/**
 * Thin fetch wrapper. Every call carries the session cookie, and a 401 means
 * "signed out" — the auth provider listens for that and returns to the login
 * screen instead of letting pages render half-loaded.
 */

export class ApiError extends Error {
  status: number;
  code: string;
  payload: Record<string, unknown>;

  constructor(status: number, payload: Record<string, unknown>) {
    super(String(payload?.error ?? `HTTP ${status}`));
    this.name = 'ApiError';
    this.status = status;
    this.code = String(payload?.error ?? 'unknown');
    this.payload = payload ?? {};
  }
}

type Listener = () => void;
const unauthorizedListeners = new Set<Listener>();

export function onUnauthorized(listener: Listener) {
  unauthorizedListeners.add(listener);
  return () => {
    unauthorizedListeners.delete(listener);
  };
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const response = await fetch(`/api${path}`, {
    method,
    credentials: 'same-origin',
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  let payload: Record<string, unknown> = {};
  if (response.status !== 204) {
    try {
      payload = await response.json();
    } catch {
      payload = {};
    }
  }

  if (!response.ok) {
    // The login request 401s as part of normal use — don't sign the user out
    // over their own typo.
    if (response.status === 401 && !path.startsWith('/auth/login')) {
      unauthorizedListeners.forEach((l) => l());
    }
    throw new ApiError(response.status, payload);
  }

  return payload as T;
}

/**
 * One file, raw. Name and media type ride in headers so the body stays a clean
 * byte stream — which also keeps a .json deliverable from being eaten by the
 * server's JSON body parser on the way in.
 */
async function upload<T>(path: string, file: File): Promise<T> {
  const response = await fetch(`/api${path}`, {
    method: 'POST',
    credentials: 'same-origin',
    headers: {
      'Content-Type': 'application/octet-stream',
      'X-File-Name': encodeURIComponent(file.name),
      'X-File-Type': file.type || 'application/octet-stream',
    },
    body: file,
  });

  let payload: Record<string, unknown> = {};
  try {
    payload = await response.json();
  } catch {
    payload = {};
  }
  if (!response.ok) {
    if (response.status === 401) unauthorizedListeners.forEach((l) => l());
    throw new ApiError(response.status, payload);
  }
  return payload as T;
}

export const api = {
  get: <T,>(path: string) => request<T>('GET', path),
  post: <T,>(path: string, body?: unknown) => request<T>('POST', path, body ?? {}),
  patch: <T,>(path: string, body: unknown) => request<T>('PATCH', path, body),
  // For the create-or-update endpoints, where the caller should not have to
  // know whether the thing it is saving exists yet.
  put: <T,>(path: string, body: unknown) => request<T>('PUT', path, body),
  delete: <T,>(path: string) => request<T>('DELETE', path),
  upload,
};

/**
 * Bilingual message per API error code. Kept here rather than in the string
 * table so an added endpoint error and its wording land in one diff.
 */
const ERRORS: Record<string, { ar: string; en: string }> = {
  hr_file_empty: { ar: 'ملف Excel فارغ.', en: 'The Excel file is empty.' },
  hr_file_too_large: { ar: 'ملف Excel أكبر من الحد المسموح (20MB).', en: 'The Excel file is larger than 20MB.' },
  hr_file_unreadable: { ar: 'تعذّر قراءة ملف Excel. تأكد أنه ملف xlsx سليم.', en: 'The workbook could not be read. Check that it is a valid xlsx file.' },
  hr_file_type_invalid: { ar: 'البوت يقبل ملفات xlsx فقط.', en: 'The bot accepts xlsx files only.' },
  hr_source_unknown: { ar: 'لم أتعرف على نوع شيت HR من العناوين.', en: 'The HR workbook type could not be detected from its headers.' },
  hr_source_mismatch: { ar: 'الشيت المرفوع لا يطابق نوع المصدر المختار.', en: 'The workbook does not match the selected source.' },
  hr_dataset_missing: { ar: 'ارفع شيت المصدر أولاً قبل التعديل.', en: 'Upload this source workbook before editing it.' },
  hr_employee_not_found: { ar: 'لم يتم العثور على كود الموظف.', en: 'The employee code was not found.' },
  hr_recruitment_not_found: { ar: 'طلب التوظيف غير موجود.', en: 'The recruitment request was not found.' },
  hr_patch_empty: { ar: 'لا توجد حقول صالحة للحفظ.', en: 'There are no valid fields to save.' },
  invalid_hr_plans: { ar: 'إعدادات تشغيل HR غير صحيحة.', en: 'The HR automation settings are invalid.' },
  unknown_hr_template: { ar: 'قالب مهمة HR غير معروف أو تم تغييره.', en: 'That HR task template is unknown or has changed.' },
  hr_event_triggered: { ar: 'هذه المهمة تبدأ بحدث فعلي ولا يمكن تشغيلها بالتاريخ وحده.', en: 'This task starts from a real event and cannot be scheduled by date alone.' },
  hr_owner_required: { ar: 'اختر مسؤولاً قبل تفعيل المهمة الدورية.', en: 'Choose an owner before enabling the recurring task.' },
  invalid_credentials: {
    ar: 'الإيميل أو كلمة المرور غير صحيحة.',
    en: 'That email or password is not correct.',
  },
  account_disabled: {
    ar: 'هذا الحساب موقوف. تواصل مع مدير النظام.',
    en: 'This account is disabled. Contact an administrator.',
  },
  account_pending: {
    ar: 'حسابك تم إنشاؤه وفي انتظار موافقة مدير النظام. هيوصلك إشعار أول ما يتفعّل.',
    en: 'Your account exists and is waiting for an administrator to approve it. You will be notified once it is active.',
  },
  google_not_configured: {
    ar: 'تسجيل الدخول بجوجل غير مهيأ بعد. أضف GOOGLE_CLIENT_ID على الخادم.',
    en: 'Google sign-in is not configured yet. Add GOOGLE_CLIENT_ID on the server.',
  },
  google_token_invalid: {
    ar: 'تعذّر التحقق من حساب جوجل. أعد المحاولة.',
    en: 'Google could not verify this sign-in. Try again.',
  },
  google_email_unverified: {
    ar: 'لازم يكون إيميل جوجل موثّقًا قبل الدخول.',
    en: 'Your Google email must be verified before signing in.',
  },
  google_account_not_invited: {
    ar: 'هذا الإيميل غير مضاف في موظفي Qodo. اطلب من المدير دعوتك أولًا.',
    en: 'This email is not in Qodo. Ask an administrator to invite it first.',
  },
  google_account_mismatch: {
    ar: 'الحساب مربوط بهوية جوجل مختلفة. تواصل مع مدير النظام.',
    en: 'This account is linked to a different Google identity. Contact an administrator.',
  },

  /* ── invite links ────────────────────────────────────────── */
  invite_invalid: {
    ar: 'رابط الدعوة غير صحيح. اطلب رابطاً جديداً من مدير النظام.',
    en: 'That invite link is not valid. Ask an administrator for a new one.',
  },
  invite_expired: {
    ar: 'انتهت صلاحية رابط الدعوة. اطلب رابطاً جديداً من مدير النظام.',
    en: 'That invite link has expired. Ask an administrator for a new one.',
  },
  invite_revoked: {
    ar: 'تم إلغاء رابط الدعوة هذا.',
    en: 'That invite link has been revoked.',
  },
  invite_exhausted: {
    ar: 'رابط الدعوة وصل للحد الأقصى من الاستخدامات.',
    en: 'That invite link has reached its usage limit.',
  },
  email_domain_mismatch: {
    ar: 'هذا الرابط يقبل إيميلات النطاق المحدد فقط.',
    en: 'This link only accepts email addresses on the allowed domain.',
  },
  subteam_required: {
    ar: 'اختر الفريق الفرعي الذي تعمل به.',
    en: 'Choose the sub-team you work in.',
  },
  role_not_invitable: {
    ar: 'رابط الدعوة لا يمنح صلاحية مدير أو مدير نظام — تُمنح يدوياً بعد الموافقة.',
    en: 'An invite link cannot grant manager or administrator access — grant it after approval.',
  },
  invalid_domain: { ar: 'صيغة النطاق غير صحيحة. مثال: engosoft.com', en: 'Invalid domain. Example: engosoft.com' },
  invalid_max_uses: { ar: 'عدد الاستخدامات يجب أن يكون من ١ إلى ٥٠٠.', en: 'Uses must be between 1 and 500.' },
  invalid_expiry: { ar: 'مدة الصلاحية يجب أن تكون من يوم إلى ٣٦٥ يوماً.', en: 'Expiry must be between 1 and 365 days.' },
  invalid_status: { ar: 'حالة الحساب غير معروفة.', en: 'That account status is not recognised.' },
  invalid_analytics_period: {
    ar: 'فترة التحليل غير صحيحة. راجع تاريخ البداية والنهاية.',
    en: 'That reporting period is not valid. Check the start and end dates.',
  },
  analytics_period_too_long: {
    ar: 'فترة التحليل أكبر من ١٠ سنوات. اختر فترة أقصر.',
    en: 'The reporting period is longer than 10 years. Choose a shorter range.',
  },
  too_many_attempts: {
    ar: 'محاولات كثيرة. انتظر عشر دقائق ثم أعد المحاولة.',
    en: 'Too many attempts. Wait ten minutes and try again.',
  },
  missing_credentials: { ar: 'أدخل الإيميل وكلمة المرور.', en: 'Enter both email and password.' },
  email_taken: { ar: 'هذا الإيميل مستخدم بالفعل.', en: 'That email is already in use.' },
  invalid_email: { ar: 'صيغة الإيميل غير صحيحة.', en: 'That email address is not valid.' },
  weak_password: {
    ar: 'كلمة المرور يجب أن تكون ٨ أحرف على الأقل.',
    en: 'The password must be at least 8 characters.',
  },
  wrong_password: { ar: 'كلمة المرور الحالية غير صحيحة.', en: 'The current password is wrong.' },
  name_required: { ar: 'أدخل الاسم.', en: 'Enter a name.' },
  title_required: { ar: 'أدخل عنوان المهمة.', en: 'Enter a task title.' },
  title_too_long: { ar: 'العنوان طويل جداً.', en: 'That title is too long.' },
  invalid_url: { ar: 'الرابط غير صحيح. يجب أن يبدأ بـ https://', en: 'Invalid link. It must start with https://' },
  invalid_protocol: { ar: 'الرابط يجب أن يكون http أو https.', en: 'The link must be http or https.' },
  invalid_department: { ar: 'هذا القسم غير معروف.', en: 'That department is not recognised.' },
  forbidden_team: {
    ar: 'لا يمكنك الوصول إلى فريق آخر.',
    en: 'You cannot access another team.',
  },
  invalid_subteam: {
    ar: 'هذا الفريق الفرعي غير موجود داخل القسم المحدد.',
    en: 'That sub-team does not exist in the selected department.',
  },
  invalid_job_role: {
    ar: 'هذا الدور الوظيفي غير موجود داخل الفريق المحدد.',
    en: 'That job role does not exist in the selected sub-team.',
  },
  invalid_stage: {
    ar: 'هذه المرحلة غير متاحة في هذا القسم.',
    en: 'That stage does not exist in this department.',
  },
  id_taken: { ar: 'يوجد تطبيق بنفس المُعرّف.', en: 'An app with that id already exists.' },
  id_required: { ar: 'التطبيق يحتاج مُعرّفاً.', en: 'The app needs an id.' },
  builtin_app: {
    ar: 'هذه وحدة أساسية — لا يمكن حذفها، لكن يمكن إخفاؤها.',
    en: 'This is a built-in module — it cannot be deleted, only hidden.',
  },
  last_admin: {
    ar: 'هذا آخر مدير نظام — يجب أن يبقى واحد على الأقل.',
    en: 'This is the last administrator — at least one must remain.',
  },
  cannot_delete_self: { ar: 'لا يمكنك حذف حسابك بنفسك.', en: 'You cannot delete your own account.' },
  unknown_role: { ar: 'هذا الدور غير معروف.', en: 'That role is not recognised.' },
  unknown_assignee: { ar: 'هذا الموظف غير موجود.', en: 'That person does not exist.' },
  assignee_team_mismatch: {
    ar: 'الموظف المُسند إليه يجب أن يكون من نفس فريق المهمة.',
    en: 'The assignee must belong to the task’s team.',
  },
  assignment_response_forbidden: {
    ar: 'الموظف المسند إليه فقط يستطيع الرد على هذا الإسناد.',
    en: 'Only the assignee can respond to this assignment.',
  },
  assignment_required: {
    ar: 'يجب قبول إسناد المهمة أولاً قبل بدء التنفيذ.',
    en: 'Accept the task assignment before starting work.',
  },
  task_plan_forbidden: {
    ar: 'المسند إليه ينفّذ المهمة ويحدّث تقدمها وملاحظاتها، أما وصف المهمة والمسؤول عنها والفريق والموعد فمن صلاحية المدير.',
    en: 'The assignee does the work and updates its progress and notes; the brief, its owner, team and due date belong to a manager.',
  },
  invalid_assignment_action: {
    ar: 'إجراء الإسناد غير معروف.',
    en: 'That assignment action is not supported.',
  },
  assignment_reason_required: {
    ar: 'اكتب سببًا واضحًا لهذا الرد.',
    en: 'Write a clear reason for this response.',
  },
  invalid_effort_points: {
    ar: 'نقاط الجهد يجب أن تكون ١ أو ٢ أو ٣ أو ٥ أو ٨ أو ١٣.',
    en: 'Effort points must be 1, 2, 3, 5, 8, or 13.',
  },
  invalid_estimate: {
    ar: 'المدة المقدرة غير صالحة.',
    en: 'The estimated time is not valid.',
  },
  invalid_progress: {
    ar: 'نسبة التقدم يجب أن تكون من ٠ إلى ١٠٠.',
    en: 'Progress must be from 0 to 100.',
  },
  comment_too_long: {
    ar: 'التعليق طويل جدًا. الحد الأقصى ٥٠٠٠ حرف.',
    en: 'That comment is too long. The maximum is 5,000 characters.',
  },
  score_forbidden: {
    ar: 'تقييم الأداء متاح لمن يملك صلاحية التقييم فقط.',
    en: 'Only someone with the scoring permission can set performance scores.',
  },
  review_forbidden: {
    ar: 'مراجعة المهام المسلَّمة متاحة لمن يملك صلاحية المراجعة فقط.',
    en: 'Only someone with the review permission can review submitted work.',
  },
  approve_forbidden: {
    ar: 'اعتماد المهمة وإغلاقها متاح لمن يملك صلاحية الاعتماد فقط.',
    en: 'Only someone with the approval permission can close a task.',
  },
  invalid_score: {
    ar: 'التقييم يجب أن يكون رقماً من ٠ إلى ١٠٠.',
    en: 'The score must be a number from 0 to 100.',
  },
  score_before_review: {
    ar: 'التقييم يأتي بعد تسليم العمل ومراجعته — لا يمكن وضعه عند إنشاء المهمة.',
    en: 'A score comes after the work is delivered and reviewed — not when the task is created.',
  },
  invalid_link: {
    ar: 'الرابط غير صالح. لازم يبدأ بـ http:// أو https://',
    en: 'That link is not valid. It must start with http:// or https://',
  },
  link_deliverable: {
    ar: 'هذا التسليم رابط — افتحه مباشرة، لا يوجد ملف لتنزيله.',
    en: 'This deliverable is a link — open it directly; there is no file to download.',
  },
  submission_empty: {
    ar: 'المهمة مش هتتسلّم فاضية — اكتب اللي عملته أو أرفق ملف أو رابط.',
    en: 'A hand-in cannot be blank — write what you did, or attach a file or link.',
  },
  start_required: {
    ar: 'ابدأ المهمة من زر «ابدأ العمل» — المرحلة تتغير بالفعل لا بالسحب.',
    en: 'Use “Start work” — the stage follows the action, not the drag.',
  },
  submit_required: {
    ar: 'المهمة تدخل المراجعة عن طريق «تسليم للمراجعة» مع إرفاق العمل.',
    en: 'Use “Submit for review” — a task enters review with its deliverable attached.',
  },
  review_required: {
    ar: 'اعتماد المهمة من صلاحية المدير، ويتم من خلال المراجعة والتقييم.',
    en: 'Closing a task is the manager’s call, and happens through the review.',
  },
  publish_required: {
    ar: 'المهمة معتمدة — استخدم زر «تم النشر» بدل سحب الكارت.',
    en: 'This is approved — use the publish button rather than dragging the card.',
  },
  reopen_required: {
    ar: 'أعد فتح المهمة المعتمدة أولاً قبل تغيير مرحلتها.',
    en: 'Reopen the approved task before changing its stage.',
  },
  reset_pending_required: {
    ar: 'استخدم إجراء «إرجاع إلى Pending» حتى تُمسح حالة المراجعة والتقييم بشكل صحيح.',
    en: 'Use “Return to Pending” so the review and score state is cleared correctly.',
  },
  not_submitted: {
    ar: 'هذه المهمة ليست قيد المراجعة.',
    en: 'This task is not waiting for review.',
  },
  archive_forbidden: {
    ar: 'أرشفة المهام من صلاحية المدير — المهمة المسندة إليك لا تُرفع من اللوحة بقرارك.',
    en: 'Archiving is a manager’s call — work assigned to you is not yours to take off the board.',
  },
  task_archived: {
    ar: 'هذه المهمة مؤرشفة. أعِدها إلى اللوحة أولاً قبل أي تعديل عليها.',
    en: 'This task is archived. Restore it to the board before changing anything.',
  },
  not_archived: {
    ar: 'هذه المهمة موجودة على اللوحة أصلاً.',
    en: 'This task is already on the board.',
  },
  archive_required: {
    ar: 'الحذف النهائي يبدأ بالأرشفة — أرشف المهمة أولاً.',
    en: 'Permanent deletion starts with the archive — archive the task first.',
  },
  invalid_decision: { ar: 'قرار المراجعة غير معروف.', en: 'That review decision is not recognised.' },
  review_note_required: {
    ar: 'اكتب سبب الإعادة حتى يعرف الموظف ما المطلوب تعديله.',
    en: 'Write why it is going back, so they know what to change.',
  },
  file_too_large: { ar: 'الملف أكبر من ١٠ ميجابايت.', en: 'That file is larger than 10 MB.' },
  too_many_files: { ar: 'وصلت للحد الأقصى من المرفقات لهذه المهمة.', en: 'This task has reached its attachment limit.' },
  empty_file: { ar: 'الملف فارغ.', en: 'That file is empty.' },
  invalid_mail_kind: { ar: 'نوع المحادثة غير معروف.', en: 'That conversation type is not supported.' },
  direct_recipient_required: { ar: 'اختر موظفًا واحدًا للمحادثة المباشرة.', en: 'Choose one person for a direct chat.' },
  unknown_recipient: { ar: 'أحد المستلمين غير موجود أو حسابه غير نشط.', en: 'A recipient does not exist or is inactive.' },
  mail_recipient_required: { ar: 'اختر مستلمًا واحدًا على الأقل.', en: 'Choose at least one recipient.' },
  too_many_recipients: { ar: 'عدد المستلمين أكبر من الحد المسموح.', en: 'There are too many recipients.' },
  mail_subject_required: { ar: 'اكتب عنوان الرسالة.', en: 'Enter a subject.' },
  mail_subject_too_long: { ar: 'عنوان الرسالة طويل جدًا.', en: 'The subject is too long.' },
  channel_create_forbidden: { ar: 'إنشاء القنوات متاح للمديرين.', en: 'Only managers can create channels.' },
  channel_name_required: { ar: 'اكتب اسم القناة.', en: 'Enter a channel name.' },
  channel_name_too_long: { ar: 'اسم القناة طويل جدًا.', en: 'The channel name is too long.' },
  public_channel_forbidden: { ar: 'القنوات العامة ينشئها مدير النظام.', en: 'Only an administrator can create public channels.' },
  channel_read_only: { ar: 'هذه قناة إعلانات والكتابة فيها للمديرين فقط.', en: 'This announcement channel is read-only.' },
  message_empty: { ar: 'اكتب رسالة أو أرفق ملفًا.', en: 'Write a message or attach a file.' },
  message_too_long: { ar: 'الرسالة طويلة جدًا.', en: 'The message is too long.' },
  too_many_mail_files: { ar: 'يمكن إرفاق ٦ ملفات كحد أقصى في الرسالة.', en: 'A message can contain up to 6 files.' },
  invalid_mail_attachment: { ar: 'تعذّر العثور على أحد المرفقات.', en: 'One of the attachments could not be found.' },
  invalid_reply: { ar: 'الرسالة التي ترد عليها غير موجودة.', en: 'The message you are replying to no longer exists.' },
  channel_open_to_everyone: {
    ar: 'هذه قناة لكل الشركة، والجميع بداخلها بالفعل.',
    en: 'This channel is open to the whole company; everybody is already in.',
  },
  channel_member_derived: {
    ar: 'هذا الزميل عضو بحكم قسمه. غيّر قسمه من صفحة الفريق.',
    en: 'They are in through their department. Change it on the Team screen.',
  },
  member_already_in_channel: {
    ar: 'هذا الزميل موجود في القناة بالفعل.',
    en: 'They are already in this channel.',
  },
  channel_owner_required: {
    ar: 'لا يمكن إزالة صاحب القناة.',
    en: 'The channel owner cannot be removed.',
  },
  too_many_channel_members: {
    ar: 'وصلت القناة للحد الأقصى من الأعضاء.',
    en: 'This channel has reached its member limit.',
  },
  no_members_to_add: { ar: 'اختر شخصًا واحدًا على الأقل.', en: 'Choose at least one person.' },
  mail_ai_not_configured: { ar: 'مساعد Qodo Mail غير مفعّل على الخادم.', en: 'Qodo Mail AI is not configured.' },
  mail_ai_rate_limited: { ar: 'طلبات AI كثيرة. انتظر قليلًا ثم حاول.', en: 'Too many AI requests. Wait a moment and try again.' },
  mail_ai_empty_thread: { ar: 'لا توجد رسائل كافية لتحليلها.', en: 'There are no messages to analyze.' },
  invalid_mail_ai_action: { ar: 'طلب AI غير معروف.', en: 'That AI action is not supported.' },
  mail_ai_quota: { ar: 'تم تجاوز حد أو رصيد مزود الـAI.', en: 'The AI provider quota has been reached.' },
  mail_ai_failed: { ar: 'تعذّر تشغيل AI على المحادثة. حاول مرة أخرى.', en: 'AI could not process this conversation. Try again.' },
  invalid_task_date: { ar: 'تاريخ المهمة غير صالح.', en: 'The task date is not valid.' },
  forbidden: { ar: 'ليست لديك صلاحية على هذا الإجراء.', en: 'You do not have permission for that.' },

  /* Seating plan. */
  office_name_required: { ar: 'اكتب اسم المكتب.', en: 'Give the room a name.' },
  office_zone_required: { ar: 'اختر المنطقة اللي فيها المكتب.', en: 'Choose the zone the room is in.' },
  unknown_department: { ar: 'القسم غير معروف.', en: 'That department is unknown.' },
  unknown_kind: { ar: 'نوع الغرفة غير معروف.', en: 'That room kind is unknown.' },
  invalid_columns: { ar: 'عدد الأعمدة لازم يكون بين 1 و24.', en: 'Columns must be between 1 and 24.' },
  invalid_count: { ar: 'اكتب عدد وحدات صحيح.', en: 'Enter a valid number of desks.' },
  invalid_dimensions: {
    ar: 'مقاسات الغرفة لازم تكون بالمتر بين 1 و60.',
    en: 'Room dimensions must be between 1 and 60 metres.',
  },
  room_not_measured: {
    ar: 'قِس الغرفة الأول — الوحدة مش ممكن تتحط على مخطط بلا مقاسات.',
    en: 'Measure the room first — a desk cannot be placed on an unscaled plan.',
  },
  point_outside_room: {
    ar: 'المكان ده بره حدود الغرفة.',
    en: 'That spot is outside the room.',
  },
  invalid_point: { ar: 'إحداثيات الوحدة غير صالحة.', en: 'That desk position is not valid.' },
  invalid_grid_index: { ar: 'ترتيب الوحدة غير صالح.', en: 'That desk order is not valid.' },
  label_required: { ar: 'اكتب رقم الوحدة.', en: 'Give the desk a label.' },
  unknown_status: { ar: 'حالة الوحدة غير معروفة.', en: 'That desk state is unknown.' },
  one_occupant_only: {
    ar: 'الوحدة تقعد شخصاً واحداً: اختر حساباً أو اكتب اسماً، مش الاتنين.',
    en: 'A desk seats one person: pick an account or type a name, not both.',
  },
  seat_blocked: {
    ar: 'الوحدة دي متعلَّمة إنها غير صالحة للجلوس. شيل العلامة الأول.',
    en: 'This desk is marked out of use. Clear that first.',
  },
  seat_occupied: {
    ar: 'في حد قاعد على الوحدة دي. فضّيها الأول.',
    en: 'Somebody is sitting here. Empty the desk first.',
  },
  office_occupied: {
    ar: 'المكتب فيه ناس قاعدة. انقلهم الأول قبل ما تحذفه.',
    en: 'People are still seated in this room. Move them before deleting it.',
  },
  office_full: { ar: 'وصلت الحد الأقصى لعدد الوحدات في المكتب.', en: 'This room is at its desk limit.' },
  too_many_seats: {
    ar: 'عدد كبير في طلب واحد. قسّمه على أكتر من مرة.',
    en: 'Too many desks in one request. Add them in smaller batches.',
  },
  unknown_user: { ar: 'الموظف ده مش موجود أو حسابه موقوف.', en: 'That person has no active account.' },
  unauthenticated: { ar: 'يجب تسجيل الدخول أولاً.', en: 'You need to sign in first.' },
  not_found: { ar: 'لم يتم العثور على هذا العنصر.', en: 'That item was not found.' },
  push_not_configured: {
    ar: 'الإشعارات غير مهيأة على الخادم.',
    en: 'Notifications are not configured on the server.',
  },
  server_error: { ar: 'حدث خطأ في الخادم. أعد المحاولة.', en: 'A server error occurred. Try again.' },
};

export function errorMessage(error: unknown, lang: 'ar' | 'en' = 'ar'): string {
  const code = error instanceof ApiError ? error.code : '';
  const entry = ERRORS[code];
  if (entry) return entry[lang];
  if (error instanceof TypeError) {
    return lang === 'en' ? 'No connection to the server.' : 'لا يوجد اتصال بالخادم.';
  }
  return lang === 'en' ? 'An unexpected error occurred.' : 'حدث خطأ غير متوقع.';
}
