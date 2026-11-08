/** Word offers use the supplied files, not an HTML-to-Word reconstruction.
 * A saved version freezes its email, inputs and attachment bytes. A durable
 * send claim prevents double clicks, retries and concurrent servers from
 * mailing it twice. SMTP acknowledgement is acceptance, not inbox delivery.
 */
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import JSZip from 'jszip';
import { can, PERMISSIONS } from '../../../shared/permissions.js';
import { organizationOf } from '../../../shared/organization.js';
import { isIsoDate, localDay } from '../../../shared/recruitment/sla.js';
import { createIfAbsent, find, findOne, getBlob, putBlob } from '../../store.js';
import { logActivity } from '../../auth.js';
import { mailConfigured, sendMail } from '../../mail.js';
import { HRError, forbidden, notFound } from '../errors.js';

const ASSETS = process.env.HR_OFFER_TEMPLATES_DIR
  ? pathToFileURL(`${path.resolve(process.env.HR_OFFER_TEMPLATES_DIR)}${path.sep}`)
  : new URL('../assets/offers/', import.meta.url);
// The public repository contains code only. HR documents live in the private
// organization store; the local directory is an untracked development fixture.
const localCatalog = await fs.readFile(new URL('catalog.json', ASSETS), 'utf8').then(JSON.parse).catch(() => null);
async function catalogFor(user) {
  const record = await findOne('recruitmentOfferCatalogs', (row) => row.organizationId === organizationOf(user));
  const catalog = record?.catalog ?? (process.env.NODE_ENV !== 'production' ? localCatalog : null);
  if (!catalog) throw new HRError('offer_catalog_not_configured',503);
  return catalog;
}
async function assetBytes(blobId, localName) {
  const bytes = blobId ? await getBlob(blobId) : await fs.readFile(new URL(localName,ASSETS));
  if (!bytes) throw new HRError('offer_attachment_missing',503);
  return bytes;
}
const MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const hash = (value) => crypto.createHash('sha256').update(value).digest('hex');
const tokenPattern = /\{\{(\w+)\}\}/g;
const emailKeys = new Set(['candidateName', 'jobTitle', 'joiningDate', 'project', 'companyName']);
const COMMON = [
  { key: 'candidateName', required: true, type: 'text' },
  { key: 'email', required: true, type: 'email' },
  { key: 'jobTitle', required: true, type: 'text' },
];
export const DEFAULT_OFFER_EMAIL = {
  ar: { subject: 'عرض عمل ENGOSOFT — {{jobTitle}} — {{candidateName}}', body: 'السيد/ السيدة {{candidateName}}،\n\nيسعدنا تقديم العرض المرفق لوظيفة {{jobTitle}} لدى ENGOSOFT. يرجى مراجعة العرض ودليل الموظف المرفقين، وإعادة نسخة موقعة في حال الموافقة قبل انتهاء صلاحية العرض.\n\nلأي استفسار، يرجى الرد على هذا البريد.\n\nإدارة الموارد البشرية\nENGOSOFT' },
  en: { subject: 'ENGOSOFT Offer — {{jobTitle}} — {{candidateName}}', body: 'Dear {{candidateName}},\n\nWe are pleased to share the attached offer for {{jobTitle}} at ENGOSOFT. Please review the offer and the attached employee handbook, and return a signed copy if you accept before the offer expires.\n\nPlease reply to this email with any questions.\n\nHuman Resources\nENGOSOFT' },
};

export function offerAccess(user) {
  return {
    manage: can(user, PERMISSIONS.HR_MANAGE),
    allowed: can(user, PERMISSIONS.HR_MANAGE) || can(user, PERMISSIONS.HR_RECRUITMENT_OFFERS),
    configure: can(user, PERMISSIONS.HR_SETTINGS_MANAGE),
  };
}
function authorize(user) {
  const access = offerAccess(user);
  if (!access.allowed) throw forbidden(PERMISSIONS.HR_RECRUITMENT_OFFERS);
  return access;
}
export function offerTemplate(id, catalog=localCatalog) {
  const template = catalog?.templates.find((item) => item.id === id);
  if (!template) throw notFound('offer_template_not_found');
  return template;
}
function clean(value, max = 2000) {
  const result = String(value ?? '').trim();
  if (result.length > max || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(result)) throw new HRError('offer_field_invalid');
  return result;
}
export function normalizeOfferFields(template, input = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new HRError('offer_field_invalid');
  const fields = {};
  for (const field of [...COMMON, ...template.fields]) {
    const value = clean(input[field.key] ?? field.default ?? '');
    if (value && field.type === 'date' && !isIsoDate(value)) throw new HRError('offer_field_invalid', 400, { field: field.key });
    if (value && field.type === 'number' && (!/^\d+(\.\d{1,2})?$/.test(value) || Number(value) > 1_000_000_000)) throw new HRError('offer_field_invalid', 400, { field: field.key });
    // A single mailbox only: no display-name syntax, header injection or CC lists.
    if (value && field.key === 'email' && !/^[^\s@<>,;"\\]+@[^\s@<>,;"\\]+\.[^\s@<>,;"\\]+$/.test(value)) throw new HRError('offer_email_invalid');
    if (/[\r\n]/.test(value) && ['email','candidateName','jobTitle'].includes(field.key)) throw new HRError('offer_field_invalid');
    if (/\{\{|\}\}/.test(value)) throw new HRError('offer_field_invalid',400,{field:field.key});
    fields[field.key] = value;
  }
  // Totals are calculated server-side, never trusted from the form.
  for (const [key, components] of Object.entries(template.sums)) {
    fields[key] = components.every((part) => fields[part] !== '') ? String(Math.round(components.reduce((sum, part) => sum + Number(fields[part]), 0) * 100) / 100) : '';
  }
  if (fields.offerDate && fields.validUntil && fields.validUntil < fields.offerDate) throw new HRError('offer_dates_invalid');
  return fields;
}
export function missingOfferFields(template, fields) {
  return [...new Set([...COMMON,...template.fields].filter((field) => field.required && !fields[field.key]).map((field) => field.key))];
}
const fill = (text, fields, missing = '________') => String(text).replace(tokenPattern, (_, key) => fields[key] || missing);
const xmlEscape = (text) => String(text).replace(/[&<>"']/g, (c) => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;' })[c]);
export async function renderOfferDocx(template, fields) {
  const zip = await JSZip.loadAsync(await assetBytes(template.blobId,`${template.id}.docx`));
  const document = await zip.file('word/document.xml').async('string');
  zip.file('word/document.xml', document.replace(tokenPattern, (_, key) => xmlEscape(fields[key] || '________')));
  return zip.generateAsync({ type:'nodebuffer', compression:'DEFLATE' });
}

async function emailTemplates(user) {
  const settings = await findOne('recruitmentOfferEmailTemplates', (row) => row.organizationId === organizationOf(user));
  return settings?.templates ?? DEFAULT_OFFER_EMAIL;
}
function validateEmailTemplate(value) {
  const subject = clean(value?.subject, 240), body = clean(value?.body, 16000);
  if (!subject || !body || /[\r\n]/.test(subject)) throw new HRError('offer_email_template_invalid');
  for (const text of [subject,body]) {
    if ([...text.matchAll(tokenPattern)].some((match) => !emailKeys.has(match[1])) || /\{\{|\}\}/.test(text.replace(tokenPattern,''))) throw new HRError('offer_email_template_invalid');
  }
  return { subject, body };
}
export async function saveOfferEmailTemplate(user, input) {
  authorize(user);
  if (!offerAccess(user).configure) throw forbidden(PERMISSIONS.HR_SETTINGS_MANAGE);
  const templates = { ar:validateEmailTemplate(input?.ar), en:validateEmailTemplate(input?.en) };
  const { getStore } = await import('../../store.js');
  const store = await getStore();
  const id = `offer-email-${hash(organizationOf(user))}`;
  const existing = await store.get('recruitmentOfferEmailTemplates',id);
  if (existing) await store.update('recruitmentOfferEmailTemplates',id,{templates,updatedBy:user.id});
  else await createIfAbsent('recruitmentOfferEmailTemplates',{id,organizationId:organizationOf(user),templates,updatedBy:user.id});
  await audit(user,'hr.offer.email_template',id);
  return { templates };
}
async function audit(user, action, id) {
  await logActivity({ actorId:user.id, organizationId:organizationOf(user), action, subject:'recruitment_offer', subjectId:id });
}
export async function offerCatalog(user) {
  const access = authorize(user);
  const catalog=await catalogFor(user);
  return { ...catalog, access, emailTemplates:await emailTemplates(user), mailConfigured:mailConfigured() };
}
export async function previewOffer(user, input) {
  authorize(user);
  const template = offerTemplate(input?.templateId,await catalogFor(user));
  const fields = normalizeOfferFields(template,input?.fields);
  const language = input?.language === 'ar' ? 'ar' : input?.language === 'en' ? 'en' : template.language;
  const draftEmail = validateEmailTemplate(input?.emailTemplate ?? (await emailTemplates(user))[language]);
  const emailFields = {...fields,companyName:'ENGOSOFT'};
  const email = { subject:fill(draftEmail.subject,emailFields),body:fill(draftEmail.body,emailFields) };
  const blocks = template.blocks.map((block) => block.type === 'paragraph'
    ? {...block,text:fill(block.text,fields)}
    : {...block,rows:block.rows.map((row) => row.map((cell) => cell.map((text) => fill(text,fields))))});
  return { templateId:template.id,fields,language,email,emailTemplate:draftEmail,blocks,missing:missingOfferFields(template,fields) };
}
function keyOf(input) {
  const key = String(input?.idempotencyKey ?? '');
  if (!/^[a-zA-Z0-9_-]{10,120}$/.test(key)) throw new HRError('offer_idempotency_required');
  return key;
}
export async function createOfferDraft(user, input) {
  authorize(user);
  const preview = await previewOffer(user,input);
  const catalog=await catalogFor(user);
  const template = offerTemplate(preview.templateId,catalog);
  const includeApplication = input?.includeApplication === true && template.id !== 'application';
  const payloadHash = hash(JSON.stringify({templateId:preview.templateId,fields:preview.fields,language:preview.language,email:preview.email,includeApplication}));
  const id = `offer-${hash(`${organizationOf(user)}:${user.id}:${keyOf(input)}`)}`;
  const existing = await findOne('recruitmentOffers',(row) => row.id === id);
  if (existing) {
    if (existing.payloadHash !== payloadHash) throw new HRError('offer_idempotency_conflict',409);
    return getOffer(user,id);
  }
  const docx = await renderOfferDocx(template,preview.fields);
  const files = [
    {filename:`ENGOSOFT-${template.id}.docx`,content:docx},
    // Always appended here; the client cannot remove or replace this file.
    {filename:catalog.handbook.filename,content:await assetBytes(catalog.handbook.blobId,'employee-handbook.docx')},
  ];
  if (includeApplication) files.push({filename:'Engosoft_Employment_Application.docx',content:await renderOfferDocx(offerTemplate('application',catalog),preview.fields)});
  const attachments=[];
  for (const [index,file] of files.entries()) {
    const blobId = `offer-file-${hash(`${id}:${payloadHash}:${index}`)}`;
    await putBlob(blobId,file.content);
    attachments.push({blobId,filename:file.filename,contentType:MIME,bytes:file.content.length,sha256:hash(file.content)});
  }
  const result = await createIfAbsent('recruitmentOffers',{
    id,organizationId:organizationOf(user),createdBy:user.id,status:'draft',payloadHash,
    templateId:template.id,templateVersion:catalog.version,sourceSha256:template.sourceSha256,
    fields:preview.fields,language:preview.language,email:preview.email,emailTemplate:preview.emailTemplate,blocks:preview.blocks,
    includeApplication,missing:preview.missing,attachments,
  });
  if (result.created) await audit(user,'hr.offer.draft',id);
  if (result.doc.payloadHash !== payloadHash) throw new HRError('offer_idempotency_conflict',409);
  return getOffer(user,id);
}
async function offerFor(user,id) {
  const access=authorize(user);
  const offer=await findOne('recruitmentOffers',(row) => row.id === id && row.organizationId === organizationOf(user));
  if (!offer || (!access.manage && offer.createdBy !== user.id)) throw notFound('offer_not_found');
  return offer;
}
function publicOffer(offer,receipt) {
  const {payloadHash,...item}=offer;
  return {...item,status:receipt?.status ?? offer.status,sentAt:receipt?.sentAt ?? null,messageId:receipt?.messageId ?? null,failureCode:receipt?.failureCode ?? null,
    attachments:offer.attachments.map(({blobId,...file},index) => ({...file,url:`/api/hr/recruitment/offers/${offer.id}/files/${index}`}))};
}
export async function getOffer(user,id) {
  const offer=await offerFor(user,id);
  const receipt=await findOne('recruitmentOfferSends',(row) => row.id === `send-${offer.id}`);
  return {offer:publicOffer(offer,receipt)};
}
export async function listOffers(user) {
  const access=authorize(user);
  const [offers,receipts]=await Promise.all([
    find('recruitmentOffers',(row) => row.organizationId === organizationOf(user) && (access.manage || row.createdBy === user.id)),
    find('recruitmentOfferSends',(row) => row.organizationId === organizationOf(user)),
  ]);
  const sends=new Map(receipts.map((row) => [row.id,row]));
  return {offers:offers.sort((a,b) => b.createdAt.localeCompare(a.createdAt)).map((row) => publicOffer(row,sends.get(`send-${row.id}`)))};
}
export async function offerFile(user,id,index) {
  const offer=await offerFor(user,id);
  if (!/^\d+$/.test(String(index))) throw notFound();
  const file=offer.attachments[Number(index)];
  if (!file) throw notFound();
  const bytes=await getBlob(file.blobId);
  if (!bytes || hash(bytes)!==file.sha256) throw new HRError('offer_attachment_missing',503);
  return {...file,bytes};
}
export async function sourceOfferFile(user,id) {
  authorize(user);
  const catalog=await catalogFor(user);
  const template=id==='handbook'?null:offerTemplate(id,catalog);
  const file=id==='handbook'?'employee-handbook.docx':`${template.id}-original.docx`;
  return {filename:file,contentType:MIME,bytes:await assetBytes(template?template.sourceBlobId:catalog.handbook.blobId,file)};
}

export async function sendOffer(user,id,{ send=sendMail,configured=mailConfigured }={}) {
  const offer=await offerFor(user,id);
  const previous=await findOne('recruitmentOfferSends',(row) => row.id === `send-${offer.id}`);
  if (previous) return {offer:publicOffer(offer,previous),duplicate:true};
  if (offer.missing.length) throw new HRError('offer_fields_required',400,{fields:offer.missing});
  if (offer.fields.validUntil && offer.fields.validUntil < localDay(new Date(),'Africa/Cairo')) throw new HRError('offer_expired');
  if (!configured()) throw new HRError('offer_mail_not_configured',503);
  // Read and verify every frozen attachment before consuming the send claim.
  const attachments=[];
  for (let i=0;i<offer.attachments.length;i++) {
    const file=await offerFile(user,id,String(i));
    attachments.push({filename:file.filename,content:file.bytes,contentType:file.contentType});
  }
  const {doc:receipt,created}=await createIfAbsent('recruitmentOfferSends',{
    id:`send-${id}`,organizationId:organizationOf(user),offerId:id,status:'sending',startedAt:new Date().toISOString(),sentBy:user.id,
  });
  if (!created) return {offer:publicOffer(offer,receipt),duplicate:true};
  await audit(user,'hr.offer.send_started',id);
  let result;
  try {
    result=await send({to:offer.fields.email,subject:offer.email.subject,text:offer.email.body,attachments,messageId:`<${id}@qodo.engosoft.com>`});
  } catch { result={sent:false}; }
  // If the connection drops after DATA, SMTP cannot tell us whether it landed.
  // Do not retry it automatically or label an ambiguous failure as unsent.
  const sent=result?.sent===true;
  const status=sent?'sent':result?.reason==='recipient_rejected'?'failed':'unknown';
  const {getStore}=await import('../../store.js');
  const updated=await (await getStore()).update('recruitmentOfferSends',receipt.id,{
    status,sentAt:sent?new Date().toISOString():null,messageId:sent?result.messageId ?? null:null,
    failureCode:sent?null:status==='failed'?'recipient_rejected':'smtp_outcome_unknown',
  });
  await audit(user,`hr.offer.${status}`,id);
  return {offer:publicOffer(offer,updated)};
}
