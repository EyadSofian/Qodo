/**
 * اقتراح السعر — what a seller may quote, while the customer is still on the
 * line.
 *
 * This is the one question a salesperson actually asks the price book: what is
 * the number, how far down may I go, and does going there need a manager. The
 * rest of the Insights pricing dashboard — which invoices breached, how the team
 * compares, editing the book — answers a different question for a different
 * audience, and deliberately does not live here.
 *
 * Every figure on this screen is computed by the hub, not by this page. The
 * band, the suggestion and the verdict arrive decided; only the sentences are
 * written here. That is the whole point: a seller quoting a number this page
 * invented, against a compliance report the hub computed, is exactly the
 * disagreement the module exists to prevent.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  BadgePercent,
  Check,
  CircleAlert,
  Copy,
  Search,
  ShieldCheck,
  Sparkles,
} from 'lucide-react';
import { api, errorMessage } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { EmptyState, Segmented, Spinner } from '@/components/ui';
import { cx } from '@/lib/utils';

type Market = 'sa' | 'eg';
type Payment = 'instalment' | 'cash';
type CustomerState = 'standard' | 'discount' | 'approved_floor';
type Verdict = 'safe' | 'needs_approval' | 'not_allowed' | 'above_list';
type ReasonCode =
  | 'list_price'
  | 'fixed_price'
  | 'stepped_down_for_discount'
  | 'approved_exception_floor'
  | 'opens_at_list';

interface Band {
  floor: number | null;
  ceiling: number | null;
  currency: string;
  fixed: boolean;
  requiresReview: boolean;
}

interface Match {
  key: string;
  code: string;
  courseName: string;
  specialization: string;
  deliveryType: string;
  level: string;
  onHold: boolean;
}

interface Offer {
  id: string;
  currency: string;
  exact: number | null;
  minimum: number | null;
  maximum: number | null;
  validTo: string;
  note: string;
}

interface Advice {
  courseName: string;
  deliveryType: string;
  /** Whether this band is the course's own price or its bundle's. */
  mode: 'course' | 'package';
  currency: string;
  band: Band | null;
  suggested: number | null;
  asked: number | null;
  priceInQuestion: number | null;
  verdict: Verdict | null;
  reasons: ReasonCode[];
  alternate: { payment: Payment; band: Band } | null;
  offers: Offer[];
}

export interface Book {
  version: number;
  effectiveFrom: string;
}

interface AdviceResponse {
  ok: boolean;
  configured: boolean;
  book: Book | null;
  matches: Match[];
  advice: Advice | null;
  error: string;
}

const VERDICTS: Record<Verdict, { ar: string; en: string; tone: string; Icon: typeof Check }> = {
  safe: {
    ar: 'يمكن البيع من دون موافقة',
    en: 'Can be sold without approval',
    tone: 'bg-status-okBg text-status-ok',
    Icon: ShieldCheck,
  },
  needs_approval: {
    ar: 'يحتاج موافقة مدير المبيعات',
    en: "Needs the sales manager's approval",
    tone: 'bg-status-warnBg text-status-warn',
    Icon: AlertTriangle,
  },
  not_allowed: {
    ar: 'غير مسموح — تحت الحد الأدنى',
    en: 'Not allowed — under the floor',
    tone: 'bg-status-badBg text-status-bad',
    Icon: CircleAlert,
  },
  above_list: {
    ar: 'أعلى من السعر الرسمي — يُسجَّل للمراجعة',
    en: 'Above list — recorded for review',
    tone: 'bg-status-infoBg text-status-info',
    Icon: BadgePercent,
  },
};

const money = (value: number | null, currency: string, lang: 'ar' | 'en') =>
  value === null || !Number.isFinite(value)
    ? '—'
    : new Intl.NumberFormat(lang === 'ar' ? 'ar-EG' : 'en-US', {
        style: 'currency',
        currency: currency || 'SAR',
        maximumFractionDigits: 2,
      }).format(value);

const DELIVERY: Record<string, { ar: string; en: string }> = {
  online: { ar: 'أونلاين', en: 'Online' },
  offline: { ar: 'حضوري', en: 'In person' },
  recorded: { ar: 'مسجّل', en: 'Recorded' },
  exam: { ar: 'اختبار', en: 'Exam' },
};

export function PriceAdvisor({ onBook }: { onBook?: (book: Book | null) => void }) {
  const { lang, dir } = useI18n();
  const ar = lang === 'ar';

  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<Match | null>(null);
  const [market, setMarket] = useState<Market>('sa');
  const [payment, setPayment] = useState<Payment>('instalment');
  const [customerState, setCustomerState] = useState<CustomerState>('standard');
  const [asked, setAsked] = useState('');

  const [data, setData] = useState<AdviceResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);

  /**
   * Only the newest question may answer.
   *
   * Toggling cash/instalment twice quickly puts two requests in flight, and
   * nothing makes them come back in order. Letting a slower earlier one land
   * would leave the wrong band on screen under the right pair of buttons — which
   * on this page means quoting a price the audit will call a breach. So each
   * request takes a number and a stale one is dropped on arrival.
   */
  const latest = useRef(0);
  const load = useCallback(
    async (params: Record<string, string>) => {
      const id = ++latest.current;
      setLoading(true);
      setError('');
      try {
        const search = new URLSearchParams(params).toString();
        const result = await api.get<AdviceResponse>(`/prices/advice?${search}`);
        if (id !== latest.current) return;
        setData(result);
      } catch (err) {
        if (id !== latest.current) return;
        setError(errorMessage(err, lang));
        setData(null);
      } finally {
        if (id === latest.current) setLoading(false);
      }
    },
    [lang]
  );

  // Searching is debounced because it is typed a letter at a time; choosing a
  // course and then a route is not, so those reload immediately.
  useEffect(() => {
    if (selected) return;
    const term = query.trim();
    if (term.length < 2) {
      setData(null);
      return;
    }
    const timer = setTimeout(() => void load({ q: term, market, payment, state: customerState }), 350);
    return () => clearTimeout(timer);
  }, [query, selected, market, payment, customerState, load]);

  useEffect(() => {
    if (!selected) return;
    void load({
      key: selected.key,
      market,
      payment,
      state: customerState,
      ...(asked.trim() ? { asked: asked.trim() } : {}),
    });
  }, [selected, market, payment, customerState, asked, load]);

  useEffect(() => {
    if (data?.book) onBook?.(data.book);
  }, [data, onBook]);

  const advice = data?.advice ?? null;
  const matches = data?.matches ?? [];
  const band = advice?.band ?? null;

  const reasonText = useMemo(() => {
    if (!advice || !band) return [];
    const currency = advice.currency;
    return advice.reasons.map((reason) => {
      switch (reason) {
        case 'list_price':
          return ar
            ? `السعر الرسمي المنشور لهذه الطريقة ${money(band.ceiling, currency, lang)}.`
            : `The published list price for this route is ${money(band.ceiling, currency, lang)}.`;
        case 'fixed_price':
          return ar
            ? 'هذه الدورة منشورة بسعر ثابت، ولا تقبل التفاوض.'
            : 'This course is published at a fixed price and is not negotiable.';
        case 'stepped_down_for_discount':
          return ar
            ? `طلب العميل خصمًا، فنزلنا خطوة واحدة داخل النطاق المسموح إلى ${money(advice.suggested, currency, lang)}.`
            : `The customer asked for a discount, so the price steps down once inside the allowed band to ${money(advice.suggested, currency, lang)}.`;
        case 'approved_exception_floor':
          return ar
            ? 'الحالة مسجَّلة كاستثناء معتمد، فالاقتراح هو الحد الأدنى نفسه.'
            : 'This is recorded as an approved exception, so the suggestion is the floor itself.';
        case 'opens_at_list':
          return ar
            ? 'لا يوجد اعتراض على السعر، فالبيع يبدأ من السعر الرسمي.'
            : 'There is no price objection, so the sale opens at the list price.';
      }
    });
  }, [advice, band, ar, lang]);

  /**
   * Two instruments publishing the same number are one offer to a seller.
   *
   * Tabby and Tamara each carry their own row at the same price, and rendering
   * both puts the identical line on screen twice, which reads as a bug. Folded
   * here rather than in the rule, because the two rows are genuinely two rules
   * and the API is right to say so.
   */
  const offers = useMemo(() => {
    const seen = new Map<string, Offer>();
    for (const offer of advice?.offers ?? []) {
      const key = `${offer.exact}|${offer.minimum}|${offer.maximum}|${offer.validTo}|${offer.note}`;
      if (!seen.has(key)) seen.set(key, offer);
    }
    return [...seen.values()];
  }, [advice]);

  const copyPrice = async () => {
    if (advice?.priceInQuestion == null) return;
    try {
      await navigator.clipboard.writeText(String(advice.priceInQuestion));
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard access can be refused; the figure is on screen either way.
    }
  };

  const pick = (match: Match) => {
    setSelected(match);
    setQuery(match.courseName);
  };

  const reset = () => {
    setSelected(null);
    setAsked('');
    setData(null);
  };

  const deliveryLabel = (value: string) =>
    DELIVERY[value] ? DELIVERY[value][lang] : value || (ar ? 'غير محدد' : 'unspecified');

  return (
    <>
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.35fr)]">
        {/* ── the sale in front of you ─────────────────────────────── */}
        <section className="card h-fit p-4">
          <h2 className="text-[13.5px] font-bold text-ink">
            {ar ? 'الحالة التي تبيع فيها' : 'The sale in front of you'}
          </h2>

          <label className="label mt-4" htmlFor="price-course">
            {ar ? 'الدورة' : 'Course'}
          </label>
          <div className="relative">
            <Search
              size={16}
              className={cx(
                'pointer-events-none absolute top-1/2 -translate-y-1/2 text-ink-faint',
                dir === 'rtl' ? 'right-3' : 'left-3'
              )}
            />
            <input
              id="price-course"
              value={query}
              onChange={(event) => {
                setQuery(event.target.value);
                if (selected) reset();
              }}
              placeholder={ar ? 'ابحث بالاسم أو الكود…' : 'Search by name or code…'}
              className={cx('field', dir === 'rtl' ? 'pr-9' : 'pl-9')}
              autoComplete="off"
            />
          </div>

          {!selected && matches.length > 0 && (
            <ul className="mt-2 max-h-64 overflow-y-auto rounded-xl border border-surface-line">
              {matches.map((match) => (
                <li key={match.key}>
                  <button
                    type="button"
                    onClick={() => pick(match)}
                    className="w-full border-b border-surface-line px-3 py-2.5 text-start last:border-b-0 hover:bg-surface-sunken"
                  >
                    <span className="block text-[13px] font-semibold text-ink">
                      {match.courseName}
                    </span>
                    <span className="ltr block text-[11.5px] text-ink-faint">
                      {match.code} · {deliveryLabel(match.deliveryType)}
                      {match.onHold && ` · ${ar ? 'موقوفة' : 'on hold'}`}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}

          <div className="mt-4 space-y-3">
            <div>
              <span className="label">{ar ? 'السوق' : 'Market'}</span>
              <Segmented<Market>
                value={market}
                onChange={setMarket}
                options={[
                  { value: 'sa', label: ar ? 'السعودية' : 'Saudi' },
                  { value: 'eg', label: ar ? 'مصر' : 'Egypt' },
                ]}
              />
            </div>

            {market === 'sa' && (
              <div>
                <span className="label">{ar ? 'طريقة الدفع' : 'Payment route'}</span>
                <Segmented<Payment>
                  value={payment}
                  onChange={setPayment}
                  options={[
                    { value: 'instalment', label: ar ? 'تقسيط' : 'Instalment' },
                    { value: 'cash', label: ar ? 'كاش' : 'Cash' },
                  ]}
                />
              </div>
            )}

            <div>
              <span className="label">{ar ? 'حالة العميل' : 'The customer'}</span>
              <Segmented<CustomerState>
                value={customerState}
                onChange={setCustomerState}
                options={[
                  { value: 'standard', label: ar ? 'عادي' : 'Standard' },
                  { value: 'discount', label: ar ? 'طلب خصم' : 'Asked for a discount' },
                  { value: 'approved_floor', label: ar ? 'استثناء معتمد' : 'Approved exception' },
                ]}
              />
            </div>

            <div>
              <label className="label" htmlFor="price-asked">
                {ar ? 'العميل طلب سعر معيّن؟' : 'Did the customer name a price?'}
              </label>
              <input
                id="price-asked"
                value={asked}
                onChange={(event) => setAsked(event.target.value)}
                inputMode="decimal"
                placeholder={ar ? 'اختياري — اكتب الرقم للحكم عليه' : 'Optional — type it to have it judged'}
                className="field num"
                disabled={!selected}
              />
            </div>
          </div>
        </section>

        {/* ── the answer ───────────────────────────────────────────── */}
        <section className="card min-h-[22rem] p-4">
          {loading && !advice ? (
            <div className="grid h-full place-items-center py-16">
              <Spinner size={26} className="text-brand-500" />
            </div>
          ) : error ? (
            <EmptyState
              icon={<CircleAlert size={30} />}
              title={ar ? 'تعذّر قراءة السعر' : 'The price could not be read'}
              body={error}
            />
          ) : data && !data.configured ? (
            <EmptyState
              icon={<CircleAlert size={30} />}
              title={ar ? 'الوحدة غير مهيأة' : 'This module is not configured'}
              body={
                ar
                  ? 'الاتصال بلوحة الإنسايتس غير مضبوط على الخادم. راجع مدير النظام.'
                  : 'The link to the Insights Hub is not set on the server. Ask an administrator.'
              }
            />
          ) : !selected ? (
            <EmptyState
              icon={<Sparkles size={30} />}
              title={ar ? 'اختر الدورة' : 'Pick a course'}
              body={
                ar
                  ? 'ابحث بالاسم أو الكود، ثم اختر الدورة ليظهر السعر المناسب لهذه الحالة.'
                  : 'Search by name or code and pick the course; the right price for the case appears here.'
              }
            />
          ) : !advice || (!band && offers.length === 0) ? (
            <EmptyState
              icon={<CircleAlert size={30} />}
              title={ar ? 'لا يوجد سعر منشور لهذه الطريقة' : 'No price is published for this route'}
              body={
                ar
                  ? 'جرّب طريقة دفع أخرى أو سوقًا آخر — كتاب الأسعار لا يحمل سعرًا لهذه الحالة.'
                  : 'Try another payment route or market — the price book publishes nothing for this one.'
              }
            />
          ) : (
            <div className="space-y-4">
              <div>
                <h2 className="text-[15px] font-bold text-ink">{advice.courseName}</h2>
                <p className="text-[12px] text-ink-faint">
                  {advice.mode === 'package' && (
                    <span className="chip me-1.5 bg-brand-50 text-brand-600">
                      {ar ? 'سعر باقة' : 'Package price'}
                    </span>
                  )}
                  {deliveryLabel(advice.deliveryType)} ·{' '}
                  {market === 'eg'
                    ? ar
                      ? 'مصر'
                      : 'Egypt'
                    : payment === 'cash'
                      ? ar
                        ? 'كاش'
                        : 'Cash'
                      : ar
                        ? 'تقسيط'
                        : 'Instalment'}
                </p>
              </div>

              {band && (
                <>
                {/* the number */}
                <div className="rounded-2xl bg-surface-sunken p-4">
                  <p className="text-[11.5px] font-semibold text-ink-muted">
                    {advice.asked !== null
                      ? ar
                        ? 'السعر الذي طلبه العميل'
                        : 'The price the customer named'
                      : ar
                        ? 'ابدأ من'
                        : 'Open at'}
                  </p>
                  <div className="mt-1 flex items-center gap-3">
                    <span className="num text-3xl font-bold text-ink">
                      {money(advice.priceInQuestion, advice.currency, lang)}
                    </span>
                    <button
                      type="button"
                      onClick={copyPrice}
                      className="btn-quiet btn-sm !min-h-9"
                      title={ar ? 'نسخ الرقم' : 'Copy the figure'}
                    >
                      {copied ? <Check size={15} /> : <Copy size={15} />}
                    </button>
                  </div>
                  {advice.asked !== null && advice.suggested !== null && (
                    <p className="mt-1 text-[12px] text-ink-muted">
                      {ar ? 'الاقتراح لهذه الحالة' : 'The suggestion for this case'}:{' '}
                      <bdi className="num font-semibold">
                        {money(advice.suggested, advice.currency, lang)}
                      </bdi>
                    </p>
                  )}
                </div>

                {/* the room around it */}
                <div className="flex items-center justify-between gap-3 rounded-xl border border-surface-line px-3.5 py-2.5">
                  <div>
                    <p className="text-[11px] text-ink-faint">{ar ? 'الحد الأدنى' : 'Floor'}</p>
                    <p className="num text-[14px] font-bold text-ink">
                      {money(band.floor, advice.currency, lang)}
                    </p>
                  </div>
                  <div className="h-px flex-1 bg-surface-line" />
                  <div className="text-end">
                    <p className="text-[11px] text-ink-faint">{ar ? 'السعر الرسمي' : 'List price'}</p>
                    <p className="num text-[14px] font-bold text-ink">
                      {money(band.ceiling, advice.currency, lang)}
                    </p>
                  </div>
                </div>

                {/* the verdict */}
                {advice.verdict && (
                  <div
                    className={cx(
                      'flex items-start gap-2.5 rounded-xl px-3.5 py-3',
                      VERDICTS[advice.verdict].tone
                    )}
                  >
                    {(() => {
                      const Icon = VERDICTS[advice.verdict].Icon;
                      return <Icon size={18} className="mt-0.5 shrink-0" />;
                    })()}
                    <div>
                      <p className="text-[13px] font-bold">{VERDICTS[advice.verdict][lang]}</p>
                      {advice.verdict === 'not_allowed' &&
                        band.floor !== null &&
                        advice.priceInQuestion !== null && (
                          <p className="mt-0.5 text-[12px] leading-relaxed opacity-90">
                            {ar
                              ? `أقل من الحد الأدنى بـ ${money(band.floor - advice.priceInQuestion, advice.currency, lang)}، وسيظهر في تقرير الالتزام كمخالفة.`
                              : `That is ${money(band.floor - advice.priceInQuestion, advice.currency, lang)} under the floor and will appear in compliance reporting as a breach.`}
                          </p>
                        )}
                    </div>
                  </div>
                )}

                {/* why */}
                {reasonText.length > 0 && (
                  <ul className="space-y-1.5 border-t border-surface-line pt-3">
                    {reasonText.map((reason) => (
                      <li key={reason} className="text-[12.5px] leading-relaxed text-ink-muted">
                        {reason}
                      </li>
                    ))}
                  </ul>
                )}

                {/* the route not taken */}
                {advice.alternate && (
                  <p className="text-[12px] leading-relaxed text-ink-muted">
                    {ar ? 'الطريقة الأخرى' : 'The other route'} (
                    {advice.alternate.payment === 'cash'
                      ? ar
                        ? 'كاش'
                        : 'cash'
                      : ar
                        ? 'تقسيط'
                        : 'instalment'}
                    ):{' '}
                    <bdi className="num font-semibold text-ink">
                      {money(advice.alternate.band.floor, advice.currency, lang)} –{' '}
                      {money(advice.alternate.band.ceiling, advice.currency, lang)}
                    </bdi>
                  </p>
                )}
                </>
              )}

              {/* priced only by a live offer: real, and not a band */}
              {!band && (
                <p className="rounded-xl bg-status-infoBg px-3.5 py-3 text-[12.5px] leading-relaxed text-status-info">
                  {ar
                    ? 'هذه الدورة ليس لها سعر أساسي منشور على هذه الطريقة — تُباع بالعرض الساري أدناه، ولا توجد مساحة تفاوض حوله.'
                    : 'This course publishes no base price on this route — it is sold at the live offer below, and there is no band to negotiate inside.'}
                </p>
              )}

              {/* live offers */}
              {offers.length > 0 && (
                <div className="rounded-xl bg-accent-50 px-3.5 py-3">
                  <p className="text-[12px] font-bold text-accent-600">
                    {ar ? 'عرض ساري' : 'Live offer'}
                  </p>
                  <ul className="mt-1 space-y-1">
                    {offers.map((offer) => (
                      <li key={offer.id} className="text-[12.5px] leading-relaxed text-ink">
                        <bdi className="num font-bold">
                          {money(
                            offer.exact ?? offer.minimum ?? offer.maximum,
                            offer.currency,
                            lang
                          )}
                        </bdi>{' '}
                        <span className="text-ink-muted">
                          {offer.validTo
                            ? ar
                              ? `حتى ${offer.validTo}`
                              : `until ${offer.validTo}`
                            : ar
                              ? 'بدون تاريخ انتهاء'
                              : 'no end date'}
                        </span>
                        {offer.note && (
                          <span className="block text-[11.5px] text-ink-faint">{offer.note}</span>
                        )}
                      </li>
                    ))}
                    <li className="text-[11.5px] leading-relaxed text-ink-muted">
                      {ar
                        ? 'البيع بسعر العرض معتمد ولا يُحتسب مخالفة.'
                        : 'Selling at the offer price is approved and is not counted as a breach.'}
                    </li>
                  </ul>
                </div>
              )}
            </div>
          )}
        </section>
      </div>
    </>
  );
}
