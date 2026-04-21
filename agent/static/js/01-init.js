console.log('Sentinel Dashboard v0.12 Loaded');
var charts = {};
var PCOLS = ['#00cc8f','#00b4ff','#e54949','#fbbf24','#a855f7','#f5a623','#ec4899'];
var pageLoadTime = Date.now();
let AUTH_TOKEN = new URLSearchParams(window.location.search).get('token') || localStorage.getItem('sentinel_token') || null;
if (new URLSearchParams(window.location.search).has('token') && AUTH_TOKEN) {
  localStorage.setItem('sentinel_token', AUTH_TOKEN);
  window.history.replaceState({}, document.title, window.location.pathname);
}
if (!AUTH_TOKEN) {
  document.addEventListener('DOMContentLoaded', function() {
    document.body.innerHTML = '<div style="display:flex;align-items:center;justify-content:center;height:100vh;background:#090c12;color:#e2e8f0;font-family:Inter,sans-serif"><div style="text-align:center;max-width:520px;padding:40px;background:#131929;border:1px solid #1e2d4a;border-radius:10px"><div style="font-size:2.2em;margin-bottom:16px">&#128274;</div><h2 style="color:#f8fafc;margin-bottom:10px">Authentication Required</h2><p style="color:#8899aa;margin-bottom:20px;line-height:1.6">No auth token found in URL or local storage.<br>Open the dashboard with your token:</p><code style="display:block;background:#090c12;padding:10px 16px;border-radius:6px;color:#00cc8f;font-size:.9em;margin-bottom:20px">http://&lt;host&gt;:30080/?token=&lt;your-token&gt;</code><p style="color:#8899aa;font-size:.82em">To disable authentication, set <code style="background:#090c12;padding:2px 6px;border-radius:4px;color:#fbbf24">AUTH_ENABLED=false</code> in the agent environment.</p></div></div>';
  });
}

// Helper to add auth header to all requests
async function fetchAuth(url, opts = {}) {
  opts.headers = opts.headers || {};
  opts.headers['Authorization'] = 'Bearer ' + AUTH_TOKEN;
  return fetch(url, opts);
}

// ─── State ────────────────────────────────────────────────────────────────────
var activeTab      = 'overview';
var activeNs       = '';           // '' = all namespaces
var logTarget      = null;         // { namespace, name }
var activeRange    = '30m';        // current chart range preset
var customFrom     = '';           // ISO string when range=custom
var customTo       = '';           // ISO string when range=custom
var overviewSort   = { col: 'cpuUsage', dir: 'desc' }; // sort state for Top Workloads overview
var lastMetrics    = [];           // cache last metrics for re-sort without fetch
var tileNs         = { pods: '', cpu: '', mem: '', finops: '', eff: '', workloads: '' }; // per-tile namespace filter
var lastSummary    = null;         // cache last summary for tile-only updates
var lastHistData   = null;         // cache last history data for finops drawer
var lastForecast   = null;         // cache last forecast data for finops drawer
var lastDbStatus   = null;         // persisted DB status from /health (used by 5s tick)

// ─── Utilities ────────────────────────────────────────────────────────────────
function debounce(func, wait) {
  var timeout;
  return function() {
    var context = this, args = arguments;
    clearTimeout(timeout);
    timeout = setTimeout(function() {
      func.apply(context, args);
    }, wait);
  };
}

function fmtMoney(val) {
  if (val === 0) return '0.0000';
  if (Math.abs(val) < 0.0001) return val.toFixed(6);
  return val.toFixed(4);
}

function esc(s) {
  var d = document.createElement('div');
  d.appendChild(document.createTextNode(String(s)));
  return d.innerHTML;
}

function apiUrl(path) {
  return activeNs ? path + '?namespace=' + encodeURIComponent(activeNs) : path;
}

// ─── Connected badge tooltip ──────────────────────────────────────────────────
function updateSpillTip(dbStatus) {
  // persist DB status so 5s tick (no arg) keeps showing the last known value
  if (dbStatus !== undefined) lastDbStatus = dbStatus;
  var tip = document.getElementById('spillTip');
  if (!tip) return;
  var upSec   = Math.floor((Date.now() - pageLoadTime) / 1000);
  var upStr   = upSec < 60 ? upSec + 's'
              : upSec < 3600 ? Math.floor(upSec/60) + 'm ' + (upSec%60) + 's'
              : Math.floor(upSec/3600) + 'h ' + Math.floor((upSec%3600)/60) + 'm';
  var cluster  = (document.querySelector('.ctag') || {}).textContent || 'minikube / local';
  var endpoint = window.location.host;
  var ver      = (document.getElementById('verBadge') || {}).textContent || '--';
  var lastSync = (document.getElementById('lastUp') || {}).textContent || '--';
  var st = lastDbStatus;
  var dbTxt    = st === 'ok' ? '<span style="color:var(--green)">&#10003; OK</span>'
               : st ? '<span style="color:var(--red)">&#x26a0; ' + esc(st) + '</span>'
               : '<span style="color:var(--text-dim)">--</span>';
  document.getElementById('sttCluster').textContent  = cluster;
  document.getElementById('sttEndpoint').textContent = endpoint;
  document.getElementById('sttVer').textContent      = ver;
  document.getElementById('sttSession').textContent  = upStr;
  document.getElementById('sttSync').textContent     = lastSync;
  document.getElementById('sttDb').innerHTML         = dbTxt;
}

