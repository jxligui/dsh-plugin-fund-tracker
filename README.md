# dsh-plugin-fund-tracker / 基金小助理

DeepSeek Harness（DSH）客户端插件：在窗口右缘提供常驻悬浮入口，查看大盘指数、基金行情与自己的持仓，附带每日净值、盈亏跟踪、自定义分组与金额制交易。不占用聊天页面空间。

用法详见 [docs/DETAIL.md](docs/DETAIL.md)，架构设计见 [docs/DESIGN.md](docs/DESIGN.md)。

## 功能

- **今日行情**：大盘指数（分页、含现价/涨跌幅/涨跌额、★ 加自选）、全部基金与 ETF 实时行情、基金检索；可在设置中切换「在售基金 / 全部基金」。
- **我的自选**：自选大盘指数与自选基金。已是持仓的基金显示「加仓/减仓」，未持仓的可「加入持仓」或「取消自选」。
- **持仓基金**：资产总览、按自定义分组查看、排序、紧凑卡片列表。卡片默认显示名称/金额/净值/成本/份额/收益率，展开可加仓、减仓、编辑、移入分组、移除。
- **自定义分组**：新建/改名/删除分组；「未分组」里的基金可勾选后批量分配到已有分组；已在持仓的基金不能取消自选。
- **金额制交易**：加仓/减仓只填金额，按确认日净值自动折算份额（普通 T+1、QDII T+2），确认前金额计入持仓金额。
- **批量导入**：每行「基金代码 金额」，自动按最新净值折算份额与成本；取不到净值时记为待确认，后续自动折算。
- **本地净值库**：每只基金近 15 日净值 + 全库在售基金最新净值自动同步并落库，后台定时更新（Host 启动后自动运行，无需打开面板）。
- **详情**：净值走势、区间涨幅与最新净值。
- **Tab 布局**：一级、二级页签均可拖动排序，顺序与当前页保存在本机。

## 在 DSH 中安装

### 方式一：GitHub 地址安装（推荐）

1. 打开 Harness 左侧导航的**插件（Plugins）页面** → **添加插件（Add plugin）**。
2. 在规格（spec）输入框填入仓库地址：

   ```text
   github:jxligui/dsh-plugin-fund-tracker
   ```

   也可填 `https://github.com/jxligui/dsh-plugin-fund-tracker.git`。要锁定版本，在末尾加上发布标签，例如 `github:jxligui/dsh-plugin-fund-tracker#v2.5.3`。
3. 确认安装（名称/版本检查 → 安装 → 完成）。安装器会先用 `git ls-remote` 检查仓库可达性，再由 pnpm 拉取，不需要手动 clone。
4. **完全重启一次 DeepSeek Harness**，让新的客户端模块代际生效。重启后窗口右缘出现竖排的「基金」悬浮条，点击即可展开面板。

如果手边有带 `plugin_manager` 工具的 Agent，一次调用即可完成安装：

```
plugin_manager install_bundle target="github:jxligui/dsh-plugin-fund-tracker#v2.5.3"
```

### 方式二：本地目录安装（开发调试）

插件页 → **添加插件**，把规格切换为本地路径，指向本仓库的检出目录（例如 `D:\WorkSpace\DeepSeek\fund-tracker`）。profile 会以 link 方式链接该目录，改完代码重启应用即可生效（客户端模块需要完整重启才会加载新代际）。也可用 `plugin_manager install_bundle` 并以目录为 target。

### 安装后 / 更新 / 卸载

- **登录**：个人页（我的自选 / 持仓基金）需要 DSH 登录账号；行情页公开，无需登录。
- **数据库**：安装插件本身不附带任何数据库文件。重启 DSH 后由 Host 自动创建 SQLite 库并联网下载基金基础库与净值数据，全程无需手动干预。
- **更新**：插件页该卡片出现**更新**控件时可直接更新；或用方式一重新安装新标签（如 `#v2.5.3`）。
- **卸载**：插件页该卡片 → **卸载**，然后重启一次 Harness。持仓数据库不会随卸载删除。

## 数据与隐私

持仓只保存在本机 `~/.dsh/fund-tracker/fund-tracker.db`（SQLite），按 DSH 登录账号隔离，不会上传到任何服务器。个人页面需登录 DSH 账号，行情页保持公开。行情来自东方财富公开接口，仅供参考，不构成投资建议。

## 开发

Host 端：`index.js` + `lib/`（路由、SQLite 存储、行情适配器）；客户端：`client.js`（纯 JS 模块工厂，无 JSX）。无构建步骤、无运行时依赖。本地跑测试需要 Node ≥ 22（内置 `node:sqlite`）。

```powershell
node --test test/routes.test.mjs   # 17 个 API 集成测试，基于 mock 宿主
node test/market-check.mjs         # 东方财富接口连通性自检
```

仓库特有的坑（测试会读写真实本地数据库、插件契约、文档滞后项）见 [AGENTS.md](AGENTS.md)。
