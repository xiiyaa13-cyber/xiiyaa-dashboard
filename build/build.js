#!/usr/bin/env node
/**
 * Reads data/briefing.json and templates/index.template.html,
 * injects data, writes index.html
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const DATA_FILE = path.join(ROOT, 'data', 'briefing.json');
const TEMPLATE = path.join(ROOT, 'templates', 'index.template.html');
const OUTPUT = path.join(ROOT, 'index.html');

const DIR_MAP = { up: '↑ up', down: '↓ down', flat: '→ flat' };
const DIR_CLASS = { up: 'direction-up', down: 'direction-down', flat: 'direction-flat' };

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

function renderSegments(segments) {
  return segments
    .map(
      s => `      <article class="segment">
        <div class="segment-header">
          <h3>${escapeHtml(s.name)}</h3>
          <span class="direction ${DIR_CLASS[s.direction] || 'direction-flat'}">${DIR_MAP[s.direction] || '→ flat'}</span>
        </div>
        <p>${escapeHtml(s.description)}</p>
      </article>`
    )
    .join('\n\n');
}

function main() {
  let data;
  try {
    data = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
  } catch (e) {
    console.error('Missing or invalid data/briefing.json. Run: npm run fetch');
    process.exit(1);
  }

  let html = fs.readFileSync(TEMPLATE, 'utf8');

  html = html
    .replace('{{BIG_PICTURE}}', escapeHtml(data.bigPicture))
    .replace('{{MARKET_MOOD}}', escapeHtml(data.marketMood))
    .replace('{{FEAR_GREED_VALUE}}', escapeHtml(String(data.fearGreed?.value ?? 50)))
    .replace('{{FEAR_GREED_LABEL}}', escapeHtml(data.fearGreed?.label ?? 'Neutral'))
    .replace('{{TRENDING_NEWS}}', renderHeadlines(data.trendingNews || []))
    .replace('{{TOP_HEADLINES}}', renderTopHeadlines(data.topHeadlines || []))
    .replace('{{SEGMENTS}}', renderSegments(data.segments || []));

  fs.writeFileSync(OUTPUT, html, 'utf8');
  console.log('Built', OUTPUT);
}

main();
