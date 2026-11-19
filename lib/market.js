/** Remote market data adapters: fundgz estimates, push2 indices, search, detail. */

import { FUNDGZ, INDEX_URL, SEARCH_URL, PINGZHONG, SPANS, INDEX_LIBRARY } from './constants.js';

function parseFundgz(text) {
  const m = /jsonpgz\((.*)\)\s*;?\s*$/.exec(text.trim());
  if (!m) return null;
  try {
    return JSON.parse(m[1]) || null;
  } catch {
    return null;
  }
}

function quoteOf(raw) {
  if (!raw || !raw.fundcode) return null;
  return {
    code: raw.fundcode,
    name: raw.name || '',
    nav: Number(raw.gsz || raw.dwjz) || null,
    prevNav: Number(raw.dwjz) || null,
    changePct: raw.gszzl != null ? Number(raw.gszzl) : null,
    navDate: raw.jzrq || '',
    estimateTime: raw.gztime || '',
  };
}

const HIS_URL = 'https://fundmobapi.eastmoney.com/FundMNewApi/FundMNHisNetList';

/**
 * Daily NAV history for one fund: [{date, nav, pct}], newest first.
 * This is the source persisted into the local `fund_nav` table.
 */
export async function fetchNavHistory(code, pageSize = 15) {
  try {
    const url = `${HIS_URL}?FCODE=${code}&pageIndex=1&pageSize=${pageSize}&deviceid=Wap&plat=Wap&product=EFund&version=6.2.5`;
    const response = await fetch(url, { headers: { referer: 'https://fund.eastmoney.com/' } });
    if (!response.ok) return [];
    const body = await response.json();
    const datas = body && Array.isArray(body.Datas) ? body.Datas : [];
    const rows = [];
    for (const d of datas) {
      if (!d || !d.FSRQ || !(Number(d.DWJZ) > 0)) continue;
      rows.push({ date: String(d.FSRQ).slice(0, 10), nav: Number(d.DWJZ), pct: d.JZZZL != null && isFinite(Number(d.JZZZL)) ? Number(d.JZZZL) : null });
    }
    return rows;
  } catch {
    return [];
  }
}

async function fetchYesterdayPct(code) {
  const rows = await fetchNavHistory(code, 2);
  return rows.length > 0 ? rows[0].pct : null;
}

// --- jdzf (daily NAV growth) page data ------------------------------------
// Fund_JJJZ_Data.aspx serves the whole fund universe paged, WITH an on-sale
// filter, the NAV date (showday) and purchase/redemption status. It is the
// bulk source for the on_sale flag and the all-fund NAV store.
const JDZF_URL = 'https://fund.eastmoney.com/Data/Fund_JJJZ_Data.aspx';

/**
 * One page of the jdzf list.
 * Returns { date, total, pages, rows: [{code,name,pinyin,nav,prevNav,pct,sg,sh}] }.
 */
export async function fetchJdzPage(page = 1, size = 200, onlySale = 1) {
  try {
    const url = `${JDZF_URL}?t=1&lx=1&letter=&gsid=&text=&sort=zdf,desc&page=${page},${size}&dt=${Date.now()}&atfc=&onlySale=${onlySale}`;
    const response = await fetch(url, {
      headers: { referer: 'https://fund.eastmoney.com/data/jdzf.html', 'user-agent': 'Mozilla/5.0' },
    });
    if (!response.ok) return null;
    const text = await response.text();
    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');
    if (start < 0 || end < 0) return null;
    // Unquoted keys + trailing commas: JS object literal, not JSON.
    const db = new Function(`return ${text.slice(start, end + 1)}`)();
    const rows = [];
    for (const r of db.datas || []) {
      if (!r || !/^\d{6}$/.test(String(r[0] || ''))) continue;
      const nav = Number(r[3]);
      rows.push({
        code: String(r[0]),
        name: String(r[1] || ''),
        pinyin: String(r[2] || '').toUpperCase(),
        nav: nav > 0 ? nav : null,
        prevNav: Number(r[5]) > 0 ? Number(r[5]) : null,
        pct: r[8] != null && isFinite(Number(r[8])) ? Number(r[8]) : null,
        sg: String(r[9] || ''),  // 申购状态: 开放申购 / 限大额 / 暂停申购 ...
        sh: String(r[10] || ''), // 赎回状态
      });
    }
    return {
      date: Array.isArray(db.showday) && db.showday[0] ? String(db.showday[0]) : null,
      total: Number(db.record) || 0,
      pages: Number(db.pages) || 0,
      rows,
    };
  } catch {
    return null;
  }
}

/**
 * Batch quote lookup by exact fund codes via jdzf `text=` search.
 * `fundgz.1234567.com.cn` went dead (returns a 404 HTML page); the jdzf
 * list endpoint accepts a code substring and returns the same-day NAV,
 * previous NAV and day change in one small response, so a single request
 * can cover up to ~10 codes by trying each individually in parallel.
 */
async function fetchJdzQuote(code) {
  try {
    const url = `${JDZF_URL}?t=1&lx=1&letter=&gsid=&text=${code}&sort=zdf,desc&page=1,5&dt=${Date.now()}&atfc=&onlySale=0`;
    const response = await fetch(url, {
      headers: { referer: 'https://fund.eastmoney.com/data/jdzf.html', 'user-agent': 'Mozilla/5.0' },
    });
    if (!response.ok) return null;
    const text = await response.text();
    const s = text.indexOf('datas:[[');
    const e = text.indexOf(']],count');
    if (s < 0 || e < 0) return null;
    const row = new Function(`return ${text.slice(s + 6, e + 2)}`)()[0];
    if (!row || String(row[0]) !== code) return null;
    const nav = Number(row[3]) > 0 ? Number(row[3]) : null;
    const prevNav = Number(row[5]) > 0 ? Number(row[5]) : null;
    const dm = /showday:\["(\d{4}-\d\d-\d\d)"/.exec(text);
    return {
      code,
      name: String(row[1] || ''),
      nav,
      prevNav,
      changePct: row[8] != null && isFinite(Number(row[8])) ? Number(row[8]) : null,
      navDate: dm ? dm[1] : '',
      estimateTime: '',
    };
  } catch {
    return null;
  }
}

export async function fetchFundQuotes(codes) {
  // jdzf is now the primary realtime-ish source (published NAV, not intraday
  // estimate). Fundgz JSONP is kept as a fallback for funds missing there.
  const jdz = await Promise.all(codes.map(code => fetchJdzQuote(code)));
  const quotes = [];
  const missing = [];
  jdz.forEach((q, i) => {
    if (q) quotes.push(q);
    else missing.push(codes[i]);
  });
  const fallback = (await Promise.all(
    missing.map(async code => {
      try {
        const response = await fetch(`${FUNDGZ}${code}.js?rt=${Date.now()}`, {
          headers: { referer: 'https://fund.eastmoney.com/' },
        });
        if (!response.ok) return null;
        return quoteOf(parseFundgz(await response.text()));
      } catch {
        return null;
      }
    }),
  )).filter(Boolean);
  quotes.push(...fallback);
  // yesterday's NAV day-change per fund (best effort, tolerant to failure)
  const yesterday = {};
  await Promise.all(
    codes.map(async code => {
      const pct = await fetchYesterdayPct(code);
      if (pct != null) yesterday[code] = pct;
    }),
  );
  return { quotes, yesterday };
}

export async function fetchIndices(db) {
  try {
    let indexRows = [];
    let etfRows = [];
    if (db) {
      indexRows = db.prepare('SELECT secid, code FROM index_base').all();
      etfRows = db.prepare('SELECT secid, code FROM etf_base').all();
    } else {
      indexRows = INDEX_LIBRARY.map(([secid, code]) => ({ secid, code }));
    }
    const secids = [...indexRows, ...etfRows].map(r => r.secid).join(',');
    if (!secids) return { indices: [], etfs: [] };
    const url = `${INDEX_URL}?fltt=2&secids=${encodeURIComponent(secids)}&fields=f2,f3,f4,f5,f6,f12,f14,f15,f16,f17,f18`;
    const response = await fetch(url, { headers: { referer: 'https://quote.eastmoney.com/' } });
    if (!response.ok) return { indices: [], etfs: [] };
    const body = await response.json();
    const diff = body && body.data && Array.isArray(body.data.diff) ? body.data.diff : [];
    const map = new Map(indexRows.map(r => [r.code, 'index']));
    const num = v => (v != null && isFinite(v) ? Number(v) : null);
    const toQuote = d => ({
      code: String(d.f12 || ''),
      name: String(d.f14 || ''),
      price: num(d.f2),
      changePct: num(d.f3),
      changeAmt: num(d.f4),
      volume: num(d.f5),   // 成交量（手）
      amount: num(d.f6),   // 成交额（元）
      high: num(d.f15),    // 最高
      low: num(d.f16),     // 最低
      open: num(d.f17),    // 今开
      prevClose: num(d.f18), // 昨收
    });
    const indices = [];
    const etfs = [];
    for (const d of diff) {
      if (!d.f14) continue;
      const q = toQuote(d);
      if (map.get(q.code) === 'index') indices.push(q);
      else etfs.push(q);
    }
    return { indices, etfs };
  } catch {
    return { indices: [], etfs: [] };
  }
}

export async function searchFunds(query) {
  try {
    const url = `${SEARCH_URL}?m=1&key=${encodeURIComponent(query)}&pageindex=0&pagesize=12`;
    const response = await fetch(url, { headers: { referer: 'https://fund.eastmoney.com/' } });
    if (!response.ok) return [];
    const body = await response.json();
    const datas = Array.isArray(body && body.Datas) ? body.Datas : [];
    return datas
      .map(d => ({
        code: String(d.CODE || ''),
        name: String(d.NAME || '').replace(/<[^>]*>/g, ''),
        type: String((d.FundBaseInfo && d.FundBaseInfo.FTYPE) || d.CATEGORYDESC || ''),
      }))
      .filter(x => /^\d{6}$/.test(x.code));
  } catch {
    return [];
  }
}

function pctBetween(trend, days) {
  if (!Array.isArray(trend) || trend.length < 2) return null;
  const last = trend[trend.length - 1];
  const t0 = last.x - days * 24 * 3600 * 1000;
  let base = null;
  for (const point of trend) {
    if (point.x >= t0 && point.y != null) { base = point; break; }
  }
  if (!base) base = trend.find(p => p.y != null);
  if (!base || !base.y || !last.y) return null;
  return (last.y / base.y - 1) * 100;
}

function sampleTrend(trend, days, maxPoints) {
  if (!Array.isArray(trend) || trend.length < 2) return [];
  const last = trend[trend.length - 1];
  const t0 = last.x - days * 24 * 3600 * 1000;
  const window = trend.filter(p => p.x >= t0 && p.y != null);
  if (window.length === 0) return [];
  const step = Math.max(1, Math.ceil(window.length / maxPoints));
  const out = [];
  for (let i = 0; i < window.length; i += step) {
    const p = window[i];
    const d = new Date(p.x);
    out.push({ d: `${d.getMonth() + 1}/${d.getDate()}`, v: p.y });
  }
  const lastPoint = window[window.length - 1];
  const d = new Date(lastPoint.x);
  const lastEntry = { d: `${d.getMonth() + 1}/${d.getDate()}`, v: lastPoint.y };
  if (out[out.length - 1].d !== lastEntry.d) out.push(lastEntry);
  return out;
}

export async function fetchDetail(code) {
  try {
    const response = await fetch(`${PINGZHONG}${code}.js`, {
      headers: { referer: 'https://fund.eastmoney.com/' },
    });
    if (!response.ok) return null;
    const text = await response.text();
    const m = /\bData_netWorthTrend\s*=\s*(\[[\s\S]*?\]);/.exec(text);
    if (!m) return null;
    const trend = JSON.parse(m[1]).filter(p => p && p.y != null);
    if (trend.length < 2) return null;
    const last = trend[trend.length - 1];
    const spans = {};
    for (const [key, days] of SPANS) spans[key] = pctBetween(trend, days);
    const first = trend.find(p => p.y);
    return {
      code,
      latestNav: last.y,
      latestDate: new Date(last.x).toISOString().slice(0, 10),
      totalPct: first && first.y ? (last.y / first.y - 1) * 100 : null,
      spans,
      trend3m: sampleTrend(trend, 90, 90),
      trend1y: sampleTrend(trend, 365, 120),
    };
  } catch {
    return null;
  }
}
