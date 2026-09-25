/**
 * /hr/recruitment/requests/:id — everything about one job on one page.
 *
 * Qodo's half (request, approvals, owner, clock, extensions, KPI, rewards,
 * audit) and Odoo's half (the job's stages and candidates) side by side. The
 * actions shown are exactly the ones the server says this person may take
 * now; the server checks them again when pressed.
 */

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Link, useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import {
  ArrowLeft,
  ArrowRight,
  CalendarClock,
  CheckCircle2,
  CircleSlash,
  ClipboardCheck,
  Flag,
  Link2,
  Pause,
  Play,
  Send,
  ShieldCheck,
  UserPlus,
  Users,
} from 'lucide-react';
import { cx } from '../../../../lib/utils';
import { hrApi, invalidateHR, useHRQuery } from '../../api';
import { date, dateTime, money, num, shortName, useHRText, workingDays } from '../../format';
import { LOCATION_LABEL, REASON_LABEL, REWARD_REASON_LABEL, SLA_LABEL } from '../../labels';
import type { RequestDetailData, RequestPipeline } from '../../types';
import { useMotion } from '../../ui/motion';
import { Badge, Card, KeyValue, PersonAvatar, PriorityBadge, ProgressDots, SectionTitle, SlaMeter, StatusBadge } from '../../ui/primitives';
import { EmptyBlock, ErrorBlock, PageSkeleton } from '../../ui/states';
import { SLA_TONE, TONE } from '../../ui/tones';
import { ApprovalTimeline } from '../components/ApprovalTimeline';
import { OdooPipeline } from '../components/OdooPipeline';
import { AcceptedDialog, AssignDialog, CommentActionDialog, DecisionDialog, ExtendDialog, OdooLinkDialog, PriorityDialog } from '../components/dialogs';

type DialogName = 'assign' | 'priority' | 'extend' | 'review' | 'approve' | 'accepted' | 'odoo' | 'submit' | 'hold' | 'resume' | 'cancel' | null;

function Section({ id, title, hint, children, action }: { id: string; title: ReactNode; hint?: ReactNode; children: ReactNode; action?: ReactNode }) {
  return (
    <Card as="section" className="scroll-mt-28">
      <div id={id} className="scroll-mt-28" />
      <SectionTitle title={title} hint={hint} action={action} />
      {children}
    </Card>
  );
}

function Prose({ text }: { text: string }) {
  const { t } = useHRText();
  if (!text?.trim()) return <p className="text-[12.5px] text-ink-faint">{t('لم يُكتب.', 'Not written.')}</p>;
  return <p className="whitespace-pre-line text-[13px] leading-7 text-[#26384F]">{text}</p>;
}

function activityLabel(type: string, t: (ar: string, en: string) => string) {
  const map: Record<string, [string, string]> = {
    created: ['أُنشئ الطلب', 'Request created'],
    edited: ['عُدّل الطلب', 'Request edited'],
    assigned: ['أُسند المسؤول', 'Recruiter assigned'],
    unassigned: ['أُلغي الإسناد', 'Recruiter removed'],
    priority_changed: ['تغيّرت الأولوية', 'Priority changed'],
    extended: ['مُدّت المهلة', 'Deadline extended'],
    accepted_recorded: ['سُجل المقبولون', 'Accepted count recorded'],
    odoo_linked: ['رُبطت وظيفة Odoo', 'Odoo job linked'],
    odoo_unlinked: ['فُك ربط Odoo', 'Odoo job unlinked'],
    kpi_deduction: ['خصم مؤشر أداء', 'KPI deduction'],
    kpi_deduction_voided: ['أُلغي خصم', 'Deduction voided'],
    imported_from_workbook: ['استُورد من ملف التوظيف', 'Imported from the recruitment workbook'],
  };
  if (map[type]) return t(map[type][0], map[type][1]);
  if (type.startsWith('status.')) {
    const action = type.slice(7);
    const status: Record<string, [string, string]> = {
      submit: ['أُرسل للمراجعة', 'Submitted for review'],
      review_approve: ['وافق مدير القسم', 'Department approved'],
      review_return: ['أُعيد من مراجعة القسم', 'Returned by department'],
      review_reject: ['رُفض في مراجعة القسم', 'Rejected by department'],
      approve: ['اعتُمد نهائياً وبدأ الـSLA', 'Final approval — SLA started'],
      approve_return: ['أُعيد من الاعتماد النهائي', 'Returned at final approval'],
      approve_reject: ['رُفض في الاعتماد النهائي', 'Rejected at final approval'],
      hold: ['عُلّق', 'Put on hold'],
      resume: ['استُؤنف', 'Resumed'],
      cancel: ['أُلغي', 'Cancelled'],
    };
    return status[action] ? t(status[action][0], status[action][1]) : type;
  }
  return type;
}

export function JobRequestDetail() {
  const { id = '' } = useParams();
  const { t, lang, pick } = useHRText();
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams, setSearchParams] = useSearchParams();
  const motionPresets = useMotion();
  const { data, error, loading, reload, setData } = useHRQuery<RequestDetailData>(hrApi.recruitment.request(id));
  const pipelineQuery = useHRQuery<RequestPipeline>(data ? hrApi.recruitment.pipeline(id) : null);
  const [dialog, setDialog] = useState<DialogName>(null);
  const [celebrate, setCelebrate] = useState(false);
  const previousStatus = useRef<string | null>(null);

  // Alerts deep-link straight into an action: ?action=assign / extend.
  useEffect(() => {
    const action = searchParams.get('action');
    if (!data || !action) return;
    const abilities = data.request.abilities;
    if (action === 'assign' && abilities.assign) setDialog('assign');
    if (action === 'extend' && abilities.extend) setDialog('extend');
    const next = new URLSearchParams(searchParams);
    next.delete('action');
    setSearchParams(next, { replace: true });
  }, [data, searchParams, setSearchParams]);

  useEffect(() => {
    if (!data || location.hash !== '#odoo') return;
    window.requestAnimationFrame(() => {
      document.getElementById('pipeline')?.scrollIntoView({ behavior: motionPresets.reduce ? 'auto' : 'smooth', block: 'start' });
    });
  }, [data, location.hash, motionPresets.reduce]);

  useEffect(() => {
    const status = data?.request.status ?? null;
    if (previousStatus.current && previousStatus.current !== 'completed' && status === 'completed') setCelebrate(true);
    previousStatus.current = status;
  }, [data?.request.status]);

  if (error && !data) return <ErrorBlock error={error} onRetry={reload} />;
  if (loading && !data) return <PageSkeleton rows={2} />;
  if (!data) return null;

  const { request, context } = data;
  const abilities = request.abilities;
  const sla = request.slaSnapshot;
  const classification = context.policy.classifications.find((item) => item.id === request.classification);
  const done = (next: RequestDetailData) => {
    setData(next);
    setDialog(null);
    invalidateHR('/hr/recruitment');
  };
  const Back = lang === 'en' ? ArrowLeft : ArrowRight;
  const index = [
    ['overview', t('نظرة عامة', 'Overview')],
    ['sla', 'SLA'],
    ['approvals', t('الاعتمادات', 'Approvals')],
    ['recruiter', t('المسؤول', 'Recruiter')],
    ['pipeline', t('المسار والمرشحون', 'Pipeline & candidates')],
    ['documents', t('المستندات', 'Documents')],
    ...(data.performance ? [['kpi', t('أثر الأداء', 'KPI impact')], ['reward', t('المكافأة', 'Reward')]] : []),
    ['activity', t('النشاط', 'Activity')],
  ] as Array<[string, string]>;

  const actions: Array<{ key: DialogName; label: string; icon: typeof Send; primary?: boolean; danger?: boolean }> = [];
  if (abilities.submit) actions.push({ key: 'submit', label: t('إرسال للمراجعة', 'Submit'), icon: Send, primary: true });
  if (abilities.review) actions.push({ key: 'review', label: t('مراجعة القسم', 'Review'), icon: ClipboardCheck, primary: true });
  if (abilities.approve) actions.push({ key: 'approve', label: t('الاعتماد النهائي', 'Final approval'), icon: ShieldCheck, primary: true });
  if (abilities.recordAccepted) actions.push({ key: 'accepted', label: t('تسجيل المقبولين', 'Record accepted'), icon: CheckCircle2, primary: !abilities.review && !abilities.approve });
  if (abilities.assign) actions.push({ key: 'assign', label: request.recruiterCode ? t('إعادة إسناد', 'Reassign') : t('إسناد مسؤول', 'Assign'), icon: UserPlus });
  if (abilities.changePriority) actions.push({ key: 'priority', label: t('الأولوية', 'Priority'), icon: Flag });
  if (abilities.extend) actions.push({ key: 'extend', label: t('مد المهلة', 'Extend'), icon: CalendarClock });
  if (abilities.linkOdoo) actions.push({ key: 'odoo', label: t('ربط Odoo', 'Link Odoo'), icon: Link2 });
  if (abilities.hold) actions.push({ key: 'hold', label: t('تعليق', 'Hold'), icon: Pause });
  if (abilities.resume) actions.push({ key: 'resume', label: t('استئناف', 'Resume'), icon: Play, primary: true });
  if (abilities.cancel) actions.push({ key: 'cancel', label: t('إلغاء', 'Cancel'), icon: CircleSlash, danger: true });

  const recruiterName = request.recruiter ? shortName(request.recruiter.name, lang) : '';
  const waiting = {
    department_review: t('بانتظار مراجعة مدير القسم', 'Waiting for the department manager'),
    final_approval: t('بانتظار الاعتماد النهائي', 'Waiting for final approval'),
    hiring: t('التوظيف جارٍ', 'Hiring in progress'),
  };

  return (
    <div className="space-y-6">
      <button type="button" onClick={() => navigate(-1)} className="inline-flex items-center gap-1.5 text-[12.5px] font-semibold text-[#5A6C82] hover:text-navy">
        <Back size={15} aria-hidden="true" />
        {t('رجوع', 'Back')}
      </button>

      <header className="rounded-2xl border border-[#E6ECF3] bg-white p-5 shadow-[0_1px_2px_rgba(11,37,69,0.04)] sm:p-6">
        <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2 text-[12px]">
              <span className="font-mono font-semibold text-ink-faint">{request.reference}</span>
              <StatusBadge status={request.status} />
              {request.source === 'legacy_workbook' && <Badge tone="neutral">{t('مستورد من ملف التوظيف', 'Imported from workbook')}</Badge>}
            </div>
            <h1 className="mt-2 text-[24px] font-bold leading-tight tracking-tight text-navy sm:text-[28px]">{request.title || t('طلب بدون عنوان', 'Untitled request')}</h1>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <PriorityBadge priority={request.priority} />
              {classification && <Badge tone="neutral">{pick(classification)}</Badge>}
              <span className="text-[13px] text-[#5A6C82]">
                {[request.department, request.locationCode ? pick(LOCATION_LABEL[request.locationCode]) : request.location].filter(Boolean).join(' · ') || '—'}
              </span>
            </div>
          </div>
          <div className={cx('w-full shrink-0 rounded-2xl border p-4 lg:w-80', sla.started ? `${TONE[SLA_TONE[sla.state]].border} ${TONE[SLA_TONE[sla.state]].bg}` : 'border-[#E6ECF3] bg-[#F8FAFC]')}>
            {sla.started ? (
              <>
                <p className={cx('text-[12px] font-bold', TONE[SLA_TONE[sla.state]].text)}>{pick(SLA_LABEL[sla.state])}</p>
                <p className="mt-1 text-[26px] font-bold tabular-nums leading-8 text-navy">
                  {t(`يوم ${num(sla.elapsedWorkingDays, lang)} / ${num(sla.targetWorkingDays, lang)}`, `Day ${num(sla.elapsedWorkingDays, lang)} / ${num(sla.targetWorkingDays, lang)}`)}
                </p>
                <p className="mt-0.5 text-[13px] font-semibold text-[#3F5068]">
                  {sla.state === 'overdue'
                    ? t(`متأخرة ${workingDays(sla.overdueWorkingDays ?? 0, 'ar')}`, `${workingDays(sla.overdueWorkingDays ?? 0, 'en')} overdue`)
                    : sla.state === 'met' || sla.state === 'missed'
                      ? t(`أُغلقت في ${workingDays(sla.actualWorkingDays ?? 0, 'ar')}`, `Closed in ${workingDays(sla.actualWorkingDays ?? 0, 'en')}`)
                      : t(`متبقٍ ${workingDays(sla.remainingWorkingDays ?? 0, 'ar')}`, `${workingDays(sla.remainingWorkingDays ?? 0, 'en')} left`)}
                </p>
                <div className="mt-3"><SlaMeter sla={sla} /></div>
              </>
            ) : (
              <>
                <p className="text-[12px] font-bold text-[#5A6C82]">SLA</p>
                <p className="mt-1 text-[15px] font-bold text-navy">{t('يبدأ عند الاعتماد النهائي', 'Starts at final approval')}</p>
                {request.targetWorkingDays && <p className="mt-0.5 text-[12.5px] text-[#5A6C82]">{t(`المدة المطلوبة: ${workingDays(request.targetWorkingDays, 'ar')}`, `Target: ${workingDays(request.targetWorkingDays, 'en')}`)}</p>}
              </>
            )}
          </div>
        </div>

        {actions.length > 0 && (
          <div className="mt-5 flex flex-wrap gap-2 border-t border-[#EEF2F7] pt-4">
            {actions.map((action) => {
              const Icon = action.icon;
              return (
                <button key={action.key} type="button" onClick={() => setDialog(action.key)} className={cx('btn-sm', action.primary ? 'btn-primary' : action.danger ? 'btn-quiet text-red-700 hover:bg-red-50 hover:text-red-700' : 'btn-ghost')}>
                  <Icon size={15} aria-hidden="true" />
                  {action.label}
                </button>
              );
            })}
          </div>
        )}
      </header>

      <AnimatePresence>
        {celebrate && request.status === 'completed' && (
          <motion.div {...motionPresets.pop} className={cx('flex items-center gap-3 rounded-2xl border px-4 py-3', request.sla?.slaMet ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : 'border-amber-200 bg-amber-50 text-amber-800')} role="status">
            <CheckCircle2 size={20} aria-hidden="true" />
            <div className="min-w-0 flex-1">
              <p className="text-[14px] font-bold">{request.sla?.slaMet ? t('✓ اكتملت الوظيفة داخل الـSLA', '✓ Job completed within SLA') : t('اكتملت الوظيفة بعد موعدها', 'Job completed after its due date')}</p>
              <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-white/70">
                <motion.span className={cx('block h-full rounded-full', request.sla?.slaMet ? 'bg-emerald-500' : 'bg-amber-500')} initial={{ width: `${Math.min(100, (sla.progress ?? 0) * 100)}%` }} animate={{ width: '100%' }} transition={motionPresets.reduce ? { duration: 0 } : { duration: 0.32, ease: [0.22, 1, 0.36, 1] }} />
              </div>
            </div>
            <button type="button" className="text-[12px] font-semibold underline" onClick={() => setCelebrate(false)}>{t('إخفاء', 'Dismiss')}</button>
          </motion.div>
        )}
      </AnimatePresence>

      <nav aria-label={t('أقسام الصفحة', 'Page sections')} className="no-scrollbar -mx-4 flex gap-1.5 overflow-x-auto px-4 sm:mx-0 sm:px-0">
        {index.map(([anchor, label]) => (
          <a key={anchor} href={`#${anchor}`} onClick={(event) => { event.preventDefault(); document.getElementById(anchor)?.scrollIntoView({ behavior: motionPresets.reduce ? 'auto' : 'smooth', block: 'start' }); }} className="shrink-0 rounded-full border border-[#E6ECF3] bg-white px-3 py-1.5 text-[12px] font-semibold text-[#5A6C82] hover:border-brand-200 hover:text-navy">
            {label}
          </a>
        ))}
      </nav>

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1fr)_380px]">
        <div className="min-w-0 space-y-5">
          <Section id="overview" title={t('نظرة عامة', 'Overview')}>
            <dl className="grid grid-cols-1 gap-x-6 gap-y-4 sm:grid-cols-2 lg:grid-cols-3">
              <KeyValue label={t('العدد المطلوب', 'Headcount')} value={num(request.headcount, lang)} />
              <KeyValue label={t('المقبولون', 'Accepted')} value={`${num(request.accepted, lang)} / ${num(request.headcount, lang)}`} />
              <KeyValue label={t('مقاعد مفتوحة', 'Open seats')} value={num(request.openSeats, lang)} />
              <KeyValue label={t('سبب الاحتياج', 'Reason')} value={request.reason ? pick(REASON_LABEL[request.reason] ?? { ar: request.reason, en: request.reason }) : '—'} />
              <KeyValue label={t('نطاق الراتب', 'Salary range')} value={request.salaryRange.min !== null || request.salaryRange.max !== null ? `${money(request.salaryRange.min, lang, request.salaryRange.currency ?? 'EGP')} – ${money(request.salaryRange.max, lang, request.salaryRange.currency ?? 'EGP')}` : request.salaryRange.text || '—'} />
              <KeyValue label={t('مدير المقابلات', 'Interview manager')} value={request.interviewManager.name} />
              <KeyValue label={t('صاحب الطلب', 'Requested by')} value={request.requestedByName || (request.source === 'legacy_workbook' ? t('غير مسجل في الملف', 'Not recorded in the workbook') : '—')} />
              <KeyValue label={t('تاريخ الطلب', 'Requested on')} value={request.source === 'legacy_workbook' ? '—' : date(request.createdAt, lang)} />
              {request.legacyValidation && <KeyValue label={t('اعتماد مسجل في الملف القديم', 'Validation in the legacy workbook')} value={request.legacyValidation} />}
            </dl>
            {request.notes && <p className="mt-4 rounded-xl bg-[#F6F8FB] px-3.5 py-2.5 text-[12.5px] leading-6 text-[#3F5068]">{request.notes}</p>}
            {request.unresolvedAssignees.length > 0 && <p className="mt-3 text-[12px] text-amber-700">{t(`أسماء في الملف القديم لم تُطابق بموظف: ${request.unresolvedAssignees.join('، ')}`, `Workbook names not matched to an employee: ${request.unresolvedAssignees.join(', ')}`)}</p>}
          </Section>

          <Section id="pipeline" title={t('مسار التوظيف ومرشحو Odoo', 'Hiring pipeline & Odoo candidates')} hint={t('من Odoo مباشرة، للقراءة فقط.', 'Straight from Odoo, read-only.')}>
            <OdooPipeline pipeline={pipelineQuery.data} loading={pipelineQuery.loading} canLink={abilities.linkOdoo} onLink={() => setDialog('odoo')} onRefresh={() => void pipelineQuery.reload()} />
          </Section>

          <Section id="documents" title={t('وصف الوظيفة والمتطلبات', 'Job description & requirements')}>
            <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
              <div><h4 className="mb-1.5 text-[12.5px] font-bold text-navy">{t('المسؤوليات', 'Responsibilities')}</h4><Prose text={request.responsibilities} /></div>
              <div><h4 className="mb-1.5 text-[12.5px] font-bold text-navy">{t('المهام', 'Tasks')}</h4><Prose text={request.tasks} /></div>
              <div><h4 className="mb-1.5 text-[12.5px] font-bold text-navy">{t('مؤشرات النجاح', 'Success indicators')}</h4><Prose text={request.successIndicators} /></div>
              <div><h4 className="mb-1.5 text-[12.5px] font-bold text-navy">{t('المتطلبات', 'Requirements')}</h4><Prose text={request.requirements} /></div>
            </div>
            <div className="mt-4 flex flex-wrap gap-2">
              {([['demo', t('Demo مطلوب', 'Demo required')], ['technicalTest', t('اختبار فني مطلوب', 'Technical test required')], ['offer', t('عرض وظيفي مكتوب مطلوب', 'Written offer required')]] as const).map(([key, label]) => (
                <Badge key={key} tone={request.requirementChecks?.[key] ? 'info' : 'neutral'}>{request.requirementChecks?.[key] ? '✓ ' : ''}{label}</Badge>
              ))}
            </div>
            {request.presentationRequirement && <p className="mt-3 text-[12.5px] leading-6 text-[#3F5068]"><b>{t('متطلب مظهر مهني خاص بالوظيفة:', 'Role-specific professional presentation requirement:')}</b> {request.presentationRequirement}</p>}
          </Section>

          <Section id="activity" title={t('سجل النشاط', 'Activity timeline')}>
            {data.activity.length === 0 ? <EmptyBlock title={t('لا يوجد نشاط', 'No activity')} /> : (
              <ol className="space-y-3">
                {data.activity.slice(0, 40).map((row) => (
                  <li key={row.id} className="flex gap-3 text-[12.5px]">
                    <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-slate-300" aria-hidden="true" />
                    <div className="min-w-0">
                      <p className="font-semibold text-navy">{activityLabel(row.type, t)}</p>
                      <p className="text-ink-faint">{row.actorName || t('النظام', 'System')} · {dateTime(row.createdAt, lang)}{typeof row.meta?.comment === 'string' && row.meta.comment ? ` · ${row.meta.comment}` : ''}</p>
                    </div>
                  </li>
                ))}
              </ol>
            )}
          </Section>
        </div>

        <aside className="min-w-0 space-y-5">
          <Section id="sla" title="SLA" hint={sla.started ? t(`بدأ ${date(sla.startDate, lang)}`, `Started ${date(sla.startDate, lang)}`) : undefined}>
            {sla.started ? (
              <dl className="grid grid-cols-2 gap-3">
                <KeyValue label={t('المدة الأصلية', 'Original target')} value={workingDays(sla.originalTargetWorkingDays ?? 0, lang)} />
                <KeyValue label={t('المدة الحالية', 'Current target')} value={workingDays(sla.targetWorkingDays ?? 0, lang)} />
                <KeyValue label={t('الموعد الأصلي', 'Original due')} value={date(sla.originalDueDate, lang)} />
                <KeyValue label={t('الموعد الحالي', 'Current due')} value={date(sla.dueDate, lang)} />
                {(sla.pausedWorkingDays ?? 0) > 0 && <KeyValue label={t('موقوفة (تعليق)', 'Paused (on hold)')} value={workingDays(sla.pausedWorkingDays ?? 0, lang)} />}
                {sla.completedAt && <KeyValue label={t('أُغلقت', 'Closed')} value={date(sla.completedAt, lang)} />}
              </dl>
            ) : <p className="text-[12.5px] text-[#5A6C82]">{t('لا تُحسب أي مدة قبل الاعتماد النهائي.', 'No time counts before final approval.')}</p>}
            <div className="mt-4 border-t border-[#EEF2F7] pt-3">
              <h4 className="mb-2 text-[12.5px] font-bold text-navy">{t('سجل المد', 'Extensions')}</h4>
              {data.extensions.length === 0 ? <p className="text-[12px] text-ink-faint">{t('لم تُمد المهلة.', 'Never extended.')}</p> : (
                <ul className="space-y-2">
                  {data.extensions.map((row) => (
                    <li key={row.id} className="rounded-xl bg-[#F6F8FB] px-3 py-2 text-[12px]">
                      <p className="font-bold text-navy">+{workingDays(row.addedWorkingDays, lang)} · {date(row.previousDueDate, lang, 'short')} → {date(row.newDueDate, lang, 'short')}</p>
                      <p className="mt-0.5 text-[#3F5068]">{row.reason}</p>
                      {row.note && <p className="text-ink-faint">{row.note}</p>}
                      <p className="mt-0.5 text-ink-faint">{row.actorName} · {dateTime(row.createdAt, lang)}</p>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </Section>

          <Section id="approvals" title={t('سجل الاعتمادات', 'Approval history')}>
            <ApprovalTimeline steps={data.timeline} waitingFor={waiting} />
          </Section>

          <Section id="recruiter" title={t('مسؤول التوظيف', 'Recruiter')} action={abilities.assign ? <button type="button" className="text-brand-600 hover:underline" onClick={() => setDialog('assign')}>{request.recruiterCode ? t('إعادة إسناد', 'Reassign') : t('إسناد', 'Assign')}</button> : null}>
            {request.recruiter ? (
              <div className="flex items-center gap-3">
                <PersonAvatar name={recruiterName} photoUrl={request.recruiter.photoUrl} size={48} />
                <div className="min-w-0">
                  <p className="truncate text-[14px] font-bold text-navy">{recruiterName}</p>
                  <p className="truncate text-[12px] text-[#5A6C82]">{request.recruiter.title}</p>
                  {!request.recruiter.active && <p className="text-[11.5px] font-semibold text-amber-700">{t('لم يعد موظفاً نشطاً', 'No longer an active employee')}</p>}
                </div>
              </div>
            ) : (
              <p className={cx('text-[13px] font-semibold', request.priority === 'critical' ? 'text-red-700' : 'text-[#5A6C82]')}>{t('لا يوجد مسؤول بعد.', 'No recruiter yet.')}</p>
            )}
            {request.supportRecruiters.filter(Boolean).length > 0 && (
              <p className="mt-2 flex items-center gap-1.5 text-[12px] text-[#5A6C82]"><Users size={13} aria-hidden="true" />{t('مساندة:', 'Support:')} {request.supportRecruiters.filter(Boolean).map((item) => shortName(item!.name, lang)).join('، ')}</p>
            )}
            {data.assignments.length > 0 && (
              <ul className="mt-3 space-y-1.5 border-t border-[#EEF2F7] pt-3">
                {data.assignments.slice().reverse().map((row) => (
                  <li key={row.id} className="text-[11.5px] text-[#5A6C82]">
                    <span className="font-semibold text-navy">{row.recruiter ? shortName(row.recruiter.name, lang) : t('بدون مسؤول', 'Unassigned')}</span>
                    {' · '}{row.actorName} · {dateTime(row.createdAt, lang)}
                    {row.override && <span className="block font-semibold text-amber-700">{t('تجاوز سعة:', 'Capacity override:')} {row.overrideReason}</span>}
                  </li>
                ))}
              </ul>
            )}
          </Section>

          {data.performance && (
            <>
              <Section id="kpi" title={t('أثر الأداء', 'KPI impact')} hint={t('الخصومات المسجلة على هذه الوظيفة.', 'Deductions recorded against this job.')}>
                {data.performance.kpiEvents.length === 0 ? <p className="text-[12.5px] text-emerald-700">{t('لا توجد خصومات على هذه الوظيفة.', 'No deductions on this job.')}</p> : (
                  <ul className="space-y-2">
                    {data.performance.kpiEvents.map((event) => (
                      <li key={event.id} className={cx('rounded-xl border px-3 py-2 text-[12px]', event.voidedAt ? 'border-dashed border-[#D5DEE9] opacity-70' : 'border-[#E6ECF3]')}>
                        <p className="flex items-center justify-between gap-2 font-bold text-navy"><span className="truncate">{typeof event.rule === 'string' ? event.rule : pick(event.rule)}</span><span className={event.voidedAt ? 'text-ink-faint line-through' : 'text-red-700'}>−{num(event.deduction, lang, 1)}</span></p>
                        <p className="mt-0.5 text-[#3F5068]">{event.reason}</p>
                        <p className="text-ink-faint">{event.source === 'automatic' ? t('فحص تلقائي', 'Automatic check') : event.reviewerName} · {date(event.occurredOn, lang)}{event.voidedAt ? ` · ${t('مُلغى', 'void')}` : ''}</p>
                      </li>
                    ))}
                  </ul>
                )}
              </Section>
              <Section id="reward" title={t('أهلية المكافأة', 'Reward eligibility')}>
                {data.performance.reward.batch ? (
                  <div className="space-y-2">
                    <Badge tone={data.performance.reward.batch.status === 'rejected' ? 'critical' : 'success'}>{t('ضمن دفعة مكافأة', 'In a reward batch')} · {data.performance.reward.batch.status}</Badge>
                    <p className="text-[12.5px] text-[#5A6C82]">{money(data.performance.reward.batch.amountMin, lang, data.performance.reward.batch.currency)} – {money(data.performance.reward.batch.amountMax, lang, data.performance.reward.batch.currency)}</p>
                  </div>
                ) : data.performance.reward.eligible ? (
                  <div className="flex items-center gap-2 text-[12.5px] font-semibold text-emerald-700"><ProgressDots done={1} of={1} />{t('مؤهلة وتُحسب في التقدم نحو الدفعة التالية', 'Eligible — counts toward the next batch')}</div>
                ) : (
                  <ul className="space-y-1.5 text-[12.5px] text-[#5A6C82]">
                    {data.performance.reward.reasons.map((reason) => <li key={reason} className="flex items-center gap-2"><span className="h-1.5 w-1.5 rounded-full bg-slate-300" aria-hidden="true" />{pick(REWARD_REASON_LABEL[reason] ?? { ar: reason, en: reason })}</li>)}
                  </ul>
                )}
                {data.performance.reward.category && <p className="mt-2 text-[11.5px] text-ink-faint">{t('بند المكافأة:', 'Reward line:')} {pick(data.performance.reward.category)} · v{data.performance.reward.rulesVersion}</p>}
                <div className="mt-2"><Link to={`/hr/recruitment/rewards${request.recruiterCode ? `?recruiter=${encodeURIComponent(request.recruiterCode)}` : ''}`} className="text-[12px] font-semibold text-brand-600 hover:underline">{t('فتح المكافآت', 'Open rewards')}</Link></div>
              </Section>
            </>
          )}
          {request.source === 'legacy_workbook' && request.legacy && (
            <Card>
              <SectionTitle title={t('من ملف التوظيف القديم', 'From the legacy workbook')} />
              <dl className="grid grid-cols-2 gap-3 text-[12px]">
                <KeyValue label={t('الملف', 'File')} value={request.legacy.fileName} />
                <KeyValue label={t('رقم التقرير', 'Report no.')} value={request.legacy.sequence} />
                <KeyValue label={t('أولوية الملف', 'Workbook priority')} value={request.legacy.priority} />
                <KeyValue label={t('مدة التعيين بالملف', 'Workbook hiring period')} value={request.legacy.hiringPeriodDays ?? '—'} />
              </dl>
            </Card>
          )}
        </aside>
      </div>

      {dialog === 'assign' && <AssignDialog request={request} context={context} onClose={() => setDialog(null)} onDone={done} />}
      {dialog === 'priority' && <PriorityDialog request={request} context={context} onClose={() => setDialog(null)} onDone={done} />}
      {dialog === 'extend' && request.sla && <ExtendDialog request={request} context={context} onClose={() => setDialog(null)} onDone={done} />}
      {dialog === 'review' && <DecisionDialog request={request} stage="review" onClose={() => setDialog(null)} onDone={done} />}
      {dialog === 'approve' && <DecisionDialog request={request} stage="approve" onClose={() => setDialog(null)} onDone={done} />}
      {dialog === 'accepted' && <AcceptedDialog request={request} odooAccepted={pipelineQuery.data?.acceptedFromOdoo ?? null} onClose={() => setDialog(null)} onDone={done} />}
      {dialog === 'odoo' && <OdooLinkDialog request={request} onClose={() => setDialog(null)} onDone={() => { setDialog(null); void reload(); void pipelineQuery.reload(); }} />}
      {(dialog === 'submit' || dialog === 'hold' || dialog === 'resume' || dialog === 'cancel') && <CommentActionDialog request={request} action={dialog} onClose={() => setDialog(null)} onDone={done} />}
    </div>
  );
}

export default JobRequestDetail;
