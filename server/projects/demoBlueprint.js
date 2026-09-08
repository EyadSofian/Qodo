/**
 * Qodo Projects — what the demo contains.
 *
 * Content, not code. The loader in `demoDataService.js` walks this structure
 * and knows nothing about e-commerce or marketing campaigns; everything a
 * reader actually sees on screen is here, in one file, in Arabic, where it can
 * be reviewed and corrected by somebody who does not read JavaScript.
 *
 * Three rules shaped it.
 *
 * **Every date is an offset from today, never a literal.** A demo written with
 * `2026-03-14` in it is convincing for a month and then becomes a museum: every
 * project overdue, every burndown flat, every "upcoming" milestone in the past.
 * Offsets mean the overdue task is still overdue next year and the project that
 * has not started yet still has not started.
 *
 * **The four projects disagree with each other on purpose.** A demo where
 * everything is green teaches nobody what the product is for. So one project is
 * finished and under budget, one is running and tight, one is genuinely in
 * trouble — late, over budget, with open defects — and one has barely begun.
 * The portfolio screen is only worth looking at if the rows differ.
 *
 * **The numbers have to survive arithmetic.** Estimated hours, logged hours,
 * progress and budget are chosen so that earned value, budget variance and the
 * critical path come out to something a person could defend in a meeting.
 * Random values produce a schedule performance index of 0.03 and a screen that
 * looks broken rather than instructive.
 */

/* ------------------------------------------------------------------ */
/* The demo space                                                       */
/* ------------------------------------------------------------------ */

/**
 * The name the demo answers to.
 *
 * The demo is a company — it has staff, customers, rates and a working week —
 * and until now that company had no name anywhere a person could see. It was
 * referred to in passing inside a task description ("فريق النور الرقمية") and
 * nowhere else, so the Settings panel could say how many rows would be created
 * but not *whose* they were.
 *
 * ── Why this is a label and not an `organizations` row ───────────────
 *
 * The obvious reading of "an isolated demo organization" is a second row in
 * `organizations` with its own id, and it is the wrong build here. Every
 * Projects query is scoped by `organizationOf(user)` — the *viewer's* own
 * organization — and a person belongs to exactly one, with no switcher anywhere
 * in the workspace. Demo data written under a second organization id would be
 * unreachable by the administrator who just pressed the button: every Projects
 * screen would stay exactly as empty as before, and the only way to see it would
 * be to edit a user row in the database.
 *
 * The isolation that actually protects real work is already stronger than an
 * organization boundary would be, and it is not name-based: every row the loader
 * writes is recorded in `demo_seeds`, and the unloader deletes that list and
 * nothing else. A real project that happens to share a name with a demo one is
 * untouched, which is the property an organization id was being asked to
 * provide.
 *
 * So this is the demo's name, shown where the demo is administered and on the
 * rows it created — not a tenant boundary pretending to be one.
 */
export const DEMO_WORKSPACE = {
  name: 'شركة النور الرقمية — مشاريع تجريبية',
  nameEn: 'Al-Nour Digital — demo projects',
};

/* ------------------------------------------------------------------ */
/* People                                                               */
/* ------------------------------------------------------------------ */

/**
 * The demo cast.
 *
 * These become real rows in the workspace `users` collection, because a project
 * member is a user id and there is no way to fake one that the members list,
 * the workload report and the assignee picker would all accept. They are
 * created disabled and without a password — see `demoDataService.js` for why
 * that is the whole of the safety argument.
 *
 * `costRate` and `billRate` are Egyptian pounds per hour. They are what make
 * the finance screens compute: without a cost rate every logged hour is worth
 * nothing, actual cost is null, and earned value reports itself unavailable.
 */
export const PEOPLE = [
  {
    ref: 'laila',
    name: 'ليلى منصور',
    title: 'مديرة مشاريع',
    jobRole: 'project_manager',
    department: 'general',
    avatarColor: '#1D6FB8',
    costRate: 320,
    billRate: 560,
  },
  {
    ref: 'karim',
    name: 'كريم عبد الرحمن',
    title: 'مطوّر واجهات أمامية',
    jobRole: 'developer',
    department: 'general',
    avatarColor: '#7C3AED',
    costRate: 240,
    billRate: 430,
  },
  {
    ref: 'tarek',
    name: 'طارق الحسيني',
    title: 'مطوّر خلفي',
    jobRole: 'developer',
    department: 'general',
    avatarColor: '#0E385E',
    costRate: 265,
    billRate: 470,
  },
  {
    ref: 'salma',
    name: 'سلمى الشريف',
    title: 'مصمّمة تجربة مستخدم',
    jobRole: 'designer',
    department: 'general',
    avatarColor: '#F5821F',
    costRate: 230,
    billRate: 410,
  },
  {
    ref: 'hala',
    name: 'هالة عبد الله',
    title: 'محاسبة المشاريع',
    jobRole: 'accountant',
    department: 'general',
    avatarColor: '#0F766E',
    costRate: 205,
    billRate: 360,
  },
  {
    ref: 'nora',
    name: 'نورا فتحي',
    title: 'أخصائية تسويق رقمي',
    jobRole: 'marketing',
    department: 'general',
    avatarColor: '#16A34A',
    costRate: 195,
    billRate: 350,
  },
  {
    ref: 'omar',
    name: 'عمر الديب',
    title: 'مهندس اختبار وجودة',
    jobRole: 'qa',
    department: 'general',
    avatarColor: '#DC2626',
    costRate: 210,
    billRate: 380,
  },
  {
    /**
     * The client contact, and the one person here who is a different *kind* of
     * user rather than a different job.
     *
     * A client membership is the module's hardest boundary — internal phases,
     * internal comments and every rate column are invisible to them — and a
     * demo without one cannot show that the boundary exists. So the demo has a
     * client, and the screens that hide things from clients have somebody to
     * hide them from.
     */
    ref: 'ziad',
    name: 'زياد الأفق',
    title: 'مدير تقنية المعلومات — شركة الأفق للتجارة',
    jobRole: 'client',
    department: 'general',
    avatarColor: '#64748B',
    isClientContact: true,
    costRate: null,
    billRate: null,
  },
];

/* ------------------------------------------------------------------ */
/* Clients                                                              */
/* ------------------------------------------------------------------ */

/**
 * Three clients, because the customer column has to be worth reading.
 *
 * With one client every row says the same word and the reader learns nothing
 * from it — including that it is a filter. Three is enough for the portfolio
 * screen to group by, and few enough that the demo does not read as a database
 * dump.
 *
 * Every address is on the reserved `.invalid` top-level domain (RFC 2606),
 * which can never be delegated to anybody. A demo address that could one day
 * become a real mailbox is a notification waiting to be sent to a stranger.
 */
export const CUSTOMERS = [
  {
    ref: 'ufuq',
    name: 'شركة الأفق للتجارة',
    kind: 'business',
    email: 'projects@al-ufuq-trading.invalid',
    phone: '+20 2 2555 0100',
    website: 'https://al-ufuq-trading.invalid',
    address: 'التجمّع الخامس، القاهرة الجديدة',
    notes: 'عميل تجريبي أُنشئ من زر «تحميل بيانات تجريبية».',
  },
  {
    ref: 'hayat',
    name: 'عيادات الحياة',
    kind: 'business',
    email: 'it@hayat-clinics.invalid',
    phone: '+20 2 3760 0244',
    website: 'https://hayat-clinics.invalid',
    address: 'المهندسين، الجيزة',
    notes: 'عميل تجريبي أُنشئ من زر «تحميل بيانات تجريبية».',
  },
  {
    ref: 'bidaya',
    name: 'مؤسسة بداية',
    kind: 'business',
    email: 'marketing@bidaya-foundation.invalid',
    phone: '+20 3 4877 0200',
    website: 'https://bidaya-foundation.invalid',
    address: 'سموحة، الإسكندرية',
    notes: 'عميل تجريبي أُنشئ من زر «تحميل بيانات تجريبية».',
  },
];

/** Groups, so the portfolio screen has a real axis to group by. */
export const GROUPS = [
  {
    ref: 'delivery',
    nameAr: 'مشاريع العملاء',
    nameEn: 'Client delivery',
    description: 'المشاريع المنفّذة لحساب عملاء خارجيين.',
    color: '#1D6FB8',
  },
  {
    ref: 'internal',
    nameAr: 'مشاريع داخلية',
    nameEn: 'Internal',
    description: 'مشاريع الشركة نفسها، بدون عميل خارجي.',
    color: '#7C3AED',
  },
];

/* ------------------------------------------------------------------ */
/* Tags                                                                 */
/* ------------------------------------------------------------------ */

/**
 * Tags cut across projects; that is the whole reason they exist beside phases
 * and lists. These are the cuts somebody would actually make — by platform, by
 * risk, by what a client is waiting on — rather than a colour swatch set.
 */
export const TAGS = [
  { ref: 'mobile', name: 'موبايل', color: '#7C3AED' },
  { ref: 'web', name: 'ويب', color: '#1D6FB8' },
  { ref: 'urgent', name: 'عاجل', color: '#DC2626' },
  { ref: 'client-waiting', name: 'بانتظار العميل', color: '#F5821F' },
  { ref: 'internal', name: 'داخلي', color: '#64748B' },
  { ref: 'security', name: 'أمان', color: '#0F766E' },
];

/* ------------------------------------------------------------------ */
/* The working week                                                     */
/* ------------------------------------------------------------------ */

/**
 * Sunday to Thursday, and the holidays that actually stop work.
 *
 * The workdays array is `{7,1,2,3,4}` — PostgreSQL's ISO day numbering, where
 * Sunday is 7. This is not a detail: every duration, every critical path and
 * every SLA clock in the product counts this week, and a calendar that assumed
 * Monday–Friday would produce plausible, wrong dates for every project.
 *
 * Holidays are offsets from today rather than fixed dates, for the same reason
 * every other date here is: a demo whose holidays are all in the past teaches
 * nothing about what a holiday does to a schedule.
 */
export const WORK_CALENDAR = {
  name: 'تقويم العمل — مصر',
  timezone: 'Africa/Cairo',
  workdays: [7, 1, 2, 3, 4],
  dayStartMinutes: 9 * 60,
  dayEndMinutes: 17 * 60,
  holidays: [
    { day: -45, name: 'إجازة رسمية' },
    { day: -12, name: 'إجازة رسمية' },
    { day: 9, name: 'عطلة نصف العام' },
    { day: 10, name: 'عطلة نصف العام' },
    { day: 38, name: 'إجازة رسمية' },
  ],
};

/* ------------------------------------------------------------------ */
/* Projects                                                             */
/* ------------------------------------------------------------------ */

/**
 * The four projects.
 *
 * `day` values are offsets from today: negative is the past, positive the
 * future. `statusKey` refers to the organization's own status rows — the demo
 * never creates statuses of its own, so a company that renamed "مكتمل" sees its
 * own word here.
 */
export const PROJECTS = [
  /* ── 1. Running, tight, and basically healthy ─────────────────── */
  {
    ref: 'shop',
    key: 'MTGR',
    name: 'إطلاق متجر إلكتروني',
    /**
     * One of the two projects the person loading the demo is left on.
     *
     * `projectService.create` adds whoever created a project as a manager, and
     * the demo creates all seven under one administrator — so that
     * administrator came out a member of everything, and the "My projects" tab
     * was a copy of "Active". A tab that is identical to the one beside it
     * teaches nothing about what it filters.
     *
     * So the loader keeps that membership on exactly the projects that say so
     * here and drops it everywhere else. Two, not one: a single row makes the
     * tab look like a rounding error rather than a filter. Visibility is
     * unaffected — an administrator can already see every project in the
     * organization whether or not they are a member of it.
     */
    loaderIsMember: true,
    description:
      'بناء متجر إلكتروني متكامل لشركة الأفق للتجارة: كتالوج المنتجات، سلة الشراء، بوابة الدفع، ولوحة تحكم للطلبات. الهدف هو الإطلاق قبل موسم الشتاء.',
    color: '#1D6FB8',
    customerRef: 'ufuq',
    groupRef: 'delivery',
    ownerRef: 'laila',
    statusKey: 'active',
    startDay: -70,
    endDay: 35,
    currency: 'EGP',
    billingMethod: 'fixed_cost',
    access: 'private',
    members: [
      { ref: 'laila', role: 'owner', allocation: 60 },
      { ref: 'karim', role: 'member', allocation: 100 },
      { ref: 'salma', role: 'member', allocation: 70 },
      { ref: 'tarek', role: 'member', allocation: 100 },
      { ref: 'omar', role: 'member', allocation: 50 },
      { ref: 'hala', role: 'member', allocation: 20 },
      // The client contact. `role: 'client'` is what turns on the boundary —
      // internal phases, internal comments and every rate column disappear
      // for them, which is a thing the demo should be able to show.
      { ref: 'ziad', role: 'client', allocation: 0 },
    ],
    tagRefs: ['web', 'urgent'],
    budgets: [
      { type: 'project_amount', amount: 450_000, thresholdPercent: 80 },
      { type: 'project_hours', hours: 940, thresholdPercent: 80 },
    ],
    expenses: [
      { description: 'اشتراك سنوي في بوابة الدفع', category: 'اشتراكات', amount: 18_000, day: -60, billable: true },
      { description: 'شراء قالب تصميم وأيقونات', category: 'تصميم', amount: 6_500, day: -48, billable: false },
      { description: 'استضافة وشهادة تأمين للموقع', category: 'استضافة', amount: 9_200, day: -30, billable: true },
    ],
    phases: [
      {
        ref: 'discovery',
        name: 'التخطيط والتحليل',
        description: 'تحديد نطاق العمل، دراسة المنافسين، والاتفاق على قائمة المزايا المطلوبة في الإصدار الأول.',
        statusKey: 'completed',
        startDay: -70,
        endDay: -52,
        color: '#16A34A',
        ownerRef: 'laila',
        lists: [
          {
            ref: 'discovery-list',
            name: 'التحليل والمتطلبات',
            description: 'كل ما يسبق التصميم.',
            tasks: [
              {
                ref: 'req',
                title: 'جمع متطلبات العميل وتوثيقها',
                description:
                  'ثلاث جلسات مع فريق النور الرقمية لتحديد المزايا المطلوبة في الإطلاق الأول، وتوثيقها في مستند متفق عليه وموقّع.',
                statusKey: 'done',
                priority: 'high',
                startDay: -70,
                endDay: -62,
                estimatedHours: 40,
                progress: 100,
                assigneeRefs: ['laila', 'salma'],
                billable: true,
                time: [
                  { ref: 'laila', day: -69, hours: 6, notes: 'الجلسة الأولى مع فريق العميل.' },
                  { ref: 'laila', day: -66, hours: 5.5, notes: 'الجلسة الثانية ومراجعة قائمة المزايا.' },
                  { ref: 'salma', day: -65, hours: 7, notes: 'تفريغ الملاحظات وترتيب المتطلبات.' },
                  { ref: 'laila', day: -63, hours: 4, notes: 'صياغة المستند النهائي.' },
                  { ref: 'salma', day: -62, hours: 6, notes: 'مراجعة المستند مع العميل قبل التوقيع.' },
                ],
                comments: [
                  {
                    ref: 'laila',
                    day: -62,
                    body: 'العميل وافق على قائمة المزايا. أي إضافة بعد كده تدخل في مرحلة تانية ومش في نطاق الإطلاق الأول.',
                  },
                ],
                checklist: [
                  { text: 'جلسة تحديد النطاق', done: true, required: true },
                  { text: 'مستند المتطلبات موقّع من العميل', done: true, required: true },
                ],
              },
              {
                ref: 'competitors',
                title: 'دراسة المتاجر المنافسة',
                description: 'مقارنة ستة متاجر في نفس القطاع من ناحية رحلة الشراء وطرق الدفع وسرعة الصفحات.',
                statusKey: 'done',
                priority: 'normal',
                startDay: -68,
                endDay: -58,
                estimatedHours: 24,
                progress: 100,
                assigneeRefs: ['nora'],
                billable: false,
                time: [
                  { ref: 'nora', day: -66, hours: 6, notes: 'مراجعة أربعة متاجر.' },
                  { ref: 'nora', day: -60, hours: 8, notes: 'إنهاء المقارنة وكتابة التوصيات.' },
                ],
                comments: [],
                checklist: [],
              },
            ],
          },
        ],
      },
      {
        ref: 'design',
        name: 'التصميم وتجربة المستخدم',
        description: 'رحلة الشراء كاملة من الصفحة الرئيسية حتى تأكيد الطلب، ثم نظام تصميم يبني عليه المطوّرون.',
        statusKey: 'completed',
        startDay: -51,
        endDay: -28,
        color: '#16A34A',
        ownerRef: 'salma',
        lists: [
          {
            ref: 'design-list',
            name: 'التصميم',
            description: '',
            tasks: [
              {
                ref: 'wireframes',
                title: 'رسم مخططات الشاشات الأساسية',
                description: 'مخططات أولية لتسع شاشات: الرئيسية، الكتالوج، صفحة المنتج، السلة، الدفع، وتأكيد الطلب.',
                statusKey: 'done',
                priority: 'high',
                startDay: -51,
                endDay: -42,
                estimatedHours: 45,
                progress: 100,
                assigneeRefs: ['salma'],
                billable: true,
                time: [
                  { ref: 'salma', day: -50, hours: 7, notes: 'الرئيسية والكتالوج.' },
                  { ref: 'salma', day: -47, hours: 7.5, notes: 'صفحة المنتج والسلة.' },
                  { ref: 'salma', day: -44, hours: 8, notes: 'شاشات الدفع والتأكيد.' },
                  { ref: 'salma', day: -42, hours: 6, notes: 'تعديلات بعد مراجعة الفريق.' },
                ],
                comments: [],
                checklist: [],
              },
              {
                ref: 'design-system',
                title: 'بناء نظام التصميم والمكوّنات',
                description:
                  'ألوان وخطوط ومكوّنات جاهزة (أزرار، حقول، بطاقات منتج) بحيث لا يعيد المطوّر اختراع الشكل في كل شاشة.',
                statusKey: 'done',
                priority: 'normal',
                startDay: -43,
                endDay: -30,
                estimatedHours: 50,
                progress: 100,
                assigneeRefs: ['salma', 'karim'],
                billable: true,
                time: [
                  { ref: 'salma', day: -41, hours: 8, notes: 'الألوان والخطوط والمسافات.' },
                  { ref: 'salma', day: -37, hours: 7, notes: 'مكوّنات النماذج.' },
                  { ref: 'karim', day: -34, hours: 8, notes: 'تحويل المكوّنات إلى كود.' },
                  { ref: 'karim', day: -31, hours: 7.5, notes: 'مراجعة وتوحيد الأسماء.' },
                ],
                comments: [
                  {
                    ref: 'karim',
                    day: -31,
                    body: 'المكوّنات كلها اتحوّلت لكود ومربوطة بنظام التصميم، فأي تعديل في الألوان بيتطبّق على الموقع كله مرة واحدة.',
                  },
                ],
                checklist: [],
              },
            ],
          },
        ],
      },
      {
        ref: 'build',
        name: 'تطوير المتجر',
        description: 'الواجهة والخدمات الخلفية وبوابة الدفع. المرحلة الجارية حاليًا.',
        statusKey: 'in_progress',
        startDay: -27,
        endDay: 14,
        color: '#1D6FB8',
        ownerRef: 'tarek',
        lists: [
          {
            ref: 'build-front',
            name: 'الواجهة الأمامية',
            description: 'كل ما يراه المشتري.',
            tasks: [
              {
                ref: 'catalog',
                title: 'تطوير صفحات الكتالوج والمنتج',
                description: 'عرض المنتجات مع الفلترة والبحث، وصفحة منتج بمعرض صور واختيار المقاس واللون.',
                statusKey: 'done',
                priority: 'high',
                startDay: -27,
                endDay: -12,
                estimatedHours: 80,
                progress: 100,
                assigneeRefs: ['karim'],
                billable: true,
                time: [
                  { ref: 'karim', day: -26, hours: 8, notes: 'هيكل صفحة الكتالوج.' },
                  { ref: 'karim', day: -22, hours: 7.5, notes: 'الفلترة والبحث.' },
                  { ref: 'karim', day: -18, hours: 8, notes: 'صفحة المنتج ومعرض الصور.' },
                  { ref: 'karim', day: -14, hours: 7, notes: 'اختيار المقاس واللون.' },
                  { ref: 'karim', day: -12, hours: 6, notes: 'تعديلات بعد المراجعة.' },
                ],
                comments: [],
                checklist: [],
              },
              {
                ref: 'cart',
                title: 'تطوير سلة الشراء وصفحة الدفع',
                description:
                  'السلة تحفظ المنتجات بين الزيارات، وصفحة الدفع تجمع العنوان وطريقة الدفع في خطوة واحدة بدل ثلاث خطوات.',
                statusKey: 'in_progress',
                priority: 'urgent',
                startDay: -11,
                endDay: 8,
                estimatedHours: 70,
                progress: 55,
                assigneeRefs: ['karim', 'tarek'],
                billable: true,
                time: [
                  { ref: 'karim', day: -10, hours: 7, notes: 'حفظ السلة بين الزيارات.' },
                  { ref: 'karim', day: -6, hours: 8, notes: 'شاشة الدفع، الخطوة الأولى.' },
                  { ref: 'tarek', day: -4, hours: 6.5, notes: 'ربط السلة بالخدمة الخلفية.' },
                  { ref: 'karim', day: -1, hours: 5, notes: 'تصحيح حساب الإجمالي مع الشحن.' },
                ],
                comments: [
                  {
                    ref: 'laila',
                    day: -3,
                    body: 'دي أهم مهمة في المرحلة دي — لو اتأخرت، الاختبار والإطلاق هيتأخروا وراها يوم بيوم.',
                  },
                ],
                checklist: [
                  { text: 'حفظ السلة بين الزيارات', done: true, required: false },
                  { text: 'حساب الشحن والضريبة', done: true, required: true },
                  { text: 'شاشة الدفع في خطوة واحدة', done: false, required: true },
                ],
              },
            ],
          },
          {
            ref: 'build-back',
            name: 'الخدمات الخلفية',
            description: 'كل ما لا يراه المشتري.',
            tasks: [
              {
                ref: 'payments',
                title: 'ربط بوابة الدفع الإلكتروني',
                description:
                  'ربط البوابة مع التعامل مع الحالات الصعبة: دفعة ناجحة والاتصال انقطع، ودفعة مرفوضة، وطلب استرجاع.',
                statusKey: 'in_progress',
                priority: 'urgent',
                startDay: -8,
                endDay: 10,
                estimatedHours: 60,
                progress: 40,
                assigneeRefs: ['tarek'],
                billable: true,
                time: [
                  { ref: 'tarek', day: -7, hours: 8, notes: 'حساب الاختبار وأول عملية ناجحة.' },
                  { ref: 'tarek', day: -3, hours: 7, notes: 'التعامل مع الدفعة المرفوضة.' },
                  { ref: 'tarek', day: -1, hours: 4, notes: 'مراجعة سجلّ العمليات.' },
                ],
                comments: [],
                checklist: [
                  { text: 'عملية دفع ناجحة في بيئة الاختبار', done: true, required: true },
                  { text: 'التعامل مع انقطاع الاتصال أثناء الدفع', done: false, required: true },
                  { text: 'طلب الاسترجاع', done: false, required: false },
                ],
              },
              {
                ref: 'orders',
                title: 'لوحة تحكم الطلبات',
                description: 'شاشة لموظف العميل يتابع منها الطلبات ويغيّر حالة الشحن ويطبع الفواتير.',
                statusKey: 'open',
                priority: 'normal',
                startDay: 2,
                endDay: 16,
                estimatedHours: 55,
                progress: 0,
                assigneeRefs: ['tarek'],
                billable: true,
                time: [],
                comments: [],
                checklist: [],
              },
            ],
          },
        ],
      },
      {
        ref: 'launch',
        name: 'الاختبار والإطلاق',
        description: 'اختبار شامل، تدريب فريق العميل، ثم النقل إلى الاستضافة النهائية.',
        statusKey: 'not_started',
        startDay: 15,
        endDay: 35,
        color: '#64748B',
        ownerRef: 'omar',
        lists: [
          {
            ref: 'launch-list',
            name: 'الاختبار والتسليم',
            description: '',
            tasks: [
              {
                ref: 'qa',
                title: 'اختبار شامل لرحلة الشراء',
                description: 'اختبار كل مسار من الدخول حتى تأكيد الطلب، على الجوال والحاسب، وعلى ثلاثة متصفحات.',
                statusKey: 'open',
                priority: 'high',
                startDay: 15,
                endDay: 26,
                estimatedHours: 65,
                progress: 0,
                assigneeRefs: ['omar'],
                billable: true,
                time: [],
                comments: [],
                checklist: [],
              },
              {
                ref: 'handover',
                title: 'تدريب فريق العميل والتسليم',
                description: 'جلستا تدريب على لوحة التحكم، ودليل استخدام مختصر بالعربية، ثم محضر تسليم.',
                statusKey: 'open',
                priority: 'normal',
                startDay: 27,
                endDay: 35,
                estimatedHours: 30,
                progress: 0,
                assigneeRefs: ['laila'],
                billable: true,
                time: [],
                comments: [],
                checklist: [],
              },
            ],
          },
        ],
      },
    ],
    /**
     * The dependency chain is what gives this project a critical path worth
     * drawing: requirements → wireframes → design system → catalogue → cart →
     * QA → handover. Nine tasks, one chain, and two branches hanging off it, so
     * the Gantt shows both a spine and some slack rather than a staircase.
     */
    dependencies: [
      { from: 'req', to: 'wireframes', type: 'FS', lagDays: 0 },
      { from: 'req', to: 'competitors', type: 'SS', lagDays: 2 },
      { from: 'wireframes', to: 'design-system', type: 'FS', lagDays: 0 },
      { from: 'design-system', to: 'catalog', type: 'FS', lagDays: 0 },
      { from: 'catalog', to: 'cart', type: 'FS', lagDays: 0 },
      { from: 'cart', to: 'payments', type: 'SS', lagDays: 3 },
      { from: 'cart', to: 'qa', type: 'FS', lagDays: 0 },
      { from: 'payments', to: 'qa', type: 'FS', lagDays: 0 },
      { from: 'orders', to: 'qa', type: 'FS', lagDays: 0 },
      { from: 'qa', to: 'handover', type: 'FS', lagDays: 0 },
    ],
    issues: [
      {
        ref: 'shop-issue-1',
        title: 'إجمالي السلة يظهر بدون الشحن عند تغيير المحافظة',
        description:
          'خطوات التكرار: أضف منتجًا، افتح السلة، غيّر المحافظة من القاهرة إلى أسوان. الإجمالي لا يعيد حساب الشحن حتى تحديث الصفحة.',
        severity: 'major',
        priority: 'high',
        statusKey: 'in_progress',
        assigneeRef: 'karim',
        dueDay: 4,
        moduleAffected: 'سلة الشراء',
        reproducibility: 'always',
        classification: 'خطأ برمجي',
        affectedPhaseRef: 'build',
        comments: [
          { ref: 'karim', day: -2, body: 'السبب إن حساب الشحن بيتنادى مرة واحدة عند فتح السلة. بحوّله ليتنادى مع كل تغيير في العنوان.' },
        ],
      },
      {
        ref: 'shop-issue-2',
        title: 'صور المنتجات تحمّل ببطء على الجوال',
        description: 'صفحة الكتالوج تستغرق أكثر من ست ثوانٍ على شبكة الجيل الثالث. الصور تُرسل بالحجم الأصلي.',
        severity: 'minor',
        priority: 'normal',
        statusKey: 'open',
        assigneeRef: 'karim',
        dueDay: 12,
        moduleAffected: 'الكتالوج',
        reproducibility: 'always',
        classification: 'أداء',
        affectedPhaseRef: 'build',
        comments: [],
      },
    ],
    documents: [
      {
        folder: 'مستندات العميل',
        name: 'مستند المتطلبات المعتمد.md',
        description: 'النسخة الموقّعة من العميل بتاريخ بداية المشروع.',
        body:
          '# مستند المتطلبات — إطلاق متجر إلكتروني\n\nملف تجريبي أُنشئ مع البيانات التجريبية.\n\n## نطاق الإصدار الأول\n- كتالوج المنتجات مع الفلترة والبحث\n- سلة شراء تحفظ المنتجات بين الزيارات\n- بوابة دفع إلكتروني\n- لوحة تحكم للطلبات\n\n## خارج النطاق\n- تطبيق جوال\n- برنامج الولاء\n',
      },
      {
        folder: 'التصميم',
        name: 'نظام التصميم — ملاحظات التسليم.md',
        description: 'ملخص المكوّنات والألوان المسلّمة للمطوّرين.',
        body:
          '# نظام التصميم\n\nملف تجريبي أُنشئ مع البيانات التجريبية.\n\n- اللون الأساسي: كحلي\n- الخط: Cairo\n- المكوّنات المسلّمة: 24 مكوّنًا\n',
      },
    ],
    /**
     * Two baselines, taken far enough apart to disagree.
     *
     * One is worthless: a baseline compared against the plan it was copied from
     * shows zero variance on every row, which teaches the reader that the
     * feature does nothing. The kickoff snapshot predates the schedule slipping
     * on the cart and payment tasks, so the comparison has something real in it.
     */
    baselines: [
      {
        ref: 'shop-baseline-kickoff',
        name: 'خطة بداية المشروع',
        notes: 'لقطة الجدول الزمني وقت اعتماد العرض، قبل أي تعديل.',
        capturedDay: -68,
      },
      {
        ref: 'shop-baseline-review',
        name: 'الخطة بعد مراجعة منتصف المشروع',
        notes: 'أُعيد ضبط الجدول بعد انتهاء مرحلة التصميم واعتماد النطاق النهائي.',
        capturedDay: -26,
      },
    ],
  },

  /* ── 2. Late, over budget, and honest about it ────────────────── */
  {
    ref: 'app',
    key: 'HAYA',
    name: 'تطبيق عيادات الحياة',
    description:
      'تطبيق جوال لعيادات الحياة على أندرويد و iOS: حجز المواعيد، الملف الطبي، والتذكير بالزيارات. المشروع متعثّر — تجاوز موعد التسليم، والميزانية على حافة الحد المعتمد، وما زالت هناك مهام مفتوحة ومشاكل حرجة.',
    color: '#DC2626',
    customerRef: 'hayat',
    groupRef: 'delivery',
    ownerRef: 'laila',
    statusKey: 'active',
    startDay: -120,
    endDay: -10,
    currency: 'EGP',
    billingMethod: 'based_on_task_hours',
    access: 'private',
    members: [
      { ref: 'laila', role: 'owner', allocation: 40 },
      { ref: 'karim', role: 'member', allocation: 60 },
      { ref: 'tarek', role: 'member', allocation: 80 },
      { ref: 'omar', role: 'member', allocation: 60 },
    ],
    tagRefs: ['mobile', 'urgent'],
    budgets: [
      { type: 'project_amount', amount: 300_000, thresholdPercent: 75 },
      { type: 'project_hours', hours: 620, thresholdPercent: 75 },
    ],
    expenses: [
      { description: 'رسوم نشر التطبيق على المتجرين', category: 'رسوم', amount: 4_800, day: -100, billable: true },
      { description: 'أجهزة اختبار (هاتفان)', category: 'أجهزة', amount: 27_500, day: -95, billable: false },
      { description: 'خدمة تتبّع الأعطال — ستة أشهر', category: 'اشتراكات', amount: 12_400, day: -80, billable: true },
    ],
    phases: [
      {
        ref: 'app-design',
        name: 'التصميم والنماذج الأولية',
        description: 'شاشات التطبيق ونموذج قابل للنقر قبل بداية البرمجة.',
        statusKey: 'completed',
        startDay: -120,
        endDay: -96,
        color: '#16A34A',
        ownerRef: 'salma',
        lists: [
          {
            ref: 'app-design-list',
            name: 'التصميم',
            description: '',
            tasks: [
              {
                ref: 'app-screens',
                title: 'تصميم شاشات التطبيق',
                description: 'اثنتا عشرة شاشة: الدخول، الرئيسية، البحث، تفاصيل المنتج، السلة، الحساب، والإشعارات.',
                statusKey: 'done',
                priority: 'high',
                startDay: -120,
                endDay: -104,
                estimatedHours: 70,
                progress: 100,
                assigneeRefs: ['salma'],
                billable: true,
                time: [
                  { ref: 'salma', day: -118, hours: 8, notes: 'شاشات الدخول والرئيسية.' },
                  { ref: 'salma', day: -113, hours: 8, notes: 'البحث وتفاصيل المنتج.' },
                  { ref: 'salma', day: -108, hours: 7.5, notes: 'السلة والحساب.' },
                  { ref: 'salma', day: -105, hours: 6, notes: 'تعديلات المراجعة.' },
                ],
                comments: [],
                checklist: [],
              },
            ],
          },
        ],
      },
      {
        ref: 'app-build',
        name: 'التطوير',
        description: 'بناء التطبيق على المنصتين. المرحلة التي استهلكت الجدول الزمني كله.',
        statusKey: 'in_progress',
        startDay: -95,
        endDay: -10,
        color: '#DC2626',
        ownerRef: 'tarek',
        lists: [
          {
            ref: 'app-build-list',
            name: 'التطوير',
            description: '',
            tasks: [
              {
                ref: 'app-auth',
                title: 'تسجيل الدخول وإنشاء الحساب',
                description: 'دخول بالبريد أو رقم الجوال، مع رمز تحقق واستعادة كلمة المرور.',
                statusKey: 'done',
                priority: 'high',
                startDay: -95,
                endDay: -74,
                estimatedHours: 65,
                progress: 100,
                assigneeRefs: ['tarek'],
                billable: true,
                time: [
                  { ref: 'tarek', day: -93, hours: 8, notes: 'الدخول بالبريد.' },
                  { ref: 'tarek', day: -88, hours: 8, notes: 'رمز التحقق بالرسائل القصيرة.' },
                  { ref: 'tarek', day: -82, hours: 7, notes: 'استعادة كلمة المرور.' },
                  { ref: 'tarek', day: -76, hours: 8, notes: 'معالجة الأخطاء ورسائل المستخدم.' },
                ],
                comments: [],
                checklist: [],
              },
              {
                ref: 'app-catalog',
                title: 'شاشات المنتجات والبحث',
                description: 'عرض المنتجات مع تمرير لا نهائي، وبحث فوري، وحفظ في المفضّلة.',
                statusKey: 'done',
                priority: 'normal',
                startDay: -73,
                endDay: -48,
                estimatedHours: 85,
                progress: 100,
                assigneeRefs: ['karim'],
                billable: true,
                time: [
                  { ref: 'karim', day: -70, hours: 8, notes: 'قائمة المنتجات.' },
                  { ref: 'karim', day: -64, hours: 8, notes: 'التمرير اللانهائي.' },
                  { ref: 'karim', day: -58, hours: 8, notes: 'البحث الفوري.' },
                  { ref: 'karim', day: -52, hours: 7.5, notes: 'المفضّلة.' },
                  { ref: 'karim', day: -49, hours: 6, notes: 'تحسينات الأداء.' },
                ],
                comments: [],
                checklist: [],
              },
              {
                /* Late, and the reason the project is late. */
                ref: 'app-push',
                title: 'الإشعارات الفورية',
                description:
                  'إشعارات حالة الطلب والعروض. تأخرت بسبب مشكلة في شهادات الإرسال على iOS استغرقت أسبوعين مع الدعم.',
                statusKey: 'in_progress',
                priority: 'urgent',
                startDay: -47,
                endDay: -18,
                estimatedHours: 55,
                progress: 65,
                assigneeRefs: ['tarek'],
                billable: true,
                time: [
                  { ref: 'tarek', day: -45, hours: 8, notes: 'الإرسال على أندرويد — تمّ.' },
                  { ref: 'tarek', day: -38, hours: 7, notes: 'شهادات iOS، محاولة أولى.' },
                  { ref: 'tarek', day: -30, hours: 6, notes: 'متابعة مع الدعم الفني.' },
                  { ref: 'tarek', day: -22, hours: 8, notes: 'إعادة إصدار الشهادات.' },
                  { ref: 'tarek', day: -14, hours: 6.5, notes: 'أول إشعار ناجح على iOS.' },
                ],
                comments: [
                  {
                    ref: 'laila',
                    day: -20,
                    body: 'المهمة دي هي سبب تأخير المشروع كله. اتكلمت مع العميل وأبلغته بالموقف والموعد الجديد.',
                  },
                  { ref: 'tarek', day: -14, body: 'الشهادات اتظبطت وأول إشعار وصل على iOS. باقي اختبار الحالات الصعبة.' },
                ],
                checklist: [
                  { text: 'الإرسال على أندرويد', done: true, required: true },
                  { text: 'الإرسال على iOS', done: true, required: true },
                  { text: 'الإشعار والتطبيق مغلق', done: false, required: true },
                ],
              },
              {
                /* Overdue and not started — the honest kind of red. */
                ref: 'app-offline',
                title: 'العمل بدون إنترنت',
                description: 'حفظ آخر بيانات محمّلة وعرضها عند انقطاع الشبكة بدل شاشة خطأ فارغة.',
                statusKey: 'open',
                priority: 'high',
                startDay: -25,
                endDay: -6,
                estimatedHours: 40,
                progress: 0,
                assigneeRefs: ['karim'],
                billable: true,
                time: [],
                comments: [
                  { ref: 'karim', day: -8, body: 'ما بدأتش فيها لحد دلوقتي — كل الوقت راح في مساعدة طارق في الإشعارات.' },
                ],
                checklist: [],
              },
              {
                ref: 'app-qa',
                title: 'اختبار التطبيق على الأجهزة',
                description: 'اختبار على ستة أجهزة مختلفة، وتغطية مسارات الشراء الأساسية.',
                statusKey: 'open',
                priority: 'high',
                startDay: -12,
                endDay: 8,
                estimatedHours: 50,
                progress: 10,
                assigneeRefs: ['omar'],
                billable: true,
                time: [{ ref: 'omar', day: -5, hours: 5, notes: 'إعداد الأجهزة وخطة الاختبار.' }],
                comments: [],
                checklist: [],
              },
            ],
          },
        ],
      },
    ],
    dependencies: [
      { from: 'app-screens', to: 'app-auth', type: 'FS', lagDays: 0 },
      { from: 'app-auth', to: 'app-catalog', type: 'FS', lagDays: 0 },
      { from: 'app-catalog', to: 'app-push', type: 'FS', lagDays: 0 },
      { from: 'app-push', to: 'app-offline', type: 'SS', lagDays: 5 },
      { from: 'app-push', to: 'app-qa', type: 'FS', lagDays: 0 },
      { from: 'app-offline', to: 'app-qa', type: 'FS', lagDays: 0 },
    ],
    issues: [
      {
        ref: 'app-issue-1',
        title: 'التطبيق يُغلق فجأة عند فتح السلة على أندرويد ١٢',
        description:
          'خطوات التكرار: أضف ثلاثة منتجات أو أكثر ثم افتح السلة. يحدث دائمًا على أندرويد ١٢ فقط. سجلّ الأعطال يشير إلى قائمة صور فارغة.',
        severity: 'critical',
        priority: 'urgent',
        statusKey: 'in_progress',
        assigneeRef: 'karim',
        dueDay: -2,
        moduleAffected: 'السلة',
        reproducibility: 'always',
        classification: 'خطأ برمجي',
        affectedPhaseRef: 'app-build',
        comments: [
          { ref: 'omar', day: -6, body: 'اتكرّرت على جهازين مختلفين بنفس الخطوات. مرفق سجلّ العطل.' },
          { ref: 'karim', day: -4, body: 'المشكلة في منتج بدون صورة. بحطّ صورة بديلة وبراجع باقي الشاشات.' },
        ],
      },
      {
        ref: 'app-issue-2',
        title: 'الإشعارات لا تصل والتطبيق مغلق على iOS',
        description: 'الإشعار يظهر والتطبيق مفتوح فقط. عند إغلاقه تمامًا لا يصل شيء.',
        severity: 'major',
        priority: 'urgent',
        statusKey: 'open',
        assigneeRef: 'tarek',
        dueDay: 3,
        moduleAffected: 'الإشعارات',
        reproducibility: 'always',
        classification: 'خطأ برمجي',
        affectedPhaseRef: 'app-build',
        comments: [],
      },
      {
        ref: 'app-issue-3',
        title: 'أسماء المنتجات الطويلة تُقطع في بطاقة المنتج',
        description: 'الاسم الأطول من ثلاثين حرفًا يظهر مقطوعًا بدون علامة حذف.',
        severity: 'cosmetic',
        priority: 'low',
        statusKey: 'to_verify',
        assigneeRef: 'karim',
        dueDay: 10,
        moduleAffected: 'الكتالوج',
        reproducibility: 'always',
        classification: 'واجهة',
        affectedPhaseRef: 'app-build',
        comments: [],
      },
    ],
    documents: [
      {
        folder: 'تقارير',
        name: 'تقرير حالة المشروع — التأخير.md',
        description: 'التقرير المرسل للعميل بشأن تجاوز موعد التسليم.',
        body:
          '# تقرير حالة — تطبيق عيادات الحياة\n\nملف تجريبي أُنشئ مع البيانات التجريبية.\n\n## سبب التأخير\nمشكلة في شهادات الإشعارات على iOS استغرقت أسبوعين.\n\n## الأثر\nتأخير الإطلاق، والميزانية على حافة الحد المعتمد قبل انتهاء العمل.\n\n## الخطة\nإغلاق المشاكل الحرجة أولًا، ثم إنهاء العمل بدون إنترنت.\n',
      },
    ],
    baselines: [
      {
        ref: 'app-baseline',
        name: 'الخطة الأصلية المتفق عليها',
        notes: 'الجدول الزمني وقت التوقيع. الفرق بينه وبين الوضع الحالي هو حجم التأخير.',
        capturedDay: -118,
      },
    ],
  },

  /* ── 3. Finished, on time, under budget ───────────────────────── */
  {
    ref: 'campaign',
    key: 'HTKH',
    name: 'حملة تسويق الخريف',
    description:
      'حملة تسويق رقمي لمؤسسة بداية استمرت أربعة أشهر. اكتملت في موعدها وأُغلقت تحت الميزانية المعتمدة — المشروع المربح في هذه المجموعة.',
    color: '#16A34A',
    customerRef: 'bidaya',
    groupRef: 'delivery',
    ownerRef: 'nora',
    statusKey: 'completed',
    startDay: -150,
    endDay: -20,
    currency: 'EGP',
    billingMethod: 'fixed_cost',
    access: 'private',
    members: [
      { ref: 'nora', role: 'owner', allocation: 80 },
      { ref: 'salma', role: 'member', allocation: 40 },
      { ref: 'laila', role: 'manager', allocation: 20 },
      { ref: 'hala', role: 'member', allocation: 10 },
    ],
    tagRefs: ['web'],
    budgets: [
      { type: 'project_amount', amount: 180_000, thresholdPercent: 80 },
      { type: 'project_hours', hours: 320, thresholdPercent: 80 },
    ],
    expenses: [
      { description: 'إعلانات مدفوعة — سبتمبر', category: 'إعلانات', amount: 34_000, day: -120, billable: true },
      { description: 'إعلانات مدفوعة — أكتوبر', category: 'إعلانات', amount: 29_500, day: -90, billable: true },
      { description: 'تصوير فوتوغرافي للمنتجات', category: 'إنتاج', amount: 15_000, day: -135, billable: true },
    ],
    phases: [
      {
        ref: 'campaign-plan',
        name: 'التخطيط وإعداد المحتوى',
        description: 'رسائل الحملة، الجمهور المستهدف، وجدول النشر.',
        statusKey: 'completed',
        startDay: -150,
        endDay: -118,
        color: '#16A34A',
        ownerRef: 'nora',
        lists: [
          {
            ref: 'campaign-plan-list',
            name: 'الإعداد',
            description: '',
            tasks: [
              {
                ref: 'camp-strategy',
                title: 'وضع خطة الحملة وتحديد الجمهور',
                description: 'ثلاث شرائح مستهدفة، ورسالة لكل شريحة، وميزانية موزّعة على أربعة أشهر.',
                statusKey: 'done',
                priority: 'high',
                startDay: -150,
                endDay: -138,
                estimatedHours: 45,
                progress: 100,
                assigneeRefs: ['nora'],
                billable: true,
                time: [
                  { ref: 'nora', day: -148, hours: 7, notes: 'تحليل الجمهور.' },
                  { ref: 'nora', day: -143, hours: 8, notes: 'صياغة الرسائل.' },
                  { ref: 'nora', day: -139, hours: 6, notes: 'توزيع الميزانية.' },
                ],
                comments: [],
                checklist: [],
              },
              {
                ref: 'camp-content',
                title: 'إنتاج محتوى الحملة',
                description: 'أربعون تصميمًا وستة مقاطع قصيرة، بالعربية، جاهزة للنشر على ثلاث منصات.',
                statusKey: 'done',
                priority: 'normal',
                startDay: -137,
                endDay: -118,
                estimatedHours: 90,
                progress: 100,
                assigneeRefs: ['salma', 'nora'],
                billable: true,
                time: [
                  { ref: 'salma', day: -135, hours: 8, notes: 'تصاميم الأسبوع الأول والثاني.' },
                  { ref: 'salma', day: -130, hours: 8, notes: 'تصاميم الأسبوع الثالث.' },
                  { ref: 'nora', day: -126, hours: 7, notes: 'كتابة النصوص المصاحبة.' },
                  { ref: 'salma', day: -122, hours: 8, notes: 'المقاطع القصيرة.' },
                  { ref: 'nora', day: -119, hours: 6, notes: 'المراجعة النهائية.' },
                ],
                comments: [],
                checklist: [],
              },
            ],
          },
        ],
      },
      {
        ref: 'campaign-run',
        name: 'التنفيذ والقياس',
        description: 'النشر والمتابعة الأسبوعية، ثم تقرير الإغلاق.',
        statusKey: 'completed',
        startDay: -117,
        endDay: -20,
        color: '#16A34A',
        ownerRef: 'nora',
        lists: [
          {
            ref: 'campaign-run-list',
            name: 'التنفيذ',
            description: '',
            tasks: [
              {
                ref: 'camp-launch',
                title: 'إطلاق الحملة ومتابعتها الأسبوعية',
                description: 'نشر حسب الجدول، ومراجعة الأداء كل أسبوع مع تعديل التوزيع حسب النتائج.',
                statusKey: 'done',
                priority: 'high',
                startDay: -117,
                endDay: -40,
                estimatedHours: 110,
                progress: 100,
                assigneeRefs: ['nora'],
                billable: true,
                time: [
                  { ref: 'nora', day: -112, hours: 8, notes: 'الإطلاق والأسبوع الأول.' },
                  { ref: 'nora', day: -95, hours: 8, notes: 'مراجعة الشهر الأول وتعديل التوزيع.' },
                  { ref: 'nora', day: -75, hours: 8, notes: 'متابعة الشهر الثاني.' },
                  { ref: 'nora', day: -58, hours: 7.5, notes: 'متابعة الشهر الثالث.' },
                  { ref: 'nora', day: -43, hours: 7, notes: 'الأسابيع الأخيرة.' },
                ],
                comments: [],
                checklist: [],
              },
              {
                ref: 'camp-report',
                title: 'تقرير نتائج الحملة وتسليمه للعميل',
                description: 'تقرير نهائي بالأرقام: الوصول، التفاعل، والتحويلات، مع توصيات للحملة القادمة.',
                statusKey: 'done',
                priority: 'normal',
                startDay: -39,
                endDay: -20,
                estimatedHours: 40,
                progress: 100,
                assigneeRefs: ['nora', 'laila'],
                billable: true,
                time: [
                  { ref: 'nora', day: -35, hours: 8, notes: 'تجميع الأرقام.' },
                  { ref: 'nora', day: -28, hours: 7, notes: 'كتابة التقرير.' },
                  { ref: 'laila', day: -22, hours: 4, notes: 'مراجعة وتسليم.' },
                ],
                comments: [
                  { ref: 'laila', day: -20, body: 'الحملة اتقفلت تحت الميزانية وفي الموعد. العميل طلب عرض سعر لحملة الربيع.' },
                ],
                checklist: [],
              },
            ],
          },
        ],
      },
    ],
    dependencies: [
      { from: 'camp-strategy', to: 'camp-content', type: 'FS', lagDays: 0 },
      { from: 'camp-content', to: 'camp-launch', type: 'FS', lagDays: 0 },
      { from: 'camp-launch', to: 'camp-report', type: 'FS', lagDays: 0 },
    ],
    issues: [
      {
        ref: 'camp-issue-1',
        title: 'رابط العرض في منشور أكتوبر يفتح صفحة غير موجودة',
        description: 'الرابط المختصر كان يشير إلى صفحة حُذفت. صُحّح خلال ساعتين من اكتشافه.',
        severity: 'major',
        priority: 'high',
        statusKey: 'closed',
        assigneeRef: 'nora',
        dueDay: -88,
        moduleAffected: 'المنشورات',
        reproducibility: 'always',
        classification: 'محتوى',
        affectedPhaseRef: 'campaign-run',
        comments: [{ ref: 'nora', day: -88, body: 'اتصلّح والرابط بيشتغل. اتحطّت مراجعة للروابط قبل أي نشر.' }],
      },
    ],
    documents: [
      {
        folder: 'تقارير',
        name: 'تقرير نتائج الحملة الخريفية.md',
        description: 'التقرير النهائي المسلّم للعميل.',
        body:
          '# نتائج الحملة الخريفية\n\nملف تجريبي أُنشئ مع البيانات التجريبية.\n\n- المدة: أربعة أشهر\n- الحالة: اكتملت في الموعد\n- الميزانية: أُغلقت تحت المعتمد\n\n## التوصيات\nتكرار نفس التوزيع في حملة الربيع مع زيادة نصيب المحتوى المرئي.\n',
      },
    ],
    baselines: [
      {
        ref: 'camp-baseline',
        name: 'خطة الحملة المعتمدة',
        notes: 'اللقطة الأصلية. المشروع سلّم مطابقًا لها تقريبًا، وهو ما يفسّر خلوّ المقارنة من انحرافات كبيرة.',
        capturedDay: -148,
      },
    ],
  },

  /* ── 4. Just beginning — mostly empty, and correctly so ───────── */
  {
    ref: 'website',
    key: 'MWQE',
    name: 'إعادة تصميم موقع الشركة',
    // The company's own site, with no external customer — the one project where
    // the workspace administrator being a member reads as obvious.
    loaderIsMember: true,
    description:
      'إعادة تصميم موقع الشركة نفسها: هوية بصرية محدّثة، سرعة أعلى، ودعم كامل للعربية من اليمين إلى اليسار. لم يبدأ التنفيذ بعد — المشروع في مرحلة التخطيط والجدول الزمني موضوع مسبقًا.',
    color: '#7C3AED',
    customerRef: null,
    groupRef: 'internal',
    ownerRef: 'laila',
    statusKey: 'planning',
    /**
     * Starts next week, and nothing in it has been touched.
     *
     * This is the state most demos skip, and it is the one a new reader is most
     * likely to be in themselves: a plan exists, the work has not begun, and
     * every screen has to stay legible with zero progress on it. A project
     * where the Gantt draws bars nobody has started is worth more here than a
     * fifth busy project.
     */
    startDay: 7,
    endDay: 98,
    currency: 'EGP',
    billingMethod: 'based_on_project_hours',
    access: 'private',
    members: [
      { ref: 'laila', role: 'owner', allocation: 30 },
      { ref: 'salma', role: 'member', allocation: 50 },
      { ref: 'karim', role: 'member', allocation: 40 },
    ],
    tagRefs: ['web', 'internal'],
    budgets: [{ type: 'project_amount', amount: 220_000, thresholdPercent: 80 }],
    expenses: [],
    phases: [
      {
        ref: 'web-audit',
        name: 'المراجعة والتخطيط',
        description: 'قياس الوضع الحالي والاتفاق على أولويات التحسين.',
        statusKey: 'not_started',
        startDay: 7,
        endDay: 33,
        color: '#64748B',
        ownerRef: 'laila',
        lists: [
          {
            ref: 'web-audit-list',
            name: 'المراجعة',
            description: '',
            tasks: [
              {
                ref: 'web-audit-task',
                title: 'مراجعة الموقع الحالي وقياس سرعته',
                description: 'قياس سرعة التحميل على الجوال والحاسب، وحصر الصفحات التي تحتاج إعادة كتابة.',
                statusKey: 'open',
                priority: 'normal',
                startDay: 7,
                endDay: 21,
                estimatedHours: 35,
                progress: 0,
                assigneeRefs: ['karim'],
                billable: true,
                time: [],
                comments: [],
                checklist: [
                  { text: 'قياس السرعة على الجوال', done: false, required: false },
                  { text: 'حصر الصفحات المطلوب تحديثها', done: false, required: false },
                ],
              },
              {
                ref: 'web-content-plan',
                title: 'خطة المحتوى الجديد',
                description: 'تحديد الصفحات التي تُعاد كتابتها والصفحات التي تُدمج أو تُحذف.',
                statusKey: 'open',
                priority: 'normal',
                startDay: 22,
                endDay: 33,
                estimatedHours: 30,
                progress: 0,
                assigneeRefs: ['salma'],
                billable: true,
                time: [],
                comments: [],
                checklist: [],
              },
            ],
          },
        ],
      },
      {
        ref: 'web-build',
        name: 'التنفيذ',
        description: 'إعادة البناء والنشر.',
        statusKey: 'not_started',
        startDay: 34,
        endDay: 98,
        color: '#64748B',
        ownerRef: 'karim',
        lists: [
          {
            ref: 'web-build-list',
            name: 'التنفيذ',
            description: '',
            tasks: [
              {
                ref: 'web-rebuild',
                title: 'إعادة بناء الصفحات الأساسية',
                description: 'الصفحة الرئيسية وصفحات الخدمات وصفحة التواصل، بدعم كامل للعربية.',
                statusKey: 'open',
                priority: 'normal',
                startDay: 34,
                endDay: 73,
                estimatedHours: 120,
                progress: 0,
                assigneeRefs: ['karim', 'salma'],
                billable: true,
                time: [],
                comments: [],
                checklist: [],
              },
            ],
          },
        ],
      },
    ],
    dependencies: [
      { from: 'web-audit-task', to: 'web-content-plan', type: 'FS', lagDays: 0 },
      { from: 'web-content-plan', to: 'web-rebuild', type: 'FS', lagDays: 0 },
    ],
    /**
     * A project that has not started still has paperwork, and these three lists
     * were empty for the wrong reason.
     *
     * "Nothing has been worked on yet" is true of the *tasks* — no logged hours,
     * no progress, no closed anything — and that emptiness is the point of this
     * project. It is not true of the planning artefacts. A redesign that is
     * waiting on a start date has, in real life, a brief that somebody wrote, a
     * decision that is blocking it, and a schedule that was agreed before the
     * work was slotted in. Leaving these empty made three tabs read as broken
     * rather than as early.
     *
     * So each one is filled with the thing that genuinely exists *before*
     * kickoff, and nothing that would not: an open question rather than a
     * defect, a brief rather than a delivery note, and the agreed plan rather
     * than a revision of it.
     */
    issues: [
      {
        ref: 'web-issue-1',
        /**
         * Not a bug — a blocker, logged before anyone has written a line.
         * The issue tracker is where a project this early keeps the things it
         * is waiting on, and a demo that only ever shows defects teaches that
         * the module is a bug list.
         */
        title: 'الهوية البصرية الجديدة لم تُعتمد بعد',
        description:
          'التصميم متوقّف على اعتماد الهوية البصرية من الإدارة. كل شغل الواجهات مرتبط بها، ولو تأخر الاعتماد بعد تاريخ البدء يتزحزح الجدول كله بنفس المدة.',
        severity: 'major',
        priority: 'high',
        statusKey: 'open',
        assigneeRef: 'salma',
        dueDay: 5,
        moduleAffected: 'التصميم',
        // Null rather than one of the defect values: the column only accepts
        // always/sometimes/rarely/unable/not_tried, and none of them mean
        // anything about a pending approval. "Not tried" would read as though
        // somebody had failed to check.
        reproducibility: null,
        classification: 'اعتماد مطلوب',
        affectedPhaseRef: 'web-audit',
        comments: [
          {
            ref: 'laila',
            day: -3,
            body: 'اتبعت الملف للإدارة يوم الأحد. لو مافيش رد قبل تاريخ البدء هنأجّل مرحلة التصميم أسبوع.',
          },
        ],
      },
    ],
    documents: [
      {
        folder: 'التخطيط',
        name: 'موجز إعادة التصميم.md',
        description: 'المستند اللي اتوافق عليه قبل جدولة المشروع.',
        body:
          '# موجز إعادة تصميم موقع الشركة\n\nملف تجريبي أُنشئ مع البيانات التجريبية.\n\n## لماذا الآن\n- الموقع الحالي بطيء على الجوال\n- الهوية البصرية اتغيّرت ولم تنعكس على الموقع\n- دعم العربية من اليمين لليسار ناقص في صفحات الخدمات\n\n## ما الذي يعتبر نجاحًا\n- زمن تحميل أقل من ثانيتين على الجوال\n- كل الصفحات الأساسية بالعربية والإنجليزية\n\n## خارج النطاق\n- المدوّنة\n- بوابة العملاء\n',
      },
    ],
    /**
     * One baseline, captured before the work starts.
     *
     * This is the only project here whose baseline should show *zero* variance,
     * and that is worth showing on purpose: it is what the comparison view looks
     * like on a plan nothing has happened to yet, so a reader learns to read the
     * variance columns from the case where the answer is "none".
     */
    baselines: [
      {
        ref: 'web-baseline',
        name: 'الجدول المعتمد قبل البدء',
        notes: 'اللقطة وقت اعتماد الخطة. لم يبدأ التنفيذ بعد، فالمقارنة مع الوضع الحالي بدون انحراف — وهذا هو المتوقّع.',
        capturedDay: -4,
      },
    ],
  },

  /* ── 5. Paused, and saying why ────────────────────────────────── */
  {
    /**
     * On hold is not the same as late and not the same as cancelled, and it is
     * the state a portfolio screen most often gets wrong: work stopped for a
     * reason outside the team, dates that are now meaningless, and a budget
     * that is neither spent nor released.
     *
     * Half of it was built before the stop, so the progress figure is real —
     * a paused project at 45% is a very different conversation from a paused
     * project at 5%, and the demo should show which one this is.
     */
    ref: 'inventory',
    key: 'MKHZ',
    name: 'نظام إدارة المخزون',
    description:
      'نظام لإدارة المخزون والمستودعات لشركة الأفق للتجارة. متوقّف مؤقتًا بناءً على طلب العميل لحين اعتماد ميزانية السنة المالية الجديدة — الشغل المنجَز محفوظ والفريق أُعيد توزيعه على مشاريع أخرى.',
    color: '#F59E0B',
    customerRef: 'ufuq',
    groupRef: 'delivery',
    ownerRef: 'laila',
    statusKey: 'on_hold',
    startDay: -95,
    endDay: 45,
    currency: 'EGP',
    billingMethod: 'based_on_project_hours',
    access: 'private',
    members: [
      { ref: 'laila', role: 'owner', allocation: 10 },
      { ref: 'tarek', role: 'member', allocation: 0 },
      { ref: 'omar', role: 'member', allocation: 0 },
    ],
    tagRefs: ['internal', 'client-waiting'],
    budgets: [
      { type: 'project_amount', amount: 260_000, thresholdPercent: 80 },
      { type: 'project_hours', hours: 520, thresholdPercent: 80 },
    ],
    expenses: [
      { description: 'ترخيص قارئ الباركود — سنة', category: 'تراخيص', amount: 14_500, day: -80, billable: true },
    ],
    phases: [
      {
        ref: 'inv-core',
        name: 'الوحدة الأساسية',
        description: 'أصناف المخزون، المستودعات، وحركات الإدخال والإخراج.',
        statusKey: 'completed',
        startDay: -95,
        endDay: -48,
        color: '#16A34A',
        ownerRef: 'tarek',
        lists: [
          {
            ref: 'inv-core-list',
            name: 'الأساسيات',
            description: '',
            tasks: [
              {
                ref: 'inv-items',
                title: 'إدارة الأصناف والمستودعات',
                description: 'إضافة الأصناف، تصنيفها، وتوزيعها على المستودعات مع رصيد افتتاحي لكل صنف.',
                statusKey: 'done',
                priority: 'high',
                startDay: -95,
                endDay: -70,
                estimatedHours: 90,
                progress: 100,
                assigneeRefs: ['tarek'],
                billable: true,
                time: [
                  { ref: 'tarek', day: -92, hours: 8, notes: 'جدول الأصناف والتصنيفات.' },
                  { ref: 'tarek', day: -86, hours: 8, notes: 'المستودعات والأرصدة الافتتاحية.' },
                  { ref: 'tarek', day: -78, hours: 7.5, notes: 'شاشات الإدخال.' },
                  { ref: 'tarek', day: -72, hours: 6, notes: 'مراجعة وتصحيح.' },
                ],
                comments: [],
                checklist: [],
              },
              {
                ref: 'inv-moves',
                title: 'حركات الإدخال والإخراج',
                description: 'تسجيل الوارد والمنصرف مع سند لكل حركة، وأثر مباشر على الرصيد.',
                statusKey: 'done',
                priority: 'high',
                startDay: -69,
                endDay: -48,
                estimatedHours: 75,
                progress: 100,
                assigneeRefs: ['tarek'],
                billable: true,
                time: [
                  { ref: 'tarek', day: -66, hours: 8, notes: 'سندات الوارد.' },
                  { ref: 'tarek', day: -58, hours: 8, notes: 'سندات الصرف.' },
                  { ref: 'tarek', day: -50, hours: 7, notes: 'ربط الحركات بالرصيد.' },
                ],
                comments: [],
                checklist: [],
              },
            ],
          },
        ],
      },
      {
        ref: 'inv-reports',
        name: 'التقارير والجرد',
        description: 'تقارير الأرصدة والجرد الدوري. متوقّفة مع توقّف المشروع.',
        statusKey: 'not_started',
        startDay: -47,
        endDay: 45,
        color: '#F59E0B',
        ownerRef: 'omar',
        lists: [
          {
            ref: 'inv-reports-list',
            name: 'التقارير',
            description: '',
            tasks: [
              {
                ref: 'inv-stock-report',
                title: 'تقرير أرصدة المخزون',
                description: 'رصيد كل صنف في كل مستودع، مع إمكانية التصدير.',
                statusKey: 'open',
                priority: 'normal',
                startDay: -47,
                endDay: -20,
                estimatedHours: 45,
                progress: 20,
                assigneeRefs: ['tarek'],
                billable: true,
                time: [{ ref: 'tarek', day: -45, hours: 6, notes: 'هيكل التقرير قبل التوقّف.' }],
                comments: [
                  {
                    ref: 'laila',
                    day: -44,
                    body: 'العميل طلب إيقاف الشغل مؤقتًا لحين اعتماد ميزانية السنة الجديدة. بنسيب المهمة مفتوحة زي ما هي عشان نكمّل من نفس النقطة.',
                  },
                ],
                checklist: [],
              },
              {
                ref: 'inv-stocktake',
                title: 'شاشة الجرد الدوري',
                description: 'جرد فعلي مقابل الرصيد الدفتري، مع تسوية الفروق.',
                statusKey: 'open',
                priority: 'normal',
                startDay: -19,
                endDay: 45,
                estimatedHours: 60,
                progress: 0,
                assigneeRefs: ['omar'],
                billable: true,
                time: [],
                comments: [],
                checklist: [],
              },
            ],
          },
        ],
      },
    ],
    dependencies: [
      { from: 'inv-items', to: 'inv-moves', type: 'FS', lagDays: 0 },
      { from: 'inv-moves', to: 'inv-stock-report', type: 'FS', lagDays: 0 },
      { from: 'inv-stock-report', to: 'inv-stocktake', type: 'FS', lagDays: 0 },
    ],
    issues: [
      {
        ref: 'inv-issue-1',
        title: 'الرصيد لا يتحدّث فورًا بعد سند صرف كبير',
        description:
          'خطوات التكرار: اصرف أكثر من مئتي صنف في سند واحد. الرصيد يتأخر في التحديث حتى إعادة فتح الشاشة.',
        severity: 'major',
        priority: 'normal',
        statusKey: 'open',
        assigneeRef: 'tarek',
        dueDay: 30,
        moduleAffected: 'حركات المخزون',
        reproducibility: 'sometimes',
        classification: 'أداء',
        affectedPhaseRef: 'inv-core',
        comments: [],
      },
    ],
    documents: [
      {
        folder: 'مستندات العميل',
        name: 'محضر إيقاف مؤقت.md',
        description: 'المحضر المتفق عليه مع العميل عند إيقاف المشروع.',
        body:
          '# محضر إيقاف مؤقت — نظام إدارة المخزون\n\nملف تجريبي أُنشئ مع البيانات التجريبية.\n\n## السبب\nانتظار اعتماد ميزانية السنة المالية الجديدة لدى العميل.\n\n## الوضع عند الإيقاف\n- الوحدة الأساسية: مكتملة ومسلّمة\n- التقارير والجرد: لم تكتمل\n\n## عند الاستئناف\nيُستأنف من تقرير الأرصدة بنفس النطاق المتفق عليه.\n',
      },
    ],
    baselines: [
      {
        ref: 'inv-baseline',
        name: 'الخطة المعتمدة قبل الإيقاف',
        notes: 'لقطة الجدول الزمني وقت توقيع العقد، محفوظة للمقارنة عند استئناف المشروع.',
        capturedDay: -90,
      },
    ],
  },

  /* ── 6. Archived — finished, closed, and out of the way ───────── */
  {
    /**
     * The projects list has five tabs, and two of them were empty.
     *
     * Active, Mine and Favorites all had rows. Archived and Recycle bin showed
     * their empty states — which is a fair rendering of an empty tab and a poor
     * demonstration of the product, because the question a reader has at that
     * point is "does archiving work", and an empty state answers "there is
     * nothing here" rather than "here is what it looks like".
     *
     * This one is deliberately last year's work: delivered, paid, closed, and
     * archived four months ago. Short, because an archived project is read as a
     * record rather than worked in — two phases, three tasks, all closed, and
     * the paperwork that proves it finished.
     */
    ref: 'booking',
    key: 'HJZE',
    name: 'بوابة الحجز الإلكتروني',
    description:
      'بوابة حجز مواعيد أونلاين لعيادات الحياة، سُلّمت واستُلمت رسميًا. المشروع مؤرشف بعد إغلاق الحساب — محفوظ للرجوع إليه، وخارج قائمة المشاريع النشطة.',
    color: '#0E7490',
    customerRef: 'hayat',
    groupRef: 'delivery',
    ownerRef: 'laila',
    statusKey: 'completed',
    startDay: -330,
    endDay: -210,
    currency: 'EGP',
    billingMethod: 'fixed_cost',
    access: 'private',
    // Archived, not deleted: it keeps its place in reports and its rows stay
    // readable — it simply leaves the active list. The loader reads this.
    lifecycle: { state: 'archived', day: -120 },
    members: [
      { ref: 'laila', role: 'owner', allocation: 20 },
      { ref: 'tarek', role: 'member', allocation: 60 },
      { ref: 'omar', role: 'member', allocation: 30 },
    ],
    tagRefs: ['web'],
    budgets: [
      { type: 'project_amount', amount: 180_000, thresholdPercent: 80 },
      { type: 'project_hours', hours: 300, thresholdPercent: 80 },
    ],
    expenses: [
      { description: 'رسوم بوابة الرسائل القصيرة', category: 'اشتراكات', amount: 7_400, day: -300, billable: true },
    ],
    phases: [
      {
        ref: 'booking-build',
        name: 'البناء والتسليم',
        description: 'بناء شاشة الحجز وربطها بجدول العيادات، ثم التسليم.',
        statusKey: 'completed',
        startDay: -330,
        endDay: -240,
        color: '#16A34A',
        ownerRef: 'tarek',
        lists: [
          {
            ref: 'booking-build-list',
            name: 'التنفيذ',
            description: '',
            tasks: [
              {
                ref: 'booking-slots',
                title: 'شاشة اختيار الموعد',
                description: 'عرض المواعيد المتاحة لكل طبيب وحجزها مباشرة، مع تأكيد برسالة قصيرة.',
                statusKey: 'done',
                priority: 'high',
                startDay: -330,
                endDay: -290,
                estimatedHours: 90,
                progress: 100,
                assigneeRefs: ['tarek'],
                billable: true,
                time: [
                  { ref: 'tarek', day: -325, hours: 7, notes: 'بناء شاشة المواعيد.' },
                  { ref: 'tarek', day: -318, hours: 6.5, notes: 'ربط الحجز بجدول الأطباء.' },
                  { ref: 'tarek', day: -300, hours: 6, notes: 'تأكيد الحجز برسالة قصيرة.' },
                ],
                comments: [
                  { ref: 'laila', day: -295, body: 'اتراجعت مع العيادة والشاشة معتمدة. باقي الاختبار النهائي.' },
                ],
                checklist: [
                  { text: 'عرض المواعيد المتاحة', done: true, required: true },
                  { text: 'رسالة تأكيد الحجز', done: true, required: true },
                ],
              },
              {
                ref: 'booking-qa',
                title: 'اختبار القبول مع العيادة',
                description: 'جلسة اختبار قبول مع فريق الاستقبال قبل التشغيل الفعلي.',
                statusKey: 'done',
                priority: 'normal',
                startDay: -285,
                endDay: -260,
                estimatedHours: 45,
                progress: 100,
                assigneeRefs: ['omar'],
                billable: true,
                time: [
                  { ref: 'omar', day: -280, hours: 5, notes: 'سيناريوهات الاختبار مع فريق الاستقبال.' },
                  { ref: 'omar', day: -268, hours: 4.5, notes: 'إعادة اختبار بعد إصلاح الملاحظات.' },
                ],
                comments: [],
                checklist: [{ text: 'توقيع محضر القبول', done: true, required: true }],
              },
            ],
          },
        ],
      },
      {
        ref: 'booking-handover',
        name: 'التسليم والإغلاق',
        description: 'تسليم المصادر، تدريب الفريق، وإغلاق الحساب.',
        statusKey: 'completed',
        startDay: -259,
        endDay: -210,
        color: '#16A34A',
        ownerRef: 'laila',
        lists: [
          {
            ref: 'booking-handover-list',
            name: 'الإغلاق',
            description: '',
            tasks: [
              {
                ref: 'booking-training',
                title: 'تدريب فريق العيادة وتسليم المصادر',
                description: 'جلسة تدريب لفريق الاستقبال، وتسليم كود المشروع ووثائق التشغيل.',
                statusKey: 'done',
                priority: 'normal',
                startDay: -259,
                endDay: -215,
                estimatedHours: 30,
                progress: 100,
                assigneeRefs: ['laila'],
                billable: true,
                time: [{ ref: 'laila', day: -240, hours: 5, notes: 'جلسة التدريب وتسليم الوثائق.' }],
                comments: [],
                checklist: [],
              },
            ],
          },
        ],
      },
    ],
    dependencies: [
      { from: 'booking-slots', to: 'booking-qa', type: 'FS', lagDays: 0 },
      { from: 'booking-qa', to: 'booking-training', type: 'FS', lagDays: 0 },
    ],
    issues: [
      {
        ref: 'booking-issue-1',
        title: 'رسالة التأكيد تصل بتوقيت غير محلي',
        description: 'وقت الموعد في رسالة التأكيد كان بتوقيت الخادم بدل توقيت القاهرة. أُصلح قبل التسليم.',
        severity: 'minor',
        priority: 'normal',
        statusKey: 'closed',
        assigneeRef: 'tarek',
        dueDay: -270,
        moduleAffected: 'الإشعارات',
        reproducibility: 'always',
        classification: 'خطأ برمجي',
        affectedPhaseRef: 'booking-build',
        comments: [],
      },
    ],
    documents: [
      {
        folder: 'الإغلاق',
        name: 'محضر التسليم النهائي.md',
        description: 'محضر الاستلام الموقّع من العيادة.',
        body:
          '# محضر التسليم النهائي — بوابة الحجز الإلكتروني\n\nملف تجريبي أُنشئ مع البيانات التجريبية.\n\n## ما تم تسليمه\n- بوابة حجز المواعيد\n- لوحة إدارة جدول الأطباء\n- وثائق التشغيل وتدريب الفريق\n\n## الحالة\nمستلَم ومغلق. المشروع مؤرشف.\n',
      },
    ],
    baselines: [
      {
        ref: 'booking-baseline',
        name: 'الخطة المعتمدة',
        notes: 'اللقطة وقت التوقيع. سُلّم المشروع قريبًا منها.',
        capturedDay: -328,
      },
    ],
  },

  /* ── 7. In the recycle bin — cancelled, recoverable ───────────── */
  {
    /**
     * Deleted is not archived, and the difference is the whole reason both tabs
     * exist: an archived project is finished, a trashed one was a mistake or a
     * cancellation, and only the second one can be restored or purged.
     *
     * Cancelled before any work started, which is the honest shape for a
     * trashed project — one that had logged hours and closed tasks in it would
     * raise the question of where that work went. There is a plan here and
     * nothing else, and the reason it was cancelled is in the description where
     * somebody looking through the bin can read it.
     */
    ref: 'loyalty',
    key: 'WLAA',
    name: 'برنامج نقاط الولاء',
    description:
      'برنامج نقاط ولاء لعملاء شركة الأفق. أُلغي قبل بدء التنفيذ بعد قرار تأجيل التوسّع، ونُقل لسلة المحذوفات — يمكن استرجاعه لو أُعيد اعتماده.',
    color: '#94A3B8',
    customerRef: 'ufuq',
    groupRef: 'delivery',
    ownerRef: 'laila',
    statusKey: 'cancelled',
    startDay: -45,
    endDay: 40,
    currency: 'EGP',
    billingMethod: 'based_on_project_hours',
    access: 'private',
    // Soft-deleted, and therefore restorable. Everything below still exists in
    // the database; the recycle bin is a filter, not an eraser.
    lifecycle: { state: 'trashed', day: -18 },
    members: [
      { ref: 'laila', role: 'owner', allocation: 10 },
      { ref: 'nora', role: 'member', allocation: 20 },
    ],
    tagRefs: ['internal'],
    budgets: [{ type: 'project_amount', amount: 95_000, thresholdPercent: 80 }],
    expenses: [],
    phases: [
      {
        ref: 'loyalty-scope',
        name: 'دراسة الجدوى',
        description: 'تقدير التكلفة والعائد قبل اعتماد التنفيذ.',
        statusKey: 'not_started',
        startDay: -45,
        endDay: -20,
        color: '#94A3B8',
        ownerRef: 'nora',
        lists: [
          {
            ref: 'loyalty-scope-list',
            name: 'الدراسة',
            description: '',
            tasks: [
              {
                ref: 'loyalty-study',
                title: 'دراسة جدوى برنامج النقاط',
                description: 'تقدير تكلفة التنفيذ والعائد المتوقّع، ومقارنة بثلاثة برامج مشابهة في السوق.',
                statusKey: 'open',
                priority: 'low',
                startDay: -45,
                endDay: -20,
                estimatedHours: 25,
                progress: 0,
                assigneeRefs: ['nora'],
                billable: false,
                time: [],
                comments: [],
                checklist: [],
              },
            ],
          },
        ],
      },
    ],
    dependencies: [],
    issues: [],
    documents: [],
    baselines: [],
  },
];

/** Everything the loader will create, counted before it starts. */
export function blueprintTotals() {
  let phases = 0;
  let lists = 0;
  let tasks = 0;
  let issues = 0;
  let timeEntries = 0;
  let comments = 0;
  let documents = 0;
  let dependencies = 0;

  for (const project of PROJECTS) {
    phases += project.phases.length;
    issues += project.issues.length;
    documents += project.documents.length;
    dependencies += project.dependencies.length;
    comments += project.issues.reduce((sum, issue) => sum + issue.comments.length, 0);
    for (const phase of project.phases) {
      lists += phase.lists.length;
      for (const list of phase.lists) {
        tasks += list.tasks.length;
        for (const task of list.tasks) {
          timeEntries += task.time.length;
          comments += task.comments.length;
        }
      }
    }
  }

  return {
    people: PEOPLE.length,
    customers: CUSTOMERS.length,
    projects: PROJECTS.length,
    phases,
    taskLists: lists,
    tasks,
    issues,
    timeEntries,
    comments,
    documents,
    dependencies,
  };
}
