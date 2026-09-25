import {
  AlarmClock,
  Archive,
  BellRing,
  CheckCircle2,
  ClipboardCheck,
  ClipboardList,
  Clock,
  Globe2,
  Megaphone,
  MessageSquare,
  RotateCcw,
  Send,
  TrendingDown,
  UserPlus,
  UsersRound,
  type LucideIcon,
} from "lucide-react";

export interface NotificationPresentation {
  icon: LucideIcon;
  label: { ar: string; en: string };
  iconBox: string;
  accent: string;
  unread: string;
}

const info: NotificationPresentation = {
  icon: BellRing,
  label: { ar: "إشعار جديد", en: "New notification" },
  iconBox: "bg-status-infoBg text-status-info",
  accent: "bg-status-info",
  unread: "bg-status-infoBg/70",
};

const ok: NotificationPresentation = {
  icon: CheckCircle2,
  label: { ar: "تم بنجاح", en: "Completed" },
  iconBox: "bg-status-okBg text-status-ok",
  accent: "bg-status-ok",
  unread: "bg-status-okBg/60",
};

const warning: NotificationPresentation = {
  icon: Clock,
  label: { ar: "يحتاج متابعة", en: "Needs attention" },
  iconBox: "bg-status-warnBg text-amber-700",
  accent: "bg-status-warn",
  unread: "bg-status-warnBg/55",
};

const danger: NotificationPresentation = {
  icon: TrendingDown,
  label: { ar: "أولوية عاجلة", en: "High priority" },
  iconBox: "bg-status-badBg text-status-bad",
  accent: "bg-status-bad",
  unread: "bg-status-badBg/55",
};

const PRESENTATIONS: Record<string, NotificationPresentation> = {
  "system.push_test": {
    ...info,
    icon: BellRing,
    label: { ar: "اختبار الإشعارات", en: "Notification test" },
  },
  "learning.assigned": {
    ...info,
    icon: ClipboardList,
    label: { ar: "عمل إنتاج جديد", en: "New production work" },
  },
  "learning.reviewer_assigned": {
    ...info,
    icon: UserPlus,
    label: { ar: "مراجعة مسندة إليك", en: "You are the reviewer" },
  },
  "learning.submitted": {
    ...info,
    icon: Send,
    label: { ar: "بانتظار مراجعتك", en: "Waiting for your review" },
  },
  "learning.resubmitted": {
    ...info,
    icon: Send,
    label: { ar: "أُعيد الإرسال للمراجعة", en: "Resubmitted for review" },
  },
  "learning.changes_requested": {
    ...warning,
    icon: RotateCcw,
    label: { ar: "مطلوب تعديلات", en: "Changes requested" },
  },
  "learning.approved": {
    ...ok,
    icon: CheckCircle2,
    label: { ar: "تم الاعتماد", en: "Approved" },
  },
  "learning.reopened": {
    ...warning,
    icon: RotateCcw,
    label: { ar: "أُعيد فتح العمل", en: "Work reopened" },
  },
  "learning.comment": {
    ...info,
    icon: MessageSquare,
    label: { ar: "ملاحظة جديدة", en: "New comment" },
  },
  "learning.due_soon": {
    ...warning,
    icon: AlarmClock,
    label: { ar: "موعد قريب", en: "Due soon" },
  },
  "learning.overdue": {
    ...danger,
    icon: AlarmClock,
    label: { ar: "متأخر عن موعده", en: "Overdue" },
  },
  "task.assigned": {
    ...info,
    icon: ClipboardList,
    label: { ar: "مهمة جديدة", en: "New task" },
  },
  "task.returned": {
    ...danger,
    icon: RotateCcw,
    label: { ar: "مطلوب تعديل", en: "Rework requested" },
  },
  "task.reset_pending": { ...warning, icon: RotateCcw },
  "task.stage_override": { ...warning, icon: RotateCcw },
  "task.submitted": {
    ...info,
    icon: Send,
    label: { ar: "جاهزة للمراجعة", en: "Ready for review" },
  },
  "task.approved": ok,
  "task.review_passed": ok,
  "task.awaiting_final_approval": {
    ...warning,
    icon: ClipboardCheck,
    label: { ar: "بانتظار الاعتماد", en: "Awaiting approval" },
  },
  "task.comment": {
    ...info,
    icon: MessageSquare,
    label: { ar: "تعليق جديد", en: "New comment" },
  },
  "task.archived": {
    ...info,
    icon: Archive,
    label: { ar: "تمت الأرشفة", en: "Archived" },
  },
  "task.unassigned": { ...info, icon: ClipboardList },
  "account.approved": ok,
  "user.join_request": {
    ...info,
    icon: UserPlus,
    label: { ar: "طلب انضمام", en: "Join request" },
  },
  "management.due_soon": warning,
  "task.overdue": {
    ...danger,
    icon: AlarmClock,
    label: { ar: "تأخير", en: "Overdue" },
  },
  "insights.updated": {
    ...info,
    icon: Globe2,
    label: { ar: "تحديث بيانات", en: "Data refresh" },
  },
  "insights.data_updated": {
    ...info,
    icon: Globe2,
    label: { ar: "تحديث البيانات", en: "Data update" },
  },
  "insights.management_brief": {
    ...info,
    icon: ClipboardList,
    label: { ar: "ملخص إداري سابق", en: "Previous management brief" },
  },
  "insights.leads_summary": {
    ...info,
    icon: UsersRound,
    label: { ar: "العملاء والمتابعة", en: "Lead summary" },
  },
  "insights.website_summary": {
    ...ok,
    icon: Globe2,
    label: { ar: "الموقع والمبيعات", en: "Website report" },
  },
  "insights.campaigns_review": {
    ...warning,
    icon: Megaphone,
    label: { ar: "الحملات", en: "Campaign review" },
  },
  "insights.employees_attention": {
    ...danger,
    icon: TrendingDown,
    label: { ar: "أداء الفريق", en: "Team performance" },
  },
};

/** Recruitment alerts that mean a deadline or a critical seat is already lost. */
const URGENT_RECRUITMENT_ALERTS = new Set(["sla_overdue", "critical_unassigned"]);

export function notificationPresentation(
  type: string,
): NotificationPresentation {
  if (PRESENTATIONS[type]) return PRESENTATIONS[type];
  // HR V2 sends families of types (`recruitment.alert.sla_overdue`,
  // `recruitment.approved`, `personnel.onboarding`…); each family reads as one.
  if (type.startsWith("recruitment.alert.")) {
    return URGENT_RECRUITMENT_ALERTS.has(type.slice("recruitment.alert.".length))
      ? { ...danger, icon: AlarmClock, label: { ar: "توظيف عاجل", en: "Urgent recruitment" } }
      : { ...warning, icon: AlarmClock, label: { ar: "تنبيه توظيف", en: "Recruitment alert" } };
  }
  if (type.startsWith("recruitment.")) {
    return { ...info, icon: ClipboardList, label: { ar: "التوظيف", en: "Recruitment" } };
  }
  if (type.startsWith("personnel.")) {
    return { ...info, icon: UserPlus, label: { ar: "شئون العاملين", en: "Personnel" } };
  }
  return info;
}

/** Arabic management cards keep one readable date style in either UI locale. */
export function arabicNotificationTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("ar-EG", {
    day: "numeric",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
    timeZone: "Africa/Cairo",
  }).format(date);
}
