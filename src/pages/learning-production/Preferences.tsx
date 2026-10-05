/**
 * Notification settings — which events reach the reader and how often
 * reminders repeat. Opened from the module menu.
 */

import { useState } from 'react';
import { useI18n, type StringKey } from '../../lib/i18n';
import { useLpQuery } from '../../lib/learningProduction/hooks';
import { runPaths, runsApi } from '../../lib/learningProduction/runApi';
import { lpErrorKey } from '../../lib/learningProduction/format';
import type { NotificationPreferences } from '../../lib/learningProduction/runTypes';
import { useToast } from '../../components/ui';
import { Busy, Drawer, LoadingRows } from '../../components/learning-production/studio';

export function Preferences({ onClose }: { onClose: () => void }) {
  const { t } = useI18n();
  const toast = useToast();
  const { data, setData } = useLpQuery<NotificationPreferences>(runPaths.preferences);
  const [busy, setBusy] = useState(false);
  const prefs = data?.preferences;

  async function save(patch: Partial<NotificationPreferences['preferences']>) {
    setBusy(true);
    try {
      setData(await runsApi.savePreferences(patch));
    } catch (failure) {
      toast.push(t(lpErrorKey(failure)), 'bad');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Drawer open onClose={onClose} title={t('lp.prefs.title')} subtitle={<span className="text-[12.5px] lps-muted">{t('lp.prefs.lede')}</span>}>
      {!prefs || !data ? (
        <LoadingRows rows={4} />
      ) : (
        <div className="space-y-5">
          <fieldset>
            <legend className="lps-eyebrow mb-2">{t('lp.prefs.kinds')}</legend>
            <ul className="lps-panel divide-y" style={{ borderColor: 'var(--lps-line)' }}>
              {data.events.map((event) => {
                const muted = prefs.mutedEvents.includes(event);
                return (
                  <li key={event} className="flex items-center justify-between gap-3 px-3 py-2.5" style={{ borderColor: 'var(--lps-line)' }}>
                    <span className="text-[13px]">
                      {t(`lp.prefs.event.${event}` as StringKey)}
                      <span className="block text-[12px] lps-muted">{t(`lp.prefs.eventHint.${event}` as StringKey)}</span>
                    </span>
                    <label className="flex shrink-0 items-center gap-2 text-[12.5px]">
                      <input
                        type="checkbox"
                        checked={!muted}
                        disabled={busy}
                        onChange={() => save({ mutedEvents: muted ? prefs.mutedEvents.filter((entry) => entry !== event) : [...prefs.mutedEvents, event] })}
                      />
                      {muted ? t('lp.prefs.off') : t('lp.prefs.on')}
                    </label>
                  </li>
                );
              })}
            </ul>
          </fieldset>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <label className="block">
              <span className="lps-label">{t('lp.prefs.dueSoon')}</span>
              <select className="lps-input" value={prefs.dueSoonDays} disabled={busy} onChange={(event) => save({ dueSoonDays: Number(event.target.value) })}>
                {[0, 1, 2, 3, 5, 7].map((days) => (
                  <option key={days} value={days}>
                    {days === 0 ? t('lp.prefs.never') : t('lp.prefs.days', { n: days })}
                  </option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="lps-label">{t('lp.prefs.overdueRepeat')}</span>
              <select className="lps-input" value={prefs.overdueRepeatDays} disabled={busy} onChange={(event) => save({ overdueRepeatDays: Number(event.target.value) })}>
                {[0, 1, 3, 7].map((days) => (
                  <option key={days} value={days}>
                    {days === 0 ? t('lp.prefs.once') : t('lp.prefs.everyDays', { n: days })}
                  </option>
                ))}
              </select>
            </label>
          </div>
          {busy && <Busy />}
        </div>
      )}
    </Drawer>
  );
}
