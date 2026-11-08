import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import crypto from 'node:crypto';
import { createOfferFixtures } from './testSupport/offerFixtures.js';

let smtp, server, directory, origin, cookie;
const messages=[];
const sockets=new Set();
before(async()=>{
  smtp=net.createServer((socket)=>{
    sockets.add(socket);socket.on('close',()=>sockets.delete(socket));
    socket.write('220 test-smtp ESMTP\r\n');
    let buffer='',data=false,body='';
    socket.on('data',(chunk)=>{
      buffer+=chunk.toString();
      while(buffer.includes('\r\n')) {
        const at=buffer.indexOf('\r\n'),line=buffer.slice(0,at);buffer=buffer.slice(at+2);
        if(data) {
          if(line==='.') {messages.push(body);body='';data=false;socket.write('250 2.0.0 accepted\r\n');}
          else body+=line+'\r\n';
        } else if(/^EHLO|^HELO/.test(line))socket.write('250-test-smtp\r\n250-AUTH PLAIN\r\n250 SIZE 10000000\r\n');
        else if(/^AUTH/.test(line))socket.write('235 2.7.0 authenticated\r\n');
        else if(/^MAIL FROM|^RCPT TO|^RSET/.test(line))socket.write('250 OK\r\n');
        else if(line==='DATA'){data=true;socket.write('354 End data with .\r\n');}
        else if(line==='QUIT'){socket.write('221 Bye\r\n');socket.end();}
        else socket.write('250 OK\r\n');
      }
    });
  });
  await new Promise((resolve)=>smtp.listen(0,'127.0.0.1',resolve));
  directory=await fs.mkdtemp(path.join(os.tmpdir(),'qodo-offer-api-'));
  const templatesDirectory=process.env.HR_OFFERS_REAL_FIXTURES || await createOfferFixtures(path.join(directory,'templates'));
  const installation=spawnSync(process.execPath,['scripts/hr/install-offer-catalog.mjs',templatesDirectory,'engosoft'],{cwd:path.resolve(import.meta.dirname,'..'),env:{...process.env,DATABASE_URL:'',DATA_DIR:directory},encoding:'utf8'});
  assert.equal(installation.status,0,installation.stderr);
  const probe=net.createServer();
  await new Promise((resolve)=>probe.listen(0,'127.0.0.1',resolve));
  const port=probe.address().port;
  await new Promise((resolve)=>probe.close(resolve));
  origin=`http://127.0.0.1:${port}`;
  server=spawn(process.execPath,['server/index.js'],{
    cwd:path.resolve(import.meta.dirname,'..'),
    env:{...process.env,NODE_ENV:'production',DATABASE_URL:'',DATA_DIR:directory,HR_OFFER_TEMPLATES_DIR:templatesDirectory,PORT:String(port),ADMIN_EMAIL:'offers-admin@example.test',ADMIN_PASSWORD:'OfferTestPass123!',SESSION_SECRET:'offer-integration-session-secret-123456',SSO_SECRET:'offer-integration-sso-secret-123456',HR_FX_LIVE:'off',OPENAI_API_KEY:'',SMTP_HOST:'127.0.0.1',SMTP_PORT:String(smtp.address().port),SMTP_USER:'sender@example.test',SMTP_PASS:'local-test-only',SMTP_FROM:'HR <sender@example.test>'},
    stdio:['ignore','pipe','pipe'],
  });
  let errors='';server.stderr.on('data',(chunk)=>{errors+=chunk;});
  let ready=false;
  for(let attempt=0;attempt<120;attempt++) {
    try {if((await fetch(`${origin}/api/health`)).ok){ready=true;break;}} catch{}
    await new Promise((resolve)=>setTimeout(resolve,100));
  }
  assert.ok(ready,errors);
  const login=await fetch(`${origin}/api/auth/login`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:'offers-admin@example.test',password:'OfferTestPass123!'})});
  assert.equal(login.status,200);cookie=login.headers.get('set-cookie').split(';')[0];
});
after(async()=>{
  server?.kill();for(const socket of sockets)socket.destroy();
  if(smtp)await new Promise((resolve)=>smtp.close(resolve));
  if(directory)await fs.rm(directory,{recursive:true,force:true});
});
async function request(route,body,method=body===undefined?'GET':'POST',session=cookie) {
  const result=await fetch(`${origin}/api/hr/recruitment/offers${route}`,{method,headers:{Cookie:session,'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});
  return {status:result.status,data:await result.json()};
}

test('authenticated API sends a real MIME email with the generated offer and the exact mandatory handbook',async()=>{
  assert.equal((await request('/catalog',undefined,'GET','')).status,401);
  const catalog=await request('/catalog');
  assert.equal(catalog.status,200);assert.equal(catalog.data.mailConfigured,true);
  const fields={candidateName:'Test Candidate',email:'candidate@example.test',jobTitle:'Developer',department:'IT',reportingTo:'IT Manager',offerDate:'2028-11-01',validUntil:'2028-12-01',joiningDate:'2028-11-15',basicSalary:'10000',workLocation:'Cairo'};
  const preview=await request('/preview',{templateId:'offer-en',fields});
  assert.equal(preview.status,200);assert.deepEqual(preview.data.missing,[]);
  assert.ok(preview.data.email.subject.includes('Test Candidate'));
  const input={templateId:'offer-en',fields,idempotencyKey:crypto.randomUUID()};
  const created=await request('',input);assert.equal(created.status,201,JSON.stringify(created.data));
  const offer=created.data.offer;
  assert.equal(offer.attachments.length,2);
  const file=await fetch(`${origin}${offer.attachments[0].url}`,{headers:{Cookie:cookie}});
  assert.equal(file.status,200);assert.ok(file.headers.get('content-disposition').includes('.docx'));
  assert.equal(file.headers.get('cache-control'),'no-store');
  const handbookResponse=await fetch(`${origin}${offer.attachments[1].url}`,{headers:{Cookie:cookie}});
  const handbook=Buffer.from(await handbookResponse.arrayBuffer());
  const source=await fs.readFile(path.join(process.env.HR_OFFERS_REAL_FIXTURES || path.join(directory,'templates'),'employee-handbook.docx'));
  assert.deepEqual(handbook,source);
  const sent=await request(`/${offer.id}/send`,{});
  assert.equal(sent.status,200,JSON.stringify(sent.data));assert.equal(sent.data.offer.status,'sent');
  assert.equal(messages.length,1);
  assert.match(messages[0],/To: candidate@example\.test/);
  assert.ok(messages[0].includes('ENGOSOFT-offer-en.docx'));
  assert.ok(messages[0].includes('Engosoft_Employee_Handbook_2026.docx'));
  assert.ok(messages[0].replace(/\r\n/g,'').includes(handbook.toString('base64')));
  assert.equal((await request(`/${offer.id}/send`,{})).data.duplicate,true);
  assert.equal(messages.length,1);
  const list=await request('');assert.equal(list.data.offers[0].status,'sent');
  assert.equal((await fetch(`${origin}/api/hr/recruitment/offers/${offer.id}/files/0`)).status,401);
});
