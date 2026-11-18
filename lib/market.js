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

async function fetchYesterdayPct(code) {
  try {
    const url = `${HIS_URL}?FCODE=${code}&pageIndex=1&pageSize=2&deviceid=Wap&plat=Wap&product=EFund&version=6.2.5`;
    const response = await fetch(url, { headers: { referer: 'https://fund.eastmoney.com/' } });
    if (!response.ok) return null;
    const body = await response.json();
    const datas = body && Array.isArray(body.Datas) ? body.Datas : [];
    if (datas.length === 0 || datas[0].JZZZL == null) return null;
    const v = Number(datas[0].JZZZL);
    return isFinite(v) ? v : null;
  } catch {
    return null;
  }
}

export async function fetchFundQuotes(codes) {
  const quotes = (await Promise.all(
    codes.map(async code => {
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
    const url = `${INDEX_URL}?fltt=2&secids=${encodeURIComponent(secids)}&fields=f2,f3,f4,f12,f14`;
    const response = await fetch(url, { headers: { referer: 'https://quote.eastmoney.com/' } });
    if (!response.ok) return { indices: [], etfs: [] };
    const body = await response.json();
    const diff = body && body.data && Array.isArray(body.data.diff) ? body.data.diff : [];
    const map = new Map(indexRows.map(r => [r.code, 'index']));
    const toQuote = d => ({
      code: String(d.f12 || ''),
      name: String(d.f14 || ''),
      price: d.f2 != null && isFinite(d.f2) ? Number(d.f2) : null,
      changePct: d.f3 != null && isFinite(d.f3) ? Number(d.f3) : null,
      changeAmt: d.f4 != null && isFinite(d.f4) ? Number(d.f4) : null,
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
