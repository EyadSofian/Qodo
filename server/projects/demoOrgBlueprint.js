/**
 * Qodo Projects — the organization-level half of the demo.
 *
 * `demoBlueprint.js` fills the project screens. This file fills the ones that
 * sit *above* a project — Settings, saved reports, saved views — and they are
 * separated because they answer a different question. A project's content is
 * "what work is happening"; this is "how this company has configured the tool",
 * and a reader who opens Settings to four empty tabs concludes the tabs do
 * nothing.
 *
 * ── The one rule that overrides everything else here ─────────────────
 *
 * **Nothing in this file may look operational when it is not.**
 *
 * `docs/QODO_PROJECTS_UI_DIFFERENCES.md` §68 is explicit that an integration
 * must never be presented as working until a real credential exists, and the
 * temptation in a demo is exactly the opposite: a Settings page full of green
 * "Connected" badges photographs well. It would also be a lie that costs
 * somebody a day when they plan around a Slack integration that has never sent
 * a message.
 *
 * So: every demo integration is `not_configured`, carries no credential field
 * at all, and says in its own name that it is a demo. The webhook endpoints
 * point at the reserved `.invalid` domain and are created **inactive**, so the
 * delivery worker will not attempt them. The automation rules are real rows the
 * engine can read, and their recorded runs describe things that genuinely
 * happened to the demo tasks.
 */

/* ------------------------------------------------------------------ */
/* Automation                                                          */
/* ------------------------------------------------------------------ */

/**
 * Workflow rules — "when this happens to a task, do that".
 *
 * Three, chosen so the trigger column is not one word repeated: a status
 * change, an assignment, and a date-based sweep. Each one is something a real
 * project manager sets up in the first week, which is the point — a reader
 * should recognise the *shape* of the automation, not admire it.
 *
 * `actions` uses the same declarative vocabulary `automationService` already
 * executes. Nothing here is evaluated as code (ADR-4); an action is data naming
 * a field and a value.
 */
export const WORKFLOW_RULES = [
  {
    ref: 'notify-overdue',
    moduleKey: 'task',
    name: 'تنبيه عند تأخّر مهمة عالية الأولوية',
    description:
      'كل صباح، أي مهمة أولويتها عالية أو عاجلة وتجاوزت تاريخ الانتهاء بدون إغلاق — يتم إخطار مدير المشروع.',
    trigger: 'time_based',
    criteria: [
      { field: 'priority', operator: 'in', value: ['high', 'urgent'] },
      { field: 'endDate', operator: 'before', value: 'today' },
    ],
    match: 'all',
    actions: [{ type: 'notify', target: 'project_owner', template: 'task_overdue' }],
    schedule: { frequency: 'daily', atMinutes: 8 * 60 },
    isActive: true,
    lastRunDay: -1,
  },
  {
    ref: 'review-on-done',
    moduleKey: 'task',
    name: 'إرسال المهمة للمراجعة عند اكتمالها',
    description:
      'لما المهمة تتحوّل إلى «مكتملة» وتكون قابلة للفوترة، تتحوّل تلقائيًا إلى «قيد المراجعة» لحد ما المدير يعتمدها.',
    trigger: 'status_change',
    triggerField: 'statusId',
    criteria: [{ field: 'isBillable', operator: 'equals', value: true }],
    match: 'all',
    actions: [{ type: 'set_field', field: 'statusKey', value: 'in_review' }],
    schedule: null,
    isActive: true,
    lastRunDay: -3,
  },
  {
    ref: 'welcome-assignee',
    moduleKey: 'task',
    name: 'إخطار العضو عند إسناد مهمة له',
    description: 'أي مهمة تتسند لعضو جديد، يوصله إشعار فيه العنوان والتاريخ المطلوب.',
    trigger: 'assignment',
    triggerField: null,
    criteria: [],
    match: 'all',
    actions: [{ type: 'notify', target: 'assignee', template: 'task_assigned' }],
    schedule: null,
    isActive: false,
    lastRunDay: -21,
  },
];

/**
 * Business rules — the same idea for issues, where the vocabulary is triage.
 *
 * Kept to two, because the Settings tab needs to show that the feature exists
 * and is configured, not to be a rule library.
 */
export const BUSINESS_RULES = [
  {
    ref: 'escalate-critical',
    moduleKey: 'issue',
    name: 'تصعيد المشاكل الحرجة فورًا',
    criteria: [{ field: 'severity', operator: 'in', value: ['critical', 'blocker'] }],
    match: 'all',
    actions: [
      { type: 'set_field', field: 'priority', value: 'urgent' },
      { type: 'notify', target: 'project_owner', template: 'issue_critical' },
    ],
    stopProcessing: false,
    isActive: true,
  },
  {
    ref: 'route-ui-bugs',
    moduleKey: 'issue',
    name: 'توجيه مشاكل الواجهة لفريق التصميم',
    criteria: [{ field: 'classification', operator: 'equals', value: 'واجهة' }],
    match: 'all',
    actions: [{ type: 'assign', target: 'designer' }],
    stopProcessing: false,
    isActive: true,
  },
];

/**
 * Recorded automation runs.
 *
 * A rule with no run history reads as something nobody has ever switched on.
 * These describe things that actually happened to the demo's own tasks and
 * issues, including one `skipped` and one `failed` — because a run log where
 * everything succeeded hides the column that matters when somebody is
 * debugging why their automation did nothing.
 *
 * `entityRef` is resolved to a real task or issue id by the loader.
 */
export const AUTOMATION_RUNS = [
  {
    ruleRef: 'notify-overdue',
    ruleType: 'workflow',
    entityType: 'task',
    entityRef: 'app-offline',
    trigger: 'time_based',
    status: 'applied',
    actionsApplied: [{ type: 'notify', target: 'project_owner', delivered: true }],
    day: -1,
  },
  {
    ruleRef: 'notify-overdue',
    ruleType: 'workflow',
    entityType: 'task',
    entityRef: 'cart',
    trigger: 'time_based',
    status: 'skipped',
    actionsApplied: [],
    error: null,
    skippedReason: 'criteria_not_met',
    day: -1,
  },
  {
    ruleRef: 'review-on-done',
    ruleType: 'workflow',
    entityType: 'task',
    entityRef: 'catalog',
    trigger: 'status_change',
    status: 'applied',
    actionsApplied: [{ type: 'set_field', field: 'statusKey', value: 'in_review' }],
    day: -12,
  },
  {
    ruleRef: 'escalate-critical',
    ruleType: 'business',
    entityType: 'issue',
    entityRef: 'app-issue-1',
    trigger: 'create',
    status: 'applied',
    actionsApplied: [{ type: 'set_field', field: 'priority', value: 'urgent' }],
    day: -6,
  },
  {
    ruleRef: 'route-ui-bugs',
    ruleType: 'business',
    entityType: 'issue',
    entityRef: 'app-issue-3',
    trigger: 'create',
    status: 'failed',
    actionsApplied: [],
    error: 'no_user_matched_role: designer',
    day: -9,
  },
];

/* ------------------------------------------------------------------ */
/* Webhooks                                                            */
/* ------------------------------------------------------------------ */

/**
 * Two endpoints, both switched off, both pointing nowhere.
 *
 * `is_active: false` is not decoration — the delivery worker reads it, so an
 * inactive endpoint is never attempted. Combined with a `.invalid` host, which
 * cannot resolve in any DNS, there are two independent reasons no request can
 * leave the building. One would have been enough; two means a future change to
 * either one alone cannot start sending traffic to a stranger.
 *
 * The `secret` is a visible placeholder rather than a generated value. A demo
 * that mints a real HMAC secret has created a credential nobody knows exists,
 * and the Settings screen already promises that a secret is shown once and then
 * never again — which would make this one unrecoverable and permanent.
 */
export const WEBHOOK_ENDPOINTS = [
  {
    ref: 'crm-sync',
    name: 'مزامنة مع نظام العميل (تجريبي)',
    url: 'https://hooks.example.invalid/qodo/crm',
    method: 'POST',
    events: ['project.created', 'project.completed', 'task.completed'],
    secret: 'demo-placeholder-not-a-real-secret',
    isActive: false,
    disabledReason: 'endpoint تجريبي — موقوف عمدًا ولا يُرسل أي طلب.',
    deliveries: [
      {
        event: 'task.completed',
        payload: { taskRef: 'catalog', note: 'حمولة تجريبية' },
        attempt: 1,
        responseStatus: 200,
        durationMs: 148,
        day: -12,
      },
      {
        event: 'project.completed',
        payload: { projectRef: 'campaign', note: 'حمولة تجريبية' },
        attempt: 1,
        responseStatus: 200,
        durationMs: 203,
        day: -20,
      },
      {
        /* A failure, because a delivery log with no failures in it hides the
           retry column and the error column — the two people actually come to
           this screen to read. */
        event: 'task.completed',
        payload: { taskRef: 'app-catalog', note: 'حمولة تجريبية' },
        attempt: 3,
        responseStatus: 502,
        responseBody: 'Bad Gateway',
        error: 'upstream_unavailable',
        durationMs: 5000,
        day: -48,
      },
    ],
  },
  {
    ref: 'ops-alerts',
    name: 'تنبيهات التشغيل (تجريبي)',
    url: 'https://hooks.example.invalid/qodo/ops',
    method: 'POST',
    events: ['issue.created', 'budget.threshold'],
    secret: 'demo-placeholder-not-a-real-secret',
    isActive: false,
    disabledReason: 'endpoint تجريبي — موقوف عمدًا ولا يُرسل أي طلب.',
    deliveries: [
      {
        event: 'budget.threshold',
        payload: { projectRef: 'app', percent: 92, note: 'حمولة تجريبية' },
        attempt: 1,
        responseStatus: 200,
        durationMs: 96,
        day: -5,
      },
    ],
  },
];

/* ------------------------------------------------------------------ */
/* Integrations                                                        */
/* ------------------------------------------------------------------ */

/**
 * Connector rows with **no credentials**, and the status that says so.
 *
 * This is the part of the demo most likely to be misread, so it is the part
 * most constrained. Every row is `not_configured`. None carries a credential
 * field. The endpoints behind them already answer 409 without one, which means
 * the demo cannot accidentally make an adapter appear to work — the product's
 * own honesty rule is doing the enforcing, not a promise in this comment.
 *
 * What the reader gets is the true thing: the adapters exist, here is where
 * they are configured, and none of them is connected.
 */
export const INTEGRATIONS = [
  { provider: 'odoo', name: 'Odoo — الفوترة والعملاء (تجريبي)' },
  { provider: 'slack', name: 'Slack — إشعارات الفريق (تجريبي)' },
  { provider: 'github', name: 'GitHub — ربط المهام بالكود (تجريبي)' },
];

/* ------------------------------------------------------------------ */
/* Saved reports and views                                             */
/* ------------------------------------------------------------------ */

/**
 * Saved reports, so the Reports tab opens on something rather than a builder.
 *
 * A report builder shown to somebody who has never used one is a form with
 * eleven dropdowns and no obvious first move. Three saved reports turn it into
 * a menu: open one, see what it produces, then change it.
 */
export const SAVED_REPORTS = [
  {
    ref: 'hours-by-person',
    name: 'ساعات العمل حسب العضو',
    description: 'إجمالي الساعات المسجّلة لكل عضو خلال آخر ثلاثين يومًا، مقسّمة إلى قابل للفوترة وغير قابل.',
    moduleKey: 'time_log',
    visibility: 'organization',
    definition: {
      groupBy: 'user_id',
      metrics: ['hours', 'billable_hours', 'cost'],
      range: { fromDay: -30, toDay: 0 },
      sort: [{ field: 'hours', direction: 'desc' }],
    },
  },
  {
    ref: 'overdue-tasks',
    name: 'المهام المتأخرة',
    description: 'كل مهمة تجاوزت تاريخ الانتهاء ولم تُغلق بعد، مرتّبة بالأقدم أولًا.',
    moduleKey: 'task',
    visibility: 'organization',
    definition: {
      filters: [
        { field: 'endDate', operator: 'before', value: 'today' },
        { field: 'statusCategory', operator: 'not_in', value: ['done', 'cancelled'] },
      ],
      columns: ['title', 'project', 'assignee', 'endDate', 'priority'],
      sort: [{ field: 'endDate', direction: 'asc' }],
    },
  },
  {
    ref: 'budget-vs-actual',
    name: 'الميزانية مقابل المصروف',
    description: 'لكل مشروع: الميزانية المعتمدة، المصروف الفعلي، والفرق بينهما.',
    moduleKey: 'project',
    visibility: 'organization',
    definition: {
      groupBy: 'project_id',
      metrics: ['budget_amount', 'actual_cost', 'variance'],
      sort: [{ field: 'variance', direction: 'asc' }],
    },
  },
];

/**
 * Saved views on the task module — the filters somebody would pin.
 *
 * "My open work" and "This week" are the two every project manager rebuilds by
 * hand on day one. Having them already there is the difference between a filter
 * bar that looks configurable and one that looks configured.
 */
export const SAVED_VIEWS = [
  {
    ref: 'my-open',
    moduleKey: 'task',
    name: 'مهامي المفتوحة',
    criteria: { assignee: 'me', statusCategory: ['open', 'active'] },
    sort: [{ field: 'endDate', direction: 'asc' }],
    groupBy: null,
    columns: ['title', 'project', 'status', 'endDate', 'priority'],
    visibility: 'private',
  },
  {
    ref: 'due-this-week',
    moduleKey: 'task',
    name: 'المستحق هذا الأسبوع',
    criteria: { dueWithinDays: 7, statusCategory: ['open', 'active', 'review'] },
    sort: [{ field: 'endDate', direction: 'asc' }],
    groupBy: 'assignee',
    columns: ['title', 'assignee', 'endDate', 'status'],
    visibility: 'organization',
  },
  {
    ref: 'blocked',
    moduleKey: 'issue',
    name: 'المشاكل الحرجة المفتوحة',
    criteria: { severity: ['critical', 'blocker'], statusCategory: ['open', 'active'] },
    sort: [{ field: 'created', direction: 'desc' }],
    groupBy: null,
    columns: ['key', 'title', 'assignee', 'severity', 'dueDate'],
    visibility: 'organization',
  },
];

/* ------------------------------------------------------------------ */
/* Notifications                                                       */
/* ------------------------------------------------------------------ */

/**
 * The four notifications a project manager would genuinely have waiting.
 *
 * Each one corresponds to something that is *actually true* in the demo data —
 * the overdue task exists, the budget really is past its threshold, the
 * timesheet really is awaiting approval. A notification pointing at a condition
 * that is not there is the fastest way to teach somebody that the notification
 * list is decorative.
 */
export const NOTIFICATIONS = [
  {
    ref: 'overdue',
    kind: 'task_overdue',
    titleAr: 'مهمة متأخرة: العمل بدون إنترنت',
    bodyAr: 'المهمة تجاوزت تاريخ الانتهاء ولم تبدأ بعد. مشروع تطبيق عيادات الحياة.',
    entityType: 'task',
    entityRef: 'app-offline',
    projectRef: 'app',
    day: -1,
    read: false,
  },
  {
    ref: 'budget',
    kind: 'budget_threshold',
    titleAr: 'الميزانية تجاوزت ٨٠٪',
    bodyAr: 'مشروع تطبيق عيادات الحياة استهلك أكثر من ٨٠٪ من الميزانية المعتمدة.',
    entityType: 'project',
    entityRef: 'app',
    projectRef: 'app',
    day: -2,
    read: false,
  },
  {
    ref: 'timesheet',
    kind: 'timesheet_pending',
    titleAr: 'كشف وقت بانتظار الاعتماد',
    bodyAr: 'كريم عبد الرحمن أرسل كشف الأسبوع الماضي وينتظر المراجعة.',
    entityType: 'timesheet',
    entityRef: null,
    projectRef: 'shop',
    day: -2,
    read: false,
  },
  {
    ref: 'sla',
    kind: 'sla_warning',
    titleAr: 'مشكلة اقتربت من تجاوز مدة الاستجابة',
    bodyAr: 'الإشعارات لا تصل والتطبيق مغلق على iOS — باقي أقل من يوم على المهلة.',
    entityType: 'issue',
    entityRef: 'app-issue-2',
    projectRef: 'app',
    day: -1,
    read: true,
  },
];

/* ------------------------------------------------------------------ */
/* Service levels                                                      */
/* ------------------------------------------------------------------ */

/**
 * One SLA policy, so the issue clocks have something to run against.
 *
 * The hours are working hours on the demo calendar, not wall-clock hours —
 * that is the whole point of attaching a calendar to a policy, and a demo that
 * used wall-clock time would quietly show a breach every weekend.
 */
export const SLA_POLICIES = [
  {
    ref: 'critical-sla',
    name: 'اتفاقية مستوى الخدمة — المشاكل الحرجة',
    description: 'استجابة خلال ٤ ساعات عمل، وحل خلال يومي عمل، للمشاكل الحرجة والمعطِّلة.',
    criteria: [{ field: 'severity', operator: 'in', value: ['critical', 'blocker'] }],
    match: 'all',
    responseMinutes: 4 * 60,
    resolutionMinutes: 2 * 8 * 60,
    escalations: [{ afterPercent: 80, notify: 'project_owner' }],
    isActive: true,
  },
];
