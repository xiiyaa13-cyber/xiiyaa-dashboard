#!/usr/bin/env node
/**
 * Reads data/briefing.json and templates,
 * builds index.html, creates dated archive, updates archive list
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const DATA_FILE = path.join(ROOT, 'data', 'briefing.json');
const INDEX_TEMPLATE = path.join(ROOT, 'templates', 'index.template.html');
const ARCHIVE_TEMPLATE = path.join(ROOT, 'templates', 'archive.template.html');

const DIR_MAP = { up: '↑ up', down: '↓ down', flat: '→ flat' };
const DIR_CLASS = { up: 'direction-up', down: 'direction-down', flat: 'direction-flat' };

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function renderHeadlines(items) {
  return items.map(h => `        <li>${escapeHtml(h)}</li>`).join('\n');
}

function renderTopHeadlines(items) {
  return items
    .map(h => `        <li><span class="source">${escapeHtml(h.source)}</span> — ${escapeHtml(h.title)}</li>`)
    .join('\n');
}

function formatPrice(n) {
  if (n == null || isNaN(n)) return '—';
  return n >= 1000 ? n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : String(n);
}

function regionDirectionText(r) {
  if (r.placeholder) return '—';
  const pct = r.changePct != null && !isNaN(r.changePct) ? (r.changePct >= 0 ? '+' : '') + r.changePct.toFixed(2) + '%' : null;
  if (pct) return pct;
  if (r.vixStyle) return r.direction;
  return r.direction === 'up' ? 'higher' : r.direction === 'down' ? 'lower' : 'flat';
}

function regionDirectionClass(r) {
  if (r.placeholder) return 'direction-flat';
  if (r.vixStyle) {
    if (r.direction === 'elevated') return 'direction-down';
    if (r.direction === 'subdued') return 'direction-up';
    return 'direction-flat';
  }
  return DIR_CLASS[r.direction] || 'direction-flat';
}

function renderRegions(regions) {
  if (!regions?.length) return '';
  return regions
    .map(
      r => `        <div class="region-row">
          <span class="region-label">${escapeHtml(r.label)}</span>
          <span class="region-direction ${regionDirectionClass(r)}">→ ${escapeHtml(regionDirectionText(r))}</span>
        </div>`
    )
    .join('\n');
}

function renderTickers(tickers) {
  if (!tickers?.length) return '';
  return tickers
    .map(
      t => {
        const hasPrice = t.price != null && !isNaN(t.price);
        if (!hasPrice) {
          return `        <div class="ticker ticker-name-only">
          <span class="ticker-symbol">${escapeHtml(t.symbol || '')}</span>
          <span class="ticker-name">${escapeHtml(t.name || '')}</span>
        </div>`;
        }
        const pct = t.changePct != null && !isNaN(t.changePct) ? (t.changePct >= 0 ? '+' : '') + t.changePct.toFixed(2) + '%' : '—';
        const dirClass = t.changePct > 0.3 ? 'direction-up' : t.changePct < -0.3 ? 'direction-down' : 'direction-flat';
        return `        <div class="ticker">
          <div class="ticker-symbol">${escapeHtml(t.symbol || '')}</div>
          <div class="ticker-name">${escapeHtml(t.name || '')}</div>
          <div class="ticker-price">${formatPrice(t.price)} USD</div>
          <span class="ticker-change ${dirClass}">${escapeHtml(pct)}</span>
        </div>`;
      }
    )
    .join('\n');
}

function renderSegments(segments) {
  return segments
    .map(
      s => {
        const tickersHtml = renderTickers(s.tickers);
        const regionsHtml = renderRegions(s.regions);
        return `      <article class="segment">
        <div class="segment-header">
          <h3>${escapeHtml(s.name)}</h3>
          <span class="direction ${DIR_CLASS[s.direction] || 'direction-flat'}">${DIR_MAP[s.direction] || '→ flat'}</span>
        </div>
        <p>${escapeHtml(s.description)}</p>${regionsHtml ? '\n        <div class="segment-regions">\n' + regionsHtml + '\n        </div>' : ''}${tickersHtml ? '\n        <div class="segment-tickers">\n' + tickersHtml + '\n        </div>' : ''}
      </article>`;
      }
    )
    .join('\n\n');
}

function dateToLabel(ymd) {
  const [y, m, d] = ymd.split('-').map(Number);
  return `${MONTHS[m - 1]} ${d}, ${y}`;
}

function dateToShort(ymd) {
  const [y, m, d] = ymd.split('-').map(Number);
  return `${MONTHS[m - 1].slice(0, 3)} ${d}, ${y}`;
}

function getArchiveList(includeDate = null) {
  const files = fs.readdirSync(ROOT);
  let dated = files
    .filter(f => /^\d{4}-\d{2}-\d{2}\.html$/.test(f))
    .map(f => f.replace('.html', ''))
    .sort()
    .reverse();
  if (includeDate && !dated.includes(includeDate)) {
    dated = [includeDate, ...dated];
  }
  return dated
    .map(ymd => `        <li><a href="${ymd}.html">${dateToLabel(ymd)}</a></li>`)
    .join('\n');
}

/** Derive 3–4 "Today's Market Drivers" from segments + fear/greed, or use data.marketDrivers if present. */
function getMarketDrivers(data) {
  if (Array.isArray(data.marketDrivers) && data.marketDrivers.length > 0) {
    return data.marketDrivers.slice(0, 5);
  }
  const segments = data.segments || [];
  const byName = (name) => segments.find(s => s.name === name);
  const fg = data.fearGreed?.value ?? 50;
  const fgLabel = data.fearGreed?.label ?? 'Neutral';
  const drivers = [];

  const dirShort = (d) => (d === 'up' ? '↑' : d === 'down' ? '↓' : '—');
  const one = (label, seg) => {
    if (!seg) return null;
    const d = seg.direction || 'flat';
    const desc = (seg.description || '').split(/[.;]/)[0].trim();
    const skipDesc = !desc || desc.length > 40 || /temporarily unavailable|add api|government bonds and credit/i.test(desc);
    if (!skipDesc) return `${label}: ${dirShort(d)} ${desc}`;
    if (d === 'flat') return `${label}: ${dirShort(d)}`;
    return `${label}: ${dirShort(d)} ${d === 'up' ? 'higher' : 'lower'}`;
  };

  const rates = one('Rates', byName('Bonds & Rates'));
  if (rates) drivers.push(rates);
  const tech = one('Tech', byName('U.S. Growth & Tech')) || one('Crypto', byName('Digital Assets'));
  if (tech) drivers.push(tech);
  const macro = one('Macro', byName('Global Markets'));
  if (macro) drivers.push(macro);
  const fx = one('FX', byName('Currencies'));
  if (fx && drivers.length < 3) drivers.push(fx);

  const volText = fg <= 25 ? 'Elevated, skew bearish' : fg >= 60 ? 'Subdued, risk-on' : 'Neutral';
  drivers.push(`Volatility: ${volText} (F&G ${fg} ${fgLabel})`);

  return drivers.slice(0, 4);
}

function renderMarketDrivers(drivers) {
  if (!drivers?.length) return '';
  return drivers
    .map(d => `        <li class="driver-item">${escapeHtml(d)}</li>`)
    .join('\n');
}

function buildPage(data, templatePath, replacements = {}) {
  let html = fs.readFileSync(templatePath, 'utf8');
  const fgClass = (data.fearGreed?.value ?? 50) < 50 ? 'fear' : 'greed';
  const base = {
    '{{BIG_PICTURE}}': escapeHtml(data.bigPicture),
    '{{MARKET_MOOD}}': escapeHtml(data.marketMood),
    '{{FEAR_GREED_VALUE}}': escapeHtml(String(data.fearGreed?.value ?? 50)),
    '{{FEAR_GREED_LABEL}}': escapeHtml(data.fearGreed?.label ?? 'Neutral'),
    '{{FEAR_GREED_CLASS}}': fgClass,
    '{{TOP_HEADLINES}}': renderTopHeadlines(data.topHeadlines || []),
    '{{SEGMENTS}}': renderSegments(data.segments || []),
  };
  for (const [k, v] of Object.entries({ ...base, ...replacements })) {
    html = html.replaceAll(k, v);
  }
  return html;
}

function main() {
  let data;
  try {
    data = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
  } catch (e) {
    console.error('Missing or invalid data/briefing.json. Run: npm run fetch');
    process.exit(1);
  }

  const today = data.date || new Date().toISOString().slice(0, 10);
  const dateShort = dateToShort(today);

  let indexHtml = fs.readFileSync(INDEX_TEMPLATE, 'utf8');
  const archiveList = getArchiveList();

  const mood = String(data.marketMood || 'Neutral').toLowerCase().replace(/\s/g, '-');
  const moodArrow = data.marketMood === 'Risk-on' ? '\u2191' : data.marketMood === 'Risk-off' ? '\u2193' : '\u2192';
  const moodClass = mood === 'risk-on' ? 'risk-on' : mood === 'risk-off' ? 'risk-off' : 'neutral';

  const fgValue = escapeHtml(String(data.fearGreed?.value ?? 50));
  const fgLabel = escapeHtml(data.fearGreed?.label ?? 'Neutral');
  const fgClass = (data.fearGreed?.value ?? 50) < 50 ? 'fear' : 'greed';

  const marketDrivers = getMarketDrivers(data);
  const marketDriversHtml = marketDrivers.length
    ? `    <section class="market-drivers" aria-label="Today's market drivers">
      <h2 class="market-drivers-title">Today's Market Drivers</h2>
      <ul class="driver-list">
${renderMarketDrivers(marketDrivers)}
      </ul>
    </section>
`
    : '';

  indexHtml = indexHtml
    .replace('{{BIG_PICTURE}}', escapeHtml(data.bigPicture))
    .replace('{{MARKET_MOOD}}', escapeHtml(data.marketMood))
    .replaceAll('{{MARKET_MOOD_ARROW}}', moodArrow)
    .replaceAll('{{MARKET_MOOD_CLASS}}', moodClass)
    .replaceAll('{{FEAR_GREED_VALUE}}', fgValue)
    .replaceAll('{{FEAR_GREED_LABEL}}', fgLabel)
    .replaceAll('{{FEAR_GREED_CLASS}}', fgClass)
    .replace('{{MARKET_DRIVERS_SECTION}}', marketDriversHtml)
    .replace('{{TOP_HEADLINES}}', renderTopHeadlines(data.topHeadlines || []))
    .replace('{{SEGMENTS}}', renderSegments(data.segments || []))
    .replace('{{ARCHIVE_LIST}}', archiveList)
    .replaceAll('{{DATE_SHORT}}', dateShort)
    .replaceAll('{{UPDATED_AT}}', escapeHtml(data.updatedAt || new Date().toISOString()));

  fs.writeFileSync(path.join(ROOT, 'index.html'), indexHtml, 'utf8');
  console.log('Built index.html');

  // Optional: build a dated archive page (e.g. node build/build.js 2026-02-05)
  const archiveDate = process.argv[2];
  if (archiveDate && /^\d{4}-\d{2}-\d{2}$/.test(archiveDate)) {
    const archShort = dateToShort(archiveDate);
    const archLabel = dateToLabel(archiveDate);
    let archHtml = fs.readFileSync(ARCHIVE_TEMPLATE, 'utf8');
    archHtml = archHtml
      .replace('{{BIG_PICTURE}}', escapeHtml(data.bigPicture))
      .replace('{{MARKET_MOOD}}', escapeHtml(data.marketMood))
      .replaceAll('{{MARKET_MOOD_ARROW}}', moodArrow)
      .replaceAll('{{MARKET_MOOD_CLASS}}', moodClass)
      .replaceAll('{{FEAR_GREED_VALUE}}', fgValue)
      .replaceAll('{{FEAR_GREED_LABEL}}', fgLabel)
      .replaceAll('{{FEAR_GREED_CLASS}}', fgClass)
      .replace('{{MARKET_DRIVERS_SECTION}}', marketDriversHtml)
      .replace('{{TOP_HEADLINES}}', renderTopHeadlines(data.topHeadlines || []))
      .replace('{{SEGMENTS}}', renderSegments(data.segments || []))
      .replace('{{ARCHIVE_LIST}}', getArchiveList(archiveDate))
      .replaceAll('{{DATE_SHORT}}', archShort)
      .replaceAll('{{DATE_LABEL}}', archLabel);
    fs.writeFileSync(path.join(ROOT, `${archiveDate}.html`), archHtml, 'utf8');
    console.log('Built', `${archiveDate}.html`);
    // Refresh index so archive list includes the new file
    indexHtml = fs.readFileSync(INDEX_TEMPLATE, 'utf8');
    indexHtml = indexHtml
      .replace('{{BIG_PICTURE}}', escapeHtml(data.bigPicture))
      .replace('{{MARKET_MOOD}}', escapeHtml(data.marketMood))
      .replaceAll('{{MARKET_MOOD_ARROW}}', moodArrow)
      .replaceAll('{{MARKET_MOOD_CLASS}}', moodClass)
      .replaceAll('{{FEAR_GREED_VALUE}}', fgValue)
      .replaceAll('{{FEAR_GREED_LABEL}}', fgLabel)
      .replaceAll('{{FEAR_GREED_CLASS}}', fgClass)
      .replace('{{MARKET_DRIVERS_SECTION}}', marketDriversHtml)
      .replace('{{TOP_HEADLINES}}', renderTopHeadlines(data.topHeadlines || []))
      .replace('{{SEGMENTS}}', renderSegments(data.segments || []))
      .replace('{{ARCHIVE_LIST}}', getArchiveList())
      .replaceAll('{{DATE_SHORT}}', dateShort)
      .replaceAll('{{UPDATED_AT}}', escapeHtml(data.updatedAt || new Date().toISOString()));
    fs.writeFileSync(path.join(ROOT, 'index.html'), indexHtml, 'utf8');
    console.log('Updated index.html archive list');
  }
}

main();
