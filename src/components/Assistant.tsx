import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { AlertCircle, ArrowUp, Bot, Square, Trash2, X } from 'lucide-react';
import { useAuth } from '../lib/auth';
import { useI18n, type StringKey } from '../lib/i18n';
import { cx } from '../lib/utils';
import { Avatar } from './ui';
import { LogoMark } from './Brand';

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

const SUGGESTION_KEYS: StringKey[] = [
  'assistant.suggest1',
  'assistant.suggest2',
  'assistant.suggest3',
  'assistant.suggest4',
];

/**
 * The workspace assistant panel.
 *
 * Answers stream in token by token, and each tool the model reaches for is
 * announced while it runs — a data question can take several seconds, and a
 * silent spinner reads as broken.
 */
export function Assistant({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { user } = useAuth();
  const { t, lang } = useI18n();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState('');
  const [streaming, setStreaming] = useState('');
  const [activity, setActivity] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [available, setAvailable] = useState<boolean | null>(null);

  const abortRef = useRef<AbortController | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (!open) return;
    fetch('/api/assistant/status', { credentials: 'same-origin' })
      .then((r) => r.json())
      .then((data) => setAvailable(Boolean(data.available)))
      .catch(() => setAvailable(false));
    requestAnimationFrame(() => inputRef.current?.focus());
  }, [open]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages, streaming, activity]);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => event.key === 'Escape' && !busy && onClose();
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose, busy]);

  // Leaving the panel mid-answer must not leave the request running.
  useEffect(() => () => abortRef.current?.abort(), []);

  const stop = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
  }, []);

  const ask = useCallback(
    async (question: string) => {
      const text = question.trim();
      if (!text || busy) return;

      const next: ChatMessage[] = [...messages, { role: 'user', content: text }];
      setMessages(next);
      setDraft('');
      setStreaming('');
      setActivity(null);
      setError('');
      setBusy(true);

      const controller = new AbortController();
      abortRef.current = controller;
      let answer = '';

      try {
        const response = await fetch('/api/assistant/chat', {
          method: 'POST',
          credentials: 'same-origin',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ messages: next, lang }),
          signal: controller.signal,
        });

        if (!response.ok || !response.body) {
          const payload = await response.json().catch(() => ({}));
          throw new Error(
            payload.error === 'assistant_not_configured'
              ? t('assistant.notConfigured')
              : t('assistant.unreachable')
          );
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';

        // SSE frames are separated by a blank line; a chunk can split one in
        // half, so anything after the last separator stays in the buffer.
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });

          const frames = buffer.split('\n\n');
          buffer = frames.pop() ?? '';

          for (const frame of frames) {
            const line = frame.split('\n').find((l) => l.startsWith('data: '));
            if (!line) continue;
            let event: { type: string; delta?: string; label?: string; message?: string };
            try {
              event = JSON.parse(line.slice(6));
            } catch {
              continue;
            }

            if (event.type === 'text' && event.delta) {
              answer += event.delta;
              setActivity(null);
              setStreaming(answer);
            } else if (event.type === 'tool') {
              setActivity(event.label ?? null);
            } else if (event.type === 'error') {
              setError(event.message ?? t('assistant.connError'));
            }
          }
        }

        if (answer.trim()) setMessages([...next, { role: 'assistant', content: answer }]);
      } catch (err) {
        if ((err as Error)?.name !== 'AbortError') {
          setError((err as Error)?.message || t('assistant.connError'));
        }
        // Keep a partial answer rather than throwing away what already arrived.
        if (answer.trim()) setMessages([...next, { role: 'assistant', content: answer }]);
      } finally {
        setStreaming('');
        setActivity(null);
        setBusy(false);
        abortRef.current = null;
      }
    },
    [messages, busy, lang, t]
  );

  if (!open) return null;

  return createPortal(
    <div className="fixed inset-0 z-[65] flex justify-start">
      <div
        className="absolute inset-0 bg-navy/40 backdrop-blur-sm"
        onClick={busy ? undefined : onClose}
        aria-hidden="true"
      />

      <aside
        role="dialog"
        aria-modal="true"
        aria-label={t('assistant.title')}
        className="relative z-10 flex h-full w-full flex-col bg-white shadow-panel animate-fade-up sm:max-w-lg"
      >
        <header className="flex items-center gap-3 border-b border-surface-line px-4 py-3 pt-safe">
          <LogoMark size={32} />
          <div className="min-w-0 flex-1">
            <h2 className="text-[14px] font-bold leading-tight text-ink">{t('assistant.title')}</h2>
            <p className="text-[11.5px] leading-tight text-ink-faint">{t('assistant.subtitle')}</p>
          </div>
          {messages.length > 0 && !busy && (
            <button
              type="button"
              onClick={() => {
                setMessages([]);
                setError('');
              }}
              className="btn-quiet !min-h-9 rounded-lg px-2"
              aria-label={t('assistant.newChat')}
              title={t('assistant.newChat')}
            >
              <Trash2 size={16} />
            </button>
          )}
          <button type="button" onClick={onClose} className="btn-quiet !min-h-9 rounded-lg px-2" aria-label={t('common.close')}>
            <X size={18} />
          </button>
        </header>

        <div ref={scrollRef} className="flex-1 overflow-y-auto overscroll-contain px-4 py-4">
          {available === false && (
            <div className="mb-4 flex items-start gap-2 rounded-xl bg-status-warnBg px-3 py-2.5 text-[12.5px] leading-relaxed text-accent-600">
              <AlertCircle size={15} className="mt-0.5 shrink-0" />
              <span>{t('assistant.notConfigured')}</span>
            </div>
          )}

          {messages.length === 0 && !streaming && (
            <div className="flex flex-col items-center gap-4 px-2 py-8 text-center">
              <span className="grid h-14 w-14 place-items-center rounded-2xl bg-brand-50 text-brand-500">
                <Bot size={26} />
              </span>
              <div>
                <p className="text-[15px] font-bold text-ink">{t('assistant.emptyTitle')}</p>
                <p className="mt-1 text-[12.5px] leading-relaxed text-ink-muted">{t('assistant.emptyBody')}</p>
              </div>
              <div className="grid w-full gap-2">
                {SUGGESTION_KEYS.map((key) => (
                  <button
                    key={key}
                    type="button"
                    onClick={() => ask(t(key))}
                    disabled={available === false}
                    className="rounded-xl border border-surface-line px-3 py-2.5 text-start text-[13px] text-ink transition-colors hover:border-brand-200 hover:bg-brand-50 disabled:opacity-50"
                  >
                    {t(key)}
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className="grid gap-3">
            {messages.map((message, index) => (
              <Bubble key={index} message={message} userName={user?.name ?? ''} userColor={user?.avatarColor} />
            ))}

            {streaming && (
              <Bubble
                message={{ role: 'assistant', content: streaming }}
                userName={user?.name ?? ''}
                userColor={user?.avatarColor}
              />
            )}

            {busy && !streaming && (
              <div className="flex items-center gap-2.5 text-[12.5px] text-ink-muted">
                <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-brand-50 text-brand-500">
                  <Bot size={15} />
                </span>
                <span className="flex items-center gap-1.5">
                  {activity ?? t('assistant.thinking')}
                  <Dots />
                </span>
              </div>
            )}
          </div>

          {error && (
            <p
              role="alert"
              className="mt-3 flex items-start gap-2 rounded-xl bg-status-badBg px-3 py-2.5 text-[12.5px] font-semibold text-status-bad"
            >
              <AlertCircle size={15} className="mt-0.5 shrink-0" />
              {error}
            </p>
          )}
        </div>

        <form
          onSubmit={(event) => {
            event.preventDefault();
            ask(draft);
          }}
          className="border-t border-surface-line p-3 pb-safe"
        >
          <div className="flex items-end gap-2">
            <textarea
              ref={inputRef}
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && !event.shiftKey) {
                  event.preventDefault();
                  ask(draft);
                }
              }}
              rows={1}
              disabled={available === false}
              placeholder={t('assistant.placeholder')}
              className="field max-h-32 min-h-[46px] flex-1 resize-y py-3"
            />
            {busy ? (
              <button type="button" onClick={stop} className="btn-ghost !min-h-[46px] px-3.5" aria-label={t('assistant.stop')}>
                <Square size={16} />
              </button>
            ) : (
              <button
                type="submit"
                className="btn-primary !min-h-[46px] px-3.5"
                disabled={!draft.trim() || available === false}
                aria-label={t('assistant.send')}
              >
                <ArrowUp size={17} />
              </button>
            )}
          </div>
        </form>
      </aside>
    </div>,
    document.body
  );
}

function Bubble({
  message,
  userName,
  userColor,
}: {
  message: ChatMessage;
  userName: string;
  userColor?: string;
}) {
  const mine = message.role === 'user';
  return (
    <div className={cx('flex items-start gap-2.5', mine && 'flex-row-reverse')}>
      {mine ? (
        <Avatar name={userName} color={userColor} size={28} className="mt-0.5 shrink-0" />
      ) : (
        <span className="mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-full bg-brand-50 text-brand-500">
          <Bot size={15} />
        </span>
      )}
      <div
        className={cx(
          'max-w-[85%] whitespace-pre-wrap break-words rounded-2xl px-3.5 py-2.5 text-[13.5px] leading-relaxed',
          mine ? 'bg-navy text-white' : 'bg-surface-sunken text-ink'
        )}
      >
        {message.content}
      </div>
    </div>
  );
}

function Dots() {
  return (
    <span className="inline-flex gap-0.5">
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          className="h-1 w-1 animate-pulse rounded-full bg-current"
          style={{ animationDelay: `${i * 160}ms` }}
        />
      ))}
    </span>
  );
}
