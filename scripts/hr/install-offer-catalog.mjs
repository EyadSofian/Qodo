/** Install supplied HR templates into the private organization store.
 * Run after prepare-offer-templates.py; DATABASE_URL must target Qodo's store.
 * There are no public/static asset URLs and no HR document bytes in Git.
 * node scripts/hr/install-offer-catalog.mjs /private/template/directory engosoft
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { createIfAbsent, getStore, putBlob } from '../../server/store.js';

const [directory,organizationId]=process.argv.slice(2);
if (!directory || !organizationId) throw new Error('Supply template directory and organization ID.');
const root=path.resolve(directory);
const catalog=JSON.parse(await fs.readFile(path.join(root,'catalog.json'),'utf8'));
if (!catalog.templates?.length || !catalog.handbook?.sourceSha256) throw new Error('Invalid offer catalog.');
const hash=(value)=>crypto.createHash('sha256').update(value).digest('hex');
const files=[];
for (const template of catalog.templates) {
  if (!/^[a-z0-9-]+$/.test(template.id)) throw new Error('Invalid template ID.');
  const original=await fs.readFile(path.join(root,`${template.id}-original.docx`));
  if(hash(original)!==template.sourceSha256)throw new Error(`Original checksum mismatch: ${template.id}`);
  const bytes=await fs.readFile(path.join(root,`${template.id}.docx`));
  template.blobId=`offer-template-${hash(`${organizationId}:${template.id}:${hash(bytes)}`)}`;
  template.sourceBlobId=`offer-source-${hash(`${organizationId}:${template.id}:${hash(original)}`)}`;
  files.push([template.blobId,bytes],[template.sourceBlobId,original]);
}
const handbook=await fs.readFile(path.join(root,'employee-handbook.docx'));
if(hash(handbook)!==catalog.handbook.sourceSha256)throw new Error('Handbook checksum mismatch.');
catalog.handbook.blobId=`offer-handbook-${hash(`${organizationId}:${hash(handbook)}`)}`;
files.push([catalog.handbook.blobId,handbook]);
// All source checks finish before the first write. Content-derived blob IDs
// make retries safe and retain the old bytes for existing saved versions.
for (const [id,bytes] of files)await putBlob(id,bytes);
const id=`offer-catalog-${hash(organizationId)}`;
const store=await getStore();
const current=await store.get('recruitmentOfferCatalogs',id);
if(current)await store.update('recruitmentOfferCatalogs',id,{catalog});
else await createIfAbsent('recruitmentOfferCatalogs',{id,organizationId,catalog});
console.log(`Installed ${catalog.templates.length} private offer templates and the handbook for ${organizationId}.`);
process.exit(0);
