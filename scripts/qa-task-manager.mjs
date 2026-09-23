#!/usr/bin/env node
/**
 * Task Management browser regression — the checks a type checker cannot make.
 *
 * Losing the caret mid-word, a half-written hand-in vanishing on Cancel, an old
 * poll rolling a submitted task back, the Done column mixing every month: each
 * of those shipped once, and none of them is visible to `npm test`. This drives
 * the real built app in a real browser against a throwaway workspace.
 *
 *   npm run build
 *   npm run qa:tasks
 *
 * Nothing here touches your data: the script starts its own server on a random
 * port with a temporary DATA_DIR, seeds three accounts and a handful of tasks,
 * and deletes the directory afterwards.
 *
 * It needs `playwright-core` and a Chromium, and deliberately does not add them
 * to package.json. Point PLAYWRIGHT_CORE_FROM at any project that has
 * playwright-core installed (or install it globally), e.g.
 *
 *   PLAYWRIGHT_CORE_FROM=~/some-project npm run qa:tasks
 *
 * The browser is Playwright's cached Chromium if present, else installed Chrome.
 * Set HEADED=1 to watch it.
 */

import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 41_000 + Math.floor(Math.random() * 4_000);
const ORIGIN = `http://127.0.0.1:${PORT}`;
const ADMIN = { email: 'admin@qa.local', password: 'AdminPass123!' };
const MANAGER = { email: 'manager@qa.local', password: 'Manager123!' };
const EMPLOYEE = { email: 'employee@qa.local', password: 'Employee123!' };

/* ── setup ───────────────────────────────────────────────────────── */

async function loadPlaywright() {
  const from = process.env.PLAYWRIGHT_CORE_FROM;
  try {
    if (from) return createRequire(path.join(path.resolve(from.replace(/^~/, os.homedir())), '/'))('playwright-core');
    return await import('playwright-core');
  } catch {
    console.error(
      'playwright-core not found. Set PLAYWRIGHT_CORE_FROM to a directory whose node_modules has it,\n' +
        'or install it globally (npm i -g playwright-core). It is not a dependency of this repo on purpose.'
    );
    process.exit(2);
  }
}

let server = null;
async function startServer(dataDir) {
  server = spawn(process.execPath, ['server/index.js'], {
    cwd: ROOT,
    env: {
      PATH: process.env.PATH,
      HOME: process.env.HOME,
      DATA_DIR: dataDir,
      PORT: String(PORT),
      ADMIN_EMAIL: ADMIN.email,
      ADMIN_PASSWORD: ADMIN.password,
      SESSION_SECRET: 'qa-session-secret-1234567890123456',
      SSO_SECRET: 'qa-sso-secret-123456789012345678',
      GOOGLE_CLIENT_ID: '',
    },
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      if ((await fetch(`${ORIGIN}/api/health`)).ok) return;
    } catch {
      // still starting
    }
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  throw new Error('QA server did not start');
}

async function stopServer() {
  if (!server) return;
  const exited = new Promise((resolve) => server.once('exit', resolve));
  server.kill();
  await exited;
  server = null;
}

async function api(pathname, { method = 'GET', body, cookie } = {}) {
  const response = await fetch(`${ORIGIN}/api${pathname}`, {
    method,
    headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(cookie ? { Cookie: cookie } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await response.json().catch(() => null);
  if (!response.ok) throw new Error(`${method} ${pathname} → ${response.status} ${JSON.stringify(data)}`);
  return { data, cookie: response.headers.get('set-cookie')?.split(';')[0] };
}
const signIn = async ({ email, password }) =>
  (await api('/auth/login', { method: 'POST', body: { email, password } })).cookie;

async function seed(dataDir) {
  await startServer(dataDir);
  const admin = await signIn(ADMIN);
  await api('/users', {
    method: 'POST',
    cookie: admin,
    body: { name: 'Mirna Manager', ...MANAGER, role: 'manager', department: 'marketing', subteam: 'performance', jobRole: 'media_buyer' },
  });
  const employee = (
    await api('/users', {
      method: 'POST',
      cookie: admin,
      body: { name: 'Sara Designer', ...EMPLOYEE, role: 'member', department: 'marketing', subteam: 'creative', jobRole: 'designer' },
    })
  ).data.user;
  const manager = await signIn(MANAGER);
  const worker = await signIn(EMPLOYEE);
  const make = async (title, accept = true) => {
    const { task } = (
      await api('/tasks', {
        method: 'POST',
        cookie: manager,
        body: { title, description: `Brief for ${title}`, department: 'marketing', subteam: 'creative', stage: 'pending', assigneeIds: [employee.id] },
      })
    ).data;
    if (accept) await api(`/tasks/${task.id}/assignment`, { method: 'POST', cookie: worker, body: { action: 'accept' } });
    return task;
  };
  await make('QA flow task');
  await make('QA race task');
  await make('QA assignment task', false);
  const archived = await make('QA archived task');
  await api(`/tasks/${archived.id}/archive`, { method: 'POST', cookie: admin, body: {} });
  archivedTaskId = archived.id;
  for (const title of ['QA done last month', 'QA done this month', 'QA done undated']) await make(title);
  await stopServer();

  // Finished history cannot be made through the API in the past, so it is
  // written straight into the store while the server is down.
  const file = path.join(dataDir, 'workspace.json');
  const workspace = JSON.parse(await fs.readFile(file, 'utf8'));
  const finish = (title, completedAt) => {
    const row = workspace.tasks.find((item) => item.title === title);
    Object.assign(row, {
      stage: 'done',
      completedAt,
      submittedAt: completedAt,
      firstSubmittedAt: completedAt,
      submittedBy: row.assigneeIds[0],
      reviewedAt: completedAt,
      reviewDecision: 'approved',
      score: 80,
      submissionNote: `Delivered ${title}`,
      progress: 100,
      startedAt: completedAt,
    });
  };
  const now = new Date();
  const thisMonth = new Date(now.getFullYear(), now.getMonth(), Math.min(now.getDate(), 10), 12).toISOString();
  const lastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 14, 12).toISOString();
  finish('QA done this month', thisMonth);
  finish('QA done last month', lastMonth);
  finish('QA done undated', lastMonth); // blanked in the browser: the server backfills a missing one at boot
  await fs.writeFile(file, JSON.stringify(workspace));
  await startServer(dataDir);
  return { thisMonthKey: monthKey(new Date(thisMonth)), lastMonthKey: monthKey(new Date(lastMonth)) };
}

const monthKey = (date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;

/* ── checks ──────────────────────────────────────────────────────── */

const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`);
}

async function main() {
  if (!existsSync(path.join(ROOT, 'dist', 'index.html'))) {
    console.error('No dist/ build. Run `npm run build` first — this checks the built app.');
    process.exit(2);
  }
  const { chromium } = await loadPlaywright();
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'qodo-task-qa-'));
  let browser;
  try {
    const months = await seed(dataDir);
    const headless = !process.env.HEADED;
    browser = await chromium.launch({ headless }).catch(() => chromium.launch({ headless, channel: 'chrome' }));
    await run(browser, months);
  } finally {
    await browser?.close().catch(() => {});
    await stopServer().catch(() => {});
    await fs.rm(dataDir, { recursive: true, force: true });
  }
  const passed = results.filter((item) => item.ok).length;
  console.log(`\n${passed}/${results.length} checks passed`);
  process.exit(passed === results.length ? 0 : 1);
}

async function session(browser, account, { lang = 'en', width = 1440, height = 1000 } = {}) {
  const context = await browser.newContext({ viewport: { width, height } });
  const response = await context.request.post(`${ORIGIN}/api/auth/login`, { data: account });
  if (!response.ok()) throw new Error(`login ${account.email}: ${response.status()}`);
  await context.addInitScript((language) => {
    try {
      localStorage.setItem('engosoft.lang', language);
    } catch {
      // ignore
    }
    // Live notification pop-ups float over the page and swallow clicks. Hidden
    // with CSS only — removing React's DOM would crash the app under test.
    document.addEventListener('DOMContentLoaded', () => {
      const style = document.createElement('style');
      style.textContent = 'div.fixed.z-\\[70\\] { display: none !important; }';
      document.head.appendChild(style);
    });
  }, lang);
  const page = await context.newPage();
  page.on('pageerror', (error) => check(`no page error (${error.message.slice(0, 80)})`, false));
  return page;
}

const dialog = (page) => page.getByRole('dialog');
const visible = (locator, timeout = 3000) =>
  locator.first().waitFor({ timeout }).then(() => true, () => false);
const forceParentRender = (page) => page.evaluate(() => window.dispatchEvent(new Event('focus')));
const focusedLabel = (page) =>
  page.evaluate(() => {
    const el = document.activeElement;
    return el ? `${el.tagName}:${el.getAttribute('aria-label') ?? el.closest('label')?.textContent?.slice(0, 20) ?? ''}` : '';
  });
const draftKeys = (page) =>
  page.evaluate(() => Object.keys(localStorage).filter((key) => key.startsWith('qodo.taskDraft')));

async function openBoard(page, view = 'Table') {
  await page.goto(`${ORIGIN}/tasks`);
  await page.getByRole('tab', { name: view }).click();
  // Everything seeded lives on the Marketing board; an administrator lands on their own department.
  const marketing = page.getByRole('button', { name: 'Marketing', exact: true });
  if (await marketing.count()) await marketing.first().click();
}
async function openTask(page, title) {
  await page.getByRole('button', { name: title, exact: true }).first().click();
  await dialog(page).waitFor();
}
async function closeDialog(page) {
  await page.keyboard.press('Escape');
  await dialog(page).waitFor({ state: 'detached' });
}

/** Type one character at a time, re-rendering the page between, and report the first slip. */
async function typeSteadily(page, text, expectFocus) {
  for (let i = 0; i < text.length; i += 1) {
    await page.keyboard.type(text[i]);
    if (i % 10 === 0) {
      await forceParentRender(page);
      await page.waitForTimeout(120);
    }
    if (!(await page.evaluate((selector) => document.activeElement?.matches(selector), expectFocus))) return i;
  }
  return -1;
}

/**
 * Hold the next board poll: its answer is taken from the server *now*, then
 * released only after `action` has written something newer.
 */
async function withStalePoll(page, action) {
  let release;
  const gate = new Promise((resolve) => (release = resolve));
  let held = false;
  await page.route('**/api/tasks', async (route) => {
    if (held || route.request().method() !== 'GET') return route.fallback();
    held = true;
    const response = await route.fetch();
    await gate;
    await route.fulfill({ response });
  });
  await forceParentRender(page);
  await page.waitForTimeout(300);
  await action();
  release();
  await page.waitForTimeout(800);
  await page.unroute('**/api/tasks');
}

async function run(browser, months) {
  /* 1–2. Existing title and details, through re-renders and a real poll. */
  {
    const page = await session(browser, ADMIN);
    await openBoard(page);
    await openTask(page, 'QA flow task');
    const title = dialog(page).getByLabel('Title');
    await title.click();
    await page.keyboard.press('End');
    const added = ' — typed one key at a time while the page re-renders underneath';
    const slip = await typeSteadily(page, added, 'input[aria-label="Title"]');
    check('existing title: 50+ chars without losing focus', slip < 0, slip < 0 ? `${added.length} chars` : `lost at ${slip}`);
    check('existing title: no characters lost', (await title.inputValue()) === `QA flow task${added}`);

    const details = dialog(page).getByLabel('Details');
    await details.click();
    await page.keyboard.press('Control+End');
    await page.keyboard.type('\nsecond line\nthird line');
    let polls = 0;
    page.on('response', (response) => response.url().endsWith('/api/tasks') && (polls += 1));
    await page.waitForTimeout(22_000);
    check('details: a real board poll ran while typing', polls > 0, `${polls}`);
    check('details: text survived the poll', (await details.inputValue()).endsWith('second line\nthird line'));
    check('details: focus survived the poll', (await focusedLabel(page)).startsWith('TEXTAREA'));
    for (const [label, text] of [['Objective', 'Grow sign-ups'], ['Definition of done', 'Three files'], ['Notes', 'Ask sales']]) {
      const field = dialog(page).getByLabel(label).first();
      await field.click();
      const miss = await typeSteadily(page, text, 'textarea');
      check(`${label.toLowerCase()}: typed without losing focus`, miss < 0 && (await field.inputValue()).endsWith(text));
    }

    // Modal: scroll lock, Escape, focus back to the opener, draft restore, close button, backdrop.
    check('modal: page scroll locked while open', (await page.evaluate(() => document.body.style.overflow)) === 'hidden');
    await closeDialog(page);
    check('modal: Escape closes and unlocks scroll', (await page.evaluate(() => document.body.style.overflow)) === '');
    check('modal: focus returns to the opener', (await page.evaluate(() => document.activeElement?.textContent)) === 'QA flow task');
    await openTask(page, 'QA flow task');
    check('edit draft: unsaved title restored on reopen', (await dialog(page).getByLabel('Title').inputValue()).endsWith('underneath'));
    check('edit draft: restore banner offered', await visible(page.getByText('Unsaved changes from last time were restored')));
    await dialog(page).getByRole('button', { name: 'Discard' }).click();
    check('edit draft: Discard returns to the saved title', (await dialog(page).getByLabel('Title').inputValue()) === 'QA flow task');
    await dialog(page).getByRole('button', { name: 'Close', exact: true }).first().click();
    await dialog(page).waitFor({ state: 'detached' });
    check('modal: close button closes', true);
    await openTask(page, 'QA flow task');
    await page.waitForTimeout(300); // the backdrop scales in from 96% for 200 ms
    await page.mouse.click(8, 990); // bottom-left: backdrop, clear of the dialog
    await dialog(page).waitFor({ state: 'detached' });
    check('modal: backdrop closes', true);

    /* 3. New task draft, and one Add = one task. */
    await page.getByRole('button', { name: 'New task' }).first().click();
    await dialog(page).waitFor();
    check('new task: title has autoFocus', (await page.evaluate(() => document.activeElement?.tagName)) === 'INPUT');
    const miss = await typeSteadily(page, 'Autumn launch plan', 'input');
    check('new task: title typed without losing focus', miss < 0);
    await dialog(page).getByLabel('Details').fill('Three posters and a reel');
    await dialog(page).getByLabel('Objective').fill('More sign-ups');
    await dialog(page).getByLabel('Definition of done').fill('Approved files');
    await dialog(page).getByLabel('Notes').fill('Ask sales for sizes');
    await dialog(page).getByLabel('Priority').selectOption('high');
    await dialog(page).getByLabel('Effort points').selectOption('5');
    await dialog(page).getByLabel('Due date').fill('2030-01-15');
    await dialog(page).getByText('Sara Designer').click();
    await page.waitForTimeout(500);
    await closeDialog(page);
    await page.getByRole('button', { name: 'New task' }).first().click();
    await dialog(page).waitFor();
    const restoredNew =
      (await dialog(page).getByLabel('Title').first().inputValue()) === 'Autumn launch plan' &&
      (await dialog(page).getByLabel('Objective').inputValue()) === 'More sign-ups' &&
      (await dialog(page).getByLabel('Priority').inputValue()) === 'high' &&
      (await dialog(page).getByLabel('Effort points').inputValue()) === '5' &&
      (await dialog(page).getByLabel('Due date').inputValue()) === '2030-01-15';
    check('new task: every field restored after an accidental close', restoredNew, JSON.stringify(await Promise.all(
      ['Title', 'Objective', 'Priority', 'Effort points', 'Due date'].map((label) => dialog(page).getByLabel(label).first().inputValue())
    )));
    check('new task: restore banner offered', await visible(page.getByText('The task you were writing, never added')));
    let creates = 0;
    page.on('request', (request) => request.method() === 'POST' && request.url().endsWith('/api/tasks') && (creates += 1));
    await dialog(page).getByRole('button', { name: 'Add', exact: true }).dblclick();
    await dialog(page).waitFor({ state: 'detached' });
    await page.waitForTimeout(500);
    check('new task: a double click creates one task', creates === 1, `${creates} POST(s)`);
    check('new task: draft cleared after creation', (await draftKeys(page)).length === 0);
    await page.getByRole('button', { name: 'New task' }).first().click();
    await dialog(page).waitFor();
    const reopened = await dialog(page).getByLabel('Title').first().inputValue();
    check('new task: next New task opens blank', reopened === '', JSON.stringify(reopened));
    await closeDialog(page);

    /* Race A: a poll sent before a save cannot undo it. */
    await openTask(page, 'QA race task');
    await withStalePoll(page, async () => {
      await dialog(page).getByLabel('Title').fill('QA race task renamed');
      await dialog(page).getByRole('button', { name: 'Save', exact: true }).click();
      await dialog(page).waitFor({ state: 'detached' });
    });
    check('race: stale poll does not revert a saved title', await visible(page.getByRole('button', { name: 'QA race task renamed', exact: true })));

    /* Archived task via its link: read-only. */
    const archived = (await page.context().request.get(`${ORIGIN}/api/tasks/${archivedId()}`)).ok();
    await page.goto(`${ORIGIN}/tasks?task=${archivedId()}`);
    await dialog(page).waitFor();
    check('archived: opens read-only from its link', archived && (await visible(dialog(page).getByText('This task is archived'))));
    check('archived: no comment box, no Save', (await dialog(page).getByPlaceholder('Write a comment…').count()) === 0 &&
      (await dialog(page).getByRole('button', { name: 'Save', exact: true }).count()) === 0);
    check('archived: title not editable', await dialog(page).getByLabel('Title').isDisabled());
    await closeDialog(page);
    check('archived: never added to the board', (await page.getByRole('button', { name: 'QA archived task', exact: true }).count()) === 0);
    await page.context().close();
  }

  const handIn = 'I designed the three posters, checked colours against the brand guide and exported print PDFs for the printer.';
  const secondHandIn = 'Fixed the logo spacing the manager asked for and re-exported all three files.';

  /* 4. Employee: assignment response draft. */
  {
    const page = await session(browser, EMPLOYEE);
    await openBoard(page);
    await openTask(page, 'QA assignment task');
    await dialog(page).getByRole('button', { name: 'Request clarification' }).click();
    const reason = dialog(page).getByLabel('Reason or note');
    check('assignment reply: autoFocus on the reason', (await focusedLabel(page)).startsWith('TEXTAREA'));
    const slip = await typeSteadily(page, 'Which sizes does the printer need?', 'textarea');
    check('assignment reply: typed without losing focus', slip < 0);
    await closeDialog(page);
    await openTask(page, 'QA assignment task');
    await dialog(page).getByRole('button', { name: 'Request clarification' }).click();
    check('assignment reply: draft restored', (await reason.inputValue()) === 'Which sizes does the printer need?');
    await dialog(page).getByRole('button', { name: 'Send', exact: true }).click();
    await page.waitForTimeout(700);
    check('assignment reply: draft cleared after sending', !(await draftKeys(page)).some((key) => key.endsWith(':assignment')));
    await closeDialog(page);

    /* 5. Employee: submit draft, comments, deliverables, hand-in. */
    await openTask(page, 'QA flow task');
    await dialog(page).getByRole('button', { name: 'Submit for review' }).click();
    const note = dialog(page).getByLabel('What you did');
    await note.click();
    const noteSlip = await typeSteadily(page, handIn, 'textarea');
    check('submit note: typed without losing focus', noteSlip < 0 && (await note.inputValue()) === handIn);
    await dialog(page).getByRole('button', { name: 'Cancel', exact: true }).first().click();
    await dialog(page).getByRole('button', { name: 'Submit for review' }).click();
    check('submit note: back after Cancel', (await note.inputValue()) === handIn);
    await closeDialog(page);
    await openTask(page, 'QA flow task');
    await dialog(page).getByRole('button', { name: 'Submit for review' }).click();
    check('submit note: back after closing the task', (await note.inputValue()) === handIn);

    const comment = dialog(page).getByPlaceholder('Write a comment…');
    await comment.click();
    await page.keyboard.type('First line');
    await page.keyboard.press('Shift+Enter');
    await page.keyboard.type('second line');
    check('comment: Shift+Enter is a newline', (await comment.inputValue()) === 'First line\nsecond line');
    await closeDialog(page);
    await openTask(page, 'QA flow task');
    check('comment: unsent text restored on reopen', (await comment.inputValue()) === 'First line\nsecond line');
    await page.route('**/api/tasks/*/comments', (route) =>
      route.request().method() === 'POST'
        ? route.fulfill({ status: 500, contentType: 'application/json', body: '{"error":"boom"}' })
        : route.fallback()
    );
    await comment.press('Enter');
    await page.waitForTimeout(500);
    check('comment: failed send keeps the text', (await comment.inputValue()) === 'First line\nsecond line');
    await page.unroute('**/api/tasks/*/comments');
    let posts = 0;
    page.on('request', (request) => request.method() === 'POST' && request.url().endsWith('/comments') && (posts += 1));
    await comment.press('Enter');
    await comment.press('Enter');
    await comment.press('Enter');
    await page.waitForTimeout(900);
    check('comment: rapid Enter sends exactly one', posts === 1, `${posts} POST(s)`);
    check('comment: box and draft cleared after sending', (await comment.inputValue()) === '' &&
      !(await draftKeys(page)).some((key) => key.endsWith(':comment')));
    check('comment: 5000-character limit matches the server', (await comment.getAttribute('maxlength')) === '5000');

    await dialog(page).locator('input[type=file]').setInputFiles([
      { name: 'poster-1.pdf', mimeType: 'application/pdf', buffer: Buffer.from('one') },
      { name: 'poster-2.pdf', mimeType: 'application/pdf', buffer: Buffer.from('two') },
    ]);
    check('deliverables: two files uploaded', await visible(dialog(page).getByText('poster-2.pdf'), 5000));
    // A file over the limit is refused on its own; the one beside it still goes up.
    await dialog(page).locator('input[type=file]').setInputFiles([
      { name: 'huge.pdf', mimeType: 'application/pdf', buffer: Buffer.alloc(10 * 1024 * 1024 + 1) },
      { name: 'poster-3.pdf', mimeType: 'application/pdf', buffer: Buffer.from('three') },
    ]);
    check('deliverables: oversize file refused, the other uploaded',
      (await visible(dialog(page).getByText('poster-3.pdf'), 5000)) && (await dialog(page).getByText('huge.pdf').count()) === 0);
    page.once('dialog', (prompt) => prompt.accept('https://drive.example.com/autumn'));
    await dialog(page).getByRole('button', { name: 'Attach a link' }).click();
    check('deliverables: link attached', await visible(dialog(page).getByText(/drive\.example\.com/), 5000));
    page.once('dialog', (confirm) => confirm.accept());
    await dialog(page).getByRole('button', { name: 'Remove attachment' }).nth(2).click();
    check('deliverables: a file removed', await dialog(page).getByText('poster-3.pdf').waitFor({ state: 'detached', timeout: 5000 }).then(() => true, () => false));
    await page.waitForTimeout(800);
    await withStalePoll(page, async () => {
      await dialog(page).getByRole('button', { name: 'Submit for review' }).click();
      check('submit note: still there after the comment round-trip', (await note.inputValue()) === handIn);
      await dialog(page).getByRole('button', { name: 'Submit for review' }).click();
      await visible(dialog(page).getByText(handIn.slice(0, 50)));
    });
    await closeDialog(page);
    await openTask(page, 'QA flow task');
    check('race: stale poll does not un-submit the task', await visible(dialog(page).getByText(handIn.slice(0, 50))));
    check('submit: all drafts cleared after success', (await draftKeys(page)).length === 0, JSON.stringify(await draftKeys(page)));
    const row = page.getByRole('row').filter({ has: page.getByRole('button', { name: 'QA flow task', exact: true }) });
    check('deliverables: board count synced (2 files + 1 link)', /\b3\b/.test(await row.locator('td').nth(8).textContent()),
      await row.locator('td').nth(8).textContent());
    await page.context().close();
  }

  /* 6. Manager sees the hand-in, drafts a review note, sends it back. */
  {
    const page = await session(browser, MANAGER);
    await openBoard(page);
    await openTask(page, 'QA flow task');
    check('manager: sees the submission note', await visible(dialog(page).getByText(handIn.slice(0, 50))));
    check('manager: sees the comment', await visible(dialog(page).getByText('second line')));
    check('manager: sees every deliverable', (await visible(dialog(page).getByText('poster-1.pdf'))) &&
      (await visible(dialog(page).getByText('poster-2.pdf'))) && (await visible(dialog(page).getByText(/drive\.example\.com/))));
    check('manager: no employee draft in this browser', (await draftKeys(page)).length === 0);
    await dialog(page).getByRole('button', { name: 'Send back → Rework' }).click();
    const reviewNote = dialog(page).getByLabel('Notes for the assignee');
    await reviewNote.click();
    const slip = await typeSteadily(page, 'Logo spacing is off on poster two', 'textarea');
    check('review note: typed without losing focus', slip < 0);
    await closeDialog(page);
    await openTask(page, 'QA flow task');
    await dialog(page).getByRole('button', { name: 'Send back → Rework' }).click();
    check('review note: draft restored', (await reviewNote.inputValue()) === 'Logo spacing is off on poster two');
    await withStalePoll(page, async () => {
      await dialog(page).getByRole('button', { name: 'Send back → Rework' }).last().click();
      await page.waitForTimeout(700);
    });
    await closeDialog(page);
    await openTask(page, 'QA flow task');
    check('race: stale poll does not undo the review', await visible(dialog(page).getByText('Logo spacing is off on poster two')));
    check('review note: draft cleared after the decision', (await draftKeys(page)).length === 0);
    await page.getByRole('tab', { name: /To review/ }).click().catch(() => {});
    await page.context().close();
  }

  /* 7. Employee reads the reason and hands in again. */
  {
    const page = await session(browser, EMPLOYEE);
    // The Rework guard blocks the workspace until the returned work is opened.
    await page.goto(`${ORIGIN}/tasks`);
    await page.getByRole('button', { name: 'Open Rework tasks' }).click();
    // …and opens the returned task straight away.
    await dialog(page).waitFor();
    check('rework: the guard opens the returned task', (await dialog(page).getByLabel('Title').inputValue()) === 'QA flow task');
    check('rework: employee sees the reason', await visible(dialog(page).getByText('Logo spacing is off on poster two')));
    await dialog(page).getByRole('button', { name: /Resubmit/ }).click();
    const note = dialog(page).getByLabel('What you did');
    check('rework: previous hand-in offered as the starting text', (await note.inputValue()) === handIn);
    await note.fill(secondHandIn);
    await dialog(page).getByRole('button', { name: /Resubmit/ }).last().click();
    check('rework: resubmitted', await visible(dialog(page).getByText(secondHandIn.slice(0, 40))));
    await page.context().close();
  }

  /* 8. Manager passes it on; drafts a rework reason; the final approver closes it. */
  {
    const page = await session(browser, MANAGER);
    await openBoard(page);
    await openTask(page, 'QA flow task');
    check('manager: sees the new hand-in', await visible(dialog(page).getByText(secondHandIn.slice(0, 40))));
    await dialog(page).getByRole('button', { name: 'Pass to approval' }).first().click();
    await dialog(page).getByRole('button', { name: 'Pass to approval' }).last().click();
    await page.waitForTimeout(700);
    await dialog(page).getByRole('button', { name: 'Send back for rework' }).click();
    check('rework reason: autoFocus', (await focusedLabel(page)).startsWith('TEXTAREA'));
    const slip = await typeSteadily(page, 'Client changed the brief', 'textarea');
    check('rework reason: typed without losing focus', slip < 0);
    await closeDialog(page);
    await openTask(page, 'QA flow task');
    await dialog(page).getByRole('button', { name: 'Send back for rework' }).click();
    check('rework reason: draft restored', (await dialog(page).locator('textarea').first().inputValue()) === 'Client changed the brief');
    await dialog(page).getByRole('button', { name: 'Cancel', exact: true }).first().click();
    await page.context().close();

    const admin = await session(browser, ADMIN);
    await openBoard(admin);
    await openTask(admin, 'QA flow task');
    await dialog(admin).getByRole('button', { name: 'Final approve → Done' }).click();
    await admin.waitForTimeout(800);
    await closeDialog(admin);
    await admin.getByRole('tab', { name: 'Board' }).click();
    const done = admin.locator('section').filter({ has: admin.getByRole('heading', { name: /^Done/ }) });
    check('done: the approved task lands in this month', await visible(done.getByText('QA flow task')));
    await admin.context().close();
  }

  /* 9–13. Done history, board vs table, review queue. */
  {
    const page = await session(browser, MANAGER);
    await page.route('**/api/tasks', async (route) => {
      if (route.request().method() !== 'GET') return route.fallback();
      const response = await route.fetch();
      const body = await response.json();
      for (const task of body.tasks) if (task.title === 'QA done undated') task.completedAt = null;
      await route.fulfill({ response, json: body });
    });
    await openBoard(page, 'Board');
    const done = page.locator('section').filter({ has: page.getByRole('heading', { name: /^Done/ }) });
    const cards = async () => (await done.locator('article h3').allTextContents()).sort();
    const picker = page.getByRole('group', { name: 'Completed in' }).first();
    check('done: current month by default', (await picker.locator('select').inputValue()) === months.thisMonthKey);
    check('done: this month only', JSON.stringify(await cards()) === JSON.stringify(['QA done this month', 'QA flow task']), JSON.stringify(await cards()));
    check('done: cards show their completion date', await visible(done.getByText(/^Completed /)));
    check('done: next month is not offered past today', await picker.getByRole('button', { name: 'Next month' }).isDisabled());
    await picker.getByRole('button', { name: 'Previous month' }).click();
    check('done: previous month only', JSON.stringify(await cards()) === JSON.stringify(['QA done last month']), JSON.stringify(await cards()));
    await page.getByRole('tab', { name: 'Table' }).click();
    const rows = async () => (await page.locator('tbody tr').allTextContents()).join('|');
    check('table: keeps the month chosen on the board', (await rows()).includes('QA done last month') && !(await rows()).includes('QA done this month'));
    check('table: open work still listed', (await rows()).includes('QA race task renamed'));
    await page.getByRole('tab', { name: 'Board' }).click();
    check('board: keeps the month chosen on the table', (await picker.locator('select').inputValue()) === months.lastMonthKey);
    await picker.getByRole('button', { name: 'Next month' }).click();
    check('done: back again, no duplicates', JSON.stringify(await cards()) === JSON.stringify(['QA done this month', 'QA flow task']));
    check('done: undated finished work is reported', await visible(page.getByText(/1 finished without a completion date/)));
    await picker.locator('select').selectOption('all');
    check('done: All history shows everything', (await cards()).length === 4);
    check('done: undated card says so', await visible(done.getByText('No completion date')));
    await page.getByRole('tab', { name: /To review/ }).click();
    check('review: history filtered by the same period', await visible(page.getByText('Reviewed history')));
    await page.context().close();
  }

  /* 14. Phone width, in Arabic. */
  {
    const page = await session(browser, EMPLOYEE, { lang: 'ar', width: 375, height: 812 });
    await page.goto(`${ORIGIN}/tasks`);
    await page.waitForTimeout(800);
    const fits = () => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth);
    check('phone: tasks page has no sideways scroll', await fits());
    await page.getByRole('button', { name: 'QA race task renamed', exact: true }).first().click();
    await dialog(page).waitFor();
    check('phone: open task has no sideways scroll', await fits());
    const title = dialog(page).locator('input').first();
    await page.waitForTimeout(500); // let the sheet finish sliding up
    const sheet = await dialog(page).evaluate((el) => [Math.round(el.getBoundingClientRect().bottom), innerHeight]);
    check('phone: dialog is a bottom sheet', Math.abs(sheet[0] - sheet[1]) < 2, sheet.join(' vs '));
    check('phone: comment box reachable', await visible(dialog(page).getByPlaceholder('اكتب تعليقاً…')));
    check('phone: submit reachable', await visible(dialog(page).getByRole('button', { name: 'تسليم للمراجعة' })));
    check('phone: title shown', (await title.inputValue()) === 'QA race task renamed');
    await page.context().close();
  }
}

let archivedTaskId = null;
const archivedId = () => archivedTaskId;

main().catch(async (error) => {
  console.error(error);
  await stopServer().catch(() => {});
  process.exit(1);
});
