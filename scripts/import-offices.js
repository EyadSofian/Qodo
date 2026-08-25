/**
 * Re-deliver the office inventory into an existing workspace.
 *
 * The rooms normally arrive on their own: `server/seed.js` hands the inventory
 * over on first boot and records that it did, so a redeploy never delivers it
 * twice. This script is the deliberate second run — for a workspace created
 * before the module existed, for a different organization, or to put back rooms
 * that were removed by mistake.
 *
 * The rows live in `shared/officeInventory.js`, so the boot delivery and this
 * script cannot drift apart.
 *
 * Safe to re-run: every room and desk carries a deterministic id, and every
 * write is `createIfAbsent`, so a second run adds what is missing and leaves
 * everything already there untouched — including a desk somebody has since been
 * moved to from the app.
 *
 *   DATA_DIR=./data node scripts/import-offices.js [--dry-run]
 *
 * Point DATABASE_URL at production instead of DATA_DIR to import into Postgres.
 */

import { createIfAbsent, getStore } from '../server/store.js';
import { DEFAULT_ORGANIZATION_ID } from '../shared/organization.js';
import { inventoryDocuments, inventoryTally } from '../shared/officeInventory.js';

const ORGANIZATION = process.env.OFFICES_ORGANIZATION_ID || DEFAULT_ORGANIZATION_ID;
const DRY_RUN = process.argv.includes('--dry-run');

async function main() {
  await getStore();

  const { offices, seats } = inventoryDocuments(ORGANIZATION);
  let createdRooms = 0;
  let createdDesks = 0;
  let existing = 0;

  if (DRY_RUN) {
    createdRooms = offices.length;
    createdDesks = seats.length;
  } else {
    for (const office of offices) {
      const { created } = await createIfAbsent('offices', office);
      if (created) createdRooms += 1;
    }
    for (const seat of seats) {
      const { created } = await createIfAbsent('officeSeats', seat);
      if (created) createdDesks += 1;
      else existing += 1;
    }
  }

  const tally = inventoryTally();
  const line = '─'.repeat(58);
  console.log(`\n${line}`);
  console.log(`  ${DRY_RUN ? 'Dry run' : 'Imported'}: ${createdRooms} rooms, ${createdDesks} desks`);
  if (existing) console.log(`  Already present, left untouched: ${existing} desks`);
  console.log(`  Organization: ${ORGANIZATION}`);
  console.log(line);

  // The plan reports fewer occupied desks than the spreadsheet did, and saying
  // so here is the point: the difference is exactly the rows that could not
  // name anybody. Discovering that later as a mystery would be worse.
  console.log(`  Occupied by a named person: ${tally.named}`);
  console.log(`  Reserved for a new joiner:  ${tally.held}   («موظف جديد» in IT)`);
  console.log(`  Counted as taken, unnamed:  ${tally.unnamed}   (ODOO — free, carrying the question)`);
  console.log(`${line}\n`);
  console.log('  Rooms arrive unmeasured and unarranged, on purpose. Measure and');
  console.log('  lay them out from Offices → Edit, and link the names to accounts.\n');
}

await main();
process.exit(0);
