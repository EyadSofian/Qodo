import { seatLabelFor } from './offices.js';

/**
 * The office inventory as it was handed over.
 *
 * The latest four-sheet distribution from the management team, transcribed
 * here with its own spelling kept. This is the fresh-install snapshot; later
 * uploads through HR → Data sync replace the corresponding office zones.
 *
 * Two inconsistent totals are deliberately reconciled instead of copied:
 *
 *   • LMS lists 7 units and 4 people but says 2 are available. Capacity and
 *     named people imply 3 available desks.
 *   • MARKETING lists 12 units and 12 people but says 1 is available. The room
 *     is therefore full.
 *
 * `occupants` are the names as written; `free` is always capacity minus those
 * names so the visible room total cannot contradict itself.
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
        nameAr: 'غرفة نادر (مبيعات جديد)',
        department: 'sales',
        free: 3,
        occupants: ['نادر عزيز', 'حازم طلعت', 'محمد حسن', 'احمد الشيخ', 'داليا محمد'],
      },
      {
        nameAr: 'المبيعات غرفة اسماء',
        department: 'sales',
        free: 5,
        occupants: [
          'اسماء',
          'سامي',
          'مازن',
          'محمد ايهاب',
          'احمد ايهاب',
          'سارة عسكر',
          'احمد فارق',
          'احمد سليمان',
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
        occupants: ['عبدالله ذكي', 'عبدالله شحاتة', 'احمد لطفي'],
      },
      {
        nameAr: 'ODOO',
        // Not resolved yet: an Odoo team is a system, not one of the nine
        // departments. Left unset rather than guessed.
        department: null,
        free: 2,
        occupants: ['اياد', 'عطية', 'صابر', 'كريم'],
      },
      {
        nameAr: 'LMS',
        department: null,
        occupants: ['عبدالرحمن', 'حربي', 'عمر', 'محمد هشام'],
        // The sheet says seven units and lists four people, while its available
        // column says two. Capacity and named occupants are authoritative, so
        // the third unassigned desk is kept visible instead of disappearing.
        free: 3,
      },
      {
        nameAr: 'MARKETING',
        department: 'marketing',
        free: 0,
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
          'مي مصطفي',
          'احمد هشام',
        ],
      },
    ],
  },
  {
    zone: 'مكتب 3',
    rooms: [
      {
        nameAr: 'مبيعات كبير',
        department: 'sales',
        free: 11,
        occupants: ['منتصر', 'هادي', 'ياسمين', 'مصطفي', 'حسين', 'صابرين'],
        note: 'سيتم إزالة أحمد إبراهيم',
      },
      {
        nameAr: 'مبيعات صغير',
        department: 'sales',
        free: 1,
        occupants: ['منة', 'شريف', 'بسمة', 'اسلام', 'بهاء', 'محمد عبدالله'],
      },
      {
        nameAr: 'اجتماعات',
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
        note: 'سيتم تعيين موظف جديد في مكان عمل وفاء',
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

/** The fresh-install snapshot tally printed on first boot. */
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
  return {
    rooms: INVENTORY.reduce((n, z) => n + z.rooms.length, 0),
    units,
    named,
    free: units - named - held - unnamed,
    held,
    unnamed,
  };
}
