import { Alert, Platform } from 'react-native';
import { displayName, formatMoney, OpError, SplitError, toBengaliDigits, type Category, type Minor, type ProjectState } from '@bm/core';
import { CATEGORY_BN, errorKey, type Lang, type TKey } from './i18n';

const SYMBOLS: Record<string, string> = { BDT: '৳', INR: '₹', USD: '$', EUR: '€', GBP: '£' };
export const CURRENCIES = ['BDT', 'INR', 'USD', 'EUR', 'GBP'];

export function money(amount: Minor, lang: Lang, currency = 'BDT', signed = false): string {
  return formatMoney(amount, { lang, symbol: SYMBOLS[currency] ?? `${currency} `, signed });
}

export function categoryLabel(cat: Category | undefined, lang: Lang): string {
  if (!cat) return '—';
  if (lang === 'bn' && cat.key && CATEGORY_BN[cat.key]) return CATEGORY_BN[cat.key]!;
  return cat.name;
}

export function personName(state: ProjectState, userId: string, me: string, t: (k: TKey) => string): string {
  const own = state.members[userId]?.profile.name?.trim();
  if (userId === me) return own ? `${own} (${t('you')})` : t('you');
  return displayName(state, userId);
}

/** Local calendar date as YYYY-MM-DD. */
export function isoDate(d = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export function yesterdayIso(): string {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return isoDate(d);
}

export function showDate(iso: string, lang: Lang): string {
  const [y, m, d] = iso.split('-');
  const text = `${d}/${m}/${y}`;
  return lang === 'bn' ? toBengaliDigits(text) : text;
}

export function digits(n: number | string, lang: Lang): string {
  return lang === 'bn' ? toBengaliDigits(String(n)) : String(n);
}

/** Turns any thrown error into a translated message. */
export function errorText(e: unknown, t: (k: TKey) => string): string {
  if (e instanceof OpError) return t(errorKey(e.code));
  if (e instanceof SplitError) return t('err_unbalanced');
  return t('err_generic');
}

export function ask(message: string, okLabel: string, cancelLabel: string): Promise<boolean> {
  if (Platform.OS === 'web') return Promise.resolve(globalThis.confirm?.(message) ?? true);
  return new Promise((resolve) =>
    Alert.alert('', message, [
      { text: cancelLabel, style: 'cancel', onPress: () => resolve(false) },
      { text: okLabel, style: 'destructive', onPress: () => resolve(true) },
    ]),
  );
}

/** Parses a plain decimal amount ("2400" / "2,400.50") into paisa, or null. */
export function parseAmount(text: string): Minor | null {
  const clean = text.replace(/,/g, '').trim();
  if (!/^\d+(\.\d{1,2})?$/.test(clean)) return null;
  const [i, f = ''] = clean.split('.');
  const v = Number(i) * 100 + Number(f.padEnd(2, '0'));
  return Number.isSafeInteger(v) && v > 0 ? v : null;
}
