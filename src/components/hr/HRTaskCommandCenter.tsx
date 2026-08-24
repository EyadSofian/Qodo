import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ArrowUpLeft,
  CalendarDays,
  CheckCircle2,
  ClipboardCheck,
  Clock3,
  FileCheck2,
  Plus,
  Play,
  Search,
  Settings2,
  ShieldCheck,
  Sparkles,
  TriangleAlert,
  UserCheck,
  UsersRound,
  Zap,
} from 'lucide-react';
import {
  HR_PERIODIC_TASKS,
  HR_TASK_CATEGORIES,
  HR_TASK_FREQUENCIES,
  hrTaskCategory,
  hrTaskFrequency,
} from '@shared/hrPeriodicTasks';
import { hrAutomationSummary, hrScheduleForTemplate } from '@shared/hrRecurrence';
import { DEFAULT_DEPARTMENT, stageType } from '@shared/departments';
import { stateOf } from '../TaskWorkflow';
import { api, errorMessage } from '../../lib/api';
import { useI18n } from '../../lib/i18n';
import { useWorkspace } from '../../lib/workspace';
import { cx, formatDate } from '../../lib/utils';
import { Modal, Spinner, useToast } from '../ui';
import type { DirectoryUser, Task } from '../../lib/types';

export interface HRPeriodicTemplate {
  id: string;
  sourceNumber: number;
  category: string;
  title: string;
  frequency: string;
  dueRule: string;
  doneDefinition: string;
  owner: string;
  notes: string;
}

interface Props {
  tasks: Task[];
  canCreate: boolean;
  canManageAutomation: boolean;
  onCreate: (template: HRPeriodicTemplate) => void;
  onOpen: (task: Task) => void;
  onGenerated: () => Promise<unknown>;
}

interface HRAutomationPlan {
  templateId: string;
  enabled: boolean;
  assigneeIds: string[];
  configuredBy: string | null;
  enabledOn: string | null;
  schedule: { mode: 'scheduled' | 'event'; labelAr: string; labelEn: string };
  lastGeneratedAt: string | null;
  lastTaskId: string | null;
  lastOccurrenceKey: string | null;
}

interface HRAutomationResponse {
  plans: HRAutomationPlan[];
  summary: { scheduled: number; event: number; enabled: number; configured: number };
}

type PlanDraft = Record<string, { enabled: boolean; assigneeId: string }>;

const templates = HR_PERIODIC_TASKS as HRPeriodicTemplate[];

function localDay() {
  const now = new Date();
  const offset = now.getTimezoneOffset() * 60_000;
  return new Date(now.getTime() - offset).toISOString().slice(0, 10);
}

export function HRTaskCommandCenter({
  tasks,
  canCreate,
  canManageAutomation,
  onCreate,
  onOpen,
  onGenerated,
}: Props) {
  const { t, lang } = useI18n();
  const { directory } = useWorkspace();
  const { push } = useToast();
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('');
  const [frequency, setFrequency] = useState('');
  const [automation, setAutomation] = useState<HRAutomationResponse | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsCategory, setSettingsCategory] = useState('');
  const [draft, setDraft] = useState<PlanDraft>({});
  const [savingPlans, setSavingPlans] = useState(false);
  const [generating, setGenerating] = useState(false);
  const today = localDay();

  const loadAutomation = useCallback(() =>
    api.get<HRAutomationResponse>('/hr-operations/plans').then(setAutomation), []);

  useEffect(() => {
    loadAutomation().catch(() => setAutomation(null));
  }, [loadAutomation]);

  const plansByTemplate = useMemo(
    () => new Map((automation?.plans ?? []).map((plan) => [plan.templateId, plan])),
    [automation]
  );
  const automationCounts = automation?.summary ?? {
    ...hrAutomationSummary(templates),
    enabled: 0,
    configured: 0,
  };
  const hrPeople = useMemo(
    () => directory.filter((person) => person.department === 'hr'),
    [directory]
  );

  const openAutomationSettings = () => {
    const next: PlanDraft = {};
    for (const template of templates) {
      const plan = plansByTemplate.get(template.id);
      next[template.id] = {
        enabled: plan?.enabled ?? false,
        assigneeId: plan?.assigneeIds[0] ?? '',
      };
    }
    setDraft(next);
    setSettingsOpen(true);
  };

  const saveAutomation = async () => {
    const scheduled = templates.filter(
      (template) => hrScheduleForTemplate(template).mode === 'scheduled'
    );
    const missingOwner = scheduled.find(
      (template) => draft[template.id]?.enabled && !draft[template.id]?.assigneeId
    );
    if (missingOwner) return push(t('hrOps.ownerRequired'), 'bad');
    setSavingPlans(true);
    try {
      const result = await api.put<{ plans: HRAutomationPlan[] }>('/hr-operations/plans', {
        plans: scheduled.map((template) => ({
          templateId: template.id,
          enabled: draft[template.id]?.enabled ?? false,
          assigneeIds: draft[template.id]?.assigneeId ? [draft[template.id].assigneeId] : [],
        })),
      });
      setAutomation((current) => current
        ? {
            plans: result.plans,
            summary: {
              ...current.summary,
              enabled: result.plans.filter((plan) => plan.enabled).length,
              configured: result.plans.filter((plan) => plan.assigneeIds.length > 0).length,
            },
          }
        : null);
      setSettingsOpen(false);
      push(t('hrOps.automationSaved'));
    } catch (error) {
      push(errorMessage(error, lang), 'bad');
    } finally {
      setSavingPlans(false);
    }
  };

  const generateNow = async () => {
    setGenerating(true);
    try {
      const result = await api.post<{ created: Task[]; existing: string[] }>('/hr-operations/generate');
      await Promise.all([onGenerated(), loadAutomation()]);
      push(result.created.length
        ? t('hrOps.generatedCount', { n: result.created.length })
        : t('hrOps.nothingDue'));
    } catch (error) {
      push(errorMessage(error, lang), 'bad');
    } finally {
      setGenerating(false);
    }
  };

  const live = useMemo(
    () => tasks.filter((item) => stageType(item.department ?? DEFAULT_DEPARTMENT, item.stage) !== 'done'),
    [tasks]
  );
  const dueToday = live.filter((item) => item.dueDate === today).length;
  const overdue = live.filter((item) => item.dueDate && item.dueDate < today).length;
  const awaitingReview = live.filter((item) => stateOf(item) === 'submitted').length;
  const inProgress = live.filter(
    (item) => stageType(item.department ?? DEFAULT_DEPARTMENT, item.stage) === 'active'
  ).length;

  const nextTasks = useMemo(
    () =>
      [...live]
        .sort((a, b) => {
          if (a.dueDate && b.dueDate) return a.dueDate.localeCompare(b.dueDate);
          if (a.dueDate) return -1;
          if (b.dueDate) return 1;
          return (b.createdAt ?? '').localeCompare(a.createdAt ?? '');
        })
        .slice(0, 7),
    [live]
  );

  const filteredTemplates = useMemo(() => {
    const term = query.trim().toLowerCase();
    return templates.filter((item) => {
      if (category && item.category !== category) return false;
      if (frequency && item.frequency !== frequency) return false;
      if (!term) return true;
      return [item.title, item.owner, item.dueRule, item.doneDefinition]
        .join(' ')
        .toLowerCase()
        .includes(term);
    });
  }, [category, frequency, query]);

  const stats = [
    { label: t('hrOps.dueToday'), value: dueToday, icon: CalendarDays, tone: 'text-amber-700 bg-amber-50' },
    { label: t('hrOps.overdue'), value: overdue, icon: TriangleAlert, tone: 'text-rose-700 bg-rose-50' },
    { label: t('hrOps.inProgress'), value: inProgress, icon: Clock3, tone: 'text-sky-700 bg-sky-50' },
    { label: t('hrOps.awaitingReview'), value: awaitingReview, icon: FileCheck2, tone: 'text-teal-700 bg-teal-50' },
  ];

  return (
    <>
    <div className="grid gap-5">
      <section className="relative overflow-hidden rounded-[28px] bg-[#073B3A] px-5 py-6 text-white shadow-lift sm:px-7 sm:py-7">
        <div
          className="pointer-events-none absolute inset-0 opacity-70"
          style={{
            backgroundImage:
              'radial-gradient(circle at 12% 10%, rgba(94,234,212,.22), transparent 30%), radial-gradient(circle at 88% 120%, rgba(245,158,11,.23), transparent 38%)',
          }}
        />
        <div className="relative grid gap-6 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end">
          <div className="max-w-2xl">
            <span className="mb-3 inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/10 px-3 py-1.5 text-[11px] font-bold tracking-wide text-teal-50">
              <Sparkles size={13} />
              {t('hrOps.eyebrow')}
            </span>
            <h2 className="text-[24px] font-extrabold leading-tight sm:text-[32px]">{t('hrOps.title')}</h2>
            <p className="mt-2 max-w-xl text-[13px] leading-7 text-teal-50/80 sm:text-[14px]">
              {t('hrOps.subtitle')}
            </p>
          </div>
          <div className="grid grid-cols-2 overflow-hidden rounded-2xl border border-white/15 bg-black/10 backdrop-blur-sm">
            <span className="flex items-center gap-3 px-4 py-3">
              <span className="grid h-11 w-11 place-items-center rounded-xl bg-amber-400 text-[#073B3A]">
                <ClipboardCheck size={22} />
              </span>
              <span>
                <span className="block text-[10px] font-semibold text-teal-50/70">{t('hrOps.basePlan')}</span>
                <strong className="block text-xl tabular-nums">{templates.length}</strong>
              </span>
            </span>
            <span className="flex items-center gap-3 border-s border-white/10 px-4 py-3">
              <span className="grid h-11 w-11 place-items-center rounded-xl bg-teal-300 text-[#073B3A]">
                <Zap size={21} />
              </span>
              <span>
                <span className="block text-[10px] font-semibold text-teal-50/70">{t('hrOps.automatic')}</span>
                <strong className="block text-xl tabular-nums">{automationCounts.enabled}</strong>
              </span>
            </span>
          </div>
        </div>
      </section>

      <section className="grid grid-cols-2 gap-2.5 lg:grid-cols-4">
        {stats.map(({ label, value, icon: Icon, tone }) => (
          <article key={label} className="rounded-2xl border border-surface-line bg-white p-3.5 shadow-sm sm:p-4">
            <div className="flex items-center justify-between gap-3">
              <span className={cx('grid h-9 w-9 place-items-center rounded-xl', tone)}><Icon size={18} /></span>
              <strong className="text-[24px] font-extrabold tabular-nums text-ink">{value}</strong>
            </div>
            <p className="mt-3 text-[12px] font-bold text-ink-muted">{label}</p>
          </article>
        ))}
      </section>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_340px]">
        <section className="overflow-hidden rounded-[24px] border border-surface-line bg-white shadow-card">
          <header className="border-b border-surface-line px-4 py-4 sm:px-5">
            <div className="flex flex-wrap items-end justify-between gap-3">
              <div>
                <h3 className="text-[17px] font-extrabold text-ink">{t('hrOps.catalogue')}</h3>
                <p className="mt-0.5 text-[12px] text-ink-faint">{t('hrOps.catalogueHint')}</p>
              </div>
              <span className="chip bg-teal-50 text-teal-800">
                {t('hrOps.matches', { n: filteredTemplates.length })}
              </span>
            </div>

            <div className="mt-4 grid gap-2 sm:grid-cols-[minmax(12rem,1fr)_auto_auto]">
              <label className="relative flex items-center">
                <Search size={15} className="absolute start-3 text-ink-faint" />
                <input
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder={t('hrOps.search')}
                  className="field ps-9"
                />
              </label>
              <select value={category} onChange={(event) => setCategory(event.target.value)} className="field w-auto min-w-[10rem]">
                <option value="">{t('hrOps.allTracks')}</option>
                {HR_TASK_CATEGORIES.map((item) => (
                  <option key={item.id} value={item.id}>{lang === 'en' ? item.en : item.ar}</option>
                ))}
              </select>
              <select value={frequency} onChange={(event) => setFrequency(event.target.value)} className="field w-auto min-w-[8rem]">
                <option value="">{t('hrOps.allCadences')}</option>
                {HR_TASK_FREQUENCIES.map((item) => (
                  <option key={item.id} value={item.id}>{lang === 'en' ? item.en : item.ar}</option>
                ))}
              </select>
            </div>
          </header>

          <div className="max-h-[780px] divide-y divide-surface-line overflow-y-auto">
            {filteredTemplates.map((item) => {
              const track = hrTaskCategory(item.category);
              const cadence = hrTaskFrequency(item.frequency);
              const schedule = hrScheduleForTemplate(item);
              const plan = plansByTemplate.get(item.id);
              const assigned = plan?.assigneeIds[0]
                ? directory.find((person) => person.id === plan.assigneeIds[0])
                : null;
              return (
                <article key={item.id} className="group grid gap-3 px-4 py-4 transition-colors hover:bg-[#F7FBFA] sm:grid-cols-[auto_minmax(0,1fr)_auto] sm:items-start sm:px-5">
                  <span className="grid h-8 w-8 place-items-center rounded-lg bg-surface-sunken font-mono text-[11px] font-bold text-ink-muted">
                    {item.sourceNumber}
                  </span>
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="chip !px-2 !py-0.5 text-[10.5px]" style={{ background: `${cadence.color}14`, color: cadence.color }}>
                        {lang === 'en' ? cadence.en : cadence.ar}
                      </span>
                      <span className="text-[11px] font-semibold text-ink-faint">{lang === 'en' ? track.en : track.ar}</span>
                      <span className={cx(
                        'chip !px-2 !py-0.5 text-[10px]',
                        schedule.mode === 'event'
                          ? 'bg-slate-100 text-slate-600'
                          : plan?.enabled
                            ? 'bg-emerald-50 text-emerald-700'
                            : 'bg-amber-50 text-amber-700'
                      )}>
                        {schedule.mode === 'event'
                          ? t('hrOps.eventDriven')
                          : plan?.enabled
                            ? t('hrOps.automatic')
                            : t('hrOps.notAutomated')}
                      </span>
                    </div>
                    <h4 className="mt-1.5 text-[13.5px] font-extrabold leading-6 text-ink">{item.title}</h4>
                    <p className="mt-1 text-[11.5px] leading-5 text-ink-muted">
                      <span className="font-bold text-ink-muted">{t('hrOps.deadline')}:</span> {item.dueRule}
                    </p>
                    <p className="mt-0.5 line-clamp-2 text-[11.5px] leading-5 text-ink-faint">
                      <span className="font-bold">{t('hrOps.proof')}:</span> {item.doneDefinition}
                    </p>
                    <span className="mt-2 inline-flex items-center gap-1.5 text-[11px] font-semibold text-ink-muted">
                      <UsersRound size={12} /> {assigned?.name ?? item.owner}
                    </span>
                  </div>
                  {canCreate && (
                    <button type="button" onClick={() => onCreate(item)} className="btn-ghost btn-sm self-center gap-1.5 sm:opacity-0 sm:group-hover:opacity-100 sm:group-focus-within:opacity-100">
                      <Plus size={14} />
                      {t('hrOps.create')}
                    </button>
                  )}
                </article>
              );
            })}
            {filteredTemplates.length === 0 && (
              <div className="px-5 py-14 text-center text-sm text-ink-faint">{t('hrOps.noTemplates')}</div>
            )}
          </div>
        </section>

        <aside className="grid content-start gap-4">
          <section className="rounded-[24px] border border-surface-line bg-white p-4 shadow-card">
            <div className="mb-3 flex items-center justify-between gap-2">
              <div>
                <h3 className="text-[15px] font-extrabold text-ink">{t('hrOps.liveWork')}</h3>
                <p className="mt-0.5 text-[11px] text-ink-faint">{t('hrOps.liveWorkHint')}</p>
              </div>
              <span className="chip bg-surface-sunken text-ink-muted">{live.length}</span>
            </div>
            {nextTasks.length ? (
              <div className="grid gap-2">
                {nextTasks.map((item) => {
                  const late = Boolean(item.dueDate && item.dueDate < today);
                  return (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => onOpen(item)}
                      className="group flex w-full items-center gap-3 rounded-xl border border-surface-line px-3 py-2.5 text-start transition-colors hover:border-teal-200 hover:bg-teal-50/40"
                    >
                      <span className={cx('h-9 w-1 rounded-full', late ? 'bg-rose-500' : 'bg-teal-500')} />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[12.5px] font-bold text-ink">{item.title}</span>
                        <span className={cx('mt-0.5 block text-[10.5px] font-semibold', late ? 'text-rose-600' : 'text-ink-faint')}>
                          {item.dueDate ? formatDate(item.dueDate, lang) : t('hrOps.noDeadline')}
                        </span>
                      </span>
                      <ArrowUpLeft size={14} className="shrink-0 text-ink-faint transition-transform group-hover:-translate-x-0.5 group-hover:-translate-y-0.5" />
                    </button>
                  );
                })}
              </div>
            ) : (
              <div className="rounded-2xl bg-surface-sunken px-4 py-8 text-center">
                <CheckCircle2 size={24} className="mx-auto text-teal-600" />
                <p className="mt-2 text-[12px] font-bold text-ink-muted">{t('hrOps.noLiveWork')}</p>
              </div>
            )}
          </section>

          <section className="rounded-[24px] border border-surface-line bg-white p-4 shadow-card">
            <h3 className="text-[15px] font-extrabold text-ink">{t('hrOps.planMix')}</h3>
            <div className="mt-3 grid gap-2.5">
              {HR_TASK_CATEGORIES.map((item) => {
                const count = templates.filter((template) => template.category === item.id).length;
                return (
                  <button key={item.id} type="button" onClick={() => setCategory(item.id === category ? '' : item.id)} className="group text-start">
                    <span className="mb-1.5 flex items-center justify-between gap-2 text-[11.5px] font-bold text-ink-muted">
                      <span>{lang === 'en' ? item.en : item.ar}</span>
                      <span className="tabular-nums text-ink-faint">{count}</span>
                    </span>
                    <span className="block h-1.5 overflow-hidden rounded-full bg-surface-sunken">
                      <span className="block h-full rounded-full bg-teal-600 transition-all group-hover:bg-amber-500" style={{ width: `${(count / templates.length) * 100}%` }} />
                    </span>
                  </button>
                );
              })}
            </div>
          </section>

          <section className="relative overflow-hidden rounded-[24px] border border-teal-200 bg-[#EAF8F5] p-4">
            <span className="pointer-events-none absolute -end-8 -top-8 h-24 w-24 rounded-full bg-teal-200/50" />
            <div className="flex gap-3">
              <span className="relative grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-teal-700 text-white">
                <ShieldCheck size={18} />
              </span>
              <div className="relative min-w-0 flex-1">
                <div className="flex items-center justify-between gap-2">
                  <h3 className="text-[13px] font-extrabold text-teal-950">{t('hrOps.automationTitle')}</h3>
                  <span className="rounded-full bg-white/80 px-2 py-1 text-[10px] font-extrabold text-teal-800">
                    {automationCounts.enabled}/{automationCounts.scheduled}
                  </span>
                </div>
                <p className="mt-1 text-[11.5px] leading-5 text-teal-900/70">{t('hrOps.automationBody')}</p>
                {canManageAutomation && (
                  <div className="mt-3 grid grid-cols-2 gap-2">
                    <button type="button" onClick={generateNow} disabled={generating || automationCounts.enabled === 0} className="btn-primary btn-sm gap-1.5 !bg-teal-800 disabled:opacity-50">
                      {generating ? <Spinner size={14} /> : <Play size={14} />}
                      {t('hrOps.runDue')}
                    </button>
                    <button type="button" onClick={openAutomationSettings} className="btn-ghost btn-sm gap-1.5 border-teal-200 bg-white/70">
                      <Settings2 size={14} />
                      {t('hrOps.configure')}
                    </button>
                  </div>
                )}
              </div>
            </div>
          </section>
        </aside>
      </div>
    </div>

    <Modal
      open={settingsOpen}
      onClose={() => setSettingsOpen(false)}
      title={t('hrOps.settingsTitle')}
      width="xl"
      footer={(
        <>
          <button type="button" onClick={() => setSettingsOpen(false)} className="btn-ghost">
            {t('common.cancel')}
          </button>
          <button type="button" onClick={saveAutomation} disabled={savingPlans} className="btn-primary gap-2 !bg-teal-800">
            {savingPlans ? <Spinner size={16} /> : <ShieldCheck size={16} />}
            {t('hrOps.saveAutomation')}
          </button>
        </>
      )}
    >
      <div className="rounded-2xl border border-teal-200 bg-teal-50 p-4">
        <div className="flex gap-3">
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-teal-700 text-white"><Zap size={17} /></span>
          <div>
            <h3 className="text-[13px] font-extrabold text-teal-950">{t('hrOps.safeAutomation')}</h3>
            <p className="mt-1 text-[11.5px] leading-5 text-teal-900/70">{t('hrOps.safeAutomationBody')}</p>
          </div>
        </div>
      </div>

      <div className="no-scrollbar mt-4 flex gap-1.5 overflow-x-auto pb-1">
        <button type="button" onClick={() => setSettingsCategory('')} className={cx('chip shrink-0', !settingsCategory ? 'bg-teal-700 text-white' : 'bg-surface-sunken text-ink-muted')}>
          {t('hrOps.allTracks')}
        </button>
        {HR_TASK_CATEGORIES.map((item) => (
          <button key={item.id} type="button" onClick={() => setSettingsCategory(item.id)} className={cx('chip shrink-0', settingsCategory === item.id ? 'bg-teal-700 text-white' : 'bg-surface-sunken text-ink-muted')}>
            {lang === 'en' ? item.en : item.ar}
          </button>
        ))}
      </div>

      <div className="mt-3 grid gap-2">
        {templates
          .filter((template) => hrScheduleForTemplate(template).mode === 'scheduled')
          .filter((template) => !settingsCategory || template.category === settingsCategory)
          .map((template) => {
            const itemDraft = draft[template.id] ?? { enabled: false, assigneeId: '' };
            const track = hrTaskCategory(template.category);
            const preferred = hrPeople.filter((person) => person.subteam === track.subteam);
            const others = hrPeople.filter((person) => person.subteam !== track.subteam);
            const people = [...preferred, ...others];
            return (
              <article key={template.id} className={cx(
                'grid gap-3 rounded-2xl border p-3 transition-colors md:grid-cols-[auto_minmax(0,1fr)_minmax(13rem,16rem)] md:items-center',
                itemDraft.enabled ? 'border-teal-300 bg-teal-50/50' : 'border-surface-line bg-white'
              )}>
                <label className="relative inline-flex h-6 w-11 cursor-pointer items-center">
                  <input
                    type="checkbox"
                    checked={itemDraft.enabled}
                    onChange={(event) => setDraft((current) => ({
                      ...current,
                      [template.id]: { ...itemDraft, enabled: event.target.checked },
                    }))}
                    className="peer sr-only"
                  />
                  <span className="absolute inset-0 rounded-full bg-slate-200 transition-colors peer-checked:bg-teal-700" />
                  <span className="relative ms-1 h-4 w-4 rounded-full bg-white shadow-sm transition-transform peer-checked:translate-x-5 rtl:peer-checked:-translate-x-5" />
                </label>
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="font-mono text-[10px] font-bold text-ink-faint">#{template.sourceNumber}</span>
                    <span className="text-[10px] font-bold text-teal-700">{lang === 'en' ? track.en : track.ar}</span>
                  </div>
                  <h4 className="mt-1 text-[12.5px] font-extrabold leading-5 text-ink">{template.title}</h4>
                  <p className="mt-0.5 text-[10.5px] leading-4 text-ink-faint">{template.dueRule}</p>
                </div>
                <label>
                  <span className="mb-1 flex items-center gap-1 text-[10.5px] font-bold text-ink-muted"><UserCheck size={12} />{t('hrOps.taskOwner')}</span>
                  <select
                    value={itemDraft.assigneeId}
                    onChange={(event) => setDraft((current) => ({
                      ...current,
                      [template.id]: { ...itemDraft, assigneeId: event.target.value },
                    }))}
                    className="field w-full text-[12px]"
                  >
                    <option value="">{t('hrOps.chooseOwner')}</option>
                    {people.map((person: DirectoryUser) => (
                      <option key={person.id} value={person.id}>{person.name}</option>
                    ))}
                  </select>
                </label>
              </article>
            );
          })}
      </div>
    </Modal>
    </>
  );
}
