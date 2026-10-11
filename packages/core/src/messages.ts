import { currentVersion, displayName, type ProjectState } from './model';
import { formatMoney, type Minor } from './money';
import type { Transfer } from './balances';

/** Ready-to-send reminder text for WhatsApp/Telegram. */
export function reminderMessage(
  state: ProjectState,
  t: Transfer,
  lang: 'en' | 'bn',
): string {
  const from = displayName(state, t.from);
  const to = displayName(state, t.to);
  const amount = formatMoney(t.amount, { lang });
  return lang === 'bn'
    ? `${from}, "${state.name}" প্রজেক্টে ${to}-কে ${amount} দিতে হবে।`
    : `${from}, you owe ${to} ${amount} for "${state.name}".`;
}

/** Summary of all suggested payments, for posting in the group chat. */
export function settlementSummaryMessage(state: ProjectState, transfers: Transfer[], lang: 'en' | 'bn'): string {
  const header = lang === 'bn' ? `"${state.name}" — হিসাব মেটানো:` : `"${state.name}" — settle up:`;
  if (transfers.length === 0) return `${header}\n${lang === 'bn' ? 'সবার হিসাব মিলে গেছে ✅' : 'Everyone is settled ✅'}`;
  const lines = transfers.map(
    (t) => `• ${displayName(state, t.from)} → ${displayName(state, t.to)}: ${formatMoney(t.amount, { lang })}`,
  );
  return [header, ...lines].join('\n');
}

/** Link that opens WhatsApp with the message filled in (optionally to a specific number). */
export function whatsappLink(text: string, phone?: string): string {
  const digits = phone?.replace(/[^0-9]/g, '') ?? '';
  return `https://wa.me/${digits}?text=${encodeURIComponent(text)}`;
}

function csvCell(v: string | number): string {
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

const plain = (a: Minor) => (a / 100).toFixed(2);

/** CSV of all expenses the viewer can see (deleted ones excluded). */
export function expensesCsv(state: ProjectState): string {
  const rows: (string | number)[][] = [['Date', 'Description', 'Category', 'Amount', 'Type', 'Paid by', 'Shared by', 'Note']];
  for (const id of state.expenseOrder) {
    const data = currentVersion(state.expenses[id]!).data;
    if (!data) continue;
    const who = (ps: { memberId: string; amount: Minor }[]) =>
      ps.map((p) => `${displayName(state, p.memberId)} (${plain(p.amount)})`).join('; ');
    rows.push([
      data.date,
      data.description ?? '',
      state.categories[data.categoryId]?.name ?? data.categoryId,
      plain(data.amount),
      data.scope,
      who(data.payers),
      who(data.beneficiaries),
      data.note ?? '',
    ]);
  }
  return rows.map((r) => r.map(csvCell).join(',')).join('\n');
}
