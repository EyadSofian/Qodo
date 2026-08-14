import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useLocation } from 'react-router-dom';
import {
  AlertCircle,
  ArrowUp,
  BarChart3,
  BrainCircuit,
  BriefcaseBusiness,
  CheckCircle2,
  Compass,
  Database,
  ListTodo,
  Mail,
  ShieldCheck,
  Sparkles,
  Square,
  Target,
  Trash2,
  Users,
  X,
} from 'lucide-react';
import { useAuth } from '../lib/auth';
import { useI18n, type StringKey } from '../lib/i18n';
import { cx } from '../lib/utils';
import { Avatar } from './ui';
import { LogoMark } from './Brand';

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  sources?: string[];
}

interface PendingConfirmation {
  actionId: string;
  tool: 'create_task';
  message: string;
  arguments: Record<string, string>;
}

const FALLBACK_SUGGESTION_KEYS: StringKey[] = [
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
  const location = useLocation();
  const page = pageContext(location.pathname, lang);
  const PageIcon = page.icon;
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState('');
  const [streaming, setStreaming] = useState('');
  const [activity, setActivity] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [available, setAvailable] = useState<boolean | null>(null);
  const [pendingConfirmation, setPendingConfirmation] = useState<PendingConfirmation | null>(null);
  const [liveSources, setLiveSources] = useState<string[]>([]);

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
      setLiveSources([]);
      setError('');
      setBusy(true);

      const controller = new AbortController();
      abortRef.current = controller;
      let answer = '';
      const answerSources = new Set<string>();

      try {
        const response = await fetch('/api/assistant/chat', {
          method: 'POST',
          credentials: 'same-origin',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            messages: next.map(({ role, content }) => ({ role, content })),
            lang,
            context: { path: location.pathname },
          }),
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
            let event: {
              type: string;
              delta?: string;
              label?: string;
              message?: string;
              actionId?: string;
              tool?: string;
              arguments?: Record<string, string>;
              source?: string;
            };
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
            } else if (event.type === 'source' && event.source) {
              answerSources.add(event.source);
              setLiveSources([...answerSources]);
            } else if (
              event.type === 'confirmation' &&
              event.actionId &&
              event.tool === 'create_task' &&
              event.message
            ) {
              setPendingConfirmation({
                actionId: event.actionId,
                tool: 'create_task',
                message: event.message,
                arguments: event.arguments ?? {},
              });
              setActivity(null);
            } else if (event.type === 'error') {
              setError(event.message ?? t('assistant.connError'));
            }
          }
        }

        if (answer.trim()) {
          setMessages([...next, { role: 'assistant', content: answer, sources: [...answerSources] }]);
        }
      } catch (err) {
        if ((err as Error)?.name !== 'AbortError') {
          setError((err as Error)?.message || t('assistant.connError'));
        }
        // Keep a partial answer rather than throwing away what already arrived.
        if (answer.trim()) {
          setMessages([...next, { role: 'assistant', content: answer, sources: [...answerSources] }]);
        }
      } finally {
        setStreaming('');
        setActivity(null);
        setBusy(false);
        abortRef.current = null;
      }
    },
    [messages, busy, lang, t, location.pathname]
  );

  const confirmPending = useCallback(async () => {
    if (!pendingConfirmation || confirming) return;
    setConfirming(true);
    setError('');
    try {
      const response = await fetch('/api/assistant/confirm', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ actionId: pendingConfirmation.actionId, lang }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.message || t('assistant.confirmFailed'));
      setMessages((current) => [
        ...current,
        { role: 'assistant', content: t('assistant.taskCreated') },
      ]);
      setPendingConfirmation(null);
    } catch (err) {
      setError((err as Error)?.message || t('assistant.confirmFailed'));
    } finally {
      setConfirming(false);
    }
  }, [confirming, lang, pendingConfirmation, t]);

  const cancelPending = useCallback(async () => {
    if (!pendingConfirmation || confirming) return;
    const actionId = pendingConfirmation.actionId;
    setPendingConfirmation(null);
    await fetch('/api/assistant/cancel', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ actionId }),
    }).catch(() => undefined);
  }, [confirming, pendingConfirmation]);

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
        className="relative z-10 flex h-full w-full flex-col overflow-hidden bg-[linear-gradient(180deg,#f8fbff_0%,#eef5fb_100%)] shadow-panel animate-fade-up sm:max-w-xl"
      >
        <header className="relative overflow-hidden border-b border-white/10 bg-navy px-4 py-4 text-white pt-safe">
          <span className="pointer-events-none absolute -end-10 -top-16 h-44 w-44 rounded-full bg-brand-500/35 blur-3xl" />
          <span className="pointer-events-none absolute -bottom-16 start-20 h-32 w-40 rounded-full bg-cyan-400/15 blur-3xl" />
          <div className="relative flex items-center gap-3">
          <span className="grid h-10 w-10 place-items-center rounded-[14px] border border-white/15 bg-white/10 shadow-inner backdrop-blur-xl">
            <LogoMark size={28} />
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <h2 className="text-[14px] font-extrabold leading-tight">Qodo AI</h2>
              <span className="rounded-full border border-emerald-300/25 bg-emerald-300/10 px-2 py-0.5 text-[8.5px] font-extrabold uppercase tracking-[.12em] text-emerald-200">
                {lang === 'ar' ? 'بيانات حيّة' : 'Live data'}
              </span>
            </div>
            <p className="mt-0.5 truncate text-[10.5px] leading-tight text-white/55">{page.label}</p>
          </div>
          {messages.length > 0 && !busy && (
            <button
              type="button"
              onClick={() => {
                setMessages([]);
                setError('');
                setPendingConfirmation(null);
              }}
              className="grid h-9 w-9 place-items-center rounded-xl text-white/55 transition hover:bg-white/10 hover:text-white"
              aria-label={t('assistant.newChat')}
              title={t('assistant.newChat')}
            >
              <Trash2 size={16} />
            </button>
          )}
          <button type="button" onClick={onClose} className="grid h-9 w-9 place-items-center rounded-xl text-white/55 transition hover:bg-white/10 hover:text-white" aria-label={t('common.close')}>
            <X size={18} />
          </button>
          </div>
        </header>

        <div ref={scrollRef} className="flex-1 overflow-y-auto overscroll-contain px-4 py-4">
          {available === false && (
            <div className="mb-4 flex items-start gap-2 rounded-xl bg-status-warnBg px-3 py-2.5 text-[12.5px] leading-relaxed text-accent-600">
              <AlertCircle size={15} className="mt-0.5 shrink-0" />
              <span>{t('assistant.notConfigured')}</span>
            </div>
          )}

          {messages.length === 0 && !streaming && (
            <div className="px-1 py-4">
              <div className="ai-glass-card relative overflow-hidden p-5 text-start">
                <span className="pointer-events-none absolute -end-10 -top-12 h-36 w-36 rounded-full bg-brand-300/20 blur-3xl" />
                <div className="relative flex items-start gap-3">
                  <span className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-navy text-white shadow-lg">
                    <PageIcon size={20} />
                  </span>
                  <div>
                    <p className="text-[10px] font-extrabold uppercase tracking-[.13em] text-brand-600">
                      {lang === 'ar' ? 'ذكاء الصفحة الحالية' : 'Current-page intelligence'}
                    </p>
                    <p className="mt-1 text-[16px] font-extrabold text-ink">{page.title}</p>
                    <p className="mt-1 text-[11.5px] leading-relaxed text-ink-muted">{page.body}</p>
                  </div>
                </div>
                <div className="relative mt-4 flex items-center gap-2 rounded-xl border border-white/80 bg-white/55 px-3 py-2 text-[10px] text-ink-muted backdrop-blur-xl">
                  <ShieldCheck size={13} className="shrink-0 text-emerald-600" />
                  {lang === 'ar'
                    ? 'يقرأ فقط ما تسمح به صلاحياتك، وأي تنفيذ يحتاج تأكيدك.'
                    : 'Reads only what your access allows; every write still needs confirmation.'}
                </div>
              </div>
              <div className="mt-3 grid w-full gap-2 sm:grid-cols-2">
                {page.suggestions.map((suggestion, index) => (
                  <button
                    key={suggestion}
                    type="button"
                    onClick={() => ask(suggestion)}
                    disabled={available === false}
                    className="group flex min-h-[62px] items-start gap-2.5 rounded-2xl border border-white/80 bg-white/65 px-3 py-3 text-start text-[11.5px] font-semibold leading-relaxed text-ink shadow-sm backdrop-blur-xl transition hover:-translate-y-0.5 hover:border-brand-200 hover:bg-white disabled:opacity-50"
                  >
                    <span className="mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-lg bg-brand-50 text-brand-600 transition group-hover:bg-brand-500 group-hover:text-white">
                      {index === 0 ? <BarChart3 size={13} /> : index === 1 ? <Target size={13} /> : index === 2 ? <ListTodo size={13} /> : <Compass size={13} />}
                    </span>
                    {suggestion}
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className="grid gap-3">
            {messages.map((message, index) => (
              <Bubble key={index} message={message} userName={user?.name ?? ''} userColor={user?.avatarColor} lang={lang} />
            ))}

            {streaming && (
              <Bubble
                message={{ role: 'assistant', content: streaming }}
                userName={user?.name ?? ''}
                userColor={user?.avatarColor}
                sources={liveSources}
                lang={lang}
              />
            )}

            {busy && !streaming && (
              <div className="flex items-center gap-2.5 rounded-2xl border border-white/80 bg-white/55 px-3 py-2.5 text-[11.5px] font-semibold text-ink-muted shadow-sm backdrop-blur-xl">
                <span className="grid h-7 w-7 shrink-0 place-items-center rounded-xl bg-brand-50 text-brand-500">
                  <BrainCircuit size={15} />
                </span>
                <span className="flex items-center gap-1.5">
                  {activity ?? t('assistant.thinking')}
                  <Dots />
                </span>
              </div>
            )}

            {pendingConfirmation && (
              <div className="ai-glass-card ms-9 overflow-hidden p-0">
                <div className="flex items-center gap-2 border-b border-white/70 bg-brand-50/60 px-3.5 py-2.5 text-[10px] font-extrabold text-brand-700">
                  <CheckCircle2 size={14} />
                  {lang === 'ar' ? 'تنفيذ ينتظر موافقتك' : 'Action awaiting your approval'}
                </div>
                <div className="p-3.5">
                <p className="text-[13.5px] font-semibold leading-relaxed text-ink">
                  {pendingConfirmation.message}
                </p>
                {pendingConfirmation.arguments.dueDate && (
                  <p className="mt-1 text-[12px] text-ink-muted">
                    {t('assistant.dueDate')}: {pendingConfirmation.arguments.dueDate}
                  </p>
                )}
                <div className="mt-3 flex gap-2">
                  <button
                    type="button"
                    className="btn-primary !min-h-9 px-3 text-[12.5px]"
                    disabled={confirming}
                    onClick={confirmPending}
                  >
                    {confirming ? t('assistant.confirming') : t('assistant.confirm')}
                  </button>
                  <button
                    type="button"
                    className="btn-ghost !min-h-9 px-3 text-[12.5px]"
                    disabled={confirming}
                    onClick={cancelPending}
                  >
                    {t('assistant.cancel')}
                  </button>
                </div>
                </div>
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
          className="border-t border-white/80 bg-white/75 p-3 backdrop-blur-xl pb-safe"
        >
          <div className="flex items-end gap-2">
            <div className="flex flex-1 items-end gap-2 rounded-[18px] border border-white/90 bg-white/75 p-1.5 shadow-[0_14px_38px_-28px_rgba(11,37,69,.55)] backdrop-blur-xl transition focus-within:border-brand-300 focus-within:ring-2 focus-within:ring-brand-100">
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
              className="max-h-32 min-h-[40px] flex-1 resize-y bg-transparent px-2 py-2.5 text-[13px] text-ink outline-none placeholder:text-ink-faint"
            />
            {busy ? (
              <button type="button" onClick={stop} className="grid h-10 w-10 place-items-center rounded-xl bg-surface-sunken text-ink-muted" aria-label={t('assistant.stop')}>
                <Square size={16} />
              </button>
            ) : (
              <button
                type="submit"
                className="grid h-10 w-10 place-items-center rounded-xl bg-gradient-to-br from-brand-500 to-brand-700 text-white shadow-md transition hover:brightness-110 disabled:opacity-40"
                disabled={!draft.trim() || available === false}
                aria-label={t('assistant.send')}
              >
                <ArrowUp size={17} />
              </button>
            )}
            </div>
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
  sources,
  lang,
}: {
  message: ChatMessage;
  userName: string;
  userColor?: string;
  sources?: string[];
  lang: 'ar' | 'en';
}) {
  const mine = message.role === 'user';
  return (
    <div className={cx('flex items-start gap-2.5', mine && 'flex-row-reverse')}>
      {mine ? (
        <Avatar name={userName} color={userColor} size={28} className="mt-0.5 shrink-0" />
      ) : (
        <span className="mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-xl bg-navy text-white shadow-sm">
          <BrainCircuit size={16} />
        </span>
      )}
      {mine ? (
        <div className="max-w-[85%] whitespace-pre-wrap break-words rounded-2xl rounded-se-md bg-navy px-3.5 py-2.5 text-[13px] leading-relaxed text-white">
          {message.content}
        </div>
      ) : (
        <AssistantCard content={message.content} sources={sources ?? message.sources ?? []} lang={lang} />
      )}
    </div>
  );
}

function AssistantCard({ content, sources, lang }: { content: string; sources: string[]; lang: 'ar' | 'en' }) {
  const lines = content.split('\n').map((line) => line.trim()).filter(Boolean);
  const hasDecision = /قرار|توصي|recommend|decision/i.test(content);
  const title = hasDecision
    ? lang === 'ar' ? 'موجز القرار' : 'Decision brief'
    : lang === 'ar' ? 'ملخص Qodo' : 'Qodo brief';

  return (
    <article className="ai-glass-card max-w-[88%] overflow-hidden">
      <header className="flex items-center gap-2 border-b border-white/70 bg-white/35 px-3.5 py-2.5 backdrop-blur-xl">
        <span className="grid h-6 w-6 place-items-center rounded-lg bg-brand-500 text-white shadow-sm">
          {hasDecision ? <Target size={13} /> : <Sparkles size={13} />}
        </span>
        <span className="flex-1 text-[10.5px] font-extrabold uppercase tracking-[.08em] text-brand-700">{title}</span>
        <span className="flex items-center gap-1 text-[8.5px] font-bold text-emerald-700"><ShieldCheck size={10} />{lang === 'ar' ? 'مؤمّن' : 'Grounded'}</span>
      </header>
      <div className="break-words px-3.5 py-3 text-[13px] leading-7 text-ink">
        {lines.map((line, index) => {
          const heading = /^(?:#{1,3}\s*)?(?:\*\*)?(الخلاصة|المؤشرات|المخاطر|التوصية|القرار المقترح|الخطوة التالية|summary|signals|risks|recommendation|next step)(?:\*\*)?\s*[:：]?/i.exec(line);
          const bullet = /^[-•]\s+/.test(line);
          if (heading) {
            const rest = line.slice(heading[0].length).trim();
            return <div key={index} className={cx(index > 0 && 'mt-3')}><p className="text-[10px] font-extrabold uppercase tracking-[.08em] text-brand-600">{heading[1]}</p>{rest && <p className="mt-0.5">{rest}</p>}</div>;
          }
          if (bullet) return <p key={index} className="flex gap-2"><span className="mt-[11px] h-1.5 w-1.5 shrink-0 rounded-full bg-brand-400" />{line.replace(/^[-•]\s+/, '')}</p>;
          return <p key={index} className={cx(index > 0 && 'mt-1.5')}>{line}</p>;
        })}
      </div>
      {sources.length > 0 && (
        <footer className="flex flex-wrap items-center gap-1.5 border-t border-white/70 bg-white/30 px-3.5 py-2 backdrop-blur-xl">
          <Database size={11} className="text-ink-faint" />
          <span className="me-0.5 text-[8.5px] font-bold text-ink-faint">{lang === 'ar' ? 'المصادر' : 'Sources'}</span>
          {[...new Set(sources)].map((source) => <span key={source} className="rounded-full border border-white/80 bg-white/70 px-2 py-0.5 text-[8.5px] font-bold text-ink-muted">{source}</span>)}
        </footer>
      )}
    </article>
  );
}

function pageContext(pathname: string, lang: 'ar' | 'en') {
  const fallbackSuggestions = FALLBACK_SUGGESTION_KEYS.map((key) =>
    lang === 'ar'
      ? ({
          'assistant.suggest1': 'ما المهام المتأخرة لدينا؟',
          'assistant.suggest2': 'من المسؤول عن ماذا الآن؟',
          'assistant.suggest3': 'حلّل أداء الشركة واقترح الأولوية التالية',
          'assistant.suggest4': 'لخّص لي أعمال هذا الأسبوع',
        } as Record<StringKey, string>)[key]
      : ({
          'assistant.suggest1': 'Which tasks are overdue?',
          'assistant.suggest2': 'Who is working on what right now?',
          'assistant.suggest3': 'Analyse company performance and suggest the next priority',
          'assistant.suggest4': 'Summarise this week’s work',
        } as Record<StringKey, string>)[key]
  );
  const contexts = [
    {
      match: '/tasks', icon: ListTodo,
      ar: ['ذكاء لوحة المهام', 'حلّل ضغط العمل والتأخير قبل ما يتحول لمشكلة.', ['اديني موجز قرار عن تنفيذ المهام', 'إيه أكبر مخاطر التسليم دلوقتي؟', 'مين عنده مهام متأخرة أو حمل زائد؟', 'لخّص إنجاز الفريق هذا الأسبوع']],
      en: ['Task-board intelligence', 'Analyse workload and delays before they become delivery problems.', ['Give me a delivery decision brief', 'What are the biggest delivery risks?', 'Who has overdue work or a heavy load?', 'Summarise the team’s wins this week']],
    },
    {
      match: '/management', icon: BriefcaseBusiness,
      ar: ['ذكاء الإدارة', 'حوّل الأجندة والقرارات المفتوحة إلى أولويات واضحة.', ['اديني موجز قرار للإدارة النهاردة', 'إيه المتأخر ومحتاج تدخل؟', 'لخّص القرارات المفتوحة والمخاطر', 'رتّب الأولويات حسب التأثير والاستعجال']],
      en: ['Management intelligence', 'Turn the agenda and open decisions into clear priorities.', ['Give me today’s management decision brief', 'What is late and needs intervention?', 'Summarise open decisions and risks', 'Rank priorities by impact and urgency']],
    },
    {
      match: '/mail', icon: Mail,
      ar: ['ذكاء التواصل', 'اربط المحادثات بأداء العمل والمهام من نفس مساحة Qodo.', ['اديني موجز قرار عن وضع الشركة', 'إيه المهام المتأخرة المرتبطة بفريقي؟', 'حلّل ضغط خدمة العملاء الآن', 'إيه الأولوية اللي لازم نتحرك فيها؟']],
      en: ['Communication intelligence', 'Connect conversations to work and performance across Qodo.', ['Give me a company decision brief', 'Which overdue tasks affect my team?', 'Analyse the current support load', 'What priority should we act on next?']],
    },
    {
      match: '/users', icon: Users,
      ar: ['ذكاء الفريق', 'افهم توزيع العمل والفِرق بدون تجاوز صلاحيات البيانات.', ['مين عنده أكبر حمل عمل؟', 'وريني توزيع المهام على الأقسام', 'مين متاح لمهمة جديدة؟', 'إيه اختناقات الفريق الحالية؟']],
      en: ['Team intelligence', 'Understand workload and team structure within your access.', ['Who has the largest workload?', 'Show task distribution by department', 'Who may be available for new work?', 'What are the current team bottlenecks?']],
    },
    {
      match: '/', icon: BrainCircuit,
      ar: ['ذكاء مساحة العمل', 'اسأل Qodo عن المهام والتسويق والمبيعات وخدمة العملاء في مكان واحد.', fallbackSuggestions],
      en: ['Workspace intelligence', 'Ask Qodo about tasks, marketing, sales and support from one place.', fallbackSuggestions],
    },
  ];
  const current = contexts.find((item) => item.match === '/' ? true : pathname.startsWith(item.match))!;
  const [title, body, suggestions] = current[lang] as [string, string, string[]];
  return { icon: current.icon, title, body, suggestions, label: title };
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
