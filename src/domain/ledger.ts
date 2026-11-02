export type EntryKind = 'expense' | 'income' | 'refund' | 'transfer-in' | 'transfer-out';
export type Theme = 'system' | 'light' | 'dark';
export interface Category {
  id: string;
  name: string;
  kind: 'expense' | 'income';
  archived: boolean;
}
export interface Entry {
  id: string;
  kind: EntryKind;
  cents: number;
  date: string;
  categoryId: string | null;
  note: string;
  createdAt: number;
  originalId?: string;
  allowanceMonth?: string;
  /** Legacy backup field; ignored. Every transaction participates in balances. */
  includedInOpening?: boolean;
}
export interface Ledger {
  format: 'kwallet';
  version: 1;
  revision: number;
  initial: { date: string; budget: number; reserve: number; allowanceReceived?: boolean };
  settings: { allowance: number; theme: Theme };
  categories: Category[];
  entries: Entry[];
}
export interface MonthSummary {
  month: string;
  openingBudget: number;
  openingReserve: number;
  budget: number;
  reserve: number;
  income: number;
  expenses: number;
  refunds: number;
  transfers: number;
}
export interface BudgetSummary extends MonthSummary {
  daysLeft: number;
  dayOpening: number;
  dayAdded: number;
  daySpent: number;
  dayBudget: number;
  dayRemaining: number;
  dayOver: number;
  futureDaily: number | null;
}

export const MAX_CENTS = 1_000_000_000_000;
export const MIN_LEDGER_DATE = '2000-01-01';
export const firstLedgerDate = (ledger: Ledger) =>
  ledger.entries.reduce(
    (date, entry) => (entry.date < date ? entry.date : date),
    ledger.initial.date,
  );
export const todayLocal = () => {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
};
export const monthOf = (date: string) => date.slice(0, 7);
export function monthDays(month: string) {
  const [y, m] = month.split('-').map(Number);
  return new Date(y, m, 0).getDate();
}
export function shiftMonth(month: string, delta: number) {
  const [y, m] = month.split('-').map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}
export function isDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [y, m, d] = value.split('-').map(Number);
  return y >= 2000 && y <= 2100 && m >= 1 && m <= 12 && d >= 1 && d <= monthDays(value.slice(0, 7));
}
export function parseMoney(text: string, signed = false): number {
  const value = text.trim();
  const pattern = signed ? /^-?\d+(?:\.\d{1,2})?$/ : /^\d+(?:\.\d{1,2})?$/;
  if (!pattern.test(value)) throw new Error('请输入有效金额，最多保留两位小数');
  const negative = value.startsWith('-');
  const [whole, decimal = ''] = value.replace('-', '').split('.');
  const cents = Number(whole) * 100 + Number(decimal.padEnd(2, '0'));
  if (!Number.isSafeInteger(cents) || cents > MAX_CENTS) throw new Error('金额过大，请检查输入');
  return negative ? -cents : cents;
}
export const money = (cents: number) =>
  (cents / 100).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
export const inputMoney = (cents: number) => (cents / 100).toFixed(2);
function add(a: number, b: number) {
  const sum = a + b;
  if (!Number.isSafeInteger(sum) || Math.abs(sum) > MAX_CENTS)
    throw new Error('累计金额超过支持范围');
  return sum;
}
function amount(value: unknown, signed = false): value is number {
  return (
    typeof value === 'number' &&
    Number.isSafeInteger(value) &&
    Math.abs(value) <= MAX_CENTS &&
    (signed || value >= 0)
  );
}
const assert: (test: unknown, message: string) => asserts test = (test, message) => {
  if (!test) throw new Error(message);
};
const record = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === 'object' && !Array.isArray(v);
const idValid = (v: unknown): v is string =>
  typeof v === 'string' && v.length > 0 && v.length <= 100;

export function newLedger(
  date: string,
  budget: number,
  reserve: number,
  allowance: number,
): Ledger {
  return {
    format: 'kwallet',
    version: 1,
    revision: 0,
    initial: { date, budget, reserve },
    settings: { allowance, theme: 'system' },
    categories: [
      ...['餐饮', '交通', '购物', '娱乐', '学习', '其他'].map((name, i): Category => ({
        id: `expense-${i}`,
        name,
        kind: 'expense',
        archived: false,
      })),
      ...['生活费', '兼职', '红包', '其他收入'].map((name, i): Category => ({
        id: `income-${i}`,
        name,
        kind: 'income',
        archived: false,
      })),
    ],
    entries: [],
  };
}

/** Validate both imported data and every prospective write before committing. */
export function validateLedger(raw: unknown, today = todayLocal()): asserts raw is Ledger {
  assert(
    record(raw) && raw.format === 'kwallet' && raw.version === 1,
    '不是支持的 KWallet 备份格式',
  );
  assert(amount(raw.revision), '数据版本号无效');
  assert(
    record(raw.initial) && isDate(raw.initial.date) && raw.initial.date <= today,
    '起始日期无效或晚于今天',
  );
  assert(amount(raw.initial.budget, true) && amount(raw.initial.reserve), '起始余额无效');
  assert(
    raw.initial.allowanceReceived === undefined ||
      typeof raw.initial.allowanceReceived === 'boolean',
    '起始生活费状态无效',
  );
  assert(record(raw.settings) && amount(raw.settings.allowance), '生活费设置无效');
  assert(['system', 'light', 'dark'].includes(String(raw.settings.theme)), '主题设置无效');
  assert(Array.isArray(raw.categories) && raw.categories.length <= 200, '分类数据无效');
  const categoryIds = new Set<string>();
  for (const c of raw.categories) {
    assert(record(c) && idValid(c.id) && !categoryIds.has(c.id), '分类标识重复或无效');
    assert(
      typeof c.name === 'string' && c.name.trim().length > 0 && c.name.length <= 20,
      '分类名称无效',
    );
    assert(
      ['expense', 'income'].includes(String(c.kind)) && typeof c.archived === 'boolean',
      '分类类型无效',
    );
    categoryIds.add(c.id);
  }
  assert(Array.isArray(raw.entries) && raw.entries.length <= 100_000, '账单数据无效或过多');
  const ids = new Set<string>();
  const allowances = new Set<string>();
  for (const e of raw.entries) {
    assert(record(e) && idValid(e.id) && !ids.has(e.id), '账单标识重复或无效');
    assert(
      ['expense', 'income', 'refund', 'transfer-in', 'transfer-out'].includes(String(e.kind)),
      '账单类型无效',
    );
    assert(amount(e.cents) && e.cents > 0, '账单金额必须大于零');
    assert(isDate(e.date) && e.date <= today, '账单日期无效或晚于今天');
    assert(
      e.includedInOpening === undefined || typeof e.includedInOpening === 'boolean',
      '历史补记状态无效',
    );
    if (String(e.kind).startsWith('transfer'))
      assert(e.date >= raw.initial.date, '资金划转日期不能早于余额基准日');
    assert(Number.isSafeInteger(e.createdAt) && (e.createdAt as number) >= 0, '账单创建时间无效');
    assert(typeof e.note === 'string' && e.note.length <= 200, '备注不能超过 200 字');
    if (e.kind === 'income' || e.kind === 'expense' || e.kind === 'refund') {
      const c = raw.categories.find((item: Category) => item.id === e.categoryId);
      assert(
        c && c.kind === (e.kind === 'income' ? 'income' : 'expense'),
        '账单分类不存在或类型不符',
      );
    } else assert(e.categoryId === null, '内部划转不能设置收支分类');
    assert(
      e.kind === 'refund' ? idValid(e.originalId) : e.originalId === undefined,
      '退款关联无效',
    );
    if (e.allowanceMonth !== undefined) {
      assert(
        e.kind === 'income' &&
          e.allowanceMonth === monthOf(e.date) &&
          !allowances.has(e.allowanceMonth as string),
        '同一个月不能重复确认生活费',
      );
      allowances.add(e.allowanceMonth as string);
    }
    ids.add(e.id);
  }
  const ledger = raw as unknown as Ledger;
  const entryById = new Map(ledger.entries.map((entry) => [entry.id, entry]));
  const refunds = new Map<string, number>();
  for (const e of ledger.entries.filter((x) => x.kind === 'refund')) {
    const original = entryById.get(e.originalId!);
    assert(
      original?.kind === 'expense' &&
        original.date <= e.date &&
        original.categoryId === e.categoryId,
      '退款必须关联不晚于退款日的原支出',
    );
    const sum = add(refunds.get(original.id) || 0, e.cents);
    assert(sum <= original.cents, '累计退款不能超过原支出');
    refunds.set(original.id, sum);
  }
  // Replaying the full ledger catches edits/imports which invalidate later transfers.
  replay(ledger, today, true);
}

function replay(
  ledger: Ledger,
  date: string,
  checkTransfers = false,
): { summary: MonthSummary; dayOpening: number } {
  assert(isDate(date), '查询日期无效');
  const target = monthOf(date);
  const initialMonth = monthOf(ledger.initial.date);
  let month = monthOf(firstLedgerDate(ledger));
  if (target < month) month = target;
  let budget = 0;
  let reserve = 0;
  const entries = ledger.entries
    .filter((e) => e.date <= date)
    .sort(
      (a, b) =>
        a.date.localeCompare(b.date) || a.createdAt - b.createdAt || a.id.localeCompare(b.id),
    );
  let pointer = 0;
  let result!: MonthSummary;
  let dayOpening = budget;
  while (month <= target) {
    if (month === initialMonth) {
      budget = add(budget, ledger.initial.budget);
      reserve = add(reserve, ledger.initial.reserve);
    }
    const openingBudget = budget,
      openingReserve = reserve;
    let income = 0,
      expenses = 0,
      refunds = 0,
      transfers = 0;
    while (pointer < entries.length && monthOf(entries[pointer].date) === month) {
      const e = entries[pointer++];
      switch (e.kind) {
        case 'income':
          budget = add(budget, e.cents);
          income = add(income, e.cents);
          break;
        case 'expense':
          budget = add(budget, -e.cents);
          expenses = add(expenses, e.cents);
          break;
        case 'refund':
          budget = add(budget, e.cents);
          refunds = add(refunds, e.cents);
          break;
        case 'transfer-in':
          if (checkTransfers)
            assert(reserve >= e.cents, '历史结余不足，或修改导致后续转入金额超出结余');
          reserve = add(reserve, -e.cents);
          budget = add(budget, e.cents);
          transfers = add(transfers, e.cents);
          break;
        case 'transfer-out':
          if (checkTransfers) assert(budget >= e.cents, '本月余额不足，不能转回历史结余');
          budget = add(budget, -e.cents);
          reserve = add(reserve, e.cents);
          transfers = add(transfers, -e.cents);
          break;
      }
    }
    result = {
      month,
      openingBudget,
      openingReserve,
      budget,
      reserve,
      income,
      expenses,
      refunds,
      transfers,
    };
    if (month === target) break;
    reserve = add(reserve, Math.max(budget, 0));
    budget = Math.min(budget, 0);
    month = shiftMonth(month, 1);
  }
  const todays = entries.filter((e) => e.date === date);
  const dayDelta = todays.reduce(
    (sum, e) => add(sum, e.kind === 'expense' || e.kind === 'transfer-out' ? -e.cents : e.cents),
    0,
  );
  dayOpening = add(budget, -dayDelta);
  return { summary: result, dayOpening };
}
export function monthSummary(ledger: Ledger, month: string, through = todayLocal()): MonthSummary {
  const end = `${month}-${String(monthDays(month)).padStart(2, '0')}`;
  return replay(ledger, end < through ? end : through).summary;
}
export function budgetSummary(ledger: Ledger, date = todayLocal()): BudgetSummary {
  const { summary, dayOpening } = replay(ledger, date);
  const todays = ledger.entries.filter((e) => e.date === date);
  const dayAdded = todays
    .filter((e) => e.kind !== 'expense')
    .reduce((sum, e) => add(sum, e.kind === 'transfer-out' ? -e.cents : e.cents), 0);
  const daySpent = todays
    .filter((e) => e.kind === 'expense')
    .reduce((sum, e) => add(sum, e.cents), 0);
  const daysLeft = monthDays(monthOf(date)) - Number(date.slice(8)) + 1;
  const dayBudget = Math.floor(Math.max(add(dayOpening, dayAdded), 0) / daysLeft);
  return {
    ...summary,
    daysLeft,
    dayOpening,
    dayAdded,
    daySpent,
    dayBudget,
    dayRemaining: Math.max(dayBudget - daySpent, 0),
    dayOver: Math.max(daySpent - dayBudget, 0),
    futureDaily: daysLeft > 1 ? Math.floor(Math.max(summary.budget, 0) / (daysLeft - 1)) : null,
  };
}
export function deleteEntry(ledger: Ledger, id: string) {
  ledger.entries = ledger.entries.filter((e) => e.id !== id && e.originalId !== id);
}
export function parseBackup(text: string, today = todayLocal()): Ledger {
  if (text.length > 20_000_000) throw new Error('备份文件过大（最多 20 MB）');
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new Error('备份不是有效的 JSON 文件');
  }
  validateLedger(value, today);
  return value;
}
export const kindLabel: Record<EntryKind, string> = {
  expense: '支出',
  income: '收入',
  refund: '退款',
  'transfer-in': '结余转入',
  'transfer-out': '转回结余',
};
