/**
 * The KPI desk.
 *
 * Two audiences share one screen because they share one question — "did this
 * month reach its target" — and the workbooks they came from only differ in
 * how a target is weighted. The catalogue rail offers the five approved cards;
 * the list below is every month already filed; the editor is the workbook,
 * without the formulas anyone could overwrite.
 */
import { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  BadgeCheck,
  ChevronDown,
  ChevronRight,
  ClipboardCheck,
  Gauge,
  Lock,
  LockOpen,
  Plus,
  RefreshCw,
  Target,
  Trash2,
  TrendingDown,
  TrendingUp,

} from 'lucide-react';
import { api, errorMessage } from '../../lib/api';
import { cx } from '../../lib/utils';
import { Avatar, EmptyState, Field, Modal, Spinner, useToast } from '../ui';
import {
  KPI_CHECK_LABELS,
  KPI_CHECK_ORDER,
  currentPeriod,
  formatPercent,
  formatPeriod,
  formatScore,
  type KPIAudience,
  type KPIOverview,
  type KPIScoredGroup,
  type KPIScorecard,
  type KPITemplate,
  type KPITemplateSummary,
} from '../../lib/kpi';

type Subject = { id: string; name: string; type: 'employee' | 'user' };

export function KPIScorecards({
  lang,
  subjects,
  canManage,
}: {
  lang: 'ar' | 'en';
  subjects: Subject[];
  canManage: boolean;
}) {
  const l = (ar: string, en: string) => (lang === 'en' ? en : ar);
  const { push } = useToast();
  const [overview, setOverview] = useState<KPIOverview | null>(null);
  const [templates, setTemplates] = useState<KPITemplate[]>([]);
  const [error, setError] = useState('');
  const [audience, setAudience] = useState<KPIAudience | 'all'>('all');
  const [period, setPeriod] = useState('all');
  const [creating, setCreating] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);

  const load = async () => {
    setError('');
    try {
      const [next, catalogue] = await Promise.all([
        api.get<KPIOverview>('/kpi/overview'),
        api.get<{ templates: KPITemplate[] }>('/kpi/catalogue'),
      ]);
      setOverview(next);
      setTemplates(catalogue.templates);
    } catch (requestError) {
      setError(errorMessage(requestError, lang));
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const scorecards = useMemo(() => {
    if (!overview) return [];
    return overview.scorecards.filter(
      (card) =>
        (audience === 'all' || card.audience === audience)
        && (period === 'all' || card.period === period)
    );
  }, [overview, audience, period]);

  if (!overview && !error) {
    return (
      <div className="grid gap-4">
        <div className="skeleton h-28 rounded-2xl" />
        <div className="skeleton h-64 rounded-2xl" />
      </div>
    );
  }

  if (!overview) {
    return (
      <EmptyState
        icon={<AlertTriangle size={26} />}
        title={l('مقدرناش نفتح البطاقات', 'Could not open the scorecards')}
        body={error}
        action={<button className="btn-primary" onClick={() => void load()}>{l('إعادة المحاولة', 'Try again')}</button>}
      />
    );
  }

  const graded = scorecards.filter((card) => card.result.approved.percent !== null);
  const average = graded.length
    ? graded.reduce((sum, card) => sum + (card.result.approved.percent ?? 0), 0) / graded.length
    : null;
  const finalised = scorecards.filter((card) => card.status === 'final').length;
  const visibleTemplates = overview.templates.filter(
    (template) => audience === 'all' || template.audience === audience
  );

  return (
    <div className="space-y-5">
      <section className="overflow-hidden rounded-2xl border border-surface-line bg-surface-card shadow-card">
        <div className="grid gap-5 p-5 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center">
          <div className="min-w-0">
            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
              <span className="text-4xl font-black tabular-nums text-navy">{formatPercent(average)}</span>
              <span className="text-[13px] font-bold text-ink-muted">{l('متوسط الدرجة المعتمدة', 'Average approved score')}</span>
            </div>
            <RatingBar scorecards={scorecards} lang={lang} />
          </div>
          <div className="grid grid-cols-3 gap-2 lg:w-72">
            <StatPill label={l('بطاقة', 'Cards')} value={String(scorecards.length)} />
            <StatPill label={l('معتمدة', 'Final')} value={String(finalised)} tone={finalised ? 'brand' : undefined} />
            <StatPill label={l('مسودة', 'Draft')} value={String(scorecards.length - finalised)} />
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2 border-t border-surface-line bg-surface-sunken/50 px-5 py-3">
          <div className="flex gap-1 rounded-xl bg-white p-1 shadow-sm">
            {([
              ['all', 'الكل', 'All'],
              ['manager', 'المديرون', 'Managers'],
              ['employee', 'الموظفون', 'Employees'],
            ] as const).map(([id, ar, en]) => (
              <button
                key={id}
                type="button"
                onClick={() => setAudience(id)}
                className={cx(
                  'rounded-lg px-3 py-1.5 text-xs font-bold transition-colors',
                  audience === id ? 'bg-brand-500 text-white shadow-sm' : 'text-ink-muted hover:text-ink'
                )}
              >
                {l(ar, en)}
              </button>
            ))}
          </div>
          <select
            className="field h-9 w-auto min-w-[9.5rem] py-0 text-[13px]"
            value={period}
            onChange={(event) => setPeriod(event.target.value)}
          >
            <option value="all">{l('كل الشهور', 'All months')}</option>
            {overview.periods.map((item) => (
              <option key={item} value={item}>{formatPeriod(item, lang)}</option>
            ))}
          </select>
          <button className="btn-ghost btn-sm ms-auto" onClick={() => void load()} aria-label={l('تحديث', 'Refresh')}>
            <RefreshCw size={15} />
          </button>
          {canManage && (
            <button className="btn-primary btn-sm" onClick={() => setCreating('')}>
              <Plus size={15} /> {l('بطاقة جديدة', 'New scorecard')}
            </button>
          )}
        </div>
      </section>

      <section>
        <h2 className="mb-2 px-1 text-[13px] font-extrabold text-ink-muted">
          {l('البطاقات المعتمدة', 'Approved templates')}
        </h2>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {visibleTemplates.map((template) => (
            <TemplateCard
              key={template.id}
              template={template}
              lang={lang}
              count={overview.scorecards.filter((card) => card.templateId === template.id).length}
              onStart={canManage ? () => setCreating(template.id) : null}
            />
          ))}
        </div>
      </section>

      <section className="card overflow-hidden">
        <div className="flex items-center justify-between border-b border-surface-line px-5 py-4">
          <div>
            <h2 className="font-extrabold">{l('البطاقات', 'Scorecards')}</h2>
            <p className="mt-0.5 text-xs text-ink-faint">
              {l('الدرجة بتتحسب من الأرقام اللي اتسجلت، وبتتحدث لحظة ما تغيّر رقم.', 'The score follows the numbers you record, and updates the moment you change one.')}
            </p>
          </div>
        </div>
        {scorecards.length ? (
          <div className="divide-y divide-surface-line">
            {scorecards.map((card) => (
              <ScorecardRow key={card.id} card={card} lang={lang} onOpen={() => setOpenId(card.id)} />
            ))}
          </div>
        ) : (
          <EmptyState
            icon={<Gauge size={26} />}
            title={l('مفيش بطاقات لسه', 'No scorecards yet')}
            body={l('اختار بطاقة من فوق وابدأ بيها شهر جديد.', 'Pick a template above and start a month with it.')}
          />
        )}
      </section>

      {creating !== null && (
        <NewScorecard
          lang={lang}
          initialTemplateId={creating}
          templates={overview.templates}
          subjects={subjects}
          onClose={() => setCreating(null)}
          onCreated={async (id) => {
            setCreating(null);
            await load();
            setOpenId(id);
          }}
          onError={(message) => push(message, 'bad')}
        />
      )}

      {openId && (
        <ScorecardEditor
          id={openId}
          lang={lang}
          canManage={overview.permissions.canManage}
          template={templates.find((item) => item.id === overview.scorecards.find((card) => card.id === openId)?.templateId) ?? null}
          onClose={() => setOpenId(null)}
          onChanged={load}
        />
      )}
    </div>
  );
}

function StatPill({ label, value, tone }: { label: string; value: string; tone?: 'brand' }) {
  return (
    <div className={cx(
      'rounded-xl border px-3 py-2 text-center',
      tone === 'brand' ? 'border-brand-200 bg-brand-50' : 'border-surface-line bg-surface-sunken'
    )}>
      <div className="text-lg font-black tabular-nums leading-tight text-navy">{value}</div>
      <div className="text-[10px] font-semibold text-ink-faint">{label}</div>
    </div>
  );
}

/**
 * How the filed months are distributed across the five bands.
 *
 * An average alone hides the shape: four excellent cards and one failing one
 * average to "very good", which is the one reading a manager must not be left
 * with. Unmeasured cards get their own neutral segment rather than being
 * dropped, so the bar always accounts for every card in the list.
 */
function RatingBar({ scorecards, lang }: { scorecards: KPIScorecard[]; lang: 'ar' | 'en' }) {
  const l = (ar: string, en: string) => (lang === 'en' ? en : ar);
  if (!scorecards.length) return null;

  const bands = new Map<string, { count: number; color: string; label: string }>();
  let unmeasured = 0;
  for (const card of scorecards) {
    const rating = card.result.approved.rating;
    if (!rating) {
      unmeasured += 1;
      continue;
    }
    const current = bands.get(rating.id);
    if (current) current.count += 1;
    else bands.set(rating.id, { count: 1, color: rating.color, label: lang === 'en' ? rating.en : rating.ar });
  }

  const segments = [
    ...bands.values(),
    ...(unmeasured ? [{ count: unmeasured, color: '#CBD5E1', label: l('من غير درجة', 'Not scored') }] : []),
  ];

  return (
    <div className="mt-3">
      <div className="flex h-2 gap-0.5 overflow-hidden rounded-full">
        {segments.map((segment) => (
          <div
            key={segment.label}
            className="h-full first:rounded-s-full last:rounded-e-full"
            style={{ width: `${(segment.count / scorecards.length) * 100}%`, backgroundColor: segment.color }}
            title={`${segment.label}: ${segment.count}`}
          />
        ))}
      </div>
      <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1">
        {segments.map((segment) => (
          <span key={segment.label} className="flex items-center gap-1.5 text-[11px] font-semibold text-ink-muted">
            <span className="h-2 w-2 rounded-full" style={{ backgroundColor: segment.color }} />
            {segment.label} <b className="tabular-nums text-ink">{segment.count}</b>
          </span>
        ))}
      </div>
    </div>
  );
}

function TemplateCard({
  template,
  lang,
  count,
  onStart,
}: {
  template: KPITemplateSummary;
  lang: 'ar' | 'en';
  count: number;
  onStart: (() => void) | null;
}) {
  const l = (ar: string, en: string) => (lang === 'en' ? en : ar);
  const manager = template.audience === 'manager';
  const accent = manager ? '#0B2545' : '#1D6FB8';

  return (
    <article className="card group relative flex flex-col overflow-hidden p-4 transition-shadow hover:shadow-lift">
      <span className="absolute inset-x-0 top-0 h-1" style={{ backgroundColor: accent }} aria-hidden="true" />
      <div className="flex items-start justify-between gap-2">
        <span
          className="chip"
          style={{ backgroundColor: `${accent}14`, color: accent }}
        >
          {manager ? l('مدير', 'Manager') : l('موظف', 'Employee')}
        </span>
        <span className="chip bg-surface-sunken text-ink-muted" title={l('عدد البطاقات', 'Scorecards filed')}>
          {count}
        </span>
      </div>
      <h3 className="mt-2 font-extrabold leading-snug">{l(template.ar, template.en)}</h3>
      <p className="mt-1.5 line-clamp-3 text-[12px] leading-6 text-ink-muted">{l(template.descAr, template.descEn)}</p>

      <div className="mt-3 flex flex-wrap gap-1.5 text-[11px] font-semibold text-ink-faint">
        <span className="rounded-lg bg-surface-sunken px-2 py-1">{template.groups} {l('محاور', 'axes')}</span>
        <span className="rounded-lg bg-surface-sunken px-2 py-1">{template.kpis} {l('مؤشر', 'KPIs')}</span>
        {template.checks > 0 && (
          <span className="rounded-lg bg-surface-sunken px-2 py-1">{template.checks} {l('بند مراجعة', 'review items')}</span>
        )}
        {template.checklistMode === 'multiplier' && (
          <span className="rounded-lg bg-accent-50 px-2 py-1 text-accent-600">
            {l('المراجعة بتأثر على الدرجة', 'Review affects the score')}
          </span>
        )}
      </div>

      {onStart && (
        <button
          type="button"
          onClick={onStart}
          className="btn-ghost btn-sm mt-3.5 w-full opacity-0 transition-opacity focus-visible:opacity-100 group-hover:opacity-100"
        >
          <Plus size={14} /> {l('ابدأ شهر بالبطاقة دي', 'Start a month')}
        </button>
      )}
    </article>
  );
}

function RatingChip({ card, lang }: { card: KPIScorecard; lang: 'ar' | 'en' }) {
  const rating = card.result.approved.rating;
  if (!rating) {
    return <span className="chip bg-surface-sunken text-ink-muted">{lang === 'en' ? 'Not scored' : 'من غير درجة'}</span>;
  }
  return (
    <span className="chip" style={{ backgroundColor: `${rating.color}1A`, color: rating.color }}>
      {lang === 'en' ? rating.en : rating.ar}
    </span>
  );
}

function ScorecardRow({ card, lang, onOpen }: { card: KPIScorecard; lang: 'ar' | 'en'; onOpen: () => void }) {
  const l = (ar: string, en: string) => (lang === 'en' ? en : ar);
  const percent = card.result.approved.percent;
  const rating = card.result.approved.rating;
  const { measured, kpis } = card.result.completeness;

  return (
    <button
      type="button"
      onClick={onOpen}
      className="flex w-full flex-col gap-3 p-4 text-start transition-colors hover:bg-brand-50/40 sm:flex-row sm:items-center sm:gap-4"
    >
      <Avatar name={card.subjectName} size={38} color={rating?.color ?? '#94A3B8'} />

      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-bold">{card.subjectName}</span>
          <RatingChip card={card} lang={lang} />
          {card.status === 'final' ? (
            <span className="chip bg-status-okBg text-status-ok"><Lock size={11} /> {l('معتمدة', 'Final')}</span>
          ) : (
            <span className="chip bg-surface-sunken text-ink-muted">{l('مسودة', 'Draft')}</span>
          )}
        </div>
        <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-ink-faint">
          <span className="font-semibold text-ink-muted">{l(card.templateAr, card.templateEn)}</span>
          <span aria-hidden="true">·</span>
          <span>{formatPeriod(card.period, lang)}</span>
          <span aria-hidden="true">·</span>
          <span className={cx(measured < kpis && 'text-accent-600')}>
            {measured}/{kpis} {l('مؤشر متسجّل', 'KPIs recorded')}
          </span>
        </div>
      </div>

      <div className="flex items-center gap-3 sm:w-56">
        <div className="h-2 flex-1 overflow-hidden rounded-full bg-surface-sunken">
          <div
            className="h-full rounded-full transition-all duration-500"
            style={{
              width: `${Math.min(100, Math.max(0, percent ?? 0))}%`,
              backgroundColor: rating?.color ?? '#CBD5E1',
            }}
          />
        </div>
        <span className="w-12 text-end text-lg font-black tabular-nums text-navy">{formatPercent(percent)}</span>
        {/* One glyph, mirrored in RTL, so "open this" always points forward. */}
        <ChevronRight size={16} className="shrink-0 text-ink-faint rtl:-scale-x-100" />
      </div>
    </button>
  );
}

function NewScorecard({
  lang,
  templates,
  subjects,
  initialTemplateId,
  onClose,
  onCreated,
  onError,
}: {
  lang: 'ar' | 'en';
  templates: KPITemplateSummary[];
  subjects: Subject[];
  initialTemplateId: string;
  onClose: () => void;
  onCreated: (id: string) => void | Promise<void>;
  onError: (message: string) => void;
}) {
  const l = (ar: string, en: string) => (lang === 'en' ? en : ar);
  const [templateId, setTemplateId] = useState(initialTemplateId || templates[0]?.id || '');
  // `record:` is the escape hatch the workbooks themselves need — they grade
  // people who have no workspace account yet.
  const [subjectKey, setSubjectKey] = useState(subjects[0] ? `${subjects[0].type}:${subjects[0].id}` : 'record:');
  const [typedName, setTypedName] = useState('');
  const [period, setPeriod] = useState(currentPeriod());
  const [saving, setSaving] = useState(false);
  const byName = subjectKey === 'record:';

  const submit = async () => {
    const [subjectType, ...rest] = subjectKey.split(':');
    const subjectId = byName ? typedName.trim() : rest.join(':');
    if (!templateId || !subjectId) return;
    setSaving(true);
    try {
      const { scorecard } = await api.post<{ scorecard: KPIScorecard }>('/kpi/scorecards', {
        templateId,
        period,
        subjectType,
        subjectId,
        subjectName: byName ? typedName.trim() : undefined,
      });
      await onCreated(scorecard.id);
    } catch (requestError) {
      onError(errorMessage(requestError, lang));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      title={l('بطاقة أداء جديدة', 'New scorecard')}
      footer={
        <>
          <button className="btn-ghost" onClick={onClose}>{l('إلغاء', 'Cancel')}</button>
          <button
            className="btn-primary"
            onClick={() => void submit()}
            disabled={saving || (byName ? !typedName.trim() : !subjectKey)}
          >
            {saving ? <Spinner size={16} /> : <Plus size={16} />} {l('إنشاء', 'Create')}
          </button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label={l('البطاقة', 'Template')}>
          <select className="field" value={templateId} onChange={(event) => setTemplateId(event.target.value)}>
            {templates.map((template) => (
              <option key={template.id} value={template.id}>
                {l(template.ar, template.en)} — {template.audience === 'manager' ? l('مدير', 'Manager') : l('موظف', 'Employee')}
              </option>
            ))}
          </select>
        </Field>
        <Field label={l('الشخص', 'Subject')}>
          <select className="field" value={subjectKey} onChange={(event) => setSubjectKey(event.target.value)}>
            {subjects.map((subject) => (
              <option key={`${subject.type}:${subject.id}`} value={`${subject.type}:${subject.id}`}>
                {subject.name}
              </option>
            ))}
            <option value="record:">{l('— اسم يدوي (بدون حساب) —', '— Type a name (no account) —')}</option>
          </select>
        </Field>
        {byName && (
          <Field
            label={l('الاسم', 'Name')}
            hint={l('لحد لسه معندوش حساب على النظام.', 'For somebody who has no workspace account yet.')}
          >
            <input
              className="field"
              value={typedName}
              onChange={(event) => setTypedName(event.target.value)}
              placeholder={l('مثال: شاهندة سمير', 'e.g. Shahenda Samir')}
            />
          </Field>
        )}
        <Field label={l('الشهر', 'Month')}>
          <input className="field ltr" type="month" value={period} onChange={(event) => setPeriod(event.target.value)} />
        </Field>
      </div>
    </Modal>
  );
}

function ScorecardEditor({
  id,
  lang,
  canManage,
  template,
  onClose,
  onChanged,
}: {
  id: string;
  lang: 'ar' | 'en';
  canManage: boolean;
  template: KPITemplate | null;
  onClose: () => void;
  onChanged: () => void | Promise<void>;
}) {
  const l = (ar: string, en: string) => (lang === 'en' ? en : ar);
  const { push } = useToast();
  const [card, setCard] = useState<KPIScorecard | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [openGroup, setOpenGroup] = useState<string | null>(null);

  const load = async () => {
    try {
      const { scorecard } = await api.get<{ scorecard: KPIScorecard }>(`/kpi/scorecards/${id}`);
      setCard(scorecard);
      setOpenGroup((current) => current ?? scorecard.result.groups[0]?.id ?? null);
    } catch (requestError) {
      setError(errorMessage(requestError, lang));
    }
  };

  useEffect(() => {
    void load();
  }, [id]);

  /**
   * Every edit is a round trip. The score is the server's answer, not the
   * browser's guess, so a rule the client does not know about can never leave
   * a different number on screen than the one in the record.
   */
  const patch = async (body: Record<string, unknown>) => {
    if (!card || card.status === 'final') return;
    setBusy(true);
    try {
      const { scorecard } = await api.patch<{ scorecard: KPIScorecard }>(`/kpi/scorecards/${id}`, body);
      setCard(scorecard);
      await onChanged();
    } catch (requestError) {
      push(errorMessage(requestError, lang), 'bad');
    } finally {
      setBusy(false);
    }
  };

  const setStatus = async (status: 'draft' | 'final') => {
    setBusy(true);
    try {
      const { scorecard } = await api.post<{ scorecard: KPIScorecard }>(`/kpi/scorecards/${id}/status`, { status });
      setCard(scorecard);
      await onChanged();
      push(status === 'final' ? l('البطاقة اتعتمدت.', 'Scorecard finalised.') : l('البطاقة اتفتحت للتعديل.', 'Scorecard reopened.'));
    } catch (requestError) {
      push(errorMessage(requestError, lang), 'bad');
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    setBusy(true);
    try {
      await api.delete(`/kpi/scorecards/${id}`);
      await onChanged();
      onClose();
    } catch (requestError) {
      push(errorMessage(requestError, lang), 'bad');
    } finally {
      setBusy(false);
    }
  };

  const editable = canManage && card?.status === 'draft';
  const complete = card?.result.completeness.complete ?? false;

  return (
    <Modal
      open
      onClose={onClose}
      width="xl"
      title={card ? `${card.subjectName} · ${formatPeriod(card.period, lang)}` : l('بطاقة الأداء', 'Scorecard')}
      footer={
        card ? (
          <>
            {editable && (
              <button className="btn-danger" onClick={() => void remove()} disabled={busy}>
                <Trash2 size={16} /> {l('حذف', 'Delete')}
              </button>
            )}
            <button className="btn-ghost" onClick={onClose}>{l('إغلاق', 'Close')}</button>
            {canManage && (card.status === 'final' ? (
              <button className="btn-ghost" onClick={() => void setStatus('draft')} disabled={busy}>
                <LockOpen size={16} /> {l('إعادة فتح', 'Reopen')}
              </button>
            ) : (
              <button
                className="btn-primary"
                onClick={() => void setStatus('final')}
                disabled={busy || !complete}
                title={complete ? undefined : l('سجّل كل المؤشرات وبنود المراجعة الأول.', 'Record every KPI and review item first.')}
              >
                <BadgeCheck size={16} /> {l('اعتماد', 'Finalise')}
              </button>
            ))}
          </>
        ) : null
      }
    >
      {!card ? (
        error ? <EmptyState icon={<AlertTriangle size={24} />} title={l('مقدرناش نفتح البطاقة', 'Could not open')} body={error} /> : <div className="grid place-items-center py-12"><Spinner size={26} /></div>
      ) : (
        <div className="space-y-4">
          <ScoreHeader card={card} lang={lang} />

          {!complete && card.status === 'draft' && (
            <p className="flex items-start gap-2 rounded-xl bg-status-warnBg px-3 py-2.5 text-[12px] font-semibold leading-6 text-accent-600">
              <AlertTriangle size={15} className="mt-0.5 shrink-0" />
              {l(
                `المؤشر اللي من غير رقم مش بياخد صفر — بيتشال من الحساب. فاضل ${card.result.completeness.kpis - card.result.completeness.measured} مؤشر و${card.result.completeness.checks - card.result.completeness.answered} بند مراجعة عشان تعتمد الشهر.`,
                `A KPI with no number is left out, not scored zero. ${card.result.completeness.kpis - card.result.completeness.measured} KPIs and ${card.result.completeness.checks - card.result.completeness.answered} review items to go before you can finalise.`
              )}
            </p>
          )}

          {card.result.groups.map((group) => (
            <GroupPanel
              key={group.id}
              group={group}
              template={template}
              card={card}
              lang={lang}
              editable={editable}
              open={openGroup === group.id}
              onToggle={() => setOpenGroup(openGroup === group.id ? null : group.id)}
              onPatch={patch}
            />
          ))}

          <Field label={l('ملاحظات الإدارة', 'Management notes')}>
            <textarea
              className="field min-h-24"
              defaultValue={card.notes}
              disabled={!editable}
              onBlur={(event) => {
                if (event.target.value !== card.notes) void patch({ notes: event.target.value });
              }}
            />
          </Field>
        </div>
      )}
    </Modal>
  );
}

function ScoreHeader({ card, lang }: { card: KPIScorecard; lang: 'ar' | 'en' }) {
  const l = (ar: string, en: string) => (lang === 'en' ? en : ar);
  const { approved, performance, verification } = card.result;
  return (
    <section className="grid gap-3 rounded-2xl bg-[#0B2545] p-4 text-white sm:grid-cols-4">
      <div className="sm:col-span-2">
        <div className="text-[11px] font-semibold text-white/60">{l('الدرجة المعتمدة', 'Approved score')}</div>
        <div className="mt-1 flex items-end gap-2">
          <span className="text-4xl font-black tabular-nums">{formatPercent(approved.percent)}</span>
          {approved.rating && (
            <span className="mb-1 rounded-full px-2 py-0.5 text-[11px] font-bold" style={{ backgroundColor: `${approved.rating.color}33`, color: '#fff' }}>
              {lang === 'en' ? approved.rating.en : approved.rating.ar}
            </span>
          )}
        </div>
        <div className="mt-1 text-[11px] text-white/50">
          {formatScore(approved.score)} / {formatScore(approved.max)} {l('نقطة مقاسة', 'measured points')}
          {approved.max < approved.totalWeight && ` · ${l(`من أصل ${approved.totalWeight}`, `of ${approved.totalWeight} total`)}`}
        </div>
      </div>
      <div className="rounded-xl bg-white/[.07] px-3 py-2">
        <div className="text-[11px] font-semibold text-white/60">{l('الأداء قبل التحقق', 'Before verification')}</div>
        <div className="mt-1 text-xl font-black tabular-nums">{formatPercent(performance.percent)}</div>
      </div>
      <div className="rounded-xl bg-white/[.07] px-3 py-2">
        <div className="text-[11px] font-semibold text-white/60">{l('تحقق قائمة المراجعة', 'Verification')}</div>
        <div className="mt-1 text-xl font-black tabular-nums">
          {verification.ratio === null ? '—' : formatPercent(verification.ratio * 100)}
        </div>
        <div className="text-[10px] text-white/45">{verification.answered}/{verification.total} {l('بند', 'items')}</div>
      </div>
    </section>
  );
}

function GroupPanel({
  group,
  template,
  card,
  lang,
  editable,
  open,
  onToggle,
  onPatch,
}: {
  group: KPIScoredGroup;
  template: KPITemplate | null;
  card: KPIScorecard;
  lang: 'ar' | 'en';
  editable: boolean;
  open: boolean;
  onToggle: () => void;
  onPatch: (body: Record<string, unknown>) => Promise<void>;
}) {
  const l = (ar: string, en: string) => (lang === 'en' ? en : ar);
  const definition = template?.groups.find((item) => item.id === group.id) ?? null;
  const checklist = definition?.checklist ?? [];

  const setValue = (kpiId: string, key: 'actual' | 'target', raw: string) => {
    const existing = card.values?.[kpiId] ?? { actual: null, target: null, note: '' };
    const value = raw.trim() === '' ? null : Number(raw);
    if (value !== null && !Number.isFinite(value)) return;
    void onPatch({ values: { ...(card.values ?? {}), [kpiId]: { ...existing, [key]: value } } });
  };

  return (
    <section className={cx('overflow-hidden rounded-2xl border', group.gated ? 'border-status-bad/30' : 'border-surface-line')}>
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-center gap-3 bg-surface-sunken/60 px-4 py-3 text-start transition-colors hover:bg-surface-sunken"
      >
        <ChevronDown size={16} className={cx('shrink-0 text-ink-faint transition-transform', open && 'rotate-180')} />
        <div className="min-w-0 flex-1">
          <div className="truncate font-bold">{l(group.ar, group.en)}</div>
          <div className="mt-0.5 text-[11px] text-ink-faint">
            <span className={cx(group.measuredCount < group.kpiCount && 'text-accent-600')}>
              {group.measuredCount}/{group.kpiCount} {l('مؤشر', 'KPIs')}
            </span>
            {' · '}{l('الوزن', 'weight')} {group.weight}
            {group.minimumRatio !== null && ` · ${l('حد أدنى', 'floor')} ${Math.round(group.minimumRatio * 100)}%`}
          </div>
          {/* The meter reads against the axis weight, so a 20-point axis and a
              50-point one are comparable at a glance. */}
          <div className="mt-1.5 h-1.5 max-w-xs overflow-hidden rounded-full bg-white">
            <div
              className="h-full rounded-full transition-all duration-500"
              style={{
                width: `${Math.min(100, Math.max(0, ((group.score ?? 0) / group.weight) * 100))}%`,
                backgroundColor: group.gated ? '#DC2626' : '#1D6FB8',
              }}
            />
          </div>
        </div>
        {group.gated && (
          <span className="chip bg-status-badBg text-status-bad">
            <AlertTriangle size={11} /> {l('تحت الحد الأدنى', 'Below floor')}
          </span>
        )}
        <span className="shrink-0 text-lg font-black tabular-nums text-navy">
          {formatScore(group.score)}
          <span className="text-xs font-bold text-ink-faint">/{group.weight}</span>
        </span>
      </button>

      {open && (
        <div className="space-y-4 p-4">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[42rem] text-start text-sm">
              <thead className="text-[11px] font-bold text-ink-faint">
                <tr>
                  <th className="py-2 text-start">{l('المؤشر', 'Indicator')}</th>
                  <th className="w-24 py-2 text-start">{l('المستهدف', 'Target')}</th>
                  <th className="w-24 py-2 text-start">{l('الفعلي', 'Actual')}</th>
                  <th className="w-20 py-2 text-start">{l('التحقق', 'Achieved')}</th>
                  <th className="w-20 py-2 text-end">{l('الدرجة', 'Score')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-surface-line">
                {group.kpis.map((kpi) => {
                  const meta = definition?.kpis.find((item) => item.id === kpi.id);
                  return (
                    <tr key={kpi.id} className={cx(!kpi.measured && 'opacity-70')}>
                      <td className="py-2.5 pe-3">
                        <div className="flex items-center gap-1.5 font-semibold">
                          {kpi.direction === 'lower'
                            ? <TrendingDown size={13} className="shrink-0 text-brand-500" />
                            : <TrendingUp size={13} className="shrink-0 text-[#1D6FB8]" />}
                          <span>{kpi.ar}</span>
                        </div>
                        {meta?.formula && <div className="mt-0.5 text-[11px] leading-5 text-ink-faint">{meta.formula}</div>}
                        <div className="mt-0.5 text-[10px] text-ink-faint">
                          {l('الوزن', 'Weight')} {kpi.weight}{kpi.unit ? ` · ${kpi.unit}` : ''}
                          {meta?.bands && ` · ${l('شرائح متدرّجة', 'tiered bands')}`}
                        </div>
                      </td>
                      <td className="py-2.5 pe-2">
                        <input
                          className="field ltr h-9 px-2 text-[13px]"
                          type="number"
                          step="any"
                          disabled={!editable}
                          defaultValue={kpi.target ?? ''}
                          key={`t-${kpi.id}-${kpi.target}`}
                          onBlur={(event) => {
                            if (Number(event.target.value) !== kpi.target) setValue(kpi.id, 'target', event.target.value);
                          }}
                        />
                      </td>
                      <td className="py-2.5 pe-2">
                        <input
                          className="field ltr h-9 px-2 text-[13px]"
                          type="number"
                          step="any"
                          disabled={!editable}
                          defaultValue={kpi.actual ?? ''}
                          key={`a-${kpi.id}-${kpi.actual}`}
                          onBlur={(event) => {
                            if (event.target.value === '' ? kpi.actual !== null : Number(event.target.value) !== kpi.actual) {
                              setValue(kpi.id, 'actual', event.target.value);
                            }
                          }}
                        />
                      </td>
                      <td className="py-2.5 text-[13px] font-bold tabular-nums">
                        {kpi.ratio === null ? <span className="text-ink-faint">—</span> : formatPercent(kpi.ratio * 100)}
                        {kpi.rawRatio !== null && kpi.ratio !== null && Math.abs(kpi.rawRatio - kpi.ratio) > 0.001 && (
                          <span className="ms-1 text-[10px] font-semibold text-ink-faint">({formatPercent(kpi.rawRatio * 100)})</span>
                        )}
                      </td>
                      <td className="py-2.5 text-end text-[13px] font-black tabular-nums">{formatScore(kpi.score)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {definition?.incentiveBands && (
            <div className="rounded-xl border border-accent-200 bg-accent-50/50 p-3">
              <div className="flex flex-wrap items-end gap-3">
                <Field label={l('الحافز الشهري المستهدف (ج.م)', 'Monthly incentive target (EGP)')}>
                  <input
                    className="field ltr h-9 w-40 px-2"
                    type="number"
                    step="any"
                    min="0"
                    disabled={!editable}
                    defaultValue={card.incentives?.[group.id] ?? ''}
                    key={`i-${group.id}-${card.incentives?.[group.id] ?? ''}`}
                    onBlur={(event) =>
                      void onPatch({
                        incentives: { ...(card.incentives ?? {}), [group.id]: event.target.value === '' ? null : Number(event.target.value) },
                      })
                    }
                  />
                </Field>
                {group.incentive && (
                  <div className="flex gap-4 text-[12px]">
                    <span><span className="text-ink-faint">{l('الخصم', 'Deduction')}</span> <b className="tabular-nums text-rose-600">{group.incentive.deduction.toLocaleString('en-US')}</b></span>
                    <span><span className="text-ink-faint">{l('الصافي', 'Net')}</span> <b className="tabular-nums text-[#1D6FB8]">{group.incentive.net.toLocaleString('en-US')}</b></span>
                  </div>
                )}
              </div>
              <p className="mt-2 flex items-start gap-1.5 text-[11px] leading-5 text-ink-muted">
                <Target size={12} className="mt-0.5 shrink-0" />
                {l('الخصم: 90% فأكتر من غير خصم · من 90% لـ80% خصم 4,000 · من 80% لـ70% خصم 8,000 · أقل من 70% الحافز كله.', 'Deduction: 90%+ none · 90–80% 4,000 · 80–70% 8,000 · under 70% the whole incentive.')}
              </p>
            </div>
          )}

          {checklist.length > 0 && (
            <div>
              <div className="mb-2 flex items-center gap-2">
                <ClipboardCheck size={15} className="text-[#1D6FB8]" />
                <h4 className="text-[13px] font-extrabold">{l('قائمة التحقق', 'Verification checklist')}</h4>
                <span className="chip bg-surface-sunken text-ink-muted">
                  {group.checklist.ratio === null ? l('لسه ما اتراجعتش', 'Not reviewed yet') : formatPercent(group.checklist.ratio * 100)}
                </span>
                {group.checklist.notApplicable > 0 && (
                  <span className="text-[11px] text-ink-faint">
                    {group.checklist.notApplicable} {l('غير منطبق — بره الحساب', 'N/A — outside the average')}
                  </span>
                )}
              </div>
              <div className="space-y-1.5">
                {checklist.map((item) => (
                  <div key={item.id} className="flex flex-col gap-2 rounded-xl bg-surface-sunken/60 px-3 py-2 sm:flex-row sm:items-center">
                    <div className="min-w-0 flex-1">
                      <div className="text-[12px] font-semibold">{item.ar}</div>
                      {(item.evidence || item.method) && (
                        <div className="mt-0.5 text-[10px] text-ink-faint">{[item.method, item.evidence, item.sample].filter(Boolean).join(' · ')}</div>
                      )}
                    </div>
                    <div className="flex shrink-0 gap-1">
                      {KPI_CHECK_ORDER.map((state) => {
                        const active = card.checks?.[item.id] === state;
                        return (
                          <button
                            key={state}
                            type="button"
                            disabled={!editable}
                            onClick={() =>
                              void onPatch({ checks: { ...(card.checks ?? {}), [item.id]: active ? null : state } })
                            }
                            className={cx(
                              'rounded-lg px-2 py-1 text-[11px] font-bold transition-colors disabled:opacity-60',
                              active ? KPI_CHECK_LABELS[state].tone : 'bg-white text-ink-faint hover:text-ink'
                            )}
                          >
                            {lang === 'en' ? KPI_CHECK_LABELS[state].en : KPI_CHECK_LABELS[state].ar}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </section>
  );
}

export type { Subject as KPISubject };
