/**
 * قائمة الأسعار — the whole published book, read down rather than searched.
 *
 * The advisor answers about one sale. This is the other half of the same
 * question: what do we charge for everything, on every route, at a glance. A
 * seller scans it before a campaign; a manager reads it to find what is missing.
 *
 * Every band and every offer on screen is computed by the hub from the same
 * module the advisor uses, so a row here and the advice for that course cannot
 * disagree. Nothing about a price is decided in this file.
 *
 * A row is a starting point, not a destination: picking one hands the course to
 * the advisor, because "what do we charge" is usually asked on the way to "what
 * do I quote this person".
 */

import { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  BadgePercent,
  ChevronLeft,
  ChevronRight,
  Pause,
  Search,
  SlidersHorizontal,
} from 'lucide-react';
import { api, errorMessage } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { EmptyState, Segmented, Spinner } from '@/components/ui';
import { cx } from '@/lib/utils';
import type { Book } from './PriceAdvisor';

interface Band {
  floor: number | null;
  ceiling: number | null;
  currency: string;
  fixed: boolean;
  requiresReview: boolean;
}

interface Offer {
  id: string;
  currency: string;
  paymentMethod: string;
  exact: number | null;
  minimum: number | null;
  maximum: number | null;
  validTo: string;
  note: string;
}

type RouteKey = 'sa_instalment' | 'sa_cash' | 'eg';

export interface Row {
  key: string;
  code: string;
  rawCode: string;
  courseName: string;
  specialization: string;
  deliveryType: string;
  level: string;
  onHold: boolean;
  requiresReview: boolean;
  negotiable: boolean;
  mode: 'course' | 'package';
  routes: Record<RouteKey, Band | null>;
  offers: Offer[];
  offersByRoute: Record<RouteKey, Offer[]>;
  unpriced: boolean;
}

interface CatalogResponse {
  ok: boolean;
  configured: boolean;
  book: Book | null;
  courses: Row[];
  facets: { specializations: string[]; deliveryTypes: string[] };
  total: number;
  counts: { negotiable: number; withOffers: number; unpriced: number; onHold: number };
  error: string;
}

type Filter = 'all' | 'negotiable' | 'offers' | 'unpriced';

const DELIVERY: Record<string, { ar: string; en: string }> = {
  online: { ar: 'أونلاين', en: 'Online' },
  offline: { ar: 'حضوري', en: 'In person' },
  recorded: { ar: 'مسجّل', en: 'Recorded' },
  exam: { ar: 'اختبار', en: 'Exam' },
};

const ROUTES: Array<{ key: RouteKey; ar: string; en: string }> = [
  { key: 'sa_instalment', ar: 'تقسيط (SAR)', en: 'Instalment (SAR)' },
  { key: 'sa_cash', ar: 'كاش (SAR)', en: 'Cash (SAR)' },
  { key: 'eg', ar: 'مصر (EGP)', en: 'Egypt (EGP)' },
];

const money = (value: number | null, currency: string, lang: 'ar' | 'en') =>
  value === null || !Number.isFinite(value)
    ? null
    : new Intl.NumberFormat(lang === 'ar' ? 'ar-EG' : 'en-US', {
        style: 'currency',
        currency: currency || 'SAR',
        maximumFractionDigits: 0,
      }).format(value);

const offerFigure = (offer: Offer) => offer.exact ?? offer.minimum ?? offer.maximum;

/**
 * One route's price.
 *
 * The band when there is one, the live offer beneath it, and the offer *instead*
 * of a dash when the course publishes no base price on this route at all — which
 * is a real, sellable number and not the absence of one.
 */
function RoutePrice({
  band,
  offers,
  lang,
  ar,
}: {
  band: Band | null;
  offers: Offer[];
  lang: 'ar' | 'en';
  ar: boolean;
}) {
  const offer = offers[0];
  const offerText = offer ? money(offerFigure(offer), offer.currency, lang) : null;

  if (!band) {
    if (!offerText) return <span className="text-ink-faint">—</span>;
    return (
      <span className="inline-flex items-center gap-1 whitespace-nowrap">
        <BadgePercent size={12} className="shrink-0 text-accent-600" />
        <bdi className="num font-semibold text-accent-600">{offerText}</bdi>
        <span className="text-[10.5px] text-ink-faint">{ar ? 'عرض' : 'offer'}</span>
      </span>
    );
  }

  const floor = money(band.floor, band.currency, lang);
  const ceiling = money(band.ceiling, band.currency, lang);
  return (
    <span className="block">
      <bdi className="num whitespace-nowrap text-ink">
        <span className="font-semibold">{ceiling}</span>
        {!band.fixed && floor !== ceiling && (
          <>
            <span className="text-ink-faint"> ← </span>
            <span className="text-ink-muted">{floor}</span>
          </>
        )}
      </bdi>
      {offerText && (
        <span className="mt-0.5 flex items-center gap-1 whitespace-nowrap">
          <BadgePercent size={11} className="shrink-0 text-accent-600" />
          <bdi className="num text-[11.5px] font-semibold text-accent-600">{offerText}</bdi>
          <span className="text-[10.5px] text-ink-faint">{ar ? 'عرض' : 'offer'}</span>
        </span>
      )}
    </span>
  );
}

function Chips({ row, ar }: { row: Row; ar: boolean }) {
  return (
    <>
      {row.mode === 'package' && (
        <span className="chip bg-brand-50 text-brand-600">{ar ? 'باقة' : 'Package'}</span>
      )}
      {row.onHold && (
        <span className="chip gap-1 bg-surface-sunken text-ink-muted">
          <Pause size={12} />
          {ar ? 'موقوفة' : 'On hold'}
        </span>
      )}
      {row.unpriced && (
        <span className="chip gap-1 bg-status-warnBg text-status-warn">
          <AlertTriangle size={12} />
          {ar ? 'بلا سعر منشور' : 'No published price'}
        </span>
      )}
    </>
  );
}

export function PriceList({
  onBook,
  onPick,
}: {
  onBook?: (book: Book | null) => void;
  onPick?: (row: Row) => void;
}) {
  const { lang, dir } = useI18n();
  const ar = lang === 'ar';

  const [query, setQuery] = useState('');
  const [specialization, setSpecialization] = useState('');
  const [delivery, setDelivery] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const [showFilters, setShowFilters] = useState(false);

  const [data, setData] = useState<CatalogResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let live = true;
    const run = async () => {
      setLoading(true);
      setError('');
      try {
        const params = new URLSearchParams({ limit: '600' });
        if (query.trim()) params.set('q', query.trim());
        if (specialization) params.set('specialization', specialization);
        if (delivery) params.set('deliveryType', delivery);
        if (filter !== 'all') params.set(filter, '1');
        const result = await api.get<CatalogResponse>(`/prices/catalog?${params}`);
        if (!live) return;
        setData(result);
        onBook?.(result.book);
      } catch (err) {
        if (!live) return;
        setError(errorMessage(err, lang));
        setData(null);
      } finally {
        if (live) setLoading(false);
      }
    };
    const timer = setTimeout(run, query.trim() ? 350 : 0);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [query, specialization, delivery, filter, lang, onBook]);

  const rows = data?.courses ?? [];
  const counts = data?.counts;

  const deliveryLabel = (value: string) =>
    DELIVERY[value] ? DELIVERY[value][lang] : value || (ar ? 'غير محدد' : '—');

  const filters: Array<{ value: Filter; label: string; count?: number }> = useMemo(
    () => [
      { value: 'all', label: ar ? 'الكل' : 'All' },
      { value: 'negotiable', label: ar ? 'قابلة للتفاوض' : 'Negotiable', count: counts?.negotiable },
      { value: 'offers', label: ar ? 'عليها عرض' : 'Has an offer', count: counts?.withOffers },
      { value: 'unpriced', label: ar ? 'بلا سعر' : 'Unpriced', count: counts?.unpriced },
    ],
    [ar, counts]
  );

  // Forward is left in Arabic and right in English, so the glyph changes rather
  // than being flipped — a mirrored chevron is the same arrow pointing back.
  const Forward = dir === 'rtl' ? ChevronLeft : ChevronRight;

  return (
    <div className="space-y-3.5">
      <div className="card p-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-[10rem] flex-1">
            <Search
              size={16}
              className={cx(
                'pointer-events-none absolute top-1/2 -translate-y-1/2 text-ink-faint',
                dir === 'rtl' ? 'right-3' : 'left-3'
              )}
            />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={ar ? 'ابحث بالاسم أو الكود…' : 'Search by name or code…'}
              className={cx('field', dir === 'rtl' ? 'pr-9' : 'pl-9')}
              autoComplete="off"
            />
          </div>
          <button
            type="button"
            onClick={() => setShowFilters((open) => !open)}
            className={cx('btn-ghost btn-sm gap-1.5', showFilters && '!bg-surface-sunken')}
          >
            <SlidersHorizontal size={15} />
            {ar ? 'الفلاتر' : 'Filters'}
          </button>
        </div>

        <Segmented<Filter>
          value={filter}
          onChange={setFilter}
          options={filters}
          className="mt-2.5"
        />

        {showFilters && (
          <div className="mt-2.5 grid gap-2 sm:grid-cols-2">
            <select
              value={specialization}
              onChange={(event) => setSpecialization(event.target.value)}
              className="field"
            >
              <option value="">{ar ? 'كل التخصصات' : 'Every specialization'}</option>
              {(data?.facets.specializations ?? []).map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </select>
            <select
              value={delivery}
              onChange={(event) => setDelivery(event.target.value)}
              className="field"
            >
              <option value="">{ar ? 'كل طرق التقديم' : 'Every delivery type'}</option>
              {(data?.facets.deliveryTypes ?? []).map((value) => (
                <option key={value} value={value}>
                  {deliveryLabel(value)}
                </option>
              ))}
            </select>
          </div>
        )}
      </div>

      {loading && !data ? (
        <div className="card grid place-items-center py-16">
          <Spinner size={26} className="text-brand-500" />
        </div>
      ) : error ? (
        <div className="card">
          <EmptyState
            icon={<AlertTriangle size={30} />}
            title={ar ? 'تعذّر قراءة قائمة الأسعار' : 'The price list could not be read'}
            body={error}
          />
        </div>
      ) : data && !data.configured ? (
        <div className="card">
          <EmptyState
            icon={<AlertTriangle size={30} />}
            title={ar ? 'الوحدة غير مهيأة' : 'This module is not configured'}
            body={
              ar
                ? 'الاتصال بلوحة الإنسايتس غير مضبوط على الخادم. راجع مدير النظام.'
                : 'The link to the Insights Hub is not set on the server.'
            }
          />
        </div>
      ) : !rows.length ? (
        <div className="card">
          <EmptyState
            icon={<Search size={30} />}
            title={ar ? 'لا توجد دورات بهذه الفلاتر' : 'No courses match these filters'}
            body={ar ? 'وسّع البحث أو امسح الفلاتر.' : 'Widen the search or clear the filters.'}
          />
        </div>
      ) : (
        <div className="card overflow-hidden">
          <div className="flex items-center justify-between gap-2 border-b border-surface-line px-3.5 py-2.5">
            <p className="text-[12.5px] font-semibold text-ink-muted">
              {ar ? `${data?.total} دورة` : `${data?.total} courses`}
            </p>
            <p className="hidden text-[11.5px] text-ink-faint sm:block">
              {ar ? 'السعر الرسمي ← الحد الأدنى' : 'List price ← floor'}
            </p>
          </div>

          {/* A phone gets cards. A table with three price columns on a 375px
              screen is a horizontal scrollbar, and a seller mid-call will not
              scroll sideways to find the floor. */}
          <ul className="divide-y divide-surface-line sm:hidden">
            {rows.map((row) => (
              <li key={row.key}>
                <button
                  type="button"
                  onClick={() => onPick?.(row)}
                  className={cx(
                    'w-full px-3.5 py-3 text-start active:bg-surface-sunken',
                    row.unpriced && 'bg-status-warnBg/40'
                  )}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="text-[13.5px] font-semibold text-ink">
                          {row.courseName}
                        </span>
                        <Chips row={row} ar={ar} />
                      </div>
                      <p className="ltr mt-0.5 text-[11px] text-ink-faint">
                        {row.rawCode || row.code || '—'} · {deliveryLabel(row.deliveryType)}
                      </p>
                    </div>
                    <Forward size={16} className="mt-1 shrink-0 text-ink-faint" />
                  </div>
                  <dl className="mt-2 space-y-1">
                    {ROUTES.map((route) => (
                      <div key={route.key} className="flex items-baseline justify-between gap-3">
                        <dt className="text-[11.5px] text-ink-muted">{route[lang]}</dt>
                        <dd className="text-[12.5px]">
                          <RoutePrice
                            band={row.routes[route.key]}
                            offers={row.offersByRoute?.[route.key] ?? []}
                            lang={lang}
                            ar={ar}
                          />
                        </dd>
                      </div>
                    ))}
                  </dl>
                </button>
              </li>
            ))}
          </ul>

          <div className="hidden overflow-x-auto sm:block">
            <table className="w-full min-w-[44rem] text-start">
              <thead>
                <tr className="border-b border-surface-line bg-surface-sunken/60 text-[11.5px] text-ink-muted">
                  <th className="px-3.5 py-2 text-start font-semibold">
                    {ar ? 'الدورة' : 'Course'}
                  </th>
                  {ROUTES.map((route) => (
                    <th key={route.key} className="px-3 py-2 text-start font-semibold">
                      {route[lang]}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr
                    key={row.key}
                    onClick={() => onPick?.(row)}
                    className={cx(
                      'cursor-pointer border-b border-surface-line last:border-b-0 hover:bg-surface-sunken/70',
                      row.unpriced && 'bg-status-warnBg/40'
                    )}
                  >
                    <td className="px-3.5 py-2.5 align-top">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="text-[13px] font-semibold text-ink">{row.courseName}</span>
                        <Chips row={row} ar={ar} />
                      </div>
                      <p className="ltr mt-0.5 text-[11px] text-ink-faint">
                        {row.rawCode || row.code || '—'} · {deliveryLabel(row.deliveryType)}
                        {row.specialization && ` · ${row.specialization}`}
                      </p>
                    </td>
                    {ROUTES.map((route) => (
                      <td key={route.key} className="px-3 py-2.5 align-top text-[12.5px]">
                        <RoutePrice
                          band={row.routes[route.key]}
                          offers={row.offersByRoute?.[route.key] ?? []}
                          lang={lang}
                          ar={ar}
                        />
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
