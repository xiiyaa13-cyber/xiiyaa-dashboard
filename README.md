# xiiyaa.net

Market intelligence, distilled. A clean, dark-mode daily market briefing.

## Development

```bash
npm install
npm run fetch   # Fetches data → data/briefing.json
npm run build   # Builds index.html from template
npm run update  # fetch + build
```

## Daily auto-update (GitHub Actions)

The workflow runs every 6 hours (00:00, 06:00, 12:00, 18:00 UTC) and fetches fresh data, then commits and pushes changes.

### Setup

1. Push this repo to GitHub.
2. Add secrets: **Settings → Secrets and variables → Actions**
   - `NEWS_API_KEY` (optional): [newsapi.org](https://newsapi.org) key for live headlines
   - `ALPHA_VANTAGE_KEY` (optional): [alphavantage.co](https://www.alphavantage.co) for market segments (Global Markets, Currencies, Energy, Tech)
   - `FMP_API_KEY` (optional): [FMP](https://site.financialmodelingprep.com/register) for Global Markets indices; fallback to Stooq/Yahoo
3. Without keys, the pipeline uses fallback data, Fear & Greed, CoinGecko, and Yahoo Finance (fallback for segments).

### Manual run

Go to **Actions → Briefing update → Run workflow**.

## Data sources

| Source | Key required | Notes |
|--------|--------------|-------|
| Fear & Greed | No | Alternative.me (crypto index) |
| CoinGecko | No | BTC and ETH prices for Digital Assets segment |
| FMP | Yes | Global Markets indices (^GSPC, ^DJI, etc.); free tier; best coverage |
| Stooq | No | Global Markets fallback; free, no key; partial coverage |
| Yahoo Finance | No | Global Markets final fallback; segments; commodities; may rate-limit |
| Alpha Vantage | Yes | Market segments; free tier: 5 req/min |
| NewsAPI | Yes | Headlines; free tier: 100 req/day |

## Local env

Copy `.env.example` to `.env` and add keys for local testing.

## Archiving

Each run builds `index.html` with the latest briefing. Archives are created manually—add dated files (e.g. `2026-02-04.html`) when you want to snapshot a day. The archive list on the home page shows links to all existing `YYYY-MM-DD.html` files.

## Deploy

Upload the built files to Dreamhost (or pull from GitHub after the daily run). The build outputs `index.html` and `data/`; archives are created manually.
