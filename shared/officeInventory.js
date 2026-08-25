import { seatLabelFor } from './offices.js';

/**
 * The office inventory as it was handed over.
 *
 * A four-sheet spreadsheet from the management team, transcribed here with its
 * own spelling kept. The sheet itself is not in the repository — it is company
 * data and it is a snapshot, not a source of truth. This is the starting state
 * the workspace is given so somebody can begin correcting it; it is not a
 * record that stays in step with the building.
 *
 * Three things the sheet said that this deliberately does not copy:
 *
 *   • Its «الشاغرة» column counts desks that ARE taken, despite the word. The
 *     data proves it: HR has 6 desks, the column says 4, and four names are
 *     listed. Nothing here stores that number at all — the desks are the count.
 *   • «موظف جديد» in IT is written where a name goes. It is a desk held for
 *     somebody who has not arrived, so it becomes `reserved`, not a person
 *     called "new employee".
 *   • ODOO's four occupied desks list no names. They come in as plain free
 *     desks carrying the question, because inventing four occupants would be
 *     worse than recording that the room needs asking about.
 *
 * `occupants` are the names as written; `free` is the sheet's «المتاحة» column;
 * `unnamed` is how many desks it counts as taken without saying by whom.
 */
export const INVENTORY = [
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
];;

/** Stable across runs and readable in the store — `office:مكتب-1:الحسابات`.
 *
 * Arabic is kept because a legible id is worth having, but whitespace is not:
 * an id goes into a URL path (`PATCH /api/offices/:officeId`), and a raw space
 * there is a malformed URL rather than something the server can decode.
 */
const slug = (value) => String(value).trim().replace(/[\s/?#%]+/g, '-');

export const officeId = (zone, nameAr) => `office:${slug(zone)}:${slug(nameAr)}`;
export const seatId = (zone, nameAr, index) => `seat:${slug(zone)}:${slug(nameAr)}:${index}`;

/**
 * The rows flattened into the documents they become.
 *
 * Named occupants first, then the desks held for new joiners, then the ones the
 * sheet counts as taken but cannot name, then the free ones — so a desk's id
 * stays put across runs and re-running never shuffles anybody.
 */
export function inventoryDocuments(organizationId) {
  const offices = [];
  const seats = [];
  let order = 0;

  for (const zone of INVENTORY) {
    for (const room of zone.rooms) {
      const id = officeId(zone.zone, room.nameAr);
      const occupants = room.occupants ?? [];
      const reserved = room.reserved ?? 0;
      const unnamed = room.unnamed ?? 0;
      const units = occupants.length + reserved + unnamed + (room.free ?? 0);
      order += 10;

      offices.push({
        id,
        organizationId,
        zone: zone.zone,
        nameAr: room.nameAr,
        nameEn: null,
        department: room.department ?? null,
        kind: room.kind ?? 'workroom',
        columns: null,
        // Nothing is measured yet, and nothing is placed. That is the point:
        // the rooms arrive unarranged so the person who knows the floor can
        // arrange them, rather than inheriting a guess they have to undo.
        dimensions: null,
        shape: null,
        note: room.note ?? null,
        order,
      });

      for (let index = 0; index < units; index += 1) {
        const name = occupants[index] ?? null;
        const isReserved = !name && index < occupants.length + reserved;
        const isUnnamed =
          !name && !isReserved && index < occupants.length + reserved + unnamed;

        seats.push({
          id: seatId(zone.zone, room.nameAr, index),
          organizationId,
          officeId: id,
          label: seatLabelFor(index),
          gridIndex: index,
          point: null,
          status: isReserved ? 'reserved' : 'free',
          userId: null,
          occupantName: name,
          note: isUnnamed ? 'الجرد يعدّها مشغولة بلا اسم' : null,
        });
      }
    }
  }
  return { offices, seats };
}

/** What the sheet said, and what could not be honoured — printed on import. */
export function inventoryTally() {
  let named = 0;
  let held = 0;
  let unnamed = 0;
  let units = 0;
  for (const zone of INVENTORY) {
    for (const room of zone.rooms) {
      named += (room.occupants ?? []).length;
      held += room.reserved ?? 0;
      unnamed += room.unnamed ?? 0;
      units +=
        (room.occupants ?? []).length + (room.reserved ?? 0) + (room.unnamed ?? 0) + (room.free ?? 0);
    }
  }
  return { rooms: INVENTORY.reduce((n, z) => n + z.rooms.length, 0), units, named, held, unnamed };
}
