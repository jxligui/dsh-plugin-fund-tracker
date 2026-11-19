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

- **外观打磨（v2.5.4）**：行情 / 自选基金表第一列表头从误用的 `t('panel')`（面板名）
  改为 `t('open')`（基金）；标题栏汇总 今日盈亏用 `signedMoney` 带符号、数值加 `ft-num`
  与 title 提示；面板 / 弹窗加 `ft-in` 入场动画（`prefers-reduced-motion` 关闭），
  按钮 / 卡片 / 表格行加 0.15s 颜色过渡，指数卡片与持仓卡片 hover 提亮边框与阴影
  （`.ft-card:not(.ft-card-open):hover` 避免覆盖展开态的品牌色边框）。
- **批量导入逗号分隔修复**：`parseBatch()` 用「先定位 6 位代码、再取其后第一个数字」的
  两段式正则，因此 `161725, 500.50` 这类逗号分隔也能解析（此前按整行 split 失败）。
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
- `seedDemoHoldings()` 会在某个账号首次 `action=list` 时写入演示数据
  （6 持仓 + 4 自选，见 v2.3.6；按账号用 `meta` 去重）。
- **自选不再是「份额为空」。** `holdings.watch` 才是自选标记；旧库在 `openDb()`
  里按 `shares IS NULL AND cost IS NULL` 补齐。`action=watch` 只改标记，不动份额；
  `save` 省略 `watch` 时保留原值。
- **待确认金额**存在 `holdings.pending_amount`：取不到净值时只存金额，客户端拿到
  净值后写回份额并清空该列。`save` 省略 `pendingAmount` 时保留原值。
  v2.2.0 起结算在**服务端** `settleTrades()`（`action=list` / `trade` 时运行），客户端不再自行折算。
- **净值与金额制交易（v2.2.0）**：`fund_nav` 表存每日净值（FundMNHisNetList，
  近 15 日/只，`action=list` 增量同步、30 分钟节流）；`trades` 表存金额制加/减仓，
  `confirm_date`=T+1（QDII 按名称/类型判 T+2），确认日首条净值落库即折算份额
  （买入移动加权成本）。`listPortfolio()` 返回的 `amount` 已含待确认买入金额。
- **净值定时同步（v2.2.1）**：`index.js` 的后台定时器每 30 分钟对**全部账号**的
  持仓基金跑 `syncNavs()` + `settleTrades()`（启动 60 秒后先跑一次），不打开面板
  也会更新。`syncNavs` 是 `routes.js` 的模块级导出，路由与定时器共用。
- **全量净值库（v2.3.0）**：排行类批量接口（FundRankApi/rankhandler）全部要求
  浏览器 cookie、不可用；全量走 FundMNHisNetList 逐只分批——每 30 秒一批 300 只、
  并发 10、每只只取最新净值日，全库 2.8 万只约 45 分钟跑完一轮，之后 20 小时节流。
  游标存 `meta.navall_cursor` / `navall_done_at`（断点续传）；进度在
  `action=libinfo` 的 `nav` 字段、设置页「净值库」行展示。注意首批要等
  `refreshLibrary` 播种 fund_base（启动 5 分钟后才开始）。
- **在售标记与在售净值（v2.3.1）**：`Fund_JJJZ_Data.aspx`（jdzf 页数据，带
  `onlySale=1`）是唯一无需 cookie 的批量源；`syncOnSale()` 一轮 ~103 页 × 200 只
  （实测 57 秒）标记 `fund_base.on_sale` 并把最新净值日（jdzf `showday`）批量写入
  `fund_nav`，20 小时节流。`fundlist` / `fundtypes` 默认 `status=onsale`，
  `status=all` 才返回暂停申购的基金；设置页「今日行情 · 基金状态」可切换
  （localStorage `fund-tracker.fund-status.v1`，CustomEvent `ft-fund-status-changed`）。
  设置页「立即更新」（`action=refreshlib`，需登录）一次跑满三件：
  `refreshLibrary(db, true)` 强刷基础库 + `syncEtfLibrary` + `syncOnSale`（强制、绕过 20h 节流）。
- **SQLite 并发**：`openDb()` 开 `journal_mode=WAL` + `busy_timeout=5000`；
  宿主与后台同步共用库文件，缺这两条会随机报 `database is locked`。
- 东方财富接口需要 `referer` 头；**`fundgz.1234567.com.cn` 已失效（返回 404 HTML）**，
  实时估值改用 `Fund_JJJZ_Data.aspx?text=<代码>` 精确查询（字段 r[3]=净值、r[5]=昨日净值、
  r[8]=涨跌幅、showday[0]=净值日），fundgz 仅作 fallback；指数 / ETF 走 `?market=1`
  与 SQLite 里的 `secid`。行情接口只接受 6 位数字代码、上限 `MAX_CODES`（60）。
- **指数卡片简化 + 无滚动条（v2.5.3）**：IdxCard 去掉今开/昨收/最高/最低/成交额网格
  与「★ 已在自选」文字标签，仅保留 名称+代码、大现价、涨跌幅胶囊、涨跌额、★/☆ 星标
  （已自选=实心★，自选指数页=✕）。大盘指数每页 10 条（5 行）免滚动，`.ft-panel-body`
  隐藏滚动条（scrollbar-width:none + ::-webkit-scrollbar display:none，仍可滚动）。
- **指数卡片基金 App 风格（v2.5.2）**：IdxCard 重设计——14px 圆角卡片 + 轻阴影、
  名称/代码两行标题、★/☆ 圆形图标按钮、大号 24px 现价（带涨跌色）、涨跌幅胶囊
  （ft-idx-up 实心红 / ft-idx-down 实心绿）、涨跌额、2 列网格展示今开/昨收/最高/最低/成交额。
  类名从 ft-idx-cell 系列改为 ft-idx-card 系列（旧类已清理）。grid 每行 2 个、gap 10px。
- **指数卡片统一 + 分页（v2.5.1）**：新增共享 `IdxCard` 组件，大盘指数与自选指数
  两处复用同一套卡片（名称/代码/现价/涨跌幅/涨跌额/成交额/今开/昨收/最高/最低 + tooltip）。
  grid 每行 2 个；大盘指数恢复分页（size=12）+ Pager；已自选状态卡片显示
  `★ 已在自选`（ft-idx-watched），自选指数页的卡片用 `onRemove` 显示 ✕ 取消自选按钮。
  自选 tab 二级标签「自选指数」改名「自选大盘指数」（watchSubIdx）。
- **大盘指数显示更多（v2.5.0）**：IndexSub 去掉分页（size=50 一次显示全部 29 指数，
  面板 body 滚动），grid 3 列；每格在主价/涨跌幅外增加 涨跌额(chg)/成交额(turnover,compactAmt
  按亿/万)/今开(todayOpen)/昨收(prevClose)/最高(high)/最低(low)，hover tooltip 显示完整数据，
  加自选按钮缩成 ★/☆ 小图标。Host 行情字段扩为 f2,f3,f4,f5,f6,f12,f14,f15,f16,f17,f18
  （price/pct/amt/volume/amount/high/low/open/prevClose）。注意 `open` key 已被占用为「基金」，
  今开必须用 `todayOpen`。
- **自选基金按持仓状态区分操作（v2.4.6）**：WatchTab 基金 tab 中，已是持仓的基金
  （shares!=null 或 pending）显示「＋加仓/－减仓」（内联金额面板，复用 apiTrade 经
  `onWatchTrade`），且**不显示取消自选**；未持仓基金显示「＋加入持仓」+「✕取消自选」
  （词典 unwatch）。tradeRow/tradeAmount 为 WatchTab 局部 state，与 MineTab 的 trade 状态隔离。
- **持仓卡片默认显示指标行（v2.4.5）**：紧凑卡片默认多一行 `.ft-card-stats`
  （净值/成本/份额/收益率 + 按昨日净值标记），展开时隐藏 stats 改为显示 `.ft-card-meta` 全量指标，
  不展开也能看到关键数据，解决列表显空。词典 key 复用 nav/costShort/sharesShort/totalPct/usePrevNav。
- **修复 code is not defined（v2.4.4）**：`MineTab.actionBar` 的「▦ 移到分组」按钮里用了裸
  `code`（该作用域只有 `name`/`inWatch`），v2.4.0 分组功能引入即存在，紧凑卡片改动后触发。
  改为 `r.hold.code`。已全量核对所有裸 `code` 引用均有参数/局部声明。排查此类错误：
  PanelBoundary 会显示 `渲染异常: <message>`，定位到具名标识符后全量 grep 核查。
- **面板局部滚动 + 紧凑卡片（v2.4.3）**：`.ft-panel` 改为 flex 列、固定 height 76vh、
  overflow hidden；内容包进 `.ft-panel-body`（flex:1; overflow:auto），标题栏和一级 tab 固定不滚。
  持仓卡片紧凑化：padding 5px、展开按钮缩成 24px 箭头、`.ft-card-meta`（净值/成本/份额等次要信息）
  仅 `.ft-card-open` 时显示，默认一行（名称+金额+今日盈亏）。影响所有 tab 的内容区滚动。
- **未分组 tab 排序与限制（v2.4.2）**：「未分组」tab 移到分组栏最后（全部→各分组→未分组）；
  该 tab 下隐藏「添加基金/批量导入」按钮（isUngrouped 控制），空态文案改为 groupNoneEmpty；
  切换分组 tab 时关闭遗留的 add/import/edit/trade 面板。
- **勾选批量分配未分组基金（v2.4.1）**：「未分组」tab 下有 ⚙ 旁的「⇥ 批量分配」按钮，
  打开后列出所有未分组基金带勾选框（全选/全不选）+ 目标组下拉 → `groupmovebatch` 一次提交。
  action `groupmovebatch`（codes[] + name，name=null 移回未分组，上限 200），返回 moved 与 items。
- **持仓基金自定义分组（v2.4.0）**：`fund_groups(account,name,sort_order)` 表存分组定义，
  `holdings.group_name`（NULL=未分组）存归属，老库 openDb 自动 ALTER 补列。
  action：grouplist / groupadd / grouprename / groupdelete / groupmove（均需登录）；
  `save` 传 `groupName`（省略保留原值，''/null=未分组）。Client：持仓页顶部分组 tab
  （全部/未分组/各分组，带只数）+ ⚙ 管理面板（增/改名/删）+ 卡片「▦ 移到分组」选择器。
  当前分组存 localStorage `fund-tracker.active-group.v1`，加载分组后校验有效性防串账号。
- **演示持仓数据（v2.3.6）**：首次 `action=list` 按账号播种 6 持仓 + 4 自选，
  成本按真实净值快照 × 系数设定（盈亏混合 +18%~-9%，总资产约 ¥1.1 万），
  不再是不真实的旧成本。`meta.demo_seeded_<account>` 去重——**老账号已播种过不会更新**，
  只对新账号生效。数据定义在 `store.js#DEMO_HOLDINGS`。
- **增加基金面板（v2.3.5）**：金额输入框排第一（autofocus），份额/成本标注「选填（一般不填）」
  放第二行；金额优先、`saveForm` 按最新净值折算份额成本。
- **批量导入（v2.3.5）**：「粘贴导入」改为「批量导入」，格式每行「基金代码 金额」
  （空格/逗号/Tab 分隔，支持 ¥ 与千分位），`parseBatch()` 解析（同代码多行累加），
  `doImport()` 用 `navOf()` 按最新净值折算份额=`金额÷净值`、成本=净值；取不到净值则
  存 `pendingAmount` 待服务端结算。旧的 `parsePasted()`（支付宝/微信文本解析）已删除。
- **今日行情二级标签（v2.3.4）**：今日行情的 index/fund 二级标签用专用 key
  `marketSubIdx`/`marketSubFund`（大盘指数/全部基金）；设置页与其它页复用 subIdx/subFund，互不影响。
- **自选 tab 二级标签（v2.3.3）**：「我的自选」下的两个二级标签专用 key
  `watchSubIdx`/`watchSubFund`（自选指数/自选基金），不改今日行情的 subIdx/subFund。
- **自选「加入持仓」金额制（v2.3.3）**：WatchTab 的加入持仓按钮打开只填金额的输入框
  （`toHoldCode`/`toHoldAmount` state），`toHoldByAmount()` 用 `navOf()`（行情优先、
  `holdings.nav` 本地净值兜底）折算 `份额=金额÷净值`、`成本=净值`，并经 `apiSave` 保存且
  保留 `watch=true`。Client-only 改动，需重启加载新代际。
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
