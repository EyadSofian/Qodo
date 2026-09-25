/**
 * /hr-form/:token — the New Employee Form, opened by a new hire who has no
 * account. It lives outside the workspace shell: no navigation, nothing that
 * suggests a way in. The link works once and expires; an unknown, expired and
 * used link all read the same, so the page cannot be used to probe links.
 */

import { useEffect, useState, type FormEvent } from 'react';
import { useParams } from 'react-router-dom';
import { AlertCircle, CheckCircle2, Languages, ShieldCheck } from 'lucide-react';
import { LogoMark } from '../../components/Brand';
import { Spinner } from '../../components/ui';
import { ApiError, api, errorMessage } from '../../lib/api';
import { useI18n } from '../../lib/i18n';
import { cx } from '../../lib/utils';

interface FormInfo {
  jobTitle: string;
  department: string;
  location: string;
  expiresAt: string;
}

type Field = {
  key: string;
  ar: string;
  en: string;
  required?: boolean;
  type?: 'text' | 'date' | 'email' | 'tel';
  dir?: 'ltr' | 'rtl';
  max?: number;
  wide?: boolean;
  options?: Array<{ ar: string; en: string }>;
};

const SECTIONS: Array<{ ar: string; en: string; fields: Field[] }> = [
  {
    ar: 'البيانات الأساسية',
    en: 'About you',
    fields: [
      { key: 'fullNameArabic', ar: 'الاسم رباعياً بالعربي', en: 'Full name in Arabic', required: true, dir: 'rtl', max: 120 },
      { key: 'fullNameEnglish', ar: 'الاسم بالإنجليزي كما في الجواز', en: 'Full name in English (as on your passport)', required: true, dir: 'ltr', max: 120 },
      { key: 'nationalId', ar: 'الرقم القومي أو رقم الجواز/الإقامة', en: 'National ID, passport or residence number', required: true, dir: 'ltr', max: 20 },
      { key: 'birthDate', ar: 'تاريخ الميلاد', en: 'Date of birth', required: true, type: 'date' },
      { key: 'maritalStatus', ar: 'الحالة الاجتماعية', en: 'Marital status', options: [{ ar: 'أعزب', en: 'Single' }, { ar: 'متزوج', en: 'Married' }, { ar: 'غير ذلك', en: 'Other' }] },
      { key: 'militaryStatus', ar: 'موقف التجنيد (للذكور في مصر)', en: 'Military status (men in Egypt)', options: [{ ar: 'أدى الخدمة', en: 'Completed' }, { ar: 'معفى', en: 'Exempted' }, { ar: 'مؤجل', en: 'Postponed' }, { ar: 'لا ينطبق', en: 'Not applicable' }] },
    ],
  },
  {
    ar: 'التواصل',
    en: 'Contact',
    fields: [
      { key: 'mobile', ar: 'رقم الموبايل', en: 'Mobile number', required: true, type: 'tel', dir: 'ltr', max: 20 },
      { key: 'personalEmail', ar: 'البريد الشخصي', en: 'Personal e-mail', type: 'email', dir: 'ltr', max: 120 },
      { key: 'address', ar: 'العنوان', en: 'Home address', max: 300, wide: true },
      { key: 'emergencyContactName', ar: 'اسم شخص للطوارئ', en: 'Emergency contact name', required: true, max: 120 },
      { key: 'emergencyContactPhone', ar: 'رقم هاتف الطوارئ', en: 'Emergency contact phone', required: true, type: 'tel', dir: 'ltr', max: 20 },
    ],
  },
  {
    ar: 'التعليم والبنك',
    en: 'Education & bank',
    fields: [
      { key: 'education', ar: 'المؤهل الدراسي', en: 'Qualification', max: 120 },
      { key: 'graduationYear', ar: 'سنة التخرج', en: 'Graduation year', dir: 'ltr', max: 4 },
      { key: 'bankAccount', ar: 'رقم الحساب البنكي (إن وُجد)', en: 'Bank account number (if any)', dir: 'ltr', max: 40, wide: true },
    ],
  },
];

export function PublicNewEmployeeForm() {
  const { token = '' } = useParams();
  const { lang, setLang, dir } = useI18n();
  const t = (ar: string, en: string) => (lang === 'en' ? en : ar);
  const [info, setInfo] = useState<FormInfo | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'unavailable' | 'sent'>('loading');
  const [values, setValues] = useState<Record<string, string>>({});
  const [missing, setMissing] = useState<string[]>([]);
  const [problem, setProblem] = useState('');
  const [sending, setSending] = useState(false);

  useEffect(() => {
    let active = true;
    api.get<{ form: FormInfo }>(`/hr-forms/${encodeURIComponent(token)}`)
      .then((result) => {
        if (!active) return;
        setInfo(result.form);
        setState('ready');
      })
      .catch(() => {
        if (active) setState('unavailable');
      });
    return () => {
      active = false;
    };
  }, [token]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const required = SECTIONS.flatMap((section) => section.fields).filter((field) => field.required && !String(values[field.key] ?? '').trim()).map((field) => field.key);
    setMissing(required);
    if (required.length) {
      setProblem(t('أكمل الحقول المطلوبة المعلّمة.', 'Fill in the highlighted required fields.'));
      document.getElementById(`field-${required[0]}`)?.focus();
      return;
    }
    setSending(true);
    setProblem('');
    try {
      await api.post(`/hr-forms/${encodeURIComponent(token)}`, values);
      setState('sent');
    } catch (error) {
      if (error instanceof ApiError && error.code === 'personnel_form_not_found') setState('unavailable');
      else {
        const fields = error instanceof ApiError && Array.isArray((error.payload as { missing?: unknown })?.missing) ? ((error.payload as { missing: string[] }).missing) : [];
        setMissing(fields);
        setProblem(errorMessage(error, lang));
      }
    } finally {
      setSending(false);
    }
  };

  return (
    <div dir={dir} className="min-h-[100dvh] bg-[#F6F8FB] px-4 py-8 sm:py-12">
      <div className="mx-auto w-full max-w-2xl">
        <header className="mb-6 flex items-center justify-between gap-3">
          <LogoMark size={40} />
          <button type="button" onClick={() => setLang(lang === 'en' ? 'ar' : 'en')} className="inline-flex items-center gap-1.5 rounded-full border border-[#E6ECF3] bg-white px-3 py-1.5 text-[12.5px] font-semibold text-[#3F5068] hover:text-navy">
            <Languages size={14} aria-hidden="true" />{lang === 'en' ? 'العربية' : 'English'}
          </button>
        </header>

        {state === 'loading' && <div className="grid place-items-center rounded-2xl border border-[#E6ECF3] bg-white py-16"><Spinner /></div>}

        {state === 'unavailable' && (
          <div className="rounded-2xl border border-[#E6ECF3] bg-white p-8 text-center">
            <AlertCircle size={32} className="mx-auto text-amber-500" aria-hidden="true" />
            <h1 className="mt-3 text-[20px] font-bold text-navy">{t('هذا الرابط غير متاح', 'This link is not available')}</h1>
            <p className="mt-2 text-[13.5px] leading-7 text-[#5A6C82]">{t('ربما انتهت صلاحيته أو استُخدم من قبل. اطلب رابطاً جديداً من فريق الموارد البشرية الذي تواصل معك.', 'It may have expired or already been used. Ask the HR team who contacted you for a new link.')}</p>
          </div>
        )}

        {state === 'sent' && (
          <div className="rounded-2xl border border-emerald-200 bg-white p-8 text-center">
            <CheckCircle2 size={36} className="mx-auto text-emerald-500" aria-hidden="true" />
            <h1 className="mt-3 text-[20px] font-bold text-navy">{t('وصلتنا بياناتك، شكراً لك', 'We have your details — thank you')}</h1>
            <p className="mt-2 text-[13.5px] leading-7 text-[#5A6C82]">{t('سيتواصل معك فريق الموارد البشرية بخطوات الانضمام. يمكنك إغلاق هذه الصفحة؛ الرابط لم يعد يعمل.', 'The HR team will be in touch with your joining steps. You can close this page; the link no longer works.')}</p>
          </div>
        )}

        {state === 'ready' && info && (
          <form onSubmit={(event) => void submit(event)} noValidate className="space-y-5">
            <div className="rounded-2xl bg-navy p-6 text-white">
              <p className="text-[12.5px] font-semibold text-white/70">{t('أهلاً بك في فريقنا', 'Welcome to the team')}</p>
              <h1 className="mt-1 text-[22px] font-bold leading-tight">{t('نموذج بيانات الموظف الجديد', 'New employee form')}</h1>
              <p className="mt-2 text-[13px] leading-6 text-white/80">{[info.jobTitle, info.department, info.location].filter(Boolean).join(' · ')}</p>
              <p className="mt-3 flex items-center gap-1.5 text-[12px] text-white/70"><ShieldCheck size={14} aria-hidden="true" />{t('بياناتك تصل لفريق الموارد البشرية فقط. الرابط يعمل مرة واحدة.', 'Your details reach the HR team only. This link works once.')}</p>
            </div>

            {SECTIONS.map((section, index) => (
              <section key={section.en} role="group" aria-labelledby={`form-section-${index}`} className="rounded-2xl border border-[#E6ECF3] bg-white p-5">
                <h2 id={`form-section-${index}`} className="text-[15px] font-bold text-navy">{t(section.ar, section.en)}</h2>
                <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
                  {section.fields.map((field) => {
                    const invalid = missing.includes(field.key);
                    const id = `field-${field.key}`;
                    return (
                      <label key={field.key} htmlFor={id} className={cx('block', field.wide && 'sm:col-span-2')}>
                        <span className="label">{t(field.ar, field.en)}{field.required && <span className="text-red-600"> *</span>}</span>
                        {field.options ? (
                          <select id={id} className={cx('field', invalid && '!border-red-400')} value={values[field.key] ?? ''} onChange={(event) => setValues((current) => ({ ...current, [field.key]: event.target.value }))}>
                            <option value="">{t('— اختر —', '— Choose —')}</option>
                            {field.options.map((option) => <option key={option.en} value={option.en}>{t(option.ar, option.en)}</option>)}
                          </select>
                        ) : (
                          <input
                            id={id}
                            className={cx('field', invalid && '!border-red-400', field.dir === 'ltr' && 'ltr')}
                            type={field.type ?? 'text'}
                            dir={field.dir}
                            maxLength={field.max}
                            required={field.required}
                            aria-invalid={invalid || undefined}
                            autoComplete={field.key === 'personalEmail' ? 'email' : field.key === 'mobile' ? 'tel' : field.key === 'fullNameEnglish' ? 'name' : 'off'}
                            value={values[field.key] ?? ''}
                            onChange={(event) => setValues((current) => ({ ...current, [field.key]: event.target.value }))}
                          />
                        )}
                      </label>
                    );
                  })}
                </div>
              </section>
            ))}

            {problem && <p role="alert" className="flex items-center gap-2 rounded-xl bg-red-50 px-4 py-3 text-[13px] font-semibold text-red-700"><AlertCircle size={16} aria-hidden="true" />{problem}</p>}
            <div className="flex flex-col-reverse items-stretch gap-3 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-[12px] text-[#5A6C82]">{t(`الرابط صالح حتى ${new Intl.DateTimeFormat('ar-EG-u-nu-latn', { dateStyle: 'medium' }).format(new Date(info.expiresAt))}`, `This link works until ${new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium' }).format(new Date(info.expiresAt))}`)}</p>
              <button type="submit" className="btn-primary" disabled={sending}>{sending ? <Spinner size={16} /> : <CheckCircle2 size={16} />}{t('إرسال البيانات', 'Send my details')}</button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}

export default PublicNewEmployeeForm;
