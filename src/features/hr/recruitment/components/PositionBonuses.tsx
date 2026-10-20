import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { CalendarClock, Gift, Plus, ShieldAlert } from 'lucide-react';
import { errorMessage } from '../../../../lib/api';
import { Modal, Spinner, useToast } from '../../../../components/ui';
import { hrApi, hrMutate, useHRQuery } from '../../api';
import { date, money, num, useHRText } from '../../format';
import { Badge, Card, SectionTitle } from '../../ui/primitives';
import { EmptyBlock, ErrorBlock } from '../../ui/states';

export interface PositionBonusRule { id: string; title: string; titleKey: string; targetWorkingDays: number; bonusAmount: number; currency: string; active: boolean; version: number }
export interface PositionBonusRow { requestId: string; reference: string; title: string; recruiterCode: string | null; status: string; requestDate: string | null; requirementsSubmittedDate: string | null; confirmedDate: string | null; openDate: string | null; closedDate: string | null; hiringDurationWorkingDays: number | null; rule: PositionBonusRule | null; outcome: 'no_rule' | 'awaiting_confirmation' | 'open' | 'date_review' | 'late_pending_policy' | 'earned' | 'closed_no_hire'; amount: number | null; currency: string | null }
interface Data { rules: PositionBonusRule[]; rows: PositionBonusRow[]; canEdit: boolean; confirmerUserId: string | null; approvers: { id: string; name: string }[]; summary: { open: number; closed: number; averageWorkingDays: number | null; earnedByCurrency: Record<string, number>; pending: number; missingRules: number } }

const statusTone = { earned: 'success', late_pending_policy: 'warning', open: 'info', awaiting_confirmation: 'neutral', no_rule: 'neutral', date_review: 'critical', closed_no_hire: 'neutral' } as const;

export function PositionBonuses() {
  const { t, lang } = useHRText();
  const { push } = useToast();
  const { data, error, loading, reload } = useHRQuery<Data>(hrApi.recruitment.positionBonuses);
  const [editing, setEditing] = useState<PositionBonusRule | 'new' | null>(null);
  const [title, setTitle] = useState('');
  const [days, setDays] = useState('');
  const [amount, setAmount] = useState('');
  const [currency, setCurrency] = useState('EGP');
  const [saving, setSaving] = useState(false);
  const [confirmerUserId, setConfirmerUserId] = useState('');
  const [savingConfirmer, setSavingConfirmer] = useState(false);
  const [filter, setFilter] = useState<'all' | 'open' | 'earned' | 'late_pending_policy'>('all');
  useEffect(() => { setConfirmerUserId(data?.confirmerUserId || ''); }, [data?.confirmerUserId]);
  const start = (rule: PositionBonusRule | 'new') => {
    setEditing(rule);
    setTitle(rule === 'new' ? '' : rule.title);
    setDays(rule === 'new' ? '' : String(rule.targetWorkingDays));
    setAmount(rule === 'new' ? '' : String(rule.bonusAmount));
    setCurrency(rule === 'new' ? 'EGP' : rule.currency);
  };
  const save = async () => {
    setSaving(true);
    try {
      await hrMutate('post', `${hrApi.recruitment.positionBonuses}/rules`, { title, targetWorkingDays: Number(days), bonusAmount: Number(amount), currency });
      push(t('اتحفظت قاعدة الـBonus بإصدار جديد.', 'Position bonus rule saved as a new version.'));
      setEditing(null);
      void reload();
    } catch (failure) { push(errorMessage(failure, lang), 'bad'); }
    finally { setSaving(false); }
  };
  const saveConfirmer = async () => {
    if (!confirmerUserId) return;
    setSavingConfirmer(true);
    try {
      await hrMutate('put', `${hrApi.recruitment.positionBonuses}/confirmer`, { confirmerUserId });
      push(t('اتحدد مسؤول الاعتماد النهائي. العداد يبدأ فقط عند اعتماده.', 'Final confirmer saved. The clock starts only after their approval.'));
      void reload();
    } catch (failure) { push(errorMessage(failure, lang), 'bad'); }
    finally { setSavingConfirmer(false); }
  };

  if (error && !data) return <ErrorBlock error={error} onRetry={reload} />;
  if (loading && !data) return <Card><div className="skeleton h-52 rounded-2xl" /></Card>;
  if (!data) return null;
  const shown = data.rows.filter((row) => filter === 'all' || row.outcome === filter);
  const label = (outcome: PositionBonusRow['outcome']) => ({
    earned: t('مستحق كامل', 'Full bonus earned'),
    late_pending_policy: t('متأخر · بانتظار سياسة طه', 'Late · policy pending'),
    open: t('التوظيف جارٍ', 'Hiring in progress'),
    awaiting_confirmation: t('بانتظار الاعتماد', 'Awaiting confirmation'),
    no_rule: t('بدون قاعدة Bonus', 'No bonus rule'),
    date_review: t('راجع التواريخ', 'Review dates'),
    closed_no_hire: t('أُغلقت بلا تعيين · لا Bonus', 'Closed without hire · no bonus'),
  })[outcome];
  return <section id="position-bonuses" className="space-y-4 scroll-mt-28">
    <SectionTitle title={t('Bonus حسب الوظيفة ومدة التعيين', 'Position and duration bonuses')} hint={t('المدة من اعتماد الطلب حتى إغلاق الوظيفة، بأيام العمل. الاستحقاق داخل المدة كامل؛ حالات التأخير معلّقة لحين اعتماد السياسة.', 'Duration runs from final approval to closure in working days. On-time vacancies earn the full amount; late cases await an approved policy.')} action={data.canEdit ? <button type="button" className="btn-primary btn-sm" onClick={() => start('new')}><Plus size={15} />{t('قاعدة جديدة', 'New rule')}</button> : undefined} />
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      {[
        [t('وظائف مفتوحة', 'Open vacancies'), num(data.summary.open, lang)],
        [t('وظائف أُغلقت', 'Closed vacancies'), num(data.summary.closed, lang)],
        [t('متوسط مدة التعيين', 'Average hiring time'), data.summary.averageWorkingDays === null ? '—' : `${num(data.summary.averageWorkingDays, lang)} ${t('يوم عمل', 'working days')}`],
        [t('حالات متأخرة معلّقة', 'Late cases pending'), num(data.summary.pending, lang)],
      ].map(([key, value]) => <Card key={key} className="!p-4"><span className="text-xs font-semibold text-slate-500">{key}</span><strong className="mt-2 block text-xl text-navy">{value}</strong></Card>)}
    </div>
    <Card className="!p-4"><div className="flex flex-wrap items-end justify-between gap-3"><div><h3 className="font-bold text-navy">{t('مسؤول الاعتماد النهائي', 'Final vacancy confirmer')}</h3><p className="mt-1 text-xs text-slate-600">{t('بعد استكمال المتطلبات، يبدأ عداد التعيين يوم اعتماد الشخص المحدد هنا.', 'After requirements are submitted, hiring time starts on this person’s approval date.')}</p></div>{data.canEdit ? <div className="flex flex-wrap items-center gap-2"><select className="field min-w-48" aria-label={t('مسؤول الاعتماد النهائي', 'Final confirmer')} value={confirmerUserId} onChange={(event) => setConfirmerUserId(event.target.value)}><option value="">{t('اختر المسؤول', 'Choose a confirmer')}</option>{data.approvers.map((person) => <option key={person.id} value={person.id}>{person.name}</option>)}</select><button type="button" className="btn-primary btn-sm" disabled={!confirmerUserId || confirmerUserId === data.confirmerUserId || savingConfirmer} onClick={() => void saveConfirmer()}>{savingConfirmer ? <Spinner size={16} /> : null}{t('حفظ', 'Save')}</button></div> : <strong className="text-sm text-navy">{data.approvers.find((person) => person.id === data.confirmerUserId)?.name || t('يحدده مسؤول الإعدادات', 'Set by HR settings')}</strong>}</div>{!data.confirmerUserId && <p className="mt-2 text-xs font-semibold text-amber-700">{t('لم يُحدد باشمهندس طه بعد؛ صلاحية الاعتماد الحالية ما زالت حسب الدور إلى أن يتم تحديد حسابه.', 'Eng. Taha has not been assigned yet; approval remains role based until his account is selected.')}</p>}</Card>
    {Object.keys(data.summary.earnedByCurrency).length > 0 && <Card className="!p-4 flex items-center gap-3 border-emerald-200 bg-emerald-50/60"><Gift size={20} className="text-emerald-700" /><p className="font-semibold text-emerald-900">{t('مكافآت مستحقة كاملة حسب القواعد:', 'Full bonuses earned under the rules:')} <b>{Object.entries(data.summary.earnedByCurrency).map(([code, value]) => money(value, lang, code)).join(' · ')}</b></p></Card>}
    <Card><div className="mb-4 flex flex-wrap items-center justify-between gap-2"><h3 className="font-bold text-navy">{t('جدول الـPositions', 'Position rules')}</h3><span className="text-xs text-slate-500">{t('كل تعديل يصدر نسخة جديدة؛ الوظائف المعتمدة تحتفظ بقاعدتها.', 'Edits create a new version; confirmed vacancies keep their rule.')}</span></div>{data.rules.length ? <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">{data.rules.map((rule) => <div key={rule.id} className="rounded-2xl border border-slate-200 p-3.5"><div className="flex items-start gap-2"><div className="min-w-0 flex-1"><p className="font-bold text-navy">{rule.title}</p><p className="mt-1 text-xs text-slate-500">v{rule.version} · {num(rule.targetWorkingDays, lang)} {t('يوم عمل', 'working days')}</p></div>{data.canEdit && <button type="button" className="text-xs font-bold text-brand-700 hover:underline" onClick={() => start(rule)}>{t('تعديل', 'Edit')}</button>}</div><p className="mt-2 text-lg font-bold text-emerald-700">{money(rule.bonusAmount, lang, rule.currency)}</p></div>)}</div> : <EmptyBlock icon={<CalendarClock size={23} />} title={t('لسه مفيش قواعد حسب المسمى', 'No position rules yet')} body={t('أضف المدة والمبلغ لكل Position قبل احتساب أي Bonus.', 'Add a duration and amount for each position before any bonus is calculated.')} />}</Card>
    <Card className="!p-0 overflow-hidden"><div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 p-4"><h3 className="font-bold text-navy">{t('الوظائف والاستحقاق', 'Vacancies and entitlement')}</h3><div className="flex flex-wrap gap-1">{(['all', 'open', 'earned', 'late_pending_policy'] as const).map((key) => <button key={key} type="button" aria-pressed={filter === key} className={`rounded-full px-3 py-1.5 text-xs font-bold ${filter === key ? 'bg-navy text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`} onClick={() => setFilter(key)}>{key === 'all' ? t('الكل', 'All') : label(key)}</button>)}</div></div>{shown.length ? <div className="divide-y divide-slate-100">{shown.map((row) => <div key={row.requestId} className="flex flex-wrap items-center gap-3 p-4"><div className="min-w-48 flex-1"><Link to={`/hr/recruitment/requests/${encodeURIComponent(row.requestId)}`} className="font-bold text-navy hover:text-brand-700">{row.title}</Link><p className="mt-0.5 text-[11px] text-slate-500">{row.reference} · {t('اعتماد', 'Confirmed')} {date(row.confirmedDate, lang)} → {t('إغلاق', 'Closed')} {date(row.closedDate, lang)}</p></div><div className="text-xs text-slate-600">{row.rule ? <><b className="text-navy">{row.hiringDurationWorkingDays === null ? '—' : num(row.hiringDurationWorkingDays, lang)}</b> / {num(row.rule.targetWorkingDays, lang)} {t('يوم عمل', 'working days')}</> : '—'}</div><Badge tone={statusTone[row.outcome]}>{label(row.outcome)}</Badge>{row.amount !== null && <strong className="text-emerald-700">{money(row.amount, lang, row.currency || 'EGP')}</strong>}</div>)}</div> : <div className="p-6"><EmptyBlock title={t('لا توجد وظائف في هذا العرض', 'No vacancies in this view')} /></div>}</Card>
    <Card className="!p-4 flex items-start gap-3 border-amber-200 bg-amber-50/60"><ShieldAlert size={18} className="mt-0.5 shrink-0 text-amber-800" /><p className="text-xs leading-6 text-amber-900">{t('سياسة الوظائف المتأخرة لم تُحدَّد بعد مع باشمهندس طه؛ لذلك يظهر الاستحقاق معلّقًا ولا يُنشأ مبلغ تلقائي لها.', 'The late-hiring policy has not yet been agreed with Eng. Taha; late vacancies remain pending with no automatic amount.')}</p></Card>
    {editing && <Modal open onClose={() => setEditing(null)} title={editing === 'new' ? t('قاعدة Bonus جديدة', 'New position bonus rule') : t('تعديل قاعدة الـBonus', 'Edit position bonus rule')} footer={<><button type="button" className="btn-ghost" onClick={() => setEditing(null)}>{t('إلغاء', 'Cancel')}</button><button type="button" className="btn-primary" disabled={saving || !title.trim() || !Number.isInteger(Number(days)) || Number(days) < 1 || !amount.trim() || Number(amount) < 0} onClick={() => void save()}>{saving ? <Spinner size={16} /> : null}{t('حفظ الإصدار', 'Save version')}</button></>}><div className="grid gap-4"><label className="block"><span className="label">Position / Job Title</span><input className="field mt-1" value={title} maxLength={140} onChange={(event) => setTitle(event.target.value)} /></label><label className="block"><span className="label">{t('المدة المستهدفة (أيام عمل)', 'Target duration (working days)')}</span><input className="field mt-1" type="number" min={1} max={365} value={days} onChange={(event) => setDays(event.target.value)} /></label><div className="grid grid-cols-[1fr_7rem] gap-3"><label className="block"><span className="label">Bonus</span><input className="field mt-1" type="number" min={0} step="0.01" value={amount} onChange={(event) => setAmount(event.target.value)} /></label><label className="block"><span className="label">{t('العملة', 'Currency')}</span><select className="field mt-1" value={currency} onChange={(event) => setCurrency(event.target.value)}>{['EGP', 'SAR', 'USD'].map((code) => <option key={code}>{code}</option>)}</select></label></div></div></Modal>}
  </section>;
}
