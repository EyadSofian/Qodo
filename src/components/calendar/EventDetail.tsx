/**
 * One entry, opened.
 *
 * Ordered by the questions somebody actually opens a meeting to answer: when is
 * it, where do I go, am I expected to say whether I am coming, who else said
 * yes. The answer buttons come before the guest list for that reason — the
 * common visit is somebody deciding, not somebody auditing.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Ban,
  CalendarClock,
  Check,
  CircleHelp,
  ExternalLink,
  MapPin,
  MessageSquare,
  Paperclip,
  Pencil,
  Users,
  X,
} from 'lucide-react';
import { Link } from 'react-router-dom';
import {
  KIND_LABEL,
  RESPONSE_LABEL,
  VISIBILITY_LABEL,
  dayOf,
  eventFileUrl,
  fetchEventFiles,
  removeEventFile,
  respondToEvent,
  spanOf,
  uploadEventFile,
  type CalendarEvent,
  type CalendarFile,
  type CalendarPerson,
  type InviteResponse,
} from '../../lib/calendar';
import { errorMessage } from '../../lib/api';
import { Avatar, Spinner, useToast } from '../ui';
import { AttachmentTiles, useFileDrop } from '../Attachments';
import { cx } from '../../lib/utils';

const ANSWERS: Array<{ value: Exclude<InviteResponse, 'needs_action'>; label: string; icon: typeof Check }> = [
  { value: 'accepted', label: 'حاضر', icon: Check },
  { value: 'tentative', label: 'مبدئي', icon: CircleHelp },
  { value: 'declined', label: 'معتذر', icon: X },
];

export function EventDetail({
  event,
  people,
  currentUserId,
  maxFiles,
  onChanged,
  onEdit,
  onCancel,
}: {
  event: CalendarEvent;
  people: Map<string, CalendarPerson>;
  currentUserId: string;
  maxFiles: number;
  onChanged: (event: CalendarEvent) => void;
  onEdit: () => void;
  onCancel: () => void;
}) {
  const { push } = useToast();
  const [files, setFiles] = useState<CalendarFile[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const picker = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let active = true;
    setFiles(null);
    fetchEventFiles(event.id)
      .then((rows) => active && setFiles(rows))
      .catch(() => active && setFiles([]));
    return () => {
      active = false;
    };
  }, [event.id]);

  const organizer = people.get(event.organizerId);
  const cancelled = event.status === 'cancelled';
  const invited = event.inviteeIds.includes(currentUserId);
  const responseOf = (userId: string) =>
    event.responses.find((row) => row.userId === userId)?.response ?? 'needs_action';

  const answer = async (value: Exclude<InviteResponse, 'needs_action'>) => {
    setBusy(true);
    try {
      onChanged(await respondToEvent(event.id, value));
    } catch (error) {
      push(errorMessage(error), 'bad');
    } finally {
      setBusy(false);
    }
  };

  const addFiles = useCallback(
    async (incoming: File[]) => {
      if (cancelled || incoming.length === 0) return;
      const room = maxFiles - (files?.length ?? 0);
      if (room <= 0) {
        push(`الحد ${maxFiles} ملفات للاجتماع.`, 'bad');
        return;
      }
      setUploading(true);
      try {
        for (const file of incoming.slice(0, room)) {
          const { attachment } = await uploadEventFile(event.id, file);
          setFiles((current) => [...(current ?? []), attachment]);
        }
      } catch (error) {
        push(errorMessage(error), 'bad');
      } finally {
        setUploading(false);
      }
    },
    [cancelled, event.id, files, maxFiles, push]
  );

  const { dragging, dropProps } = useFileDrop({ onFiles: addFiles, disabled: cancelled });

  const drop = async (file: { id: string }) => {
    try {
      await removeEventFile(event.id, file.id);
      setFiles((current) => (current ?? []).filter((row) => row.id !== file.id));
    } catch (error) {
      push(errorMessage(error), 'bad');
    }
  };

  return (
    <div className="grid gap-4">
      {cancelled && (
        <p className="flex items-center gap-2 rounded-xl bg-status-badBg px-3 py-2 text-[12px] font-bold text-status-bad">
          <Ban size={15} /> اتلغى. الميعاد ده مش قايم.
        </p>
      )}

      <header className="grid gap-2">
        <span className="chip w-fit bg-brand-50 text-brand-700">{KIND_LABEL[event.kind].ar}</span>
        <h3 className={cx('text-lg font-extrabold text-ink', cancelled && 'line-through opacity-60')}>
          {event.title}
        </h3>
        <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[12.5px] font-semibold text-ink-muted">
          <CalendarClock size={15} className="text-brand-500" />
          {dayOf(event.startAt)}
          <span className="ltr text-ink-faint">· {spanOf(event)}</span>
        </p>
        {event.location && (
          <p className="flex items-center gap-2 text-[12.5px] text-ink-muted">
            <MapPin size={15} className="text-ink-faint" />
            {event.location}
          </p>
        )}
        {event.onlineUrl && (
          <a
            href={event.onlineUrl}
            target="_blank"
            rel="noreferrer"
            className="flex w-fit items-center gap-2 text-[12.5px] font-semibold text-brand-600 hover:underline"
          >
            <ExternalLink size={15} />
            دخول الاجتماع أونلاين
          </a>
        )}
        {event.conversationId && (
          <Link
            to={`/mail?conversation=${encodeURIComponent(event.conversationId)}`}
            className="flex w-fit items-center gap-2 text-[12.5px] font-semibold text-brand-600 hover:underline"
          >
            <MessageSquare size={15} />
            الرجوع للمحادثة في Qodo Mail
          </Link>
        )}
      </header>

      {invited && !cancelled && (
        <div className="rounded-2xl border border-surface-line bg-surface-sunken/60 p-3">
          <span className="label !mb-2">هتحضر؟</span>
          <div className="flex flex-wrap gap-2">
            {ANSWERS.map(({ value, label, icon: Icon }) => {
              const active = event.myResponse === value;
              return (
                <button
                  key={value}
                  type="button"
                  disabled={busy}
                  onClick={() => answer(value)}
                  className={cx(
                    'btn btn-sm',
                    active ? 'btn-primary' : 'btn-ghost',
                    busy && 'opacity-60'
                  )}
                >
                  <Icon size={14} />
                  {label}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {event.details && (
        <p className="whitespace-pre-wrap rounded-2xl bg-surface-sunken/60 p-3 text-[12.5px] leading-relaxed text-ink-muted">
          {event.details}
        </p>
      )}

      <section>
        <span className="label flex items-center gap-1.5">
          <Users size={14} /> الحاضرون
          <span className="font-normal text-ink-faint">({event.inviteeIds.length + 1})</span>
        </span>
        <ul className="grid gap-1.5">
          <Attendee
            person={organizer}
            fallbackId={event.organizerId}
            response="accepted"
            badge="منظّم"
          />
          {event.inviteeIds.map((id) => (
            <Attendee key={id} person={people.get(id)} fallbackId={id} response={responseOf(id)} />
          ))}
        </ul>
      </section>

      <section
        {...dropProps}
        className={cx(
          'rounded-2xl border border-dashed p-3 transition',
          dragging ? 'border-brand-400 bg-brand-50' : 'border-surface-line'
        )}
      >
        <div className="mb-2 flex items-center justify-between gap-2">
          <span className="label !mb-0 flex items-center gap-1.5">
            <Paperclip size={14} /> المرفقات
            <span className="font-normal text-ink-faint">
              ({files?.length ?? 0}/{maxFiles})
            </span>
          </span>
          {!cancelled && (
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              disabled={uploading || (files?.length ?? 0) >= maxFiles}
              onClick={() => picker.current?.click()}
            >
              {uploading ? <Spinner size={14} /> : <Paperclip size={14} />}
              إضافة
            </button>
          )}
        </div>
        <input
          ref={picker}
          type="file"
          multiple
          className="hidden"
          onChange={(input) => {
            addFiles([...(input.target.files ?? [])]);
            input.target.value = '';
          }}
        />
        {files === null ? (
          <p className="flex items-center gap-2 py-1 text-[12px] text-ink-faint">
            <Spinner size={14} /> جارٍ التحميل…
          </p>
        ) : files.length === 0 ? (
          <p className="text-[11.5px] text-ink-faint">
            اسحب الأجندة أو العرض هنا، أو اضغط «إضافة».
          </p>
        ) : (
          <AttachmentTiles
            files={files}
            urlOf={(file) => eventFileUrl(event.id, file.id)}
            onRemove={
              cancelled
                ? undefined
                : (file) => {
                    const row = files.find((candidate) => candidate.id === file.id);
                    if (row && (row.userId === currentUserId || event.canManage)) drop(file);
                  }
            }
          />
        )}
      </section>

      <footer className="flex flex-wrap items-center justify-between gap-2 border-t border-surface-line pt-3">
        <span className="text-[11px] text-ink-faint">
          {VISIBILITY_LABEL[event.visibility].ar}
          {event.department ? ` · ${event.department}` : ''}
        </span>
        {event.canManage && !cancelled && (
          <span className="flex gap-2">
            <button type="button" className="btn btn-ghost btn-sm" onClick={onEdit}>
              <Pencil size={14} /> تعديل
            </button>
            <button type="button" className="btn btn-danger btn-sm" onClick={onCancel}>
              <Ban size={14} /> إلغاء الميعاد
            </button>
          </span>
        )}
      </footer>
    </div>
  );
}

function Attendee({
  person,
  fallbackId,
  response,
  badge,
}: {
  person?: CalendarPerson;
  fallbackId: string;
  response: InviteResponse;
  badge?: string;
}) {
  const label = RESPONSE_LABEL[response];
  return (
    <li className="flex items-center gap-2 rounded-xl border border-surface-line bg-white px-2.5 py-2">
      <Avatar name={person?.name ?? '؟'} color={person?.avatarColor} size={26} />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[12.5px] font-semibold text-ink">
          {person?.name ?? fallbackId}
        </span>
        {person?.title && (
          <span className="block truncate text-[10.5px] text-ink-faint">{person.title}</span>
        )}
      </span>
      {badge && <span className="chip bg-surface-sunken text-[10px] text-ink-muted">{badge}</span>}
      <span className={cx('chip text-[10.5px]', label.tone)}>{label.ar}</span>
    </li>
  );
}
