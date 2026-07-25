import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import { AlertCircle, CheckCircle2, Loader2, X } from 'lucide-react';
import { cx, initials, readableOn } from '../lib/utils';

/* ── Avatar ──────────────────────────────────────────────────────── */

export function Avatar({
  name,
  color = '#1D6FB8',
  size = 32,
  className,
}: {
  name: string;
  color?: string;
  size?: number;
  className?: string;
}) {
  return (
    <span
      className={cx('inline-grid place-items-center rounded-full font-bold', className)}
      style={{
        width: size,
        height: size,
        background: color,
        color: readableOn(color),
        fontSize: Math.max(10, Math.round(size * 0.38)),
      }}
      title={name}
    >
      {initials(name)}
    </span>
  );
}

/* ── Modal ───────────────────────────────────────────────────────── */

export function Modal({
  open,
  onClose,
  title,
  children,
  footer,
  width = 'md',
}: {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  width?: 'sm' | 'md' | 'lg';
}) {
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    // Stop the page behind from scrolling under the sheet on phones.
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    panelRef.current?.focus();
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = previous;
    };
  }, [open, onClose]);

  if (!open) return null;

  const widths = { sm: 'sm:max-w-md', md: 'sm:max-w-xl', lg: 'sm:max-w-3xl' };

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center">
      <div
        className="absolute inset-0 bg-navy/40 backdrop-blur-sm animate-pop-in"
        onClick={onClose}
        aria-hidden="true"
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        tabIndex={-1}
        className={cx(
          'relative z-10 flex max-h-[92dvh] w-full flex-col rounded-t-3xl bg-white shadow-panel',
          'animate-fade-up sm:rounded-2xl',
          widths[width]
        )}
      >
        <header className="flex items-center justify-between gap-3 border-b border-surface-line px-5 py-4">
          <h2 className="text-base font-bold text-ink">{title}</h2>
          <button type="button" onClick={onClose} className="btn-quiet !min-h-9 rounded-lg p-1.5" aria-label="إغلاق">
            <X size={18} />
          </button>
        </header>
        <div className="flex-1 overflow-y-auto px-5 py-4">{children}</div>
        {footer && (
          <footer className="flex flex-wrap items-center justify-end gap-2 border-t border-surface-line px-5 py-3 pb-safe sm:pb-3">
            {footer}
          </footer>
        )}
      </div>
    </div>,
    document.body
  );
}

/* ── Toasts ──────────────────────────────────────────────────────── */

type Toast = { id: number; message: string; tone: 'ok' | 'bad' };
const ToastContext = createContext<{ push: (message: string, tone?: 'ok' | 'bad') => void } | null>(
  null
);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const counter = useRef(0);

  const push = useCallback((message: string, tone: 'ok' | 'bad' = 'ok') => {
    const id = ++counter.current;
    setToasts((list) => [...list, { id, message, tone }]);
    setTimeout(() => setToasts((list) => list.filter((t) => t.id !== id)), 4200);
  }, []);

  const value = useMemo(() => ({ push }), [push]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      {createPortal(
        <div className="pointer-events-none fixed inset-x-0 bottom-0 z-[60] flex flex-col items-center gap-2 p-4 pb-safe">
          {toasts.map((toast) => (
            <div
              key={toast.id}
              role="status"
              className={cx(
                'pointer-events-auto flex max-w-md items-center gap-2.5 rounded-xl px-4 py-3',
                'text-sm font-semibold shadow-lift animate-fade-up',
                toast.tone === 'ok' ? 'bg-navy text-white' : 'bg-status-bad text-white'
              )}
            >
              {toast.tone === 'ok' ? <CheckCircle2 size={17} /> : <AlertCircle size={17} />}
              <span>{toast.message}</span>
            </div>
          ))}
        </div>,
        document.body
      )}
    </ToastContext.Provider>
  );
}

export function useToast() {
  const context = useContext(ToastContext);
  if (!context) throw new Error('useToast must be used inside <ToastProvider>');
  return context;
}

/* ── Small pieces ────────────────────────────────────────────────── */

export function Field({
  label,
  hint,
  error,
  children,
  required,
}: {
  label: string;
  hint?: string;
  error?: string;
  children: ReactNode;
  required?: boolean;
}) {
  return (
    <label className="block">
      <span className="label">
        {label}
        {required && <span className="text-status-bad"> *</span>}
      </span>
      {children}
      {error ? (
        <span className="mt-1 block text-[12px] font-semibold text-status-bad">{error}</span>
      ) : hint ? (
        <span className="mt-1 block text-[12px] text-ink-faint">{hint}</span>
      ) : null}
    </label>
  );
}

export function Spinner({ size = 18, className }: { size?: number; className?: string }) {
  return <Loader2 size={size} className={cx('animate-spin', className)} />;
}

export function EmptyState({
  icon,
  title,
  body,
  action,
}: {
  icon?: ReactNode;
  title: string;
  body?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 px-6 py-14 text-center">
      {icon && <div className="text-ink-faint">{icon}</div>}
      <h3 className="text-base font-bold text-ink">{title}</h3>
      {body && <p className="max-w-sm text-sm leading-relaxed text-ink-muted">{body}</p>}
      {action}
    </div>
  );
}

export function Segmented<T extends string>({
  value,
  onChange,
  options,
  className,
}: {
  value: T;
  onChange: (value: T) => void;
  options: Array<{ value: T; label: string; count?: number }>;
  className?: string;
}) {
  return (
    <div
      role="tablist"
      className={cx(
        'no-scrollbar flex gap-1 overflow-x-auto rounded-xl border border-surface-line bg-white p-1',
        className
      )}
    >
      {options.map((option) => {
        const active = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(option.value)}
            className={cx(
              'flex shrink-0 items-center gap-1.5 rounded-lg px-3 py-2 text-[13px] font-semibold transition-colors',
              active ? 'bg-navy text-white shadow-sm' : 'text-ink-muted hover:bg-surface-sunken'
            )}
          >
            {option.label}
            {option.count !== undefined && (
              <span
                className={cx(
                  'rounded-full px-1.5 text-[11px] tabular-nums',
                  active ? 'bg-white/20' : 'bg-surface-sunken text-ink-faint'
                )}
              >
                {option.count}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
