/**
 * Files — every uploaded file and link in the course, newest first. Nothing
 * is uploaded here: a file belongs to a stage of a lesson, and is added there.
 */

import { Link } from 'react-router-dom';
import { Download, ExternalLink, FileIcon } from 'lucide-react';
import { useI18n } from '../../../lib/i18n';
import { timeAgo } from '../../../lib/utils';
import { lp, paths } from '../../../lib/learningProduction/api';
import { useLpQuery, useSessionState } from '../../../lib/learningProduction/hooks';
import { STAGES, assetRoute, formatSize, stageKey } from '../../../lib/learningProduction/format';
import type { FileEntry, People } from '../../../lib/learningProduction/types';
import { Chip, EmptyPanel, ErrorPanel, PersonChip, SkeletonRows, StageLabel } from '../../../components/learning-production/kit';
import { useCourse } from '../CourseWorkspace';
import { useState } from 'react';

export function CourseFiles() {
  const { t } = useI18n();
  const { detail } = useCourse();
  const courseId = detail.course.id;
  const [filters, setFilters] = useSessionState(`files.${courseId}`, { assetType: '', latest: '1' });
  const { data, error, loading, reload } = useLpQuery<{ files: FileEntry[]; hasMore: boolean; people: People }>(paths.files(courseId, filters));
  const [more, setMore] = useState<FileEntry[]>([]);

  const loadMore = async () => {
    const offset = (data?.files.length ?? 0) + more.length;
    const next = await lp.files(courseId, { ...filters, offset });
    setMore((list) => [...list, ...next.files]);
  };
  const files = [...(data?.files ?? []), ...more];

  return (
    <>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <select className="field !w-auto" value={filters.assetType} onChange={(event) => { setMore([]); setFilters({ ...filters, assetType: event.target.value }); }} aria-label={t('lp.stage')}>
          <option value="">{t('lp.allStages')}</option>
          {STAGES.filter((type) => type !== 'OUTLINE' && type !== 'SCRIPT').map((type) => (
            <option key={type} value={type}>
              {t(stageKey(type))}
            </option>
          ))}
        </select>
        <label className="flex items-center gap-2 text-[13px] text-ink-muted">
          <input type="checkbox" className="h-4 w-4 accent-brand-500" checked={filters.latest === '1'} onChange={(event) => { setMore([]); setFilters({ ...filters, latest: event.target.checked ? '1' : '' }); }} />
          {t('lp.files.latestOnly')}
        </label>
      </div>
      {loading && !data ? (
        <SkeletonRows rows={5} />
      ) : error && !data ? (
        <ErrorPanel error={error} onRetry={reload} />
      ) : files.length === 0 ? (
        <EmptyPanel icon={<FileIcon size={24} />} title={t('lp.files.empty')} body={t('lp.files.emptyBody')} />
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-surface-line bg-white">
          <table className="w-full min-w-[720px] text-[13px]">
            <thead>
              <tr className="border-b border-surface-line text-[11.5px] text-ink-faint">
                <th className="px-4 py-2 text-start font-semibold">{t('lp.files.file')}</th>
                <th className="px-2 py-2 text-start font-semibold">{t('lp.lesson')}</th>
                <th className="px-2 py-2 text-start font-semibold">{t('lp.files.version')}</th>
                <th className="px-2 py-2 text-start font-semibold">{t('lp.files.uploadedBy')}</th>
                <th className="px-4 py-2 text-end font-semibold">{t('lp.files.size')}</th>
              </tr>
            </thead>
            <tbody>
              {files.map((file) => (
                <tr key={file.id} className="border-b border-surface-line last:border-0">
                  <td className="max-w-0 px-4 py-2.5">
                    <div className="flex min-w-0 items-center gap-2">
                      {file.sourceKind === 'LINK' ? (
                        <a href={file.externalUrl ?? '#'} target="_blank" rel="noreferrer" className="flex min-w-0 items-center gap-1.5 font-semibold text-brand-600 hover:underline">
                          <ExternalLink size={14} className="shrink-0" />
                          <span className="truncate">{file.externalUrl}</span>
                        </a>
                      ) : (
                        <a href={paths.file(file.id, { download: true })} className="flex min-w-0 items-center gap-1.5 font-semibold text-ink hover:text-brand-600">
                          <Download size={14} className="shrink-0 text-ink-faint" />
                          <span className="truncate">{file.fileName}</span>
                        </a>
                      )}
                    </div>
                    <StageLabel type={file.assetType} className="mt-0.5 text-[11.5px] text-ink-faint" />
                  </td>
                  <td className="max-w-0 px-2 py-2.5">
                    <Link to={assetRoute(courseId, file.lesson.id, file.assetType)} className="block truncate text-ink-muted hover:text-brand-600">
                      {file.lesson.name}
                    </Link>
                  </td>
                  <td className="px-2 py-2.5">
                    <span className="flex items-center gap-1.5">
                      v{file.versionNumber}
                      {file.isApproved && <Chip tone="ok">{t('lp.status.APPROVED')}</Chip>}
                      {file.isCurrent && !file.isApproved && <Chip>{t('lp.files.current')}</Chip>}
                    </span>
                  </td>
                  <td className="max-w-0 px-2 py-2.5">
                    <span className="flex items-center gap-1.5">
                      <PersonChip userId={file.createdBy} people={data?.people ?? {}} size={20} />
                      <span className="shrink-0 text-[11.5px] text-ink-faint">{timeAgo(file.createdAt, t)}</span>
                    </span>
                  </td>
                  <td className="px-4 py-2.5 text-end tabular-nums text-ink-muted">{formatSize(file.fileSize)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {data?.hasMore && (
            <div className="border-t border-surface-line p-2 text-center">
              <button type="button" className="btn-quiet btn-sm" onClick={() => void loadMore()}>
                {t('lp.loadMore')}
              </button>
            </div>
          )}
        </div>
      )}
    </>
  );
}
