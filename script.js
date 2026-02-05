/**
 * xiiyaa.net — Local time display
 * Uses browser's local timezone from system settings.
 */
function initTime() {
  var timeEl = document.getElementById('local-time');
  if (!timeEl) return;

  function getTimeString() {
    var now = new Date();
    var dateStr = now.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' });
    var timeStr = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    return dateStr + ' \u00B7 ' + timeStr;
  }

  function updateTime() {
    var s = getTimeString();
    var now = new Date();
    timeEl.textContent = s;
    timeEl.setAttribute('datetime', now.toISOString());
  }

  updateTime();
  setInterval(updateTime, 1000);
}

/**
 * Theme toggle — Light / Dark mode
 * Firefox-compatible: runs on DOMContentLoaded, uses onclick for reliability
 */
function initTheme() {
  var toggle = document.getElementById('theme-toggle');
  var html = document.documentElement;
  var STORAGE_KEY = 'xiiyaa-theme';

  function getTheme() {
    try {
      var t = localStorage.getItem(STORAGE_KEY) || 'dark';
      return t === 'gray' ? 'dark' : t;
    } catch (e) {
      return html.getAttribute('data-theme') || 'dark';
    }
  }

  var NEXT = { dark: 'Light', light: 'Dark' };

  function setTheme(theme) {
    if (theme === 'gray') theme = 'dark';
    html.setAttribute('data-theme', theme);
    try {
      localStorage.setItem(STORAGE_KEY, theme);
    } catch (e) { /* ETP may block storage */ }
    if (toggle) toggle.textContent = NEXT[theme] || 'Light';
  }

  function handleToggle() {
    var next = getTheme() === 'dark' ? 'light' : 'dark';
    setTheme(next);
    return false;
  }

  if (toggle) {
    setTheme(getTheme());
    toggle.onclick = handleToggle;
  }
}

/**
 * Update countdown — "updates in Xh Xm Xs"
 * GitHub Actions runs at 00:00, 06:00, 12:00, 18:00 UTC every 6 hours.
 */
function initUpdateCountdown() {
  var card = document.querySelector('.mood-card[data-updated-at]');
  var el = document.getElementById('update-countdown');
  if (!card || !el) return;

  function getNextUpdateMs() {
    var now = new Date();
    var utcHour = now.getUTCHours() + now.getUTCMinutes() / 60 + now.getUTCSeconds() / 3600;
    var hoursToNext = 6 - (utcHour % 6);
    if (hoursToNext < 0.001) hoursToNext = 6;
    return Math.floor(hoursToNext * 3600 * 1000);
  }

  function formatCountdown(ms) {
    if (ms <= 0) return 'updates soon';
    var s = Math.floor(ms / 1000) % 60;
    var m = Math.floor(ms / 60000) % 60;
    var h = Math.floor(ms / 3600000);
    var parts = [];
    if (h > 0) parts.push(h + 'h');
    parts.push(m + 'm');
    parts.push(s + 's');
    return 'updates in ' + parts.join(' ');
  }

  function tick() {
    var ms = getNextUpdateMs();
    el.textContent = formatCountdown(ms);
  }

  tick();
  setInterval(tick, 1000);
}

function onReady() {
  initTime();
  initTheme();
  initUpdateCountdown();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', onReady);
} else {
  onReady();
}
