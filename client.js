window.__ModuleLoader__.load({
  id: '@local/fund-tracker',
  factory(require) {
    const React = require('react');
    const h = React.createElement;
    const { useState, useEffect, useMemo, useCallback } = React;

    const CACHE_KEY = 'fund-tracker.cache.v2';
    const INTERVAL_KEY = 'fund-tracker.interval.v1';
    const INTERVAL_OPTIONS = [15, 30, 60, 120, 300];
    // Codes currently being settled from "pending amount" to shares (guards the
    // effect against re-entering while its own save is in flight).
    const settleLocks = new Set();
    const TAB_ORDER_KEY = 'fund-tracker.tab-order.v1';
    const MAIN_TABS = ['market', 'watch', 'mine', 'settings'];
    const MARKET_SUBS = ['index', 'fund', 'etf'];
    const WATCH_SUBS = ['index', 'fund'];

    function loadTabState() {
      try {
        const value = JSON.parse(localStorage.getItem(TAB_ORDER_KEY) || '{}');
        return value && typeof value === 'object' ? value : {};
      } catch { return {}; }
    }
    function saveTabState(state) {
      try { localStorage.setItem(TAB_ORDER_KEY, JSON.stringify(state)); } catch {}
    }
    function withDefaults(list, defaults) {
      const kept = Array.isArray(list) ? list.filter(k => defaults.includes(k)) : [];
      return [...kept, ...defaults.filter(k => !kept.includes(k))];
    }
    function pick(value, defaults, fallback) {
      return defaults.includes(value) ? value : fallback;
    }

    // First- and second-level tabs: drag to reorder, Alt+←/→ for keyboard users.
    // Order + active tab live in localStorage, so they survive a reload.
    function SortableTabs({ t, className, items, active, onSelect, onOrderChange }) {
      const [dragKey, setDragKey] = useState(null);
      const [overKey, setOverKey] = useState(null);
      const move = (from, to) => {
        const keys = items.map(x => x.key);
        const a = keys.indexOf(from);
        const b = keys.indexOf(to);
        if (a < 0 || b < 0 || a === b) return;
        const next = keys.slice();
        next.splice(a, 1);
        next.splice(b, 0, from);
        onOrderChange && onOrderChange(next);
      };
      return h('div', { className, role: 'tablist' },
        items.map(item => h('button', {
          key: item.key,
          className: `ft-tab${active === item.key ? ' ft-tab-active' : ''} ft-tab-drag${dragKey === item.key ? ' ft-tab-dragging' : ''}${overKey === item.key && dragKey !== item.key ? ' ft-tab-dragover' : ''}`,
          draggable: true,
          role: 'tab',
          'aria-selected': active === item.key,
          title: t('dragHint'),
          onClick: () => onSelect && onSelect(item.key),
          onDragStart: e => {
            setDragKey(item.key);
            if (e.dataTransfer) { e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', item.key); }
          },
          onDragOver: e => { e.preventDefault(); if (e.dataTransfer) e.dataTransfer.dropEffect = 'move'; setOverKey(item.key); },
          onDragLeave: () => setOverKey(k => (k === item.key ? null : k)),
          onDrop: e => {
            e.preventDefault();
            const from = dragKey || (e.dataTransfer && e.dataTransfer.getData('text/plain'));
            move(from, item.key);
            setDragKey(null); setOverKey(null);
          },
          onDragEnd: () => { setDragKey(null); setOverKey(null); },
          onKeyDown: e => {
            if (!e.altKey || (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight')) return;
            e.preventDefault();
            const i = items.findIndex(x => x.key === item.key);
            const j = e.key === 'ArrowLeft' ? i - 1 : i + 1;
            if (j >= 0 && j < items.length) move(item.key, items[j].key);
          },
        }, item.label)));
    }

    const DICTS = {
      'zh-CN': {
        panel: '基金小助理',
        tabMarket: '今日行情',
        tabWatchPage: '我的自选',
        tabMine: '我的基金',
        tabSettings: '设置',
        watchIdxEmpty: '暂未关注指数。在「今日行情 → 指数 → 编辑指数」中勾选即可。',
        loginMaskTitle: '持仓金额已隐藏',
        loginMaskHint: '持仓数据涉及隐私，请先登录 DSH 账号。指数与行情页仍可正常浏览。',
        addShare: '加仓',
        reduceShare: '减仓',
        tradeQtyHint: '份额数量',
        confirmDeleteTitle: '删除基金',
        confirmDeleteBody: (n, c) => `确定删除 ${n}（${c}）吗？删除后无法恢复。`,
        confirmDelete: '确认删除',
        loginRequired: '请先登录 DSH 账号后再操作持仓',
        indices: '指数',
        yesterday: '昨日涨跌',
        sector: '板块',
        realtime: '实时行情',
        themes: '主题基金',
        open: '基金',
        close: '收起',
        refresh: '刷新',
        refreshing: '加载中…',
        empty: '暂无基金。搜索代码/名称/拼音添加，或粘贴支付宝 / 微信 / 华夏基金的持仓文本导入。',
        addTitle: '搜索添加（代码 / 名称 / 拼音）',
        importTitle: '粘贴导入（支付宝 / 微信 / 华夏基金持仓文本）',
        code: '代码',
        shares: '持有份额',
        cost: '持仓成本价',
        price: '最新价',
        add: '保存',
        edit: '编辑',
        cancel: '取消',
        import: '导入',
        importing: '导入中…',
        imported: (n, f) => `解析到 ${n} 只基金，导入 ${f} 只`,
        importFailed: '未解析到基金代码，请确认粘贴了包含持仓的文本',
        invalidCode: '基金代码须为 6 位数字',
        nav: '净值',
        today: '今日涨跌',
        holdAmount: '持有金额',
        todayProfit: '今日盈亏',
        totalProfit: '持有收益',
        totalPct: '收益率',
        remove: '移除',
        watch: '加入自选',
        noShares: '自选',
        overview: '资产总览',
        totalAsset: '总资产',
        sortBy: '排序',
        sortToday: '今日涨跌',
        sortProfit: '持有收益',
        sortAmount: '持有金额',
        detail: '详情',
        spans: '区间涨幅',
        spanW1: '近1周', spanM1: '近1月', spanM3: '近3月', spanM6: '近6月', spanY1: '近1年', spanTotal: '成立以来',
        trend: '净值走势（近3月）',
        latestNav: '最新净值',
        loadingDetail: '加载详情…',
        detailFail: '详情加载失败',
        lockTitle: '「我的基金」已锁定',
        lockHint: '个人持仓涉及隐私，请先在 DSH 界面登录账号后再查看。行情页仍可正常浏览。',
        refreshInterval: '刷新间隔',
        seconds: (s) => `${s} 秒`,
        libLabel: '证券基础数据库',
        etfLibLabel: 'ETF 基础库',
        etfCount: n => `${n} 只 ETF · 按主题分类`,
        etfSync: '同步内置清单',
        etfSyncDone: 'ETF 清单已同步',
        etfHint: 'ETF 行情为交易所实时价格，随刷新间隔自动更新；同步会恢复内置 ETF 清单',
        libNever: '未更新',
        libUpdate: '立即更新',
        libUpdating: '更新中…',
        libUpdated: (n, e, d) => `${n} 条 · ETF ${e} 只 · 上次更新 ${d}`,
        libUpdateDone: '基础库已更新',
        editIndices: '编辑指数',
        idxSaved: '指数显示已保存',
        mktTitle: '今日行情',
        subIdx: '指数',
        subFund: '基金',
        subEtf: 'ETF 基金',
        price: '现价',
        pageOf: (p, n) => `第 ${p} / ${n} 页`,
        totalN: n => `共 ${n.toLocaleString('zh-CN')} 只`,
        searchPh: '搜索代码 / 名称 / 拼音，如 HXCZHH',
        prevPage: '上一页',
        nextPage: '下一页',
        intervalHint: '行情自动刷新频率',
        settingsHint: '刷新间隔、基金基础库与指数显示配置已移至：设置 Tab',
        tabHold: '持仓',
        tabWatch: '自选',
        toWatch: '加入我的自选',
        toHold: '加入持仓',
        inWatch: '已在自选',
        watchEmpty: '暂无自选基金。在行情页或下方搜索点「＋ 加自选」即可关注。',
        prevClose: '昨收',
        chg: '涨跌额',
        filterType: '类型',
        allTypes: '全部类型',
        sortCode: '按代码',
        sortUp: '涨幅高→低',
        sortDown: '涨幅低→高',
        actions: '操作',
        dragHint: '拖动可调整顺序（Alt+← / Alt+→ 也可以）',
        addFund: '添加基金',
        addFirst: '添加第一只基金',
        confirmAdd: '确认加仓',
        confirmReduce: '确认减仓',
        currentShares: n => `当前 ${n} 份`,
        afterTrade: n => `→ ${n} 份`,
        confirmEdit: '保存修改',
        selectedFund: '已选择',
        addHint: '输入 6 位代码或名称搜索',
        optionalWatch: '仅自选可留空',
        importShort: '粘贴导入',
        watchRemain: n => `还有 ${n} 只自选`,
        holdCount: n => `持仓 ${n} 只`,
        costShort: '成本',
        sharesShort: '份额',
        amountShort: '金额（元）',
        amountHint: '填金额时按最新净值折算份额，份额与金额可只填一个',
        pendingCalc: '待确认',
        pendingHint: '未取到净值，已记为待确认；第二天取到净值后自动折算份额并保存',
        amountRule: '金额 ÷ 净值 = 份额',
      },
      'en-US': {
        panel: 'Fund assistant',
        tabMarket: "Today's market",
        tabWatchPage: 'Watchlist',
        tabMine: 'My funds',
        tabSettings: 'Settings',
        watchIdxEmpty: 'No watched indices yet. Pick some in Today market, Indices, Edit.',
        loginMaskTitle: 'Amounts hidden',
        loginMaskHint: 'Holdings are private. Sign in with your DSH account to see amounts; indices and market data stay available.',
        addShare: 'Buy',
        reduceShare: 'Sell',
        tradeQtyHint: 'Shares',
        confirmDeleteTitle: 'Delete fund',
        confirmDeleteBody: (n, c) => `Delete ${n} (${c})? This cannot be undone.`,
        confirmDelete: 'Delete',
        loginRequired: 'Sign in with your DSH account first',
        indices: 'Indices',
        yesterday: 'Prev-day change',
        sector: 'Sector',
        realtime: 'realtime',
        themes: 'Sector funds',
        open: 'Funds',
        close: 'Collapse',
        refresh: 'Refresh',
        refreshing: 'Loading…',
        empty: 'No funds yet. Search by code, name or pinyin abbreviation to add, or paste holdings text from Alipay / WeChat / Huaxia Fund to import.',
        addTitle: 'Search to add (code / name / pinyin)',
        importTitle: 'Paste import (Alipay / WeChat / Huaxia holdings text)',
        code: 'Code',
        shares: 'Shares',
        cost: 'Cost per share',
        price: 'Price',
        add: 'Save',
        edit: 'Edit',
        cancel: 'Cancel',
        import: 'Import',
        importing: 'Importing…',
        imported: (n, f) => `Parsed ${n} funds, imported ${f}`,
        importFailed: 'No fund code found. Paste text that contains your holdings.',
        invalidCode: 'Fund code must be 6 digits',
        nav: 'NAV',
        today: 'Today',
        holdAmount: 'Market value',
        todayProfit: "Today's P/L",
        totalProfit: 'Holding P/L',
        totalPct: 'Return',
        remove: 'Remove',
        watch: 'Watch',
        noShares: 'Watchlist',
        overview: 'Overview',
        totalAsset: 'Total assets',
        sortBy: 'Sort',
        sortToday: 'Today',
        sortProfit: 'Holding P/L',
        sortAmount: 'Market value',
        detail: 'Detail',
        spans: 'Period returns',
        spanW1: '1W', spanM1: '1M', spanM3: '3M', spanM6: '6M', spanY1: '1Y', spanTotal: 'Inception',
        trend: 'NAV trend (3M)',
        latestNav: 'Latest NAV',
        loadingDetail: 'Loading detail…',
        detailFail: 'Detail fetch failed',
        lockTitle: '"My funds" is locked',
        lockHint: 'Holdings are private. Sign in with your DSH account to view them. Market data stays available.',
        refreshInterval: 'Refresh',
        seconds: (s) => `${s}s`,
        libLabel: 'Securities master database',
        etfLibLabel: 'ETF library',
        etfCount: n => `${n} ETFs, grouped by theme`,
        etfSync: 'Sync built-in list',
        etfSyncDone: 'ETF list synced',
        etfHint: 'ETF quotes are realtime exchange prices, refreshed automatically; sync restores the built-in ETF list',
        libNever: 'never',
        libUpdate: 'Update now',
        libUpdating: 'Updating…',
        libUpdated: (n, e, d) => `${n} entries · ETF ${e} · updated ${d}`,
        libUpdateDone: 'Library updated',
        editIndices: 'Edit indices',
        idxSaved: 'Index selection saved',
        mktTitle: "Today's market",
        subIdx: 'Indices',
        subFund: 'Funds',
        subEtf: 'ETF funds',
        price: 'Price',
        pageOf: (p, n) => `Page ${p} / ${n}`,
        totalN: n => `${n.toLocaleString('en-US')} total`,
        searchPh: 'Search code / name / pinyin, e.g. HXCZHH',
        prevPage: 'Previous page',
        nextPage: 'Next page',
        intervalHint: 'Auto-refresh frequency',
        settingsHint: 'Refresh interval, fund library and index display moved to: Settings → Fund tracker',
        tabHold: 'Holdings',
        tabWatch: 'Watchlist',
        toWatch: 'Add to watchlist',
        toHold: 'Add to holdings',
        inWatch: 'In watchlist',
        watchEmpty: 'No watchlist items yet. Add from the market tab or search below.',
        prevClose: 'Prev close',
        chg: 'Change',
        filterType: 'Type',
        allTypes: 'All types',
        sortCode: 'By code',
        sortUp: 'Gain high→low',
        sortDown: 'Gain low→high',
        actions: 'Actions',
        dragHint: 'Drag to reorder (or Alt+← / Alt+→)',
        addFund: 'Add fund',
        addFirst: 'Add your first fund',
        confirmAdd: 'Confirm buy',
        confirmReduce: 'Confirm sell',
        currentShares: n => `Currently ${n} shares`,
        afterTrade: n => `→ ${n} shares`,
        confirmEdit: 'Save changes',
        selectedFund: 'Selected',
        addHint: 'Enter a 6-digit code or search by name',
        optionalWatch: 'Optional for watchlist',
        importShort: 'Paste import',
        watchRemain: n => `${n} more in watchlist`,
        holdCount: n => `${n} holdings`,
        costShort: 'Cost',
        sharesShort: 'Shares',
        amountShort: 'Amount (CNY)',
        amountHint: 'Amount is converted to shares at the latest NAV; fill either shares or amount',
        pendingCalc: 'Pending',
        pendingHint: 'No NAV yet, saved as pending — shares are calculated and stored after the next quote',
        amountRule: 'amount ÷ NAV = shares',
      },
    };
    const currentLocaleRef = { id: 'zh-CN' };
    function makeT() {
      return key => {
        const dict = DICTS[currentLocaleRef.id] || DICTS['zh-CN'];
        const v = dict[key];
        return typeof v === 'function' ? v : v || key;
      };
    }

    function loadCache() {
      try {
        const raw = localStorage.getItem(CACHE_KEY);
        const list = raw ? JSON.parse(raw) : [];
        return Array.isArray(list) ? list.filter(x => x && /^\d{6}$/.test(x.code)) : [];
      } catch { return []; }
    }
    function saveCache(list) {
      try { localStorage.setItem(CACHE_KEY, JSON.stringify(list)); } catch {}
    }
    function loadInterval() {
      try {
        const v = Number(localStorage.getItem(INTERVAL_KEY));
        return INTERVAL_OPTIONS.includes(v) ? v : 60;
      } catch { return 60; }
    }

    function parsePasted(text) {
      const found = new Map();
      for (const line of String(text || '').split(/\r?\n/)) {
        const codeMatch = /(?:^|[^\d])(\d{6})(?=[^\d]|$)/.exec(line);
        if (!codeMatch) continue;
        const code = codeMatch[1];
        const num = re => { const m = re.exec(line); return m ? Number(m[1].replace(/,/g, '')) : null; };
        const shares = num(/(?:份额|持有数量)[^\d-]*(-?[\d,]+(?:\.\d+)?)/);
        const cost = num(/成本[^\d-]*(-?[\d,]+(?:\.\d+)?)/);
        const amount = num(/金额[^\d-]*(-?[\d,]+(?:\.\d+)?)/);
        const nameMatch = /([\u4e00-\u9fa5A-Za-z0-9*]{2,20})/.exec(line.replace(/[\d,.\-+%/（）()：:|]/g, ' ').trim());
        const existing = found.get(code) || {};
        found.set(code, {
          code,
          name: existing.name || (nameMatch ? nameMatch[1].trim() : ''),
          shares: existing.shares ?? shares ?? amount,
          cost: existing.cost ?? cost,
        });
      }
      return [...found.values()];
    }

    function money(v, digits = 2) {
      if (v == null || !isFinite(v)) return '—';
      return v.toLocaleString('zh-CN', { minimumFractionDigits: digits, maximumFractionDigits: digits });
    }
    function pct(v) {
      if (v == null || !isFinite(v)) return '—';
      return `${v >= 0 ? '+' : ''}${v.toFixed(2)}%`;
    }
    function signColor(v) {
      if (v == null || !isFinite(v) || v === 0) return 'var(--dsw-alias-label-secondary)';
      return v > 0 ? 'var(--dsw-alias-state-error-primary)' : 'var(--dsw-alias-state-success-primary)';
    }
    function signedMoney(v, digits = 2) {
      if (v == null || !isFinite(v)) return '—';
      const abs = Math.abs(v).toLocaleString('zh-CN', { minimumFractionDigits: digits, maximumFractionDigits: digits });
      return `${v > 0 ? '+' : v < 0 ? '−' : ''}${abs}`;
    }

    const css = `
.ft-root{position:fixed;right:0;top:38%;z-index:60;font-size:12px;color:var(--dsw-alias-label-primary);}
.ft-chip{writing-mode:vertical-rl;letter-spacing:3px;padding:14px 5px;border:1px solid var(--dsw-alias-border-l2);border-right:none;border-radius:8px 0 0 8px;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);cursor:pointer;font:inherit;font-size:12px;box-shadow:-2px 2px 8px rgba(0,0,0,.18);}
.ft-chip:hover{background:var(--dsw-alias-bg-layer-2);}
.ft-panel{position:fixed;right:34px;top:20%;z-index:60;width:640px;max-width:calc(100vw - 60px);max-height:72vh;overflow:auto;background:var(--dsw-alias-bg-layer-1);border:1px solid var(--dsw-alias-border-l1);border-radius:12px;box-shadow:-4px 6px 24px rgba(0,0,0,.22);padding:8px 12px 12px;}
.ft-bar{display:flex;align-items:center;gap:8px;width:100%;padding:4px 2px;text-align:left;color:inherit;font:inherit;}
.ft-bar-title{font-weight:600;white-space:nowrap;}
.ft-bar-sum{margin-left:auto;display:flex;gap:10px;align-items:center;white-space:nowrap;}
.ft-tabs{display:flex;gap:4px;border-bottom:1px solid var(--dsw-alias-border-l1);margin:2px 0 8px;}
.ft-tab{border:none;background:none;color:var(--dsw-alias-label-secondary);cursor:pointer;padding:5px 12px;font:inherit;font-size:12px;border-bottom:2px solid transparent;}
.ft-tab:hover{color:var(--dsw-alias-label-primary);}
.ft-tab-active{color:var(--dsw-alias-brand-primary);border-bottom-color:var(--dsw-alias-brand-primary);font-weight:600;}
.ft-tab-lock{opacity:.5;}
.ft-close{background:none;border:none;color:var(--dsw-alias-label-secondary);cursor:pointer;padding:2px 6px;border-radius:4px;font-size:14px;}
.ft-close:hover{color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-layer-2);}
.ft-overview{display:grid;grid-template-columns:repeat(4,1fr);gap:6px;background:var(--dsw-alias-bg-layer-2);border-radius:8px;padding:8px;margin-bottom:8px;}
.ft-ov-cell{text-align:center;}
.ft-ov-label{color:var(--dsw-alias-label-secondary);font-size:11px;}
.ft-ov-value{font-weight:600;font-size:13px;}
.ft-lock{background:var(--dsw-alias-bg-layer-2);border-radius:8px;padding:16px;text-align:center;color:var(--dsw-alias-label-secondary);}
.ft-lock-title{font-weight:600;color:var(--dsw-alias-label-primary);margin-bottom:6px;}
.ft-section{margin-top:8px;}
.ft-section-title{color:var(--dsw-alias-label-secondary);font-weight:600;margin:6px 0 4px;}
.ft-idx-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:6px;}
.ft-idx-cell{background:var(--dsw-alias-bg-layer-2);border-radius:8px;padding:6px 8px;text-align:center;}
.ft-idx-name{color:var(--dsw-alias-label-secondary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
.ft-idx-price{font-weight:600;}
.ft-idx-pct{font-weight:600;}
.ft-table{width:100%;border-collapse:collapse;}
.ft-table th{color:var(--dsw-alias-label-secondary);font-weight:500;text-align:right;padding:2px 6px;white-space:nowrap;}
.ft-table th:first-child{text-align:left;}
.ft-table td{padding:4px 6px;text-align:right;white-space:nowrap;}
.ft-table td:first-child{text-align:left;}
.ft-table tbody tr:hover td{background:var(--dsw-alias-bg-layer-2);}
.ft-row{cursor:pointer;}
.ft-code{color:var(--dsw-alias-label-secondary);}
.ft-del,.ft-act{background:none;border:none;color:var(--dsw-alias-label-secondary);cursor:pointer;padding:2px 4px;border-radius:4px;}
.ft-del:hover{color:var(--dsw-alias-state-error-primary);background:var(--dsw-alias-bg-layer-2);}
.ft-act{font:inherit;font-size:11px;}
.ft-act:hover{color:var(--dsw-alias-brand-primary);background:var(--dsw-alias-bg-layer-2);}
.ft-actions{display:flex;align-items:center;gap:8px;margin-top:8px;flex-wrap:wrap;color:var(--dsw-alias-label-secondary);}
.ft-btn-danger{background:var(--dsw-alias-state-error-primary);border-color:var(--dsw-alias-state-error-primary);color:#ffffff;}
.ft-btn-danger:hover{filter:brightness(1.1);}
.ft-btn{border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary);border-radius:6px;padding:3px 10px;cursor:pointer;font:inherit;font-size:12px;}
.ft-btn:hover{border-color:var(--dsw-alias-brand-primary);}
.ft-select{border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);border-radius:6px;padding:3px 6px;font:inherit;font-size:12px;}
.ft-input{border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);border-radius:6px;padding:3px 8px;font:inherit;font-size:12px;width:110px;}
.ft-input-sm{width:80px;}
.ft-textarea{width:100%;min-height:72px;resize:vertical;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);border-radius:8px;padding:6px 8px;font:inherit;font-size:12px;margin-top:8px;}
.ft-suggest{position:relative;}
.ft-suggest-list{position:absolute;left:0;top:100%;z-index:70;min-width:280px;background:var(--dsw-alias-bg-overlay);border:1px solid var(--dsw-alias-border-l2);border-radius:8px;box-shadow:0 6px 20px rgba(0,0,0,.2);max-height:200px;overflow:auto;}
.ft-suggest-item{display:flex;gap:8px;padding:5px 10px;cursor:pointer;align-items:baseline;}
.ft-suggest-item:hover{background:var(--dsw-alias-bg-layer-2);}
.ft-suggest-type{color:var(--dsw-alias-label-secondary);font-size:11px;margin-left:auto;}
.ft-msg{margin-top:6px;color:var(--dsw-alias-label-secondary);}
.ft-err{color:var(--dsw-alias-state-error-primary);}
.ft-subtabs{display:flex;gap:2px;margin:0 0 8px;background:var(--dsw-alias-bg-layer-2);border-radius:8px;padding:2px;}
.ft-subtabs .ft-tab{flex:1;text-align:center;border-radius:6px;border-bottom:none;}
.ft-subtabs .ft-tab-active{background:var(--dsw-alias-bg-layer-1);}
.ft-tab-drag{cursor:grab;}
.ft-tab-drag:active{cursor:grabbing;}
.ft-tab-dragover{outline:2px dashed var(--dsw-alias-brand-primary);outline-offset:-2px;}
.ft-tab-dragging{opacity:.45;}
.ft-badge{display:inline-block;min-width:56px;padding:1px 6px;border:1px solid transparent;border-radius:6px;font-weight:600;text-align:center;font-variant-numeric:tabular-nums;}
.ft-flag{display:inline-block;margin-left:6px;padding:0 6px;border-radius:999px;font-size:10px;line-height:16px;border:1px solid var(--dsw-alias-brand-primary);color:var(--dsw-alias-brand-primary);vertical-align:1px;}
.ft-flag-pending{border-color:var(--dsw-alias-label-secondary);color:var(--dsw-alias-label-secondary);}
.ft-pager{display:flex;gap:8px;align-items:center;justify-content:center;margin-top:10px;}
.ft-type{display:inline-block;color:var(--dsw-alias-label-secondary);background:var(--dsw-alias-bg-layer-2);border-radius:4px;padding:0 4px;font-size:11px;max-width:90px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;vertical-align:1px;}
.ft-idx-cell{display:flex;flex-direction:column;gap:2px;align-items:center;}
.ft-settings{max-width:720px;margin:0 auto;color:var(--dsw-alias-label-primary);font-size:13px;}
.ft-set-title{font-size:16px;margin:4px 0 16px;}
.ft-set-block{background:var(--dsw-alias-bg-layer-1);border:1px solid var(--dsw-alias-border-l1);border-radius:10px;padding:12px 16px;margin-bottom:12px;}
.ft-set-label{font-weight:600;margin-bottom:2px;}
.ft-empty{padding:10px 4px;color:var(--dsw-alias-label-secondary);}
.ft-idx-editor{background:var(--dsw-alias-bg-layer-2);border-radius:8px;padding:8px;margin-bottom:8px;}
.ft-idx-picks{display:flex;gap:6px;flex-wrap:wrap;}
.ft-pick{border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);border-radius:6px;padding:3px 10px;cursor:pointer;font:inherit;font-size:12px;}
.ft-pick:hover{border-color:var(--dsw-alias-brand-primary);}
.ft-pick-on{background:var(--dsw-alias-brand-primary);border-color:var(--dsw-alias-brand-primary);color:var(--dsw-alias-bg-base);font-weight:600;}
.ft-modal-backdrop{position:fixed;inset:0;z-index:80;background:rgba(0,0,0,.35);}
.ft-modal{position:fixed;left:50%;top:50%;transform:translate(-50%,-50%);z-index:81;width:520px;max-width:calc(100vw - 40px);max-height:80vh;overflow:auto;background:var(--dsw-alias-bg-layer-1);border:1px solid var(--dsw-alias-border-l1);border-radius:12px;box-shadow:0 10px 40px rgba(0,0,0,.3);padding:14px 16px;}
.ft-modal h3{margin:0 0 4px;font-size:15px;}
.ft-chips{display:flex;gap:6px;flex-wrap:wrap;margin:8px 0;}
.ft-chip-span{background:var(--dsw-alias-bg-layer-2);border-radius:6px;padding:4px 8px;text-align:center;}
.ft-chip-label{color:var(--dsw-alias-label-secondary);font-size:11px;}
.ft-chip-value{font-weight:600;}
.ft-spark{width:100%;height:120px;}
.ft-toolbar{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:8px;}
.ft-seg{display:flex;gap:2px;background:var(--dsw-alias-bg-layer-2);border-radius:8px;padding:2px;}
.ft-seg-btn{border:none;background:none;color:var(--dsw-alias-label-secondary);cursor:pointer;padding:3px 10px;border-radius:6px;font:inherit;font-size:11px;min-height:28px;white-space:nowrap;}
.ft-seg-btn:hover{color:var(--dsw-alias-label-primary);}
.ft-seg-btn-on{background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-brand-primary);font-weight:600;}
.ft-toolbar .ft-btn:not(.ft-btn-primary){min-height:28px;}
.ft-list{list-style:none;margin:0;padding:0;}
.ft-card{border:1px solid var(--dsw-alias-border-l1);border-radius:10px;padding:8px 10px;margin-bottom:6px;}
.ft-card:hover{background:var(--dsw-alias-bg-layer-2);}
.ft-card-main{display:flex;align-items:flex-start;gap:8px;}
.ft-card-id{flex:1;min-width:0;display:flex;flex-direction:column;gap:2px;align-items:flex-start;}
.ft-name{border:none;background:none;padding:0;max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--dsw-alias-label-primary);font:inherit;font-size:12px;font-weight:600;cursor:pointer;border-radius:4px;}
.ft-name:hover{color:var(--dsw-alias-brand-primary);}
.ft-sub{display:flex;align-items:center;gap:6px;flex-wrap:wrap;color:var(--dsw-alias-label-secondary);max-width:100%;}
.ft-card-fig{display:flex;flex-direction:column;align-items:flex-end;gap:2px;text-align:right;flex-shrink:0;}
.ft-amount{font-weight:600;font-size:13px;color:var(--dsw-alias-label-primary);}
.ft-today{color:var(--dsw-alias-label-secondary);}
.ft-more{flex-shrink:0;display:inline-flex;align-items:center;gap:3px;min-height:30px;padding:0 10px;border:1px solid var(--dsw-alias-brand-primary);background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-brand-primary);border-radius:8px;cursor:pointer;font:inherit;font-size:11px;font-weight:600;white-space:nowrap;}
.ft-more:hover{background:var(--dsw-alias-bg-layer-1);}
.ft-more-on{background:var(--dsw-alias-brand-primary);border-color:var(--dsw-alias-brand-primary);color:var(--dsw-alias-bg-base);}
.ft-card-meta{display:grid;grid-template-columns:repeat(4,minmax(0,1fr)) auto;gap:4px 8px;margin-top:6px;align-items:end;}
.ft-meta-cell{display:flex;flex-direction:column;gap:1px;min-width:0;}
.ft-meta-label{color:var(--dsw-alias-label-secondary);font-size:11px;}
.ft-meta-value{color:var(--dsw-alias-label-primary);}
.ft-card-meta .ft-link{justify-self:end;align-self:end;white-space:nowrap;}
.ft-card-actions{display:flex;gap:6px;flex-wrap:wrap;margin-top:8px;padding-top:8px;border-top:1px solid var(--dsw-alias-border-l1);}
.ft-card-actions .ft-act,.ft-card-actions .ft-del{min-height:30px;padding:3px 10px;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);font-size:11px;font-weight:600;white-space:nowrap;}
.ft-card-actions .ft-act:hover{border-color:var(--dsw-alias-brand-primary);color:var(--dsw-alias-brand-primary);background:var(--dsw-alias-bg-layer-2);}
.ft-card-actions .ft-act-buy{border-color:var(--dsw-alias-brand-primary);color:var(--dsw-alias-brand-primary);background:var(--dsw-alias-bg-layer-2);}
.ft-card-actions .ft-act-watch{border-style:dashed;}
.ft-card-actions .ft-act-on{border-style:solid;border-color:var(--dsw-alias-border-l1);color:var(--dsw-alias-label-secondary);background:none;cursor:default;}
.ft-card-actions .ft-del{border-color:var(--dsw-alias-border-l2);color:var(--dsw-alias-state-error-primary);}
.ft-card-actions .ft-del:hover{border-color:var(--dsw-alias-state-error-primary);background:var(--dsw-alias-bg-layer-2);}
.ft-card-actions button:disabled{opacity:.75;}
.ft-card-open{border-color:var(--dsw-alias-brand-primary);}
.ft-form{border:1px solid var(--dsw-alias-border-l2);border-radius:10px;padding:10px 12px;margin-bottom:8px;background:var(--dsw-alias-bg-layer-2);}
.ft-card .ft-form{margin-top:8px;margin-bottom:0;}
.ft-form-title{font-weight:600;margin:0 0 8px;color:var(--dsw-alias-label-primary);}
.ft-field{display:flex;flex-direction:column;gap:2px;min-width:0;}
.ft-field-label{color:var(--dsw-alias-label-secondary);font-size:11px;}
.ft-field-hint{color:var(--dsw-alias-label-secondary);font-size:11px;font-weight:400;}
.ft-empty-card{border:1px dashed var(--dsw-alias-border-l2);border-radius:10px;padding:18px 12px;text-align:center;color:var(--dsw-alias-label-secondary);}
.ft-link{border:none;background:none;padding:0;color:var(--dsw-alias-brand-primary);font:inherit;font-size:12px;cursor:pointer;border-radius:4px;}
.ft-link:hover{text-decoration:underline;}
.ft-chip-code{display:inline-block;background:var(--dsw-alias-bg-layer-1);border:1px solid var(--dsw-alias-brand-primary);color:var(--dsw-alias-brand-primary);border-radius:999px;padding:1px 10px;font-weight:600;font-variant-numeric:tabular-nums;}
.ft-btn-primary{background:var(--dsw-alias-brand-primary);border-color:var(--dsw-alias-brand-primary);color:var(--dsw-alias-bg-base);font-weight:600;min-height:32px;}
.ft-btn-primary:hover{border-color:var(--dsw-alias-brand-primary);filter:brightness(1.08);}
.ft-ov-value-lg{font-size:16px;font-variant-numeric:tabular-nums;}
.ft-num{font-variant-numeric:tabular-nums;}
.ft-suggest-item{width:100%;background:none;border:none;font:inherit;color:inherit;text-align:left;}
.ft-root :focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:2px;border-radius:4px;}
@media (max-width:720px){ .ft-card-meta{grid-template-columns:repeat(2,1fr)} }
`;

    function useQuotes(codes, refreshKey) {
      const [quotes, setQuotes] = useState({});
      useEffect(() => {
        let alive = true;
        if (codes.length === 0) { setQuotes({}); return; }
        fetch(`/fund-tracker/quotes?codes=${codes.join(',')}`)
          .then(r => r.json())
          .then(data => {
            if (!alive) return;
            const next = {};
            const yd = (data && data.yesterday) || {};
            for (const q of (data && data.quotes) || []) {
              next[q.code] = { ...q, yesterdayPct: yd[q.code] != null ? yd[q.code] : null };
            }
            setQuotes(next);
          })
          .catch(() => {});
        return () => { alive = false; };
      }, [codes.join(','), refreshKey]);
      return quotes;
    }

    // Sector keywords -> realtime ETF quote (by ETF code).
    const SECTOR_KEYWORDS = [
      ['半导体', '512480'], ['芯片', '512480'], ['光伏', '515790'], ['新能源', '515030'],
      ['电池', '159875'], ['白酒', '512690'], ['酒', '512690'], ['食品', '159928'],
      ['消费', '159928'], ['医药', '512010'], ['医疗', '159929'], ['药', '512010'],
      ['军工', '512660'], ['国防', '512660'], ['券商', '512000'], ['证券', '512000'],
      ['银行', '512800'], ['保险', '512000'], ['有色', '512400'], ['稀土', '512400'],
      ['传媒', '512980'], ['影视', '512980'], ['电力', '159611'], ['水电', '159611'],
      ['科技', '512480'], ['通信', '515050'], ['红利', '510880'],
    ];
    function sectorOf(name) {
      const n = String(name || '');
      for (const [kw, code] of SECTOR_KEYWORDS) {
        if (n.includes(kw)) return { kw, etfCode: code };
      }
      return null;
    }
    function SectorCell({ t, name, marketQuotes }) {
      const s = sectorOf(name);
      if (!s) return h('span', { className: 'ft-code' }, '—');
      const q = marketQuotes[s.etfCode];
      return h('span', { title: `${s.kw} · ${t('realtime')}` },
        h('span', { className: 'ft-type' }, `${s.kw}板块`),
        ' ',
        q && q.changePct != null
          ? h('span', { style: { color: signColor(q.changePct), fontWeight: 600, fontVariantNumeric: 'tabular-nums' } }, pct(q.changePct))
          : h('span', { className: 'ft-code' }, '…'),
      );
    }

    function useMarket(refreshKey) {
      const [market, setMarket] = useState({ indices: [], etfs: [], legacy: false });
      useEffect(() => {
        let alive = true;
        fetch('/fund-tracker/quotes?market=1')
          .then(r => r.json())
          .then(data => {
            if (!alive) return;
            // Legacy host modules (pre-ETF) return no `etfs` key at all.
            const legacy = data && !('etfs' in data);
            setMarket({ indices: (data && data.indices) || [], etfs: legacy ? [] : (data && data.etfs) || [], legacy });
          })
          .catch(() => {});
        return () => { alive = false; };
      }, [refreshKey]);
      return market;
    }

    class PanelBoundary extends React.Component {
      constructor(props) { super(props); this.state = { error: null }; }
      static getDerivedStateFromError(error) { return { error }; }
      render() {
        if (this.state.error) {
          return h('div', { className: 'ft-empty ft-err' }, `渲染异常: ${this.state.error && this.state.error.message}`);
        }
        return this.props.children;
      }
    }

    function useIndexConfig(refreshKey) {
      const [config, setConfig] = useState({ library: [], selected: [], loggedIn: false });
      useEffect(() => {
        let alive = true;
        fetch('/fund-tracker/api?action=indices')
          .then(r => r.json())
          .then(data => { if (alive && data && Array.isArray(data.library)) setConfig(data); })
          .catch(() => {});
        return () => { alive = false; };
      }, [refreshKey]);
      return config;
    }

    function Sparkline({ points, height = 120 }) {
      if (!points || points.length < 2) return h('div', { className: 'ft-empty' }, '…');
      const values = points.map(p => p.v);
      const min = Math.min(...values);
      const max = Math.max(...values);
      const range = max - min || 1;
      const W = 480, H = height, pad = 6;
      const coords = points.map((p, i) => [
        pad + (W - 2 * pad) * (i / (points.length - 1)),
        pad + (H - 2 * pad) * (1 - (p.v - min) / range),
      ]);
      const path = coords.map(c => c.join(',')).join(' ');
      const first = values[0], lastV = values[values.length - 1];
      const color = lastV >= first ? 'var(--dsw-alias-state-error-primary)' : 'var(--dsw-alias-state-success-primary)';
      return h('svg', { className: 'ft-spark', viewBox: `0 0 ${W} ${H}`, preserveAspectRatio: 'none' },
        h('polyline', { points: path, fill: 'none', stroke: color, strokeWidth: 2 }),
      );
    }

    function FundDetail({ code, name, t, onClose }) {
      const [detail, setDetail] = useState(null);
      const [failed, setFailed] = useState(false);
      useEffect(() => {
        let alive = true;
        fetch(`/fund-tracker/api?action=detail&code=${code}`)
          .then(r => r.json())
          .then(data => { if (alive) setDetail(data && data.detail); })
          .catch(() => { if (alive) setFailed(true); });
        return () => { alive = false; };
      }, [code]);
      const spanKeys = [['spanW1', 'w1'], ['spanM1', 'm1'], ['spanM3', 'm3'], ['spanM6', 'm6'], ['spanY1', 'y1'], ['spanTotal', 'totalPct']];
      return h(React.Fragment, null,
        h('div', { className: 'ft-modal-backdrop', onClick: onClose }),
        h('div', { className: 'ft-modal', role: 'dialog', 'aria-label': `${name || code} ${t('detail')}` },
          h('div', { className: 'ft-bar' },
            h('h3', null, `${name || ''} `, h('span', { className: 'ft-code' }, code)),
            h('span', { className: 'ft-bar-sum' },
              h('button', { className: 'ft-close', onClick: onClose, 'aria-label': t('close') }, '✕')),
          ),
          !detail && !failed && h('div', { className: 'ft-msg' }, t('loadingDetail')),
          failed && h('div', { className: 'ft-msg ft-err' }, t('detailFail')),
          detail && h(React.Fragment, null,
            h('div', { className: 'ft-msg' },
              `${t('latestNav')}: ${money(detail.latestNav, 4)} (${detail.latestDate})`,
              detail.totalPct != null ? ` · ${t('spanTotal')} ${pct(detail.totalPct)}` : '',
            ),
            h('div', { className: 'ft-section-title' }, t('spans')),
            h('div', { className: 'ft-chips' },
              spanKeys.map(([label, key]) => h('div', { className: 'ft-chip-span', key },
                h('div', { className: 'ft-chip-label' }, t(label)),
                h('div', { className: 'ft-chip-value', style: { color: signColor(detail.spans ? detail.spans[key] : null) } },
                  pct(detail.spans ? detail.spans[key] : null)),
              )),
            ),
            h('div', { className: 'ft-section-title' }, t('trend')),
            h(Sparkline, { points: detail.trend3m }),
          ),
        ),
      );
    }

    function ChangeBadge({ v }) {
      const text = pct(v);
      const tone = v == null || !isFinite(v) || v === 0
        ? 'var(--dsw-alias-label-secondary)'
        : v > 0 ? 'var(--dsw-alias-state-error-primary)' : 'var(--dsw-alias-state-success-primary)';
      return h('span', { className: 'ft-badge', style: { color: tone, borderColor: tone } }, text);
    }

    function Pager({ t, page, size, total, onPage }) {
      const pages = Math.max(1, Math.ceil(total / size));
      return h('div', { className: 'ft-pager' },
        h('button', { className: 'ft-btn', disabled: page <= 1, onClick: () => onPage(page - 1), 'aria-label': t('prevPage') }, '‹'),
        h('span', { className: 'ft-code' }, t('pageOf')(page, pages)),
        h('button', { className: 'ft-btn', disabled: page >= pages, onClick: () => onPage(page + 1), 'aria-label': t('nextPage') }, '›'),
        h('span', { className: 'ft-code' }, t('totalN')(total)),
      );
    }

    function IndexSub({ t, idxQuotes, idxConfig, onSaveSelection, holdingsCodes, onWatch, refreshKey }) {
      const [page, setPage] = useState(1);
      const size = 12;
      const [data, setData] = useState({ items: [], total: 0 });
      useEffect(() => {
        let alive = true;
        fetch(`/fund-tracker/api?action=indexlist&page=${page}&size=${size}`)
          .then(r => r.json())
          .then(d => {
            if (!alive) return;
            setData({ items: (d && d.items) || [], total: (d && d.total) || 0, error: (d && d.error) || '' });
          })
          .catch(e => { if (alive) setData({ items: [], total: 0, error: `fetch failed: ${e}` }); });
        return () => { alive = false; };
      }, [page, refreshKey]);
      const [editingIdx, setEditingIdx] = useState(false);
      const [picked, setPicked] = useState(null);
      const selected = picked || idxConfig.selected || [];
      const toggle = code => {
        const base = picked || [...(idxConfig.selected || [])];
        setPicked(base.includes(code) ? base.filter(c => c !== code) : [...base, code]);
      };
      const byCategory = useMemo(() => {
        const groups = new Map();
        for (const item of idxConfig.library || []) {
          const key = item.category || '其他';
          if (!groups.has(key)) groups.set(key, []);
          groups.get(key).push(item);
        }
        return groups;
      }, [idxConfig.library]);
      return h(React.Fragment, null,
        h('div', { className: 'ft-bar', style: { padding: 0 } },
          h('span', { className: 'ft-section-title', style: { margin: '6px 0 4px' } }, t('indices')),
          h('span', { className: 'ft-bar-sum' },
            h('button', { className: 'ft-act', onClick: () => { setEditingIdx(o => !o); setPicked(null); } },
              editingIdx ? t('cancel') : t('editIndices')),
          ),
        ),
        editingIdx && h('div', { className: 'ft-idx-editor' },
          [...byCategory.entries()].map(([category, items]) => h('div', { key: category },
            h('div', { className: 'ft-section-title' }, category),
            h('div', { className: 'ft-idx-picks' },
              items.map(item => h('button', {
                key: item.code,
                className: `ft-pick${selected.includes(item.code) ? ' ft-pick-on' : ''}`,
                onClick: () => toggle(item.code),
                title: `${item.name} (${item.code})`,
              }, item.name)),
            ),
          )),
          h('div', { className: 'ft-actions' },
            h('button', { className: 'ft-btn', disabled: picked == null, onClick: () => onSaveSelection(selected, () => { setEditingIdx(false); setPicked(null); }) }, t('add')),
            !idxConfig.loggedIn && h('span', { className: 'ft-msg ft-err' }, t('lockHint')),
          ),
        ),
        data.items.length === 0
          ? h('div', { className: `ft-empty${data.error ? ' ft-err' : ''}` }, data.error || t('refreshing'))
          : h('div', { className: 'ft-idx-grid' },
              data.items.map(idx => {
                const q = idxQuotes[idx.code];
                const watched = holdingsCodes.includes(idx.code);
                return h('div', { className: 'ft-idx-cell', key: idx.code },
                  h('div', { className: 'ft-idx-name', title: idx.name }, idx.name),
                  h('div', { className: 'ft-code' }, idx.code, ' · ', idx.category || ''),
                  h('div', { className: 'ft-idx-price' }, money(q ? q.price : null)),
                  h('div', { className: 'ft-idx-pct' }, h(ChangeBadge, { v: q ? q.changePct : null })),
                  h('button', {
                    className: 'ft-act', disabled: watched,
                    onClick: () => onWatch({ code: idx.code, name: idx.name }),
                    'aria-label': `${t('watch')} ${idx.name}`,
                  }, watched ? '✓' : `＋ ${t('watch')}`),
                );
              }),
            ),
        h(Pager, { t, page, size, total: data.total, onPage: setPage }),
      );
    }

    function SignValue({ v, digits = 4 }) {
      if (v == null || !isFinite(v)) return h('span', null, '—');
      const text = `${v >= 0 ? '+' : ''}${v.toFixed(digits)}`;
      return h('span', { style: { color: signColor(v), fontWeight: 600, fontVariantNumeric: 'tabular-nums' } }, text);
    }

    function FundSub({ t, holdingsCodes, onWatch, onOpenDetail, refreshKey }) {
      const [page, setPage] = useState(1);
      const [query, setQuery] = useState('');
      const [fundType, setFundType] = useState('all');
      const [sort, setSort] = useState('code');
      const [types, setTypes] = useState([]);
      const [data, setData] = useState({ items: [], total: 0, error: '' });
      const [loading, setLoading] = useState(true);
      const size = 20;
      useEffect(() => {
        let alive = true;
        fetch('/fund-tracker/api?action=fundtypes')
          .then(r => r.json())
          .then(d => { if (alive) setTypes((d && d.types) || []); })
          .catch(() => {});
        return () => { alive = false; };
      }, [refreshKey]);
      useEffect(() => {
        let alive = true;
        setLoading(true);
        const timer = setTimeout(() => {
          fetch(`/fund-tracker/api?action=fundlist&page=${page}&size=${size}&query=${encodeURIComponent(query.trim())}&type=${encodeURIComponent(fundType)}`)
            .then(r => r.json())
            .then(d => {
              if (!alive) return;
              setData({ items: (d && d.items) || [], total: (d && d.total) || 0, error: (d && d.error) || '' });
              setLoading(false);
            })
            .catch(e => { if (alive) { setData({ items: [], total: 0, error: `fetch failed: ${e}` }); setLoading(false); } });
        }, 250);
        return () => { alive = false; clearTimeout(timer); };
      }, [page, query, fundType, refreshKey]);
      const codes = useMemo(() => data.items.map(x => x.code), [data.items]);
      const quotes = useQuotes(codes, refreshKey);
      const list = useMemo(() => {
        const arr = data.items.map(item => ({ ...item, q: quotes[item.code] }));
        if (sort === 'up') arr.sort((a, b) => (b.q ? b.q.changePct ?? -Infinity : -Infinity) - (a.q ? a.q.changePct ?? -Infinity : -Infinity));
        if (sort === 'down') arr.sort((a, b) => (a.q ? a.q.changePct ?? Infinity : Infinity) - (b.q ? b.q.changePct ?? Infinity : Infinity));
        return arr;
      }, [data.items, quotes, sort]);
      return h(React.Fragment, null,
        h('div', { className: 'ft-actions', style: { marginTop: 4 } },
          h('input', {
            className: 'ft-input', style: { width: 200 },
            placeholder: t('searchPh'), value: query, 'aria-label': t('searchPh'),
            onChange: e => { setQuery(e.target.value); setPage(1); },
          }),
          h('span', null, `${t('filterType')}:`),
          h('select', { className: 'ft-select', value: fundType, 'aria-label': t('filterType'), onChange: e => { setFundType(e.target.value); setPage(1); } },
            h('option', { value: 'all' }, t('allTypes')),
            types.map(x => h('option', { key: x.type, value: x.type }, `${x.type} (${x.n})`)),
          ),
          h('span', null, `${t('sortBy')}:`),
          h('select', { className: 'ft-select', value: sort, 'aria-label': t('sortBy'), onChange: e => setSort(e.target.value) },
            h('option', { value: 'code' }, t('sortCode')),
            h('option', { value: 'up' }, t('sortUp')),
            h('option', { value: 'down' }, t('sortDown')),
          ),
        ),
        loading && !data.error
          ? h('div', { className: 'ft-empty' }, t('refreshing'))
          : data.error
            ? h('div', { className: 'ft-empty ft-err' }, data.error)
            : h('table', { className: 'ft-table' },
                h('thead', null, h('tr', null,
                  h('th', null, t('panel')), h('th', null, t('sector')), h('th', null, t('prevClose')), h('th', null, t('nav')),
                  h('th', null, t('chg')), h('th', null, t('yesterday')), h('th', null, ''),
                )),
                h('tbody', null, list.map(item => {
                  const q = item.q;
                  const nav = q ? q.nav : null;
                  const prev = q ? q.prevNav : null;
                  const chg = nav != null && prev != null ? nav - prev : null;
                  const yesterdayPct = q && q.yesterdayPct != null ? q.yesterdayPct : (q ? q.changePct : null);
                  const watched = holdingsCodes.includes(item.code);
                  return h('tr', { key: item.code },
                    h('td', { className: 'ft-row', onClick: () => onOpenDetail(item) },
                      item.name || item.code, ' ',
                      h('span', { className: 'ft-code' }, item.code),
                      ' ', h('span', { className: 'ft-type' }, item.type || ''),
                    ),
                    h('td', null, h(SectorCell, { t, name: item.name, marketQuotes })),
                    h('td', null, money(prev)),
                    h('td', null, money(nav)),
                    h('td', null, h(SignValue, { v: chg })),
                    h('td', null, h(ChangeBadge, { v: yesterdayPct })),
                    h('td', null, watched
                      ? h('span', { className: 'ft-code' }, '✓')
                      : h('button', { className: 'ft-act', onClick: () => onWatch(item) }, `＋ ${t('watch')}`),
                    ),
                  );
                })),
              ),
        h(Pager, { t, page, size, total: data.total, onPage: setPage }),
      );
    }

    function FundSettings() {
      const t = makeT();
      const [intervalSec, setIntervalSecState] = useState(loadInterval);
      const [libInfo, setLibInfo] = useState(null);
      const [etfCount, setEtfCount] = useState(null);
      const [etfSyncing, setEtfSyncing] = useState(false);
      const [libUpdating, setLibUpdating] = useState(false);
      const [msg, setMsg] = useState(null);
      const [idxConfig, setIdxConfig] = useState({ library: [], selected: [], loggedIn: true });
      const [picked, setPicked] = useState(null);
      const selected = picked || idxConfig.selected || [];
      const toggle = code => {
        const base = picked || [...(idxConfig.selected || [])];
        setPicked(base.includes(code) ? base.filter(c => c !== code) : [...base, code]);
      };
      const load = useCallback(() => {
        fetch('/fund-tracker/api?action=libinfo').then(r => r.json())
          .then(info => { if (info && info.count != null) setLibInfo(info); }).catch(() => {});
        fetch('/fund-tracker/api?action=etfinfo').then(r => r.json())
          .then(info => { if (info && info.count != null) setEtfCount(info.count); }).catch(() => {});
        fetch('/fund-tracker/api?action=indices').then(r => r.json())
          .then(data => { if (data && Array.isArray(data.library)) setIdxConfig(data); }).catch(() => {});
      }, []);
      useEffect(load, [load]);
      useEffect(() => {
        const handler = () => load();
        window.addEventListener('ft-lib-changed', handler);
        return () => window.removeEventListener('ft-lib-changed', handler);
      }, [load]);
      const setIntervalSec = v => {
        setIntervalSecState(v);
        try { localStorage.setItem(INTERVAL_KEY, String(v)); } catch {}
        window.dispatchEvent(new CustomEvent('ft-interval-changed', { detail: v }));
      };
      const refreshLib = async () => {
        setLibUpdating(true);
        try {
          const response = await fetch('/fund-tracker/api?action=refreshlib', { method: 'POST' });
          const info = await response.json();
          if (info && info.count != null) {
            setLibInfo(info);
            setMsg({ kind: 'ok', text: t('libUpdateDone') });
            window.dispatchEvent(new CustomEvent('ft-lib-changed'));
          }
        } catch {} finally { setLibUpdating(false); }
      };
      const saveSelection = async () => {
        try {
          const response = await fetch('/fund-tracker/api?action=savesettings', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ key: 'indices', value: selected }),
          });
          if (response.ok) {
            setMsg({ kind: 'ok', text: t('idxSaved') });
            setPicked(null);
            load();
          }
        } catch {}
      };
      const byCategory = useMemo(() => {
        const groups = new Map();
        for (const item of idxConfig.library || []) {
          const key = item.category || '其他';
          if (!groups.has(key)) groups.set(key, []);
          groups.get(key).push(item);
        }
        return groups;
      }, [idxConfig.library]);
      return h('div', { className: 'ft-settings' },
        h('style', null, css),
        h('h2', { className: 'ft-set-title' }, '📈 ', t('panel')),
        h('div', { className: 'ft-set-block' },
          h('div', { className: 'ft-set-label' }, t('refreshInterval')),
          h('div', { className: 'ft-actions', style: { marginTop: 4 } },
            h('select', {
              className: 'ft-select', value: intervalSec, 'aria-label': t('refreshInterval'),
              onChange: e => setIntervalSec(Number(e.target.value)),
            }, INTERVAL_OPTIONS.map(s => h('option', { key: s, value: s }, t('seconds')(s)))),
            h('span', { className: 'ft-code' }, t('intervalHint')),
          ),
        ),
        h('div', { className: 'ft-set-block' },
          h('div', { className: 'ft-set-label' }, `${t('libLabel')} · ${t('indices')} / ${t('subFund')}`),
          h('div', { className: 'ft-actions', style: { marginTop: 4 } },
            h('span', null, libInfo
              ? t('libUpdated')(libInfo.count, libInfo.etfCount != null ? libInfo.etfCount : '—', libInfo.refreshedAt ? new Date(libInfo.refreshedAt).toLocaleString('zh-CN') : t('libNever'))
              : t('refreshing')),
            h('button', { className: 'ft-btn', disabled: libUpdating, onClick: refreshLib },
              libUpdating ? t('libUpdating') : t('libUpdate')),
          ),
        ),
        h('div', { className: 'ft-set-block' },
          h('div', { className: 'ft-set-label' }, `${t('editIndices')} · ${t('panel')}`),
          [...byCategory.entries()].map(([category, items]) => h('div', { key: category },
            h('div', { className: 'ft-section-title' }, category),
            h('div', { className: 'ft-idx-picks' },
              items.map(item => h('button', {
                key: item.code,
                className: `ft-pick${selected.includes(item.code) ? ' ft-pick-on' : ''}`,
                onClick: () => toggle(item.code),
                title: `${item.name} (${item.code})`,
              }, item.name)),
            ),
          )),
          h('div', { className: 'ft-actions' },
            h('button', { className: 'ft-btn', disabled: picked == null, onClick: saveSelection }, t('add')),
          ),
        ),
        msg && h('div', { className: `ft-msg${msg.kind === 'err' ? ' ft-err' : ''}` }, msg.text),
      );
    }

    function EtfSub({ t, etfs, holdingsCodes, onWatch, onOpenDetail, legacy }) {
      const sorted = useMemo(
        () => [...etfs].sort((a, b) => (b.changePct ?? -Infinity) - (a.changePct ?? -Infinity)),
        [etfs],
      );
      if (legacy) {
        return h('div', { className: 'ft-lock' },
          h('div', { className: 'ft-lock-title' }, '⚠ ETF 实时行情需要更新宿主模块'),
          h('div', null, '当前 DSH 进程仍在运行旧版行情接口。请完全退出并重启 DSH 应用，然后刷新页面即可看到 24 只 ETF 的实时涨跌。'),
        );
      }
      if (sorted.length === 0) return h('div', { className: 'ft-empty' }, t('refreshing'));
      return h('table', { className: 'ft-table' },
        h('thead', null, h('tr', null,
          h('th', null, 'ETF'), h('th', null, t('price')), h('th', null, t('chg')), h('th', null, t('today')), h('th', null, ''),
        )),
        h('tbody', null, sorted.map(r => h('tr', { key: r.code, className: 'ft-row', onClick: () => onOpenDetail(r) },
          h('td', null, r.name, ' ', h('span', { className: 'ft-code' }, r.code)),
          h('td', null, money(r.price)),
          h('td', null, h(SignValue, { v: r.changeAmt, digits: 3 })),
          h('td', null, h(ChangeBadge, { v: r.changePct })),
          h('td', { onClick: e => e.stopPropagation() },
            holdingsCodes.includes(r.code)
              ? h('span', { className: 'ft-code' }, '✓')
              : h('button', { className: 'ft-act', onClick: () => onWatch(r) }, `＋ ${t('watch')}`),
          ),
        ))),
      );
    }

    function MarketTab({ t, market, idxQuotes, idxConfig, onSaveSelection, holdingsCodes, onWatch, onOpenDetail, refreshKey,
                         sub, setSub, subOrder, onOrderChange }) {
      const active = pick(sub, MARKET_SUBS, 'index');
      const order = withDefaults(subOrder, MARKET_SUBS);
      const choose = setSub || (() => {});
      return h(React.Fragment, null,
        h(SortableTabs, {
          t, className: 'ft-subtabs', items: order.map(k => ({ key: k, label: t(k === 'index' ? 'subIdx' : k === 'fund' ? 'subFund' : 'subEtf') })),
          active, onSelect: choose, onOrderChange,
        }),
        active === 'index' && h(IndexSub, { t, idxQuotes, idxConfig, onSaveSelection, holdingsCodes, onWatch, refreshKey }),
        active === 'fund' && h(FundSub, { t, holdingsCodes, onWatch, onOpenDetail, refreshKey, marketQuotes }),
        active === 'etf' && h(EtfSub, { t, etfs: market.etfs, holdingsCodes, onWatch, onOpenDetail, legacy: market.legacy }),
      );
    }

    function WatchTab({ t, idxQuotes, idxConfig, onSaveSelection, rows, editing, setEditing, onSaveEdit, onRemove, onOpenDetail, saving, form, setForm, marketQuotes,
                        sub, setSub, subOrder, onOrderChange }) {
      const selected = idxConfig.selected || [];
      const removeIdx = code => onSaveSelection(selected.filter(c => c !== code), () => {});
      const watchRows = rows.filter(r => r.hold.watch || (r.hold.watch == null && r.hold.shares == null && r.hold.cost == null))
        .sort((a, b) => (b.changePct ?? -Infinity) - (a.changePct ?? -Infinity));
      const active = pick(sub, WATCH_SUBS, 'index');
      const order = withDefaults(subOrder, WATCH_SUBS);
      const choose = setSub || (() => {});
      return h(React.Fragment, null,
        h(SortableTabs, {
          t, className: 'ft-subtabs',
          items: order.map(k => ({ key: k, label: k === 'index' ? `${t('indices')} (${selected.length})` : `${t('subFund')} (${watchRows.length})` })),
          active, onSelect: choose, onOrderChange,
        }),
        active === 'index' && h('div', { className: 'ft-section' },
          selected.length === 0
            ? h('div', { className: 'ft-empty' }, t('watchIdxEmpty'))
            : h('div', { className: 'ft-idx-grid' },
                selected.map(code => {
                  const q = idxQuotes[code];
                  const meta = (idxConfig.library || []).find(x => x.code === code);
                  return h('div', { className: 'ft-idx-cell', key: code },
                    h('div', { className: 'ft-idx-name', title: (meta && meta.name) || code }, (meta && meta.name) || code),
                    h('div', { className: 'ft-code' }, code),
                    h('div', { className: 'ft-idx-price' }, money(q ? q.price : null)),
                    h('div', { className: 'ft-idx-pct' }, h(ChangeBadge, { v: q ? q.changePct : null })),
                    h('button', {
                      className: 'ft-act', 'aria-label': `${t('remove')} ${(meta && meta.name) || code}`,
                      onClick: () => removeIdx(code),
                    }, `✕ ${t('remove')}`),
                  );
                }),
              ),
        ),
        active === 'fund' && h('div', { className: 'ft-section' },
          watchRows.length === 0
            ? h('div', { className: 'ft-empty' }, t('watchEmpty'))
            : h('table', { className: 'ft-table' },
                h('thead', null, h('tr', null,
                  h('th', null, t('panel')), h('th', null, t('sector')), h('th', null, t('nav')), h('th', null, t('yesterday')), h('th', null, ''),
                )),
                h('tbody', null, watchRows.map(r => editing === r.hold.code
                  ? h('tr', { key: r.hold.code }, h('td', { colSpan: 5 },
                      h('div', { className: 'ft-actions', style: { marginTop: 2 } },
                        h('span', { className: 'ft-code' }, r.hold.code),
                        h('input', { className: 'ft-input ft-input-sm', placeholder: t('shares'), inputMode: 'decimal', value: form.shares, onChange: e => setForm({ ...form, shares: e.target.value }) }),
                        h('input', { className: 'ft-input ft-input-sm', placeholder: t('cost'), inputMode: 'decimal', value: form.cost, onChange: e => setForm({ ...form, cost: e.target.value }) }),
                        h('input', { className: 'ft-input ft-input-sm', placeholder: t('amountShort'), inputMode: 'decimal', value: form.amount || '', onChange: e => setForm({ ...form, amount: e.target.value }) }),
                        h('button', { className: 'ft-btn', disabled: saving, onClick: () => onSaveEdit(r.hold.code) }, t('add')),
                        h('button', { className: 'ft-btn', onClick: () => setEditing(null) }, t('cancel')),
                      ),
                    ))
                  : h('tr', { key: r.hold.code, className: 'ft-row', onClick: () => onOpenDetail(r.hold) },
                      h('td', null,
                        (r.q && r.q.name) || r.hold.name || r.hold.code, ' ',
                        h('span', { className: 'ft-code' }, r.hold.code),
                        r.hold.shares != null && h('span', { className: 'ft-flag' }, t('tabHold')),
                      ),
                      h('td', null, h(SectorCell, { t, name: r.hold.name || r.hold.code, marketQuotes })),
                      h('td', null, money(r.nav)),
                      h('td', null, h(ChangeBadge, { v: (r.q && r.q.yesterdayPct != null) ? r.q.yesterdayPct : r.changePct })),
                      h('td', { onClick: e => e.stopPropagation() },
                        h('button', { className: 'ft-act', title: r.hold.shares != null ? t('edit') : t('toHold'), onClick: () => { setEditing(r.hold.code); setForm({ shares: r.hold.shares == null ? '' : String(r.hold.shares), cost: r.hold.cost == null ? '' : String(r.hold.cost), code: r.hold.code, amount: '' }); } }, '✎ ', r.hold.shares != null ? t('edit') : t('toHold')),
                        h('button', { className: 'ft-del', title: t('remove'), 'aria-label': `${t('remove')} ${r.hold.code}`, onClick: () => onRemove(r.hold.code) }, '✕'),
                      ),
                    ))),
              ),
        ),
      );
    }

    function MineTab({ t, rows, totals, loggedIn, editing, setEditing, onSaveEdit, onRemoveAsk, onAddWatch, onOpenDetail, sortBy, setSortBy, marketQuotes,
                       trade, setTrade, onTradeConfirm, onTradeAsk,
                       form, setForm, searchQ, setSearchQ, suggest, onSaveForm, saving,
                       importOpen, setImportOpen, importText, setImportText, onImport, msg, onRefresh, onGoWatch }) {
      const canWrite = loggedIn;
      const positions = rows.filter(r => r.hold.shares != null || r.hold.cost != null || r.pending != null);
      const watchedCount = rows.filter(r => r.hold.watch).length;
      const mask = v => (loggedIn ? v : '***');
      const [addOpen, setAddOpen] = useState(false);
      const [menuCode, setMenuCode] = useState(null);

      // Add / import / edit / trade panels are mutually exclusive; opening one closes the rest.
      const closeEditTrade = () => { setEditing(null); setTrade(null); };
      const openAdd = () => {
        closeEditTrade(); setImportOpen(false); setMenuCode(null); setAddOpen(true);
        setForm({ code: '', shares: '', cost: '', amount: '' }); setSearchQ('');
      };
      const closeAdd = () => { setAddOpen(false); setForm({ code: '', shares: '', cost: '', amount: '' }); setSearchQ(''); };
      const toggleImport = () => { closeEditTrade(); setAddOpen(false); setMenuCode(null); setImportOpen(o => !o); };
      const startEdit = r => {
        closeEditTrade(); setAddOpen(false); setImportOpen(false); setMenuCode(r.hold.code); setEditing(r.hold.code);
        setForm({
          shares: r.hold.shares == null ? '' : String(r.hold.shares),
          cost: r.hold.cost == null ? '' : String(r.hold.cost),
          code: r.hold.code,
          amount: '',
        });
      };
      const startTrade = (r, mode) => {
        setEditing(null); setAddOpen(false); setImportOpen(false); setMenuCode(r.hold.code); onTradeAsk(r.hold, mode);
      };
      // One card's actions open at a time; opening another closes edit/trade panels.
      const toggleMenu = code => {
        if (menuCode === code) {
          setMenuCode(null);
          if (editing === code) setEditing(null);
          if (trade && trade.code === code) setTrade(null);
        } else {
          setEditing(null);
          setTrade(null);
          setMenuCode(code);
        }
      };

      const msgNode = () => msg && h('div', {
        className: `ft-msg${msg.kind === 'err' ? ' ft-err' : ''}`,
        role: msg.kind === 'err' ? 'alert' : 'status', 'aria-live': 'polite',
      }, msg.text);

      const seg = (key, label) => h('button', {
        key, className: `ft-seg-btn${sortBy === key ? ' ft-seg-btn-on' : ''}`,
        'aria-pressed': sortBy === key, onClick: () => setSortBy(key),
      }, label);

      const metaCell = (label, value, color) => h('div', { className: 'ft-meta-cell' },
        h('span', { className: 'ft-meta-label' }, label),
        h('span', { className: 'ft-meta-value ft-num', style: color ? { color } : null }, value),
      );

      const amountPreview = r => {
        const amt = String(form.amount || '').trim();
        if (amt === '') return null;
        const n = Number(amt);
        if (!isFinite(n) || n <= 0) return t('amountRule');
        const nav = r.nav;
        return nav != null ? `${n.toLocaleString('zh-CN')} ÷ ${nav} ≈ ${(n / nav).toFixed(2)} ${t('sharesShort')}`
          : t('pendingHint');
      };

      const editPanel = r => h('div', { className: 'ft-form', onKeyDown: e => { if (e.key === 'Escape') setEditing(null); } },
        h('div', { className: 'ft-form-title' }, `${t('edit')} · ${(r.q && r.q.name) || r.hold.name || r.hold.code}`),
        h('div', { className: 'ft-actions', style: { marginTop: 0, alignItems: 'flex-end' } },
          h('div', { className: 'ft-field' },
            h('label', { className: 'ft-field-label', htmlFor: `ft-edit-shares-${r.hold.code}` }, t('sharesShort')),
            h('input', {
              id: `ft-edit-shares-${r.hold.code}`, className: 'ft-input ft-input-sm', inputMode: 'decimal', autoFocus: true,
              value: form.shares, onChange: e => setForm({ ...form, shares: e.target.value }),
              onKeyDown: e => { if (e.key === 'Enter') onSaveEdit(r.hold.code); },
            }),
          ),
          h('div', { className: 'ft-field' },
            h('label', { className: 'ft-field-label', htmlFor: `ft-edit-cost-${r.hold.code}` }, t('cost')),
            h('input', {
              id: `ft-edit-cost-${r.hold.code}`, className: 'ft-input ft-input-sm', inputMode: 'decimal',
              value: form.cost, onChange: e => setForm({ ...form, cost: e.target.value }),
              onKeyDown: e => { if (e.key === 'Enter') onSaveEdit(r.hold.code); },
            }),
          ),
          h('div', { className: 'ft-field' },
            h('label', { className: 'ft-field-label', htmlFor: `ft-edit-amount-${r.hold.code}` },
              `${t('amountShort')} `, h('span', { className: 'ft-field-hint' }, t('amountRule'))),
            h('input', {
              id: `ft-edit-amount-${r.hold.code}`, className: 'ft-input ft-input-sm', inputMode: 'decimal',
              value: form.amount || '', onChange: e => setForm({ ...form, amount: e.target.value }),
              onKeyDown: e => { if (e.key === 'Enter') onSaveEdit(r.hold.code); },
            }),
          ),
          h('button', { className: 'ft-btn', disabled: saving, onClick: () => onSaveEdit(r.hold.code), title: t('confirmEdit') }, t('add')),
          h('button', { className: 'ft-btn', onClick: () => setEditing(null) }, t('cancel')),
        ),
        amountPreview(r) && h('div', { className: 'ft-field-hint', style: { marginTop: 6 } }, amountPreview(r)),
      );

      const tradePanel = r => {
        const cur = r.hold.shares == null ? 0 : Number(r.hold.shares) || 0;
        const direct = String(form.shares == null ? '' : form.shares).trim();
        const amt = String(form.amount || '').trim();
        const fromAmount = amt !== '' && r.nav != null ? Number((Number(amt) / r.nav).toFixed(2)) : NaN;
        const qty = direct !== '' ? Number(direct) : fromAmount;
        const qtyOk = isFinite(qty) && qty > 0;
        const after = qtyOk ? Math.max(0, cur + (trade.mode === 'add' ? qty : -qty)) : null;
        return h('div', { className: 'ft-form', onKeyDown: e => { if (e.key === 'Escape') setTrade(null); } },
          h('div', { className: 'ft-form-title' },
            h('span', { style: { color: signColor(trade.mode === 'add' ? 1 : -1) } },
              trade.mode === 'add' ? `＋ ${t('addShare')}` : `－ ${t('reduceShare')}`),
            ` · ${(r.q && r.q.name) || r.hold.name || r.hold.code}`,
          ),
          h('div', { className: 'ft-code ft-num' }, t('currentShares')(cur)),
          h('div', { className: 'ft-actions', style: { marginTop: 6, alignItems: 'flex-end' } },
            h('div', { className: 'ft-field' },
              h('label', { className: 'ft-field-label', htmlFor: `ft-trade-qty-${r.hold.code}` }, t('tradeQtyHint')),
              h('input', {
                id: `ft-trade-qty-${r.hold.code}`, className: 'ft-input ft-input-sm', inputMode: 'decimal', autoFocus: true,
                value: form.shares, onChange: e => setForm({ ...form, shares: e.target.value }),
                onKeyDown: e => { if (e.key === 'Enter') onTradeConfirm(); },
              }),
            ),
            h('div', { className: 'ft-field' },
              h('label', { className: 'ft-field-label', htmlFor: `ft-trade-amount-${r.hold.code}` },
                trade.mode === 'add' ? `${t('addShare')}${t('amountShort')}` : `${t('reduceShare')}${t('amountShort')}`),
              h('input', {
                id: `ft-trade-amount-${r.hold.code}`, className: 'ft-input ft-input-sm', inputMode: 'decimal',
                value: form.amount || '', onChange: e => setForm({ ...form, amount: e.target.value }),
                onKeyDown: e => { if (e.key === 'Enter') onTradeConfirm(); },
              }),
            ),
            h('span', { className: 'ft-num', style: { color: 'var(--dsw-alias-label-secondary)' } },
              after != null ? t('afterTrade')(after) : ''),
            h('button', {
              className: `ft-btn${trade.mode === 'add' ? ' ft-btn-primary' : ''}`, disabled: saving, onClick: onTradeConfirm,
            }, trade.mode === 'add' ? t('confirmAdd') : t('confirmReduce')),
            h('button', { className: 'ft-btn', onClick: () => setTrade(null) }, t('cancel')),
          ),
        );
      };

      const actionBar = r => {
        const name = (r.q && r.q.name) || r.hold.name || r.hold.code;
        const inWatch = !!r.hold.watch;
        return h('div', { className: 'ft-card-actions', role: 'group', 'aria-label': `${t('actions')} ${name}` },
          h('button', { className: 'ft-act ft-act-buy', title: `${t('addShare')} ${name}`, 'aria-label': `${t('addShare')} ${name}`, onClick: () => startTrade(r, 'add') }, `＋ ${t('addShare')}`),
          h('button', { className: 'ft-act', title: `${t('reduceShare')} ${name}`, 'aria-label': `${t('reduceShare')} ${name}`, onClick: () => startTrade(r, 'reduce') }, `－ ${t('reduceShare')}`),
          h('button', { className: 'ft-act', title: `${t('edit')} ${name}`, 'aria-label': `${t('edit')} ${name}`, onClick: () => startEdit(r) }, t('edit')),
          h('button', {
            className: `ft-act ft-act-watch${inWatch ? ' ft-act-on' : ''}`,
            title: inWatch ? `${t('inWatch')} ${name}` : `${t('toWatch')} ${name}`,
            'aria-label': inWatch ? `${t('inWatch')} ${name}` : `${t('toWatch')} ${name}`,
            'aria-pressed': inWatch, disabled: inWatch || saving,
            onClick: () => onAddWatch(r.hold),
          }, inWatch ? `★ ${t('inWatch')}` : `☆ ${t('toWatch')}`),
          h('button', { className: 'ft-del', title: `${t('remove')} ${name}`, 'aria-label': `${t('remove')} ${name}`, onClick: () => onRemoveAsk(r.hold) }, `✕ ${t('remove')}`),
        );
      };

      const addPanel = () => h('div', { className: 'ft-form', onKeyDown: e => { if (e.key === 'Escape') closeAdd(); } },
        h('div', { className: 'ft-form-title' }, t('addFund')),
        h('div', { className: 'ft-field' },
          h('label', { className: 'ft-field-label', htmlFor: 'ft-add-search' }, t('addTitle')),
          h('div', { className: 'ft-suggest' },
            h('input', {
              id: 'ft-add-search', className: 'ft-input', style: { width: '100%' }, placeholder: t('addHint'),
              value: searchQ, onChange: e => setSearchQ(e.target.value),
            }),
            suggest.length > 0 && h('div', { className: 'ft-suggest-list' },
              suggest.map(s => h('button', {
                key: s.code, className: 'ft-suggest-item',
                onClick: () => { setForm(f => ({ ...f, code: s.code })); setSearchQ(s.code); },
              },
                h('span', { className: 'ft-code' }, s.code),
                h('span', null, s.name),
                h('span', { className: 'ft-suggest-type' }, s.type),
              )),
            ),
          ),
        ),
        /^\d{6}$/.test(form.code) && h('div', { className: 'ft-msg', style: { marginTop: 6 } },
          h('span', { className: 'ft-chip-code' }, `${t('selectedFund')} ${form.code}`)),
        h('div', { className: 'ft-actions', style: { marginTop: 8, alignItems: 'flex-end' } },
          h('div', { className: 'ft-field' },
            h('label', { className: 'ft-field-label', htmlFor: 'ft-add-shares' },
              `${t('sharesShort')} `, h('span', { className: 'ft-field-hint' }, t('optionalWatch'))),
            h('input', {
              id: 'ft-add-shares', className: 'ft-input ft-input-sm', inputMode: 'decimal',
              value: form.shares, onChange: e => setForm({ ...form, shares: e.target.value }),
            }),
          ),
          h('div', { className: 'ft-field' },
            h('label', { className: 'ft-field-label', htmlFor: 'ft-add-cost' }, t('cost')),
            h('input', {
              id: 'ft-add-cost', className: 'ft-input ft-input-sm', inputMode: 'decimal',
              value: form.cost, onChange: e => setForm({ ...form, cost: e.target.value }),
            }),
          ),
          h('div', { className: 'ft-field' },
            h('label', { className: 'ft-field-label', htmlFor: 'ft-add-amount' },
              `${t('amountShort')} `, h('span', { className: 'ft-field-hint' }, t('amountRule'))),
            h('input', {
              id: 'ft-add-amount', className: 'ft-input ft-input-sm', inputMode: 'decimal',
              value: form.amount || '', onChange: e => setForm({ ...form, amount: e.target.value }),
            }),
          ),
          h('button', { className: 'ft-btn ft-btn-primary', disabled: saving, onClick: onSaveForm }, t('add')),
          h('button', { className: 'ft-btn', onClick: closeAdd }, t('cancel')),
        ),
        h('div', { className: 'ft-field-hint', style: { marginTop: 6 } }, t('amountHint')),
        msgNode(),
      );

      const importPanel = () => h('div', { className: 'ft-form', onKeyDown: e => { if (e.key === 'Escape') setImportOpen(false); } },
        h('div', { className: 'ft-form-title' }, t('importTitle')),
        h('textarea', {
          className: 'ft-textarea', value: importText,
          'aria-label': t('importTitle'),
          onChange: e => setImportText(e.target.value),
          placeholder: '华夏成长混合 000021\n持有金额 1,234.56\n…',
        }),
        h('div', { className: 'ft-actions', style: { marginTop: 6 } },
          h('button', { className: 'ft-btn', disabled: saving, onClick: onImport }, t('import')),
          h('button', { className: 'ft-btn', onClick: () => setImportOpen(false) }, t('cancel')),
        ),
        msgNode(),
      );

      const card = r => {
        const code = r.hold.code;
        const name = (r.q && r.q.name) || r.hold.name || code;
        const expanded = canWrite && (menuCode === code || editing === code || (trade && trade.code === code));
        return h('li', { key: code, className: `ft-card${expanded ? ' ft-card-open' : ''}` },
          h('div', { className: 'ft-card-main' },
            h('div', { className: 'ft-card-id' },
              h('button', { className: 'ft-name', title: t('detail'), onClick: () => onOpenDetail(r.hold) }, name),
              h('span', { className: 'ft-sub' },
                h('span', { className: 'ft-code ft-num' }, code),
                ' ',
                h(SectorCell, { t, name: r.hold.name || code, marketQuotes }),
                r.pending != null && h('span', { className: 'ft-flag ft-flag-pending' }, t('pendingCalc')),
                r.hold.watch && h('span', { className: 'ft-flag' }, t('tabWatch')),
              ),
            ),
            h('div', { className: 'ft-card-fig' },
              h('span', { className: 'ft-amount ft-num' }, r.pending != null ? t('pendingCalc') : mask(money(r.amount))),
              h('span', { className: 'ft-today ft-num', style: { color: loggedIn ? signColor(r.todayProfit) : null } },
                r.pending != null ? '—' : `${mask(signedMoney(r.todayProfit))} (${pct(r.changePct)})`),
            ),
            canWrite && h('button', {
              className: `ft-more${expanded ? ' ft-more-on' : ''}`, 'aria-expanded': expanded,
              'aria-label': t('actions'), title: t('actions'),
              onClick: () => toggleMenu(code),
            }, t('actions'), ' ', expanded ? '▴' : '▾'),
          ),
          h('div', { className: 'ft-card-meta' },
            metaCell(t('nav'), money(r.nav)),
            metaCell(t('costShort'), mask(money(r.hold.cost))),
            metaCell(t('sharesShort'), r.pending != null ? t('pendingCalc') : mask(money(r.hold.shares))),
            metaCell(t('totalPct'), r.pending != null ? '—' : loggedIn ? pct(r.totalPct) : '***', loggedIn ? signColor(r.totalProfit) : null),
            h('button', { className: 'ft-link', onClick: () => onOpenDetail(r.hold) }, `${t('detail')} ›`),
          ),
          expanded && (trade && trade.code === code ? tradePanel(r) : editing === code ? editPanel(r) : actionBar(r)),
        );
      };

      return h(React.Fragment, null,
        !loggedIn && h('div', { className: 'ft-lock' },
          h('div', { className: 'ft-lock-title' }, '🔒 ', t('loginMaskTitle')),
          h('div', null, t('loginMaskHint')),
        ),
        positions.length > 0 && h('div', { className: 'ft-overview' },
          h('div', { className: 'ft-ov-cell' },
            h('div', { className: 'ft-ov-label' }, t('totalAsset')),
            h('div', { className: 'ft-ov-value ft-ov-value-lg ft-num' }, mask(money(totals.amount))),
          ),
          h('div', { className: 'ft-ov-cell' },
            h('div', { className: 'ft-ov-label' }, t('todayProfit')),
            h('div', { className: 'ft-ov-value ft-num', style: { color: loggedIn ? signColor(totals.today) : null } }, mask(signedMoney(totals.today))),
          ),
          h('div', { className: 'ft-ov-cell' },
            h('div', { className: 'ft-ov-label' }, t('totalProfit')),
            h('div', { className: 'ft-ov-value ft-num', style: { color: loggedIn ? signColor(totals.profit) : null } }, mask(signedMoney(totals.profit))),
          ),
          h('div', { className: 'ft-ov-cell' },
            h('div', { className: 'ft-ov-label' }, t('totalPct')),
            h('div', { className: 'ft-ov-value ft-num', style: { color: loggedIn ? signColor(totals.profit) : null } }, loggedIn ? pct(totals.pct) : '***'),
          ),
        ),
        canWrite && positions.length > 0 && h('div', { className: 'ft-toolbar' },
          h('span', { className: 'ft-code' }, t('holdCount')(positions.length)),
          h('div', { className: 'ft-seg', role: 'group', 'aria-label': t('sortBy') },
            seg('today', t('sortToday')), seg('profit', t('sortProfit')), seg('amount', t('sortAmount'))),
          h('span', { style: { marginLeft: 'auto', display: 'flex', gap: 6 } },
            h('button', { className: 'ft-btn ft-btn-primary', onClick: openAdd, 'aria-expanded': addOpen }, `＋ ${t('addFund')}`),
            h('button', { className: 'ft-btn', onClick: toggleImport, 'aria-expanded': importOpen }, t('importShort')),
            h('button', { className: 'ft-btn', onClick: onRefresh, 'aria-label': t('refresh'), title: t('refresh') }, '⟳'),
          ),
        ),
        canWrite && addOpen && addPanel(),
        canWrite && importOpen && importPanel(),
        positions.length === 0
          ? h('div', { className: 'ft-empty-card' },
              h('div', { style: { marginBottom: 8 } }, t('empty')),
              canWrite && h('div', { className: 'ft-actions', style: { marginTop: 0, justifyContent: 'center' } },
                h('button', { className: 'ft-btn ft-btn-primary', onClick: openAdd }, `＋ ${t('addFirst')}`),
                h('button', { className: 'ft-btn', onClick: toggleImport, 'aria-expanded': importOpen }, t('importShort'))),
              watchedCount > 0 && h('div', { style: { marginTop: 8 } },
                t('watchRemain')(watchedCount), ' ',
                h('button', { className: 'ft-link', onClick: onGoWatch }, t('tabWatchPage'))),
            )
          : h('ul', { className: 'ft-list' }, positions.map(card)),
        !addOpen && !importOpen && msgNode(),
      );
    }

    function FundOverlay() {
      const t = makeT();
      const [open, setOpen] = useState(false);
      const [tabState, setTabState] = useState(loadTabState);
      const updateTabState = patch => setTabState(prev => {
        const next = { ...prev, ...patch };
        saveTabState(next);
        return next;
      });
      const tab = pick(tabState.activeMain, MAIN_TABS, 'market');
      const mainOrder = withDefaults(tabState.main, MAIN_TABS);
      const marketOrder = withDefaults(tabState.market, MARKET_SUBS);
      const watchOrder = withDefaults(tabState.watch, WATCH_SUBS);
      const marketSub = pick(tabState.marketActive, MARKET_SUBS, 'index');
      const watchSub = pick(tabState.watchActive, WATCH_SUBS, 'index');
      const [loggedIn, setLoggedIn] = useState(false);
      const [holdings, setHoldings] = useState(loadCache);
      const [refreshKey, setRefreshKey] = useState(0);
      const [intervalSec, setIntervalSecState] = useState(loadInterval);
      const [form, setForm] = useState({ code: '', shares: '', cost: '', amount: '' });
      const [editing, setEditing] = useState(null);
      const [sortBy, setSortBy] = useState('today');
      const [searchQ, setSearchQ] = useState('');
      const [suggest, setSuggest] = useState([]);
      const [importOpen, setImportOpen] = useState(false);
      const [importText, setImportText] = useState('');
      const [msg, setMsg] = useState(null);
      const [saving, setSaving] = useState(false);
      const [detailInfo, setDetailInfo] = useState(null);
      const [confirmDel, setConfirmDel] = useState(null);
      const [trade, setTrade] = useState(null);

      const setIntervalSec = v => {
        setIntervalSecState(v);
        try { localStorage.setItem(INTERVAL_KEY, String(v)); } catch {}
      };

      // Settings page may change the refresh interval; follow it live.
      useEffect(() => {
        const handler = e => { if (INTERVAL_OPTIONS.includes(e.detail)) setIntervalSecState(e.detail); };
        window.addEventListener('ft-interval-changed', handler);
        return () => window.removeEventListener('ft-interval-changed', handler);
      }, []);

      const codes = useMemo(() => {
        const set = new Set(holdings.map(x => x.code));
        return [...set];
      }, [holdings]);
      const quotes = useQuotes(codes, refreshKey);
      const market = useMarket(open ? refreshKey : 0);
      const idxQuotes = useMemo(() => {
        const map = {};
        for (const q of market.indices) map[q.code] = q;
        return map;
      }, [market.indices]);
      const marketQuotes = useMemo(() => {
        const map = {};
        for (const q of [...market.indices, ...market.etfs]) map[q.code] = q;
        return map;
      }, [market.indices, market.etfs]);
      // ETFs are quoted through the market feed, not the fundgz estimate feed.
      const etfMap = useMemo(() => {
        const map = {};
        for (const q of market.etfs) map[q.code] = q;
        return map;
      }, [market.etfs]);
      const allQuotes = useMemo(() => ({ ...quotes, ...etfMap }), [quotes, etfMap]);
      const idxConfig = useIndexConfig(open ? refreshKey : 0);

      const saveIndexSelection = useCallback(async (codes, done) => {
        try {
          const response = await fetch('/fund-tracker/api?action=savesettings', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ key: 'indices', value: codes }),
          });
          if (response.ok) {
            setMsg({ kind: 'ok', text: t('idxSaved') });
            done();
            setRefreshKey(k => k + 1);
          } else {
            setMsg({ kind: 'err', text: t('lockHint') });
          }
        } catch {}
      }, [t]);

      // Session + holdings come from the Host (SQLite, per DSH account).
      useEffect(() => {
        let alive = true;
        fetch('/fund-tracker/api?action=session')
          .then(r => r.json())
          .then(state => {
            if (!alive) return;
            setLoggedIn(!!(state && state.loggedIn));
            if (state && state.loggedIn) {
              return fetch('/fund-tracker/api?action=list').then(r => r.json()).then(data => {
                if (!alive) return;
                if (data && Array.isArray(data.items)) {
                  setHoldings(data.items);
                  saveCache(data.items);
                }
              });
            }
            return null;
          })
          .catch(() => {});
        return () => { alive = false; };
      }, [refreshKey]);

      useEffect(() => {
        const id = setInterval(() => setRefreshKey(k => k + 1), intervalSec * 1000);
        return () => clearInterval(id);
      }, [intervalSec]);

      const loadLibInfo = useCallback(() => {
        fetch('/fund-tracker/api?action=libinfo')
          .then(r => r.json())
          .then(info => { if (info && info.count != null) setLibInfo(info); })
          .catch(() => {});
      }, []);
      useEffect(loadLibInfo, [loadLibInfo, refreshKey]);

      const refreshLib = useCallback(async () => {
        setLibUpdating(true);
        try {
          const response = await fetch('/fund-tracker/api?action=refreshlib', { method: 'POST' });
          const info = await response.json();
          if (info && info.count != null) {
            setLibInfo(info);
            setMsg({ kind: 'ok', text: t('libUpdateDone') });
          }
        } catch {} finally { setLibUpdating(false); }
      }, [t]);

      useEffect(() => {
        const q = searchQ.trim();
        if (!q) { setSuggest([]); return; }
        const code = (/^\d{6}$/.exec(q) || [])[0];
        if (code) { setSuggest([]); setForm(f => ({ ...f, code })); return; }
        const timer = setTimeout(() => {
          fetch(`/fund-tracker/api?action=search&query=${encodeURIComponent(q)}`)
            .then(r => r.json())
            .then(data => setSuggest((data && data.items) || []))
            .catch(() => setSuggest([]));
        }, 250);
        return () => clearTimeout(timer);
      }, [searchQ]);

      const rows = useMemo(() => holdings.map(hold => {
        const q = allQuotes[hold.code];
        // Fundgz quotes carry `nav`; ETF quotes only carry `price`.
        const nav = q ? (q.nav != null ? q.nav : (q.price != null ? q.price : null)) : null;
        const changePct = q && q.changePct != null ? q.changePct : null;
        const amount = nav != null && hold.shares != null ? hold.shares * nav : null;
        const todayProfit = amount != null && changePct != null ? amount * changePct / (100 + changePct) : null;
        const totalProfit = nav != null && hold.cost != null && hold.shares != null ? (nav - hold.cost) * hold.shares : null;
        const totalPct = nav != null && hold.cost ? (nav / hold.cost - 1) * 100 : null;
        // Amount entered before any NAV was known: shares are filled in later.
        const pending = hold.pendingAmount != null && hold.pendingAmount > 0 ? hold.pendingAmount : null;
        return { hold, q, nav, changePct, amount, todayProfit, totalProfit, totalPct, pending };
      }), [holdings, allQuotes]);

      const totals = useMemo(() => {
        const amount = rows.reduce((s, r) => s + (r.amount || 0), 0);
        const today = rows.reduce((s, r) => s + (r.todayProfit || 0), 0);
        const profit = rows.reduce((s, r) => s + (r.totalProfit || 0), 0);
        const base = rows.reduce((s, r) => s + (r.hold.cost > 0 && r.hold.shares != null ? r.hold.cost * r.hold.shares : 0), 0);
        return { amount, today, profit, pct: base ? (profit / base) * 100 : null };
      }, [rows]);

      const sortedRows = useMemo(() => {
        const key = sortBy === 'today' ? 'changePct' : sortBy === 'profit' ? 'totalProfit' : 'amount';
        return [...rows].sort((a, b) => (b[key] ?? -Infinity) - (a[key] ?? -Infinity));
      }, [rows, sortBy]);

      const apiSave = async body => {
        const response = await fetch('/fund-tracker/api?action=save', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(body),
        });
        const data = await response.json();
        if (data && Array.isArray(data.items)) {
          setHoldings(data.items);
          saveCache(data.items);
        }
        return data;
      };
      const apiDelete = async code => {
        const response = await fetch('/fund-tracker/api?action=delete', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ code }),
        });
        const data = await response.json();
        if (data && Array.isArray(data.items)) {
          setHoldings(data.items);
          saveCache(data.items);
        }
      };
      // Adds to / removes from the watchlist only; shares and cost stay untouched.
      const apiWatch = async (code, on) => {
        const response = await fetch('/fund-tracker/api?action=watch', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ code, watch: on }),
        });
        const data = await response.json();
        if (data && Array.isArray(data.items)) {
          setHoldings(data.items);
          saveCache(data.items);
        }
        return data;
      };

      // Latest NAV for a code, from fundgz (`nav`) or the ETF feed (`price`).
      const navOf = code => {
        const q = allQuotes[code];
        const nav = q ? (q.nav != null ? q.nav : (q.price != null ? q.price : null)) : null;
        return nav != null && nav > 0 ? nav : null;
      };

      const saveForm = async () => {
        const code = form.code.trim();
        if (!/^\d{6}$/.test(code)) { setMsg({ kind: 'err', text: t('invalidCode') }); return; }
        setSaving(true);
        try {
          let shares = form.shares.trim();
          let cost = form.cost.trim();
          const amount = String(form.amount || '').trim();
          let pendingAmount;
          // Amount-only entry: convert with the latest NAV, otherwise remember the
          // amount and settle it once a quote is available (usually the next day).
          if (shares === '' && amount !== '') {
            const nav = navOf(code);
            const n = Number(amount);
            if (!isFinite(n) || n <= 0) { setMsg({ kind: 'err', text: t('invalidCode') }); return; }
            if (nav) {
              shares = String(Number((n / nav).toFixed(2)));
              if (cost === '') cost = String(nav);
            } else {
              pendingAmount = n;
            }
          }
          await apiSave({
            code,
            name: (quotes[code] && quotes[code].name) || holdings.find(x => x.code === code)?.name || '',
            shares, cost,
            pendingAmount,
            // No shares/cost means "watch only", so it lands in 我的自选.
            watch: shares === '' && cost === '' && pendingAmount == null ? true : undefined,
          });
          setForm({ code: '', shares: '', cost: '', amount: '' });
          setSearchQ('');
          setSuggest([]);
          setEditing(null);
          setMsg(pendingAmount != null ? { kind: 'ok', text: t('pendingHint') } : null);
          setRefreshKey(k => k + 1);
        } finally { setSaving(false); }
      };
      const saveEdit = async code => {
        setSaving(true);
        try {
          let shares = form.shares.trim();
          let cost = form.cost.trim();
          const amount = String(form.amount || '').trim();
          // Editing by amount rewrites the total position; it needs a NAV, otherwise
          // the shares the user typed are kept as-is.
          if (shares === '' && amount !== '') {
            const nav = navOf(code);
            const n = Number(amount);
            if (nav && isFinite(n) && n > 0) {
              shares = String(Number((n / nav).toFixed(2)));
              if (cost === '') cost = String(nav);
            } else {
              setMsg({ kind: 'err', text: t('pendingHint') });
              return;
            }
          }
          await apiSave({ code, shares, cost });
        } finally { setSaving(false); }
        setEditing(null);
        setRefreshKey(k => k + 1);
      };
      const removeFund = async code => {
        if (editing === code) setEditing(null);
        try { await apiDelete(code); } catch {}
      };

      // 待计算：录入金额时还取不到净值。之后任意一次刷新拿到净值就折算份额并落库，
      // 因此它最多停留到下一次行情可取时（通常第二天）。
      useEffect(() => {
        if (!loggedIn) return;
        const ready = holdings
          .filter(h => h.pendingAmount != null && h.pendingAmount > 0 && !settleLocks.has(h.code))
          .map(h => ({ h, nav: navOf(h.code) }))
          .filter(x => x.nav != null);
        if (ready.length === 0) return;
        let alive = true;
        (async () => {
          for (const { h, nav } of ready) {
            settleLocks.add(h.code);
            try {
              await apiSave({
                code: h.code,
                name: h.name || '',
                shares: String(Number((h.pendingAmount / nav).toFixed(2))),
                cost: h.cost != null ? String(h.cost) : String(nav),
                pendingAmount: '',
              });
            } catch {
              // leave it pending; the next refresh retries
            } finally {
              settleLocks.delete(h.code);
            }
          }
          if (alive) setRefreshKey(k => k + 1);
        })();
        return () => { alive = false; };
        // eslint-disable-next-line react-hooks/exhaustive-deps
      }, [holdings, allQuotes, loggedIn]);
      // Removing from 我的自选 must not delete a real position: watch-only rows are
      // deleted, positions just lose the watch flag.
      const removeFromWatch = async hold => {
        if (editing === hold.code) setEditing(null);
        try {
          if (hold.shares == null && hold.cost == null && hold.pendingAmount == null) await apiDelete(hold.code);
          else await apiWatch(hold.code, false);
        } catch {}
      };
      const addToWatch = async hold => {
        await addWatch({ code: hold.code, name: hold.name || '' });
      };
      const apiTrade = async (code, delta) => {
        const response = await fetch('/fund-tracker/api?action=trade', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ code, delta }),
        });
        const data = await response.json();
        if (data && Array.isArray(data.items)) {
          setHoldings(data.items);
          saveCache(data.items);
        }
        return data;
      };
      const onTradeConfirm = async () => {
        if (!trade) return;
        let qty = Number(form.shares);
        if (String(form.shares == null ? '' : form.shares).trim() === '') {
          const amount = String(form.amount || '').trim();
          const nav = navOf(trade.code);
          qty = amount !== '' && nav != null ? Number((Number(amount) / nav).toFixed(2)) : NaN;
          if (!isFinite(qty)) { setMsg({ kind: 'err', text: t('pendingHint') }); return; }
        }
        if (!isFinite(qty) || qty <= 0) { setMsg({ kind: 'err', text: t('tradeQtyHint') }); return; }
        setSaving(true);
        try {
          const delta = qty * (trade.mode === 'add' ? 1 : -1);
          const data = await apiTrade(trade.code, delta);
          if (data && data.error) setMsg({ kind: 'err', text: data.error });
          else { setMsg(null); setTrade(null); setForm({ shares: '', cost: '', code: '', amount: '' }); setRefreshKey(k => k + 1); }
        } finally { setSaving(false); }
      };
      const onTradeAsk = (hold, mode) => { setEditing(null); setTrade({ code: hold.code, mode }); setForm({ shares: '', cost: '', code: hold.code, amount: '' }); };
      const onRemoveAsk = hold => setConfirmDel({ code: hold.code, name: hold.name || hold.code });
      const addWatch = async r => {
        setSaving(true);
        try {
          if (holdings.some(x => x.code === r.code)) {
            await apiWatch(r.code, true);
          } else {
            await apiSave({ code: r.code, name: r.name, shares: '', cost: '', watch: true });
          }
          setMsg({ kind: 'ok', text: `${t('watch')}: ${r.name || r.code}` });
          setRefreshKey(k => k + 1);
        } finally { setSaving(false); }
      };
      const doImport = async () => {
        const parsed = parsePasted(importText);
        if (parsed.length === 0) { setMsg({ kind: 'err', text: t('importFailed') }); return; }
        setSaving(true);
        let fresh = 0;
        try {
          for (const p of parsed) {
            if (!holdings.some(x => x.code === p.code)) fresh += 1;
            const watchOnly = p.shares == null && p.cost == null;
            await apiSave(watchOnly ? { ...p, watch: true } : p);
          }
          setMsg({ kind: 'ok', text: t('imported')(parsed.length, fresh) });
          setImportText('');
          setRefreshKey(k => k + 1);
        } finally { setSaving(false); }
      };

      const openDetail = item => setDetailInfo({ code: item.code, name: item.name || '' });

      return h('div', { className: 'ft-root' },
        h('style', null, css),
        !open && h('button', {
          className: 'ft-chip',
          onClick: () => { setOpen(true); setRefreshKey(k => k + 1); },
          'aria-label': t('panel'), title: t('panel'),
        }, t('open')),
        open && h('div', { className: 'ft-panel' },
          h('div', { className: 'ft-bar' },
            h('span', { className: 'ft-bar-title' }, '📈 ', t('panel')),
            h('span', { className: 'ft-bar-sum' },
              holdings.length > 0 && h(React.Fragment, null,
                h('span', null, t('totalAsset'), ' ', money(totals.amount)),
                h('span', { style: { color: signColor(totals.today) } }, money(totals.today)),
                h('span', { style: { color: signColor(totals.profit) } }, pct(totals.pct)),
              ),
              h('button', {
                className: 'ft-close', 'aria-label': t('close'), title: t('close'),
                onClick: () => setOpen(false),
              }, '✕'),
            ),
          ),
          h(SortableTabs, {
            t, className: 'ft-tabs',
            items: mainOrder.map(k => ({
              key: k,
              label: k === 'market' ? t('tabMarket')
                : k === 'watch' ? `${t('tabWatchPage')} (${(idxConfig.selected || []).length + holdings.filter(x => x.watch).length})`
                  : k === 'mine' ? `${t('tabMine')} (${holdings.length})` : t('tabSettings'),
            })),
            active: tab,
            onSelect: k => updateTabState({ activeMain: k }),
            onOrderChange: main => updateTabState({ main }),
          }),
          tab === 'market'
            ? h(PanelBoundary, null, h(MarketTab, {
                t, market, idxQuotes, idxConfig,
                onSaveSelection: saveIndexSelection,
                holdingsCodes: holdings.filter(x => x.watch).map(x => x.code),
                onWatch: addWatch, onOpenDetail: openDetail, refreshKey,
                sub: marketSub, setSub: k => updateTabState({ marketActive: k }),
                subOrder: marketOrder, onOrderChange: market => updateTabState({ market }),
              }))
            : tab === 'watch'
              ? h(PanelBoundary, null, h(WatchTab, {
                  t, idxQuotes, idxConfig,
                  onSaveSelection: saveIndexSelection,
                  rows: sortedRows, editing, setEditing,
                  onSaveEdit: saveEdit, onRemove: removeFromWatch,
                  onOpenDetail: openDetail, saving, form, setForm, marketQuotes,
                  sub: watchSub, setSub: k => updateTabState({ watchActive: k }),
                  subOrder: watchOrder, onOrderChange: watch => updateTabState({ watch }),
                }))
              : tab === 'mine'
                ? h(PanelBoundary, null, h(MineTab, {
                    t, rows: sortedRows, totals, loggedIn, editing, setEditing,
                    onSaveEdit: saveEdit, onRemoveAsk, onAddWatch: addToWatch,
                    onOpenDetail: openDetail, marketQuotes,
                    onTradeAsk, trade, setTrade, onTradeConfirm,
                    sortBy, setSortBy,
                    form, setForm, searchQ, setSearchQ, suggest, onSaveForm: saveForm, saving,
                    importOpen, setImportOpen, importText, setImportText, onImport: doImport, msg,
                    onRefresh: () => setRefreshKey(k => k + 1), onGoWatch: () => updateTabState({ activeMain: 'watch' }),
                  }))
                : h(PanelBoundary, null, h(FundSettings, null)),
        ),
        detailInfo && h(FundDetail, {
          code: detailInfo.code, name: detailInfo.name || detailInfo.code, t,
          onClose: () => setDetailInfo(null),
        }),
        confirmDel && h(React.Fragment, null,
          h('div', { className: 'ft-modal-backdrop', onClick: () => setConfirmDel(null) }),
          h('div', { className: 'ft-modal', role: 'alertdialog', 'aria-label': t('confirmDeleteTitle') },
            h('h3', null, t('confirmDeleteTitle')),
            h('div', { className: 'ft-msg' }, t('confirmDeleteBody')(confirmDel.name, confirmDel.code)),
            h('div', { className: 'ft-actions', style: { marginTop: 12 } },
              h('button', { className: 'ft-btn', onClick: () => setConfirmDel(null) }, t('cancel')),
              h('button', {
                className: 'ft-btn ft-btn-danger',
                onClick: async () => { await removeFund(confirmDel.code); setConfirmDel(null); },
              }, t('confirmDelete')),
            ),
          ),
        ),
      );
    }

    return {
      inject: ['slots'],
      apply(ctx) {
        const showFatal = message => {
          try {
            const bar = document.createElement('div');
            bar.style.cssText = 'position:fixed;left:0;top:0;z-index:99999;background:#b00020;color:#fff;font:12px/1.5 monospace;padding:8px 12px;max-width:60vw;max-height:40vh;overflow:auto;white-space:pre-wrap;border-radius:0 0 8px 0;';
            bar.textContent = `[fund-tracker] ${message}`;
            document.body.appendChild(bar);
          } catch {}
        };
        window.addEventListener('error', e => {
          if (e && e.filename && /fund-tracker/.test(e.filename)) showFatal(e.message);
        });
        try {
          try {
            const snap = ctx.locale && ctx.locale.getLocale && ctx.locale.getLocale();
            const id = snap && (snap.locale || snap.id || snap.localeId);
            if (typeof id === 'string' && DICTS[id]) currentLocaleRef.id = id;
            else if (typeof id === 'string' && id && id.startsWith('en')) currentLocaleRef.id = 'en-US';
          } catch {}
          const disposeOverlay = ctx.slots.inject('shell.overlay', () =>
            ctx.slots.register({
              name: 'shell.overlay',
              id: 'fund-tracker',
              order: 90,
              label: 'Fund tracker',
            }, FundOverlay));
          // Settings live in the panel's own 设置 tab; no global settings page.
          return () => {
            if (typeof disposeOverlay === 'function') disposeOverlay();
          };
        } catch (error) {
          console.error('[fund-tracker] client activation failed', error);
          showFatal(`activation failed: ${error && (error.stack || error.message)}`);
          return () => {};
        }
      },
    };
  },
});