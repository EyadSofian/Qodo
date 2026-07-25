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

export const api = {
  get: <T,>(path: string) => request<T>('GET', path),
  post: <T,>(path: string, body?: unknown) => request<T>('POST', path, body ?? {}),
  patch: <T,>(path: string, body: unknown) => request<T>('PATCH', path, body),
  delete: <T,>(path: string) => request<T>('DELETE', path),
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
