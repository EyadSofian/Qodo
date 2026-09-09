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
  "insights.leads_summary": {
    ...info,
    icon: UsersRound,
    label: { ar: "ملخص العملاء المحتملين", en: "Lead summary" },
  },
  "insights.website_summary": {
    ...ok,
    icon: Globe2,
    label: { ar: "تقرير الموقع", en: "Website report" },
  },
  "insights.campaigns_review": {
    ...warning,
    icon: Megaphone,
    label: { ar: "مراجعة الحملات", en: "Campaign review" },
  },
  "insights.employees_attention": {
    ...danger,
    icon: TrendingDown,
    label: { ar: "متابعة أداء الفريق", en: "Team performance" },
  },
};

export function notificationPresentation(
  type: string,
): NotificationPresentation {
  return PRESENTATIONS[type] ?? info;
}
