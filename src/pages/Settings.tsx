import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Activity,
  Database,
  ExternalLink,
  Eye,
  EyeOff,
  Github,
  Link2,
  Pencil,
  Plus,
  Trash2,
} from 'lucide-react';
import { api, errorMessage } from '../lib/api';
import { useAuth } from '../lib/auth';
import { useI18n, type StringKey } from '../lib/i18n';
import { useWorkspace } from '../lib/workspace';
import { PERMISSIONS } from '@shared/permissions';
import { ICON_KEYS, ModuleIcon } from '../components/ModuleIcon';
import { Avatar, EmptyState, Field, Modal, Segmented, Spinner, useToast } from '../components/ui';
import { cx, timeAgo } from '../lib/utils';
import type { ActivityEntry, ActorMap, EmbedMode, WorkspaceApp } from '../lib/types';

const TILE_COLORS = [
  '#1D6FB8', '#0B2545', '#F5821F', '#0EA5A5',
  '#6366F1', '#16A34A', '#7C3AED', '#DC2626',
];

export function Settings() {
  const { can } = useAuth();
  const { t } = useI18n();
  const [tab, setTab] = useState<'apps' | 'activity' | 'system'>('apps');

  if (!can(PERMISSIONS.SETTINGS_MANAGE)) {
    return (
      <div className="mx-auto max-w-md px-5 py-16">
        <EmptyState title={t('settings.noPermission')} body={t('settings.noPermissionBody')} />
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-[1100px] px-4 py-6 sm:px-6 sm:py-8">
      <header className="mb-5">
        <h1 className="text-[20px] font-extrabold text-ink sm:text-[24px]">{t('settings.title')}</h1>
        <p className="mt-0.5 text-[13px] text-ink-muted">{t('settings.subtitle')}</p>
      </header>

      <Segmented
        className="mb-4 w-fit"
        value={tab}
        onChange={setTab}
        options={[
          { value: 'apps', label: t('settings.tabApps') },
          { value: 'activity', label: t('settings.tabActivity') },
          { value: 'system', label: t('settings.tabSystem') },
        ]}
      />

      {tab === 'apps' && <AppsSettings />}
      {tab === 'activity' && <ActivityLog />}
      {tab === 'system' && <SystemInfo />}
    </div>
  );
}

/* ── Apps ────────────────────────────────────────────────────────── */

function AppsSettings() {
  const { reloadApps } = useWorkspace();
  const { t, lang } = useI18n();
  const { push } = useToast();
  const [editing, setEditing] = useState<WorkspaceApp | null>(null);
  const [open, setOpen] = useState(false);
  const [apps, setApps] = useState<WorkspaceApp[]>([]);

  /**
   * Its own list, not the workspace one. The shared list is what the launcher
   * grid draws, so it is filtered down to what you can open — which is exactly
   * the wrong list for the screen whose job is to bring a hidden app back.
   */
  const load = useCallback(async () => {
    const data = await api.get<{ apps: WorkspaceApp[] }>('/apps?includeHidden=1');
    setApps(data.apps);
  }, []);

  useEffect(() => {
    load().catch(() => setApps([]));
  }, [load]);

  // Both lists: this screen keeps the hidden rows, the chrome drops them.
  const refresh = useCallback(async () => {
    await Promise.all([load(), reloadApps()]);
  }, [load, reloadApps]);

  const toggle = async (app: WorkspaceApp) => {
    try {
      await api.patch(`/apps/${app.id}`, { enabled: !app.enabled });
      await refresh();
      push(app.enabled ? t('settings.appHidden') : t('settings.appShown'));
    } catch (err) {
      push(errorMessage(err, lang), 'bad');
    }
  };

  const remove = async (app: WorkspaceApp) => {
    if (!window.confirm(t('settings.confirmRemoveApp', { name: app.nameAr }))) return;
    try {
      await api.delete(`/apps/${app.id}`);
      await refresh();
      push(t('settings.appRemoved'));
    } catch (err) {
      push(errorMessage(err, lang), 'bad');
    }
  };

  const embedLabel: Record<string, StringKey> = {
    auto: 'settings.openAuto',
    iframe: 'settings.openIframe',
    newtab: 'settings.openNewTab',
    internal: 'settings.openInternal',
  };

  return (
    <>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <p className="text-[13px] text-ink-muted">{t('settings.appsHint')}</p>
        <button
          type="button"
          onClick={() => {
            setEditing(null);
            setOpen(true);
          }}
          className="btn-primary btn-sm gap-1.5"
        >
          <Plus size={16} />
          {t('settings.newApp')}
        </button>
      </div>

      <ul className="grid gap-2">
        {apps.map((app) => (
          <li
            key={app.id}
            className={cx(
              'card flex flex-wrap items-center gap-3 px-4 py-3',
              !app.enabled && 'opacity-60'
            )}
          >
            <ModuleIcon name={app.icon} color={app.color} size={40} />

            <div className="min-w-0 flex-1">
              <p className="flex flex-wrap items-center gap-2">
                <span className="text-[14px] font-bold text-ink">
                  {lang === 'en' && app.nameEn ? app.nameEn : app.nameAr}
                </span>
                {app.builtin && <span className="chip bg-brand-50 text-brand-600">{t('settings.builtin')}</span>}
                {!app.enabled && <span className="chip bg-surface-sunken text-ink-muted">{t('settings.hidden')}</span>}
              </p>
              <p className="ltr mt-0.5 truncate text-[12px] text-ink-muted">
                {app.kind === 'internal' ? `${app.url} (${t('settings.internal')})` : app.url}
              </p>
            </div>

            <span className="hidden text-[11.5px] text-ink-faint sm:block">
              {t(embedLabel[app.embed] ?? 'settings.openAuto')}
            </span>

            <div className="flex items-center gap-1">
              {app.repo && (
                <a
                  href={app.repo}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="btn-quiet !min-h-9 rounded-lg px-2"
                  title={t('frame.repo')}
                >
                  <Github size={15} />
                </a>
              )}
              {app.kind === 'external' && (
                <a
                  href={app.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="btn-quiet !min-h-9 rounded-lg px-2"
                  title={t('common.openNewTab')}
                >
                  <ExternalLink size={15} />
                </a>
              )}
              <button
                type="button"
                onClick={() => toggle(app)}
                className={cx(
                  'btn-quiet !min-h-9 rounded-lg px-2',
                  !app.enabled && 'text-brand-500 hover:bg-brand-50'
                )}
                title={app.enabled ? t('settings.hideFromGrid') : t('settings.showInGrid')}
                aria-label={app.enabled ? t('settings.hideFromGrid') : t('settings.showInGrid')}
              >
                {app.enabled ? <Eye size={15} /> : <EyeOff size={15} />}
              </button>
              <button
                type="button"
                onClick={() => {
                  setEditing(app);
                  setOpen(true);
                }}
                className="btn-quiet !min-h-9 rounded-lg px-2"
                title={t('common.edit')}
              >
                <Pencil size={15} />
              </button>
              {!app.builtin && (
                <button
                  type="button"
                  onClick={() => remove(app)}
                  className="btn-quiet !min-h-9 rounded-lg px-2 text-status-bad hover:bg-status-badBg"
                  title={t('common.delete')}
                >
                  <Trash2 size={15} />
                </button>
              )}
            </div>
          </li>
        ))}
      </ul>

      <AppDialog
        open={open}
        onClose={() => setOpen(false)}
        app={editing}
        onSaved={refresh}
      />
    </>
  );
}

function AppDialog({
  open,
  onClose,
  app,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  app: WorkspaceApp | null;
  onSaved: () => Promise<void>;
}) {
  const { t, lang } = useI18n();
  const { push } = useToast();
  const [nameAr, setNameAr] = useState('');
  const [nameEn, setNameEn] = useState('');
  const [descAr, setDescAr] = useState('');
  const [url, setUrl] = useState('');
  const [repo, setRepo] = useState('');
  const [icon, setIcon] = useState<string>('grid');
  const [color, setColor] = useState(TILE_COLORS[0]);
  const [embed, setEmbed] = useState<EmbedMode>('auto');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setError('');
    setNameAr(app?.nameAr ?? '');
    setNameEn(app?.nameEn ?? '');
    setDescAr(app?.descAr ?? '');
    setUrl(app?.url ?? 'https://');
    setRepo(app?.repo ?? '');
    setIcon(app?.icon ?? 'grid');
    setColor(app?.color ?? TILE_COLORS[0]);
    setEmbed(app?.embed === 'internal' ? 'auto' : (app?.embed ?? 'auto'));
  }, [open, app]);

  const isInternal = app?.kind === 'internal';

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError('');
    if (!nameAr.trim()) return setError(t('settings.nameAr'));

    setSaving(true);
    const payload: Record<string, unknown> = {
      nameAr: nameAr.trim(),
      nameEn: nameEn.trim(),
      descAr: descAr.trim(),
      repo: repo.trim() || null,
      icon,
      color,
    };
    // Built-in modules are React routes — the API ignores url/embed for them,
    // and sending them anyway would just be noise.
    if (!isInternal) {
      payload.url = url.trim();
      payload.embed = embed;
    }

    try {
      if (app) await api.patch(`/apps/${app.id}`, payload);
      else await api.post('/apps', payload);
      await onSaved();
      push(app ? t('settings.appUpdated') : t('settings.appAdded'));
      onClose();
    } catch (err) {
      setError(errorMessage(err, lang));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={app ? `${t('common.edit')}: ${app.nameAr}` : t('settings.newApp')}
      footer={
        <>
          <button type="button" onClick={onClose} className="btn-ghost btn-sm">
            {t('common.cancel')}
          </button>
          <button type="submit" form="app-form" className="btn-primary btn-sm" disabled={saving}>
            {saving && <Spinner size={15} />}
            {app ? t('common.save') : t('common.add')}
          </button>
        </>
      }
    >
      <form id="app-form" onSubmit={submit} className="grid gap-3.5">
        <div className="flex items-center gap-3 rounded-xl bg-surface-sunken px-3 py-3">
          <ModuleIcon name={icon} color={color} size={52} />
          <div className="min-w-0">
            <p className="text-[14px] font-bold text-ink">{nameAr || t('settings.appNamePreview')}</p>
            <p className="text-[12px] text-ink-muted">{descAr || t('settings.descPreview')}</p>
          </div>
        </div>

        <div className="grid gap-3.5 sm:grid-cols-2">
          <Field label={t('settings.nameAr')} required>
            <input className="field" value={nameAr} onChange={(e) => setNameAr(e.target.value)} required />
          </Field>
          <Field label={t('settings.nameEn')}>
            <input className="field ltr text-start" value={nameEn} onChange={(e) => setNameEn(e.target.value)} />
          </Field>
        </div>

        <Field label={t('settings.shortDesc')}>
          <input className="field" value={descAr} onChange={(e) => setDescAr(e.target.value)} />
        </Field>

        {!isInternal && (
          <Field label={t('settings.link')} hint={t('settings.linkHint')} required>
            <input
              type="url"
              className="field ltr text-start"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://app.engosoft.com"
              required
            />
          </Field>
        )}

        <Field label={t('settings.repoLink')}>
          <input
            type="url"
            className="field ltr text-start"
            value={repo}
            onChange={(e) => setRepo(e.target.value)}
            placeholder="https://github.com/…"
          />
        </Field>

        <fieldset>
          <legend className="label">{t('settings.icon')}</legend>
          <div className="flex flex-wrap gap-1.5 rounded-xl border border-surface-line p-2">
            {ICON_KEYS.map((key) => (
              <button
                key={key}
                type="button"
                onClick={() => setIcon(key)}
                aria-label={key}
                aria-pressed={icon === key}
                className={cx('rounded-xl p-1 transition-all', icon === key ? 'ring-2 ring-brand-500' : 'hover:bg-surface-sunken')}
              >
                <ModuleIcon name={key} color={color} size={36} />
              </button>
            ))}
          </div>
        </fieldset>

        <fieldset>
          <legend className="label">{t('settings.color')}</legend>
          <div className="flex flex-wrap gap-2">
            {TILE_COLORS.map((value) => (
              <button
                key={value}
                type="button"
                onClick={() => setColor(value)}
                aria-label={value}
                aria-pressed={color === value}
                className={cx(
                  'h-8 w-8 rounded-full transition-transform',
                  color === value ? 'scale-110 ring-2 ring-navy ring-offset-2' : 'hover:scale-105'
                )}
                style={{ background: value }}
              />
            ))}
          </div>
        </fieldset>

        {!isInternal && (
          <Field label={t('settings.openMode')} hint={t('settings.openModeHint')}>
            <select className="field" value={embed} onChange={(e) => setEmbed(e.target.value as EmbedMode)}>
              <option value="auto">{t('settings.openAuto')}</option>
              <option value="iframe">{t('settings.openIframe')}</option>
              <option value="newtab">{t('settings.openNewTab')}</option>
            </select>
          </Field>
        )}

        {error && (
          <p role="alert" className="rounded-xl bg-status-badBg px-3 py-2 text-[13px] font-semibold text-status-bad">
            {error}
          </p>
        )}
      </form>
    </Modal>
  );
}

/* ── Activity ────────────────────────────────────────────────────── */

/**
 * The filters, narrowest question first.
 *
 * "Deleted messages" is its own entry rather than a sub-case of Qodo Mail
 * because sending a message writes an activity row too, and the hundred newest
 * entries of a working day are almost entirely traffic. Asking the server for
 * the deletions is the only way to actually read them.
 */
const ACTIVITY_FILTERS = [
  { value: '', label: 'activity.filter.all' },
  { value: 'mail.message.delete', label: 'activity.filter.mailDelete' },
  { value: 'mail.channel.member', label: 'activity.filter.members' },
  { value: 'mail', label: 'activity.filter.mail' },
  { value: 'user', label: 'activity.filter.users' },
  { value: 'task', label: 'activity.filter.tasks' },
] as const;

function ActivityLog() {
  const { t } = useI18n();
  const [entries, setEntries] = useState<ActivityEntry[] | null>(null);
  const [actors, setActors] = useState<ActorMap>({});
  const [filter, setFilter] = useState<string>('');

  const load = useCallback(async () => {
    const query = filter ? `?action=${encodeURIComponent(filter)}` : '';
    const data = await api.get<{ activity: ActivityEntry[]; actors: ActorMap }>(
      `/notifications/activity${query}`
    );
    setEntries(data.activity);
    setActors(data.actors);
  }, [filter]);

  useEffect(() => {
    setEntries(null);
    load().catch(() => setEntries([]));
  }, [load]);

  const filterBar = (
    <div className="mb-3 flex flex-wrap gap-2">
      {ACTIVITY_FILTERS.map((option) => (
        <button
          key={option.value}
          type="button"
          onClick={() => setFilter(option.value)}
          className={cx(
            'rounded-full px-3 py-1.5 text-[11.5px] font-bold transition',
            filter === option.value
              ? 'bg-brand-500 text-white shadow-sm'
              : 'bg-surface-sunken text-ink-muted hover:text-brand-600'
          )}
        >
          {t(option.label as StringKey)}
        </button>
      ))}
    </div>
  );

  if (entries === null) {
    return (
      <div>
        {filterBar}
        <div className="skeleton h-64 rounded-2xl" />
      </div>
    );
  }

  if (entries.length === 0) {
    return (
      <div>
        {filterBar}
        <div className="card">
          <EmptyState icon={<Activity size={26} />} title={t('settings.noActivity')} />
        </div>
      </div>
    );
  }

  return (
    <div>
      {filterBar}
      <ul className="card divide-y divide-surface-line">
        {entries.map((entry) => {
          const actor = actors[entry.actorId];
          // Most entries carry the human name of what was touched, under one of
          // two keys depending on the subject.
          const subject = [entry.meta?.name, entry.meta?.title].find(
            (value): value is string => typeof value === 'string'
          );
          // A deletion says a different sentence when the message was somebody
          // else's, and names them — that pairing is the whole audit.
          const author =
            typeof entry.meta?.authorId === 'string' ? actors[entry.meta.authorId] : undefined;
          // A membership change names the people it moved, between the verb and
          // the channel they were moved into or out of. Creating a channel
          // records its opening roster under the same key, but that sentence
          // already reads as one — the names would only get in the way of it.
          const membership =
            entry.action === 'mail.channel.member.add'
              ? 'activity.toChannel'
              : entry.action === 'mail.channel.member.remove'
                ? 'activity.fromChannel'
                : null;
          const moved =
            membership && Array.isArray(entry.meta?.memberIds)
              ? entry.meta.memberIds
                  .map((id) => (typeof id === 'string' ? actors[id]?.name : null))
                  .filter((name): name is string => Boolean(name))
              : [];
          const removedForSomeoneElse =
            entry.action === 'mail.message.delete' && entry.meta?.own === false;
          const verb = removedForSomeoneElse
            ? t('activity.mail.message.delete.other')
            : t(`activity.${entry.action}` as StringKey);
          // A private thread is deliberately unnamed in the log; say where it
          // was without saying which.
          const place =
            entry.action === 'mail.message.delete' && !subject
              ? t('activity.inPrivate')
              : null;
          return (
            <li key={entry.id} className="flex items-center gap-3 px-4 py-3">
              <Avatar name={actor?.name ?? '?'} color={actor?.avatarColor} size={30} />
              <div className="min-w-0 flex-1">
                <p className="text-[13px] text-ink">
                  <span className="font-bold">{actor?.name ?? t('common.removedUser')}</span>{' '}
                  {verb}
                  {removedForSomeoneElse && (
                    <span className="font-semibold"> {author?.name ?? t('common.removedUser')}</span>
                  )}
                  {moved.length > 0 && <span className="font-semibold"> {moved.join('، ')}</span>}
                  {membership && <span> {t(membership)}</span>}
                  {subject && (
                    <span>
                      {/* A deletion happened *in* a channel; a membership change
                          already carries its own preposition; everything else
                          names the thing it acted on directly. */}
                      {entry.action === 'mail.message.delete' && ` ${t('activity.inChannel')}`}
                      <span className="font-semibold"> «{subject}»</span>
                    </span>
                  )}
                  {place && <span className="text-ink-muted"> {place}</span>}
                </p>
              </div>
              <span className="shrink-0 text-[11.5px] text-ink-faint">{timeAgo(entry.createdAt, t)}</span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/* ── System ──────────────────────────────────────────────────────── */

function SystemInfo() {
  const { apps } = useWorkspace();
  const { t, lang } = useI18n();
  const [health, setHealth] = useState<{ storage: string; uptime: number } | null>(null);

  useEffect(() => {
    api
      .get<{ storage: string; uptime: number }>('/health')
      .then(setHealth)
      .catch(() => setHealth(null));
  }, []);

  const external = useMemo(() => apps.filter((a) => a.kind === 'external'), [apps]);

  return (
    <div className="grid gap-3">
      <section className="card p-5">
        <h2 className="mb-3 flex items-center gap-2 text-[14px] font-bold text-ink">
          <Database size={16} className="text-brand-500" />
          {t('settings.storage')}
        </h2>
        {health ? (
          <dl className="grid gap-2 text-[13px]">
            <div className="flex items-center justify-between gap-3">
              <dt className="text-ink-muted">{t('settings.database')}</dt>
              <dd className="font-semibold text-ink">
                {health.storage === 'postgres' ? 'PostgreSQL' : t('settings.localFile')}
              </dd>
            </div>
            <div className="flex items-center justify-between gap-3">
              <dt className="text-ink-muted">{t('settings.uptime')}</dt>
              <dd className="font-semibold text-ink">
                {t('settings.minutes', { n: Math.round(health.uptime / 60) })}
              </dd>
            </div>
          </dl>
        ) : (
          <p className="text-[13px] text-ink-muted">{t('settings.noServer')}</p>
        )}
        {health?.storage === 'file' && (
          <p className="mt-3 rounded-xl bg-status-warnBg px-3 py-2.5 text-[12.5px] leading-relaxed text-accent-600">
            {t('settings.fileStorageWarning')}
          </p>
        )}
      </section>

      <section className="card p-5">
        <h2 className="mb-3 flex items-center gap-2 text-[14px] font-bold text-ink">
          <Link2 size={16} className="text-brand-500" />
          {t('settings.linking')}
        </h2>
        <p className="mb-3 text-[13px] leading-relaxed text-ink-muted">{t('settings.linkingBody')}</p>
        <ul className="grid gap-1.5">
          {external.map((app) => (
            <li key={app.id} className="flex items-center gap-2 text-[12.5px]">
              <ModuleIcon name={app.icon} color={app.color} size={18} variant="plain" />
              <span className="font-semibold text-ink">
                {lang === 'en' && app.nameEn ? app.nameEn : app.nameAr}
              </span>
              <span className="ltr truncate text-ink-faint">{app.url}</span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
