/**
 * Departments and their workflows.
 *
 * Modelled on how Odoo Project does it rather than Zoho Blueprints: in Odoo
 * every project owns its own ordered set of Kanban stages, so a sales pipeline
 * and a support queue don't have to pretend they share the same four columns.
 * Zoho's equivalent (per-layout statuses + blueprint transitions) is more
 * powerful but needs an admin to design a state machine before anyone can file
 * a task — too much ceremony for a workspace this size.
 *
 * So: each department carries its own stages, colour and icon, and a task
 * belongs to one department.
 *
 * The catch with per-department stages is that cross-department views — "my
 * work", the launcher counters, the assistant's summary — can no longer group
 * by a shared status. Every stage therefore declares a canonical `type`
 * (`open` / `active` / `review` / `done`), which is the spine those views group
 * by. Departments get to name their own columns; the workspace still knows what
 * "finished" means.
 *
 * The department list is grounded in Engosoft's own systems: `sales`,
 * `operations` and `complaints` come from the Chatwoot analytics dashboard's
 * `DEPARTMENT_LABELS_AR`; marketing, HR, training, finance and IT come from the
 * other three dashboards and the fact that Engosoft is a training company.
 */

/** The canonical spine every stage maps onto. Never shown as a column itself. */
export const STAGE_TYPES = ['open', 'active', 'review', 'done'];

export const STAGE_TYPE_LABELS = {
  open: { ar: 'لم تبدأ', en: 'Not started' },
  active: { ar: 'قيد التنفيذ', en: 'In progress' },
  review: { ar: 'قيد المراجعة', en: 'In review' },
  done: { ar: 'منجزة', en: 'Done' },
};

/**
 * `general` is the fallback for anything that isn't department-specific, and
 * the default for a task filed without a department.
 */
export const DEPARTMENTS = [
  {
    id: 'general',
    ar: 'عام',
    en: 'General',
    color: '#1D6FB8',
    icon: 'grid',
    stages: [
      { id: 'todo', type: 'open', ar: 'لم تبدأ', en: 'To do' },
      { id: 'doing', type: 'active', ar: 'قيد التنفيذ', en: 'In progress' },
      { id: 'review', type: 'review', ar: 'قيد المراجعة', en: 'Review' },
      { id: 'done', type: 'done', ar: 'منجزة', en: 'Done' },
    ],
  },
  {
    id: 'sales',
    ar: 'المبيعات',
    en: 'Sales',
    color: '#16A34A',
    icon: 'funnel',
    // A pipeline, not a to-do list: the columns are deal stages, so the board
    // doubles as a forecast.
    stages: [
      { id: 'lead', type: 'open', ar: 'عميل محتمل', en: 'Lead' },
      { id: 'contacted', type: 'active', ar: 'تم التواصل', en: 'Contacted' },
      { id: 'quotation', type: 'active', ar: 'عرض سعر', en: 'Quotation' },
      { id: 'negotiation', type: 'review', ar: 'تفاوض', en: 'Negotiation' },
      { id: 'won', type: 'done', ar: 'تم الإغلاق', en: 'Closed won' },
    ],
  },
  {
    id: 'operations',
    ar: 'العمليات',
    en: 'Operations',
    color: '#0EA5A5',
    icon: 'sliders',
    stages: [
      { id: 'new', type: 'open', ar: 'جديدة', en: 'New' },
      { id: 'scheduled', type: 'open', ar: 'مجدولة', en: 'Scheduled' },
      { id: 'executing', type: 'active', ar: 'قيد التنفيذ', en: 'Executing' },
      { id: 'verifying', type: 'review', ar: 'تحت التدقيق', en: 'Verifying' },
      { id: 'completed', type: 'done', ar: 'مكتملة', en: 'Completed' },
    ],
  },
  {
    id: 'complaints',
    ar: 'خدمة العملاء',
    en: 'Customer service',
    color: '#6366F1',
    icon: 'headset',
    // "Waiting on customer" is a distinct column on purpose — folding it into
    // "in progress" is what makes support boards lie about their backlog.
    stages: [
      { id: 'received', type: 'open', ar: 'واردة', en: 'Received' },
      { id: 'handling', type: 'active', ar: 'قيد المعالجة', en: 'Handling' },
      { id: 'awaiting', type: 'active', ar: 'بانتظار العميل', en: 'Awaiting customer' },
      { id: 'escalated', type: 'review', ar: 'مُصعَّدة', en: 'Escalated' },
      { id: 'resolved', type: 'done', ar: 'تم الحل', en: 'Resolved' },
    ],
  },
  {
    id: 'marketing',
    ar: 'التسويق',
    en: 'Marketing',
    color: '#F5821F',
    icon: 'bolt',
    stages: [
      { id: 'idea', type: 'open', ar: 'فكرة', en: 'Idea' },
      { id: 'production', type: 'active', ar: 'قيد الإنتاج', en: 'In production' },
      { id: 'approval', type: 'review', ar: 'بانتظار الاعتماد', en: 'Approval' },
      { id: 'live', type: 'done', ar: 'منشورة', en: 'Live' },
    ],
  },
  {
    id: 'hr',
    ar: 'الموارد البشرية',
    en: 'Human resources',
    color: '#7C3AED',
    icon: 'people',
    // Mirrors the recruitment funnel already used in the HR dashboard.
    stages: [
      { id: 'request', type: 'open', ar: 'طلب توظيف', en: 'Request' },
      { id: 'screening', type: 'active', ar: 'فرز المتقدمين', en: 'Screening' },
      { id: 'interview', type: 'active', ar: 'مقابلات', en: 'Interviews' },
      { id: 'offer', type: 'review', ar: 'عرض وظيفي', en: 'Offer' },
      { id: 'hired', type: 'done', ar: 'تم التعيين', en: 'Hired' },
    ],
  },
  {
    id: 'training',
    ar: 'التدريب',
    en: 'Training',
    color: '#0B2545',
    icon: 'calendar',
    stages: [
      { id: 'proposed', type: 'open', ar: 'مقترحة', en: 'Proposed' },
      { id: 'material', type: 'active', ar: 'إعداد المادة', en: 'Material prep' },
      { id: 'scheduled', type: 'active', ar: 'مجدولة', en: 'Scheduled' },
      { id: 'delivered', type: 'done', ar: 'تم التنفيذ', en: 'Delivered' },
    ],
  },
  {
    id: 'finance',
    ar: 'المالية',
    en: 'Finance',
    color: '#64748B',
    icon: 'chart',
    stages: [
      { id: 'requested', type: 'open', ar: 'مطلوبة', en: 'Requested' },
      { id: 'reviewing', type: 'active', ar: 'قيد المراجعة', en: 'Under review' },
      { id: 'approved', type: 'review', ar: 'معتمدة', en: 'Approved' },
      { id: 'settled', type: 'done', ar: 'تمت التسوية', en: 'Settled' },
    ],
  },
  {
    id: 'it',
    ar: 'تقنية المعلومات',
    en: 'IT',
    color: '#DC2626',
    icon: 'globe',
    stages: [
      { id: 'reported', type: 'open', ar: 'بلاغ', en: 'Reported' },
      { id: 'diagnosis', type: 'active', ar: 'تشخيص', en: 'Diagnosis' },
      { id: 'fixing', type: 'active', ar: 'قيد الإصلاح', en: 'Fixing' },
      { id: 'verify', type: 'review', ar: 'تأكيد الحل', en: 'Verification' },
      { id: 'closed', type: 'done', ar: 'مغلقة', en: 'Closed' },
    ],
  },
];

export const DEPARTMENT_IDS = DEPARTMENTS.map((d) => d.id);
export const DEFAULT_DEPARTMENT = 'general';

export function getDepartment(id) {
  return DEPARTMENTS.find((d) => d.id === id) ?? DEPARTMENTS[0];
}

export function getStages(departmentId) {
  return getDepartment(departmentId).stages;
}

export function getStage(departmentId, stageId) {
  const stages = getStages(departmentId);
  return stages.find((s) => s.id === stageId) ?? stages[0];
}

/** The stage a newly filed task lands in. */
export function firstStage(departmentId) {
  return getStages(departmentId)[0].id;
}

/**
 * Canonical type for a (department, stage) pair — how every cross-department
 * view groups work that doesn't share column names.
 */
export function stageType(departmentId, stageId) {
  return getStage(departmentId, stageId).type;
}

export function isDoneStage(departmentId, stageId) {
  return stageType(departmentId, stageId) === 'done';
}

/**
 * Moving a task between departments can't keep a stage id that doesn't exist
 * there, so the closest stage of the same canonical type is used instead.
 */
export function translateStage(fromDepartment, stageId, toDepartment) {
  if (fromDepartment === toDepartment) return stageId;
  const type = stageType(fromDepartment, stageId);
  const target = getStages(toDepartment);
  return (target.find((s) => s.type === type) ?? target[0]).id;
}

export function departmentLabel(id, lang = 'ar') {
  const department = getDepartment(id);
  return lang === 'en' ? department.en : department.ar;
}

export function stageLabel(departmentId, stageId, lang = 'ar') {
  const stage = getStage(departmentId, stageId);
  return lang === 'en' ? stage.en : stage.ar;
}
