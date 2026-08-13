import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type FormEvent,
} from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  ArrowLeft,
  ArrowRight,
  BellRing,
  Bot,
  Building2,
  Check,
  FileText,
  Globe2,
  Hash,
  Inbox,
  ListTodo,
  Lock,
  Mail as MailIcon,
  Megaphone,
  MessageCircle,
  Paperclip,
  Plus,
  Reply,
  Search,
  Send,
  Sparkles,
  WandSparkles,
  X,
} from 'lucide-react';
import { api, errorMessage } from '../lib/api';
import { useAuth } from '../lib/auth';
import { useI18n } from '../lib/i18n';
import { PERMISSIONS } from '@shared/permissions';
import { cx } from '../lib/utils';
import { Avatar, EmptyState, Field, Modal, Spinner, useToast } from '../components/ui';
import type {
  MailAttachment,
  MailBootstrap,
  MailChannelScope,
  MailConversation,
  MailConversationKind,
  MailMessage,
  MailPerson,
} from '../lib/types';

type Filter = 'inbox' | MailConversationKind;
type AiAction = 'summary' | 'reply' | 'actions';
type AiResult = { text: string } | { items: AiActionItem[] };
type AiActionItem = { title: string; details: string; dueDate: string | null };

const POLL_MS = 15_000;

export function Mail() {
  const { user, can } = useAuth();
  const { lang, dir } = useI18n();
  const { push: toast } = useToast();
  const c = copy(lang);
  const [params, setParams] = useSearchParams();
  const selectedId = params.get('conversation');

  const [bootstrap, setBootstrap] = useState<MailBootstrap | null>(null);
  const [filter, setFilter] = useState<Filter>('inbox');
  const [query, setQuery] = useState('');
  const [messages, setMessages] = useState<MailMessage[]>([]);
  const [authors, setAuthors] = useState<Record<string, MailPerson>>({});
  const [threadLoading, setThreadLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [nextBefore, setNextBefore] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [draftFiles, setDraftFiles] = useState<MailAttachment[]>([]);
  const [replyTo, setReplyTo] = useState<MailMessage | null>(null);
  const [sending, setSending] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [composeOpen, setComposeOpen] = useState(false);
  const [aiOpen, setAiOpen] = useState(false);
  const [mobileThread, setMobileThread] = useState(Boolean(selectedId));
  const fileInput = useRef<HTMLInputElement>(null);
  const composer = useRef<HTMLTextAreaElement>(null);

  const refreshBootstrap = useCallback(async () => {
    const data = await api.get<MailBootstrap>('/mail/bootstrap');
    setBootstrap(data);
    return data;
  }, []);

  const loadThread = useCallback(async (conversationId: string, quiet = false) => {
    if (!quiet) setThreadLoading(true);
    try {
      const data = await api.get<{
        messages: MailMessage[];
        authors: Record<string, MailPerson>;
        hasMore: boolean;
        nextBefore: string | null;
      }>(`/mail/conversations/${encodeURIComponent(conversationId)}/messages`);
      setMessages(data.messages);
      setAuthors(data.authors);
      setHasMore(data.hasMore);
      setNextBefore(data.nextBefore);
      await api.post(`/mail/conversations/${encodeURIComponent(conversationId)}/read`);
      setBootstrap((current) =>
        current
          ? {
              ...current,
              conversations: current.conversations.map((row) =>
                row.id === conversationId ? { ...row, unreadCount: 0 } : row
              ),
            }
          : current
      );
    } finally {
      if (!quiet) setThreadLoading(false);
    }
  }, []);

  useEffect(() => {
    let active = true;
    refreshBootstrap()
      .then((data) => {
        if (!active || selectedId || !data.conversations.length) return;
        setParams({ conversation: data.conversations[0].id }, { replace: true });
      })
      .catch(() => active && setBootstrap({ conversations: [], people: [], unread: 0, aiAvailable: false, aiModel: null }));
    return () => {
      active = false;
    };
  }, [refreshBootstrap, selectedId, setParams]);

  useEffect(() => {
    if (!selectedId) {
      setMessages([]);
      return;
    }
    setDraftFiles([]);
    setReplyTo(null);
    setAiOpen(false);
    loadThread(selectedId).catch((error) => toast(errorMessage(error, lang), 'bad'));
  }, [selectedId, loadThread, toast, lang]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      if (document.visibilityState !== 'visible') return;
      refreshBootstrap().catch(() => undefined);
      if (selectedId) loadThread(selectedId, true).catch(() => undefined);
    }, POLL_MS);
    const onFocus = () => {
      refreshBootstrap().catch(() => undefined);
      if (selectedId) loadThread(selectedId, true).catch(() => undefined);
    };
    window.addEventListener('focus', onFocus);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener('focus', onFocus);
    };
  }, [refreshBootstrap, loadThread, selectedId]);

  useEffect(() => {
    const stream = new EventSource('/api/mail/stream');
    const onMessage = (event: MessageEvent) => {
      let payload: { conversationId?: string } = {};
      try {
        payload = JSON.parse(event.data);
      } catch {
        return;
      }
      refreshBootstrap().catch(() => undefined);
      if (payload.conversationId === selectedId) {
        loadThread(selectedId, true).catch(() => undefined);
      }
    };
    stream.addEventListener('message', onMessage as EventListener);
    return () => stream.close();
  }, [selectedId, refreshBootstrap, loadThread]);

  const peopleById = useMemo(
    () => new Map((bootstrap?.people ?? []).map((person) => [person.id, person])),
    [bootstrap?.people]
  );
  const selected = bootstrap?.conversations.find((row) => row.id === selectedId) ?? null;
  const visible = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase(lang === 'ar' ? 'ar' : 'en');
    return (bootstrap?.conversations ?? []).filter((conversation) => {
      if (filter !== 'inbox' && conversation.kind !== filter) return false;
      if (!needle) return true;
      return [conversationTitle(conversation, peopleById, user?.id ?? '', lang), conversation.lastMessagePreview]
        .join(' ')
        .toLocaleLowerCase(lang === 'ar' ? 'ar' : 'en')
        .includes(needle);
    });
  }, [bootstrap?.conversations, filter, query, peopleById, user?.id, lang]);

  const selectConversation = (id: string) => {
    setParams({ conversation: id });
    setMobileThread(true);
  };

  const loadOlder = async () => {
    if (!selectedId || !nextBefore || loadingMore) return;
    setLoadingMore(true);
    try {
      const data = await api.get<{
        messages: MailMessage[];
        authors: Record<string, MailPerson>;
        hasMore: boolean;
        nextBefore: string | null;
      }>(`/mail/conversations/${encodeURIComponent(selectedId)}/messages?before=${encodeURIComponent(nextBefore)}`);
      setMessages((current) => [...data.messages, ...current]);
      setAuthors((current) => ({ ...data.authors, ...current }));
      setHasMore(data.hasMore);
      setNextBefore(data.nextBefore);
    } catch (error) {
      toast(errorMessage(error, lang), 'bad');
    } finally {
      setLoadingMore(false);
    }
  };

  const uploadFiles = async (event: ChangeEvent<HTMLInputElement>) => {
    if (!selectedId) return;
    const picked = [...(event.target.files ?? [])].slice(0, Math.max(0, 6 - draftFiles.length));
    event.target.value = '';
    if (!picked.length) return;
    setUploading(true);
    try {
      const uploaded: MailAttachment[] = [];
      for (const file of picked) {
        const data = await api.upload<{ attachment: MailAttachment }>(
          `/mail/conversations/${encodeURIComponent(selectedId)}/files`,
          file
        );
        uploaded.push(data.attachment);
      }
      setDraftFiles((current) => [...current, ...uploaded]);
    } catch (error) {
      toast(errorMessage(error, lang), 'bad');
    } finally {
      setUploading(false);
    }
  };

  const removeDraftFile = async (file: MailAttachment) => {
    try {
      await api.delete(`/mail/conversations/${encodeURIComponent(file.conversationId)}/files/${encodeURIComponent(file.id)}`);
      setDraftFiles((current) => current.filter((row) => row.id !== file.id));
    } catch (error) {
      toast(errorMessage(error, lang), 'bad');
    }
  };

  const sendMessage = async () => {
    if (!selectedId || sending || (!draft.trim() && !draftFiles.length)) return;
    setSending(true);
    try {
      const data = await api.post<{ message: MailMessage; conversation: MailConversation }>(
        `/mail/conversations/${encodeURIComponent(selectedId)}/messages`,
        {
          body: draft,
          attachmentIds: draftFiles.map((file) => file.id),
          replyToId: replyTo?.id ?? null,
        }
      );
      setMessages((current) => [...current, data.message]);
      setAuthors((current) =>
        user
          ? {
              ...current,
              [user.id]: {
                id: user.id,
                name: user.name,
                email: user.email,
                title: user.title,
                department: user.department,
                avatarColor: user.avatarColor,
                role: user.role,
              },
            }
          : current
      );
      setDraft('');
      setDraftFiles([]);
      setReplyTo(null);
      await refreshBootstrap();
      requestAnimationFrame(() => composer.current?.focus());
    } catch (error) {
      toast(errorMessage(error, lang), 'bad');
    } finally {
      setSending(false);
    }
  };

  if (!bootstrap) {
    return <MailSkeleton />;
  }

  return (
    <div className="mx-auto h-[calc(100dvh-var(--topbar-h)-var(--sat)-78px)] w-full max-w-[1800px] overflow-hidden md:h-[calc(100dvh-var(--topbar-h)-var(--sat))] md:px-4 md:py-4">
      <section className="relative grid h-full overflow-hidden bg-white md:rounded-3xl md:border md:border-surface-line md:shadow-card lg:grid-cols-[230px_330px_minmax(0,1fr)]">
        <MailRail
          filter={filter}
          onFilter={setFilter}
          conversations={bootstrap.conversations}
          onCompose={() => setComposeOpen(true)}
          lang={lang}
        />

        <ConversationList
          conversations={visible}
          selectedId={selectedId}
          peopleById={peopleById}
          currentUserId={user?.id ?? ''}
          lang={lang}
          query={query}
          onQuery={setQuery}
          onSelect={selectConversation}
          filter={filter}
          onFilter={setFilter}
          onCompose={() => setComposeOpen(true)}
          hiddenOnMobile={mobileThread}
        />

        <main className={cx('relative min-w-0 flex-col bg-[#F7F9FC]', mobileThread ? 'flex' : 'hidden md:flex')}>
          {selected ? (
            <>
              <ThreadHeader
                conversation={selected}
                peopleById={peopleById}
                currentUserId={user?.id ?? ''}
                lang={lang}
                dir={dir}
                aiAvailable={bootstrap.aiAvailable}
                onBack={() => setMobileThread(false)}
                onAi={() => setAiOpen(true)}
              />

              <div className="relative flex min-h-0 flex-1 flex-col">
                <MessageTimeline
                  conversation={selected}
                  messages={messages}
                  authors={authors}
                  currentUserId={user?.id ?? ''}
                  lang={lang}
                  loading={threadLoading}
                  hasMore={hasMore}
                  loadingMore={loadingMore}
                  onLoadMore={loadOlder}
                  onReply={(message) => {
                    setReplyTo(message);
                    composer.current?.focus();
                  }}
                />

                <Composer
                  conversation={selected}
                  value={draft}
                  onChange={setDraft}
                  replyTo={replyTo}
                  onCancelReply={() => setReplyTo(null)}
                  draftFiles={draftFiles}
                  onRemoveFile={removeDraftFile}
                  onAttach={() => fileInput.current?.click()}
                  uploading={uploading}
                  sending={sending}
                  onSend={sendMessage}
                  inputRef={composer}
                  lang={lang}
                />

                {aiOpen && (
                  <AiDrawer
                    conversation={selected}
                    lang={lang}
                    available={bootstrap.aiAvailable}
                    canCreateTask={can(PERMISSIONS.TASKS_CREATE)}
                    onClose={() => setAiOpen(false)}
                    onUseReply={(text) => {
                      setDraft(text);
                      setAiOpen(false);
                      requestAnimationFrame(() => composer.current?.focus());
                    }}
                    onCreateTask={async (item) => {
                      if (!user) return;
                      if (!window.confirm(c.confirmTask.replace('{title}', item.title))) return;
                      try {
                        await api.post('/tasks', {
                          title: item.title,
                          description: item.details,
                          dueDate: item.dueDate,
                          department: user.department,
                        });
                        toast(c.taskCreated);
                      } catch (error) {
                        toast(errorMessage(error, lang), 'bad');
                      }
                    }}
                  />
                )}
              </div>
            </>
          ) : (
            <EmptyState icon={<MailIcon size={34} />} title={c.chooseConversation} body={c.chooseConversationBody} />
          )}
        </main>

        <input ref={fileInput} type="file" multiple className="hidden" onChange={uploadFiles} />
      </section>

      <ComposeModal
        open={composeOpen}
        onClose={() => setComposeOpen(false)}
        people={bootstrap.people}
        currentUserId={user?.id ?? ''}
        currentDepartment={user?.department ?? 'general'}
        role={user?.role ?? 'member'}
        lang={lang}
        onCreated={async (conversationId) => {
          await refreshBootstrap();
          selectConversation(conversationId);
        }}
      />
    </div>
  );
}

function MailRail({
  filter,
  onFilter,
  conversations,
  onCompose,
  lang,
}: {
  filter: Filter;
  onFilter: (value: Filter) => void;
  conversations: MailConversation[];
  onCompose: () => void;
  lang: 'ar' | 'en';
}) {
  const c = copy(lang);
  const unread = (kind?: MailConversationKind) =>
    conversations
      .filter((row) => !kind || row.kind === kind)
      .reduce((sum, row) => sum + row.unreadCount, 0);
  const items: Array<{ id: Filter; label: string; icon: typeof Inbox; count: number }> = [
    { id: 'inbox', label: c.inbox, icon: Inbox, count: unread() },
    { id: 'mail', label: c.mail, icon: MailIcon, count: unread('mail') },
    { id: 'channel', label: c.channels, icon: Hash, count: unread('channel') },
    { id: 'direct', label: c.direct, icon: MessageCircle, count: unread('direct') },
  ];
  return (
    <aside className="hidden min-h-0 flex-col overflow-hidden border-e border-[#173A4E] bg-[#0C2F3B] text-white lg:flex">
      <div className="border-b border-white/10 px-5 py-5">
        <div className="flex items-center gap-2.5">
          <span className="grid h-10 w-10 place-items-center rounded-2xl bg-[#5EEAD4] text-[#083344] shadow-[0_10px_28px_-12px_rgba(94,234,212,.8)]">
            <MailIcon size={20} strokeWidth={2.3} />
          </span>
          <div>
            <p className="text-[15px] font-extrabold tracking-tight">Qodo Mail</p>
            <p className="text-[10.5px] text-white/50">{c.internalWorkspace}</p>
          </div>
        </div>
        <button type="button" onClick={onCompose} className="mt-5 flex min-h-11 w-full items-center justify-center gap-2 rounded-xl bg-[#5EEAD4] px-3 text-[13px] font-extrabold text-[#083344] transition hover:bg-[#99F6E4] active:scale-[.98]">
          <Plus size={17} /> {c.newMessage}
        </button>
      </div>
      <nav className="grid gap-1 px-3 py-4">
        {items.map(({ id, label, icon: Icon, count }) => (
          <button
            key={id}
            type="button"
            onClick={() => onFilter(id)}
            className={cx(
              'flex min-h-10 items-center gap-2.5 rounded-xl px-3 text-start text-[12.5px] font-semibold transition',
              filter === id ? 'bg-white/12 text-white' : 'text-white/65 hover:bg-white/7 hover:text-white'
            )}
          >
            <Icon size={16} />
            <span className="flex-1">{label}</span>
            {count > 0 && <span className="rounded-full bg-[#5EEAD4] px-1.5 py-0.5 text-[10px] font-extrabold text-[#083344]">{count > 99 ? '99+' : count}</span>}
          </button>
        ))}
      </nav>
      <div className="mt-auto border-t border-white/10 px-4 py-4 text-[10.5px] leading-relaxed text-white/45">
        <p className="flex items-center gap-2"><Lock size={13} />{c.privateInside}</p>
        <p className="mt-2">{c.gmailIdentity}</p>
      </div>
    </aside>
  );
}

function ConversationList({
  conversations,
  selectedId,
  peopleById,
  currentUserId,
  lang,
  query,
  onQuery,
  onSelect,
  filter,
  onFilter,
  onCompose,
  hiddenOnMobile,
}: {
  conversations: MailConversation[];
  selectedId: string | null;
  peopleById: Map<string, MailPerson>;
  currentUserId: string;
  lang: 'ar' | 'en';
  query: string;
  onQuery: (value: string) => void;
  onSelect: (id: string) => void;
  filter: Filter;
  onFilter: (value: Filter) => void;
  onCompose: () => void;
  hiddenOnMobile: boolean;
}) {
  const c = copy(lang);
  const groups = filter === 'inbox'
    ? [
        { kind: 'mail' as const, label: c.officialMail, icon: MailIcon },
        { kind: 'channel' as const, label: c.channels, icon: Hash },
        { kind: 'direct' as const, label: c.privateChats, icon: MessageCircle },
      ].map((group) => ({
        ...group,
        rows: conversations.filter((conversation) => conversation.kind === group.kind),
      }))
    : [{ kind: filter, label: '', icon: Inbox, rows: conversations }];
  return (
    <aside className={cx('min-h-0 flex-col border-e border-surface-line bg-white md:flex', hiddenOnMobile ? 'hidden' : 'flex')}>
      <header className="border-b border-surface-line px-4 pb-3 pt-4">
        <div className="mb-3 flex items-center justify-between lg:hidden">
          <span className="flex items-center gap-2 text-[16px] font-extrabold text-ink"><MailIcon size={19} className="text-[#0F766E]" />Qodo Mail</span>
          <button type="button" onClick={onCompose} className="grid h-9 w-9 place-items-center rounded-xl bg-[#0F766E] text-white" aria-label={c.newMessage}><Plus size={17} /></button>
        </div>
        <div className="relative">
          <Search size={15} className="pointer-events-none absolute start-3 top-1/2 -translate-y-1/2 text-ink-faint" />
          <input value={query} onChange={(event) => onQuery(event.target.value)} className="field !min-h-10 !rounded-xl !bg-surface-sunken ps-9 !text-[12.5px]" placeholder={c.search} />
        </div>
        <div className="no-scrollbar mt-3 flex gap-1 overflow-x-auto lg:hidden">
          {(['inbox', 'mail', 'channel', 'direct'] as Filter[]).map((id) => (
            <button key={id} type="button" onClick={() => onFilter(id)} className={cx('shrink-0 rounded-full px-3 py-1.5 text-[11.5px] font-bold', filter === id ? 'bg-[#0F766E] text-white' : 'bg-surface-sunken text-ink-muted')}>
              {{ inbox: c.inbox, mail: c.mail, channel: c.channels, direct: c.direct }[id]}
            </button>
          ))}
        </div>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {conversations.length || filter === 'inbox' ? (
          groups.map(({ kind, label, icon: Icon, rows }) => (
            <section key={kind}>
              {filter === 'inbox' && (
                <header className="sticky top-0 z-[1] flex items-center gap-2 border-b border-surface-line bg-[#F8FAFC]/95 px-4 py-2 text-[10.5px] font-extrabold text-ink-muted backdrop-blur">
                  <Icon size={13} className="text-[#0F766E]" />
                  <span className="flex-1">{label}</span>
                  <span className="ltr text-[9px] font-semibold text-ink-faint">{rows.length}</span>
                </header>
              )}
              {rows.length ? rows.map((conversation) => (
                <ConversationRow
                  key={conversation.id}
                  conversation={conversation}
                  selected={selectedId === conversation.id}
                  peopleById={peopleById}
                  currentUserId={currentUserId}
                  lang={lang}
                  onSelect={onSelect}
                />
              )) : filter === 'inbox' && !query ? (
                <p className="border-b border-surface-line/70 px-4 py-3 text-[10.5px] text-ink-faint">{c.emptyGroup}</p>
              ) : null}
            </section>
          ))
        ) : (
          <EmptyState icon={<Inbox size={28} />} title={c.noConversations} body={c.noConversationsBody} />
        )}
      </div>
    </aside>
  );
}

function ConversationRow({
  conversation,
  selected,
  peopleById,
  currentUserId,
  lang,
  onSelect,
}: {
  conversation: MailConversation;
  selected: boolean;
  peopleById: Map<string, MailPerson>;
  currentUserId: string;
  lang: 'ar' | 'en';
  onSelect: (id: string) => void;
}) {
  const c = copy(lang);
  const title = conversationTitle(conversation, peopleById, currentUserId, lang);
  const person = conversation.kind === 'direct'
    ? peopleById.get(conversation.memberIds.find((id) => id !== currentUserId) ?? '')
    : null;
  return (
    <button
      type="button"
      onClick={() => onSelect(conversation.id)}
      className={cx(
        'group flex w-full items-start gap-3 border-b border-surface-line/70 px-4 py-3.5 text-start transition',
        selected ? 'bg-[#EAF8F5]' : 'hover:bg-surface-sunken/70'
      )}
    >
      <ConversationAvatar conversation={conversation} person={person} />
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-2">
          <span className={cx('min-w-0 flex-1 truncate text-[13px] text-ink', conversation.unreadCount ? 'font-extrabold' : 'font-semibold')}>{title}</span>
          <span className="ltr shrink-0 text-[9.5px] text-ink-faint">{shortTime(conversation.lastMessageAt ?? conversation.createdAt, lang)}</span>
        </span>
        <span className={cx('mt-1 block truncate text-[11.5px]', conversation.unreadCount ? 'font-semibold text-ink-muted' : 'text-ink-faint')}>
          {conversation.lastMessagePreview || conversationDescription(conversation, lang) || c.noMessages}
        </span>
      </span>
      {conversation.unreadCount > 0 && <span className="mt-6 grid h-5 min-w-5 place-items-center rounded-full bg-[#0F766E] px-1 text-[9px] font-extrabold text-white">{conversation.unreadCount}</span>}
    </button>
  );
}

function ThreadHeader({
  conversation,
  peopleById,
  currentUserId,
  lang,
  dir,
  aiAvailable,
  onBack,
  onAi,
}: {
  conversation: MailConversation;
  peopleById: Map<string, MailPerson>;
  currentUserId: string;
  lang: 'ar' | 'en';
  dir: 'rtl' | 'ltr';
  aiAvailable: boolean;
  onBack: () => void;
  onAi: () => void;
}) {
  const c = copy(lang);
  const title = conversationTitle(conversation, peopleById, currentUserId, lang);
  const Back = dir === 'rtl' ? ArrowRight : ArrowLeft;
  return (
    <header className="flex min-h-[68px] items-center gap-3 border-b border-surface-line bg-white/95 px-3 backdrop-blur sm:px-4">
      <button type="button" onClick={onBack} className="btn-quiet !min-h-9 rounded-lg px-2 md:hidden" aria-label={c.back}><Back size={19} /></button>
      <ConversationAvatar
        conversation={conversation}
        person={conversation.kind === 'direct' ? peopleById.get(conversation.memberIds.find((id) => id !== currentUserId) ?? '') : null}
        compact
      />
      <div className="min-w-0 flex-1">
        <h1 className="truncate text-[14px] font-extrabold text-ink">{title}</h1>
        <p className="mt-0.5 flex items-center gap-1 truncate text-[10.5px] text-ink-faint">
          {conversation.announcementOnly && <><BellRing size={11} />{c.announcementsOnly}</>}
          {!conversation.announcementOnly && conversation.kind === 'channel' && <>{conversation.scope === 'public' ? c.publicChannelShort : conversation.scope === 'private' ? c.privateChannelShort : c.teamChannel}</>}
          {conversation.kind !== 'channel' && <>{conversation.memberIds.length} {c.participants}</>}
        </p>
      </div>
      <button type="button" onClick={onAi} aria-label="Qodo AI" className={cx('btn !min-h-9 rounded-xl px-3 text-[11.5px] font-bold', aiAvailable ? 'bg-[#E7F7F4] text-[#0F766E] hover:bg-[#D1F1EB]' : 'bg-surface-sunken text-ink-faint')}>
        <WandSparkles size={15} /> <span className="hidden sm:inline">Qodo AI</span>
      </button>
    </header>
  );
}

function MessageTimeline({
  conversation,
  messages,
  authors,
  currentUserId,
  lang,
  loading,
  hasMore,
  loadingMore,
  onLoadMore,
  onReply,
}: {
  conversation: MailConversation;
  messages: MailMessage[];
  authors: Record<string, MailPerson>;
  currentUserId: string;
  lang: 'ar' | 'en';
  loading: boolean;
  hasMore: boolean;
  loadingMore: boolean;
  onLoadMore: () => void;
  onReply: (message: MailMessage) => void;
}) {
  const c = copy(lang);
  const scrollRef = useRef<HTMLDivElement>(null);
  const lastId = messages[messages.length - 1]?.id;
  useEffect(() => {
    if (!lastId) return;
    requestAnimationFrame(() => scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' }));
  }, [lastId]);

  if (loading) return <div className="grid flex-1 place-items-center"><Spinner className="text-[#0F766E]" /></div>;
  if (!messages.length) return <EmptyState icon={<MessageCircle size={30} />} title={c.startConversation} body={c.startConversationBody} />;

  return (
    <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto px-3 py-5 sm:px-6">
      {hasMore && (
        <div className="mb-5 text-center"><button type="button" onClick={onLoadMore} disabled={loadingMore} className="rounded-full bg-white px-3 py-1.5 text-[11px] font-bold text-ink-muted shadow-sm hover:text-[#0F766E]">{loadingMore ? c.loading : c.olderMessages}</button></div>
      )}
      <div className="mx-auto grid max-w-4xl gap-3">
        {messages.map((message, index) => {
          const previous = messages[index - 1];
          const showDay = !previous || dayKey(previous.createdAt) !== dayKey(message.createdAt);
          return (
            <div key={message.id}>
              {showDay && <div className="my-4 flex items-center gap-3 text-[10px] font-semibold text-ink-faint"><span className="h-px flex-1 bg-surface-line" /><span>{fullDay(message.createdAt, lang)}</span><span className="h-px flex-1 bg-surface-line" /></div>}
              {conversation.kind === 'mail' ? (
                <MailCard message={message} author={authors[message.senderId]} lang={lang} onReply={() => onReply(message)} />
              ) : (
                <ChatBubble message={message} author={authors[message.senderId]} own={message.senderId === currentUserId} lang={lang} onReply={() => onReply(message)} />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function MailCard({ message, author, lang, onReply }: { message: MailMessage; author?: MailPerson; lang: 'ar' | 'en'; onReply: () => void }) {
  const c = copy(lang);
  return (
    <article className="group rounded-2xl border border-surface-line bg-white p-4 shadow-[0_8px_28px_-24px_rgba(11,37,69,.5)] sm:p-5">
      <header className="flex items-start gap-3">
        <Avatar name={author?.name ?? '?'} color={author?.avatarColor} size={34} />
        <div className="min-w-0 flex-1"><p className="truncate text-[12.5px] font-extrabold text-ink">{author?.name ?? c.removedUser}</p><p className="ltr truncate text-start text-[10px] text-ink-faint">{author?.email}</p></div>
        <span className="ltr text-[9.5px] text-ink-faint">{longTime(message.createdAt, lang)}</span>
        <button type="button" onClick={onReply} className="rounded-lg p-1.5 text-ink-faint opacity-0 transition hover:bg-surface-sunken hover:text-[#0F766E] group-hover:opacity-100" aria-label={c.reply}><Reply size={14} /></button>
      </header>
      {message.body && <p className="mt-4 whitespace-pre-wrap text-[13px] leading-7 text-ink">{message.body}</p>}
      <AttachmentList files={message.attachments} />
    </article>
  );
}

function ChatBubble({ message, author, own, lang, onReply }: { message: MailMessage; author?: MailPerson; own: boolean; lang: 'ar' | 'en'; onReply: () => void }) {
  const c = copy(lang);
  return (
    <article className={cx('group flex items-end gap-2', own ? 'justify-end' : 'justify-start')}>
      {!own && <Avatar name={author?.name ?? '?'} color={author?.avatarColor} size={28} className="mb-1 shrink-0" />}
      <div className={cx('max-w-[84%] sm:max-w-[72%]', own && 'text-end')}>
        {!own && <p className="mb-1 px-1 text-[10.5px] font-bold text-ink-muted">{author?.name ?? c.removedUser}</p>}
        <div className={cx('relative rounded-2xl px-3.5 py-2.5 text-start shadow-sm', own ? 'rounded-ee-md bg-[#0F766E] text-white' : 'rounded-es-md border border-surface-line bg-white text-ink')}>
          {message.body && <p className="whitespace-pre-wrap text-[12.5px] leading-6">{message.body}</p>}
          <AttachmentList files={message.attachments} dark={own} />
          <div className={cx('mt-1 flex items-center justify-end gap-1 text-[8.5px]', own ? 'text-white/55' : 'text-ink-faint')}><span className="ltr">{longTime(message.createdAt, lang)}</span>{own && <Check size={10} />}</div>
        </div>
      </div>
      <button type="button" onClick={onReply} className="mb-1 rounded-lg p-1.5 text-ink-faint opacity-0 transition hover:bg-white hover:text-[#0F766E] group-hover:opacity-100" aria-label={c.reply}><Reply size={14} /></button>
    </article>
  );
}

function AttachmentList({ files, dark = false }: { files: MailAttachment[]; dark?: boolean }) {
  if (!files?.length) return null;
  return (
    <div className="mt-3 grid gap-1.5">
      {files.map((file) => (
        <a key={file.id} href={`/api/mail/conversations/${encodeURIComponent(file.conversationId)}/files/${encodeURIComponent(file.id)}`} target="_blank" rel="noreferrer" className={cx('flex items-center gap-2 rounded-xl border px-3 py-2 text-[10.5px] font-semibold transition', dark ? 'border-white/15 bg-white/10 text-white hover:bg-white/15' : 'border-surface-line bg-surface-sunken text-ink-muted hover:border-[#5EEAD4] hover:text-[#0F766E]')}>
          <FileText size={14} /><span className="min-w-0 flex-1 truncate">{file.name}</span><span className="ltr opacity-60">{fileSize(file.size)}</span>
        </a>
      ))}
    </div>
  );
}

function Composer({
  conversation,
  value,
  onChange,
  replyTo,
  onCancelReply,
  draftFiles,
  onRemoveFile,
  onAttach,
  uploading,
  sending,
  onSend,
  inputRef,
  lang,
}: {
  conversation: MailConversation;
  value: string;
  onChange: (value: string) => void;
  replyTo: MailMessage | null;
  onCancelReply: () => void;
  draftFiles: MailAttachment[];
  onRemoveFile: (file: MailAttachment) => void;
  onAttach: () => void;
  uploading: boolean;
  sending: boolean;
  onSend: () => void;
  inputRef: React.RefObject<HTMLTextAreaElement>;
  lang: 'ar' | 'en';
}) {
  const c = copy(lang);
  if (!conversation.canPost) {
    return <div className="border-t border-surface-line bg-white px-4 py-3 text-center text-[11.5px] font-semibold text-ink-muted"><Megaphone size={14} className="me-1 inline text-[#0F766E]" />{c.readOnlyChannel}</div>;
  }
  return (
    <footer className="border-t border-surface-line bg-white p-3 sm:p-4">
      <div className="mx-auto max-w-4xl">
        {replyTo && <div className="mb-2 flex items-center gap-2 rounded-xl border-s-2 border-[#0F766E] bg-[#EAF8F5] px-3 py-2 text-[10.5px] text-ink-muted"><Reply size={13} /><span className="min-w-0 flex-1 truncate">{replyTo.body}</span><button type="button" onClick={onCancelReply}><X size={14} /></button></div>}
        {draftFiles.length > 0 && <div className="mb-2 flex flex-wrap gap-1.5">{draftFiles.map((file) => <span key={file.id} className="flex max-w-[220px] items-center gap-1.5 rounded-full bg-surface-sunken px-2.5 py-1 text-[9.5px] font-semibold text-ink-muted"><Paperclip size={11} /><span className="truncate">{file.name}</span><button type="button" onClick={() => onRemoveFile(file)} className="text-ink-faint hover:text-status-bad"><X size={11} /></button></span>)}</div>}
        <div className="flex items-end gap-2 rounded-2xl border border-surface-line bg-[#F9FBFD] p-2 transition focus-within:border-[#5EEAD4] focus-within:ring-2 focus-within:ring-[#CCFBF1]">
          <button type="button" onClick={onAttach} disabled={uploading || draftFiles.length >= 6} className="grid h-9 w-9 shrink-0 place-items-center rounded-xl text-ink-faint hover:bg-white hover:text-[#0F766E] disabled:opacity-40" aria-label={c.attach}>{uploading ? <Spinner size={15} /> : <Paperclip size={17} />}</button>
          <textarea ref={inputRef} value={value} onChange={(event) => onChange(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); onSend(); } }} rows={1} className="max-h-32 min-h-9 flex-1 resize-y bg-transparent px-1 py-2 text-[12.5px] leading-5 text-ink outline-none placeholder:text-ink-faint" placeholder={conversation.kind === 'mail' ? c.writeReply : c.writeMessage} />
          <button type="button" onClick={onSend} disabled={sending || (!value.trim() && !draftFiles.length)} className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-[#0F766E] text-white shadow-sm transition hover:bg-[#115E59] active:scale-95 disabled:opacity-40" aria-label={c.send}>{sending ? <Spinner size={15} /> : <Send size={16} />}</button>
        </div>
      </div>
    </footer>
  );
}

function ComposeModal({
  open,
  onClose,
  people,
  currentUserId,
  currentDepartment,
  role,
  lang,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  people: MailPerson[];
  currentUserId: string;
  currentDepartment: string;
  role: string;
  lang: 'ar' | 'en';
  onCreated: (id: string) => Promise<void>;
}) {
  const c = copy(lang);
  const [mode, setMode] = useState<MailConversationKind>('mail');
  const [selected, setSelected] = useState<string[]>([]);
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [scope, setScope] = useState<MailChannelScope>('department');
  const [announcementOnly, setAnnouncementOnly] = useState(false);
  const [files, setFiles] = useState<File[]>([]);
  const [search, setSearch] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const availablePeople = people.filter((person) => person.id !== currentUserId && `${person.name} ${person.email}`.toLowerCase().includes(search.toLowerCase()));
  const canChannel = role === 'manager' || role === 'admin';

  useEffect(() => {
    if (!open) return;
    setMode('mail'); setSelected([]); setSubject(''); setBody(''); setName(''); setDescription(''); setScope('department'); setAnnouncementOnly(false); setFiles([]); setSearch(''); setError(''); setBusy(false);
  }, [open]);

  const toggle = (id: string) => setSelected((current) => mode === 'direct' ? [id] : current.includes(id) ? current.filter((value) => value !== id) : [...current, id]);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true); setError('');
    try {
      if (mode === 'direct') {
        const data = await api.post<{ conversation: MailConversation }>('/mail/conversations', { kind: 'direct', memberIds: selected });
        await onCreated(data.conversation.id); onClose(); return;
      }
      if (mode === 'channel') {
        const data = await api.post<{ conversation: MailConversation }>('/mail/conversations', { kind: 'channel', name, description, scope, department: currentDepartment, memberIds: scope === 'private' ? selected : [], announcementOnly });
        await onCreated(data.conversation.id); onClose(); return;
      }
      const data = await api.post<{ conversation: MailConversation }>('/mail/conversations', { kind: 'mail', memberIds: selected, subject });
      const uploaded: string[] = [];
      for (const file of files.slice(0, 6)) {
        const result = await api.upload<{ attachment: MailAttachment }>(`/mail/conversations/${encodeURIComponent(data.conversation.id)}/files`, file);
        uploaded.push(result.attachment.id);
      }
      await api.post(`/mail/conversations/${encodeURIComponent(data.conversation.id)}/messages`, { body, attachmentIds: uploaded });
      await onCreated(data.conversation.id); onClose();
    } catch (err) {
      setError(errorMessage(err, lang));
    } finally { setBusy(false); }
  };

  return (
    <Modal open={open} onClose={busy ? () => undefined : onClose} title={c.newConversation} width="lg" footer={<><button type="button" onClick={onClose} disabled={busy} className="btn-ghost">{c.cancel}</button><button type="submit" form="mail-compose-form" disabled={busy} className="btn !bg-[#0F766E] text-white hover:!bg-[#115E59]">{busy && <Spinner size={15} />}{mode === 'channel' ? c.createChannel : mode === 'direct' ? c.openChat : c.send}</button></>}>
      <form id="mail-compose-form" onSubmit={submit} className="grid gap-4">
        <div className="grid grid-cols-2 gap-1 rounded-xl bg-surface-sunken p-1 sm:grid-cols-3">
          {([['mail', c.mail, MailIcon], ['direct', c.direct, MessageCircle], ...(canChannel ? [['channel', c.channel, Hash]] : [])] as Array<[MailConversationKind, string, typeof MailIcon]>).map(([id, label, Icon]) => <button key={id} type="button" onClick={() => { setMode(id); setSelected([]); }} className={cx('flex min-h-9 items-center justify-center gap-1.5 rounded-lg px-2 text-[11.5px] font-bold transition', mode === id ? 'bg-white text-[#0F766E] shadow-sm' : 'text-ink-muted')}><Icon size={14} />{label}</button>)}
        </div>

        {mode === 'channel' ? (
          <>
            <Field label={c.channelName} required><input className="field" value={name} onChange={(event) => setName(event.target.value)} required /></Field>
            <Field label={c.description}><textarea className="field min-h-20 resize-y" value={description} onChange={(event) => setDescription(event.target.value)} /></Field>
            <Field label={c.channelAccess}>
              <div className="grid gap-2 sm:grid-cols-3">
                {([['department', c.departmentChannel, Building2], ['private', c.privateChannel, Lock], ...(role === 'admin' ? [['public', c.publicChannel, Globe2]] : [])] as Array<[MailChannelScope, string, typeof Lock]>).map(([id, label, Icon]) => <button key={id} type="button" onClick={() => setScope(id)} className={cx('flex min-h-12 items-center gap-2 rounded-xl border px-3 text-start text-[11px] font-bold', scope === id ? 'border-[#5EEAD4] bg-[#EAF8F5] text-[#0F766E]' : 'border-surface-line text-ink-muted')}><Icon size={15} />{label}</button>)}
              </div>
            </Field>
            <label className="flex items-center gap-2 rounded-xl bg-surface-sunken px-3 py-2.5 text-[11.5px] font-semibold text-ink-muted"><input type="checkbox" checked={announcementOnly} onChange={(event) => setAnnouncementOnly(event.target.checked)} className="accent-[#0F766E]" />{c.announcementChannel}</label>
          </>
        ) : mode === 'mail' ? (
          <><Field label={c.subject} required><input className="field" value={subject} onChange={(event) => setSubject(event.target.value)} required /></Field><Field label={c.message} required={files.length === 0}><textarea className="field min-h-32 resize-y" value={body} onChange={(event) => setBody(event.target.value)} required={files.length === 0} /></Field><Field label={c.attachments}><input type="file" multiple onChange={(event) => setFiles([...(event.target.files ?? [])].slice(0, 6))} className="field file:me-3 file:rounded-lg file:border-0 file:bg-[#EAF8F5] file:px-3 file:py-1 file:text-[11px] file:font-bold file:text-[#0F766E]" /></Field></>
        ) : null}

        {(mode !== 'channel' || scope === 'private') && (
          <Field label={mode === 'direct' ? c.choosePerson : c.recipients} required={mode !== 'channel'}>
            <div className="overflow-hidden rounded-xl border border-surface-line">
              <div className="relative border-b border-surface-line"><Search size={14} className="absolute start-3 top-1/2 -translate-y-1/2 text-ink-faint" /><input value={search} onChange={(event) => setSearch(event.target.value)} className="w-full px-9 py-2.5 text-[12px] outline-none" placeholder={c.searchPeople} /></div>
              <div className="max-h-48 overflow-y-auto p-1.5">
                {availablePeople.map((person) => <button key={person.id} type="button" onClick={() => toggle(person.id)} className={cx('flex w-full items-center gap-2.5 rounded-lg px-2 py-2 text-start transition hover:bg-surface-sunken', selected.includes(person.id) && 'bg-[#EAF8F5]')}><Avatar name={person.name} color={person.avatarColor} size={28} /><span className="min-w-0 flex-1"><span className="block truncate text-[11.5px] font-bold text-ink">{person.name}</span><span className="ltr block truncate text-start text-[9.5px] text-ink-faint">{person.email}</span></span>{selected.includes(person.id) && <Check size={15} className="text-[#0F766E]" />}</button>)}
              </div>
            </div>
          </Field>
        )}
        {error && <p className="rounded-xl bg-status-badBg px-3 py-2.5 text-[12px] font-semibold text-status-bad">{error}</p>}
      </form>
    </Modal>
  );
}

function AiDrawer({
  conversation,
  lang,
  available,
  canCreateTask,
  onClose,
  onUseReply,
  onCreateTask,
}: {
  conversation: MailConversation;
  lang: 'ar' | 'en';
  available: boolean;
  canCreateTask: boolean;
  onClose: () => void;
  onUseReply: (text: string) => void;
  onCreateTask: (item: AiActionItem) => void;
}) {
  const c = copy(lang);
  const [action, setAction] = useState<AiAction>('summary');
  const [result, setResult] = useState<AiResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const run = async (next: AiAction) => {
    setAction(next); setBusy(true); setError(''); setResult(null);
    try {
      const data = await api.post<{ result: AiResult }>(`/mail/conversations/${encodeURIComponent(conversation.id)}/ai`, { action: next, lang });
      setResult(data.result);
    } catch (err) { setError(errorMessage(err, lang)); }
    finally { setBusy(false); }
  };
  return (
    <aside className="absolute inset-y-0 end-0 z-20 flex w-full flex-col border-s border-surface-line bg-white shadow-[-24px_0_60px_-34px_rgba(11,37,69,.55)] animate-fade-up sm:w-[380px]">
      <header className="flex items-center gap-3 border-b border-surface-line px-4 py-4"><span className="grid h-9 w-9 place-items-center rounded-xl bg-[#EAF8F5] text-[#0F766E]"><Bot size={18} /></span><div className="min-w-0 flex-1"><h2 className="text-[13.5px] font-extrabold text-ink">Qodo AI</h2><p className="text-[9.5px] text-ink-faint">{c.aiLastMessages}</p></div><button type="button" onClick={onClose} aria-label={c.close} className="btn-quiet !min-h-9 rounded-lg px-2"><X size={17} /></button></header>
      <div className="grid grid-cols-3 gap-1 border-b border-surface-line p-2">
        {([['summary', c.summarize, Sparkles], ['reply', c.suggestReply, Reply], ['actions', c.extractActions, ListTodo]] as Array<[AiAction, string, typeof Sparkles]>).map(([id, label, Icon]) => <button key={id} type="button" onClick={() => run(id)} disabled={!available || busy} className={cx('flex min-h-16 flex-col items-center justify-center gap-1 rounded-xl px-1 text-center text-[9.5px] font-bold transition disabled:opacity-45', action === id && result ? 'bg-[#EAF8F5] text-[#0F766E]' : 'text-ink-muted hover:bg-surface-sunken')}><Icon size={16} />{label}</button>)}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        {!available ? <EmptyState icon={<WandSparkles size={27} />} title={c.aiUnavailable} body={c.aiUnavailableBody} /> : busy ? <div className="flex h-full flex-col items-center justify-center gap-3 text-center"><span className="grid h-12 w-12 place-items-center rounded-2xl bg-[#EAF8F5] text-[#0F766E]"><Spinner size={21} /></span><p className="text-[12px] font-bold text-ink">{c.aiWorking}</p><p className="max-w-[240px] text-[10.5px] leading-relaxed text-ink-faint">{c.aiNoAction}</p></div> : error ? <p className="rounded-xl bg-status-badBg p-3 text-[11.5px] font-semibold text-status-bad">{error}</p> : result && 'text' in result ? <div className="rounded-2xl border border-[#BFE9E2] bg-[#F2FBF9] p-4"><p className="whitespace-pre-wrap text-[12.5px] leading-7 text-ink">{result.text}</p>{action === 'reply' && <button type="button" onClick={() => onUseReply(result.text)} className="mt-4 flex min-h-9 w-full items-center justify-center gap-2 rounded-xl bg-[#0F766E] px-3 text-[11px] font-bold text-white"><Reply size={14} />{c.useReply}</button>}</div> : result && 'items' in result ? <div className="grid gap-2.5">{result.items.length ? result.items.map((item, index) => <article key={`${item.title}-${index}`} className="rounded-2xl border border-surface-line p-3.5"><div className="flex items-start gap-2"><span className="grid h-6 w-6 shrink-0 place-items-center rounded-lg bg-[#EAF8F5] text-[10px] font-extrabold text-[#0F766E]">{index + 1}</span><div className="min-w-0 flex-1"><h3 className="text-[11.5px] font-extrabold text-ink">{item.title}</h3>{item.details && <p className="mt-1 text-[10.5px] leading-relaxed text-ink-muted">{item.details}</p>}{item.dueDate && <span className="ltr mt-2 inline-block rounded-full bg-status-warnBg px-2 py-1 text-[9px] font-bold text-status-warn">{item.dueDate}</span>}</div></div>{canCreateTask && <button type="button" onClick={() => onCreateTask(item)} className="mt-3 flex min-h-8 w-full items-center justify-center gap-1.5 rounded-lg border border-[#BFE9E2] text-[10px] font-bold text-[#0F766E] hover:bg-[#EAF8F5]"><Plus size={12} />{c.createTask}</button>}</article>) : <EmptyState icon={<ListTodo size={25} />} title={c.noActions} body={c.noActionsBody} />}</div> : <EmptyState icon={<WandSparkles size={28} />} title={c.aiChoose} body={c.aiChooseBody} />}
      </div>
      <footer className="border-t border-surface-line px-4 py-3 text-[9px] leading-relaxed text-ink-faint"><Lock size={10} className="me-1 inline" />{c.aiPrivacy}</footer>
    </aside>
  );
}

function ConversationAvatar({ conversation, person, compact = false }: { conversation: MailConversation; person?: MailPerson | null; compact?: boolean }) {
  const size = compact ? 36 : 40;
  if (conversation.kind === 'direct' && person) return <Avatar name={person.name} color={person.avatarColor} size={size} />;
  const meta = conversation.announcementOnly ? { icon: Megaphone, bg: '#FEF3C7', color: '#B45309' } : conversation.kind === 'channel' ? { icon: Hash, bg: '#E0F2FE', color: '#0369A1' } : { icon: MailIcon, bg: '#CCFBF1', color: '#0F766E' };
  const Icon = meta.icon;
  return <span className="grid shrink-0 place-items-center rounded-2xl" style={{ width: size, height: size, background: meta.bg, color: meta.color }}><Icon size={compact ? 17 : 18} /></span>;
}

function MailSkeleton() {
  return <div className="mx-auto grid h-[calc(100dvh-var(--topbar-h))] max-w-[1800px] gap-px overflow-hidden bg-surface-line md:grid-cols-[230px_330px_1fr] md:p-4"><div className="hidden bg-[#0C2F3B] md:block" /><div className="grid gap-px bg-white p-4">{Array.from({ length: 8 }).map((_, index) => <div key={index} className="skeleton h-16" />)}</div><div className="hidden place-items-center bg-[#F7F9FC] md:grid"><Spinner className="text-[#0F766E]" /></div></div>;
}

function conversationTitle(conversation: MailConversation, people: Map<string, MailPerson>, currentUserId: string, lang: 'ar' | 'en') {
  if (conversation.kind === 'mail') return conversation.subject || copy(lang).untitled;
  if (conversation.kind === 'channel') return (lang === 'en' ? conversation.nameEn : conversation.nameAr) || conversation.nameAr || conversation.nameEn || copy(lang).channel;
  const others = conversation.memberIds.filter((id) => id !== currentUserId).map((id) => people.get(id)?.name).filter(Boolean);
  return others.join('، ') || copy(lang).removedUser;
}

function conversationDescription(conversation: MailConversation, lang: 'ar' | 'en') {
  return (lang === 'en' ? conversation.descriptionEn : conversation.descriptionAr) || conversation.descriptionAr || conversation.descriptionEn;
}

const dayKey = (value: string) => new Date(value).toISOString().slice(0, 10);
const locale = (lang: 'ar' | 'en') => (lang === 'ar' ? 'ar-EG' : 'en-GB');
const shortTime = (value: string, lang: 'ar' | 'en') => {
  const date = new Date(value); const today = new Date();
  return dayKey(value) === dayKey(today.toISOString()) ? new Intl.DateTimeFormat(locale(lang), { hour: 'numeric', minute: '2-digit' }).format(date) : new Intl.DateTimeFormat(locale(lang), { day: 'numeric', month: 'short' }).format(date);
};
const longTime = (value: string, lang: 'ar' | 'en') => new Intl.DateTimeFormat(locale(lang), { hour: 'numeric', minute: '2-digit' }).format(new Date(value));
const fullDay = (value: string, lang: 'ar' | 'en') => new Intl.DateTimeFormat(locale(lang), { weekday: 'long', day: 'numeric', month: 'long' }).format(new Date(value));
const fileSize = (bytes: number) => bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`;

function copy(lang: 'ar' | 'en') {
  return lang === 'en' ? EN : AR;
}

const AR = {
  officialMail: 'الرسائل الرسمية', privateChats: 'المحادثات الخاصة', emptyGroup: 'لا يوجد شيء هنا بعد.',
  inbox: 'الوارد', mail: 'الرسائل', channels: 'القنوات', channel: 'قناة', direct: 'المحادثات', close: 'إغلاق', internalWorkspace: 'تواصل الشركة الداخلي', newMessage: 'رسالة جديدة', privateInside: 'المحادثات داخل Qodo فقط', gmailIdentity: 'Gmail للدخول والتحقق من الهوية؛ لا نقرأ صندوق بريدك.', search: 'ابحث في الرسائل والقنوات…', noMessages: 'لا توجد رسائل بعد', noConversations: 'لا توجد محادثات', noConversationsBody: 'ابدأ رسالة أو محادثة جديدة مع فريقك.', back: 'رجوع', announcementsOnly: 'قناة إعلانات', teamChannel: 'قناة القسم', publicChannelShort: 'قناة عامة لكل الشركة', privateChannelShort: 'قناة خاصة', members: 'أعضاء', participants: 'مشاركون', chooseConversation: 'اختر محادثة', chooseConversationBody: 'اختر رسالة أو قناة من القائمة للبدء.', olderMessages: 'عرض رسائل أقدم', loading: 'جارٍ التحميل…', startConversation: 'ابدأ المحادثة', startConversationBody: 'أرسل أول رسالة أو ملف هنا.', removedUser: 'مستخدم غير متاح', reply: 'رد', attach: 'إرفاق ملف', send: 'إرسال', writeReply: 'اكتب ردك…', writeMessage: 'اكتب رسالة…', readOnlyChannel: 'هذه قناة إعلانات؛ الكتابة متاحة للمديرين.', newConversation: 'بدء تواصل جديد', cancel: 'إلغاء', createChannel: 'إنشاء القناة', openChat: 'فتح المحادثة', channelName: 'اسم القناة', description: 'الوصف', channelAccess: 'من يمكنه رؤية القناة؟', departmentChannel: 'القسم', privateChannel: 'خاصة', publicChannel: 'الشركة كلها', announcementChannel: 'قناة إعلانات: المديرون يكتبون والموظفون يقرؤون', subject: 'عنوان الرسالة', message: 'الرسالة', attachments: 'المرفقات', choosePerson: 'اختر موظفًا', recipients: 'المستلمون', searchPeople: 'ابحث بالاسم أو الإيميل…', aiLastMessages: 'يحلّل آخر 60 رسالة فقط', summarize: 'تلخيص', suggestReply: 'اقتراح رد', extractActions: 'استخراج مهام', aiUnavailable: 'Qodo AI غير مفعّل', aiUnavailableBody: 'هيّئ QODO_AI_BASE_URL أو OPENAI_API_KEY على الخادم لتفعيل أدوات المحادثة.', aiWorking: 'Qodo AI يقرأ المحادثة…', aiNoAction: 'لن يرسل رسالة أو ينشئ مهمة من تلقاء نفسه.', useReply: 'استخدام الرد في المحرر', createTask: 'إنشاء مهمة', noActions: 'لا توجد إجراءات واضحة', noActionsBody: 'لم يجد AI طلبات تنفيذ صريحة في المحادثة.', aiChoose: 'ماذا تريد من Qodo AI؟', aiChooseBody: 'اختر التلخيص أو اقتراح رد أو استخراج إجراءات قابلة للتحويل لمهام.', aiPrivacy: 'النص يُرسل إلى مزود الـAI المهيأ للمساحة، والنتيجة لا تُرسل تلقائيًا.', confirmTask: 'إنشاء مهمة بعنوان «{title}»؟', taskCreated: 'تم إنشاء المهمة من المحادثة.', untitled: 'بدون عنوان', publicChannelForbidden: 'القناة العامة للإدارة فقط.',
};

const EN: typeof AR = {
  officialMail: 'Official mail', privateChats: 'Private chats', emptyGroup: 'Nothing here yet.',
  inbox: 'Inbox', mail: 'Mail', channels: 'Channels', channel: 'Channel', direct: 'Direct', close: 'Close', internalWorkspace: 'Internal company communication', newMessage: 'New message', privateInside: 'Conversations stay inside Qodo', gmailIdentity: 'Gmail verifies identity; Qodo never reads your inbox.', search: 'Search mail and channels…', noMessages: 'No messages yet', noConversations: 'No conversations', noConversationsBody: 'Start a mail thread or chat with your team.', back: 'Back', announcementsOnly: 'Announcements', teamChannel: 'Department channel', publicChannelShort: 'Public company channel', privateChannelShort: 'Private channel', members: 'members', participants: 'participants', chooseConversation: 'Choose a conversation', chooseConversationBody: 'Pick a mail thread or channel from the list.', olderMessages: 'Load older messages', loading: 'Loading…', startConversation: 'Start the conversation', startConversationBody: 'Send the first message or file here.', removedUser: 'Unavailable user', reply: 'Reply', attach: 'Attach file', send: 'Send', writeReply: 'Write a reply…', writeMessage: 'Write a message…', readOnlyChannel: 'This is an announcement channel; only managers can post.', newConversation: 'Start a new conversation', cancel: 'Cancel', createChannel: 'Create channel', openChat: 'Open chat', channelName: 'Channel name', description: 'Description', channelAccess: 'Who can see this channel?', departmentChannel: 'Department', privateChannel: 'Private', publicChannel: 'Whole company', announcementChannel: 'Announcement channel: managers post and employees read', subject: 'Subject', message: 'Message', attachments: 'Attachments', choosePerson: 'Choose a person', recipients: 'Recipients', searchPeople: 'Search by name or email…', aiLastMessages: 'Analyzes the latest 60 messages', summarize: 'Summarize', suggestReply: 'Draft reply', extractActions: 'Action items', aiUnavailable: 'Qodo AI is not enabled', aiUnavailableBody: 'Configure QODO_AI_BASE_URL or OPENAI_API_KEY on the server to enable conversation tools.', aiWorking: 'Qodo AI is reading the conversation…', aiNoAction: 'It will never send a message or create a task by itself.', useReply: 'Use this reply', createTask: 'Create task', noActions: 'No clear actions found', noActionsBody: 'AI did not find explicit action requests in this conversation.', aiChoose: 'What should Qodo AI do?', aiChooseBody: 'Choose a summary, a suggested reply, or action extraction.', aiPrivacy: 'Text is sent to the configured AI provider. Results are never sent automatically.', confirmTask: 'Create a task called “{title}”?', taskCreated: 'Task created from the conversation.', untitled: 'Untitled', publicChannelForbidden: 'Only administrators can create public channels.',
};
