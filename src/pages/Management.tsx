/**
 * The management desk.
 *
 * Not the task board. The board is where work is assigned to somebody and
 * measured; this is the diary of the people doing the assigning — what the
 * board decided, who they are meeting, what is owed this week. It is opened by
 * `management.view`, which no role grants, so the people here are named rather
 * than senior.
 *
 * The page is organised around the question it is actually opened to answer:
 * what is today, and what is already late. Everything else is a lane away.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, CalendarClock, CheckCircle2, Clock, Plus, RefreshCw } from 'lucide-react';
import { PERMISSIONS } from '@shared/permissions';
import { useAuth } from '../lib/auth';
import { errorMessage } from '../lib/api';
import {
  KIND_LABEL,
  createItem,
  draftFrom,
  emptyDraft,
  fetchItems,
  fetchMeta,
  isOpen,
  isOverdue,
  isToday,
  patchItem,
  removeItem,
  sortItems,
  uploadFile,
  type MgmtDraft,
  type MgmtItem,
  type MgmtKind,
  type MgmtMeta,
  type MgmtStatus,
} from '../lib/management';
import { ItemCard } from '../components/management/ItemCard';
import { ItemForm } from '../components/management/ItemForm';
import { KindCards } from '../components/management/KindCards';
import { EmptyState, Modal, Segmented, Spinner, useToast } from '../components/ui';
import { cx } from '../lib/utils';

type Lane = 'today' | 'open' | 'late' | 'review' | 'done';

const LANES: Array<{ key: Lane; label: string }> = [
  { key: 'today', label: 'النهاردة' },
  { key: 'open', label: 'المفتوح' },
  { key: 'late', label: 'المتأخر' },
  { key: 'review', label: 'محتاج مراجعة' },
  { key: 'done', label: 'خلص' },
];

export function Management() {
  const { can } = useAuth();
  const { push } = useToast();

  const [items, setItems] = useState<MgmtItem[] | null>(null);
  const [meta, setMeta] = useState<MgmtMeta | null>(null);
  const [lane, setLane] = useState<Lane>('today');
  const [editing, setEditing] = useState<MgmtItem | null>(null);
  const [draft, setDraft] = useState<MgmtDraft | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const canManage = Boolean(meta?.canManage) && can(PERMISSIONS.MANAGEMENT_MANAGE);

  const load = useCallback(async () => {
    try {
      setError('');
      const [rows, info] = await Promise.all([fetchItems(), fetchMeta()]);
      setItems(rows);
      setMeta(info);
    } catch (err) {
      setError(errorMessage(err, 'ar'));
      setItems([]);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const counts = useMemo(() => {
    const rows = items ?? [];
    return {
      today: rows.filter((item) => isOpen(item) && isToday(item.dueAt)).length,
      open: rows.filter(isOpen).length,
      late: rows.filter(isOverdue).length,
      review: rows.filter((item) => item.needsReview).length,
      done: rows.filter((item) => item.status === 'done' && isToday(item.doneAt)).length,
    };
  }, [items]);

  const visible = useMemo(() => {
    const rows = items ?? [];
    const inLane = (item: MgmtItem) => {
      switch (lane) {
        case 'today':
          return isOpen(item) && isToday(item.dueAt);
        case 'open':
          return isOpen(item);
        case 'late':
          return isOverdue(item);
        case 'review':
          return item.needsReview;
        case 'done':
          return item.status === 'done' || item.status === 'cancelled';
        default:
          return true;
      }
    };
    return sortItems(rows.filter(inLane));
  }, [items, lane]);

  /** Replace one row in place — the list is long and re-fetching it flickers. */
  const applyItem = (updated: MgmtItem) =>
    setItems((rows) => (rows ?? []).map((row) => (row.id === updated.id ? updated : row)));

  const save = async (values: MgmtDraft, files: File[]) => {
    setBusy(true);
    try {
      if (editing) {
        applyItem(await patchItem(editing.id, values));
        push('اتحدّث.');
      } else {
        const created = await createItem(values);
        // The pictures were picked before the item had an id, so they go up now
        // that it does. A failure here is reported without losing the item —
        // it is already filed, and the card can take the files afterwards.
        let attachmentCount = 0;
        try {
          for (const file of files) {
            ({ attachmentCount } = await uploadFile(created.id, file));
          }
        } catch {
          push('اتسجّل، بس فيه صورة ما اترفعتش — جرّب من الكارت.', 'bad');
        }
        setItems((rows) => [{ ...created, attachmentCount }, ...(rows ?? [])]);
        if (files.length === 0 || attachmentCount === files.length) push('اتسجّل.');
      }
      setDraft(null);
      setEditing(null);
    } catch (err) {
      push(errorMessage(err, 'ar'), 'bad');
    } finally {
      setBusy(false);
    }
  };

  const setStatus = async (item: MgmtItem, status: MgmtStatus) => {
    try {
      applyItem(await patchItem(item.id, { status }));
    } catch (err) {
      push(errorMessage(err, 'ar'), 'bad');
    }
  };

  const confirmReview = async (item: MgmtItem) => {
    try {
      applyItem(await patchItem(item.id, { needsReview: false }));
    } catch (err) {
      push(errorMessage(err, 'ar'), 'bad');
    }
  };

  const destroy = async (item: MgmtItem) => {
    if (!window.confirm(`حذف «${item.title}» نهائياً؟`)) return;
    try {
      await removeItem(item.id);
      setItems((rows) => (rows ?? []).filter((row) => row.id !== item.id));
      push('اتحذف.');
    } catch (err) {
      push(errorMessage(err, 'ar'), 'bad');
    }
  };

  const openNew = (kind: MgmtKind) => {
    setEditing(null);
    setDraft(emptyDraft(kind));
  };

  const openEdit = (item: MgmtItem) => {
    setEditing(item);
    setDraft(draftFrom(item));
  };

  return (
    <div className="mx-auto grid w-full max-w-6xl gap-5 px-3 py-4 sm:px-5">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-[22px] font-black leading-tight text-ink">الإدارة</h1>
          <p className="mt-1 text-[12.5px] leading-relaxed text-ink-muted">
            مهام ومواعيد الإدارة — بتتسجّل من اللوحة أو من رسايل تيليجرام بعد ما الـAI يحلّلها.
          </p>
        </div>
        <button type="button" onClick={() => void load()} className="btn-ghost btn-sm gap-1.5">
          <RefreshCw size={15} />
          تحديث
        </button>
      </header>

      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-5">
        <Tile label="مستحق النهاردة" value={counts.today} icon={CalendarClock} />
        <Tile label="متأخر" value={counts.late} icon={Clock} urgent={counts.late > 0} />
        <Tile label="محتاج مراجعة" value={counts.review} icon={AlertTriangle} warn={counts.review > 0} />
        <Tile label="مفتوح" value={counts.open} icon={Clock} />
        <Tile label="خلص النهاردة" value={counts.done} icon={CheckCircle2} />
      </div>

      {canManage && (
        <section className="grid gap-2.5">
          <div>
            <h2 className="text-[15px] font-bold text-ink">ضيف بسرعة</h2>
            <p className="text-[12px] text-ink-muted">اختار النوع وهيفتحلك النموذج جاهز</p>
          </div>
          <KindCards onSelect={openNew} />
        </section>
      )}

      <section className="grid gap-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <Segmented
            value={lane}
            onChange={setLane}
            options={LANES.map((entry) => ({
              value: entry.key,
              label: `${entry.label}${counts[entry.key] ? ` (${counts[entry.key]})` : ''}`,
            }))}
          />
          {canManage && (
            <button type="button" onClick={() => openNew('task')} className="btn-primary btn-sm gap-1.5">
              <Plus size={15} />
              إضافة
            </button>
          )}
        </div>

        {error && (
          <p className="rounded-xl bg-rose-50 px-3.5 py-2.5 text-[12.5px] font-semibold text-rose-700">
            {error}
          </p>
        )}

        {items === null ? (
          <div className="grid place-items-center py-12">
            <Spinner size={24} />
          </div>
        ) : visible.length === 0 ? (
          <EmptyState
            title="مفيش حاجة هنا"
            body={
              lane === 'today'
                ? 'أجندة النهاردة فاضية.'
                : lane === 'review'
                  ? 'مفيش بنود مستنية مراجعة.'
                  : 'جرّب لِين تاني.'
            }
          />
        ) : (
          <div className="grid gap-2.5 lg:grid-cols-2">
            {visible.map((item) => (
              <ItemCard
                key={item.id}
                item={item}
                canManage={canManage}
                onEdit={openEdit}
                onStatus={setStatus}
                onConfirm={confirmReview}
                onDelete={destroy}
              />
            ))}
          </div>
        )}
      </section>

      <Modal
        open={draft !== null}
        onClose={() => {
          setDraft(null);
          setEditing(null);
        }}
        width="md"
        title={editing ? `تعديل ${KIND_LABEL[editing.kind].ar}` : 'بند جديد'}
      >
        {draft && (
          <ItemForm
            initial={draft}
            itemId={editing?.id}
            canManage={canManage}
            busy={busy}
            onCancel={() => {
              setDraft(null);
              setEditing(null);
            }}
            onSubmit={save}
          />
        )}
      </Modal>
    </div>
  );
}

function Tile({
  label,
  value,
  icon: Icon,
  urgent = false,
  warn = false,
}: {
  label: string;
  value: number;
  icon: typeof Clock;
  urgent?: boolean;
  warn?: boolean;
}) {
  return (
    <div className="card flex items-center justify-between gap-2 p-3.5">
      <div className="min-w-0">
        <p className="truncate text-[12px] font-semibold text-ink-muted">{label}</p>
        <p
          className={cx(
            'ltr mt-0.5 text-[26px] font-black leading-none tabular-nums',
            urgent ? 'text-rose-600' : warn ? 'text-amber-600' : 'text-ink'
          )}
        >
          {value}
        </p>
      </div>
      <span
        className={cx(
          'grid h-9 w-9 shrink-0 place-items-center rounded-xl',
          urgent ? 'bg-rose-50 text-rose-600' : warn ? 'bg-amber-50 text-amber-600' : 'bg-surface-sunken text-ink-muted'
        )}
      >
        <Icon size={17} />
      </span>
    </div>
  );
}
