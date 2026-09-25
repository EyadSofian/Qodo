/**
 * What a personnel case carries, by type — the same fields `server/hr/personnel.js`
 * accepts in `cleanDetails`, labelled once for the form, the drawer and the list.
 */

import type { Localised, PersonnelCase, PersonnelStatus, PersonnelType } from '../types';

export interface PersonnelList {
  cases: PersonnelCase[];
  access: { view: boolean; manage: boolean; payroll: boolean; it: boolean };
}

export type DetailKind = 'text' | 'textarea' | 'date' | 'number' | 'select' | 'documents';

export interface DetailField {
  key: string;
  kind: DetailKind;
  label: Localised;
  options?: Array<{ value: string; label: Localised }>;
}

export const LEAVE_TYPES: Array<{ value: string; label: Localised }> = [
  { value: 'annual', label: { ar: 'اعتيادية', en: 'Annual' } },
  { value: 'casual', label: { ar: 'عارضة', en: 'Casual' } },
  { value: 'sick', label: { ar: 'مرضية', en: 'Sick' } },
  { value: 'unpaid', label: { ar: 'بدون أجر', en: 'Unpaid' } },
  { value: 'maternity', label: { ar: 'وضع', en: 'Maternity' } },
  { value: 'other', label: { ar: 'أخرى', en: 'Other' } },
];

export const INSURANCE_OPERATIONS: Array<{ value: string; label: Localised }> = [
  { value: 'registration', label: { ar: 'تسجيل في التأمينات', en: 'Registration' } },
  { value: 'salary_update', label: { ar: 'تعديل الأجر التأميني', en: 'Insured salary update' } },
  { value: 'termination', label: { ar: 'إنهاء اشتراك (استمارة 6)', en: 'Termination (Form 6)' } },
  { value: 'medical', label: { ar: 'تأمين طبي', en: 'Medical insurance' } },
  { value: 'other', label: { ar: 'أخرى', en: 'Other' } },
];

export const DETAIL_FIELDS: Record<PersonnelType, DetailField[]> = {
  onboarding: [
    { key: 'startDate', kind: 'date', label: { ar: 'تاريخ بدء العمل', en: 'Start date' } },
    { key: 'office', kind: 'text', label: { ar: 'المكتب أو المقعد', en: 'Office or seat' } },
    { key: 'accounts', kind: 'textarea', label: { ar: 'الحسابات والأجهزة المطلوبة', en: 'Accounts and equipment needed' } },
  ],
  leave: [
    { key: 'leaveType', kind: 'select', label: { ar: 'نوع الإجازة', en: 'Leave type' }, options: LEAVE_TYPES },
    { key: 'from', kind: 'date', label: { ar: 'من', en: 'From' } },
    { key: 'to', kind: 'date', label: { ar: 'إلى', en: 'To' } },
    { key: 'days', kind: 'number', label: { ar: 'عدد الأيام', en: 'Days' } },
  ],
  clearance: [
    { key: 'lastWorkingDay', kind: 'date', label: { ar: 'آخر يوم عمل', en: 'Last working day' } },
    { key: 'reason', kind: 'text', label: { ar: 'سبب انتهاء الخدمة', en: 'Reason for leaving' } },
  ],
  salary_increase: [
    { key: 'currentSalary', kind: 'number', label: { ar: 'الراتب الحالي', en: 'Current salary' } },
    { key: 'proposedSalary', kind: 'number', label: { ar: 'الراتب المقترح', en: 'Proposed salary' } },
    { key: 'effectiveDate', kind: 'date', label: { ar: 'تاريخ السريان', en: 'Effective date' } },
    { key: 'reason', kind: 'textarea', label: { ar: 'المبرر', en: 'Justification' } },
  ],
  documents: [{ key: 'documents', kind: 'documents', label: { ar: 'المستندات المطلوبة', en: 'Documents requested' } }],
  insurance: [
    { key: 'operation', kind: 'select', label: { ar: 'العملية', en: 'Operation' }, options: INSURANCE_OPERATIONS },
    { key: 'effectiveDate', kind: 'date', label: { ar: 'تاريخ السريان', en: 'Effective date' } },
  ],
  general: [{ key: 'subject', kind: 'text', label: { ar: 'الموضوع', en: 'Subject' } }],
};

/** The moves a case can make — mirrors `TRANSITIONS` on the server. */
export const NEXT_STATUS: Record<PersonnelStatus, Array<{ to: PersonnelStatus; label: Localised; primary?: boolean }>> = {
  open: [
    { to: 'in_progress', label: { ar: 'بدء التنفيذ', en: 'Start' }, primary: true },
    { to: 'done', label: { ar: 'إنهاء', en: 'Mark done' } },
    { to: 'cancelled', label: { ar: 'إلغاء', en: 'Cancel' } },
  ],
  in_progress: [
    { to: 'done', label: { ar: 'إنهاء', en: 'Mark done' }, primary: true },
    { to: 'open', label: { ar: 'إرجاع إلى مفتوح', en: 'Back to open' } },
    { to: 'cancelled', label: { ar: 'إلغاء', en: 'Cancel' } },
  ],
  done: [{ to: 'in_progress', label: { ar: 'إعادة فتح', en: 'Reopen' } }],
  cancelled: [{ to: 'open', label: { ar: 'إعادة فتح', en: 'Reopen' } }],
};

export const TIMELINE_LABEL: Record<string, Localised> = {
  created: { ar: 'أُنشئ الطلب', en: 'Case created' },
  handoff_from_recruitment: { ar: 'تسليم من التوظيف بعد اكتمال الوظيفة', en: 'Handed over from recruitment' },
  'status.open': { ar: 'أُعيد إلى مفتوح', en: 'Moved back to open' },
  'status.in_progress': { ar: 'بدأ التنفيذ', en: 'Work started' },
  'status.done': { ar: 'انتهى', en: 'Marked done' },
  'status.cancelled': { ar: 'أُلغي', en: 'Cancelled' },
  checked: { ar: 'تم بند', en: 'Item done' },
  unchecked: { ar: 'أُلغي إتمام بند', en: 'Item reopened' },
  form_link_created: { ar: 'أُنشئ رابط نموذج البيانات', en: 'Form link created' },
  form_submitted: { ar: 'الموظف الجديد أرسل النموذج', en: 'New hire submitted the form' },
};

export const FORM_FIELD_LABEL: Record<string, Localised> = {
  fullNameArabic: { ar: 'الاسم بالعربي', en: 'Name in Arabic' },
  fullNameEnglish: { ar: 'الاسم بالإنجليزي', en: 'Name in English' },
  nationalId: { ar: 'الرقم القومي / الجواز', en: 'National ID / passport' },
  birthDate: { ar: 'تاريخ الميلاد', en: 'Birth date' },
  mobile: { ar: 'الموبايل', en: 'Mobile' },
  personalEmail: { ar: 'البريد الشخصي', en: 'Personal e-mail' },
  address: { ar: 'العنوان', en: 'Address' },
  education: { ar: 'المؤهل', en: 'Education' },
  graduationYear: { ar: 'سنة التخرج', en: 'Graduation year' },
  maritalStatus: { ar: 'الحالة الاجتماعية', en: 'Marital status' },
  militaryStatus: { ar: 'موقف التجنيد', en: 'Military status' },
  emergencyContactName: { ar: 'اسم للطوارئ', en: 'Emergency contact' },
  emergencyContactPhone: { ar: 'هاتف الطوارئ', en: 'Emergency phone' },
  bankAccount: { ar: 'رقم الحساب البنكي', en: 'Bank account' },
};

/** The sub-page a case type lives on. */
export function sectionFor(type: PersonnelType) {
  if (type === 'onboarding' || type === 'clearance' || type === 'leave') return type;
  return 'requests';
}

export const REQUEST_TYPES: PersonnelType[] = ['general', 'documents', 'salary_increase', 'insurance'];

export const isOpenCase = (item: Pick<PersonnelCase, 'status'>) => item.status === 'open' || item.status === 'in_progress';

export function checklistProgress(item: Pick<PersonnelCase, 'checklist'>) {
  const total = item.checklist?.length ?? 0;
  const done = (item.checklist ?? []).filter((entry) => entry.done).length;
  return { done, total };
}

/** A form link that was sent and has not come back yet (and has not expired). */
export function formPending(item: Pick<PersonnelCase, 'form'>, now = Date.now()) {
  return Boolean(item.form && !item.form.submittedAt && Date.parse(item.form.expiresAt) > now);
}
