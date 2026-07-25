import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { CornerDownLeft, Search, X } from 'lucide-react';
import { api } from '../lib/api';
import { useI18n } from '../lib/i18n';
import { cx } from '../lib/utils';
import { getStage } from '@shared/departments';
import { ModuleIcon } from './ModuleIcon';
import { Avatar, Spinner } from './ui';
import type { SearchResult } from '../lib/types';

/**
 * One box over apps, tasks and people. Opens with ⌘K / Ctrl+K, and from the
 * search button in the top bar — on a phone that button is the only way in, so
 * the panel is a full-height sheet there rather than a floating card.
 */
export function SearchPalette({ open, onClose }: { open: boolean; onClose: () => void }) {
  const navigate = useNavigate();
  const { t, lang } = useI18n();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [active, setActive] = useState(0);
  const [loading, setLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (open) {
      setQuery('');
      setResults([]);
      setActive(0);
      // Wait for the panel to mount before stealing focus, or iOS ignores it.
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open]);

  // Debounced so typing a word doesn't fire a request per keystroke.
  useEffect(() => {
    if (!open) return;
    const term = query.trim();
    if (!term) {
      setResults([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      try {
        const data = await api.get<{ results: SearchResult[] }>(
          `/search?q=${encodeURIComponent(term)}&lang=${lang}`
        );
        if (!controller.signal.aborted) {
          setResults(data.results);
          setActive(0);
        }
      } catch {
        if (!controller.signal.aborted) setResults([]);
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }, 180);

    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [query, open, lang]);

  const choose = useCallback(
    (result: SearchResult) => {
      onClose();
      navigate(result.route);
    },
    [navigate, onClose]
  );

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === 'Escape') return onClose();
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setActive((i) => Math.min(i + 1, results.length - 1));
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActive((i) => Math.max(i - 1, 0));
    }
    if (event.key === 'Enter' && results[active]) {
      event.preventDefault();
      choose(results[active]);
    }
  };

  useEffect(() => {
    listRef.current
      ?.querySelector<HTMLElement>(`[data-index="${active}"]`)
      ?.scrollIntoView({ block: 'nearest' });
  }, [active]);

  if (!open) return null;

  const typeLabel: Record<SearchResult['type'], string> = {
    app: t('search.typeApp'),
    task: t('search.typeTask'),
    user: t('search.typeUser'),
  };

  return createPortal(
    <div className="fixed inset-0 z-[70] flex items-start justify-center p-0 sm:p-6 sm:pt-[12vh]">
      <div className="absolute inset-0 bg-navy/40 backdrop-blur-sm" onClick={onClose} aria-hidden="true" />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={t('common.search')}
        className="relative z-10 flex h-full w-full flex-col bg-white shadow-panel sm:h-auto sm:max-h-[70vh] sm:max-w-2xl sm:rounded-2xl animate-fade-up"
        onKeyDown={onKeyDown}
      >
        <div className="flex items-center gap-3 border-b border-surface-line px-4 pt-safe sm:pt-0">
          <Search size={18} className="shrink-0 text-ink-faint" />
          <input
            ref={inputRef}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t('search.placeholder')}
            className="min-w-0 flex-1 bg-transparent py-4 text-[15px] text-ink outline-none placeholder:text-ink-faint"
            autoComplete="off"
            spellCheck={false}
          />
          {loading && <Spinner size={16} className="text-ink-faint" />}
          <button type="button" onClick={onClose} className="btn-quiet !min-h-9 rounded-lg p-1.5" aria-label={t('common.close')}>
            <X size={18} />
          </button>
        </div>

        <div ref={listRef} className="flex-1 overflow-y-auto overscroll-contain p-2">
          {!query.trim() && <p className="px-3 py-8 text-center text-sm text-ink-faint">{t('search.empty')}</p>}
          {query.trim() && !loading && results.length === 0 && (
            <p className="px-3 py-8 text-center text-sm text-ink-faint">
              {t('search.noResults', { q: query })}
            </p>
          )}

          {results.map((result, index) => (
            <button
              key={`${result.type}-${result.id}`}
              type="button"
              data-index={index}
              onMouseEnter={() => setActive(index)}
              onClick={() => choose(result)}
              className={cx(
                'flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-start transition-colors',
                index === active ? 'bg-brand-50' : 'hover:bg-surface-sunken'
              )}
            >
              <ResultIcon result={result} />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-semibold text-ink">{result.title}</span>
                {result.subtitle && (
                  <span className="block truncate text-[12px] text-ink-muted">{result.subtitle}</span>
                )}
              </span>
              <span className="shrink-0 text-[11px] font-semibold text-ink-faint">
                {typeLabel[result.type]}
              </span>
              {index === active && <CornerDownLeft size={14} className="shrink-0 text-brand-500" />}
            </button>
          ))}
        </div>

        <div className="hidden items-center gap-4 border-t border-surface-line px-4 py-2 text-[11px] text-ink-faint sm:flex">
          <Hint keys="↑ ↓" label={t('search.navigate')} />
          <Hint keys="Enter" label={t('search.open')} />
          <Hint keys="Esc" label={t('common.close')} />
        </div>
      </div>
    </div>,
    document.body
  );
}

function ResultIcon({ result }: { result: SearchResult }) {
  if (result.type === 'app') {
    return <ModuleIcon name={result.icon ?? 'grid'} color={result.color ?? '#1D6FB8'} size={34} />;
  }
  if (result.type === 'user') {
    return <Avatar name={result.title} color={result.color} size={34} />;
  }
  // A task's dot carries its department colour, so the same title in two
  // departments is still distinguishable at a glance.
  const stage = result.department ? getStage(result.department, result.stage) : null;
  const done = stage?.type === 'done';
  return (
    <span className="grid h-[34px] w-[34px] shrink-0 place-items-center rounded-xl bg-surface-sunken">
      <span
        className={cx('h-2.5 w-2.5 rounded-full', done ? 'bg-status-ok' : 'bg-brand-400')}
      />
    </span>
  );
}

function Hint({ keys, label }: { keys: string; label: string }) {
  return (
    <span className="flex items-center gap-1.5">
      <kbd className="ltr rounded border border-surface-line bg-surface-sunken px-1.5 py-0.5 font-sans text-[10px] font-semibold text-ink-muted">
        {keys}
      </kbd>
      {label}
    </span>
  );
}
