/**
 * Numbers, dates and money for HR V2.
 *
 * Arabic keeps its own month and currency names but Latin digits (`-u-nu-latn`)
 * — a column of salaries or SLA days must scan the same in both languages.
 */

import { useI18n } from '../../lib/i18n';
import { arabicWorkingDays, englishWorkingDays } from '@shared/recruitment/alerts';
import type { Lang, Localised } from './types';

const NUM = { ar: 'ar-EG-u-nu-latn', en: 'en-US' } as const;
const DATE = { ar: 'ar-EG-u-nu-latn', en: 'en-GB' } as const;

/** `t('عربي', 'English')` for the current language, plus `lang`, `dir` and `pick()`. */
export function useHRText() {
  const { lang, dir } = useI18n();
  const t = (ar: string, en: string) => (lang === 'en' ? en : ar);
  const pick = (value: Localised | string | null | undefined) => {
    if (!value) return '';
    if (typeof value === 'string') return value;
    return lang === 'en' ? value.en || value.ar : value.ar || value.en;
  };
  return { lang: lang as Lang, dir, t, pick };
}

export function num(value: number | null | undefined, lang: Lang, digits = 0) {
  if (value === null || value === undefined || !Number.isFinite(Number(value))) return '—';
  return new Intl.NumberFormat(NUM[lang], { maximumFractionDigits: digits }).format(Number(value));
}

export function pct(value: number | null | undefined, lang: Lang, digits = 0) {
  if (value === null || value === undefined || !Number.isFinite(Number(value))) return '—';
  return `${num(value, lang, digits)}%`;
}

export function money(value: number | null | undefined, lang: Lang, currency = 'EGP') {
  if (value === null || value === undefined || !Number.isFinite(Number(value))) return '—';
  const text = new Intl.NumberFormat(NUM[lang], { style: 'currency', currency, maximumFractionDigits: 0 }).format(Number(value));
  // Arabic formats USD as "5,351 US$", and inside right-to-left text the Latin
  // sign and the digits reorder into "$US 5,351". Isolating the amount as one
  // left-to-right run (LRI … PDI) keeps it reading "US$ 5,351" everywhere.
  return lang === 'ar' && currency !== 'EGP' ? `\u2066${text}\u2069` : text;
}

export function date(value: string | null | undefined, lang: Lang, style: 'medium' | 'short' = 'medium') {
  if (!value) return '—';
  const parsed = new Date(/^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T12:00:00` : value);
  if (Number.isNaN(parsed.getTime())) return value;
  return new Intl.DateTimeFormat(DATE[lang], style === 'short' ? { day: 'numeric', month: 'short' } : { dateStyle: 'medium' }).format(parsed);
}

export function dateTime(value: string | null | undefined, lang: Lang) {
  if (!value) return '—';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return new Intl.DateTimeFormat(DATE[lang], { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }).format(parsed);
}

export function monthLabel(period: string | null | undefined, lang: Lang) {
  if (!period) return '—';
  const parsed = new Date(`${period}-01T12:00:00`);
  return Number.isNaN(parsed.getTime()) ? period : new Intl.DateTimeFormat(DATE[lang], { month: 'long', year: 'numeric' }).format(parsed);
}

/** "4 أيام عمل" / "4 working days", with Arabic's number agreement. */
export function workingDays(count: number, lang: Lang) {
  return lang === 'en' ? englishWorkingDays(count) : arabicWorkingDays(count);
}

export function shortName(value: Localised | null | undefined, lang: Lang) {
  if (!value) return '';
  return lang === 'en' ? value.en || value.ar : value.ar || value.en;
}

export function initialsOf(name: string) {
  const words = String(name || '').trim().split(/\s+/).filter(Boolean).slice(0, 2);
  return words.map((word) => [...word][0] ?? '').join('').toUpperCase() || '؟';
}

export function currentPeriod() {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'Africa/Cairo' }).slice(0, 7);
}

export function shiftPeriod(period: string, months: number) {
  const [year, month] = period.split('-').map(Number);
  const index = year * 12 + (month - 1) + months;
  return `${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, '0')}`;
}

export function currentQuarter() {
  const period = currentPeriod();
  return `${period.slice(0, 4)}-Q${Math.floor((Number(period.slice(5, 7)) - 1) / 3) + 1}`;
}

export function shiftQuarter(quarter: string, quarters: number) {
  const [year, q] = [Number(quarter.slice(0, 4)), Number(quarter.slice(6))];
  const index = year * 4 + (q - 1) + quarters;
  return `${Math.floor(index / 4)}-Q${(index % 4) + 1}`;
}

export function quarterLabel(quarter: string, lang: Lang) {
  const q = Number(quarter.slice(6));
  const ordinal = ['الأول', 'الثاني', 'الثالث', 'الرابع'][q - 1] ?? '';
  return lang === 'en' ? `Q${q} ${quarter.slice(0, 4)}` : `الربع ${ordinal} ${quarter.slice(0, 4)}`;
}

/** Search text with Arabic letter variants, diacritics and digits folded together. */
export function normaliseSearch(value: string) {
  return String(value || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[ً-ٰٟ]/g, '')
    .replace(/[أإآ]/g, 'ا')
    .replace(/ة/g, 'ه')
    .replace(/ى/g, 'ي')
    .replace(/[٠-٩]/g, (digit) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(digit)))
    .trim();
}
