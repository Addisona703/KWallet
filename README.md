# KWallet

给自己用的生活费记账 PWA。手机浏览器打开并添加到桌面，首次联网完成缓存后可离线记账。

## 已实现

- 首次使用：设置常用生活费、本月起始余额、独立历史结余；可标记本月生活费已包含在余额中。
- 首页：今日可花/超支、今日预算、今日已花、本月余额/缺口、剩余天数、后续日均。
- 收入、支出、修改、删除和撤销最近一次删除；分类筛选、备注搜索、日期分组。
- 历史日期补记：普通收支可选择 2000-01-01 到今天；全部收支按实际发生日期参与余额和跨月计算。
- 生活费到账确认，同月只确认一次；其他补充收入可另行添加。
- 正结余进入历史结余，负余额占用下月资金；跨月按账单重算，无重复结转。
- 历史结余与本月预算之间划转；跨月退款和原支出关联。
- 月度收支、分类排行、每日支出图及文字明细。
- 分类添加/停用、浅色/深色/跟随系统。
- JSON 完整备份、校验后恢复、恢复前本机副本、CSV 导出。
- IndexedDB 事务存储、并发写入保护、跨标签页通知、持久存储申请。
- 离线缓存、桌面安装信息和新版本更新提示。

## 本地运行

要求 Node.js 22.12+ 或 24 LTS，推荐 Node.js 24。无需 Android Studio、安卓 SDK 或服务器数据库。

```powershell
npm ci
npm run dev
```

浏览器打开终端显示的本地地址。开发模式没有离线缓存，离线能力需用生产构建验证。

```powershell
npm test
npm run build
npm run preview
```

## 部署到 GitHub Pages

目标仓库名：`KWallet`。仓库中只提交代码，不提交真实账本、备份、密钥或 node_modules。

1. 登录 GitHub，创建 `KWallet` 仓库。免费账户使用 Pages 时选择公开仓库。
2. 将本项目推送到仓库的 `main` 分支。
3. 仓库 Settings → Pages → Build and deployment → Source 选择 **GitHub Actions**。
4. 在 Actions 页面运行 **Deploy KWallet to GitHub Pages**，或向 main 推送更新。
5. 等待 build、deploy 成功，访问 `https://<你的用户名>.github.io/KWallet/`。

仓库未创建时，可在本机完成 `gh auth login --web --git-protocol https --scopes workflow` 后使用：

```powershell
git init -b main
git add .
git commit -m "Build KWallet offline expense tracker"
gh repo create KWallet --public --source . --remote origin --push
```

随后在 GitHub 设置 Pages Source 为 GitHub Actions，再手动运行部署工作流。若仓库已存在，使用对应远程地址，不要再次创建。当前交付尚未登录 GitHub、创建远程仓库或发布。

工作流会运行 `npm ci`、单元测试、生产构建并部署。资源、manifest 与 Service Worker 的 base/scope 由实际仓库名生成。默认流程适用于项目站点；若改用 `<用户名>.github.io` 根站点或自定义域名，应把构建 `BASE_PATH` 改为 `/`。

模拟仓库子路径的构建：

```powershell
$env:BASE_PATH='/KWallet/'
npm run build
npm run preview
```

打开预览服务的 `/KWallet/`。浏览器不需要前端 history 路由，刷新任意功能页面不会请求不存在的服务器路径。

## 浏览器验证

```powershell
# 本机配置使用已安装的 Chrome；CI 使用 Playwright Chromium。
$env:BASE_PATH='/KWallet/'
npm run build
npx playwright test
```

在 CI 中运行浏览器测试前需要 `npx playwright install --with-deps chromium`。默认 Pages 工作流不下载浏览器，仅运行核心单元测试和构建。

若已有预览服务，可设置 `$env:E2E_PORT='4175'` 复用该端口；测试仍使用隔离浏览器上下文，不修改预览浏览器中的用户账本。

## 预算口径

金额按整数分存储。日预算向下取整，零头留在余额。当天新增收入、到账退款及净转入会重分配额度；当天消费直接扣除当天额度。

```text
下月历史结余 = 原历史结余 + max(月末本月余额, 0)
下月期初预算 = min(月末本月余额, 0)

今日预算 = floor(max(日初本月余额 + 今日补充, 0) / 剩余天数含今天)
今日可花 = max(今日预算 - 今日支出, 0)
```

欠款指生活费超支缺口，尚无真实借款人与还款管理。期初余额和内部划转不计收入；欠款结转不重复计支出；退款按实际到账月抵减支出。

起始日期是余额基准日，不是禁止补记的下限。全部收支均参与预算和结转计算，旧版本的“仅补历史”标记不再影响计算，无需逐条修改旧账单。基准月的起始资金不会错误提前到旧月份参与结转。内部划转仍从基准日起记录，退款不能早于原支出。

## 数据与使用边界

- 所有账单只存在当前浏览器当前网站的 IndexedDB；无账号和云同步。
- 手机与电脑、不同浏览器、不同站点域名的数据互不共享。更换网址或设备前请导出备份。
- 清除网站数据、浏览器回收存储或设备损坏可能丢失本地数据。持久存储申请不能替代备份。
- JSON 完整备份可恢复；CSV 用于表格查看，不能恢复完整账本。备份文件包含个人账单，请妥善保管。
- 初次访问及更新需要网络。离线可用状态取决于首次应用缓存成功；安卓浏览器实际桌面安装仍需在部署后验证。
- “预算净余额”是预算维度，不是银行卡、现金或支付账户的资产对账。
- 自动月度结转无需后台常驻：打开、回到页面、跨过午夜都会根据当前本地日期计算。

## 结构

```text
src/domain/ledger.ts       纯预算、结转和数据校验逻辑
src/data/store.ts          IndexedDB 事务、备份和导出
src/ui/App.tsx             四个入口和操作表单
src/ui/style.css           手机/桌面与明暗主题
tests/browser/            生产版本端到端测试
.github/workflows/        GitHub Pages 自动发布
docs/product-design.md    产品与业务规则
```

本项目不需要运行时密钥，也不包含任何访问 GitHub 的凭证。

## 跨月欠款测试数据

线上示例：[下载模拟账本](https://addisona703.github.io/KWallet/test-data/monthly-debt-demo.json)。在设置 → 从备份恢复中选择 JSON 文件；恢复会替换当前账本，请先导出完整备份。

该文件仅含模拟记录：2026 年 10 月收入 1500 元、支出 1700 元，欠款 200 元结转到 11 月；11 月收入 1500 元、支出 40 元，截至 11 月 2 日预算余额为 1260 元，历史结余 300 元单独保留。
