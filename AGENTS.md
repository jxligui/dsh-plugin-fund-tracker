# fund-tracker

DeepSeek Harness（DSH）插件 `@local/fund-tracker`：悬浮的基金 / 行情面板。
分两半：Host（`index.js` → `lib/`）与 Client（`client.js`）。无构建步骤、无依赖、
无 lint / 类型检查、无 npm scripts。已发布为
`github.com/jxligui/dsh-plugin-fund-tracker`（只有 `main` 一条分支）。

## 命令

```powershell
node --test test/routes.test.mjs      # 唯一的测试套件（Node >=22，node:sqlite）
node test/market-check.mjs            # 东方财富接口连通性自检
```

新机器上测试会一直失败：`openDb()` 只建表、不下载基础库。手动播种一次
（实测 2.8 万条）：

```powershell
node -e "import('./lib/store.js').then(async m => { const db = m.openDb(); console.log(await m.refreshLibrary(db, true)); db.close(); })"
```

**客户端没有任何测试。** 改动 `client.js` 只能通过重新安装 bundle、在 Harness 里
打开面板来验证。

## 坑

- **测试读写真实的用户数据库。** `store.js#dbPath()` 固定使用
  `~/.dsh/fund-tracker/fund-tracker.db`，完全忽略 `DSH_PROFILE_DIR` 与
  `FT_TEST_PROFILE`（测试文件里虽然还在设置它们）。断言依赖真实基础库
  （`fundCount > 10000`），这是首次运行失败最常见的原因。测试写入 `test` 账号，
  必须自行清理数据。
- **`FT_SKIP_NETWORK=1` 无效。** skip 选项被当成 `test()` 的第 3 个参数传入，而
  node 要求 options 在第 2 个参数；网络用例永远会跑。要么改调用形式，别信文档。
- **基础库表只在 `count < <常量>.length` 时于 `openDb()` 补齐。** 往
  `INDEX_LIBRARY` / `ETF_LIBRARY`（`lib/constants.js`）里加条目能进入已有数据库；
  删条目则会在旧库里留下残行。`indexlist` 测试断言恰好 **29** 条指数。
- `seedDemoHoldings()` 会在某个账号首次 `action=list` 时写入 10 条假持仓
  （按账号用 `meta` 去重）。
- **自选不再是「份额为空」。** `holdings.watch` 才是自选标记；旧库在 `openDb()`
  里按 `shares IS NULL AND cost IS NULL` 补齐。`action=watch` 只改标记，不动份额；
  `save` 省略 `watch` 时保留原值。
- **待确认金额**存在 `holdings.pending_amount`：取不到净值时只存金额，客户端拿到
  净值后写回份额并清空该列。`save` 省略 `pendingAmount` 时保留原值。
- 东方财富接口需要 `referer` 头；`fundgz` 返回的是 JSONP（`jsonpgz(...)`）而不是
  JSON。行情接口只接受 6 位数字代码、上限 `MAX_CODES`（60）；指数 / ETF 走
  `?market=1` 与 SQLite 里的 `secid`。
- 未登录访问私有 action 返回 **403**（`routes.js`）。
- `test/minetab.part` 是旧版 `WatchTab` 的死代码片段，没有任何地方引用它；别照着它改。

## 约定

- **所有路由必须走 `lib/routes.js` 里的 `register()` 包装器**：
  `webServer.register({ kind: 'exact', path, handler })`。包装器负责
  `connection.admit(req)`（浏览器 peer token 校验），裸注册会绕过它。私有 action
  还要再调用 `requireAccount()`。
- 只有两个端点：`/fund-tracker/quotes` 与 `/fund-tracker/api?action=...`。加功能 =
  在 action 分支里加一段 + 在 `client.js` 里加一个 `fetch`。
- `client.js` **不是 ES 模块**：它是通过
  `window.__ModuleLoader__.load({ id, factory(require) })` 注册的惰性 CJS 工厂，
  用 `require('react')` 与 `React.createElement`（绑定为 `h`）。顶层不能出现
  `import` / `export`。
- 所有 CSS 是一个模板字符串，以 `<style>{css}</style>` 注入；类名统一 `ft-` 前缀，
  颜色只能用 DSH 主题变量（`--dsw-alias-*`），不要写字面色值。
- 跨组件状态用 window CustomEvent（`ft-interval-changed`、`ft-lib-changed`）；
  没有共享 store，每个标签页各自取数。
- 一级 / 二级 Tab 的顺序与当前页签存在 localStorage `fund-tracker.tab-order.v1`；
  `SortableTabs` 统一处理拖动、`Alt+←/→` 与 `withDefaults()` 兜底。
- 客户端只在 `apply()` 里解析一次语言（`ctx.locale.getLocale()`），从
  `DICTS['zh-CN' | 'en-US']` 取词；两份词典的 key 必须完全一致。
- Host 端数据库访问是同步的 `node:sqlite`（`DatabaseSync`）；store 函数会吞掉错误
  并返回空结构 —— 数据莫名为空时先查 `action=debug`。

## 安装 / 验证

- 只改 Host：先跑测试，再用 `plugin_manager install_bundle` 指向本目录（profile 以
  link 方式接入）并重启 Harness。改了 Client 必须完整重启，才会加载新的客户端模块代际。
- `package.json` 的 `dsh.bundle.patch` 指向 `cordis.patch.yml`，由它插入
  `fund-tracker` 行；`dsh.client.inject` 列出依赖的会话 UI 包。

## 文档

- `docs/DESIGN.md` 是架构与数据设计的唯一说明；`docs/schema.sql` 是数据库的等价 DDL
  （由 `lib/store.js#openDb()` 实际创建）。改表结构时两处一起改。
- `locale/{zh,en}.json` 的 `meta.description` 会显示在插件页，`meta.detail` 指向
  `docs/DETAIL.md`，三处都是用户可见文案。
