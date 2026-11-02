import { test, expect, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { newLedger } from '../../src/domain/ledger';

test.beforeEach(async ({ page }) => {
  await page.clock.install({ time: new Date(2026, 10, 16, 12, 0, 0) });
});
async function initialize(page: Page, budget = '900', reserve = '300') {
  await page.goto('./');
  await page.getByLabel('每月常用生活费', { exact: true }).fill('2000');
  await page.getByLabel('今天开始时，本月生活费还剩多少？').fill(budget);
  await page.getByLabel('之前攒下的历史结余').fill(reserve);
  await page.getByRole('button', { name: '开启我的账本' }).click();
  await expect(page.getByRole('heading', { name: '每一天，心里都有数。' })).toBeVisible();
}
async function addExpense(page: Page, amount = '45') {
  await page.getByRole('button', { name: '记一笔支出' }).click();
  await page.getByLabel('金额', { exact: true }).fill(amount);
  await page.getByRole('button', { name: '餐饮', exact: true }).click();
  await page.getByLabel('备注').fill('测试午餐');
  await page.getByRole('button', { name: '保存记录' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
}
async function navigate(page: Page, name: string) {
  const nav = page.getByRole('navigation', { name: '手机导航' });
  await nav.getByRole('button', { name, exact: true }).click();
}

test('mobile records, recalculates, persists and fits the viewport', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await initialize(page);
  await addExpense(page);
  await expect(page.locator('.hero-amount')).toHaveText('¥15.00');
  await expect(page.locator('.balance-value')).toHaveText('¥855.00');
  await expect(page.locator('.tomorrow-card>strong')).toHaveText('¥61.07');
  await page.reload();
  await expect(page.locator('.hero-amount')).toHaveText('¥15.00');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: 'test-results/mobile-home.png', fullPage: true });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.screenshot({ path: 'test-results/desktop-home.png', fullPage: true });
  expect(errors).toEqual([]);
});

test('monthly allowance confirmation is not repeated', async ({ page }) => {
  await initialize(page, '-200');
  await page.getByRole('button', { name: '确认到账' }).click();
  await expect(page.getByLabel('金额', { exact: true })).toHaveValue('2000.00');
  await page.getByRole('button', { name: '保存记录' }).click();
  await expect(page.locator('.balance-value')).toHaveText('¥1,800.00');
  await expect(page.getByRole('button', { name: '确认到账' })).toHaveCount(0);
  await page.reload();
  await expect(page.getByRole('button', { name: '确认到账' })).toHaveCount(0);
});

test('fund transfer, editing, refunds and deletion update the budget', async ({ page }) => {
  await initialize(page);
  await addExpense(page, '60');
  await page.locator('.entry-row').first().click();
  await page.getByRole('button', { name: '记录退款', exact: true }).click();
  await page.getByLabel('金额', { exact: true }).fill('20');
  await page.getByRole('button', { name: '保存记录' }).click();
  await expect(page.locator('.balance-value')).toHaveText('¥860.00');
  await page.getByRole('button', { name: /历史结余 ¥/ }).click();
  await page.getByRole('button', { name: '从历史结余补充本月' }).click();
  await page.getByLabel('金额', { exact: true }).fill('100');
  await page.getByRole('button', { name: '保存记录' }).click();
  await expect(page.locator('.balance-value')).toHaveText('¥960.00');
  await expect(page.locator('.fund-link')).toContainText('200.00');
  await navigate(page, '账单');
  await page.getByLabel('搜索账单备注或分类').fill('测试午餐');
  await page.locator('.entry-row').first().click();
  await page.getByLabel('金额', { exact: true }).fill('70');
  await page.getByRole('button', { name: '保存记录' }).click();
  await page.locator('.entry-row').first().click();
  page.once('dialog', (d) => d.accept());
  await page.getByRole('button', { name: '删除记录' }).click();
  await page.getByRole('button', { name: '撤销删除' }).click();
  await expect(page.locator('.entry-row')).toHaveCount(1);
});

test('backup restoration preserves previous data and rejects damaged files', async ({ page }) => {
  await initialize(page);
  await addExpense(page);
  await navigate(page, '设置');
  const downloadEvent = page.waitForEvent('download');
  await page.getByRole('button', { name: '导出完整备份' }).click();
  const download = await downloadEvent;
  const payload = await readFile((await download.path())!, 'utf-8');
  expect(JSON.parse(payload).entries).toHaveLength(1);
  await navigate(page, '概览');
  await addExpense(page, '10');
  await navigate(page, '设置');
  await page.getByLabel('选择备份文件').setInputFiles({
    name: 'backup.json',
    mimeType: 'application/json',
    buffer: Buffer.from(payload),
  });
  await page.getByRole('button', { name: '确认替换并恢复' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await navigate(page, '概览');
  await expect(page.locator('.balance-value')).toHaveText('¥855.00');
  await navigate(page, '设置');
  await page.getByLabel('选择备份文件').setInputFiles({
    name: 'broken.json',
    mimeType: 'application/json',
    buffer: Buffer.from('{"version":99}'),
  });
  await expect(page.getByRole('status')).toContainText('不是支持');
  await expect(page.getByRole('dialog')).toHaveCount(0);
});

test('statistics, themes and categories are usable on narrow screens', async ({ page }) => {
  await initialize(page);
  await addExpense(page);
  await navigate(page, '统计');
  await expect(page.getByRole('heading', { name: '支出花在哪里' })).toBeVisible();
  await page.getByText('查看每日消费明细').click();
  await expect(page.locator('.daily-table')).toContainText('45.00');
  await expect(page.locator('.daily-table')).toContainText('餐饮');
  await expect(page.locator('.daily-table')).toContainText('测试午餐');
  await navigate(page, '设置');
  await page.getByRole('button', { name: '深色', exact: true }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.getByRole('button', { name: '分类管理' }).click();
  await page.getByLabel('新分类名称').fill('奶茶');
  await page.getByRole('dialog').getByRole('button', { name: '添加分类', exact: true }).click();
  await expect(page.locator('.category-management')).toContainText('奶茶');
  await page.getByRole('button', { name: '关闭弹窗' }).click();
  await page.setViewportSize({ width: 320, height: 720 });
  for (const name of ['概览', '账单', '统计', '设置']) {
    await navigate(page, name);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
  }
  await page.setViewportSize({ width: 320, height: 720 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

for (const scenario of [
  { opening: '300', current: '0.00', reserve: '600.00' },
  { opening: '-200', current: '200.00', reserve: '300.00' },
]) {
  test(`rolls ${scenario.opening} across midnight without duplicating carry`, async ({ page }) => {
    await page.clock.setSystemTime(new Date(2026, 10, 30, 23, 59, 59));
    await initialize(page, scenario.opening);
    await page.clock.setSystemTime(new Date(2026, 11, 1, 0, 0, 1));
    await page.clock.runFor(16000);
    await expect(page.locator('.balance-value')).toHaveText(`¥${scenario.current}`);
    await expect(page.locator('.fund-link')).toContainText(scenario.reserve);
    await page.reload();
    await expect(page.locator('.fund-link')).toContainText(scenario.reserve);
  });
}

test('installed service worker reloads offline and saves another entry', async ({
  page,
  context,
}) => {
  await initialize(page);
  await addExpense(page);
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  await page.reload();
  await expect(page.locator('.balance-value')).toHaveText('¥855.00');
  await context.setOffline(true);
  await page.reload();
  await expect(page.locator('.balance-value')).toHaveText('¥855.00');
  await addExpense(page, '5');
  await expect(page.locator('.balance-value')).toHaveText('¥850.00');
  await page.reload();
  await expect(page.locator('.balance-value')).toHaveText('¥850.00');
  await context.setOffline(false);
});

test('restores an existing backup directly on first use', async ({ page }) => {
  const value = newLedger('2026-11-16', 90000, 30000, 200000);
  value.entries.push({
    id: 'restore-expense',
    kind: 'expense',
    cents: 4500,
    date: '2026-11-16',
    categoryId: 'expense-0',
    note: '迁移记录',
    createdAt: 1,
  });
  await page.goto('./');
  await page
    .getByLabel('首次使用恢复备份')
    .setInputFiles({
      name: 'backup.json',
      mimeType: 'application/json',
      buffer: Buffer.from(JSON.stringify(value)),
    });
  await expect(page.locator('.balance-value')).toHaveText('¥855.00');
  await expect(page.locator('.hero-amount')).toHaveText('¥15.00');
});

test('initial balance can already contain the current allowance', async ({ page }) => {
  await page.goto('./');
  await page.getByLabel('今天开始时，本月生活费还剩多少？').fill('900');
  await page.getByLabel('本月生活费已到账，已包含在上面的余额中').check();
  await page.getByRole('button', { name: '开启我的账本' }).click();
  await expect(page.locator('.balance-value')).toHaveText('¥900.00');
  await expect(page.getByRole('button', { name: '确认到账' })).toHaveCount(0);
  await expect(page.locator('.entry-row')).toContainText('生活费');
  await expect(page.locator('.entry-row')).toContainText('已含起始余额');
  await expect(page.locator('.month-metrics')).toContainText('2,000.00');
  await page.setViewportSize({ width: 375, height: 812 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.setViewportSize({ width: 844, height: 390 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('clearly marks a daily overspend with a negative amount', async ({ page }) => {
  await initialize(page, '60', '0');
  await addExpense(page, '10');
  await expect(page.locator('.budget-card')).toHaveClass(/over-budget/);
  await expect(page.locator('.budget-top')).toContainText('今日已超出');
  await expect(page.locator('.hero-amount')).toHaveText('−¥6.00');
});
