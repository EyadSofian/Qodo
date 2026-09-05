/**
 * Qodo Projects — documents.
 *
 * Two things this screen makes unmissable, because both are easy to get wrong
 * and expensive when they are:
 *
 * **Who can see it.** Every row states whether a client can read it, and the
 * upload form asks before the file lands rather than hiding the switch in a
 * menu afterwards. A drawing shared by accident cannot be un-shared.
 *
 * **What came before.** Uploading again makes a version, never an overwrite,
 * and the version list is one click away with a restore beside each entry.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { Download, Eye, EyeOff, FileText, History, Plus, RotateCcw, Trash2 } from 'lucide-react';
import { useI18n } from '../../../lib/i18n';
import { errorMessage } from '../../../lib/api';
import { documentsApi } from '../../../lib/projects/api';
import type { ProjectDocument } from '../../../lib/projects/types';
import { useProject } from '../../../lib/projects/useProject';
import { EmptyState, Modal, Spinner, useToast } from '../../../components/ui';

/** Bytes, in the unit a person would say out loud. */
function formatSize(bytes: number | null): string {
  if (bytes === null) return '—';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function ProjectDocuments() {
  const { detail, can } = useProject();
  const { t, lang } = useI18n();
  const toast = useToast();
  const projectId = detail.project.id;

  const [files, setFiles] = useState<ProjectDocument[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [shareWithClient, setShareWithClient] = useState(false);
  const [inspecting, setInspecting] = useState<ProjectDocument | null>(null);
  const pickerRef = useRef<HTMLInputElement>(null);
  const versionTargetRef = useRef<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const { files: loaded } = await documentsApi.list(projectId);
      setFiles(loaded);
    } catch (caught) {
      setError(errorMessage(caught, lang));
    } finally {
      setLoading(false);
    }
  }, [projectId, lang]);

  useEffect(() => {
    setLoading(true);
    void load();
  }, [load]);

  const onPicked = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    // Clear immediately so picking the same file twice in a row still fires.
    event.target.value = '';
    if (!file) return;

    setUploading(true);
    try {
      await documentsApi.upload(projectId, file, {
        fileId: versionTargetRef.current ?? undefined,
        isExternal: versionTargetRef.current ? undefined : shareWithClient,
      });
      await load();
    } catch (caught) {
      toast.push(errorMessage(caught, lang), 'bad');
    } finally {
      versionTargetRef.current = null;
      setUploading(false);
    }
  };

  /**
   * Download in two steps: ask for a signed link, then follow it.
   *
   * The link expires in five minutes and carries the asker's id, so it is not
   * a URL worth forwarding — which is the point.
   */
  const download = async (file: ProjectDocument, versionNo?: number) => {
    try {
      const { url } = await documentsApi.downloadUrl(projectId, file.id, versionNo);
      window.location.assign(url);
    } catch (caught) {
      toast.push(errorMessage(caught, lang), 'bad');
    }
  };

  const restore = async (file: ProjectDocument, versionNo: number) => {
    try {
      await documentsApi.restoreVersion(projectId, file.id, versionNo);
      toast.push(t('documents.restored'), 'ok');
      setInspecting(null);
      await load();
    } catch (caught) {
      toast.push(errorMessage(caught, lang), 'bad');
    }
  };

  if (loading) {
    return (
      <div className="card grid place-items-center py-16">
        <Spinner size={22} className="text-brand-500" />
      </div>
    );
  }

  return (
    <section>
      <input ref={pickerRef} type="file" className="hidden" onChange={onPicked} />

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <h2 className="flex-1 text-base font-bold text-ink">{t('documents.title')}</h2>

        {can('document.upload') && (
          <>
            {/* Asked before the file lands, not after. A drawing shared by
                accident cannot be un-shared. */}
            <label className="flex cursor-pointer items-center gap-2 rounded-xl border border-surface-line bg-white px-3 py-2 text-[12.5px] font-semibold text-ink">
              <input
                type="checkbox"
                checked={shareWithClient}
                onChange={(event) => setShareWithClient(event.target.checked)}
              />
              {t('documents.external')}
            </label>
            <button
              type="button"
              className="btn-primary btn-sm"
              disabled={uploading}
              onClick={() => {
                versionTargetRef.current = null;
                pickerRef.current?.click();
              }}
            >
              {uploading ? <Spinner size={15} /> : <Plus size={15} />}
              {uploading ? t('documents.uploading') : t('documents.upload')}
            </button>
          </>
        )}
      </div>

      {error ? (
        <div className="card">
          <EmptyState icon={<FileText size={32} />} title={t('projects.error.load')} body={error} />
        </div>
      ) : files.length === 0 ? (
        <div className="card">
          <EmptyState
            icon={<FileText size={32} />}
            title={t('documents.empty')}
            body={t('documents.emptyHint')}
            action={
              can('document.upload') ? (
                <button type="button" className="btn-primary btn-sm" onClick={() => pickerRef.current?.click()}>
                  <Plus size={15} />
                  {t('documents.upload')}
                </button>
              ) : undefined
            }
          />
        </div>
      ) : (
        <ul className="card divide-y divide-surface-line">
          {files.map((file) => (
            <li key={file.id} className="group flex flex-wrap items-center gap-3 px-4 py-3">
              <FileText size={18} className="shrink-0 text-ink-faint" aria-hidden="true" />

              <div className="min-w-0 flex-1">
                <p className="truncate text-[13.5px] font-semibold text-ink">{file.name}</p>
                <p className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11.5px] text-ink-muted">
                  <span>{formatSize(file.sizeBytes)}</span>
                  <span>{t('documents.version', { n: file.currentVersion })}</span>
                  {/* Visibility on every row, not only in the form. */}
                  <span
                    className={`inline-flex items-center gap-1 ${
                      file.isExternal ? 'text-status-info' : ''
                    }`}
                  >
                    {file.isExternal ? <Eye size={11} /> : <EyeOff size={11} />}
                    {file.isExternal ? t('documents.external') : t('documents.internal')}
                  </span>
                </p>
              </div>

              <div className="flex shrink-0 gap-1">
                {file.currentVersion > 1 && (
                  <button
                    type="button"
                    title={t('documents.versions', { n: file.currentVersion })}
                    aria-label={`${t('documents.versions', { n: file.currentVersion })} — ${file.name}`}
                    className="btn-quiet !min-h-8 rounded-lg px-2"
                    onClick={async () => {
                      const { file: full } = await documentsApi.get(projectId, file.id);
                      setInspecting(full);
                    }}
                  >
                    <History size={15} />
                  </button>
                )}

                <button
                  type="button"
                  title={t('documents.download')}
                  aria-label={`${t('documents.download')} — ${file.name}`}
                  className="btn-quiet !min-h-8 rounded-lg px-2"
                  onClick={() => void download(file)}
                >
                  <Download size={15} />
                </button>

                {can('document.upload') && (
                  <button
                    type="button"
                    title={t('documents.newVersion')}
                    aria-label={`${t('documents.newVersion')} — ${file.name}`}
                    className="btn-quiet !min-h-8 rounded-lg px-2 opacity-0 transition-opacity focus:opacity-100 group-hover:opacity-100"
                    onClick={() => {
                      versionTargetRef.current = file.id;
                      pickerRef.current?.click();
                    }}
                  >
                    <Plus size={15} />
                  </button>
                )}

                {can('document.delete') && (
                  <button
                    type="button"
                    aria-label={`${t('common.delete')} — ${file.name}`}
                    className="btn-danger !min-h-8 rounded-lg px-2 opacity-0 transition-opacity focus:opacity-100 group-hover:opacity-100"
                    onClick={async () => {
                      try {
                        await documentsApi.remove(projectId, file.id);
                        await load();
                      } catch (caught) {
                        toast.push(errorMessage(caught, lang), 'bad');
                      }
                    }}
                  >
                    <Trash2 size={15} />
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}

      <Modal
        open={inspecting !== null}
        onClose={() => setInspecting(null)}
        title={inspecting?.name ?? ''}
        width="md"
      >
        <ol className="divide-y divide-surface-line">
          {(inspecting?.versions ?? []).map((version) => (
            <li key={version.versionNo} className="flex flex-wrap items-center gap-3 py-2.5">
              <span className="chip bg-surface-sunken text-ink-muted">
                {t('documents.version', { n: version.versionNo })}
              </span>
              <span className="flex-1 text-[12px] text-ink-muted">
                {formatSize(version.sizeBytes)}
                {version.notes && ` · ${version.notes}`}
              </span>
              <button
                type="button"
                className="btn-quiet btn-sm"
                onClick={() => inspecting && void download(inspecting, version.versionNo)}
              >
                <Download size={14} />
              </button>
              {version.versionNo !== inspecting?.currentVersion && can('document.upload') && (
                <button
                  type="button"
                  className="btn-ghost btn-sm"
                  onClick={() => inspecting && void restore(inspecting, version.versionNo)}
                >
                  <RotateCcw size={14} />
                  {t('documents.restore')}
                </button>
              )}
            </li>
          ))}
        </ol>
      </Modal>
    </section>
  );
}
