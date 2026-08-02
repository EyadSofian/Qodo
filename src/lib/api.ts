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
  delete: <T,>(path: string) => request<T>('DELETE', path),
  upload,
};

/**
 * Bilingual message per API error code. Kept here rather than in the string
 * table so an added endpoint error and its wording land in one diff.
 */
const ERRORS: Record<string, { ar: string; en: string }> = {
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
    ar: 'المسند إليه يستطيع تنفيذ المهمة، لكن تغيير المسؤول أو الفريق أو الموعد من صلاحية منشئ المهمة أو المدير.',
    en: 'The assignee can do the work, but only the task creator or a manager can change its owner, team, or due date.',
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
    ar: 'تقييم الأداء متاح للمدير فقط.',
    en: 'Only a manager can set performance scores.',
  },
  invalid_score: {
    ar: 'التقييم يجب أن يكون رقماً من ٠ إلى ١٠٠.',
    en: 'The score must be a number from 0 to 100.',
  },
  score_before_review: {
    ar: 'التقييم يأتي بعد تسليم العمل ومراجعته — لا يمكن وضعه عند إنشاء المهمة.',
    en: 'A score comes after the work is delivered and reviewed — not when the task is created.',
  },
  deliverable_required: {
    ar: 'أرفق ملف التسليم أولاً قبل إرسال المهمة للمراجعة.',
    en: 'Attach what you produced before sending the task for review.',
  },
  submit_required: {
    ar: 'المهمة تدخل المراجعة عن طريق «تسليم للمراجعة» مع إرفاق العمل.',
    en: 'Use “Submit for review” — a task enters review with its deliverable attached.',
  },
  review_required: {
    ar: 'اعتماد المهمة من صلاحية المدير، ويتم من خلال المراجعة والتقييم.',
    en: 'Closing a task is the manager’s call, and happens through the review.',
  },
  reopen_required: {
    ar: 'أعد فتح المهمة المعتمدة أولاً قبل تغيير مرحلتها.',
    en: 'Reopen the approved task before changing its stage.',
  },
  not_submitted: {
    ar: 'هذه المهمة ليست قيد المراجعة.',
    en: 'This task is not waiting for review.',
  },
  invalid_decision: { ar: 'قرار المراجعة غير معروف.', en: 'That review decision is not recognised.' },
  review_note_required: {
    ar: 'اكتب سبب الإعادة حتى يعرف الموظف ما المطلوب تعديله.',
    en: 'Write why it is going back, so they know what to change.',
  },
  file_too_large: { ar: 'الملف أكبر من ١٠ ميجابايت.', en: 'That file is larger than 10 MB.' },
  too_many_files: { ar: 'وصلت للحد الأقصى من المرفقات لهذه المهمة.', en: 'This task has reached its attachment limit.' },
  empty_file: { ar: 'الملف فارغ.', en: 'That file is empty.' },
  invalid_task_date: { ar: 'تاريخ المهمة غير صالح.', en: 'The task date is not valid.' },
  forbidden: { ar: 'ليست لديك صلاحية على هذا الإجراء.', en: 'You do not have permission for that.' },
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
