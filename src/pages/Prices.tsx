/**
 * دليل الأسعار — the price book, for the people who sell from it.
 *
 * Two tabs, because a seller asks the book two different questions. Scanning it
 * — what do we charge for everything — is a list. Pricing the call in front of
 * you is a decision, and needs the market, the payment route and what the
 * customer just said. One screen answering both would do neither well.
 *
 * The rest of the Insights pricing dashboard — which invoices breached, how the
 * team compares, editing and publishing the book — answers a different question
 * for a different audience and deliberately does not live here.
 *
 * Nothing here decides a price. Every band and every verdict is computed by the
 * hub from one module, so this screen and its compliance report cannot disagree.
 */

import { useCallback, useState } from 'react';
import { Compass, ListChecks } from 'lucide-react';
import { useI18n } from '../lib/i18n';
import { Segmented } from '../components/ui';
import { PriceAdvisor, type Book, type Handoff } from '../components/prices/PriceAdvisor';
import { PriceList, type Row } from '../components/prices/PriceList';

type Tab = 'list' | 'advisor';

export function Prices() {
  const { lang } = useI18n();
  const ar = lang === 'ar';
  const [tab, setTab] = useState<Tab>('list');
  const [book, setBook] = useState<Book | null>(null);
  const [handoff, setHandoff] = useState<Handoff | null>(null);

  // Both tabs read the same published book; whichever loads first names it.
  const onBook = useCallback((next: Book | null) => setBook((current) => next ?? current), []);

  // Picking a row in the list is the start of pricing a call, not the end of
  // reading one. Hand the course over and follow it.
  const onPick = useCallback((row: Row) => {
    setHandoff({ key: row.key, courseName: row.courseName });
    setTab('advisor');
  }, []);

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-5 sm:px-6">
      <header className="mb-4">
        <h1 className="text-xl font-bold text-ink">{ar ? 'دليل الأسعار' : 'Price book'}</h1>
        <p className="mt-1 text-[13.5px] leading-relaxed text-ink-muted">
          {ar
            ? 'الأسعار المعتمدة لكل الدورات، ومساحة التفاوض المسموحة، وهل السعر يحتاج موافقة مدير.'
            : 'The approved price for every course, the room you have to negotiate in, and whether a figure needs a manager.'}
        </p>
        {book && (
          <p className="mt-1 text-[11.5px] text-ink-faint">
            {ar ? 'كتاب الأسعار' : 'Price book'} v{book.version} ·{' '}
            {ar ? 'ساري من' : 'in force since'} {String(book.effectiveFrom).slice(0, 10)}
          </p>
        )}
      </header>

      <Segmented<Tab>
        value={tab}
        onChange={setTab}
        options={[
          {
            value: 'list',
            label: ar ? 'قائمة الأسعار' : 'Price list',
            icon: <ListChecks size={15} />,
          },
          {
            value: 'advisor',
            label: ar ? 'اقتراح السعر' : 'Price advisor',
            icon: <Compass size={15} />,
          },
        ]}
        className="mb-4 w-fit"
      />

      {/* Both stay mounted: switching back to a search you already ran should
          not throw the result away and fetch it again. */}
      <div hidden={tab !== 'list'}>
        <PriceList onBook={onBook} onPick={onPick} />
      </div>
      <div hidden={tab !== 'advisor'}>
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.35fr)]">
          <PriceAdvisor onBook={onBook} handoff={handoff} />
        </div>
      </div>
    </div>
  );
}
