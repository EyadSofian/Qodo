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
    // Most modules answer `{ error: 'code' }`; E-Learning Production answers
    // `{ error: { code, message, details } }`. Both read as the same code here.
    const raw = payload?.error;
    const code =
      raw && typeof raw === 'object' ? String((raw as { code?: unknown }).code ?? 'unknown') : String(raw ?? 'unknown');
    super(code === 'unknown' ? `HTTP ${status}` : code);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
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
  hr_organization_layout_invalid: { ar: 'أعمدة ملف الهيكل الوظيفي غير مكتملة.', en: 'The organization workbook is missing required columns.' },
  hr_leave_layout_invalid: { ar: 'أعمدة ملف الإجازات أو صفحاته غير مكتملة.', en: 'The leave workbook is missing required sheets or columns.' },
  hr_offices_layout_invalid: { ar: 'أعمدة ملف توزيع المكاتب غير مكتملة.', en: 'The office workbook is missing required columns.' },
  hr_dataset_missing: { ar: 'ارفع شيت المصدر أولاً قبل التعديل.', en: 'Upload this source workbook before editing it.' },
  hr_employee_not_found: { ar: 'لم يتم العثور على كود الموظف.', en: 'The employee code was not found.' },
  hr_recruitment_not_found: { ar: 'طلب التوظيف غير موجود.', en: 'The recruitment request was not found.' },
  hr_odoo_job_invalid: { ar: 'اختيار وظيفة Odoo غير صالح.', en: 'The selected Odoo job is invalid.' },
  hr_odoo_job_not_found: { ar: 'وظيفة Odoo المختارة لم تعد موجودة.', en: 'The selected Odoo job no longer exists.' },
  hr_patch_empty: { ar: 'لا توجد حقول صالحة للحفظ.', en: 'There are no valid fields to save.' },
  invalid_hr_plans: { ar: 'إعدادات تشغيل HR غير صحيحة.', en: 'The HR automation settings are invalid.' },
  unknown_hr_template: { ar: 'قالب مهمة HR غير معروف أو تم تغييره.', en: 'That HR task template is unknown or has changed.' },
  hr_event_triggered: { ar: 'هذه المهمة تبدأ بحدث فعلي ولا يمكن تشغيلها بالتاريخ وحده.', en: 'This task starts from a real event and cannot be scheduled by date alone.' },
  hr_owner_required: { ar: 'اختر مسؤولاً قبل تفعيل المهمة الدورية.', en: 'Choose an owner before enabling the recurring task.' },
  /* ── HR V2 · Recruitment ─────────────────────────────────────── */
  recruitment_request_not_found: { ar: 'طلب الوظيفة غير موجود.', en: 'The job request was not found.' },
  recruitment_transition_invalid: { ar: 'هذه الخطوة غير متاحة في حالة الطلب الحالية.', en: 'That step is not available in the request\'s current state.' },
  recruitment_action_unknown: { ar: 'إجراء غير معروف.', en: 'Unknown action.' },
  recruitment_comment_required: { ar: 'اكتب سبباً واضحاً لهذا القرار.', en: 'Write a clear reason for this decision.' },
  recruitment_request_incomplete: { ar: 'الطلب ناقص — أكمل الحقول المطلوبة قبل الإرسال.', en: 'The request is incomplete — fill the required fields before submitting.' },
  recruitment_request_closed: { ar: 'هذا الطلب مغلق ولا يقبل التعديل.', en: 'This request is closed and cannot be changed.' },
  recruitment_request_conflict: { ar: 'عدّل شخص آخر الطلب للتو. أعد التحميل ثم حاول مرة أخرى.', en: 'Someone else just changed this request. Reload and try again.' },
  recruitment_capacity_exceeded: { ar: 'تجاوز سعة المسؤول عن التوظيف.', en: 'The recruiter\'s capacity would be exceeded.' },
  recruitment_override_reason_required: { ar: 'تجاوز السعة يحتاج سبباً مكتوباً (10 أحرف على الأقل).', en: 'A capacity override needs a written reason (at least 10 characters).' },
  recruitment_recruiter_not_on_team: { ar: 'هذا الموظف ليس ضمن فريق التوظيف.', en: 'That employee is not on the recruitment team.' },
  recruitment_recruiter_unchanged: { ar: 'هذا المسؤول مُسند بالفعل.', en: 'That recruiter is already assigned.' },
  recruitment_recruiter_required: { ar: 'اختر مسؤول التوظيف.', en: 'Choose a recruiter.' },
  recruitment_priority_invalid: { ar: 'الأولوية غير صحيحة.', en: 'The priority is invalid.' },
  recruitment_priority_unchanged: { ar: 'لم يتغير شيء في الأولوية أو المدة.', en: 'Neither the priority nor the target changed.' },
  recruitment_target_invalid: { ar: 'مدة الـSLA يجب أن تكون عدداً صحيحاً من أيام العمل.', en: 'The SLA target must be a whole number of working days.' },
  recruitment_target_out_of_band: { ar: 'مدة الـSLA خارج النطاق المعتمد لهذه الأولوية.', en: 'The SLA target is outside the approved band for this priority.' },
  recruitment_reason_required: { ar: 'اكتب سبب التغيير.', en: 'Write the reason for the change.' },
  recruitment_extend_not_active: { ar: 'يمكن مد مهلة الوظائف النشطة فقط.', en: 'Only active jobs can be extended.' },
  recruitment_extension_days_invalid: { ar: 'عدد أيام العمل المضافة بين 1 و60.', en: 'Add between 1 and 60 working days.' },
  recruitment_extension_reason_required: { ar: 'سبب المد إلزامي.', en: 'A reason for the extension is required.' },
  recruitment_accepted_invalid: { ar: 'عدد المقبولين غير صحيح.', en: 'The accepted count is invalid.' },
  recruitment_accepted_unchanged: { ar: 'العدد لم يتغير.', en: 'The count has not changed.' },
  recruitment_not_hiring: { ar: 'الوظيفة ليست في مرحلة التوظيف النشط.', en: 'The job is not in active hiring.' },
  recruitment_completion_date_invalid: { ar: 'تاريخ الإغلاق يجب أن يكون بين بداية الـSLA واليوم.', en: 'The completion date must fall between the SLA start and today.' },
  recruitment_title_required: { ar: 'اكتب المسمى الوظيفي.', en: 'Enter the job title.' },
  recruitment_headcount_invalid: { ar: 'العدد المطلوب بين 1 و200.', en: 'Headcount must be between 1 and 200.' },
  recruitment_headcount_below_accepted: { ar: 'لا يمكن أن يقل العدد المطلوب عن المقبولين.', en: 'Headcount cannot drop below those already accepted.' },
  recruitment_salary_invalid: { ar: 'نطاق الراتب غير صحيح.', en: 'The salary range is invalid.' },
  recruitment_salary_range_inverted: { ar: 'الحد الأعلى للراتب أقل من الأدنى.', en: 'The salary maximum is below the minimum.' },
  recruitment_classification_invalid: { ar: 'التصنيف غير متاح.', en: 'That classification is not available.' },
  recruitment_department_invalid: { ar: 'القسم المراجِع غير صحيح.', en: 'The reviewing department is invalid.' },
  recruitment_decision_invalid: { ar: 'القرار غير صحيح.', en: 'The decision is invalid.' },
  recruitment_patch_empty: { ar: 'لا توجد تغييرات للحفظ.', en: 'There are no changes to save.' },
  kpi_reason_required: { ar: 'السبب إلزامي ويجب أن يكون واضحاً ومكتوباً.', en: 'A clear written reason is required.' },
  kpi_job_required: { ar: 'هذه القاعدة تحتاج تحديد الوظيفة.', en: 'This rule needs the job it happened on.' },
  kpi_job_not_owned: { ar: 'الوظيفة ليست مسندة لهذا الموظف.', en: 'That job is not assigned to this employee.' },
  kpi_job_requirement_not_defined: { ar: 'طلب الوظيفة لم يحدد هذا المتطلب كتابةً.', en: 'The job request does not define this requirement in writing.' },
  kpi_rule_unknown: { ar: 'القاعدة غير متاحة.', en: 'That rule is not available.' },
  kpi_self_review_forbidden: { ar: 'لا يمكنك تقييم نفسك.', en: 'You cannot review yourself.' },
  kpi_employee_not_on_team: { ar: 'الموظف ليس ضمن فريق التوظيف.', en: 'The employee is not on the recruitment team.' },
  kpi_event_already_void: { ar: 'هذا الخصم مُلغى بالفعل.', en: 'This deduction is already void.' },
  kpi_date_invalid: { ar: 'تاريخ الواقعة غير صحيح.', en: 'The date is invalid.' },
  kpi_weights_must_total_100: { ar: 'أوزان المحاور يجب أن يكون مجموعها 100.', en: 'The category weights must total 100.' },
  reward_amount_out_of_range: { ar: 'المبلغ خارج نطاق القاعدة المعتمدة.', en: 'The amount is outside the rule\'s approved range.' },
  reward_transition_invalid: { ar: 'هذا الإجراء غير متاح لحالة الدفعة.', en: 'That action is not available for this batch.' },
  reward_reason_required: { ar: 'اكتب السبب.', en: 'Write the reason.' },
  hr_settings_conflict: { ar: 'غيّر شخص آخر الإعدادات للتو. أعد التحميل ثم احفظ.', en: 'Someone else just changed the settings. Reload, then save.' },
  personnel_form_incomplete: { ar: 'أكمل الحقول المطلوبة.', en: 'Fill in the required fields.' },
  personnel_form_not_found: { ar: 'الرابط غير صالح أو انتهت صلاحيته أو استُخدم من قبل.', en: 'This link is invalid, expired or already used.' },
  personnel_transition_invalid: { ar: 'لا يمكن نقل الحالة بهذا الشكل.', en: 'The case cannot move to that status.' },
  personnel_employee_required: { ar: 'اختر الموظف.', en: 'Choose the employee.' },
  performance_review_incomplete: { ar: 'قيّم كل المعايير قبل الاعتماد.', en: 'Score every criterion before finalising.' },
  performance_self_review_forbidden: { ar: 'لا يمكنك تقييم نفسك.', en: 'You cannot review yourself.' },
  recruitment_input_invalid: { ar: 'بيانات الطلب غير صحيحة.', en: 'The request data is invalid.' },
  recruitment_location_invalid: { ar: 'الموقع غير صحيح.', en: 'The location is invalid.' },
  recruitment_reason_invalid: { ar: 'سبب الاحتياج غير صحيح.', en: 'The reason for the vacancy is invalid.' },
  kpi_count_invalid: { ar: 'عدد التكرار بين 1 و5.', en: 'The count must be between 1 and 5.' },
  kpi_event_not_found: { ar: 'الخصم غير موجود.', en: 'The deduction was not found.' },
  kpi_idempotency_key_required: { ar: 'أعد فتح النافذة ثم حاول مرة أخرى.', en: 'Reopen the dialog and try again.' },
  kpi_period_invalid: { ar: 'الشهر غير صحيح.', en: 'The month is invalid.' },
  kpi_rule_invalid: { ar: 'إعداد القاعدة غير صحيح.', en: 'The rule setting is invalid.' },
  kpi_rule_points_invalid: { ar: 'نقاط الخصم يجب أن تكون بين 0 ووزن المحور.', en: 'Deduction points must be between 0 and the category weight.' },
  kpi_weight_invalid: { ar: 'وزن المحور غير صحيح.', en: 'A category weight is invalid.' },
  reward_batch_not_found: { ar: 'دفعة المكافأة غير موجودة.', en: 'The reward batch was not found.' },
  reward_decision_invalid: { ar: 'القرار غير صحيح.', en: 'The decision is invalid.' },
  reward_category_classification_unknown: { ar: 'تصنيف بند المكافأة غير موجود في التصنيفات.', en: 'A reward line uses a classification that does not exist.' },
  reward_categories_required: { ar: 'أضف بند مكافأة واحداً على الأقل.', en: 'Add at least one reward line.' },
  reward_category_amount_invalid: { ar: 'مبالغ بند المكافأة غير صحيحة (الحد الأدنى لا يتجاوز الأعلى).', en: 'A reward line\'s amounts are invalid (the minimum cannot exceed the maximum).' },
  reward_category_classification_required: { ar: 'كل بند مكافأة يحتاج تصنيفاً.', en: 'Every reward line needs a classification.' },
  reward_category_duplicate: { ar: 'يوجد بندا مكافأة بنفس المعرّف.', en: 'Two reward lines share one id.' },
  reward_category_id_invalid: { ar: 'معرّف بند المكافأة غير صحيح.', en: 'A reward line id is invalid.' },
  reward_category_label_required: { ar: 'اكتب اسم البند بالعربي والإنجليزي.', en: 'Name every reward line in Arabic and English.' },
  reward_category_location_invalid: { ar: 'موقع بند المكافأة غير صحيح.', en: 'A reward line location is invalid.' },
  reward_currency_invalid: { ar: 'العملة غير صحيحة.', en: 'The currency is invalid.' },
  reward_grouping_invalid: { ar: 'طريقة التجميع غير صحيحة.', en: 'The grouping is invalid.' },
  reward_jobs_per_batch_invalid: { ar: 'عدد الوظائف لكل مكافأة بين 1 و20.', en: 'Jobs per reward must be between 1 and 20.' },
  reward_rules_invalid: { ar: 'قواعد المكافآت غير صحيحة.', en: 'The reward rules are invalid.' },
  reward_rules_conflict: { ar: 'حفظ شخص آخر نسخة جديدة للتو. أعد التحميل ثم احفظ.', en: 'Someone else just saved a new version. Reload, then save.' },
  hr_settings_invalid: { ar: 'الإعدادات غير صحيحة.', en: 'The settings are invalid.' },
  hr_settings_patch_invalid: { ar: 'لا توجد تغييرات صالحة للحفظ.', en: 'There are no valid changes to save.' },
  hr_settings_weekend_invalid: { ar: 'أيام العطلة الأسبوعية غير صحيحة.', en: 'The weekend days are invalid.' },
  hr_settings_holidays_invalid: { ar: 'قائمة الإجازات الرسمية غير صحيحة (تاريخ بصيغة YYYY-MM-DD).', en: 'The holiday list is invalid (dates as YYYY-MM-DD).' },
  hr_settings_sla_band_invalid: { ar: 'نطاق الـSLA غير صحيح: الأدنى ≤ الافتراضي ≤ الأعلى، بين 1 و365.', en: 'An SLA band is invalid: min ≤ default ≤ max, between 1 and 365.' },
  hr_settings_due_soon_invalid: { ar: 'مدة "قريبة الاستحقاق" بين 0 و30 يوم عمل.', en: 'The "due soon" window must be 0–30 working days.' },
  hr_settings_capacity_invalid: { ar: 'حد السعة بين 0 و50 أو بلا حد.', en: 'A capacity limit must be 0–50 or unlimited.' },
  hr_settings_classifications_invalid: { ar: 'التصنيفات غير صحيحة: معرّف فريد بأحرف إنجليزية صغيرة واسم بالعربي والإنجليزي.', en: 'The classifications are invalid: a unique lower-case id and an Arabic and English name each.' },
  hr_settings_team_invalid: { ar: 'قائمة فريق التوظيف غير صحيحة.', en: 'The recruitment team list is invalid.' },
  hr_settings_waits_invalid: { ar: 'مدد الانتظار بين 0 و60 يوم عمل.', en: 'Waiting windows must be 0–60 working days.' },
  hr_settings_funnel_invalid: { ar: 'مراحل قمع Odoo غير صحيحة.', en: 'The Odoo funnel stages are invalid.' },
  performance_criteria_invalid: { ar: 'معايير التقييم الربع سنوي غير صحيحة.', en: 'The quarterly review criteria are invalid.' },
  performance_quarter_invalid: { ar: 'الربع غير صحيح.', en: 'The quarter is invalid.' },
  performance_score_invalid: { ar: 'الدرجة خارج الحد المسموح لهذا المعيار.', en: 'A score is outside the range allowed for its criterion.' },
  performance_review_final: { ar: 'هذا التقييم معتمد ولا يمكن تعديله.', en: 'This review is final and cannot be changed.' },
  personnel_checklist_invalid: { ar: 'قائمة المهام غير صحيحة.', en: 'The checklist is invalid.' },
  personnel_amount_invalid: { ar: 'المبلغ غير صحيح.', en: 'The amount is invalid.' },
  personnel_case_closed: { ar: 'هذا الطلب مغلق. أعد فتحه أولاً.', en: 'This case is closed. Reopen it first.' },
  personnel_case_not_found: { ar: 'الطلب غير موجود.', en: 'The case was not found.' },
  personnel_checklist_item_not_found: { ar: 'البند غير موجود.', en: 'The checklist item was not found.' },
  personnel_date_invalid: { ar: 'التاريخ غير صحيح.', en: 'The date is invalid.' },
  personnel_form_birth_date_invalid: { ar: 'تاريخ الميلاد غير صحيح.', en: 'The birth date is invalid.' },
  personnel_form_email_invalid: { ar: 'البريد الإلكتروني غير صحيح.', en: 'The e-mail address is invalid.' },
  personnel_form_national_id_invalid: { ar: 'الرقم القومي 14 رقماً، أو رقم جواز/إقامة من 6 إلى 20 حرفاً ورقماً.', en: 'The national ID is 14 digits, or a passport/residence number of 6–20 letters and digits.' },
  personnel_form_onboarding_only: { ar: 'نموذج بيانات الموظف الجديد لطلبات التهيئة فقط.', en: 'The new employee form is for onboarding cases only.' },
  personnel_patch_empty: { ar: 'لا توجد تغييرات للحفظ.', en: 'There are no changes to save.' },
  personnel_type_invalid: { ar: 'نوع الطلب غير صحيح.', en: 'The case type is invalid.' },
  report_range_invalid: { ar: 'نطاق التاريخ غير صحيح.', en: 'The date range is invalid.' },
  report_unknown: { ar: 'التقرير غير موجود.', en: 'That report does not exist.' },
  hr_section_invalid: { ar: 'القسم غير صحيح.', en: 'The section is invalid.' },
  hr_patch_invalid: { ar: 'البيانات المرسلة غير صحيحة.', en: 'The submitted data is invalid.' },
  hr_user_not_found: { ar: 'الحساب غير موجود.', en: 'The account was not found.' },
  hr_source_invalid: { ar: 'مصدر البيانات غير معروف.', en: 'Unknown data source.' },
  hr_master_layout_invalid: { ar: 'أعمدة قاعدة الموظفين غير مكتملة.', en: 'The employee database is missing required columns.' },
  hr_payroll_layout_invalid: { ar: 'أعمدة ملف الرواتب غير مكتملة.', en: 'The payroll workbook is missing required columns.' },
  hr_insurance_layout_invalid: { ar: 'أعمدة ملف التأمينات غير مكتملة.', en: 'The insurance workbook is missing required columns.' },
  hr_recruitment_layout_invalid: { ar: 'أعمدة ملف طلبات التوظيف غير مكتملة.', en: 'The recruitment workbook is missing required columns.' },
  hr_telegram_not_configured: { ar: 'بوت تيليجرام غير مهيأ.', en: 'The Telegram bot is not configured.' },
  hr_telegram_download_failed: { ar: 'تعذّر تنزيل الملف من تيليجرام.', en: 'The file could not be downloaded from Telegram.' },
  rate_limited: { ar: 'محاولات كثيرة. انتظر قليلاً ثم حاول مرة أخرى.', en: 'Too many attempts. Wait a little and try again.' },
  /* ── Qodo Projects ───────────────────────────────────────────── */
  projects_storage_unavailable: {
    ar: 'وحدة المشاريع محتاجة قاعدة بيانات PostgreSQL. اضبط DATABASE_URL ثم أعد التشغيل.',
    en: 'Projects needs a PostgreSQL database. Set DATABASE_URL and restart the server.',
  },
  end_before_start: {
    ar: 'تاريخ الانتهاء لا يصح أن يسبق تاريخ البدء.',
    en: 'The end date cannot be before the start date.',
  },
  owner_cannot_be_removed: {
    ar: 'لا يمكن إزالة مالك المشروع. غيّر المالك أولاً.',
    en: 'The project owner cannot be removed. Change the owner first.',
  },
  key_exhausted: {
    ar: 'رمز المشروع مستخدم بالكامل. اختر رمزًا مختلفًا.',
    en: 'That project key is taken. Choose a different one.',
  },
  user_required: { ar: 'اختر المستخدم أولاً.', en: 'Choose a user first.' },
  document_empty: { ar: 'الملف فارغ.', en: 'That file is empty.' },
  document_too_large: {
    ar: 'مستند المشروع أكبر من ٢٥ ميجابايت.',
    en: 'A project document may be up to 25 MB.',
  },
  file_type_not_allowed: {
    ar: 'نوع الملف ده مش مسموح — للأمان، الملفات اللي المتصفح ممكن ينفّذها مرفوضة.',
    en: 'That file type is not allowed — anything a browser could execute is refused.',
  },
  link_expired: {
    ar: 'رابط التنزيل انتهت صلاحيته. اطلب واحدًا جديدًا.',
    en: 'That download link has expired. Ask for a new one.',
  },
  timesheet_empty: { ar: 'مفيش وقت مسجّل في الأسبوع ده.', en: 'No time was logged this week.' },
  timesheet_approved: { ar: 'الأسبوع ده معتمَد بالفعل.', en: 'That week is already approved.' },
  timesheet_locked: { ar: 'الأسبوع ده مقفول.', en: 'That week is locked.' },
  timesheet_not_submitted: { ar: 'الأسبوع ده لسه مش مُرسَل.', en: 'That week has not been submitted.' },
  cannot_approve_own_timesheet: {
    ar: 'لا يمكنك اعتماد أسبوعك — الاعتماد معناه إن حد تاني راجعه.',
    en: 'You cannot approve your own week — an approval means somebody else looked at it.',
  },
  rejection_reason_required: {
    ar: 'اكتب سبب الرفض. رفض من غير سبب بيكلّف الشخص محادثة عشان يفهم.',
    en: 'Give a reason. A rejection with no explanation costs the person a conversation to decode.',
  },
  time_entry_approved: {
    ar: 'الوقت المعتمَد لا يمكن تعديله.',
    en: 'Approved time cannot be edited.',
  },
  time_entry_invoiced: {
    ar: 'الوقت ده اتفوتر بالفعل ولا يمكن تعديله.',
    en: 'That time has been invoiced and cannot be edited.',
  },
  hours_invalid: { ar: 'عدد الساعات غير صحيح.', en: 'That number of hours is not valid.' },
  budget_value_required: { ar: 'حدّد قيمة للميزانية.', en: 'Give the budget a value.' },
  budget_type_invalid: { ar: 'نوع الميزانية غير معروف.', en: 'That budget type is not recognised.' },
  sla_target_required: {
    ar: 'اتفاقية بدون هدف زمني مش اتفاقية.',
    en: 'An agreement with no target is not an agreement.',
  },
  linked_not_found: { ar: 'العنصر المرتبط غير موجود في هذا المشروع.', en: 'That record is not in this project.' },
  task_not_found: { ar: 'المهمة غير موجودة في هذا المشروع.', en: 'That task is not in this project.' },
  issue_not_found: { ar: 'المشكلة غير موجودة في هذا المشروع.', en: 'That issue is not in this project.' },
  entity_type_invalid: { ar: 'نوع العنصر غير مدعوم.', en: 'That record type is not supported.' },
  topic_locked: { ar: 'الموضوع مقفول للردود.', en: 'That topic is locked.' },
  field_validation_failed: { ar: 'فيه حقول قيمها غير صحيحة.', en: 'Some fields have invalid values.' },
  title_required_project: { ar: 'عنوان المهمة مطلوب.', en: 'A task title is required.' },
  checklist_incomplete: {
    ar: 'فيه بنود مطلوبة في قائمة التحقق لسه غير مكتملة.',
    en: 'Required checklist items are still open.',
  },
  would_create_cycle: {
    ar: 'ده هيعمل حلقة مقفولة في تبعية المهام.',
    en: 'That would create a loop in the task hierarchy.',
  },
  max_depth_exceeded: {
    ar: 'وصلت لأقصى عمق مسموح للمهام الفرعية.',
    en: 'That is as deep as subtasks can nest.',
  },
  parent_not_found: { ar: 'المهمة الأصلية غير موجودة.', en: 'The parent task no longer exists.' },
  cannot_be_own_parent: { ar: 'المهمة لا يمكن أن تكون أصل نفسها.', en: 'A task cannot be its own parent.' },
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
  // Odoo, as the Events and eLearning pages meet it. Each says what happened
  // and whether waiting will help, rather than "something went wrong".
  odoo_not_configured: {
    ar: 'الاتصال بأودو لسه مش متظبط على السيرفر.',
    en: 'The Odoo connection is not configured on the server.',
  },
  odoo_auth_failed: {
    ar: 'أودو رفض مفتاح الربط (API key). محتاج المسؤول يراجع ODOO_LOGIN و ODOO_API_KEY.',
    en: 'Odoo rejected the integration API key. An administrator needs to check ODOO_LOGIN and ODOO_API_KEY.',
  },
  odoo_timeout: {
    ar: 'أودو اتأخر في الرد ومالحقش. جرّب تاني بعد دقيقة.',
    en: 'Odoo took too long to answer. Try again in a minute.',
  },
  odoo_unreachable: {
    ar: 'مش قادرين نوصل لأودو دلوقتي. جرّب تاني بعد شوية.',
    en: 'Odoo cannot be reached right now. Try again shortly.',
  },
  odoo_bad_response: {
    ar: 'أودو رجّع رد ناقص. جرّب تاني.',
    en: 'Odoo returned an incomplete response. Try again.',
  },
  odoo_schema_changed: {
    ar: 'حقول الإيفينتات في أودو اتغيرت. أعد المحاولة — هنكتشف الحقول من جديد.',
    en: 'The Events fields in Odoo changed. Retry and they will be discovered again.',
  },
  odoo_access_denied: {
    ar: 'حساب الربط في أودو ملوش صلاحية يقرأ البيانات دي.',
    en: 'The Odoo integration account is not allowed to read this data.',
  },
  odoo_error: {
    ar: 'أودو رجّع خطأ. التفاصيل متسجّلة على السيرفر.',
    en: 'Odoo returned an error. The details were logged on the server.',
  },
  invalid_course: { ar: 'رقم الكورس مش صحيح.', en: 'That course id is not valid.' },
  layout_conflict: {
    ar: 'حد تاني عدّل ترتيب الجدول. حمّل آخر نسخة قبل ما تحفظ.',
    en: 'This layout was changed by another user. Reload the latest version before saving.',
  },
  layout_invalid: { ar: 'ترتيب الجدول فيه بيانات مش سليمة.', en: 'The schedule layout contains invalid data.' },
  layout_duplicate_placement: {
    ar: 'نفس الكورس موجود في مكانين. الكورس الواحد يظهر مرة واحدة بس.',
    en: 'The same course is placed twice. A course can appear only once.',
  },
  layout_duplicate_id: { ar: 'فيه باقتين أو مستويين بنفس المعرّف.', en: 'Two packages or groups share an id.' },
  layout_unknown_event: {
    ar: 'فيه كورس مش موجود في أودو. شيله وجرّب تاني.',
    en: 'A course in the layout does not exist in Odoo. Remove it and try again.',
  },
  layout_revision_required: { ar: 'نسخة الترتيب ناقصة. حمّل الصفحة من جديد.', en: 'The layout revision is missing. Reload the page.' },
  course_not_found: {
    ar: 'الكورس ده مش موجود في أودو أو اتمسح.',
    en: 'That course does not exist in Odoo, or was deleted.',
  },
  invalid_schedule_range: {
    ar: 'نطاق التواريخ مش صحيح. راجع تاريخ البداية والنهاية.',
    en: 'That date range is not valid. Check the start and end dates.',
  },
  schedule_range_too_long: {
    ar: 'النطاق أطول من المسموح (٦ شهور للجدول، سنة للأرشيف). اختار فترة أقصر.',
    en: 'That range is too long (6 months for the schedule, a year for the archive).',
  },
  invalid_archive_year: { ar: 'السنة دي مش متاحة في الأرشيف.', en: 'That year is not available in the archive.' },
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
  course_required: {
    ar: 'اختر دورة أولاً.',
    en: 'Pick a course first.',
  },
  prices_not_configured: {
    ar: 'وحدة الأسعار غير مهيأة على الخادم. أضف INSIGHTS_INTERNAL_SECRET.',
    en: 'The price module is not configured on the server. Add INSIGHTS_INTERNAL_SECRET.',
  },
  invalid_price_query: {
    ar: 'الرقم المكتوب غير صالح. اكتب رقمًا مثل 1200.',
    en: 'That is not a number. Enter a figure such as 1200.',
  },
  prices_upstream: {
    ar: 'تعذّر الوصول إلى لوحة الإنسايتس. أعد المحاولة بعد قليل.',
    en: 'The Insights Hub could not be reached. Try again shortly.',
  },
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
