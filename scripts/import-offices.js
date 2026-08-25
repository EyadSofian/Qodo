/**
 * One-time import of the office inventory into the seating plan.
 *
 * The inventory arrived as a four-sheet spreadsheet from the management team.
 * The sheet itself is not in the repository — it is company data, and it is a
 * snapshot rather than a source of truth — so the rows are transcribed below,
 * verbatim, with the spreadsheet's own spelling kept.
 *
 * Safe to re-run: every room and desk gets a deterministic id derived from the
 * zone, the room and the desk number, and every write is `createIfAbsent`, so a
 * second run adds what is missing and leaves everything already there alone —
 * including a desk somebody has since been moved to from the app.
 *
 *   DATA_DIR=./data node scripts/import-offices.js [--dry-run]
 *
 * Point DATABASE_URL at production instead of DATA_DIR to import into Postgres.
 *
 * Three things the spreadsheet said that this deliberately does not copy:
 *
 *   • Its «الشاغرة» column counts desks that ARE taken, despite the word. The
 *     data proves it: HR has 6 desks, the column says 4, and four names are
 *     listed. Nothing here stores that number at all — the desks are the count.
 *   • «موظف جديد» in IT is written where a name goes. It is a desk held for
 *     somebody who has not arrived, so it is imported as `reserved`, not as a
 *     person called "new employee".
 *   • ODOO's four occupied desks list no names. They come in as plain free
 *     desks with a note, because inventing four occupants would be worse than
 *     recording that the room needs asking about.
 */

import { createIfAbsent, getStore } from '../server/store.js';
import { DEFAULT_ORGANIZATION_ID } from '../shared/organization.js';
import { seatLabelFor } from '../shared/offices.js';

const ORGANIZATION = process.env.OFFICES_ORGANIZATION_ID || DEFAULT_ORGANIZATION_ID;
const DRY_RUN = process.argv.includes('--dry-run');

/**
 * The inventory as transcribed. `occupants` are the names as written; `free` is
 * the sheet's «المتاحة» column. `unnamed` is how many desks the sheet counts as
 * taken without saying by whom — only ODOO has any.
 */
const INVENTORY = [
  {
    zone: 'مكتب 1',
    rooms: [
      {
        nameAr: 'الموارد البشرية',
        department: 'hr',
        free: 2,
        occupants: ['صلاح', 'كريم', 'ياسمين', 'شاهندة'],
      },
      {
        nameAr: 'الحسابات',
        department: 'finance',
        free: 1,
        occupants: ['محمد عجمي', 'احمد شعبان', 'اميرة محمد', 'مصطفي فرحات'],
      },
      {
        nameAr: 'التدريب',
        department: 'training',
        free: 8,
        occupants: [],
        note: 'سيتم إضافة 8 وحدات لفريق المبيعات',
      },
      {
        nameAr: 'المبيعات',
        department: 'sales',
        free: 2,
        occupants: [
          'اسماء فتحي',
          'منة مجدي',
          'احمد شعبان',
          'احمد فاروق',
          'داليا محمد',
          'نادر رفعت',
          'محمد سامي',
          'حازم طلعت',
          'احمد ايهاب',
          'محمود حسن',
          'محمد ايهاب',
        ],
      },
    ],
  },
  {
    zone: 'مكتب 2',
    rooms: [
      {
        nameAr: 'IT',
        department: 'it',
        free: 0,
        occupants: ['عبدالله ذكي', 'عبدالله شحاتة'],
        reserved: 1,
      },
      {
        nameAr: 'ODOO',
        // Not resolved yet: an Odoo team is a system, not one of the nine
        // departments. Left unset rather than guessed.
        department: null,
        free: 1,
        occupants: [],
        unnamed: 4,
        note: 'الجرد يقول 4 وحدات مشغولة بلا أسماء · وقرار بإزالة المكتب وتركيب وحدتين',
      },
      {
        nameAr: 'LMS',
        department: null,
        free: 2,
        occupants: ['جورج', 'عبدالرحمن', 'حربي', 'عمر', 'احمد هشام'],
        note: 'إزالة جورج وتعيين بديل',
      },
      {
        nameAr: 'MARKETING',
        department: 'marketing',
        free: 1,
        occupants: [
          'صديق',
          'السيد',
          'محمد شاذلي',
          'ابوالعلا',
          'عبدالله',
          'ميرنا',
          'حبيبة',
          'طه',
          'شيماء',
          'رنا',
        ],
        note: 'الزيادة لموظفة السوشيال الجديدة',
      },
    ],
  },
  {
    zone: 'مكتب 3',
    rooms: [
      {
        nameAr: 'مبيعات كبير',
        department: 'sales',
        free: 10,
        occupants: ['منتصر', 'هادي', 'مريم', 'ياسمين', 'احمد ابراهيم', 'مصطفي', 'حسين'],
        note: 'ستتم إزالة أحمد إبراهيم',
      },
      {
        nameAr: 'مبيعات صغير',
        department: 'sales',
        free: 0,
        occupants: ['منة', 'شريف', 'صابرين', 'بسمة', 'اسلام', 'بهاء', 'محمد عبدالله'],
      },
      {
        nameAr: 'اجتماعات · مصلّى',
        department: null,
        kind: 'prayer',
        free: 0,
        occupants: [],
      },
      {
        nameAr: 'عمليات',
        department: 'operations',
        free: 0,
        occupants: [
          'محفوظ',
          'عبدالرحمن طارق',
          'احمد علاء',
          'محمود',
          'رامي',
          'عبدالرحمن عادل',
          'احمد شعبان',
          'وفاء',
        ],
      },
      {
        nameAr: 'جودة و ادمن',
        // «جودة» reads like customer service and «ادمن» like general; picking
        // one would be a guess, and the colour on the plan follows this field.
        department: null,
        free: 2,
        occupants: ['عمرو', 'دينا', 'ياسمين', 'مارتن', 'سيف', 'فيصل'],
      },
    ],
  },
];

/**
 * Stable across runs and readable in the store — `office:مكتب-1:الحسابات`.
 *
 * Arabic is kept because a legible id is worth having, but whitespace is not:
 * an id goes into a URL path (`PATCH /api/offices/:officeId`), and a raw space
 * there is a malformed URL rather than something the server can decode.
 */
const slug = (value) => String(value).trim().replace(/[\s/?#%]+/g, '-');
const officeId = (zone, nameAr) => `office:${slug(zone)}:${slug(nameAr)}`;
const seatId = (zone, nameAr, index) => `seat:${slug(zone)}:${slug(nameAr)}:${index}`;

async function main() {
  await getStore();

  // Every write below is `createIfAbsent` on a deterministic id, so a desk that
  // has been edited from the app since the last run is left exactly as it is.
  // The spreadsheet is a snapshot; whoever moved somebody in the UI knew more.
  let rooms = 0;
  let desks = 0;
  let existing = 0;
  let order = 0;
  let named = 0;
  let held = 0;
  let unnamedTotal = 0;

  for (const zone of INVENTORY) {
    for (const room of zone.rooms) {
      const id = officeId(zone.zone, room.nameAr);
      const occupants = room.occupants ?? [];
      const reserved = room.reserved ?? 0;
      const unnamed = room.unnamed ?? 0;
      const units = occupants.length + reserved + unnamed + (room.free ?? 0);
      order += 10;

      if (!DRY_RUN) {
        await createIfAbsent('offices', {
          id,
          organizationId: ORGANIZATION,
          zone: zone.zone,
          nameAr: room.nameAr,
          nameEn: null,
          department: room.department ?? null,
          kind: room.kind ?? 'workroom',
          columns: null,
          // Nothing is measured yet. The schematic works without it, and the
          // scaled plan stays unavailable until somebody walks the floor.
          dimensions: null,
          note: room.note ?? null,
          order,
        });
      }
      rooms += 1;

      for (let index = 0; index < units; index += 1) {
        // Named occupants first, then the desks held for new joiners, then the
        // ones the sheet counts as taken but cannot name, then the free ones.
        const name = occupants[index] ?? null;
        const isReserved = !name && index < occupants.length + reserved;
        const isUnnamed =
          !name && !isReserved && index < occupants.length + reserved + unnamed;

        if (name) named += 1;
        else if (isReserved) held += 1;
        else if (isUnnamed) unnamedTotal += 1;

        if (!DRY_RUN) {
          const { created } = await createIfAbsent('officeSeats', {
            id: seatId(zone.zone, room.nameAr, index),
            organizationId: ORGANIZATION,
            officeId: id,
            label: seatLabelFor(index),
            gridIndex: index,
            point: null,
            status: isReserved ? 'reserved' : 'free',
            userId: null,
            occupantName: name,
            note: isUnnamed ? 'الجرد يعدّها مشغولة بلا اسم' : null,
          });
          if (created) desks += 1;
          else existing += 1;
        } else {
          desks += 1;
        }
      }
    }
  }

  const line = '─'.repeat(58);
  console.log(`\n${line}`);
  console.log(`  ${DRY_RUN ? 'Dry run' : 'Imported'}: ${rooms} rooms, ${desks} desks`);
  if (existing) console.log(`  Already present, left untouched: ${existing} desks`);
  console.log(`  Organization: ${ORGANIZATION}`);
  console.log(line);

  // The plan will report fewer occupied desks than the spreadsheet did, and
  // saying so here is the point: the difference is exactly the rows that could
  // not name anybody. Discovering that as a mystery later would be worse.
  console.log(`  Occupied by a named person: ${named}`);
  console.log(`  Reserved for a new joiner:  ${held}   («موظف جديد» in IT)`);
  console.log(`  Counted as taken, unnamed:  ${unnamedTotal}   (ODOO — imported as free, with a note)`);
  console.log(`${line}\n`);
  console.log('  Names came in as plain text. Link them to accounts from the');
  console.log('  Offices page so a rename in the directory follows the desk.\n');
}

await main();
process.exit(0);
