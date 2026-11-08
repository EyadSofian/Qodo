import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import JSZip from 'jszip';
import { createOfferFixtures } from './testSupport/offerFixtures.js';

let dir, service, store;
const manager={id:'offer-manager',organizationId:'offers-test',role:'member',status:'active',permissions:['hr.manage','hr.settings.manage']};
const recruiter={id:'offer-recruiter',organizationId:'offers-test',role:'member',status:'active',permissions:['hr.recruitment.offers']};
const outsider={...recruiter,id:'offer-other'};
const foreign={...manager,id:'offer-foreign',organizationId:'other-organization'};
before(async()=>{
  dir=await fs.mkdtemp(path.join(os.tmpdir(),'qodo-offers-'));
  process.env.DATA_DIR=dir;
  process.env.HR_OFFER_TEMPLATES_DIR=process.env.HR_OFFERS_REAL_FIXTURES || await createOfferFixtures(path.join(dir,'templates'));
  service=await import('./hr/recruitment/offers.js');
  store=await import('./store.js');
});
after(async()=>{if(dir)await fs.rm(dir,{recursive:true,force:true});});

function values(template) {
  const fields={candidateName:'أحمد & <مصطفى>',email:'candidate@example.test',jobTitle:'Engineer & Designer'};
  for(const field of template.fields) {
    fields[field.key]=field.type==='date'?'2028-12-01':field.type==='number'?'100':`Value ${field.key}`;
  }
  Object.assign(fields,{candidateName:'أحمد & <مصطفى>',email:'candidate@example.test',jobTitle:'Engineer & Designer',offerDate:'2028-11-01',validUntil:'2028-12-01',joiningDate:'2028-12-01'});
  return fields;
}
const draftInput=(template,fields)=>({templateId:template.id,fields,idempotencyKey:crypto.randomUUID()});

test('all seven supplied templates render safely, preserve Word parts and replace sample identities',async()=>{
  const catalog=await service.offerCatalog(manager);
  assert.equal(catalog.templates.length,7);
  for(const template of catalog.templates) {
    const fields=service.normalizeOfferFields(template,values(template));
    assert.deepEqual(service.missingOfferFields(template,fields),[]);
    const rendered=await JSZip.loadAsync(await service.renderOfferDocx(template,fields));
    const source=await JSZip.loadAsync((await service.sourceOfferFile(manager,template.id)).bytes);
    const xml=await rendered.file('word/document.xml').async('string');
    assert.ok(!xml.includes('{{'),template.id);
    assert.ok(!/Osama Ahmed|\[Ahmed/.test(xml),template.id);
    assert.ok(xml.includes('أحمد &amp; &lt;مصطفى&gt;'),template.id);
    assert.ok(!xml.includes('&amp;amp;'),template.id);
    for(const [name,entry] of Object.entries(source.files)) {
      if(entry.dir || name==='word/document.xml')continue;
      assert.deepEqual(await rendered.file(name).async('nodebuffer'),await entry.async('nodebuffer'),`${template.id}: ${name}`);
    }
    const preview=await service.previewOffer(manager,{templateId:template.id,fields});
    assert.ok(JSON.stringify(preview.blocks).includes('أحمد & <مصطفى>'));
    if(template.sums.grossSalary)assert.equal(Number(fields.grossSalary),template.sums.grossSalary.length*100);
  }
});

test('validation rejects recipient lists, injected headers, invalid dates, amounts and template variables',async()=>{
  const template=service.offerTemplate('offer-en');
  for(const patch of [{email:'a@example.test,b@example.test'},{email:'a@example.test\r\nBcc: b@example.test'},{joiningDate:'2026-02-30'},{basicSalary:'-1'},{candidateName:'{{email}}'},{validUntil:'2028-01-01'}]) {
    assert.throws(()=>service.normalizeOfferFields(template,{...values(template),...patch}));
  }
  await assert.rejects(()=>service.previewOffer(manager,{templateId:template.id,fields:values(template),emailTemplate:{subject:'Hello {{password}}',body:'test'}}),{code:'offer_email_template_invalid'});
  await assert.rejects(()=>service.offerCatalog({...recruiter,permissions:['hr.recruitment.view']}),{status:403});
  await assert.rejects(()=>service.offerCatalog({...recruiter,status:'inactive'}),{status:403});
});

test('drafts freeze generated files and mandatory handbook; access stays within creator and organization',async()=>{
  const template=service.offerTemplate('offer-en');
  const input={...draftInput(template,values(template)),includeApplication:true};
  const first=await service.createOfferDraft(recruiter,input);
  const duplicate=await service.createOfferDraft(recruiter,input);
  assert.equal(duplicate.offer.id,first.offer.id);
  assert.equal(first.offer.attachments.length,3);
  await assert.rejects(()=>service.createOfferDraft(recruiter,{...input,fields:{...input.fields,candidateName:'Different'}}),{code:'offer_idempotency_conflict'});
  const handbook=await service.offerFile(recruiter,first.offer.id,'1');
  assert.deepEqual(handbook.bytes,(await service.sourceOfferFile(manager,'handbook')).bytes);
  await assert.rejects(()=>service.getOffer(outsider,first.offer.id),{status:404});
  await assert.rejects(()=>service.offerFile(foreign,first.offer.id,'0'),{status:404});
  assert.equal((await service.getOffer(manager,first.offer.id)).offer.id,first.offer.id);
  assert.deepEqual((await service.listOffers(outsider)).offers,[]);
  await assert.rejects(()=>service.sendOffer(recruiter,first.offer.id,{configured:()=>false}),{code:'offer_mail_not_configured'});
  assert.equal((await service.getOffer(recruiter,first.offer.id)).offer.status,'draft');
});

test('concurrent sends claim once, use only frozen bytes and expose SMTP acceptance separately',async()=>{
  const template=service.offerTemplate('offer-ar');
  const {offer}=await service.createOfferDraft(recruiter,draftInput(template,values(template)));
  let calls=0;
  const send=async(message)=>{
    calls++;
    assert.equal(message.to,'candidate@example.test');
    assert.equal(message.attachments.length,2);
    assert.deepEqual(message.attachments[1].content,(await service.sourceOfferFile(manager,'handbook')).bytes);
    await new Promise((resolve)=>setTimeout(resolve,30));
    return {sent:true,messageId:'smtp-accepted-test'};
  };
  const results=await Promise.all([service.sendOffer(recruiter,offer.id,{configured:()=>true,send}),service.sendOffer(recruiter,offer.id,{configured:()=>true,send})]);
  assert.equal(calls,1);
  assert.ok(results.some((result)=>result.duplicate));
  const result=await service.getOffer(recruiter,offer.id);
  assert.equal(result.offer.status,'sent');
  assert.equal(result.offer.messageId,'smtp-accepted-test');
  assert.ok(result.offer.sentAt);
  await service.sendOffer(recruiter,offer.id,{configured:()=>true,send});
  assert.equal(calls,1);
});

test('partial drafts cannot send, ambiguous SMTP errors stay visible and never auto-retry',async()=>{
  const template=service.offerTemplate('freelance-uiux');
  const partial=await service.createOfferDraft(recruiter,draftInput(template,{}));
  await assert.rejects(()=>service.sendOffer(recruiter,partial.offer.id,{configured:()=>true}),{code:'offer_fields_required'});
  const {offer}=await service.createOfferDraft(recruiter,draftInput(template,values(template)));
  let calls=0;
  const send=async()=>{calls++;throw new Error('connection lost after DATA');};
  const result=await service.sendOffer(recruiter,offer.id,{configured:()=>true,send});
  assert.equal(result.offer.status,'unknown');
  assert.equal(result.offer.failureCode,'smtp_outcome_unknown');
  await service.sendOffer(recruiter,offer.id,{configured:()=>true,send});
  assert.equal(calls,1);
  const receipts=await store.find('recruitmentOfferSends',(row)=>row.offerId===offer.id);
  assert.equal(receipts.length,1);
});

test('only HR settings owners can change the shared message; old versions stay frozen',async()=>{
  const template=service.offerTemplate('offer-en');
  const {offer}=await service.createOfferDraft(recruiter,draftInput(template,values(template)));
  const templates={...service.DEFAULT_OFFER_EMAIL,en:{subject:'Welcome {{candidateName}}',body:'New message for {{jobTitle}}'}};
  await assert.rejects(()=>service.saveOfferEmailTemplate(recruiter,templates),{status:403});
  await service.saveOfferEmailTemplate(manager,templates);
  assert.equal((await service.offerCatalog(recruiter)).emailTemplates.en.subject,templates.en.subject);
  assert.equal((await service.getOffer(recruiter,offer.id)).offer.email.subject,offer.email.subject);
  assert.equal((await service.offerCatalog(foreign)).emailTemplates.en.subject,service.DEFAULT_OFFER_EMAIL.en.subject);
});
