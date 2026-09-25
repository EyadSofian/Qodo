/**
 * The data side of HR Settings: who holds which HR permission, the workbook
 * imports (moved here from the old HR tabs), the legacy migration, the
 * reconciliation queue and the audit trail.
 */

import { useMemo, useState, type ChangeEvent } from 'react';
import { Link } from 'react-router-dom';
import { Bot, Check, CheckCircle2, Cloud, Database, ExternalLink, RefreshCw, Search, UploadCloud } from 'lucide-react';
import { api, errorMessage } from '../../../lib/api';
import { useI18n } from '../../../lib/i18n';
import { cx } from '../../../lib/utils';
import { Spinner, useToast } from '../../../components/ui';
import { hrApi, hrMutate, invalidateHR, useHRQuery } from '../api';
import { dateTime, normaliseSearch, num, useHRText } from '../format';
import type { AuditRow, DatasetMeta, ReconciliationPerson, ReconciliationView, SettingsView } from '../types';
import { DataTable, type Column } from '../ui/DataTable';
import { Badge, PersonAvatar } from '../ui/primitives';
import { EmptyBlock, ErrorBlock, Skeleton } from '../ui/states';
import { SettingsCard } from './common';

const SOURCE_HINT: Record<string, { ar: string; en: string }> = {
  master: { ar: 'البيانات الشخصية والوظيفية والمستندات', en: 'Personal, employment and document data' },
  payroll: { ar: 'المرتب الأساسي وKPI والإجمالي الشهري', en: 'Base, KPI and monthly total' },
  insurance: { ar: 'الاشتراكات والوعاء والضريبة', en: 'Contributions, taxable base and tax' },
  recruitment: { ar: 'سجل تاريخي فقط — يُرحَّل مرة واحدة إلى طلبات Qodo', en: 'History only — migrated once into Qodo requests' },
  organization: { ar: 'المناصب والمدير المباشر والشواغر', en: 'Positions, reporting lines and vacancies' },
  leave: { ar: 'الرصيد السنوي والمرضي وسجل الإجازات', en: 'Annual and sick balances with leave history' },
  offices: { ar: 'الغرف والسعة وأماكن الجلوس', en: 'Rooms, capacity and seating' },
};

export function PermissionsSection({ view }: { view: SettingsView }) {
  const { t } = useHRText();
  const { t: translate } = useI18n();
  const label = (key: string) => {
    const text = translate(`perm.${key}` as Parameters<typeof translate>[0]);
    return text === `perm.${key}` ? key : text;
  };
  return (
    <div className="space-y-5">
      <SettingsCard
        title={t('صلاحيات HR', 'HR permissions')}
        hint={t('تُمنح من شاشة المستخدمين، وكل مسار على الخادم يتحقق منها. الاعتماد والمد وتجاوز السعة والمكافآت والإعدادات لا تُشتق من غيرها أبداً.', 'Granted from the Users screen and checked by every route on the server. Approve, extend, capacity override, rewards and settings are never derived from anything else.')}
        action={<Link to="/users" className="inline-flex items-center gap-1 text-brand-700 hover:underline">{t('شاشة المستخدمين', 'Users screen')}<ExternalLink size={13} aria-hidden="true" /></Link>}
      >
        <ul className="grid grid-cols-1 gap-2 md:grid-cols-2">
          {view.permissions.keys.map((key) => {
            const holders = view.permissions.holders.filter((holder) => holder.keys.includes(key));
            return (
              <li key={key} className="rounded-xl border border-[#EEF2F7] px-3 py-2.5">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-[13px] font-semibold text-navy">{label(key)}</p>
                    <code className="ltr text-[11px] text-ink-faint">{key}</code>
                  </div>
                  <Badge tone={holders.length ? 'info' : 'neutral'}>{holders.length}</Badge>
                </div>
                {holders.length > 0 && <p className="mt-1.5 text-[12px] leading-5 text-[#5A6C82]">{holders.slice(0, 6).map((holder) => holder.name).join('، ')}{holders.length > 6 ? ` +${holders.length - 6}` : ''}</p>}
              </li>
            );
          })}
        </ul>
      </SettingsCard>
    </div>
  );
}

function DatasetCard({ dataset, busy, disabled, onUpload }: { dataset: DatasetMeta; busy: boolean; disabled: boolean; onUpload: (event: ChangeEvent<HTMLInputElement>) => void }) {
  const { t, lang, pick } = useHRText();
  const ready = Boolean(dataset.importedAt);
  return (
    <article className={cx('flex flex-col rounded-2xl border bg-white p-4', ready ? 'border-[#E6ECF3]' : 'border-dashed border-slate-300')}>
      <div className="flex items-start justify-between gap-2">
        <h3 className="text-[14px] font-bold text-navy">{pick(dataset.label)}</h3>
        <Badge tone={ready ? 'success' : 'neutral'}>{ready ? t('متصل', 'Ready') : t('ناقص', 'Missing')}</Badge>
      </div>
      <p className="mt-1 text-[12px] leading-5 text-[#5A6C82]">{SOURCE_HINT[dataset.source] ? pick(SOURCE_HINT[dataset.source]) : ''}</p>
      {ready && (
        <div className="mt-3 rounded-xl bg-[#F6F8FB] p-2.5">
          <p className="truncate text-[11.5px] font-semibold text-navy" title={dataset.fileName}>{dataset.fileName}</p>
          <p className="mt-0.5 text-[11px] text-[#5A6C82]">{dateTime(dataset.importedAt, lang)} · {dataset.origin === 'telegram' ? 'Telegram' : t('لوحة التحكم', 'Dashboard')}</p>
          {dataset.warnings.length > 0 && <p className="mt-1 text-[11px] font-semibold text-amber-700">{t(`${dataset.warnings.length} تحذير`, `${dataset.warnings.length} warnings`)}</p>}
        </div>
      )}
      <label className={cx('btn-ghost btn-sm mt-3 w-full cursor-pointer', disabled && 'pointer-events-none opacity-50')}>
        <input type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" className="sr-only" onChange={onUpload} disabled={disabled} />
        {busy ? <Spinner size={15} /> : <UploadCloud size={15} />}
        {busy ? t('جارٍ التحليل…', 'Analysing…') : ready ? t('استبدال الملف', 'Replace workbook') : t('رفع الملف', 'Upload workbook')}
      </label>
    </article>
  );
}

export function ImportsSection({ view }: { view: SettingsView }) {
  const { t, lang, pick } = useHRText();
  const { push } = useToast();
  const [uploading, setUploading] = useState<string | null>(null);
  if (!view.imports) return <EmptyBlock title={t('رفع الملفات يحتاج صلاحية إدارة HR', 'Uploading needs the HR manage permission')} />;
  const { datasets, history, telegram } = view.imports;
  const upload = async (source: string, event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    setUploading(source);
    try {
      const result = await api.upload<{ dataset: DatasetMeta; migration?: { created: number; existing: number } | null }>(`/hr/imports/${source}`, file);
      invalidateHR();
      const migrated = result.migration ? t(` — رُحّل ${result.migration.created} طلب جديد`, ` — ${result.migration.created} new requests migrated`) : '';
      push(t(`حُدّث ${result.dataset.label.ar}${migrated}.`, `${result.dataset.label.en} updated${migrated}.`));
    } catch (error) {
      push(errorMessage(error, lang), 'bad');
    } finally {
      setUploading(null);
    }
  };
  return (
    <div className="space-y-5">
      <SettingsCard title={t('ملفات البيانات', 'Data workbooks')} hint={t('كود الموظف هو المفتاح. الاسم لا يدمج سجلين تلقائياً، واستبدال ملف لا يحذف سجل الاستيراد ولا روابط حسابات Qodo. ملف التوظيف تاريخي فقط.', 'The employee code is the key. Names never merge two records, and replacing a workbook keeps the import history and Qodo account links. The recruitment workbook is history only.')}>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {datasets.map((dataset) => <DatasetCard key={dataset.source} dataset={dataset} busy={uploading === dataset.source} disabled={Boolean(uploading)} onUpload={(event) => void upload(dataset.source, event)} />)}
        </div>
      </SettingsCard>
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <SettingsCard title={<span className="flex items-center gap-2"><Bot size={16} className="text-brand-600" aria-hidden="true" />{t('قناة Telegram للرواتب', 'Telegram payroll channel')}</span>}>
          <Badge tone={telegram.enabled ? 'success' : 'warning'}>{telegram.enabled ? t('متصل', 'Connected') : t('يحتاج إعداد', 'Needs setup')}</Badge>
          <p className="mt-2 text-[12.5px] leading-6 text-[#5A6C82]">{t('البوت يقبل نفس ملفات Excel، ويتحقق من السر وقائمة المحادثات المسموحة، ثم يمر بنفس مسار المطابقة.', 'The bot accepts the same Excel files, checks the secret and the chat allow-list, then runs the same reconciliation path.')}</p>
          {!telegram.restricted && telegram.enabled && <p className="mt-1 text-[12px] font-semibold text-amber-700">{t('لا توجد قائمة محادثات مسموحة.', 'No chat allow-list is set.')}</p>}
        </SettingsCard>
        <SettingsCard title={t('آخر عمليات الاستيراد', 'Recent imports')}>
          {history.length ? (
            <ul className="divide-y divide-[#EEF2F7]">
              {history.map((run) => {
                const dataset = datasets.find((item) => item.source === run.source);
                return (
                  <li key={run.id} className="flex items-center justify-between gap-3 py-2 text-[12.5px]">
                    <span className="min-w-0"><span className="block truncate font-semibold text-navy">{dataset ? pick(dataset.label) : run.source}</span><span className="block truncate text-[11.5px] text-[#5A6C82]">{run.fileName ?? '—'}</span></span>
                    <span className="shrink-0 text-end text-[11.5px] text-ink-faint">{dateTime(run.createdAt, lang)}<br />{run.origin === 'telegram' ? 'Telegram' : t('لوحة التحكم', 'Dashboard')}</span>
                  </li>
                );
              })}
            </ul>
          ) : <p className="text-[12.5px] text-ink-faint">{t('لا توجد عمليات بعد.', 'Nothing imported yet.')}</p>}
        </SettingsCard>
      </div>
    </div>
  );
}

export function MigrationSection({ view }: { view: SettingsView }) {
  const { t, lang } = useHRText();
  const { push } = useToast();
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<{ total: number; created: number; existing: number } | null>(null);
  const run = async () => {
    setRunning(true);
    try {
      const response = await hrMutate<{ migration: { total: number; created: number; existing: number } }>('post', '/hr/settings/migration', {});
      setResult(response.migration);
      push(t('اكتملت المزامنة.', 'Migration finished.'));
    } catch (error) {
      push(errorMessage(error, lang), 'bad');
    } finally {
      setRunning(false);
    }
  };
  return (
    <div className="space-y-5">
      <SettingsCard title={t('ترحيل طلبات التوظيف التاريخية', 'Legacy recruitment migration')} hint={t('يحوّل صفوف ملف التوظيف القديم إلى طلبات Qodo مرة واحدة. آمن للتكرار: كل صف له معرّف ثابت، فالتشغيل مرة ثانية لا يكرر شيئاً ولا يغيّر طلباً تم تعديله في Qodo.', 'Turns the old recruitment workbook rows into Qodo requests once. Safe to repeat: every row has a fixed id, so running it again duplicates nothing and never overwrites a request edited in Qodo.')}>
        <dl className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <div className="rounded-xl bg-[#F6F8FB] p-3"><dt className="text-[11.5px] font-semibold text-[#5A6C82]">{t('طلبات مُرحّلة', 'Requests migrated')}</dt><dd className="mt-0.5 text-[20px] font-bold tabular-nums text-navy">{num(view.migration.imported, lang)}</dd></div>
          <div className="rounded-xl bg-[#F6F8FB] p-3"><dt className="text-[11.5px] font-semibold text-[#5A6C82]">{t('آخر ترحيل', 'Last migrated')}</dt><dd className="mt-0.5 text-[13px] font-semibold text-navy">{dateTime(view.migration.lastImportedAt, lang)}</dd></div>
          <div className="rounded-xl bg-[#F6F8FB] p-3"><dt className="text-[11.5px] font-semibold text-[#5A6C82]">{t('إصدار قواعد الترحيل', 'Migration rules version')}</dt><dd className="mt-0.5 text-[13px] font-semibold text-navy">v{view.migration.version}</dd></div>
        </dl>
        <ul className="mt-4 space-y-1.5 text-[12.5px] leading-6 text-[#3F5068]">
          {[
            t('يحفظ المعرّف القديم والمصدر وتواريخ التفعيل والاستحقاق والحالة.', 'Keeps the legacy id, source, active and due dates, and status.'),
            t('لا يخترع سجل اعتماد لطلب لم يمر بالاعتماد في Qodo.', 'Never invents approval history for a request that was not approved in Qodo.'),
            t('الوظائف المكتملة بلا تاريخ إغلاق تبقى نتيجتها "غير معروفة" ولا تدخل المكافآت أو KPI.', 'Completed jobs without a closing date keep an "unknown" outcome and stay out of rewards and KPI.'),
            t('المسؤول يُطابق من قسم الموارد البشرية فقط، والاسم غير المحسوم يظهر في المطابقة.', 'The recruiter is matched within the HR department only; an unresolved name shows in reconciliation.'),
          ].map((line) => <li key={line} className="flex gap-2"><Check size={15} className="mt-1 shrink-0 text-emerald-600" aria-hidden="true" />{line}</li>)}
        </ul>
        {view.canEdit && (
          <button type="button" className="btn-ghost btn-sm mt-4" disabled={running} onClick={() => void run()}>{running ? <Spinner size={15} /> : <RefreshCw size={15} />}{t('تشغيل الترحيل الآن', 'Run the migration now')}</button>
        )}
        {result && <p className="mt-3 flex items-center gap-2 rounded-xl bg-emerald-50 px-3 py-2.5 text-[12.5px] font-semibold text-emerald-800"><CheckCircle2 size={15} aria-hidden="true" />{t(`جديد ${result.created} · موجود مسبقاً ${result.existing}`, `New ${result.created} · already there ${result.existing}`)}</p>}
      </SettingsCard>
    </div>
  );
}

function PeopleGap({ title, people }: { title: string; people: ReconciliationPerson[] | null }) {
  const { t, lang } = useHRText();
  if (people === null) return null;
  return (
    <div>
      <h3 className="mb-1.5 flex items-center justify-between text-[13px] font-bold text-navy">{title}<Badge tone={people.length ? 'warning' : 'success'}>{people.length}</Badge></h3>
      {people.length ? (
        <ul className="max-h-60 divide-y divide-[#EEF2F7] overflow-y-auto rounded-xl border border-[#EEF2F7]">
          {people.map((person) => (
            <li key={person.employeeCode}><Link to={`/hr/people/${encodeURIComponent(person.employeeCode)}`} className="flex items-center justify-between gap-2 px-3 py-2 text-[12.5px] hover:bg-[#F7FAFD]"><span className="truncate font-semibold text-navy">{(lang === 'en' ? person.nameEnglish || person.nameArabic : person.nameArabic || person.nameEnglish) || `#${person.employeeCode}`}</span><span className="shrink-0 font-mono text-[11px] text-ink-faint">#{person.employeeCode}</span></Link></li>
          ))}
        </ul>
      ) : <p className="text-[12px] text-emerald-700">{t('لا شيء — متطابق.', 'Nothing — all matched.')}</p>}
    </div>
  );
}

export function ReconciliationSection() {
  const { t, lang } = useHRText();
  const { data, error, loading, reload } = useHRQuery<ReconciliationView>(hrApi.reconciliation);
  if (error && !data) return <ErrorBlock error={error} onRetry={reload} />;
  if (loading && !data) return <Skeleton className="h-64" />;
  if (!data) return null;
  const fieldLabel: Record<string, { ar: string; en: string }> = {
    status: { ar: 'الحالة', en: 'Status' },
    accepted: { ar: 'المقبولون', en: 'Accepted' },
    headcount: { ar: 'العدد المطلوب', en: 'Headcount' },
    dueDate: { ar: 'تاريخ الاستحقاق', en: 'Due date' },
    recruiter: { ar: 'المسؤول', en: 'Recruiter' },
  };
  const show = (value: unknown) => (value === null || value === undefined || value === '' ? '—' : String(value));
  return (
    <div className="space-y-5">
      <SettingsCard title={t('الموظفون والحسابات', 'People and accounts')} hint={t('ما لا يتطابق بين ملفات HR وبين حسابات الدخول.', 'What does not line up across the HR files and the sign-in accounts.')}>
        <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
          <PeopleGap title={t('نشطون بلا حساب Qodo', 'Active without a Qodo account')} people={data.people.unlinkedAccounts} />
          <PeopleGap title={t('نشطون بلا سجل راتب', 'Active without payroll')} people={data.people.activeWithoutPayroll} />
          <PeopleGap title={t('في الرواتب وليسوا في القاعدة', 'On payroll, not in the database')} people={data.people.payrollWithoutMaster} />
          <PeopleGap title={t('في التأمينات وليسوا في القاعدة', 'In insurance, not in the database')} people={data.people.insuranceWithoutMaster} />
        </div>
        {data.people.odooOnly && data.people.odooOnly.length > 0 && (
          <div className="mt-5">
            <h3 className="mb-1 flex items-center justify-between gap-2 text-[13px] font-bold text-navy">
              <span className="inline-flex items-center gap-1.5"><Cloud size={15} className="text-sky-600" aria-hidden="true" />{t('يعملون في Odoo وليسوا في ملف HR', 'Working in Odoo, missing from the HR file')}</span>
              <Badge tone="info">{num(data.people.odooOnly.length, lang)}</Badge>
            </h3>
            <p className="mb-2 text-[12px] text-[#5A6C82]">{t('موظفون نشطون في Odoo لا يقابلهم سجل في قاعدة الموظفين — أضفهم في الملف القادم ليكتمل ملفهم.', 'Active in Odoo with no row in the employee database — add them in the next upload to complete their file.')}</p>
            <ul className="grid max-h-80 grid-cols-1 gap-1.5 overflow-y-auto sm:grid-cols-2">
              {data.people.odooOnly.map((person) => (
                <li key={person.odooId}>
                  <Link to={`/hr/people/${encodeURIComponent(person.code)}`} className="flex items-center gap-2.5 rounded-2xl border border-[#EEF2F7] bg-white/70 px-2.5 py-2 transition-colors hover:border-sky-200 hover:bg-sky-50/60">
                    <PersonAvatar name={person.name} photoUrl={person.photoUrl} size={34} />
                    <span className="min-w-0 flex-1">
                      <span className="hr-bidi block truncate text-[12.5px] font-semibold text-navy">{person.name || `#${person.code}`}</span>
                      <span className="hr-bidi block truncate text-[11px] text-[#5A6C82]">{[person.jobTitle, person.department].filter(Boolean).join(' · ') || '—'}</span>
                    </span>
                    <span className="shrink-0 font-mono text-[11px] text-ink-faint">#{person.code}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        )}
        {data.people.unmatchedPositions.length > 0 && (
          <div className="mt-5">
            <h3 className="mb-1.5 text-[13px] font-bold text-navy">{t(`مناصب في الهيكل تحتاج مطابقة (${data.people.unmatchedPositions.length})`, `Structure positions needing a match (${data.people.unmatchedPositions.length})`)}</h3>
            <ul className="max-h-60 divide-y divide-[#EEF2F7] overflow-y-auto rounded-xl border border-[#EEF2F7]">
              {data.people.unmatchedPositions.map((position) => <li key={position.id} className="flex items-center justify-between gap-2 px-3 py-2 text-[12.5px]"><span className="truncate font-semibold text-navy">{position.title}</span><span className="shrink-0 truncate text-[11.5px] text-[#5A6C82]">{position.employeeName || '—'} · {position.department || '—'}</span></li>)}
            </ul>
          </div>
        )}
      </SettingsCard>

      <SettingsCard title={t('ملف التوظيف القديم مقابل Qodo', 'Recruitment workbook vs Qodo')} hint={data.workbook ? t(`${data.workbook.fileName} · ${num(data.workbook.rows, 'ar')} صف · ${dateTime(data.workbook.importedAt, 'ar')}`, `${data.workbook.fileName} · ${num(data.workbook.rows, 'en')} rows · ${dateTime(data.workbook.importedAt, 'en')}`) : t('لا يوجد ملف توظيف مرفوع.', 'No recruitment workbook uploaded.')}>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          {[[t('مُرحّل', 'Migrated'), data.imported], [t('فروق', 'Differences'), data.differences.length], [t('لم يُرحّل', 'Not migrated'), data.missing.length], [t('أسماء غير محسومة', 'Unresolved names'), data.unresolved.length]].map(([label, value]) => (
            <div key={String(label)} className="rounded-xl bg-[#F6F8FB] p-3"><p className="text-[11.5px] font-semibold text-[#5A6C82]">{label}</p><p className="mt-0.5 text-[20px] font-bold tabular-nums text-navy">{num(Number(value), lang)}</p></div>
          ))}
        </div>
        {data.differences.length > 0 && (
          <div className="mt-4">
            <h3 className="mb-1.5 text-[13px] font-bold text-navy">{t('فروق بين الملف وQodo', 'Where the workbook and Qodo differ')}</h3>
            <p className="mb-2 text-[12px] text-[#5A6C82]">{t('Qodo هو المرجع التشغيلي الآن؛ الفرق يعني أن الطلب تغيّر في Qodo بعد الترحيل أو أن الملف تغيّر.', 'Qodo is the operating record now; a difference means the request changed in Qodo after migration, or the workbook changed.')}</p>
            <ul className="space-y-2">
              {data.differences.map((row) => (
                <li key={row.requestId} className="rounded-xl border border-[#EEF2F7] px-3 py-2">
                  <Link to={`/hr/recruitment/requests/${encodeURIComponent(row.requestId)}`} className="text-[13px] font-semibold text-navy hover:text-brand-700">{row.reference} · {row.title}</Link>
                  <ul className="mt-1 space-y-0.5 text-[12px] text-[#5A6C82]">{row.fields.map((field) => <li key={field.field}>{fieldLabel[field.field] ? (lang === 'en' ? fieldLabel[field.field].en : fieldLabel[field.field].ar) : field.field}: <span className="line-through">{show(field.workbook)}</span> → <b className="text-navy">{show(field.qodo)}</b></li>)}</ul>
                </li>
              ))}
            </ul>
          </div>
        )}
        {data.unresolved.length > 0 && (
          <div className="mt-4">
            <h3 className="mb-1.5 text-[13px] font-bold text-navy">{t('مسؤولون بالاسم لم تُحسم مطابقتهم', 'Recruiter names that could not be matched')}</h3>
            <ul className="space-y-1.5">{data.unresolved.map((row) => <li key={row.requestId} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-[#EEF2F7] px-3 py-2 text-[12.5px]"><Link to={`/hr/recruitment/requests/${encodeURIComponent(row.requestId)}?action=assign`} className="font-semibold text-navy hover:text-brand-700">{row.reference} · {row.title}</Link><span className="text-amber-700">{row.names.join('، ')}</span></li>)}</ul>
          </div>
        )}
        {data.orphans.length > 0 && <p className="mt-4 text-[12px] text-[#5A6C82]">{t(`${data.orphans.length} طلب مُرحّل لم يعد في الملف الحالي — يبقى في Qodo كما هو.`, `${data.orphans.length} migrated requests are no longer in the current workbook — they stay in Qodo as they are.`)}</p>}
      </SettingsCard>
    </div>
  );
}

const AUDIT_KIND: Record<string, { ar: string; en: string }> = {
  approval: { ar: 'قرار اعتماد', en: 'Approval decision' },
  assignment: { ar: 'إسناد', en: 'Assignment' },
  capacity_override: { ar: 'تجاوز سعة', en: 'Capacity override' },
  extension: { ar: 'مد مهلة', en: 'Extension' },
  kpi_deduction: { ar: 'خصم KPI', en: 'KPI deduction' },
  kpi_void: { ar: 'إلغاء خصم', en: 'Deduction voided' },
  created: { ar: 'إنشاء طلب', en: 'Request created' },
  edited: { ar: 'تعديل طلب', en: 'Request edited' },
  priority_changed: { ar: 'تغيير أولوية', en: 'Priority changed' },
  accepted_recorded: { ar: 'تسجيل مقبولين', en: 'Hires recorded' },
  odoo_linked: { ar: 'ربط Odoo', en: 'Odoo linked' },
  odoo_unlinked: { ar: 'فك ربط Odoo', en: 'Odoo unlinked' },
  imported_from_workbook: { ar: 'ترحيل من الملف', en: 'Migrated from workbook' },
  'hr.import': { ar: 'رفع ملف', en: 'Workbook uploaded' },
  'hr.employee.update': { ar: 'تعديل موظف', en: 'Employee edited' },
  'hr.employee.link': { ar: 'ربط حساب', en: 'Account linked' },
  'hr.settings.update': { ar: 'تعديل إعدادات HR', en: 'HR settings changed' },
  'hr.rewards.rules': { ar: 'نسخة قواعد مكافآت', en: 'Reward rules version' },
  'hr.recruitment.migration': { ar: 'تشغيل الترحيل', en: 'Migration run' },
};

function auditDetail(row: AuditRow) {
  const detail = row.detail ?? {};
  const parts = ['comment', 'reason', 'overrideReason', 'note', 'decision', 'previousDueDate', 'newDueDate', 'added', 'sections', 'fields', 'fileName']
    .map((key) => detail[key])
    .filter((value) => value !== null && value !== undefined && value !== '')
    .map((value) => (Array.isArray(value) ? value.join('، ') : typeof value === 'object' ? JSON.stringify(value) : String(value)));
  return parts.join(' · ');
}

export function AuditSection() {
  const { t, lang, pick } = useHRText();
  const { data, error, loading, reload } = useHRQuery<{ rows: AuditRow[] }>(`${hrApi.audit}?limit=500`);
  const [kind, setKind] = useState('');
  const [q, setQ] = useState('');
  const rows = useMemo(() => {
    const needle = normaliseSearch(q);
    return (data?.rows ?? [])
      .filter((row) => !kind || row.kind === kind)
      .filter((row) => !needle || normaliseSearch(`${row.actor} ${row.subject} ${auditDetail(row)}`).includes(needle))
      .map((row, index) => ({ ...row, id: `${row.at}-${index}` }));
  }, [data, kind, q]);
  if (error && !data) return <ErrorBlock error={error} onRetry={reload} />;
  if (loading && !data) return <Skeleton className="h-64" />;
  const kinds = [...new Set((data?.rows ?? []).map((row) => row.kind))];
  const columns: Array<Column<AuditRow & { id: string }>> = [
    { key: 'at', header: t('الوقت', 'When'), sort: (row) => row.at, cell: (row) => <span className="whitespace-nowrap text-[12px] text-[#5A6C82]">{dateTime(row.at, lang)}</span> },
    { key: 'kind', header: t('الحدث', 'Event'), sort: (row) => row.kind, cell: (row) => <Badge tone={row.kind === 'capacity_override' || row.kind === 'kpi_deduction' ? 'warning' : row.kind === 'extension' ? 'info' : 'neutral'}>{AUDIT_KIND[row.kind] ? pick(AUDIT_KIND[row.kind]) : row.kind}</Badge> },
    { key: 'actor', header: t('بواسطة', 'By'), sort: (row) => row.actor, cell: (row) => <span className="text-[12.5px] font-semibold text-navy">{row.actor || '—'}</span> },
    { key: 'subject', header: t('على', 'On'), cell: (row) => (row.requestId ? <Link to={`/hr/recruitment/requests/${encodeURIComponent(row.requestId)}`} onClick={(event) => event.stopPropagation()} className="text-[12.5px] text-brand-700 hover:underline">{row.subject}</Link> : <span className="text-[12.5px]">{row.subject || '—'}</span>) },
    { key: 'detail', header: t('التفاصيل', 'Detail'), cell: (row) => <span className="line-clamp-2 text-[12px] text-[#5A6C82]">{auditDetail(row) || '—'}</span> },
  ];
  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-2 sm:flex-row">
        <select className="field !py-2 sm:w-56" value={kind} onChange={(event) => setKind(event.target.value)} aria-label={t('نوع الحدث', 'Event type')}>
          <option value="">{t('كل الأحداث', 'All events')}</option>
          {kinds.map((entry) => <option key={entry} value={entry}>{AUDIT_KIND[entry] ? pick(AUDIT_KIND[entry]) : entry}</option>)}
        </select>
        <div className="relative sm:w-72">
          <Search size={15} className="pointer-events-none absolute start-3 top-1/2 -translate-y-1/2 text-ink-faint" aria-hidden="true" />
          <input className="field !py-2 ps-9" value={q} onChange={(event) => setQ(event.target.value)} placeholder={t('شخص، طلب، سبب…', 'Person, request, reason…')} aria-label={t('بحث في السجل', 'Search the log')} />
        </div>
      </div>
      <DataTable rows={rows} columns={columns} initialSort={{ key: 'at', direction: 'desc' }} caption={t('سجل التدقيق', 'Audit log')} empty={<EmptyBlock icon={<Database size={24} />} title={t('لا توجد أحداث', 'No events')} />} />
    </div>
  );
}
