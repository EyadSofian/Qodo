/**
 * The join page — the only screen in the app that renders without a session.
 *
 * Someone opens an invite link, says who they are, sets their own password and
 * points at where they sit in the department tree. Nothing here decides what
 * they will be allowed to do: role, permissions and allowed apps are baked into
 * the link by whoever created it, and the account waits in `pending` until an
 * administrator approves it. So the honest thing to tell the visitor is exactly
 * that — before they type a password, not after they submit one.
 */

import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { AlertCircle, CheckCircle2, Clock, Languages, ShieldCheck } from 'lucide-react';
import { api, errorMessage } from '../lib/api';
import { useI18n } from '../lib/i18n';
import { Logo } from '../components/Brand';
import { ModuleIcon } from '../components/ModuleIcon';
import { Field, Spinner } from '../components/ui';
import { cx } from '../lib/utils';
import type { PublicInvite } from '../lib/types';

type Phase = 'loading' | 'form' | 'done' | 'dead';

export function Join() {
  const { token = '' } = useParams();
  const { t, lang, setLang } = useI18n();

  const [phase, setPhase] = useState<Phase>('loading');
  const [invite, setInvite] = useState<PublicInvite | null>(null);
  const [deadReason, setDeadReason] = useState('');

  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [department, setDepartment] = useState('');
  const [subteam, setSubteam] = useState('');
  const [jobRole, setJobRole] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    api
      .get<{ invite: PublicInvite }>(`/invites/token/${encodeURIComponent(token)}`)
      .then(({ invite: data }) => {
        if (cancelled) return;
        setInvite(data);
        // A link pinned to a single department shouldn't ask a question with
        // one answer.
        if (data.departments.length === 1) setDepartment(data.departments[0].id);
        setPhase('form');
      })
      .catch((err) => {
        if (cancelled) return;
        setDeadReason(errorMessage(err, lang));
        setPhase('dead');
      });
    return () => {
      cancelled = true;
    };
    // The language only changes the wording of an error we already have, and
    // re-fetching on every toggle would burn the public rate limit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  const chosen = useMemo(
    () => invite?.departments.find((item) => item.id === department) ?? null,
    [invite, department]
  );
  const subteams = chosen?.subteams ?? [];
  const jobRoles = subteams.find((team) => team.id === subteam)?.roles ?? [];

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError('');
    if (!name.trim()) return setError(t('join.nameRequired'));
    if (password.length < 8) return setError(t('auth.passwordTooShort'));
    if (password !== confirm) return setError(t('auth.passwordMismatch'));
    if (!department) return setError(t('join.pickDepartment'));
    if (subteams.length > 0 && !subteam) return setError(t('join.pickSubteam'));

    setSaving(true);
    try {
      await api.post(`/invites/token/${encodeURIComponent(token)}/accept`, {
        name: name.trim(),
        email: email.trim(),
        password,
        department,
        subteam: subteam || null,
        jobRole: jobRole || null,
      });
      setPhase('done');
    } catch (err) {
      setError(errorMessage(err, lang));
      setSaving(false);
    }
  };

  return (
    <div className="relative flex min-h-[100dvh] items-center justify-center overflow-hidden bg-navy px-5 py-10">
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          backgroundImage:
            'radial-gradient(900px 520px at 78% 8%, rgba(42,167,240,0.30), transparent 62%), radial-gradient(700px 460px at 12% 92%, rgba(29,111,184,0.34), transparent 60%)',
        }}
        aria-hidden="true"
      />

      <button
        type="button"
        onClick={() => setLang(lang === 'ar' ? 'en' : 'ar')}
        className="absolute end-4 top-4 z-10 flex items-center gap-1.5 rounded-xl px-3 py-2 text-[13px] font-semibold text-white/70 transition-colors hover:bg-white/10 hover:text-white"
      >
        <Languages size={16} />
        {lang === 'ar' ? 'English' : 'العربية'}
      </button>

      <div className="relative w-full max-w-[440px]">
        <div className="mb-7 flex flex-col items-center gap-3 text-center">
          <Logo tone="white" height={42} />
          <p className="text-[13.5px] text-white/70">{t('join.tagline')}</p>
        </div>

        <div className="rounded-2xl border border-white/10 bg-white p-6 shadow-panel">
          {phase === 'loading' && (
            <div className="flex items-center justify-center gap-2 py-10 text-ink-muted">
              <Spinner size={18} />
              {t('common.loading')}
            </div>
          )}

          {phase === 'dead' && (
            <div className="py-4 text-center">
              <AlertCircle size={30} className="mx-auto mb-3 text-status-bad" />
              <h1 className="mb-1.5 text-base font-bold text-ink">{t('join.linkProblem')}</h1>
              <p className="text-[13px] leading-relaxed text-ink-muted">{deadReason}</p>
              <Link to="/" className="btn-ghost btn-sm mt-5">
                {t('auth.signIn')}
              </Link>
            </div>
          )}

          {phase === 'done' && (
            <div className="py-4 text-center">
              <CheckCircle2 size={34} className="mx-auto mb-3 text-status-ok" />
              <h1 className="mb-1.5 text-base font-bold text-ink">{t('join.doneTitle')}</h1>
              <p className="text-[13px] leading-relaxed text-ink-muted">{t('join.doneBody')}</p>
              <p className="mt-4 flex items-start gap-2 rounded-xl bg-status-warnBg px-3 py-2.5 text-start text-[12.5px] leading-relaxed text-accent-600">
                <Clock size={15} className="mt-0.5 shrink-0" />
                {t('join.doneWait')}
              </p>
              <Link to="/" className="btn-primary btn-sm mt-5">
                {t('auth.signIn')}
              </Link>
            </div>
          )}

          {phase === 'form' && invite && (
            <form onSubmit={submit} className="grid gap-3.5">
              <div>
                <h1 className="text-lg font-bold text-ink">{t('join.title')}</h1>
                <p className="mt-0.5 text-[13px] text-ink-muted">
                  {invite.label || t('join.subtitle')}
                </p>
              </div>

              <p className="flex items-start gap-2 rounded-xl bg-brand-50 px-3 py-2.5 text-[12.5px] leading-relaxed text-brand-600">
                <ShieldCheck size={15} className="mt-0.5 shrink-0" />
                {t('join.approvalNotice')}
              </p>

              <Field label={t('users.name')} required>
                <input
                  className="field"
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  autoComplete="name"
                  autoFocus
                  required
                />
              </Field>

              <Field
                label={t('auth.email')}
                hint={invite.emailDomain ? t('join.domainHint', { domain: invite.emailDomain }) : undefined}
                required
              >
                <input
                  type="email"
                  className="field ltr text-start"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  placeholder={invite.emailDomain ? `you@${invite.emailDomain}` : 'you@engosoft.com'}
                  autoComplete="username"
                  required
                />
              </Field>

              <div className="grid gap-3.5 sm:grid-cols-2">
                <Field label={t('auth.password')} hint={t('auth.passwordHint')} required>
                  <input
                    type="password"
                    className="field"
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    autoComplete="new-password"
                    required
                  />
                </Field>
                <Field label={t('join.confirmPassword')} required>
                  <input
                    type="password"
                    className="field"
                    value={confirm}
                    onChange={(event) => setConfirm(event.target.value)}
                    autoComplete="new-password"
                    required
                  />
                </Field>
              </div>

              {invite.departments.length > 1 && (
                <Field label={t('join.department')} hint={t('join.departmentHint')} required>
                  <div className="grid gap-1.5 sm:grid-cols-2">
                    {invite.departments.map((item) => (
                      <label
                        key={item.id}
                        className={cx(
                          'flex cursor-pointer items-center gap-2 rounded-xl border p-2.5 text-[13px] font-semibold transition-colors',
                          department === item.id
                            ? 'border-brand-400 bg-brand-50 text-ink'
                            : 'border-surface-line text-ink-muted hover:bg-surface-sunken'
                        )}
                      >
                        <input
                          type="radio"
                          name="department"
                          className="sr-only"
                          checked={department === item.id}
                          onChange={() => {
                            setDepartment(item.id);
                            setSubteam('');
                            setJobRole('');
                          }}
                        />
                        <ModuleIcon name={item.icon} color={item.color} size={16} variant="plain" />
                        {lang === 'en' ? item.en : item.ar}
                      </label>
                    ))}
                  </div>
                </Field>
              )}

              {subteams.length > 0 && (
                <Field label={t('join.subteam')} hint={t('join.subteamHint')} required>
                  <select
                    className="field"
                    value={subteam}
                    onChange={(event) => {
                      setSubteam(event.target.value);
                      setJobRole('');
                    }}
                    required
                  >
                    <option value="">— {t('join.choose')} —</option>
                    {subteams.map((team) => (
                      <option key={team.id} value={team.id}>
                        {lang === 'en' ? team.en : team.ar}
                      </option>
                    ))}
                  </select>
                </Field>
              )}

              {/* A sub-team that names no job titles — payroll — would
                  otherwise render a dropdown whose only entry is "none". */}
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
                    {jobRoles.map((role) => (
                      <option key={role.id} value={role.id}>
                        {lang === 'en' ? role.en : role.ar}
                      </option>
                    ))}
                  </select>
                </Field>
              )}

              {error && (
                <p
                  role="alert"
                  className="flex items-start gap-2 rounded-xl bg-status-badBg px-3 py-2.5 text-[13px] font-semibold text-status-bad"
                >
                  <AlertCircle size={16} className="mt-0.5 shrink-0" />
                  {error}
                </p>
              )}

              <button type="submit" className="btn-primary mt-1 w-full" disabled={saving}>
                {saving && <Spinner size={16} />}
                {saving ? t('join.creating') : t('join.submit')}
              </button>

              <p className="text-center text-[12px] text-ink-faint">
                {t('join.haveAccount')}{' '}
                <Link to="/" className="font-semibold text-brand-500 hover:underline">
                  {t('auth.signIn')}
                </Link>
              </p>
            </form>
          )}
        </div>

        <p className="mt-6 text-center text-[12px] text-white/50">
          © {new Date().getFullYear()} Engosoft — {t('auth.footer')}
        </p>
      </div>
    </div>
  );
}
