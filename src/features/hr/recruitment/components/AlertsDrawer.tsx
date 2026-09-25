/**
 * The alert centre. Every live recruitment alert, most severe first; each
 * row goes straight to the job or recruiter it is about.
 */

import { useNavigate } from 'react-router-dom';
import { BellOff, ChevronRight } from 'lucide-react';
import { cx } from '../../../../lib/utils';
import { useHRText } from '../../format';
import { SEVERITY_LABEL } from '../../labels';
import { useHR } from '../../shell/HRContext';
import { Drawer } from '../../ui/Drawer';
import { EmptyBlock } from '../../ui/states';
import { SEVERITY_TONE, TONE } from '../../ui/tones';
import type { Severity } from '../../types';
import { SEVERITY_ICON, alertActionLabel, alertActionTarget } from './RecruitmentAlert';

export function AlertsDrawer() {
  const { alertCenter } = useHR();
  const { t, pick } = useHRText();
  const navigate = useNavigate();
  const groups = (['critical', 'warning', 'info', 'success'] as Severity[])
    .map((severity) => ({ severity, alerts: alertCenter.alerts.filter((alert) => alert.severity === severity) }))
    .filter((group) => group.alerts.length);

  const go = (to: string) => {
    alertCenter.closeDrawer();
    navigate(to);
  };

  return (
    <Drawer
      open={alertCenter.drawerOpen}
      onClose={alertCenter.closeDrawer}
      title={t('تنبيهات التوظيف', 'Recruitment alerts')}
      subtitle={t('تبقى هنا حتى تُحل المشكلة نفسها.', 'Each stays here until the problem behind it is resolved.')}
      footer={alertCenter.alerts.length > 0 ? <button type="button" className="btn-ghost btn-sm" onClick={alertCenter.markAllSeen}>{t('تعليم الكل كمقروء', 'Mark all as seen')}</button> : undefined}
    >
      {groups.length === 0 ? (
        <EmptyBlock icon={<BellOff size={24} />} title={t('لا توجد تنبيهات', 'No alerts')} body={t('كل الوظائف ضمن مهلها والسعة في حدودها.', 'Every job is inside its SLA and every recruiter inside capacity.')} />
      ) : (
        <div className="space-y-5">
          {groups.map((group) => (
            <section key={group.severity} aria-label={pick(SEVERITY_LABEL[group.severity])}>
              <h3 className={cx('mb-2 flex items-center gap-2 text-[12px] font-bold', TONE[SEVERITY_TONE[group.severity]].text)}>
                <span className={cx('h-1.5 w-1.5 rounded-full', TONE[SEVERITY_TONE[group.severity]].dot)} aria-hidden="true" />
                {pick(SEVERITY_LABEL[group.severity])} · {group.alerts.length}
              </h3>
              <ul className="space-y-2">
                {group.alerts.map((alert) => {
                  const Icon = SEVERITY_ICON[alert.severity];
                  const tone = SEVERITY_TONE[alert.severity];
                  const fresh = alertCenter.unseen.has(alert.id);
                  return (
                    <li key={alert.id} className="rounded-xl border border-[#E6ECF3] bg-white">
                      <button type="button" className="flex w-full items-start gap-3 p-3 text-start hover:bg-[#F7FAFD]" onClick={() => go(alert.link)}>
                        <span className={cx('mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-lg', TONE[tone].bg, TONE[tone].text)}>
                          <Icon size={16} aria-hidden="true" />
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="flex items-center gap-2">
                            <span className="text-[13px] font-bold text-navy">{pick(alert.title)}</span>
                            {fresh && <span className="rounded-full bg-brand-50 px-1.5 text-[10px] font-bold text-brand-700">{t('جديد', 'New')}</span>}
                          </span>
                          <span className="mt-0.5 block text-[12.5px] leading-5 text-[#5A6C82]">{pick(alert.body)}</span>
                        </span>
                        <ChevronRight size={16} className="mt-2 shrink-0 text-ink-faint rtl:rotate-180" aria-hidden="true" />
                      </button>
                      {alert.actions.length > 1 && (
                        <div className="flex flex-wrap gap-2 border-t border-[#EEF2F7] px-3 py-2">
                          {alert.actions.slice(0, 2).map((action) => (
                            <button key={action} type="button" className="text-[12px] font-semibold text-brand-600 hover:underline" onClick={() => go(alertActionTarget(alert, action))}>
                              {alertActionLabel(action, t)}
                            </button>
                          ))}
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}
        </div>
      )}
    </Drawer>
  );
}
