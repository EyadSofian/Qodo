/**
 * E-Learning Production — starting a production run.
 *
 * Four short steps: which way (AI-assisted new program, expert-led new
 * program, or a revamp), the basics, the team by role, and a preview of every
 * stage and task the chosen template will create — before anything is
 * written. Lessons are not asked for: they come when the curriculum does.
 *
 * Nothing here decides anything the server does not decide again. The
 * preview is the published template version the run will be pinned to.
 */

import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { ArrowLeft, ArrowRight, BookOpenCheck, Check, Crown, Lightbulb, RotateCcw, Sparkles, Users, type LucideIcon } from 'lucide-react';
import { useI18n, type StringKey } from '../../lib/i18n';
import { useAuth } from '../../lib/auth';
import { paths } from '../../lib/learningProduction/api';
import { runsApi } from '../../lib/learningProduction/runApi';
import { invalidate, useLpQuery } from '../../lib/learningProduction/hooks';
import type { CourseWithStats } from '../../lib/learningProduction/types';
import type { Release, Scenario, TemplateSummary } from '../../lib/learningProduction/runTypes';
import { PersonSelect, usePeople } from '../../components/learning-production/kit';
import { SCENARIO_THEME, gradient } from '../../lib/learningProduction/theme';
import { Busy, Disclosure, ErrorNote, Hero, IconChip, OriginBadge, Panel, Pill, usePick } from '../../components/learning-production/studio';
import { cx } from '../../lib/utils';

type Way = Exclude<Scenario, 'LEGACY'>;
const LESSON_ROLES = ['OUTLINE_WRITER', 'PPT_DESIGNER', 'SCRIPT_WRITER', 'VOICE_OVER_ARTIST', 'VIDEO_EDITOR'];
const LESSON_REVIEWERS = ['SUBJECT_MATTER_EXPERT', 'QUALITY_REVIEWER'];

const WAYS: Array<{ value: Way; icon: LucideIcon; letter: string }> = [
  { value: 'AI_NEW', icon: Sparkles, letter: 'A' },
  { value: 'EXPERT_NEW', icon: BookOpenCheck, letter: 'B1' },
  { value: 'REVAMP', icon: RotateCcw, letter: 'B2' },
];
const STEPS = ['way', 'basics', 'team', 'review'] as const;
type Step = (typeof STEPS)[number];

export function NewRun() {
  const { t } = useI18n();
  const pick = usePick();
  const navigate = useNavigate();
  const { user } = useAuth();
  const [params] = useSearchParams();
  const people = usePeople();
  const { data: courseList } = useLpQuery<{ courses: CourseWithStats[]; canCreate: boolean }>(paths.courses({ sort: 'name' }));

  const [step, setStep] = useState<Step>('way');
  const [scenario, setScenario] = useState<Way | null>((params.get('scenario') as Way) || null);
  const [courseMode, setCourseMode] = useState<'new' | 'existing'>(params.get('course') ? 'existing' : 'new');
  const [courseId, setCourseId] = useState<string>(params.get('course') ?? '');
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [description, setDescription] = useState('');
  const [title, setTitle] = useState('');
  const [managerUserId, setManager] = useState<string | null>(user?.id ?? null);
  const [startDate, setStartDate] = useState('');
  const [targetDate, setTargetDate] = useState('');
  const [releaseChoice, setReleaseChoice] = useState<string>('');
  const [expertContracted, setExpertContracted] = useState(false);
  const [expertUserId, setExpertUserId] = useState<string | null>(null);
  const [expertReason, setExpertReason] = useState('');
  const [team, setTeam] = useState<Record<string, string | null>>({});
  const [preview, setPreview] = useState<TemplateSummary | null>(null);
  const [templateVersion, setTemplateVersion] = useState<number | null>(null);
  const [releases, setReleases] = useState<Release[]>([]);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!managerUserId && user?.id) setManager(user.id);
  }, [user, managerUserId]);

  // The template for the chosen way — its stages, and the roles it needs people for.
  useEffect(() => {
    if (!scenario) return;
    let alive = true;
    setPreview(null);
    runsApi
      .previewTemplate(scenario)
      .then((response) => {
        if (!alive) return;
        setPreview(response.summary);
        setTemplateVersion(response.templateVersion.versionNumber);
      })
      .catch((failure) => alive && setError(failure));
    return () => {
      alive = false;
    };
  }, [scenario]);

  // A revamp starts from one of the course's published releases, or from its content as it stands.
  useEffect(() => {
    if (scenario !== 'REVAMP' || !courseId) {
      setReleases([]);
      return;
    }
    let alive = true;
    runsApi
      .releases(courseId)
      .then((response) => {
        if (!alive) return;
        const published = response.releases.filter((release) => release.publishedAt);
        setReleases(published);
        setReleaseChoice(published[0]?.id ?? 'CURRENT_CONTENT');
      })
      .catch(() => alive && setReleases([]));
    return () => {
      alive = false;
    };
  }, [scenario, courseId]);

  const courses = courseList?.courses ?? [];
  const eligible = useMemo(
    () =>
      courses.filter((course) => {
        const run = course.run;
        const open = run && (run.status === 'ACTIVE' || run.status === 'ON_HOLD') && run.scenario !== 'LEGACY';
        return !open;
      }),
    [courses]
  );
  const existing = courses.find((course) => course.id === courseId) ?? null;
  const effectiveMode = scenario === 'REVAMP' ? 'existing' : courseMode;

  const basicsReady =
    (effectiveMode === 'new' ? name.trim().length > 0 : Boolean(courseId)) &&
    (!startDate || !targetDate || targetDate >= startDate) &&
    (scenario !== 'REVAMP' || Boolean(releaseChoice)) &&
    (!expertContracted || expertReason.trim().length > 0);

  // One person runs the run: the project manager. Beside them, the three
  // roles this template leans on most (by the tasks it gives them) are worth
  // naming now; everything else is optional here, and any task left without
  // a person reaches the project manager to hand out from the course page.
  const { keyRoles, otherRoles } = useMemo(() => {
    const weight = new Map<string, number>();
    for (const stage of preview?.stages ?? []) {
      for (const task of stage.tasks) {
        if (task.role) weight.set(task.role, (weight.get(task.role) ?? 0) + 1);
        if (task.reviewerRole) weight.set(task.reviewerRole, (weight.get(task.reviewerRole) ?? 0) + 1);
      }
    }
    const managed = ['PRODUCTION_MANAGER', 'COURSE_MANAGER'];
    const program = (preview?.roles ?? []).filter((role) => !managed.includes(role) && !LESSON_ROLES.includes(role));
    const ranked = [...program].sort((a, b) => (weight.get(b) ?? 0) - (weight.get(a) ?? 0));
    const top = ranked.slice(0, 3);
    const rest = [
      'COURSE_MANAGER',
      ...ranked.slice(3),
      ...LESSON_ROLES,
      ...LESSON_REVIEWERS.filter((role) => !program.includes(role)),
    ];
    return { keyRoles: top, otherRoles: rest };
  }, [preview]);
  const extraChosen = otherRoles.filter((role) => team[role]).length;

  async function create() {
    if (!scenario) return;
    setBusy(true);
    setError(null);
    const byPerson = new Map<string, Set<string>>();
    for (const [role, userId] of Object.entries(team)) {
      if (!userId) continue;
      byPerson.set(userId, new Set([...(byPerson.get(userId) ?? []), role]));
    }
    try {
      const created = await runsApi.createRun({
        scenario,
        ...(effectiveMode === 'existing' ? { courseId } : { course: { name: name.trim(), code: code.trim() || undefined, description } }),
        title: title.trim() || undefined,
        managerUserId,
        startDate: startDate || undefined,
        targetDate: targetDate || undefined,
        team: [...byPerson.entries()].map(([userId, set]) => ({ userId, roles: [...set] })),
        ...(scenario === 'REVAMP'
          ? releaseChoice === 'CURRENT_CONTENT'
            ? { baseline: 'CURRENT_CONTENT' }
            : { sourceReleaseId: releaseChoice }
          : {}),
        ...(scenario === 'EXPERT_NEW' && expertContracted ? { expertContracted: { userId: expertUserId, reason: expertReason.trim() } } : {}),
      });
      invalidate();
      navigate(`/learning-production/courses/${created.course.id}?created=1`);
    } catch (failure) {
      setError(failure);
      setBusy(false);
    }
  }

  const index = STEPS.indexOf(step);
  const next = () => setStep(STEPS[Math.min(STEPS.length - 1, index + 1)]);
  const back = () => setStep(STEPS[Math.max(0, index - 1)]);
  const canNext = step === 'way' ? Boolean(scenario) : step === 'basics' ? basicsReady : step === 'team' ? Boolean(managerUserId) : true;

  return (
    <div className="lps-stagger mx-auto max-w-[980px] space-y-4">
      <Hero
        back={
          <Link to="/learning-production/courses" className="lps-hero-back">
            <ArrowRight size={15} aria-hidden="true" className="ltr:rotate-180" />
            {t('lp.nav.courses')}
          </Link>
        }
        title={t('lp.run.new')}
        subtitle={t('lp.newRun.lede')}
      />

      <ol className="lps-panel flex gap-3 px-4 pb-3 pt-4" aria-label={t('lp.newRun.steps')}>
        {STEPS.map((entry, position) => (
          <li
            key={entry}
            className="lps-step"
            data-state={position < index ? 'DONE' : position === index ? 'IN_PROGRESS' : 'BLOCKED'}
            data-current={position === index}
            aria-current={position === index ? 'step' : undefined}
          >
            <span className="text-[11.5px] lps-faint">{t('lp.newRun.stepN', { n: position + 1 })}</span>
            <span className="text-[13px] font-semibold">{t(`lp.newRun.step.${entry}` as StringKey)}</span>
          </li>
        ))}
      </ol>

      {error ? <ErrorNote error={error} /> : null}

      {step === 'way' && (
        <fieldset className="space-y-2">
          <legend className="lps-h2 mb-2">{t('lp.newRun.wayQuestion')}</legend>
          {WAYS.map(({ value, icon: Icon, letter }) => (
            <label
              key={value}
              className="lps-panel lps-lift relative flex cursor-pointer gap-3.5 overflow-hidden p-4"
              style={
                scenario === value
                  ? { borderColor: `rgb(${SCENARIO_THEME[value].a1})`, boxShadow: `0 0 0 3px rgb(${SCENARIO_THEME[value].a1} / 0.18), 0 22px 44px -26px rgb(${SCENARIO_THEME[value].a1} / 0.7)` }
                  : undefined
              }
            >
              <span aria-hidden="true" className="absolute inset-y-0 start-0 w-1.5" style={{ background: gradient(SCENARIO_THEME[value], 180) }} />
              <input type="radio" name="scenario" value={value} className="mt-1" style={{ accentColor: `rgb(${SCENARIO_THEME[value].a1})` }} checked={scenario === value} onChange={() => setScenario(value)} />
              <span className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl text-white" style={{ background: gradient(SCENARIO_THEME[value]), boxShadow: `0 10px 20px -10px rgb(${SCENARIO_THEME[value].a1})` }}>
                <Icon size={20} aria-hidden="true" />
              </span>
              <span className="min-w-0">
                <span className="flex flex-wrap items-center gap-2">
                  <span className="font-display text-[15px] font-semibold">{t(`lp.scenario.${value}` as StringKey)}</span>
                  <Pill tone="outline">{letter}</Pill>
                </span>
                <span className="mt-1 block text-[13px] lps-muted">{t(`lp.scenarioHint.${value}` as StringKey)}</span>
                <span className="mt-1.5 block text-[12px] lps-faint">{t(`lp.scenarioPath.${value}` as StringKey)}</span>
              </span>
            </label>
          ))}
        </fieldset>
      )}

      {step === 'basics' && scenario && (
        <Panel title={t('lp.newRun.step.basics')}>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            {scenario !== 'REVAMP' && (
              <fieldset className="md:col-span-2">
                <legend className="lps-label">{t('lp.newRun.courseMode')}</legend>
                <div className="flex flex-wrap gap-3 text-[13.5px]">
                  <label className="flex items-center gap-2">
                    <input type="radio" checked={courseMode === 'new'} onChange={() => setCourseMode('new')} />
                    {t('lp.newRun.newCourse')}
                  </label>
                  <label className="flex items-center gap-2">
                    <input type="radio" checked={courseMode === 'existing'} onChange={() => setCourseMode('existing')} />
                    {t('lp.newRun.existingCourse')}
                  </label>
                </div>
              </fieldset>
            )}

            {effectiveMode === 'new' ? (
              <>
                <Field label={t('lp.field.courseName')} required>
                  <input className="lps-input" value={name} onChange={(event) => setName(event.target.value)} maxLength={160} />
                </Field>
                <Field label={t('lp.field.courseCode')}>
                  <input className="lps-input" value={code} onChange={(event) => setCode(event.target.value)} maxLength={40} />
                </Field>
                <Field label={t('lp.field.description')} wide>
                  <textarea className="lps-input min-h-[72px]" value={description} onChange={(event) => setDescription(event.target.value)} maxLength={5000} />
                </Field>
              </>
            ) : (
              <Field label={t('lp.field.course')} required wide hint={scenario === 'REVAMP' ? t('lp.newRun.revampCourseHint') : t('lp.newRun.existingHint')}>
                <select className="lps-input" value={courseId} onChange={(event) => setCourseId(event.target.value)}>
                  <option value="">{t('lp.newRun.chooseCourse')}</option>
                  {eligible.map((course) => (
                    <option key={course.id} value={course.id}>
                      {course.name}
                      {course.run?.isLegacy && course.run.scenario === 'LEGACY' ? ` — ${t('lp.scenarioShort.LEGACY')}` : ''}
                    </option>
                  ))}
                </select>
              </Field>
            )}

            {scenario === 'REVAMP' && courseId && (
              <Field label={t('lp.newRun.source')} required wide hint={t('lp.newRun.sourceHint')}>
                <select className="lps-input" value={releaseChoice} onChange={(event) => setReleaseChoice(event.target.value)}>
                  {releases.map((release) => (
                    <option key={release.id} value={release.id}>
                      {release.versionLabel} · {t(`lp.releaseStatus.${release.status}` as StringKey)}
                    </option>
                  ))}
                  <option value="CURRENT_CONTENT">{t('lp.newRun.currentContent')}</option>
                </select>
                {releaseChoice === 'CURRENT_CONTENT' && <span className="lps-callout mt-2 block">{t('lp.newRun.baselineNote')}</span>}
              </Field>
            )}

            {existing?.run?.scenario === 'LEGACY' && existing.run.status === 'ACTIVE' && (
              <p className="lps-callout-info md:col-span-2">{t('lp.newRun.closesLegacy')}</p>
            )}

            <Field label={t('lp.field.runTitle')} hint={t('lp.field.runTitleHint')}>
              <input className="lps-input" value={title} onChange={(event) => setTitle(event.target.value)} maxLength={160} />
            </Field>
            <Field label={t('lp.field.startDate')}>
              <input type="date" className="lps-input" value={startDate} onChange={(event) => setStartDate(event.target.value)} />
            </Field>
            <Field label={t('lp.field.targetDate')}>
              <input type="date" className="lps-input" value={targetDate} min={startDate || undefined} onChange={(event) => setTargetDate(event.target.value)} />
            </Field>

            {scenario === 'EXPERT_NEW' && (
              <fieldset className="md:col-span-2 lps-panel p-3" style={{ background: 'var(--lps-sunken)' }}>
                <label className="flex items-start gap-2 text-[13.5px] font-semibold">
                  <input type="checkbox" className="mt-1" checked={expertContracted} onChange={(event) => setExpertContracted(event.target.checked)} />
                  <span>
                    {t('lp.newRun.expertContracted')}
                    <span className="block text-[12.5px] font-normal lps-muted">{t('lp.newRun.expertContractedHint')}</span>
                  </span>
                </label>
                {expertContracted && (
                  <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-2">
                    <Field label={t('lp.newRun.expertPerson')}>
                      <PersonSelect className="lps-input" value={expertUserId} onChange={setExpertUserId} people={people} placeholder={t('lp.people.optional')} />
                    </Field>
                    <Field label={t('lp.newRun.expertReason')} required>
                      <input className="lps-input" value={expertReason} onChange={(event) => setExpertReason(event.target.value)} maxLength={1000} />
                    </Field>
                  </div>
                )}
              </fieldset>
            )}
          </div>
        </Panel>
      )}

      {step === 'team' && (
        <div className="space-y-4">
          <section className="lps-panel p-4 sm:p-5">
            <h3 className="flex items-center gap-2.5 text-[16px] font-bold">
              <IconChip icon={Crown} tone="violet" size={15} />
              {t('lp.newRun.pm')}
              <span className="text-[13px] font-normal text-[color:var(--lps-danger)]" aria-hidden="true">*</span>
            </h3>
            <p className="mt-1 text-[13px] lps-muted">{t('lp.newRun.pmHint')}</p>
            <div className="mt-3 max-w-md">
              <PersonSelect className="lps-input" value={managerUserId} onChange={setManager} people={people} placeholder={t('lp.people.choose')} />
            </div>
          </section>

          <section className="lps-panel p-4 sm:p-5">
            <h3 className="flex items-center gap-2.5 text-[16px] font-bold">
              <IconChip icon={Users} tone="blue" size={15} />
              {t('lp.newRun.keyRoles')}
            </h3>
            <p className="mt-1 text-[13px] lps-muted">{t('lp.newRun.keyRolesHint')}</p>
            {!preview ? (
              <div className="mt-3">
                <Busy />
              </div>
            ) : (
              <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-3">
                {keyRoles.map((role) => (
                  <Field key={role} label={t(`lp.role.${role}` as StringKey)} hint={t(`lp.roleHint.${role}` as StringKey)}>
                    <PersonSelect
                      className="lps-input"
                      value={team[role] ?? null}
                      onChange={(value) => setTeam((current) => ({ ...current, [role]: value }))}
                      people={people}
                      placeholder={t('lp.people.later')}
                    />
                  </Field>
                ))}
              </div>
            )}
          </section>

          {preview && otherRoles.length > 0 && (
            <Disclosure title={t('lp.newRun.otherRoles')} count={extraChosen || undefined}>
              <p className="mb-3 text-[13px] lps-muted">{t('lp.newRun.otherRolesHint')}</p>
              <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
                {otherRoles.map((role) => (
                  <Field key={role} label={t(`lp.role.${role}` as StringKey)}>
                    <PersonSelect
                      className="lps-input"
                      value={team[role] ?? null}
                      onChange={(value) => setTeam((current) => ({ ...current, [role]: value }))}
                      people={people}
                      placeholder={t('lp.people.later')}
                    />
                  </Field>
                ))}
              </div>
            </Disclosure>
          )}
        </div>
      )}

      {step === 'review' && preview && (
        <div className="space-y-3">
          <Panel
            title={t('lp.newRun.previewTitle', { template: pick(preview.label), version: templateVersion ?? 1 })}
            action={
              <span className="flex flex-wrap gap-1.5">
                <Pill tone="neutral">{t('lp.newRun.countStages', { n: preview.counts.stages })}</Pill>
                <Pill tone="neutral">{t('lp.newRun.countRequired', { n: preview.counts.required })}</Pill>
                <Pill tone="neutral">{t('lp.newRun.countApprovals', { n: preview.counts.approvals })}</Pill>
                {preview.counts.proposed > 0 && (
                  <Pill tone="attention" icon={Lightbulb}>
                    {t('lp.newRun.countProposed', { n: preview.counts.proposed })}
                  </Pill>
                )}
              </span>
            }
            bodyClassName="p-0"
          >
            <ol>
              {preview.stages.map((stage, position) => {
                const skipped = scenario === 'EXPERT_NEW' && expertContracted && stage.key === 'EXPERT_ACQUISITION';
                return (
                  <li key={stage.key} className="border-b px-4 py-3 last:border-b-0" style={{ borderColor: 'var(--lps-line)' }}>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="w-6 text-[12px] font-semibold lps-faint">{position + 1}</span>
                      <span className={cx('font-semibold', skipped && 'line-through lps-muted')}>{pick(stage.label)}</span>
                      {stage.origin === 'PROPOSED' && <OriginBadge origin="PROPOSED" />}
                      {skipped && <Pill tone="outline">{t('lp.newRun.willSkip')}</Pill>}
                      <span className="ms-auto text-[12px] lps-muted">
                        {t('lp.newRun.stageTasks', { n: stage.tasks.filter((task) => task.kind !== 'AUTO').length })}
                        {stage.tasks.some((task) => task.kind === 'AUTO') ? ` · ${t('lp.newRun.stageGates', { n: stage.tasks.filter((task) => task.kind === 'AUTO').length })}` : ''}
                      </span>
                    </div>
                    <p className="ms-8 mt-0.5 text-[12.5px] lps-muted">
                      {stage.tasks
                        .filter((task) => task.kind !== 'AUTO')
                        .map((task) => pick(task.label))
                        .join(' · ')}
                    </p>
                  </li>
                );
              })}
            </ol>
          </Panel>
          <p className="lps-callout-info">{t('lp.newRun.unassignedGoToPm', { name: people.find((person) => person.id === managerUserId)?.name ?? t('lp.newRun.pm') })}</p>
          <p className="lps-callout-info">{t('lp.newRun.noLessonsYet')}</p>
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-2 border-t pt-4" style={{ borderColor: 'var(--lps-line)' }}>
        <button type="button" className="lps-btn" onClick={back} disabled={index === 0 || busy}>
          <ArrowLeft size={15} aria-hidden="true" className="rtl:-scale-x-100" />
          {t('common.back')}
        </button>
        {step === 'review' ? (
          <button type="button" className="lps-btn-primary" onClick={create} disabled={busy || !preview}>
            {busy ? <Busy /> : <Check size={15} aria-hidden="true" />}
            {t('lp.newRun.create')}
          </button>
        ) : (
          <button type="button" className="lps-btn-primary" onClick={next} disabled={!canNext}>
            {t('lp.action.next')}
            <ArrowRight size={15} aria-hidden="true" className="rtl:-scale-x-100" />
          </button>
        )}
      </div>
    </div>
  );
}

function Field({ label, required, hint, wide, children }: { label: string; required?: boolean; hint?: string; wide?: boolean; children: ReactNode }) {
  return (
    <label className={cx('block min-w-0', wide && 'md:col-span-2')}>
      <span className="lps-label">
        {label}
        {required && <span aria-hidden="true"> *</span>}
      </span>
      {children}
      {hint && <span className="mt-1 block text-[12px] lps-faint">{hint}</span>}
    </label>
  );
}
