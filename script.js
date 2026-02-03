/**
 * xiiyaa.net — Local time display
 * Uses browser's local timezone from system settings.
 * Runs on DOMContentLoaded so both header and at-a-glance elements exist.
 */
function initTime() {
  var timeEl = document.getElementById('local-time');
  var glanceTimeEl = document.getElementById('at-a-glance-time');

  function getTimeString() {
    var now = new Date();
    var dateStr = now.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' });
    var timeStr = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    return dateStr + ' \u00B7 ' + timeStr;
  }

  function updateTime() {
    var s = getTimeString();
    var now = new Date();
    if (timeEl) {
      timeEl.textContent = s;
      timeEl.setAttribute('datetime', now.toISOString());
    }
    if (glanceTimeEl) {
      glanceTimeEl.textContent = s;
      glanceTimeEl.setAttribute('datetime', now.toISOString());
    }
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
      return localStorage.getItem(STORAGE_KEY) || 'dark';
    } catch (e) {
      return html.getAttribute('data-theme') || 'dark';
    }
  }

  function setTheme(theme) {
    html.setAttribute('data-theme', theme);
    try {
      localStorage.setItem(STORAGE_KEY, theme);
    } catch (e) { /* ETP may block storage */ }
    if (toggle) toggle.textContent = theme === 'dark' ? 'Light' : 'Dark';
  }

  function handleToggle() {
    setTheme(getTheme() === 'dark' ? 'light' : 'dark');
    return false;
  }

  if (toggle) {
    setTheme(getTheme());
    toggle.onclick = handleToggle;
  }
}

function onReady() {
  initTime();
  initTheme();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', onReady);
} else {
  onReady();
}
