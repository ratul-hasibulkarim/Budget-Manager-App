import type { Minor } from './money';
import type { Portion, SplitSpec } from './split';

export type ProjectType = 'group' | 'personal';
export type ProjectStatus = 'active' | 'archived' | 'trashed';
export type Role = 'admin' | 'member';
/**
 * pending: asked to join, waiting for an admin.
 * active: full member.
 * left: left voluntarily (re-joins automatically with the same membership).
 * removed: removed by an admin (needs approval to come back).
 * rejected: join request was rejected (may ask again).
 */
export type MemberStatus = 'pending' | 'active' | 'left' | 'removed' | 'rejected';

/** Group projects auto-archive after this long without updates. */
export const AUTO_ARCHIVE_AFTER_MS = 90 * 24 * 60 * 60 * 1000;
/** Trashed projects are permanently deleted after this long. */
export const TRASH_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

export interface MemberProfile {
  name?: string;
  whatsapp?: string;
  bkash?: string;
  address?: string;
  /** Visible only to the member and admins. */
  nid?: string;
  bankAccount?: string;
}

export interface Member {
  userId: string;
  role: Role;
  status: MemberStatus;
  canAddExpenses: boolean;
  /** Order of first approval; decides admin succession and rounding order. Null until first approved. */
  joinIndex: number | null;
  profile: MemberProfile;
  /** Member asked to leave while having an unsettled balance. */
  leaveRequested: boolean;
}

export interface Category {
  id: string;
  name: string;
  /** Default categories carry a key used for translation. */
  key?: string;
  hidden: boolean;
}

export type ExpenseScope = 'group' | 'personal';

export interface ExpenseData {
  /** Total in minor units. */
  amount: Minor;
  categoryId: string;
  /** Calendar date of the expense, YYYY-MM-DD. */
  date: string;
  description?: string;
  note?: string;
  payerSplit: SplitSpec;
  beneficiarySplit: SplitSpec;
  /** Resolved amounts; must add up to `amount`. */
  payers: Portion[];
  beneficiaries: Portion[];
  scope: ExpenseScope;
  /** 'auto' when the app decided the scope, 'manual' when the user tapped the tag. */
  scopeSource: 'auto' | 'manual';
  receiptIds?: string[];
}

/** What a member who is not involved in a personal expense receives: only its effect on balances. */
export interface HiddenExpense {
  /** memberId -> (paid - share). Adds up to zero. */
  effect: Record<string, Minor>;
}

export type VersionKind = 'create' | 'edit' | 'override' | 'delete' | 'restore';

export interface ExpenseVersion {
  version: number;
  kind: VersionKind;
  by: string;
  at: number;
  opId: string;
  /** Null for a delete. */
  data: ExpenseData | null;
  /** Present instead of data when this viewer may not see the details. */
  hidden?: HiddenExpense;
  /** Balance effect of this version (empty for a delete). */
  effect: Record<string, Minor>;
  /** True if the edit was based on an older version (made concurrently). */
  concurrent?: boolean;
}

export interface Expense {
  id: string;
  createdBy: string;
  createdAt: number;
  versions: ExpenseVersion[];
}

export type SettlementKind = 'payment' | 'contribution';
export type PartStatus = 'pending' | 'confirmed' | 'disputed';

export interface SettlementPart {
  to: string;
  amount: Minor;
  status: PartStatus;
  comment?: string;
}

export interface Settlement {
  id: string;
  kind: SettlementKind;
  from: string;
  parts: SettlementPart[];
  method: string;
  note?: string;
  date: string;
  recordedBy: string;
  recordedAt: number;
  cancelled: boolean;
}

export interface Budget {
  total: Minor | null;
  categories: Record<string, Minor>;
}

export interface ProjectState {
  id: string;
  type: ProjectType;
  name: string;
  description?: string;
  currency: string;
  coverId?: string;
  startDate?: string;
  endDate?: string;
  links: { whatsapp?: string; telegram?: string };
  inviteCode: string | null;
  status: ProjectStatus;
  statusChangedAt: number;
  createdBy: string;
  createdAt: number;
  lastActivityAt: number;
  budget: Budget;
  members: Record<string, Member>;
  nextJoinIndex: number;
  categories: Record<string, Category>;
  categoryOrder: string[];
  expenses: Record<string, Expense>;
  expenseOrder: string[];
  settlements: Record<string, Settlement>;
  settlementOrder: string[];
}

export function currentVersion(e: Expense): ExpenseVersion {
  return e.versions[e.versions.length - 1]!;
}

export function isDeleted(e: Expense): boolean {
  return currentVersion(e).kind === 'delete';
}

export function activeMembers(state: ProjectState): Member[] {
  return membersInJoinOrder(state).filter((m) => m.status === 'active');
}

/** Members that were ever approved, in join order. */
export function membersInJoinOrder(state: ProjectState): Member[] {
  return Object.values(state.members)
    .filter((m) => m.joinIndex !== null)
    .sort((a, b) => a.joinIndex! - b.joinIndex!);
}

export function joinOrder(state: ProjectState): string[] {
  return membersInJoinOrder(state).map((m) => m.userId);
}

export function isAdmin(state: ProjectState, userId: string): boolean {
  const m = state.members[userId];
  return !!m && m.status === 'active' && m.role === 'admin';
}

export function canAddExpenses(state: ProjectState, userId: string): boolean {
  const m = state.members[userId];
  return !!m && m.status === 'active' && (m.role === 'admin' || m.canAddExpenses);
}

export function displayName(state: ProjectState, userId: string): string {
  return state.members[userId]?.profile.name?.trim() || `Member ${userId.slice(0, 4)}`;
}
