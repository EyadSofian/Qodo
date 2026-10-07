import { useEffect, useMemo, useState } from 'react';
import { BarChart3, Check, Pencil, Plus, Search, Sparkles } from 'lucide-react';
import { errorMessage } from '../../../lib/api';
import { useToast } from '../../../components/ui';
import { hrApi, hrMutate, useHRQuery } from '../api';
import { monthLabel, normaliseSearch, num, pct, useHRText } from '../format';
import { Card, SectionTitle } from '../ui/primitives';
import { Drawer } from '../ui/Drawer';
import { EmptyBlock, ErrorBlock } from '../ui/states';

type Source = 'manual' | 'paid_revenue' | 'operational_sales' | 'outbound_calls' | 'answered_calls';
type Indicator = { id: string; name: string; weight: number; target: number; actual: number | null; source: Source; unit: string; ratio?: number | null; points?: number | null };
type Plan = { id: string; status: 'draft' | 'published'; indicators: Indicator[]; score: number | null; measured: number; total: number; updatedAt: string; revision: number };
type Person = { employeeCode: string; name: { ar: string; en: string }; title: string; department: string; canEdit: boolean; plan: Plan | null; salesMatched: boolean; sales: { paidRevenue: number | null; operationalSales: number | null; outboundCalls: number | null; answeredCalls: number | null; target: number | null } | null };
type Response = { period: string; source: { name: string; fetchedAt: string | null; stale: boolean; callsAvailable: boolean; error: string | null }; people: Person[] };

const SOURCE_LABELS: Record<Source, { ar: string; en: string }> = {
  manual: { ar: 'إدخال المدير', en: 'Manager entry' },
  paid_revenue: { ar: 'التحصيل المدفوع · Insights', en: 'Paid collections · Insights' },
  operational_sales: { ar: 'المبيعات التشغيلية · Insights', en: 'Operational sales · Insights' },
  outbound_calls: { ar: 'المكالمات الصادرة · Insights', en: 'Outbound calls · Insights' },
  answered_calls: { ar: 'المكالمات المردود عليها · Insights', en: 'Answered calls · Insights' },
};

const starter = (person: Person): Indicator[] => person.salesMatched ? [
  { id: 'sales', name: 'التحصيل المدفوع', weight: 60, target: person.sales?.target || 1, actual: null, source: 'paid_revenue', unit: 'USD' },
  { id: 'calls', name: 'المكالمات الصادرة', weight: 40, target: 1, actual: null, source: 'outbound_calls', unit: 'مكالمة' },
] : [
  { id: 'delivery', name: 'إنجاز المهام في الوقت المحدد', weight: 40, target: 100, actual: null, source: 'manual', unit: '%' },
  { id: 'quality', name: 'جودة المخرجات', weight: 35, target: 100, actual: null, source: 'manual', unit: '%' },
  { id: 'teamwork', name: 'التعاون والاستجابة', weight: 25, target: 100, actual: null, source: 'manual', unit: '%' },
];

function PlanEditor({ person, period, onClose, onSaved }: { person: Person; period: string; onClose: () => void; onSaved: () => void }) {
  const { t, pick, lang } = useHRText();
  const { push } = useToast();
  const [rows, setRows] = useState<Indicator[]>(() => person.plan?.indicators.map((row) => ({ ...row })) || starter(person));
  const [saving, setSaving] = useState(false);
  const total = rows.reduce((sum, row) => sum + Number(row.weight || 0), 0);
  const valid = rows.length > 0 && Math.abs(total - 100) < 0.001 && rows.every((row) => row.name.trim() && Number(row.target) > 0 && Number(row.weight) > 0);
  const change = (id: string, patch: Partial<Indicator>) => setRows((current) => current.map((row) => row.id === id ? { ...row, ...patch } : row));
  const save = async (publish: boolean) => {
    if (!valid) return;
    setSaving(true);
    try {
      await hrMutate('put', hrApi.performancePlan(person.employeeCode, period), { indicators: rows, publish });
      push(publish ? t('تم نشر مؤشرات الموظف.', 'Employee indicators published.') : t('تم حفظ المسودة.', 'Draft saved.'));
      onSaved();
    } catch (error) { push(errorMessage(error, lang), 'bad'); }
    finally { setSaving(false); }
  };
  return <Drawer open onClose={onClose} width={650} title={t(`مؤشرات ${pick(person.name)}`, `${pick(person.name)} indicators`)} subtitle={monthLabel(period, lang)} footer={<><button className="btn-ghost" onClick={() => void save(false)} disabled={saving || !valid}>{t('حفظ مسودة', 'Save draft')}</button><button className="btn-primary" onClick={() => void save(true)} disabled={saving || !valid}><Check size={15} />{t('نشر للمتابعة', 'Publish for tracking')}</button></>}>
    <div className="space-y-5">
      <div className="rounded-2xl border border-teal-100 bg-teal-50 p-4 text-[12.5px] leading-6 text-teal-900">
        {t('حدد أهداف الشهر وأوزان المؤشرات. مجموع الأوزان لازم يكون 100%. أرقام المبيعات والمكالمات بتتحدث من Insights Hub تلقائيًا، والإدخال اليدوي للمؤشرات التانية.', 'Set monthly goals and weights adding to 100%. Sales and calls update automatically from Insights Hub; other indicators use manager entry.')}
      </div>
      <div className="flex items-center justify-between"><h3 className="font-bold text-navy">{t('المؤشرات', 'Indicators')}</h3><span className={`rounded-full px-3 py-1 text-xs font-bold ${valid ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-800'}`}>{t('مجموع الأوزان', 'Total weight')} {num(total, lang)}%</span></div>
      <div className="space-y-3">{rows.map((row, index) => <div key={row.id} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="mb-3 flex items-center justify-between"><span className="text-xs font-bold text-slate-500">{t(`مؤشر ${index + 1}`, `Indicator ${index + 1}`)}</span><button type="button" className="text-xs font-semibold text-red-600 hover:underline" onClick={() => setRows((current) => current.filter((entry) => entry.id !== row.id))}>{t('حذف', 'Remove')}</button></div>
        <label className="block text-xs font-semibold text-slate-600">{t('اسم المؤشر', 'Indicator name')}<input className="field mt-1.5" value={row.name} maxLength={160} onChange={(event) => change(row.id, { name: event.target.value })} /></label>
        <div className="mt-3 grid gap-3 sm:grid-cols-2"><label className="block text-xs font-semibold text-slate-600">{t('مصدر النتيجة', 'Result source')}<select className="field mt-1.5" value={row.source} onChange={(event) => change(row.id, { source: event.target.value as Source, actual: null })}>{Object.entries(SOURCE_LABELS).map(([source, label]) => <option key={source} value={source}>{pick(label)}</option>)}</select></label><label className="block text-xs font-semibold text-slate-600">{t('الوحدة', 'Unit')}<input className="field mt-1.5" value={row.unit} maxLength={30} onChange={(event) => change(row.id, { unit: event.target.value })} /></label></div>
        <div className="mt-3 grid gap-3 sm:grid-cols-3"><label className="block text-xs font-semibold text-slate-600">{t('الوزن %', 'Weight %')}<input className="field mt-1.5" type="number" min="0.01" max="100" step="0.01" value={row.weight} onChange={(event) => change(row.id, { weight: Number(event.target.value) })} /></label><label className="block text-xs font-semibold text-slate-600">{t('الهدف', 'Target')}<input className="field mt-1.5" type="number" min="0.01" step="any" value={row.target} onChange={(event) => change(row.id, { target: Number(event.target.value) })} /></label><label className="block text-xs font-semibold text-slate-600">{t('المنجز', 'Actual')}<input className="field mt-1.5" type="number" min="0" step="any" disabled={row.source !== 'manual'} value={row.source === 'manual' ? row.actual ?? '' : person.sales?.[row.source as keyof NonNullable<Person['sales']>] ?? ''} onChange={(event) => change(row.id, { actual: event.target.value === '' ? null : Number(event.target.value) })} placeholder={row.source === 'manual' ? t('أدخله لاحقًا', 'Enter later') : t('من Insights', 'From Insights')} /></label></div>
      </div>)}</div>
      <button type="button" className="btn-ghost w-full justify-center border border-dashed border-slate-300" onClick={() => setRows((current) => [...current, { id: `kpi-${crypto.randomUUID()}`, name: '', weight: 0, target: 1, actual: null, source: 'manual', unit: '' }])}><Plus size={16} />{t('إضافة مؤشر', 'Add indicator')}</button>
      {!valid && <p className="text-xs text-amber-800">{t('اكتب اسم وهدف ووزن لكل مؤشر، واضبط مجموع الأوزان على 100%.', 'Give every indicator a name, target and weight; make the weights total 100%.')}</p>}
    </div>
  </Drawer>;
}

export function PerformancePlans({ period }: { period: string }) {
  const { t, pick, lang } = useHRText();
  const { data, error, loading, reload } = useHRQuery<Response>(hrApi.performancePlans(period), { refreshMs: 5 * 60_000 });
  const [query, setQuery] = useState('');
  const [department, setDepartment] = useState('');
  const [editing, setEditing] = useState<string | null>(null);
  const departments = useMemo(() => [...new Set((data?.people || []).map((person) => person.department).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'ar')), [data]);
  const people = useMemo(() => (data?.people || []).filter((person) => (!department || person.department === department) && (!query || normaliseSearch(`${person.name.ar} ${person.name.en} ${person.employeeCode}`).includes(normaliseSearch(query)))), [data, department, query]);
  const completed = data?.people.filter((person) => person.plan?.status === 'published').length || 0;
  const drafts = data?.people.filter((person) => person.plan?.status === 'draft').length || 0;
  const person = data?.people.find((entry) => entry.employeeCode === editing) || null;
  useEffect(() => { if (person && !person.canEdit) setEditing(null); }, [person]);
  return <section id="performance-plans" className="scroll-mt-24 space-y-4">
    <SectionTitle title={t('نماذج المؤشرات الشهرية', 'Monthly indicator plans')} hint={t('المدير يحدد أهداف وأوزان موظفي فريقه؛ أرقام السيلز والمكالمات تتحدث من Insights Hub.', 'Managers set team goals and weights; sales and calls update from Insights Hub.')} />
    {error && !data ? <ErrorBlock error={error} onRetry={reload} /> : loading && !data ? <Card><div className="skeleton h-52 rounded-xl" /></Card> : data ? <>
      <div className="grid gap-3 sm:grid-cols-3"><Card className="!p-4"><span className="text-xs font-semibold text-slate-500">{t('الموظفون', 'Employees')}</span><strong className="mt-2 block text-2xl text-navy">{num(data.people.length, lang)}</strong></Card><Card className="!p-4"><span className="text-xs font-semibold text-slate-500">{t('نماذج منشورة', 'Published plans')}</span><strong className="mt-2 block text-2xl text-emerald-700">{num(completed, lang)}</strong></Card><Card className="!p-4"><span className="text-xs font-semibold text-slate-500">{t('قيد الإعداد', 'Drafts')}</span><strong className="mt-2 block text-2xl text-amber-700">{num(drafts, lang)}</strong></Card></div>
      <div className="flex flex-wrap items-center gap-2 text-[11.5px] text-slate-500"><Sparkles size={15} className="text-teal-700" /><span>{data.source.error ? t('تعذر تحديث Insights Hub الآن؛ المؤشرات الآلية غير متاحة.', 'Insights Hub could not refresh; automatic figures are unavailable.') : t(`المصدر: Insights Hub · ${data.source.stale ? 'آخر نسخة متاحة' : 'بيانات مباشرة'} · ${data.source.fetchedAt ? new Date(data.source.fetchedAt).toLocaleString(lang === 'ar' ? 'ar-EG' : 'en-GB') : ''}`, `Source: Insights Hub · ${data.source.stale ? 'last available' : 'live'} · ${data.source.fetchedAt ? new Date(data.source.fetchedAt).toLocaleString('en-GB') : ''}`)}</span><button type="button" className="font-bold text-teal-700 hover:underline" onClick={() => void reload()}>{t('تحديث', 'Refresh')}</button></div>
      <Card className="!p-0 overflow-hidden"><div className="flex flex-wrap gap-2 border-b border-slate-100 p-4"><div className="relative min-w-44 flex-1"><Search size={15} className="absolute start-3 top-3 text-slate-400" /><input className="field ps-9" value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t('ابحث عن موظف', 'Search employees')} /></div><select className="field w-auto min-w-40" value={department} onChange={(event) => setDepartment(event.target.value)}><option value="">{t('كل الأقسام', 'All departments')}</option>{departments.map((item) => <option key={item}>{item}</option>)}</select></div>
        {people.length ? <div className="divide-y divide-slate-100">{people.map((entry) => <div key={entry.employeeCode} className="flex flex-wrap items-center gap-3 px-4 py-3.5 hover:bg-slate-50/60"><div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-teal-50 font-bold text-teal-800">{pick(entry.name).slice(0, 2)}</div><div className="min-w-36 flex-1"><p className="font-bold text-navy">{pick(entry.name)}</p><p className="text-[11.5px] text-slate-500">{entry.title || entry.department || `#${entry.employeeCode}`}</p>{entry.salesMatched && entry.sales && <p className="mt-1 flex flex-wrap gap-x-3 text-[11px] font-semibold text-teal-800"><span>{t('التحصيل', 'Collections')}: {entry.sales.paidRevenue === null ? '—' : `${num(entry.sales.paidRevenue, lang)} USD`}</span><span>{t('مكالمات صادرة', 'Outbound calls')}: {entry.sales.outboundCalls === null ? '—' : num(entry.sales.outboundCalls, lang)}</span><span>{t('تم الرد', 'Answered')}: {entry.sales.answeredCalls === null ? '—' : num(entry.sales.answeredCalls, lang)}</span></p>}</div><div className="flex items-center gap-2"><span className={`rounded-full px-2.5 py-1 text-[11px] font-bold ${entry.plan?.status === 'published' ? 'bg-emerald-50 text-emerald-800' : entry.plan ? 'bg-amber-50 text-amber-800' : 'bg-slate-100 text-slate-500'}`}>{entry.plan?.status === 'published' ? t('منشور', 'Published') : entry.plan ? t('مسودة', 'Draft') : t('لم يبدأ', 'Not started')}</span>{entry.plan && <span className="font-bold tabular-nums text-navy">{pct(entry.plan.score, lang)}</span>}{entry.salesMatched && <span title={t('بيانات سيلز مرتبطة', 'Sales data linked')} className="text-teal-700"><BarChart3 size={15} /></span>}</div>{entry.canEdit && <button type="button" className="btn-ghost btn-sm" onClick={() => setEditing(entry.employeeCode)}>{entry.plan ? <Pencil size={14} /> : <Plus size={14} />}{entry.plan ? t('تعديل', 'Edit') : t('إعداد', 'Set up')}</button>}</div>)}</div> : <div className="p-6"><EmptyBlock title={t('لا يوجد موظفون مطابقون', 'No matching employees')} /></div>}
      </Card>
    </> : null}
    {person && person.canEdit && <PlanEditor key={`${person.employeeCode}:${person.plan?.revision || 0}`} person={person} period={period} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); void reload(); }} />}
  </section>;
}
