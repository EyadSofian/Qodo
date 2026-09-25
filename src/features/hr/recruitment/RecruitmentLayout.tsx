/** Recruitment's own sections, under the shared sub-navigation. */

import { RECRUITMENT_NAV } from '../shell/nav';
import { SubNavLayout } from '../shell/SubNav';

export function RecruitmentLayout() {
  return <SubNavLayout items={RECRUITMENT_NAV} label={{ ar: 'أقسام التوظيف', en: 'Recruitment sections' }} layoutId="recruitment-tab" />;
}

export default RecruitmentLayout;
