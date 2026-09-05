/**
 * Qodo Projects — interface strings.
 *
 * Kept apart from `src/lib/i18n.tsx`, which is already 1288 lines for the rest
 * of the workspace and would become unreviewable if Projects — a module with
 * more screens than everything else combined — poured into it. `t()` is
 * unchanged for every caller; the two maps are merged there.
 *
 * The `satisfies` clause is what enforces §76's "no key without a value": a
 * string added with only an English half fails `npm run typecheck` rather than
 * shipping an Arabic screen with an English word in the middle of it.
 *
 * Arabic here is Modern Standard — clear and everyday, matching the register
 * i18n.tsx already sets, not officialese.
 */

export const PROJECT_STRINGS = {
  /* ── the module ──────────────────────────────────────────── */
  'projects.title': { ar: 'المشاريع', en: 'Projects' },
  'projects.subtitle': {
    ar: 'التخطيط والتنفيذ والمتابعة — من أول فكرة المشروع لآخر ساعة مسجّلة.',
    en: 'Plan, run and track work — from the first brief to the last logged hour.',
  },
  'projects.new': { ar: 'مشروع جديد', en: 'New project' },
  'projects.search': { ar: 'ابحث باسم المشروع أو رمزه', en: 'Search by project name or key' },

  /* ── scopes ──────────────────────────────────────────────── */
  'projects.scope.active': { ar: 'النشطة', en: 'Active' },
  'projects.scope.mine': { ar: 'مشاريعي', en: 'My projects' },
  'projects.scope.favorites': { ar: 'المفضّلة', en: 'Favorites' },
  'projects.scope.archived': { ar: 'المؤرشفة', en: 'Archived' },
  'projects.scope.trashed': { ar: 'سلة المحذوفات', en: 'Recycle bin' },

  /* ── views ───────────────────────────────────────────────── */
  'projects.view.grid': { ar: 'بطاقات', en: 'Cards' },
  'projects.view.table': { ar: 'جدول', en: 'Table' },

  /* ── fields ──────────────────────────────────────────────── */
  'projects.field.name': { ar: 'اسم المشروع', en: 'Project name' },
  'projects.field.key': { ar: 'الرمز', en: 'Key' },
  'projects.field.keyHint': {
    ar: 'رمز قصير يظهر قبل رقم كل مهمة ومشكلة. لا يمكن تغييره بعد الإنشاء.',
    en: 'A short prefix on every task and issue reference. It cannot be changed later.',
  },
  'projects.field.description': { ar: 'الوصف', en: 'Description' },
  'projects.field.owner': { ar: 'المسؤول', en: 'Owner' },
  'projects.field.customer': { ar: 'العميل', en: 'Customer' },
  'projects.field.group': { ar: 'المجموعة', en: 'Group' },
  'projects.field.status': { ar: 'الحالة', en: 'Status' },
  'projects.field.startDate': { ar: 'تاريخ البدء', en: 'Start date' },
  'projects.field.endDate': { ar: 'تاريخ الانتهاء', en: 'End date' },
  'projects.field.access': { ar: 'الوصول', en: 'Access' },
  'projects.field.currency': { ar: 'العملة', en: 'Currency' },
  'projects.field.members': { ar: 'الأعضاء', en: 'Members' },
  'projects.field.updated': { ar: 'آخر تحديث', en: 'Last updated' },

  /* ── access ──────────────────────────────────────────────── */
  'projects.access.private': { ar: 'خاص', en: 'Private' },
  'projects.access.privateHint': {
    ar: 'الأعضاء المضافون فقط يفتحون المشروع.',
    en: 'Only the people you add can open it.',
  },
  'projects.access.portal': { ar: 'مفتوح للمساحة', en: 'Open to the workspace' },
  'projects.access.portalHint': {
    ar: 'أي زميل في المساحة يقدر يشوفه للقراءة. العملاء لا.',
    en: 'Any colleague may read it. Clients still cannot.',
  },

  /* ── actions ─────────────────────────────────────────────── */
  'projects.action.open': { ar: 'فتح', en: 'Open' },
  'projects.action.favorite': { ar: 'إضافة للمفضّلة', en: 'Add to favorites' },
  'projects.action.unfavorite': { ar: 'إزالة من المفضّلة', en: 'Remove from favorites' },
  'projects.action.archive': { ar: 'أرشفة', en: 'Archive' },
  'projects.action.unarchive': { ar: 'إلغاء الأرشفة', en: 'Unarchive' },
  'projects.action.delete': { ar: 'نقل لسلة المحذوفات', en: 'Move to recycle bin' },
  'projects.action.restore': { ar: 'استرجاع', en: 'Restore' },

  /* ── confirmations ───────────────────────────────────────── */
  'projects.confirm.archive': {
    ar: 'هيختفي من قائمة المشاريع النشطة، وكل شيء بداخله يفضل محفوظًا.',
    en: 'It leaves the active list. Everything inside it is kept.',
  },
  'projects.confirm.delete': {
    ar: 'هينتقل لسلة المحذوفات، وتقدر ترجّعه منها.',
    en: 'It moves to the recycle bin, and you can restore it from there.',
  },

  /* ── empty states ────────────────────────────────────────── */
  'projects.empty.active': { ar: 'لا توجد مشاريع نشطة', en: 'No active projects' },
  'projects.empty.activeHint': {
    ar: 'ابدأ بمشروع جديد، وقسّمه بعدها لمراحل وقوائم مهام.',
    en: 'Start a project, then break it into phases and task lists.',
  },
  'projects.empty.mine': { ar: 'لست عضوًا في أي مشروع بعد', en: 'You are not in any project yet' },
  'projects.empty.mineHint': {
    ar: 'مدير المشروع هو اللي بيضيفك؛ لو محتاج وصول اطلبه منه.',
    en: 'A project manager adds you. Ask one if you need access.',
  },
  'projects.empty.favorites': { ar: 'لا توجد مشاريع مفضّلة', en: 'No favorites yet' },
  'projects.empty.favoritesHint': {
    ar: 'علّم أي مشروع بنجمة ليظهر هنا في المقدمة.',
    en: 'Star a project and it appears here first.',
  },
  'projects.empty.archived': { ar: 'لا توجد مشاريع مؤرشفة', en: 'Nothing archived' },
  'projects.empty.archivedHint': {
    ar: 'المشاريع المنتهية اللي تؤرشفها هتظهر هنا.',
    en: 'Finished projects you archive show up here.',
  },
  'projects.empty.trashed': { ar: 'سلة المحذوفات فارغة', en: 'The recycle bin is empty' },
  'projects.empty.trashedHint': {
    ar: 'المحذوف يفضل هنا لحد ما تحذفه نهائيًا.',
    en: 'Deleted projects stay here until they are purged.',
  },
  'projects.empty.search': { ar: 'لا نتائج لهذا البحث', en: 'No matching projects' },
  'projects.empty.searchHint': {
    ar: 'جرّب كلمة أقصر، أو رمز المشروع.',
    en: 'Try a shorter word, or the project key.',
  },

  /* ── errors ──────────────────────────────────────────────── */
  'projects.error.load': { ar: 'تعذّر تحميل المشاريع.', en: 'Projects could not be loaded.' },
  'projects.error.retry': { ar: 'إعادة المحاولة', en: 'Try again' },
  'projects.error.nameRequired': { ar: 'اسم المشروع مطلوب.', en: 'A project name is required.' },
  'projects.error.endBeforeStart': {
    ar: 'تاريخ الانتهاء لا يصح أن يسبق تاريخ البدء.',
    en: 'The end date cannot be before the start date.',
  },
  'projects.error.forbidden': {
    ar: 'ليست لديك صلاحية تنفيذ هذا الإجراء.',
    en: 'You do not have permission to do that.',
  },
  /**
   * Projects is the first module here that needs a real database, so this is
   * the first message of its kind in the product. It says what is missing
   * rather than "something went wrong", because the person reading it in
   * development is the person who can fix it in one command.
   */
  'projects.error.storage': {
    ar: 'وحدة المشاريع محتاجة قاعدة بيانات PostgreSQL. اضبط DATABASE_URL ثم أعد التشغيل.',
    en: 'Projects needs a PostgreSQL database. Set DATABASE_URL and restart.',
  },

  /* ── counts ──────────────────────────────────────────────── */
  'projects.count': { ar: '{n} مشروع', en: '{n} projects' },
  'projects.memberCount': { ar: '{n} عضو', en: '{n} members' },
  'projects.creating': { ar: 'جارٍ الإنشاء…', en: 'Creating…' },
  'projects.created': { ar: 'تم إنشاء المشروع.', en: 'Project created.' },

  /* ── project navigation ──────────────────────────────────── */
  'projects.nav.overview': { ar: 'نظرة عامة', en: 'Overview' },
  'projects.nav.phases': { ar: 'المراحل', en: 'Phases' },
  'projects.nav.tasks': { ar: 'المهام', en: 'Tasks' },
  'projects.nav.gantt': { ar: 'المخطط الزمني', en: 'Gantt' },
  'projects.nav.issues': { ar: 'المشاكل', en: 'Issues' },
  'projects.nav.timesheet': { ar: 'الوقت', en: 'Timesheet' },
  'projects.nav.documents': { ar: 'المستندات', en: 'Documents' },
  'projects.nav.activity': { ar: 'النشاط', en: 'Activity' },
  'projects.nav.members': { ar: 'الأعضاء', en: 'Members' },
  'projects.nav.settings': { ar: 'الإعدادات', en: 'Settings' },
  'projects.backToList': { ar: 'كل المشاريع', en: 'All projects' },

  /* ── phases ──────────────────────────────────────────────── */
  'phases.title': { ar: 'المراحل', en: 'Phases' },
  'phases.new': { ar: 'مرحلة جديدة', en: 'New phase' },
  'phases.empty': { ar: 'لا توجد مراحل بعد', en: 'No phases yet' },
  'phases.emptyHint': {
    ar: 'المرحلة هي أكبر قطعة في المشروع — قسّم عليها قوائم المهام.',
    en: 'A phase is the largest piece of a project. Task lists hang off it.',
  },
  'phases.field.name': { ar: 'اسم المرحلة', en: 'Phase name' },
  'phases.field.visibility': { ar: 'الظهور', en: 'Visibility' },
  'phases.visibility.internal': { ar: 'داخلي', en: 'Internal' },
  'phases.visibility.internalHint': {
    ar: 'الفريق فقط. العميل لن يرى هذه المرحلة ولا أي شيء بداخلها.',
    en: 'Staff only. A client never sees this phase or anything inside it.',
  },
  'phases.visibility.external': { ar: 'مرئي للعميل', en: 'Visible to the client' },
  'phases.visibility.externalHint': {
    ar: 'العميل المضاف للمشروع يقدر يتابع تقدّم هذه المرحلة.',
    en: 'A client added to the project can follow this phase.',
  },
  'phases.progress': { ar: '{done} من {total} مهمة', en: '{done} of {total} tasks' },

  /* ── task lists ──────────────────────────────────────────── */
  'taskLists.title': { ar: 'قوائم المهام', en: 'Task lists' },
  'taskLists.new': { ar: 'قائمة جديدة', en: 'New task list' },
  'taskLists.unfiled': { ar: 'بدون قائمة', en: 'No task list' },
  'taskLists.empty': { ar: 'لا توجد قوائم مهام', en: 'No task lists' },
  'taskLists.emptyHint': {
    ar: 'القائمة هي اللي بتجمّع المهام المترابطة — ابدأ بواحدة.',
    en: 'A list groups related tasks. Start with one.',
  },
  'taskLists.field.billing': { ar: 'نوع الفوترة', en: 'Billing' },
  'taskLists.billing.none': { ar: 'غير محدد', en: 'Unset' },
  'taskLists.billing.billable': { ar: 'قابل للفوترة', en: 'Billable' },
  'taskLists.billing.non_billable': { ar: 'غير قابل للفوترة', en: 'Non-billable' },

  /* ── tasks ───────────────────────────────────────────────── */
  'projectTasks.title': { ar: 'المهام', en: 'Tasks' },
  'projectTasks.new': { ar: 'مهمة جديدة', en: 'New task' },
  'projectTasks.newSubtask': { ar: 'مهمة فرعية', en: 'Subtask' },
  'projectTasks.empty': { ar: 'لا توجد مهام', en: 'No tasks' },
  'projectTasks.emptyHint': {
    ar: 'أضف أول مهمة، وقسّمها لمهام فرعية لو احتجت.',
    en: 'Add the first task, and break it into subtasks if you need to.',
  },
  'projectTasks.view.list': { ar: 'قائمة', en: 'List' },
  'projectTasks.view.board': { ar: 'لوحة', en: 'Board' },
  'projectTasks.filter.all': { ar: 'الكل', en: 'All' },
  'projectTasks.filter.mine': { ar: 'المسندة لي', en: 'Assigned to me' },
  'projectTasks.filter.overdue': { ar: 'متأخرة', en: 'Overdue' },
  'projectTasks.field.title': { ar: 'عنوان المهمة', en: 'Task title' },
  'projectTasks.field.list': { ar: 'قائمة المهام', en: 'Task list' },
  'projectTasks.field.phase': { ar: 'المرحلة', en: 'Phase' },
  'projectTasks.field.duration': { ar: 'المدة (أيام عمل)', en: 'Duration (working days)' },
  'projectTasks.field.estimated': { ar: 'الساعات المقدّرة', en: 'Estimated hours' },
  'projectTasks.field.progress': { ar: 'التقدّم', en: 'Progress' },
  'projectTasks.field.priority': { ar: 'الأولوية', en: 'Priority' },
  'projectTasks.subtasks': { ar: '{n} مهمة فرعية', en: '{n} subtasks' },
  'projectTasks.checklist': { ar: '{done}/{total} في القائمة', en: '{done}/{total} checklist' },
  'projectTasks.checklistBlocked': {
    ar: 'لسه فيه بنود مطلوبة غير مكتملة — لا يمكن إنهاء المهمة.',
    en: 'Required checklist items are still open — the task cannot be completed.',
  },
  'projectTasks.overdue': { ar: 'متأخرة', en: 'Overdue' },
  'projectTasks.showSubtasks': { ar: 'عرض المهام الفرعية', en: 'Show subtasks' },
  'projectTasks.hideSubtasks': { ar: 'إخفاء المهام الفرعية', en: 'Hide subtasks' },

  /* ── errors ──────────────────────────────────────────────── */
  'projects.error.checklistIncomplete': {
    ar: 'فيه بنود مطلوبة في قائمة التحقق لسه غير مكتملة.',
    en: 'Required checklist items are still open.',
  },
  'projects.error.wouldCycle': {
    ar: 'ده هيعمل حلقة مقفولة في تبعية المهام.',
    en: 'That would create a loop in the task hierarchy.',
  },
  'projects.error.maxDepth': {
    ar: 'وصلت لأقصى عمق مسموح للمهام الفرعية.',
    en: 'That is as deep as subtasks can nest.',
  },

  /* ── project membership ──────────────────────────────────── */
  'projectMembers.roleLegend': { ar: 'الدور داخل المشروع', en: 'Role in this project' },
  'projectMembers.role.owner': { ar: 'مالك المشروع', en: 'Project owner' },
  'projectMembers.role.manager': { ar: 'مدير المشروع', en: 'Project manager' },
  'projectMembers.role.member': { ar: 'عضو', en: 'Member' },
  'projectMembers.role.viewer': { ar: 'مشاهد', en: 'Viewer' },
  'projectMembers.role.client': { ar: 'عميل', en: 'Client' },
  'projectMembers.roleHint.owner': {
    ar: 'مسؤول المشروع. لا يمكن إزالته — غيّر المالك أولاً.',
    en: 'Accountable for the project. Cannot be removed — change the owner first.',
  },
  'projectMembers.roleHint.manager': {
    ar: 'يخطّط ويكلّف ويعتمد الوقت ويتابع الميزانية.',
    en: 'Plans, assigns, approves time and watches the budget.',
  },
  'projectMembers.roleHint.member': {
    ar: 'ينفّذ المهام ويسجّل وقته. لا يعدّل المشروع ولا يرى الأسعار.',
    en: 'Works tasks and logs time. Cannot edit the project or see rates.',
  },
  'projectMembers.roleHint.viewer': {
    ar: 'قراءة فقط، مهما كانت صلاحياته في مكان آخر.',
    en: 'Read-only, whatever their permissions are elsewhere.',
  },
  'projectMembers.roleHint.client': {
    ar: 'عميل من خارج الشركة. يرى فقط المراحل والقوائم المعلَّمة كمرئية للعميل — ولا يرى الوقت ولا الميزانية ولا التعليقات الداخلية أبدًا.',
    en: 'An outside customer. Sees only what is marked client-visible — never time, budget or internal comments.',
  },

  /* ── gantt ───────────────────────────────────────────────── */
  'gantt.title': { ar: 'المخطط الزمني', en: 'Gantt' },
  'gantt.noDates': {
    ar: 'مفيش مهام لها تواريخ بعد — حدّد تاريخ بداية ومدة عشان تظهر هنا.',
    en: 'No task has dates yet. Give one a start date and a duration to see it here.',
  },
  'gantt.critical': { ar: 'على المسار الحرج', en: 'On the critical path' },
  'gantt.float': { ar: 'الفائض', en: 'Float' },
  'gantt.zoom.day': { ar: 'يوم', en: 'Day' },
  'gantt.zoom.week': { ar: 'أسبوع', en: 'Week' },
  'gantt.zoom.month': { ar: 'شهر', en: 'Month' },
  'gantt.baseline': { ar: 'خط الأساس', en: 'Baseline' },
  'gantt.captureBaseline': { ar: 'تثبيت خط أساس', en: 'Capture baseline' },
  'gantt.baselineCaptured': { ar: 'تم تثبيت خط الأساس.', en: 'Baseline captured.' },
  'gantt.noBaseline': { ar: 'بدون خط أساس', en: 'No baseline' },
  'gantt.criticalPath': { ar: 'المسار الحرج', en: 'Critical path' },
  'gantt.cycle': {
    ar: 'فيه حلقة مقفولة في التبعيات — لا يمكن حساب الجدول.',
    en: 'The dependencies contain a loop, so the schedule cannot be computed.',
  },
  'gantt.moveConfirm': {
    ar: 'نقل المهمة هيحرّك {n} مهمة تانية، والمشروع هيتأخر {days} يوم عمل. تمام؟',
    en: 'Moving this shifts {n} other tasks and pushes the project {days} working days later. Go ahead?',
  },
  'gantt.moveConfirmNoSlip': {
    ar: 'نقل المهمة هيحرّك {n} مهمة تانية من غير ما يتأخر المشروع. تمام؟',
    en: 'Moving this shifts {n} other tasks without delaying the project. Go ahead?',
  },
  'gantt.moved': { ar: 'تم تحديث الجدول.', en: 'The schedule was updated.' },

  /* ── issues ──────────────────────────────────────────────── */
  'issues.title': { ar: 'المشاكل', en: 'Issues' },
  'issues.new': { ar: 'تسجيل مشكلة', en: 'Report an issue' },
  'issues.empty': { ar: 'لا توجد مشاكل مسجّلة', en: 'No issues reported' },
  'issues.emptyHint': {
    ar: 'المشكلة حاجة غلط اتلاقت — مش شغل متفق عليه. المهام مكانها تبويب المهام.',
    en: 'An issue is something found wrong, not work that was agreed. Agreed work belongs in Tasks.',
  },
  'issues.filter.open': { ar: 'المفتوحة', en: 'Open' },
  'issues.filter.mine': { ar: 'المسندة لي', en: 'Assigned to me' },
  'issues.filter.reported': { ar: 'اللي سجّلتها', en: 'Reported by me' },
  'issues.filter.all': { ar: 'الكل', en: 'All' },
  'issues.field.title': { ar: 'عنوان المشكلة', en: 'Issue title' },
  'issues.field.severity': { ar: 'الخطورة', en: 'Severity' },
  'issues.field.reproducibility': { ar: 'قابلية التكرار', en: 'Reproducibility' },
  'issues.field.module': { ar: 'الجزء المتأثر', en: 'Affected area' },
  'issues.field.assignee': { ar: 'المسؤول', en: 'Assignee' },
  'issues.field.visibility': { ar: 'الظهور للعميل', en: 'Client visibility' },
  'issues.visibility.internal': { ar: 'داخلي', en: 'Internal' },
  'issues.visibility.internalHint': {
    ar: 'الفريق فقط. العميل لن يرى هذه المشكلة.',
    en: 'Staff only. A client never sees this issue.',
  },
  'issues.visibility.external': { ar: 'مرئي للعميل', en: 'Visible to the client' },
  'issues.visibility.externalHint': {
    ar: 'العميل هيقدر يتابع المشكلة دي وحالتها.',
    en: 'The client can follow this issue and its status.',
  },
  'issues.severity.cosmetic': { ar: 'شكلية', en: 'Cosmetic' },
  'issues.severity.minor': { ar: 'بسيطة', en: 'Minor' },
  'issues.severity.major': { ar: 'كبيرة', en: 'Major' },
  'issues.severity.critical': { ar: 'حرجة', en: 'Critical' },
  'issues.severity.blocker': { ar: 'معطّلة', en: 'Blocker' },
  'issues.repro.always': { ar: 'دائمًا', en: 'Always' },
  'issues.repro.sometimes': { ar: 'أحيانًا', en: 'Sometimes' },
  'issues.repro.rarely': { ar: 'نادرًا', en: 'Rarely' },
  'issues.repro.unable': { ar: 'تعذّر التكرار', en: 'Unable to reproduce' },
  'issues.repro.not_tried': { ar: 'لم تُجرَّب', en: 'Not tried' },
  'issues.sla.responseDue': { ar: 'موعد الرد', en: 'Response due' },
  'issues.sla.resolutionDue': { ar: 'موعد الحل', en: 'Resolution due' },
  'issues.sla.breached': { ar: 'تجاوز الاتفاقية', en: 'SLA breached' },
  'issues.sla.escalated': { ar: 'تم التصعيد ({n})', en: 'Escalated ({n})' },
  'issues.reportedBy': { ar: 'سجّلها {name}', en: 'Reported by {name}' },

  /* ── time ────────────────────────────────────────────────── */
  'projects.nav.budget': { ar: 'الميزانية', en: 'Budget' },
  'time.title': { ar: 'الوقت', en: 'Time' },
  'time.log': { ar: 'تسجيل وقت', en: 'Log time' },
  'time.hours': { ar: 'ساعات', en: 'Hours' },
  'time.date': { ar: 'التاريخ', en: 'Date' },
  'time.notes': { ar: 'ملاحظات', en: 'Notes' },
  'time.billable': { ar: 'قابل للفوترة', en: 'Billable' },
  'time.task': { ar: 'المهمة', en: 'Task' },
  'time.week': { ar: 'الأسبوع', en: 'Week' },
  'time.totalHours': { ar: 'إجمالي الساعات', en: 'Total hours' },
  'time.billableHours': { ar: 'ساعات قابلة للفوترة', en: 'Billable hours' },
  'time.empty': { ar: 'لم يُسجَّل وقت لهذا الأسبوع', en: 'No time logged this week' },
  'time.emptyHint': {
    ar: 'سجّل وقتك أول بأول — أسهل بكتير من ما تفتكره آخر الأسبوع.',
    en: 'Log as you go. It is far easier than reconstructing the week on Thursday.',
  },
  'time.submit': { ar: 'إرسال للاعتماد', en: 'Submit for approval' },
  'time.recall': { ar: 'سحب الإرسال', en: 'Recall' },
  'time.submitted': { ar: 'تم الإرسال — في انتظار الاعتماد.', en: 'Submitted — waiting for approval.' },
  'time.approved': { ar: 'معتمَد', en: 'Approved' },
  'time.rejected': { ar: 'مرفوض', en: 'Rejected' },
  'time.draft': { ar: 'مسودة', en: 'Draft' },
  'time.approvedLocked': {
    ar: 'الوقت المعتمَد لا يمكن تعديله — الاعتماد قرار اتّاخد على أرقام محددة.',
    en: 'Approved time cannot be edited — the approval was a decision about these exact numbers.',
  },
  'time.pending': { ar: 'في انتظار مراجعتك', en: 'Waiting for your review' },
  'time.approve': { ar: 'اعتماد', en: 'Approve' },
  'time.reject': { ar: 'رفض', en: 'Reject' },
  'time.rejectReason': { ar: 'سبب الرفض', en: 'Reason for rejection' },
  'time.rejectReasonHint': {
    ar: 'مطلوب. رفض من غير سبب بيكلّف الشخص محادثة عشان يفهم.',
    en: 'Required. A rejection with no reason costs the person a conversation to decode.',
  },
  'time.timerRunning': { ar: 'المؤقّت شغّال', en: 'Timer running' },
  'time.startTimer': { ar: 'تشغيل المؤقّت', en: 'Start timer' },
  'time.stopTimer': { ar: 'إيقاف', en: 'Stop' },

  /* ── budget ──────────────────────────────────────────────── */
  'budget.title': { ar: 'الميزانية', en: 'Budget' },
  'budget.set': { ar: 'تحديد ميزانية', en: 'Set a budget' },
  'budget.none': { ar: 'لا توجد ميزانية محددة', en: 'No budget set' },
  'budget.noneHint': {
    ar: 'من غير ميزانية مفيش انحراف يتحسب — حدّد واحدة عشان التقارير تشتغل.',
    en: 'Without a budget there is no variance to compute. Set one and the reports light up.',
  },
  'budget.type.project_hours': { ar: 'ساعات المشروع', en: 'Project hours' },
  'budget.type.staff_hours': { ar: 'ساعات الفريق', en: 'Staff hours' },
  'budget.type.project_amount': { ar: 'مبلغ المشروع', en: 'Project amount' },
  'budget.type.fixed_cost': { ar: 'تكلفة ثابتة', en: 'Fixed cost' },
  'budget.type.task_hours': { ar: 'ساعات المهام', en: 'Task hours' },
  'budget.type.issue_hours': { ar: 'ساعات المشاكل', en: 'Issue hours' },
  'budget.state.healthy': { ar: 'سليمة', en: 'Healthy' },
  'budget.state.at_risk': { ar: 'في خطر', en: 'At risk' },
  'budget.state.overrun': { ar: 'تجاوزت', en: 'Overrun' },
  'budget.state.surplus': { ar: 'فائض', en: 'Surplus' },
  'budget.state.unset': { ar: 'غير محددة', en: 'Not set' },
  'budget.consumed': { ar: 'المستهلَك', en: 'Consumed' },
  'budget.plannedHours': { ar: 'الساعات المخطّطة', en: 'Planned hours' },
  'budget.actualHours': { ar: 'الساعات الفعلية', en: 'Actual hours' },
  'budget.actualCost': { ar: 'التكلفة الفعلية', en: 'Actual cost' },
  'budget.notMeasured': { ar: 'لم يُقَس', en: 'Not measured' },
  'budget.threshold': { ar: 'حد التنبيه ٪', en: 'Warn at %' },

  /* ── earned value ────────────────────────────────────────── */
  'evm.title': { ar: 'القيمة المكتسبة', en: 'Earned value' },
  'evm.unavailable': { ar: 'لا يمكن حساب القيمة المكتسبة بعد', en: 'Earned value cannot be computed yet' },
  'evm.unavailableHint': {
    ar: 'ناقص: {missing}. مش هنخمّن رقم — الرقم المخمَّن أسوأ من مفيش رقم، لأن حد هيتصرّف بناءً عليه.',
    en: 'Missing: {missing}. We will not guess — a guessed index is worse than none, because somebody acts on it.',
  },
  'evm.missing.budget_amount': { ar: 'ميزانية بالمبلغ', en: 'an amount budget' },
  'evm.missing.project_dates': { ar: 'تواريخ المشروع', en: 'project start and end dates' },
  'evm.missing.actual_cost': { ar: 'تكلفة فعلية مسجّلة', en: 'logged actual cost' },
  'evm.missing.progress': { ar: 'نسبة تقدّم', en: 'task progress' },
  'evm.bac': { ar: 'الميزانية الكلية (BAC)', en: 'Budget at completion (BAC)' },
  'evm.pv': { ar: 'القيمة المخطّطة (PV)', en: 'Planned value (PV)' },
  'evm.ev': { ar: 'القيمة المكتسبة (EV)', en: 'Earned value (EV)' },
  'evm.ac': { ar: 'التكلفة الفعلية (AC)', en: 'Actual cost (AC)' },
  'evm.sv': { ar: 'انحراف الجدول (SV)', en: 'Schedule variance (SV)' },
  'evm.cv': { ar: 'انحراف التكلفة (CV)', en: 'Cost variance (CV)' },
  'evm.spi': { ar: 'مؤشّر أداء الجدول (SPI)', en: 'Schedule performance index (SPI)' },
  'evm.cpi': { ar: 'مؤشّر أداء التكلفة (CPI)', en: 'Cost performance index (CPI)' },
  'evm.eac': { ar: 'التكلفة المتوقّعة عند الإنجاز (EAC)', en: 'Estimate at completion (EAC)' },
  'evm.etc': { ar: 'المتبقّي المتوقّع (ETC)', en: 'Estimate to complete (ETC)' },
  'evm.basis': {
    ar: 'القيمة المخطّطة محسوبة من نسبة الوقت المنقضي من مدة المشروع — تبسيط مقصود ومذكور.',
    en: 'Planned value is derived from elapsed calendar time — a deliberate simplification, stated rather than hidden.',
  },
  'evm.behind': { ar: 'متأخّر عن الجدول', en: 'Behind schedule' },
  'evm.ahead': { ar: 'متقدّم على الجدول', en: 'Ahead of schedule' },
  'evm.overCost': { ar: 'فوق التكلفة', en: 'Over cost' },
  'evm.underCost': { ar: 'تحت التكلفة', en: 'Under cost' },
} satisfies Record<string, { ar: string; en: string }>;
