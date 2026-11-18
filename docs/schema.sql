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
  updated_at INTEGER NOT NULL,          -- 最后更新时间戳（毫秒）
  PRIMARY KEY (account, code)
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
