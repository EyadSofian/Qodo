import crypto from 'node:crypto';
import express, { Router } from 'express';
import { create } from '../store.js';
import { logActivity, requireAuth, requirePermission } from '../auth.js';
import { PERMISSIONS, can } from '../../shared/permissions.js';
import { DEFAULT_ORGANIZATION_ID, organizationOf } from '../../shared/organization.js';
import {
  hrDashboardFor,
  hrEmployeeFor,
  hrImportHistory,
  importHRDataset,
  linkHREmployee,
  organizationState,
  updateHREmployee,
} from '../hrModule.js';
import { HRWorkbookError, MAX_HR_WORKBOOK_BYTES } from '../hrWorkbook.js';
import { fail as failWith, handle } from './hrFail.js';
import recruitmentRoutes from './hrRecruitment.js';
import { employeeOdoo, hrAccess, hrHome, odooOnlyProfile, organizationOverview, payrollOverview, peopleDirectory } from '../hr/workspace.js';
import { performanceOverview, reviewFor, saveReview } from '../hr/performance.js';
import { buildReport, reportsFor } from '../hr/reports.js';
import { auditLog, reconciliationView, saveSettings, settingsView } from '../hr/admin.js';
import { saveRewardRules } from '../hr/recruitment/rewards.js';
import { migrateLegacyRecruitment } from '../hr/recruitment/migration.js';
import {
  createFormLink,
  createPersonnelCase,
  leaveOverview,
  listPersonnel,
  personnelCase,
  tickChecklist,
  updatePersonnelCase,
} from '../hr/personnel.js';
import { odooEmployeeByKey, odooEmployeeFor, odooEmployeeIndex, odooPhoto } from '../hr/odooPeople.js';

const router = Router();
const uploadBody = express.raw({ type: () => true, limit: MAX_HR_WORKBOOK_BYTES });

function fail(res, error) {
  // Workbook errors keep their historical `details` envelope — the import
  // screen reads it — everything else answers through the shared HR shape.
  if (error instanceof HRWorkbookError) {
    return res.status(error.status).json({ error: error.code, details: error.details ?? undefined });
  }
  return failWith(res, error);
}
const h = (fn) => handle(fn, 'hr');

function decodedFileName(header) {
  const raw = String(header || 'workbook.xlsx');
  try {
    return decodeURIComponent(raw).replace(/[\\/\u0000-\u001f]/g, ' ').trim().slice(0, 180) || 'workbook.xlsx';
  } catch {
    return 'workbook.xlsx';
  }
}

function sameSecret(received, expected) {
  const left = Buffer.from(String(received || ''));
  const right = Buffer.from(String(expected || ''));
  return Boolean(right.length) && left.length === right.length && crypto.timingSafeEqual(left, right);
}

function allowedTelegramChats() {
  return new Set(
    String(process.env.HR_TELEGRAM_CHAT_IDS || '')
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean)
  );
}

async function telegramFile(document) {
  const token = String(process.env.HR_TELEGRAM_BOT_TOKEN || process.env.TELEGRAM_BOT_TOKEN || '').trim();
  if (!token) throw new HRWorkbookError('hr_telegram_not_configured', 503);
  if (!/\.xlsx$/i.test(String(document?.file_name || ''))) {
    throw new HRWorkbookError('hr_file_type_invalid', 400);
  }
  if (Number(document?.file_size) > MAX_HR_WORKBOOK_BYTES) {
    throw new HRWorkbookError('hr_file_too_large', 413);
  }

  const metaResponse = await fetch(
    `https://api.telegram.org/bot${token}/getFile?file_id=${encodeURIComponent(document.file_id)}`
  );
  const meta = await metaResponse.json().catch(() => null);
  if (!metaResponse.ok || !meta?.ok || !meta.result?.file_path) {
    throw new HRWorkbookError('hr_telegram_download_failed', 502);
  }
  const fileResponse = await fetch(`https://api.telegram.org/file/bot${token}/${meta.result.file_path}`);
  if (!fileResponse.ok) throw new HRWorkbookError('hr_telegram_download_failed', 502);
  const advertised = Number(fileResponse.headers.get('content-length'));
  if (advertised > MAX_HR_WORKBOOK_BYTES) throw new HRWorkbookError('hr_file_too_large', 413);
  const bytes = Buffer.from(await fileResponse.arrayBuffer());
  if (bytes.length > MAX_HR_WORKBOOK_BYTES) throw new HRWorkbookError('hr_file_too_large', 413);
  return bytes;
}

async function replyToTelegram(chatId, text) {
  const token = String(process.env.HR_TELEGRAM_BOT_TOKEN || process.env.TELEGRAM_BOT_TOKEN || '').trim();
  if (!token || !chatId) return;
  try {
    await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text }),
    });
  } catch (error) {
    console.error('[hr] telegram reply failed:', error?.message ?? error);
  }
}

/**
 * Telegram sends JSON metadata first; the actual workbook is downloaded with
 * the bot token only after both the webhook secret and the chat allowlist pass.
 */
router.post('/telegram', async (req, res) => {
  const secret = process.env.HR_TELEGRAM_WEBHOOK_SECRET;
  const received = req.headers['x-telegram-bot-api-secret-token'] ?? req.headers['x-webhook-secret'];
  if (!sameSecret(received, secret)) return res.status(403).json({ error: 'forbidden' });

  const message = req.body?.message ?? req.body?.edited_message;
  const chatId = String(message?.chat?.id || '');
  const allowed = allowedTelegramChats();
  if (!allowed.size && process.env.NODE_ENV === 'production') {
    return res.status(503).json({ error: 'hr_telegram_not_configured' });
  }
  if (allowed.size && !allowed.has(chatId)) {
    return res.status(403).json({ error: 'hr_telegram_chat_forbidden' });
  }
  if (!message?.document) {
    await replyToTelegram(chatId, 'ارفع ملف Excel بصيغة .xlsx وسأحدّث موديول الموارد البشرية.');
    return res.json({ ok: true, ignored: 'no_document' });
  }

  const organizationId = process.env.HR_ORGANIZATION_ID || DEFAULT_ORGANIZATION_ID;
  try {
    const bytes = await telegramFile(message.document);
    const result = await importHRDataset({
      bytes,
      fileName: message.document.file_name,
      organizationId,
      origin: 'telegram',
    });
    const issues = Object.values(result.run.quality ?? {}).reduce((sum, count) => sum + Number(count || 0), 0);
    await replyToTelegram(
      chatId,
      `تم تحديث ${result.dataset.label?.ar || result.dataset.source}: ${result.dataset.summary?.rows ?? 0} سجل. ملاحظات المطابقة: ${issues}.`
    );
    res.json({ ok: true, source: result.dataset.source, summary: result.dataset.summary });
  } catch (error) {
    await create('hrImportRuns', {
      organizationId,
      source: 'unknown',
      fileName: String(message.document.file_name || ''),
      importedBy: null,
      origin: 'telegram',
      status: 'failed',
      error: error?.code ?? 'server_error',
    });
    await replyToTelegram(chatId, `تعذّر تحديث الملف: ${error?.code ?? 'server_error'}`);
    // A bad workbook is recorded and acknowledged so Telegram does not keep
    // redelivering the same document forever.
    res.json({ ok: false, error: error?.code ?? 'server_error' });
  }
});

router.use(requireAuth);

router.get('/dashboard', async (req, res) => {
  try {
    res.json(await hrDashboardFor(req.user));
  } catch (error) {
    fail(res, error);
  }
});

router.get('/employees/:employeeCode', async (req, res) => {
  try {
    res.json({ employee: await hrEmployeeFor(req.user, req.params.employeeCode) });
  } catch (error) {
    // Someone Odoo has and the HR file does not still opens, for HR viewers.
    if (error?.code === 'hr_employee_not_found') {
      try {
        const employee = await odooOnlyProfile(req.user, req.params.employeeCode);
        if (employee) return res.json({ employee });
      } catch (fallbackError) {
        return fail(res, fallbackError);
      }
    }
    fail(res, error);
  }
});

router.get('/employees/:employeeCode/odoo', h((req) => employeeOdoo(req.user, req.params.employeeCode)));

router.get('/imports', requirePermission(PERMISSIONS.HR_MANAGE), async (req, res) => {
  try {
    res.json({ runs: await hrImportHistory(organizationOf(req.user), req.query.limit) });
  } catch (error) {
    fail(res, error);
  }
});

router.post(
  '/imports/:source',
  requirePermission(PERMISSIONS.HR_MANAGE),
  uploadBody,
  async (req, res) => {
    try {
      const result = await importHRDataset({
        bytes: req.body,
        fileName: decodedFileName(req.headers['x-file-name']),
        requestedSource: req.params.source,
        organizationId: organizationOf(req.user),
        actorId: req.user.id,
        origin: 'dashboard',
      });
      await logActivity({
        actorId: req.user.id,
        action: 'hr.import',
        subject: 'hrDataset',
        subjectId: result.dataset.source,
        meta: { fileName: result.dataset.fileName, summary: result.dataset.summary },
      });
      res.json(result);
    } catch (error) {
      fail(res, error);
    }
  }
);

router.patch('/employees/:employeeCode/:section', requirePermission(PERMISSIONS.HR_MANAGE), async (req, res) => {
  try {
    if (['payroll', 'insurance', 'bank'].includes(req.params.section) && !can(req.user, PERMISSIONS.HR_PAYROLL)) {
      return res.status(403).json({ error: 'forbidden', missing: PERMISSIONS.HR_PAYROLL });
    }
    const employee = await updateHREmployee({
      organizationId: organizationOf(req.user),
      employeeCode: req.params.employeeCode,
      section: req.params.section,
      patch: req.body,
      actorId: req.user.id,
    });
    await logActivity({
      actorId: req.user.id,
      action: 'hr.employee.update',
      subject: 'hrEmployee',
      subjectId: req.params.employeeCode,
      meta: { section: req.params.section, fields: Object.keys(req.body ?? {}) },
    });
    res.json({ employee });
  } catch (error) {
    fail(res, error);
  }
});

router.put('/employees/:employeeCode/link', requirePermission(PERMISSIONS.HR_MANAGE), async (req, res) => {
  try {
    const link = await linkHREmployee({
      organizationId: organizationOf(req.user),
      employeeCode: req.params.employeeCode,
      userId: req.body?.userId ? String(req.body.userId) : null,
      actorId: req.user.id,
    });
    await logActivity({
      actorId: req.user.id,
      action: 'hr.employee.link',
      subject: 'hrEmployee',
      subjectId: req.params.employeeCode,
      meta: { userId: link.userId },
    });
    res.json({ link });
  } catch (error) {
    fail(res, error);
  }
});

/* ── HR V2 ─────────────────────────────────────────────────────── */

router.get('/access', h(async (req) => ({ access: await hrAccess(req.user) })));
router.get('/overview', h((req) => hrHome(req.user)));
router.get('/people', h((req) => peopleDirectory(req.user)));

/**
 * A real employee photo, read from Odoo `hr.employee.image_128` and never a
 * generated placeholder. Anyone who may see the person's HR record may see
 * their photo; a missing photo is a 404 and the page shows initials instead.
 */
router.get('/people/:employeeCode/photo', async (req, res) => {
  try {
    const user = req.user;
    const state = await organizationState(organizationOf(user));
    const profile = state.profiles.get(String(req.params.employeeCode)) ?? null;
    const staff = can(user, PERMISSIONS.HR_VIEW)
      || can(user, PERMISSIONS.HR_RECRUITMENT_VIEW)
      || can(user, PERMISSIONS.HR_RECRUITMENT_ASSIGN)
      || can(user, PERMISSIONS.HR_RECRUITMENT_APPROVE)
      || can(user, PERMISSIONS.HR_PERSONNEL_VIEW);
    if (!staff && !(profile && profile.linkedUserId === user.id)) return res.status(403).end();
    const index = await odooEmployeeIndex({ timeoutMs: 8000 });
    // The HR file's person first; someone only Odoo has, by `o<id>` or their Odoo code.
    const odoo = profile ? odooEmployeeFor(profile, index) : odooEmployeeByKey(req.params.employeeCode, index);
    if (!odoo) return res.status(404).end();
    const photo = await odooPhoto(odoo.id, { size: req.query.size === '512' ? 512 : 128 });
    if (!photo) return res.status(404).end();
    res.setHeader('Content-Type', photo.type);
    res.setHeader('Cache-Control', 'private, max-age=3600');
    res.setHeader('Content-Disposition', 'inline');
    res.send(photo.bytes);
  } catch (error) {
    console.warn('[hr] photo unavailable:', error?.message ?? error);
    res.status(404).end();
  }
});

router.get('/payroll', h((req) => payrollOverview(req.user)));
router.get('/organization', h((req) => organizationOverview(req.user)));

router.get('/performance', h((req) => performanceOverview(req.user, { period: req.query.period, quarter: req.query.quarter })));
router.get('/performance/reviews/:employeeCode/:quarter', h((req) => reviewFor(req.user, req.params.employeeCode, req.params.quarter)));
router.put('/performance/reviews/:employeeCode/:quarter', h((req) => saveReview(req.user, req.params.employeeCode, req.params.quarter, req.body ?? {})));

router.get('/reports', h((req) => ({ reports: reportsFor(req.user) })));
router.get('/reports/:id', h((req) => buildReport(req.user, req.params.id, req.query)));

router.get('/settings', h((req) => settingsView(req.user)));
// Policy changes land in the audit trail with who made them and what they touched.
router.patch('/settings', h(async (req) => {
  const result = await saveSettings(req.user, { patch: req.body?.patch, revision: req.body?.revision });
  await logActivity({ actorId: req.user.id, action: 'hr.settings.update', subject: 'hrSettings', subjectId: `r${result.revision}`, meta: { sections: Object.keys(req.body?.patch ?? {}), revision: result.revision } });
  return result;
}));
router.post('/settings/reward-rules', h(async (req, res) => {
  const rules = await saveRewardRules(req.user, req.body ?? {});
  await logActivity({ actorId: req.user.id, action: 'hr.rewards.rules', subject: 'recruitmentRewardRules', subjectId: `v${rules.version}`, meta: { version: rules.version, note: rules.note } });
  res.status(201).json({ rules });
}));
router.post('/settings/migration', requirePermission(PERMISSIONS.HR_SETTINGS_MANAGE), h(async (req) => {
  const migration = await migrateLegacyRecruitment(organizationOf(req.user));
  await logActivity({ actorId: req.user.id, action: 'hr.recruitment.migration', subject: 'recruitmentRequests', subjectId: 'legacy_workbook', meta: migration });
  return { migration };
}));
router.get('/settings/reconciliation', h((req) => reconciliationView(req.user)));
router.get('/settings/audit', h((req) => auditLog(req.user, { limit: req.query.limit })));

router.get('/personnel', h((req) => listPersonnel(req.user, { type: req.query.type, status: req.query.status })));
router.post('/personnel', h(async (req, res) => {
  res.status(201).json(await createPersonnelCase(req.user, req.body ?? {}));
}));
router.get('/personnel/leave', h((req) => leaveOverview(req.user)));
router.get('/personnel/:id', h((req) => personnelCase(req.user, req.params.id)));
router.patch('/personnel/:id', h((req) => updatePersonnelCase(req.user, req.params.id, req.body ?? {})));
router.post('/personnel/:id/checklist/:itemId', h((req) => tickChecklist(req.user, req.params.id, req.params.itemId, { done: req.body?.done === true })));
router.post('/personnel/:id/form', h((req) => createFormLink(req.user, req.params.id)));

router.use('/recruitment', recruitmentRoutes);

export default router;
