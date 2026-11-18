# dsh-plugin-fund-tracker / 基金小助理

DeepSeek Harness（DSH）客户端插件：在窗口右缘提供常驻悬浮入口，查看大盘指数、主题基金与自己的持仓，附带实时净值估算和每日盈亏。不占用聊天页面空间。

用法详见 [docs/DETAIL.md](docs/DETAIL.md)，架构设计见 [docs/DESIGN.md](docs/DESIGN.md)。

## 功能

- **今日行情**：可自定义的指数网格 + 主题基金 / ETF 实时行情 + 全量基金检索。
- **我的自选**：关注的指数与基金；「加入持仓」后仍保留在自选。
- **我的基金**：持仓卡片列表，含最新净值与昨日净值、持有金额、今日盈亏、持有收益与收益率；今日净值未公布时按昨日净值计算。支持按金额或份额录入，行内编辑、加仓 / 减仓、加入我的自选（保留持仓）、移除。取不到净值时金额显示为「待确认」，下次取到后自动折算份额。
- **Tab 布局**：一级、二级页签均可拖动排序，顺序与当前页保存在本地。
- **详情**：净值走势、区间涨幅与最新净值。
- **导入**：粘贴支付宝 / 微信 / 华夏基金持仓文本，自动识别代码与份额、成本、金额。
- **设置**：刷新间隔、指数显示选择、本地基金基础库（约 2.8 万条，每 24 小时自动刷新）。

## 在 DSH 中安装

### 方式一：GitHub 地址安装（推荐）

1. 打开 Harness 左侧导航的**插件（Plugins）页面** → **添加插件（Add plugin）**。
2. 在规格（spec）输入框填入仓库地址：

   ```text
   github:jxligui/dsh-plugin-fund-tracker
   ```

   也可填 `https://github.com/jxligui/dsh-plugin-fund-tracker.git`。要锁定版本，在末尾加上发布标签，例如 `github:jxligui/dsh-plugin-fund-tracker#v2.2.0`。
3. 确认安装（名称/版本检查 → 安装 → 完成）。安装器会先用 `git ls-remote` 检查仓库可达性，再由 pnpm 拉取，不需要手动 clone。
4. **完全重启一次 DeepSeek Harness**，让新的客户端模块代际生效。重启后窗口右缘出现竖排的「基金」悬浮条，点击即可展开面板。

如果手边有带 `plugin_manager` 工具的 Agent，一次调用即可完成安装：

```
plugin_manager install_bundle target="github:jxligui/dsh-plugin-fund-tracker#v2.2.0"
```

### 方式二：本地目录安装（开发调试）

插件页 → **添加插件**，把规格切换为本地路径，指向本仓库的检出目录（例如 `D:\WorkSpace\DeepSeek\fund-tracker`）。profile 会以 link 方式链接该目录，改完代码重启应用即可生效（客户端模块需要完整重启才会加载新代际）。也可用 `plugin_manager install_bundle` 并以目录为 target。

### 安装后 / 更新 / 卸载

- **登录**：个人页（我的自选 / 我的基金）需要 DSH 登录账号；行情页公开，无需登录。
- **更新**：插件页该卡片出现**更新**控件时可直接更新；或用方式一重新安装新标签（如 `#v2.2.0`）。
- **卸载**：插件页该卡片 → **卸载**，然后重启一次 Harness。持仓数据库不会随卸载删除。

## 数据与隐私

持仓只保存在本机 `~/.dsh/fund-tracker/fund-tracker.db`（SQLite），按 DSH 登录账号隔离，不会上传到任何服务器。个人页面需登录 DSH 账号，行情页保持公开。行情来自东方财富公开接口，盘中为估算值，仅供参考，不构成投资建议。

## 开发

Host 端：`index.js` + `lib/`（路由、SQLite 存储、行情适配器）；客户端：`client.js`（纯 JS 模块工厂，无 JSX）。无构建步骤、无运行时依赖。本地跑测试需要 Node ≥ 22（内置 `node:sqlite`）。

```powershell
node --test test/routes.test.mjs   # 13 个 API 集成测试，基于 mock 宿主
node test/market-check.mjs         # 东方财富接口连通性自检
```

仓库特有的坑（测试会读写真实本地数据库、插件契约、文档滞后项）见 [AGENTS.md](AGENTS.md)。
