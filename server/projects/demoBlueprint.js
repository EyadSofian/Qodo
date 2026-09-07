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
    department: 'general',
    avatarColor: '#1D6FB8',
    costRate: 320,
    billRate: 560,
  },
  {
    ref: 'karim',
    name: 'كريم عبد الرحمن',
    title: 'مطوّر واجهات أمامية',
    department: 'general',
    avatarColor: '#7C3AED',
    costRate: 240,
    billRate: 430,
  },
  {
    ref: 'salma',
    name: 'سلمى الشريف',
    title: 'مصمّمة تجربة مستخدم',
    department: 'general',
    avatarColor: '#F5821F',
    costRate: 230,
    billRate: 410,
  },
  {
    ref: 'tarek',
    name: 'طارق الحسيني',
    title: 'مطوّر خلفي',
    department: 'general',
    avatarColor: '#0E385E',
    costRate: 265,
    billRate: 470,
  },
  {
    ref: 'nora',
    name: 'نورا فتحي',
    title: 'أخصائية تسويق رقمي',
    department: 'general',
    avatarColor: '#16A34A',
    costRate: 195,
    billRate: 350,
  },
  {
    ref: 'omar',
    name: 'عمر الديب',
    title: 'مهندس اختبار وجودة',
    department: 'general',
    avatarColor: '#DC2626',
    costRate: 210,
    billRate: 380,
  },
];

/* ------------------------------------------------------------------ */
/* Clients                                                              */
/* ------------------------------------------------------------------ */

/**
 * Two clients rather than one.
 *
 * With a single client the customer column is the same word on every row and
 * the reader learns nothing from it — including that it is a filter.
 *
 * Both use the reserved `.invalid` top-level domain (RFC 2606), which can never
 * be registered. A demo address that could one day become a real mailbox is a
 * notification waiting to be sent to a stranger.
 */
export const CUSTOMERS = [
  {
    ref: 'nour',
    name: 'شركة النور الرقمية',
    kind: 'business',
    email: 'projects@al-nour-digital.invalid',
    phone: '+20 2 2555 0100',
    website: 'https://al-nour-digital.invalid',
    address: 'التجمّع الخامس، القاهرة الجديدة',
    notes: 'عميل تجريبي. حساب توضيحي أُنشئ من زر «تحميل بيانات تجريبية».',
  },
  {
    ref: 'waha',
    name: 'مجموعة الواحة التجارية',
    kind: 'business',
    email: 'marketing@al-waha-group.invalid',
    phone: '+20 3 4877 0200',
    website: 'https://al-waha-group.invalid',
    address: 'سموحة، الإسكندرية',
    notes: 'عميل تجريبي. حساب توضيحي أُنشئ من زر «تحميل بيانات تجريبية».',
  },
];

/** One group, so the portfolio screen has something to group by. */
export const GROUPS = [
  {
    ref: 'delivery',
    nameAr: 'مشاريع العملاء',
    nameEn: 'Client delivery',
    description: 'المشاريع المنفّذة لحساب عملاء خارجيين.',
    color: '#1D6FB8',
  },
];

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
    description:
      'بناء متجر إلكتروني متكامل لشركة النور الرقمية: كتالوج المنتجات، سلة الشراء، بوابة الدفع، ولوحة تحكم للطلبات. الهدف هو الإطلاق قبل موسم الشتاء.',
    color: '#1D6FB8',
    customerRef: 'nour',
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
    ],
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
  },

  /* ── 2. Late, over budget, and honest about it ────────────────── */
  {
    ref: 'app',
    key: 'TTBQ',
    name: 'تطوير تطبيق موبايل',
    description:
      'تطبيق جوال لشركة النور الرقمية على أندرويد و iOS. المشروع متعثّر: تجاوز موعد التسليم، والميزانية استُهلكت بالكامل، وما زالت هناك مهام مفتوحة ومشاكل حرجة.',
    color: '#DC2626',
    customerRef: 'nour',
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
          '# تقرير حالة — تطوير تطبيق موبايل\n\nملف تجريبي أُنشئ مع البيانات التجريبية.\n\n## سبب التأخير\nمشكلة في شهادات الإشعارات على iOS استغرقت أسبوعين.\n\n## الأثر\nتأخير الإطلاق، واستهلاك الميزانية بالكامل قبل انتهاء العمل.\n\n## الخطة\nإغلاق المشاكل الحرجة أولًا، ثم إنهاء العمل بدون إنترنت.\n',
      },
    ],
  },

  /* ── 3. Finished, on time, under budget ───────────────────────── */
  {
    ref: 'campaign',
    key: 'HTKH',
    name: 'حملة تسويق خريفية',
    description:
      'حملة تسويق رقمي لمجموعة الواحة التجارية استمرت أربعة أشهر. اكتملت في موعدها وأُغلقت تحت الميزانية المعتمدة.',
    color: '#16A34A',
    customerRef: 'waha',
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
    ],
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
  },

  /* ── 4. Just beginning — mostly empty, and correctly so ───────── */
  {
    ref: 'website',
    key: 'THMW',
    name: 'تحسين موقع الشركة',
    description:
      'تجديد موقع شركة النور الرقمية: سرعة أعلى، محتوى محدّث، ودعم كامل للعربية من اليمين إلى اليسار. المشروع في بدايته.',
    color: '#7C3AED',
    customerRef: 'nour',
    groupRef: 'delivery',
    ownerRef: 'laila',
    statusKey: 'planning',
    startDay: -6,
    endDay: 85,
    currency: 'EGP',
    billingMethod: 'based_on_project_hours',
    access: 'private',
    members: [
      { ref: 'laila', role: 'owner', allocation: 30 },
      { ref: 'salma', role: 'member', allocation: 50 },
      { ref: 'karim', role: 'member', allocation: 40 },
    ],
    budgets: [{ type: 'project_amount', amount: 220_000, thresholdPercent: 80 }],
    expenses: [],
    phases: [
      {
        ref: 'web-audit',
        name: 'المراجعة والتخطيط',
        description: 'قياس الوضع الحالي والاتفاق على أولويات التحسين.',
        statusKey: 'in_progress',
        startDay: -6,
        endDay: 20,
        color: '#1D6FB8',
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
                statusKey: 'in_progress',
                priority: 'normal',
                startDay: -6,
                endDay: 8,
                estimatedHours: 35,
                progress: 30,
                assigneeRefs: ['karim'],
                billable: true,
                time: [{ ref: 'karim', day: -3, hours: 6, notes: 'قياس السرعة وتسجيل النتائج.' }],
                comments: [],
                checklist: [
                  { text: 'قياس السرعة على الجوال', done: true, required: false },
                  { text: 'حصر الصفحات المطلوب تحديثها', done: false, required: false },
                ],
              },
              {
                ref: 'web-content-plan',
                title: 'خطة المحتوى الجديد',
                description: 'تحديد الصفحات التي تُعاد كتابتها والصفحات التي تُدمج أو تُحذف.',
                statusKey: 'open',
                priority: 'normal',
                startDay: 9,
                endDay: 20,
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
        description: 'إعادة البناء والنشر. لم تبدأ بعد.',
        statusKey: 'not_started',
        startDay: 21,
        endDay: 85,
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
                startDay: 21,
                endDay: 60,
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
    issues: [],
    documents: [],
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
