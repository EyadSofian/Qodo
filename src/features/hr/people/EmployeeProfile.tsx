/**
 * /hr/people/:employeeCode — one person's HR record.
 *
 * The same endpoints and permission rules as before HR V2: sensitive contact
 * and bank fields are masked unless the reader manages HR or is the person,
 * and payroll, insurance and tax appear only for `hr.payroll` (or the person
 * themselves). The page never decides that on its own — it shows what the
 * server returned.
 */

import { useEffect, useState, type ReactNode } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, ArrowRight, BriefcaseBusiness, CalendarDays, Check, ClipboardList, Cloud, Database, ExternalLink, FileCheck2, IdCard, Landmark, Link2, Pencil, ShieldCheck, WalletCards } from 'lucide-react';
import { errorMessage } from '../../../lib/api';
import { cx } from '../../../lib/utils';
import { Modal, Spinner, useToast } from '../../../components/ui';
import type { HRDashboardData, HREmployeeProfile } from '../../../lib/hr';
import { hrApi, hrMutate, useHRQuery } from '../api';
import { date, money, num, useHRText } from '../format';
import { DOCUMENT_LABEL, PERSONNEL_STATUS_LABEL, PERSONNEL_TYPE_LABEL } from '../labels';
import { useHR } from '../shell/HRContext';
import type { EmployeeOdooData, PersonnelCase } from '../types';
import { Badge, Card, KeyValue, LinkArrow, PersonAvatar, SectionTitle } from '../ui/primitives';
import { LeaveRow, LeaveTypeChip, personName } from '../ui/timeOff';
import { EmptyBlock, ErrorBlock, PageSkeleton } from '../ui/states';

type EditSection = 'master' | 'payroll' | 'insurance' | 'bank';

function Section({ icon: Icon, title, action, children }: { icon: typeof IdCard; title: string; action?: ReactNode; children: ReactNode }) {
  return (
    <Card>
      <SectionTitle title={<span className="flex items-center gap-2"><span className="grid h-7 w-7 place-items-center rounded-lg bg-[linear-gradient(135deg,rgb(var(--hr-a1)),rgb(var(--hr-a2)))] text-white shadow-[0_6px_14px_-8px_rgb(var(--hr-a1)/0.9)]"><Icon size={14} aria-hidden="true" /></span>{title}</span>} action={action} />
      {children}
    </Card>
  );
}

/** A figure on a soft coloured tile. */
function Tile({ label, value, danger = false }: { label: ReactNode; value: ReactNode; danger?: boolean }) {
  return (
    <div className="rounded-2xl bg-[linear-gradient(135deg,rgb(var(--hr-a1)/0.08),rgb(var(--hr-a2)/0.05))] p-3 ring-1 ring-white/80">
      <dt className="text-[11.5px] font-semibold text-slate-500">{label}</dt>
      <dd className={cx('mt-0.5 text-[20px] font-extrabold tabular-nums', danger ? 'text-red-700' : 'text-navy')}>{value}</dd>
    </div>
  );
}

/** The person's own photo, blurred into the hero behind them. */
function BlurredPhoto({ src }: { src: string }) {
  const [visible, setVisible] = useState(true);
  useEffect(() => {
    setVisible(true);
  }, [src]);
  if (!visible) return null;
  return <img src={src} alt="" aria-hidden="true" className="absolute inset-0 -z-10 h-full w-full scale-125 object-cover opacity-70 blur-2xl saturate-150" onError={() => setVisible(false)} />;
}

function OdooCard({ code }: { code: string }) {
  const { t, lang } = useHRText();
  const { data, loading } = useHRQuery<EmployeeOdooData>(hrApi.employeeOdoo(code));
  if (loading && !data) return <Card><div className="h-24 animate-pulse rounded-2xl bg-white/60" /></Card>;
  if (!data?.connected) return null;
  const odoo = data.employee;
  if (!odoo) {
    return (
      <Section icon={Cloud} title={t('من Odoo', 'From Odoo')}>
        <p className="text-[12.5px] leading-6 text-slate-500">{t('لم يُعثر على هذا الموظف في Odoo بالكود أو البريد أو الاسم.', 'This employee was not found in Odoo by code, e-mail or name.')}</p>
      </Section>
    );
  }
  const manager = data.manager;
  return (
    <Section icon={Cloud} title={t('من Odoo', 'From Odoo')} action={odoo.url ? <a href={odoo.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-[rgb(var(--hr-a1))] hover:underline">{t('فتح في Odoo', 'Open in Odoo')}<ExternalLink size={13} aria-hidden="true" /></a> : null}>
      {manager && (
        <PersonLink code={manager.code} className="mb-4 flex items-center gap-3 rounded-2xl border border-white/80 bg-white/70 p-3">
          <PersonAvatar name={personName(manager, lang)} photoUrl={manager.photoUrl} size={44} ring />
          <span className="min-w-0">
            <span className="block text-[11.5px] font-semibold text-slate-500">{t('المدير المباشر في Odoo', 'Manager in Odoo')}</span>
            <span className="block truncate text-[14px] font-bold text-navy">{personName(manager, lang)}</span>
            <span className="hr-bidi block truncate text-[12px] text-slate-500">{manager.title || '—'}</span>
          </span>
        </PersonLink>
      )}
      <dl className="grid grid-cols-1 gap-x-6 gap-y-4 sm:grid-cols-2">
        <KeyValue label={t('المسمى في Odoo', 'Job in Odoo')} value={odoo.jobTitle} />
        <KeyValue label={t('القسم في Odoo', 'Department in Odoo')} value={odoo.department} />
        <KeyValue label={t('البريد الوظيفي', 'Work e-mail')} value={<span className="ltr">{odoo.workEmail || '—'}</span>} />
        <KeyValue label={t('هاتف العمل', 'Work phone')} value={<span className="ltr">{odoo.workPhone || '—'}</span>} />
        <KeyValue label={t('مكان العمل', 'Work location')} value={odoo.workLocation} />
        <KeyValue label={t('يعتمد إجازاته', 'Approves their time off')} value={odoo.leaveApprover} />
        {odoo.since && <KeyValue label={t('أول عقد', 'First contract')} value={date(odoo.since, lang)} />}
      </dl>
      {(data.reports?.length ?? 0) > 0 && (
        <div className="mt-5">
          <p className="mb-2 text-[12px] font-bold text-slate-500">{t(`فريقه المباشر (${data.reports!.length})`, `Direct reports (${data.reports!.length})`)}</p>
          <ul className="hr-stagger grid grid-cols-2 gap-2 sm:grid-cols-3">
            {data.reports!.map((person) => (
              <li key={person.code ?? person.nameEnglish}>
                <PersonLink code={person.code} className="flex items-center gap-2 rounded-2xl border border-white/80 bg-white/70 p-2">
                  <PersonAvatar name={personName(person, lang)} photoUrl={person.photoUrl} size={32} />
                  <span className="min-w-0"><span className="hr-bidi block truncate text-[12.5px] font-semibold text-navy">{personName(person, lang)}</span><span className="hr-bidi block truncate text-[11px] text-slate-500">{person.title || '—'}</span></span>
                </PersonLink>
              </li>
            ))}
          </ul>
        </div>
      )}
    </Section>
  );
}

function OdooTimeOff({ code }: { code: string }) {
  const { t } = useHRText();
  const { data } = useHRQuery<EmployeeOdooData>(hrApi.employeeOdoo(code));
  const timeOff = data?.connected ? data.timeOff : null;
  if (!timeOff?.connected) return null;
  const requests = timeOff.requests ?? [];
  const allocations = timeOff.allocations ?? [];
  if (!requests.length && !allocations.length) return <p className="mt-4 rounded-2xl bg-white/60 px-3 py-2.5 text-[12.5px] text-slate-500">{t('لا توجد طلبات أو أرصدة في إجازات Odoo هذا العام.', 'No requests or allocations in Odoo time off this year.')}</p>;
  return (
    <div className="mt-5 space-y-4">
      {allocations.length > 0 && (
        <div>
          <p className="mb-2 flex items-center gap-1.5 text-[12px] font-bold text-slate-500"><Cloud size={13} aria-hidden="true" />{t('أرصدة Odoo', 'Odoo allocations')}</p>
          <ul className="space-y-2">
            {allocations.map((allocation) => (
              <li key={allocation.id} className="rounded-2xl bg-white/70 p-3 ring-1 ring-white/80">
                <div className="flex items-center justify-between gap-2"><LeaveTypeChip type={allocation.type} /><span className="text-[12.5px] font-bold tabular-nums text-navy">{t(`${num(allocation.remaining, 'ar', 1)} متبقٍ من ${num(allocation.days, 'ar', 1)}`, `${num(allocation.remaining, 'en', 1)} left of ${num(allocation.days, 'en', 1)}`)}</span></div>
                <div className="mt-2 h-2 overflow-hidden rounded-full bg-slate-200/70"><span className="block h-full rounded-full bg-[linear-gradient(90deg,rgb(var(--hr-a1)),rgb(var(--hr-a2)))]" style={{ width: `${allocation.days ? Math.min(100, (allocation.taken / allocation.days) * 100) : 0}%` }} /></div>
              </li>
            ))}
          </ul>
        </div>
      )}
      {requests.length > 0 && (
        <div>
          <p className="mb-1 flex items-center gap-1.5 text-[12px] font-bold text-slate-500"><Cloud size={13} aria-hidden="true" />{t('طلبات الإجازة في Odoo', 'Time-off requests in Odoo')}</p>
          <ul className="-mx-2.5">{requests.slice(0, 8).map((leave) => <li key={leave.id}><LeaveRow leave={leave} /></li>)}</ul>
        </div>
      )}
    </div>
  );
}

/** A link to someone's profile when HR can address them, plain text when it cannot. */
function PersonLink({ code, className, children }: { code: string | null; className: string; children: ReactNode }) {
  return code ? <Link to={`/hr/people/${encodeURIComponent(code)}`} className={cx(className, 'hr-lift')}>{children}</Link> : <div className={className}>{children}</div>;
}

const FIELD_LABELS: Record<string, { ar: string; en: string }> = {
  nameArabic: { ar: 'الاسم بالعربي', en: 'Arabic name' },
  nameEnglish: { ar: 'الاسم بالإنجليزي', en: 'English name' },
  title: { ar: 'المسمى الوظيفي', en: 'Job title' },
  department: { ar: 'القسم', en: 'Department' },
  directManager: { ar: 'المدير المباشر', en: 'Direct manager' },
  workType: { ar: 'نوع العمل', en: 'Work type' },
  companyEmail: { ar: 'البريد الوظيفي', en: 'Company e-mail' },
  mobile: { ar: 'الموبايل', en: 'Mobile' },
  baseSalary: { ar: 'الراتب الأساسي', en: 'Base salary' },
  kpiAmount: { ar: 'قيمة KPI', en: 'KPI amount' },
  totalSalary: { ar: 'الإجمالي', en: 'Total salary' },
  insuredSalary: { ar: 'الراتب التأميني', en: 'Insured salary' },
  subscriptionSalary: { ar: 'أجر الاشتراك', en: 'Contribution salary' },
  employeeShare: { ar: 'حصة الموظف', en: 'Employee share' },
  employerShare: { ar: 'حصة الشركة', en: 'Employer share' },
  monthlyTax: { ar: 'الضريبة الشهرية', en: 'Monthly tax' },
  bankName: { ar: 'اسم البنك', en: 'Bank' },
  bankStatus: { ar: 'حالة الحساب', en: 'Account status' },
  bankAccount: { ar: 'رقم الحساب', en: 'Account number' },
};
const SECTION_FIELDS: Record<EditSection, string[]> = {
  master: ['nameArabic', 'nameEnglish', 'title', 'department', 'directManager', 'workType', 'companyEmail', 'mobile'],
  payroll: ['baseSalary', 'kpiAmount', 'totalSalary'],
  insurance: ['insuredSalary', 'subscriptionSalary', 'employeeShare', 'employerShare', 'monthlyTax'],
  bank: ['bankName', 'bankStatus', 'bankAccount'],
};
const NUMERIC = new Set(['baseSalary', 'kpiAmount', 'totalSalary', 'insuredSalary', 'subscriptionSalary', 'employeeShare', 'employerShare', 'monthlyTax']);

function Editor({ employee, section, onClose, onSaved }: { employee: HREmployeeProfile; section: EditSection; onClose: () => void; onSaved: () => void }) {
  const { t, lang, pick } = useHRText();
  const { push } = useToast();
  const source: Record<string, unknown> = section === 'payroll' ? ((employee.payroll ?? {}) as Record<string, unknown>) : section === 'insurance' ? (employee.insurance ?? {}) : (employee as unknown as Record<string, unknown>);
  const [form, setForm] = useState<Record<string, string>>(() => Object.fromEntries(SECTION_FIELDS[section].map((key) => [key, String(source[key] ?? '')])));
  const [saving, setSaving] = useState(false);
  const save = async () => {
    setSaving(true);
    try {
      const body = Object.fromEntries(Object.entries(form).map(([key, value]) => [key, NUMERIC.has(key) ? (value === '' ? null : Number(value)) : value.trim()]));
      await hrMutate('patch', `/hr/employees/${encodeURIComponent(employee.employeeCode)}/${section}`, body);
      push(t('حُفظت البيانات.', 'Saved.'));
      onSaved();
    } catch (error) {
      push(errorMessage(error, lang), 'bad');
    } finally {
      setSaving(false);
    }
  };
  return (
    <Modal open onClose={onClose} title={t('تعديل بيانات الموظف', 'Edit employee record')} width="lg" footer={<><button type="button" className="btn-ghost" onClick={onClose}>{t('إلغاء', 'Cancel')}</button><button type="button" className="btn-primary" disabled={saving} onClick={() => void save()}>{saving ? <Spinner size={16} /> : <Check size={16} />}{t('حفظ', 'Save')}</button></>}>
      <p className="mb-4 rounded-xl bg-brand-50 px-3.5 py-2.5 text-[12.5px] leading-6 text-brand-800">{t('يُحفظ التعديل في نفس مصدر الملف ويظهر فوراً. رفع ملف أحدث لهذا المصدر يستبدل قيمه.', 'The edit is saved into the same source and shows at once. A newer upload of that source replaces its values.')}</p>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {SECTION_FIELDS[section].map((key) => (
          <label key={key} className="block">
            <span className="label">{pick(FIELD_LABELS[key])}</span>
            <input className="field" type={NUMERIC.has(key) ? 'number' : 'text'} value={form[key]} onChange={(event) => setForm((current) => ({ ...current, [key]: event.target.value }))} />
          </label>
        ))}
      </div>
    </Modal>
  );
}

function AccountLink({ employee, accounts, onSaved }: { employee: HREmployeeProfile; accounts: HRDashboardData['accounts']; onSaved: () => void }) {
  const { t, lang } = useHRText();
  const { push } = useToast();
  const [value, setValue] = useState(employee.linkedUserId ?? '');
  const [saving, setSaving] = useState(false);
  const save = async () => {
    setSaving(true);
    try {
      await hrMutate('put', `/hr/employees/${encodeURIComponent(employee.employeeCode)}/link`, { userId: value || null });
      push(t('حُفظ ربط الحساب.', 'Account link saved.'));
      onSaved();
    } catch (error) {
      push(errorMessage(error, lang), 'bad');
    } finally {
      setSaving(false);
    }
  };
  return (
    <div className="space-y-2">
      <select className="field" value={value} onChange={(event) => setValue(event.target.value)} aria-label={t('حساب Qodo', 'Qodo account')}>
        <option value="">— {t('بدون حساب', 'No account')} —</option>
        {accounts.map((account) => <option key={account.id} value={account.id}>{account.name} · {account.email}</option>)}
      </select>
      <button type="button" className="btn-ghost btn-sm w-full" disabled={saving || value === (employee.linkedUserId ?? '')} onClick={() => void save()}>{saving ? <Spinner size={15} /> : <Link2 size={15} />}{t('حفظ الربط', 'Save link')}</button>
    </div>
  );
}

export function EmployeeProfile() {
  const { employeeCode = '' } = useParams();
  const { t, lang, pick } = useHRText();
  const navigate = useNavigate();
  const { access } = useHR();
  const { data, error, loading, reload } = useHRQuery<{ employee: HREmployeeProfile }>(hrApi.employee(employeeCode));
  const dashboard = useHRQuery<HRDashboardData>(access?.manage ? hrApi.dashboard : null);
  const personnel = useHRQuery<{ cases: PersonnelCase[] }>(access?.personnel ? hrApi.personnel() : null);
  const [editing, setEditing] = useState<EditSection | null>(null);
  useEffect(() => {
    setEditing(null);
  }, [employeeCode]);

  if (error && !data) return <ErrorBlock error={error} onRetry={reload} />;
  if (loading && !data) return <PageSkeleton rows={2} />;
  if (!data) return null;

  const employee = data.employee;
  const name = (lang === 'en' ? employee.nameEnglish || employee.nameArabic : employee.nameArabic || employee.nameEnglish) || `#${employee.employeeCode}`;
  const canManage = Boolean(access?.manage);
  const canPayroll = Boolean(access?.payroll);
  // The server sends `totalSalary` (a number or null) only to readers who may
  // see pay — payroll holders and the person themselves.
  const showsPayroll = canPayroll || employee.totalSalary !== undefined;
  const cases = (personnel.data?.cases ?? []).filter((item) => item.employeeCode === employee.employeeCode);
  const Back = lang === 'en' ? ArrowLeft : ArrowRight;
  const documents = Object.entries(employee.documents ?? {}).filter(([key]) => !['completionRate', 'collectionStatus'].includes(key));
  const docsDone = documents.filter(([, value]) => Boolean(value)).length;
  const docsRate = typeof employee.documents?.completionRate === 'number' ? Math.round(Number(employee.documents.completionRate) * 100) : documents.length ? Math.round((docsDone / documents.length) * 100) : 0;
  const edit = (section: EditSection) => (canManage && (section === 'master' || canPayroll) ? <button type="button" className="btn-quiet btn-sm !min-h-8" onClick={() => setEditing(section)}><Pencil size={14} />{t('تعديل', 'Edit')}</button> : null);

  const photo = `/api/hr/people/${encodeURIComponent(employee.employeeCode)}/photo`;
  const odooOnly = Boolean(employee.odooOnly);

  return (
    <div className="space-y-6">
      <header className="relative isolate overflow-hidden rounded-[28px] text-white shadow-[0_26px_60px_-32px_rgb(var(--hr-a1)/0.95)]" style={{ backgroundImage: 'linear-gradient(135deg, rgb(var(--hr-a1)), rgb(var(--hr-a2)))' }}>
        <BlurredPhoto src={`${photo}?size=512`} />
        <div className="absolute inset-0 -z-10 bg-[linear-gradient(180deg,rgb(11_37_69/0.15)_0%,rgb(11_37_69/0.55)_100%)]" aria-hidden="true" />
        <div aria-hidden="true" className="pointer-events-none absolute -end-16 -top-20 -z-10 h-64 w-64 rounded-full bg-white/10" />
        <div className="relative p-5 sm:p-7">
          <button type="button" onClick={() => navigate(-1)} className="inline-flex items-center gap-1.5 rounded-full bg-white/15 px-3 py-1 text-[12.5px] font-semibold text-white ring-1 ring-white/25 backdrop-blur transition-colors hover:bg-white/25"><Back size={14} aria-hidden="true" />{t('رجوع', 'Back')}</button>
          <div className="mt-5 flex flex-col gap-5 sm:flex-row sm:items-end">
            <PersonAvatar name={name} photoUrl={photo} size={112} ring className="shadow-[0_18px_40px_-16px_rgb(0_0_0/0.6)]" />
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="rounded-full bg-white/15 px-2.5 py-0.5 font-mono text-[12px] font-semibold ring-1 ring-white/25">#{employee.employeeCode}</span>
                <span className={cx('rounded-full px-2.5 py-0.5 text-[11.5px] font-bold', employee.status === 'active' ? 'bg-emerald-400/90 text-emerald-950' : 'bg-white/25 text-white')}>{employee.status === 'active' ? t('نشط', 'Active') : employee.status === 'inactive' ? t('غير نشط', 'Inactive') : t('غير محدد', 'Unknown')}</span>
                {odooOnly && <span className="inline-flex items-center gap-1 rounded-full bg-violet-500/90 px-2.5 py-0.5 text-[11.5px] font-bold"><Cloud size={12} aria-hidden="true" />{t('في Odoo فقط', 'Odoo only')}</span>}
              </div>
              <h1 className="hr-bidi mt-2 truncate text-[28px] font-extrabold tracking-tight drop-shadow-sm sm:text-[34px]">{name}</h1>
              <p className="mt-1 text-[14px] text-white/85">{[employee.title, employee.department || employee.sector].filter(Boolean).join(' · ') || '—'}</p>
              {employee.directManager && <p className="mt-1 text-[12.5px] text-white/70">{t('المدير المباشر:', 'Direct manager:')} {employee.directManager}</p>}
            </div>
            {canManage && !odooOnly && <div className="hr-on-color"><button type="button" className="btn-primary btn-sm" onClick={() => setEditing('master')}><Pencil size={15} />{t('تعديل الملف', 'Edit profile')}</button></div>}
          </div>
        </div>
      </header>

      {odooOnly && (
        <p className="hr-glass flex items-start gap-3 rounded-3xl px-4 py-3.5 text-[13px] leading-6 text-violet-900">
          <Cloud size={18} className="mt-0.5 shrink-0 text-violet-600" aria-hidden="true" />
          {t('هذا الموظف يعمل في Odoo لكنه غير موجود في ملف الموظفين (Excel) بعد، فبيانات الهوية والراتب والمستندات فارغة. أضفه لملف HR برقم التسجيل نفسه وسيرتبط تلقائياً.', 'This employee works in Odoo but is not in the HR employee file (Excel) yet, so identity, payroll and documents are empty. Add them to the HR file with the same registration number and they link automatically.')}
        </p>
      )}

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
        <div className="hr-stagger min-w-0 space-y-5">
          <OdooCard code={employee.employeeCode} />
          {!odooOnly && <Section icon={BriefcaseBusiness} title={t('البيانات الوظيفية', 'Employment')} action={edit('master')}>
            <dl className="grid grid-cols-1 gap-x-6 gap-y-4 sm:grid-cols-2 lg:grid-cols-3">
              <KeyValue label={t('المسمى الوظيفي', 'Job title')} value={employee.title} />
              <KeyValue label={t('القسم', 'Department')} value={employee.department} />
              <KeyValue label={t('القطاع', 'Sector')} value={employee.sector} />
              <KeyValue label={t('تاريخ التعيين', 'Hiring date')} value={date(employee.hiringDate, lang)} />
              <KeyValue label={t('نوع العمل', 'Work type')} value={employee.workType} />
              <KeyValue label={t('الوردية', 'Shift')} value={employee.shiftStart || employee.shiftEnd ? `${employee.shiftStart} — ${employee.shiftEnd}` : '—'} />
              <KeyValue label={t('ساعات أسبوعية', 'Weekly hours')} value={employee.weeklyHours ? num(employee.weeklyHours, lang, 1) : '—'} />
              {employee.resignationDate && <KeyValue label={t('تاريخ الاستقالة', 'Resignation date')} value={date(employee.resignationDate, lang)} />}
            </dl>
          </Section>}

          {!odooOnly && <Section icon={IdCard} title={t('الهوية والتواصل', 'Identity & contact')}>
            <dl className="grid grid-cols-1 gap-x-6 gap-y-4 sm:grid-cols-2 lg:grid-cols-3">
              <KeyValue label={t('البريد الوظيفي', 'Company e-mail')} value={<span className="ltr">{employee.companyEmail || '—'}</span>} />
              <KeyValue label={t('البريد الشخصي', 'Personal e-mail')} value={<span className="ltr">{employee.personalEmail || '—'}</span>} />
              <KeyValue label={t('الموبايل', 'Mobile')} value={<span className="ltr">{employee.mobile || '—'}</span>} />
              <KeyValue label={t('الرقم القومي', 'National ID')} value={<span className="ltr">{employee.nationalId || '—'}</span>} />
              <KeyValue label={t('تاريخ الميلاد', 'Birth date')} value={date(employee.birthDate, lang)} />
              <KeyValue label={t('النوع', 'Gender')} value={employee.gender} />
              <KeyValue label={t('الحالة الاجتماعية', 'Marital status')} value={employee.maritalStatus} />
              <KeyValue label={t('العنوان', 'Address')} value={employee.address} />
            </dl>
          </Section>}

          <Section icon={CalendarDays} title={t('الإجازات والأرصدة', 'Leave & balances')} action={access?.personnel ? <LinkArrow to="/hr/personnel/leave">{t('كل الإجازات', 'All leave')}</LinkArrow> : null}>
            {employee.leave ? (
              <div className="space-y-4">
                <p className="text-[12px] font-bold text-slate-500">{t('من ملف الإجازات', 'From the leave workbook')}</p>
                <dl className="grid grid-cols-3 gap-3">
                  <Tile label={t('المتاح الآن', 'Available now')} value={employee.leave.availableNow === null ? '—' : num(employee.leave.availableNow, lang, 1)} danger={Number(employee.leave.availableNow) < 0} />
                  <Tile label={t('سنوي مستخدم', 'Annual used')} value={employee.leave.annualUsed === null ? '—' : num(employee.leave.annualUsed, lang, 1)} />
                  <Tile label={t('مرضي متبقٍ', 'Sick remaining')} value={employee.leave.sickRemaining === null ? '—' : num(employee.leave.sickRemaining, lang, 1)} />
                </dl>
                {(employee.leave.records?.length ?? 0) > 0 && (
                  <ul className="divide-y divide-slate-200/60 rounded-2xl bg-white/60 ring-1 ring-white/80">
                    {employee.leave.records!.slice(0, 8).map((record) => <li key={record.id} className="flex items-center justify-between gap-3 px-3 py-2 text-[12.5px]"><span className="font-semibold text-navy">{record.code}</span><span className="text-slate-500">{num(record.days, lang, 1)} · {date(record.date, lang)}</span></li>)}
                  </ul>
                )}
              </div>
            ) : !odooOnly ? <p className="rounded-2xl bg-white/60 px-3 py-2.5 text-[12.5px] text-slate-500">{t('لا يوجد رصيد في ملف الإجازات لهذا الكود.', 'The leave workbook has no balance for this code.')}</p> : null}
            <OdooTimeOff code={employee.employeeCode} />
          </Section>

          {showsPayroll && !odooOnly && (
            <Section icon={WalletCards} title={t('الراتب الحالي', 'Current payroll')} action={edit('payroll')}>
              {employee.payroll ? (
                <dl className="grid grid-cols-3 gap-3">
                  {[[t('الأساسي', 'Base'), employee.payroll.baseSalary], ['KPI', employee.payroll.kpiAmount], [t('الإجمالي', 'Total'), employee.payroll.totalSalary]].map(([label, value]) => (
                    <Tile key={String(label)} label={label} value={<span className="text-[16px]">{money(value as number | null, lang)}</span>} />
                  ))}
                </dl>
              ) : <EmptyBlock title={t('لا يوجد سجل راتب لهذا الكود', 'No payroll row for this code')} />}
            </Section>
          )}

          {showsPayroll && !odooOnly && (
            <Section icon={ShieldCheck} title={t('التأمينات والضرائب', 'Insurance & tax')} action={edit('insurance')}>
              {employee.insurance ? (
                <dl className="grid grid-cols-1 gap-x-6 gap-y-4 sm:grid-cols-2 lg:grid-cols-3">
                  <KeyValue label={t('الرقم التأميني', 'Insurance number')} value={String(employee.insurance.insuranceNumber || '—')} />
                  <KeyValue label={t('الحالة', 'Status')} value={String(employee.insurance.status || '—')} />
                  <KeyValue label={t('أجر الاشتراك', 'Contribution salary')} value={money(employee.insurance.subscriptionSalary as number, lang)} />
                  <KeyValue label={t('حصة الموظف', 'Employee share')} value={money(employee.insurance.employeeShare as number, lang)} />
                  <KeyValue label={t('حصة الشركة', 'Employer share')} value={money(employee.insurance.employerShare as number, lang)} />
                  <KeyValue label={t('الضريبة الشهرية', 'Monthly tax')} value={money(employee.insurance.monthlyTax as number, lang)} />
                </dl>
              ) : <EmptyBlock title={t('لا يوجد سجل تأمين لهذا الكود', 'No insurance row for this code')} />}
            </Section>
          )}

          {access?.personnel && (
            <Section icon={ClipboardList} title={t('طلبات شئون العاملين', 'Personnel cases')} action={<LinkArrow to="/hr/personnel/requests">{t('فتح شئون العاملين', 'Open personnel')}</LinkArrow>}>
              {cases.length ? (
                <ul className="space-y-2">
                  {cases.map((item) => (
                    <li key={item.id}><Link to={`/hr/personnel/${item.type === 'onboarding' ? 'onboarding' : item.type === 'clearance' ? 'clearance' : item.type === 'leave' ? 'leave' : 'requests'}?case=${encodeURIComponent(item.id)}`} className="hr-lift flex items-center justify-between gap-3 rounded-2xl border border-white/80 bg-white/60 px-3 py-2.5"><span className="text-[13px] font-semibold text-navy">{pick(PERSONNEL_TYPE_LABEL[item.type])}</span><Badge tone={item.status === 'done' ? 'success' : item.status === 'cancelled' ? 'neutral' : 'info'}>{pick(PERSONNEL_STATUS_LABEL[item.status])}</Badge></Link></li>
                  ))}
                </ul>
              ) : <p className="text-[12.5px] text-ink-faint">{t('لا توجد طلبات.', 'No cases.')}</p>}
            </Section>
          )}
        </div>

        <aside className="hr-stagger min-w-0 space-y-5">
          {!odooOnly && <Section icon={FileCheck2} title={t('اكتمال المستندات', 'Documents')}>
            <div className="flex items-end justify-between"><span className="text-[12px] font-semibold text-slate-500">{t('مكتمل', 'Complete')}</span><b className="text-[24px] font-extrabold tabular-nums text-navy">{docsRate}%</b></div>
            <div className="mt-2 h-2.5 overflow-hidden rounded-full bg-slate-200/70"><span className={cx('block h-full rounded-full transition-[width] duration-700', docsRate >= 100 ? 'bg-gradient-to-r from-emerald-400 to-green-600' : 'bg-gradient-to-r from-amber-400 to-orange-500')} style={{ width: `${Math.min(100, docsRate)}%` }} /></div>
            <ul className="mt-3 grid grid-cols-2 gap-1.5">
              {documents.map(([key, value]) => <li key={key} className={cx('flex items-center gap-1.5 rounded-xl px-2 py-1.5 text-[11.5px] font-semibold', value ? 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-100' : 'bg-white/60 text-slate-400 ring-1 ring-white/80')}>{value ? <Check size={12} aria-hidden="true" /> : <span aria-hidden="true">—</span>}<span className="truncate">{DOCUMENT_LABEL[key] ? pick(DOCUMENT_LABEL[key]) : key}</span><span className="sr-only">{value ? t('موجود', 'on file') : t('ناقص', 'missing')}</span></li>)}
            </ul>
          </Section>}
          {!odooOnly && <Section icon={Landmark} title={t('الحساب البنكي', 'Bank')} action={edit('bank')}>
            <dl className="space-y-3">
              <KeyValue label={t('البنك', 'Bank')} value={employee.bankName} />
              <KeyValue label={t('الحالة', 'Status')} value={employee.bankStatus} />
              <KeyValue label={t('رقم الحساب', 'Account')} value={<span className="ltr">{employee.bankAccount || '—'}</span>} />
            </dl>
          </Section>}
          {!odooOnly && <Section icon={Link2} title={t('حساب Qodo', 'Qodo account')}>
            {canManage && dashboard.data ? <AccountLink employee={employee} accounts={dashboard.data.accounts} onSaved={() => void reload()} /> : <p className="text-[12.5px] text-slate-500">{employee.linkedUserId ? t('مربوط بحساب دخول.', 'Linked to a sign-in account.') : t('غير مربوط بحساب دخول.', 'Not linked to a sign-in account.')}</p>}
          </Section>}
          <Section icon={Database} title={t('مصادر الملف', 'Sources')}>
            <ul className="grid grid-cols-2 gap-1.5">
              {Object.entries(employee.sources).map(([source, present]) => <li key={source} className={cx('rounded-xl px-2.5 py-1.5 text-[11.5px] font-semibold ring-1', present ? 'bg-[rgb(var(--hr-a1)/0.1)] text-[rgb(var(--hr-a1))] ring-[rgb(var(--hr-a1)/0.2)]' : 'bg-white/60 text-slate-400 ring-white/80')}>{present ? '✓' : '—'} {source}</li>)}
            </ul>
          </Section>
        </aside>
      </div>

      {editing && <Editor employee={employee} section={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); void reload(); }} />}
    </div>
  );
}

export default EmployeeProfile;
