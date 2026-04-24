// ─── Drawer event bindings ────────────────────────────────────────────────────
document.getElementById('drawer-close').addEventListener('click', closeDrawer);
document.getElementById('drawer-overlay').addEventListener('click', closeDrawer);
document.addEventListener('keydown', function(e) {
  if (e.key === 'Escape' && drawerOpen) closeDrawer();
});
// KPI cards → open corresponding drawers
document.getElementById('kNodesCard').addEventListener('click', openNodeDrawer);
document.getElementById('kPodsCard').addEventListener('click', openPodDrawer);
document.getElementById('kFailCard').addEventListener('click', openAlertsDrawer);
document.getElementById('kCpuCard').addEventListener('click', openCpuDrawer);
document.getElementById('kMemCard').addEventListener('click', openMemDrawer);
document.getElementById('kWasteCard').addEventListener('click', openWasteDrawer);
// Header alert badge
document.getElementById('hdrAlertBadge').addEventListener('click', openAlertsDrawer);
// ─── Panel header clicks — only expand button opens drawer ────────────────────
function _bindExpand(phId, fn) {
  var ph = document.getElementById(phId);
  if (!ph) return;
  var btn = ph.querySelector('.ph-expand');
  if (btn) btn.addEventListener('click', fn);
}
_bindExpand('ph-nodes', openNodeDrawer);
_bindExpand('ph-pods', openPodDrawer);
_bindExpand('ph-alerts', openAlertsDrawer);
_bindExpand('ph-cpu', openCpuDrawer);
_bindExpand('ph-mem', openMemDrawer);
_bindExpand('ph-waste', openWasteDrawer);
_bindExpand('ph-events', openEventsDrawer);
_bindExpand('ph-finops', openFinOpsDrawer);
// ─── Efficiency panel interactive elements ────────────────────────────────────
var _effExpand = document.getElementById('eff-expand-btn');
if (_effExpand) _effExpand.addEventListener('click', function(e) { e.stopPropagation(); openEfficiencyDrawer(''); });

var _gradeInfoBtn = document.getElementById('grade-info-btn');
if (_gradeInfoBtn) _gradeInfoBtn.addEventListener('click', function(e) { e.stopPropagation(); toggleGradeLegend(); });

var _effSysLabel = document.getElementById('eff-sys-label');
if (_effSysLabel) _effSysLabel.addEventListener('click', function(e) { e.stopPropagation(); });

var _effSysToggle = document.getElementById('eff-show-system');
if (_effSysToggle) _effSysToggle.addEventListener('change', function() {
  renderDropdowns();
  updateEfficiency();
});

var _finopsHelpBtn = document.getElementById('finopsHelp');
if (_finopsHelpBtn) _finopsHelpBtn.addEventListener('click', function(e) { e.stopPropagation(); toggleFinOpsLegend(); });

// ─── Per-tile namespace selects ───────────────────────────────────────────────
['tile-ns-finops','tile-ns-eff','tile-ns-workloads','tile-ns-events'].forEach(function(id) {
  var el = document.getElementById(id);
  if (!el) return;
  el.addEventListener('click', function(e) { e.stopPropagation(); });
  el.addEventListener('change', function(e) {
    e.stopPropagation();
    if (id === 'tile-ns-finops') { tileNs.finops = this.value; fetchChart(); updateEfficiency(); }
    else if (id === 'tile-ns-eff') { tileNs.eff = this.value; updateEfficiency(); }
    else if (id === 'tile-ns-workloads') { tileNs.workloads = this.value; updateWorkloads(); }
    else if (id === 'tile-ns-events') { renderOverviewEvents(); }
  });
});

// ─── Chart area click → same drawer ──────────────────────────────────────────
document.getElementById('honeycomb').addEventListener('click', function(e) {
  var hex = e.target.closest('.hex');
  if (hex && hex.dataset.node) {
    openNodeDrawer(hex.dataset.node);
  } else {
    openNodeDrawer();
  }
});
document.getElementById('phaseDonutWrap').addEventListener('click', openPodDrawer);
document.getElementById('alertsBox').addEventListener('click', openAlertsDrawer);
document.getElementById('cpuDonutWrap').addEventListener('click', openCpuDrawer);
document.getElementById('memDonutWrap').addEventListener('click', openMemDrawer);
document.getElementById('finops-chart-area').addEventListener('click', openFinOpsDrawer);

var _finoTab = 'fino';
function switchFinoTab(tab) {
  _finoTab = tab;
  var finoContent = document.getElementById('fino-content');
  var effContent = document.getElementById('eff-content');
  var finoBtn = document.getElementById('fino-tab-btn');
  var effBtn = document.getElementById('eff-tab-btn');
  if (finoContent) finoContent.style.display = tab === 'fino' ? '' : 'none';
  if (effContent) effContent.style.display = tab === 'eff' ? '' : 'none';
  if (finoBtn) finoBtn.className = 'fino-eff-tab' + (tab === 'fino' ? ' active' : '');
  if (effBtn) effBtn.className = 'fino-eff-tab' + (tab === 'eff' ? ' active' : '');
  var nsSel = document.getElementById('tile-ns-finops');
  if (nsSel) nsSel.style.display = tab === 'fino' ? '' : 'none';
}

document.getElementById('fino-tab-btn').addEventListener('click', function(e) { e.stopPropagation(); switchFinoTab('fino'); });
document.getElementById('eff-tab-btn').addEventListener('click', function(e) { e.stopPropagation(); switchFinoTab('eff'); });

// wasteList: delegate to waste drawer (clicks on items or empty area)
document.getElementById('wasteList').addEventListener('click', function(e) {
  // if clicked on a waste-item, open drawer pre-filtered to that pod
  var item = e.target.closest('.waste-item-clickable');
  if (item) {
    openWasteDrawer();
    return;
  }
  openWasteDrawer();
});

// ─── Version badge (dynamic) ──────────────────────────────────────────────────
function setVersionBadge(version) {
  if (!version) return;
  var badge = document.getElementById('ribbonVer');
  if (!badge) return;
  badge.textContent = 'sentinel-agent v' + version;
  badge.title = 'Sentinel v' + version + '\nKubernetes SRE/FinOps\n\u00a9 2026 Sentinel Project';
}

var ONBOARDING_DONE_KEY = 'sentinel_first_run_onboarding_done_v1';

function isOnboardingDone() {
  try {
    return localStorage.getItem(ONBOARDING_DONE_KEY) === '1';
  } catch (e) {
    return false;
  }
}

function setOnboardingDone(done) {
  try {
    if (done) localStorage.setItem(ONBOARDING_DONE_KEY, '1');
    else localStorage.removeItem(ONBOARDING_DONE_KEY);
  } catch (e) {
    // Ignore storage failures.
  }
}

function setOnboardingVisible(visible) {
  var shell = document.getElementById('firstRunOnboarding');
  if (!shell) return;
  shell.style.display = visible ? 'block' : 'none';
}

function updateOnboardingHealth(data) {
  var summaryEl = document.getElementById('onboardingHealthSummary');
  var checksEl = document.getElementById('onboardingHealthChecks');
  if (!summaryEl || !checksEl) return;

  if (!data || !data.checks) {
    summaryEl.textContent = 'Health check unavailable right now. Open /health and confirm the API is responding before continuing.';
    checksEl.innerHTML = '';
    return;
  }

  var checks = data.checks;
  var keys = Object.keys(checks);
  var hasWarn = keys.some(function(key) {
    return checks[key] && checks[key].status && checks[key].status !== 'ok';
  });
  summaryEl.textContent = hasWarn
    ? 'Sentinel is reachable, but one or more checks are degraded. Inspect /health details and /status before trusting recommendations.'
    : 'All core checks are OK. Sentinel is ready for regular incident and FinOps analysis.';

  checksEl.innerHTML = keys.map(function(key) {
    var check = checks[key] || {};
    var st = String(check.status || 'unknown').toLowerCase();
    var cls = st === 'ok' ? 'ok' : 'warn';
    return '<span class="onboarding-health-pill ' + cls + '">' + esc(key) + ': ' + esc(st) + '</span>';
  }).join('');
}

function initFirstRunOnboarding() {
  var reopenBtn = document.getElementById('onboardingReopenBtn');
  var completeBtn = document.getElementById('onboardingCompleteBtn');
  var dismissBtn = document.getElementById('onboardingDismissBtn');

  if (reopenBtn) {
    reopenBtn.addEventListener('click', function() {
      setOnboardingVisible(true);
    });
  }
  if (dismissBtn) {
    dismissBtn.addEventListener('click', function() {
      setOnboardingVisible(false);
    });
  }
  if (completeBtn) {
    completeBtn.addEventListener('click', function() {
      setOnboardingDone(true);
      setOnboardingVisible(false);
    });
  }

  setOnboardingVisible(!isOnboardingDone());
}

function updateMetricsDegradedBanner(data) {
  var banner = document.getElementById('degradedBanner');
  var msgEl = document.getElementById('degradedBannerMsg');
  if (!banner || !msgEl) return;

  var metricsCheck = data && data.checks ? data.checks.metrics_api : null;
  var isMetricsDegraded = metricsCheck && metricsCheck.status && metricsCheck.status !== 'ok';
  if (!isMetricsDegraded) {
    banner.style.display = 'none';
    return;
  }

  var detail = metricsCheck.message ? String(metricsCheck.message) : 'metrics api unavailable';
  msgEl.textContent = 'Sentinel is online, but metrics-backed views (incidents, FinOps and efficiency) can be partial or empty until metrics.k8s.io recovers. Detail: ' + detail + '.';
  banner.style.display = 'block';
}

async function refreshHealthSignals() {
  try {
    var data = await (await fetchAuth('/health')).json();
    setVersionBadge(data && data.version ? data.version : null);
    var dbSt = (data.checks && data.checks.database) ? data.checks.database.status : 'unknown';
    updateSpillTip(dbSt);
    updateMetricsDegradedBanner(data);
    updateOnboardingHealth(data);
  } catch(e) {
    updateSpillTip('unknown');
    updateMetricsDegradedBanner(null);
    updateOnboardingHealth(null);
  }
}

initFirstRunOnboarding();
loadNamespaces();
refreshHealthSignals();
setInterval(refreshHealthSignals, 5000);
setInterval(update, 5000);

update();
fetchChart();
updateEfficiency();
