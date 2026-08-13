import { useEffect, useRef, useState } from 'react';
import { AlertCircle, Languages, LockKeyhole } from 'lucide-react';
import { useAuth } from '../lib/auth';
import { useI18n } from '../lib/i18n';
import { api, errorMessage } from '../lib/api';
import { Logo } from '../components/Brand';
import { Field, Spinner } from '../components/ui';

export function Login() {
  const { signIn, signInWithGoogle } = useAuth();
  const { t, lang, setLang } = useI18n();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [googleConfig, setGoogleConfig] = useState<{ enabled: boolean; clientId: string | null } | null>(null);
  const [googleBusy, setGoogleBusy] = useState(false);

  useEffect(() => {
    api
      .get<{ enabled: boolean; clientId: string | null }>('/auth/google/config')
      .then(setGoogleConfig)
      .catch(() => setGoogleConfig({ enabled: false, clientId: null }));
  }, []);

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

          {googleConfig && (
            <>
              {googleConfig.enabled && googleConfig.clientId ? (
                <GoogleSignIn
                  clientId={googleConfig.clientId}
                  lang={lang}
                  busy={googleBusy}
                  onCredential={async (credential) => {
                    setError('');
                    setGoogleBusy(true);
                    try {
                      await signInWithGoogle(credential);
                    } catch (err) {
                      setError(errorMessage(err, lang));
                      setGoogleBusy(false);
                    }
                  }}
                  onError={() => setError(lang === 'en' ? 'Google sign-in could not load.' : 'تعذّر تحميل تسجيل الدخول بجوجل.')}
                />
              ) : (
                <button
                  type="button"
                  onClick={() =>
                    setError(
                      lang === 'en'
                        ? 'Google sign-in is ready in Qodo, but GOOGLE_CLIENT_ID still needs to be added on the server.'
                        : 'تسجيل Google جاهز داخل Qodo، لكن لازم نضيف GOOGLE_CLIENT_ID على الخادم أولًا.'
                    )
                  }
                  className="flex min-h-[44px] w-full items-center justify-center gap-3 rounded-md border border-[#DADCE0] bg-white px-4 text-[13px] font-semibold text-[#3C4043] transition hover:bg-[#F8FAFD]"
                >
                  <GoogleMark />
                  {lang === 'en' ? 'Continue with Google' : 'المتابعة باستخدام Google'}
                </button>
              )}
              <div className="my-5 flex items-center gap-3 text-[11px] font-semibold text-ink-faint">
                <span className="h-px flex-1 bg-surface-line" />
                {lang === 'en' ? 'or use your Qodo password' : 'أو استخدم كلمة مرور Qodo'}
                <span className="h-px flex-1 bg-surface-line" />
              </div>
            </>
          )}

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

          {googleConfig && (
            <p className="mt-3 flex items-start justify-center gap-1.5 text-center text-[11px] leading-relaxed text-ink-faint">
              <LockKeyhole size={13} className="mt-0.5 shrink-0 text-status-ok" />
              {lang === 'en'
                ? 'Google verifies your identity only. Qodo never reads your Gmail inbox.'
                : 'جوجل يتحقق من هويتك فقط؛ Qodo لا يقرأ رسائل Gmail.'}
            </p>
          )}

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

function GoogleMark() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
      <path fill="#4285F4" d="M17.64 9.205c0-.639-.057-1.252-.164-1.841H9v3.481h4.844a4.14 4.14 0 0 1-1.797 2.716v2.258h2.909c1.702-1.567 2.684-3.877 2.684-6.614Z" />
      <path fill="#34A853" d="M9 18c2.43 0 4.468-.806 5.956-2.181l-2.909-2.258c-.806.54-1.835.859-3.047.859-2.344 0-4.328-1.585-5.037-3.714H.956v2.332A9 9 0 0 0 9 18Z" />
      <path fill="#FBBC05" d="M3.963 10.706A5.42 5.42 0 0 1 3.681 9c0-.593.102-1.169.282-1.706V4.962H.956A9 9 0 0 0 0 9c0 1.452.348 2.827.956 4.038l3.007-2.332Z" />
      <path fill="#EA4335" d="M9 3.58c1.321 0 2.507.454 3.441 1.346l2.581-2.581C13.464.892 11.426 0 9 0A9 9 0 0 0 .956 4.962l3.007 2.332C4.672 5.165 6.656 3.58 9 3.58Z" />
    </svg>
  );
}

function GoogleSignIn({
  clientId,
  lang,
  busy,
  onCredential,
  onError,
}: {
  clientId: string;
  lang: 'ar' | 'en';
  busy: boolean;
  onCredential: (credential: string) => void;
  onError: () => void;
}) {
  const buttonRef = useRef<HTMLDivElement>(null);
  const credentialHandler = useRef(onCredential);
  const errorHandler = useRef(onError);
  credentialHandler.current = onCredential;
  errorHandler.current = onError;

  useEffect(() => {
    let cancelled = false;
    const render = () => {
      if (cancelled || !buttonRef.current || !window.google) return;
      buttonRef.current.replaceChildren();
      window.google.accounts.id.initialize({
        client_id: clientId,
        context: 'signin',
        ux_mode: 'popup',
        callback: (response) => response.credential && credentialHandler.current(response.credential),
      });
      window.google.accounts.id.renderButton(buttonRef.current, {
        type: 'standard',
        theme: 'outline',
        size: 'large',
        text: 'continue_with',
        shape: 'rectangular',
        width: 352,
        locale: lang === 'ar' ? 'ar' : 'en',
      });
    };

    const existing = document.querySelector<HTMLScriptElement>('script[data-google-identity]');
    if (window.google) render();
    else if (existing) existing.addEventListener('load', render, { once: true });
    else {
      const script = document.createElement('script');
      script.src = 'https://accounts.google.com/gsi/client';
      script.async = true;
      script.defer = true;
      script.dataset.googleIdentity = 'true';
      script.addEventListener('load', render, { once: true });
      script.addEventListener('error', () => errorHandler.current(), { once: true });
      document.head.appendChild(script);
    }

    return () => {
      cancelled = true;
      existing?.removeEventListener('load', render);
    };
  }, [clientId, lang]);

  return (
    <div className="relative min-h-[44px] overflow-hidden rounded-lg">
      <div ref={buttonRef} className={busy ? 'pointer-events-none opacity-40' : ''} />
      {busy && (
        <div className="absolute inset-0 grid place-items-center rounded-lg bg-white/80 text-[12px] font-semibold text-ink-muted">
          <span className="flex items-center gap-2"><Spinner size={15} />{lang === 'en' ? 'Signing in…' : 'جارٍ تسجيل الدخول…'}</span>
        </div>
      )}
    </div>
  );
}
