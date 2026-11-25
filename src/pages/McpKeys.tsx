/**
 * Settings → MCP keys.
 *
 * One key per person or agent that connects to the workspace MCP endpoint,
 * each limited to the dashboards and sections it needs, optionally expiring,
 * and revocable at once. The key is shown a single time, when it is created.
 */
import { useCallback, useEffect, useState } from 'react';
import { Copy, KeyRound, Plus, ShieldOff } from 'lucide-react';
import { api, errorMessage } from '../lib/api';
import { useI18n } from '../lib/i18n';
import { EmptyState, Field, Modal, Spinner, useToast } from '../components/ui';
import { cx, timeAgo } from '../lib/utils';

type App = 'qodo' | 'insights' | 'pulse';
type Section = { id: string; ar: string; en: string };
type Scopes = Partial<Record<App, string[] | null>> & { actions?: boolean };
type McpKey = {
  id: string;
  name: string;
  hint: string;
  scopes: Scopes;
  expiresAt: string | null;
  revokedAt: string | null;
  createdAt: string;
  lastUsedAt: string | null;
  lastUsedIp: string | null;
  status: 'active' | 'revoked' | 'expired';
};
type Listing = { keys: McpKey[]; sections: Record<App, Section[]>; masterConfigured: boolean; endpoint: string };

const APPS: { id: App; ar: string; en: string }[] = [
  { id: 'qodo', ar: 'Qodo', en: 'Qodo' },
  { id: 'insights', ar: 'Insights Hub', en: 'Insights Hub' },
  { id: 'pulse', ar: 'مبدع', en: 'Mobde3' },
];

type Choice = 'none' | 'all' | 'some';

export function McpKeys() {
  const { lang, t } = useI18n();
  const L = (ar: string, en: string) => (lang === 'en' ? en : ar);
  const { push } = useToast();
  const [data, setData] = useState<Listing | null>(null);
  const [open, setOpen] = useState(false);
  const [created, setCreated] = useState<{ token: string; name: string } | null>(null);

  const load = useCallback(async () => setData(await api.get<Listing>('/mcp-keys')), []);
  useEffect(() => {
    load().catch((error) => push(errorMessage(error, lang), 'bad'));
  }, [load, push]);

  const revoke = async (key: McpKey) => {
    if (!window.confirm(L(`إلغاء مفتاح «${key.name}»؟ هيتوقف فوراً ومش هيرجع.`, `Revoke “${key.name}”? It stops at once and cannot be restored.`))) return;
    try {
      await api.post(`/mcp-keys/${key.id}/revoke`, {});
      push(L('اتلغى المفتاح', 'Key revoked'));
      await load();
    } catch (error) {
      push(errorMessage(error, lang), 'bad');
    }
  };

  const describe = (scopes: Scopes) =>
    APPS.filter((app) => scopes[app.id] !== undefined)
      .map((app) => {
        const value = scopes[app.id];
        if (value === null) return `${L(app.ar, app.en)}: ${L('كله', 'all')}`;
        const names = (value ?? []).map((id: string) => {
          const section = data?.sections[app.id]?.find((s) => s.id === id);
          return section ? L(section.ar, section.en) : id;
        });
        return `${L(app.ar, app.en)}: ${names.join('، ')}`;
      })
      .concat(scopes.actions ? [L('مسموح بالأكشنز', 'actions allowed')] : [L('قراية بس', 'read only')]);

  if (!data) return <div className="skeleton h-64 rounded-2xl" />;

  return (
    <div className="space-y-4">
      <div className="card flex flex-wrap items-start justify-between gap-3 p-4">
        <div className="min-w-0">
          <p className="text-[13.5px] font-bold text-ink">{L('مفاتيح الـ MCP', 'MCP keys')}</p>
          <p className="mt-1 text-[12.5px] text-ink-muted">
            {L(
              'مفتاح لكل شخص أو إيجنت، بصلاحيات محددة. اللي معاه المفتاح يشوف بس الداشبوردات والأقسام اللي اخترتها، وتقدر تلغيه في أي وقت.',
              'One key per person or agent, limited to the dashboards and sections you choose, revocable at any time.'
            )}
          </p>
          <p className="mt-2 text-[12px] text-ink-faint" dir="ltr">{data.endpoint}</p>
          {data.masterConfigured && (
            <p className="mt-2 text-[12px] text-ink-muted">
              {L(
                'المفتاح الرئيسي NOD_MCP_TOKEN (من Railway) لسه شغال وبيفتح كل حاجة. يتلغي بتغييره في Railway.',
                'The master key NOD_MCP_TOKEN (Railway) still works with full access; rotate it in Railway to stop it.'
              )}
            </p>
          )}
        </div>
        <button type="button" className="btn-primary btn-sm gap-1.5" onClick={() => setOpen(true)}>
          <Plus size={15} /> {L('مفتاح جديد', 'New key')}
        </button>
      </div>

      {data.keys.length === 0 ? (
        <div className="card">
          <EmptyState icon={<KeyRound size={26} />} title={L('مفيش مفاتيح لسه', 'No keys yet')} />
        </div>
      ) : (
        <ul className="card divide-y divide-surface-line">
          {data.keys.map((key) => (
            <li key={key.id} className="flex flex-wrap items-start gap-3 px-4 py-3">
              <div className="min-w-0 flex-1">
                <p className="text-[13px] font-bold text-ink">
                  {key.name}{' '}
                  <span
                    className={cx(
                      'ms-1 rounded-full px-2 py-0.5 text-[10.5px] font-bold',
                      key.status === 'active' ? 'bg-status-goodBg text-status-good' : 'bg-status-badBg text-status-bad'
                    )}
                  >
                    {key.status === 'active' ? L('شغال', 'active') : key.status === 'revoked' ? L('ملغي', 'revoked') : L('انتهى', 'expired')}
                  </span>
                </p>
                <p className="mt-0.5 text-[12px] text-ink-muted">{describe(key.scopes).join(' · ')}</p>
                <p className="mt-0.5 text-[11.5px] text-ink-faint">
                  <span dir="ltr">{key.hint}</span>
                  {' · '}
                  {L('اتعمل', 'created')} {timeAgo(key.createdAt, t)}
                  {' · '}
                  {key.lastUsedAt ? `${L('آخر استخدام', 'last used')} ${timeAgo(key.lastUsedAt, t)}` : L('ما استُخدمش لسه', 'never used')}
                  {key.lastUsedIp ? ` · ${key.lastUsedIp}` : ''}
                  {key.expiresAt && key.status === 'active' ? ` · ${L('ينتهي', 'expires')} ${key.expiresAt.slice(0, 10)}` : ''}
                </p>
              </div>
              {key.status === 'active' && (
                <button
                  type="button"
                  className="btn-quiet !min-h-9 gap-1.5 rounded-lg px-2 text-status-bad hover:bg-status-badBg"
                  onClick={() => revoke(key)}
                >
                  <ShieldOff size={15} /> {L('إلغاء', 'Revoke')}
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      <CreateKey
        open={open}
        sections={data.sections}
        onClose={() => setOpen(false)}
        onCreated={async (token, name) => {
          setOpen(false);
          setCreated({ token, name });
          await load();
        }}
      />

      <Modal
        open={Boolean(created)}
        onClose={() => setCreated(null)}
        title={L('انسخ المفتاح دلوقتي', 'Copy the key now')}
        footer={
          <button type="button" className="btn-primary btn-sm" onClick={() => setCreated(null)}>
            {L('نسخته', 'I copied it')}
          </button>
        }
      >
        {created && (
          <div className="space-y-3">
            <p className="text-[12.5px] text-ink-muted">
              {L(
                `ده مفتاح «${created.name}». مش هيظهر تاني، فانسخه وابعته بطريقة آمنة.`,
                `This is the key for “${created.name}”. It will not be shown again; copy it and send it securely.`
              )}
            </p>
            <Copyable label="URL" value={data.endpoint} />
            <Copyable label="Authorization" value={`Bearer ${created.token}`} />
          </div>
        )}
      </Modal>
    </div>
  );
}

function Copyable({ label, value }: { label: string; value: string }) {
  const { push } = useToast();
  return (
    <div>
      <p className="mb-1 text-[11.5px] font-bold text-ink-muted">{label}</p>
      <div className="flex items-center gap-2">
        <code className="min-w-0 flex-1 break-all rounded-lg bg-surface-sunken px-3 py-2 text-[12px]" dir="ltr">
          {value}
        </code>
        <button
          type="button"
          className="btn-quiet !min-h-9 rounded-lg px-2"
          onClick={() => navigator.clipboard.writeText(value).then(() => push('Copied'))}
          aria-label="Copy"
        >
          <Copy size={15} />
        </button>
      </div>
    </div>
  );
}

function CreateKey({
  open,
  sections,
  onClose,
  onCreated,
}: {
  open: boolean;
  sections: Record<App, Section[]>;
  onClose: () => void;
  onCreated: (token: string, name: string) => void;
}) {
  const { lang } = useI18n();
  const L = (ar: string, en: string) => (lang === 'en' ? en : ar);
  const { push } = useToast();
  const [name, setName] = useState('');
  const [choice, setChoice] = useState<Record<App, Choice>>({ qodo: 'none', insights: 'none', pulse: 'none' });
  const [picked, setPicked] = useState<Record<App, string[]>>({ qodo: [], insights: [], pulse: [] });
  const [actions, setActions] = useState(false);
  const [days, setDays] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setName('');
    setChoice({ qodo: 'none', insights: 'none', pulse: 'none' });
    setPicked({ qodo: [], insights: [], pulse: [] });
    setActions(false);
    setDays('');
  }, [open]);

  const scopes = (): Scopes => {
    const out: Scopes = { actions };
    for (const app of APPS) {
      if (choice[app.id] === 'all') out[app.id] = null;
      else if (choice[app.id] === 'some' && picked[app.id].length) out[app.id] = picked[app.id];
    }
    return out;
  };
  const anyApp = APPS.some((app) => scopes()[app.id] !== undefined);

  const submit = async () => {
    setBusy(true);
    try {
      const result = await api.post<{ token: string; key: { name: string } }>('/mcp-keys', {
        name,
        scopes: scopes(),
        expiresInDays: days ? Number(days) : null,
      });
      onCreated(result.token, result.key.name);
    } catch (error) {
      push(errorMessage(error, lang), 'bad');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      width="lg"
      title={L('مفتاح MCP جديد', 'New MCP key')}
      footer={
        <>
          <button type="button" className="btn-ghost btn-sm" onClick={onClose}>
            {L('إلغاء', 'Cancel')}
          </button>
          <button type="button" className="btn-primary btn-sm" disabled={busy || !name.trim() || !anyApp} onClick={submit}>
            {busy ? <Spinner /> : L('اعمل المفتاح', 'Create key')}
          </button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label={L('اسم الشخص أو الإيجنت', 'Person or agent')} required>
          <input className="field" value={name} maxLength={80} onChange={(e) => setName(e.target.value)} placeholder={L('مثلاً: أحمد - انستك', 'e.g. Ahmed - Instinct')} />
        </Field>

        {APPS.map((app) => (
          <div key={app.id} className="rounded-xl border border-surface-line p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-[13px] font-bold text-ink">{L(app.ar, app.en)}</p>
              <div className="flex gap-1">
                {(['none', 'all', 'some'] as Choice[]).map((value) => (
                  <button
                    key={value}
                    type="button"
                    onClick={() => setChoice((current) => ({ ...current, [app.id]: value }))}
                    className={cx(
                      'rounded-full px-3 py-1 text-[11.5px] font-bold',
                      choice[app.id] === value ? 'bg-brand-500 text-white' : 'bg-surface-sunken text-ink-muted'
                    )}
                  >
                    {value === 'none' ? L('ممنوع', 'None') : value === 'all' ? L('كله', 'All') : L('أقسام معينة', 'Some sections')}
                  </button>
                ))}
              </div>
            </div>
            {choice[app.id] === 'some' && (
              <div className="mt-2 grid gap-1.5 sm:grid-cols-2">
                {sections[app.id].map((section) => (
                  <label key={section.id} className="flex items-start gap-2 text-[12.5px] text-ink">
                    <input
                      type="checkbox"
                      className="mt-0.5"
                      checked={picked[app.id].includes(section.id)}
                      onChange={(e) =>
                        setPicked((current) => ({
                          ...current,
                          [app.id]: e.target.checked
                            ? [...current[app.id], section.id]
                            : current[app.id].filter((id) => id !== section.id),
                        }))
                      }
                    />
                    <span>{L(section.ar, section.en)}</span>
                  </label>
                ))}
              </div>
            )}
          </div>
        ))}

        <label className="flex items-start gap-2 text-[12.5px] text-ink">
          <input type="checkbox" className="mt-0.5" checked={actions} onChange={(e) => setActions(e.target.checked)} />
          <span>
            {L(
              'مسموح بالأكشنز (إنشاء تاسك، draft في مبدع، refresh للداتا) جوه الأقسام اللي اخترتها',
              'Allow actions (create task, Mobde3 draft, data refresh) within the chosen sections'
            )}
          </span>
        </label>

        <Field label={L('ينتهي بعد', 'Expires after')}>
          <select className="field" value={days} onChange={(e) => setDays(e.target.value)}>
            <option value="">{L('ما ينتهيش', 'Never')}</option>
            <option value="7">{L('أسبوع', '7 days')}</option>
            <option value="30">{L('شهر', '30 days')}</option>
            <option value="90">{L('3 شهور', '90 days')}</option>
            <option value="365">{L('سنة', '1 year')}</option>
          </select>
        </Field>
      </div>
    </Modal>
  );
}
