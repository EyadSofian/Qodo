/**
 * One-time import of the management desk out of Supabase and into the workspace.
 *
 * The desk used to live in the SLA dashboard, storing into `mgmt_item` with a
 * service key. Everything it holds is real — meetings that happened, decisions
 * that were taken, work that is still owed — so moving the module without
 * moving the history would mean starting the board at zero on the day the
 * people who use it most needed to look something up.
 *
 * Safe to re-run. Rows are matched by their Supabase id, which is carried over
 * as `importedFrom`, so a second run updates rather than duplicates.
 *
 *   SUPABASE_URL=https://xxx.supabase.co \
 *   SUPABASE_SERVICE_KEY=sb_secret_... \
 *   DATA_DIR=./data \
 *   node scripts/import-management-from-supabase.js [--dry-run]
 *
 * Point DATABASE_URL at production instead of DATA_DIR to import into Postgres.
 */

import { create, find, getStore } from '../server/store.js';
import { DEFAULT_ORGANIZATION_ID } from '../shared/organization.js';
import { DEPARTMENT_IDS } from '../shared/departments.js';

const SUPABASE_URL = (process.env.SUPABASE_URL ?? '').replace(/\/+$/, '');
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY ?? process.env.SUPABASE_SECRET_KEY ?? '';
const ORGANIZATION = process.env.MANAGEMENT_ORGANIZATION_ID || DEFAULT_ORGANIZATION_ID;
const DRY_RUN = process.argv.includes('--dry-run');

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('Set SUPABASE_URL and SUPABASE_SERVICE_KEY (the secret key, not the publishable one).');
  process.exit(1);
}

async function fetchAll(table) {
  const rows = [];
  const pageSize = 500;
  for (let from = 0; ; from += pageSize) {
    const response = await fetch(`${SUPABASE_URL}/rest/v1/${table}?select=*&order=created_at.asc`, {
      headers: {
        apikey: SUPABASE_KEY,
        Authorization: `Bearer ${SUPABASE_KEY}`,
        Range: `${from}-${from + pageSize - 1}`,
      },
    });
    if (!response.ok) {
      throw new Error(`${table}: ${response.status} ${await response.text()}`);
    }
    const page = await response.json();
    rows.push(...page);
    if (page.length < pageSize) return rows;
  }
}

/**
 * An owner was a free-text name over there. Resolving it to a real account is
 * most of the point of the move, but the written name is kept either way — if
 * nobody matches, it is still the honest record of who was meant.
 */
function resolveOwner(name, people) {
  const written = typeof name === 'string' ? name.trim() : '';
  if (!written) return { ownerId: null, ownerName: null };
  const needle = written.toLowerCase();
  const exact = people.find((person) => person.name?.toLowerCase() === needle);
  const partial = people.filter((person) => person.name?.toLowerCase().includes(needle));
  const match = exact ?? (partial.length === 1 ? partial[0] : null);
  return { ownerId: match?.id ?? null, ownerName: written };
}

function toItem(row, people) {
  const { ownerId, ownerName } = resolveOwner(row.owner_name, people);
  const department = typeof row.department === 'string' ? row.department.trim() : '';
  const known = DEPARTMENT_IDS.includes(department);

  return {
    organizationId: ORGANIZATION,
    importedFrom: row.id,
    kind: row.kind ?? 'task',
    title: row.title,
    details: row.details ?? null,
    ownerId,
    ownerName,
    department: known ? department : null,
    departmentLabel: known ? null : department || null,
    priority: row.priority ?? 'normal',
    status: row.status ?? 'todo',
    dueAt: row.due_at ?? null,
    durationMin: row.duration_min ?? null,
    location: row.location ?? null,
    attendees: Array.isArray(row.attendees) ? row.attendees : [],
    tags: Array.isArray(row.tags) ? row.tags : [],
    source: row.source ?? 'dashboard',
    reporter: row.reporter ?? null,
    chatId: row.chat_id ?? null,
    messageId: row.message_id ?? null,
    rawText: row.raw_text ?? null,
    aiConfidence: row.ai_confidence ?? null,
    aiModel: row.ai_model ?? null,
    needsReview: Boolean(row.needs_review),
    ingestId: null,
    createdBy: null,
    // The originals are the truth about when things happened; letting `create`
    // stamp today would make every item look filed on migration day.
    createdAt: row.created_at ?? new Date().toISOString(),
    updatedAt: row.updated_at ?? row.created_at ?? new Date().toISOString(),
    doneAt: row.done_at ?? null,
  };
}

async function main() {
  const store = await getStore();
  console.log(`store: ${store.kind}  ·  organization: ${ORGANIZATION}${DRY_RUN ? '  ·  DRY RUN' : ''}`);

  const [rows, people, existing] = await Promise.all([
    fetchAll('mgmt_item'),
    find('users'),
    find('managementItems'),
  ]);

  const seen = new Map(existing.filter((row) => row.importedFrom).map((row) => [row.importedFrom, row]));
  console.log(`supabase: ${rows.length} items  ·  already imported: ${seen.size}`);

  let created = 0;
  let updated = 0;
  let unresolved = 0;

  for (const row of rows) {
    if (!row.title) continue;
    const item = toItem(row, people);
    if (item.ownerName && !item.ownerId) unresolved += 1;

    const already = seen.get(row.id);
    if (DRY_RUN) {
      already ? (updated += 1) : (created += 1);
      continue;
    }

    if (already) {
      await store.update('managementItems', already.id, item);
      updated += 1;
    } else {
      await create('managementItems', item);
      created += 1;
    }
  }

  console.log(`created: ${created}  ·  updated: ${updated}`);
  if (unresolved) {
    console.log(
      `note: ${unresolved} items name an owner who is not a workspace user — the name is kept, the link is not.`
    );
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
