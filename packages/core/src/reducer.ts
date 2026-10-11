import { isSettled } from './balances';
import { defaultCategories } from './categories';
import {
  canAddExpenses,
  currentVersion,
  isAdmin,
  joinOrder,
  type ExpenseData,
  type ExpenseVersion,
  type HiddenExpense,
  type Member,
  type MemberProfile,
  type ProjectState,
} from './model';
import { isValidAmount, sum, type Minor } from './money';
import { SYSTEM_ACTOR, type Op, type OpPayloads, type OpType } from './ops';
import { splitMembers, type Portion } from './split';
import { AUTO_ARCHIVE_AFTER_MS } from './model';

/** Why an op was refused. `code` is stable and translated in the app. */
export class OpError extends Error {
  constructor(
    public readonly code: string,
    message?: string,
  ) {
    super(message ?? code);
  }
}

export interface ApplyContext {
  /** Position in the log (provisional for ops not yet confirmed). */
  seq: number;
  /** Server time of acceptance (device time for ops not yet confirmed). */
  serverAt: number;
}

function fail(code: string, message?: string): never {
  throw new OpError(code, message);
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
export function isValidDate(s: unknown): s is string {
  if (typeof s !== 'string' || !DATE_RE.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

function checkText(value: unknown, max: number, field: string, required = false): void {
  if (value === undefined || value === null) {
    if (required) fail('invalid', `${field} is required`);
    return;
  }
  if (typeof value !== 'string' || value.length > max) fail('invalid', `${field} is too long`);
  if (required && !value.trim()) fail('invalid', `${field} is required`);
}

const CURRENCY_RE = /^[A-Z]{3}$/;
const INVITE_RE = /^[A-Z0-9]{6,12}$/;
const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

// ---------------------------------------------------------------------------------------------

/**
 * Applies one op to a project's state, or throws OpError without changing anything.
 * Every handler validates first and only then mutates, so a refused op leaves state untouched.
 * Pass `null` state only for 'project.create'. Returns the (same, mutated) state object.
 */
export function applyOp(state: ProjectState | null, op: Op, ctx: ApplyContext): ProjectState {
  if (op.type === 'project.create') {
    if (state) fail('exists', 'Project already exists');
    return createProject(op as Op<'project.create'>, ctx);
  }
  if (!state) fail('not_found', 'Project does not exist');
  if (op.projectId !== state.id) fail('invalid', 'Wrong project');

  const handler = handlers[op.type] as Handler<OpType> | undefined;
  if (!handler) fail('invalid', `Unknown operation ${op.type}`);

  if (op.type !== 'member.requestJoin' && op.actorId !== SYSTEM_ACTOR) {
    const actor = state.members[op.actorId];
    if (!actor || actor.status !== 'active') fail('not_member', 'You are not a member of this project');
  }
  if (state.status !== 'active' && !READ_ONLY_ALLOWED.has(op.type)) {
    fail('read_only', 'This project is archived or in the trash');
  }
  if (state.type === 'personal' && GROUP_ONLY.has(op.type)) fail('group_only', 'Only available in group projects');

  handler(state, op.payload as never, op.actorId, ctx, op);
  if (op.actorId !== SYSTEM_ACTOR) state.lastActivityAt = ctx.serverAt;
  return state;
}

const READ_ONLY_ALLOWED: ReadonlySet<OpType> = new Set<OpType>(['project.unarchive', 'project.restore', 'project.trash']);
const GROUP_ONLY: ReadonlySet<OpType> = new Set<OpType>([
  'project.setInviteCode',
  'project.autoArchive',
  'member.requestJoin',
  'member.approve',
  'member.reject',
  'member.leave',
  'member.requestLeave',
  'member.cancelLeaveRequest',
  'member.approveLeave',
  'member.denyLeave',
  'member.remove',
  'member.setRole',
  'member.setPermission',
  'settlement.record',
  'settlement.respond',
  'settlement.cancel',
]);

type Handler<T extends OpType> = (
  state: ProjectState,
  payload: OpPayloads[T],
  actorId: string,
  ctx: ApplyContext,
  op: Op,
) => void;

function requireAdmin(state: ProjectState, actorId: string) {
  if (!isAdmin(state, actorId)) fail('not_admin', 'Only an admin can do this');
}

function requireMember(state: ProjectState, userId: string): Member {
  const m = state.members[userId];
  if (!m) fail('no_such_member', 'No such member');
  return m;
}

function validateProfile(profile: MemberProfile) {
  if (typeof profile !== 'object' || profile === null) fail('invalid', 'Bad profile');
  for (const key of Object.keys(profile)) {
    if (!['name', 'whatsapp', 'bkash', 'address', 'nid', 'bankAccount'].includes(key)) fail('invalid', `Unknown field ${key}`);
    checkText((profile as Record<string, unknown>)[key], key === 'address' ? 300 : 100, key);
  }
}

function cleanProfile(profile: MemberProfile): MemberProfile {
  const out: MemberProfile = {};
  for (const [k, v] of Object.entries(profile)) if (typeof v === 'string' && v.trim()) (out as Record<string, string>)[k] = v.trim();
  return out;
}

/** If no active admin is left, the earliest-joined active member becomes admin. */
function ensureAdmin(state: ProjectState) {
  const active = Object.values(state.members)
    .filter((m) => m.status === 'active' && m.joinIndex !== null)
    .sort((a, b) => a.joinIndex! - b.joinIndex!);
  if (active.length && !active.some((m) => m.role === 'admin')) active[0]!.role = 'admin';
}

function createProject(op: Op<'project.create'>, ctx: ApplyContext): ProjectState {
  const p = op.payload;
  if (!ID_RE.test(op.projectId)) fail('invalid', 'Bad project id');
  if (p.type !== 'group' && p.type !== 'personal') fail('invalid', 'Bad project type');
  checkText(p.name, 100, 'Name', true);
  if (!CURRENCY_RE.test(p.currency)) fail('invalid', 'Bad currency');
  checkText(p.description, 1000, 'Description');
  checkText(p.creatorName, 100, 'Name');
  if (p.startDate !== undefined && !isValidDate(p.startDate)) fail('invalid', 'Bad start date');
  if (p.endDate !== undefined && !isValidDate(p.endDate)) fail('invalid', 'Bad end date');
  if (p.budgetTotal != null && !isValidAmount(p.budgetTotal)) fail('invalid', 'Bad budget');
  checkText(p.links?.whatsapp, 300, 'WhatsApp link');
  checkText(p.links?.telegram, 300, 'Telegram link');

  const { categories, order } = defaultCategories();
  const creator: Member = {
    userId: op.actorId,
    role: 'admin',
    status: 'active',
    canAddExpenses: true,
    joinIndex: 0,
    profile: p.creatorName?.trim() ? { name: p.creatorName.trim() } : {},
    leaveRequested: false,
  };
  return {
    id: op.projectId,
    type: p.type,
    name: p.name.trim(),
    description: p.description?.trim() || undefined,
    currency: p.currency,
    startDate: p.startDate,
    endDate: p.endDate,
    links: { whatsapp: p.links?.whatsapp || undefined, telegram: p.links?.telegram || undefined },
    inviteCode: null,
    status: 'active',
    statusChangedAt: ctx.serverAt,
    createdBy: op.actorId,
    createdAt: ctx.serverAt,
    lastActivityAt: ctx.serverAt,
    budget: { total: p.budgetTotal ?? null, categories: {} },
    members: { [op.actorId]: creator },
    nextJoinIndex: 1,
    categories,
    categoryOrder: order,
    expenses: {},
    expenseOrder: [],
    settlements: {},
    settlementOrder: [],
  };
}

// ----- Expenses ------------------------------------------------------------------------------

export function effectOf(data: ExpenseData): Record<string, Minor> {
  const effect: Record<string, Minor> = {};
  for (const p of data.payers) effect[p.memberId] = (effect[p.memberId] ?? 0) + p.amount;
  for (const b of data.beneficiaries) effect[b.memberId] = (effect[b.memberId] ?? 0) - b.amount;
  for (const k of Object.keys(effect)) if (effect[k] === 0) delete effect[k];
  return effect;
}

export function participantsOf(data: ExpenseData): Set<string> {
  return new Set([...data.payers.map((p) => p.memberId), ...data.beneficiaries.map((b) => b.memberId)]);
}

function validatePortions(portions: Portion[], total: Minor, label: string, allowed: (id: string) => boolean, specIds: string[]) {
  if (!Array.isArray(portions) || portions.length === 0) fail('invalid', `Choose who ${label}`);
  const seen = new Set<string>();
  const specSet = new Set(specIds);
  for (const p of portions) {
    if (!p || typeof p.memberId !== 'string' || !isValidAmount(p.amount)) fail('invalid', `Bad amount in ${label}`);
    if (seen.has(p.memberId)) fail('invalid', 'A person is listed twice');
    seen.add(p.memberId);
    if (!specSet.has(p.memberId)) fail('invalid', `Split does not match ${label}`);
    if (!allowed(p.memberId)) fail('bad_participant', 'Someone in this expense is not a member');
  }
  if (sum(portions.map((p) => p.amount)) !== total) fail('unbalanced', `The ${label} amounts must add up to the total`);
}

function validateExpenseData(state: ProjectState, data: ExpenseData, allowedExtra: Set<string>) {
  if (typeof data !== 'object' || data === null) fail('invalid', 'Missing expense details');
  if (!isValidAmount(data.amount)) fail('invalid', 'Amount must be more than zero');
  if (!state.categories[data.categoryId]) fail('invalid', 'Unknown category');
  if (!isValidDate(data.date)) fail('invalid', 'Bad date');
  checkText(data.description, 200, 'Description');
  checkText(data.note, 2000, 'Note');
  if (data.scope !== 'group' && data.scope !== 'personal') fail('invalid', 'Bad scope');
  if (data.scopeSource !== 'auto' && data.scopeSource !== 'manual') fail('invalid', 'Bad scope source');
  if (data.receiptIds !== undefined && (!Array.isArray(data.receiptIds) || data.receiptIds.length > 10)) fail('invalid', 'Too many receipts');
  const allowed = (id: string) => {
    if (state.type === 'personal') return id === state.createdBy;
    return state.members[id]?.status === 'active' || allowedExtra.has(id);
  };
  validatePortions(data.payers, data.amount, 'paid', allowed, splitMembers(data.payerSplit));
  validatePortions(data.beneficiaries, data.amount, 'benefited', allowed, splitMembers(data.beneficiarySplit));
}

function validateHidden(state: ProjectState, hidden: HiddenExpense) {
  if (typeof hidden !== 'object' || hidden === null || typeof hidden.effect !== 'object') fail('invalid', 'Bad hidden expense');
  let total = 0;
  for (const [id, v] of Object.entries(hidden.effect)) {
    if (!state.members[id] || !Number.isSafeInteger(v)) fail('invalid', 'Bad hidden expense');
    total += v;
  }
  if (total !== 0) fail('unbalanced', 'Hidden expense does not balance');
}

function versionBody(state: ProjectState, payload: { data?: ExpenseData; hidden?: HiddenExpense }, allowedExtra: Set<string>) {
  if (payload.data && payload.hidden) fail('invalid', 'Both data and hidden');
  if (payload.data) {
    validateExpenseData(state, payload.data, allowedExtra);
    return { data: payload.data, effect: effectOf(payload.data) };
  }
  if (payload.hidden) {
    validateHidden(state, payload.hidden);
    return { data: null, hidden: payload.hidden, effect: { ...payload.hidden.effect } };
  }
  fail('invalid', 'Missing expense details');
}

function canEditOwn(state: ProjectState, actorId: string, createdBy: string) {
  return actorId === createdBy && canAddExpenses(state, actorId);
}

function pushVersion(state: ProjectState, expenseId: string, v: Omit<ExpenseVersion, 'version'>) {
  const e = state.expenses[expenseId]!;
  e.versions.push({ ...v, version: e.versions.length + 1 });
}

// ----- Handlers ------------------------------------------------------------------------------

const handlers: { [K in OpType]?: Handler<K> } = {
  'project.update'(state, p, actor) {
    requireAdmin(state, actor);
    if (p.name !== undefined) checkText(p.name, 100, 'Name', true);
    checkText(p.description, 1000, 'Description');
    if (p.startDate != null && !isValidDate(p.startDate)) fail('invalid', 'Bad start date');
    if (p.endDate != null && !isValidDate(p.endDate)) fail('invalid', 'Bad end date');
    checkText(p.coverId, 100, 'Cover');
    checkText(p.links?.whatsapp, 300, 'WhatsApp link');
    checkText(p.links?.telegram, 300, 'Telegram link');
    if (p.name !== undefined) state.name = p.name.trim();
    if (p.description !== undefined) state.description = p.description?.trim() || undefined;
    if (p.startDate !== undefined) state.startDate = p.startDate ?? undefined;
    if (p.endDate !== undefined) state.endDate = p.endDate ?? undefined;
    if (p.coverId !== undefined) state.coverId = p.coverId ?? undefined;
    if (p.links) {
      if (p.links.whatsapp !== undefined) state.links.whatsapp = p.links.whatsapp?.trim() || undefined;
      if (p.links.telegram !== undefined) state.links.telegram = p.links.telegram?.trim() || undefined;
    }
  },
  'project.setBudget'(state, p, actor) {
    requireAdmin(state, actor);
    if (p.total !== null && !isValidAmount(p.total)) fail('invalid', 'Bad budget');
    if (typeof p.categories !== 'object' || p.categories === null) fail('invalid', 'Bad budget');
    for (const [cat, v] of Object.entries(p.categories)) {
      if (!state.categories[cat]) fail('invalid', 'Unknown category');
      if (!isValidAmount(v)) fail('invalid', 'Bad budget');
    }
    state.budget = { total: p.total, categories: { ...p.categories } };
  },
  'project.setInviteCode'(state, p, actor) {
    requireAdmin(state, actor);
    if (p.code !== null && !INVITE_RE.test(p.code)) fail('invalid', 'Bad invite code');
    state.inviteCode = p.code;
  },
  'project.archive'(state, _p, actor, ctx) {
    requireAdmin(state, actor);
    state.status = 'archived';
    state.statusChangedAt = ctx.serverAt;
  },
  'project.unarchive'(state, _p, actor, ctx) {
    requireAdmin(state, actor);
    if (state.status !== 'archived') fail('invalid', 'Project is not archived');
    state.status = 'active';
    state.statusChangedAt = ctx.serverAt;
  },
  'project.trash'(state, _p, actor, ctx) {
    requireAdmin(state, actor);
    if (state.status === 'trashed') fail('invalid', 'Already in trash');
    state.status = 'trashed';
    state.statusChangedAt = ctx.serverAt;
  },
  'project.restore'(state, _p, actor, ctx) {
    requireAdmin(state, actor);
    if (state.status !== 'trashed') fail('invalid', 'Project is not in the trash');
    state.status = 'active';
    state.statusChangedAt = ctx.serverAt;
  },
  'project.autoArchive'(state, _p, actor, ctx) {
    if (actor !== SYSTEM_ACTOR) fail('forbidden', 'Only the server can auto-archive');
    if (ctx.serverAt - state.lastActivityAt < AUTO_ARCHIVE_AFTER_MS) fail('invalid', 'Project is still in use');
    state.status = 'archived';
    state.statusChangedAt = ctx.serverAt;
  },

  // ----- Members -----
  'member.requestJoin'(state, p, actor) {
    if (actor === SYSTEM_ACTOR || !ID_RE.test(actor)) fail('invalid', 'Bad user');
    if (!state.inviteCode || p.inviteCode !== state.inviteCode) fail('bad_invite', 'This invite link is not valid');
    checkText(p.name, 100, 'Name');
    const existing = state.members[actor];
    if (existing?.status === 'active') fail('already_member', 'You are already a member');
    if (existing?.status === 'pending') fail('already_pending', 'Your request is waiting for approval');
    if (existing?.status === 'left') {
      // Left voluntarily: re-joins automatically with the same membership and entries.
      existing.status = 'active';
      existing.leaveRequested = false;
      return;
    }
    if (existing) {
      // Removed by an admin, or previously rejected: needs approval again.
      existing.status = 'pending';
      if (p.name?.trim() && !existing.profile.name) existing.profile.name = p.name.trim();
      return;
    }
    state.members[actor] = {
      userId: actor,
      role: 'member',
      status: 'pending',
      canAddExpenses: false,
      joinIndex: null,
      profile: p.name?.trim() ? { name: p.name.trim() } : {},
      leaveRequested: false,
    };
  },
  'member.approve'(state, p, actor) {
    requireAdmin(state, actor);
    const m = requireMember(state, p.userId);
    if (m.status !== 'pending') fail('invalid', 'No pending request');
    m.status = 'active';
    m.role = 'member';
    if (m.joinIndex === null) m.joinIndex = state.nextJoinIndex++;
  },
  'member.reject'(state, p, actor) {
    requireAdmin(state, actor);
    const m = requireMember(state, p.userId);
    if (m.status !== 'pending') fail('invalid', 'No pending request');
    m.status = m.joinIndex === null ? 'rejected' : 'removed';
  },
  'member.leave'(state, _p, actor) {
    if (!isSettled(state, actor)) fail('unsettled', 'Settle your balance first, or ask an admin to approve leaving');
    leave(state, actor);
  },
  'member.requestLeave'(state, _p, actor) {
    if (isSettled(state, actor)) fail('settled', 'Your balance is settled; you can leave directly');
    state.members[actor]!.leaveRequested = true;
  },
  'member.cancelLeaveRequest'(state, _p, actor) {
    const m = state.members[actor]!;
    if (!m.leaveRequested) fail('invalid', 'No leave request');
    m.leaveRequested = false;
  },
  'member.approveLeave'(state, p, actor) {
    requireAdmin(state, actor);
    if (p.userId === actor) fail('forbidden', 'Another admin must approve your request');
    const m = requireMember(state, p.userId);
    if (m.status !== 'active' || !m.leaveRequested) fail('invalid', 'No leave request');
    leave(state, p.userId);
  },
  'member.denyLeave'(state, p, actor) {
    requireAdmin(state, actor);
    const m = requireMember(state, p.userId);
    if (!m.leaveRequested) fail('invalid', 'No leave request');
    m.leaveRequested = false;
  },
  'member.remove'(state, p, actor) {
    requireAdmin(state, actor);
    if (p.userId === actor) fail('invalid', 'Use leave instead');
    if (p.userId === state.createdBy) fail('forbidden', 'The creator cannot be removed');
    const m = requireMember(state, p.userId);
    if (m.status !== 'active') fail('invalid', 'Not an active member');
    m.status = 'removed';
    m.role = 'member';
    m.leaveRequested = false;
    ensureAdmin(state);
  },
  'member.setRole'(state, p, actor) {
    requireAdmin(state, actor);
    if (p.role !== 'admin' && p.role !== 'member') fail('invalid', 'Bad role');
    const m = requireMember(state, p.userId);
    if (m.status !== 'active') fail('invalid', 'Not an active member');
    if (p.role === 'member') {
      if (p.userId === state.createdBy && actor !== state.createdBy) fail('forbidden', 'The creator cannot be demoted');
      const admins = Object.values(state.members).filter((x) => x.status === 'active' && x.role === 'admin');
      if (admins.length === 1 && admins[0]!.userId === p.userId) fail('last_admin', 'Make someone else admin first');
    }
    m.role = p.role;
  },
  'member.setPermission'(state, p, actor) {
    requireAdmin(state, actor);
    if (typeof p.canAddExpenses !== 'boolean') fail('invalid', 'Bad permission');
    const m = requireMember(state, p.userId);
    if (m.status !== 'active') fail('invalid', 'Not an active member');
    m.canAddExpenses = p.canAddExpenses;
  },
  'member.updateProfile'(state, p, actor) {
    validateProfile(p.profile);
    state.members[actor]!.profile = cleanProfile(p.profile);
  },

  // ----- Categories -----
  'category.add'(state, p, actor) {
    if (!canAddExpenses(state, actor)) fail('no_permission', 'You do not have permission to add expenses');
    if (!ID_RE.test(p.categoryId)) fail('invalid', 'Bad category id');
    if (state.categories[p.categoryId]) fail('exists', 'Category already exists');
    checkText(p.name, 50, 'Category name', true);
    const name = p.name.trim();
    if (Object.values(state.categories).some((c) => !c.hidden && c.name.toLowerCase() === name.toLowerCase())) {
      fail('exists', 'A category with this name already exists');
    }
    state.categories[p.categoryId] = { id: p.categoryId, name, hidden: false };
    state.categoryOrder.push(p.categoryId);
  },
  'category.update'(state, p, actor) {
    requireAdmin(state, actor);
    const c = state.categories[p.categoryId];
    if (!c) fail('invalid', 'Unknown category');
    if (p.name !== undefined) checkText(p.name, 50, 'Category name', true);
    if (p.hidden !== undefined && typeof p.hidden !== 'boolean') fail('invalid', 'Bad value');
    if (p.name !== undefined) {
      c.name = p.name.trim();
      delete c.key; // renamed: no longer the translated default
    }
    if (p.hidden !== undefined) c.hidden = p.hidden;
  },

  // ----- Expenses -----
  'expense.create'(state, p, actor, ctx, op) {
    if (!canAddExpenses(state, actor)) fail('no_permission', 'You do not have permission to add expenses');
    if (!ID_RE.test(p.expenseId)) fail('invalid', 'Bad expense id');
    if (state.expenses[p.expenseId]) fail('exists', 'Expense already exists');
    const body = versionBody(state, p, new Set());
    state.expenses[p.expenseId] = { id: p.expenseId, createdBy: actor, createdAt: ctx.serverAt, versions: [] };
    state.expenseOrder.push(p.expenseId);
    pushVersion(state, p.expenseId, { kind: 'create', by: actor, at: ctx.serverAt, opId: op.id, ...body });
  },
  'expense.update'(state, p, actor, ctx, op) {
    const e = state.expenses[p.expenseId];
    if (!e) fail('not_found', 'Expense not found');
    const cur = currentVersion(e);
    if (cur.kind === 'delete') fail('deleted', 'Restore the expense before editing it');
    const own = canEditOwn(state, actor, e.createdBy);
    if (!own && !isAdmin(state, actor)) fail('not_owner', 'You can only edit your own entries');
    // People already in the expense may stay in it even if they have since left.
    const previous = cur.data ? participantsOf(cur.data) : new Set(Object.keys(cur.effect));
    const body = versionBody(state, p, previous);
    pushVersion(state, p.expenseId, {
      kind: own ? 'edit' : 'override',
      by: actor,
      at: ctx.serverAt,
      opId: op.id,
      concurrent: p.baseVersion !== cur.version ? true : undefined,
      ...body,
    });
  },
  'expense.delete'(state, p, actor, ctx, op) {
    const e = state.expenses[p.expenseId];
    if (!e) fail('not_found', 'Expense not found');
    if (currentVersion(e).kind === 'delete') fail('deleted', 'Already deleted');
    if (!canEditOwn(state, actor, e.createdBy) && !isAdmin(state, actor)) fail('not_owner', 'You can only delete your own entries');
    pushVersion(state, p.expenseId, { kind: 'delete', by: actor, at: ctx.serverAt, opId: op.id, data: null, effect: {} });
  },
  'expense.restore'(state, p, actor, ctx, op) {
    const e = state.expenses[p.expenseId];
    if (!e) fail('not_found', 'Expense not found');
    if (!canEditOwn(state, actor, e.createdBy) && !isAdmin(state, actor)) fail('not_owner', 'Only the creator or an admin can restore');
    const target = e.versions.find((v) => v.version === p.version);
    if (!target || target.kind === 'delete') fail('invalid', 'Nothing to restore in that version');
    if (target.version === currentVersion(e).version) fail('invalid', 'That is already the current version');
    pushVersion(state, p.expenseId, {
      kind: 'restore',
      by: actor,
      at: ctx.serverAt,
      opId: op.id,
      data: target.data,
      hidden: target.hidden,
      effect: { ...target.effect },
    });
  },

  // ----- Settlements -----
  'settlement.record'(state, p, actor, ctx) {
    if (!ID_RE.test(p.settlementId)) fail('invalid', 'Bad id');
    if (state.settlements[p.settlementId]) fail('exists', 'Already recorded');
    if (p.kind !== 'payment' && p.kind !== 'contribution') fail('invalid', 'Bad kind');
    if (!isValidDate(p.date)) fail('invalid', 'Bad date');
    checkText(p.method, 50, 'Method', true);
    checkText(p.note, 500, 'Note');
    const everJoined = (id: string) => state.members[id]?.joinIndex != null;
    if (!everJoined(p.from)) fail('bad_participant', 'Payer is not a member');
    if (!Array.isArray(p.parts) || p.parts.length === 0 || p.parts.length > 50) fail('invalid', 'Choose who receives the money');
    const seen = new Set<string>();
    for (const part of p.parts) {
      if (!part || !everJoined(part.to)) fail('bad_participant', 'Receiver is not a member');
      if (part.to === p.from) fail('invalid', 'Cannot pay yourself');
      if (seen.has(part.to)) fail('invalid', 'A person is listed twice');
      if (!isValidAmount(part.amount)) fail('invalid', 'Amount must be more than zero');
      seen.add(part.to);
    }
    if (actor !== p.from && !seen.has(actor) && !isAdmin(state, actor)) {
      fail('forbidden', 'Only the payer, a receiver or an admin can record this');
    }
    state.settlements[p.settlementId] = {
      id: p.settlementId,
      kind: p.kind,
      from: p.from,
      parts: p.parts.map((part) => ({
        to: part.to,
        amount: part.amount,
        // A receiver recording money they got confirms their own part.
        status: part.to === actor ? 'confirmed' : 'pending',
      })),
      method: p.method.trim(),
      note: p.note?.trim() || undefined,
      date: p.date,
      recordedBy: actor,
      recordedAt: ctx.serverAt,
      cancelled: false,
    };
    state.settlementOrder.push(p.settlementId);
  },
  'settlement.respond'(state, p, actor) {
    const s = state.settlements[p.settlementId];
    if (!s || s.cancelled) fail('not_found', 'Payment not found');
    const part = s.parts.find((x) => x.to === actor);
    if (!part) fail('forbidden', 'Only the receiver can confirm');
    if (p.response !== 'confirm' && p.response !== 'dispute') fail('invalid', 'Bad response');
    checkText(p.comment, 500, 'Comment');
    if (part.status === 'confirmed') fail('invalid', 'Already confirmed');
    if (p.response === 'dispute' && part.status === 'disputed') fail('invalid', 'Already disputed');
    part.status = p.response === 'confirm' ? 'confirmed' : 'disputed';
    part.comment = p.comment?.trim() || undefined;
  },
  'settlement.cancel'(state, p, actor) {
    const s = state.settlements[p.settlementId];
    if (!s || s.cancelled) fail('not_found', 'Payment not found');
    if (actor !== s.recordedBy && actor !== s.from && !isAdmin(state, actor)) fail('forbidden', 'Not allowed');
    if (s.parts.some((x) => x.status === 'confirmed')) fail('confirmed', 'A confirmed payment cannot be cancelled; record a payment back instead');
    s.cancelled = true;
  },
};

function leave(state: ProjectState, userId: string) {
  const m = state.members[userId]!;
  m.status = 'left';
  m.role = 'member';
  m.leaveRequested = false;
  ensureAdmin(state);
}

/** Folds a list of stored ops into state. Throws if any op is invalid (the log is corrupt). */
export function replay(ops: readonly (Op & { seq: number; serverAt: number })[]): ProjectState | null {
  let state: ProjectState | null = null;
  for (const op of ops) state = applyOp(state, op, { seq: op.seq, serverAt: op.serverAt });
  return state;
}

/** Deep copy of plain JSON state (used for optimistic views). */
export function cloneState(state: ProjectState): ProjectState {
  return JSON.parse(JSON.stringify(state)) as ProjectState;
}

/** Auto-decided scope: group when more than half of active members benefit. */
export function autoScope(state: ProjectState, beneficiaryIds: string[]): 'group' | 'personal' {
  if (state.type === 'personal') return 'group';
  const active = Object.values(state.members).filter((m) => m.status === 'active').length;
  return beneficiaryIds.length * 2 > active ? 'group' : 'personal';
}

export { joinOrder };
