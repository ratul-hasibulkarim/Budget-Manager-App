import type { Minor } from './money';
import type {
  ExpenseData,
  HiddenExpense,
  MemberProfile,
  ProjectType,
  Role,
  SettlementKind,
} from './model';

/**
 * Every change in a project is an operation ("op"). Ops are created on the device with a unique
 * id (so retries can never create duplicates), queued while offline, and ordered by the server.
 * A project's state is always the result of applying its ops in server order.
 */
export interface OpPayloads {
  'project.create': {
    type: ProjectType;
    name: string;
    currency: string;
    description?: string;
    startDate?: string;
    endDate?: string;
    links?: { whatsapp?: string; telegram?: string };
    budgetTotal?: Minor | null;
    /** Creator's display name. */
    creatorName?: string;
  };
  'project.update': {
    name?: string;
    description?: string | null;
    startDate?: string | null;
    endDate?: string | null;
    coverId?: string | null;
    links?: { whatsapp?: string | null; telegram?: string | null };
  };
  'project.setBudget': { total: Minor | null; categories: Record<string, Minor> };
  'project.setInviteCode': { code: string | null };
  'project.archive': Record<string, never>;
  'project.unarchive': Record<string, never>;
  'project.trash': Record<string, never>;
  'project.restore': Record<string, never>;
  /** Issued only by the server when a group project has been idle too long. */
  'project.autoArchive': Record<string, never>;

  'member.requestJoin': { inviteCode: string; name?: string };
  'member.approve': { userId: string };
  'member.reject': { userId: string };
  'member.leave': Record<string, never>;
  'member.requestLeave': Record<string, never>;
  'member.cancelLeaveRequest': Record<string, never>;
  'member.approveLeave': { userId: string };
  'member.denyLeave': { userId: string };
  'member.remove': { userId: string };
  'member.setRole': { userId: string; role: Role };
  'member.setPermission': { userId: string; canAddExpenses: boolean };
  'member.updateProfile': { profile: MemberProfile };

  'category.add': { categoryId: string; name: string };
  'category.update': { categoryId: string; name?: string; hidden?: boolean };

  /** Exactly one of `data` / `hidden` is present (`hidden` only in copies sent to uninvolved members). */
  'expense.create': { expenseId: string; data?: ExpenseData; hidden?: HiddenExpense };
  'expense.update': { expenseId: string; baseVersion: number; data?: ExpenseData; hidden?: HiddenExpense };
  'expense.delete': { expenseId: string };
  'expense.restore': { expenseId: string; version: number };

  'settlement.record': {
    settlementId: string;
    kind: SettlementKind;
    from: string;
    parts: { to: string; amount: Minor }[];
    method: string;
    note?: string;
    date: string;
  };
  'settlement.respond': { settlementId: string; response: 'confirm' | 'dispute'; comment?: string };
  'settlement.cancel': { settlementId: string };
}

export type OpType = keyof OpPayloads;

export type Op<T extends OpType = OpType> = {
  [K in T]: {
    /** Unique id generated on the device. Doubles as the idempotency key. */
    id: string;
    projectId: string;
    actorId: string;
    /** Device clock when created (informational only). */
    at: number;
    type: K;
    payload: OpPayloads[K];
  };
}[T];

/** An op accepted by the server, with its position in the project's log. */
export type StoredOp<T extends OpType = OpType> = Op<T> & {
  /** 1, 2, 3 ... with no gaps, per project. */
  seq: number;
  /** Server clock when accepted. */
  serverAt: number;
};

export const SYSTEM_ACTOR = 'system';

export function makeOp<T extends OpType>(
  type: T,
  payload: OpPayloads[T],
  meta: { id: string; projectId: string; actorId: string; at: number },
): Op<T> {
  return { ...meta, type, payload } as Op<T>;
}

/** Ops that change money (shown in the activity feed). */
export const MONEY_OPS: ReadonlySet<OpType> = new Set<OpType>([
  'expense.create',
  'expense.update',
  'expense.delete',
  'expense.restore',
  'settlement.record',
  'settlement.respond',
  'settlement.cancel',
]);
