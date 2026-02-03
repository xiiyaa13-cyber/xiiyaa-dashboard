#!/usr/bin/env node
/**
 * Fetches market data from APIs and outputs data/briefing.json
 * Add API keys via env vars or .env for NEWS_API_KEY, etc.
 */

require('dotenv').config();
const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', 'data');
const OUTPUT_FILE = path.join(DATA_DIR, 'briefing.json');

// Fallback data when APIs fail or keys are missing
const FALLBACK = {
  bigPicture: "Markets are consolidating. Add NEWS_API_KEY and other keys to enable live data. See README for setup.",
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
    { name: "Global Markets", direction: "flat", description: "Add API keys for live data." },
    { name: "Currencies", direction: "flat", description: "Add API keys for live data." },
    { name: "Digital Assets", direction: "flat", description: "Add API keys for live data." },
    { name: "Energy & Materials", direction: "flat", description: "Add API keys for live data." },
    { name: "U.S. Growth & Tech", direction: "flat", description: "Add API keys for live data." },
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

async function fetchFearGreed() {
  // Alternative.me Fear & Greed Index (crypto) - free, no key
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
    const headlines = data.articles
      .filter(a => a.title)
      .slice(0, 8)
      .map(a => a.title.replace(/^[^:]+:\s*/, '')); // strip "Source: "
    const topHeadlines = data.articles
      .filter(a => a.title && a.source?.name)
      .slice(0, 6)
      .map(a => ({ source: a.source.name, title: a.title }));
    return { trendingNews: headlines, topHeadlines };
  }
  return null;
}

async function main() {
  let briefing = { ...FALLBACK };

  // Fetch Fear & Greed (no key needed)
  const fng = await fetchFearGreed();
  if (fng) {
    briefing.marketMood = fng.marketMood;
    briefing.fearGreed = fng.fearGreed;
  }

  // Fetch News (needs NEWS_API_KEY)
  const news = await fetchNewsApi();
  if (news) {
    briefing.trendingNews = news.trendingNews;
    briefing.topHeadlines = news.topHeadlines;
    briefing.bigPicture = "Live data from NewsAPI. Add Alpha Vantage or similar for market summaries.";
  }

  briefing.updatedAt = new Date().toISOString();

  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(briefing, null, 2), 'utf8');
  console.log('Wrote', OUTPUT_FILE);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
