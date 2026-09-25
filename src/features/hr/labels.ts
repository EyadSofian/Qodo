/**
 * Every enumerated value HR V2 shows, in both languages, in one place — so a
 * status reads the same on the table, the card and the timeline.
 */

import type { Localised, PersonnelStatus, PersonnelType, Priority, RequestStatus, Severity, SlaState } from './types';

export const PRIORITY_LABEL: Record<Priority, Localised> = {
  critical: { ar: 'حرجة', en: 'Critical' },
  required: { ar: 'مطلوبة', en: 'Required' },
  planned: { ar: 'مخطط لها', en: 'Planned' },
};

export const PRIORITY_ORDER: Priority[] = ['critical', 'required', 'planned'];

export const STATUS_LABEL: Record<RequestStatus, Localised> = {
  draft: { ar: 'مسودة', en: 'Draft' },
  pending_review: { ar: 'مراجعة القسم', en: 'Department review' },
  pending_approval: { ar: 'الاعتماد النهائي', en: 'Final approval' },
  hiring: { ar: 'توظيف نشط', en: 'Active hiring' },
  on_hold: { ar: 'معلّقة', en: 'On hold' },
  completed: { ar: 'مكتملة', en: 'Completed' },
  cancelled: { ar: 'ملغاة', en: 'Cancelled' },
  rejected: { ar: 'مرفوضة', en: 'Rejected' },
};

export const SLA_LABEL: Record<SlaState, Localised> = {
  on_track: { ar: 'في الموعد', en: 'On track' },
  due_soon: { ar: 'قريبة الاستحقاق', en: 'Due soon' },
  due_today: { ar: 'تستحق اليوم', en: 'Due today' },
  overdue: { ar: 'متأخرة', en: 'Overdue' },
  paused: { ar: 'موقوفة مؤقتاً', en: 'Paused' },
  met: { ar: 'داخل الـSLA', en: 'Within SLA' },
  missed: { ar: 'بعد الموعد', en: 'Missed SLA' },
  not_started: { ar: 'لم يبدأ', en: 'Not started' },
};

export const SEVERITY_LABEL: Record<Severity, Localised> = {
  critical: { ar: 'حرج', en: 'Critical' },
  warning: { ar: 'تنبيه', en: 'Warning' },
  info: { ar: 'معلومة', en: 'Info' },
  success: { ar: 'تم', en: 'Done' },
};

export const STAGE_LABEL: Record<string, Localised> = {
  request: { ar: 'الطلب', en: 'Requested' },
  department_review: { ar: 'مراجعة القسم', en: 'Department review' },
  final_approval: { ar: 'الاعتماد النهائي', en: 'Final approval' },
  hiring: { ar: 'التوظيف', en: 'Hiring' },
  closure: { ar: 'الإغلاق', en: 'Closure' },
};

export const DECISION_LABEL: Record<string, Localised> = {
  submitted: { ar: 'قُدّم', en: 'Submitted' },
  approved: { ar: 'اعتُمد', en: 'Approved' },
  returned: { ar: 'أُعيد للتعديل', en: 'Returned' },
  rejected: { ar: 'رُفض', en: 'Rejected' },
  held: { ar: 'عُلّق', en: 'Put on hold' },
  resumed: { ar: 'استُؤنف', en: 'Resumed' },
  completed: { ar: 'اكتمل', en: 'Completed' },
  cancelled: { ar: 'أُلغي', en: 'Cancelled' },
};

export const REASON_LABEL: Record<string, Localised> = {
  new: { ar: 'وظيفة جديدة', en: 'New position' },
  replacement: { ar: 'بديل لموظف', en: 'Replacement' },
  expansion: { ar: 'توسع', en: 'Expansion' },
  other: { ar: 'أخرى', en: 'Other' },
};

export const LOCATION_LABEL: Record<string, Localised> = {
  EG: { ar: 'مصر', en: 'Egypt' },
  KSA: { ar: 'السعودية', en: 'Saudi Arabia' },
};

export const ODOO_STAGE_AR: Record<string, string> = {
  New: 'جديد',
  'Initial Screening': 'فرز أولي',
  'HR Evaluation': 'تقييم الموارد البشرية',
  'Technical Evaluation': 'تقييم فني',
  'On boarding': 'تهيئة',
  'Final Review & Decision': 'مراجعة نهائية وقرار',
  Rejected: 'مرفوض',
  'Shortlisted I': 'قائمة مختصرة ١',
  'Shortlisted II': 'قائمة مختصرة ٢',
  'Contract Signed': 'تم توقيع العقد',
  'Contract negotiation': 'تفاوض العقد',
  'Next Patch': 'الدفعة القادمة',
  Unstaged: 'بلا مرحلة',
};

export const FUNNEL_LABEL: Record<string, Localised> = {
  received: { ar: 'مرشحون مستلمون', en: 'Candidates received' },
  filtered: { ar: 'مناسبون بعد الفرز', en: 'Suitable after filtering' },
  interviewed: { ar: 'تمت مقابلتهم', en: 'Interviewed' },
  accepted: { ar: 'مقبولون', en: 'Accepted' },
  offer: { ar: 'عُرض عليهم', en: 'Offer sent' },
  hired: { ar: 'تم تعيينهم', en: 'Hired' },
};

export const REWARD_REASON_LABEL: Record<string, Localised> = {
  already_batched: { ar: 'ضمن دفعة سابقة', en: 'Already in a batch' },
  not_completed: { ar: 'غير مكتملة بتاريخ معروف', en: 'Not completed with a known date' },
  sla_not_met: { ar: 'اكتملت بعد الـSLA', en: 'Completed after its SLA' },
  quality_failed: { ar: 'عليها خصم جودة', en: 'Has a quality deduction' },
  no_reward_category: { ar: 'لا يوجد بند مكافأة لتصنيفها', en: 'No reward line for its classification' },
};

export const PERSONNEL_TYPE_LABEL: Record<PersonnelType, Localised> = {
  onboarding: { ar: 'تهيئة موظف جديد', en: 'Onboarding' },
  leave: { ar: 'إجازة', en: 'Leave' },
  clearance: { ar: 'إخلاء طرف', en: 'Clearance' },
  salary_increase: { ar: 'زيادة راتب', en: 'Salary increase' },
  documents: { ar: 'مستندات', en: 'Documents' },
  insurance: { ar: 'تأمينات', en: 'Insurance' },
  general: { ar: 'طلب موظف', en: 'Employee request' },
};

export const PERSONNEL_STATUS_LABEL: Record<PersonnelStatus, Localised> = {
  open: { ar: 'مفتوح', en: 'Open' },
  in_progress: { ar: 'قيد التنفيذ', en: 'In progress' },
  done: { ar: 'منتهي', en: 'Done' },
  cancelled: { ar: 'ملغي', en: 'Cancelled' },
};

export const OWNER_LABEL: Record<string, Localised> = {
  personnel: { ar: 'شئون العاملين', en: 'Personnel' },
  manager: { ar: 'المدير المباشر', en: 'Manager' },
  it: { ar: 'IT', en: 'IT' },
};

export const TEAM_REASON_LABEL: Record<string, Localised> = {
  title: { ar: 'المسمى الوظيفي', en: 'Job title' },
  odoo: { ar: 'قسم التوظيف في Odoo', en: 'Odoo recruiting department' },
  assignments: { ar: 'مسؤول عن طلبات', en: 'Owns requests' },
  manual: { ar: 'أُضيف يدوياً', en: 'Added in settings' },
};

export const WEEKDAY_LABEL: Localised[] = [
  { ar: 'الأحد', en: 'Sunday' },
  { ar: 'الاثنين', en: 'Monday' },
  { ar: 'الثلاثاء', en: 'Tuesday' },
  { ar: 'الأربعاء', en: 'Wednesday' },
  { ar: 'الخميس', en: 'Thursday' },
  { ar: 'الجمعة', en: 'Friday' },
  { ar: 'السبت', en: 'Saturday' },
];

/** The document columns of the employee database, as the master workbook names them. */
export const DOCUMENT_LABEL: Record<string, Localised> = {
  id: { ar: 'صورة البطاقة', en: 'ID copy' },
  photo: { ar: 'صورة شخصية', en: 'Photo' },
  graduation: { ar: 'شهادة التخرج', en: 'Graduation certificate' },
  military: { ar: 'موقف التجنيد', en: 'Military status' },
  workCertificate: { ar: 'كعب العمل', en: 'Work record' },
  criminalRecord: { ar: 'الفيش الجنائي', en: 'Criminal record' },
  experienceCertificates: { ar: 'شهادات الخبرة', en: 'Experience certificates' },
  birthCertificate: { ar: 'شهادة الميلاد', en: 'Birth certificate' },
  contract: { ar: 'العقد', en: 'Contract' },
  application: { ar: 'طلب التوظيف', en: 'Application form' },
  cv: { ar: 'السيرة الذاتية', en: 'CV' },
};
