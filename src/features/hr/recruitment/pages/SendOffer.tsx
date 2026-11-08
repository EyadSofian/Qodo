import { useRef, useState, type ReactNode } from 'react';
import { Check, ChevronLeft, ChevronRight, Download, FileCheck2, FileText, Mail, Paperclip, Plus, Save, Send, ShieldCheck } from 'lucide-react';
import { api, errorMessage } from '../../../../lib/api';
import { useHRQuery, idempotencyKey } from '../../api';
import { useHRText } from '../../format';
import { Badge, Card, PageHeader, SectionTitle } from '../../ui/primitives';
import { ErrorBlock, PageSkeleton } from '../../ui/states';
import type { Localised } from '../../types';

type Field = { key:string; label:Localised; type:string; required:boolean; default:string; computed:boolean };
type Block = { type:'paragraph';text:string } | { type:'table'; rows:string[][][] };
type Email = { subject:string;body:string };
type Template = {id:string;label:Localised;language:'ar'|'en';kind:string;sourceName:string;fields:Field[];sums:Record<string,string[]>};
type Offer = {id:string;templateId:string;fields:Record<string,string>;language:'ar'|'en';email:Email;emailTemplate:Email;blocks?:Block[];includeApplication:boolean;status:string;createdAt:string;sentAt:string|null;attachments:{filename:string;url:string;bytes:number}[];missing:string[]};
type Catalog = {templates:Template[];access:{allowed:boolean;manage:boolean;configure:boolean};mailConfigured:boolean;emailTemplates:{ar:Email;en:Email}};
type Preview = {fields:Record<string,string>;email:Email;blocks:Block[];missing:string[]};
const ROOT='/hr/recruitment/offers';
const common:Field[]=[
  {key:'candidateName',label:{ar:'اسم المرشح',en:'Candidate name'},type:'text',required:true,default:'',computed:false},
  {key:'email',label:{ar:'بريد المرشح',en:'Candidate email'},type:'email',required:true,default:'',computed:false},
  {key:'jobTitle',label:{ar:'المسمى الوظيفي',en:'Job title'},type:'text',required:true,default:'',computed:false},
];
const stamp=(date:string,lang:string) => new Date(date).toLocaleString(lang==='ar'?'ar-EG-u-nu-latn':'en-GB',{dateStyle:'medium',timeStyle:'short',timeZone:'Africa/Cairo'});

function Label({label,children,required}:{label:string;children:ReactNode;required?:boolean}) {
  return <label className="block min-w-0"><span className="label">{label}{required && <span className="ms-1 text-rose-600">*</span>}</span>{children}</label>;
}
function DocumentPreview({blocks,language}:{blocks:Block[];language:string}) {
  return <article dir={language==='ar'?'rtl':'ltr'} className="mx-auto max-w-3xl rounded-xl border border-slate-200 bg-white px-5 py-8 text-[12px] leading-7 text-slate-800 shadow-sm sm:px-9">
    <div className="mb-6 border-b-2 border-slate-800 pb-3 text-lg font-black tracking-widest" dir="ltr">ENGOSOFT</div>
    {blocks.map((block,index) => block.type==='paragraph'
      ? <p key={index} className="my-2 whitespace-pre-wrap [overflow-wrap:anywhere]">{block.text}</p>
      : <div key={index} className="my-4 overflow-x-auto"><table className="w-full border-collapse text-start"><tbody>{block.rows.map((row,ri)=><tr key={ri}>{row.map((cell,ci)=><td key={ci} className="min-w-24 border border-slate-200 px-3 py-2 align-top">{cell.map((text,pi)=><p key={pi} className="min-h-4 whitespace-pre-wrap [overflow-wrap:anywhere]">{text}</p>)}</td>)}</tr>)}</tbody></table></div>)}
  </article>;
}

export function SendOffer() {
  const {t,pick,lang}=useHRText();
  const {data:catalog,error,loading,reload}=useHRQuery<Catalog>(`${ROOT}/catalog`);
  const {data:history,reload:reloadHistory}=useHRQuery<{offers:Offer[]}>(`${ROOT}`);
  const [templateId,setTemplateId]=useState('offer-ar');
  const [fields,setFields]=useState<Record<string,string>>({});
  const [language,setLanguage]=useState<'ar'|'en'>('ar');
  const [emailTemplate,setEmailTemplate]=useState<Email|null>(null);
  const [includeApplication,setIncludeApplication]=useState(false);
  const [step,setStep]=useState(0);
  const [preview,setPreview]=useState<Preview|null>(null);
  const [draft,setDraft]=useState<Offer|null>(null);
  const [busy,setBusy]=useState(false);
  const [failure,setFailure]=useState<unknown>(null);
  const [notice,setNotice]=useState('');
  const [showEmailSettings,setShowEmailSettings]=useState(false);
  const [settingsLanguage,setSettingsLanguage]=useState<'ar'|'en'>('ar');
  const [settingsEmail,setSettingsEmail]=useState<Email|null>(null);
  const key=useRef(idempotencyKey());
  const actionLock=useRef(false);
  const template=catalog?.templates.find((item)=>item.id===templateId);
  const effectiveEmail=emailTemplate ?? catalog?.emailTemplates[language] ?? {subject:'',body:''};
  const effectiveFields={...Object.fromEntries((template?.fields ?? []).map((field)=>[field.key,field.default])),...fields};
  const fieldList=[...common,...(template?.fields ?? []).filter((field)=>!common.some((item)=>item.key===field.key))];
  for (const [total,parts] of Object.entries(template?.sums ?? {})) {
    effectiveFields[total]=parts.every((part)=>effectiveFields[part]!=='' && effectiveFields[part]!==undefined) ? String(Math.round(parts.reduce((sum,part)=>sum+Number(effectiveFields[part]),0)*100)/100):'';
  }
  function changed() {key.current=idempotencyKey();setDraft(null);setPreview(null);setFailure(null);setNotice('');}
  function changeField(name:string,value:string) {changed();setFields((current)=>({...current,[name]:value}));}
  function selectTemplate(item:Template) {
    changed();setTemplateId(item.id);setLanguage(item.language);setEmailTemplate(null);
    // Carry only identity across templates; salary and project terms belong to their own form.
    setFields((current)=>Object.fromEntries(common.filter((field)=>field.key!=='jobTitle').map((field)=>[field.key,current[field.key] ?? ''])));
    setStep(1);
  }
  const payload=()=>({templateId,fields:effectiveFields,language,emailTemplate:effectiveEmail,includeApplication,idempotencyKey:key.current});
  async function action(work:()=>Promise<void>) {
    if(actionLock.current)return;
    actionLock.current=true;setBusy(true);setFailure(null);setNotice('');
    try {await work();} catch(error) {setFailure(error);} finally {actionLock.current=false;setBusy(false);}
  }
  async function review() {
    await action(async()=>{
      const result=await api.post<Preview>(`${ROOT}/preview`,payload());setPreview(result);setStep(2);
    });
  }
  async function save() {
    return draft ?? (await api.post<{offer:Offer}>(ROOT,payload())).offer;
  }
  function saveDraft() {void action(async()=>{const offer=await save();setDraft(offer);setNotice(t('تم حفظ نسخة العرض ومرفقاته.','The offer version and its attachments are saved.'));await reloadHistory();});}
  function send() {void action(async()=>{
    const offer=await save();setDraft(offer);
    const result=await api.post<{offer:Offer}>(`${ROOT}/${offer.id}/send`);setDraft(result.offer);
    setNotice(result.offer.status==='sent'?t('قبل خادم البريد الرسالة. راجع سجل العرض.','The mail server accepted the message. See the offer history.'):t('راجع حالة الإرسال في السجل قبل أي محاولة أخرى.','Review the send status before any further attempt.'));
    await reloadHistory();
  });}
  function openOffer(offer:Offer) {void action(async()=>{
    setTemplateId(offer.templateId);setFields(offer.fields);setLanguage(offer.language);setEmailTemplate(offer.emailTemplate);setIncludeApplication(offer.includeApplication);setDraft(offer);
    const result=offer.blocks ? {fields:offer.fields,email:offer.email,blocks:offer.blocks,missing:offer.missing} : await api.post<Preview>(`${ROOT}/preview`,{templateId:offer.templateId,fields:offer.fields,language:offer.language,emailTemplate:offer.emailTemplate});
    setPreview({...result,email:offer.email});setStep(2);
  });}
  function status(value:string) {
    return ({draft:t('مسودة','Draft'),sending:t('جارٍ الإرسال — لا تعِد المحاولة','Sending — do not retry'),sent:t('قبله خادم البريد','Accepted by mail server'),failed:t('رفض البريد المستلم','Recipient rejected'),unknown:t('نتيجة غير مؤكدة — راجع صندوق الصادر','Unconfirmed — check Sent mail')})[value] ?? value;
  }
  if(error && !catalog)return <ErrorBlock error={error} onRetry={reload}/>;
  if(loading || !catalog || !template)return <PageSkeleton/>;
  const missing=preview?.missing ?? [];
  const locked=Boolean(draft && draft.status!=='draft');
  return <div className="space-y-6">
    <PageHeader eyebrow={t('التوظيف / عروض العمل','RECRUITMENT / OFFERS')} title={t('إرسال عرض عمل','Send Offer')} description={t('اختر النموذج، أدخل بيانات المرشح، ثم راجع العرض وأرسله. دليل الموظف يُرفق تلقائيًا.','Choose a template, enter the candidate details, review and send. The employee handbook is attached automatically.')} actions={<button type="button" className="btn-ghost border-white/30 bg-white/15 text-white" disabled={busy} onClick={()=>{changed();setFields({});setEmailTemplate(null);setStep(0);}}><Plus size={16}/>{t('عرض جديد','New offer')}</button>}/>
    <div className="flex flex-wrap items-center gap-2" aria-label={t('خطوات إرسال العرض','Offer steps')}>
      {[t('اختيار النموذج','Choose template'),t('البيانات والإيميل','Details & email'),t('المراجعة والإرسال','Review & send')].map((title,index)=><button key={index} type="button" disabled={busy || index>step} aria-current={step===index?'step':undefined} className={`flex items-center gap-2 rounded-full border px-4 py-2 text-[12px] font-bold ${step===index?'border-slate-900 bg-slate-900 text-white':'border-white bg-white/60 text-slate-600'}`} onClick={()=>{setStep(index);if(index<2 && locked){key.current=idempotencyKey();setDraft(null);}}}><span className="grid h-5 w-5 place-items-center rounded-full border border-current text-[10px]">{index<step?<Check size={12}/>:index+1}</span>{title}</button>)}
    </div>
    {!catalog.mailConfigured && <div role="status" className="rounded-2xl border border-amber-200 bg-amber-50 px-5 py-4 text-[13px] leading-6 text-amber-900">{t('البريد الخارجي غير مُعدّ حاليًا. يمكنك تجهيز العروض وتنزيلها؛ الإرسال يتاح بعد إعداد بريد الشركة على الخادم.','External email is not configured. You can prepare and download offers; sending becomes available once company mail is configured.')}</div>}
    {failure!==null && <div role="alert" className="rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800">{errorMessage(failure,lang)}</div>}
    {notice && <div role="status" className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-900">{notice}</div>}

    {step===0 && <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">{catalog.templates.map((item)=><button type="button" key={item.id} onClick={()=>selectTemplate(item)} className="hr-glass hr-lift rounded-3xl p-6 text-start"><div className="mb-5 flex items-center justify-between"><span className="grid h-12 w-12 place-items-center rounded-2xl bg-slate-900 text-white"><FileText size={22}/></span><Badge>{item.language.toUpperCase()}</Badge></div><h2 className="text-base font-bold text-navy">{pick(item.label)}</h2><p className="mt-2 break-words text-[11px] leading-5 text-slate-500" dir="ltr">{item.sourceName}</p><span className="mt-5 inline-flex items-center gap-2 text-[12px] font-bold text-[rgb(var(--hr-a1))]">{t('استخدام النموذج','Use template')}{lang==='ar'?<ChevronLeft size={15}/>:<ChevronRight size={15}/>}</span></button>)}</div>}

    {step===1 && <form onSubmit={(event)=>{event.preventDefault();void review();}} className="grid grid-cols-1 items-start gap-5 xl:grid-cols-[minmax(0,1fr)_340px]">
      <Card><SectionTitle title={pick(template.label)} hint={t('القيم المحسوبة تجمع بنود الراتب تلقائيًا. حقول التوقيع تبقى للتوقيع الفعلي.','Calculated totals add the salary components. Signature spaces are left for actual signatures.')} action={<a href={`/api${ROOT}/sources/${template.id}`} className="inline-flex items-center gap-1"><Download size={14}/>{t('الأصل','Original')}</a>}/>
        <fieldset disabled={busy} className="grid grid-cols-1 gap-4 sm:grid-cols-2">{fieldList.map((field)=><Label key={field.key} label={pick(field.label)} required={field.required}><input className="input w-full" name={field.key} type={field.type} value={effectiveFields[field.key] ?? ''} required={field.required && !field.computed} readOnly={field.computed} min={field.type==='number'?'0':undefined} step={field.type==='number'?'0.01':undefined} dir={['email','date','number'].includes(field.type)?'ltr':undefined} autoComplete={field.key==='email'?'email':field.key==='candidateName'?'name':'off'} onInput={field.type==='date'?(event)=>changeField(field.key,event.currentTarget.value):undefined} onChange={(event)=>changeField(field.key,event.target.value)}/></Label>)}</fieldset>
      </Card>
      <div className="space-y-4"><Card><SectionTitle title={t('نص الإيميل','Email message')}/><fieldset disabled={busy} className="space-y-4"><Label label={t('لغة الإيميل','Email language')}><select className="input w-full" value={language} onChange={(event)=>{changed();setLanguage(event.target.value as 'ar'|'en');setEmailTemplate(null);}}><option value="ar">العربية</option><option value="en">English</option></select></Label><Label label={t('العنوان','Subject')} required><input className="input w-full" maxLength={240} required value={effectiveEmail.subject} onChange={(event)=>{changed();setEmailTemplate({...effectiveEmail,subject:event.target.value});}}/></Label><Label label={t('الرسالة','Message')} required><textarea className="input min-h-64 w-full text-[12px] leading-6" required maxLength={16000} dir={language==='ar'?'rtl':'ltr'} value={effectiveEmail.body} onChange={(event)=>{changed();setEmailTemplate({...effectiveEmail,body:event.target.value});}}/></Label><p className="text-[11px] leading-5 text-slate-500">{t('يمكن استخدام المتغيرات:','Available variables:')} <bdi>{'{{candidateName}}, {{jobTitle}}, {{joiningDate}}, {{project}}, {{companyName}}'}</bdi></p></fieldset></Card>
        <Card><SectionTitle title={t('المرفقات','Attachments')}/><div className="space-y-3 text-[12px]"><p className="flex items-center gap-2"><FileText size={17}/>{pick(template.label)}</p><p className="flex items-center gap-2 font-bold text-emerald-700"><ShieldCheck size={17}/>{t('دليل الموظف — مرفق تلقائيًا','Employee handbook — always attached')}</p><a className="inline-flex items-center gap-1 text-slate-500 underline" href={`/api${ROOT}/sources/handbook`}><Download size={13}/>{t('تنزيل دليل الموظف','Download handbook')}</a>{templateId!=='application' && <label className="flex items-start gap-2"><input type="checkbox" className="mt-1" checked={includeApplication} disabled={busy} onChange={(event)=>{changed();setIncludeApplication(event.target.checked);}}/><span>{t('إرفاق طلب توظيف (البيانات الأساسية فقط؛ باقيه يملؤه المرشح)','Attach employment application (basic details filled; remaining sections for the candidate)')}</span></label>}</div></Card>
        <button type="submit" className="btn-primary w-full" disabled={busy}><FileCheck2 size={17}/>{busy?t('جارٍ التجهيز…','Preparing…'):t('معاينة العرض والإيميل','Preview offer & email')}</button>
        <button type="button" className="btn-ghost w-full" disabled={busy} onClick={saveDraft}><Save size={16}/>{t('حفظ مسودة','Save draft')}</button>
      </div>
    </form>}

    {step===2 && preview && <div className="grid grid-cols-1 items-start gap-5 xl:grid-cols-[minmax(0,1fr)_340px]">
      <div><div className="mb-3 flex flex-wrap items-center justify-between gap-2"><h2 className="text-sm font-bold text-navy">{t('مراجعة محتوى المستند','Review document content')}</h2><p className="text-[11px] text-slate-500">{t('تنسيق Word الأصلي محفوظ في الملف المُنزّل','The download preserves the original Word layout')}</p></div><DocumentPreview blocks={preview.blocks} language={template.language}/></div>
      <div className="space-y-4 xl:sticky xl:top-24"><Card><SectionTitle title={t('الإيميل المُرسل','Outgoing email')}/><div className="mb-3 border-b border-slate-200 pb-3 text-[12px]"><span className="text-slate-500">{t('إلى: ','To: ')}</span><bdi className="font-bold">{preview.fields.email}</bdi></div><div dir={language==='ar'?'rtl':'ltr'}><h3 className="mb-3 text-sm font-bold">{preview.email.subject}</h3><p className="whitespace-pre-wrap text-[12px] leading-6 text-slate-600">{preview.email.body}</p></div></Card>
        <Card><SectionTitle title={t('نسخة العرض والمرفقات','Offer version & attachments')}/><p className="mb-3 text-[12px] leading-6 text-emerald-700"><Paperclip className="me-1 inline" size={14}/>{t('دليل الموظف يُضاف تلقائيًا مع هذا العرض.','The employee handbook is automatically included.')}</p>{missing.length>0 && <p role="alert" className="mb-3 text-[12px] leading-6 text-rose-700">{t('أكمل الحقول المطلوبة قبل الإرسال: ','Complete the required fields before sending: ')}{missing.map((key)=>pick(fieldList.find((field)=>field.key===key)?.label ?? {ar:key,en:key})).join('، ')}</p>}
          {draft && <><Badge tone={draft.status==='sent'?'success':draft.status==='draft'?'neutral':'warning'}>{status(draft.status)}</Badge><ul className="my-4 space-y-2">{draft.attachments.map((file)=><li key={file.url}><a className="inline-flex items-center gap-2 break-all text-[11px] font-semibold text-[rgb(var(--hr-a1))] underline" href={file.url}><Download size={14} className="shrink-0"/>{file.filename}</a></li>)}</ul></>}
          <div className="space-y-2"><button type="button" className="btn-ghost w-full" disabled={busy} onClick={saveDraft}><Save size={15}/>{t('حفظ النسخة وتنزيل المرفقات','Save version & download attachments')}</button><button type="button" className="btn-primary w-full" disabled={busy || missing.length>0 || !catalog.mailConfigured || locked} onClick={send}><Send size={15}/>{busy?t('جارٍ التنفيذ…','Working…'):t('إرسال العرض للمرشح','Send offer to candidate')}</button><button type="button" className="btn-ghost w-full" disabled={busy} onClick={()=>{if(locked){key.current=idempotencyKey();setDraft(null);}setStep(1);}}>{locked?t('إنشاء نسخة جديدة من العرض','Create a new version'):t('تعديل البيانات','Edit details')}</button></div>
          <p className="mt-3 text-[11px] leading-5 text-slate-500">{t('الإرسال يستخدم بريد الشركة. «قبله خادم البريد» تعني قبول SMTP، ولا تثبت وصوله لصندوق الوارد.','Messages use company email. SMTP acceptance does not confirm inbox delivery.')}</p>
        </Card>
      </div>
    </div>}

    <Card><SectionTitle title={t('سجل العروض','Offer history')} hint={catalog.access.manage?t('عروض فريق التوظيف داخل المؤسسة','Recruitment offers in this organization'):t('العروض التي جهزتها','Offers you prepared')} action={<button type="button" className="btn-ghost btn-sm" onClick={()=>void reloadHistory()}>{t('تحديث','Refresh')}</button>}/>
      {!history?.offers.length?<p className="py-5 text-center text-sm text-slate-500">{t('لا توجد عروض محفوظة بعد.','No saved offers yet.')}</p>:<div className="space-y-2">{history.offers.map((offer)=><button type="button" key={offer.id} disabled={busy} className="flex w-full flex-wrap items-center gap-3 rounded-2xl border border-slate-200/70 bg-white/60 p-4 text-start hover:bg-white" onClick={()=>openOffer(offer)}><Mail size={18} className="text-slate-400"/><span className="min-w-0 flex-1"><span className="block truncate text-[13px] font-bold text-navy">{offer.fields.candidateName || t('مسودة بدون اسم','Unnamed draft')}</span><bdi className="block truncate text-[11px] text-slate-500">{offer.fields.email} · {offer.fields.jobTitle}</bdi></span><span className="text-[11px] text-slate-500">{stamp(offer.createdAt,lang)}</span><Badge tone={offer.status==='sent'?'success':offer.status==='draft'?'neutral':'warning'}>{status(offer.status)}</Badge></button>)}</div>}
    </Card>
    {catalog.access.configure && <Card><SectionTitle title={t('قالب الإيميل الموحد','Shared email template')} hint={t('نص مبدئي لحين استلام الفورمة الرسمية. الحفظ يطبق على العروض الجديدة فقط.','A starter message until the official wording is supplied. Changes apply to new offers.')} action={<button type="button" className="btn-ghost btn-sm" onClick={()=>setShowEmailSettings(!showEmailSettings)}>{t('تحرير القالب','Edit template')}</button>}/>{showEmailSettings && <form className="space-y-3" onSubmit={(event)=>{event.preventDefault();void action(async()=>{await api.put(`${ROOT}/email-template`,{...catalog.emailTemplates,[settingsLanguage]:settingsEmail ?? catalog.emailTemplates[settingsLanguage]});await reload();setNotice(t('تم حفظ قالب الإيميل.','Email template saved.'));});}}><Label label={t('اللغة','Language')}><select className="input" value={settingsLanguage} onChange={(event)=>{setSettingsLanguage(event.target.value as 'ar'|'en');setSettingsEmail(null);}}><option value="ar">العربية</option><option value="en">English</option></select></Label><Label label={t('عنوان الرسالة','Subject')}><input className="input w-full" required value={(settingsEmail ?? catalog.emailTemplates[settingsLanguage]).subject} onChange={(event)=>setSettingsEmail({...settingsEmail ?? catalog.emailTemplates[settingsLanguage],subject:event.target.value})}/></Label><Label label={t('نص الرسالة','Message')}><textarea className="input min-h-48 w-full" required dir={settingsLanguage==='ar'?'rtl':'ltr'} value={(settingsEmail ?? catalog.emailTemplates[settingsLanguage]).body} onChange={(event)=>setSettingsEmail({...settingsEmail ?? catalog.emailTemplates[settingsLanguage],body:event.target.value})}/></Label><button className="btn-primary" type="submit" disabled={busy}><Save size={15}/>{t('حفظ القالب الموحد','Save shared template')}</button></form>}</Card>}
  </div>;
}
export default SendOffer;
