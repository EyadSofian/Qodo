/**
 * Files & activity: every file produced for the course, and its history in
 * sentences. Two views of the same record, one tab.
 */

import { useSearchParams } from 'react-router-dom';
import { useI18n } from '../../../lib/i18n';
import { Choice } from '../../../components/learning-production/studio';
import { CourseActivity } from './CourseActivity';
import { CourseFiles } from './CourseFiles';

export function FilesActivity() {
  const { t } = useI18n();
  const [params, setParams] = useSearchParams();
  const view = params.get('view') === 'activity' ? 'activity' : 'files';
  return (
    <div className="space-y-4">
      <Choice<'files' | 'activity'>
        label={t('lp.tab.files')}
        value={view}
        onChange={(next) => {
          const copy = new URLSearchParams(params);
          if (next === 'activity') copy.set('view', 'activity');
          else copy.delete('view');
          setParams(copy);
        }}
        options={[
          { value: 'files', label: t('lp.files.files') },
          { value: 'activity', label: t('lp.files.activity') },
        ]}
      />
      {view === 'files' ? <CourseFiles /> : <CourseActivity />}
    </div>
  );
}
