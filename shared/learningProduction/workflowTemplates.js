/**
 * E-Learning Production — the workflow templates.
 *
 * Three ways a production run can go, taken from the business's workbook
 * ("Content Development Checklists.xlsx", copied row by row into
 * workbookSource.js):
 *
 *   AI_NEW      A — a new program built with AI tools, human-reviewed.
 *   EXPERT_NEW  B1 — a new program built by people and a contracted expert.
 *   REVAMP      B2 — a revamp of an existing program's release.
 *
 * Every stage, task and checklist item says where it came from:
 *
 *   WORKBOOK         a visible row of the workbook (cited by sheet and row);
 *   WORKBOOK_HIDDEN  a hidden row, activated deliberately (see OPTIONS);
 *   OLD_PROMPT       the original production-manager brief (the lesson
 *                    asset pipeline: Outline → PPT → Script → Voice → Video);
 *   PROPOSED         a product proposal where the workbook is silent. These
 *                    are labelled as proposals in the interface and listed in
 *                    OPEN_DECISIONS for the business owner to confirm.
 *
 * A template is code, but a run never reads code: when a run starts it is
 * pinned to a *published template version* — the output of `buildTemplate`
 * frozen in the database — so editing this file (or publishing new options)
 * never rewrites work already in progress.
 *
 * Keys are stable and language-neutral. Labels are `{ en, ar }` pairs, kept
 * apart from anything a user writes.
 */

import { workbookRow } from './workbookSource.js';

export const TEMPLATE_CODE_VERSION = 1;

export const SCENARIOS = /** @type {const} */ (['AI_NEW', 'EXPERT_NEW', 'REVAMP']);
/** Every run's scenario, including the compatibility state existing courses were migrated into. */
export const RUN_SCENARIOS = /** @type {const} */ ([...SCENARIOS, 'LEGACY']);

const L = (en, ar) => ({ en, ar });

/* ------------------------------------------------------------------ */
/* Sheets                                                               */
/* ------------------------------------------------------------------ */

export const SHEETS = /** @type {const} */ ({
  MASTER: 'Content Development Activities',
  RESEARCH: 'Research',
  DRAFT: '1st Draft Curriculum',
  EXPERTS: 'Experts and Coaches Acquisition',
  FINAL: 'Final Curriculum Details',
  ID: 'Instruction Designing',
  MEDIA: 'Media Production',
  DEPLOY: 'Platform Deployment',
  DRY_RUN: 'First Dry Run',
  REDEPLOY: 'Platform Deployment After Chang',
  UAT: 'User Acceptance Test',
});

/* ------------------------------------------------------------------ */
/* Builders                                                             */
/* ------------------------------------------------------------------ */

/** The origin of a cited row: hidden rows are marked as such, automatically. */
function rowOrigin(sheet, rows) {
  const hidden = rows.some((row) => workbookRow(sheet, row)?.hidden);
  return hidden ? 'WORKBOOK_HIDDEN' : 'WORKBOOK';
}

/** A checklist item from one workbook row. `required: false` makes it conditional within its task. */
function item(sheet, row, en, ar, extra = {}) {
  const found = workbookRow(sheet, row);
  if (!found) throw new Error(`[workflowTemplates] ${sheet} r${row} is not in the workbook source`);
  return {
    key: `r${row}`,
    label: L(en, ar),
    origin: rowOrigin(sheet, [row]),
    source: { sheet, rows: [row], text: found.text },
    required: extra.required ?? true,
    ...(extra.group ? { group: L(extra.group.en, extra.group.ar) } : {}),
    ...(extra.group?.row ? { groupSource: { sheet, rows: [extra.group.row], text: workbookRow(sheet, extra.group.row)?.text ?? null } } : {}),
    ...(extra.note ? { note: extra.note } : {}),
  };
}

/** A checklist item the workbook does not supply. */
function proposed(key, en, ar, extra = {}) {
  return {
    key,
    label: L(en, ar),
    origin: 'PROPOSED',
    source: extra.source ?? null,
    required: extra.required ?? true,
    ...(extra.group ? { group: extra.group } : {}),
    ...(extra.note ? { note: extra.note } : {}),
  };
}

/**
 * A task. `rows` cites the heading(s) it came from; the origin is derived from
 * them unless given. `kind`:
 *
 *   WORK     somebody does it and marks it done (or submits it for approval);
 *   REVIEW   somebody reviews something and records the outcome;
 *   HANDOFF  work handed to an external tool or team, with evidence of it;
 *   ISSUES   a review whose findings are logged as tracked issues;
 *   SIGNOFF  a named person signs off a result;
 *   AUTO     a gate the system computes from the lesson assets, issues or
 *            releases. Nobody ticks it; it is true or it is not.
 */
function task(key, spec) {
  const origin = spec.origin ?? (spec.sheet && spec.rows?.length ? rowOrigin(spec.sheet, spec.rows) : 'PROPOSED');
  return {
    key,
    label: spec.label,
    description: spec.description ?? null,
    kind: spec.kind ?? 'WORK',
    classification: spec.classification ?? 'REQUIRED',
    condition: spec.condition ?? null,
    role: spec.role ?? null,
    reviewerRole: spec.requiresApproval ? spec.reviewerRole ?? 'PRODUCTION_MANAGER' : null,
    requiresApproval: Boolean(spec.requiresApproval),
    approvalOrigin: spec.requiresApproval ? spec.approvalOrigin ?? origin : null,
    requiresEvidence: Boolean(spec.evidence),
    evidenceLabel: spec.evidence ?? null,
    sensitive: Boolean(spec.sensitive),
    externalTool: spec.externalTool ?? null,
    rule: spec.rule ?? null,
    after: spec.after ?? [],
    origin,
    source: spec.sheet ? { sheet: spec.sheet, rows: spec.rows ?? [], ...(spec.also ? { also: spec.also } : {}) } : spec.source ?? null,
    note: spec.note ?? null,
    checklist: spec.checklist ?? [],
  };
}

function stage(key, spec) {
  return {
    key,
    label: spec.label,
    description: spec.description ?? null,
    origin: spec.origin ?? 'WORKBOOK',
    source: spec.source ?? null,
    after: spec.after ?? [],
    ownerRole: spec.ownerRole ?? 'PRODUCTION_MANAGER',
    skippable: spec.skippable ?? null,
    issueLog: Boolean(spec.issueLog),
    lessonAssets: Boolean(spec.lessonAssets),
    note: spec.note ?? null,
    tasks: spec.tasks,
  };
}

/** Where a stage sits in the master sheet, cited by path, row and cells. */
const master = (path, row, cells, activityId, label, note) => ({
  sheet: SHEETS.MASTER,
  path,
  row,
  cells,
  activityId,
  label,
  ...(note ? { note } : {}),
});

/* ------------------------------------------------------------------ */
/* Research                                                             */
/* ------------------------------------------------------------------ */

const R = SHEETS.RESEARCH;

function researchStage(source) {
  return stage('RESEARCH', {
    label: L('Research', 'البحث'),
    description: L(
      'Define the field, audience, outcomes, duration and workload; study the competition; outline the journey and tools; hand the findings to instructional design.',
      'تحديد المجال والجمهور والمخرجات والمدة وعبء العمل، ودراسة المنافسين، ورسم الخطوط العريضة للرحلة والأدوات، ثم تسليم النتائج لفريق التصميم التعليمي.'
    ),
    source,
    ownerRole: 'RESEARCHER',
    tasks: [
      task('research.define', {
        label: L('Define the program', 'تعريف البرنامج'),
        role: 'RESEARCHER',
        sheet: R,
        rows: [3],
        checklist: [
          item(R, 4, 'Define the field', 'تحديد المجال'),
          item(R, 5, 'Define the target audience', 'تحديد الفئة المستهدفة'),
          item(R, 6, 'Define the learning outcomes', 'تحديد مخرجات التعلم'),
          item(R, 7, 'Define the program/journey duration', 'تحديد مدة البرنامج/الرحلة'),
          item(R, 8, 'Define the weekly workload', 'تحديد عبء العمل الأسبوعي'),
        ],
      }),
      task('research.competitors', {
        label: L('Identify competitors', 'تحديد المنافسين'),
        role: 'RESEARCHER',
        sheet: R,
        rows: [11],
        after: ['research.define'],
        checklist: [item(R, 12, 'List potential competitors offering a similar program', 'حصر المنافسين المحتملين الذين يقدمون برنامجًا مشابهًا')],
      }),
      task('research.analysis', {
        label: L('Competitor analysis', 'تحليل المنافسين'),
        role: 'RESEARCHER',
        sheet: R,
        rows: [13, 14, 18, 21],
        after: ['research.competitors'],
        checklist: [
          item(R, 15, "Visit each competitor's website", 'زيارة موقع كل منافس', { group: { ...L('Website review', 'مراجعة المواقع'), row: 14 } }),
          item(R, 16, 'Note their course offerings, structure, pricing and target audience', 'تسجيل ما يقدمونه من كورسات وهيكلها وأسعارها وجمهورها المستهدف', {
            group: { ...L('Website review', 'مراجعة المواقع'), row: 14 },
          }),
          item(R, 17, 'Look for customer testimonials or reviews', 'البحث عن آراء العملاء وتقييماتهم', { group: { ...L('Website review', 'مراجعة المواقع'), row: 14 } }),
          item(R, 19, 'Evaluate the topics their courses cover', 'تقييم الموضوعات التي تغطيها كورساتهم', {
            group: { ...L('Program content analysis', 'تحليل محتوى البرامج'), row: 18 },
          }),
          item(R, 20, 'Compare the depth, breadth and uniqueness of their content', 'مقارنة عمق المحتوى واتساعه وتميزه', {
            group: { ...L('Program content analysis', 'تحليل محتوى البرامج'), row: 18 },
          }),
          item(R, 22, 'Check which learning platforms or tools they use', 'معرفة منصات أو أدوات التعلم التي يستخدمونها', {
            group: { ...L('Learning experience', 'تجربة التعلم'), row: 21 },
          }),
          item(R, 23, 'Evaluate their user experience and interface', 'تقييم تجربة المستخدم والواجهة لديهم', { group: { ...L('Learning experience', 'تجربة التعلم'), row: 21 } }),
        ],
      }),
      task('research.document', {
        label: L('Research outcomes document', 'مستند نتائج البحث'),
        role: 'RESEARCHER',
        sheet: R,
        rows: [9],
        evidence: L('The research outcomes document', 'مستند نتائج البحث'),
        after: ['research.analysis'],
        checklist: [item(R, 10, 'Create a document recording the research outcomes', 'إنشاء مستند يوثق نتائج نشاط البحث')],
      }),
      task('research.outline', {
        label: L('Identify the content outline and hand over to ID', 'تحديد الخطوط العريضة للمحتوى والتسليم للتصميم التعليمي'),
        role: 'RESEARCHER',
        sheet: R,
        rows: [24],
        kind: 'HANDOFF',
        after: ['research.document'],
        checklist: [
          item(R, 25, 'Identify the main journey programs', 'تحديد البرامج الرئيسية في الرحلة'),
          item(R, 26, 'Identify the main program modules', 'تحديد الوحدات الرئيسية للبرنامج'),
          item(R, 27, 'Identify the tools used during the program', 'تحديد الأدوات المستخدمة خلال البرنامج'),
          item(R, 28, 'Pass these findings to ID to craft a roadmap for the learners', 'تسليم هذه النتائج لفريق التصميم التعليمي لبناء خارطة طريق للمتعلمين'),
        ],
      }),
    ],
  });
}

/* ------------------------------------------------------------------ */
/* First draft curriculum                                               */
/* ------------------------------------------------------------------ */

const D = SHEETS.DRAFT;

function curriculumDraftStage(source) {
  return stage('CURRICULUM_DRAFT', {
    label: L('First draft curriculum', 'المسودة الأولى للمنهج'),
    description: L(
      'Build the curriculum document — structure, introduction, objectives, prerequisites, journey, modules, topics, outcomes and tools — then take it through ID review.',
      'بناء مستند المنهج — الهيكل والمقدمة والأهداف والمتطلبات والرحلة والوحدات والموضوعات والمخرجات والأدوات — ثم تمريره على مراجعة التصميم التعليمي.'
    ),
    source,
    after: ['RESEARCH'],
    ownerRole: 'RESEARCHER',
    tasks: [
      task('draft.structure', {
        label: L('Create the draft structure', 'إنشاء هيكل المسودة'),
        role: 'RESEARCHER',
        sheet: D,
        rows: [3],
        checklist: [
          item(D, 4, 'Get the finalized research document', 'استلام مستند البحث النهائي'),
          item(D, 5, 'Create a document for the journey/program', 'إنشاء مستند للرحلة/البرنامج'),
          item(D, 6, 'Name the document "Program Name Curriculum"', 'تسمية المستند "Program Name Curriculum"'),
          item(D, 7, 'Create the program title page', 'إنشاء صفحة عنوان البرنامج'),
          item(D, 8, 'Create the table of contents page', 'إنشاء صفحة جدول المحتويات'),
          item(D, 9, 'Create a relevant "Introduction" section', 'إنشاء قسم "المقدمة"'),
          item(D, 10, 'Create the "Learning Objectives" section (attitude, skills, knowledge)', 'إنشاء قسم "أهداف التعلم" (الاتجاهات والمهارات والمعارف)'),
          item(D, 11, 'Create the "Prerequisites" section', 'إنشاء قسم "المتطلبات السابقة"'),
          item(
            D,
            12,
            'Create the "About the Journey" section (target audience, age group, duration in hours, tasks, projects, weeks, impact, language)',
            'إنشاء قسم "عن الرحلة" (الفئة المستهدفة، الفئة العمرية، المدة بالساعات، المهام، المشاريع، الأسابيع، الأثر، اللغة)'
          ),
          item(D, 13, 'Create a section per program (numbering starts from 1)', 'إنشاء قسم لكل برنامج (يبدأ الترقيم من 1)'),
          item(D, 14, 'Create a section per module (numbering starts from 1)', 'إنشاء قسم لكل وحدة (يبدأ الترقيم من 1)'),
          item(D, 15, 'Create the module "Introduction"', 'إنشاء "مقدمة" الوحدة'),
          item(D, 16, 'Create the module "Learning Objectives" (action verb, conditions, criteria)', 'إنشاء "أهداف التعلم" للوحدة (فعل إجرائي، شروط، معايير)'),
          item(
            D,
            17,
            'Create the module contents table (topics, and learning outcomes per topic — cognitive, psychomotor, affective)',
            'إنشاء جدول محتويات الوحدة (الموضوعات، ومخرجات التعلم لكل موضوع — معرفية ونفس-حركية ووجدانية)'
          ),
          item(D, 18, 'Create the "Tools" section', 'إنشاء قسم "الأدوات"'),
        ],
      }),
      task('draft.fill', {
        label: L('Fill the draft', 'تعبئة المسودة'),
        role: 'RESEARCHER',
        sheet: D,
        rows: [19],
        evidence: L('The curriculum draft document', 'مستند مسودة المنهج'),
        after: ['draft.structure'],
        checklist: [
          item(D, 20, 'Write the title "Program Name Curriculum"', 'كتابة العنوان "Program Name Curriculum"'),
          item(
            D,
            21,
            'Write the program introduction (AI tools may help, but check them — they make mistakes)',
            'كتابة مقدمة البرنامج (يمكن الاستعانة بأدوات الذكاء الاصطناعي مع المراجعة، فهي قد تخطئ)'
          ),
          item(D, 22, 'Write the program learning objectives', 'كتابة أهداف التعلم للبرنامج'),
          item(D, 23, 'Write the program prerequisites', 'كتابة المتطلبات السابقة للبرنامج'),
          item(D, 24, 'Write the "About the Journey" points', 'كتابة نقاط "عن الرحلة"'),
          item(D, 25, 'Write every module introduction as a paragraph starting "In this module, learners will…"', 'كتابة مقدمة كل وحدة كفقرة تبدأ بعبارة "In this module, learners will…"'),
          item(
            D,
            26,
            'Write every module\'s learning objectives as arrow bullets after "By the end of this module, learners will be able to:"',
            'كتابة أهداف كل وحدة كنقاط سهمية بعد عبارة "By the end of this module, learners will be able to:"'
          ),
          item(D, 27, "Write every module's topics with short, descriptive names", 'كتابة موضوعات كل وحدة بأسماء قصيرة وواضحة'),
          item(D, 28, "Write every topic's learning outcomes as arrow bullets", 'كتابة مخرجات التعلم لكل موضوع كنقاط سهمية'),
        ],
      }),
      task('draft.fonts', {
        label: L('Apply the document fonts', 'تطبيق خطوط المستند'),
        role: 'RESEARCHER',
        sheet: D,
        rows: [29],
        after: ['draft.fill'],
        checklist: [
          item(D, 30, 'Heading 1, bold Open Sans 20 — table of contents, introduction, program name, tools', 'عنوان 1، Open Sans عريض 20 — لجدول المحتويات والمقدمة واسم البرنامج والأدوات'),
          item(
            D,
            31,
            'Heading 2, regular Open Sans 18 — program learning objectives, prerequisites, about the journey, module names',
            'عنوان 2، Open Sans عادي 18 — لأهداف البرنامج والمتطلبات و"عن الرحلة" وأسماء الوحدات'
          ),
          item(D, 32, 'Normal bold Open Sans 14 — module introduction, objectives and content labels', 'عادي عريض Open Sans 14 — لتسميات مقدمة الوحدة وأهدافها ومحتواها'),
          item(
            D,
            33,
            'Normal bold Open Sans 11 — attitude, skills, knowledge, audience, age group, duration, tasks, projects, weeks, impact, language, topics and module outcome labels',
            'عادي عريض Open Sans 11 — لتسميات الاتجاهات والمهارات والمعارف والجمهور والفئة العمرية والمدة والمهام والمشاريع والأسابيع والأثر واللغة والموضوعات ومخرجات الوحدة'
          ),
          item(D, 34, 'Normal Open Sans 11 — paragraphs and bullet points', 'عادي Open Sans 11 — للفقرات والنقاط'),
        ],
      }),
      task('draft.id_review', {
        label: L('ID review of the draft', 'مراجعة التصميم التعليمي للمسودة'),
        kind: 'REVIEW',
        role: 'INSTRUCTIONAL_DESIGNER',
        sheet: D,
        rows: [35],
        evidence: L('The documented review comments', 'ملاحظات المراجعة الموثقة'),
        after: ['draft.fonts'],
        checklist: [
          item(D, 36, 'Check the document structure', 'مراجعة هيكل المستند'),
          item(D, 37, 'Check the content from a learning-experience view', 'مراجعة المحتوى من منظور تجربة التعلم'),
          item(D, 38, 'Check the fonts', 'مراجعة الخطوط'),
          item(D, 39, 'Document the comments', 'توثيق الملاحظات'),
        ],
      }),
      task('draft.apply', {
        label: L("Apply the ID's changes", 'تطبيق تعديلات التصميم التعليمي'),
        role: 'RESEARCHER',
        sheet: D,
        rows: [40],
        evidence: L('The revised curriculum draft', 'مسودة المنهج المعدلة'),
        requiresApproval: true,
        reviewerRole: 'INSTRUCTIONAL_DESIGNER',
        approvalOrigin: 'PROPOSED',
        note: L(
          "The workbook ends at applying the ID's changes. Having the ID sign off the revised draft is a proposed gate.",
          'ينتهي ملف العمل عند تطبيق تعديلات التصميم التعليمي. اعتماد المسودة المعدلة من التصميم التعليمي بوابة مقترحة.'
        ),
        after: ['draft.id_review'],
        checklist: [item(D, 41, 'Apply every change the ID requested', 'تطبيق كل التعديلات التي طلبها فريق التصميم التعليمي')],
      }),
    ],
  });
}

/* ------------------------------------------------------------------ */
/* Experts and coaches acquisition                                      */
/* ------------------------------------------------------------------ */

const E = SHEETS.EXPERTS;

function expertStage(source) {
  return stage('EXPERT_ACQUISITION', {
    label: L('Experts and coaches acquisition', 'استقطاب الخبراء والكوتشز'),
    description: L(
      'Source, screen and assess candidates, onboard the chosen expert with scope and milestones, and sign the agreement and SOW before any further work starts.',
      'البحث عن المرشحين وفرزهم وتقييمهم، ثم تهيئة الخبير المختار بنطاق العمل والمراحل، وتوقيع الاتفاقية ونطاق العمل قبل بدء أي نشاط آخر.'
    ),
    source,
    after: ['RESEARCH'],
    ownerRole: 'EXPERT_COORDINATOR',
    skippable: {
      when: 'EXPERT_CONTRACTED',
      label: L('An expert is already contracted', 'يوجد خبير متعاقد بالفعل'),
    },
    note: L(
      'Runs alongside the first draft curriculum once research is done — both only need the finalized research document.',
      'تعمل بالتوازي مع المسودة الأولى للمنهج بعد انتهاء البحث — فكلاهما يحتاج فقط مستند البحث النهائي.'
    ),
    tasks: [
      task('experts.sourcing', {
        label: L('Source candidates', 'البحث عن المرشحين'),
        role: 'EXPERT_COORDINATOR',
        sensitive: true,
        sheet: E,
        rows: [3],
        checklist: [
          item(E, 4, 'Get the finalized research document', 'استلام مستند البحث النهائي'),
          item(E, 5, 'Search LinkedIn', 'البحث عبر LinkedIn'),
          item(E, 6, 'Search Apollo.io', 'البحث عبر Apollo.io', { note: L('The sheet spells it "Appllo.io".', 'مكتوبة في الملف "Appllo.io".') }),
        ],
      }),
      task('experts.contact', {
        label: L('Contact candidates', 'التواصل مع المرشحين'),
        role: 'EXPERT_COORDINATOR',
        sensitive: true,
        sheet: E,
        rows: [7],
        after: ['experts.sourcing'],
        checklist: [
          item(
            E,
            8,
            'Message candidates asking for a meeting/call and their CV, describing the type of cooperation',
            'مراسلة المرشحين لطلب اجتماع/مكالمة وسيرتهم الذاتية مع توضيح نوع التعاون'
          ),
          item(
            E,
            9,
            'Reply to accepting candidates with a scheduled meeting/call and the "become an expert" form',
            'الرد على المرشحين الموافقين بموعد اجتماع/مكالمة ونموذج "كن خبيرًا"'
          ),
          item(
            E,
            10,
            'Hold a 15-minute call to assess relevant experience, teaching experience and English',
            'إجراء مكالمة 15 دقيقة لتقييم الخبرة ذات الصلة وخبرة التدريس واللغة الإنجليزية'
          ),
        ],
      }),
      task('experts.samples', {
        label: L('Review candidate samples', 'مراجعة عينات المرشحين'),
        role: 'EXPERT_COORDINATOR',
        sensitive: true,
        sheet: E,
        rows: [11],
        after: ['experts.contact'],
        note: L(
          'The sheet heads this block "Technical Discussion", the same name as the next block. It is named here for what its rows describe.',
          'عنوان هذا الجزء في الملف "Technical Discussion"، وهو نفس عنوان الجزء التالي. سُمّي هنا بحسب ما تصفه بنوده.'
        ),
        checklist: [
          item(E, 12, 'Review the Arabic and English script video (all candidates)', 'مراجعة فيديو السكريبت بالعربية والإنجليزية (لكل المرشحين)'),
          item(
            E,
            13,
            'Review the technical Arabic and English sample (candidates with under 7 years of experience)',
            'مراجعة العينة التقنية بالعربية والإنجليزية (للمرشحين بخبرة أقل من 7 سنوات)',
            { required: false }
          ),
        ],
      }),
      task('experts.technical', {
        label: L('Technical discussion', 'المناقشة التقنية'),
        role: 'EXPERT_COORDINATOR',
        sensitive: true,
        sheet: E,
        rows: [14],
        after: ['experts.samples'],
        checklist: [
          item(E, 15, 'Call the passed candidates and arrange the technical discussion', 'الاتصال بالمرشحين المجتازين وترتيب المناقشة التقنية'),
          item(E, 16, 'Follow up so the teaching video sample arrives before the discussion', 'متابعة المرشح لتسليم عينة فيديو التدريس قبل المناقشة'),
          item(E, 17, 'Hold a 1-hour technical discussion to assess technical depth and proficiency', 'إجراء مناقشة تقنية لمدة ساعة لتقييم العمق التقني والكفاءة'),
          item(E, 18, 'Email the candidates thanking them and saying when to expect an answer', 'مراسلة المرشحين لشكرهم وإبلاغهم بموعد الرد المتوقع'),
          item(E, 19, 'Follow up with candidates who have not responded', 'متابعة المرشحين غير المستجيبين', { required: false }),
        ],
      }),
      task('experts.onboarding', {
        label: L('Onboard the expert', 'تهيئة الخبير'),
        role: 'EXPERT_COORDINATOR',
        sheet: E,
        rows: [20],
        evidence: L('The agreed scope and milestones', 'نطاق العمل والمراحل المتفق عليها'),
        after: ['experts.technical'],
        checklist: [
          item(E, 21, 'Call the passed candidates and send the onboarding email with the welcome form', 'الاتصال بالمرشحين المجتازين وإرسال إيميل التهيئة مع نموذج الترحيب'),
          item(
            E,
            22,
            'Hold a 1-hour meeting with the Technical PM and Delivery PM to propose the curriculum and scope of work',
            'عقد اجتماع لمدة ساعة مع مدير المشروع التقني ومدير التسليم لعرض المنهج ونطاق العمل'
          ),
          item(E, 23, 'Schedule weekly follow-up meetings', 'جدولة اجتماعات متابعة أسبوعية'),
          item(E, 24, 'Send calendar invitations with every required milestone', 'إرسال دعوات التقويم بكل المراحل المطلوبة'),
        ],
      }),
      task('experts.contract', {
        label: L('Contract the expert', 'التعاقد مع الخبير'),
        role: 'EXPERT_COORDINATOR',
        sensitive: true,
        sheet: E,
        rows: [25],
        evidence: L('The signed agreement and SOW', 'الاتفاقية ونطاق العمل (SOW) موقّعين'),
        after: ['experts.onboarding'],
        checklist: [
          item(E, 26, 'Email a signed version of the agreement and SOW', 'إرسال نسخة موقعة من الاتفاقية ونطاق العمل بالإيميل'),
          item(E, 27, 'Negotiation round, if needed', 'جولة تفاوض عند الحاجة', { required: false }),
          item(E, 28, 'Email the signed agreement and SOW after negotiation', 'إرسال الاتفاقية ونطاق العمل الموقعين بعد التفاوض', { required: false }),
          item(E, 29, 'Follow up until the contract is signed — before any further activity starts', 'متابعة توقيع العقد قبل بدء أي نشاط آخر'),
        ],
      }),
      task('experts.performance', {
        label: L('Track expert and coach performance', 'متابعة أداء الخبراء والكوتشز'),
        role: 'EXPERT_COORDINATOR',
        classification: 'OPTIONAL',
        sheet: E,
        rows: [30],
        after: ['experts.contract'],
        note: L(
          'Continues through production, so it never holds this stage open.',
          'تستمر طوال الإنتاج، لذلك لا تُبقي هذه المرحلة مفتوحة.'
        ),
        checklist: [
          item(E, 31, 'Arrange a meeting with the ID team (ToT)', 'ترتيب اجتماع مع فريق التصميم التعليمي (تدريب المدربين)'),
          item(E, 32, "Track the expert's shooting performance", 'متابعة أداء الخبير في التصوير'),
          item(E, 33, "Track the expert's commitment", 'متابعة التزام الخبير'),
          item(E, 34, "Track the expert's live delivery", 'متابعة التقديم المباشر للخبير'),
          item(E, 35, "Track the coaches' commitment", 'متابعة التزام الكوتشز'),
          item(E, 36, "Track the coaches' performance", 'متابعة أداء الكوتشز'),
        ],
      }),
      task('experts.community', {
        label: L('Engage the experts community', 'التفاعل مع مجتمع الخبراء'),
        role: 'EXPERT_COORDINATOR',
        classification: 'OPTIONAL',
        sheet: E,
        rows: [37],
        note: L(
          'The workbook names this activity without listing its steps.',
          'يذكر ملف العمل هذا النشاط دون تفصيل خطواته.'
        ),
      }),
    ],
  });
}

/* ------------------------------------------------------------------ */
/* Final curriculum details                                             */
/* ------------------------------------------------------------------ */

const F = SHEETS.FINAL;

function finalCurriculumStage(source, { scenario }) {
  const ai = scenario === 'AI_NEW';
  const pendingNote = L(
    'The workbook gives this deliverable a heading but no checklist. The steps shown are a proposal pending the business owner.',
    'يذكر ملف العمل هذا المُخرج كعنوان دون قائمة خطوات. الخطوات المعروضة مقترحة بانتظار اعتماد مالك العمل.'
  );
  return stage('FINAL_CURRICULUM', {
    label: L('Final curriculum details', 'التفاصيل النهائية للمنهج'),
    description: L(
      'Take expert, consultant and ID feedback into the final curriculum, align the presentations, and produce the knowledge checks, tasks and projects.',
      'إدخال ملاحظات الخبير والاستشاري والتصميم التعليمي في المنهج النهائي، ومواءمة العروض التقديمية، وإعداد أسئلة التحقق والمهام والمشاريع.'
    ),
    source,
    after: ai ? ['AI_OUTLINE_REVIEW'] : ['CURRICULUM_DRAFT', 'EXPERT_ACQUISITION'],
    ownerRole: 'RESEARCHER',
    tasks: [
      task('final.expert_feedback', {
        label: L('Collect expert feedback on the draft', 'جمع ملاحظات الخبير على المسودة'),
        role: 'RESEARCHER',
        classification: ai ? 'CONDITIONAL' : 'REQUIRED',
        condition: ai ? L('When an expert is involved in this program', 'عند مشاركة خبير في هذا البرنامج') : null,
        sheet: F,
        rows: [3],
        evidence: L('The documented suggestions and justifications', 'المقترحات ومبرراتها موثقة'),
        checklist: [
          item(F, 4, 'Send the first curriculum draft to the expert', 'إرسال مسودة المنهج الأولى للخبير'),
          item(F, 5, 'Schedule a meeting to discuss the suggested modifications', 'جدولة اجتماع لمناقشة التعديلات المقترحة'),
          item(F, 6, 'Document every suggestion and its justification', 'توثيق كل مقترح ومبرره'),
          item(F, 7, 'Send the suggested modifications to the consultant', 'إرسال التعديلات المقترحة للاستشاري'),
        ],
      }),
      task('final.document', {
        label: L('Final curriculum document', 'مستند المنهج النهائي'),
        role: 'RESEARCHER',
        sheet: F,
        rows: [3],
        evidence: L('The final curriculum document', 'مستند المنهج النهائي'),
        requiresApproval: true,
        reviewerRole: 'TECHNICAL_CONSULTANT',
        after: ['final.expert_feedback'],
        checklist: [
          item(F, 8, 'Create the final curriculum document', 'إنشاء مستند المنهج النهائي'),
          item(F, 9, "Apply the suggested modifications after the consultant's approval", 'تطبيق التعديلات المقترحة بعد موافقة الاستشاري'),
        ],
      }),
      task('final.id_approval', {
        label: L('ID learning-experience approval', 'اعتماد تجربة التعلم من التصميم التعليمي'),
        kind: 'SIGNOFF',
        role: 'RESEARCHER',
        requiresApproval: true,
        reviewerRole: 'INSTRUCTIONAL_DESIGNER',
        sheet: F,
        rows: [3],
        after: ['final.document'],
        checklist: [item(F, 10, 'Send to the ID team for learning-experience approval', 'الإرسال لفريق التصميم التعليمي لاعتماد تجربة التعلم')],
      }),
      task('final.consultant_review', {
        label: L('Consultant review', 'مراجعة الاستشاري'),
        kind: 'SIGNOFF',
        role: 'RESEARCHER',
        requiresApproval: true,
        reviewerRole: 'TECHNICAL_CONSULTANT',
        sheet: F,
        rows: [3],
        after: ['final.id_approval'],
        checklist: [
          item(F, 11, 'Send to the consultant for review', 'الإرسال للاستشاري للمراجعة'),
          item(F, 12, "Gather the consultant's feedback", 'جمع ملاحظات الاستشاري'),
        ],
      }),
      task('final.presentations', {
        label: L('Create and align the presentations', 'إنشاء العروض التقديمية ومواءمتها'),
        role: 'TECHNICAL_PM',
        classification: ai ? 'CONDITIONAL' : 'REQUIRED',
        condition: ai ? L('When slides are not produced through the Docki handoff', 'عندما لا تُنتج الشرائح عبر التسليم إلى Docki') : null,
        sheet: F,
        rows: [13],
        requiresApproval: true,
        reviewerRole: 'TECHNICAL_CONSULTANT',
        after: ['final.document'],
        checklist: [
          item(F, 14, 'Create a new "Program Name Presentations – Developing"', 'إنشاء "Program Name Presentations - Developing" جديد'),
          item(
            F,
            15,
            'Validate every delivered presentation against the final detailed curriculum (modules, topics, subtopics)',
            'التحقق من توافق كل العروض المسلَّمة مع المنهج التفصيلي النهائي (الوحدات والموضوعات والموضوعات الفرعية)'
          ),
          item(F, 16, 'Send the presentations to the consultant for technical review', 'إرسال العروض للاستشاري للمراجعة التقنية'),
        ],
      }),
      task('final.mcqs', {
        label: L('Knowledge checks (MCQs)', 'أسئلة التحقق من المعرفة (اختيار من متعدد)'),
        role: 'SUBJECT_MATTER_EXPERT',
        sheet: F,
        rows: [17],
        evidence: L('The MCQ bank', 'بنك الأسئلة'),
        requiresApproval: true,
        reviewerRole: 'TECHNICAL_CONSULTANT',
        approvalOrigin: 'PROPOSED',
        note: pendingNote,
        after: ['final.document'],
        checklist: [
          proposed('mcq.draft', "Write MCQs for each module, aligned with the module's learning outcomes", 'كتابة أسئلة لكل وحدة متوافقة مع مخرجات تعلمها'),
          proposed('mcq.technical', 'Technical accuracy review by the consultant', 'مراجعة الدقة التقنية من الاستشاري'),
          proposed('mcq.id', 'ID review of wording and difficulty', 'مراجعة التصميم التعليمي للصياغة ومستوى الصعوبة'),
        ],
      }),
      task('final.tasks', {
        label: L('Tasks', 'المهام التطبيقية'),
        role: 'SUBJECT_MATTER_EXPERT',
        sheet: F,
        rows: [19],
        evidence: L('The task documents', 'مستندات المهام'),
        requiresApproval: true,
        reviewerRole: 'TECHNICAL_CONSULTANT',
        approvalOrigin: 'PROPOSED',
        note: pendingNote,
        after: ['final.document'],
        checklist: [
          proposed('tasks.write', 'Write each task with the task-creation template (content, deliverables, submission)', 'كتابة كل مهمة وفق قالب إنشاء المهام (المحتوى والمخرجات وطريقة التسليم)', {
            source: { sheet: SHEETS.DRY_RUN, rows: [21], relation: 'criteria the dry run later checks' },
          }),
          proposed('tasks.scoring', 'Define the scoring checklist and the passing score', 'تحديد قائمة التقييم ودرجة النجاح', {
            source: { sheet: SHEETS.DRY_RUN, rows: [21], relation: 'criteria the dry run later checks' },
          }),
          proposed('tasks.review', 'Technical review by the consultant', 'مراجعة تقنية من الاستشاري'),
        ],
      }),
      task('final.projects', {
        label: L('Projects', 'المشاريع'),
        role: 'SUBJECT_MATTER_EXPERT',
        sheet: F,
        rows: [20],
        evidence: L('The project documents', 'مستندات المشاريع'),
        requiresApproval: true,
        reviewerRole: 'TECHNICAL_CONSULTANT',
        approvalOrigin: 'PROPOSED',
        note: pendingNote,
        after: ['final.document'],
        checklist: [
          proposed('projects.write', 'Write each project with the task-creation template (content, deliverables, submission)', 'كتابة كل مشروع وفق قالب إنشاء المهام (المحتوى والمخرجات وطريقة التسليم)', {
            source: { sheet: SHEETS.DRY_RUN, rows: [23], relation: 'criteria the dry run later checks' },
          }),
          proposed('projects.scoring', 'Define the scoring checklist and the passing score', 'تحديد قائمة التقييم ودرجة النجاح', {
            source: { sheet: SHEETS.DRY_RUN, rows: [23], relation: 'criteria the dry run later checks' },
          }),
          proposed('projects.review', 'Technical review by the consultant', 'مراجعة تقنية من الاستشاري'),
        ],
      }),
    ],
  });
}

/* ------------------------------------------------------------------ */
/* Instructional design                                                 */
/* ------------------------------------------------------------------ */

const I = SHEETS.ID;

function instructionalDesignStage(source, { after, hiddenChecklist }) {
  const visibleEmpty = L(
    "The visible checklist on this sheet is empty. The steps below come from the sheet's hidden rows 25–37, activated as a proposal pending the business owner.",
    'القائمة الظاهرة في هذه الورقة فارغة. الخطوات التالية مأخوذة من الصفوف المخفية 25–37، وفُعّلت كمقترح بانتظار اعتماد مالك العمل.'
  );
  const tasks = hiddenChecklist
    ? [
        task('id.review', {
          label: L('Pedagogical review of the presentations', 'المراجعة التربوية للعروض التقديمية'),
          kind: 'REVIEW',
          role: 'INSTRUCTIONAL_DESIGNER',
          sheet: I,
          rows: [25],
          evidence: L('The review comments', 'ملاحظات المراجعة'),
          note: visibleEmpty,
          checklist: [
            item(I, 26, 'Receive the presentations from the Technical PM', 'استلام العروض من مدير المشروع التقني', {
              note: L('The sheet spells it "Recieve".', 'مكتوبة في الملف "Recieve".'),
            }),
            item(I, 27, 'Research the topic', 'البحث في الموضوع', { note: L('The sheet row reads only "Research".', 'نص الصف في الملف "Research" فقط.') }),
            item(I, 28, 'Compare the slides against the curriculum/topic', 'مقارنة الشرائح بالمنهج/الموضوع'),
            item(I, 29, 'Check the slide notes', 'مراجعة ملاحظات الشرائح'),
            item(I, 30, 'Apply the fonts and sizes', 'تطبيق الخطوط والأحجام'),
            item(I, 31, 'Check or create the main title', 'مراجعة العنوان الرئيسي أو إنشاؤه'),
            item(I, 32, 'Check or create the outlines', 'مراجعة المخططات أو إنشاؤها'),
            item(I, 33, 'Check the visuals (icons, infographics, etc.)', 'مراجعة العناصر المرئية (الأيقونات والإنفوجرافيك وغيرها)'),
            item(I, 34, 'Check the links (competitor references, illegal downloads, cracks)', 'مراجعة الروابط (الإشارة لمنافسين، التنزيلات غير القانونية، النسخ المقرصنة)'),
          ],
        }),
        task('id.feedback', {
          label: L('Send the ID feedback', 'إرسال ملاحظات التصميم التعليمي'),
          role: 'INSTRUCTIONAL_DESIGNER',
          sheet: I,
          rows: [25],
          after: ['id.review'],
          checklist: [
            item(I, 35, 'Send the feedback to the Technical PM', 'إرسال الملاحظات لمدير المشروع التقني'),
            item(I, 36, "Resend to the Technical PM for the expert's final review", 'إعادة الإرسال لمدير المشروع التقني للمراجعة النهائية من الخبير'),
          ],
        }),
        task('id.corrections', {
          label: L('Apply the corrections', 'تطبيق التصحيحات'),
          role: 'TECHNICAL_PM',
          sheet: I,
          rows: [25],
          requiresApproval: true,
          reviewerRole: 'INSTRUCTIONAL_DESIGNER',
          approvalOrigin: 'PROPOSED',
          after: ['id.feedback'],
          checklist: [item(I, 37, 'Work on the changes', 'العمل على التعديلات')],
        }),
      ]
    : [
        task('id.review', {
          label: L('Pedagogical review and corrections', 'المراجعة التربوية والتصحيحات'),
          kind: 'REVIEW',
          role: 'INSTRUCTIONAL_DESIGNER',
          requiresApproval: true,
          reviewerRole: 'INSTRUCTIONAL_DESIGNER',
          origin: 'PROPOSED',
          note: L('The workbook has no active checklist for this stage.', 'لا توجد قائمة فعالة لهذه المرحلة في ملف العمل.'),
          checklist: [
            proposed('id.pedagogy', 'Review pedagogy against the final curriculum', 'مراجعة الجانب التربوي مقابل المنهج النهائي'),
            proposed('id.alignment', 'Check presentation alignment', 'مراجعة توافق العروض التقديمية'),
            proposed('id.comments', 'Record the comments and verify the corrections', 'تسجيل الملاحظات والتحقق من التصحيحات'),
          ],
        }),
      ];

  return stage('INSTRUCTIONAL_DESIGN', {
    label: L('Instructional design', 'التصميم التعليمي'),
    description: L(
      'Pedagogical review, presentation alignment, comments and corrections.',
      'المراجعة التربوية ومواءمة العروض والملاحظات والتصحيحات.'
    ),
    source,
    after,
    ownerRole: 'INSTRUCTIONAL_DESIGNER',
    note: visibleEmpty,
    tasks,
  });
}

/* ------------------------------------------------------------------ */
/* Media production — the lesson asset pipeline                         */
/* ------------------------------------------------------------------ */

function mediaStage(source, { after }) {
  return stage('MEDIA_PRODUCTION', {
    label: L('Media production', 'إنتاج الوسائط'),
    description: L(
      'Each lesson goes through its assets — outline, slides, script, voice-over, video — with versioned review and approval.',
      'يمر كل درس بملفاته — المخطط والشرائح والسكريبت والتعليق الصوتي والفيديو — مع مراجعة واعتماد لكل نسخة.'
    ),
    source,
    after,
    lessonAssets: true,
    note: L(
      'The workbook sheet for this stage is empty; the work is the lesson asset pipeline from the original production brief.',
      'ورقة هذه المرحلة في ملف العمل فارغة؛ والعمل هو مسار ملفات الدروس من وصف الإنتاج الأصلي.'
    ),
    tasks: [
      task('media.assets', {
        label: L('Every lesson asset approved', 'اعتماد كل ملفات الدروس'),
        kind: 'AUTO',
        origin: 'OLD_PROMPT',
        rule: { type: 'ASSETS_APPROVED', assetTypes: null },
      }),
    ],
  });
}

/* ------------------------------------------------------------------ */
/* Platform deployment                                                  */
/* ------------------------------------------------------------------ */

const P = SHEETS.DEPLOY;

function deploymentStage(source, { after, revamp, hiddenChecklist, proposedStage = false }) {
  const tasks = [
    task('deploy.content_review', {
      label: L('Content team internal review', 'المراجعة الداخلية لفريق المحتوى'),
      role: 'QUALITY_REVIEWER',
      sheet: P,
      rows: [3],
      origin: proposedStage ? 'PROPOSED' : undefined,
      checklist: [
        item(P, 4, 'Review every video to be uploaded to the platform', 'مراجعة كل الفيديوهات التي سترفع على المنصة'),
        item(P, 5, 'Review the knowledge checks (MCQs) to be added to the platform', 'مراجعة أسئلة التحقق من المعرفة التي ستضاف على المنصة'),
        item(P, 6, 'Review every task', 'مراجعة كل المهام'),
        item(P, 7, 'Review every project', 'مراجعة كل المشاريع'),
      ],
    }),
    revamp
      ? task('deploy.visuals', {
          label: L('Cover and thumbnail, if needed', 'الغلاف والصورة المصغرة عند الحاجة'),
          role: 'MARKETING',
          classification: 'CONDITIONAL',
          condition: L('When the revamp changes the cover or thumbnail', 'عندما يغيّر التطوير الغلاف أو الصورة المصغرة'),
          sheet: P,
          rows: [21],
          evidence: L('The cover page and thumbnail', 'الغلاف والصورة المصغرة'),
          checklist: [
            item(P, 22, 'Ask the marketing team for a program cover page and thumbnail', 'طلب غلاف وصورة مصغرة للبرنامج من فريق التسويق'),
            item(P, 23, 'Follow up to receive them', 'المتابعة حتى الاستلام'),
            item(P, 24, 'Add the cover and thumbnail to a folder inside the main program folder', 'إضافة الغلاف والصورة المصغرة في مجلد داخل مجلد البرنامج الرئيسي'),
          ],
        })
      : task('deploy.visuals', {
          label: L('Cover and thumbnail', 'الغلاف والصورة المصغرة'),
          role: 'MARKETING',
          sheet: P,
          rows: [8],
          origin: proposedStage ? 'PROPOSED' : undefined,
          evidence: L('The cover page and thumbnail', 'الغلاف والصورة المصغرة'),
          checklist: [
            item(P, 9, 'Ask the marketing team for a program cover page and thumbnail', 'طلب غلاف وصورة مصغرة للبرنامج من فريق التسويق'),
            item(P, 10, 'Follow up to receive them', 'المتابعة حتى الاستلام'),
          ],
        }),
  ];

  if (hiddenChecklist) {
    if (revamp) {
      tasks.push(
        task('deploy.clone', {
          label: L('Clone from the latest release', 'النسخ من آخر إصدار'),
          role: 'LEARNING_OPERATIONS',
          sheet: P,
          rows: [17],
          checklist: [
            item(P, 18, 'Clone the parent program from the latest release', 'نسخ البرنامج الأب من آخر إصدار'),
            item(P, 19, 'Clone the child program from the latest release', 'نسخ البرنامج الفرعي من آخر إصدار'),
            item(P, 20, 'Name the program "Program Name rx.y.z" — x, y and z describe the new release version', 'تسمية البرنامج "Program Name rx.y.z" — حيث تصف x وy وz رقم الإصدار الجديد'),
          ],
        })
      );
    }
    tasks.push(
      task('deploy.handoff', {
        label: L('Send the data to Learning Operations', 'تسليم البيانات لفريق عمليات التعلم'),
        kind: 'HANDOFF',
        role: 'PRODUCTION_MANAGER',
        sheet: P,
        rows: [25],
        after: ['deploy.content_review'],
        checklist: [
          item(
            P,
            26,
            'Send the new curriculum document, highlighting the changes: intro, learning objectives, about the program; and the skeleton of modules, topics and subtopics',
            'إرسال مستند المنهج الجديد مع إبراز التعديلات: المقدمة وأهداف التعلم و"عن البرنامج"، وهيكل الوحدات والموضوعات والموضوعات الفرعية'
          ),
          item(P, 27, 'Send the new visuals, if any', 'إرسال العناصر المرئية الجديدة إن وجدت', { required: false }),
          item(P, 28, 'Send the final edited videos to upload', 'إرسال الفيديوهات النهائية المحررة للرفع'),
          item(P, 29, 'Send the final knowledge checks to add', 'إرسال أسئلة التحقق النهائية للإضافة'),
          item(P, 30, 'Send the calendar delivery event', 'إرسال موعد التسليم في التقويم'),
        ],
      }),
      task('deploy.codelabs', {
        label: L('Update codelabs, tasks and projects, if needed', 'تحديث المختبرات والمهام والمشاريع عند الحاجة'),
        role: 'LEARNING_OPERATIONS',
        classification: 'CONDITIONAL',
        condition: L('When the program has codelabs, or its tasks or projects changed', 'عندما يحتوي البرنامج على مختبرات، أو تغيرت مهامه أو مشاريعه'),
        sheet: P,
        rows: [31],
        after: ['deploy.handoff'],
        checklist: [
          item(P, 32, 'Add the codelabs', 'إضافة المختبرات البرمجية'),
          item(P, 33, 'Modify the tasks', 'تعديل المهام'),
          item(P, 34, 'Modify the projects', 'تعديل المشاريع'),
        ],
      }),
      task('deploy.release_setup', {
        label: L('Prepare the release on the platform', 'تجهيز الإصدار على المنصة'),
        role: 'LEARNING_OPERATIONS',
        sheet: P,
        rows: [35],
        evidence: L("The release's platform link", 'رابط الإصدار على المنصة'),
        after: ['deploy.handoff'],
        note: L('The sheet heads this block "Clonning".', 'عنوان هذا الجزء في الملف "Clonning".'),
        checklist: [
          item(P, 36, 'Add the program link to the versioning sheet and mark it as the current release', 'إضافة رابط البرنامج إلى سجل الإصدارات وتعليمه كالإصدار الحالي'),
          item(P, 37, 'Clone when delivering to the learners', 'النسخ عند التسليم للمتعلمين'),
          item(P, 38, 'This release version must have no learners inside', 'يجب ألا يحتوي هذا الإصدار على متعلمين'),
          item(P, 39, 'Enroll every internal stakeholder before the dry run', 'تسجيل كل الأطراف الداخلية قبل التجربة الداخلية'),
        ],
      }),
      task('deploy.schedule_dry_run', {
        label: L('Schedule the internal dry run', 'جدولة التجربة الداخلية'),
        role: 'PRODUCTION_MANAGER',
        sheet: P,
        rows: [40],
        after: ['deploy.release_setup'],
        checklist: [
          item(
            P,
            41,
            'Schedule the internal dry run with the Content, Learning Ops, Delivery, ID and Tech Consultant SPOCs',
            'جدولة التجربة الداخلية مع ممثلي فرق المحتوى وعمليات التعلم والتسليم والتصميم التعليمي والاستشاريين التقنيين'
          ),
        ],
      })
    );
  }

  tasks.push(
    task('deploy.verify', {
      label: L('Verify the deployment', 'التحقق من النشر'),
      kind: 'SIGNOFF',
      role: 'LEARNING_OPERATIONS',
      requiresApproval: true,
      reviewerRole: 'PRODUCTION_MANAGER',
      evidence: L('The platform link and verification notes', 'رابط المنصة وملاحظات التحقق'),
      after: tasks.filter((entry) => entry.classification === 'REQUIRED').map((entry) => entry.key),
      note: L(
        'There is no platform API: the deployment is done by hand and verified here with evidence.',
        'لا توجد واجهة برمجية للمنصة: يتم النشر يدويًا ويُتحقق منه هنا بالأدلة.'
      ),
      checklist: [
        proposed('verify.structure', 'The structure on the platform matches the final curriculum', 'الهيكل على المنصة مطابق للمنهج النهائي'),
        proposed('verify.videos', 'Every lesson video is uploaded and plays', 'كل فيديوهات الدروس مرفوعة وتعمل'),
        proposed('verify.assessments', 'Knowledge checks, tasks and projects are configured', 'أسئلة التحقق والمهام والمشاريع مُعدّة'),
        proposed('verify.visuals', 'The cover and thumbnail are applied', 'الغلاف والصورة المصغرة مطبقان'),
        proposed('verify.release', 'The target release (version and link) is recorded', 'الإصدار المستهدف (الرقم والرابط) مسجل'),
      ],
    })
  );

  return stage('PLATFORM_DEPLOYMENT', {
    label: L('Platform deployment', 'النشر على المنصة'),
    description: L(
      'Package and verify the curriculum, content, assessments, visuals and the target release on the learning platform.',
      'تجهيز المنهج والمحتوى والتقييمات والعناصر المرئية والإصدار المستهدف على منصة التعلم والتحقق منها.'
    ),
    origin: proposedStage ? 'PROPOSED' : 'WORKBOOK',
    source,
    after,
    ownerRole: 'LEARNING_OPERATIONS',
    tasks,
  });
}

/* ------------------------------------------------------------------ */
/* Dry runs                                                             */
/* ------------------------------------------------------------------ */

const DR = SHEETS.DRY_RUN;

function dryRunStage(key, source, { after, cycle, proposedStage = false }) {
  const prefix = cycle === 1 ? 'dry' : 'dry2';
  const reuse = cycle === 2;
  const tasks = [
    task(`${prefix}.freeze`, {
      label: L('Freeze the platform', 'تجميد المنصة'),
      role: 'LEARNING_OPERATIONS',
      sheet: DR,
      rows: [3],
      checklist: [
        item(DR, 4, 'Stop any program activity on the platform', 'إيقاف أي نشاط للبرنامج على المنصة'),
        item(DR, 5, 'Stop any live platform changes or modifications', 'إيقاف أي تغييرات أو تعديلات مباشرة على المنصة'),
      ],
    }),
    task(`${prefix}.landing`, {
      label: L('Review the landing page', 'مراجعة صفحة البرنامج'),
      kind: 'ISSUES',
      role: 'PRODUCTION_MANAGER',
      sheet: DR,
      rows: [6],
      after: [`${prefix}.freeze`],
      checklist: [
        item(DR, 7, 'Get the program link to be delivered to the learners', 'الحصول على رابط البرنامج الذي سيُسلَّم للمتعلمين'),
        item(DR, 8, 'Review the program title', 'مراجعة عنوان البرنامج'),
        item(DR, 9, 'Review the program cover page', 'مراجعة غلاف البرنامج'),
        item(DR, 10, 'Review the program thumbnail', 'مراجعة الصورة المصغرة للبرنامج'),
        item(DR, 11, 'Review "What you will learn"', 'مراجعة "ماذا ستتعلم"'),
        item(DR, 12, 'Review the program/journey description', 'مراجعة وصف البرنامج/الرحلة'),
        item(DR, 13, 'Review the requirements/prerequisites', 'مراجعة المتطلبات السابقة'),
        item(DR, 14, 'Review the program specifications', 'مراجعة مواصفات البرنامج'),
      ],
    }),
    task(`${prefix}.content`, {
      label: L('Review the program content', 'مراجعة محتوى البرنامج'),
      kind: 'ISSUES',
      role: 'PRODUCTION_MANAGER',
      sheet: DR,
      rows: [15],
      after: [`${prefix}.freeze`],
      checklist: [
        item(DR, 16, 'Check module names and order against the program playbook', 'مطابقة أسماء الوحدات وترتيبها مع دليل البرنامج'),
        item(DR, 17, 'Check topic names and order against the playbook', 'مطابقة أسماء الموضوعات وترتيبها مع الدليل'),
        item(DR, 18, 'Check the videos (names, order, relevancy, functionality) against the playbook', 'مطابقة الفيديوهات (الأسماء والترتيب والملاءمة والعمل) مع الدليل'),
        item(DR, 19, 'Check the program materials', 'مراجعة مواد البرنامج'),
        item(DR, 20, 'Check the program resources — downloadable software, packages, etc.', 'مراجعة موارد البرنامج — البرامج والحزم القابلة للتنزيل وغيرها'),
        item(
          DR,
          21,
          'Check the tasks: names, content (per the task template), deliverables, order, submission, scoring checklist and passing scores in the admin panel',
          'مراجعة المهام: الأسماء والمحتوى (وفق قالب المهام) والمخرجات والترتيب والتسليم وقائمة التقييم ودرجات النجاح في لوحة الإدارة'
        ),
        item(
          DR,
          23,
          'Check the projects: names, content (per the task template), deliverables, order, submission, scoring checklist and passing scores in the admin panel',
          'مراجعة المشاريع: الأسماء والمحتوى (وفق قالب المهام) والمخرجات والترتيب والتسليم وقائمة التقييم ودرجات النجاح في لوحة الإدارة'
        ),
      ],
    }),
    task(`${prefix}.report`, {
      label: L('Document and route the issues', 'توثيق المشكلات وتوجيهها'),
      role: 'PRODUCTION_MANAGER',
      sheet: DR,
      rows: [24],
      after: [`${prefix}.landing`, `${prefix}.content`],
      checklist: [
        item(DR, 25, 'Document every issue that appeared', 'توثيق كل مشكلة ظهرت'),
        item(DR, 26, 'Send the documented issues to the responsible team (Operations, Content, Product)', 'إرسال المشكلات الموثقة للفريق المسؤول (العمليات، المحتوى، المنتج)'),
      ],
    }),
  ];

  if (cycle === 2) {
    tasks.push(
      task('dry2.fixed', {
        label: L('Every second dry-run issue fixed and verified', 'إصلاح كل مشكلات التجربة الثانية والتحقق منها'),
        kind: 'AUTO',
        origin: 'PROPOSED',
        rule: { type: 'ISSUES_RESOLVED', stages: ['DRY_RUN_2'] },
        after: ['dry2.report'],
      })
    );
  }

  return stage(key, {
    label: cycle === 1 ? L('First internal dry run', 'التجربة الداخلية الأولى') : L('Second internal dry run', 'التجربة الداخلية الثانية'),
    description: L(
      'Walk the deployed program as a learner — landing page, structure, media, materials, assessments, submission and scoring — and log every issue.',
      'تصفح البرنامج المنشور كمتعلم — صفحة البرنامج والهيكل والوسائط والمواد والتقييمات والتسليم والتقييم — وتسجيل كل مشكلة.'
    ),
    origin: proposedStage ? 'PROPOSED' : 'WORKBOOK',
    source,
    after,
    issueLog: true,
    note: reuse
      ? L('The workbook has no separate sheet for the second dry run; it reuses the first dry run checklist.', 'لا توجد ورقة منفصلة للتجربة الثانية في ملف العمل؛ فهي تعيد استخدام قائمة التجربة الأولى.')
      : null,
    tasks,
  });
}

function dryRunFixesTasks({ stageKey, redeploy }) {
  const tasks = [
    task('fix.triage', {
      label: L('Assign every dry-run issue', 'إسناد كل مشكلات التجربة الداخلية'),
      role: 'PRODUCTION_MANAGER',
      origin: 'PROPOSED',
      checklist: [
        proposed('fix.owner', 'Give every issue an owner and a due date', 'تحديد مسؤول وموعد لكل مشكلة'),
        proposed('fix.wontfix', 'Agree which issues will not be fixed, with reasons', 'الاتفاق على المشكلات التي لن تُصلح مع ذكر الأسباب'),
      ],
    }),
    task('fix.gate', {
      label: L('Every dry-run issue fixed and verified', 'إصلاح كل مشكلات التجربة والتحقق منها'),
      kind: 'AUTO',
      origin: 'PROPOSED',
      rule: { type: 'ISSUES_RESOLVED', stages: [stageKey] },
      after: ['fix.triage'],
    }),
  ];
  if (redeploy) tasks.push(redeployTask(['fix.gate']));
  return tasks;
}

function redeployTask(after) {
  return task('redeploy.apply', {
    label: L('Redeploy the corrected items', 'إعادة نشر العناصر المصححة'),
    kind: 'SIGNOFF',
    role: 'LEARNING_OPERATIONS',
    origin: 'PROPOSED',
    evidence: L('The updated platform link and notes', 'رابط المنصة المحدث والملاحظات'),
    requiresApproval: true,
    reviewerRole: 'PRODUCTION_MANAGER',
    after,
    note: L(
      'The workbook sheet "Platform Deployment After Chang" is empty. This checklist is a proposal pending the business owner.',
      'ورقة "Platform Deployment After Chang" في ملف العمل فارغة. هذه القائمة مقترحة بانتظار اعتماد مالك العمل.'
    ),
    checklist: [
      proposed('redeploy.items', 'Deploy every corrected item to the platform', 'نشر كل عنصر مصحح على المنصة'),
      proposed('redeploy.recheck', 'Re-check each fixed issue on the platform', 'إعادة التحقق من كل مشكلة مُصلحة على المنصة'),
      proposed('redeploy.release', 'Update the release record (version and link)', 'تحديث سجل الإصدار (الرقم والرابط)'),
    ],
  });
}

/* ------------------------------------------------------------------ */
/* User acceptance test                                                 */
/* ------------------------------------------------------------------ */

const U = SHEETS.UAT;

function uatStage(source, { after, proposedStage = false }) {
  // Each group is one of the sheet's category headings, cited by its row.
  const group = (row, en, ar) => ({ ...L(en, ar), row });
  const G = {
    nav: group(9, 'Program navigation', 'التنقل في البرنامج'),
    accuracy: group(12, 'Content accuracy', 'دقة المحتوى'),
    objectives: group(15, 'Learning objectives', 'أهداف التعلم'),
    interactivity: group(18, 'Interactivity', 'التفاعلية'),
    compatibility: group(21, 'Compatibility', 'التوافق'),
    accessibility: group(24, 'Accessibility', 'إتاحة الوصول'),
    multimedia: group(27, 'Multimedia', 'الوسائط المتعددة'),
    evaluation: group(30, 'Tasks and projects evaluation', 'تقييم المهام والمشاريع'),
    progress: group(33, 'Progress tracking', 'تتبع التقدم'),
  };
  return stage('UAT', {
    label: L('User acceptance test', 'اختبار قبول المستخدم'),
    description: L(
      'Real testers from the target audience run the scenarios — navigation, accuracy, objectives, interactivity, compatibility, accessibility, media, grading and progress — and sign off.',
      'مختبرون حقيقيون من الفئة المستهدفة ينفذون السيناريوهات — التنقل والدقة والأهداف والتفاعلية والتوافق والإتاحة والوسائط والتقييم والتقدم — ثم يعتمدون النتيجة.'
    ),
    origin: proposedStage ? 'PROPOSED' : 'WORKBOOK',
    source,
    after,
    ownerRole: 'UAT_COORDINATOR',
    issueLog: true,
    note: L(
      'The sheet\'s activity ID reads "new_res_1", copied from the Research sheet; the master sheet gives this stage "new_uat_11".',
      'رقم النشاط في هذه الورقة "new_res_1" منسوخ من ورقة البحث؛ ورقة الأنشطة الرئيسية تعطي هذه المرحلة "new_uat_11".'
    ),
    tasks: [
      task('uat.testers', {
        label: L('Identify the UAT testers', 'تحديد مختبري القبول'),
        role: 'UAT_COORDINATOR',
        sheet: U,
        rows: [3, 4],
        checklist: [
          item(U, 5, 'Select a diverse group of testers representing the target audience', 'اختيار مجموعة متنوعة من المختبرين تمثل الفئة المستهدفة'),
          item(U, 6, 'Make sure the testers are available during the UAT period', 'التأكد من توفر المختبرين خلال فترة الاختبار'),
        ],
      }),
      task('uat.scenarios', {
        label: L('Prepare the test scenarios', 'إعداد سيناريوهات الاختبار'),
        role: 'UAT_COORDINATOR',
        sheet: U,
        rows: [3],
        evidence: L('The test scenarios', 'سيناريوهات الاختبار'),
        checklist: [item(U, 7, 'Prepare the test scenarios', 'إعداد سيناريوهات الاختبار')],
      }),
      task('uat.execute', {
        label: L('Run the acceptance test', 'تنفيذ اختبار القبول'),
        kind: 'ISSUES',
        role: 'UAT_COORDINATOR',
        sheet: U,
        rows: [8],
        after: ['uat.testers', 'uat.scenarios'],
        checklist: [
          item(U, 10, 'Can users easily navigate through the course materials?', 'هل يتنقل المستخدمون بسهولة بين مواد الكورس؟', { group: G.nav }),
          item(U, 11, 'Are the menus, buttons and links working correctly?', 'هل تعمل القوائم والأزرار والروابط بشكل صحيح؟', { group: G.nav }),
          item(U, 13, 'Are the training materials accurate and up to date?', 'هل المواد التدريبية دقيقة ومحدثة؟', { group: G.accuracy }),
          item(U, 14, 'Verify the correctness of facts, figures and procedures', 'التحقق من صحة الحقائق والأرقام والإجراءات', { group: G.accuracy }),
          item(U, 16, 'Do the activities and exercises align with the learning objectives?', 'هل تتوافق الأنشطة والتمارين مع أهداف التعلم؟', { group: G.objectives }),
          item(U, 17, 'Are the objectives clear and achievable?', 'هل الأهداف واضحة وقابلة للتحقيق؟', { group: G.objectives }),
          item(U, 19, 'Test the interactive elements (quizzes, simulations, etc.)', 'اختبار العناصر التفاعلية (الاختبارات القصيرة والمحاكاة وغيرها)', { group: G.interactivity }),
          item(U, 20, 'Verify the interactions work as intended', 'التحقق من عمل التفاعلات كما هو مطلوب', { group: G.interactivity }),
          item(U, 22, 'Test with different browsers (Chrome, Firefox, Safari, etc.)', 'الاختبار على متصفحات مختلفة (Chrome وFirefox وSafari وغيرها)', { group: G.compatibility }),
          item(U, 23, 'Verify with different devices (desktop, tablet, mobile)', 'التحقق على أجهزة مختلفة (مكتبي، لوحي، جوال)', { group: G.compatibility }),
          item(U, 25, 'Make sure the accessibility features (screen readers, keyboard navigation, etc.) work', 'التأكد من عمل ميزات الإتاحة (قارئات الشاشة والتنقل بلوحة المفاتيح وغيرها)', {
            group: G.accessibility,
          }),
          item(U, 26, 'Check colour contrast, font sizes and other accessibility considerations', 'مراجعة تباين الألوان وأحجام الخطوط واعتبارات الإتاحة الأخرى', {
            group: G.accessibility,
          }),
          item(U, 28, 'Test audio and video for clarity and functionality', 'اختبار وضوح الصوت والفيديو وعملهما', { group: G.multimedia }),
          item(U, 29, 'Check subtitles/captions in the videos, if applicable', 'مراجعة الترجمة/التعليقات النصية في الفيديوهات إن وجدت', {
            group: G.multimedia,
            required: false,
          }),
          item(U, 31, 'Evaluate the tasks and projects for accuracy and relevance', 'تقييم المهام والمشاريع من حيث الدقة والملاءمة', { group: G.evaluation }),
          item(U, 32, 'Verify the grading and feedback mechanisms', 'التحقق من آليات التقييم والتغذية الراجعة', { group: G.evaluation }),
          item(U, 34, 'Confirm that progress tracking works', 'التأكد من عمل تتبع التقدم', { group: G.progress }),
          item(U, 35, 'Check that the completion status updates correctly', 'التحقق من تحديث حالة الإكمال بشكل صحيح', { group: G.progress }),
        ],
      }),
      task('uat.fixed', {
        label: L('Every UAT issue resolved', 'حل كل مشكلات اختبار القبول'),
        kind: 'AUTO',
        origin: 'PROPOSED',
        rule: { type: 'ISSUES_RESOLVED', stages: ['UAT'] },
        after: ['uat.execute'],
      }),
      task('uat.signoff', {
        label: L('UAT sign-off', 'اعتماد اختبار القبول'),
        kind: 'SIGNOFF',
        role: 'UAT_COORDINATOR',
        origin: 'PROPOSED',
        evidence: L('The UAT results summary', 'ملخص نتائج الاختبار'),
        requiresApproval: true,
        reviewerRole: 'PRODUCTION_MANAGER',
        after: ['uat.fixed'],
        checklist: [
          proposed('signoff.executed', 'Every scenario was executed', 'تنفيذ كل السيناريوهات'),
          proposed('signoff.noBlockers', 'No critical or high issue is open', 'لا توجد مشكلات حرجة أو عالية مفتوحة'),
          proposed('signoff.accepted', 'The business owner accepts the results', 'قبول مالك العمل للنتائج'),
        ],
      }),
    ],
  });
}

/* ------------------------------------------------------------------ */
/* Release                                                              */
/* ------------------------------------------------------------------ */

function releaseStage({ after }) {
  return stage('RELEASE', {
    label: L('Release', 'الإصدار'),
    description: L(
      'Prepare a release candidate from the approved content, get it signed off, and publish it — recording the platform link as evidence.',
      'تجهيز نسخة إصدار من المحتوى المعتمد، واعتمادها، ثم نشرها مع تسجيل رابط المنصة كدليل.'
    ),
    origin: 'PROPOSED',
    after,
    note: L(
      'Publication is an explicit, gated action. The workbook ends at UAT; this stage is a proposal pending the business owner.',
      'النشر إجراء صريح له بوابة اعتماد. ينتهي ملف العمل عند اختبار القبول؛ وهذه المرحلة مقترحة بانتظار اعتماد مالك العمل.'
    ),
    tasks: [
      task('release.published', {
        label: L('Release signed off and published', 'اعتماد الإصدار ونشره'),
        kind: 'AUTO',
        origin: 'PROPOSED',
        rule: { type: 'RELEASE_PUBLISHED' },
      }),
    ],
  });
}

/* ------------------------------------------------------------------ */
/* AI-assisted stages                                                   */
/* ------------------------------------------------------------------ */

const aiNote = L(
  'AI output is never self-approved: every AI-assisted version is reviewed and approved by a named person other than the one who submitted it.',
  'مخرجات الذكاء الاصطناعي لا تُعتمد ذاتيًا: كل نسخة بمساعدة الذكاء الاصطناعي يراجعها ويعتمدها شخص مسمّى غير من أرسلها.'
);

function aiStages() {
  const M = (row, cells, id, label, note) => master('AI_NEW_PROGRAM', row, cells, id, label, note);
  return [
    stage('AI_INPUT', {
      label: L('Content input', 'تجهيز المحتوى المدخل'),
      description: L('Prepare the source content the AI tools will work from.', 'تجهيز المحتوى المصدري الذي ستعمل عليه أدوات الذكاء الاصطناعي.'),
      source: M(3, 'G3:H3', 'new_res_1', 'New content'),
      ownerRole: 'RESEARCHER',
      tasks: [
        task('ai.input', {
          label: L('Prepare the source content and input', 'تجهيز المحتوى المصدري والمدخلات'),
          role: 'RESEARCHER',
          origin: 'PROPOSED',
          evidence: L('The input pack', 'حزمة المدخلات'),
          note: L('The workbook names this step "New content" without a checklist.', 'يسمي ملف العمل هذه الخطوة "New content" دون قائمة خطوات.'),
          checklist: [
            proposed('input.sources', 'Collect the source material and references', 'جمع المواد المصدرية والمراجع'),
            proposed('input.definition', 'Record the program definition — field, audience, outcomes, duration, workload', 'تسجيل تعريف البرنامج — المجال والجمهور والمخرجات والمدة وعبء العمل', {
              source: { sheet: SHEETS.RESEARCH, rows: [4, 5, 6, 7, 8], relation: 'reuses the Research definitions' },
            }),
            proposed('input.tools', 'Record the AI tools and prompts that will be used', 'تسجيل أدوات الذكاء الاصطناعي والتعليمات التي ستستخدم'),
          ],
        }),
      ],
    }),
    stage('AI_OUTLINES', {
      label: L('Outlines', 'المخططات'),
      description: L('Create the lessons and generate each lesson outline.', 'إنشاء الدروس وتوليد مخطط كل درس.'),
      source: M(4, 'G4:H4', 'new_curr_draft_2', 'Outlines'),
      after: ['AI_INPUT'],
      ownerRole: 'RESEARCHER',
      lessonAssets: true,
      note: aiNote,
      tasks: [
        task('ai.outlines.generate', {
          label: L('Generate the lesson outlines', 'توليد مخططات الدروس'),
          role: 'RESEARCHER',
          origin: 'PROPOSED',
          checklist: [
            proposed('outlines.lessons', 'Create the lessons from the program structure', 'إنشاء الدروس من هيكل البرنامج'),
            proposed('outlines.generate', "Generate each lesson outline and save it as the lesson's Outline, marked AI-assisted", 'توليد مخطط كل درس وحفظه كمخطط الدرس مع تعليمه كمُعد بمساعدة الذكاء الاصطناعي'),
          ],
        }),
        task('ai.outlines.submitted', {
          label: L('Every lesson outline sent for review', 'إرسال كل مخططات الدروس للمراجعة'),
          kind: 'AUTO',
          origin: 'PROPOSED',
          rule: { type: 'ASSETS_SUBMITTED', assetTypes: ['OUTLINE'] },
          after: ['ai.outlines.generate'],
        }),
      ],
    }),
    stage('AI_OUTLINE_REVIEW', {
      label: L('Outline review', 'مراجعة المخططات'),
      description: L('A person reviews and approves every outline.', 'يراجع شخص كل مخطط ويعتمده.'),
      source: M(5, 'G5:H5', 'new_exp_3', 'Review(Outlines)', 'The activity ID is the expert-acquisition ID; the label is the outline review.'),
      after: ['AI_OUTLINES'],
      ownerRole: 'SUBJECT_MATTER_EXPERT',
      note: aiNote,
      tasks: [
        task('ai.outlines.approved', {
          label: L('Every outline approved by a person', 'اعتماد كل المخططات من شخص مسؤول'),
          kind: 'AUTO',
          origin: 'WORKBOOK',
          source: { sheet: SHEETS.MASTER, rows: [5], cells: 'G5:H5' },
          rule: { type: 'ASSETS_APPROVED', assetTypes: ['OUTLINE'] },
        }),
        task('ai.outlines.accuracy', {
          label: L('Content and technical accuracy sign-off', 'اعتماد دقة المحتوى والدقة التقنية'),
          kind: 'SIGNOFF',
          role: 'INSTRUCTIONAL_DESIGNER',
          origin: 'PROPOSED',
          requiresApproval: true,
          reviewerRole: 'SUBJECT_MATTER_EXPERT',
          after: ['ai.outlines.approved'],
          checklist: [
            proposed('accuracy.content', 'Content accuracy checked across the outlines', 'مراجعة دقة المحتوى في كل المخططات'),
            proposed('accuracy.technical', 'Technical accuracy checked across the outlines', 'مراجعة الدقة التقنية في كل المخططات'),
            proposed('accuracy.definition', 'The outlines match the program definition', 'المخططات تطابق تعريف البرنامج'),
          ],
        }),
      ],
    }),
  ];
}

function aiProductionStages() {
  const M = (row, cells, id, label, note) => master('AI_NEW_PROGRAM', row, cells, id, label, note);
  return [
    stage('AI_SCRIPTS', {
      label: L('Scripts', 'السكريبتات'),
      description: L('Generate each lesson script; a person approves every one.', 'توليد سكريبت كل درس؛ ويعتمد شخص كل واحد منها.'),
      source: M(7, 'G7:H7', 'new_id_5', 'Scripts', 'The activity ID is the instructional-design ID.'),
      after: ['FINAL_CURRICULUM'],
      ownerRole: 'SCRIPT_WRITER',
      lessonAssets: true,
      note: aiNote,
      tasks: [
        task('ai.scripts.generate', {
          label: L('Generate the lesson scripts', 'توليد سكريبتات الدروس'),
          role: 'SCRIPT_WRITER',
          origin: 'PROPOSED',
          checklist: [
            proposed('scripts.generate', "Generate each lesson script and save it as the lesson's Script, marked AI-assisted", 'توليد سكريبت كل درس وحفظه كسكريبت الدرس مع تعليمه كمُعد بمساعدة الذكاء الاصطناعي'),
          ],
        }),
        task('ai.scripts.approved', {
          label: L('Every script approved by a person', 'اعتماد كل السكريبتات من شخص مسؤول'),
          kind: 'AUTO',
          origin: 'PROPOSED',
          rule: { type: 'ASSETS_APPROVED', assetTypes: ['SCRIPT'] },
          after: ['ai.scripts.generate'],
        }),
      ],
    }),
    stage('AI_SCRIPT_REVIEW', {
      label: L('Script review, if any', 'مراجعة السكريبتات عند الحاجة'),
      description: L('An expert pass over the scripts when the program needs one.', 'مراجعة خبير للسكريبتات عندما يحتاجها البرنامج.'),
      source: M(8, 'G8:H8', 'new_exp_6', 'Review(Scripts) if any', '"new_exp_6" does not exist in the new-program list.'),
      after: ['AI_SCRIPTS'],
      ownerRole: 'SUBJECT_MATTER_EXPERT',
      tasks: [
        task('ai.scripts.expert_review', {
          label: L('Expert review of the scripts', 'مراجعة الخبير للسكريبتات'),
          kind: 'REVIEW',
          role: 'SUBJECT_MATTER_EXPERT',
          classification: 'CONDITIONAL',
          condition: L('When the program needs an expert pass on its scripts', 'عندما يحتاج البرنامج مراجعة خبير لسكريبتاته'),
          origin: 'WORKBOOK',
          source: { sheet: SHEETS.MASTER, rows: [8], cells: 'G8:H8' },
          requiresApproval: true,
          reviewerRole: 'PRODUCTION_MANAGER',
          approvalOrigin: 'PROPOSED',
          checklist: [
            proposed('script.content', 'Content accuracy', 'دقة المحتوى'),
            proposed('script.technical', 'Technical accuracy', 'الدقة التقنية'),
            proposed('script.terms', 'Technical terms whose pronunciation needs care are flagged', 'تمييز المصطلحات التقنية التي يحتاج نطقها إلى عناية'),
          ],
        }),
      ],
    }),
    stage('AI_SLIDES', {
      label: L('Slides by Docki', 'الشرائح عبر Docki'),
      description: L('Hand the approved scripts to Docki and bring the slides back for review.', 'تسليم السكريبتات المعتمدة إلى Docki وإعادة الشرائح للمراجعة.'),
      source: M(9, 'G9:H9', 'new_id_7', 'Slides by docki'),
      after: ['AI_SCRIPT_REVIEW'],
      ownerRole: 'PPT_DESIGNER',
      lessonAssets: true,
      note: L(
        'Docki is an external tool with no integration contract. The handoff is recorded by hand, with a link or file as evidence.',
        'Docki أداة خارجية دون عقد تكامل. يُسجَّل التسليم يدويًا مع رابط أو ملف كدليل.'
      ),
      tasks: [
        task('ai.slides.handoff', {
          label: L('Hand the scripts to Docki', 'تسليم السكريبتات إلى Docki'),
          kind: 'HANDOFF',
          role: 'PPT_DESIGNER',
          externalTool: 'Docki',
          origin: 'WORKBOOK',
          source: { sheet: SHEETS.MASTER, rows: [9], cells: 'G9:H9' },
          evidence: L('The Docki handoff link or file', 'رابط أو ملف التسليم إلى Docki'),
          checklist: [
            proposed('docki.send', 'Send the approved scripts to Docki', 'إرسال السكريبتات المعتمدة إلى Docki'),
            proposed('docki.receive', 'Receive the generated slides', 'استلام الشرائح المولدة'),
            proposed('docki.upload', "Upload each lesson's slides as its PPT version, marked AI-assisted", 'رفع شرائح كل درس كنسخة PPT مع تعليمها كمُعدة بمساعدة الذكاء الاصطناعي'),
          ],
        }),
        task('ai.slides.approved', {
          label: L('Every lesson deck approved by a person', 'اعتماد كل عروض الدروس من شخص مسؤول'),
          kind: 'AUTO',
          origin: 'PROPOSED',
          rule: { type: 'ASSETS_APPROVED', assetTypes: ['PPT'] },
          after: ['ai.slides.handoff'],
        }),
      ],
    }),
    stage('AI_VOICE_VIDEO', {
      label: L('Voice-over generation and Think video', 'توليد التعليق الصوتي وفيديو Think'),
      description: L('Generate the voice-over, then hand slides and voice-over to Think for the video.', 'توليد التعليق الصوتي، ثم تسليم الشرائح والتعليق إلى Think لإنتاج الفيديو.'),
      source: M(10, 'G10:H10', 'new_media_8', 'Vo generation / Think (Slides+ Vo)'),
      after: ['AI_SLIDES'],
      ownerRole: 'VIDEO_EDITOR',
      lessonAssets: true,
      note: L(
        'Think is an external tool with no integration contract. The handoff is recorded by hand, with a link or file as evidence.',
        'Think أداة خارجية دون عقد تكامل. يُسجَّل التسليم يدويًا مع رابط أو ملف كدليل.'
      ),
      tasks: [
        task('ai.vo.generate', {
          label: L('Generate the voice-over', 'توليد التعليق الصوتي'),
          kind: 'HANDOFF',
          role: 'VOICE_OVER_ARTIST',
          origin: 'WORKBOOK',
          source: { sheet: SHEETS.MASTER, rows: [10], cells: 'G10:H10' },
          checklist: [
            proposed('vo.generate', "Generate each lesson's voice-over from its approved script", 'توليد التعليق الصوتي لكل درس من سكريبته المعتمد'),
            proposed('vo.upload', "Upload it as the lesson's Voice Over version, marked AI-assisted", 'رفعه كنسخة التعليق الصوتي للدرس مع تعليمه كمُعد بمساعدة الذكاء الاصطناعي'),
          ],
        }),
        task('ai.vo.approved', {
          label: L('Every voice-over approved by a person', 'اعتماد كل التعليقات الصوتية من شخص مسؤول'),
          kind: 'AUTO',
          origin: 'PROPOSED',
          rule: { type: 'ASSETS_APPROVED', assetTypes: ['VOICE_OVER'] },
          after: ['ai.vo.generate'],
        }),
        task('ai.video.handoff', {
          label: L('Hand the slides and voice-over to Think', 'تسليم الشرائح والتعليق الصوتي إلى Think'),
          kind: 'HANDOFF',
          role: 'VIDEO_EDITOR',
          externalTool: 'Think',
          origin: 'WORKBOOK',
          source: { sheet: SHEETS.MASTER, rows: [10], cells: 'G10:H10' },
          evidence: L('The Think handoff link or file', 'رابط أو ملف التسليم إلى Think'),
          after: ['ai.vo.approved'],
          checklist: [
            proposed('think.send', 'Send the approved slides and voice-over to Think', 'إرسال الشرائح والتعليق الصوتي المعتمدين إلى Think'),
            proposed('think.receive', 'Receive the rendered videos', 'استلام الفيديوهات المنتجة'),
            proposed('think.upload', "Upload each lesson video as its Video version, marked AI-assisted", 'رفع فيديو كل درس كنسخة فيديو مع تعليمه كمُعد بمساعدة الذكاء الاصطناعي'),
          ],
        }),
        task('ai.video.submitted', {
          label: L('Every lesson video sent for review', 'إرسال كل فيديوهات الدروس للمراجعة'),
          kind: 'AUTO',
          origin: 'PROPOSED',
          rule: { type: 'ASSETS_SUBMITTED', assetTypes: ['VIDEO'] },
          after: ['ai.video.handoff'],
        }),
      ],
    }),
    stage('AI_VIDEO_REVIEW', {
      label: L('Review every video', 'مراجعة كل الفيديوهات'),
      description: L('Review every video and write every comment.', 'مراجعة كل فيديو وكتابة كل الملاحظات.'),
      source: M(11, 'G11:H11', 'new_id_9', 'Review all videos and write all comments'),
      after: ['AI_VOICE_VIDEO'],
      ownerRole: 'QUALITY_REVIEWER',
      tasks: [
        task('ai.video.reviewed', {
          label: L('Every video reviewed, comments recorded', 'مراجعة كل فيديو وتسجيل ملاحظاته'),
          kind: 'AUTO',
          origin: 'WORKBOOK',
          source: { sheet: SHEETS.MASTER, rows: [11], cells: 'G11:H11' },
          rule: { type: 'ASSETS_REVIEWED', assetTypes: ['VIDEO'] },
        }),
      ],
    }),
    stage('AI_COMMENTS_FIX', {
      label: L('Implement every comment', 'تنفيذ كل الملاحظات'),
      description: L('Address every video comment and resubmit.', 'معالجة كل ملاحظة على الفيديو وإعادة الإرسال.'),
      source: M(12, 'G12:H12', 'new_media_9', 'implement all comments', 'The ID repeats the number 9 already used on row 11.'),
      after: ['AI_VIDEO_REVIEW'],
      ownerRole: 'VIDEO_EDITOR',
      tasks: [
        task('ai.comments.fixed', {
          label: L('No video waiting on changes, no comment left open', 'لا فيديو بانتظار تعديل ولا ملاحظة مفتوحة'),
          kind: 'AUTO',
          origin: 'WORKBOOK',
          source: { sheet: SHEETS.MASTER, rows: [12], cells: 'G12:H12' },
          rule: { type: 'ASSET_FEEDBACK_ADDRESSED', assetTypes: ['VIDEO'] },
        }),
      ],
    }),
    stage('AI_COMMENTS_VERIFY', {
      label: L('Check every comment', 'التحقق من كل الملاحظات'),
      description: L('Confirm every comment was addressed and approve the videos.', 'التأكد من معالجة كل ملاحظة واعتماد الفيديوهات.'),
      source: M(13, 'G13:H13', 'new_id_10', 'Check all comments'),
      after: ['AI_COMMENTS_FIX'],
      ownerRole: 'INSTRUCTIONAL_DESIGNER',
      tasks: [
        task('ai.comments.verified', {
          label: L('Every video approved with no open comment', 'اعتماد كل الفيديوهات دون ملاحظات مفتوحة'),
          kind: 'AUTO',
          origin: 'WORKBOOK',
          source: { sheet: SHEETS.MASTER, rows: [13], cells: 'G13:H13' },
          rule: { type: 'ASSETS_APPROVED', assetTypes: ['VIDEO'], noOpenComments: true },
        }),
      ],
    }),
  ];
}

/* ------------------------------------------------------------------ */
/* Revamp                                                               */
/* ------------------------------------------------------------------ */

function changeImpactStage() {
  return stage('CHANGE_IMPACT', {
    label: L('Baseline and change impact', 'خط الأساس وأثر التغيير'),
    description: L(
      'Before work starts, decide against the source release what stays, what changes, what is removed and what must be re-approved.',
      'قبل بدء العمل، تحديد ما يبقى وما يتغير وما يُحذف وما يجب اعتماده من جديد مقارنة بالإصدار المصدر.'
    ),
    origin: 'PROPOSED',
    ownerRole: 'PRODUCTION_MANAGER',
    note: L(
      'The workbook starts a revamp at instructional design. Reviewing the baseline first is a proposal pending the business owner.',
      'يبدأ ملف العمل التطوير من التصميم التعليمي. مراجعة خط الأساس أولًا مقترحة بانتظار اعتماد مالك العمل.'
    ),
    tasks: [
      task('impact.review', {
        label: L('Record the change impact', 'تسجيل أثر التغيير'),
        kind: 'SIGNOFF',
        role: 'PRODUCTION_MANAGER',
        origin: 'PROPOSED',
        requiresApproval: true,
        reviewerRole: 'INSTRUCTIONAL_DESIGNER',
        checklist: [
          proposed('impact.source', 'Review the source release', 'مراجعة الإصدار المصدر'),
          proposed('impact.decide', 'Mark what stays, what changes and what is removed', 'تحديد ما يبقى وما يتغير وما يُحذف'),
          proposed('impact.reapprove', 'List what must be re-approved', 'حصر ما يجب اعتماده من جديد'),
          proposed('impact.reference', 'Note what can be referenced unchanged', 'تحديد ما يمكن الرجوع إليه دون تغيير'),
        ],
      }),
    ],
  });
}

function revampStages({ options }) {
  const M = (row, cells, id, label, note) => master('REVAMP', row, cells, id, label, note);
  const start = options.changeImpact ? ['CHANGE_IMPACT'] : [];
  const stages = [];
  if (options.changeImpact) stages.push(changeImpactStage());
  stages.push(
    instructionalDesignStage(M(3, 'D3:E3', 'rev_id_1', 'Instruction Designing'), { after: start, hiddenChecklist: options.idHiddenChecklist }),
    mediaStage(M(4, 'D4:E4', 'rev_media_2', 'Media Production', 'The Media Production sheet names the revamp ID "upg_media_6".'), { after: start }),
    deploymentStage(M(5, 'D5:E5', 'rev_deploy_3', 'Platform Deployment'), {
      after: ['INSTRUCTIONAL_DESIGN', 'MEDIA_PRODUCTION'],
      revamp: true,
      hiddenChecklist: options.deployHiddenChecklist,
    }),
    dryRunStage('DRY_RUN_1', M(6, 'D6:E6', 'rev_first_run_4', 'First Internal Dry Run'), { after: ['PLATFORM_DEPLOYMENT'], cycle: 1 }),
    stage('APPLY_CHANGES', {
      label: L('Apply changes, if any', 'تطبيق التعديلات إن وجدت'),
      description: L('Apply any further changes the team decided outside the dry-run findings.', 'تطبيق أي تعديلات إضافية قررها الفريق خارج نتائج التجربة الداخلية.'),
      source: M(7, 'D7:E7', 'rev_change_5', 'Applying Changes if Any'),
      after: ['DRY_RUN_1'],
      note: L(
        'The workbook lists this stage separately from applying the dry-run comments but gives neither a checklist. Its operational checklist is pending the business owner.',
        'يذكر ملف العمل هذه المرحلة منفصلة عن تطبيق ملاحظات التجربة، دون قائمة لأي منهما. قائمتها التشغيلية بانتظار اعتماد مالك العمل.'
      ),
      tasks: [
        task('change.apply', {
          label: L('Apply further changes, if any', 'تطبيق تعديلات إضافية إن وجدت'),
          role: 'PRODUCTION_MANAGER',
          classification: 'CONDITIONAL',
          condition: L('When changes beyond the dry-run findings were decided', 'عند تقرير تعديلات تتجاوز نتائج التجربة'),
          origin: 'WORKBOOK',
          source: { sheet: SHEETS.MASTER, rows: [7], cells: 'D7:E7' },
          evidence: L('The list of applied changes', 'قائمة التعديلات المطبقة'),
          checklist: [
            proposed('change.list', 'List the changes to apply', 'حصر التعديلات المطلوب تطبيقها'),
            proposed('change.record', 'Apply and record each change', 'تطبيق كل تعديل وتسجيله'),
          ],
        }),
      ],
    }),
    stage('APPLY_DRY_RUN_COMMENTS', {
      label: L('Apply the dry-run comments', 'تطبيق ملاحظات التجربة الداخلية'),
      description: L('Fix every dry-run issue, verify it, and redeploy.', 'إصلاح كل مشكلة من التجربة والتحقق منها ثم إعادة النشر.'),
      source: M(8, 'D8:E8', 'rev_change_deploy_6', 'Applying Dry Run Comments', 'The ID says "change deploy"; the label says "dry run comments". Both are covered here.'),
      after: ['APPLY_CHANGES'],
      tasks: dryRunFixesTasks({ stageKey: 'DRY_RUN_1', redeploy: true }),
    }),
    dryRunStage('DRY_RUN_2', M(9, 'D9:E9', 'rev_second_run_7', 'Second Internal Dry Run'), { after: ['APPLY_DRY_RUN_COMMENTS'], cycle: 2 }),
    uatStage(M(10, 'D10:E10', 'rev_uat_8', 'User Acceptance Test'), { after: ['DRY_RUN_2'] }),
    releaseStage({ after: ['UAT'] })
  );
  return stages;
}

/* ------------------------------------------------------------------ */
/* The three templates                                                  */
/* ------------------------------------------------------------------ */

/**
 * Configuration an administrator may change when publishing a template
 * version. Each is a decision the workbook leaves open.
 */
export const TEMPLATE_OPTIONS = /** @type {const} */ ({
  idHiddenChecklist: {
    scenarios: ['EXPERT_NEW', 'REVAMP'],
    default: true,
    label: L('Use the hidden ID checklist (Instruction Designing rows 25–37)', 'استخدام قائمة التصميم التعليمي المخفية (الصفوف 25–37)'),
  },
  deployHiddenChecklist: {
    scenarios: ['EXPERT_NEW', 'REVAMP', 'AI_NEW'],
    default: true,
    label: L('Use the hidden deployment checklist (Platform Deployment rows 11–41)', 'استخدام قائمة النشر المخفية (الصفوف 11–41)'),
  },
  changeImpact: {
    scenarios: ['REVAMP'],
    default: true,
    label: L('Start a revamp with a baseline and change-impact review', 'بدء التطوير بمراجعة خط الأساس وأثر التغيير'),
  },
  aiReleaseGates: {
    scenarios: ['AI_NEW'],
    default: true,
    label: L('Add deployment, UAT and release gates to the AI path', 'إضافة بوابات النشر واختبار القبول والإصدار لمسار الذكاء الاصطناعي'),
  },
  aiDryRun: {
    scenarios: ['AI_NEW'],
    default: false,
    label: L('Add an internal dry run to the AI path', 'إضافة تجربة داخلية لمسار الذكاء الاصطناعي'),
  },
});

export function defaultOptions(scenario) {
  const options = {};
  for (const [key, option] of Object.entries(TEMPLATE_OPTIONS)) {
    if (option.scenarios.includes(scenario)) options[key] = option.default;
  }
  return options;
}

export function normalizeOptions(scenario, input = {}) {
  const options = defaultOptions(scenario);
  for (const key of Object.keys(options)) {
    if (typeof input?.[key] === 'boolean') options[key] = input[key];
  }
  return options;
}

export const SCENARIO_LABELS = /** @type {const} */ ({
  AI_NEW: L('New program — AI-assisted', 'برنامج جديد — بمساعدة الذكاء الاصطناعي'),
  EXPERT_NEW: L('New program — expert-led', 'برنامج جديد — بقيادة خبير'),
  REVAMP: L('Revamp an existing program', 'تطوير برنامج قائم'),
  LEGACY: L('Legacy production', 'إنتاج سابق'),
});

/** Which lesson assets each path produces. Legacy courses keep all five. */
export const SCENARIO_ASSET_TYPES = /** @type {const} */ ({
  AI_NEW: ['OUTLINE', 'PPT', 'SCRIPT', 'VOICE_OVER', 'VIDEO'],
  EXPERT_NEW: ['OUTLINE', 'PPT', 'SCRIPT', 'VOICE_OVER', 'VIDEO'],
  REVAMP: ['OUTLINE', 'PPT', 'SCRIPT', 'VOICE_OVER', 'VIDEO'],
  LEGACY: ['OUTLINE', 'PPT', 'SCRIPT', 'VOICE_OVER', 'VIDEO'],
});

/**
 * One concrete template: every stage and task, options applied. This is what
 * a published version freezes and what a run is generated from.
 */
export function buildTemplate(scenario, input = {}) {
  if (!SCENARIOS.includes(scenario)) throw new Error(`[workflowTemplates] unknown scenario ${scenario}`);
  const options = normalizeOptions(scenario, input);
  const N = (row, cells, id, label, note) => master('NEW_PROGRAM', row, cells, id, label, note);
  let stages;

  if (scenario === 'EXPERT_NEW') {
    stages = [
      researchStage(N(2, 'A2:B2', 'new_res_1', 'Research')),
      curriculumDraftStage(N(3, 'A3:B3', 'new_curr_draft_2', '1st Draft Curriculum Development')),
      expertStage(N(4, 'A4:B4', 'new_exp_3', 'Experts and Coaches Acquisition')),
      finalCurriculumStage(N(5, 'A5:B5', 'new_curr_final_4', 'Final Curriculum Details'), { scenario }),
      instructionalDesignStage(N(6, 'A6:B6', 'new_id_5', 'Instructional Designing'), {
        after: ['FINAL_CURRICULUM'],
        hiddenChecklist: options.idHiddenChecklist,
      }),
      mediaStage(N(7, 'A7:B7', 'new_media_6', 'Media Production'), { after: ['FINAL_CURRICULUM'] }),
      deploymentStage(N(8, 'A8:B8', 'new_deploy_7', 'Platform Deployment'), {
        after: ['INSTRUCTIONAL_DESIGN', 'MEDIA_PRODUCTION'],
        hiddenChecklist: options.deployHiddenChecklist,
      }),
      dryRunStage(
        'DRY_RUN_1',
        N(9, 'A9:B9', 'new_first_run_8', '1st Draft Curriculum', 'Labelled "1st Draft Curriculum" but its activity ID and the "First Dry Run" sheet (new_first_run_8) make it the first internal dry run.'),
        { after: ['PLATFORM_DEPLOYMENT'], cycle: 1 }
      ),
      stage('DRY_RUN_FIXES', {
        label: L('Apply the dry-run comments', 'تطبيق ملاحظات التجربة الداخلية'),
        description: L('Track each dry-run issue to its owner, correction, evidence and re-check.', 'متابعة كل مشكلة من التجربة حتى مسؤولها وتصحيحها ودليلها وإعادة التحقق منها.'),
        source: N(10, 'A10:B10', 'new_change_9', 'Applying Dry Run Comments'),
        after: ['DRY_RUN_1'],
        note: L('The workbook has no sheet for this stage.', 'لا توجد ورقة لهذه المرحلة في ملف العمل.'),
        tasks: dryRunFixesTasks({ stageKey: 'DRY_RUN_1', redeploy: false }),
      }),
      stage('REDEPLOYMENT', {
        label: L('Platform deployment after changes', 'النشر بعد التعديلات'),
        description: L('Redeploy and re-verify what changed.', 'إعادة نشر ما تغيّر والتحقق منه.'),
        source: N(11, 'A11:B11', 'new_change_deploy_10', 'Platform Deployment After Changing'),
        after: ['DRY_RUN_FIXES'],
        ownerRole: 'LEARNING_OPERATIONS',
        note: L(
          'The workbook sheet for this stage is empty and its activity ID reads "new_res_1".',
          'ورقة هذه المرحلة في ملف العمل فارغة ورقم نشاطها "new_res_1".'
        ),
        tasks: [redeployTask([])],
      }),
      uatStage(N(12, 'A12:B12', 'new_uat_11', 'User Acceptance Test'), { after: ['REDEPLOYMENT'] }),
      releaseStage({ after: ['UAT'] }),
    ];
  } else if (scenario === 'AI_NEW') {
    stages = [
      ...aiStages(),
      finalCurriculumStage(master('AI_NEW_PROGRAM', 6, 'G6:H6', 'new_curr_final_4', 'Final Curriculum Details'), { scenario }),
      ...aiProductionStages(),
    ];
    if (options.aiReleaseGates) {
      stages.push(
        deploymentStage(null, { after: ['AI_COMMENTS_VERIFY'], hiddenChecklist: options.deployHiddenChecklist, proposedStage: true })
      );
      let uatAfter = ['PLATFORM_DEPLOYMENT'];
      if (options.aiDryRun) {
        stages.push(dryRunStage('DRY_RUN_1', null, { after: ['PLATFORM_DEPLOYMENT'], cycle: 1, proposedStage: true }));
        stages.push(
          stage('DRY_RUN_FIXES', {
            label: L('Apply the dry-run comments', 'تطبيق ملاحظات التجربة الداخلية'),
            origin: 'PROPOSED',
            after: ['DRY_RUN_1'],
            tasks: dryRunFixesTasks({ stageKey: 'DRY_RUN_1', redeploy: true }),
          })
        );
        uatAfter = ['DRY_RUN_FIXES'];
      }
      stages.push(uatStage(null, { after: uatAfter, proposedStage: true }), releaseStage({ after: ['UAT'] }));
    }
  } else {
    stages = revampStages({ options });
  }

  return {
    scenario,
    codeVersion: TEMPLATE_CODE_VERSION,
    label: SCENARIO_LABELS[scenario],
    options,
    lessonAssetTypes: [...SCENARIO_ASSET_TYPES[scenario]],
    stages,
  };
}

/** Every task key in a built template, for dependency checks. */
export function templateTaskKeys(template) {
  return template.stages.flatMap((entry) => entry.tasks.map((t) => t.key));
}

/**
 * A template is sound when stage and task dependencies point at things that
 * exist in it and run forwards. Returns the problems; empty means sound.
 */
export function validateTemplate(template) {
  const problems = [];
  const stageKeys = new Set();
  const taskKeys = new Set();
  for (const s of template.stages) {
    if (stageKeys.has(s.key)) problems.push(`duplicate stage ${s.key}`);
    for (const dependency of s.after) if (!stageKeys.has(dependency)) problems.push(`${s.key} waits for ${dependency}, which is not an earlier stage`);
    stageKeys.add(s.key);
    const local = new Set();
    for (const t of s.tasks) {
      if (taskKeys.has(t.key)) problems.push(`duplicate task ${t.key}`);
      for (const dependency of t.after) if (!local.has(dependency)) problems.push(`${t.key} waits for ${dependency}, which is not an earlier task in ${s.key}`);
      local.add(t.key);
      taskKeys.add(t.key);
      if (t.kind === 'AUTO' && !t.rule) problems.push(`${t.key} is automatic but has no rule`);
      if (t.kind !== 'AUTO' && !t.role) problems.push(`${t.key} has no responsible role`);
      if (!t.label?.en || !t.label?.ar) problems.push(`${t.key} is missing a label`);
      for (const entry of t.checklist) if (!entry.label?.en || !entry.label?.ar) problems.push(`${t.key}/${entry.key} is missing a label`);
    }
    // Conditional tasks gate their stage until they are waived with a reason;
    // optional ones never do. A stage with neither could close before it began.
    if (!s.tasks.some((t) => t.classification !== 'OPTIONAL')) problems.push(`${s.key} has no gating task, so it would close before it began`);
  }
  return problems;
}
