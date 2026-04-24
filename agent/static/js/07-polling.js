// ─── Drawer event bindings ────────────────────────────────────────────────────
document.getElementById('drawer-close').addEventListener('click', closeDrawer);
document.getElementById('drawer-overlay').addEventListener('click', closeDrawer);
document.addEventListener('keydown', function(e) {
  if (e.key === 'Escape' && isOnboardingTourActive()) {
    stopOnboardingTour();
    return;
  }
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
var ONBOARDING_TOUR_STEPS = [
  {
    selector: '#nsFilter',
    title: 'Namespace Scope',
    body: 'Start by choosing the namespace scope. Keep "All Namespaces" for global triage, then narrow to isolate a specific incident.',
    scrollBlock: 'start'
  },
  {
    selector: '#hdrStatusControls',
    title: 'Header Status Controls',
    body: 'Use header controls for quick orientation: Connected status (cluster/session health), Active Alerts badge (shortcut to incidents), and First-run guide (reopen this tour).',
    autoScroll: false
  },
  {
    selector: '#kFailCard',
    title: 'Critical/Warn Signal',
    body: 'This card is your first severity signal. Click it to open the Alerts drawer and inspect incidents that are impacting service health.'
  },
  {
    selector: '#kWasteCard',
    title: 'FinOps Waste View',
    body: 'Use this tile to focus cost hotspots. It summarizes waste opportunities and opens detailed savings candidates.'
  },
  {
    selector: '#hdrAlertBadge',
    title: 'Live Alert Badge',
    body: 'The header badge tracks current critical count. Click it any time to jump directly to active alerts.',
    autoScroll: false
  },
  {
    selector: '#ph-events',
    title: 'Recent Incidents',
    body: 'This panel shows the latest incident stream with severity, type, namespace and age. Use it for fast triage before drilling into drawers.'
  },
  {
    selector: '#ph-finops',
    title: 'Financial Correlation',
    body: 'This tile correlates budget, actual usage and waste over time. Use namespace filter and period buttons (30m, 1h, 6h, 24h, 7d...) to analyze cost behavior.'
  },
  {
    selector: '#fino-tab-btn',
    title: 'FinOps View',
    body: 'FinOps tab focuses on spend trends and waste forecast, including confidence bands and optimization opportunity.'
  },
  {
    selector: '#eff-tab-btn',
    title: 'Efficiency View',
    body: 'Efficiency tab shows namespace grades (A-F) based on requested vs actual usage, helping prioritize right-sizing.'
  },
  {
    selector: '#onboardingLinks',
    title: 'Support and Runbooks',
    body: 'Use support matrix, release process and runbook links when you need operating boundaries, release checks or remediation guidance.'
  }
];
var onboardingTourState = {
  active: false,
  step: 0,
  targetEl: null
};

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

function isOnboardingTourActive() {
  return !!onboardingTourState.active;
}

function scheduleOnboardingTourReflow() {
  [0, 80, 180, 320].forEach(function(ms) {
    setTimeout(updateOnboardingTourPosition, ms);
  });
}

function updateOnboardingTourPosition() {
  if (!onboardingTourState.active || !onboardingTourState.targetEl) return;

  var overlay = document.getElementById('onboardingTourOverlay');
  var spotlight = document.getElementById('onboardingTourSpotlight');
  var popover = document.getElementById('onboardingTourPopover');
  if (!overlay || !spotlight || !popover) return;

  var rect = onboardingTourState.targetEl.getBoundingClientRect();
  var pad = 8;
  var left = Math.max(6, rect.left - pad);
  var top = Math.max(6, rect.top - pad);
  var width = Math.max(24, rect.width + (pad * 2));
  var height = Math.max(24, rect.height + (pad * 2));
  spotlight.style.left = left + 'px';
  spotlight.style.top = top + 'px';
  spotlight.style.width = width + 'px';
  spotlight.style.height = height + 'px';

  var popRect = popover.getBoundingClientRect();
  var viewportW = window.innerWidth || document.documentElement.clientWidth || 1280;
  var viewportH = window.innerHeight || document.documentElement.clientHeight || 720;
  var popLeft = left;
  if (popLeft + popRect.width + 8 > viewportW) popLeft = viewportW - popRect.width - 8;
  if (popLeft < 8) popLeft = 8;
  var popTop = top + height + 10;
  if (popTop + popRect.height + 8 > viewportH) popTop = Math.max(8, top - popRect.height - 10);
  popover.style.left = popLeft + 'px';
  popover.style.top = popTop + 'px';
}

function renderOnboardingTourStep() {
  var idx = onboardingTourState.step;
  if (idx < 0 || idx >= ONBOARDING_TOUR_STEPS.length) return;

  var step = ONBOARDING_TOUR_STEPS[idx];
  if (drawerOpen) closeDrawer();
  var target = document.querySelector(step.selector);
  if (!target) {
    if (idx < ONBOARDING_TOUR_STEPS.length - 1) {
      onboardingTourState.step = idx + 1;
      renderOnboardingTourStep();
    } else {
      stopOnboardingTour();
    }
    return;
  }

  onboardingTourState.targetEl = target;
  if (step.autoScroll !== false && typeof target.scrollIntoView === 'function') {
    target.scrollIntoView({ behavior: 'auto', block: step.scrollBlock || 'center', inline: 'nearest' });
  }

  var titleEl = document.getElementById('onboardingTourTitle');
  var bodyEl = document.getElementById('onboardingTourBody');
  var progressEl = document.getElementById('onboardingTourProgress');
  var prevBtn = document.getElementById('onboardingTourPrevBtn');
  var nextBtn = document.getElementById('onboardingTourNextBtn');
  if (titleEl) titleEl.textContent = step.title;
  if (bodyEl) bodyEl.textContent = step.body;
  if (progressEl) progressEl.textContent = 'Step ' + (idx + 1) + ' of ' + ONBOARDING_TOUR_STEPS.length;
  if (prevBtn) prevBtn.disabled = idx === 0;
  if (nextBtn) nextBtn.textContent = idx === ONBOARDING_TOUR_STEPS.length - 1 ? 'Finish' : 'Next';

  scheduleOnboardingTourReflow();
}

function startOnboardingTour() {
  var overlay = document.getElementById('onboardingTourOverlay');
  if (!overlay) return;
  onboardingTourState.active = true;
  onboardingTourState.step = 0;
  onboardingTourState.targetEl = null;
  overlay.style.display = 'block';
  renderOnboardingTourStep();
}

function stopOnboardingTour(markDone) {
  var overlay = document.getElementById('onboardingTourOverlay');
  if (overlay) overlay.style.display = 'none';
  onboardingTourState.active = false;
  onboardingTourState.step = 0;
  onboardingTourState.targetEl = null;
  if (markDone) {
    setOnboardingDone(true);
    setOnboardingVisible(false);
  }
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
  var startTourBtn = document.getElementById('onboardingStartTourBtn');
  var nextBtn = document.getElementById('onboardingTourNextBtn');
  var prevBtn = document.getElementById('onboardingTourPrevBtn');
  var skipBtn = document.getElementById('onboardingTourSkipBtn');

  if (reopenBtn) {
    reopenBtn.addEventListener('click', function() {
      setOnboardingVisible(true);
      startOnboardingTour();
    });
  }
  if (dismissBtn) {
    dismissBtn.addEventListener('click', function() {
      setOnboardingVisible(false);
      stopOnboardingTour(false);
    });
  }
  if (completeBtn) {
    completeBtn.addEventListener('click', function() {
      setOnboardingDone(true);
      setOnboardingVisible(false);
      stopOnboardingTour(false);
    });
  }
  if (startTourBtn) {
    startTourBtn.addEventListener('click', function() {
      startOnboardingTour();
    });
  }
  if (prevBtn) {
    prevBtn.addEventListener('click', function() {
      if (!onboardingTourState.active) return;
      if (onboardingTourState.step > 0) {
        onboardingTourState.step -= 1;
        renderOnboardingTourStep();
      }
    });
  }
  if (nextBtn) {
    nextBtn.addEventListener('click', function() {
      if (!onboardingTourState.active) return;
      if (onboardingTourState.step >= ONBOARDING_TOUR_STEPS.length - 1) {
        stopOnboardingTour(true);
        return;
      }
      onboardingTourState.step += 1;
      renderOnboardingTourStep();
    });
  }
  if (skipBtn) {
    skipBtn.addEventListener('click', function() {
      stopOnboardingTour(false);
    });
  }
  window.addEventListener('resize', updateOnboardingTourPosition);
  window.addEventListener('scroll', updateOnboardingTourPosition, true);

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
