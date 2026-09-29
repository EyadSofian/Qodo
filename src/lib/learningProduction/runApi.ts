/**
 * Production runs — the API client.
 *
 * Named calls over the workspace `api` wrapper, like `api.ts`. No rules live
 * here: what may be done is what each response's verdicts say.
 */

import { api } from '../api';
import { query, uploadFile } from './api';
import type {
  CandidatesResponse,
  ImpactResponse,
  IssueDetail,
  IssuesResponse,
  MyWork2Response,
  NotificationPreferences,
  PortfolioResponse,
  Release,
  ReleasesResponse,
  Reviews2Response,
  RunTeamResponse,
  RunView,
  RunsResponse,
  TaskDetail,
  TemplateSummary,
  TemplateVersion,
  TemplatesResponse,
  TraceabilityResponse,
} from './runTypes';
import type { People } from './types';

const BASE = '/learning-production';

export const runPaths = {
  work: `${BASE}/work`,
  reviews: (scope: 'mine' | 'all' = 'mine') => `${BASE}/review-queue${query({ scope: scope === 'all' ? 'all' : undefined })}`,
  portfolio: `${BASE}/portfolio`,
  preferences: `${BASE}/notification-preferences`,
  templates: `${BASE}/templates`,
  traceability: `${BASE}/traceability`,
  courseRuns: (courseId: string) => `${BASE}/courses/${courseId}/runs`,
  run: (runId: string) => `${BASE}/runs/${runId}`,
  runTeam: (runId: string) => `${BASE}/runs/${runId}/team`,
  task: (taskId: string) => `${BASE}/tasks/${taskId}`,
  issues: (runId: string) => `${BASE}/runs/${runId}/issues`,
  issue: (issueId: string) => `${BASE}/issues/${issueId}`,
  releases: (courseId: string) => `${BASE}/courses/${courseId}/releases`,
  release: (releaseId: string) => `${BASE}/releases/${releaseId}`,
  impact: (runId: string) => `${BASE}/runs/${runId}/impact`,
  candidates: (runId: string) => `${BASE}/runs/${runId}/candidates`,
  evidenceFile: (evidenceId: string, download = false) => `/api${BASE}/evidence/${evidenceId}/file${query({ download })}`,
  candidateFile: (fileId: string, download = false) => `/api${BASE}/candidate-files/${fileId}${query({ download })}`,
};

export const runsApi = {
  work: () => api.get<MyWork2Response>(runPaths.work),
  reviews: (scope: 'mine' | 'all') => api.get<Reviews2Response>(runPaths.reviews(scope)),
  portfolio: () => api.get<PortfolioResponse>(runPaths.portfolio),
  preferences: () => api.get<NotificationPreferences>(runPaths.preferences),
  savePreferences: (input: Partial<NotificationPreferences['preferences']>) => api.put<NotificationPreferences>(runPaths.preferences, input),

  templates: () => api.get<TemplatesResponse>(runPaths.templates),
  previewTemplate: (scenario: string) =>
    api.post<{ templateVersion: TemplateVersion; summary: TemplateSummary }>(`${BASE}/templates/preview`, { scenario }),
  publishTemplate: (scenario: string, options: Record<string, boolean>, notes: string) =>
    api.post<{ version: TemplateVersion; summary: TemplateSummary }>(`${BASE}/templates/versions`, { scenario, options, notes }),
  traceability: () => api.get<TraceabilityResponse>(runPaths.traceability),

  createRun: (input: Record<string, unknown>) => api.post<RunView>(`${BASE}/runs`, input),
  courseRuns: (courseId: string) => api.get<RunsResponse>(runPaths.courseRuns(courseId)),
  run: (runId: string) => api.get<RunView>(runPaths.run(runId)),
  updateRun: (runId: string, input: Record<string, unknown>) => api.patch<RunView>(runPaths.run(runId), input),
  adopt: (runId: string, scenario: string) => api.post<RunView>(`${runPaths.run(runId)}/adopt`, { scenario }),
  skipStage: (stageId: string, reason: string) => api.post<RunView>(`${BASE}/stages/${stageId}/skip`, { reason }),
  unskipStage: (stageId: string) => api.post<RunView>(`${BASE}/stages/${stageId}/unskip`),
  runTeam: (runId: string) => api.get<RunTeamResponse>(runPaths.runTeam(runId)),
  saveRunMember: (runId: string, userId: string, roles: string[]) =>
    api.put<RunTeamResponse>(`${runPaths.runTeam(runId)}/${encodeURIComponent(userId)}`, { roles }),
  removeRunMember: (runId: string, userId: string) => api.delete<RunTeamResponse>(`${runPaths.runTeam(runId)}/${encodeURIComponent(userId)}`),

  task: (taskId: string) => api.get<TaskDetail>(runPaths.task(taskId)),
  assignTask: (taskId: string, input: Record<string, unknown>) => api.patch<TaskDetail>(runPaths.task(taskId), input),
  taskAction: (taskId: string, action: string, body: Record<string, unknown> = {}) => api.post<TaskDetail>(`${runPaths.task(taskId)}/${action}`, body),
  checklist: (itemId: string, input: Record<string, unknown>) => api.patch<TaskDetail>(`${BASE}/task-checklist-items/${itemId}`, input),
  addEvidenceLink: (taskId: string, url: string, note: string) => api.post<TaskDetail>(`${runPaths.task(taskId)}/evidence`, { url, note }),
  addEvidenceNote: (taskId: string, note: string) => api.post<TaskDetail>(`${runPaths.task(taskId)}/evidence`, { note }),
  withdrawEvidence: (evidenceId: string, reason: string) => api.post<TaskDetail>(`${BASE}/evidence/${evidenceId}/withdraw`, { reason }),
  comment: (taskId: string, body: string, parentId?: string) => api.post<TaskDetail>(`${runPaths.task(taskId)}/comments`, { body, parentId }),

  issues: (runId: string) => api.get<IssuesResponse>(runPaths.issues(runId)),
  issue: (issueId: string) => api.get<IssueDetail>(runPaths.issue(issueId)),
  createIssue: (runId: string, input: Record<string, unknown>) => api.post<IssueDetail>(runPaths.issues(runId), input),
  updateIssue: (issueId: string, input: Record<string, unknown>) => api.patch<IssueDetail>(runPaths.issue(issueId), input),
  issueAction: (issueId: string, action: string, body: Record<string, unknown> = {}) => api.post<IssueDetail>(`${runPaths.issue(issueId)}/${action}`, body),

  releases: (courseId: string) => api.get<ReleasesResponse>(runPaths.releases(courseId)),
  release: (releaseId: string) => api.get<{ release: Release; stale: string[]; people: People }>(runPaths.release(releaseId)),
  prepareRelease: (runId: string, input: Record<string, unknown>) =>
    api.post<{ release: Release; stale: string[]; people: People }>(`${runPaths.run(runId)}/releases`, input),
  releaseAction: (releaseId: string, action: 'signoff' | 'publish' | 'withdraw' | 'rollback', body: Record<string, unknown> = {}) =>
    api.post<{ release: Release; stale: string[]; people: People }>(`${runPaths.release(releaseId)}/${action}`, body),

  impact: (runId: string) => api.get<ImpactResponse>(runPaths.impact(runId)),
  saveImpact: (runId: string, items: Array<Record<string, unknown>>) => api.put<ImpactResponse>(runPaths.impact(runId), { items }),
  applyImpact: (runId: string) => api.post<ImpactResponse>(`${runPaths.impact(runId)}/apply`),

  candidates: (runId: string) => api.get<CandidatesResponse>(runPaths.candidates(runId)),
  createCandidate: (runId: string, input: Record<string, unknown>) => api.post<CandidatesResponse>(runPaths.candidates(runId), input),
  updateCandidate: (candidateId: string, input: Record<string, unknown>) => api.patch<CandidatesResponse>(`${BASE}/candidates/${candidateId}`, input),

  setApplicability: (assetId: string, applicable: boolean, reason?: string) =>
    api.post(`${BASE}/assets/${assetId}/applicability`, { applicable, reason }),
  addLessonAsset: (lessonId: string, assetType: string) => api.post(`${BASE}/lessons/${lessonId}/assets`, { assetType }),
};

export const runUploads = {
  evidence: (taskId: string, file: File, note: string, onProgress?: (fraction: number) => void) =>
    uploadFile<TaskDetail>(`${BASE}/tasks/${taskId}/evidence`, file, {
      headers: note ? { 'X-Evidence-Note': encodeURIComponent(note) } : {},
      onProgress,
    }),
  candidateFile: (candidateId: string, file: File, kind: string) =>
    uploadFile<CandidatesResponse>(`${BASE}/candidates/${candidateId}/files`, file, { headers: { 'X-File-Kind': kind } }),
};
