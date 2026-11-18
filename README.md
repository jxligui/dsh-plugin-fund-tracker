# dsh-plugin-fund-tracker / 基金小助理

DeepSeek Harness 客户端插件：在窗口右缘提供常驻悬浮入口，查看大盘指数、主题基金与自己的持仓，附带实时净值估算和每日盈亏。不占用聊天页面空间。

用法详见 [docs/DETAIL.md](docs/DETAIL.md)，架构设计见 [docs/DESIGN.md](docs/DESIGN.md)。

## 功能

- **今日行情**：可自定义的指数网格 + 主题基金 / ETF 实时行情 + 全量基金检索。
- **我的自选**：关注的指数与基金；「加入持仓」后仍保留在自选。
- **我的基金**：持仓卡片列表，含最新净值与昨日净值、持有金额、今日盈亏、持有收益与收益率；今日净值未公布时按昨日净值计算。支持按金额或份额录入，行内编辑、加仓 / 减仓、加入我的自选（保留持仓）、移除。取不到净值时金额显示为「待确认」，下次取到后自动折算份额。
- **Tab 布局**：一级、二级页签均可拖动排序，顺序与当前页保存在本地。
- **详情**：净值走势、区间涨幅与最新净值。
- **导入**：粘贴支付宝 / 微信 / 华夏基金持仓文本，自动识别代码与份额、成本、金额。
- **设置**：刷新间隔、指数显示选择、本地基金基础库（约 2.8 万条，每 24 小时自动刷新）。

## 安装

插件页 → **添加插件**，填入 `github:jxligui/dsh-plugin-fund-tracker`，安装后**重启一次 DeepSeek Harness**。若手边有带 `plugin_manager` 工具的 Agent，一次调用即可：

```
plugin_manager install_bundle target="github:jxligui/dsh-plugin-fund-tracker"
```

本插件无构建步骤、无运行时依赖，因此在插件页直接把本地检出目录作为规格（spec）链接即可用于开发调试。

## 数据与隐私

持仓只保存在本机 `~/.dsh/fund-tracker/fund-tracker.db`（SQLite），按 DSH 登录账号隔离，不会上传到任何服务器。个人页面需登录 DSH 账号，行情页保持公开。行情来自东方财富公开接口，盘中为估算值，仅供参考，不构成投资建议。

## 开发

Host 端：`index.js` + `lib/`（路由、SQLite 存储、行情适配器）；客户端：`client.js`（纯 JS 模块工厂，无 JSX）。需要 Node ≥ 22（内置 `node:sqlite`）。

```powershell
node --test test/routes.test.mjs   # 11 个 API 集成测试，基于 mock 宿主
node test/market-check.mjs         # 东方财富接口连通性自检
```

仓库特有的坑（测试会读写真实本地数据库、插件契约、文档滞后项）见 [AGENTS.md](AGENTS.md)。
