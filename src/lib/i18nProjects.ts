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
  'projectTasks.overdueCount': { ar: '{n} متأخرة', en: '{n} overdue' },
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

  /* ── documents ───────────────────────────────────────────── */
  'documents.title': { ar: 'المستندات', en: 'Documents' },
  'documents.upload': { ar: 'رفع ملف', en: 'Upload' },
  'documents.newVersion': { ar: 'نسخة جديدة', en: 'New version' },
  'documents.empty': { ar: 'لا توجد مستندات', en: 'No documents' },
  'documents.emptyHint': {
    ar: 'ارفع المخططات والعقود والتقارير هنا — كل رفعة بتبقى نسخة، والقديم بيفضل موجود.',
    en: 'Drawings, contracts and reports live here. Each upload is a version, and the old ones stay.',
  },
  'documents.versions': { ar: '{n} نسخة', en: '{n} versions' },
  'documents.version': { ar: 'نسخة {n}', en: 'Version {n}' },
  'documents.restore': { ar: 'استرجاع هذه النسخة', en: 'Restore this version' },
  'documents.restored': { ar: 'تم استرجاع النسخة.', en: 'That version is now current.' },
  'documents.download': { ar: 'تنزيل', en: 'Download' },
  'documents.size': { ar: 'الحجم', en: 'Size' },
  'documents.uploaded': { ar: 'رُفع', en: 'Uploaded' },
  'documents.visibility': { ar: 'الظهور للعميل', en: 'Client visibility' },
  'documents.internal': { ar: 'داخلي', en: 'Internal' },
  'documents.external': { ar: 'مرئي للعميل', en: 'Visible to the client' },
  'documents.uploading': { ar: 'جارٍ الرفع…', en: 'Uploading…' },
  'documents.tooLarge': { ar: 'الملف أكبر من الحد المسموح (25MB).', en: 'That file is larger than 25MB.' },
  'documents.typeNotAllowed': {
    ar: 'نوع الملف ده مش مسموح — للأمان، الملفات اللي المتصفح ممكن ينفّذها مرفوضة.',
    en: 'That file type is not allowed — anything a browser could execute is refused.',
  },

  /* ── comments ────────────────────────────────────────────── */
  'comments.title': { ar: 'التعليقات', en: 'Comments' },
  'comments.placeholder': { ar: 'اكتب تعليقًا… استخدم @ لمناداة زميل', en: 'Write a comment… use @ to mention someone' },
  'comments.post': { ar: 'إرسال', en: 'Post' },
  'comments.empty': { ar: 'لا توجد تعليقات بعد', en: 'No comments yet' },
  'comments.internal': { ar: 'داخلي', en: 'Internal' },
  'comments.internalHint': {
    ar: 'الفريق فقط — العميل مش هيشوف التعليق ده.',
    en: 'Staff only — the client will not see this.',
  },
  'comments.shared': { ar: 'مرئي للعميل', en: 'Visible to the client' },
  'comments.sharedHint': {
    ar: 'العميل هيقرأ التعليق ده. اتأكد قبل ما تبعت.',
    en: 'The client will read this. Be sure before you post.',
  },
  'comments.edited': { ar: 'مُعدّل', en: 'edited' },

  /* ── reports ─────────────────────────────────────────────── */
  'projects.nav.reports': { ar: 'التقارير', en: 'Reports' },
  'reports.title': { ar: 'التقارير', en: 'Reports' },
  'reports.build': { ar: 'بناء تقرير', en: 'Build a report' },
  'reports.module': { ar: 'الوحدة', en: 'Module' },
  'reports.module.task': { ar: 'المهام', en: 'Tasks' },
  'reports.module.issue': { ar: 'المشاكل', en: 'Issues' },
  'reports.module.time_log': { ar: 'تسجيلات الوقت', en: 'Time logs' },
  'reports.groupBy': { ar: 'التجميع حسب', en: 'Group by' },
  'reports.measure': { ar: 'القياس', en: 'Measure' },
  'reports.run': { ar: 'تشغيل', en: 'Run' },
  'reports.save': { ar: 'حفظ التقرير', en: 'Save report' },
  'reports.saved': { ar: 'التقارير المحفوظة', en: 'Saved reports' },
  'reports.empty': { ar: 'لا توجد بيانات لهذا التقرير', en: 'No data for this report' },
  'reports.emptyHint': {
    ar: 'جرّب تجميعًا مختلفًا، أو نطاق تاريخ أوسع.',
    en: 'Try a different grouping, or a wider date range.',
  },
  'reports.total': { ar: 'الإجمالي', en: 'Total' },
  'reports.group.status': { ar: 'الحالة', en: 'Status' },
  'reports.group.severity': { ar: 'الخطورة', en: 'Severity' },
  'reports.group.priority': { ar: 'الأولوية', en: 'Priority' },
  'reports.group.phase': { ar: 'المرحلة', en: 'Phase' },
  'reports.group.task_list': { ar: 'قائمة المهام', en: 'Task list' },
  'reports.group.project': { ar: 'المشروع', en: 'Project' },
  'reports.group.assignee': { ar: 'المسؤول', en: 'Assignee' },
  'reports.group.reporter': { ar: 'المُبلِّغ', en: 'Reporter' },
  'reports.group.user': { ar: 'الموظف', en: 'Person' },
  'reports.group.billable': { ar: 'الفوترة', en: 'Billable' },
  'reports.group.approval': { ar: 'الاعتماد', en: 'Approval' },
  'reports.group.month': { ar: 'الشهر', en: 'Month' },
  'reports.group.due_month': { ar: 'شهر الاستحقاق', en: 'Due month' },
  'reports.group.day': { ar: 'اليوم', en: 'Day' },
  'reports.measure.count': { ar: 'العدد', en: 'Count' },
  'reports.measure.estimated_hours': { ar: 'الساعات المقدّرة', en: 'Estimated hours' },
  'reports.measure.actual_hours': { ar: 'الساعات الفعلية', en: 'Actual hours' },
  'reports.measure.hours': { ar: 'الساعات', en: 'Hours' },
  'reports.measure.progress': { ar: 'متوسط التقدّم', en: 'Average progress' },
  'reports.measure.cost': { ar: 'التكلفة', en: 'Cost' },
  'reports.measure.billable_amount': { ar: 'المبلغ القابل للفوترة', en: 'Billable amount' },

  /* ── portfolio ───────────────────────────────────────────── */
  'portfolio.title': { ar: 'نظرة على المحفظة', en: 'Portfolio' },
  'portfolio.total': { ar: 'المشاريع', en: 'Projects' },
  'portfolio.atRisk': { ar: 'في خطر', en: 'At risk' },
  'portfolio.delayed': { ar: 'متأخرة', en: 'Delayed' },
  'portfolio.overdueTasks': { ar: 'مهام متأخرة', en: 'Overdue tasks' },
  'portfolio.atRiskHint': {
    ar: '«متأخر» حقيقة عن التقويم؛ «في خطر» حكم — متأخر، أو فوق الميزانية، أو شايل شغل متأخر.',
    en: '"Delayed" is a fact about the calendar. "At risk" is a judgement — delayed, over budget, or carrying overdue work.',
  },
  'portfolio.empty': { ar: 'لا توجد مشاريع لعرضها', en: 'No projects to show' },
  'portfolio.notMeasured': { ar: 'لم يُقَس', en: 'Not measured' },

  /* ── workload ────────────────────────────────────────────── */
  'workload.title': { ar: 'توزيع العمل', en: 'Workload' },
  'workload.assignedHours': { ar: 'ساعات مسندة', en: 'Assigned hours' },
  'workload.loggedHours': { ar: 'ساعات مسجّلة', en: 'Logged hours' },
  'workload.noEstimate': { ar: 'بدون تقدير', en: 'No estimate' },
  'workload.hint': {
    ar: 'المقياس هو الساعات مش عدد المهام — عشرة تذاكر بسيطة مش زي مهمة أسبوعين.',
    en: 'Measured in hours, not task count — ten small tickets are not a fortnight of work.',
  },
  'workload.empty': { ar: 'لا يوجد عمل مسند حاليًا', en: 'Nothing is assigned right now' },

  /* ── settings ────────────────────────────────────────────── */
  'projectSettings.title': { ar: 'إعدادات المشاريع', en: 'Projects settings' },
  'projectSettings.subtitle': {
    ar: 'الحالات والأتمتة والإخطارات والربط بالأنظمة الخارجية.',
    en: 'Statuses, automation, webhooks and the connections to other systems.',
  },
  'projectSettings.tab.statuses': { ar: 'الحالات', en: 'Statuses' },
  'projectSettings.tab.automation': { ar: 'الأتمتة', en: 'Automation' },
  'projectSettings.tab.webhooks': { ar: 'الإخطارات', en: 'Webhooks' },
  'projectSettings.tab.integrations': { ar: 'الربط', en: 'Integrations' },

  'statuses.title': { ar: 'الحالات', en: 'Statuses' },
  'statuses.hint': {
    ar: 'الحالة اللي بتتشال بتفضل على السجلات القديمة — بنوقّفها، مش بنمسحها.',
    en: 'A retired status stays on the records that already point at it — it is deactivated, never deleted.',
  },
  'statuses.retire': { ar: 'إيقاف', en: 'Retire' },
  'statuses.restore': { ar: 'تفعيل', en: 'Reactivate' },
  'statuses.retired': { ar: 'موقوفة', en: 'Retired' },
  'statuses.category': { ar: 'التصنيف', en: 'Category' },
  'statuses.category.open': { ar: 'مفتوحة', en: 'Open' },
  'statuses.category.active': { ar: 'جارية', en: 'Active' },
  'statuses.category.review': { ar: 'مراجعة', en: 'Review' },
  'statuses.category.done': { ar: 'منتهية', en: 'Done' },
  'statuses.category.cancelled': { ar: 'ملغاة', en: 'Cancelled' },
  'statuses.categoryHint': {
    ar: 'التصنيف هو اللي التقارير بتفهمه — الاسم للناس، والتصنيف للنظام.',
    en: 'The category is what the product branches on. The label is for people; the category is for the system.',
  },

  'automation.title': { ar: 'قواعد الأتمتة', en: 'Automation rules' },
  'automation.empty': { ar: 'لا توجد قواعد', en: 'No rules yet' },
  'automation.emptyHint': {
    ar: 'القاعدة بتتكوّن من مُشغِّل وشرط وإجراء — ومفيش حاجة منها بتشغّل كود.',
    en: 'A rule is a trigger, a condition and an action — and none of it runs code.',
  },
  'automation.trigger': { ar: 'المُشغِّل', en: 'Trigger' },
  'automation.actions': { ar: '{n} إجراء', en: '{n} actions' },
  'automation.enabled': { ar: 'مفعّلة', en: 'Enabled' },
  'automation.disabled': { ar: 'موقوفة', en: 'Disabled' },
  'automation.runs': { ar: 'سجل التشغيل', en: 'Run history' },
  'automation.runsEmpty': { ar: 'لم تُشغَّل أي قاعدة بعد', en: 'No rule has run yet' },
  'automation.status.applied': { ar: 'نُفّذت', en: 'Applied' },
  'automation.status.skipped': { ar: 'تُخطّيت', en: 'Skipped' },
  'automation.status.failed': { ar: 'فشلت', en: 'Failed' },

  'webhooks.title': { ar: 'الإخطارات عبر الإنترنت', en: 'Webhooks' },
  'webhooks.new': { ar: 'إخطار جديد', en: 'New webhook' },
  'webhooks.empty': { ar: 'لا توجد إخطارات', en: 'No webhooks' },
  'webhooks.emptyHint': {
    ar: 'الإخطار بيبعت حدث لعنوان خارجي، موقّع بمفتاح سري، مع إعادة محاولة وسجل تسليم.',
    en: 'A webhook posts an event to an external URL, signed with a secret, with retries and a delivery log.',
  },
  'webhooks.url': { ar: 'العنوان', en: 'URL' },
  'webhooks.secretOnce': {
    ar: 'المفتاح السري ده هيظهر مرة واحدة بس. انسخه دلوقتي — مفيش طريقة تقراه تاني.',
    en: 'This secret is shown once. Copy it now — there is no way to read it again.',
  },
  'webhooks.disabledFor': { ar: 'موقوف: {reason}', en: 'Disabled: {reason}' },

  'integrations.title': { ar: 'الربط بالأنظمة', en: 'Integrations' },
  'integrations.firstParty': { ar: 'داخل المساحة', en: 'Inside the workspace' },
  'integrations.adapters': { ar: 'أنظمة خارجية', en: 'External systems' },
  'integrations.status.connected': { ar: 'مربوط', en: 'Connected' },
  'integrations.status.not_configured': { ar: 'غير مهيّأ', en: 'Not configured' },
  'integrations.status.error': { ar: 'خطأ', en: 'Error' },
  'integrations.status.disabled': { ar: 'موقوف', en: 'Disabled' },
  'integrations.notConfiguredHint': {
    ar: 'الواجهة موجودة وشغّالة، بس محتاجة بيانات اعتماد. من غيرها بترد ٤٠٩ بدل ما تدّعي إنها شغّالة.',
    en: 'The adapter is real and working, but it has no credentials. Without them it answers 409 rather than claiming to work.',
  },
  'integrations.connect': { ar: 'ربط', en: 'Connect' },
  'integrations.disconnect': { ar: 'فصل', en: 'Disconnect' },
  'integrations.credentials': { ar: 'بيانات الاعتماد', en: 'Credentials' },
  'integrations.credentialsHint': {
    ar: 'بتتخزّن مشفّرة، ومفيش أي مسار في النظام بيرجّعها.',
    en: 'Stored encrypted. No route in the system returns it.',
  },

  /* ── health: one vocabulary for "how is this going" ───────── */
  /* Rendered from src/lib/projects/health.ts, which decides which of these
     applies. The words are short because they sit inside a chip on a card
     that already carries a name, a client and two dates. */
  'health.complete': { ar: 'مكتمل', en: 'Complete' },
  'health.paused': { ar: 'متوقّف مؤقتًا', en: 'Paused' },
  'health.late': { ar: 'متأخر', en: 'Late' },
  'health.behind': { ar: 'متأخر عن الخطة', en: 'Behind plan' },
  'health.atRisk': { ar: 'يحتاج متابعة', en: 'Needs attention' },
  'health.onTrack': { ar: 'يسير كما هو مخطط', en: 'On track' },
  'health.notStarted': { ar: 'لم يبدأ', en: 'Not started' },
  'health.unknown': { ar: 'غير محدّد', en: 'Not measured' },
  'health.label': { ar: 'الحالة العامة', en: 'Overall health' },
  'health.hint': {
    ar: 'تقدير تلقائي من التواريخ ونسبة الإنجاز والمهام المتأخرة. مش مُدخل يدويًا.',
    en: 'Worked out from the dates, the progress and the overdue tasks. Nobody types it in.',
  },

  /* ── schedule ─────────────────────────────────────────────── */
  'schedule.lateBy': { ar: 'متأخر {n} يوم', en: '{n} days late' },
  'schedule.dueToday': { ar: 'ينتهي اليوم', en: 'Due today' },
  'schedule.dueInDays': { ar: 'باقي {n} يوم', en: '{n} days left' },
  'schedule.noDate': { ar: 'بدون تاريخ', en: 'No date' },
  'schedule.finished': { ar: 'انتهى', en: 'Finished' },
  'schedule.range': { ar: 'من {from} إلى {to}', en: '{from} → {to}' },

  /* ── progress ─────────────────────────────────────────────── */
  'progress.label': { ar: 'نسبة الإنجاز', en: 'Progress' },
  'progress.expected': { ar: 'المتوقّع اليوم {n}%', en: 'Expected today: {n}%' },
  'progress.expectedHint': {
    ar: 'العلامة على الشريط هي النسبة المفروض توصلها دلوقتي حسب تواريخ البداية والنهاية.',
    en: 'The mark on the bar is where the work should have reached by today, going by the start and end dates.',
  },
  'progress.ahead': { ar: 'متقدّم {n}% عن الخطة', en: '{n}% ahead of plan' },
  'progress.behind': { ar: 'متأخر {n}% عن الخطة', en: '{n}% behind plan' },
  'progress.onTrack': { ar: 'مطابق للخطة', en: 'On plan' },

  /* ── glossary: the terms a non-specialist will not know ───── */
  /* Every one of these appears as a small "?" beside the term it explains.
     They are written for somebody who has never run a project before, which
     is the whole reason they exist. */
  'glossary.criticalPath': {
    ar: 'أطول سلسلة مهام مترابطة في المشروع. أي تأخير في مهمة على المسار الحرج بيأخّر تسليم المشروع كله بنفس المدة.',
    en: 'The longest chain of linked tasks. A day lost on any of them is a day lost on the whole project.',
  },
  'glossary.earnedValue': {
    ar: 'قيمة الشغل اللي اتعمل فعلًا، محسوبة بالفلوس. بتقارنها بالمخطط وبالمصروف عشان تعرف إنت مكسبان ولا خسران وقت وفلوس.',
    en: 'The money-value of the work actually finished. Compared against what was planned and what was spent.',
  },
  'glossary.plannedValue': {
    ar: 'قيمة الشغل اللي كان مفروض يخلص لحد النهارده حسب الجدول الزمني.',
    en: 'The value of the work that should have been finished by today, going by the schedule.',
  },
  'glossary.actualCost': {
    ar: 'اللي اتصرف فعلًا: ساعات الفريق مضروبة في تكلفة الساعة، زائد المصروفات.',
    en: 'What was actually spent: logged hours at their cost rate, plus expenses.',
  },
  'glossary.budgetVariance': {
    ar: 'الفرق بين الميزانية المعتمدة واللي اتصرف. الرقم السالب معناه تجاوز.',
    en: 'The gap between the approved budget and what was spent. Negative means overspent.',
  },
  'glossary.spi': {
    ar: 'مؤشر أداء الجدول الزمني. أكبر من ١ يعني قدّام الجدول، وأقل من ١ يعني متأخر.',
    en: 'Schedule performance index. Above 1 is ahead of schedule, below 1 is behind.',
  },
  'glossary.cpi': {
    ar: 'مؤشر أداء التكلفة. أكبر من ١ يعني بتصرف أقل من المخطط، وأقل من ١ يعني بتصرف أكتر.',
    en: 'Cost performance index. Above 1 means spending less than planned, below 1 means more.',
  },
  'glossary.workload': {
    ar: 'عدد المهام والساعات المسندة لكل شخص في فترة معيّنة — عشان تشوف مين محمّل زيادة ومين فاضي.',
    en: 'The tasks and hours assigned to each person in a period — who is overloaded and who is free.',
  },
  'glossary.baseline': {
    ar: 'لقطة محفوظة من الجدول الزمني في لحظة معيّنة، بتقارن بيها بعدين عشان تشوف الجدول اتغيّر قد إيه.',
    en: 'A saved snapshot of the schedule, kept so you can see how far the plan has since moved.',
  },
  'glossary.dependency': {
    ar: 'ربط بين مهمتين: المهمة التانية ما تبدأش (أو ما تخلصش) غير لما الأولى توصل لمرحلة معيّنة.',
    en: 'A link between two tasks: the second cannot start (or finish) until the first reaches a point.',
  },
  'glossary.billable': {
    ar: 'ساعة قابلة للفوترة معناها إنها هتتحسب على العميل. غير القابلة للفوترة بتتسجّل بس ما بتتحسبش عليه.',
    en: 'Billable hours are charged to the client. Non-billable hours are still recorded, just not charged.',
  },
  'glossary.phase': {
    ar: 'مجموعة كبيرة من الشغل داخل المشروع، ليها تاريخ بداية ونهاية ومسؤول — زي «التصميم» أو «الاختبار».',
    en: 'A large block of work inside a project, with its own dates and owner — like “Design” or “Testing”.',
  },
  'glossary.taskList': {
    ar: 'مجموعة صغيرة من المهام المترابطة جوّه المرحلة. بتساعد في ترتيب الشغل بس مالهاش تواريخ خاصة بيها.',
    en: 'A small group of related tasks inside a phase. It organises work but carries no dates of its own.',
  },
  'glossary.projectKey': {
    ar: 'الرمز القصير اللي بيظهر قبل رقم كل مهمة ومشكلة، زي MTGR-12. بيتحدّد مرة واحدة وما بيتغيّرش.',
    en: 'The short prefix on every task and issue reference, like MTGR-12. Set once and never changed.',
  },

  /* ── generic UI the module reuses ─────────────────────────── */
  'ui.help': { ar: 'ما معنى هذا؟', en: 'What does this mean?' },
  'ui.showing': { ar: 'عرض {shown} من {total}', en: 'Showing {shown} of {total}' },
  'ui.clearFilters': { ar: 'مسح الفلاتر', en: 'Clear filters' },
  'ui.filtersActive': { ar: '{n} فلتر مفعّل', en: '{n} filters on' },
  'ui.loading': { ar: 'جارٍ التحميل…', en: 'Loading…' },
  'ui.retry': { ar: 'إعادة المحاولة', en: 'Try again' },
  'ui.of': { ar: 'من', en: 'of' },

  /* ── demo data ────────────────────────────────────────────── */
  'demo.title': { ar: 'البيانات التجريبية', en: 'Demo data' },
  'demo.subtitle': {
    ar: 'مشاريع وفرق ومهام جاهزة تشتغل عليها من غير ما تدخل بيانات حقيقية. تقدر تحمّلها وتمسحها في أي وقت.',
    en: 'Ready-made projects, teams and tasks to explore, without entering anything real. Load it and remove it whenever you like.',
  },
  'demo.load': { ar: 'تحميل بيانات تجريبية', en: 'Load demo data' },
  'demo.remove': { ar: 'حذف البيانات التجريبية', en: 'Remove demo data' },
  'demo.loading': { ar: 'جارٍ التحميل…', en: 'Loading…' },
  'demo.removing': { ar: 'جارٍ الحذف…', en: 'Removing…' },
  'demo.notLoaded': { ar: 'لا توجد بيانات تجريبية محمّلة الآن.', en: 'No demo data is loaded right now.' },
  'demo.loadedAt': { ar: 'محمّلة منذ {when}', en: 'Loaded {when}' },
  'demo.willCreate': {
    ar: 'هيتعمل {projects} مشاريع، و{tasks} مهمة، و{people} أعضاء فريق، و{issues} مشكلة، و{timeEntries} تسجيل وقت.',
    en: 'Creates {projects} projects, {tasks} tasks, {people} team members, {issues} issues and {timeEntries} time logs.',
  },
  'demo.loaded': { ar: 'تم تحميل البيانات التجريبية.', en: 'Demo data loaded.' },
  'demo.removed': { ar: 'تم حذف البيانات التجريبية.', en: 'Demo data removed.' },
  'demo.confirmLoad': {
    ar: 'هتتضاف مشاريع وأعضاء فريق تجريبيين للمساحة دي. الأعضاء التجريبيين ما يقدروش يسجّلوا دخول، وكل حاجة تتمسح بضغطة واحدة.',
    en: 'This adds demo projects and demo team members to this workspace. The demo members cannot sign in, and everything is removable in one click.',
  },
  'demo.confirmRemove': {
    ar: 'هيتمسح كل اللي اتحمّل مع البيانات التجريبية: المشاريع والمهام والأعضاء التجريبيين. شغلك الحقيقي مش هيتلمس.',
    en: 'This removes everything the demo created — its projects, tasks and demo members. Your real work is not touched.',
  },
  'demo.safetyTitle': { ar: 'إزاي دي آمنة', en: 'Why this is safe' },
  'demo.safetyIsolation': {
    ar: 'كل صف بيتسجّل وقت إنشائه، والحذف بيمسح المسجَّل بس — مفيش بحث بالاسم، فمشروع حقيقي اسمه زي التجريبي ما يتأثرش.',
    en: 'Every created row is recorded when it is made, and removal deletes exactly that list — nothing is found by name, so a real project with a similar name is never touched.',
  },
  'demo.safetyAccounts': {
    ar: 'الأعضاء التجريبيون بيتعملوا موقوفين وبدون كلمة مرور، وعناوين بريدهم على نطاق محجوز ما ينفعش يتسجّل.',
    en: 'Demo members are created disabled and without a password, on a reserved domain that can never receive mail.',
  },
  'demo.safetyTasks': {
    ar: 'مهام المشاريع التجريبية بتظهر كمان في لوحة المهام العامة، زيها زي أي مهمة مشروع — وبتتمسح معاها.',
    en: 'Demo project tasks also appear on the general task board, like any project task — and are removed with it.',
  },
  'demo.disabled': {
    ar: 'البيانات التجريبية موقوفة في هذا التثبيت.',
    en: 'Demo data is switched off on this deployment.',
  },
  'demo.badge': { ar: 'تجريبي', en: 'Demo' },
  'demo.reset': { ar: 'إعادة ضبط البيانات التجريبية', en: 'Reset demo data' },
  'demo.resetting': { ar: 'جارٍ إعادة الضبط…', en: 'Resetting…' },
  'demo.wasReset': { ar: 'تمت إعادة ضبط البيانات التجريبية على تواريخ اليوم.', en: 'Demo data rebuilt against today’s dates.' },
  'demo.alreadyLoaded': {
    ar: 'البيانات التجريبية محمّلة بالفعل — لم يتغيّر شيء.',
    en: 'Demo data is already loaded — nothing changed.',
  },
  'demo.isLoaded': { ar: 'البيانات التجريبية محمّلة', en: 'Demo data is loaded' },
  'demo.loadedSummary': {
    ar: '{projects} مشاريع · {people} أعضاء · {tasks} مهمة',
    en: '{projects} projects · {people} people · {tasks} tasks',
  },
  'demo.someSkipped': {
    ar: 'تم تخطّي {n} سجل لأنه غير معلَّم كبيانات تجريبية. لم يُحذف.',
    en: '{n} records were skipped because they are not marked as demo. Nothing was deleted.',
  },
  'demo.forbidden': {
    ar: 'إدارة البيانات التجريبية تحتاج صلاحية مدير المشاريع الكاملة وصلاحية مدير المساحة معًا.',
    en: 'Managing demo data needs both the Projects administrator set and the workspace administrator role.',
  },
  'demo.confirmReset': {
    ar: 'هيتم حذف البيانات التجريبية الحالية وإنشاؤها من جديد بتواريخ اليوم. شغلك الحقيقي مش هيتلمس.',
    en: 'The current demo set is removed and rebuilt against today’s dates. Your real work is not touched.',
  },
  'demo.safetyIntegrations': {
    ar: 'التكاملات التجريبية بتتعمل «غير مهيّأة» وبدون أي بيانات اعتماد، والـwebhooks موقوفة وعناوينها على نطاق محجوز — يعني مفيش أي طلب بيخرج بره.',
    en: 'Demo integrations are created “not configured” with no credentials at all, and the webhooks are inactive on a reserved domain — no request can leave the building.',
  },
} satisfies Record<string, { ar: string; en: string }>;
