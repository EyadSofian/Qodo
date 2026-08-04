/**
 * The pick-a-type row, used twice: as the quick-add strip on the board (cards
 * with a hint line) and as the type switcher inside the form (compact chips).
 *
 * Choosing the type first is the point. "مهمة" and "اجتماع" want different
 * fields — one needs an owner, the other needs a time and a room — so asking
 * which it is before showing a form is what keeps the form short.
 */

import { motion } from 'framer-motion';
import { CalendarDays, CheckCircle2, Clock, Target, Users } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { KIND_LABEL, KIND_ORDER, type MgmtKind } from '../../lib/management';
import { useI18n } from '../../lib/i18n';
import { cx } from '../../lib/utils';

export const KIND_ICON: Record<MgmtKind, LucideIcon> = {
  task: CheckCircle2,
  meeting: Users,
  appointment: CalendarDays,
  reminder: Clock,
  decision: Target,
};

export function KindCards({
  value,
  onSelect,
  compact = false,
}: {
  value?: MgmtKind;
  onSelect: (kind: MgmtKind) => void;
  compact?: boolean;
}) {
  const { lang } = useI18n();

  if (compact) {
    return (
      <div className="no-scrollbar -mx-1 flex gap-1.5 overflow-x-auto px-1 pb-0.5">
        {KIND_ORDER.map((kind) => {
          const Icon = KIND_ICON[kind];
          const active = value === kind;
          return (
            <button
              key={kind}
              type="button"
              onClick={() => onSelect(kind)}
              aria-pressed={active}
              className={cx(
                'inline-flex min-h-[44px] shrink-0 items-center gap-1.5 rounded-xl px-3 text-xs font-semibold transition-colors',
                active
                  ? 'bg-navy text-white'
                  : 'border border-surface-line bg-white text-ink-muted hover:text-ink'
              )}
            >
              <Icon size={16} />
              {lang === 'en' ? KIND_LABEL[kind].en : KIND_LABEL[kind].ar}
            </button>
          );
        })}
      </div>
    );
  }

  return (
    <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-5">
      {KIND_ORDER.map((kind) => {
        const Icon = KIND_ICON[kind];
        return (
          <motion.button
            key={kind}
            type="button"
            onClick={() => onSelect(kind)}
            whileHover={{ y: -2 }}
            whileTap={{ scale: 0.985 }}
            transition={{ type: 'spring', stiffness: 320, damping: 24 }}
            className="card flex min-h-[92px] flex-col items-start gap-1.5 p-3.5 text-start transition-colors hover:border-brand-200"
          >
            <span className="grid h-8 w-8 place-items-center rounded-lg bg-brand-50 text-brand-600">
              <Icon size={16} />
            </span>
            <span className="text-sm font-bold text-ink">
              {lang === 'en' ? KIND_LABEL[kind].en : KIND_LABEL[kind].ar}
            </span>
            <span className="text-[11px] leading-tight text-ink-muted">{KIND_LABEL[kind].hint}</span>
          </motion.button>
        );
      })}
    </div>
  );
}
