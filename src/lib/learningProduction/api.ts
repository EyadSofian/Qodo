/**
 * E-Learning Production — the API client.
 *
 * Thin named calls over the workspace `api` wrapper, so the session, the 401
 * handling and the error type are inherited. No rules live here: what may be
 * done is what the server says in each response.
 */

import { ApiError, api } from '../api';
import type {
  ActivityEntry,
  AssetBoardResponse,
  AssetDetail,
  AssetStatus,
  AttentionKind,
  ChecklistItem,
  CommentsResponse,
  Course,
  CourseDetail,
  CourseRole,
  CourseSettings,
  CourseWithStats,
  DashboardResponse,
  FileEntry,
  Lesson,
  LessonDetail,
  MatrixResponse,
  Me,
  ModuleRow,
  MyWorkResponse,
  NewComment,
  People,
  Person,
  ProductionDefaults,
  ReportsResponse,
  ReviewComment,
  ReviewsResponse,
  TeamResponse,
  Transcript,
  WorkItem,
} from './types';

const BASE = '/learning-production';

export function query(params: Record<string, unknown>) {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === '' || value === false) continue;
    search.set(key, value === true ? '1' : String(value));
  }
  const text = search.toString();
  return text ? `?${text}` : '';
}

export const paths = {
  me: `${BASE}/me`,
  dashboard: `${BASE}/dashboard/summary`,
  attention: (kind: AttentionKind) => `${BASE}/dashboard/attention?kind=${kind}`,
  myWork: `${BASE}/my-work`,
  reviews: (params: Record<string, unknown> = {}) => `${BASE}/reviews${query(params)}`,
  reports: (courseId?: string) => `${BASE}/reports${query({ courseId })}`,
  courses: (params: Record<string, unknown> = {}) => `${BASE}/courses${query(params)}`,
  course: (courseId: string) => `${BASE}/courses/${courseId}`,
  matrix: (courseId: string) => `${BASE}/courses/${courseId}/production-matrix`,
  archivedLessons: (courseId: string) => `${BASE}/courses/${courseId}/lessons?archived=1`,
  team: (courseId: string) => `${BASE}/courses/${courseId}/team`,
  files: (courseId: string, params: Record<string, unknown> = {}) => `${BASE}/courses/${courseId}/files${query(params)}`,
  courseActivity: (courseId: string, before?: string) => `${BASE}/courses/${courseId}/activity${query({ before })}`,
  checklistTemplate: (courseId: string) => `${BASE}/courses/${courseId}/checklist-template?assetType=VIDEO`,
  lesson: (lessonId: string) => `${BASE}/lessons/${lessonId}`,
  assetBoard: (lessonId: string) => `${BASE}/lessons/${lessonId}/asset-board`,
  asset: (assetId: string) => `${BASE}/assets/${assetId}`,
  comments: (assetId: string) => `${BASE}/assets/${assetId}/comments`,
  assetActivity: (assetId: string) => `${BASE}/assets/${assetId}/activity`,
  people: (search = '') => `${BASE}/people${query({ q: search })}`,
  cover: (courseId: string, stamp?: string) => `/api${BASE}/courses/${courseId}/cover${query({ v: stamp })}`,
  file: (versionId: string, options: { preview?: boolean; download?: boolean } = {}) =>
    `/api${BASE}/versions/${versionId}/file${query({ variant: options.preview ? 'preview' : undefined, download: options.download })}`,
};

export const lp = {
  get: <T,>(path: string) => api.get<T>(path),

  me: () => api.get<Me>(paths.me),
  dashboard: () => api.get<DashboardResponse>(paths.dashboard),
  attention: (kind: AttentionKind) => api.get<{ kind: AttentionKind; items: WorkItem[]; people: People }>(paths.attention(kind)),
  myWork: () => api.get<MyWorkResponse>(paths.myWork),
  reviews: (params: Record<string, unknown>) => api.get<ReviewsResponse>(paths.reviews(params)),
  reports: (courseId?: string) => api.get<ReportsResponse>(paths.reports(courseId)),
  people: (search = '') => api.get<{ people: Person[] }>(paths.people(search)),
  search: (q: string) =>
    api.get<{ courses: Array<{ id: string; name: string; code: string | null }>; lessons: Array<{ id: string; name: string; course: { id: string; name: string } }> }>(
      `${BASE}/search${query({ q })}`
    ),

  courses: (params: Record<string, unknown>) =>
    api.get<{ courses: CourseWithStats[]; people: People; canCreate: boolean }>(paths.courses(params)),
  course: (courseId: string) => api.get<CourseDetail>(paths.course(courseId)),
  createCourse: (input: Record<string, unknown>) => api.post<{ course: Course }>(`${BASE}/courses`, input),
  updateCourse: (courseId: string, input: Record<string, unknown>) => api.patch<{ course: Course }>(paths.course(courseId), input),
  archiveCourse: (courseId: string) => api.post(`${paths.course(courseId)}/archive`),
  restoreCourse: (courseId: string) => api.post(`${paths.course(courseId)}/restore`),
  saveSettings: (courseId: string, settings: Partial<CourseSettings>) =>
    api.put<{ settings: CourseSettings }>(`${paths.course(courseId)}/settings`, settings),
  saveDefaults: (courseId: string, productionDefaults: ProductionDefaults, applyToOpen: boolean) =>
    api.put<{ productionDefaults: ProductionDefaults; filled: number }>(`${paths.course(courseId)}/defaults`, { productionDefaults, applyToOpen }),

  matrix: (courseId: string) => api.get<MatrixResponse>(paths.matrix(courseId)),
  archivedLessons: (courseId: string) => api.get<{ lessons: Lesson[] }>(paths.archivedLessons(courseId)),
  createLesson: (courseId: string, input: Record<string, unknown>) =>
    api.post<{ lessons: Lesson[] }>(`${paths.course(courseId)}/lessons`, input),
  createLessons: (courseId: string, items: Array<{ name: string; moduleId?: string | null; moduleName?: string | null }>) =>
    api.post<{ lessons: Lesson[] }>(`${paths.course(courseId)}/lessons`, { items }),
  updateLesson: (lessonId: string, input: Record<string, unknown>) => api.patch<{ lesson: Lesson }>(paths.lesson(lessonId), input),
  reorderLessons: (courseId: string, moduleId: string | null, lessonIds: string[]) =>
    api.post(`${paths.course(courseId)}/lessons/reorder`, { moduleId, lessonIds }),
  moveLessons: (courseId: string, moduleId: string | null, lessonIds: string[]) =>
    api.post(`${paths.course(courseId)}/lessons/move`, { moduleId, lessonIds }),
  archiveLessons: (courseId: string, lessonIds: string[]) => api.post(`${paths.course(courseId)}/lessons/archive`, { lessonIds }),
  duplicateLesson: (lessonId: string, name: string) => api.post<{ lesson: Lesson }>(`${paths.lesson(lessonId)}/duplicate`, { name }),
  restoreLesson: (lessonId: string) => api.post(`${paths.lesson(lessonId)}/restore`),
  lesson: (lessonId: string) => api.get<LessonDetail>(paths.lesson(lessonId)),
  assetBoard: (lessonId: string) => api.get<AssetBoardResponse>(paths.assetBoard(lessonId)),
  createModule: (courseId: string, name: string) => api.post<{ module: ModuleRow }>(`${paths.course(courseId)}/modules`, { name }),
  updateModule: (moduleId: string, name: string) => api.patch<{ module: ModuleRow }>(`${BASE}/modules/${moduleId}`, { name }),
  archiveModule: (moduleId: string) => api.delete(`${BASE}/modules/${moduleId}`),
  reorderModules: (courseId: string, moduleIds: string[]) => api.post(`${paths.course(courseId)}/modules/reorder`, { moduleIds }),
  bulkAssign: (courseId: string, input: Record<string, unknown>) =>
    api.post<{ updated: number; skipped: number }>(`${paths.course(courseId)}/assets/bulk-assign`, input),

  team: (courseId: string) => api.get<TeamResponse>(paths.team(courseId)),
  saveMember: (courseId: string, userId: string, roles: CourseRole[]) =>
    api.put(`${paths.team(courseId)}/${encodeURIComponent(userId)}`, { roles }),
  removeMember: (courseId: string, userId: string) => api.delete(`${paths.team(courseId)}/${encodeURIComponent(userId)}`),
  files: (courseId: string, params: Record<string, unknown>) =>
    api.get<{ files: FileEntry[]; hasMore: boolean; people: People }>(paths.files(courseId, params)),
  courseActivity: (courseId: string, before?: string) =>
    api.get<{ entries: ActivityEntry[]; hasMore: boolean; people: People }>(paths.courseActivity(courseId, before)),
  checklistTemplate: (courseId: string) => api.get<{ items: ChecklistItem[]; canEdit: boolean }>(paths.checklistTemplate(courseId)),
  saveChecklistTemplate: (courseId: string, items: Array<Partial<ChecklistItem>>) =>
    api.put<{ items: ChecklistItem[] }>(paths.checklistTemplate(courseId), { items }),

  asset: (assetId: string) => api.get<AssetDetail>(paths.asset(assetId)),
  assign: (assetId: string, input: Record<string, unknown>) => api.patch<AssetDetail>(paths.asset(assetId), input),
  action: (assetId: string, action: string, body: Record<string, unknown> = {}) =>
    api.post<AssetDetail>(`${paths.asset(assetId)}/${action}`, body),
  saveDraft: (assetId: string, content: unknown, revision: number) =>
    api.put<{ revision: number; savedAt: string; status: AssetStatus }>(`${paths.asset(assetId)}/draft`, { content, revision }),
  addLink: (assetId: string, externalUrl: string, notes: string) =>
    api.post<AssetDetail>(`${paths.asset(assetId)}/versions`, { externalUrl, notes }),
  assetActivity: (assetId: string) => api.get<{ entries: ActivityEntry[]; people: People }>(paths.assetActivity(assetId)),

  comments: (assetId: string) => api.get<CommentsResponse>(paths.comments(assetId)),
  comment: (assetId: string, input: NewComment) =>
    api.post<{ comment: ReviewComment; people: People }>(paths.comments(assetId), input),
  editComment: (commentId: string, body: string) => api.patch<{ comment: ReviewComment }>(`${BASE}/comments/${commentId}`, { body }),
  resolveComment: (commentId: string, resolve: boolean) =>
    api.post<{ comment: ReviewComment }>(`${BASE}/comments/${commentId}/${resolve ? 'resolve' : 'reopen'}`),
  applySuggestion: (commentId: string) =>
    api.post<{ revision: number; content: unknown }>(`${BASE}/comments/${commentId}/apply-suggestion`),
  deleteAnnotation: (annotationId: string) => api.delete(`${BASE}/annotations/${annotationId}`),

  version: (versionId: string) => api.get<{ version: import('./types').Version }>(`${BASE}/versions/${versionId}`),
  checklist: (versionId: string) => api.get<{ items: ChecklistItem[]; canEdit: boolean }>(`${BASE}/versions/${versionId}/checklist`),
  updateChecklistItem: (itemId: string, input: Record<string, unknown>) =>
    api.patch<{ item: ChecklistItem }>(`${BASE}/checklist-items/${itemId}`, input),
  transcript: (versionId: string) =>
    api.get<{ transcript: Transcript | null; canEdit: boolean }>(`${BASE}/versions/${versionId}/transcript`),
  saveTranscript: (versionId: string, body: string, segments: Transcript['segments']) =>
    api.put<{ transcript: Transcript }>(`${BASE}/versions/${versionId}/transcript`, { body, segments }),
};

export interface UploadHandle<T> {
  promise: Promise<T>;
  abort: () => void;
}

/**
 * A file upload with progress and cancel. `fetch` reports neither, so this is
 * the one place the module uses XMLHttpRequest.
 */
export function uploadFile<T>(
  path: string,
  file: File,
  { method = 'POST', headers = {}, onProgress }: { method?: string; headers?: Record<string, string>; onProgress?: (fraction: number) => void } = {}
): UploadHandle<T> {
  const request = new XMLHttpRequest();
  const promise = new Promise<T>((resolve, reject) => {
    request.open(method, `/api${path}`);
    request.withCredentials = true;
    request.setRequestHeader('Content-Type', 'application/octet-stream');
    request.setRequestHeader('X-File-Name', encodeURIComponent(file.name));
    for (const [name, value] of Object.entries(headers)) request.setRequestHeader(name, value);
    request.upload.onprogress = (event) => {
      if (event.lengthComputable) onProgress?.(event.loaded / event.total);
    };
    request.onload = () => {
      let payload: Record<string, unknown> = {};
      try {
        payload = JSON.parse(request.responseText || '{}');
      } catch {
        payload = {};
      }
      if (request.status >= 200 && request.status < 300) resolve(payload as T);
      else reject(new ApiError(request.status, payload));
    };
    request.onerror = () => reject(new TypeError('network'));
    request.onabort = () => reject(new DOMException('aborted', 'AbortError'));
    request.send(file);
  });
  return { promise, abort: () => request.abort() };
}

export const uploads = {
  version: (assetId: string, file: File, notes: string, durationSeconds: number | null, onProgress?: (fraction: number) => void) =>
    uploadFile<AssetDetail>(`${BASE}/assets/${assetId}/versions`, file, {
      headers: {
        ...(notes ? { 'X-Version-Notes': encodeURIComponent(notes) } : {}),
        ...(durationSeconds ? { 'X-Duration-Seconds': String(durationSeconds) } : {}),
      },
      onProgress,
    }),
  preview: (versionId: string, file: File, onProgress?: (fraction: number) => void) =>
    uploadFile<AssetDetail>(`${BASE}/versions/${versionId}/preview`, file, { method: 'PUT', onProgress }),
  cover: (courseId: string, file: File) => uploadFile<{ hasCover: boolean }>(`${BASE}/courses/${courseId}/cover`, file, { method: 'PUT' }),
};
