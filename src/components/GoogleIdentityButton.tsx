import { useEffect, useRef } from 'react';
import { Spinner } from './ui';

interface GoogleIdentityButtonProps {
  clientId: string | null;
  configured: boolean;
  lang: 'ar' | 'en';
  mode?: 'signin' | 'signup';
  busy?: boolean;
  disabled?: boolean;
  onCredential: (credential: string) => void;
  onError: () => void;
  onUnavailable: () => void;
}

/** Shared Google Identity Services entry point for login and invite signup. */
export function GoogleIdentityButton({
  clientId,
  configured,
  lang,
  mode = 'signin',
  busy = false,
  disabled = false,
  onCredential,
  onError,
  onUnavailable,
}: GoogleIdentityButtonProps) {
  if (!configured || !clientId) {
    return (
      <button
        type="button"
        onClick={onUnavailable}
        disabled={disabled || busy}
        className="flex min-h-[44px] w-full items-center justify-center gap-3 rounded-md border border-[#DADCE0] bg-white px-4 text-[13px] font-semibold text-[#3C4043] transition hover:bg-[#F8FAFD] disabled:cursor-not-allowed disabled:opacity-50"
      >
        {busy ? <Spinner size={16} /> : <GoogleMark />}
        {label(lang, mode, busy)}
      </button>
    );
  }

  return (
    <GoogleRenderedButton
      clientId={clientId}
      lang={lang}
      mode={mode}
      busy={busy}
      disabled={disabled}
      onCredential={onCredential}
      onError={onError}
    />
  );
}

function GoogleRenderedButton({
  clientId,
  lang,
  mode,
  busy,
  disabled,
  onCredential,
  onError,
}: Omit<GoogleIdentityButtonProps, 'configured' | 'onUnavailable'> & {
  clientId: string;
  mode: 'signin' | 'signup';
  busy: boolean;
  disabled: boolean;
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
        context: mode,
        ux_mode: 'popup',
        callback: (response) => response.credential && credentialHandler.current(response.credential),
      });
      window.google.accounts.id.renderButton(buttonRef.current, {
        type: 'standard',
        theme: 'outline',
        size: 'large',
        text: mode === 'signup' ? 'signup_with' : 'continue_with',
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
  }, [clientId, lang, mode]);

  return (
    <div
      className={`relative min-h-[44px] overflow-hidden rounded-lg ${
        disabled ? 'cursor-not-allowed opacity-50' : ''
      }`}
      aria-disabled={disabled || busy}
    >
      <div ref={buttonRef} className={disabled || busy ? 'pointer-events-none' : ''} />
      {busy && (
        <div className="absolute inset-0 grid place-items-center rounded-lg bg-white/85 text-[12px] font-semibold text-ink-muted">
          <span className="flex items-center gap-2">
            <Spinner size={15} />
            {label(lang, mode, true)}
          </span>
        </div>
      )}
    </div>
  );
}

function label(lang: 'ar' | 'en', mode: 'signin' | 'signup', busy: boolean) {
  if (busy) return lang === 'en' ? 'Connecting to Google…' : 'جارٍ الاتصال بجوجل…';
  if (mode === 'signup') return lang === 'en' ? 'Create account with Google' : 'إنشاء الحساب باستخدام Google';
  return lang === 'en' ? 'Continue with Google' : 'المتابعة باستخدام Google';
}

export function GoogleMark() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
      <path fill="#4285F4" d="M17.64 9.205c0-.639-.057-1.252-.164-1.841H9v3.481h4.844a4.14 4.14 0 0 1-1.797 2.716v2.258h2.909c1.702-1.567 2.684-3.877 2.684-6.614Z" />
      <path fill="#34A853" d="M9 18c2.43 0 4.468-.806 5.956-2.181l-2.909-2.258c-.806.54-1.835.859-3.047.859-2.344 0-4.328-1.585-5.037-3.714H.956v2.332A9 9 0 0 0 9 18Z" />
      <path fill="#FBBC05" d="M3.963 10.706A5.42 5.42 0 0 1 3.681 9c0-.593.102-1.169.282-1.706V4.962H.956A9 9 0 0 0 0 9c0 1.452.348 2.827.956 4.038l3.007-2.332Z" />
      <path fill="#EA4335" d="M9 3.58c1.321 0 2.507.454 3.441 1.346l2.581-2.581C13.464.892 11.426 0 9 0A9 9 0 0 0 .956 4.962l3.007 2.332C4.672 5.165 6.656 3.58 9 3.58Z" />
    </svg>
  );
}
