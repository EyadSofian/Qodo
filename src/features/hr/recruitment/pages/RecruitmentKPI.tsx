/**
 * /hr/recruitment/kpi — the 30 / 30 / 20 / 20 scorecard for each recruiter,
 * one month at a time, every number one click from its evidence.
 */

import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { ClipboardList } from 'lucide-react';
import { cx } from '../../../../lib/utils';
import { hrApi, invalidateHR, useHRQuery } from '../../api';
import { currentPeriod, monthLabel, num, shiftPeriod, shortName, useHRText } from '../../format';
import type { KpiOverviewData } from '../../types';
import { Card, PageHeader, PersonAvatar, SectionTitle } from '../../ui/primitives';
import { EmptyBlock, ErrorBlock, PageSkeleton } from '../../ui/states';
import { Stepper } from '../../ui/Stepper';
import { DeductionDialog, KPIBar, RuleList, WhyScoreDrawer, scoreTone } from '../components/KPIScore';

export function RecruitmentKPI() {
  const { t, lang, pick } = useHRText();
  const [params, setParams] = useSearchParams();
  const period = /^\d{4}-\d{2}$/.test(params.get('period') ?? '') ? params.get('period')! : currentPeriod();
  const focus = params.get('recruiter');
  const { data, error, loading, reload } = useHRQuery<KpiOverviewData>(hrApi.recruitment.kpi(period));
  const [recording, setRecording] = useState<string | null>(null);

  const setParam = (key: string, value: string | null) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    setParams(next, { replace: key === 'recruiter' ? false : true });
  };

  if (error && !data) return <ErrorBlock error={error} onRetry={reload} />;
  if (loading && !data) return <PageSkeleton rows={2} />;
  if (!data) return null;
  const isCurrent = period >= currentPeriod();

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow={t('التوظيف', 'Recruitment')}
        title={t('مؤشرات أداء التوظيف', 'Recruitment KPI')}
        description={t('100 نقطة: جودة المراجعة 30، هدف التعيين والـSLA 30، الالتزام 20، جودة النظام 20. كل مخالفة تخصم نقاطها داخل محورها فقط.', '100 points: HR review 30, hiring target & SLA 30, commitment 20, system quality 20. Each violation deducts its own points inside its category.')}
        actions={
          <Stepper label={monthLabel(period, lang)} onPrev={() => setParam('period', shiftPeriod(period, -1))} onNext={() => setParam('period', shiftPeriod(period, 1))} nextDisabled={isCurrent} prevLabel={t('الشهر السابق', 'Previous month')} nextLabel={t('الشهر التالي', 'Next month')} />
        }
      />

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        {data.recruiters.map((row) => {
          const name = shortName(row.member.shortName, lang);
          return (
            <Card key={row.member.employeeCode} className={cx(focus === row.member.employeeCode && 'ring-2 ring-brand-300')}>
              <div className="flex items-center gap-3">
                <PersonAvatar name={name} photoUrl={row.member.photoUrl} size={44} />
                <div className="min-w-0 flex-1">
                  <p className="hr-bidi truncate text-[14px] font-bold text-navy">{name}</p>
                  <p className="truncate text-[12px] text-[#5A6C82]">{row.member.title}</p>
                </div>
                <div className="text-end">
                  <p className={cx('text-[26px] font-bold tabular-nums leading-7', scoreTone(row.percent))}>{row.percent === null ? '—' : `${num(row.percent, lang, 1)}%`}</p>
                  {!row.complete && <p className="text-[10.5px] text-ink-faint">{t('محور غير محتسب', 'partly measured')}</p>}
                </div>
              </div>
              <div className="mt-4"><KPIBar categories={row.categories} /></div>
              <dl className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
                {row.categories.map((category) => {
                  const meta = data.categories.find((item) => item.id === category.id);
                  return (
                    <div key={category.id} className="rounded-xl bg-[#F6F8FB] px-2.5 py-2">
                      <dt className="truncate text-[10.5px] font-semibold text-[#5A6C82]" title={meta ? pick(meta) : category.id}>{meta ? pick(meta) : category.id}</dt>
                      <dd className="mt-0.5 text-[14px] font-bold tabular-nums text-navy">{category.measured ? num(category.score, lang, 1) : '—'}<span className="text-[11px] font-semibold text-ink-faint"> / {category.weight}</span></dd>
                      {category.deductions > 0 && <dd className="text-[10.5px] font-semibold text-red-700">{t(`${category.deductions} خصم`, `${category.deductions} deductions`)}</dd>}
                    </div>
                  );
                })}
              </dl>
              <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-[#EEF2F7] pt-3">
                <button type="button" className="btn-ghost btn-sm" onClick={() => setParam('recruiter', row.member.employeeCode)}>{t('لماذا هذه النتيجة؟', 'Why this score?')}</button>
                {data.canReview && <button type="button" className="btn-quiet btn-sm" onClick={() => setRecording(row.member.employeeCode)}><ClipboardList size={14} />{t('تسجيل خصم', 'Record deduction')}</button>}
              </div>
            </Card>
          );
        })}
      </div>
      {!data.recruiters.length && <EmptyBlock title={t('لا يوجد فريق توظيف بعد', 'No recruitment team yet')} />}

      <Card>
        <SectionTitle title={t('قواعد الخصم المفعلة', 'Deduction rules in force')} hint={t('النقاط قابلة للتعديل من إعدادات HR. القواعد التلقائية يرفعها النظام من البيانات مرة واحدة لكل واقعة.', 'Points are configurable in HR Settings. Automatic rules are raised from data, once per finding.')} />
        <RuleList rules={data.rules} />
      </Card>

      <WhyScoreDrawer employeeCode={focus} period={period} onClose={() => setParam('recruiter', null)} onRecord={focus ? () => setRecording(focus) : undefined} />
      {recording && (
        <DeductionDialog
          employeeCode={recording}
          rules={data.rules}
          onClose={() => setRecording(null)}
          onDone={() => {
            setRecording(null);
            invalidateHR('/hr/recruitment');
          }}
        />
      )}
    </div>
  );
}

export default RecruitmentKPI;
