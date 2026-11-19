-- 基金管家（fund-tracker）本地数据库 Schema
-- 实际文件：~/.dsh/fund-tracker/fund-tracker.db（用户主目录，固定路径）
-- 由 Host 端 lib/store.js 的 openDb() 在插件激活时自动创建；此处为等价的 DDL 参考，
-- 手动执行亦无损（全部为 IF NOT EXISTS）。
-- 路径说明：Harness 宿主不保证向插件导出 DSH_PROFILE_DIR，因此不再使用该变量，
-- 避免出现两份互相分叉的数据库。

-- =========================================================
-- 1. 个人持仓 / 自选表
--    按 DSH 登录账号（account）隔离；watch = 1 表示在「我的自选」里。
--    自选与持仓互相独立：一只基金可以同时在自选和持仓里（watch=1 且 shares 非 NULL）。
-- =========================================================
CREATE TABLE IF NOT EXISTS holdings (
  account    TEXT NOT NULL,             -- DSH 账号标识（未登录不可读写）
  code       TEXT NOT NULL,             -- 6 位基金/指数代码
  name       TEXT,                      -- 基金名称（冗余，展示用）
  shares     REAL,                      -- 持有份额；NULL = 未记份额
  cost       REAL,                      -- 持仓成本价（单位净值）；NULL = 未填
  watch      INTEGER NOT NULL DEFAULT 0,-- 1 = 在我的自选；与是否有份额无关
  pending_amount REAL,                     -- 待确认金额：净值取不到时先存金额，取到后折算份额并清空
  group_name  TEXT,                        -- 自定义分组名；NULL = 未分组
  updated_at INTEGER NOT NULL,          -- 最后更新时间戳（毫秒）
  PRIMARY KEY (account, code)
);

-- =========================================================
-- 1b. 自定义分组（v2.4.0，按账号隔离；删除分组后旗下基金变为未分组）
-- =========================================================
CREATE TABLE IF NOT EXISTS fund_groups (
  account    TEXT NOT NULL,
  name       TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (account, name)
);

-- =========================================================
-- 2. 基金基础库
--    每 24 小时从东方财富全量列表刷新 kind='fund' 的行（约 2.8 万条），
--    同时把 lib/constants.js 的内置指数以 kind='index' 写入（type 形如「指数 · 大盘」）。
--    支持按 代码前缀 / 名称包含 / 拼音简码前缀 / 全拼前缀 检索。
-- =========================================================
CREATE TABLE IF NOT EXISTS fund_base (
  code    TEXT PRIMARY KEY,             -- 6 位代码
  name    TEXT NOT NULL,                -- 中文名称，如：华夏成长混合
  pinyin  TEXT,                         -- 拼音简码，如：HXCZHH
  fullpy  TEXT,                         -- 全拼（大写），如：HUAXIACHENGZHANGHUNHE；指数为 NULL
  type    TEXT,                         -- 基金类型，如：混合型-灵活 / 指数 · 大盘
  kind    TEXT NOT NULL DEFAULT 'fund'  -- 'fund' = 基金；'index' = 指数
);

-- =========================================================
-- 3. 指数库（可浏览/分页的精选指数，含 push2 secid）
--    由 lib/constants.js 的 INDEX_LIBRARY 在 openDb() 时补齐。
-- =========================================================
CREATE TABLE IF NOT EXISTS index_base (
  code     TEXT PRIMARY KEY,            -- 指数代码，如 000001 / HSI
  name     TEXT NOT NULL,
  pinyin   TEXT,                        -- 拼音简码，如 SZSZ；搜索用
  secid    TEXT NOT NULL,               -- push2 行情标识，如 1.000001 / 100.HSI
  category TEXT                         -- 大盘 / 规模 / 红利 / 行业 / 海外
);

-- =========================================================
-- 4. ETF 库（内置主题 ETF 清单，实时行情走交易所价格）
-- =========================================================
CREATE TABLE IF NOT EXISTS etf_base (
  code   TEXT PRIMARY KEY,
  name   TEXT NOT NULL,
  secid  TEXT NOT NULL,                 -- push2 行情标识，如 1.510300
  theme  TEXT                           -- 宽基 / 红利 / 科技 / 消费 / 医药 / 新能源 / 军工 / 金融 / 周期 / 海外
);

-- =========================================================
-- 5. 用户设置（按账号隔离的 JSON 值，如指数显示选择）
-- =========================================================
CREATE TABLE IF NOT EXISTS user_settings (
  account TEXT NOT NULL,
  key     TEXT NOT NULL,
  value   TEXT,                         -- JSON 文本，由 store.js 序列化/反序列化
  PRIMARY KEY (account, key)
);

-- =========================================================
-- 6. 元数据（基础库刷新时间、各账号 demo 数据播种标记等）
-- =========================================================
CREATE TABLE IF NOT EXISTS meta (
  key   TEXT PRIMARY KEY,
  value TEXT
);

-- =========================================================
-- 7. 基金每日净值表（东方财富 FundMNHisNetList 同步，最多保留近 15 个净值日/只）
--    打开「我的基金」时自动增量同步：最新净值日 < 今天 且 距上次同步 > 30 分钟才请求。
--    持仓金额 = 份额 × 最新净值；净值缺失时先触发同步再计算。
-- =========================================================
CREATE TABLE IF NOT EXISTS fund_nav (
  code TEXT NOT NULL,             -- 6 位基金代码
  date TEXT NOT NULL,             -- 净值日 YYYY-MM-DD
  nav  REAL NOT NULL,             -- 单位净值
  pct  REAL,                      -- 当日涨跌 %
  PRIMARY KEY (code, date)
);

-- =========================================================
-- 8. 金额制交易记录（加仓/减仓只填金额，份额待确认）
--    确认规则：普通基金 T+1、QDII T+2（按 fund_base 类型判断）。
--    settleTrades() 在每次 action=list / trade 时运行：
--    确认日（含）之后的第一条净值落库即折算 份额 = 金额 ÷ 净值，
--    买入移动加权成本、卖出保持成本；确认前买入金额已计入持仓金额。
-- =========================================================
CREATE TABLE IF NOT EXISTS trades (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  account      TEXT NOT NULL,
  code         TEXT NOT NULL,
  side         TEXT NOT NULL,     -- 'buy' | 'sell'
  amount       REAL NOT NULL,     -- 交易金额（元）
  shares       REAL,              -- 确认后折算的份额
  nav          REAL,              -- 结算所用净值
  status       TEXT NOT NULL DEFAULT 'pending',  -- 'pending' | 'confirmed'
  trade_date   TEXT NOT NULL,     -- 下单日 YYYY-MM-DD
  confirm_date TEXT NOT NULL,     -- 最早可确认净值日（T+1 / QDII T+2）
  created_at   INTEGER NOT NULL
);

-- 常用查询示例 -----------------------------------------------------------
-- 检索（代码 / 名称 / 拼音简码 / 全拼）：
--   SELECT code, name, pinyin, type, kind FROM fund_base
--   WHERE code LIKE 'HS%' OR name LIKE '%消费%' OR pinyin LIKE 'XF' OR fullpy LIKE 'XF'
--   ORDER BY code LIMIT 15;
--
-- 某账号的全部持仓（按更新时间倒序）：
--   SELECT code, name, shares, cost FROM holdings
--   WHERE account = ? ORDER BY updated_at DESC;
--
-- 保存（upsert）一条持仓：
--   INSERT INTO holdings (account, code, name, shares, cost, updated_at)
--   VALUES (?, ?, ?, ?, ?, ?)
--   ON CONFLICT(account, code) DO UPDATE SET
--     name = excluded.name, shares = excluded.shares,
--     cost = excluded.cost, updated_at = excluded.updated_at;
