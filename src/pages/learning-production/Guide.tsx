/**
 * How it works — the business logic of the module, for the people using it.
 *
 * The prose lives in lib/learningProduction/guideContent.ts. The stage lists
 * under "The three ways" are read from the published templates, so what this
 * page says a run contains is exactly what a new run gets.
 */

import { useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, BookOpen, Check, ChevronLeft } from 'lucide-react';
import { useI18n, type StringKey } from '../../lib/i18n';
import { useLpQuery } from '../../lib/learningProduction/hooks';
import { runPaths } from '../../lib/learningProduction/runApi';
import type { TemplatesResponse } from '../../lib/learningProduction/runTypes';
import { GUIDE } from '../../lib/learningProduction/guideContent';
import { Choice, LoadingRows, OriginBadge, PageHero, Panel, usePick } from '../../components/learning-production/studio';

const WHERE: Record<string, string> = {
  newRun: '/learning-production/runs/new',
  myWork: '/learning-production',
  reviews: '/learning-production',
  production: '/learning-production/courses',
  qa: '/learning-production/courses',
};

export function Guide() {
  const pick = usePick();
  return (
    <div className="lps-stagger mx-auto max-w-[1100px] space-y-4">
      <PageHero icon={BookOpen} title={pick(GUIDE.title)} lede={pick(GUIDE.lede)} />

      <Panel title={pick(GUIDE.model.title)}>
        <ol className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-5">
          {GUIDE.model.boxes.map((box, index) => (
            <li key={index} className="relative rounded-xl border p-3" style={{ borderColor: 'var(--lps-line)', background: 'rgb(248 250 252 / 0.8)' }}>
              <span className="text-[11.5px] font-semibold lps-faint">{index + 1}</span>
              <p className="font-display text-[14.5px] font-bold">{pick(box.title)}</p>
              <p className="mt-1 text-[12.5px] leading-relaxed lps-muted">{pick(box.body)}</p>
              {index < GUIDE.model.boxes.length - 1 && (
                <ChevronLeft size={16} aria-hidden="true" className="absolute -end-3 top-1/2 hidden -translate-y-1/2 lps-faint lg:block ltr:rotate-180" />
              )}
            </li>
          ))}
        </ol>
      </Panel>

      <Panel title={pick(GUIDE.journey.title)} bodyClassName="p-0">
        <ol>
          {GUIDE.journey.steps.map((step, index) => (
            <li key={index} className="flex gap-3 border-b px-4 py-3 last:border-b-0" style={{ borderColor: 'var(--lps-line)' }}>
              <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full text-[12px] font-bold text-white" style={{ background: 'var(--lps-tab-active)' }}>
                {index + 1}
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-[12px] font-semibold lps-muted">{pick(step.who)}</p>
                <p className="text-[13.5px] leading-relaxed">{pick(step.what)}</p>
              </div>
              {step.where && (
                <Link to={WHERE[step.where]} className="lps-btn-quiet shrink-0 self-center !px-2" aria-label={pick(step.what)}>
                  <ArrowLeft size={15} aria-hidden="true" className="ltr:rotate-180" />
                </Link>
              )}
            </li>
          ))}
        </ol>
      </Panel>

      <Ways />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Panel title={pick(GUIDE.task.title)}>
          <ol className="space-y-2">
            {GUIDE.task.states.map((state, index) => (
              <li key={index} className="flex gap-2.5">
                <span className="mt-0.5 inline-flex h-[22px] shrink-0 items-center rounded-full border px-2 text-[11.5px] font-semibold" style={{ borderColor: 'var(--lps-line-strong)' }}>
                  {pick(state.label)}
                </span>
                <span className="text-[13px] lps-muted">{pick(state.body)}</span>
              </li>
            ))}
          </ol>
          <Rules rules={GUIDE.task.rules} />
        </Panel>

        <Panel title={pick(GUIDE.lessons.title)}>
          <ol className="flex flex-wrap items-center gap-1.5">
            {GUIDE.lessons.order.map((step, index) => (
              <li key={index} className="flex items-center gap-1.5">
                <span className="rounded-lg border px-2.5 py-1.5 text-[12.5px] font-semibold" style={{ borderColor: 'var(--lps-line)', background: 'rgb(248 250 252 / 0.9)' }}>
                  {pick(step)}
                </span>
                {index < GUIDE.lessons.order.length - 1 && <ChevronLeft size={14} aria-hidden="true" className="lps-faint ltr:rotate-180" />}
              </li>
            ))}
          </ol>
          <Rules rules={GUIDE.lessons.rules} />
        </Panel>

        <Panel title={pick(GUIDE.stages.title)}>
          <Rules rules={GUIDE.stages.rules} first />
        </Panel>

        <Panel title={pick(GUIDE.release.title)}>
          <Rules rules={GUIDE.release.rules} first />
        </Panel>
      </div>

      <Panel title={pick(GUIDE.progress.title)}>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-4">
          {GUIDE.progress.items.map((item, index) => (
            <div key={index} className="rounded-xl border p-3" style={{ borderColor: 'var(--lps-line)' }}>
              <p className="font-semibold">{pick(item.title)}</p>
              <p className="mt-1 text-[12.5px] lps-muted">{pick(item.body)}</p>
            </div>
          ))}
        </div>
      </Panel>

      <Roles />

      <Panel title={pick(GUIDE.alerts.title)}>
        <p className="text-[13.5px] leading-relaxed lps-muted">{pick(GUIDE.alerts.body)}</p>
      </Panel>
    </div>
  );
}

function Rules({ rules, first = false }: { rules: Array<{ ar: string; en: string }>; first?: boolean }) {
  const pick = usePick();
  return (
    <ul className={first ? 'space-y-2' : 'mt-4 space-y-2 border-t pt-3'} style={{ borderColor: 'var(--lps-line)' }}>
      {rules.map((rule, index) => (
        <li key={index} className="flex gap-2 text-[13px]">
          <Check size={14} aria-hidden="true" className="mt-1 shrink-0" style={{ color: 'var(--lps-ok)' }} />
          <span>{pick(rule)}</span>
        </li>
      ))}
    </ul>
  );
}

function Ways() {
  const { t } = useI18n();
  const pick = usePick();
  const { data, loading } = useLpQuery<TemplatesResponse>(runPaths.templates);
  const templates = (data?.templates ?? []).filter((entry) => entry.current);
  const [picked, setPicked] = useState<string | null>(null);
  const current = templates.find((entry) => entry.scenario === picked) ?? templates.find((entry) => entry.scenario === 'EXPERT_NEW') ?? templates[0];

  return (
    <Panel
      title={pick(GUIDE.ways.title)}
      bodyClassName="p-0"
      action={
        templates.length > 0 && current ? (
          <Choice
            label={pick(GUIDE.ways.title)}
            value={current.scenario}
            onChange={setPicked}
            options={templates.map((entry) => ({ value: entry.scenario, label: t(`lp.scenarioShort.${entry.scenario}` as StringKey) }))}
          />
        ) : undefined
      }
    >
      <p className="px-4 pt-3 text-[12.5px] lps-muted">{pick(GUIDE.ways.body)}</p>
      {loading && !data ? (
        <LoadingRows rows={5} />
      ) : current?.current ? (
        <>
          <p className="px-4 pt-2 text-[13px] font-semibold">{t(`lp.scenarioHint.${current.scenario}` as StringKey)}</p>
          <ol className="mt-2">
            {current.current.summary.stages.map((stage, index) => {
              const roles = [...new Set(stage.tasks.flatMap((task) => [task.role, task.reviewerRole]).filter(Boolean))] as string[];
              return (
                <li key={stage.key} className="border-t px-4 py-3" style={{ borderColor: 'var(--lps-line)' }}>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="w-6 text-[12px] font-bold lps-faint">{index + 1}</span>
                    <span className="font-semibold">{pick(stage.label)}</span>
                    {stage.origin === 'PROPOSED' && <OriginBadge origin="PROPOSED" compact />}
                    {stage.after.length > 0 && (
                      <span className="text-[12px] lps-faint">
                        {t('lp.templates.after', { stages: stage.after.map((key) => t(`lp.stageKey.${key}` as StringKey)).join(t('lp.listSeparator')) })}
                      </span>
                    )}
                  </div>
                  {stage.description && <p className="ms-8 mt-0.5 text-[12.5px] lps-muted">{pick(stage.description)}</p>}
                  {roles.length > 0 && (
                    <p className="ms-8 mt-1 text-[12px] lps-faint">{roles.map((role) => t(`lp.role.${role}` as StringKey)).join(t('lp.listSeparator'))}</p>
                  )}
                </li>
              );
            })}
          </ol>
        </>
      ) : null}
    </Panel>
  );
}

function Roles() {
  const { t } = useI18n();
  const pick = usePick();
  return (
    <Panel title={pick(GUIDE.roles.title)}>
      <p className="mb-3 text-[13px] lps-muted">{pick(GUIDE.roles.body)}</p>
      <dl className="grid grid-cols-1 gap-x-6 gap-y-2 sm:grid-cols-2">
        {GUIDE.roles.order.map((role) => (
          <div key={role} className="border-b pb-2" style={{ borderColor: 'var(--lps-line)' }}>
            <dt className="text-[13px] font-semibold">{t(`lp.role.${role}` as StringKey)}</dt>
            <dd className="text-[12.5px] lps-muted">{t(`lp.roleHint.${role}` as StringKey)}</dd>
          </div>
        ))}
      </dl>
    </Panel>
  );
}
