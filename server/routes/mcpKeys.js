/**
 * Settings → MCP keys: create, list and revoke personal MCP keys.
 *
 * Admin only (settings.manage). The key is returned once, in the create
 * response, and never again. Creating and revoking are written to the activity
 * log beside the calls the key makes.
 */
import { Router } from 'express';
import { logActivity, requirePermission } from '../auth.js';
import { PERMISSIONS } from '../../shared/permissions.js';
import { organizationOf } from '../../shared/organization.js';
import { createKey, listKeys, revokeKey } from '../mcpKeys.js';
import { APPS, SECTIONS, cleanScopes, describeScopes } from '../mcpScopes.js';

const router = Router();
router.use(requirePermission(PERMISSIONS.SETTINGS_MANAGE));

const sectionCatalog = () =>
  Object.fromEntries(
    APPS.map((app) => [app, Object.entries(SECTIONS[app]).map(([id, section]) => ({ id, ar: section.ar, en: section.en }))])
  );

router.get('/', async (req, res) => {
  const org = organizationOf(req.user);
  res.json({
    keys: await listKeys(org),
    sections: sectionCatalog(),
    masterConfigured: Boolean(String(process.env.NOD_MCP_TOKEN || '').trim()),
    endpoint: `${String(process.env.PUBLIC_URL || '').replace(/\/+$/, '') || `${req.protocol}://${req.get('host')}`}/api/mcp`,
  });
});

router.post('/', async (req, res) => {
  const name = String(req.body?.name || '').trim();
  if (!name || name.length > 80) return res.status(400).json({ error: 'name_required' });
  const scopes = cleanScopes(req.body?.scopes);
  if (!APPS.some((app) => scopes[app] !== undefined)) return res.status(400).json({ error: 'scope_required' });
  const days = Number(req.body?.expiresInDays);
  if (req.body?.expiresInDays != null && req.body?.expiresInDays !== '' && (!Number.isInteger(days) || days < 1 || days > 730)) {
    return res.status(400).json({ error: 'invalid_expiry' });
  }
  const expiresAt = Number.isInteger(days) && days > 0 ? new Date(Date.now() + days * 86_400_000).toISOString() : null;
  const { key, token } = await createKey({
    name,
    scopes,
    expiresAt,
    createdBy: req.user.id,
    organizationId: organizationOf(req.user),
  });
  await logActivity({
    actorId: req.user.id,
    action: 'mcp.key.create',
    subject: 'mcpKey',
    subjectId: key.id,
    meta: { name: key.name, scopes: describeScopes(key.scopes, 'ar').join(' | '), expiresAt },
  });
  res.status(201).json({ key, token });
});

router.post('/:id/revoke', async (req, res) => {
  const key = await revokeKey(req.params.id, organizationOf(req.user), req.user.id);
  if (!key) return res.status(404).json({ error: 'not_found' });
  await logActivity({
    actorId: req.user.id,
    action: 'mcp.key.revoke',
    subject: 'mcpKey',
    subjectId: key.id,
    meta: { name: key.name },
  });
  res.json({ key });
});

export default router;
