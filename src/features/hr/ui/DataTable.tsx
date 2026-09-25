/**
 * One table for HR V2. Columns declare a cell renderer and an optional sort
 * key; on a phone the same rows become stacked cards instead of a table that
 * scrolls sideways (the failure the Events grid shipped with).
 */

import { useMemo, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowDown, ArrowUp } from 'lucide-react';
import { cx } from '../../../lib/utils';
import { useHRText } from '../format';

export interface Column<T> {
  key: string;
  header: ReactNode;
  cell: (row: T) => ReactNode;
  sort?: (row: T) => string | number | null;
  align?: 'start' | 'end' | 'center';
  width?: string;
  /** Hidden in the phone card; the card shows `primary` and the rest. */
  hideOnCard?: boolean;
}

export function DataTable<T extends { id: string }>({
  rows,
  columns,
  onRowClick,
  rowHref,
  empty,
  card,
  initialSort,
  caption,
  rowClassName,
  minWidth = 720,
}: {
  rows: T[];
  columns: Array<Column<T>>;
  onRowClick?: (row: T) => void;
  /** Where a row leads; `null` leaves that row plain rather than clickable to nowhere. */
  rowHref?: (row: T) => string | null;
  empty?: ReactNode;
  card?: (row: T) => ReactNode;
  initialSort?: { key: string; direction: 'asc' | 'desc' } | null;
  caption?: string;
  rowClassName?: (row: T) => string | undefined;
  /** Below this width the table scrolls sideways rather than squeezing its cells (desktop only). */
  minWidth?: number;
}) {
  const { t } = useHRText();
  const navigate = useNavigate();
  const [sort, setSort] = useState(initialSort ?? null);
  const sorted = useMemo(() => {
    if (!sort) return rows;
    const column = columns.find((item) => item.key === sort.key);
    if (!column?.sort) return rows;
    const factor = sort.direction === 'asc' ? 1 : -1;
    return [...rows].sort((left, right) => {
      const a = column.sort!(left);
      const b = column.sort!(right);
      if (a === b) return 0;
      if (a === null || a === undefined) return 1;
      if (b === null || b === undefined) return -1;
      return (typeof a === 'number' && typeof b === 'number' ? a - b : String(a).localeCompare(String(b))) * factor;
    });
  }, [rows, columns, sort]);

  if (!rows.length) return <>{empty ?? null}</>;

  const hrefOf = (row: T) => (rowHref ? rowHref(row) : null);
  const clickable = (row: T) => Boolean(onRowClick) || Boolean(hrefOf(row));
  const activate = (row: T) => {
    if (onRowClick) {
      onRowClick(row);
      return;
    }
    const href = hrefOf(row);
    if (href) navigate(href);
  };

  return (
    <>
      <div className="hr-glass hidden overflow-x-auto rounded-3xl md:block">
        <table className="w-full text-[13px]" style={{ minWidth }}>
          {caption && <caption className="sr-only">{caption}</caption>}
          <thead>
            <tr className="border-b border-white/80 bg-[linear-gradient(90deg,rgb(var(--hr-a1)/0.09),rgb(var(--hr-a2)/0.05))] text-[11.5px] font-bold text-slate-600">
              {columns.map((column) => {
                const active = sort?.key === column.key;
                return (
                  <th key={column.key} scope="col" className={cx('px-4 py-2.5 font-semibold', column.align === 'end' ? 'text-end' : column.align === 'center' ? 'text-center' : 'text-start')} style={column.width ? { width: column.width } : undefined} aria-sort={active ? (sort!.direction === 'asc' ? 'ascending' : 'descending') : undefined}>
                    {column.sort ? (
                      <button
                        type="button"
                        className="inline-flex items-center gap-1 rounded hover:text-navy"
                        onClick={() => setSort(active && sort!.direction === 'desc' ? { key: column.key, direction: 'asc' } : { key: column.key, direction: 'desc' })}
                      >
                        {column.header}
                        {active ? (sort!.direction === 'asc' ? <ArrowUp size={12} /> : <ArrowDown size={12} />) : null}
                      </button>
                    ) : column.header}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-200/60">
            {sorted.map((row) => (
              <tr
                key={row.id}
                className={cx('transition-[background-color,box-shadow] duration-200', clickable(row) && 'cursor-pointer hover:bg-[rgb(var(--hr-a1)/0.06)] hover:shadow-[inset_3px_0_0_rgb(var(--hr-a1))] rtl:hover:shadow-[inset_-3px_0_0_rgb(var(--hr-a1))]', rowClassName?.(row))}
                onClick={clickable(row) ? () => activate(row) : undefined}
                onKeyDown={clickable(row) ? (event) => { if (event.key === 'Enter') activate(row); } : undefined}
                tabIndex={clickable(row) ? 0 : undefined}
              >
                {columns.map((column) => (
                  <td key={column.key} className={cx('px-4 py-3 align-middle', column.align === 'end' ? 'text-end' : column.align === 'center' ? 'text-center' : 'text-start')}>
                    {column.cell(row)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="hr-stagger space-y-2.5 md:hidden">
        {sorted.map((row) => (
          <div
            key={row.id}
            className={cx('hr-glass rounded-3xl p-4', clickable(row) && 'hr-lift cursor-pointer active:scale-[0.99]', rowClassName?.(row))}
            onClick={clickable(row) ? () => activate(row) : undefined}
            role={clickable(row) ? 'button' : undefined}
            tabIndex={clickable(row) ? 0 : undefined}
            onKeyDown={clickable(row) ? (event) => { if (event.key === 'Enter') activate(row); } : undefined}
          >
            {card ? card(row) : (
              <dl className="grid grid-cols-2 gap-x-3 gap-y-2">
                {columns.filter((column) => !column.hideOnCard).map((column) => (
                  <div key={column.key} className="min-w-0">
                    <dt className="text-[11px] font-semibold text-[#5A6C82]">{column.header}</dt>
                    <dd className="mt-0.5 min-w-0 text-[13px] text-navy">{column.cell(row)}</dd>
                  </div>
                ))}
              </dl>
            )}
          </div>
        ))}
        <p className="sr-only">{t(`${rows.length} صف`, `${rows.length} rows`)}</p>
      </div>
    </>
  );
}
