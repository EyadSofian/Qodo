/**
 * Job classification and location — two axes that are easy to confuse with
 * priority and must not be.
 *
 *   priority        Critical / Required / Planned — how fast (drives the SLA)
 *   classification  Instructor / Team Leader / Manager / Senior / Agent — what
 *                   kind of role (drives reward categories and reports)
 *
 * The list is a setting. These are the defaults management named, plus
 * "Agent", which the approved reward table prices (500) and which would
 * otherwise have no classification to attach to.
 */

export const DEFAULT_CLASSIFICATIONS = [
  { id: 'instructor', ar: 'مدرب', en: 'Instructor', active: true },
  { id: 'team_leader', ar: 'قائد فريق', en: 'Team Leader', active: true },
  { id: 'manager', ar: 'مدير', en: 'Manager', active: true },
  { id: 'senior', ar: 'سينيور', en: 'Senior', active: true },
  { id: 'agent', ar: 'إيجنت', en: 'Agent', active: true },
];

const PRIMARY_PATTERNS = [
  ['instructor', /\b(instructor|trainer)\b|مدرب|محاضر/i],
  ['team_leader', /\bteam\s*-?\s*leader\b|\bteamleader\b|\bt\.?\s?l\b|قائد\s*فريق|تيم\s*ليدر/i],
  ['manager', /\b(manager|director|head of)\b|مدير/i],
  ['agent', /\b(agent|telesales|re-?sale|call\s*cent(er|re)|customer\s*service)\b|خدمة\s*عملاء/i],
];
const SENIOR = /\b(senior|sr)\b|سينيور/i;

/**
 * The classification a job title names unambiguously, or `null`.
 *
 * "Senior" is a modifier: "Senior Mechanical Instructor" is an Instructor. Two
 * primary kinds in one title ("Instructor Team Leader") is a question for a
 * person, so the answer is `null` rather than a guess that would price the
 * wrong reward.
 */
export function classificationFromTitle(title) {
  const text = String(title ?? '');
  if (!text.trim()) return null;
  const matches = PRIMARY_PATTERNS.filter(([, pattern]) => pattern.test(text)).map(([id]) => id);
  if (matches.length === 1) return matches[0];
  if (matches.length === 0 && SENIOR.test(text)) return 'senior';
  return null;
}

export const LOCATIONS = [
  { code: 'EG', ar: 'مصر', en: 'Egypt' },
  { code: 'KSA', ar: 'السعودية', en: 'Saudi Arabia' },
];

/** `EG`, `KSA`, or `null` for anything else — a remote or third-country role stays unlabelled. */
export function locationCode(value) {
  const text = String(value ?? '').trim().toLowerCase();
  if (!text) return null;
  if (/\b(ksa|saudi|riyadh|jeddah|dammam)\b|السعودي|الرياض|جدة/.test(text)) return 'KSA';
  if (/\b(eg|egy|egypt|cairo|giza|alexandria)\b|مصر|القاهرة|الجيزة/.test(text)) return 'EG';
  return null;
}

export function classificationLabel(id, classifications = DEFAULT_CLASSIFICATIONS, lang = 'ar') {
  const item = classifications.find((entry) => entry.id === id);
  if (!item) return '';
  return lang === 'en' ? item.en : item.ar;
}
