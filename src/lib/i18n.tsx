import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';

export type Lang = 'ar' | 'en';

/**
 * Arabic here is Modern Standard Arabic — clear and everyday, not dialect and
 * not stiff officialese. One deliberate exception: «الإيميل», which is what
 * people at Engosoft actually write, rather than «البريد الإلكتروني».
 */
const STRINGS = {
  /* ── generic ─────────────────────────────────────────────── */
  'common.save': { ar: 'حفظ', en: 'Save' },
  'common.cancel': { ar: 'إلغاء', en: 'Cancel' },
  'common.add': { ar: 'إضافة', en: 'Add' },
  'common.send': { ar: 'إرسال', en: 'Send' },
  'common.edit': { ar: 'تعديل', en: 'Edit' },
  'common.delete': { ar: 'حذف', en: 'Delete' },
  'common.close': { ar: 'إغلاق', en: 'Close' },
  'common.search': { ar: 'بحث', en: 'Search' },
  'common.all': { ar: 'الكل', en: 'All' },
  'common.none': { ar: 'لا شيء', en: 'None' },
  'common.optional': { ar: 'اختياري', en: 'Optional' },
  'common.required': { ar: 'مطلوب', en: 'Required' },
  'common.you': { ar: 'أنت', en: 'You' },
  'common.refresh': { ar: 'تحديث', en: 'Refresh' },
  'common.openNewTab': { ar: 'فتح في تبويب جديد', en: 'Open in a new tab' },
  'common.back': { ar: 'رجوع', en: 'Back' },
  'common.home': { ar: 'الصفحة الرئيسية', en: 'Home' },
  'common.loading': { ar: 'جارٍ التحميل…', en: 'Loading…' },
  'common.unknown': { ar: 'غير معروف', en: 'Unknown' },
  'common.removedUser': { ar: 'مستخدم محذوف', en: 'Removed user' },

  /* ── auth ────────────────────────────────────────────────── */
  'auth.tagline': { ar: 'جميع تطبيقات إنجوسوفت في مكان واحد', en: 'Every Engosoft app in one place' },
  'auth.signIn': { ar: 'تسجيل الدخول', en: 'Sign in' },
  'auth.signInHint': { ar: 'أدخل بيانات حسابك في المساحة.', en: 'Enter your workspace account details.' },
  'auth.email': { ar: 'الإيميل', en: 'Email' },
  'auth.password': { ar: 'كلمة المرور', en: 'Password' },
  'auth.signingIn': { ar: 'جارٍ تسجيل الدخول…', en: 'Signing in…' },
  'auth.submit': { ar: 'دخول', en: 'Sign in' },
  'auth.forgot': {
    ar: 'نسيت كلمة المرور؟ تواصل مع مدير النظام لإنشاء واحدة جديدة من صفحة المستخدمين.',
    en: 'Forgot your password? Ask an administrator to set a new one from the Users page.',
  },
  'auth.footer': { ar: 'مساحة العمل الداخلية', en: 'Internal workspace' },
  'auth.signOut': { ar: 'تسجيل الخروج', en: 'Sign out' },
  'auth.changePassword': { ar: 'تغيير كلمة المرور', en: 'Change password' },
  'auth.currentPassword': { ar: 'كلمة المرور الحالية', en: 'Current password' },
  'auth.newPassword': { ar: 'كلمة المرور الجديدة', en: 'New password' },
  'auth.confirmPassword': { ar: 'تأكيد كلمة المرور الجديدة', en: 'Confirm new password' },
  'auth.passwordHint': { ar: '٨ أحرف على الأقل.', en: 'At least 8 characters.' },
  'auth.passwordChanged': { ar: 'تم تغيير كلمة المرور.', en: 'Password changed.' },
  'auth.passwordMismatch': { ar: 'التأكيد لا يطابق كلمة المرور الجديدة.', en: 'Confirmation does not match.' },
  'auth.passwordTooShort': {
    ar: 'كلمة المرور الجديدة يجب أن تكون ٨ أحرف على الأقل.',
    en: 'New password must be at least 8 characters.',
  },

  /* ── shell ───────────────────────────────────────────────── */
  'shell.apps': { ar: 'التطبيقات', en: 'Apps' },
  'shell.allApps': { ar: 'جميع التطبيقات', en: 'All apps' },
  'shell.searchPlaceholder': { ar: 'ابحث في المساحة كاملة…', en: 'Search the whole workspace…' },
  'shell.notifications': { ar: 'الإشعارات', en: 'Notifications' },
  'shell.notificationsWithCount': { ar: 'الإشعارات ({n} جديدة)', en: 'Notifications ({n} new)' },
  'shell.markAllRead': { ar: 'تعليم الكل كمقروء', en: 'Mark all as read' },
  'shell.noNotifications': { ar: 'لا توجد إشعارات حالياً.', en: 'No notifications right now.' },
  'shell.openNotification': { ar: 'فتح المهمة', en: 'Open task' },
  'shell.account': { ar: 'حسابي', en: 'My account' },
  'shell.workspaceSettings': { ar: 'إعدادات المساحة', en: 'Workspace settings' },
  'shell.assistant': { ar: 'المساعد', en: 'Assistant' },
  'shell.team': { ar: 'الفريق', en: 'Team' },
  'shell.noAppsForYou': { ar: 'لا توجد تطبيقات متاحة لحسابك.', en: 'No apps are available to your account.' },
  'shell.language': { ar: 'اللغة', en: 'Language' },
  // Deliberately "this device": a push subscription belongs to one browser on
  // one machine, so enabling it on the laptop does nothing for the phone. The
  // old wording said "phone" and left desktop users assuming it wasn't for them.
  'shell.enableNotifications': {
    ar: 'تفعيل الإشعارات على هذا الجهاز',
    en: 'Enable notifications on this device',
  },
  'shell.enableNotificationsHint': {
    ar: 'استقبل تنبيهات تسليم المهام حتى عندما تكون المساحة مغلقة.',
    en: 'Get task delivery alerts even while the workspace is closed.',
  },
  'shell.notificationsEnabled': {
    ar: 'الإشعارات مفعّلة على هذا الجهاز',
    en: 'Notifications on for this device',
  },
  'shell.notificationsNoKeys': {
    ar: 'الإشعارات الفورية متوقفة: مفاتيح VAPID غير مضبوطة على الخادم.',
    en: 'Push is off: the server has no VAPID keys set.',
  },
  'shell.testNotification': { ar: 'إرسال إشعار تجريبي', en: 'Send a test notification' },
  'push.testSent': { ar: 'أُرسل الإشعار — تحقّق من جهازك.', en: 'Sent — check your device.' },
  'push.testFailed': { ar: 'تعذّر إرسال الإشعار التجريبي.', en: 'Could not send the test notification.' },

  /* ── search ──────────────────────────────────────────────── */
  'search.placeholder': { ar: 'ابحث عن تطبيق أو مهمة أو شخص…', en: 'Search for an app, task or person…' },
  'search.empty': {
    ar: 'اكتب أي شيء — اسم تطبيق أو عنوان مهمة أو اسم موظف.',
    en: 'Type anything — an app name, a task title, or a colleague.',
  },
  'search.noResults': { ar: 'لا توجد نتائج لـ «{q}».', en: 'No results for “{q}”.' },
  'search.navigate': { ar: 'تنقّل', en: 'Navigate' },
  'search.open': { ar: 'فتح', en: 'Open' },
  'search.typeApp': { ar: 'تطبيق', en: 'App' },
  'search.typeTask': { ar: 'مهمة', en: 'Task' },
  'search.typeUser': { ar: 'موظف', en: 'Person' },

  /* ── launcher ────────────────────────────────────────────── */
  'launcher.goodMorning': { ar: 'صباح الخير', en: 'Good morning' },
  'launcher.goodEvening': { ar: 'مساء الخير', en: 'Good evening' },
  'launcher.externalApp': { ar: 'يفتح تطبيقاً خارجياً', en: 'Opens an external app' },
  'launcher.myWork': { ar: 'أعمالي', en: 'My work' },
  'launcher.wholeBoard': { ar: 'اللوحة كاملة', en: 'Full board' },
  'launcher.noOpenTasks': { ar: 'لا توجد مهام مفتوحة عليك', en: 'No open tasks assigned to you' },
  'launcher.noOpenTasksBody': {
    ar: 'عند إسناد مهمة إليك ستظهر هنا، وسيصلك إشعار بها.',
    en: 'When a task is assigned to you it shows up here, and you get a notification.',
  },
  'launcher.statOpen': { ar: 'مفتوحة', en: 'Open' },
  'launcher.statOverdue': { ar: 'متأخرة', en: 'Overdue' },
  'launcher.statDoneWeek': { ar: 'أُنجزت هذا الأسبوع', en: 'Done this week' },
  'launcher.noAppsTitle': { ar: 'لا توجد تطبيقات متاحة لحسابك', en: 'No apps available to your account' },
  'launcher.noAppsBody': {
    ar: 'مدير النظام هو من يحدد التطبيقات التي يمكنك فتحها. تواصل معه لإضافة ما تحتاجه.',
    en: 'An administrator decides which apps you can open. Ask them to add what you need.',
  },

  /* ── app frame ───────────────────────────────────────────── */
  'frame.opening': { ar: 'جارٍ فتح {app}…', en: 'Opening {app}…' },
  'frame.slow': { ar: 'يستغرق وقتاً — افتحه في تبويب', en: 'Taking a while — open it in a tab' },
  'frame.blockedTitle': { ar: '{app} لا يسمح بالفتح داخل إطار', en: '{app} does not allow embedding' },
  'frame.blockedBody': {
    ar: 'هذا التطبيق يرفض العرض داخل موقع آخر — وهو إعداد أمان من جانبه هو، وليس خللاً في المساحة. افتحه في تبويب جديد، وسيظل متاحاً في شريط التطبيقات بالأعلى.',
    en: 'This app refuses to be displayed inside another site — a security setting on its side, not a fault in the workspace. Open it in a new tab; it stays in the app bar above.',
  },
  'frame.blockedFix': {
    ar: 'لتشغيله داخل المساحة، يجب أن يسمح التطبيق نفسه بذلك — الطريقة مشروحة في docs/EMBEDDING.md.',
    en: 'To run it inside the workspace the app itself must allow it — see docs/EMBEDDING.md.',
  },
  'frame.notFound': { ar: 'هذا التطبيق غير موجود', en: 'This app does not exist' },
  'frame.notFoundBody': {
    ar: 'ربما أُزيل، أو ليست لديك صلاحية فتحه.',
    en: 'It may have been removed, or you do not have permission to open it.',
  },
  'frame.repo': { ar: 'الشيفرة على GitHub', en: 'Source on GitHub' },

  /* ── tasks ───────────────────────────────────────────────── */
  'tasks.title': { ar: 'المهام', en: 'Tasks' },
  'tasks.teamBoard': { ar: 'لوحة الفريق كاملة', en: 'The whole team’s board' },
  'tasks.myBoard': { ar: 'المهام المُسندة إليك أو التي أنشأتها', en: 'Tasks assigned to you or created by you' },
  'tasks.new': { ar: 'مهمة جديدة', en: 'New task' },
  'tasks.newIn': { ar: 'مهمة جديدة في {stage}', en: 'New task in {stage}' },
  'tasks.table': { ar: 'الجدول', en: 'Table' },
  'tasks.board': { ar: 'البورد', en: 'Board' },
  'tasks.overview': { ar: 'الأداء', en: 'Performance' },
  'tasks.export': { ar: 'تصدير للشيت', en: 'Export sheet' },
  'tasks.mine': { ar: 'مهامي', en: 'Mine' },
  'tasks.searchPlaceholder': { ar: 'ابحث في المهام…', en: 'Search tasks…' },
  'tasks.allPeople': { ar: 'جميع الموظفين', en: 'Everyone' },
  'tasks.allDepartments': { ar: 'جميع الأقسام', en: 'All departments' },
  'tasks.emptyColumn': { ar: 'لا شيء هنا', en: 'Nothing here' },
  'tasks.dragHandle': { ar: 'اسحب لتغيير مكان المهمة', en: 'Drag to move this task' },
  'tasks.noMatch': { ar: 'لا توجد مهام مطابقة', en: 'No matching tasks' },
  'tasks.noMatchSearch': { ar: 'جرّب كلمة بحث أخرى أو أزل عوامل التصفية.', en: 'Try another search term or clear the filters.' },
  'tasks.noMatchEmpty': { ar: 'ابدأ بإضافة أول مهمة للفريق.', en: 'Start by adding the team’s first task.' },
  'tasks.noPermission': { ar: 'ليست لديك صلاحية على المهام', en: 'You do not have access to tasks' },
  'tasks.noPermissionBody': { ar: 'تواصل مع مدير النظام إذا كنت بحاجة لرؤية اللوحة.', en: 'Ask an administrator if you need board access.' },
  'tasks.detail': { ar: 'تفاصيل المهمة', en: 'Task details' },
  'tasks.titleField': { ar: 'العنوان', en: 'Title' },
  'tasks.taskDate': { ar: 'التاريخ', en: 'Date' },
  'tasks.titlePlaceholder': { ar: 'مثال: مراجعة تقرير مبيعات أكتوبر', en: 'e.g. Review the October sales report' },
  'tasks.descField': { ar: 'التفاصيل', en: 'Details' },
  'tasks.descPlaceholder': { ar: 'أي تفاصيل تساعد من سينفّذ المهمة…', en: 'Anything that helps whoever picks this up…' },
  'tasks.objective': { ar: 'الهدف', en: 'Objective' },
  'tasks.objectivePlaceholder': {
    ar: 'ما النتيجة التي نريد الوصول إليها؟',
    en: 'What outcome should this work achieve?',
  },
  'tasks.definitionOfDone': { ar: 'تعريف الإنجاز', en: 'Definition of done' },
  'tasks.definitionOfDonePlaceholder': {
    ar: 'اكتب شروطًا واضحة يمكن للمراجع التحقق منها…',
    en: 'Write clear conditions the reviewer can verify…',
  },
  'tasks.department': { ar: 'القسم', en: 'Department' },
  'tasks.team': { ar: 'الفريق', en: 'Team' },
  'tasks.subteam': { ar: 'الفريق الفرعي', en: 'Sub-team' },
  'tasks.noSubteam': { ar: 'بدون فريق فرعي', en: 'No sub-team' },
  'tasks.departmentHint': { ar: 'القسم يحدد مراحل اللوحة المتاحة لهذه المهمة.', en: 'The department decides which board stages this task can move through.' },
  'tasks.stage': { ar: 'المرحلة', en: 'Stage' },
  'tasks.priority': { ar: 'الأولوية', en: 'Priority' },
  'tasks.effortPoints': { ar: 'نقاط الجهد', en: 'Effort points' },
  'tasks.progress': { ar: 'نسبة التقدم', en: 'Progress' },
  'tasks.assignee': { ar: 'المسؤول', en: 'Assignee' },
  'tasks.unassigned': { ar: 'غير مُسندة', en: 'Unassigned' },
  'tasks.dueDate': { ar: 'تاريخ التسليم', en: 'Due date' },
  'tasks.notes': { ar: 'الملاحظات', en: 'Notes' },
  'tasks.notesPlaceholder': {
    ar: 'ملاحظات مختصرة تظهر في جدول المهام…',
    en: 'Short notes shown in the task table…',
  },
  'tasks.score': { ar: 'التقييم', en: 'Score' },
  'tasks.notScored': { ar: 'لم تُقيّم', en: 'Not scored' },
  'tasks.deliverables': { ar: 'التسليم', en: 'Delivery' },
  'tasks.newHint': {
    ar: 'المهمة تُسند لشخص واحد ويصله إشعار ليقبلها أو يطلب تعديل الإسناد. التقييم يأتي لاحقاً — بعد أن يسلّم عمله وتراجعه.',
    en: 'A task goes to one person, who can accept or request an assignment change. The score comes later — after delivery and review.',
  },
  'tasks.comments': { ar: 'التعليقات', en: 'Comments' },
  'tasks.noComments': { ar: 'لا توجد تعليقات بعد.', en: 'No comments yet.' },
  'tasks.commentPlaceholder': { ar: 'اكتب تعليقاً…', en: 'Write a comment…' },
  'tasks.added': { ar: 'تمت إضافة المهمة.', en: 'Task added.' },
  'tasks.updated': { ar: 'تم تحديث المهمة.', en: 'Task updated.' },
  'tasks.archive': { ar: 'أرشفة', en: 'Archive' },
  'tasks.archived': { ar: 'تمت أرشفة المهمة وسجلها محفوظ.', en: 'Task archived — its record is kept.' },
  // Says what actually happens, because the old wording ("cannot be undone")
  // described a permanent delete that employees never had any business doing.
  'tasks.confirmArchive': {
    ar: 'أرشفة «{title}»؟ سترفع من اللوحة ويبقى سجلها كاملاً.',
    en: 'Archive “{title}”? It leaves the board and its full record is kept.',
  },
  'tasks.titleRequired': { ar: 'اكتب عنوان المهمة.', en: 'Enter a task title.' },
  'tasks.dueToday': { ar: 'اليوم', en: 'Today' },
  'tasks.dueTomorrow': { ar: 'غداً', en: 'Tomorrow' },
  // Arabic counts three ways, not two: يوم / يومين / ٣-١٠ أيام. Skipping the
  // dual reads as broken Arabic ("خلال 2 أيام"), so each has its own string.
  'tasks.overdueOne': { ar: 'متأخرة يوماً', en: '1 day late' },
  'tasks.overdueTwo': { ar: 'متأخرة يومين', en: '2 days late' },
  'tasks.overdueMany': { ar: 'متأخرة {n} أيام', en: '{n} days late' },
  'tasks.dueInTwo': { ar: 'خلال يومين', en: 'In 2 days' },
  'tasks.dueInDays': { ar: 'خلال {n} أيام', en: 'In {n} days' },
  /* ── the task lifecycle ──────────────────────────────────────
     assign → deliver → review → approve. The four states, the
     buttons that move between them, and the two panels the gates
     open. */
  'flow.assigned': { ar: 'مُسندة', en: 'Assigned' },
  'flow.working': { ar: 'قيد التنفيذ', en: 'In progress' },
  'flow.submitted': { ar: 'بانتظار المراجعة', en: 'In review' },
  'flow.approved': { ar: 'منجزة', en: 'Done' },
  'flow.signedOff': { ar: 'معتمدة', en: 'Approved' },

  'assignment.title': { ar: 'مطلوب ردك على الإسناد', en: 'Respond to this assignment' },
  'assignment.hint': {
    ar: 'راجع المطلوب والموعد، ثم اقبل المهمة أو أرسل طلبًا واضحًا للمدير قبل بدء التنفيذ.',
    en: 'Review the brief and deadline, then accept or send a clear request before starting work.',
  },
  'assignment.awaiting': { ar: 'بانتظار رد الموظف على الإسناد', en: 'Waiting for the assignee’s response' },
  'assignment.accept': { ar: 'قبول المهمة', en: 'Accept task' },
  'assignment.accepted': { ar: 'تم قبول المهمة ويمكنك بدء العمل.', en: 'Assignment accepted; you can start work.' },
  'assignment.decline': { ar: 'رفض', en: 'Decline' },
  'assignment.clarify': { ar: 'طلب توضيح', en: 'Request clarification' },
  'assignment.proposeDate': { ar: 'اقتراح موعد', en: 'Propose due date' },
  'assignment.reassign': { ar: 'طلب إعادة إسناد', en: 'Request reassignment' },
  'assignment.reason': { ar: 'السبب أو الملاحظة', en: 'Reason or note' },
  'assignment.reasonPlaceholder': {
    ar: 'اكتب للمدير ما يحتاج أن يعرفه لاتخاذ الإجراء التالي…',
    en: 'Tell the manager what they need to know for the next action…',
  },
  'assignment.reasonRequired': { ar: 'اكتب السبب أولًا.', en: 'Write a reason first.' },
  'assignment.responseHint': {
    ar: 'سيُحفظ ردك في سجل الإسناد ويصل إلى منشئ المهمة.',
    en: 'Your response is saved in the assignment history and sent to the task creator.',
  },
  'assignment.sent': { ar: 'تم إرسال ردك وتسجيله.', en: 'Your response was sent and recorded.' },
  'assignment.assignedOn': { ar: 'أُسندت', en: 'Assigned' },
  'assignment.acceptedOn': { ar: 'قُبلت', en: 'Accepted' },
  'assignment.declinedOn': { ar: 'رُفضت', en: 'Declined' },
  'assignment.decline.title': { ar: 'رفض الإسناد', en: 'Decline assignment' },
  'assignment.request_clarification.title': { ar: 'طلب توضيح', en: 'Request clarification' },
  'assignment.propose_due_date.title': { ar: 'اقتراح موعد تسليم جديد', en: 'Propose a new due date' },
  'assignment.request_reassignment.title': { ar: 'طلب إعادة إسناد', en: 'Request reassignment' },

  'flow.start': { ar: 'ابدأ العمل', en: 'Start work' },
  'flow.submit': { ar: 'تسليم للمراجعة', en: 'Submit for review' },
  'flow.resubmit': { ar: 'إعادة التسليم', en: 'Resubmit' },
  // Both buttons name the column the card lands in, so a reviewer reads the
  // choice as "where does this go" rather than as two words for a verdict.
  'flow.approve': { ar: 'اعتماد ← منجزة', en: 'Approve → Done' },
  'flow.requestChanges': { ar: 'إرجاع ← إعادة عمل', en: 'Send back → Rework' },
  'flow.reopen': { ar: 'إعادة فتح المهمة', en: 'Reopen task' },
  'flow.publish': { ar: 'تم النشر', en: 'Mark as published' },
  'flow.confirmReopen': { ar: 'إعادة فتح «{title}»؟ سيرجع للموظف من جديد.', en: 'Reopen “{title}”? It goes back to the assignee.' },

  'flow.deliverables': { ar: 'ملفات التسليم', en: 'Deliverables' },
  'flow.deliverablesHint': {
    ar: 'أرفق ما أنجزته فعلاً — ملف أو صورة أو تقرير، أو رابط الشيت أو الفولدر أو البوست. هذا ما سيراجعه المدير قبل الاعتماد.',
    en: 'Attach what you actually produced — a file, an image, a report, or the link to the sheet, folder or post. This is what the manager reviews before approving.',
  },
  'flow.noDeliverables': { ar: 'لا توجد مرفقات بعد.', en: 'Nothing attached yet.' },
  'flow.addFile': { ar: 'إرفاق ملف', en: 'Attach a file' },
  'flow.addLink': { ar: 'إرفاق رابط', en: 'Attach a link' },
  'flow.linkPrompt': {
    ar: 'الصق رابط التسليم — شيت أو فولدر درايف أو فيجما أو بوست منشور:',
    en: 'Paste the deliverable link — a sheet, a Drive folder, Figma, a live post:',
  },
  'flow.uploading': { ar: 'جارٍ الرفع…', en: 'Uploading…' },
  'flow.fileLimit': { ar: 'ملف حتى ١٠ ميجابايت، أو رابط.', en: 'A file up to 10 MB, or a link.' },
  'flow.removeFile': { ar: 'إزالة المرفق', en: 'Remove attachment' },
  'flow.confirmRemoveFile': { ar: 'إزالة «{name}»؟', en: 'Remove “{name}”?' },
  'flow.uploadedBy': { ar: 'رفعه {name}', en: 'by {name}' },

  'flow.submitTitle': { ar: 'تسليم المهمة للمراجعة', en: 'Submit this task for review' },
  'flow.submitHint': {
    ar: 'راجع المرفقات، واكتب باختصار ما أنجزته. بعد التسليم تنتقل المهمة للمدير — هو من يعتمدها ويضع التقييم.',
    en: 'Check the attachments and say briefly what you did. Once submitted it goes to your manager — approving and scoring are their call.',
  },
  'flow.submitNote': { ar: 'ملخص ما أنجزته', en: 'What you delivered' },
  'flow.submitNotePlaceholder': {
    ar: 'مثال: التصميمات الثلاثة النهائية بعد تعديلات البراند…',
    en: 'e.g. the three final designs after the brand revisions…',
  },
  'flow.needDeliverable': {
    ar: 'أرفق التسليم أولاً — ملف أو رابط.',
    en: 'Attach the deliverable first — a file or a link.',
  },
  'flow.submitted.toast': { ar: 'تم التسليم — المهمة الآن عند المدير.', en: 'Submitted — it is with your manager now.' },
  'flow.started.toast': { ar: 'بدأ العمل على المهمة.', en: 'Work started.' },

  'flow.reviewTitle': { ar: 'المراجعة والتقييم', en: 'Review & score' },
  'flow.reviewHint': {
    ar: 'افتح المرفقات، حدّد التقييم، ثم اختر: تروح «منجزة» ولا ترجع «إعادة عمل» مع سبب واضح.',
    en: 'Open the deliverables, set the score, then choose: it goes to Done, or back to Rework with a clear reason.',
  },
  'flow.weakScoreHint': {
    ar: 'التقييم ده «دون المتوقع» — الأنسب ترجّعها «إعادة عمل» مع السبب بدل ما تقفلها بتقييم ضعيف.',
    en: 'That score is “below expectations” — better to send it back to Rework with a reason than to close it on a poor score.',
  },
  'flow.submittedBy': { ar: 'سلّمها {name} · {when}', en: 'Submitted by {name} · {when}' },
  'flow.onTime': { ar: 'سُلّمت في الموعد', en: 'Delivered on time' },
  'flow.late': { ar: 'سُلّمت بعد الموعد', en: 'Delivered late' },
  'flow.scoreLabel': { ar: 'التقييم من ١٠٠', en: 'Score out of 100' },
  'flow.reviewNote': { ar: 'ملاحظات للموظف', en: 'Notes for the assignee' },
  'flow.reviewNotePlaceholder': { ar: 'ما كان جيداً، وما يمكن تحسينه…', en: 'What was good, what could be better…' },
  'flow.returnReason': { ar: 'سبب الإرجاع', en: 'Why it is going back' },
  'flow.returnReasonPlaceholder': {
    ar: 'اكتب المطلوب تعديله بالتحديد…',
    en: 'Say exactly what needs to change…',
  },
  'flow.returnReasonRequired': {
    ar: 'اكتب سبب الإرجاع أولاً — الموظف يحتاج أن يعرف ما المطلوب.',
    en: 'Write why it is going back first — they need to know what to change.',
  },
  'flow.approved.toast': { ar: 'تم اعتماد المهمة وتسجيل التقييم.', en: 'Approved, and the score is recorded.' },
  'flow.returned.toast': { ar: 'رجعت المهمة للموظف مع ملاحظاتك.', en: 'Sent back with your notes.' },
  'flow.reopened.toast': { ar: 'أُعيد فتح المهمة.', en: 'Task reopened.' },
  'flow.published.toast': { ar: 'اتسجّل إنها اتنشرت.', en: 'Recorded as published.' },

  'flow.awaitingYou': { ar: 'بانتظار مراجعتك', en: 'Waiting for your review' },
  'flow.awaitingManager': { ar: 'عند المدير للمراجعة', en: 'With the manager' },
  'flow.returnedBadge': { ar: 'رجعت للتعديل', en: 'Sent back' },
  'flow.returnedOnce': { ar: 'أُعيدت مرة واحدة', en: 'Returned once' },
  'flow.returnedTwice': { ar: 'أُعيدت مرتين', en: 'Returned twice' },
  'flow.returnedTimes': { ar: 'أُعيدت {n} مرات', en: 'Returned {n}×' },
  'flow.verdictApproved': { ar: 'اعتُمدت', en: 'Approved' },
  'flow.verdictChanges': { ar: 'طُلب تعديلها', en: 'Changes requested' },
  'flow.scoredBy': { ar: 'قيّمها {name}', en: 'Scored by {name}' },
  'flow.managerOnly': {
    ar: 'الاعتماد من صلاحية المدير — سلّم المهمة للمراجعة أولاً.',
    en: 'Only a manager closes a task — submit it for review first.',
  },
  'flow.reviewQueue': { ar: 'للمراجعة', en: 'To review' },
  'flow.reviewQueueEmpty': { ar: 'لا شيء بانتظار المراجعة', en: 'Nothing waiting for review' },
  'flow.reviewQueueEmptyBody': {
    ar: 'كل ما سُلّم تمت مراجعته. سيظهر هنا أي تسليم جديد فور وصوله.',
    en: 'Everything handed in has been reviewed. New submissions land here.',
  },
  'flow.reviewQueueHint': {
    ar: 'الأقدم أولاً — المراجعة تسبق العمل الجديد، وإلا تكدّست عند المدير.',
    en: 'Oldest first — review comes before new work, or it piles up on you.',
  },
  'flow.waitingSince': { ar: 'بانتظار المراجعة {when}', en: 'Waiting since {when}' },
  'flow.timeline': { ar: 'المسار', en: 'Timeline' },
  'flow.properties': { ar: 'الخصائص', en: 'Properties' },
  'flow.createdOn': { ar: 'أُنشئت', en: 'Created' },
  'flow.startedOn': { ar: 'بدأ العمل', en: 'Started' },
  'flow.submittedOn': { ar: 'سُلّمت', en: 'Submitted' },
  'flow.reviewedOn': { ar: 'روجعت', en: 'Reviewed' },
  'flow.noScoreYet': { ar: 'لم تُقيّم بعد', en: 'Not scored yet' },
  'flow.selfReview': {
    ar: 'أنت المسؤول عن هذه المهمة وأنت من يراجعها.',
    en: 'You own this task and you are also reviewing it.',
  },
  'flow.readOnly': {
    ar: 'أنت تشاهد هذه المهمة فقط — لا يمكنك تعديلها.',
    en: 'You are viewing this task; you cannot change it.',
  },

  'performance.title': { ar: 'نظرة عامة على الأداء', en: 'Performance overview' },
  'performance.selfHint': {
    ar: 'هذه أرقامك أنت فقط؛ تقييمات زملائك خاصة.',
    en: 'These are your figures only; colleagues’ scores stay private.',
  },
  'performance.teamHint': {
    ar: 'أداء أعضاء الفريق والالتزام بالتسليم والتقييم النهائي.',
    en: 'Team delivery, timeliness and final scores.',
  },
  'performance.total': { ar: 'إجمالي المهام', en: 'Total tasks' },
  'performance.completed': { ar: 'معتمدة', en: 'Approved' },
  'performance.completionRate': { ar: 'نسبة الإنجاز', en: 'Completion rate' },
  'performance.onTime': { ar: 'التسليم في الموعد', en: 'On-time delivery' },
  'performance.averageScore': { ar: 'متوسط التقييم', en: 'Average score' },
  'performance.overdue': { ar: 'متأخرة', en: 'Overdue' },
  'performance.awaitingReview': { ar: 'بانتظار المراجعة', en: 'Awaiting review' },
  'performance.firstPass': { ar: 'اعتماد من أول مرة', en: 'First-pass approval' },
  'performance.firstPassHint': {
    ar: 'نسبة ما اعتُمد دون إرجاع. انخفاضها غالباً يعني أن الطلب لم يكن واضحاً.',
    en: 'Approved without a single return. A low number usually means the brief was unclear.',
  },
  'performance.returned': { ar: 'أُعيدت للتعديل', en: 'Sent back' },
  'performance.person': { ar: 'الموظف', en: 'Employee' },
  'performance.active': { ar: 'مفتوحة', en: 'Open' },
  'performance.noData': { ar: 'لا توجد بيانات أداء بعد.', en: 'No performance data yet.' },
  'performance.statusMix': { ar: 'توزيع الحالات', en: 'Status mix' },

  'profile.viewProfile': { ar: 'الملف الشخصي', en: 'Profile' },
  'profile.notFound': {
    ar: 'هذا الموظف غير موجود، أو ليس ضمن من يمكنك الاطلاع عليهم.',
    en: 'No such employee, or they are outside what you may see.',
  },
  'profile.remaining': { ar: 'مهام فاضلة', en: 'Still open' },
  'profile.done': { ar: 'مهام منجزة', en: 'Finished' },
  'profile.noOpen': { ar: 'لا توجد مهام مفتوحة.', en: 'Nothing open right now.' },
  'profile.noDone': { ar: 'لم تُنجز أي مهمة بعد.', en: 'Nothing finished yet.' },
  'profile.metricsPrivate': {
    ar: 'أرقام الأداء والتقييم خاصة بصاحبها ومديره.',
    en: 'Performance figures stay between this person and their manager.',
  },
  'profile.self': { ar: 'ملفك الشخصي', en: 'Your profile' },
  'profile.lastSeen': { ar: 'آخر دخول {when}', en: 'Last signed in {when}' },
  'profile.neverSignedIn': { ar: 'لم يسجّل دخوله بعد', en: 'Never signed in' },
  'priority.urgent': { ar: 'عاجلة', en: 'Urgent' },
  'priority.high': { ar: 'مهمة', en: 'High' },
  'priority.normal': { ar: 'عادية', en: 'Normal' },
  'priority.low': { ar: 'مؤجلة', en: 'Low' },

  /* ── users ───────────────────────────────────────────────── */
  'users.title': { ar: 'المستخدمون', en: 'Users' },
  'users.subtitle': { ar: 'من يدخل المساحة، وما المسموح له بفعله.', en: 'Who can sign in, and what they are allowed to do.' },
  'users.new': { ar: 'مستخدم جديد', en: 'New user' },
  'users.active': { ar: 'نشطون', en: 'Active' },
  'users.disabled': { ar: 'موقوفون', en: 'Disabled' },
  'users.disabledBadge': { ar: 'موقوف', en: 'Disabled' },
  'users.none': { ar: 'لا يوجد مستخدمون في هذه القائمة', en: 'No users in this list' },
  'users.roleDefaults': { ar: 'صلاحيات الدور', en: 'Role defaults' },
  'users.customPermissions': { ar: 'صلاحيات مخصصة', en: 'Custom permissions' },
  'users.appsCount': { ar: '{n} تطبيقات', en: '{n} apps' },
  'users.allApps': { ar: 'جميع التطبيقات', en: 'All apps' },
  'users.lastLogin': { ar: 'آخر دخول {when}', en: 'Last seen {when}' },
  'users.neverLoggedIn': { ar: 'لم يسجل الدخول بعد', en: 'Never signed in' },
  'users.name': { ar: 'الاسم', en: 'Name' },
  'users.jobTitle': { ar: 'مسمى وظيفي إضافي', en: 'Additional job title' },
  'users.jobTitlePlaceholder': { ar: 'مثال: أخصائي مبيعات', en: 'e.g. Sales specialist' },
  'users.newPassword': { ar: 'كلمة مرور جديدة', en: 'New password' },
  'users.leaveBlank': { ar: 'اتركها فارغة إذا لم ترغب في تغييرها.', en: 'Leave blank to keep the current one.' },
  'users.copyPassword': {
    ar: 'انسخ كلمة المرور هذه وأرسلها للموظف — لن تُعرض مرة أخرى بعد الحفظ.',
    en: 'Copy this password and send it to them — it is not shown again after saving.',
  },
  'users.role': { ar: 'مستوى الصلاحية', en: 'Access role' },
  'users.permissions': { ar: 'الصلاحيات', en: 'Permissions' },
  'users.resetToRole': { ar: 'العودة لصلاحيات الدور', en: 'Reset to role defaults' },
  'users.followingRole': { ar: 'تتبع الدور — عدّل أي مربع لتخصيصها', en: 'Following the role — tick any box to customise' },
  'users.allowedApps': { ar: 'التطبيقات المسموح بها', en: 'Allowed apps' },
  'users.allAppsIncludingNew': { ar: 'جميع التطبيقات (وأي تطبيق جديد)', en: 'All apps (including new ones)' },
  'users.adminSeesAll': {
    ar: 'مدير النظام يرى جميع التطبيقات دائماً، مهما كان المحدد هنا.',
    en: 'An administrator always sees every app, whatever is ticked here.',
  },
  'users.userDepartment': { ar: 'القسم', en: 'Department' },
  'users.userDepartmentHint': { ar: 'يحدد لوحة المهام التي تُفتح افتراضياً.', en: 'Sets which task board opens by default.' },
  'users.subteam': { ar: 'الفريق الفرعي', en: 'Sub-team' },
  'users.subteamHint': {
    ar: 'يظهر عند وجود شجرة تنظيمية داخل القسم.',
    en: 'Shown when the department has an organisational tree.',
  },
  'users.jobRole': { ar: 'الدور الوظيفي', en: 'Job role' },
  'users.chooseSubteamFirst': { ar: 'اختر الفريق الفرعي أولاً', en: 'Choose a sub-team first' },
  'users.added': { ar: 'تمت إضافة المستخدم.', en: 'User added.' },
  'users.saved': { ar: 'تم تحديث البيانات.', en: 'Details updated.' },
  'users.confirmDisable': { ar: 'إيقاف حساب «{name}»؟', en: 'Disable “{name}”?' },
  'users.confirmEnable': { ar: 'إعادة تفعيل حساب «{name}»؟', en: 'Re-enable “{name}”?' },
  'users.disabledDone': { ar: 'تم إيقاف الحساب.', en: 'Account disabled.' },
  'users.enabledDone': { ar: 'تمت إعادة تفعيل الحساب.', en: 'Account re-enabled.' },
  'users.confirmDelete': {
    ar: 'حذف «{name}» نهائياً؟ ستبقى مهامه موجودة بلا مسؤول.',
    en: 'Delete “{name}” permanently? Their tasks stay, unassigned.',
  },
  'users.deletedWithTasks': { ar: 'تم الحذف. {n} مهمة أصبحت بلا مسؤول.', en: 'Deleted. {n} task(s) are now unassigned.' },
  'users.deleted': { ar: 'تم حذف المستخدم.', en: 'User deleted.' },
  'role.admin': { ar: 'مدير النظام', en: 'Administrator' },
  'role.manager': { ar: 'مدير', en: 'Manager' },
  'role.member': { ar: 'موظف', en: 'Member' },
  'role.viewer': { ar: 'مشاهدة فقط', en: 'Viewer' },
  'role.admin.desc': {
    ar: 'صلاحية كاملة: المستخدمون والتطبيقات والإعدادات وجميع المهام.',
    en: 'Full access: users, apps, settings and every task.',
  },
  'role.manager.desc': {
    ar: 'يرى ويعدّل مهام فريقه، ويشاهد أداء أعضائه ويصدّره.',
    en: 'Sees and edits their team’s tasks, performance and exports.',
  },
  'role.member.desc': {
    ar: 'يرى مهام فريقه، ويعدّل مهامه، ويشاهد أداءه هو فقط.',
    en: 'Sees the team board, edits their tasks and sees only their performance.',
  },
  'role.viewer.desc': {
    ar: 'يفتح التطبيقات المسموح بها ويقرأ المهام دون تعديل.',
    en: 'Opens allowed apps and reads tasks without editing.',
  },
  'perm.apps.view': { ar: 'فتح التطبيقات', en: 'Open apps' },
  'perm.apps.manage': { ar: 'إضافة التطبيقات وتعديلها', en: 'Add and edit apps' },
  'perm.tasks.view': { ar: 'رؤية المهام', en: 'View tasks' },
  'perm.tasks.view_team': { ar: 'رؤية مهام الفريق', en: 'View team tasks' },
  'perm.tasks.view_all': { ar: 'رؤية مهام الشركة كلها', en: 'View all company tasks' },
  'perm.tasks.create': { ar: 'إنشاء المهام', en: 'Create tasks' },
  'perm.tasks.assign': { ar: 'إسناد المهام وتحديد مواعيدها', en: 'Assign tasks and set their dates' },
  'perm.tasks.edit_any': { ar: 'تعديل أي مهمة', en: 'Edit any task' },
  'perm.tasks.review': { ar: 'مراجعة المسلَّم وإرجاعه', en: 'Review deliverables and send back' },
  'perm.tasks.approve': { ar: 'اعتماد المهام وإعادة فتحها', en: 'Approve and reopen tasks' },
  'perm.tasks.score': { ar: 'تقييم الأداء ورؤية تقييمات الفريق', en: 'Score work and see team scores' },
  'management.title': { ar: 'الإدارة', en: 'Management' },
  'perm.management.view': { ar: 'فتح لوحة الإدارة', en: 'Open the management desk' },
  'perm.management.manage': {
    ar: 'تسجيل وتعديل بنود الإدارة',
    en: 'File and edit management items',
  },
  'perm.tasks.archive': { ar: 'أرشفة المهام وإعادتها', en: 'Archive tasks and restore them' },
  'perm.tasks.delete_any': { ar: 'حذف المؤرشف نهائياً', en: 'Permanently delete archived tasks' },
  'perm.tasks.export': { ar: 'تصدير مهام الفريق', en: 'Export team tasks' },
  'perm.users.view': { ar: 'رؤية المستخدمين', en: 'View users' },
  'perm.users.manage': { ar: 'إضافة المستخدمين وتعديلهم', en: 'Add and edit users' },
  'perm.settings.manage': { ar: 'الدخول لإعدادات المساحة', en: 'Access workspace settings' },

  /* ── visibility scope ────────────────────────────────────── */
  'scope.label': { ar: 'نطاق الرؤية', en: 'Task visibility' },
  'scope.hint': {
    ar: 'يضيّق ما يراه هذا الشخص من المهام. لا يمكن أن يوسّع أكثر مما يسمح به دوره.',
    en: 'Narrows what this person sees. It can never widen beyond what their role allows.',
  },
  'scope.role': { ar: 'حسب الدور (الافتراضي)', en: 'Follow the role (default)' },
  'scope.own': { ar: 'مهامه هو فقط', en: 'Only their own tasks' },
  'scope.subteam': { ar: 'فريقه الفرعي', en: 'Their sub-team' },
  'scope.department': { ar: 'القسم كله', en: 'The whole department' },
  'scope.all': { ar: 'كل الأقسام', en: 'Every department' },
  'scope.needsSubteam': {
    ar: 'هذا الشخص ليس له فريق فرعي — نطاق «الفريق الفرعي» سيقصر رؤيته على مهامه هو.',
    en: 'This person has no sub-team — “sub-team” scope leaves them seeing only their own tasks.',
  },

  /* ── join / invite links ─────────────────────────────────── */
  'join.tagline': { ar: 'إنشاء حسابك في مساحة عمل إنجوسوفت', en: 'Create your Engosoft workspace account' },
  'join.title': { ar: 'إنشاء حساب', en: 'Create your account' },
  'join.subtitle': { ar: 'املأ بياناتك واختر مكانك في الهيكل.', en: 'Fill in your details and pick where you sit.' },
  'join.approvalNotice': {
    ar: 'أنت من تختار كلمة المرور — لن يراها أحد. الحساب يُفعّل بعد موافقة مدير النظام.',
    en: 'You choose your own password — nobody else sees it. The account activates once an administrator approves it.',
  },
  'join.department': { ar: 'القسم', en: 'Department' },
  'join.departmentHint': { ar: 'اختر القسم الذي تعمل به.', en: 'Pick the department you work in.' },
  'join.subteam': { ar: 'الفريق الفرعي', en: 'Sub-team' },
  'join.subteamHint': {
    ar: 'يحدد الفرع الذي تنتمي له داخل القسم.',
    en: 'Sets which branch of the department you belong to.',
  },
  'join.choose': { ar: 'اختر', en: 'Choose' },
  'join.confirmPassword': { ar: 'تأكيد كلمة المرور', en: 'Confirm password' },
  'join.domainHint': { ar: 'هذا الرابط يقبل إيميلات @{domain} فقط.', en: 'This link only accepts @{domain} addresses.' },
  'join.submit': { ar: 'إنشاء الحساب', en: 'Create account' },
  'join.creating': { ar: 'جارٍ الإنشاء…', en: 'Creating…' },
  'join.nameRequired': { ar: 'اكتب اسمك الكامل.', en: 'Enter your full name.' },
  'join.pickDepartment': { ar: 'اختر القسم الذي تعمل به.', en: 'Pick the department you work in.' },
  'join.pickSubteam': { ar: 'اختر الفريق الفرعي.', en: 'Pick a sub-team.' },
  'join.haveAccount': { ar: 'عندك حساب بالفعل؟', en: 'Already have an account?' },
  'join.linkProblem': { ar: 'رابط الدعوة لا يعمل', en: 'This invite link does not work' },
  'join.doneTitle': { ar: 'تم إنشاء حسابك', en: 'Your account is created' },
  'join.doneBody': {
    ar: 'بياناتك اتسجلت وكلمة المرور اتحفظت مشفّرة.',
    en: 'Your details are saved and your password is stored encrypted.',
  },
  'join.doneWait': {
    ar: 'الحساب في انتظار موافقة مدير النظام. هيوصلك إشعار أول ما يتفعّل، وبعدها تقدر تسجّل الدخول بنفس الإيميل وكلمة المرور.',
    en: 'The account is waiting for an administrator to approve it. You will be notified once it is active, then you can sign in with the same email and password.',
  },

  /* ── invite management ───────────────────────────────────── */
  'invites.title': { ar: 'روابط الدعوة', en: 'Invite links' },
  'invites.subtitle': {
    ar: 'رابط يفتحه الموظف ليُنشئ حسابه بنفسه — ولا يُفعّل إلا بموافقتك.',
    en: 'A link an employee opens to create their own account — it only activates when you approve it.',
  },
  'invites.new': { ar: 'رابط جديد', en: 'New link' },
  'invites.none': { ar: 'لا توجد روابط دعوة بعد.', en: 'No invite links yet.' },
  'invites.label': { ar: 'اسم الرابط', en: 'Link name' },
  'invites.labelHint': { ar: 'للتمييز بينها فقط. مثال: دفعة الماركتنج يوليو', en: 'Just to tell them apart. e.g. Marketing intake, July' },
  'invites.role': { ar: 'الدور عند الإنشاء', en: 'Role on creation' },
  'invites.roleHint': {
    ar: 'الرابط لا يمنح صلاحية مدير — ترفعه يدوياً بعد الموافقة.',
    en: 'A link cannot grant manager access — promote them after approval.',
  },
  'invites.departments': { ar: 'الأقسام المسموح باختيارها', en: 'Departments they may pick' },
  'invites.departmentsHint': {
    ar: 'اتركها فارغة ليختار الموظف أي قسم، أو حدّد قسماً واحداً لتثبيته.',
    en: 'Leave empty to let them pick any, or select one to pin the link to it.',
  },
  'invites.emailDomain': { ar: 'نطاق الإيميل المسموح', en: 'Allowed email domain' },
  'invites.emailDomainHint': { ar: 'اختياري. مثال: engosoft.com', en: 'Optional. e.g. engosoft.com' },
  'invites.maxUses': { ar: 'أقصى عدد استخدامات', en: 'Maximum uses' },
  'invites.maxUsesHint': { ar: 'اتركه فارغاً لعدد غير محدود.', en: 'Leave empty for unlimited.' },
  'invites.expiresInDays': { ar: 'صلاحية الرابط (بالأيام)', en: 'Link expires in (days)' },
  'invites.created': { ar: 'تم إنشاء الرابط — انسخه وابعته.', en: 'Link created — copy it and send it.' },
  'invites.copy': { ar: 'نسخ الرابط', en: 'Copy link' },
  'invites.copied': { ar: 'تم نسخ الرابط.', en: 'Link copied.' },
  'invites.revoke': { ar: 'إلغاء', en: 'Revoke' },
  'invites.revoked': { ar: 'تم إلغاء الرابط.', en: 'Link revoked.' },
  'invites.confirmRevoke': { ar: 'إلغاء هذا الرابط؟ لن يعمل بعدها.', en: 'Revoke this link? It stops working immediately.' },
  'invites.confirmDelete': { ar: 'حذف هذا الرابط نهائياً؟', en: 'Delete this link permanently?' },
  'invites.deleted': { ar: 'تم حذف الرابط.', en: 'Link deleted.' },
  'invites.usage': { ar: '{used} من {max}', en: '{used} of {max}' },
  'invites.usageUnlimited': { ar: '{used} استخدام', en: '{used} used' },
  'invites.joinedCount': { ar: '{n} انضموا', en: '{n} joined' },
  'invites.pendingCount': { ar: '{n} في انتظار الموافقة', en: '{n} awaiting approval' },
  'invites.expiresOn': { ar: 'ينتهي {when}', en: 'Expires {when}' },
  'invites.anyDepartment': { ar: 'أي قسم', en: 'Any department' },
  'invites.state.active': { ar: 'فعّال', en: 'Active' },
  'invites.state.expired': { ar: 'منتهي', en: 'Expired' },
  'invites.state.revoked': { ar: 'ملغي', en: 'Revoked' },
  'invites.state.exhausted': { ar: 'استُنفد', en: 'Used up' },

  /* ── approvals ───────────────────────────────────────────── */
  'users.pending': { ar: 'في انتظار الموافقة', en: 'Awaiting approval' },
  'users.pendingBadge': { ar: 'بانتظار الموافقة', en: 'Pending' },
  'users.approve': { ar: 'موافقة', en: 'Approve' },
  'users.approveAndEdit': { ar: 'مراجعة الصلاحيات ثم الموافقة', en: 'Review permissions, then approve' },
  'users.confirmApprove': {
    ar: 'تفعيل حساب «{name}»؟ هيقدر يسجّل الدخول فوراً بالصلاحيات المحددة له.',
    en: 'Activate “{name}”? They will be able to sign in immediately with the permissions set for them.',
  },
  'users.approved': { ar: 'تم تفعيل الحساب.', en: 'Account activated.' },
  'users.joinedVia': { ar: 'انضم عبر رابط دعوة', en: 'Joined through an invite link' },
  'users.pendingHint': {
    ar: 'أنشأ حسابه بنفسه من رابط دعوة. راجع قسمه وصلاحياته قبل الموافقة.',
    en: 'They created this account from an invite link. Check their department and permissions before approving.',
  },

  /* ── the sign-in summary ─────────────────────────────────── */
  'summary.title': { ar: 'صباح الخير 👋', en: 'Good to see you 👋' },
  'summary.titleEvening': { ar: 'مساء الخير 👋', en: 'Good to see you 👋' },
  'summary.open': { ar: 'مهمة مفتوحة', en: 'Open' },
  'summary.overdue': { ar: 'متأخرة', en: 'Overdue' },
  'summary.dueToday': { ar: 'تسليمها النهارده', en: 'Due today' },
  'summary.unanswered': { ar: 'لسه محتاجة ردّك', en: 'Awaiting your answer' },
  'summary.awaitingMyReview': { ar: 'مستنية مراجعتك', en: 'Awaiting your review' },
  'summary.clear': {
    ar: 'مفيش حاجة مفتوحة عليك دلوقتي. يوم هادي.',
    en: 'Nothing open on your plate. Quiet day.',
  },
  'summary.openBoard': { ar: 'افتح لوحة المهام', en: 'Open the board' },
  'summary.dismiss': { ar: 'مش دلوقتي', en: 'Not now' },
  'summary.badgeLabel': { ar: '{n} مهمة مفتوحة', en: '{n} open tasks' },

  /* ── settings ────────────────────────────────────────────── */
  'settings.title': { ar: 'إعدادات المساحة', en: 'Workspace settings' },
  'settings.subtitle': {
    ar: 'التطبيقات الظاهرة في الشبكة، وسجل الحركة، وحالة النظام.',
    en: 'Which apps show in the grid, the activity log, and system status.',
  },
  'settings.tabApps': { ar: 'التطبيقات', en: 'Apps' },
  'settings.tabActivity': { ar: 'سجل الحركة', en: 'Activity' },
  'settings.tabSystem': { ar: 'النظام', en: 'System' },
  'settings.noPermission': { ar: 'ليست لديك صلاحية على الإعدادات', en: 'You do not have access to settings' },
  'settings.noPermissionBody': { ar: 'هذه الصفحة لمدير النظام فقط.', en: 'This page is for administrators only.' },
  'settings.appsHint': {
    ar: 'أي رابط تضيفه هنا يصبح أيقونة في الشبكة وفي شريط التطبيقات.',
    en: 'Any link you add here becomes an icon in the grid and the app bar.',
  },
  'settings.newApp': { ar: 'تطبيق جديد', en: 'New app' },
  'settings.builtin': { ar: 'أساسي', en: 'Built-in' },
  'settings.hidden': { ar: 'مخفي', en: 'Hidden' },
  'settings.internal': { ar: 'داخلي', en: 'internal' },
  'settings.hideFromGrid': { ar: 'إخفاء من الشبكة', en: 'Hide from the grid' },
  'settings.showInGrid': { ar: 'إظهار في الشبكة', en: 'Show in the grid' },
  'settings.confirmRemoveApp': { ar: 'إزالة «{name}» من الشبكة؟', en: 'Remove “{name}” from the grid?' },
  'settings.appRemoved': { ar: 'تمت إزالة التطبيق.', en: 'App removed.' },
  'settings.appHidden': {
    ar: 'تم إخفاء التطبيق من الشبكة — يفضل هنا لإظهاره وقت ما تحب.',
    en: 'Hidden from the grid — it stays here so you can bring it back.',
  },
  'settings.appShown': { ar: 'رجع التطبيق للشبكة.', en: 'Back in the grid.' },
  'settings.appAdded': { ar: 'تمت إضافة التطبيق للشبكة.', en: 'App added to the grid.' },
  'settings.appUpdated': { ar: 'تم تحديث التطبيق.', en: 'App updated.' },
  'settings.nameAr': { ar: 'الاسم بالعربية', en: 'Arabic name' },
  'settings.nameEn': { ar: 'الاسم بالإنجليزية', en: 'English name' },
  'settings.shortDesc': { ar: 'وصف مختصر', en: 'Short description' },
  'settings.descPreview': { ar: 'يظهر الوصف عند المرور فوق الأيقونة', en: 'Shown when hovering the icon' },
  'settings.appNamePreview': { ar: 'اسم التطبيق', en: 'App name' },
  'settings.link': { ar: 'الرابط', en: 'Link' },
  'settings.linkHint': { ar: 'يجب أن يبدأ بـ https://', en: 'Must start with https://' },
  'settings.repoLink': { ar: 'رابط المستودع (اختياري)', en: 'Repository link (optional)' },
  'settings.icon': { ar: 'الأيقونة', en: 'Icon' },
  'settings.color': { ar: 'اللون', en: 'Colour' },
  'settings.openMode': { ar: 'طريقة الفتح', en: 'How it opens' },
  'settings.openModeHint': {
    ar: '«تلقائي» يحاول فتحه داخل المساحة، وإذا رفض التطبيق يحوّله إلى تبويب جديد.',
    en: '“Automatic” tries to embed it, and falls back to a new tab if the app refuses.',
  },
  'settings.openAuto': { ar: 'تلقائي', en: 'Automatic' },
  'settings.openIframe': { ar: 'داخل المساحة دائماً', en: 'Always embedded' },
  'settings.openNewTab': { ar: 'تبويب جديد دائماً', en: 'Always a new tab' },
  'settings.openInternal': { ar: 'وحدة داخلية', en: 'Internal module' },
  'settings.noActivity': { ar: 'لا توجد حركة مسجّلة بعد', en: 'No activity recorded yet' },
  'settings.storage': { ar: 'التخزين', en: 'Storage' },
  'settings.database': { ar: 'قاعدة البيانات', en: 'Database' },
  'settings.localFile': { ar: 'ملف محلي (data/workspace.json)', en: 'Local file (data/workspace.json)' },
  'settings.uptime': { ar: 'الخادم يعمل منذ', en: 'Server up for' },
  'settings.minutes': { ar: '{n} دقيقة', en: '{n} min' },
  'settings.noServer': { ar: 'تعذّر الوصول إلى الخادم.', en: 'Could not reach the server.' },
  'settings.fileStorageWarning': {
    ar: 'التخزين حالياً ملف على القرص. على Railway أضف قاعدة Postgres وعيّن DATABASE_URL حتى لا تضيع البيانات مع كل نشر.',
    en: 'Storage is currently a file on disk. On Railway add a Postgres database and set DATABASE_URL so data survives each deploy.',
  },
  'settings.linking': { ar: 'الربط بين التطبيقات', en: 'Linking the apps' },
  'settings.linkingBody': {
    ar: 'هذه المساحة هي مصدر الهوية: توقّع رمزاً قصير العمر لكل تطبيق. ولكي يقبل أحد التطبيقات الدخول الموحّد، يجب ضبط نفس SSO_SECRET فيه والتحقق من الرمز — الخطوات في docs/SSO.md.',
    en: 'This workspace is the identity provider: it signs a short-lived token per app. For an app to accept single sign-on it needs the same SSO_SECRET and must verify the token — see docs/SSO.md.',
  },
  'activity.login': { ar: 'سجّل الدخول', en: 'signed in' },
  'activity.password.change': { ar: 'غيّر كلمة المرور', en: 'changed their password' },
  'activity.user.create': { ar: 'أضاف مستخدماً', en: 'added a user' },
  'activity.user.update': { ar: 'عدّل مستخدماً', en: 'updated a user' },
  'activity.user.delete': { ar: 'حذف مستخدماً', en: 'deleted a user' },
  'activity.app.create': { ar: 'أضاف تطبيقاً', en: 'added an app' },
  'activity.app.update': { ar: 'عدّل تطبيقاً', en: 'updated an app' },
  'activity.app.delete': { ar: 'أزال تطبيقاً', en: 'removed an app' },
  'activity.task.create': { ar: 'أضاف مهمة', en: 'created a task' },
  'activity.task.update': { ar: 'عدّل مهمة', en: 'updated a task' },
  'activity.task.delete': { ar: 'حذف مهمة', en: 'deleted a task' },

  /* ── assistant ───────────────────────────────────────────── */
  'assistant.title': { ar: 'مساعد المساحة', en: 'Workspace assistant' },
  'assistant.subtitle': { ar: 'يقرأ المهام والفريق والتطبيقات من البيانات الحيّة', en: 'Reads tasks, people and apps from live data' },
  'assistant.newChat': { ar: 'محادثة جديدة', en: 'New chat' },
  'assistant.emptyTitle': { ar: 'اسألني عن أي شيء في المساحة', en: 'Ask me anything about the workspace' },
  'assistant.emptyBody': {
    ar: 'أرى المهام والفريق والتطبيقات — لكنني لا أرى البيانات داخل كل تطبيق، وسأرشدك إلى أين تفتحه.',
    en: 'I can see tasks, people and apps — but not the data inside each app; I will point you to the right one.',
  },
  'assistant.placeholder': { ar: 'اسأل عن المهام أو الفريق أو التطبيقات…', en: 'Ask about tasks, people or apps…' },
  'assistant.send': { ar: 'إرسال', en: 'Send' },
  'assistant.stop': { ar: 'إيقاف', en: 'Stop' },
  'assistant.thinking': { ar: 'يفكّر', en: 'Thinking' },
  'assistant.notConfigured': {
    ar: 'المساعد غير مفعّل. أضف OPENAI_API_KEY في متغيّرات البيئة وأعد تشغيل الخادم.',
    en: 'The assistant is not configured. Add OPENAI_API_KEY to the environment and restart the server.',
  },
  'assistant.unreachable': { ar: 'تعذّر الوصول إلى المساعد.', en: 'Could not reach the assistant.' },
  'assistant.connError': { ar: 'حدث خطأ في الاتصال.', en: 'A connection error occurred.' },
  'assistant.suggest1': { ar: 'ما المهام المتأخرة لدينا؟', en: 'Which tasks are overdue?' },
  'assistant.suggest2': { ar: 'من المسؤول عن ماذا الآن؟', en: 'Who is working on what right now?' },
  'assistant.suggest3': { ar: 'أين أجد مصروف الإعلانات؟', en: 'Where do I find ad spend?' },
  'assistant.suggest4': { ar: 'لخّص لي أعمال هذا الأسبوع', en: 'Summarise this week’s work' },

  /* ── push ────────────────────────────────────────────────── */
  'push.enabled': { ar: 'تم تفعيل الإشعارات على هذا الجهاز.', en: 'Notifications enabled on this device.' },
  'push.denied': {
    ar: 'المتصفح رفض الإشعارات. فعّلها من إعدادات الموقع ثم أعد المحاولة.',
    en: 'The browser blocked notifications. Allow them in site settings and try again.',
  },
  'push.unsupported': { ar: 'هذا المتصفح لا يدعم الإشعارات.', en: 'This browser does not support notifications.' },
  'push.notConfigured': {
    ar: 'الإشعارات غير مهيأة على الخادم (VAPID).',
    en: 'Notifications are not configured on the server (VAPID).',
  },
  'push.failed': { ar: 'تعذّر تفعيل الإشعارات.', en: 'Could not enable notifications.' },
  'push.disabled': { ar: 'تم إيقاف الإشعارات على هذا الجهاز.', en: 'Notifications turned off on this device.' },

  /* ── time ────────────────────────────────────────────────── */
  'time.now': { ar: 'الآن', en: 'just now' },
  'time.minutes': { ar: 'منذ {n} دقيقة', en: '{n} min ago' },
  'time.hours': { ar: 'منذ {n} ساعة', en: '{n}h ago' },
  'time.yesterday': { ar: 'أمس', en: 'yesterday' },
  'time.days': { ar: 'منذ {n} يوماً', en: '{n} days ago' },
  'time.months': { ar: 'منذ {n} شهراً', en: '{n} months ago' },
  'time.years': { ar: 'منذ {n} سنة', en: '{n} years ago' },
  'time.expired': { ar: 'انتهى', en: 'expired' },
  'time.inMinutes': { ar: 'خلال {n} دقيقة', en: 'in {n} min' },
  'time.inHours': { ar: 'خلال {n} ساعة', en: 'in {n}h' },
  'time.tomorrow': { ar: 'بكرة', en: 'tomorrow' },
  'time.inDays': { ar: 'خلال {n} يوم', en: 'in {n} days' },
} as const;

export type StringKey = keyof typeof STRINGS;

interface I18nState {
  lang: Lang;
  dir: 'rtl' | 'ltr';
  setLang: (lang: Lang) => void;
  t: (key: StringKey, vars?: Record<string, string | number>) => string;
  /** Picks the right half of an `{ar, en}` pair — used for data, not UI chrome. */
  pick: (pair: { ar: string; en: string } | undefined | null) => string;
}

const I18nContext = createContext<I18nState | null>(null);
const STORAGE_KEY = 'engosoft.lang';

function initialLang(): Lang {
  if (typeof window === 'undefined') return 'ar';
  const saved = window.localStorage.getItem(STORAGE_KEY);
  if (saved === 'ar' || saved === 'en') return saved;
  return navigator.language?.toLowerCase().startsWith('en') ? 'en' : 'ar';
}

export function I18nProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(initialLang);
  const dir = lang === 'ar' ? 'rtl' : 'ltr';

  // index.html ships lang="ar" dir="rtl"; keep the document in step so CSS
  // logical properties, text selection and the scrollbar all flip together.
  useEffect(() => {
    document.documentElement.lang = lang;
    document.documentElement.dir = dir;
  }, [lang, dir]);

  const setLang = useCallback((next: Lang) => {
    setLangState(next);
    try {
      window.localStorage.setItem(STORAGE_KEY, next);
    } catch {
      /* private mode — the choice just won't persist */
    }
  }, []);

  const value = useMemo<I18nState>(() => {
    const t = (key: StringKey, vars?: Record<string, string | number>) => {
      const entry = STRINGS[key];
      let text: string = entry ? entry[lang] : key;
      if (vars) {
        for (const [name, replacement] of Object.entries(vars)) {
          text = text.replaceAll(`{${name}}`, String(replacement));
        }
      }
      return text;
    };
    return {
      lang,
      dir,
      setLang,
      t,
      pick: (pair) => (pair ? (lang === 'en' ? pair.en : pair.ar) : ''),
    };
  }, [lang, dir, setLang]);

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n() {
  const context = useContext(I18nContext);
  if (!context) throw new Error('useI18n must be used inside <I18nProvider>');
  return context;
}
