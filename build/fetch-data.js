#!/usr/bin/env node
/**
 * Fetches market data from APIs and outputs data/briefing.json
 * Add API keys via env vars or .env for NEWS_API_KEY, ALPHA_VANTAGE_KEY.
 * Big Picture: news-driven. Segments: Alpha Vantage (when key) else Yahoo Finance.
 * Digital Assets: CoinGecko (always).
 */

require('dotenv').config();
const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', 'data');
const OUTPUT_FILE = path.join(DATA_DIR, 'briefing.json');

// Fallback data when APIs fail or keys are missing
const FALLBACK = {
  bigPicture: "Markets are consolidating. Add NEWS_API_KEY for live headlines. See README for setup.",
  marketMood: "Neutral",
  fearGreed: { value: 50, label: "Neutral" },
  trendingNews: [
    "Markets await key economic data",
    "Fed policy in focus",
    "Add API keys for live headlines",
  ],
  topHeadlines: [
    { source: "Reuters", title: "Markets digest Fed decision" },
    { source: "Bloomberg", title: "Add NEWS_API_KEY for live data" },
  ],
  segments: [
    {
      name: "Global Markets",
      direction: "flat",
      description: "Market data temporarily unavailable.",
      regions: [
        { label: "S&P 500", direction: "flat", placeholder: true },
        { label: "Europe", direction: "flat", placeholder: true },
        { label: "Asia", direction: "flat", placeholder: true },
        { label: "VIX", direction: "steady", vixStyle: true, placeholder: true },
      ],
    },
    { name: "Currencies", direction: "flat", description: "Add API keys for live data." },
    { name: "Bonds & Rates", direction: "flat", description: "Government bonds and credit." },
    { name: "Digital Assets", direction: "flat", description: "Add API keys for live data." },
    { name: "Commodities", direction: "flat", description: "Gold, silver, copper data temporarily unavailable." },
    { name: "Energy & Materials", direction: "flat", description: "Add API keys for live data." },
    { name: "U.S. Growth & Tech", direction: "flat", description: "Add API keys for live data." },
    { name: "Sector Performance", direction: "flat", description: "S&P 500 sector ETFs." },
    { name: "Real Estate", direction: "flat", description: "REITs and property." },
    { name: "Top Movers", direction: "flat", description: "Biggest gainers and losers." },
  ],
  updatedAt: new Date().toISOString(),
};

async function fetchJson(url, opts = {}) {
  try {
    const res = await fetch(url, { ...opts, signal: AbortSignal.timeout(10000) });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

function pctDir(pct) {
  if (pct == null || isNaN(pct)) return 'flat';
  return pct > 0.3 ? 'up' : pct < -0.3 ? 'down' : 'flat';
}

// Tone mapping for Global Markets (ChatGPT / common convention)
function toneFromPct(pct) {
  if (pct == null || isNaN(pct)) return 'flat';
  if (pct >= 0.5) return 'up';   // Bullish
  if (pct >= 0.15) return 'up';  // Mildly positive
  if (pct >= -0.15) return 'flat'; // Flat / Neutral
  if (pct >= -0.49) return 'down'; // Mildly negative
  return 'down';                   // Bearish (<= -0.5)
}

// VIX: high = elevated (fear), low = subdued (calm). Up % = elevated, down % = subdued
function vixToneFromPct(pct) {
  if (pct == null || isNaN(pct)) return 'steady';
  if (pct >= 0.5) return 'elevated';
  if (pct >= 0.15) return 'elevated';
  if (pct >= -0.15) return 'steady';
  if (pct >= -0.49) return 'subdued';
  return 'subdued';
}

// FMP: requires API key. Sign up at https://site.financialmodelingprep.com/register
// FMP uses same symbols as Yahoo (^GSPC, ^DJI, etc.)
const FMP_GLOBAL_SYMBOLS = [
  { symbol: '^GSPC', label: 'S&P 500' },
  { symbol: '^DJI', label: 'Dow Jones' },
  { symbol: '^IXIC', label: 'Nasdaq' },
  { symbol: '^STOXX50E', label: 'Euro Stoxx 50' },
  { symbol: '^GDAXI', label: 'DAX' },
  { symbol: '^N225', label: 'Nikkei 225' },
  { symbol: '^HSI', label: 'Hang Seng' },
  { symbol: '^SSEC', label: 'Shanghai Composite' },
  { symbol: '^VIX', label: 'VIX', vixStyle: true },
];

async function fetchFmpGlobalMarkets() {
  const key = process.env.FMP_API_KEY || process.env.FMPAPIKEY;
  if (!key) return null;

  const symbols = FMP_GLOBAL_SYMBOLS.map(s => s.symbol).join(',');
  const url = `https://financialmodelingprep.com/stable/batch-quote?symbols=${encodeURIComponent(symbols)}&apikey=${encodeURIComponent(key)}`;

  try {
    const data = await fetchJson(url);
    if (!Array.isArray(data) || !data.length) return null;

    const bySymbol = Object.fromEntries(data.filter(r => r?.symbol).map(r => [r.symbol, r]));
    const regions = FMP_GLOBAL_SYMBOLS.map(({ symbol, label, vixStyle }) => {
      const q = bySymbol[symbol];
      if (!q) return { label, direction: vixStyle ? 'steady' : 'flat', vixStyle, placeholder: true };
      const pct = q.changesPercentage ?? q.changePercent ?? (q.change && q.price ? (q.change / (q.price - q.change)) * 100 : null);
      if (pct == null || isNaN(pct)) return { label, direction: vixStyle ? 'steady' : 'flat', vixStyle, placeholder: true };
      const direction = vixStyle ? vixToneFromPct(pct) : toneFromPct(pct);
      return { label, direction, vixStyle, changePct: pct, placeholder: false };
    });

    const nonPlaceholder = regions.filter(r => !r.placeholder && !r.vixStyle);
    const avgPct = nonPlaceholder.length
      ? nonPlaceholder.reduce((s, r) => s + (r.changePct ?? 0), 0) / nonPlaceholder.length
      : 0;

    return {
      regions,
      direction: toneFromPct(avgPct),
      description: 'Session tone and regional risk. Data via FMP.',
    };
  } catch {
    return null;
  }
}

// Stooq: free, no API key. CSV at https://stooq.com/q/d/l/?s=SYMBOL&i=d
// Stooq uses ^SPX for S&P 500 (Yahoo uses ^GSPC)
const STOOQ_GLOBAL_SYMBOLS = [
  { symbol: '^SPX', label: 'S&P 500' },
  { symbol: '^DJI', label: 'Dow Jones' },
  { symbol: '^IXIC', label: 'Nasdaq' },
  { symbol: '^STOXX50E', label: 'Euro Stoxx 50' },
  { symbol: '^GDAXI', label: 'DAX' },
  { symbol: '^N225', label: 'Nikkei 225' },
  { symbol: '^HSI', label: 'Hang Seng' },
  { symbol: '^SSEC', label: 'Shanghai Composite' },
  { symbol: '^VIX', label: 'VIX', vixStyle: true },
];

async function fetchStooqGlobalMarkets() {
  const results = [];
  const ua = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
  const opts = { headers: { 'User-Agent': ua }, signal: AbortSignal.timeout(15000) };

  for (const { symbol, label, vixStyle } of STOOQ_GLOBAL_SYMBOLS) {
    try {
      const url = `https://stooq.com/q/d/l/?s=${encodeURIComponent(symbol)}&i=d`;
      const res = await fetch(url, opts);
      if (!res.ok) continue;
      const csv = await res.text();
      const lines = csv.trim().split(/\r?\n/).filter(Boolean);
      if (lines.length < 2) continue; // need header + at least 1 row
      const lastTwo = lines.slice(-2);
      const parseRow = (row) => {
        const parts = row.split(',');
        const close = parseFloat(parts[4]);
        return isNaN(close) ? null : close;
      };
      const prevClose = parseRow(lastTwo[0]);
      const currClose = parseRow(lastTwo[1]);
      if (prevClose == null || currClose == null || prevClose <= 0) continue;
      const pct = ((currClose - prevClose) / prevClose) * 100;
      results.push({ symbol, label, vixStyle, pct });
    } catch {
      // skip failed symbol
    }
    await new Promise(r => setTimeout(r, 200));
  }

  if (!results.length) return null;

  const regions = STOOQ_GLOBAL_SYMBOLS.map(({ symbol, label, vixStyle }) => {
    const r = results.find(x => x.symbol === symbol);
    if (!r) return { label, direction: vixStyle ? 'steady' : 'flat', vixStyle, placeholder: true };
    const direction = vixStyle ? vixToneFromPct(r.pct) : toneFromPct(r.pct);
    return { label, direction, vixStyle, changePct: r.pct, placeholder: false };
  });

  const nonPlaceholder = regions.filter(r => !r.placeholder && !r.vixStyle);
  const avgPct = nonPlaceholder.length
    ? nonPlaceholder.reduce((s, r) => s + (r.changePct ?? 0), 0) / nonPlaceholder.length
    : 0;

  return {
    regions,
    direction: toneFromPct(avgPct),
    description: 'Session tone and regional risk. Data via Stooq.',
  };
}

// Index symbols (ChatGPT: use real browser User-Agent; batch first, then one-by-one fallback)
const YAHOO_GLOBAL_SYMBOLS = [
  { symbol: '^GSPC', label: 'S&P 500' },
  { symbol: '^DJI', label: 'Dow Jones' },
  { symbol: '^IXIC', label: 'Nasdaq' },
  { symbol: '^STOXX50E', label: 'Euro Stoxx 50' },
  { symbol: '^GDAXI', label: 'DAX' },
  { symbol: '^N225', label: 'Nikkei 225' },
  { symbol: '^HSI', label: 'Hang Seng' },
  { symbol: '^SSEC', label: 'Shanghai Composite' },
  { symbol: '^VIX', label: 'VIX', vixStyle: true },
];

const BROWSER_USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

const QUOTE_FIELDS = ['regularMarketPrice', 'regularMarketChangePercent', 'regularMarketPreviousClose'];

async function fetchYahooQuoteGlobalMarkets() {
  const symbolList = YAHOO_GLOBAL_SYMBOLS.map(s => s.symbol);
  const fetchOpts = { fetchOptions: { headers: { 'User-Agent': BROWSER_USER_AGENT } } };
  const queryOpts = { fields: QUOTE_FIELDS };
  let results = [];

  try {
    const yf = await getYahooFinance();
    results = await yf.quote(symbolList, queryOpts, fetchOpts);
    if (!Array.isArray(results)) results = results ? [results] : [];
  } catch {
    results = [];
  }

  if (!results.length || results.every(r => !r?.symbol)) {
    try {
      const yf = await getYahooFinance();
      results = [];
      for (const symbol of symbolList) {
        const q = await yf.quote(symbol, queryOpts, fetchOpts);
        if (q) results.push(q);
        await new Promise(r => setTimeout(r, 300));
      }
    } catch {
      return null;
    }
  }

  const bySymbol = Object.fromEntries(results.filter(r => r?.symbol).map(r => [r.symbol, r]));
  const regions = YAHOO_GLOBAL_SYMBOLS.map(({ symbol, label, vixStyle }) => {
    const q = bySymbol[symbol];
    if (!q) return { label, direction: vixStyle ? 'steady' : 'flat', vixStyle, placeholder: true };
    const price = q.regularMarketPrice;
    const change = q.regularMarketChange ?? 0;
    const pct = q.regularMarketChangePercent ?? (change && price ? (change / (price - change)) * 100 : null);
    if (pct == null || isNaN(pct)) return { label, direction: vixStyle ? 'steady' : 'flat', vixStyle, placeholder: true };
    const direction = vixStyle ? vixToneFromPct(pct) : toneFromPct(pct);
    return { label, direction, vixStyle, changePct: pct, placeholder: false };
  });

  const nonPlaceholder = regions.filter(r => !r.placeholder && !r.vixStyle);
  const avgPct = nonPlaceholder.length
    ? nonPlaceholder.reduce((s, r) => s + (r.changePct ?? 0), 0) / nonPlaceholder.length
    : 0;
  const globalDirection = toneFromPct(avgPct);
  const desc = nonPlaceholder.length
    ? 'Session tone and regional risk. Data via Yahoo Finance.'
    : 'Session tone and regional risk across major indices.';

  return {
    regions,
    direction: globalDirection,
    description: desc,
  };
}

async function fetchFearGreed() {
  const data = await fetchJson('https://api.alternative.me/fng/?limit=1');
  if (data?.data?.[0]) {
    const v = parseInt(data.data[0].value, 10);
    const label = data.data[0].value_classification || 'Neutral';
    const mood = v >= 55 ? 'Risk-on' : v <= 45 ? 'Risk-off' : 'Neutral';
    return { marketMood: mood, fearGreed: { value: v, label } };
  }
  return null;
}

async function fetchNewsApi() {
  const key = process.env.NEWS_API_KEY;
  if (!key) return null;
  const url = `https://newsapi.org/v2/top-headlines?country=us&category=business&pageSize=8&apiKey=${key}`;
  const data = await fetchJson(url);
  if (data?.articles?.length) {
    const topHeadlines = data.articles
      .filter(a => a.title && a.source?.name)
      .slice(0, 8)
      .map(a => ({ source: a.source.name, title: a.title }));
    return { topHeadlines };
  }
  return null;
}

async function fetchCoinGecko() {
  const url = 'https://api.coingecko.com/api/v3/simple/price?ids=bitcoin,ethereum&vs_currencies=usd&include_24hr_change=true';
  const data = await fetchJson(url);
  if (!data?.bitcoin?.usd || !data?.ethereum?.usd) return null;
  return {
    btc: {
      price: data.bitcoin.usd,
      changePct: data.bitcoin.usd_24h_change ?? 0,
    },
    eth: {
      price: data.ethereum.usd,
      changePct: data.ethereum.usd_24h_change ?? 0,
    },
  };
}

async function fetchAlphaVantageQuote(symbol, key) {
  const url = `https://www.alphavantage.co/query?function=GLOBAL_QUOTE&symbol=${symbol}&apikey=${key}`;
  const data = await fetchJson(url);
  const q = data?.['Global Quote'];
  if (!q?.['09. change']) return null;
  const change = parseFloat(q['09. change']);
  const changePct = parseFloat(q['10. change percent']?.replace('%', ''));
  const price = parseFloat(q['05. price']);
  return { change, changePct, price };
}

async function fetchAlphaVantage() {
  const key = process.env.ALPHA_VANTAGE_KEY || process.env.ALPHAVANTAGE_API_KEY;
  if (!key) return null;

  const [spy, qqq, xom, eurusd, vgk] = await Promise.all([
    fetchAlphaVantageQuote('SPY', key),
    fetchAlphaVantageQuote('QQQ', key),
    fetchAlphaVantageQuote('XOM', key),
    fetchAlphaVantageQuote('EURUSD', key),
    fetchAlphaVantageQuote('VGK', key),
  ]);
  await new Promise(r => setTimeout(r, 65000));
  const [ewj, ewh, vxx] = await Promise.all([
    fetchAlphaVantageQuote('EWJ', key),
    fetchAlphaVantageQuote('EWH', key),
    fetchAlphaVantageQuote('VXX', key),
  ]);

  const regions = [];
  regions.push(spy ? { label: 'S&P 500', direction: pctDir(spy.changePct), changePct: spy.changePct } : { label: 'S&P 500', direction: 'flat', placeholder: true });
  regions.push(vgk ? { label: 'Europe', direction: pctDir(vgk.changePct), changePct: vgk.changePct } : { label: 'Europe', direction: 'flat', placeholder: true });
  if (ewj && ewh) {
    const asiaDir = pctDir((ewj.changePct + ewh.changePct) / 2);
    regions.push({ label: 'Asia', direction: asiaDir, changePct: (ewj.changePct + ewh.changePct) / 2 });
  } else if (ewj) {
    regions.push({ label: 'Japan', direction: pctDir(ewj.changePct), changePct: ewj.changePct });
  } else if (ewh) {
    regions.push({ label: 'Hong Kong', direction: pctDir(ewh.changePct), changePct: ewh.changePct });
  } else {
    regions.push({ label: 'Asia', direction: 'flat', placeholder: true });
  }
  regions.push(vxx ? { label: 'VIX', direction: vixLabel(vxx.changePct), changePct: vxx.changePct, vixStyle: true } : { label: 'VIX', direction: 'steady', vixStyle: true, placeholder: true });

  const globalDirection = spy ? pctDir(spy.changePct) : 'flat';
  const globalDesc = regions.some(r => !r.placeholder)
    ? 'Session tone and regional risk. Data via Alpha Vantage.'
    : 'Market data temporarily unavailable.';

  const segments = [
    { name: 'Global Markets', direction: globalDirection, description: globalDesc, regions },
    eurusd
      ? {
          name: 'Currencies',
          direction: eurusd.change > 0 ? 'down' : eurusd.change < 0 ? 'up' : 'flat',
          description: eurusd.change > 0 ? 'Dollar strengthening vs euro.' : eurusd.change < 0 ? 'Dollar weakening.' : 'DXY range-bound.',
        }
      : { name: 'Currencies', direction: 'flat', description: 'Forex data temporarily unavailable.' },
    { name: 'Bonds & Rates', direction: 'flat', description: 'Government bonds and credit.' },
    { name: 'Digital Assets', direction: 'flat', description: 'Fear & Greed reflects crypto sentiment. Add crypto API for live prices.' },
    { name: 'Commodities', direction: 'flat', description: 'Gold, silver, copper data temporarily unavailable.' },
    xom
      ? {
          name: 'Energy & Materials',
          direction: pctDir(xom.changePct),
          description: `Energy (XOM) ${xom.changePct >= 0 ? '+' : ''}${xom.changePct?.toFixed(2)}%. ${pctDir(xom.changePct) === 'down' ? 'Oil pressure.' : pctDir(xom.changePct) === 'up' ? 'Commodities firmer.' : 'Flat.'}`,
        }
      : { name: 'Energy & Materials', direction: 'flat', description: 'Energy data temporarily unavailable.' },
    qqq
      ? {
          name: 'U.S. Growth & Tech',
          direction: pctDir(qqq.changePct),
          description: `Nasdaq (QQQ) ${qqq.changePct >= 0 ? '+' : ''}${qqq.changePct?.toFixed(2)}%. ${pctDir(qqq.changePct) === 'up' ? 'Tech leading.' : pctDir(qqq.changePct) === 'down' ? 'Growth under pressure.' : 'Mixed.'}`,
        }
      : { name: 'U.S. Growth & Tech', direction: 'flat', description: 'Tech data temporarily unavailable.' },
    { name: 'Sector Performance', direction: 'flat', description: 'S&P 500 sector ETFs.' },
    { name: 'Real Estate', direction: 'flat', description: 'REITs and property.' },
    { name: 'Top Movers', direction: 'flat', description: 'Biggest gainers and losers.' },
  ];

  return { segments };
}

let yahooFinanceInstance = null;
async function getYahooFinance() {
  if (!yahooFinanceInstance) {
    const YahooFinance = (await import('yahoo-finance2')).default;
    yahooFinanceInstance = new YahooFinance();
    try {
      yahooFinanceInstance.suppressNotices?.(['yahooSurvey']);
    } catch { /* ignore */ }
  }
  return yahooFinanceInstance;
}

function vixLabel(changePct) {
  if (changePct == null || isNaN(changePct)) return 'steady';
  return changePct > 0.3 ? 'elevated' : changePct < -0.3 ? 'subdued' : 'steady';
}

function quoteToResult(q) {
  if (!q?.regularMarketPrice) return null;
  const price = q.regularMarketPrice;
  const change = q.regularMarketChange ?? 0;
  const changePct = q.regularMarketChangePercent ?? (change && price ? (change / (price - change)) * 100 : 0);
  return { change, changePct, price };
}

async function fetchYahooFinance() {
  const symbolMap = { SPY: 'spy', QQQ: 'qqq', XOM: 'xom', 'EURUSD=X': 'eurusd', VGK: 'vgk', EWJ: 'ewj', EWH: 'ewh', VXX: 'vxx' };
  const symbolList = Object.keys(symbolMap);
  let results = [];
  try {
    const yf = await getYahooFinance();
    results = await yf.quote(symbolList);
    if (!Array.isArray(results)) results = results ? [results] : [];
  } catch {
    results = [];
  }
  const data = {};
  for (const q of results) {
    const sym = q?.symbol;
    if (sym && symbolMap[sym]) data[symbolMap[sym]] = quoteToResult(q);
  }
  for (const key of Object.values(symbolMap)) {
    if (!data[key]) data[key] = null;
  }
  const { spy, qqq, xom, eurusd, vgk, ewj, ewh, vxx } = data;

  const regions = [];
  regions.push(spy ? { label: 'S&P 500', direction: pctDir(spy.changePct), changePct: spy.changePct } : { label: 'S&P 500', direction: 'flat', placeholder: true });
  regions.push(vgk ? { label: 'Europe', direction: pctDir(vgk.changePct), changePct: vgk.changePct } : { label: 'Europe', direction: 'flat', placeholder: true });
  if (ewj && ewh) {
    const asiaDir = pctDir((ewj.changePct + ewh.changePct) / 2);
    regions.push({ label: 'Asia', direction: asiaDir, changePct: (ewj.changePct + ewh.changePct) / 2 });
  } else if (ewj) {
    regions.push({ label: 'Japan', direction: pctDir(ewj.changePct), changePct: ewj.changePct });
  } else if (ewh) {
    regions.push({ label: 'Hong Kong', direction: pctDir(ewh.changePct), changePct: ewh.changePct });
  } else {
    regions.push({ label: 'Asia', direction: 'flat', placeholder: true });
  }
  regions.push(vxx ? { label: 'VIX', direction: vixLabel(vxx.changePct), changePct: vxx.changePct, vixStyle: true } : { label: 'VIX', direction: 'steady', vixStyle: true, placeholder: true });

  const globalDirection = spy ? pctDir(spy.changePct) : (regions.length ? pctDir(regions[0]?.changePct) : 'flat');
  const globalDesc = regions.some(r => !r.placeholder)
    ? 'Session tone and regional risk. Data via Yahoo Finance.'
    : 'Market data temporarily unavailable.';

  const segments = [
    {
      name: 'Global Markets',
      direction: globalDirection,
      description: globalDesc,
      regions,
    },
    eurusd
      ? {
          name: 'Currencies',
          direction: eurusd.change > 0 ? 'down' : eurusd.change < 0 ? 'up' : 'flat',
          description: eurusd.change > 0 ? 'Dollar strengthening vs euro.' : eurusd.change < 0 ? 'Dollar weakening.' : 'DXY range-bound.',
        }
      : { name: 'Currencies', direction: 'flat', description: 'Forex data temporarily unavailable.' },
    { name: 'Bonds & Rates', direction: 'flat', description: 'Government bonds and credit.' },
    { name: 'Digital Assets', direction: 'flat', description: 'Fear & Greed reflects crypto sentiment. Add crypto API for live prices.' },
    { name: 'Commodities', direction: 'flat', description: 'Gold, silver, copper data temporarily unavailable.' },
    xom
      ? {
          name: 'Energy & Materials',
          direction: pctDir(xom.changePct),
          description: `Energy (XOM) ${xom.changePct >= 0 ? '+' : ''}${xom.changePct?.toFixed(2)}%. ${pctDir(xom.changePct) === 'down' ? 'Oil pressure.' : pctDir(xom.changePct) === 'up' ? 'Commodities firmer.' : 'Flat.'}`,
        }
      : { name: 'Energy & Materials', direction: 'flat', description: 'Energy data temporarily unavailable.' },
    qqq
      ? {
          name: 'U.S. Growth & Tech',
          direction: pctDir(qqq.changePct),
          description: `Nasdaq (QQQ) ${qqq.changePct >= 0 ? '+' : ''}${qqq.changePct?.toFixed(2)}%. ${pctDir(qqq.changePct) === 'up' ? 'Tech leading.' : pctDir(qqq.changePct) === 'down' ? 'Growth under pressure.' : 'Mixed.'}`,
        }
      : { name: 'U.S. Growth & Tech', direction: 'flat', description: 'Tech data temporarily unavailable.' },
    { name: 'Sector Performance', direction: 'flat', description: 'S&P 500 sector ETFs.' },
    { name: 'Real Estate', direction: 'flat', description: 'REITs and property.' },
    { name: 'Top Movers', direction: 'flat', description: 'Biggest gainers and losers.' },
  ];

  return { segments };
}

async function fetchCommoditiesYahoo() {
  const symbolMap = { GLD: 'gold', SLV: 'silver', 'HG=F': 'copper' };
  try {
    const yf = await getYahooFinance();
    const results = await yf.quote(Object.keys(symbolMap));
    const arr = Array.isArray(results) ? results : results ? [results] : [];
    const data = {};
    for (const q of arr) {
      const sym = q?.symbol;
      if (sym && symbolMap[sym]) data[symbolMap[sym]] = quoteToResult(q);
    }
    return data;
  } catch {
    return null;
  }
}

// Global Markets regions (name-only outline; live data can add direction later)
const GLOBAL_MARKETS_PLACEHOLDERS = [
  { label: 'S&P 500', direction: 'flat', placeholder: true },
  { label: 'Dow Jones', direction: 'flat', placeholder: true },
  { label: 'Nasdaq', direction: 'flat', placeholder: true },
  { label: 'Euro Stoxx 50', direction: 'flat', placeholder: true },
  { label: 'DAX', direction: 'flat', placeholder: true },
  { label: 'Nikkei 225', direction: 'flat', placeholder: true },
  { label: 'Hang Seng', direction: 'flat', placeholder: true },
  { label: 'Shanghai Composite', direction: 'flat', placeholder: true },
  { label: 'VIX', direction: 'steady', vixStyle: true, placeholder: true },
];

// Bonds & Rates names only (outline; live data can add prices later)
const BONDS_RATES_PLACEHOLDERS = [
  { symbol: 'US10Y', name: 'U.S. 10Y Treasury' },
  { symbol: 'US2Y', name: 'U.S. 2Y Treasury' },
  { symbol: 'DE10Y', name: 'German 10Y Bund' },
  { symbol: 'DE2Y', name: 'German 2Y Schatz' },
  { symbol: 'JP10Y', name: 'Japan 10Y Bond' },
  { symbol: 'JP2Y', name: 'Japan 2Y Bond' },
  { symbol: 'CN10Y', name: 'China 10Y Bond' },
  { symbol: 'CN2Y', name: 'China 2Y Bond' },
  { symbol: 'TIP', name: 'US TIPS' },
  { symbol: 'TLT', name: 'Long Duration Treasuries' },
  { symbol: 'LQD', name: 'Investment Grade Credit' },
  { symbol: 'HYG', name: 'High Yield Credit' },
];

// Currency names only (outline; live data can add prices later)
const CURRENCY_PLACEHOLDERS = [
  { symbol: 'DXY', name: 'U.S. Dollar' },
  { symbol: 'EUR/USD', name: 'EUR/USD' },
  { symbol: 'USD/JPY', name: 'USD/JPY' },
  { symbol: 'GBP/USD', name: 'GBP/USD' },
  { symbol: 'CNY/USD', name: 'CNY/USD' },
  { symbol: 'AUD/USD', name: 'AUD/USD' },
  { symbol: 'USD/CAD', name: 'USD/CAD' },
  { symbol: 'USD/CHF', name: 'USD/CHF' },
];

// Sector Performance names only (outline; live data can add prices later)
const SECTOR_PERFORMANCE_PLACEHOLDERS = [
  { symbol: 'XLK', name: 'Technology' },
  { symbol: 'XLF', name: 'Financials' },
  { symbol: 'XLE', name: 'Energy' },
  { symbol: 'XLV', name: 'Health Care' },
  { symbol: 'XLY', name: 'Consumer Discretionary' },
  { symbol: 'XLP', name: 'Consumer Staples' },
  { symbol: 'XLI', name: 'Industrials' },
  { symbol: 'XLB', name: 'Materials' },
  { symbol: 'XLU', name: 'Utilities' },
];

// Real Estate names only (outline; live data can add prices later)
const REAL_ESTATE_PLACEHOLDERS = [
  { symbol: 'VNQ', name: 'U.S. REITs' },
  { symbol: 'REET', name: 'Global Real Estate' },
  { symbol: 'IYR', name: 'Dow Jones REIT' },
];

// Top Movers placeholder (outline; live data can add gainers/losers later)
const TOP_MOVERS_PLACEHOLDERS = [
  { symbol: '▲', name: 'Leading' },
  { symbol: '▼', name: 'Lagging' },
];

// U.S. Growth & Tech names only (outline; live data can add prices later)
const US_GROWTH_TECH_PLACEHOLDERS = [
  { symbol: 'AAPL', name: 'Apple' },
  { symbol: 'MSFT', name: 'Microsoft' },
  { symbol: 'TSLA', name: 'Tesla' },
  { symbol: 'AMZN', name: 'Amazon' },
  { symbol: 'GOOGL', name: 'Google' },
  { symbol: 'META', name: 'Meta' },
  { symbol: 'SMH', name: 'VanEck Semiconductor ETF' },
  { symbol: 'SOXX', name: 'Semiconductors' },
];

// Energy names only (outline; live data can add prices later)
const ENERGY_PLACEHOLDERS = [
  { symbol: 'BRENT', name: 'U.K. Oil' },
  { symbol: 'WTI', name: 'U.S. Oil' },
  { symbol: 'NG', name: 'U.S. Natural Gas' },
  { symbol: 'TTF', name: 'EU Natural Gas' },
  { symbol: 'COAL', name: 'Coal' },
  { symbol: 'KRBN', name: 'Carbon ETF' },
];

// Commodity names only (outline; live data can add prices later)
const COMMODITY_PLACEHOLDERS = [
  { symbol: 'GOLD', name: 'Gold' },
  { symbol: 'XAG', name: 'Silver' },
  { symbol: 'COPPER', name: 'Copper' },
  { symbol: 'HG', name: 'Copper' },
  { symbol: 'WHEAT', name: 'Wheat' },
  { symbol: 'CORN', name: 'Corn' },
  { symbol: 'SOY', name: 'Soybeans' },
  { symbol: 'COFFEE', name: 'Coffee' },
  { symbol: 'BCOM', name: 'Bloomberg Commodity' },
];

function mergeCommoditiesIntoSegments(segments, commodities) {
  if (!segments?.length) return segments;
  let tickers = [];
  let direction = 'flat';
  let desc = 'Precious metals, grains, and industrial commodities.';
  if (commodities?.gold || commodities?.silver || commodities?.copper) {
    const { gold, silver, copper } = commodities;
    if (gold) tickers.push({ symbol: 'GLD', name: 'Gold', price: gold.price, changePct: gold.changePct });
    if (silver) tickers.push({ symbol: 'SLV', name: 'Silver', price: silver.price, changePct: silver.changePct });
    if (copper) tickers.push({ symbol: 'HG', name: 'Copper', price: copper.price, changePct: copper.changePct });
    if (tickers.length) {
      const avgPct = tickers.reduce((s, t) => s + (t.changePct ?? 0), 0) / tickers.length;
      direction = pctDir(avgPct);
      desc = tickers.map(t => `${t.name} ${(t.changePct ?? 0) >= 0 ? '+' : ''}${(t.changePct ?? 0).toFixed(2)}%`).join(', ') + '.';
    }
  }
  if (!tickers.length) {
    tickers = COMMODITY_PLACEHOLDERS;
    const avgPct = tickers.reduce((s, t) => s + (t.changePct ?? 0), 0) / tickers.length;
    direction = pctDir(avgPct);
  }
  return segments.map(s =>
    s.name === 'Commodities'
      ? { ...s, direction, description: desc, tickers }
      : s
  );
}

function mergeCurrenciesIntoSegments(segments) {
  if (!segments?.length) return segments;
  return segments.map(s =>
    s.name === 'Currencies'
      ? { ...s, tickers: CURRENCY_PLACEHOLDERS }
      : s
  );
}

function mergeBondsRatesIntoSegments(segments) {
  if (!segments?.length) return segments;
  return segments.map(s =>
    s.name === 'Bonds & Rates'
      ? { ...s, tickers: BONDS_RATES_PLACEHOLDERS }
      : s
  );
}

function mergeGlobalMarketsRegions(segments, globalData) {
  if (!segments?.length) return segments;
  const useGlobal = globalData?.regions?.length && globalData.regions.some(r => !r.placeholder);
  return segments.map(s =>
    s.name === 'Global Markets'
      ? useGlobal
        ? { ...s, regions: globalData.regions, direction: globalData.direction, description: globalData.description }
        : { ...s, regions: GLOBAL_MARKETS_PLACEHOLDERS, description: 'Session tone and regional risk across major indices.' }
      : s
  );
}

function mergeEnergyIntoSegments(segments) {
  if (!segments?.length) return segments;
  return segments.map(s =>
    s.name === 'Energy & Materials'
      ? { ...s, tickers: ENERGY_PLACEHOLDERS }
      : s
  );
}

function mergeUsGrowthTechIntoSegments(segments) {
  if (!segments?.length) return segments;
  return segments.map(s =>
    s.name === 'U.S. Growth & Tech'
      ? { ...s, tickers: US_GROWTH_TECH_PLACEHOLDERS }
      : s
  );
}

function mergeSectorPerformanceIntoSegments(segments) {
  if (!segments?.length) return segments;
  return segments.map(s =>
    s.name === 'Sector Performance'
      ? { ...s, tickers: SECTOR_PERFORMANCE_PLACEHOLDERS }
      : s
  );
}

function mergeRealEstateIntoSegments(segments) {
  if (!segments?.length) return segments;
  return segments.map(s =>
    s.name === 'Real Estate'
      ? { ...s, tickers: REAL_ESTATE_PLACEHOLDERS }
      : s
  );
}

function mergeTopMoversIntoSegments(segments) {
  if (!segments?.length) return segments;
  return segments.map(s =>
    s.name === 'Top Movers'
      ? { ...s, tickers: TOP_MOVERS_PLACEHOLDERS }
      : s
  );
}

// Additional crypto names (name-only; live data can add prices later)
const DIGITAL_ASSETS_ADDITIONAL = [
  { symbol: 'DOGE', name: 'Dogecoin' },
  { symbol: 'SOL', name: 'Solana' },
  { symbol: 'XRP', name: 'XRP' },
  { symbol: 'ADA', name: 'Cardano' },
  { symbol: 'AVAX', name: 'Avalanche' },
];

function mergeCryptoIntoSegments(segments, crypto) {
  if (!segments?.length) return segments;
  let tickers = [];
  let direction = 'flat';
  let desc = 'Fear & Greed for sentiment.';
  if (crypto?.btc && crypto?.eth) {
    const avgPct = (crypto.btc.changePct + crypto.eth.changePct) / 2;
    direction = pctDir(avgPct);
    tickers = [
      { symbol: 'BTC/USD', name: 'Bitcoin', price: crypto.btc.price, changePct: crypto.btc.changePct },
      { symbol: 'ETH/USD', name: 'Ethereum', price: crypto.eth.price, changePct: crypto.eth.changePct },
    ];
    desc = `BTC ${crypto.btc.changePct >= 0 ? '+' : ''}${crypto.btc.changePct?.toFixed(2)}%, ETH ${crypto.eth.changePct >= 0 ? '+' : ''}${crypto.eth.changePct?.toFixed(2)}%. Fear & Greed for sentiment.`;
  }
  tickers = [...tickers, ...DIGITAL_ASSETS_ADDITIONAL];
  return segments.map(s =>
    s.name === 'Digital Assets'
      ? { ...s, direction, description: desc, tickers }
      : s
  );
}

function synthesizeFromNews(headlines, topHeadlines) {
  const h = headlines || [];
  const th = topHeadlines || [];
  const all = [...h, ...th.map(t => (typeof t === 'string' ? t : t.title))];

  const bigParts = [];
  if (all.length) {
    bigParts.push(all[0].replace(/\s*-\s*[^-]+$/, '').trim());
    if (all.length > 1) bigParts.push(all[1].replace(/\s*-\s*[^-]+$/, '').trim());
  }
  const bigPicture = bigParts.length
    ? `Today's focus: ${bigParts.join('. ')}. Markets reacting to headlines.`
    : null;

  const lower = all.join(' ').toLowerCase();
  const placeholderRegions = [
    { label: 'S&P 500', direction: 'flat', placeholder: true },
    { label: 'Europe', direction: 'flat', placeholder: true },
    { label: 'Asia', direction: 'flat', placeholder: true },
    { label: 'VIX', direction: 'steady', vixStyle: true, placeholder: true },
  ];
  const segments = [
    {
      name: 'Global Markets',
      direction: 'flat',
      description: lower.includes('market') || lower.includes('stock') || lower.includes('s&p') ? 'Headlines drive session.' : 'Markets digesting news.',
      regions: placeholderRegions,
    },
    {
      name: 'Currencies',
      direction: lower.includes('dollar') || lower.includes('currency') ? (lower.includes('hurt') || lower.includes('fall') ? 'down' : 'up') : 'flat',
      description: lower.includes('dollar') ? 'Dollar in focus per headlines.' : 'FX quiet.',
    },
    {
      name: 'Bonds & Rates',
      direction: 'flat',
      description: 'Government bonds and credit.',
    },
    {
      name: 'Digital Assets',
      direction: 'flat',
      description: 'Crypto sentiment from Fear & Greed. No live prices.',
    },
    {
      name: 'Commodities',
      direction: 'flat',
      description: 'Gold, silver, copper data temporarily unavailable.',
    },
    {
      name: 'Energy & Materials',
      direction: lower.includes('oil') || lower.includes('commodit') ? (lower.includes('retreat') || lower.includes('fall') ? 'down' : 'up') : 'flat',
      description: lower.includes('oil') || lower.includes('critical minerals') ? 'Energy and commodities in headlines.' : 'Materials mixed.',
    },
    {
      name: 'U.S. Growth & Tech',
      direction: lower.includes('tesla') || lower.includes('tech') ? (lower.includes('slash') || lower.includes('fall') ? 'down' : 'up') : 'flat',
      description: lower.includes('tesla') || lower.includes('tech') ? 'Tech names in focus.' : 'Growth stocks digesting news.',
    },
    {
      name: 'Sector Performance',
      direction: 'flat',
      description: 'S&P 500 sector ETFs.',
    },
    {
      name: 'Real Estate',
      direction: 'flat',
      description: 'REITs and property.',
    },
    {
      name: 'Top Movers',
      direction: 'flat',
      description: 'Biggest gainers and losers.',
    },
  ];

  return { bigPicture, segments };
}

async function main() {
  let briefing = { ...FALLBACK };

  const hasFmp = !!(process.env.FMP_API_KEY || process.env.FMPAPIKEY);
  const [fng, news, fmpGlobal, stooqGlobal] = await Promise.all([
    fetchFearGreed(),
    fetchNewsApi(),
    hasFmp ? fetchFmpGlobalMarkets() : null,
    fetchStooqGlobalMarkets(),
  ]);
  // FMP first (when key set), else Stooq, else Yahoo
  let globalMarkets = fmpGlobal;
  if (!globalMarkets?.regions?.length || globalMarkets.regions.every(r => r.placeholder)) {
    globalMarkets = stooqGlobal;
  }
  if (!globalMarkets?.regions?.length || globalMarkets.regions.every(r => r.placeholder)) {
    globalMarkets = await fetchYahooQuoteGlobalMarkets();
  }

  if (fng) {
    briefing.marketMood = fng.marketMood;
    briefing.fearGreed = fng.fearGreed;
  }

  if (news) {
    briefing.topHeadlines = news.topHeadlines;
  }

  const crypto = await fetchCoinGecko();
  const commodities = await fetchCommoditiesYahoo();
  const syn = news ? synthesizeFromNews([], briefing.topHeadlines) : null;

  // Big Picture: always news-driven (never Alpha Vantage or Yahoo)
  if (syn?.bigPicture) {
    briefing.bigPicture = syn.bigPicture;
  }

  // Segments: Alpha Vantage first (when key), else Yahoo Finance, else news-driven
  const av = process.env.ALPHA_VANTAGE_KEY || process.env.ALPHAVANTAGE_API_KEY
    ? await fetchAlphaVantage()
    : null;
  const yahoo = !av?.segments?.length ? await fetchYahooFinance() : null;

  if (av?.segments?.length) {
    briefing.segments = av.segments;
  } else if (yahoo?.segments?.length) {
    briefing.segments = yahoo.segments;
  } else if (syn?.segments?.length) {
    briefing.segments = syn.segments;
  }

  briefing.segments = mergeGlobalMarketsRegions(briefing.segments, globalMarkets);
  briefing.segments = mergeCurrenciesIntoSegments(briefing.segments);
  briefing.segments = mergeBondsRatesIntoSegments(briefing.segments);
  briefing.segments = mergeCryptoIntoSegments(briefing.segments, crypto);
  briefing.segments = mergeCommoditiesIntoSegments(briefing.segments, commodities);
  briefing.segments = mergeEnergyIntoSegments(briefing.segments);
  briefing.segments = mergeUsGrowthTechIntoSegments(briefing.segments);
  briefing.segments = mergeSectorPerformanceIntoSegments(briefing.segments);
  briefing.segments = mergeRealEstateIntoSegments(briefing.segments);
  briefing.segments = mergeTopMoversIntoSegments(briefing.segments);

  briefing.updatedAt = new Date().toISOString();
  const d = new Date();
  briefing.date = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(briefing, null, 2), 'utf8');
  console.log('Wrote', OUTPUT_FILE);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
