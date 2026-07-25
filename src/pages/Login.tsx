import { useState } from 'react';
import { AlertCircle, Languages } from 'lucide-react';
import { useAuth } from '../lib/auth';
import { useI18n } from '../lib/i18n';
import { errorMessage } from '../lib/api';
import { Logo } from '../components/Brand';
import { Field, Spinner } from '../components/ui';

export function Login() {
  const { signIn } = useAuth();
  const { t, lang, setLang } = useI18n();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError('');
    setBusy(true);
    try {
      await signIn(email.trim(), password);
    } catch (err) {
      setError(errorMessage(err, lang));
      setBusy(false);
    }
  };

  return (
    <div className="relative flex min-h-[100dvh] items-center justify-center overflow-hidden bg-navy px-5 py-10">
      {/* The same blue bloom as the "e" in the mark, blown up as atmosphere. */}
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

      <div className="relative w-full max-w-[400px]">
        <div className="mb-7 flex flex-col items-center gap-3 text-center">
          <Logo tone="white" height={42} />
          <p className="text-[13.5px] text-white/70">{t('auth.tagline')}</p>
        </div>

        <form onSubmit={submit} className="rounded-2xl border border-white/10 bg-white p-6 shadow-panel">
          <h1 className="mb-1 text-lg font-bold text-ink">{t('auth.signIn')}</h1>
          <p className="mb-5 text-[13px] text-ink-muted">{t('auth.signInHint')}</p>

          <div className="grid gap-3.5">
            <Field label={t('auth.email')} required>
              <input
                type="email"
                className="field ltr text-start"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                placeholder="you@engosoft.com"
                autoComplete="username"
                autoFocus
                required
              />
            </Field>

            <Field label={t('auth.password')} required>
              <input
                type="password"
                className="field"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                autoComplete="current-password"
                required
              />
            </Field>
          </div>

          {error && (
            <p
              role="alert"
              className="mt-4 flex items-start gap-2 rounded-xl bg-status-badBg px-3 py-2.5 text-[13px] font-semibold text-status-bad"
            >
              <AlertCircle size={16} className="mt-0.5 shrink-0" />
              {error}
            </p>
          )}

          <button type="submit" className="btn-primary mt-5 w-full" disabled={busy}>
            {busy && <Spinner size={16} />}
            {busy ? t('auth.signingIn') : t('auth.submit')}
          </button>

          <p className="mt-4 text-center text-[12px] leading-relaxed text-ink-faint">
            {t('auth.forgot')}
          </p>
        </form>

        <p className="mt-6 text-center text-[12px] text-white/50">
          © {new Date().getFullYear()} Engosoft — {t('auth.footer')}
        </p>
      </div>
    </div>
  );
}
