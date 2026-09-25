import {
  BarChart3,
  BriefcaseBusiness,
  ClipboardList,
  Gauge,
  LayoutDashboard,
  Network,
  Settings2,
  UsersRound,
  WalletCards,
  type LucideIcon,
} from 'lucide-react';
import type { HRAccess, Localised } from '../types';
import type { SubNavItem } from './SubNav';

export interface HRNavItem {
  id: string;
  to: string;
  end?: boolean;
  icon: LucideIcon;
  label: Localised;
  visible: (access: HRAccess) => boolean;
}

/**
 * The nine HR areas. Visibility here is a courtesy — every endpoint behind
 * these pages re-checks the same permission on the server.
 */
export const HR_NAV: HRNavItem[] = [
  { id: 'home', to: '/hr', end: true, icon: LayoutDashboard, label: { ar: 'الرئيسية', en: 'HR Home' }, visible: () => true },
  { id: 'recruitment', to: '/hr/recruitment', icon: BriefcaseBusiness, label: { ar: 'التوظيف', en: 'Recruitment' }, visible: (a) => a.recruitment || a.requests || a.kpiReview || a.rewards },
  { id: 'people', to: '/hr/people', icon: UsersRound, label: { ar: 'الموظفون', en: 'People' }, visible: (a) => a.people },
  { id: 'personnel', to: '/hr/personnel', icon: ClipboardList, label: { ar: 'شئون العاملين', en: 'Personnel' }, visible: (a) => a.personnel },
  { id: 'payroll', to: '/hr/payroll', icon: WalletCards, label: { ar: 'الرواتب والمزايا', en: 'Payroll & Benefits' }, visible: (a) => a.payroll },
  // Anyone with an HR record may read their own KPI, and anyone may find a colleague's seat.
  { id: 'performance', to: '/hr/performance', icon: Gauge, label: { ar: 'الأداء', en: 'Performance' }, visible: (a) => a.people || a.performance || a.recruitment || Boolean(a.employeeCode) },
  { id: 'organization', to: '/hr/organization', icon: Network, label: { ar: 'الهيكل التنظيمي', en: 'Organization' }, visible: () => true },
  { id: 'reports', to: '/hr/reports', icon: BarChart3, label: { ar: 'التقارير', en: 'Reports' }, visible: (a) => a.people || a.recruitment || a.payroll },
  { id: 'settings', to: '/hr/settings', icon: Settings2, label: { ar: 'إعدادات HR', en: 'HR Settings' }, visible: (a) => a.settings || a.manage },
];

export const RECRUITMENT_NAV: SubNavItem[] = [
  { to: '/hr/recruitment', end: true, label: { ar: 'نظرة عامة', en: 'Overview' }, visible: (a) => a.recruitment || a.kpiReview || a.rewards },
  { to: '/hr/recruitment/requests', label: { ar: 'طلبات الوظائف', en: 'Job Requests' }, visible: () => true },
  { to: '/hr/recruitment/hiring', label: { ar: 'التوظيف النشط', en: 'Active Hiring' }, visible: (a) => a.recruitment },
  { to: '/hr/recruitment/capacity', label: { ar: 'سعة الفريق', en: 'Team Capacity' }, visible: (a) => a.recruitment },
  { to: '/hr/recruitment/kpi', label: { ar: 'مؤشرات التوظيف', en: 'Recruitment KPI' }, visible: (a) => a.recruitment || a.kpiReview },
  { to: '/hr/recruitment/rewards', label: { ar: 'المكافآت', en: 'Rewards' }, visible: (a) => a.recruitment || a.rewards },
];

export const PERSONNEL_NAV: SubNavItem[] = [
  { to: '/hr/personnel', end: true, label: { ar: 'نظرة عامة', en: 'Overview' }, visible: () => true },
  { to: '/hr/personnel/requests', label: { ar: 'طلبات الموظفين', en: 'Requests' }, visible: () => true },
  { to: '/hr/personnel/onboarding', label: { ar: 'تهيئة الموظفين الجدد', en: 'Onboarding' }, visible: () => true },
  { to: '/hr/personnel/leave', label: { ar: 'الإجازات', en: 'Leave' }, visible: () => true },
  { to: '/hr/personnel/clearance', label: { ar: 'إخلاء الطرف', en: 'Clearance' }, visible: () => true },
];

/** Order used to decide which way a section transition slides. */
export function navIndex(pathname: string) {
  const sorted = [...HR_NAV].sort((left, right) => right.to.length - left.to.length);
  const match = sorted.find((item) => (item.end ? pathname === item.to : pathname === item.to || pathname.startsWith(`${item.to}/`)));
  return match ? HR_NAV.indexOf(match) : 0;
}
