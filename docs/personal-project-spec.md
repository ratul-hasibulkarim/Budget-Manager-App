# Personal Project: Feature Spec (v1 final draft)

A private, single-user money book. It uses the same engine as the group project (offline-first, calculator, categories, version history, export) with no members and no splitting.

## 1. Creation and projects
- Name is the only required field. Optional: cover/icon, currency, starting balances.
- A user can have **several personal projects** (Daily life, Side business, Savings).
- One project can be flagged **primary**. The app opens to it, and one is created automatically at signup (the user can rename or delete it).
- **Never auto-archived.** Manual archive only.
- The project's currency is stored on the project from day one. The multi-currency UI comes later.

## 2. Accounts
- Types: Cash, bKash, Nagad, Bank, Card, Savings.
- Each account has a name, an opening balance, and an optional icon/color.
- Balance is always **calculated from entries**, never typed over.
- **Reconcile (v1):** the user enters the real balance. The app records the difference as an *adjustment* entry and keeps a reconcile history.
- Accounts can be hidden or closed without losing history.
- **Credit card:** has a statement cycle day and a due date. Its balance is a liability (money owed), shown as negative and subtracted in net worth.

## 3. Entries
- Types: **Expense, Income, Transfer.**
- Fields: amount (inline calculator, for example `250 + 80 + 40`), account, category, date, description, note, receipt, tags.
- **Split one entry across categories** (for example groceries into food, cleaning and toiletries). The parts must add up to the total.
- Multiple attachments per entry.
- Default categories for expense and income. The user can add, rename, hide and reorder.
- **Repeat last** button and **named templates** are two separate features.
- List item shows two lines: description + amount / category + account + date.
- Default date is today, with a *Yesterday* shortcut. Future dates are allowed only for scheduled items.
- Recent categories appear at the top of the picker, and favorites can be pinned.

## 4. Budgets
- Monthly budget per category, plus an optional overall budget.
- Alerts at 80% and 100%. It is a soft limit, so nothing is blocked.
- **Month-start day** is configurable (for example salary day).
- Rollover comes later.

## 5. Dashboard
- Total balance and per-account balances.
- This month's income, expense and remaining.
- Category chart, monthly trend, budget progress.
- Net worth (accounts + savings − debts − card balances).
- Date filter: this month / last month / custom.

## 6. Search, history, export
- Filter by text, category, account, tag, date, amount.
- Every edit and delete keeps a version. **Restoring creates a new entry; history is never rolled back or rewritten.**
- History appears as a timeline on the entry detail screen.
- Export to PDF, Excel/CSV or image: statement, category report, full data download.

## 7. Privacy and backup
- App lock with PIN or biometric. In v1 it applies to the whole app, and per-project comes later.
- **Hide balances** toggle: an eye icon on the total (tap or long-press). Not shake, to avoid accidental triggers.
- Fully offline. Background sync uses the same duplicate-proof, loss-proof queue as groups, so signing in on a new phone restores everything.
- **Encrypted file backup/restore** protected by a password the user chooses. The app warns that a forgotten password cannot be recovered.

## 8. Accounting rules
- Money is stored as whole integer minor units (৳2,400.00 is stored as 240000). Never floats.
- Account balance = opening balance + income − expense ± transfers ± adjustments, always recalculated.
- A transfer is always equal and opposite between two accounts.
- Entries are never overwritten. Edits and deletes create versions.
- Budget percentages are rounded for display only. Comparisons use exact values.

## 9. UX rules
- A quick-add button on every screen.
- Onboarding wizard: create an account → first entry → set a budget.
- Every empty state has a one-line call to action.

## Tiers

| Tier | Contents |
|---|---|
| **v1** | Onboarding, multiple accounts (+ credit card fields), reconcile, 3 entry types, calculator, categories, split across categories, monthly budgets and alerts, dashboard, quick-add, search, history/restore, export, app lock, hide-balances toggle, encrypted backup |
| **v1.1** | Recurring items and bill reminders/calendar, savings goals (goal-as-account), loans/debts (contact-linked), templates, subscriptions tracker, card statements, auto-categorization rules, weekly summary |
| **Later** | Rollover budgets, receipt OCR, bank/SMS import, multi-currency UI, net worth trends, debt payoff planner, investments, group-to-personal link (memo only) |

## v1.1 details (for later)
- **Recurring:** daily/weekly/monthly/yearly; auto-add or confirm first; missed occurrences are created on next open (works offline).
- **Savings goals:** a goal is a special account. Money moved into it counts as set aside, and the target and deadline show the required monthly amount.
- **Loans/debts:** each is linked to a saved contact. It tracks lent/borrowed, partial repayments, due dates and overdue flags, with a WhatsApp reminder generator.
- **Group link (later):** only a memo, such as "Cox's Bazar trip, my share 4,500", to avoid double-counting money.
