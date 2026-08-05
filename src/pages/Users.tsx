import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  Check,
  Copy,
  KeyRound,
  Link2,
  Pencil,
  ShieldCheck,
  Trash2,
  UserMinus,
  UserPlus,
  Users2,
  X,
} from 'lucide-react';
import { api, errorMessage } from '../lib/api';
import { useAuth } from '../lib/auth';
import { useI18n, type StringKey } from '../lib/i18n';
import { useWorkspace } from '../lib/workspace';
import {
  ALL_PERMISSIONS,
  PERMISSIONS,
  ROLES,
  VISIBILITY_SCOPES,
  availableScopes,
} from '@shared/permissions';
import {
  DEFAULT_DEPARTMENT,
  DEPARTMENTS,
  getDepartment,
  getJobRole,
  getJobRoles,
  getSubteam,
  getSubteams,
} from '@shared/departments';
import { ModuleIcon } from '../components/ModuleIcon';
import { Avatar, EmptyState, Field, Modal, Segmented, Spinner, useToast } from '../components/ui';
import { cx, timeAgo, timeUntil } from '../lib/utils';
import type { Invite, Role, User, VisibilityScope } from '../lib/types';

const ROLE_ORDER: Role[] = ['admin', 'manager', 'member', 'viewer'];

export function Users() {
  const { user: me, can } = useAuth();
  const { t, lang } = useI18n();
  const { reloadDirectory } = useWorkspace();
  const { push } = useToast();
  const [params, setParams] = useSearchParams();

  const [users, setUsers] = useState<User[] | null>(null);
  const [filter, setFilter] = useState<'active' | 'pending' | 'disabled' | 'all'>('active');
  const [editing, setEditing] = useState<User | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [invitesOpen, setInvitesOpen] = useState(false);

  const manage = can(PERMISSIONS.USERS_MANAGE);

  const load = useCallback(async () => {
    const data = await api.get<{ users: User[] }>('/users');
    setUsers(data.users);
  }, []);

  useEffect(() => {
    load().catch(() => setUsers([]));
  }, [load]);

  const deepLink = params.get('user');
  useEffect(() => {
    if (!deepLink || !users) return;
    const match = users.find((u) => u.id === deepLink);
    if (match && manage) {
      setEditing(match);
      setDialogOpen(true);
    }
    params.delete('user');
    setParams(params, { replace: true });
  }, [deepLink, users, params, setParams, manage]);

  const shown = useMemo(() => {
    if (!users) return [];
    return users
      .filter((u) => (filter === 'all' ? true : u.status === filter))
      .sort(
        (a, b) =>
          // Whoever is waiting on a decision comes first — an approval queue
          // buried under the staff list is an approval queue nobody works.
          Number(b.status === 'pending') - Number(a.status === 'pending') ||
          ROLE_ORDER.indexOf(a.role) - ROLE_ORDER.indexOf(b.role) ||
          a.name.localeCompare(b.name, lang === 'en' ? 'en' : 'ar')
      );
  }, [users, filter, lang]);

  const counts = useMemo(
    () => ({
      active: users?.filter((u) => u.status === 'active').length ?? 0,
      pending: users?.filter((u) => u.status === 'pending').length ?? 0,
      disabled: users?.filter((u) => u.status === 'disabled').length ?? 0,
      all: users?.length ?? 0,
    }),
    [users]
  );

  // Land straight on the queue when there is one — the notification that
  // brought them here was about a person waiting, not about the staff list.
  useEffect(() => {
    if (counts.pending > 0) setFilter((current) => (current === 'active' ? 'pending' : current));
  }, [counts.pending]);

  const approve = async (target: User) => {
    if (!window.confirm(t('users.confirmApprove', { name: target.name }))) return;
    try {
      await api.patch(`/users/${target.id}`, { status: 'active' });
      push(t('users.approved'));
      await load();
      await reloadDirectory();
    } catch (err) {
      push(errorMessage(err, lang), 'bad');
    }
  };

  const toggleStatus = async (target: User) => {
    const next = target.status === 'active' ? 'disabled' : 'active';
    const question =
      next === 'disabled'
        ? t('users.confirmDisable', { name: target.name })
        : t('users.confirmEnable', { name: target.name });
    if (!window.confirm(question)) return;
    try {
      await api.patch(`/users/${target.id}`, { status: next });
      push(next === 'disabled' ? t('users.disabledDone') : t('users.enabledDone'));
      await load();
      await reloadDirectory();
    } catch (err) {
      push(errorMessage(err, lang), 'bad');
    }
  };

  const remove = async (target: User) => {
    if (!window.confirm(t('users.confirmDelete', { name: target.name }))) return;
    try {
      const result = await api.delete<{ unassignedTasks: number }>(`/users/${target.id}`);
      push(
        result.unassignedTasks > 0
          ? t('users.deletedWithTasks', { n: result.unassignedTasks })
          : t('users.deleted')
      );
      await load();
      await reloadDirectory();
    } catch (err) {
      push(errorMessage(err, lang), 'bad');
    }
  };

  return (
    <div className="mx-auto w-full max-w-[1200px] px-4 py-6 sm:px-6 sm:py-8">
      <header className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-[20px] font-extrabold text-ink sm:text-[24px]">{t('users.title')}</h1>
          <p className="mt-0.5 text-[13px] text-ink-muted">{t('users.subtitle')}</p>
        </div>
        {manage && (
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => setInvitesOpen(true)}
              className="btn-ghost btn-sm gap-1.5"
            >
              <Link2 size={16} />
              {t('invites.title')}
            </button>
            <button
              type="button"
              onClick={() => {
                setEditing(null);
                setDialogOpen(true);
              }}
              className="btn-primary btn-sm gap-1.5"
            >
              <UserPlus size={16} />
              {t('users.new')}
            </button>
          </div>
        )}
      </header>

      <Segmented
        className="mb-4 w-fit"
        value={filter}
        onChange={setFilter}
        options={[
          { value: 'active', label: t('users.active'), count: counts.active },
          ...(counts.pending > 0 || filter === 'pending'
            ? [{ value: 'pending' as const, label: t('users.pending'), count: counts.pending }]
            : []),
          { value: 'disabled', label: t('users.disabled'), count: counts.disabled },
          { value: 'all', label: t('common.all'), count: counts.all },
        ]}
      />

      {users === null ? (
        <div className="grid gap-2">
          {Array.from({ length: 4 }).map((_, index) => (
            <div key={index} className="skeleton h-[72px] rounded-2xl" />
          ))}
        </div>
      ) : shown.length === 0 ? (
        <div className="card">
          <EmptyState icon={<Users2 size={26} />} title={t('users.none')} />
        </div>
      ) : (
        <ul className="grid gap-2">
          {shown.map((person) => {
            const department = getDepartment(person.department ?? DEFAULT_DEPARTMENT);
            const subteam = getSubteam(person.department, person.subteam);
            const jobRole = getJobRole(person.department, person.subteam, person.jobRole);
            return (
              <li
                key={person.id}
                className={cx(
                  'card flex flex-wrap items-center gap-3 px-4 py-3',
                  person.status === 'disabled' && 'opacity-70',
                  person.status === 'pending' && 'ring-1 ring-accent-400'
                )}
              >
                <Avatar name={person.name} color={person.avatarColor} size={40} />

                <div className="min-w-0 flex-1">
                  <p className="flex flex-wrap items-center gap-2">
                    <span className="text-[14px] font-bold text-ink">{person.name}</span>
                    {person.id === me?.id && <span className="chip bg-brand-50 text-brand-600">{t('common.you')}</span>}
                    {person.status === 'disabled' && (
                      <span className="chip bg-status-badBg text-status-bad">{t('users.disabledBadge')}</span>
                    )}
                    {person.status === 'pending' && (
                      <span className="chip bg-status-warnBg text-accent-600">{t('users.pendingBadge')}</span>
                    )}
                  </p>
                  <p className="ltr mt-0.5 truncate text-[12px] text-ink-muted">{person.email}</p>
                  {person.status === 'pending' ? (
                    <p className="mt-0.5 text-[11.5px] text-accent-600">{t('users.pendingHint')}</p>
                  ) : (
                    (jobRole || person.title) && (
                      <p className="mt-0.5 truncate text-[11.5px] text-ink-faint">
                        {jobRole ? (lang === 'en' ? jobRole.en : jobRole.ar) : person.title}
                      </p>
                    )
                  )}
                </div>

                <span
                  className="chip shrink-0"
                  style={{ background: `${department.color}1a`, color: department.color }}
                >
                  <ModuleIcon name={department.icon} color={department.color} size={12} variant="plain" />
                  {lang === 'en' ? department.en : department.ar}
                </span>
                {subteam && (
                  <span className="chip shrink-0 bg-surface-sunken text-ink-muted">
                    {lang === 'en' ? subteam.en : subteam.ar}
                  </span>
                )}

                <div className="flex min-w-[7rem] flex-col gap-0.5">
                  <span className="flex items-center gap-1.5 text-[12.5px] font-semibold text-ink">
                    <ShieldCheck size={14} className="text-brand-500" />
                    {t(`role.${person.role}` as StringKey)}
                  </span>
                  <span className="text-[11px] text-ink-faint">
                    {person.permissions ? t('users.customPermissions') : t('users.roleDefaults')}
                    {' · '}
                    {person.appIds ? t('users.appsCount', { n: person.appIds.length }) : t('users.allApps')}
                  </span>
                </div>

                <span className="hidden min-w-[6rem] text-[11.5px] text-ink-faint lg:block">
                  {person.lastLoginAt
                    ? t('users.lastLogin', { when: timeAgo(person.lastLoginAt, t) })
                    : t('users.neverLoggedIn')}
                </span>

                {manage && (
                  <div className="flex items-center gap-1">
                    {person.status === 'pending' && (
                      <button
                        type="button"
                        onClick={() => approve(person)}
                        className="btn-primary btn-sm gap-1.5"
                      >
                        <Check size={15} />
                        {t('users.approve')}
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => {
                        setEditing(person);
                        setDialogOpen(true);
                      }}
                      className="btn-quiet !min-h-9 rounded-lg px-2"
                      aria-label={person.status === 'pending' ? t('users.approveAndEdit') : t('common.edit')}
                      title={person.status === 'pending' ? t('users.approveAndEdit') : t('common.edit')}
                    >
                      <Pencil size={15} />
                    </button>
                    {person.id !== me?.id && (
                      <>
                        {person.status !== 'pending' && (
                          <button
                            type="button"
                            onClick={() => toggleStatus(person)}
                            className="btn-quiet !min-h-9 rounded-lg px-2"
                            aria-label={person.status === 'active' ? t('users.disabled') : t('users.active')}
                          >
                            <UserMinus size={15} />
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => remove(person)}
                          className="btn-quiet !min-h-9 rounded-lg px-2 text-status-bad hover:bg-status-badBg"
                          aria-label={t('common.delete')}
                        >
                          <X size={15} />
                        </button>
                      </>
                    )}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {manage && (
        <>
          <UserDialog
            open={dialogOpen}
            onClose={() => setDialogOpen(false)}
            user={editing}
            onSaved={async () => {
              await load();
              await reloadDirectory();
            }}
          />
          <InvitesDialog open={invitesOpen} onClose={() => setInvitesOpen(false)} />
        </>
      )}
    </div>
  );
}

/* ── Create / edit ───────────────────────────────────────────────── */

function UserDialog({
  open,
  onClose,
  user,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  user: User | null;
  onSaved: () => Promise<void>;
}) {
  const { apps } = useWorkspace();
  const { t, lang } = useI18n();
  const { push } = useToast();

  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [title, setTitle] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState<Role>('member');
  const [department, setDepartment] = useState(DEFAULT_DEPARTMENT);
  const [subteam, setSubteam] = useState('');
  const [jobRole, setJobRole] = useState('');
  const [customPermissions, setCustomPermissions] = useState<string[] | null>(null);
  const [appIds, setAppIds] = useState<string[] | null>(null);
  const [scope, setScope] = useState<VisibilityScope | ''>('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setError('');
    setPassword('');
    setName(user?.name ?? '');
    setEmail(user?.email ?? '');
    setTitle(user?.title ?? '');
    setRole(user?.role ?? 'member');
    setDepartment(user?.department ?? DEFAULT_DEPARTMENT);
    setSubteam(user?.subteam ?? '');
    setJobRole(user?.jobRole ?? '');
    setCustomPermissions(user?.permissions ?? null);
    setAppIds(user?.appIds ?? null);
    setScope(user?.visibilityScope ?? '');
  }, [open, user]);

  const rolePermissions = ROLES[role]?.permissions ?? [];
  const effective = customPermissions ?? rolePermissions;
  const subteams = getSubteams(department);
  const jobRoles = getJobRoles(department, subteam);

  // The picker reflects the role being edited right now, not the stored one —
  // demoting someone to viewer has to drop "every department" off the list.
  const scopeOptions: string[] = availableScopes({
    role,
    status: 'active',
    permissions: customPermissions,
  });

  const togglePermission = (permission: string) => {
    const base = customPermissions ?? rolePermissions;
    setCustomPermissions(
      base.includes(permission) ? base.filter((p) => p !== permission) : [...base, permission]
    );
  };

  const toggleApp = (appId: string) => {
    const base = appIds ?? apps.map((a) => a.id);
    setAppIds(base.includes(appId) ? base.filter((id) => id !== appId) : [...base, appId]);
  };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError('');
    if (!name.trim()) return setError(t('users.name'));
    if (!user && password.length < 8) return setError(t('auth.passwordTooShort'));

    setSaving(true);
    const payload: Record<string, unknown> = {
      name: name.trim(),
      email: email.trim(),
      title: title.trim(),
      role,
      department,
      subteam: subteam || null,
      jobRole: jobRole || null,
      permissions: customPermissions,
      appIds,
      visibilityScope: scope || null,
    };
    if (password) payload.password = password;

    try {
      if (user) await api.patch(`/users/${user.id}`, payload);
      else await api.post('/users', payload);
      await onSaved();
      push(user ? t('users.saved') : t('users.added'));
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
      width="lg"
      title={user ? `${t('common.edit')}: ${user.name}` : t('users.new')}
      footer={
        <>
          <button type="button" onClick={onClose} className="btn-ghost btn-sm">
            {t('common.cancel')}
          </button>
          <button type="submit" form="user-form" className="btn-primary btn-sm" disabled={saving}>
            {saving && <Spinner size={15} />}
            {user ? t('common.save') : t('common.add')}
          </button>
        </>
      }
    >
      <form id="user-form" onSubmit={submit} className="grid gap-4">
        <div className="grid gap-3.5 sm:grid-cols-2">
          <Field label={t('users.name')} required>
            <input className="field" value={name} onChange={(e) => setName(e.target.value)} required />
          </Field>
          <Field label={t('auth.email')} required>
            <input
              type="email"
              className="field ltr text-start"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </Field>
          <Field label={t('users.jobTitle')}>
            <input
              className="field"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder={t('users.jobTitlePlaceholder')}
            />
          </Field>
          <Field label={t('users.userDepartment')} hint={t('users.userDepartmentHint')}>
            <select
              className="field"
              value={department}
              onChange={(e) => {
                setDepartment(e.target.value);
                setSubteam('');
                setJobRole('');
              }}
            >
              {DEPARTMENTS.map((d) => (
                <option key={d.id} value={d.id}>
                  {lang === 'en' ? d.en : d.ar}
                </option>
              ))}
            </select>
          </Field>
          {subteams.length > 0 && (
            <Field label={t('users.subteam')} hint={t('users.subteamHint')}>
              <select
                className="field"
                value={subteam}
                onChange={(event) => {
                  setSubteam(event.target.value);
                  setJobRole('');
                }}
              >
                <option value="">— {t('common.none')} —</option>
                {subteams.map((team) => (
                  <option key={team.id} value={team.id}>
                    {lang === 'en' ? team.en : team.ar}
                  </option>
                ))}
              </select>
            </Field>
          )}
          {/* A sub-team that names no job titles — payroll — would otherwise
              render a dropdown whose only entry is "none". */}
          {subteams.length > 0 && (!subteam || jobRoles.length > 0) && (
            <Field label={t('users.jobRole')}>
              <select
                className="field"
                value={jobRole}
                onChange={(event) => setJobRole(event.target.value)}
                disabled={!subteam}
              >
                <option value="">
                  — {subteam ? t('common.none') : t('users.chooseSubteamFirst')} —
                </option>
                {jobRoles.map((item) => (
                  <option key={item.id} value={item.id}>
                    {lang === 'en' ? item.en : item.ar}
                  </option>
                ))}
              </select>
            </Field>
          )}
          <Field
            label={user ? t('users.newPassword') : t('auth.password')}
            hint={user ? t('users.leaveBlank') : t('auth.passwordHint')}
            required={!user}
          >
            <input
              type={user ? 'text' : 'password'}
              className="field"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="new-password"
              placeholder={user ? '••••••••' : ''}
            />
          </Field>
        </div>

        {user && password && (
          <p className="flex items-start gap-2 rounded-xl bg-status-warnBg px-3 py-2 text-[12.5px] text-accent-600">
            <KeyRound size={15} className="mt-0.5 shrink-0" />
            {t('users.copyPassword')}
          </p>
        )}

        <Field
          label={t('scope.label')}
          hint={
            scope === 'subteam' && !subteam ? t('scope.needsSubteam') : t('scope.hint')
          }
        >
          <select
            className="field"
            value={scope}
            onChange={(event) => setScope(event.target.value as VisibilityScope | '')}
          >
            <option value="">{t('scope.role')}</option>
            {VISIBILITY_SCOPES.filter((id: string) => scopeOptions.includes(id)).map(
              (id: string) => (
                <option key={id} value={id}>
                  {t(`scope.${id}` as StringKey)}
                </option>
              )
            )}
          </select>
        </Field>

        {/* Role first: it sets the defaults, and most users never need more. */}
        <fieldset>
          <legend className="label">{t('users.role')}</legend>
          <div className="grid gap-2 sm:grid-cols-2">
            {ROLE_ORDER.map((id) => (
              <label
                key={id}
                className={cx(
                  'flex cursor-pointer items-start gap-2.5 rounded-xl border p-3 transition-colors',
                  role === id ? 'border-brand-400 bg-brand-50' : 'border-surface-line hover:bg-surface-sunken'
                )}
              >
                <input
                  type="radio"
                  name="role"
                  className="mt-1 accent-brand-500"
                  checked={role === id}
                  onChange={() => {
                    setRole(id);
                    // Switching role while an override is active would silently
                    // keep the old permission set — clear it instead.
                    setCustomPermissions(null);
                  }}
                />
                <span className="min-w-0">
                  <span className="block text-[13px] font-bold text-ink">{t(`role.${id}` as StringKey)}</span>
                  <span className="mt-0.5 block text-[11.5px] leading-relaxed text-ink-muted">
                    {t(`role.${id}.desc` as StringKey)}
                  </span>
                </span>
              </label>
            ))}
          </div>
        </fieldset>

        <fieldset>
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <legend className="label !mb-0">{t('users.permissions')}</legend>
            {customPermissions ? (
              <button
                type="button"
                onClick={() => setCustomPermissions(null)}
                className="text-[12px] font-semibold text-brand-500 hover:underline"
              >
                {t('users.resetToRole')}
              </button>
            ) : (
              <span className="text-[11.5px] text-ink-faint">{t('users.followingRole')}</span>
            )}
          </div>

          <div className="grid gap-1.5 rounded-xl border border-surface-line p-2.5 sm:grid-cols-2">
            {ALL_PERMISSIONS.map((permission: string) => (
              <label
                key={permission}
                className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-[12.5px] transition-colors hover:bg-surface-sunken"
              >
                <input
                  type="checkbox"
                  className="accent-brand-500"
                  checked={effective.includes(permission)}
                  onChange={() => togglePermission(permission)}
                  disabled={role === 'admin' && !customPermissions}
                />
                <span className="text-ink">{t(`perm.${permission}` as StringKey)}</span>
              </label>
            ))}
          </div>
        </fieldset>

        <fieldset>
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <legend className="label !mb-0">{t('users.allowedApps')}</legend>
            <label className="flex cursor-pointer items-center gap-2 text-[12px] font-semibold text-ink-muted">
              <input
                type="checkbox"
                className="accent-brand-500"
                checked={appIds === null}
                onChange={(e) => setAppIds(e.target.checked ? null : apps.map((a) => a.id))}
              />
              {t('users.allAppsIncludingNew')}
            </label>
          </div>

          <div
            className={cx(
              'grid gap-1.5 rounded-xl border border-surface-line p-2.5 sm:grid-cols-2',
              appIds === null && 'pointer-events-none opacity-50'
            )}
          >
            {apps.map((app) => (
              <label
                key={app.id}
                className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-[12.5px] transition-colors hover:bg-surface-sunken"
              >
                <input
                  type="checkbox"
                  className="accent-brand-500"
                  checked={appIds === null || appIds.includes(app.id)}
                  onChange={() => toggleApp(app.id)}
                />
                <ModuleIcon name={app.icon} color={app.color} size={16} variant="plain" />
                <span className="text-ink">{lang === 'en' && app.nameEn ? app.nameEn : app.nameAr}</span>
              </label>
            ))}
          </div>
          {role === 'admin' && <p className="mt-1.5 text-[11.5px] text-ink-faint">{t('users.adminSeesAll')}</p>}
        </fieldset>

        {error && (
          <p role="alert" className="rounded-xl bg-status-badBg px-3 py-2 text-[13px] font-semibold text-status-bad">
            {error}
          </p>
        )}
      </form>
    </Modal>
  );
}

/* ── Invite links ────────────────────────────────────────────────── */

/**
 * The link is the whole product here, so the list is built around one action:
 * copy it. Everything else — who joined, how long it lasts, whether it still
 * works — is context for deciding whether to send this link or make a new one.
 */
function InvitesDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t, lang } = useI18n();
  const { push } = useToast();

  const [invites, setInvites] = useState<Invite[] | null>(null);
  const [creating, setCreating] = useState(false);
  const [copied, setCopied] = useState('');

  const [label, setLabel] = useState('');
  const [role, setRole] = useState<'member' | 'viewer'>('member');
  const [department, setDepartment] = useState('');
  const [emailDomain, setEmailDomain] = useState('');
  const [maxUses, setMaxUses] = useState('');
  const [expiresInDays, setExpiresInDays] = useState('14');
  const [scope, setScope] = useState<VisibilityScope | ''>('');
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    const data = await api.get<{ invites: Invite[] }>('/invites');
    setInvites(data.invites);
  }, []);

  useEffect(() => {
    if (!open) return;
    setError('');
    setCopied('');
    load().catch(() => setInvites([]));
  }, [open, load]);

  const linkFor = (invite: Invite) => `${window.location.origin}/join/${invite.token}`;

  const copy = async (invite: Invite) => {
    const url = linkFor(invite);
    try {
      await navigator.clipboard.writeText(url);
    } catch {
      // Clipboard access needs a secure context and can still be refused —
      // a prompt the user can copy out of beats a silent failure.
      window.prompt(t('invites.copy'), url);
    }
    setCopied(invite.id);
    push(t('invites.copied'));
    setTimeout(() => setCopied(''), 2500);
  };

  const create = async (event: React.FormEvent) => {
    event.preventDefault();
    setError('');
    setCreating(true);
    try {
      await api.post('/invites', {
        label: label.trim(),
        role,
        departments: department ? [department] : [],
        emailDomain: emailDomain.trim(),
        maxUses: maxUses.trim() === '' ? null : Number(maxUses),
        expiresInDays: Number(expiresInDays),
        visibilityScope: scope || null,
      });
      setLabel('');
      setEmailDomain('');
      setMaxUses('');
      await load();
      push(t('invites.created'));
    } catch (err) {
      setError(errorMessage(err, lang));
    } finally {
      setCreating(false);
    }
  };

  const revoke = async (invite: Invite) => {
    if (!window.confirm(t('invites.confirmRevoke'))) return;
    try {
      await api.post(`/invites/${invite.id}/revoke`);
      push(t('invites.revoked'));
      await load();
    } catch (err) {
      push(errorMessage(err, lang), 'bad');
    }
  };

  const remove = async (invite: Invite) => {
    if (!window.confirm(t('invites.confirmDelete'))) return;
    try {
      await api.delete(`/invites/${invite.id}`);
      push(t('invites.deleted'));
      await load();
    } catch (err) {
      push(errorMessage(err, lang), 'bad');
    }
  };

  const stateTone: Record<string, string> = {
    active: 'bg-status-okBg text-status-ok',
    expired: 'bg-surface-sunken text-ink-faint',
    revoked: 'bg-status-badBg text-status-bad',
    exhausted: 'bg-status-warnBg text-accent-600',
  };

  return (
    <Modal open={open} onClose={onClose} width="lg" title={t('invites.title')}>
      <p className="mb-4 text-[13px] leading-relaxed text-ink-muted">{t('invites.subtitle')}</p>

      <form onSubmit={create} className="mb-5 grid gap-3.5 rounded-2xl border border-surface-line p-4">
        <div className="grid gap-3.5 sm:grid-cols-2">
          <Field label={t('invites.label')} hint={t('invites.labelHint')}>
            <input className="field" value={label} onChange={(e) => setLabel(e.target.value)} />
          </Field>
          <Field label={t('invites.role')} hint={t('invites.roleHint')}>
            <select
              className="field"
              value={role}
              onChange={(e) => setRole(e.target.value as 'member' | 'viewer')}
            >
              <option value="member">{t('role.member')}</option>
              <option value="viewer">{t('role.viewer')}</option>
            </select>
          </Field>
          <Field label={t('invites.departments')} hint={t('invites.departmentsHint')}>
            <select
              className="field"
              value={department}
              onChange={(e) => setDepartment(e.target.value)}
            >
              <option value="">— {t('invites.anyDepartment')} —</option>
              {DEPARTMENTS.map((item) => (
                <option key={item.id} value={item.id}>
                  {lang === 'en' ? item.en : item.ar}
                </option>
              ))}
            </select>
          </Field>
          <Field label={t('scope.label')} hint={t('scope.hint')}>
            <select
              className="field"
              value={scope}
              onChange={(e) => setScope(e.target.value as VisibilityScope | '')}
            >
              <option value="">{t('scope.role')}</option>
              <option value="own">{t('scope.own')}</option>
              <option value="subteam">{t('scope.subteam')}</option>
              <option value="department">{t('scope.department')}</option>
            </select>
          </Field>
          <Field label={t('invites.emailDomain')} hint={t('invites.emailDomainHint')}>
            <input
              className="field ltr text-start"
              value={emailDomain}
              onChange={(e) => setEmailDomain(e.target.value)}
              placeholder="engosoft.com"
            />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label={t('invites.maxUses')} hint={t('invites.maxUsesHint')}>
              <input
                type="number"
                min={1}
                max={500}
                className="field"
                value={maxUses}
                onChange={(e) => setMaxUses(e.target.value)}
              />
            </Field>
            <Field label={t('invites.expiresInDays')}>
              <input
                type="number"
                min={1}
                max={365}
                className="field"
                value={expiresInDays}
                onChange={(e) => setExpiresInDays(e.target.value)}
              />
            </Field>
          </div>
        </div>

        {error && (
          <p role="alert" className="rounded-xl bg-status-badBg px-3 py-2 text-[13px] font-semibold text-status-bad">
            {error}
          </p>
        )}

        <button type="submit" className="btn-primary btn-sm w-fit gap-1.5" disabled={creating}>
          {creating ? <Spinner size={15} /> : <Link2 size={15} />}
          {t('invites.new')}
        </button>
      </form>

      {invites === null ? (
        <div className="grid gap-2">
          {Array.from({ length: 2 }).map((_, index) => (
            <div key={index} className="skeleton h-[86px] rounded-2xl" />
          ))}
        </div>
      ) : invites.length === 0 ? (
        <EmptyState icon={<Link2 size={24} />} title={t('invites.none')} />
      ) : (
        <ul className="grid gap-2">
          {invites.map((invite) => (
            <li key={invite.id} className="rounded-2xl border border-surface-line p-3">
              <div className="mb-2 flex flex-wrap items-center gap-2">
                <span className="text-[13.5px] font-bold text-ink">
                  {invite.label || t('invites.title')}
                </span>
                <span className={cx('chip', stateTone[invite.state])}>
                  {t(`invites.state.${invite.state}` as StringKey)}
                </span>
                <span className="chip bg-surface-sunken text-ink-muted">
                  {t(`role.${invite.role}` as StringKey)}
                </span>
                <span className="chip bg-surface-sunken text-ink-muted">
                  {invite.departments.length
                    ? getDepartment(invite.departments[0])[lang === 'en' ? 'en' : 'ar']
                    : t('invites.anyDepartment')}
                </span>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <code className="ltr min-w-0 flex-1 truncate rounded-lg bg-surface-sunken px-2.5 py-2 text-[11.5px] text-ink-muted">
                  {linkFor(invite)}
                </code>
                <button
                  type="button"
                  onClick={() => copy(invite)}
                  className="btn-ghost btn-sm gap-1.5"
                  disabled={invite.state !== 'active'}
                >
                  {copied === invite.id ? <Check size={15} /> : <Copy size={15} />}
                  {t('invites.copy')}
                </button>
                {invite.state === 'active' && (
                  <button
                    type="button"
                    onClick={() => revoke(invite)}
                    className="btn-quiet !min-h-9 rounded-lg px-2 text-status-bad hover:bg-status-badBg"
                    title={t('invites.revoke')}
                    aria-label={t('invites.revoke')}
                  >
                    <X size={15} />
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => remove(invite)}
                  className="btn-quiet !min-h-9 rounded-lg px-2 text-ink-faint hover:bg-surface-sunken"
                  title={t('common.delete')}
                  aria-label={t('common.delete')}
                >
                  <Trash2 size={15} />
                </button>
              </div>

              <p className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[11.5px] text-ink-faint">
                <span>
                  {invite.maxUses
                    ? t('invites.usage', { used: invite.useCount, max: invite.maxUses })
                    : t('invites.usageUnlimited', { used: invite.useCount })}
                </span>
                {invite.joined > 0 && <span>{t('invites.joinedCount', { n: invite.joined })}</span>}
                {invite.pending > 0 && (
                  <span className="font-semibold text-accent-600">
                    {t('invites.pendingCount', { n: invite.pending })}
                  </span>
                )}
                <span>{t('invites.expiresOn', { when: timeUntil(invite.expiresAt, t, lang) })}</span>
              </p>
            </li>
          ))}
        </ul>
      )}
    </Modal>
  );
}
