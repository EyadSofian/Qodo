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

/**
 * The canonical spine every stage maps onto. Never shown as a column itself.
 *
 * `signoff` sits between review and done for the one case where "the manager
 * said yes" and "the work is out the door" are different days: a post can be
 * approved on Sunday and scheduled for Thursday. A department that does not
 * declare a `signoff` column never sees the state — approving lands straight
 * on `done` there, exactly as it always has.
 */
export const STAGE_TYPES = ['open', 'active', 'review', 'signoff', 'done'];

export const STAGE_TYPE_LABELS = {
  open: { ar: 'لم تبدأ', en: 'Not started' },
  active: { ar: 'قيد التنفيذ', en: 'In progress' },
  review: { ar: 'قيد المراجعة', en: 'In review' },
  signoff: { ar: 'معتمدة', en: 'Approved' },
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
    /**
     * Organisational structure is deliberately separate from access roles.
     * "Manager" / "member" answers what a person may do; these entries answer
     * where they sit in the marketing organisation and what work they do.
     */
    subteams: [
      {
        id: 'creative',
        ar: 'الكرييتف',
        en: 'Creative',
        roles: [
          { id: 'designer', ar: 'مصمم', en: 'Designer' },
          { id: 'video_editor', ar: 'مونتير فيديو', en: 'Video editor' },
          { id: 'content_creator', ar: 'صانع محتوى', en: 'Content creator' },
        ],
      },
      {
        id: 'marketing_core',
        ar: 'الماركتنج',
        en: 'Marketing',
        roles: [
          { id: 'social_media', ar: 'سوشيال ميديا', en: 'Social media' },
          { id: 'marketing_specialist', ar: 'أخصائي تسويق', en: 'Marketing specialist' },
          {
            id: 'digital_marketing_specialist',
            ar: 'أخصائي تسويق رقمي',
            en: 'Digital marketing specialist',
          },
          { id: 'marketing_coordinator', ar: 'منسق تسويق', en: 'Marketing coordinator' },
          {
            id: 'digital_marketing_coordinator',
            ar: 'منسق تسويق رقمي',
            en: 'Digital marketing coordinator',
          },
        ],
      },
      {
        id: 'moderation',
        ar: 'المودريشن',
        en: 'Moderation',
        roles: [{ id: 'moderator', ar: 'مودريتور', en: 'Moderator' }],
      },
      {
        id: 'website',
        ar: 'الويب سايت',
        en: 'Website & e-commerce',
        roles: [
          { id: 'ecommerce_manager', ar: 'مدير تجارة إلكترونية', en: 'E-commerce manager' },
          {
            id: 'ecommerce_specialist',
            ar: 'أخصائي تجارة إلكترونية',
            en: 'E-commerce specialist',
          },
          { id: 'seo_specialist', ar: 'أخصائي SEO', en: 'SEO specialist' },
          { id: 'web_developer', ar: 'مطور ويب', en: 'Web developer' },
        ],
      },
      {
        id: 'merchandising',
        ar: 'الميرشندايزنج',
        en: 'Merchandising',
        roles: [{ id: 'merchandiser', ar: 'أخصائي ميرشندايزنج', en: 'Merchandiser' }],
      },
      {
        id: 'performance',
        ar: 'البيرفورمانس',
        en: 'Performance',
        roles: [{ id: 'media_buyer', ar: 'ميديا باير', en: 'Media buyer' }],
      },
    ],
    /**
     * The board reads left to right as the work actually travels: filed,
     * picked up, handed in, approved, published — with the two side columns
     * for work sent back and work parked.
     *
     * "معتمدة" is here on its second attempt, and the difference is the whole
     * lesson. It used to sit *second*, between "قيد الانتظار" and "قيد العمل",
     * typed `open` — so approving never landed there, nothing in the lifecycle
     * could move a task into it, and being the same type as "قيد الانتظار"
     * meant an employee could drag their own card into a column that read as
     * "approved". It was retired for that.
     *
     * It now sits after review and carries its own canonical type, so it is
     * where the review gate actually lands and the only way out of it is the
     * publish action. Marketing is the department that needs it: approving a
     * post and posting it are genuinely different days, and collapsing them
     * meant the board could not show what was signed off and still waiting.
     */
    stages: [
      { id: 'pending', type: 'open', ar: 'قيد الانتظار', en: 'Pending' },
      { id: 'working', type: 'active', ar: 'قيد العمل', en: 'Working' },
      { id: 'review', type: 'review', ar: 'قيد المراجعة', en: 'In review' },
      { id: 'approved', type: 'signoff', ar: 'معتمدة', en: 'Approved' },
      { id: 'rework', type: 'active', ar: 'إعادة عمل', en: 'Rework' },
      { id: 'blocked', type: 'active', ar: 'متوقفة', en: 'Blocked' },
      { id: 'done', type: 'done', ar: 'منجزة', en: 'Done' },
    ],
  },
  {
    id: 'hr',
    ar: 'الموارد البشرية',
    en: 'Human resources',
    color: '#7C3AED',
    icon: 'people',
    /**
     * Three branches doing genuinely different work: hiring people, paying
     * them, and the personnel side that outlives both. Same separation as
     * marketing's — this says where someone sits in HR, not what they may do.
     *
     * `hr_management` is deliberately not `management`: the management desk is
     * a permission (`management.view`) belonging to the executive's own diary,
     * and a sub-team id that reads like it would be a trap for the next person.
     */
    subteams: [
      {
        id: 'recruitment',
        ar: 'الركرومنت',
        en: 'Recruitment',
        roles: [{ id: 'recruiter', ar: 'أخصائي توظيف', en: 'Recruiter' }],
      },
      {
        // No titles yet — payroll is one job here, so the sub-team is already
        // the whole answer and an empty list means the form stops asking.
        id: 'payroll',
        ar: 'البايرول',
        en: 'Payroll',
        roles: [],
      },
      {
        id: 'hr_management',
        ar: 'المناجمينت',
        en: 'HR management',
        roles: [
          { id: 'hr_specialist', ar: 'أخصائي موارد', en: 'HR specialist' },
          { id: 'admin_manager', ar: 'مدير إدارة', en: 'Administration manager' },
        ],
      },
    ],
    /**
     * Left as the recruitment funnel the HR dashboard already uses. Payroll and
     * HR management therefore file work onto hiring columns, and returned work
     * lands in "فرز المتقدمين" because there is no `rework` column to catch it
     * (see `stageForReturn`). A deliberate choice to keep the recruitment board
     * intact, not an oversight — generic stages are the fix when it starts to
     * bite.
     */
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
      { id: 'review', type: 'review', ar: 'قيد المراجعة', en: 'In review' },
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

/**
 * Old marketing cards used four content-production stages. Keeping the alias
 * table next to the workflow lets the boot migration move them without losing
 * their meaning.
 *
 * `approved` is deliberately *not* aliased any more. It used to map to
 * "قيد الانتظار", because back then the column called "معتمدة" was an `open`
 * one and anything sitting in it was work that had not started. The boot
 * migration rewrote those cards on the first deploy after that change, so the
 * id is free — and it now names the real sign-off column. Re-adding the alias
 * would send every newly approved card back to the top of the board.
 */
export const STAGE_ALIASES = {
  marketing: {
    idea: 'pending',
    production: 'working',
    approval: 'review',
    live: 'done',
  },
};

export function getDepartment(id) {
  return DEPARTMENTS.find((d) => d.id === id) ?? DEPARTMENTS[0];
}

export function getStages(departmentId) {
  return getDepartment(departmentId).stages;
}

export function getSubteams(departmentId) {
  return getDepartment(departmentId).subteams ?? [];
}

export function getSubteam(departmentId, subteamId) {
  if (!subteamId) return null;
  return getSubteams(departmentId).find((team) => team.id === subteamId) ?? null;
}

export function getJobRoles(departmentId, subteamId) {
  return getSubteam(departmentId, subteamId)?.roles ?? [];
}

export function getJobRole(departmentId, subteamId, roleId) {
  if (!roleId) return null;
  return getJobRoles(departmentId, subteamId).find((role) => role.id === roleId) ?? null;
}

export function subteamLabel(departmentId, subteamId, lang = 'ar') {
  const team = getSubteam(departmentId, subteamId);
  if (!team) return '';
  return lang === 'en' ? team.en : team.ar;
}

export function jobRoleLabel(departmentId, subteamId, roleId, lang = 'ar') {
  const role = getJobRole(departmentId, subteamId, roleId);
  if (!role) return '';
  return lang === 'en' ? role.en : role.ar;
}

export function normaliseStageId(departmentId, stageId) {
  return STAGE_ALIASES[departmentId]?.[stageId] ?? stageId;
}

export function getStage(departmentId, stageId) {
  const stages = getStages(departmentId);
  const normalised = normaliseStageId(departmentId, stageId);
  return stages.find((s) => s.id === normalised) ?? stages[0];
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

/** Delivered — it actually went out. The narrow question. */
export function isDoneStage(departmentId, stageId) {
  return stageType(departmentId, stageId) === 'done';
}

/**
 * Nobody owes any more work on it — approved, whether or not it has shipped.
 *
 * This is the question almost every counter is really asking. A post signed off
 * this morning and scheduled for Thursday is not "still open": nagging its
 * owner about the deadline, or counting it against them as overdue, would be
 * telling them off for work a manager already approved and scored. `isDoneStage`
 * stays for the places that genuinely mean delivered.
 */
export function isSettledStage(departmentId, stageId) {
  const type = stageType(departmentId, stageId);
  return type === 'done' || type === 'signoff';
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
