import { useCallback, useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import {
  ArrowDownLeft,
  ArrowUpRight,
  ArrowLeftRight,
  ArrowRight,
  Plus,
  X,
  ChevronLeft,
  ChevronRight,
  LayoutDashboard,
  List,
  ChartNoAxesCombined,
  Settings,
  Wallet,
  CalendarDays,
  ShieldCheck,
  Download,
  Upload,
  WifiOff,
  Info,
  Check,
  Pencil,
  Trash2,
  Undo2,
  Search,
  RefreshCw,
  Sun,
  Moon,
  Monitor,
  Utensils,
  Bus,
  ShoppingBag,
  BookOpen,
  Gamepad2,
  CircleEllipsis,
  Landmark,
  Coins,
  House,
} from 'lucide-react';
import { useRegisterSW } from 'virtual:pwa-register/react';
import DatePicker from './DatePicker';
import {
  backup,
  download,
  exportCsv,
  loadLedger,
  mutateLedger,
  requestPersistence,
  subscribeLedger,
} from '../data/store';
import {
  budgetSummary,
  installmentSchedule,
  convertToInstallments,
  confirmInstallment,
  entryBalances,
  deleteEntry,
  inputMoney,
  kindLabel,
  money,
  monthDays,
  monthOf,
  monthSummary,
  newLedger,
  parseBackup,
  parseMoney,
  shiftMonth,
  todayLocal,
  firstLedgerDate,
  initialAllowanceEntry,
  MIN_LEDGER_DATE,
  type Category,
  type Entry,
  type EntryKind,
  type Ledger,
  type InstallmentPlan,
  type Theme,
} from '../domain/ledger';

type Page = 'home' | 'ledger' | 'stats' | 'settings';
type Modal =
  | { type: 'entry'; kind: EntryKind; entry?: Entry; original?: Entry; allowance?: boolean }
  | { type: 'installment-setup'; entry: Entry }
  | { type: 'installment-plan'; planId: string }
  | { type: 'installment-pay'; planId: string; index: number }
  | { type: 'funds' | 'formula' | 'categories' }
  | { type: 'restore'; value: Ledger }
  | null;
type InstallEvent = Event & { prompt(): Promise<void>; userChoice: Promise<{ outcome: string }> };
const nav = [
  { id: 'home', label: '概览', icon: LayoutDashboard },
  { id: 'ledger', label: '账单', icon: List },
  { id: 'stats', label: '统计', icon: ChartNoAxesCombined },
  { id: 'settings', label: '设置', icon: Settings },
] as const;
const errorText = (error: unknown) => (error instanceof Error ? error.message : '操作失败，请重试');
const cn = (...values: (string | false | null | undefined)[]) => values.filter(Boolean).join(' ');
const categoryIcon = (category?: Category) =>
  ({
    餐饮: Utensils,
    交通: Bus,
    购物: ShoppingBag,
    娱乐: Gamepad2,
    学习: BookOpen,
    生活: House,
    生活费: Landmark,
    兼职: Coins,
  })[category?.name || ''] || CircleEllipsis;
const dateTitle = (date: string, today: string) =>
  date === today ? '今天' : `${Number(date.slice(5, 7))} 月 ${Number(date.slice(8))} 日`;
const positive = (entry: Entry) => !['expense', 'transfer-out'].includes(entry.kind);

export default function App() {
  const [ledger, setLedger] = useState<Ledger | null | undefined>();
  const [fatal, setFatal] = useState('');
  const [today, setToday] = useState(todayLocal());
  const [page, setPage] = useState<Page>('home');
  const [month, setMonth] = useState(monthOf(today));
  const [modal, setModal] = useState<Modal>(null);
  const [toast, setToast] = useState<{ text: string; action?: () => void } | null>(null);
  const [busy, setBusy] = useState(false);
  const saving = useRef(false);
  const [online, setOnline] = useState(navigator.onLine);
  const [install, setInstall] = useState<InstallEvent | null>(null);
  const [undo, setUndo] = useState<{ ledger: Ledger; revision: number } | null>(null);
  const readVersion = useRef(0);
  const {
    offlineReady: [offlineReady],
    needRefresh: [needRefresh],
    updateServiceWorker,
  } = useRegisterSW();

  const refresh = useCallback(async () => {
    const request = ++readVersion.current;
    try {
      const value = await loadLedger();
      if (request === readVersion.current) {
        setLedger(value);
        setFatal('');
      }
    } catch (e) {
      setFatal(errorText(e));
    }
  }, []);
  useEffect(() => {
    void refresh();
    return subscribeLedger(() => void refresh());
  }, [refresh]);
  useEffect(() => {
    const tick = () => setToday(todayLocal());
    const visibility = () => {
      if (!document.hidden) {
        tick();
        void refresh();
      }
    };
    const timer = window.setInterval(tick, 15000);
    document.addEventListener('visibilitychange', visibility);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', visibility);
    };
  }, [refresh]);
  useEffect(() => {
    setMonth(monthOf(today));
  }, [today]);
  useEffect(() => {
    const on = () => setOnline(navigator.onLine);
    const before = (event: Event) => {
      event.preventDefault();
      setInstall(event as InstallEvent);
    };
    window.addEventListener('online', on);
    window.addEventListener('offline', on);
    window.addEventListener('beforeinstallprompt', before);
    return () => {
      window.removeEventListener('online', on);
      window.removeEventListener('offline', on);
      window.removeEventListener('beforeinstallprompt', before);
    };
  }, []);
  useEffect(() => {
    const theme = ledger?.settings.theme || 'system';
    const media = matchMedia('(prefers-color-scheme: dark)');
    const apply = () =>
      (document.documentElement.dataset.theme =
        theme === 'system' ? (media.matches ? 'dark' : 'light') : theme);
    apply();
    media.addEventListener('change', apply);
    return () => media.removeEventListener('change', apply);
  }, [ledger?.settings.theme]);
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), toast.action ? 12000 : 6000);
    return () => clearTimeout(timer);
  }, [toast]);

  async function write(
    change: (current: Ledger | null) => Ledger,
    expected?: number,
    preserve = false,
  ) {
    if (saving.current) throw new Error('正在保存，请稍候');
    saving.current = true;
    setBusy(true);
    try {
      const saved = await mutateLedger(change, expected, preserve);
      setLedger(saved);
      setUndo(null);
      return saved;
    } finally {
      saving.current = false;
      setBusy(false);
    }
  }
  useEffect(() => {
    if (!ledger) return;
    const receipt = initialAllowanceEntry(ledger);
    if (!receipt) return;
    void write((current) => {
      if (!current) throw new Error('请先创建账本');
      const pendingReceipt = initialAllowanceEntry(current);
      if (pendingReceipt) current.entries.push(pendingReceipt);
      return current;
    }, ledger.revision).catch((error) => setToast({ text: errorText(error) }));
  }, [ledger?.revision]);
  async function saveEntry(entry: Entry, expected: number) {
    await write((current) => {
      if (!current) throw new Error('请先创建账本');
      const index = current.entries.findIndex((e) => e.id === entry.id);
      if (index < 0) current.entries.push(entry);
      else current.entries[index] = entry;
      if (entry.kind === 'expense')
        current.entries.forEach((e) => {
          if (e.originalId === entry.id) e.categoryId = entry.categoryId;
        });
      return current;
    }, expected);
    setModal(null);
    setToast({ text: '已保存，余额和每日预算已更新' });
  }
  async function remove(entry: Entry) {
    if (
      !ledger ||
      !confirm(
        ledger.entries.some((e) => e.originalId === entry.id)
          ? '删除这笔支出及其关联退款？后续预算会重新计算。'
          : '删除这笔记录？后续预算会重新计算。',
      )
    )
      return false;
    const before = structuredClone(ledger);
    try {
      const saved = await write((current) => {
        deleteEntry(current!, entry.id);
        return current!;
      }, ledger.revision);
      setUndo({ ledger: before, revision: saved.revision });
      setToast({ text: '记录已删除，可在账单页撤销最近一次删除' });
      return true;
    } catch (error) {
      setToast({ text: errorText(error) });
      return false;
    }
  }
  async function undoDelete() {
    if (!undo) return;
    try {
      await write(() => undo.ledger, undo.revision);
      setToast({ text: '删除已撤销' });
    } catch (error) {
      setToast({ text: errorText(error) });
    }
  }
  function navigate(next: Page) {
    setPage(next);
    window.scrollTo({ top: 0 });
  }

  if (fatal)
    return (
      <main className="startup">
        <Wallet size={40} />
        <h1>暂时无法读取账本</h1>
        <p>{fatal}</p>
        <p>请使用普通浏览模式，并允许网站保存数据。</p>
        <button onClick={() => void refresh()}>重新读取</button>
      </main>
    );
  if (ledger === undefined)
    return (
      <main className="startup" role="status">
        <Wallet size={40} />
        <h1>KWallet</h1>
        <p>正在打开你的本地账本…</p>
      </main>
    );
  if (ledger === null)
    return (
      <Onboarding
        busy={busy}
        onCreate={async (value) => {
          await write((current) => {
            if (current) throw new Error('已有账本，请刷新后重试');
            return value;
          });
          void requestPersistence().catch(() => false);
        }}
      />
    );
  if (ledger.initial.date > today)
    return (
      <main className="startup">
        <h1>请检查手机日期</h1>
        <p>当前系统日期早于账本起始日期 {ledger.initial.date}，请校准日期后重试。</p>
      </main>
    );

  const summary = budgetSummary(ledger, today);
  const allowanceDone =
    ledger.entries.some((e) => e.allowanceMonth === monthOf(today)) ||
    (monthOf(ledger.initial.date) === monthOf(today) && ledger.initial.allowanceReceived === true);
  const monthName = `${Number(month.slice(0, 4))} 年 ${Number(month.slice(5))} 月`;
  const monthPicker = (
    <div className="month-picker">
      <button
        className="icon-button"
        aria-label="上个月"
        disabled={month <= monthOf(firstLedgerDate(ledger))}
        onClick={() => setMonth(shiftMonth(month, -1))}
      >
        <ChevronLeft size={18} />
      </button>
      <span>{monthName}</span>
      <button
        className="icon-button"
        aria-label="下个月"
        disabled={month >= monthOf(today)}
        onClick={() => setMonth(shiftMonth(month, 1))}
      >
        <ChevronRight size={18} />
      </button>
    </div>
  );
  const openEntry = (kind: EntryKind) => setModal({ type: 'entry', kind });
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <a
          className="brand"
          href="#"
          onClick={(e) => {
            e.preventDefault();
            navigate('home');
          }}
        >
          <span className="brand-icon">
            <Wallet size={25} />
          </span>
          <span>
            KWallet<small>把生活费安排好</small>
          </span>
        </a>
        <div className="nav-caption">我的生活账本</div>
        <nav aria-label="主导航">
          {nav.map((item) => (
            <button
              key={item.id}
              className={cn('nav-item', page === item.id && 'active')}
              aria-current={page === item.id ? 'page' : undefined}
              onClick={() => navigate(item.id)}
            >
              <item.icon size={21} />
              <span>{item.label}</span>
              {page === item.id && <span className="nav-dot" />}
            </button>
          ))}
        </nav>
        <div className="sidebar-note">
          <ShieldCheck size={22} />
          <strong>账本留在你身边</strong>
          <p>数据保存在当前设备，记得定期导出备份。</p>
          <button className="text-button" onClick={() => backup(ledger)}>
            备份我的账本 <ArrowRight size={15} />
          </button>
        </div>
        <div className="sidebar-footer">
          <span className="status-dot" /> {online ? '本地账本 · 无需登录' : '离线记账中'}
        </div>
      </aside>
      <main className="main-content">
        <header className="page-header">
          <div>
            <div className="eyebrow">
              KWALLET /{' '}
              {page === 'home'
                ? 'OVERVIEW'
                : page === 'ledger'
                  ? 'TRANSACTIONS'
                  : page === 'stats'
                    ? 'INSIGHTS'
                    : 'PREFERENCES'}
            </div>
            <h1>
              {page === 'home'
                ? '每一天，心里都有数。'
                : page === 'ledger'
                  ? '生活的每一笔。'
                  : page === 'stats'
                    ? '看见钱的去向。'
                    : '让账本适合你。'}
            </h1>
            <p>
              {page === 'home'
                ? `${Number(today.slice(5, 7))} 月 ${Number(today.slice(8))} 日 · 慢慢记录，好好生活`
                : page === 'ledger'
                  ? '收入、支出和资金调整，都在这里。'
                  : page === 'stats'
                    ? '了解消费习惯，安排接下来的日子。'
                    : '管理生活费、分类和属于你的数据。'}
            </p>
          </div>
          <div className="header-status">
            <span className="status-dot" />
            {!online ? '离线使用中' : offlineReady ? '已就绪 · 可离线使用' : '本地保存'}
            <span className="avatar">K</span>
          </div>
        </header>
        {!online && (
          <div className="notice">
            <WifiOff size={18} />
            当前没有网络，记账仍会保存到本机。
          </div>
        )}
        {needRefresh && (
          <div className="notice">
            <RefreshCw size={18} />
            新版本已就绪。
            <button
              className="text-button"
              disabled={!!modal || busy}
              onClick={() => void updateServiceWorker(true)}
            >
              保存操作完成后更新
            </button>
          </div>
        )}
        {page === 'home' && (
          <>
            <div className="dashboard-grid">
              <section className={cn('budget-card', summary.dayOver > 0 && 'over-budget')}>
                <div className="budget-top">
                  <span>
                    <span className={cn('light-dot', summary.dayOver > 0 && 'danger-dot')} />{' '}
                    {summary.dayOver > 0 ? '今日已超出' : '今日还能花'}
                  </span>
                  <button
                    aria-label="查看预算计算说明"
                    className="glass-button"
                    onClick={() => setModal({ type: 'formula' })}
                  >
                    <Info size={19} />
                  </button>
                </div>
                <div
                  className={cn('hero-amount', summary.dayOver > 0 && 'danger')}
                  aria-label={
                    summary.dayOver > 0
                      ? `今日超出 ${money(summary.dayOver)} 元`
                      : `今日还能花 ${money(summary.dayRemaining)} 元`
                  }
                >
                  <span>{summary.dayOver > 0 ? '−¥' : '¥'}</span>
                  {money(summary.dayOver || summary.dayRemaining)}
                </div>
                <p className="budget-caption">
                  {summary.budget < 0
                    ? '本月已有资金缺口，先补充生活费吧。'
                    : summary.dayOver
                      ? '今天多花一点，接下来重新安排。'
                      : '在自己的节奏里，过好今天。'}
                </p>
                <div className="budget-divider" />
                <div className="budget-details">
                  <div>
                    <span>今日预算</span>
                    <strong>¥{money(summary.dayBudget)}</strong>
                  </div>
                  <div>
                    <span>今日已花</span>
                    <strong>¥{money(summary.daySpent)}</strong>
                  </div>
                  <div>
                    <span>距月底</span>
                    <strong>
                      {summary.daysLeft}
                      <small> 天</small>
                    </strong>
                  </div>
                </div>
                <div className="orbit orbit-one" />
                <div className="orbit orbit-two" />
              </section>
              <section className="month-card panel">
                <div className="section-heading">
                  <h2>{Number(today.slice(5, 7))} 月生活费</h2>
                  <span className="tag">本月</span>
                </div>
                <div className="balance-label">
                  {summary.budget < 0 ? '本月资金缺口' : '剩余可用'}
                </div>
                <div className={cn('balance-value', summary.budget < 0 && 'danger')}>
                  ¥{money(Math.abs(summary.budget))}
                </div>
                {summary.openingBudget < 0 && (
                  <p className="debt-line">含上月结转缺口 ¥{money(-summary.openingBudget)}</p>
                )}
                <div className="month-metrics">
                  <div>
                    <span>本月收入</span>
                    <strong>¥{money(summary.income)}</strong>
                  </div>
                  <div>
                    <span>本月净支出</span>
                    <strong>¥{money(summary.expenses - summary.refunds)}</strong>
                  </div>
                </div>
                <button className="fund-link" onClick={() => setModal({ type: 'funds' })}>
                  <span>
                    <Landmark size={17} />
                    历史结余 <b>¥{money(summary.reserve)}</b>
                  </span>
                  <ChevronRight size={16} />
                </button>
              </section>
            </div>
            {!allowanceDone && (
              <div className="allowance-banner">
                <div className="mini-icon">
                  <Landmark size={21} />
                </div>
                <div>
                  <strong>这个月的生活费到账了吗？</strong>
                  <p>确认后，再按剩余天数安排每天的预算。</p>
                </div>
                <button
                  className="secondary"
                  onClick={() => setModal({ type: 'entry', kind: 'income', allowance: true })}
                >
                  确认到账 <ArrowRight size={16} />
                </button>
              </div>
            )}
            <div className="quick-actions">
              <button onClick={() => openEntry('expense')}>
                <span className="action-icon">
                  <Plus size={24} />
                </span>
                <span>
                  <strong>记一笔支出</strong>
                  <small>记录今天的小日常</small>
                </span>
                <ArrowRight size={19} />
              </button>
              <button onClick={() => openEntry('income')}>
                <span className="action-icon income">
                  <ArrowDownLeft size={24} />
                </span>
                <span>
                  <strong>记一笔收入</strong>
                  <small>生活费、兼职或小惊喜</small>
                </span>
                <ArrowRight size={19} />
              </button>
            </div>
            <div className="lower-grid">
              <section className="panel recent-panel">
                <div className="section-heading">
                  <h2>
                    最近账单 <span className="count">{ledger.entries.length}</span>
                  </h2>
                  <button className="text-button" onClick={() => navigate('ledger')}>
                    查看全部 <ArrowRight size={16} />
                  </button>
                </div>
                <EntryList
                  entries={[...ledger.entries].sort(sortEntries).slice(0, 5)}
                  ledger={ledger}
                  today={today}
                  onSelect={(entry) => setModal({ type: 'entry', kind: entry.kind, entry })}
                  onAdd={() => openEntry('expense')}
                />
              </section>
              <section className="tomorrow-card">
                <span className="mini-label">
                  <CalendarDays size={17} /> 给接下来的日子
                </span>
                <h2>{summary.futureDaily === null ? '本月最后一天' : '明天起，日均可花'}</h2>
                <strong>
                  {summary.futureDaily === null ? '好好收个尾' : `¥${money(summary.futureDaily)}`}
                </strong>
                <p>
                  {summary.futureDaily === null
                    ? '明天会开启新的月份，结余与欠款将自动结转。'
                    : '按当前余额计算，假设今天不再消费。今天省下的，会留给往后的每一天。'}
                </p>
                <div className="little-line" />
              </section>
            </div>
          </>
        )}
        {page === 'ledger' && (
          <>
          {!!ledger.installments?.length && <section className="panel padded installment-list"><div className="section-heading"><h2>分期计划</h2></div>{ledger.installments.map(plan => {
            const pending = plan.periods.filter(p => !p.entryId);
            const overdue = pending.filter(p => p.dueDate < today).length;
            return <button className="secondary full" key={plan.id} onClick={() => setModal({ type: 'installment-plan', planId: plan.id })}>{plan.note || ledger.categories.find(c => c.id === plan.categoryId)?.name || '分期支出'} · 待还 {pending.length} 期{overdue ? ` · 已逾期 ${overdue} 期` : ''}</button>;
          })}</section>}
          <LedgerPage
            ledger={ledger}
            today={today}
            month={month}
            monthPicker={monthPicker}
            onAdd={() => openEntry('expense')}
            onEdit={(entry) => setModal({ type: 'entry', kind: entry.kind, entry })}
            undo={undo ? () => void undoDelete() : undefined}
          />
          </>
        )}
        {page === 'stats' && (
          <StatsPage ledger={ledger} today={today} month={month} picker={monthPicker} />
        )}
        {page === 'settings' && (
          <SettingsPage
            ledger={ledger}
            busy={busy}
            install={install}
            onInstall={async () => {
              await install?.prompt();
              await install?.userChoice;
              setInstall(null);
            }}
            write={write}
            onToast={(text) => setToast({ text })}
            onCategories={() => setModal({ type: 'categories' })}
            onImport={(value) => setModal({ type: 'restore', value })}
            onFunds={() => setModal({ type: 'funds' })}
          />
        )}
        <footer className="content-footer">
          <span>KWallet · 把生活费安排好</span>
          <span>
            <ShieldCheck size={13} />
            数据保存在当前设备
          </span>
        </footer>
      </main>
      <nav className="bottom-nav" aria-label="手机导航">
        {nav.map((item) => (
          <button
            key={item.id}
            aria-current={page === item.id ? 'page' : undefined}
            className={cn(page === item.id && 'active')}
            onClick={() => navigate(item.id)}
          >
            <item.icon size={22} />
            <span>{item.label}</span>
          </button>
        ))}
      </nav>
      {page !== 'settings' && (
        <button className="mobile-add" onClick={() => openEntry('expense')}>
          <Plus size={21} />
          记一笔
        </button>
      )}
      {modal?.type === 'entry' && (
        <EntryModal
          key={modal.entry?.id || `${modal.kind}-${modal.allowance}`}
          ledger={ledger}
          today={today}
          modal={modal}
          busy={busy}
          onClose={() => setModal(null)}
          onSave={(entry) => saveEntry(entry, ledger.revision)}
          onDelete={
            modal.entry
              ? async () => {
                  if (await remove(modal.entry!)) setModal(null);
                }
              : undefined
          }
          onRefund={(entry) => setModal({ type: 'entry', kind: 'refund', original: entry })}
          onInstallment={(entry) => setModal({ type: 'installment-setup', entry })}
        />
      )}
      {modal?.type === 'installment-setup' && <InstallmentSetup key={modal.entry.id} entry={modal.entry} busy={busy} onClose={() => setModal(null)} onSave={async (plan, firstPaid) => {
        await write(current => { convertToInstallments(current!, modal.entry.id, plan, firstPaid); return current!; }, ledger.revision);
        setModal({ type: 'installment-plan', planId: plan.id });
      }} />}
      {modal?.type === 'installment-plan' && (() => {
        const plan = ledger.installments?.find(p => p.id === modal.planId);
        if (!plan) return null;
        return <Dialog title="分期计划" onClose={() => setModal(null)}>
          <p>{plan.note || ledger.categories.find(c => c.id === plan.categoryId)?.name} · 本金 ¥{money(plan.principal)} · 手续费 ¥{money(plan.fee)}</p>
          <p className="muted">待还 ¥{money(plan.periods.filter(p => !p.entryId).reduce((sum, p) => sum + p.cents, 0))} · 待还计划不会影响余额</p>
          <p className="muted">已确认的期数可在账单中修改实际金额和日期；暂不支持单独删除或退款。</p>
          {plan.periods.map((period, index) => {
            const paid = ledger.entries.find(e => e.id === period.entryId);
            return <div className="installment-period" key={index}><div><strong>第 {index + 1}/{plan.periods.length} 期 · ¥{money(period.cents)}</strong><small>计划 {period.dueDate} · {paid ? `已扣款 ${paid.date} ¥${money(paid.cents)}` : period.dueDate < today ? '已逾期' : '待还款'}</small></div>{!paid && <button className="secondary" onClick={() => setModal({ type: 'installment-pay', planId: plan.id, index })}>确认扣款</button>}</div>;
          })}
        </Dialog>;
      })()}
      {modal?.type === 'installment-pay' && (() => {
        const plan = ledger.installments?.find(p => p.id === modal.planId);
        if (!plan || !plan.periods[modal.index]) return null;
        return <InstallmentPayment key={`${plan.id}-${modal.index}`} plan={plan} index={modal.index} today={today} busy={busy} onClose={() => setModal({ type: 'installment-plan', planId: plan.id })} onSave={async (entry) => {
          await write(current => { confirmInstallment(current!, plan.id, modal.index, entry); return current!; }, ledger.revision);
          setModal({ type: 'installment-plan', planId: plan.id });
          setToast({ text: '已确认扣款，余额已更新' });
        }} />;
      })()}
      {modal?.type === 'formula' && (
        <Dialog title="今天的预算怎么算？" onClose={() => setModal(null)}>
          <p className="muted">按实际到账的资金分配，不把历史结余自动算进来。</p>
          <div className="detail-lines">
            <Detail label="今日开始时的本月余额" value={summary.dayOpening} />
            <Detail label="今日补充、退款与净转入" value={summary.dayAdded} />
            <Detail label="今日预算" value={summary.dayBudget} />
            <Detail label="今日已花" value={summary.daySpent} />
          </div>
          <div className="explanation">
            今日预算 = max（日初余额 + 今日补充，0）÷ {summary.daysLeft} 天，向下取整到分。
            <br />
            <br />
            今日额度扣除今日支出后，就是今日还能花的钱。超支会影响后续日期的预算。
          </div>
        </Dialog>
      )}
      {modal?.type === 'funds' && (
        <Dialog title="我的资金安排" onClose={() => setModal(null)}>
          <div className="detail-lines">
            <Detail label="历史结余（不参与日预算）" value={summary.reserve} />
            <Detail label="本月预算余额（含缺口）" value={summary.budget} />
            <Detail label="预算净余额" value={summary.reserve + summary.budget} />
          </div>
          <p className="muted">这是生活费预算，不代表银行卡资产。历史结余不会自动抵扣欠款。</p>
          <button className="full" onClick={() => openEntry('transfer-in')}>
            <ArrowDownLeft size={18} />
            从历史结余补充本月
          </button>
          <button className="secondary full" onClick={() => openEntry('transfer-out')}>
            <ArrowUpRight size={18} />
            把本月余额转回结余
          </button>
        </Dialog>
      )}
      {modal?.type === 'categories' && (
        <CategoryModal ledger={ledger} busy={busy} onClose={() => setModal(null)} write={write} />
      )}
      {modal?.type === 'restore' && (
        <Dialog title="确认恢复账本" onClose={() => !busy && setModal(null)}>
          <p>
            备份包含 <strong>{modal.value.entries.length}</strong> 笔记录，起始日期为{' '}
            {modal.value.initial.date}。
          </p>
          <div className="explanation">
            恢复会替换当前账本。恢复前的账本会自动保留在本机，可在设置中导出；建议同时手动下载一份备份。
          </div>
          <button className="secondary full" onClick={() => backup(ledger)}>
            先下载当前账本备份
          </button>
          <AsyncButton
            busy={busy}
            label="确认替换并恢复"
            onClick={async () => {
              await write(() => structuredClone(modal.value), ledger.revision, true);
              setModal(null);
              setToast({ text: '账本已恢复，预算已重新计算' });
            }}
          />
        </Dialog>
      )}
      {toast && (
        <div className="toast" role="status">
          <Check size={18} />
          <span>{toast.text}</span>
          <button className="icon-button" aria-label="关闭提示" onClick={() => setToast(null)}>
            <X size={16} />
          </button>
        </div>
      )}
    </div>
  );
}

function sortEntries(a: Entry, b: Entry) {
  return b.date.localeCompare(a.date) || b.createdAt - a.createdAt || b.id.localeCompare(a.id);
}
function balanceText(value: number) {
  return `扣款后余额 ${value < 0 ? '−' : ''}¥${money(Math.abs(value))}${value < 0 ? ' · 已超支' : ''}`;
}
function Detail({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <span>{label}</span>
      <strong>¥{money(value)}</strong>
    </div>
  );
}
function Empty({ onAdd }: { onAdd?: () => void }) {
  return (
    <div className="empty">
      <span className="empty-icon">
        <List size={28} />
      </span>
      <h3>给生活留下一笔记录</h3>
      <p>从今天的一顿饭、一杯咖啡开始。</p>
      {onAdd && (
        <button className="text-button" onClick={onAdd}>
          记第一笔 <Plus size={16} />
        </button>
      )}
    </div>
  );
}

function EntryList({
  entries,
  ledger,
  today,
  onSelect,
  onAdd,
}: {
  entries: Entry[];
  ledger: Ledger;
  today: string;
  onSelect: (e: Entry) => void;
  onAdd?: () => void;
}) {
  if (!entries.length) return <Empty onAdd={onAdd} />;
  return (
    <div className="entry-list">
      {entries.map((entry) => {
        const category = ledger.categories.find((c) => c.id === entry.categoryId);
        const plan = ledger.installments?.find(p => p.periods.some(period => period.entryId === entry.id));
        const installmentNumber = plan ? plan.periods.findIndex(period => period.entryId === entry.id) + 1 : 0;
        const Icon = entry.kind.startsWith('transfer') ? ArrowLeftRight : categoryIcon(category);
        const refunded = ledger.entries
          .filter((e) => e.originalId === entry.id)
          .reduce((s, e) => s + e.cents, 0);
        return (
          <button key={entry.id} className="entry-row" onClick={() => onSelect(entry)}>
            <span className={cn('entry-icon', positive(entry) && 'positive')}>
              <Icon size={20} />
            </span>
            <span className="entry-description">
              <strong>
                {entry.kind.startsWith('transfer')
                  ? kindLabel[entry.kind]
                  : category?.name || kindLabel[entry.kind]}
                {entry.kind === 'refund' && ' · 退款'}
                {plan && ` · 第 ${installmentNumber}/${plan.periods.length} 期`}
                {entry.allowanceMonth && <span className="inline-tag">生活费</span>}
                {entry.includedInInitialBalance && (
                  <span className="inline-tag initial-balance-tag">已含起始余额</span>
                )}
              </strong>
              <small>
                {dateTitle(entry.date, today)}
                {entry.note && ` · ${entry.note}`}
                {refunded > 0 && ` · 已退 ¥${money(refunded)}`}
              </small>
            </span>
            <span className={cn('entry-amount', positive(entry) && 'positive')}>
              {positive(entry) ? '+' : '−'}
              {money(entry.cents)}
              {entry.kind === 'expense' && <small className={cn('entry-balance', (entryBalances(ledger).get(entry.id) ?? 0) < 0 && 'danger')}>{balanceText(entryBalances(ledger).get(entry.id) ?? 0)}</small>}
            </span>
            <ChevronRight size={15} className="row-chevron" />
          </button>
        );
      })}
    </div>
  );
}

function LedgerPage({
  ledger,
  today,
  month,
  monthPicker,
  onAdd,
  onEdit,
  undo,
}: {
  ledger: Ledger;
  today: string;
  month: string;
  monthPicker: ReactNode;
  onAdd: () => void;
  onEdit: (e: Entry) => void;
  undo?: () => void;
}) {
  const [filter, setFilter] = useState('all');
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('all');
  const summary = monthSummary(ledger, month, today);
  const entries = ledger.entries
    .filter(
      (e) =>
        monthOf(e.date) === month &&
        (filter === 'all' ||
          (filter === 'adjust'
            ? e.kind.startsWith('transfer')
            : filter === 'expense'
              ? ['expense', 'refund'].includes(e.kind)
              : e.kind === filter)) &&
        (category === 'all' || e.categoryId === category) &&
        `${e.note} ${ledger.categories.find((c) => c.id === e.categoryId)?.name || ''}`
          .toLowerCase()
          .includes(query.toLowerCase()),
    )
    .sort(sortEntries);
  const dates = [...new Set(entries.map((e) => e.date))];
  return (
    <>
      <div className="toolbar">
        {monthPicker}
        <div className="toolbar-actions">
          {undo && (
            <button className="secondary" onClick={undo}>
              <Undo2 size={17} />
              撤销删除
            </button>
          )}
          <button onClick={onAdd}>
            <Plus size={18} />
            记一笔
          </button>
        </div>
      </div>
      <div className="stat-strip">
        <Detail label="本月收入" value={summary.income} />
        <Detail label="本月净支出" value={summary.expenses - summary.refunds} />
        <Detail label="收支差额" value={summary.income - summary.expenses + summary.refunds} />
      </div>
      <section className="panel">
        <div className="ledger-filters">
          <div className="segmented">
            {[
              ['all', '全部'],
              ['expense', '支出'],
              ['income', '收入'],
              ['adjust', '调整'],
            ].map(([id, label]) => (
              <button
                key={id}
                className={cn(filter === id && 'selected')}
                onClick={() => setFilter(id)}
              >
                {label}
              </button>
            ))}
          </div>
          <label className="search-field">
            <Search size={17} />
            <input
              aria-label="搜索账单备注或分类"
              placeholder="搜索备注、分类"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </label>
          <select
            aria-label="筛选分类"
            value={category}
            onChange={(e) => setCategory(e.target.value)}
          >
            <option value="all">全部分类</option>
            {ledger.categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </div>
        {dates.length ? (
          dates.map((date) => (
            <section key={date} className="day-group">
              <h3>
                {dateTitle(date, today)}
                <span>{date}</span>
              </h3>
              <EntryList
                entries={entries.filter((e) => e.date === date)}
                ledger={ledger}
                today={today}
                onSelect={onEdit}
              />
            </section>
          ))
        ) : (
          <Empty onAdd={onAdd} />
        )}
      </section>
    </>
  );
}

function StatsPage({
  ledger,
  month,
  today,
  picker,
}: {
  ledger: Ledger;
  month: string;
  today: string;
  picker: ReactNode;
}) {
  const [selectedDay, setSelectedDay] = useState<string | null>(null);
  const s = monthSummary(ledger, month, today);
  const entries = ledger.entries.filter((e) => monthOf(e.date) === month);
  const groups = ledger.categories
    .filter((c) => c.kind === 'expense')
    .map((c) => ({
      ...c,
      amount: entries
        .filter((e) => e.categoryId === c.id)
        .reduce(
          (v, e) => v + (e.kind === 'expense' ? e.cents : e.kind === 'refund' ? -e.cents : 0),
          0,
        ),
    }))
    .filter((c) => c.amount !== 0)
    .sort((a, b) => b.amount - a.amount);
  const total = s.expenses - s.refunds;
  const days = Array.from({ length: monthDays(month) }, (_, i) => {
    const date = `${month}-${String(i + 1).padStart(2, '0')}`;
    return {
      date,
      amount: entries
        .filter((e) => e.date === date && e.kind === 'expense')
        .reduce((sum, e) => sum + e.cents, 0),
    };
  });
  const max = Math.max(...days.map((d) => d.amount), 1);
  const selected = days.find((d) => d.date === selectedDay) ||
    days.find((d) => d.date === (month === monthOf(today) ? today : days[days.length - 1].date))!;
  const expenseEntriesOn = (date: string) =>
    entries.filter((entry) => entry.date === date && entry.kind === 'expense').sort(sortEntries);
  return (
    <>
      <div className="toolbar">
        {picker}
        <span className="muted">按实际发生日期统计</span>
      </div>
      {month === monthOf(ledger.initial.date) && (
        <p className="notice">
          <Info size={17} />
          余额基准日为 {ledger.initial.date}
          。所有已记录的历史收支均参与余额和跨月结转计算。
        </p>
      )}
      <div className="stat-strip">
        <Detail label="本月收入" value={s.income} />
        <Detail label="本月净支出" value={total} />
        <Detail label="收支差额" value={s.income - total} />
      </div>
      <div className="stats-grid">
        <section className="panel padded">
          <div className="section-heading">
            <h2>支出花在哪里</h2>
            <span className="tag">分类排行</span>
          </div>
          {!groups.length ? (
            <Empty />
          ) : (
            <div className="category-chart">
              {groups.map((g, i) => (
                <div key={g.id}>
                  <div className="chart-label">
                    <span>
                      <small>{String(i + 1).padStart(2, '0')}</small>
                      {g.name}
                    </span>
                    <strong>¥{money(g.amount)}</strong>
                  </div>
                  {total > 0 && groups.every((c) => c.amount >= 0) && (
                    <div className="bar-track">
                      <span style={{ width: `${(g.amount / total) * 100}%` }} />
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
          <p className="chart-note">退款按到账月抵减支出，结转和内部划转不计入收支。</p>
        </section>
        <section className="panel padded">
          <div className="section-heading">
            <h2>预算从哪里来</h2>
            <Info size={17} />
          </div>
          <div className="detail-lines">
            <Detail label="期初预算（含上月欠款）" value={s.openingBudget} />
            <Detail label="本月收入" value={s.income} />
            <Detail label="本月到账退款" value={s.refunds} />
            <Detail label="历史结余净转入" value={s.transfers} />
            <Detail label="本月支出" value={-s.expenses} />
            <Detail label="本月预算余额" value={s.budget} />
          </div>
          <p className="chart-note">预算余额与收支差额不同，前者还考虑结转和资金划转。</p>
        </section>
      </div>
      <section className="panel padded daily-chart">
        <div className="section-heading">
          <h2>每天的消费节奏</h2>
          <span className="muted">单位：元 · 点击查看明细</span>
        </div>
        <div className="columns" aria-label="每日支出柱状图">
          {days.map((d) => (
            <div className="column-item" key={d.date}>
              <button
                onClick={() => setSelectedDay(d.date)}
                disabled={d.date > today}
                aria-pressed={selected.date === d.date}
                aria-label={`${d.date} 支出 ${money(d.amount)} 元`}
                title={`${d.date}：¥${money(d.amount)}`}
                style={{ height: `${Math.max((d.amount / max) * 100, 2)}%` }}
              />
              <span>{Number(d.date.slice(8))}</span>
            </div>
          ))}
        </div>
        <div role="status">
          <div className="daily-table">
            {[selected]
              .map((d) => {
                const dayEntries = expenseEntriesOn(d.date);
                return (
                  <div className="daily-summary-row" key={d.date}>
                    <div className="daily-summary-head">
                      <span>{d.date}</span>
                      <strong>¥{money(d.amount)}</strong>
                    </div>
                    {dayEntries.length ? (
                      <div className="daily-entry-details" aria-label={`${d.date} 的消费记录`}>
                        {dayEntries.map((entry) => {
                          const category = ledger.categories.find((item) => item.id === entry.categoryId);
                          return (
                            <div className="daily-entry-detail" key={entry.id}>
                              <span>
                                <b>{category?.name || '未分类'}</b>
                                <small>{entry.note || '无备注'}</small>
                              </span>
                              <strong>−¥{money(entry.cents)}<small className={cn('entry-balance', (entryBalances(ledger).get(entry.id) ?? 0) < 0 && 'danger')}>{balanceText(entryBalances(ledger).get(entry.id) ?? 0)}</small></strong>
                            </div>
                          );
                        })}
                      </div>
                    ) : (
                      <small className="daily-empty">当天没有消费记录</small>
                    )}
                  </div>
                );
              })}
          </div>
        </div>
      </section>
    </>
  );
}

function Onboarding({
  busy,
  onCreate,
}: {
  busy: boolean;
  onCreate: (value: Ledger) => Promise<void>;
}) {
  const restoreFile = useRef<HTMLInputElement>(null);
  const [received, setReceived] = useState(false);
  const [allowance, setAllowance] = useState('2000');
  const [debt, setDebt] = useState('0');
  const [reserve, setReserve] = useState('0');
  const [error, setError] = useState('');
  return (
    <main className="onboarding">
      <section className="welcome-story">
        <div className="brand">
          <span className="brand-icon">
            <Wallet size={26} />
          </span>
          KWallet
        </div>
        <div className="welcome-copy">
          <span className="eyebrow">A LITTLE CLARITY, EVERY DAY</span>
          <h1>
            把生活费安排好，
            <br />
            把日子过自在。
          </h1>
          <p>
            记下每一笔，算好每一天。
            <br />
            花多一点，或省下一点，接下来的预算都会跟着调整。
          </p>
          <div className="welcome-features">
            <span>
              <Check size={17} />
              每日额度，自动计算
            </span>
            <span>
              <Check size={17} />
              欠款结转，结余留存
            </span>
            <span>
              <Check size={17} />
              离线可记，数据在本机
            </span>
          </div>
        </div>
        <small>YOUR MONEY. YOUR OWN PACE.</small>
      </section>
      <section className="welcome-form">
        <div className="eyebrow">从今天开始</div>
        <h2>你好，创建你的生活账本。</h2>
        <p className="muted">不用补齐过去的记录，先从现在开始。</p>
        <form
          onSubmit={async (event) => {
            event.preventDefault();
            setError('');
            try {
              const date = todayLocal();
              const allowanceCents = parseMoney(allowance);
              const debtCents = parseMoney(debt);
              const value = newLedger(
                date,
                (received ? allowanceCents : 0) - debtCents,
                parseMoney(reserve),
                allowanceCents,
              );
              value.initial.allowanceReceived = received;
              if (received) {
                const receipt = initialAllowanceEntry(value);
                if (!receipt) throw new Error('已到账的生活费金额需要大于零');
                value.entries.push(receipt);
              }
              await onCreate(value);
            } catch (e) {
              setError(errorText(e));
            }
          }}
        >
          <MoneyField
            label="每月常用生活费"
            value={allowance}
            onChange={setAllowance}
            hint="勾选下方“已到账”后，按这个金额计入本月预算。"
          />
          <MoneyField
            label="上月欠款"
            value={debt}
            onChange={setDebt}
            hint="没有欠款填 0；欠款会从本月生活费中扣除。"
          />
          <label className="checkbox-field">
            <input
              type="checkbox"
              checked={received}
              onChange={(e) => setReceived(e.target.checked)}
            />
            <span>本月生活费已到账</span>
          </label>
          <MoneyField
            label="之前攒下的历史结余"
            value={reserve}
            onChange={setReserve}
            hint="单独保留，不自动参与每天的预算。"
          />
          {error && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}
          <button className="full" disabled={busy} type="submit">
            {busy ? '正在创建…' : '开启我的账本'}
            <ArrowRight size={18} />
          </button>
        </form>
        <button
          className="secondary full"
          disabled={busy}
          onClick={() => restoreFile.current?.click()}
        >
          <Upload size={17} />
          已有账本？从完整备份恢复
        </button>
        <input
          ref={restoreFile}
          type="file"
          accept="application/json,.json"
          className="visually-hidden"
          aria-label="首次使用恢复备份"
          onChange={async (event) => {
            const selected = event.target.files?.[0];
            event.target.value = '';
            if (!selected) return;
            setError('');
            try {
              if (selected.size > 20_000_000) throw new Error('备份不能超过 20 MB');
              await onCreate(parseBackup(await selected.text()));
            } catch (error) {
              setError(errorText(error));
            }
          }}
        />
        <p className="privacy-note">
          <ShieldCheck size={15} />
          无需注册。数据保存在此浏览器，请定期备份。
        </p>
      </section>
    </main>
  );
}

function MoneyField({
  label,
  value,
  onChange,
  hint,
  signed = false,
  autoFocus = false,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  hint?: string;
  signed?: boolean;
  autoFocus?: boolean;
}) {
  return (
    <label className="field">
      <span>{label}</span>
      <div className="money-input">
        <span>¥</span>
        <input
          autoFocus={autoFocus}
          aria-label={label}
          inputMode={signed ? 'text' : 'decimal'}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="0.00"
          required
          maxLength={18}
        />
      </div>
      {hint && <small>{hint}</small>}
    </label>
  );
}
function Dialog({
  title,
  onClose,
  children,
  dirty = false,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  dirty?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const el = ref.current!;
    el.showModal();
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      el.close();
      document.body.style.overflow = previous;
    };
  }, []);
  const close = () => {
    if (!dirty || confirm('有尚未保存的修改，确定离开？')) onClose();
  };
  return (
    <dialog
      ref={ref}
      className="dialog"
      aria-labelledby="dialog-title"
      onCancel={(e) => {
        e.preventDefault();
        close();
      }}
    >
      <div className="dialog-heading">
        <h2 id="dialog-title">{title}</h2>
        <button className="icon-button" aria-label="关闭弹窗" onClick={close}>
          <X size={22} />
        </button>
      </div>
      <div className="dialog-content">{children}</div>
    </dialog>
  );
}

function InstallmentSetup({ entry, busy, onClose, onSave }: {
  entry: Entry; busy: boolean; onClose: () => void;
  onSave: (plan: InstallmentPlan, firstPaid: boolean) => Promise<void>;
}) {
  const [count, setCount] = useState('3');
  const [fee, setFee] = useState('0');
  const [firstDate, setFirstDate] = useState(entry.date);
  const [firstPaid, setFirstPaid] = useState(false);
  const [overrides, setOverrides] = useState<Record<number, string>>({});
  const [error, setError] = useState('');
  let schedule: { dueDate: string; cents: number }[] = [];
  let previewError = '';
  try {
    schedule = installmentSchedule(entry.cents + parseMoney(fee), Number(count), firstDate);
    schedule = schedule.map((period, index) => ({
      ...period, cents: overrides[index] === undefined ? period.cents : parseMoney(overrides[index]),
    }));
    if (schedule.some(p => p.cents <= 0)) throw new Error('每期金额必须大于零');
    if (schedule.reduce((sum, p) => sum + p.cents, 0) !== entry.cents + parseMoney(fee)) throw new Error('各期金额合计必须等于本金加手续费');
  } catch (e) { previewError = errorText(e); }
  return <Dialog title="设置分期" onClose={onClose}>
    <p>原支出 ¥{money(entry.cents)} 将转换为分期计划。只有确认实际扣款的期数才计入余额。</p>
    <label className="field"><span>分期期数（2–120）</span><input type="number" min="2" max="120" value={count} onChange={e => { setCount(e.target.value); setOverrides({}); }} /></label>
    <label className="field"><span>总手续费（元）</span><input inputMode="decimal" value={fee} onChange={e => { setFee(e.target.value); setOverrides({}); }} /></label>
    <label className="field"><span>首期计划日期</span><input type="date" min="2000-01-01" max="2100-12-31" value={firstDate} onChange={e => setFirstDate(e.target.value)} /></label>
    <label className="installment-check"><input type="checkbox" checked={firstPaid} onChange={e => setFirstPaid(e.target.checked)} /> 首期已实际扣款，使用原账单日期 {entry.date} 计入首期</label>
    <p className="explanation">{firstPaid ? '原账单将调整为首期金额，其余各期待确认。' : '原账单将从支出中移除，所有期数待你确认扣款。'}保存后余额和后续预算会重新计算。</p>
    {schedule.map((period, index) => <label className="installment-period" key={index}><span>第 {index + 1} 期 · {period.dueDate}</span><input aria-label={`第 ${index + 1} 期金额`} inputMode="decimal" value={overrides[index] ?? inputMoney(period.cents)} onChange={e => setOverrides({ ...overrides, [index]: e.target.value })} /></label>)}
    {(previewError || error) && <p className="form-error" role="alert">{error || previewError}</p>}
    <button className="full" disabled={busy || !!previewError} onClick={async () => {
      try {
        setError('');
        await onSave({ id: crypto.randomUUID(), categoryId: entry.categoryId!, note: entry.note, principal: entry.cents, fee: parseMoney(fee), periods: schedule }, firstPaid);
      } catch (e) { setError(errorText(e)); }
    }}>确认转换为分期</button>
  </Dialog>;
}

function InstallmentPayment({ plan, index, today, busy, onClose, onSave }: {
  plan: InstallmentPlan; index: number; today: string; busy: boolean; onClose: () => void; onSave: (entry: Entry) => Promise<void>;
}) {
  const [date, setDate] = useState(today);
  const [value, setValue] = useState(inputMoney(plan.periods[index].cents));
  const [error, setError] = useState('');
  return <Dialog title={`确认第 ${index + 1} 期扣款`} onClose={onClose}>
    <p>计划扣款 {plan.periods[index].dueDate} · ¥{money(plan.periods[index].cents)}</p>
    <label className="field"><span>实际扣款日期</span><input type="date" min="2000-01-01" max={today} value={date} onChange={e => setDate(e.target.value)} /></label>
    <label className="field"><span>实际扣款金额（元）</span><input inputMode="decimal" value={value} onChange={e => setValue(e.target.value)} /></label>
    {error && <p className="form-error" role="alert">{error}</p>}
    <button className="full" disabled={busy} onClick={async () => {
      try {
        const cents = parseMoney(value);
        if (cents <= 0 || !date || date > today) throw new Error('请输入有效的实际扣款日期和金额');
        await onSave({ id: crypto.randomUUID(), kind: 'expense', cents, date, categoryId: plan.categoryId, note: plan.note, createdAt: Date.now() });
      } catch (e) { setError(errorText(e)); }
    }}>确认实际扣款</button>
  </Dialog>;
}

function EntryModal({
  ledger,
  today,
  modal,
  busy,
  onClose,
  onSave,
  onDelete,
  onRefund,
  onInstallment,
}: {
  ledger: Ledger;
  today: string;
  modal: Extract<NonNullable<Modal>, { type: 'entry' }>;
  busy: boolean;
  onClose: () => void;
  onSave: (e: Entry) => Promise<void>;
  onDelete?: () => Promise<void>;
  onRefund: (e: Entry) => void;
  onInstallment: (e: Entry) => void;
}) {
  const { entry, kind, original } = modal;
  const installment = entry && ledger.installments?.find(p => p.periods.some(period => period.entryId === entry.id));
  const [amount, setAmount] = useState(
    entry ? inputMoney(entry.cents) : modal.allowance ? inputMoney(ledger.settings.allowance) : '',
  );
  const [date, setDate] = useState(entry?.date || today);
  const [note, setNote] = useState(entry?.note || '');
  const categories = ledger.categories.filter(
    (c) =>
      c.kind === (kind === 'income' ? 'income' : 'expense') &&
      (!c.archived || c.id === entry?.categoryId),
  );
  const [category, setCategory] = useState(
    original?.categoryId || entry?.categoryId || categories[0]?.id || '',
  );
  const [error, setError] = useState('');
  const [dirty, setDirty] = useState(false);
  const id = useRef(entry?.id || crypto.randomUUID());
  const initialRevision = useRef(ledger.revision);
  const hasCategory = ['income', 'expense'].includes(kind);
  async function submit(event: FormEvent) {
    event.preventDefault();
    setError('');
    try {
      if (ledger.revision !== initialRevision.current)
        throw new Error('账本已更新，请关闭后重新打开此表单');
      const cents = parseMoney(amount);
      if (cents <= 0) throw new Error('请输入大于零的金额');
      const next: Entry = {
        id: id.current,
        kind,
        cents,
        date,
        note: note.trim(),
        categoryId: hasCategory || kind === 'refund' ? category : null,
        createdAt: entry?.createdAt || Date.now(),
        ...(kind === 'refund' ? { originalId: entry?.originalId || original?.id } : {}),
        ...(modal.allowance || entry?.allowanceMonth ? { allowanceMonth: monthOf(date) } : {}),
      };
      await onSave(next);
    } catch (e) {
      setError(errorText(e));
    }
  }
  const refunded = entry
    ? ledger.entries.filter((e) => e.originalId === entry.id).reduce((s, e) => s + e.cents, 0)
    : 0;
  if (entry?.includedInInitialBalance) {
    return (
      <Dialog title="生活费已入账" onClose={() => !busy && onClose()}>
        <p>
          这笔 ¥{money(entry.cents)} 生活费在首次设置时已确认到账，并且已经包含在你的起始余额中。
        </p>
        <div className="detail-lines">
          <div>
            <span>确认日期</span>
            <strong>{entry.date}</strong>
          </div>
          <div>
            <span>余额处理</span>
            <strong>已计入起始余额</strong>
          </div>
        </div>
        <p className="explanation">
          它会显示在账单和收入统计中，但不会再次增加可用钱，避免首次设置时重复计算。
        </p>
        <button className="full" onClick={onClose}>
          知道了
        </button>
      </Dialog>
    );
  }
  return (
    <Dialog
      title={modal.allowance ? '确认生活费到账' : `${entry ? '编辑' : '记录'}${kindLabel[kind]}`}
      onClose={() => !busy && onClose()}
      dirty={dirty}
    >
      <form onSubmit={submit} onChange={() => setDirty(true)}>
        {installment && <p className="explanation">这是已确认的分期付款，可修改实际金额和日期。分类、删除和退款暂不可修改。</p>}
        {entry?.kind === 'expense' && <p className="explanation">{balanceText(entryBalances(ledger).get(entry.id) ?? 0)}</p>}
        <MoneyField
          label="金额"
          autoFocus
          value={amount}
          onChange={setAmount}
          hint={kind.startsWith('transfer') ? '这是内部资金划转，不计入收入或支出。' : undefined}
        />
        {hasCategory && (
          <fieldset className="category-select">
            <legend>分类</legend>
            {categories.map((c) => {
              const Icon = categoryIcon(c);
              return (
                <button
                  key={c.id}
                  type="button"
                  disabled={!!installment && c.id !== entry?.categoryId}
                  className={cn(category === c.id && 'selected')}
                  onClick={() => {
                    setCategory(c.id);
                    setDirty(true);
                  }}
                >
                  <Icon size={19} />
                  {c.name}
                </button>
              );
            })}
            {!categories.length && <p className="form-error">请先在设置中添加或启用一个分类。</p>}
          </fieldset>
        )}
        <DatePicker
          value={date}
          min={
            kind.startsWith('transfer')
              ? ledger.initial.date
              : kind === 'refund'
                ? original?.date ||
                  ledger.entries.find((e) => e.id === entry?.originalId)?.date ||
                  MIN_LEDGER_DATE
                : MIN_LEDGER_DATE
          }
          max={today}
          onChange={(value) => {
            setDate(value);
            setDirty(true);
          }}
        />
        <label className="field">
          <span>
            备注 <small>选填</small>
          </span>
          <input
            placeholder="这一笔，记点什么？"
            value={note}
            maxLength={200}
            onChange={(e) => setNote(e.target.value)}
          />
        </label>
        {kind === 'refund' && (
          <p className="explanation">退款按实际到账日恢复预算，并抵减到账月份的支出。</p>
        )}
        {modal.allowance && (
          <p className="explanation">
            仅在实际收到生活费后确认。上月欠款会自动扣减本月可分配额度。
          </p>
        )}
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <button className="full" disabled={busy || (hasCategory && !category)} type="submit">
          {busy ? '正在保存…' : '保存记录'}
          <Check size={18} />
        </button>
      </form>
      {entry && (
        <div className="entry-options">
          {entry.kind === 'expense' && !installment && refunded < entry.cents && (
            <button
              className="secondary"
              disabled={busy}
              onClick={() => {
                if (!dirty || confirm('放弃尚未保存的修改，记录退款？')) onRefund(entry);
              }}
            >
              <Undo2 size={16} />
              记录退款{refunded > 0 && `（已退 ${money(refunded)}）`}
            </button>
          )}
          {entry.kind === 'expense' && !installment && refunded === 0 && <button className="secondary" disabled={busy} onClick={() => { if (!dirty || confirm('放弃尚未保存的修改，设置分期？')) onInstallment(entry); }}>设置分期</button>}
          {!installment && <button className="danger-button" disabled={busy} onClick={() => void onDelete?.()}>
            <Trash2 size={16} />
            删除记录
          </button>}
        </div>
      )}
    </Dialog>
  );
}

type Write = (
  change: (current: Ledger | null) => Ledger,
  expected?: number,
  preserve?: boolean,
) => Promise<Ledger>;
function SettingsPage({
  ledger,
  busy,
  install,
  onInstall,
  write,
  onToast,
  onCategories,
  onImport,
  onFunds,
}: {
  ledger: Ledger;
  busy: boolean;
  install: InstallEvent | null;
  onInstall: () => Promise<void>;
  write: Write;
  onToast: (v: string) => void;
  onCategories: () => void;
  onImport: (v: Ledger) => void;
  onFunds: () => void;
}) {
  const [allowance, setAllowance] = useState(inputMoney(ledger.settings.allowance));
  const [persistence, setPersistence] = useState('');
  const file = useRef<HTMLInputElement>(null);
  useEffect(() => setAllowance(inputMoney(ledger.settings.allowance)), [ledger.settings.allowance]);
  const settingsRevision = useRef(ledger.revision);
  useEffect(() => {
    settingsRevision.current = ledger.revision;
  }, [ledger.revision]);
  return (
    <div className="settings-grid">
      <section className="panel padded">
        <div className="section-heading">
          <h2>生活费与预算</h2>
          <Wallet size={20} />
        </div>
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            try {
              const cents = parseMoney(allowance);
              await write((current) => {
                current!.settings.allowance = cents;
                return current!;
              }, settingsRevision.current);
              onToast('常用生活费已更新，不会自动计入收入');
            } catch (error) {
              onToast(errorText(error));
            }
          }}
        >
          <MoneyField
            label="每月常用生活费"
            value={allowance}
            onChange={setAllowance}
            hint="实际到账时点一次确认，也可以修改当次金额。"
          />
          <button type="submit" disabled={busy}>
            保存设置
          </button>
        </form>
        <button className="setting-row" onClick={onFunds}>
          <span>
            <strong>历史结余与资金划转</strong>
            <small>结余单独留存，欠款占用下月额度</small>
          </span>
          <ChevronRight size={19} />
        </button>
        <button className="setting-row" onClick={onCategories}>
          <span>
            <strong>分类管理</strong>
            <small>添加分类、停用不常用的分类</small>
          </span>
          <ChevronRight size={19} />
        </button>
        <div className="theme-control">
          <strong>外观主题</strong>
          <div className="segmented">
            {(
              [
                { id: 'system', icon: Monitor, label: '跟随系统' },
                { id: 'light', icon: Sun, label: '浅色' },
                { id: 'dark', icon: Moon, label: '深色' },
              ] as const
            ).map((t) => (
              <button
                key={t.id}
                disabled={busy}
                className={cn(ledger.settings.theme === t.id && 'selected')}
                onClick={async () => {
                  try {
                    await write((current) => {
                      current!.settings.theme = t.id as Theme;
                      return current!;
                    });
                  } catch (e) {
                    onToast(errorText(e));
                  }
                }}
              >
                <t.icon size={16} />
                {t.label}
              </button>
            ))}
          </div>
        </div>
      </section>
      <section className="panel padded">
        <div className="section-heading">
          <h2>数据由你保管</h2>
          <ShieldCheck size={20} />
        </div>
        <p className="muted">账单只存于此设备和浏览器。换手机、清理网站数据前，请先导出备份。</p>
        <button
          className="setting-row"
          onClick={() => {
            backup(ledger);
            onToast('已发起备份下载，请确认文件已保存');
          }}
        >
          <span className="setting-title">
            <Download size={20} />
            <span>
              <strong>导出完整备份</strong>
              <small>包含所有账单、分类、余额与设置</small>
            </span>
          </span>
          <ChevronRight size={18} />
        </button>
        <button className="setting-row" onClick={() => file.current?.click()}>
          <span className="setting-title">
            <Upload size={20} />
            <span>
              <strong>从备份恢复</strong>
              <small>先校验文件，再确认替换</small>
            </span>
          </span>
          <ChevronRight size={18} />
        </button>
        <input
          ref={file}
          type="file"
          accept="application/json,.json"
          className="visually-hidden"
          aria-label="选择备份文件"
          onChange={async (e) => {
            const selected = e.target.files?.[0];
            e.target.value = '';
            if (!selected) return;
            try {
              if (selected.size > 20_000_000) throw new Error('备份不能超过 20 MB');
              onImport(parseBackup(await selected.text()));
            } catch (error) {
              onToast(errorText(error));
            }
          }}
        />
        <button className="setting-row" onClick={() => exportCsv(ledger)}>
          <span className="setting-title">
            <List size={20} />
            <span>
              <strong>导出 CSV 表格</strong>
              <small>便于查看，不用于完整恢复</small>
            </span>
          </span>
          <ChevronRight size={18} />
        </button>
        <button
          className="text-button"
          onClick={async () => {
            const previous = await loadLedger('before-restore');
            if (previous) backup(previous, 'before-restore-');
            else onToast('尚无恢复前备份');
          }}
        >
          下载最近一次恢复前的账本
        </button>
        <div className="explanation">
          <button
            className="text-button"
            onClick={async () => {
              try {
                const ok = await requestPersistence();
                setPersistence(
                  ok
                    ? '已获得持久存储许可，但手动清除数据仍会删除账本。'
                    : '浏览器未授予持久存储，请继续定期备份。',
                );
              } catch {
                setPersistence('无法申请持久存储，请定期备份。');
              }
            }}
          >
            申请持久存储保护 <ArrowRight size={15} />
          </button>
          <p>{persistence || '尽量减少浏览器自动回收数据，不能替代备份。'}</p>
        </div>
      </section>
      <section className="panel padded">
        <div className="section-heading">
          <h2>随时打开，随手记</h2>
          <Monitor size={20} />
        </div>
        <p className="muted">
          在安卓 Chrome / Edge
          菜单中选择“安装应用”或“添加到主屏幕”。首次联网完成缓存后，可离线使用。
        </p>
        {install && <AsyncButton label="添加到手机桌面" busy={false} onClick={onInstall} />}
        <p className="chart-note">应用更新后请在表单保存完成时更新。手机与电脑的数据各自独立。</p>
      </section>
      <section className="panel padded rules-panel">
        <h2>你的预算规则</h2>
        <ol>
          <li>每月生活费到账后手动确认。</li>
          <li>月末剩余转为历史结余，不自动参与下月预算。</li>
          <li>上月欠款扣减下月预算，不重复计为下月支出。</li>
          <li>今天的消费扣减今日额度，剩余资金重新安排往后的日期。</li>
        </ol>
      </section>
    </div>
  );
}

function CategoryModal({
  ledger,
  busy,
  write,
  onClose,
}: {
  ledger: Ledger;
  busy: boolean;
  write: Write;
  onClose: () => void;
}) {
  const [name, setName] = useState('');
  const [kind, setKind] = useState<'expense' | 'income'>('expense');
  const [error, setError] = useState('');
  return (
    <Dialog title="管理收支分类" onClose={() => !busy && onClose()}>
      <div className="category-management">
        {ledger.categories.map((c) => (
          <div key={c.id}>
            <span>
              {c.name}
              <small>
                {c.kind === 'expense' ? '支出' : '收入'}
                {c.archived && ' · 已停用'}
              </small>
            </span>
            <button
              className="secondary"
              disabled={busy}
              onClick={async () => {
                try {
                  await write((current) => {
                    const target = current!.categories.find((x) => x.id === c.id)!;
                    target.archived = !target.archived;
                    return current!;
                  });
                } catch (e) {
                  setError(errorText(e));
                }
              }}
            >
              {c.archived ? '启用' : '停用'}
            </button>
          </div>
        ))}
      </div>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          setError('');
          try {
            if (!name.trim()) throw new Error('请输入分类名');
            await write((current) => {
              if (current!.categories.some((c) => c.name === name.trim() && c.kind === kind))
                throw new Error('此分类已存在');
              current!.categories.push({
                id: crypto.randomUUID(),
                name: name.trim(),
                kind,
                archived: false,
              });
              return current!;
            });
            setName('');
          } catch (err) {
            setError(errorText(err));
          }
        }}
      >
        <label className="field">
          <span>新分类名称</span>
          <input value={name} onChange={(e) => setName(e.target.value)} maxLength={20} required />
        </label>
        <label className="field">
          <span>分类类型</span>
          <select value={kind} onChange={(e) => setKind(e.target.value as 'expense' | 'income')}>
            <option value="expense">支出</option>
            <option value="income">收入</option>
          </select>
        </label>
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <button className="full" disabled={busy} type="submit">
          <Plus size={18} />
          添加分类
        </button>
      </form>
    </Dialog>
  );
}

function AsyncButton({
  label,
  busy,
  onClick,
}: {
  label: string;
  busy: boolean;
  onClick: () => Promise<void>;
}) {
  const [error, setError] = useState('');
  const [working, setWorking] = useState(false);
  return (
    <>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      <button
        className="full"
        disabled={busy || working}
        onClick={async () => {
          setWorking(true);
          setError('');
          try {
            await onClick();
          } catch (e) {
            setError(errorText(e));
          } finally {
            setWorking(false);
          }
        }}
      >
        {busy || working ? '正在处理…' : label}
      </button>
    </>
  );
}
