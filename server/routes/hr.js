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
  updateHREmployee,
  updateRecruitmentRequest,
} from '../hrModule.js';
import { HRWorkbookError, MAX_HR_WORKBOOK_BYTES } from '../hrWorkbook.js';

const router = Router();
const uploadBody = express.raw({ type: () => true, limit: MAX_HR_WORKBOOK_BYTES });

function fail(res, error) {
  if (error instanceof HRWorkbookError) {
    return res.status(error.status).json({ error: error.code, details: error.details ?? undefined });
  }
  if (error?.type === 'entity.too.large') return res.status(413).json({ error: 'hr_file_too_large' });
  console.error('[hr]', error);
  return res.status(500).json({ error: 'server_error' });
}

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
    fail(res, error);
  }
});

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

router.patch('/recruitment/:requestId', requirePermission(PERMISSIONS.HR_MANAGE), async (req, res) => {
  try {
    const request = await updateRecruitmentRequest({
      organizationId: organizationOf(req.user),
      requestId: req.params.requestId,
      patch: req.body,
      actorId: req.user.id,
    });
    await logActivity({
      actorId: req.user.id,
      action: 'hr.recruitment.update',
      subject: 'hrRecruitment',
      subjectId: req.params.requestId,
      meta: { fields: Object.keys(req.body ?? {}) },
    });
    res.json({ request });
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

export default router;
