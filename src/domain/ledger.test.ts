import { describe, expect, it } from 'vitest';
import {
  budgetSummary,
  entryBalances,
  ensureLifeCategory,
  installmentSchedule,
  convertToInstallments,
  confirmInstallment,
  deleteEntry,
  initialAllowanceEntry,
  isDate,
  monthSummary,
  newLedger,
  parseBackup,
  parseMoney,
  shiftMonth,
  validateLedger,
  type Entry,
  type Ledger,
} from './ledger';

let next = 0;
const at = '2026-12-31';
function entry(
  kind: Entry['kind'],
  cents: number,
  date: string,
  extra: Partial<Entry> = {},
): Entry {
  return {
    id: `entry-${++next}`,
    kind,
    cents,
    date,
    note: '',
    createdAt: next,
    categoryId: kind === 'income' ? 'income-0' : kind.startsWith('transfer') ? null : 'expense-0',
    ...extra,
  };
}
function check(ledger: Ledger) {
  validateLedger(ledger, at);
  return ledger;
}

describe('integer money and calendar validation', () => {
  it.each([
    ['0', 0],
    ['12.3', 1230],
    ['0.01', 1],
    ['002.00', 200],
  ])('parses %s exactly', (text, cents) => expect(parseMoney(text)).toBe(cents));
  it('supports a signed initial deficit', () => expect(parseMoney('-200.01', true)).toBe(-20001));
  it.each(['', '1.001', '1e3', 'Infinity', '-1', '0x10', '1,000', '9007199254740993'])(
    'rejects %s',
    (text) => expect(() => parseMoney(text)).toThrow(),
  );
  it('validates leap days and shifts years', () => {
    expect(isDate('2024-02-29')).toBe(true);
    expect(isDate('2025-02-29')).toBe(false);
    expect(isDate('2026-13-01')).toBe(false);
    expect(shiftMonth('2026-12', 1)).toBe('2027-01');
  });
});
describe('monthly rollover and daily allocation', () => {
  it('splits cents and clamps month end without changing the original billing day', () => {
    expect(installmentSchedule(10000, 3, '2026-01-31')).toEqual([
      { dueDate: '2026-01-31', cents: 3333 },
      { dueDate: '2026-02-28', cents: 3333 },
      { dueDate: '2026-03-31', cents: 3334 },
    ]);
  });
  it('converts a purchase and only counts manually confirmed payments', () => {
    const l = newLedger('2026-11-01', 150000, 0, 0);
    const purchase = entry('expense', 120000, '2026-11-02');
    l.entries.push(purchase);
    const plan = { id: 'plan', categoryId: 'expense-0', note: '', principal: 120000, fee: 0, periods: installmentSchedule(120000, 3, '2026-11-02') };
    convertToInstallments(l, purchase.id, plan, false);
    expect(budgetSummary(l, '2026-11-02').budget).toBe(150000);
    const payment = entry('expense', 41000, '2026-11-03');
    confirmInstallment(l, 'plan', 0, payment);
    expect(budgetSummary(l, '2026-11-03').budget).toBe(109000);
    expect(() => confirmInstallment(l, 'plan', 0, entry('expense', 40000, '2026-11-04'))).toThrow('已确认');
    validateLedger(l, at);
    expect(parseBackup(JSON.stringify(l), at).installments).toEqual(l.installments);
  });
  it('converts a previously paid first installment without charging the purchase twice', () => {
    const l = newLedger('2026-11-01', 150000, 0, 0);
    const purchase = entry('expense', 120000, '2026-11-02');
    l.entries.push(purchase);
    convertToInstallments(l, purchase.id, { id: 'p', categoryId: 'expense-0', note: '', principal: 120000, fee: 0, periods: installmentSchedule(120000, 3, '2026-11-02') }, true);
    expect(l.entries).toHaveLength(1);
    expect(budgetSummary(l, '2026-11-02').budget).toBe(110000);
    validateLedger(l, at);
  });
  it('replays each expense in order with income, refunds and rollover', () => {
    const l = newLedger('2026-11-01', 10000, 0, 0);
    const first = entry('expense', 2000, '2026-11-02');
    const refund = entry('refund', 500, '2026-11-03', { originalId: first.id });
    const second = entry('expense', 1500, '2026-11-03');
    const next = entry('expense', 1000, '2026-12-01');
    l.entries.push(second, next, refund, first);
    const balances = entryBalances(l);
    expect(balances.get(first.id)).toBe(8000);
    expect(balances.get(second.id)).toBe(7000);
    expect(balances.get(next.id)).toBe(-1000);
    expect(balances.get(next.id)).toBe(budgetSummary(l, '2026-12-01').budget);
  });
  it('adds life without changing existing or archived categories', () => {
    const l = newLedger('2026-11-01', 0, 0, 0);
    l.categories = l.categories.filter(c => c.name !== '生活');
    const ids = l.categories.map(c => c.id);
    expect(ensureLifeCategory(l)).toBe(true);
    expect(l.categories.slice(0, ids.length).map(c => c.id)).toEqual(ids);
    l.categories.find(c => c.name === '生活')!.archived = true;
    expect(ensureLifeCategory(l)).toBe(false);
    expect(l.categories.find(c => c.name === '生活')!.archived).toBe(true);
  });
  it('restores missing default expense categories without replacing archived or conflicting IDs', () => {
    const l = newLedger('2026-11-01', 0, 0, 0);
    l.categories = l.categories.filter(c => !['娱乐', '学习', '其他', '生活'].includes(c.name));
    l.categories.find(c => c.name === '餐饮')!.archived = true;
    l.categories.push({ id: 'expense-3', name: '自定义', kind: 'expense', archived: false });
    expect(ensureLifeCategory(l)).toBe(true);
    for (const name of ['餐饮', '交通', '购物', '娱乐', '学习', '其他', '生活']) {
      expect(l.categories.filter(c => c.kind === 'expense' && c.name === name)).toHaveLength(1);
    }
    expect(l.categories.find(c => c.name === '餐饮')!.archived).toBe(true);
    expect(l.categories.find(c => c.name === '自定义')!.id).toBe('expense-3');
    expect(l.categories.find(c => c.name === '娱乐')!.id).not.toBe('expense-3');
    expect(ensureLifeCategory(l)).toBe(false);
  });
  it('shows an initially received allowance without adding it to the opening balance twice', () => {
    const l = newLedger('2026-11-16', 90000, 0, 200000);
    l.initial.allowanceReceived = true;
    const receipt = initialAllowanceEntry(l);
    expect(receipt).toMatchObject({
      kind: 'income',
      cents: 200000,
      allowanceMonth: '2026-11',
      includedInInitialBalance: true,
    });
    l.entries.push(receipt!);
    const s = budgetSummary(check(l), '2026-11-16');
    expect([s.budget, s.income, s.dayOpening, s.dayBudget]).toEqual([90000, 200000, 90000, 6000]);
    expect(initialAllowanceEntry(l)).toBeUndefined();
  });
  it('moves positive balances to reserve without increasing next month budget', () => {
    const l = newLedger('2026-11-01', 30000, 0, 200000);
    l.entries.push(entry('income', 200000, '2026-12-01'));
    const s = budgetSummary(check(l), '2026-12-01');
    expect(s.reserve).toBe(30000);
    expect(s.budget).toBe(200000);
    expect(s.dayBudget).toBe(6451);
  });
  it('carries a deficit once without counting it as another expense', () => {
    const l = newLedger('2026-11-01', 200000, 0, 200000);
    l.entries.push(entry('expense', 220000, '2026-11-30'), entry('income', 200000, '2026-12-01'));
    const s = budgetSummary(check(l), '2026-12-01');
    expect(s.openingBudget).toBe(-20000);
    expect(s.budget).toBe(180000);
    expect(s.expenses).toBe(0);
    expect(budgetSummary(l, '2026-12-01')).toEqual(s);
  });
  it('carries uncovered debt through months without opening the app', () => {
    const l = newLedger('2026-09-01', -50000, 30000, 30000);
    l.entries.push(entry('income', 30000, '2026-10-01'));
    const s = budgetSummary(check(l), '2026-12-01');
    expect(s.budget).toBe(-20000);
    expect(s.reserve).toBe(30000);
    expect(s.dayRemaining).toBe(0);
  });
  it('subtracts daily spending from a stable daily allowance', () => {
    const l = newLedger('2026-11-16', 90000, 0, 200000);
    l.entries.push(entry('expense', 4500, '2026-11-16'));
    const s = budgetSummary(check(l), '2026-11-16');
    expect([s.dayBudget, s.dayRemaining, s.budget, s.futureDaily]).toEqual([
      6000, 1500, 85500, 6107,
    ]);
  });
  it('redistributes extra income on the same day', () => {
    const l = newLedger('2026-11-16', 90000, 0, 200000);
    l.entries.push(entry('expense', 4500, '2026-11-16'), entry('income', 15000, '2026-11-16'));
    const s = budgetSummary(check(l), '2026-11-16');
    expect([s.dayBudget, s.dayRemaining, s.budget]).toEqual([7000, 2500, 100500]);
  });
  it('spending more today reduces next day allowance', () => {
    const l = newLedger('2026-11-16', 90000, 0, 0);
    l.entries.push(entry('expense', 8000, '2026-11-16'));
    expect(budgetSummary(check(l), '2026-11-16').dayOver).toBe(2000);
    expect(budgetSummary(l, '2026-11-17').dayBudget).toBe(5857);
  });
  it('handles month end and leap year without division by zero', () => {
    const l = newLedger('2024-02-28', 101, 0, 0);
    expect(budgetSummary(l, '2024-02-28').dayBudget).toBe(50);
    const s = budgetSummary(l, '2024-02-29');
    expect(s.dayBudget).toBe(101);
    expect(s.futureDaily).toBeNull();
  });
  it('recalculates downstream rollover after historical edits and deletions', () => {
    const l = newLedger('2026-11-01', 10000, 0, 0);
    const e = entry('expense', 5000, '2026-11-02');
    l.entries.push(e);
    expect(budgetSummary(l, '2026-12-01').reserve).toBe(5000);
    e.cents = 15000;
    expect(budgetSummary(l, '2026-12-01').budget).toBe(-5000);
    deleteEntry(l, e.id);
    expect(budgetSummary(l, '2026-12-01').reserve).toBe(10000);
  });
  it('preserves total net funds across the monthly boundary', () => {
    for (const balance of [-50000, 0, 255, 200000]) {
      const l = newLedger('2026-11-30', balance, 100000, 0);
      const s = budgetSummary(l, '2026-12-01');
      expect(s.budget + s.reserve).toBe(balance + 100000);
    }
  });
});
describe('refunds, transfers and imported data', () => {
  it('counts backdated income and spending in available money and the daily budget by default', () => {
    const l = newLedger('2026-11-02', 0, 0, 150000);
    l.entries.push(entry('income', 150000, '2026-11-01'), entry('expense', 600, '2026-11-02'));
    const s = budgetSummary(check(l), '2026-11-02');
    expect(s.budget).toBe(149400);
    expect(s.dayBudget).toBe(5172);
    expect(s.dayRemaining).toBe(4572);
    expect(s.futureDaily).toBe(5335);
  });
  it('recalculates legacy history-only records as actual spending', () => {
    const l = newLedger('2026-11-16', 90000, 30000, 0);
    l.entries.push(entry('expense', 5000, '2026-11-01', { includedInOpening: true }));
    const s = budgetSummary(check(l), '2026-11-16');
    expect(s.budget).toBe(85000);
    expect(s.expenses).toBe(5000);
  });
  it('carries previously unaccounted historical debt into the balance month', () => {
    const l = newLedger('2026-11-16', 90000, 30000, 0);
    l.entries.push(entry('expense', 20000, '2026-10-31'));
    const s = budgetSummary(check(l), '2026-11-16');
    expect(s.budget).toBe(70000);
    expect(s.reserve).toBe(30000);
    expect(monthSummary(l, '2026-10', at).expenses).toBe(20000);
  });
  it('leaves positive opening money in the correct month when backfilling older months', () => {
    const l = newLedger('2026-11-16', 90000, 30000, 0);
    l.entries.push(entry('expense', 20000, '2026-10-31', { includedInOpening: true }));
    const s = budgetSummary(check(l), '2026-11-16');
    expect(s.budget).toBe(70000);
    expect(s.reserve).toBe(30000);
  });
  it('separates unaccounted historical surplus from current daily funds', () => {
    const l = newLedger('2026-11-16', 90000, 30000, 0);
    l.entries.push(entry('income', 20000, '2026-10-31'));
    const s = budgetSummary(check(l), '2026-11-16');
    expect(s.budget).toBe(90000);
    expect(s.reserve).toBe(50000);
  });
  it('ignores obsolete exclusion flags and still rejects historical transfers', () => {
    const l = newLedger('2026-11-16', 90000, 30000, 0);
    l.entries.push(entry('expense', 100, '2026-11-16', { includedInOpening: true }));
    expect(budgetSummary(check(l), '2026-11-16').budget).toBe(89900);
    l.entries = [entry('transfer-in', 100, '2026-11-15')];
    expect(() => check(l)).toThrow('资金划转日期');
  });
  it('matches the reported screenshot: income 1500 minus spending 55 and previous debt 50', () => {
    const l = newLedger('2026-11-02', 0, 0, 150000);
    l.entries.push(
      entry('expense', 5000, '2026-10-31', { includedInOpening: true }),
      entry('income', 150000, '2026-11-01', { includedInOpening: true }),
      entry('expense', 5500, '2026-11-01', { includedInOpening: true }),
    );
    const s = budgetSummary(check(l), '2026-11-02');
    expect(s.openingBudget).toBe(-5000);
    expect(s.budget).toBe(139500);
    expect(s.dayRemaining).toBe(4810);
    expect(s.income).toBe(150000);
    expect(s.expenses).toBe(5500);
  });
  it('restores current budget on a cross-month refund, without inventing income', () => {
    const l = newLedger('2026-11-01', 10000, 0, 0);
    const expense = entry('expense', 20000, '2026-11-30');
    l.entries.push(expense, entry('refund', 5000, '2026-12-02', { originalId: expense.id }));
    const s = budgetSummary(check(l), '2026-12-02');
    expect(s.budget).toBe(-5000);
    expect(s.income).toBe(0);
    expect(s.refunds).toBe(5000);
    expect(monthSummary(l, '2026-11', at).expenses).toBe(20000);
  });
  it('rejects excessive or orphaned refunds and cascades deletion', () => {
    const l = newLedger('2026-11-01', 10000, 0, 0);
    const e = entry('expense', 1000, '2026-11-02');
    const r = entry('refund', 1001, '2026-11-03', { originalId: e.id });
    l.entries.push(e, r);
    expect(() => check(l)).toThrow('累计退款');
    r.cents = 1000;
    check(l);
    deleteEntry(l, e.id);
    expect(l.entries).toHaveLength(0);
    l.entries.push(r);
    expect(() => check(l)).toThrow('原支出');
  });
  it('does not treat transfers as income and conserves net balance', () => {
    const l = newLedger('2026-11-01', 0, 30000, 0);
    l.entries.push(entry('transfer-in', 10000, '2026-11-02'));
    const s = budgetSummary(check(l), '2026-11-02');
    expect([s.budget, s.reserve, s.income, s.transfers]).toEqual([10000, 20000, 0, 10000]);
  });
  it('rejects transfers using future or insufficient funds, including after historical edits', () => {
    const l = newLedger('2026-11-01', 0, 10000, 0);
    l.entries.push(entry('transfer-in', 10001, '2026-11-02'));
    expect(() => check(l)).toThrow('历史结余不足');
    l.entries = [entry('transfer-out', 1, '2026-11-02')];
    expect(() => check(l)).toThrow('本月余额不足');
  });
  it('prevents duplicate monthly confirmations and releases marker on deletion', () => {
    const l = newLedger('2026-11-01', 0, 0, 200000);
    const e = entry('income', 200000, '2026-11-02', { allowanceMonth: '2026-11' });
    l.entries.push(e);
    l.entries.push(entry('income', 200000, '2026-11-03', { allowanceMonth: '2026-11' }));
    expect(() => check(l)).toThrow('重复确认');
    deleteEntry(l, e.id);
    check(l);
  });
  it('round trips backups and rejects malformed/unsupported data', () => {
    const l = newLedger('2026-11-01', -1234, 50000, 200000);
    expect(parseBackup(JSON.stringify(l), at)).toEqual(l);
    expect(() => parseBackup('{', at)).toThrow();
    expect(() => parseBackup(JSON.stringify({ ...l, version: 2 }), at)).toThrow();
    expect(() =>
      parseBackup(JSON.stringify({ ...l, initial: { ...l.initial, reserve: -1 } }), at),
    ).toThrow();
    expect(() =>
      parseBackup(JSON.stringify({ ...l, entries: [entry('income', 0, '2026-11-02')] }), at),
    ).toThrow();
    expect(() =>
      parseBackup(JSON.stringify({ ...l, entries: [entry('income', 1, '2027-01-01')] }), at),
    ).toThrow();
  });
});
