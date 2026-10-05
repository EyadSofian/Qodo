/**
 * Files & activity: every file produced for the course, then its history in
 * sentences — one after the other, no switch between them.
 */

import { CourseActivity } from './CourseActivity';
import { CourseFiles } from './CourseFiles';

export function FilesActivity() {
  return (
    <div className="space-y-5">
      <CourseFiles />
      <CourseActivity />
    </div>
  );
}
