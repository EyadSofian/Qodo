/**
 * One row on the management board.
 *
 * The card leads with what makes the item actionable — when it is due and who
 * owes it — because the list is read to answer "what is today" far more often
 * than "what did we file". Everything else is a chip.
 */

import { AlertTriangle, Clock, MapPin, Radio, Trash2, UserRound } from 'lucide-react';
import {
  KIND_LABEL,
  PRIORITY_LABEL,
  STATUS_LABEL,
  isOpen,
  isOverdue,
  type MgmtItem,
  type MgmtStatus,
} from '../../lib/management';
import { KIND_ICON } from './KindCards';
import { useI18n } from '../../lib/i18n';
import { useWorkspace } from '../../lib/workspace';
import { cx } from '../../lib/utils';

const timeFmt = new Intl.DateTimeFormat('ar-EG-u-nu-latn', {
  hour: '2-digit',
  minute: '2-digit',
  hour12: true,
});
const dateFmt = new Intl.DateTimeFormat('ar-EG-u-nu-latn', { day: 'numeric', month: 'short' });

export function ItemCard({
  item,
  canManage,
  onEdit,
  onStatus,
  onConfirm,
  onDelete,
}: {
  item: MgmtItem;
  canManage: boolean;
  onEdit: (item: MgmtItem) => void;
  onStatus: (item: MgmtItem, status: MgmtStatus) => void;
  /** Clears the review flag — a human has now looked at what the model guessed. */
  onConfirm: (item: MgmtItem) => void;
  onDelete: (item: MgmtItem) => void;
}) {
  const { lang } = useI18n();
  const { directory } = useWorkspace();
  const Icon = KIND_ICON[item.kind];
  const late = isOverdue(item);
  const open = isOpen(item);

  // The owner resolved to a real colleague, or is just the name that was said.
  const owner = item.ownerId ? directory.find((person) => person.id === item.ownerId) : null;
  const ownerLabel = owner?.name ?? item.ownerName;

  const due = item.dueAt ? new Date(item.dueAt) : null;

  return (
    <article
      className={cx(
        'card flex flex-col gap-2.5 p-3.5 transition-colors',
        late && 'border-rose-200 bg-rose-50/30',
        !open && 'opacity-60'
      )}
    >
      <div className="flex items-start gap-2.5">
        <span className="mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-brand-50 text-brand-600">
          <Icon size={16} />
        </span>

        <div className="min-w-0 flex-1">
          <h3 className={cx('text-[14px] font-bold leading-snug text-ink', !open && 'line-through')}>
            {item.title}
          </h3>
          {item.details && (
            <p className="mt-1 line-clamp-2 text-[12.5px] leading-relaxed text-ink-muted">
              {item.details}
            </p>
          )}
        </div>

        {item.needsReview && (
          <span
            className="inline-flex items-center gap-1 rounded-lg bg-amber-50 px-2 py-1 text-[11px] font-bold text-amber-700"
            title="المساعد مكانش متأكد — راجعها"
          >
            <AlertTriangle size={12} />
            مراجعة
          </span>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-1.5 text-[11.5px]">
        {due && (
          <span
            className={cx(
              'inline-flex items-center gap-1 rounded-lg px-2 py-1 font-bold',
              late ? 'bg-rose-100 text-rose-700' : 'bg-surface-sunken text-ink-muted'
            )}
          >
            <Clock size={12} />
            {dateFmt.format(due)} · {timeFmt.format(due)}
            {item.durationMin ? ` · ${item.durationMin}د` : ''}
          </span>
        )}

        {ownerLabel && (
          <span className="inline-flex items-center gap-1 rounded-lg bg-surface-sunken px-2 py-1 font-semibold text-ink-muted">
            <UserRound size={12} />
            {ownerLabel}
          </span>
        )}

        {item.location && (
          <span className="inline-flex items-center gap-1 rounded-lg bg-surface-sunken px-2 py-1 font-semibold text-ink-muted">
            <MapPin size={12} />
            {item.location}
          </span>
        )}

        {item.priority !== 'normal' && (
          <span
            className={cx('rounded-lg px-2 py-1 font-bold', PRIORITY_LABEL[item.priority].tone)}
          >
            {lang === 'en' ? PRIORITY_LABEL[item.priority].en : PRIORITY_LABEL[item.priority].ar}
          </span>
        )}

        <span className="rounded-lg bg-surface-sunken px-2 py-1 font-semibold text-ink-muted">
          {lang === 'en' ? KIND_LABEL[item.kind].en : KIND_LABEL[item.kind].ar}
        </span>

        {/* Where the row came from. A card filed from a chat message reads
            differently from one somebody sat down and typed, and the raw text
            behind it is the only way to check what was actually said. */}
        {item.source !== 'dashboard' && (
          <span
            className="inline-flex items-center gap-1 rounded-lg bg-sky-50 px-2 py-1 font-semibold text-sky-700"
            title={item.rawText ?? undefined}
          >
            <Radio size={12} />
            {item.reporter ?? 'من الشات'}
          </span>
        )}
      </div>

      {canManage && (
        <div className="flex flex-wrap items-center gap-1.5 border-t border-surface-line pt-2.5">
          {open ? (
            <>
              {item.status === 'todo' && (
                <button type="button" onClick={() => onStatus(item, 'doing')} className="btn-ghost btn-sm">
                  {STATUS_LABEL.doing.ar}
                </button>
              )}
              <button
                type="button"
                onClick={() => onStatus(item, 'done')}
                className="btn-primary btn-sm"
              >
                خلص
              </button>
            </>
          ) : (
            <button type="button" onClick={() => onStatus(item, 'todo')} className="btn-ghost btn-sm">
              رجّعها
            </button>
          )}

          <button type="button" onClick={() => onEdit(item)} className="btn-ghost btn-sm">
            تعديل
          </button>

          {item.needsReview && (
            <button
              type="button"
              onClick={() => onConfirm(item)}
              className="btn-ghost btn-sm text-amber-700"
              title="اتأكدت منها — تخرج من لِين المراجعة"
            >
              تمام
            </button>
          )}

          <button
            type="button"
            onClick={() => onDelete(item)}
            className="btn-ghost btn-sm ms-auto text-rose-600"
            aria-label="حذف"
          >
            <Trash2 size={14} />
          </button>
        </div>
      )}
    </article>
  );
}
