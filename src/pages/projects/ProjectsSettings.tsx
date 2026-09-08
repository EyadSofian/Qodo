/**
 * Qodo Projects — the administration surface.
 *
 * Statuses, automation, webhooks and integrations, in one place with four tabs.
 * Each section is written to make the safety property visible rather than
 * assumed:
 *
 * • a retired status says it is retired rather than disappearing, because the
 *   records pointing at it still exist;
 * • a webhook secret is shown once, and the screen says so before it is gone;
 * • an unconfigured integration says *why* it is unconfigured, so nobody plans
 *   around a logo that does nothing.
 */

import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  ArrowLeft,
  ArrowRight,
  Cable,
  CircleDot,
  Copy,
  Database,
  Plug,
  RotateCcw,
  Settings2,
  ShieldCheck,
  Trash2,
  Webhook,
  Workflow,
} from 'lucide-react';
import { useI18n } from '../../lib/i18n';
import { errorMessage } from '../../lib/api';
import { demoDataApi, projectAdminApi, type DemoStatus } from '../../lib/projects/api';
import type {
  AutomationRule,
  AutomationRun,
  IntegrationEntry,
  StatusDefinition,
  WebhookEndpoint,
} from '../../lib/projects/types';
import { useProjectPermissions } from '../../lib/projects/useProjectPermissions';
import { EmptyState, Field, Modal, Segmented, Spinner, useToast } from '../../components/ui';
import { SectionCard } from '../../components/projects/ui';

type Tab = 'statuses' | 'automation' | 'webhooks' | 'integrations' | 'demo';

export function ProjectsSettings() {
  const { t, dir } = useI18n();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const { can } = useProjectPermissions();

  const tab = (params.get('tab') as Tab) || 'statuses';
  const BackArrow = dir === 'rtl' ? ArrowRight : ArrowLeft;

  const setTab = (next: Tab) => {
    const updated = new URLSearchParams(params);
    updated.set('tab', next);
    setParams(updated, { replace: true });
  };

  return (
    <div className="mx-auto w-full max-w-[1100px] px-4 py-5 sm:px-6">
      <header className="mb-4">
        <button type="button" onClick={() => navigate('/projects')} className="btn-quiet btn-sm -ms-3 mb-1.5">
          <BackArrow size={15} />
          {t('projects.backToList')}
        </button>
        <h1 className="flex items-center gap-2 text-xl font-bold text-ink">
          <Settings2 size={22} className="text-brand-500" />
          {t('projectSettings.title')}
        </h1>
        <p className="mt-1 text-sm text-ink-muted">{t('projectSettings.subtitle')}</p>
      </header>

      <Segmented
        value={tab}
        onChange={setTab}
        className="mb-4"
        options={[
          { value: 'statuses' as Tab, label: t('projectSettings.tab.statuses') },
          { value: 'automation' as Tab, label: t('projectSettings.tab.automation') },
          { value: 'webhooks' as Tab, label: t('projectSettings.tab.webhooks') },
          { value: 'integrations' as Tab, label: t('projectSettings.tab.integrations') },
          { value: 'demo' as Tab, label: t('demo.title') },
        ]}
      />

      {tab === 'statuses' && <Statuses canManage={can('customization.manage')} />}
      {tab === 'automation' && <Automation canManage={can('automation.manage')} />}
      {tab === 'webhooks' && <Webhooks canManage={can('automation.manage')} />}
      {tab === 'integrations' && <Integrations canManage={can('integration.manage')} />}
      {tab === 'demo' && <DemoData />}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Statuses                                                             */
/* ------------------------------------------------------------------ */

function Statuses({ canManage }: { canManage: boolean }) {
  const { t, lang, pick } = useI18n();
  const toast = useToast();
  const [statuses, setStatuses] = useState<StatusDefinition[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const { statuses: loaded } = await projectAdminApi.statuses();
      setStatuses(loaded);
    } catch (caught) {
      toast.push(errorMessage(caught, lang), 'bad');
    } finally {
      setLoading(false);
    }
  }, [lang, toast]);

  useEffect(() => {
    void load();
  }, [load]);

  const retire = async (status: StatusDefinition) => {
    try {
      await projectAdminApi.updateStatus(status.id, { isActive: !status.isActive });
      await load();
    } catch (caught) {
      toast.push(errorMessage(caught, lang), 'bad');
    }
  };

  if (loading) return <Loading />;

  const byModule = statuses.reduce<Record<string, StatusDefinition[]>>((grouped, status) => {
    (grouped[status.moduleKey] ??= []).push(status);
    return grouped;
  }, {});

  return (
    <section className="grid gap-4">
      <p className="text-[12px] leading-relaxed text-ink-muted">{t('statuses.hint')}</p>

      {Object.entries(byModule).map(([moduleKey, moduleStatuses]) => (
        <div key={moduleKey} className="card p-4">
          <h2 className="mb-2 text-sm font-bold text-ink">
            {t(`reports.module.${moduleKey}` as Parameters<typeof t>[0]) === `reports.module.${moduleKey}`
              ? moduleKey
              : t(`reports.module.${moduleKey}` as Parameters<typeof t>[0])}
          </h2>
          <ul className="divide-y divide-surface-line">
            {moduleStatuses.map((status) => (
              <li key={status.id} className="flex flex-wrap items-center gap-3 py-2.5">
                <span
                  aria-hidden="true"
                  className="h-3 w-3 shrink-0 rounded-full"
                  style={{ backgroundColor: status.color }}
                />
                <span className={`flex-1 text-[13px] ${status.isActive ? 'text-ink' : 'text-ink-faint line-through'}`}>
                  {pick(status.label)}
                </span>
                {/* The category, not the label, is what reports branch on — so
                    it is shown rather than hidden behind the colour. */}
                <span className="chip bg-surface-sunken text-[11px] text-ink-muted">
                  {t(`statuses.category.${status.category}` as Parameters<typeof t>[0])}
                </span>
                {!status.isActive && (
                  <span className="chip bg-surface-sunken text-[11px] text-ink-faint">{t('statuses.retired')}</span>
                )}
                {canManage && (
                  <button type="button" className="btn-quiet btn-sm" onClick={() => void retire(status)}>
                    {status.isActive ? t('statuses.retire') : t('statuses.restore')}
                  </button>
                )}
              </li>
            ))}
          </ul>
        </div>
      ))}

      <p className="text-[11.5px] leading-relaxed text-ink-faint">{t('statuses.categoryHint')}</p>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* Automation                                                           */
/* ------------------------------------------------------------------ */

function Automation({ canManage }: { canManage: boolean }) {
  const { t, lang } = useI18n();
  const toast = useToast();
  const [rules, setRules] = useState<AutomationRule[]>([]);
  const [runs, setRuns] = useState<AutomationRun[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const [ruleResult, runResult] = await Promise.all([
        projectAdminApi.rules('task'),
        projectAdminApi.runs(25).catch(() => ({ runs: [] as AutomationRun[] })),
      ]);
      setRules(ruleResult.rules);
      setRuns(runResult.runs);
    } catch (caught) {
      toast.push(errorMessage(caught, lang), 'bad');
    } finally {
      setLoading(false);
    }
  }, [lang, toast]);

  useEffect(() => {
    void load();
  }, [load]);

  if (loading) return <Loading />;

  return (
    <section className="grid gap-4">
      {rules.length === 0 ? (
        <div className="card">
          <EmptyState
            icon={<Workflow size={32} />}
            title={t('automation.empty')}
            body={t('automation.emptyHint')}
          />
        </div>
      ) : (
        <ul className="card divide-y divide-surface-line">
          {rules.map((rule) => (
            <li key={rule.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
              <div className="min-w-0 flex-1">
                <p className="truncate text-[13.5px] font-semibold text-ink">{rule.name}</p>
                <p className="mt-0.5 text-[11.5px] text-ink-muted">
                  {t('automation.trigger')}: {rule.trigger} · {t('automation.actions', { n: rule.actions.length })}
                </p>
              </div>
              <span
                className={`chip ${rule.isActive ? 'bg-status-okBg text-status-ok' : 'bg-surface-sunken text-ink-muted'}`}
              >
                {rule.isActive ? t('automation.enabled') : t('automation.disabled')}
              </span>
              {canManage && (
                <button
                  type="button"
                  className="btn-quiet btn-sm"
                  onClick={async () => {
                    try {
                      await projectAdminApi.setRuleActive(rule.id, !rule.isActive);
                      await load();
                    } catch (caught) {
                      toast.push(errorMessage(caught, lang), 'bad');
                    }
                  }}
                >
                  {rule.isActive ? t('automation.disabled') : t('automation.enabled')}
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      <section className="card p-4">
        <h2 className="mb-2 text-sm font-bold text-ink">{t('automation.runs')}</h2>
        {runs.length === 0 ? (
          <p className="text-[13px] text-ink-muted">{t('automation.runsEmpty')}</p>
        ) : (
          <ol className="divide-y divide-surface-line">
            {runs.map((run) => (
              <li key={run.id} className="flex flex-wrap items-center gap-3 py-2">
                <span
                  className={`chip text-[11px] ${
                    run.status === 'failed'
                      ? 'bg-status-badBg text-status-bad'
                      : run.status === 'applied'
                        ? 'bg-status-okBg text-status-ok'
                        : 'bg-surface-sunken text-ink-muted'
                  }`}
                >
                  {t(`automation.status.${run.status}` as Parameters<typeof t>[0])}
                </span>
                <span className="flex-1 truncate text-[12px] text-ink-muted">
                  {run.entity_type} · {run.trigger ?? '—'}
                  {/* A failure that says nothing is a failure nobody can fix. */}
                  {run.error && <span className="ms-2 text-status-bad">{run.error}</span>}
                </span>
                <time dateTime={run.ran_at} className="shrink-0 text-[11px] tabular-nums text-ink-faint">
                  {new Date(run.ran_at).toLocaleString(lang === 'ar' ? 'ar-EG' : 'en-GB')}
                </time>
              </li>
            ))}
          </ol>
        )}
      </section>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* Webhooks                                                             */
/* ------------------------------------------------------------------ */

function Webhooks({ canManage }: { canManage: boolean }) {
  const { t, lang } = useI18n();
  const toast = useToast();
  const [endpoints, setEndpoints] = useState<WebhookEndpoint[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [revealed, setRevealed] = useState<{ name: string; secret: string } | null>(null);

  const load = useCallback(async () => {
    try {
      const { endpoints: loaded } = await projectAdminApi.webhooks();
      setEndpoints(loaded);
    } catch (caught) {
      toast.push(errorMessage(caught, lang), 'bad');
    } finally {
      setLoading(false);
    }
  }, [lang, toast]);

  useEffect(() => {
    void load();
  }, [load]);

  if (loading) return <Loading />;

  return (
    <section className="grid gap-3">
      {canManage && (
        <div className="flex justify-end">
          <button type="button" className="btn-primary btn-sm" onClick={() => setCreating(true)}>
            <Webhook size={15} />
            {t('webhooks.new')}
          </button>
        </div>
      )}

      {endpoints.length === 0 ? (
        <div className="card">
          <EmptyState icon={<Webhook size={32} />} title={t('webhooks.empty')} body={t('webhooks.emptyHint')} />
        </div>
      ) : (
        <ul className="card divide-y divide-surface-line">
          {endpoints.map((endpoint) => (
            <li key={endpoint.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
              <div className="min-w-0 flex-1">
                <p className="truncate text-[13.5px] font-semibold text-ink">{endpoint.name}</p>
                <p className="mt-0.5 truncate font-mono text-[11.5px] text-ink-muted">{endpoint.url}</p>
                {endpoint.disabledReason && (
                  <p className="mt-0.5 text-[11.5px] text-status-bad">
                    {t('webhooks.disabledFor', { reason: endpoint.disabledReason })}
                  </p>
                )}
              </div>
              {/* Always the mask. There is no route that returns the value. */}
              <span className="chip bg-surface-sunken font-mono text-[11px] text-ink-faint">{endpoint.secret}</span>
              {canManage && (
                <button
                  type="button"
                  className="btn-quiet btn-sm"
                  onClick={async () => {
                    try {
                      await projectAdminApi.setWebhookActive(endpoint.id, !endpoint.isActive);
                      await load();
                    } catch (caught) {
                      toast.push(errorMessage(caught, lang), 'bad');
                    }
                  }}
                >
                  {endpoint.isActive ? t('automation.disabled') : t('automation.enabled')}
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      <WebhookDialog
        open={creating}
        onClose={() => setCreating(false)}
        onCreated={(endpoint) => {
          setCreating(false);
          setRevealed({ name: endpoint.name, secret: endpoint.secret });
          void load();
        }}
      />

      {/* The one moment the secret exists in the UI. Said plainly, because
          there is genuinely no second chance. */}
      <Modal open={revealed !== null} onClose={() => setRevealed(null)} title={revealed?.name ?? ''}>
        <p className="mb-3 rounded-xl bg-status-warnBg px-3 py-2 text-[13px] font-semibold text-accent-700">
          {t('webhooks.secretOnce')}
        </p>
        <div className="flex items-center gap-2">
          <code className="flex-1 overflow-x-auto rounded-xl bg-surface-sunken px-3 py-2 font-mono text-[12px] text-ink">
            {revealed?.secret}
          </code>
          <button
            type="button"
            className="btn-ghost btn-sm"
            onClick={() => {
              navigator.clipboard?.writeText(revealed?.secret ?? '').catch(() => {});
            }}
          >
            <Copy size={15} />
          </button>
        </div>
      </Modal>
    </section>
  );
}

function WebhookDialog({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: (endpoint: { name: string; secret: string }) => void;
}) {
  const { t, lang } = useI18n();
  const [name, setName] = useState('');
  const [url, setUrl] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) return;
    setName('');
    setUrl('');
    setError(null);
  }, [open]);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!name.trim() || !url.trim() || saving) return;
    setSaving(true);
    setError(null);
    try {
      const { endpoint } = await projectAdminApi.createWebhook({ name: name.trim(), url: url.trim() });
      onCreated(endpoint);
    } catch (caught) {
      setError(errorMessage(caught, lang));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t('webhooks.new')}
      footer={
        <>
          <button type="button" className="btn-ghost btn-sm" onClick={onClose}>
            {t('common.cancel')}
          </button>
          <button
            type="submit"
            form="webhook-create"
            className="btn-primary btn-sm"
            disabled={!name.trim() || !url.trim() || saving}
          >
            {saving && <Spinner size={15} />}
            {t('common.add')}
          </button>
        </>
      }
    >
      <form id="webhook-create" onSubmit={submit} className="grid gap-4">
        {error && (
          <p role="alert" className="rounded-xl bg-status-badBg px-3 py-2 text-[13px] font-semibold text-status-bad">
            {error}
          </p>
        )}
        <Field label={t('projects.field.name')} required>
          <input className="field" value={name} onChange={(e) => setName(e.target.value)} autoFocus required />
        </Field>
        <Field label={t('webhooks.url')} required>
          <input
            type="url"
            className="field font-mono text-[13px]"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://"
            required
          />
        </Field>
      </form>
    </Modal>
  );
}

/* ------------------------------------------------------------------ */
/* Integrations                                                         */
/* ------------------------------------------------------------------ */

function Integrations({ canManage }: { canManage: boolean }) {
  const { t, lang } = useI18n();
  const toast = useToast();
  const [entries, setEntries] = useState<IntegrationEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [connecting, setConnecting] = useState<IntegrationEntry | null>(null);

  const load = useCallback(async () => {
    try {
      const { integrations } = await projectAdminApi.integrations();
      setEntries(integrations);
    } catch (caught) {
      toast.push(errorMessage(caught, lang), 'bad');
    } finally {
      setLoading(false);
    }
  }, [lang, toast]);

  useEffect(() => {
    void load();
  }, [load]);

  if (loading) return <Loading />;

  const firstParty = entries.filter((entry) => entry.kind === 'first_party');
  const adapters = entries.filter((entry) => entry.kind === 'adapter');

  const Row = ({ entry }: { entry: IntegrationEntry }) => (
    <li className="flex flex-wrap items-center gap-3 px-4 py-3">
      <Plug size={16} className="shrink-0 text-ink-faint" aria-hidden="true" />
      <div className="min-w-0 flex-1">
        <p className="text-[13.5px] font-semibold text-ink">{entry.label}</p>
        <p className="mt-0.5 text-[11.5px] text-ink-muted">{entry.capabilities.join(' · ')}</p>
        {entry.lastError && <p className="mt-0.5 text-[11.5px] text-status-bad">{entry.lastError}</p>}
      </div>
      <span
        className={`chip ${
          entry.status === 'connected'
            ? 'bg-status-okBg text-status-ok'
            : entry.status === 'error'
              ? 'bg-status-badBg text-status-bad'
              : 'bg-surface-sunken text-ink-muted'
        }`}
      >
        <CircleDot size={11} aria-hidden="true" />
        {t(`integrations.status.${entry.status}` as Parameters<typeof t>[0])}
      </span>
      {canManage && entry.needsCredentials && (
        <button
          type="button"
          className="btn-quiet btn-sm"
          onClick={async () => {
            if (entry.status === 'connected') {
              try {
                await projectAdminApi.disconnect(entry.provider);
                await load();
              } catch (caught) {
                toast.push(errorMessage(caught, lang), 'bad');
              }
            } else {
              setConnecting(entry);
            }
          }}
        >
          {entry.status === 'connected' ? t('integrations.disconnect') : t('integrations.connect')}
        </button>
      )}
    </li>
  );

  return (
    <section className="grid gap-4">
      <div className="card">
        <h2 className="border-b border-surface-line px-4 py-2.5 text-[12.5px] font-bold uppercase tracking-wide text-ink-muted">
          {t('integrations.firstParty')}
        </h2>
        <ul className="divide-y divide-surface-line">
          {firstParty.map((entry) => (
            <Row key={entry.provider} entry={entry} />
          ))}
        </ul>
      </div>

      <div className="card">
        <h2 className="border-b border-surface-line px-4 py-2.5 text-[12.5px] font-bold uppercase tracking-wide text-ink-muted">
          <Cable size={13} className="me-1.5 inline" aria-hidden="true" />
          {t('integrations.adapters')}
        </h2>
        <ul className="divide-y divide-surface-line">
          {adapters.map((entry) => (
            <Row key={entry.provider} entry={entry} />
          ))}
        </ul>
      </div>

      {/* Said once, at the bottom, rather than on every row: the adapters are
          real and inert, and that is a deliberate state rather than a gap. */}
      <p className="text-[11.5px] leading-relaxed text-ink-faint">{t('integrations.notConfiguredHint')}</p>

      <ConnectDialog
        entry={connecting}
        onClose={() => setConnecting(null)}
        onConnected={() => {
          setConnecting(null);
          void load();
        }}
      />
    </section>
  );
}

function ConnectDialog({
  entry,
  onClose,
  onConnected,
}: {
  entry: IntegrationEntry | null;
  onClose: () => void;
  onConnected: () => void;
}) {
  const { t, lang } = useI18n();
  const [credentials, setCredentials] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!entry) {
      setCredentials('');
      setError(null);
    }
  }, [entry]);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!entry || !credentials.trim() || saving) return;
    setSaving(true);
    try {
      await projectAdminApi.connect({ provider: entry.provider, credentials: credentials.trim() });
      onConnected();
    } catch (caught) {
      setError(errorMessage(caught, lang));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open={entry !== null}
      onClose={onClose}
      title={entry?.label ?? ''}
      footer={
        <>
          <button type="button" className="btn-ghost btn-sm" onClick={onClose}>
            {t('common.cancel')}
          </button>
          <button
            type="submit"
            form="integration-connect"
            className="btn-primary btn-sm"
            disabled={!credentials.trim() || saving}
          >
            {saving && <Spinner size={15} />}
            {t('integrations.connect')}
          </button>
        </>
      }
    >
      <form id="integration-connect" onSubmit={submit} className="grid gap-3">
        {error && (
          <p role="alert" className="rounded-xl bg-status-badBg px-3 py-2 text-[13px] font-semibold text-status-bad">
            {error}
          </p>
        )}
        <Field label={t('integrations.credentials')} hint={t('integrations.credentialsHint')} required>
          <input
            type="password"
            className="field font-mono text-[13px]"
            value={credentials}
            onChange={(e) => setCredentials(e.target.value)}
            autoFocus
            required
            autoComplete="off"
          />
        </Field>
      </form>
    </Modal>
  );
}

function Loading() {
  return (
    <div className="card grid place-items-center py-16">
      <Spinner size={22} className="text-brand-500" />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Demo data                                                            */
/* ------------------------------------------------------------------ */

/**
 * Load, refresh or remove the demo set.
 *
 * The three buttons are not equivalent and the screen says so rather than
 * leaving the reader to work it out:
 *
 *   • **Load** builds it. Pressing it twice is safe — the server treats the
 *     second press as a no-op — and the panel says "already loaded" rather
 *     than claiming to have done the work again.
 *   • **Reset** removes and rebuilds. It exists because every date in the demo
 *     is an offset from the day it was loaded, so a set from last quarter shows
 *     a project that was supposed to be starting as already finished.
 *   • **Remove** takes it away and leaves the workspace as it was.
 *
 * The destructive two ask first. Not a reflex — a confirmation on every button
 * teaches people to dismiss confirmations — but because both delete rows, and
 * the dialog is the only place the reader is told *what* is deleted and what
 * is not.
 *
 * The whole panel is hidden when the server says the caller may not manage it:
 * the endpoints answer 403 for anybody without both the Projects administrator
 * set and the workspace admin role, and a button that always fails is worse
 * than no button.
 */
function DemoData() {
  const { t, lang } = useI18n();
  const toast = useToast();

  const [status, setStatus] = useState<DemoStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [forbidden, setForbidden] = useState(false);
  const [busy, setBusy] = useState<null | 'load' | 'reset' | 'remove'>(null);
  const [confirming, setConfirming] = useState<null | 'reset' | 'remove'>(null);

  const load = useCallback(async () => {
    try {
      setStatus(await demoDataApi.status());
      setForbidden(false);
    } catch (caught) {
      // A 403 here is the expected answer for a project manager, not a fault.
      // It hides the panel instead of shouting.
      if ((caught as { status?: number })?.status === 403) setForbidden(true);
      else toast.push(errorMessage(caught, lang), 'bad');
    } finally {
      setLoading(false);
    }
  }, [lang, toast]);

  useEffect(() => {
    void load();
  }, [load]);

  const run = async (action: 'load' | 'reset' | 'remove') => {
    setBusy(action);
    setConfirming(null);
    try {
      if (action === 'load') {
        const result = await demoDataApi.load();
        toast.push(result.alreadyLoaded ? t('demo.alreadyLoaded') : t('demo.loaded'), 'ok');
      } else if (action === 'reset') {
        await demoDataApi.reset();
        toast.push(t('demo.wasReset'), 'ok');
      } else {
        const result = await demoDataApi.remove();
        toast.push(t('demo.removed'), 'ok');
        // A refusal is not a failure, but it is the one outcome somebody has to
        // act on, so it is said out loud rather than buried in the response.
        if (result.skipped.length > 0) toast.push(t('demo.someSkipped', { n: result.skipped.length }), 'bad');
      }
      await load();
    } catch (caught) {
      toast.push(errorMessage(caught, lang), 'bad');
    } finally {
      setBusy(null);
    }
  };

  if (loading) return <Loading />;

  if (forbidden) {
    return (
      <div className="card">
        <EmptyState
          icon={<ShieldCheck size={34} />}
          title={t('demo.title')}
          body={t('demo.forbidden')}
        />
      </div>
    );
  }

  if (status && !status.enabled) {
    return (
      <div className="card">
        <EmptyState icon={<Database size={34} />} title={t('demo.title')} body={t('demo.disabled')} />
      </div>
    );
  }

  const counts = status?.willCreate;

  return (
    <div className="grid gap-4">
      <SectionCard
        title={
          <span className="inline-flex items-center gap-2">
            <Database size={16} className="text-brand-500" aria-hidden="true" />
            {t('demo.title')}
          </span>
        }
        hint={t('demo.subtitle')}
      >
        <div className="grid gap-4">
          {/* What is there now. A batch that was loaded and then had its
              projects deleted by hand reports the difference rather than
              claiming to be intact. */}
          <div
            className={`rounded-xl border px-4 py-3 ${
              status?.loaded
                ? 'border-status-ok/30 bg-status-okBg/50'
                : 'border-surface-line bg-surface-sunken'
            }`}
          >
            <p className="text-[13px] font-bold text-ink">
              {status?.loaded ? t('demo.isLoaded') : t('demo.notLoaded')}
            </p>
            {status?.loaded && status.batch && (
              <p className="mt-1 text-[12px] text-ink-muted">
                {t('demo.loadedSummary', {
                  projects: status.batch.liveProjects,
                  people: status.batch.counts.people,
                  tasks: status.batch.counts.tasks,
                })}
                {' · '}
                <span className="ltr">{String(status.batch.loadedAt).slice(0, 10)}</span>
              </p>
            )}
            {!status?.loaded && counts && (
              <p className="mt-1 text-[12px] leading-relaxed text-ink-muted">
                {t('demo.willCreate', {
                  projects: counts.projects,
                  tasks: counts.tasks,
                  people: counts.people,
                  issues: counts.issues,
                  timeEntries: counts.timeEntries,
                })}
              </p>
            )}
          </div>

          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className="btn-primary btn-sm"
              disabled={busy !== null}
              onClick={() => void run('load')}
            >
              {busy === 'load' ? <Spinner size={15} /> : <Database size={15} />}
              {busy === 'load' ? t('demo.loading') : t('demo.load')}
            </button>

            <button
              type="button"
              className="btn-ghost btn-sm"
              disabled={busy !== null || !status?.loaded}
              onClick={() => setConfirming('reset')}
            >
              {busy === 'reset' ? <Spinner size={15} /> : <RotateCcw size={15} />}
              {busy === 'reset' ? t('demo.resetting') : t('demo.reset')}
            </button>

            <button
              type="button"
              className="btn-danger btn-sm"
              disabled={busy !== null || !status?.loaded}
              onClick={() => setConfirming('remove')}
            >
              {busy === 'remove' ? <Spinner size={15} /> : <Trash2 size={15} />}
              {busy === 'remove' ? t('demo.removing') : t('demo.remove')}
            </button>
          </div>

          {/* Why this is safe to press. Written out rather than assumed,
              because an administrator sitting in front of production is
              entitled to know what a button labelled "load demo data" is
              about to do to their database. */}
          <div className="rounded-xl border border-surface-line bg-white p-4">
            <h3 className="mb-2 flex items-center gap-1.5 text-[13px] font-bold text-ink">
              <ShieldCheck size={15} className="text-status-ok" aria-hidden="true" />
              {t('demo.safetyTitle')}
            </h3>
            <ul className="grid gap-2 text-[12px] leading-relaxed text-ink-muted">
              <li className="flex gap-2">
                <span aria-hidden="true" className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-ink-faint" />
                {t('demo.safetyIsolation')}
              </li>
              <li className="flex gap-2">
                <span aria-hidden="true" className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-ink-faint" />
                {t('demo.safetyAccounts')}
              </li>
              <li className="flex gap-2">
                <span aria-hidden="true" className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-ink-faint" />
                {t('demo.safetyTasks')}
              </li>
              <li className="flex gap-2">
                <span aria-hidden="true" className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-ink-faint" />
                {t('demo.safetyIntegrations')}
              </li>
            </ul>
          </div>
        </div>
      </SectionCard>

      <Modal
        open={confirming !== null}
        onClose={() => setConfirming(null)}
        title={confirming === 'reset' ? t('demo.reset') : t('demo.remove')}
        footer={
          <>
            <button type="button" className="btn-ghost btn-sm" onClick={() => setConfirming(null)}>
              {t('common.cancel')}
            </button>
            <button
              type="button"
              className={confirming === 'reset' ? 'btn-primary btn-sm' : 'btn-danger btn-sm'}
              onClick={() => void run(confirming === 'reset' ? 'reset' : 'remove')}
            >
              {confirming === 'reset' ? t('demo.reset') : t('demo.remove')}
            </button>
          </>
        }
      >
        <p className="text-sm leading-relaxed text-ink-muted">
          {confirming === 'reset' ? t('demo.confirmReset') : t('demo.confirmRemove')}
        </p>
      </Modal>
    </div>
  );
}
