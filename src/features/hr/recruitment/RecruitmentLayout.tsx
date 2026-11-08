/** Recruitment's own sections, under the shared sub-navigation. */

import { RECRUITMENT_NAV } from '../shell/nav';
import { SubNavLayout } from '../shell/SubNav';
import { Navigate, useLocation } from 'react-router-dom';
import { useHR } from '../shell/HRContext';

export function RecruitmentLayout() {
  const { access } = useHR();
  const { pathname } = useLocation();
  if (pathname === '/hr/recruitment' && access?.offers && !access.recruitment && !access.kpiReview && !access.rewards) {
    return <Navigate to="/hr/recruitment/offers" replace />;
  }
  return <SubNavLayout items={RECRUITMENT_NAV} label={{ ar: 'أقسام التوظيف', en: 'Recruitment sections' }} layoutId="recruitment-tab" />;
}

export default RecruitmentLayout;
