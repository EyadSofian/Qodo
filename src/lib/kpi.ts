export type KPIAudience = 'manager' | 'employee';
export type KPIDirection = 'higher' | 'lower';
export type KPICheckState = 'done' | 'partial' | 'missed' | 'na';
export type KPIStatus = 'draft' | 'final';

export interface KPIIndicator {
  id: string;
  ar: string;
  definition: string;
  weight: number;
  direction: KPIDirection;
  target: number | null;
  unit: string;
  source: string;
  formula: string;
  bands: Array<{ min: number; entitlement: number }> | null;
}

export interface KPIChecklistItem {
  id: string;
  ar: string;
  method: string;
  evidence: string;
  sample: string;
  owner: string;
}

export interface KPIGroup {
  id: string;
  ar: string;
  en: string;
  weight: number;
  minimumRatio: number | null;
  incentiveBands: Array<{ min: number; deduction: number | 'all' }> | null;
  kpis: KPIIndicator[];
  checklist: KPIChecklistItem[];
}

export interface KPITemplate {
  id: string;
  audience: KPIAudience;
  department: string;
  subteam: string;
  ar: string;
  en: string;
  descAr: string;
  descEn: string;
  checklistMode: 'multiplier' | 'evidence' | 'none';
  sourceFile: string;
  groups: KPIGroup[];
}

export interface KPITemplateSummary {
  id: string;
  audience: KPIAudience;
  department: string;
  ar: string;
  en: string;
  descAr: string;
  descEn: string;
  checklistMode: KPITemplate['checklistMode'];
  sourceFile: string;
  groups: number;
  kpis: number;
  checks: number;
  weight: number;
}

export interface KPIRating {
  id: string;
  min: number;
  ar: string;
  en: string;
  color: string;
}

export interface KPIScoredIndicator {
  id: string;
  ar: string;
  unit: string;
  direction: KPIDirection;
  weight: number;
  target: number | null;
  actual: number | null;
  note: string;
  rawRatio: number | null;
  ratio: number | null;
  measured: boolean;
  score: number | null;
}

export interface KPIScoredGroup {
  id: string;
  ar: string;
  en: string;
  weight: number;
  minimumRatio: number | null;
  kpis: KPIScoredIndicator[];
  checklist: { ratio: number | null; counted: number; notApplicable: number; answered: number; total: number };
  incentive: { target: number; deduction: number; net: number; achievement: number } | null;
  rawRatio: number | null;
  ratio: number | null;
  gated: boolean;
  performanceScore: number | null;
  score: number | null;
  percent: number | null;
  measuredWeight: number;
  measuredCount: number;
  kpiCount: number;
}

export interface KPIResult {
  templateId: string;
  groups: KPIScoredGroup[];
  performance: { score: number | null; percent: number | null };
  verification: { ratio: number | null; counted: number; answered: number; total: number };
  approved: { score: number; max: number; totalWeight: number; percent: number | null; rating: KPIRating | null };
  completeness: { kpis: number; measured: number; checks: number; answered: number; complete: boolean };
}

export interface KPIScorecard {
  id: string;
  templateId: string;
  audience: KPIAudience;
  templateAr: string;
  templateEn: string;
  period: string;
  subjectType: 'employee' | 'user';
  subjectId: string;
  subjectName: string;
  status: KPIStatus;
  notes: string;
  values?: Record<string, { actual: number | null; target: number | null; note: string }>;
  checks?: Record<string, KPICheckState>;
  incentives?: Record<string, number>;
  createdBy: string | null;
  updatedBy: string | null;
  updatedAt: string | null;
  finalizedAt: string | null;
  finalizedBy: string | null;
  result: KPIResult;
}

export interface KPIOverview {
  permissions: { canRead: boolean; canManage: boolean; selfOnly: boolean };
  templates: KPITemplateSummary[];
  periods: string[];
  scorecards: KPIScorecard[];
}

export const KPI_CHECK_LABELS: Record<KPICheckState, { ar: string; en: string; tone: string }> = {
  done: { ar: 'تم', en: 'Done', tone: 'bg-status-okBg text-status-ok' },
  partial: { ar: 'جزئي', en: 'Partial', tone: 'bg-status-warnBg text-accent-600' },
  missed: { ar: 'لم يتم', en: 'Not done', tone: 'bg-rose-50 text-rose-700' },
  na: { ar: 'غير منطبق', en: 'N/A', tone: 'bg-surface-sunken text-ink-muted' },
};

export const KPI_CHECK_ORDER: KPICheckState[] = ['done', 'partial', 'missed', 'na'];

/** The current month as the scorecard period format, `YYYY-MM`. */
export function currentPeriod(date = new Date()): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

export function formatPeriod(period: string, lang: 'ar' | 'en'): string {
  const [year, month] = period.split('-').map(Number);
  if (!year || !month) return period;
  // Arabic month name, Latin year — the same numeral system the rest of the
  // HR module uses, so a period reads the same on every tab.
  return new Date(year, month - 1, 1).toLocaleDateString(lang === 'en' ? 'en-GB' : 'ar-EG-u-nu-latn', {
    month: 'long',
    year: 'numeric',
  });
}

/** One decimal, and an em dash for a measurement nobody has taken. */
export function formatScore(value: number | null | undefined): string {
  return value === null || value === undefined || !Number.isFinite(value) ? '—' : value.toFixed(1);
}

export function formatPercent(value: number | null | undefined): string {
  return value === null || value === undefined || !Number.isFinite(value) ? '—' : `${Math.round(value)}%`;
}
