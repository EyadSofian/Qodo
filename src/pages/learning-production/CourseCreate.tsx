/**
 * Create a course — three short steps: the basics, the lessons, who does what.
 *
 * Nothing is saved until Finish, and Finish sends everything in one request,
 * so an abandoned wizard never leaves a half-built course behind. Only the
 * course name is required; the other two steps can be skipped and done later.
 */

import { useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ArrowLeft, ArrowRight, Check, FileUp, Plus, Trash2 } from 'lucide-react';
import { useI18n } from '../../lib/i18n';
import { cx } from '../../lib/utils';
import { useAuth } from '../../lib/auth';
import { lp, uploads } from '../../lib/learningProduction/api';
import { invalidate } from '../../lib/learningProduction/hooks';
import { STAGES, lpErrorKey, priorityKey, stageKey } from '../../lib/learningProduction/format';
import { parseLessonList } from '@shared/learningProduction/lessonImport';
import type { AssetType, Priority, ProductionDefaults } from '../../lib/learningProduction/types';
import { useToast, Spinner } from '../../components/ui';
import { PageHeader, PersonSelect, Section, StageLabel, usePeople } from '../../components/learning-production/kit';

interface DraftModule {
  key: number;
  name: string;
  lessons: string;
}

const PRIORITIES: Priority[] = ['LOW', 'NORMAL', 'HIGH', 'URGENT'];

export function CourseCreate() {
  const { t, dir } = useI18n();
  const { user } = useAuth();
  const navigate = useNavigate();
  const toast = useToast();
  const people = usePeople();
  const [step, setStep] = useState(0);
  const [busy, setBusy] = useState(false);
  const [nameError, setNameError] = useState(false);

  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [description, setDescription] = useState('');
  const [managerUserId, setManager] = useState<string | null>(user?.id ?? null);
  const [startDate, setStartDate] = useState('');
  const [targetDate, setTargetDate] = useState('');
  const [priority, setPriority] = useState<Priority>('NORMAL');
  const [cover, setCover] = useState<File | null>(null);

  const counter = useRef(1);
  const [modules, setModules] = useState<DraftModule[]>([{ key: 0, name: '', lessons: '' }]);
  const [defaults, setDefaults] = useState<ProductionDefaults>({});

  const parsed = useMemo(
    () => modules.map((module) => ({ ...module, parsed: parseLessonList(module.lessons) })),
    [modules]
  );
  const lessonCount = parsed.reduce((sum, module) => sum + module.parsed.length, 0);

  const Back = dir === 'rtl' ? ArrowRight : ArrowLeft;
  const Next = dir === 'rtl' ? ArrowLeft : ArrowRight;
  const steps = [t('lp.create.stepBasics'), t('lp.create.stepLessons'), t('lp.create.stepTeam')];

  const importFile = async (file: File, key: number) => {
    const text = await file.text();
    const rows = parseLessonList(text);
    const withModules = rows.some((row) => row.moduleName);
    if (!withModules) {
      setModules((list) => list.map((module) => (module.key === key ? { ...module, lessons: rows.map((row) => row.name).join('\n') } : module)));
      return;
    }
    const grouped = new Map<string, string[]>();
    for (const row of rows) {
      const moduleName = row.moduleName ?? t('lp.noModule');
      grouped.set(moduleName, [...(grouped.get(moduleName) ?? []), row.name]);
    }
    setModules([...grouped.entries()].map(([moduleName, names]) => ({ key: counter.current++, name: moduleName, lessons: names.join('\n') })));
  };

  const setDefault = (type: AssetType, field: 'assigneeUserId' | 'reviewerUserId', value: string | null) => {
    setDefaults((current) => ({
      ...current,
      [type]: { assigneeUserId: current[type]?.assigneeUserId ?? null, reviewerUserId: current[type]?.reviewerUserId ?? null, [field]: value },
    }));
  };

  const next = () => {
    if (step === 0 && !name.trim()) {
      setNameError(true);
      return;
    }
    setStep((value) => Math.min(2, value + 1));
  };

  const finish = async () => {
    if (!name.trim()) {
      setStep(0);
      setNameError(true);
      return;
    }
    setBusy(true);
    try {
      const withLessons = parsed.filter((module) => module.parsed.length > 0 || module.name.trim());
      const namedModules = withLessons.filter((module) => module.name.trim());
      const loose = withLessons.filter((module) => !module.name.trim()).flatMap((module) => module.parsed.map((row) => row.name));
      const { course } = await lp.createCourse({
        name: name.trim(),
        code: code.trim() || null,
        description,
        managerUserId,
        startDate: startDate || null,
        targetDate: targetDate || null,
        priority,
        modules: namedModules.map((module) => ({ name: module.name.trim(), lessons: module.parsed.map((row) => row.name) })),
        lessons: loose,
        productionDefaults: defaults,
      });
      if (cover) {
        await uploads.cover(course.id, cover).promise.catch(() => toast.push(t('lp.create.coverFailed'), 'bad'));
      }
      invalidate();
      toast.push(t('lp.toast.courseCreated'));
      navigate(`/learning-production/courses/${course.id}/production`);
    } catch (error) {
      toast.push(t(lpErrorKey(error)), 'bad');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader
        title={t('lp.create.title')}
        breadcrumbs={[{ label: t('lp.nav.courses'), to: '/learning-production/courses' }, { label: t('lp.create.title') }]}
      />

      <ol className="mb-5 flex items-center gap-2" aria-label={t('lp.create.steps')}>
        {steps.map((label, index) => (
          <li key={label} className="flex flex-1 items-center gap-2">
            <button
              type="button"
              onClick={() => (index <= step || name.trim() ? setStep(index) : undefined)}
              aria-current={index === step ? 'step' : undefined}
              className={cx(
                'flex items-center gap-2 text-[13px] font-semibold',
                index === step ? 'text-brand-600' : index < step ? 'text-ink' : 'text-ink-faint'
              )}
            >
              <span
                className={cx(
                  'grid h-6 w-6 place-items-center rounded-full text-[12px]',
                  index < step ? 'bg-status-ok text-white' : index === step ? 'bg-brand-500 text-white' : 'bg-surface-sunken'
                )}
              >
                {index < step ? <Check size={13} /> : index + 1}
              </span>
              <span className="hidden sm:inline">{label}</span>
            </button>
            {index < steps.length - 1 && <span className="h-px flex-1 bg-surface-line" aria-hidden="true" />}
          </li>
        ))}
      </ol>

      {step === 0 && (
        <Section>
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="block sm:col-span-2">
              <span className="label">
                {t('lp.course.name')} <span className="text-status-bad">*</span>
              </span>
              <input
                className={cx('field', nameError && '!border-status-bad')}
                value={name}
                onChange={(event) => {
                  setName(event.target.value);
                  setNameError(false);
                }}
                placeholder={t('lp.create.namePlaceholder')}
                autoFocus
              />
              {nameError && <span className="mt-1 block text-[12px] font-semibold text-status-bad">{t('lp.create.nameRequired')}</span>}
            </label>
            <label className="block">
              <span className="label">{t('lp.course.code')}</span>
              <input className="field ltr" value={code} onChange={(event) => setCode(event.target.value)} placeholder="CMRP" />
            </label>
            <label className="block">
              <span className="label">{t('lp.course.manager')}</span>
              <PersonSelect value={managerUserId} onChange={setManager} people={people} placeholder={t('lp.create.me')} />
            </label>
            <label className="block sm:col-span-2">
              <span className="label">{t('lp.course.description')}</span>
              <textarea className="field min-h-[80px]" value={description} onChange={(event) => setDescription(event.target.value)} />
            </label>
            <label className="block">
              <span className="label">{t('lp.course.startDate')}</span>
              <input type="date" className="field" value={startDate} onChange={(event) => setStartDate(event.target.value)} />
            </label>
            <label className="block">
              <span className="label">{t('lp.course.targetDate')}</span>
              <input type="date" className="field" value={targetDate} min={startDate || undefined} onChange={(event) => setTargetDate(event.target.value)} />
            </label>
            <label className="block">
              <span className="label">{t('lp.priority')}</span>
              <select className="field" value={priority} onChange={(event) => setPriority(event.target.value as Priority)}>
                {PRIORITIES.map((value) => (
                  <option key={value} value={value}>
                    {t(priorityKey(value))}
                  </option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="label">
                {t('lp.course.cover')} <span className="font-normal text-ink-faint">({t('common.optional')})</span>
              </span>
              <input type="file" accept="image/png,image/jpeg,image/webp" className="field !py-2 text-[12.5px]" onChange={(event) => setCover(event.target.files?.[0] ?? null)} />
            </label>
          </div>
        </Section>
      )}

      {step === 1 && (
        <div className="space-y-3">
          <p className="text-[13px] text-ink-muted">{t('lp.create.lessonsHint')}</p>
          {parsed.map((module, index) => (
            <Section key={module.key}>
              <div className="flex items-center gap-2">
                <input
                  className="field"
                  value={module.name}
                  onChange={(event) => setModules((list) => list.map((entry) => (entry.key === module.key ? { ...entry, name: event.target.value } : entry)))}
                  placeholder={t('lp.create.modulePlaceholder', { n: index + 1 })}
                  aria-label={t('lp.module.name')}
                />
                <label className="btn-ghost btn-sm shrink-0 cursor-pointer" title={t('lp.create.importCsv')}>
                  <FileUp size={14} />
                  <span className="hidden sm:inline">{t('lp.create.import')}</span>
                  <input
                    type="file"
                    accept=".csv,.tsv,.txt,text/csv,text/plain"
                    className="sr-only"
                    onChange={(event) => {
                      const file = event.target.files?.[0];
                      if (file) void importFile(file, module.key);
                      event.target.value = '';
                    }}
                  />
                </label>
                {modules.length > 1 && (
                  <button
                    type="button"
                    className="btn-quiet btn-sm shrink-0"
                    onClick={() => setModules((list) => list.filter((entry) => entry.key !== module.key))}
                    aria-label={t('lp.create.removeModule')}
                  >
                    <Trash2 size={14} />
                  </button>
                )}
              </div>
              <textarea
                className="field mt-2 min-h-[140px] font-mono text-[13px]"
                value={module.lessons}
                onChange={(event) => setModules((list) => list.map((entry) => (entry.key === module.key ? { ...entry, lessons: event.target.value } : entry)))}
                placeholder={t('lp.create.lessonsPlaceholder')}
                aria-label={t('lp.create.lessonsLabel')}
              />
              <p className="mt-1 text-[12px] text-ink-faint">{t('lp.create.lessonsDetected', { n: module.parsed.length })}</p>
            </Section>
          ))}
          <div className="flex items-center justify-between">
            <button type="button" className="btn-ghost btn-sm" onClick={() => setModules((list) => [...list, { key: counter.current++, name: '', lessons: '' }])}>
              <Plus size={14} />
              {t('lp.module.add')}
            </button>
            <span className="text-[13px] font-semibold text-ink">{t('lp.create.totalAssets', { lessons: lessonCount, assets: lessonCount * 5 })}</span>
          </div>
        </div>
      )}

      {step === 2 && (
        <Section>
          <p className="mb-4 text-[13px] text-ink-muted">{t('lp.create.defaultsHint')}</p>
          <div className="space-y-3">
            {STAGES.map((type) => (
              <div key={type} className="grid items-center gap-2 sm:grid-cols-[140px_1fr_1fr]">
                <span className="text-[13px] font-semibold text-ink">
                  <StageLabel type={type} />
                </span>
                <PersonSelect
                  value={defaults[type]?.assigneeUserId ?? null}
                  onChange={(value) => setDefault(type, 'assigneeUserId', value)}
                  people={people}
                  exclude={defaults[type]?.reviewerUserId}
                  placeholder={t('lp.create.defaultMaker', { stage: t(stageKey(type)) })}
                />
                <PersonSelect
                  value={defaults[type]?.reviewerUserId ?? null}
                  onChange={(value) => setDefault(type, 'reviewerUserId', value)}
                  people={people}
                  exclude={defaults[type]?.assigneeUserId}
                  placeholder={t('lp.create.defaultReviewer')}
                />
              </div>
            ))}
          </div>
        </Section>
      )}

      <div className="mt-5 flex items-center justify-between gap-2">
        {step === 0 ? (
          <Link to="/learning-production/courses" className="btn-quiet btn-sm">
            {t('common.cancel')}
          </Link>
        ) : (
          <button type="button" className="btn-ghost btn-sm" onClick={() => setStep((value) => value - 1)}>
            <Back size={14} />
            {t('common.back')}
          </button>
        )}
        <div className="flex items-center gap-2">
          {step < 2 && step > 0 && (
            <button type="button" className="btn-quiet btn-sm" onClick={finish} disabled={busy}>
              {t('lp.create.finishNow')}
            </button>
          )}
          {step < 2 ? (
            <button type="button" className="btn-primary btn-sm" onClick={next}>
              {t('lp.next')}
              <Next size={14} />
            </button>
          ) : (
            <button type="button" className="btn-primary btn-sm" onClick={finish} disabled={busy}>
              {busy ? <Spinner size={14} /> : <Check size={14} />}
              {t('lp.create.finish')}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
