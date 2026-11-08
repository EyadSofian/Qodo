/** Synthetic, non-confidential Word fixtures. Actual company documents never
 * enter Git. Set HR_OFFERS_REAL_FIXTURES for an additional private-source run.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import JSZip from 'jszip';

export async function createOfferFixtures(directory) {
  await fs.mkdir(directory,{recursive:true});
  const templates=[];
  const money=['basicSalary','transportAllowance','workAllowance','skillAllowance','housingAllowance','livingAllowance','kpiBonus'];
  for(const id of ['offer-ar','offer-en','offer-en-appendix','contract-ar','freelance-uiux','lms-manager','application']) {
    const fields=[
      ...['candidateName','email','jobTitle','department','reportingTo','workLocation'].map((key)=>({key,type:'text',required:true,default:''})),
      ...['offerDate','validUntil','joiningDate'].map((key)=>({key,type:'date',required:true,default:''})),
      ...[...money,'grossSalary'].map((key)=>({key,type:'number',required:true,default:key==='basicSalary'?'':'0',computed:key==='grossSalary'})),
    ].map((field)=>({...field,label:{ar:field.key,en:field.key}}));
    const zip=new JSZip();
    zip.file('[Content_Types].xml','<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/></Types>');
    const xml=`<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${fields.map((field)=>`<w:p><w:r><w:t>{{${field.key}}}</w:t></w:r></w:p>`).join('')}</w:body></w:document>`;
    zip.file('word/document.xml',xml);
    zip.file('word/header1.xml','<header>Synthetic test letterhead</header>');
    zip.file('word/styles.xml','<styles>Synthetic test styles</styles>');
    const bytes=await zip.generateAsync({type:'nodebuffer'});
    await fs.writeFile(path.join(directory,`${id}.docx`),bytes);
    await fs.writeFile(path.join(directory,`${id}-original.docx`),bytes);
    templates.push({id,label:{ar:id,en:id},language:id==='offer-ar'?'ar':'en',kind:'offer',sourceName:`${id}.docx`,sourceSha256:crypto.createHash('sha256').update(bytes).digest('hex'),fields,blocks:fields.map((field)=>({type:'paragraph',text:`{{${field.key}}}`})),sums:{grossSalary:money}});
  }
  const handbook=Buffer.from('Synthetic handbook fixture — contains no company HR information.');
  await fs.writeFile(path.join(directory,'employee-handbook.docx'),handbook);
  await fs.writeFile(path.join(directory,'catalog.json'),JSON.stringify({version:'test-v1',handbook:{filename:'Engosoft_Employee_Handbook_2026.docx',sourceSha256:crypto.createHash('sha256').update(handbook).digest('hex')},templates}));
  return directory;
}
