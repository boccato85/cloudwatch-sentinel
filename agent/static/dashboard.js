var charts = {};
var PCOLS = ['#00cc8f','#00b4ff','#e54949','#fbbf24','#a855f7','#f5a623','#ec4899'];
var pageLoadTime = Date.now();
const AUTH_TOKEN = 'sentinel-secure-token';

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

// ─── Charts ───────────────────────────────────────────────────────────────────
function uDonut(id, labels, data, colors) {
  var el = document.getElementById(id);
  if (!el) return;
  if (charts[id]) {
    charts[id].data.labels = labels;
    charts[id].data.datasets[0].data = data;
    charts[id].data.datasets[0].backgroundColor = colors;
    charts[id].update('none');
  } else {
    charts[id] = new Chart(el, {
      type: 'doughnut',
      data: { labels: labels, datasets: [{ data: data, backgroundColor: colors, borderWidth: 0, hoverOffset: 4 }] },
      options: {
        cutout: '76%',
        plugins: { legend: { display: false } },
        maintainAspectRatio: false
      }
    });
  }
}

function uLine(id, hData, fData) {
  var el = document.getElementById(id);
  if (!el || !hData || hData.length === 0) return;

  var totalBudget = hData.reduce(function(sum, p) { return sum + p.reqCost; }, 0);
  var totalActual = hData.reduce(function(sum, p) { return sum + p.useCost; }, 0);
  var totalSaved  = totalBudget - totalActual;
  var savingsPct  = totalBudget > 0 ? ((totalSaved / totalBudget) * 100) : 0;
  var summaryEl = document.getElementById('finopsSummary');
  if (summaryEl) {
    var forecastTotal = fData && fData.length > 0
      ? fData.reduce(function(sum, p) { return sum + p.reqCost; }, 0) : 0;
    var forecastUse = fData && fData.length > 0
      ? fData.reduce(function(sum, p) { return sum + p.useCost; }, 0) : 0;
    var forecastStr = fData && fData.length > 0
      ? ' | <span style="color:var(--purple)">Forecast Budget: $' + forecastTotal.toFixed(4) +
        '</span> | <span style="color:#00b4ff">Forecast Usage: $' + forecastUse.toFixed(4) + '</span>'
      : '';
    summaryEl.innerHTML =
      '<span style="color:var(--red)">Budget: $' + totalBudget.toFixed(4) + '</span> | ' +
      '<span style="color:var(--green)">Actual: $' + totalActual.toFixed(4) + '</span> | ' +
      '<span style="color:var(--orange)">Waste: $' + totalSaved.toFixed(4) + ' (' + savingsPct.toFixed(0) + '%)</span>' +
      forecastStr;
  }

  // Build combined labels and datasets
  var histLabels = hData.map(function(p){ return p.time; });
  var forecastLabels = fData ? fData.map(function(p){ return p.time; }) : [];
  var allLabels = histLabels.concat(forecastLabels);

  // Historical data (null-padded for forecast positions)
  var histReq = hData.map(function(p){ return p.reqCost; })
    .concat(forecastLabels.map(function(){ return null; }));
  var histUse = hData.map(function(p){ return p.useCost; })
    .concat(forecastLabels.map(function(){ return null; }));

  // Forecast data (null-padded for historical positions + last historical point as bridge)
  var lastReq = hData[hData.length - 1].reqCost;
  var lastUse = hData[hData.length - 1].useCost;
  var fReqLine    = histLabels.map(function(){ return null; });
  var fUseLine    = histLabels.map(function(){ return null; });
  var fReqHigh    = histLabels.map(function(){ return null; });
  var fReqLow     = histLabels.map(function(){ return null; });
  var fUseHigh    = histLabels.map(function(){ return null; });
  var fUseLow     = histLabels.map(function(){ return null; });
  // bridge: repeat last historical value so lines connect visually
  if (fData && fData.length > 0) {
    fReqLine[histLabels.length - 1] = lastReq;
    fUseLine[histLabels.length - 1] = lastUse;
    fReqHigh[histLabels.length - 1] = lastReq;
    fReqLow[histLabels.length - 1]  = lastReq;
    fUseHigh[histLabels.length - 1] = lastUse;
    fUseLow[histLabels.length - 1]  = lastUse;
    fData.forEach(function(p) {
      fReqLine.push(p.reqCost);
      fUseLine.push(p.useCost);
      fReqHigh.push(p.reqHigh);
      fReqLow.push(p.reqLow);
      fUseHigh.push(p.useHigh);
      fUseLow.push(p.useLow);
    });
  }

  // Destroy and recreate chart to handle dataset count changes
  if (charts[id]) { charts[id].destroy(); delete charts[id]; }

  var datasets = [
    // 0 — Historical Budget
    { label: 'Budget (Requested)', borderColor: '#ff4d4d', borderWidth: 3,
      data: histReq, pointRadius: 0, tension: 0.3, fill: false, spanGaps: false },
    // 1 — Historical Actual
    { label: 'Actual (Usage)', borderColor: '#00ffb3', borderWidth: 3,
      data: histUse, fill: true, backgroundColor: 'rgba(0,255,179,.10)',
      pointRadius: 0, tension: 0.3, spanGaps: false }
  ];

  if (fData && fData.length > 0) {
    datasets = datasets.concat([
      // 2 — Forecast Budget line (dashed)
      { label: 'Forecast Budget', borderColor: '#c084fc', borderWidth: 3,
        borderDash: [6, 4], data: fReqLine,
        pointRadius: 0, tension: 0.3, fill: false, spanGaps: false },
      // 3 — Forecast Usage line (dashed)
      { label: 'Forecast Usage', borderColor: '#38bdf8', borderWidth: 3,
        borderDash: [6, 4], data: fUseLine,
        pointRadius: 0, tension: 0.3, fill: false, spanGaps: false },
      // 4 — Forecast Budget upper bound (invisible line, for fill target)
      { label: '_fReqHigh', borderColor: 'transparent', borderWidth: 0,
        data: fReqHigh, pointRadius: 0, fill: '+1',
        backgroundColor: 'rgba(168,85,247,.10)', spanGaps: false },
      // 5 — Forecast Budget lower bound
      { label: '_fReqLow', borderColor: 'transparent', borderWidth: 0,
        data: fReqLow, pointRadius: 0, fill: false, spanGaps: false },
      // 6 — Forecast Usage upper bound
      { label: '_fUseHigh', borderColor: 'transparent', borderWidth: 0,
        data: fUseHigh, pointRadius: 0, fill: '+1',
        backgroundColor: 'rgba(0,180,255,.10)', spanGaps: false },
      // 7 — Forecast Usage lower bound
      { label: '_fUseLow', borderColor: 'transparent', borderWidth: 0,
        data: fUseLow, pointRadius: 0, fill: false, spanGaps: false }
    ]);
  }

  charts[id] = new Chart(el, {
    type: 'line',
    data: { labels: allLabels, datasets: datasets },
    options: {
      responsive: true, maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: '#1a1e27', borderColor: '#2d3347', borderWidth: 1,
          titleColor: '#c8d0e0', bodyColor: '#c8d0e0', padding: 12,
          filter: function(item) {
            return !item.dataset.label.startsWith('_');
          },
          callbacks: {
            label: function(context) {
              if (context.parsed.y === null) return null;
              return (context.dataset.label || '') + ': $' + context.parsed.y.toFixed(6);
            },
            afterBody: function(context) {
              // Show waste only for historical zone (first 2 datasets)
              var histPts = context.filter(function(c) {
                return c.datasetIndex < 2 && c.parsed.y !== null;
              });
              if (histPts.length >= 2) {
                var budget = histPts[0].parsed.y, actual = histPts[1].parsed.y;
                var waste = budget - actual, pct = budget > 0 ? ((waste/budget)*100) : 0;
                return ['', 'Waste: $' + waste.toFixed(6) + ' (' + pct.toFixed(0) + '%)'];
              }
              return [];
            }
          }
        }
      },
      scales: {
        y: { grid: { color: 'rgba(45,51,71,.55)' },
             ticks: { color: '#7a8499', font: { family: 'JetBrains Mono', size: 10 },
                      callback: function(v) {
                        if (v >= 0.01) return '$' + v.toFixed(2);
                        if (v >= 0.001) return '$' + v.toFixed(3);
                        return '$' + v.toFixed(4);
                      } } },
        x: { grid: { display: false },
             ticks: { color: '#7a8499', maxTicksLimit: 10, font: { size: 10 } } }
      }
    }
  });
}

var sysNsList = ['kube-system', 'kube-public', 'kube-node-lease', 'kubernetes-dashboard', 'cert-manager', 'monitoring', 'logging', 'ingress-nginx', 'istio-system'];
var allNamespaces = [];

// ─── Namespace filter ─────────────────────────────────────────────────────────
async function loadNamespaces() {
  try {
    allNamespaces = await (await fetchAuth('/api/namespaces')).json();
    renderDropdowns();
  } catch(e) { console.error('loadNamespaces error:', e); }
}

function renderDropdowns() {
  var selIds = ['nsFilter', 'tile-ns-pods', 'tile-ns-cpu', 'tile-ns-mem', 'tile-ns-finops', 'tile-ns-eff', 'tile-ns-workloads', 'tile-ns-events'];
  
  var showSysGlobal = document.getElementById('global-show-system') ? document.getElementById('global-show-system').checked : false;
  var showSysEff = typeof _effSysToggle !== 'undefined' && _effSysToggle ? _effSysToggle.checked : false;
  var showSysWl = document.getElementById('workloads-show-system') ? document.getElementById('workloads-show-system').checked : false;
  var showSysEvt = document.getElementById('events-show-system') ? document.getElementById('events-show-system').checked : false;
  
  selIds.forEach(function(id) {
    var sel = document.getElementById(id);
    if (!sel) return;
    var curVal = sel.value;
    sel.innerHTML = '<option value="">All NS</option>';
    allNamespaces.forEach(function(n) {
      if (sysNsList.indexOf(n) !== -1) {
        if (id === 'nsFilter' && !showSysGlobal) return;
        if (id === 'tile-ns-eff' && !showSysEff) return;
        if (id === 'tile-ns-workloads' && !showSysWl) return;
        if (id === 'tile-ns-events' && !showSysEvt) return;
      }
      var opt = document.createElement('option');
      opt.value = n;
      opt.textContent = n;
      sel.appendChild(opt);
    });
    if (curVal && sel.querySelector('option[value="' + curVal + '"]')) {
      sel.value = curVal;
    } else {
      sel.value = '';
      if (id === 'tile-ns-finops') tileNs.finops = '';
      if (id === 'tile-ns-eff') tileNs.eff = '';
      if (id === 'tile-ns-workloads') tileNs.workloads = '';
    }
  });
}

// ─── Tab navigation ───────────────────────────────────────────────────────────
function switchTab(tab) {
  activeTab = tab;
  document.querySelectorAll('.tab-btn').forEach(function(b) {
    b.classList.toggle('active', b.dataset.tab === tab);
  });
  document.querySelectorAll('.tab-content').forEach(function(c) {
    c.classList.toggle('active', c.id === 'tab-' + tab);
  });
  if (tab === 'workloads') updateWorkloads();
  if (tab === 'pods')      updatePods();
}

// ─── Overview update ──────────────────────────────────────────────────────────
async function updateOverview() {
  try {
    var showSysGlobal = document.getElementById('global-show-system') ? document.getElementById('global-show-system').checked : false;
    var [s, incidents, allPods] = await Promise.all([
      fetchAuth('/api/summary').then(function(r){ return r.json(); }),
      fetchAuth('/api/incidents').then(function(r){ return r.json(); }).catch(function(){ return []; }),
      fetchAuth('/api/pods').then(function(r){ return r.json(); }).catch(function(){ return []; })
    ]);
    allPods = allPods || [];
    var nsPods = activeNs ? allPods.filter(function(p){ return p.namespace === activeNs; }) : allPods;
    var filteredPods = showSysGlobal ? nsPods : nsPods.filter(function(p){ return !_SYSTEM_NS[p.namespace]; });
    var byPhase = {};
    filteredPods.forEach(function(p){ byPhase[p.phase] = (byPhase[p.phase]||0)+1; });
    var nodes   = s.nodes || [];
    var eff     = s.efficiency || 0;
    var running = byPhase['Running'] || 0;
    var total   = Object.values(byPhase).reduce(function(a,b){ return a+b; }, 0);
    var issues  = nodes.filter(function(n){ return n.status !== 'Running'; }).length;

    incidents = incidents || [];
    var nsIncidents = activeNs ? incidents.filter(function(i){ return i.namespace === activeNs; }) : incidents;
    var healthIncidents = nsIncidents.filter(function(i) { return !i.isWaste && (showSysGlobal || !_SYSTEM_NS[i.namespace]); });
    var critIncs = healthIncidents.filter(function(i) { return i.severity === 'CRITICAL' || i.severity === 'critical'; });
    var warnIncs = healthIncidents.filter(function(i) { return i.severity === 'WARNING' || i.severity === 'warning'; });

    document.getElementById('kN').textContent  = nodes.length;
    document.getElementById('kNs').textContent = issues > 0 ? issues + ' with issues' : 'All healthy';
    document.getElementById('kR').textContent  = running;
    document.getElementById('kRs').textContent = 'of ' + total + ' total';
    var kFailCard = document.getElementById('kFailCard');
    document.getElementById('kF').textContent  = critIncs.length;
    var w = warnIncs.length;
    document.getElementById('kFs').textContent = critIncs.length + ' crítico' + (critIncs.length !== 1 ? 's' : '') + ' • ' + w + ' warning' + (w !== 1 ? 's' : '');
    kFailCard.className = 'kpi' + (critIncs.length > 0 ? ' c-red' : w > 0 ? ' c-orange' : ' c-green') + ' kpi-clickable';
    // kE/kEs kept for compat (element may be absent after layout v0.10.7+)
    var _kE = document.getElementById('kE'); if (_kE) { _kE.textContent = eff.toFixed(1) + '%'; }
    var _kEs = document.getElementById('kEs'); if (_kEs) { _kEs.textContent = s.cpuRequested + 'm / ' + s.cpuAllocatable + 'm'; }
    lastSummary = s;

    if (!tileNs.cpu) {
      document.getElementById('effBig').textContent  = eff.toFixed(1) + '%';
      document.getElementById('cpuReqV').textContent = s.cpuRequested + 'm';
      document.getElementById('cpuAlcV').textContent = s.cpuAllocatable + 'm';
      var reqPct = s.cpuAllocatable > 0 ? (s.cpuRequested / s.cpuAllocatable * 100) : 0;
      var rb = document.getElementById('cpuReqB');
      rb.style.width = Math.min(reqPct, 100) + '%';
      rb.style.background = reqPct > 85 ? 'var(--red)' : reqPct > 70 ? 'var(--orange)' : 'var(--cyan)';
      var cpuBadge = document.getElementById('cpubadge');
      cpuBadge.textContent = eff > 85 ? 'Critical' : eff > 70 ? 'High Load' : 'Optimal';
      cpuBadge.className   = 'badge ' + (eff > 85 ? 'b-crit' : eff > 70 ? 'b-warn' : 'b-ok');
      uDonut('cpuDonut', ['Requested','Free'],
        [s.cpuRequested, Math.max(0, s.cpuAllocatable - s.cpuRequested)], ['#00b4ff','#2d3347']);
    } else {
      updateCpuTile();
    }

    // ── Memory tile ────────────────────────────────────────────────────────────
    if (!tileNs.mem) {
      var memReqPct = s.memAllocatable > 0 ? (s.memRequested / s.memAllocatable * 100) : 0;
      document.getElementById('memReqV').textContent  = s.memRequested + 'Mi';
      document.getElementById('memAlcV').textContent  = s.memAllocatable + 'Mi';
      document.getElementById('memEffBig').textContent = memReqPct.toFixed(1) + '%';
      var memBar = document.getElementById('memReqB');
      memBar.style.width      = Math.min(memReqPct, 100) + '%';
      memBar.style.background = memReqPct > 90 ? 'var(--red)' : memReqPct > 75 ? 'var(--orange)' : 'var(--purple)';
      var memBadge = document.getElementById('membadge');
      memBadge.textContent = memReqPct > 90 ? 'Critical' : memReqPct > 75 ? 'High' : 'Optimal';
      memBadge.className   = 'badge ' + (memReqPct > 90 ? 'b-crit' : memReqPct > 75 ? 'b-warn' : 'b-ok');
      uDonut('memDonut', ['Requested','Free'],
        [s.memRequested, Math.max(0, s.memAllocatable - s.memRequested)], ['#a855f7','#2d3347']);
    } else {
      updateMemTile();
    }

    var hc = document.getElementById('honeycomb');
    hc.innerHTML = '';

    var isMock = false;
    var drawNodes = nodes;

    // --- MOCK MODE FOR SINGLE NODE ---
    if (nodes.length === 1) {
      isMock = true;
      drawNodes = [];
      for (var i=1; i<=24; i++) {
         var cpuPct = Math.random() * 100;
         var memPct = Math.random() * 100;
         var cpuCap = 4000;
         var memCap = 16000;
         drawNodes.push({
           name: 'mock-node-' + i,
           status: Math.random() > 0.95 ? 'NotReady' : 'Running',
           cpuAllocatable: cpuCap,
           cpuRequested: (cpuPct / 100) * cpuCap,
           memAllocatable: memCap,
           memRequested: (memPct / 100) * memCap,
           podCount: Math.floor(Math.random() * 50) + 1
         });
      }
    }

    drawNodes.forEach(function(n) {
      var d = document.createElement('div');
      
      var cpuSat = n.cpuAllocatable > 0 ? (n.cpuRequested / n.cpuAllocatable) * 100 : 0;
      var memSat = n.memAllocatable > 0 ? (n.memRequested / n.memAllocatable) * 100 : 0;
      var maxSat = Math.max(cpuSat, memSat);
      
      var hexClass = 'hex';
      if (n.status !== 'Running') {
         hexClass += ' issue'; // fallback to dark with red border
         d.style.background = '#1a1e27';
         d.style.border = '1px solid var(--red)';
         d.style.color = 'var(--red)';
      } else if (maxSat > 85) {
         d.style.background = 'var(--red)';
         d.style.color = '#fff';
      } else if (maxSat > 75) {
         d.style.background = 'var(--orange)';
      } else if (maxSat >= 60) {
         d.style.background = '#fbbf24'; // yellow
      } else {
         d.style.background = 'var(--green)';
      }
      
      d.className = hexClass;
      d.title = n.name + '\nCPU: ' + cpuSat.toFixed(1) + '% | Mem: ' + memSat.toFixed(1) + '% | Pods: ' + (n.podCount || 0);
      d.textContent = 'N';
      hc.appendChild(d);
    });

    if (isMock) {
       var mockLabel = document.createElement('div');
       mockLabel.style = 'width:100%;text-align:center;font-size:0.65em;color:var(--text-dim);margin-top:6px;text-transform:uppercase;letter-spacing:1px';
       mockLabel.textContent = 'Mock Data (Single-Node)';
       hc.appendChild(mockLabel);
    }
    var nb = document.getElementById('nbadge');
    nb.textContent = issues > 0 ? issues + ' Issues' : 'All OK';
    nb.className = 'badge ' + (issues > 0 ? 'b-crit' : 'b-ok');

    if (!tileNs.pods) {
      // All-NS: fetch all pods and show namespace distribution
      updatePodsAllNsTile(total, running);
    } else {
      updatePodsTile(); // namespace-specific: show phases
    }

    var ahtml = '';
    healthIncidents.forEach(function(inc) {
      var isCrit = (inc.severity === 'CRITICAL' || inc.severity === 'critical');
      var color = isCrit ? 'var(--red)' : 'var(--orange)';
      var icon = isCrit ? '&#9888;' : '&#9203;';
      var cls = isCrit ? 'failed' : 'pending';
      var typeStr = esc(inc.type || 'ALERT').toUpperCase();
      ahtml += '<div class="alert ' + cls + '"><span class="alert-ico" style="color:' + color + '">' + icon + '</span>' +
               '<div><b>' + esc(inc.podName || inc.name || '--') + '</b><div class="alert-ns">' + esc(inc.namespace) + ' &bull; ' + typeStr + '</div></div></div>';
    });
    document.getElementById('alertsBox').innerHTML = ahtml ||
      '<div class="alert ok"><span style="color:var(--green)">&#10003;</span>&nbsp; No active alerts &mdash; cluster healthy</div>';
    var totalA = healthIncidents.length;
    var ab = document.getElementById('abadge');
    if (ab) { ab.textContent = totalA > 0 ? totalA + ' Issues' : '0 Issues'; ab.className = 'badge ' + (critIncs.length > 0 ? 'b-crit' : totalA > 0 ? 'b-warn' : 'b-ok'); }
    // Header alert badge
    var hdrBadge = document.getElementById('hdrAlertBadge');
    var hdrTxt   = document.getElementById('hdrAlertTxt');
    if (hdrBadge) {
      hdrBadge.className = 'hdr-alert' + (critIncs.length > 0 ? ' alert-crit' : totalA > 0 ? ' alert-warn' : '');
      hdrTxt.textContent = critIncs.length > 0 ? critIncs.length + ' Critical' : totalA > 0 ? totalA + ' Alerts' : 'All OK';
    }

    var m = await (await fetchAuth('/api/metrics')).json();
    m = m || [];
    // Apply namespace filter to metrics
    if (activeNs) m = m.filter(function(p){ return p.namespace === activeNs; });
    lastMetrics = m; // cache for re-sort

    // top CPU consumer KPI
    var topByUsage = m.slice().sort(function(a,b){ return b.cpuUsage - a.cpuUsage; });
    if (topByUsage.length > 0) {
      var topCpuPod = topByUsage[0];
      document.getElementById('kT').textContent  = topCpuPod.cpuUsage + 'm';
      document.getElementById('kTs').textContent = topCpuPod.name || '--';
      
      var reqCpu = topCpuPod.cpuRequest > 0 ? topCpuPod.cpuRequest : topCpuPod.cpuUsage;
      var fillPct = Math.min(100, (topCpuPod.cpuUsage / reqCpu) * 100);
      if(fillPct === Infinity || isNaN(fillPct)) fillPct = 0;
      var cCard = document.getElementById('kCpuCard');
      if (cCard) cCard.style.backgroundImage = 'linear-gradient(to right, rgba(0, 180, 255, 0.12) ' + fillPct.toFixed(0) + '%, transparent ' + fillPct.toFixed(0) + '%)';
    }
    // top memory consumer KPI
    var topByMem = m.slice().sort(function(a,b){ return (b.memUsage||0) - (a.memUsage||0); });
    if (topByMem.length > 0) {
      var topMemPod = topByMem[0];
      document.getElementById('kMem').textContent  = (topMemPod.memUsage || 0) + 'Mi';
      document.getElementById('kMems').textContent = topMemPod.name || '--';
      
      var reqMem = topMemPod.memRequest > 0 ? topMemPod.memRequest : topMemPod.memUsage;
      var fillPctM = Math.min(100, (topMemPod.memUsage / reqMem) * 100);
      if(fillPctM === Infinity || isNaN(fillPctM)) fillPctM = 0;
      var mCard = document.getElementById('kMemCard');
      if (mCard) mCard.style.backgroundImage = 'linear-gradient(to right, rgba(168, 85, 247, 0.12) ' + fillPctM.toFixed(0) + '%, transparent ' + fillPctM.toFixed(0) + '%)';
    }
    renderOverviewEvents();

    var waste = m.filter(function(p){ return Number(p.potentialSavingMCpu || 0) > 0; });
    // ── Waste KPI card ────────────────────────────────────────────────────────
    var totalCpuM = waste.reduce(function(s,p){ return s + Number(p.potentialSavingMCpu||0); }, 0);
    // main = pod count (universal, short like other KPI cards)
    document.getElementById('kW').textContent = waste.length;

    // memory: sum of (memRequest - memUsage) for pods that are over-allocated
    var totalMemMi = waste.reduce(function(s,p){
      var over = (Number(p.memRequest||0) - Number(p.memUsage||0));
      return s + (over > 0 ? over : 0);
    }, 0);
    var cpuStr = totalCpuM > 0 ? totalCpuM + 'm CPU' : '';
    var memStr = totalMemMi >= 1024 ? (totalMemMi/1024).toFixed(1) + 'GB memory'
               : totalMemMi > 0    ? totalMemMi + 'Mi memory'
               : '';
    var kWmem = document.getElementById('kWmem');
    var wasteBody = [cpuStr, memStr].filter(Boolean).join(' · ');
    if (kWmem) kWmem.textContent = wasteBody ? 'wasting: ' + wasteBody : 'no waste detected';

    // pareto: how many top pods account for ≥60% of CPU waste
    var sorted = waste.slice().sort(function(a,b){ return Number(b.potentialSavingMCpu||0) - Number(a.potentialSavingMCpu||0); });
    var paretoLabel = '';
    if (sorted.length > 1 && totalCpuM > 0) {
      var cum = 0, n = 0;
      for (var i = 0; i < sorted.length; i++) {
        cum += Number(sorted[i].potentialSavingMCpu||0);
        n++;
        if (cum / totalCpuM >= 0.6) break;
      }
      var pct = Math.round(cum / totalCpuM * 100);
      paretoLabel = 'top ' + n + ' pod' + (n !== 1 ? 's' : '') + ' → ' + pct + '% of waste';
    }
    var kWpareto = document.getElementById('kWpareto');
    if (kWpareto) kWpareto.textContent = paretoLabel;

    var wc = document.getElementById('wcnt');
    if (wc) {
      wc.textContent = waste.length > 0 ? waste.length + ' waste item' + (waste.length !== 1 ? 's' : '') : 'All rightsized';
      wc.className = 'badge ' + (waste.length > 0 ? 'b-warn' : 'b-ok');
    }

    document.getElementById('lastUp').textContent = 'Updated: ' + new Date().toLocaleTimeString();

    var ctxNs = document.getElementById('ctx-ns');
    if (ctxNs) ctxNs.textContent = (activeNs || 'All Namespaces');

    var ctxPods = document.getElementById('ctx-pods');
    if (ctxPods) ctxPods.textContent = (allPods.length) + ' pods';

    var ctxWarn = document.getElementById('ctx-warnings');
    if (ctxWarn) {
      var warnCount = incidents && incidents.length ? incidents.length : (s.failedPods || 0);
      ctxWarn.textContent = warnCount + ' warning' + (warnCount !== 1 ? 's' : '');
      ctxWarn.style.color = warnCount > 0 ? 'var(--orange)' : 'var(--green)';
    }

    var ctxUpdated = document.getElementById('ctx-updated');
    if (ctxUpdated) ctxUpdated.textContent = new Date().toLocaleTimeString();
  } catch(e) { console.error('Sentinel overview error:', e); }
}

// ─── Overview Recent Events ─────────────────────────────────────────────────────
var lastEvents = [];
var eventsSort = { col: 'age', dir: 'desc' };

async function renderOverviewEvents() {
  try {
    var showSysEvt = document.getElementById('events-show-system') ? document.getElementById('events-show-system').checked : false;
    var ns = document.getElementById('tile-ns-events') ? document.getElementById('tile-ns-events').value : '';
    var url = '/api/events';
    if (ns) url += '?namespace=' + encodeURIComponent(ns);
    var events = await (await fetchAuth(url)).json();
    events = events || [];
    lastEvents = showSysEvt ? events : events.filter(function(e){ return !_SYSTEM_NS[e.namespace]; });

    document.getElementById('evtcnt').textContent = lastEvents.length + ' events';

    var rows = '';
    lastEvents.slice(0, 10).forEach(function(e, i) {
      var typeClass = e.type === 'Warning' ? 'b-warn' : e.type === 'Normal' ? 'b-ok' : 'b-warn';
      var msg = esc(e.message || '--');
      if (msg.length > 80) msg = msg.substring(0, 77) + '...';
      rows += '<tr>' +
        '<td><span class="badge ' + typeClass + '" style="font-size:.7em">' + esc(e.type||'--') + '</span></td>' +
        '<td style="font-size:.78em;color:var(--text-dim)">' + esc(e.reason||'--') + '</td>' +
        '<td style="font-size:.78em;max-width:120px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="' + esc(e.name||'') + '">' + esc(e.name||'--') + '</td>' +
        '<td style="font-size:.72em"><span class="ns-tag">' + esc(e.namespace||'--') + '</span></td>' +
        '<td style="font-size:.72em;color:var(--text-dim)">' + esc(e.age||'--') + '</td>' +
        '<td style="font-size:.72em;color:var(--text-dim);max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="' + esc(e.message||'') + '">' + msg + '</td>' +
        '</tr>';
    });
    document.getElementById('evtbody').innerHTML = rows || '<tr><td colspan="6" style="text-align:center;color:var(--text-dim);padding:16px">No events</td></tr>';
  } catch(e) { console.error('events error:', e); }
}

// ─── Drawer: Events ─────────────────────────────────────────────────────────────
var _evtDrawerState = { ns: '', showSys: false, search: '' };
var _evtDrawerAbortable = null;
var _evtDrawerSearchTimer = null;
var _evtDrawerReqId = 0;

function openEventsDrawer() {
  var curNs = document.getElementById('tile-ns-events') ? document.getElementById('tile-ns-events').value : '';
  var curShowSys = document.getElementById('events-show-system') ? document.getElementById('events-show-system').checked : false;
  _evtDrawerState = { ns: curNs, showSys: curShowSys, search: '' };
  openDrawer('Recent Events — Full Log', renderEventsDrawer);
}

async function renderEventsDrawer() {
  try {
    var nsFilter = _evtDrawerState.ns;
    var showSysEvt = _evtDrawerState.showSys;
    var searchVal = _evtDrawerState.search;

    var myReqId = ++_evtDrawerReqId;

    if (_evtDrawerAbortable) _evtDrawerAbortable.abort();
    var ctrl = new AbortController();
    _evtDrawerAbortable = ctrl;

    var url = '/api/events';
    var events = await (await fetchAuth(url, { signal: ctrl.signal })).json();
    if (myReqId !== _evtDrawerReqId) return;
    events = events || [];

    var filtered = events.filter(function(e) {
      if (!showSysEvt && _SYSTEM_NS[e.namespace]) return false;
      if (searchVal && !(e.name||'').toLowerCase().includes(searchVal) && !(e.message||'').toLowerCase().includes(searchVal) && !(e.reason||'').toLowerCase().includes(searchVal)) return false;
      return true;
    });

    if (nsFilter) {
      filtered = filtered.filter(function(e){ return e.namespace === nsFilter; });
    }

    filtered = filtered.slice().sort(function(a, b) {
      var av, bv;
      if (eventsSort.col === 'age') {
        av = a._ts || 0; bv = b._ts || 0;
      } else {
        av = a[eventsSort.col] || ''; bv = b[eventsSort.col] || '';
        if (typeof av === 'string') { av = av.toLowerCase(); bv = bv.toLowerCase(); }
      }
      if (av < bv) return eventsSort.dir === 'asc' ? -1 : 1;
      if (av > bv) return eventsSort.dir === 'asc' ? 1 : -1;
      return 0;
    });

    var nsSet = {};
    events.forEach(function(e){ if (showSysEvt || !_SYSTEM_NS[e.namespace]) nsSet[e.namespace] = 1; });

    var allNs = await (await fetchAuth('/api/namespaces')).json();
    allNs = allNs || [];
    var nsForSelect = {};
    allNs.forEach(function(n) {
      if (showSysEvt || !_SYSTEM_NS[n]) nsForSelect[n] = 1;
    });
    var nsOpts = '<option value="">All Namespaces</option>' + Object.keys(nsForSelect).sort().map(function(n){ return '<option value="'+esc(n)+'"'+(nsFilter===n?' selected':'')+'>' + esc(n) + '</option>'; }).join('');

    var tableHTML = '';
    if (!filtered.length) {
      tableHTML = '<div style="text-align:center;color:var(--text-dim);padding:40px">No events matching filters</div>';
    } else {
      tableHTML = '<table class="wtable"><thead><tr id="devthead">' +
        makeSortHeader('Type', 'type', eventsSort) +
        makeSortHeader('Reason', 'reason', eventsSort) +
        makeSortHeader('Object', 'name', eventsSort) +
        makeSortHeader('NS', 'namespace', eventsSort) +
        makeSortHeader('Age', 'age', eventsSort) +
        '<th>Message</th>' +
        '</tr></thead><tbody>';

      filtered.forEach(function(e) {
        var typeClass = e.type === 'Warning' ? 'b-warn' : e.type === 'Normal' ? 'b-ok' : 'b-warn';
        tableHTML += '<tr>' +
          '<td><span class="badge ' + typeClass + '" style="font-size:.7em">' + esc(e.type||'--') + '</span></td>' +
          '<td style="font-size:.78em;color:var(--text-dim)">' + esc(e.reason||'--') + '</td>' +
          '<td style="font-size:.78em;max-width:140px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="' + esc(e.name||'') + '">' + esc(e.name||'--') + '</td>' +
          '<td style="font-size:.72em"><span class="ns-tag">' + esc(e.namespace||'--') + '</span></td>' +
          '<td style="font-size:.72em;color:var(--text-dim)">' + esc(e.age||'--') + '</td>' +
          '<td style="font-size:.72em;color:var(--text-dim);max-width:250px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="' + esc(e.message||'') + '">' + esc(e.message||'--') + '</td>' +
          '</tr>';
      });
      tableHTML += '</tbody></table>';
    }

    var existingTable = document.getElementById('devt-table');
    if (!existingTable) {
      var controlsHTML = '<div style="padding:0 0 12px;display:flex;gap:10px;flex-wrap:wrap;align-items:center">' +
        '<input class="dtool-input" id="devt-search" placeholder="search reason, object, message..." value="' + esc(searchVal) + '" style="flex:1;min-width:200px">' +
        '<select id="devt-ns" class="dtool-select">' + nsOpts + '</select>' +
        '</div>';
      drawerHTML(controlsHTML + '<div id="devt-table">' + tableHTML + '</div>');

      var searchInput = document.getElementById('devt-search');
      var nsSelect = document.getElementById('devt-ns');
      if (searchInput) {
        searchInput.addEventListener('input', function() {
          clearTimeout(_evtDrawerSearchTimer);
          _evtDrawerSearchTimer = setTimeout(function() {
            _evtDrawerState.search = searchInput.value.toLowerCase();
            renderEventsDrawer();
          }, 300);
        });
      }
      if (nsSelect) {
        nsSelect.addEventListener('change', function() {
          _evtDrawerState.ns = nsSelect.value;
          renderEventsDrawer();
        });
      }
      document.querySelectorAll('#devthead .th-sort').forEach(function(th) {
        th.style.cursor = 'pointer';
        th.addEventListener('click', function() {
          var col = th.dataset.col;
          if (eventsSort.col === col) {
            eventsSort.dir = eventsSort.dir === 'asc' ? 'desc' : 'asc';
          } else {
            eventsSort.col = col; eventsSort.dir = 'asc';
          }
          renderEventsDrawer();
        });
      });
    } else {
      existingTable.innerHTML = tableHTML;
      var searchInput = document.getElementById('devt-search');
      var nsSelect = document.getElementById('devt-ns');
      if (searchInput) searchInput.focus();
      if (nsSelect) nsSelect.value = nsFilter;
      document.querySelectorAll('#devthead .th-sort').forEach(function(th) {
        th.style.cursor = 'pointer';
        th.addEventListener('click', function() {
          var col = th.dataset.col;
          if (eventsSort.col === col) {
            eventsSort.dir = eventsSort.dir === 'asc' ? 'desc' : 'asc';
          } else {
            eventsSort.col = col; eventsSort.dir = 'asc';
          }
          renderEventsDrawer();
        });
      });
    }
  } catch(e) { drawerHTML('<div style="color:var(--red);padding:20px">Error: ' + esc(e.message) + '</div>'); }
}

// ─── Pod Detail Drawer ────────────────────────────────────────────────────────
function openPodDetailDrawer(p) {
  var hasSaving   = Number(p.potentialSavingMCpu || 0) > 0;
  var utilPct     = (p.cpuRequestPresent && p.cpuRequest > 0) ? (p.cpuUsage / p.cpuRequest * 100) : 0;
  var memUtilPct  = (p.memRequest && p.memRequest > 0) ? ((p.memUsage||0) / p.memRequest * 100) : 0;
  var cpuBarColor = utilPct > 70 ? 'var(--green)' : utilPct > 40 ? 'var(--orange)' : 'var(--red)';
  var memBarColor = memUtilPct > 75 ? 'var(--red)' : memUtilPct > 50 ? 'var(--orange)' : 'var(--cyan)';
  var severityClass = hasSaving ? 'b-warn' : 'b-ok';
  var severityText  = hasSaving ? 'Overprovisioned' : 'Rightsized';

  var cpuRequestStr  = p.cpuRequestPresent ? p.cpuRequest + 'm' : 'No request set';
  var memRequestStr  = p.memRequest > 0 ? p.memRequest + ' Mi' : 'No request set';

  var savingsLine = hasSaving
    ? '<div style="margin-top:12px;padding:10px 12px;background:rgba(251,191,36,.08);border:1px solid rgba(251,191,36,.3);border-radius:6px">' +
      '<div style="color:var(--orange);font-weight:600;font-size:.88em;margin-bottom:4px">&#9888; Savings Opportunity</div>' +
      '<div style="font-size:.83em;color:var(--text-bright)">Potential CPU savings: <b style="color:var(--orange)">-' + Number(p.potentialSavingMCpu) + 'm (' + (p.wastePct||'--') + '%)</b></div>' +
      '<div style="font-size:.80em;color:var(--text-dim);margin-top:4px">CPU request is significantly higher than actual usage.<br>Consider reducing <code>resources.requests.cpu</code> to ~' + Math.ceil(p.cpuUsage * 1.2) + 'm.</div>' +
      '</div>'
    : '<div style="margin-top:12px;padding:10px 12px;background:rgba(0,204,143,.08);border:1px solid rgba(0,204,143,.3);border-radius:6px">' +
      '<div style="font-size:.83em;color:var(--green)">&#10003; This workload is well rightsized. CPU usage is within acceptable range of the request.</div>' +
      '</div>';

  var html =
    '<div style="display:flex;align-items:center;gap:10px;margin-bottom:16px">' +
      '<span class="mono" style="font-size:1em;color:var(--text-bright)">' + esc(p.name||'--') + '</span>' +
      '<span class="ns-tag">' + esc(p.namespace||'--') + '</span>' +
      '<span class="badge ' + severityClass + '" style="font-size:.76em">' + severityText + '</span>' +
    '</div>' +

    '<div style="font-size:.80em;color:var(--text-dim);margin-bottom:14px">Real-time snapshot &bull; data collected every ~10s</div>' +

    '<div style="margin-bottom:14px">' +
      '<div style="display:flex;justify-content:space-between;font-size:.82em;margin-bottom:4px">' +
        '<span style="color:var(--text-dim)">CPU Usage / Request</span>' +
        '<span class="mono" style="color:var(--cyan)">' + p.cpuUsage + 'm / ' + cpuRequestStr + '</span>' +
      '</div>' +
      '<div style="background:var(--surface2);border-radius:4px;height:10px;overflow:hidden">' +
        '<div style="height:100%;width:' + Math.min(utilPct,100).toFixed(1) + '%;background:' + cpuBarColor + ';border-radius:4px;transition:width .4s"></div>' +
      '</div>' +
      '<div style="font-size:.76em;color:var(--text-dim);margin-top:3px">Utilization: ' + utilPct.toFixed(1) + '%</div>' +
    '</div>' +

    '<div style="margin-bottom:14px">' +
      '<div style="display:flex;justify-content:space-between;font-size:.82em;margin-bottom:4px">' +
        '<span style="color:var(--text-dim)">Memory Usage / Request</span>' +
        '<span class="mono" style="color:var(--purple)">' + (p.memUsage||0) + ' Mi / ' + memRequestStr + '</span>' +
      '</div>' +
      '<div style="background:var(--surface2);border-radius:4px;height:10px;overflow:hidden">' +
        '<div style="height:100%;width:' + Math.min(memUtilPct||0,100).toFixed(1) + '%;background:' + memBarColor + ';border-radius:4px;transition:width .4s"></div>' +
      '</div>' +
      '<div style="font-size:.76em;color:var(--text-dim);margin-top:3px">Utilization: ' + (p.memRequest > 0 ? memUtilPct.toFixed(1) + '%' : 'N/A — no memory request set') + '</div>' +
    '</div>' +

    savingsLine;

  openDrawer('Pod Detail — Waste Analysis', function(el) { drawerHTML(html); });
}


// ─── Financial Correlation chart (independent of 5s loop) ────────────────────
async function fetchChart() {
  try {
    var url, forecastUrl;
    var chartNs = tileNs.finops || activeNs;
    var showSys = document.getElementById('global-show-system') ? document.getElementById('global-show-system').checked : false;
    if (activeRange === 'custom' && customFrom && customTo) {
      url = '/api/history?range=custom&from=' + encodeURIComponent(customFrom) + '&to=' + encodeURIComponent(customTo) + '&system=' + showSys;
      if (chartNs) url += '&namespace=' + encodeURIComponent(chartNs);
      forecastUrl = null; // no forecast for custom range
    } else {
      url = '/api/history?range=' + activeRange + '&system=' + showSys;
      if (chartNs) url += '&namespace=' + encodeURIComponent(chartNs);
      forecastUrl = '/api/forecast?range=' + activeRange + '&system=' + showSys;
      if (chartNs) forecastUrl += '&namespace=' + encodeURIComponent(chartNs);
    }

    var hResp = await fetchAuth(url);
    var dataNote = hResp.headers.get('X-Sentinel-Data-Note') || '';
    var h = await hResp.json();
    var f = null;
    if (forecastUrl) {
      try { f = await (await fetchAuth(forecastUrl)).json(); } catch(e) { f = null; }
    }
    lastHistData = h;
    lastForecast = f;
    uLine('mainLineChart', h, f);

    // Show data note when backend served fallback data
    var noteEl = document.getElementById('chartDataNote');
    if (noteEl) {
      if (dataNote === 'insufficient-daily-data-showing-hourly-fallback') {
        noteEl.textContent = 'Insufficient daily aggregates \u2014 showing available hourly data';
        noteEl.style.display = '';
      } else {
        noteEl.style.display = 'none';
        noteEl.textContent = '';
      }
    }

    var chartTitle = document.getElementById('finops-chart-title');
    if (chartTitle) {
      var rangeLabel = activeRange === 'custom'
        ? 'Custom Range'
        : ({ '30m':'30 min','1h':'1 hour','6h':'6 hours','24h':'24 hours','7d':'7 days','30d':'30 days','90d':'90 days','365d':'1 year' }[activeRange] || activeRange);
      chartTitle.textContent = 'Financial Correlation \u2014 ROI Timeline' +
        (activeNs ? ' \u00b7 ' + activeNs : '') + ' (' + rangeLabel + ')';
    }

    // Update forecast summary card
    updateForecastCard(f);
  } catch(e) { console.error('Sentinel chart error:', e); }
}

function updateForecastCard(fData) {
  var card = document.getElementById('forecastCard');
  if (!card) return;
  if (!fData || fData.length === 0) {
    card.style.display = 'none';
    return;
  }
  card.style.display = _fcVisible ? '' : 'none';
  var projBudget = fData.reduce(function(s, p) { return s + p.reqCost; }, 0);
  var projUsage  = fData.reduce(function(s, p) { return s + p.useCost; }, 0);
  var projWaste  = projBudget - projUsage;
  var projPct    = projBudget > 0 ? (projWaste / projBudget * 100) : 0;
  document.getElementById('fcProjBudget').textContent = '$' + projBudget.toFixed(4);
  document.getElementById('fcProjUsage').textContent  = '$' + projUsage.toFixed(4);
  document.getElementById('fcProjWaste').textContent  = '$' + projWaste.toFixed(4) + ' (' + projPct.toFixed(0) + '%)';
  document.getElementById('fcPeriod').textContent = fData[0].time + ' → ' + fData[fData.length - 1].time;
}

// ─── Per-tile namespace update functions ──────────────────────────────────────
async function updatePodsTile() {
  try {
    var ns = tileNs.pods;
    var url = ns ? '/api/pods?namespace=' + encodeURIComponent(ns) : '/api/pods';
    var pods = await (await fetchAuth(url)).json();
    pods = pods || [];
    var byPhase = {};
    pods.forEach(function(p) { byPhase[p.phase] = (byPhase[p.phase]||0)+1; });
    var phases = Object.keys(byPhase), vals = Object.values(byPhase);
    uDonut('phaseDonut', phases, vals, PCOLS.slice(0, phases.length));
    var leg = '';
    phases.forEach(function(ph, i) {
      leg += '<div class="li"><div class="li-dot" style="background:' + PCOLS[i] + '"></div>' +
             '<span class="li-lbl">' + esc(ph) + '</span>' +
             '<span class="li-val">' + vals[i] + '</span></div>';
    });
    document.getElementById('phaseLegend').innerHTML = leg ||
      '<div style="color:var(--text-dim);font-size:.84em">No pods in ' + esc(ns) + '</div>';
  } catch(e) { console.error('updatePodsTile error:', e); }
}

async function updatePodsAllNsTile(totalFallback, runningFallback) {
  try {
    var allPods = await (await fetchAuth('/api/pods')).json();
    allPods = allPods || [];
    var byNs = {};
    allPods.forEach(function(p) {
      var ns = p.namespace || 'default';
      if (!byNs[ns]) byNs[ns] = { total: 0, running: 0 };
      byNs[ns].total++;
      if (p.phase === 'Running') byNs[ns].running++;
    });
    var nsSorted  = Object.keys(byNs).sort(function(a, b) { return byNs[b].total - byNs[a].total; });
    var topNs     = nsSorted.slice(0, 6);
    var otherCnt  = nsSorted.slice(6).reduce(function(acc, ns) { return acc + byNs[ns].total; }, 0);
    var nsLabels  = topNs.concat(otherCnt > 0 ? ['other'] : []);
    var nsVals    = topNs.map(function(ns) { return byNs[ns].total; }).concat(otherCnt > 0 ? [otherCnt] : []);
    uDonut('phaseDonut', nsLabels, nsVals, PCOLS.slice(0, nsLabels.length));
    var total     = allPods.length || totalFallback || 0;
    var nsCount   = Object.keys(byNs).length;
    var runCount  = allPods.filter(function(p){ return p.phase === 'Running'; }).length || runningFallback || 0;
    var healthPct = total > 0 ? (runCount / total * 100) : 100;
    var hcol      = healthPct > 90 ? 'var(--green)' : healthPct > 70 ? 'var(--orange)' : 'var(--red)';
    var leg = '<div class="pods-ns-kpis">' +
      '<div class="pnk"><div class="pnk-val">' + total + '</div><div class="pnk-lbl">total pods</div></div>' +
      '<div class="pnk"><div class="pnk-val">' + nsCount + '</div><div class="pnk-lbl">namespaces</div></div>' +
      '<div class="pnk" style="color:' + hcol + '"><div class="pnk-val">' + healthPct.toFixed(0) + '%</div><div class="pnk-lbl">running</div></div>' +
      '</div>';
    topNs.forEach(function(ns, i) {
      var info = byNs[ns];
      leg += '<div class="li-row"><b style="background:' + PCOLS[i] + '"></b>' +
        '<span class="li-name" title="' + esc(ns) + '">' + esc(ns) + '</span>' +
        '<span class="li-val">' + info.total + '</span></div>';
    });
    if (otherCnt > 0) {
      leg += '<div class="li-row"><b style="background:var(--text-dim)"></b><span class="li-name">+more</span><span class="li-val">' + otherCnt + '</span></div>';
    }
    document.getElementById('phaseLegend').innerHTML = leg;
  } catch(e) { console.error('updatePodsAllNsTile error:', e); }
}

async function updateCpuTile() {
  try {
    var ns = tileNs.cpu;
    var s = lastSummary || await (await fetchAuth('/api/summary')).json();
    var url = '/api/metrics?namespace=' + encodeURIComponent(ns);
    var m = await (await fetchAuth(url)).json();
    m = m || [];
    var nsReq = m.reduce(function(sum, p) { return sum + (p.cpuRequestPresent ? p.cpuRequest : 0); }, 0);
    var alc = s.cpuAllocatable;
    var reqPct = alc > 0 ? (nsReq / alc * 100) : 0;
    document.getElementById('cpuReqV').textContent = nsReq + 'm';
    document.getElementById('cpuAlcV').textContent = alc + 'm';
    document.getElementById('effBig').textContent  = reqPct.toFixed(1) + '%';
    var rb = document.getElementById('cpuReqB');
    rb.style.width = Math.min(reqPct, 100) + '%';
    rb.style.background = reqPct > 85 ? 'var(--red)' : reqPct > 70 ? 'var(--orange)' : 'var(--cyan)';
    var cpuBadge = document.getElementById('cpubadge');
    cpuBadge.textContent = reqPct > 85 ? 'Critical' : reqPct > 70 ? 'High Load' : 'Optimal';
    cpuBadge.className   = 'badge ' + (reqPct > 85 ? 'b-crit' : reqPct > 70 ? 'b-warn' : 'b-ok');
    uDonut('cpuDonut', ['Requested','Free'],
      [nsReq, Math.max(0, alc - nsReq)], ['#00b4ff','#2d3347']);
  } catch(e) { console.error('updateCpuTile error:', e); }
}

async function updateMemTile() {
  try {
    var ns = tileNs.mem;
    var s = lastSummary || await (await fetchAuth('/api/summary')).json();
    var url = '/api/metrics?namespace=' + encodeURIComponent(ns);
    var m = await (await fetchAuth(url)).json();
    m = m || [];
    // memRequest per pod not in API yet — use memUsage as proxy when ns-filtered
    var nsMemUse = m.reduce(function(sum, p) { return sum + (p.memUsage || 0); }, 0);
    var alc = s.memAllocatable;
    var usePct = alc > 0 ? (nsMemUse / alc * 100) : 0;
    document.getElementById('memReqV').textContent  = nsMemUse + 'Mi';
    document.getElementById('memAlcV').textContent  = alc + 'Mi';
    document.getElementById('memEffBig').textContent = usePct.toFixed(1) + '%';
    var memBar = document.getElementById('memReqB');
    memBar.style.width      = Math.min(usePct, 100) + '%';
    memBar.style.background = usePct > 90 ? 'var(--red)' : usePct > 75 ? 'var(--orange)' : 'var(--purple)';
    var memBadge = document.getElementById('membadge');
    memBadge.textContent = usePct > 90 ? 'Critical' : usePct > 75 ? 'High' : 'Optimal';
    memBadge.className   = 'badge ' + (usePct > 90 ? 'b-crit' : usePct > 75 ? 'b-warn' : 'b-ok');
    uDonut('memDonut', ['Usage','Free'],
      [nsMemUse, Math.max(0, alc - nsMemUse)], ['#a855f7','#2d3347']);
  } catch(e) { console.error('updateMemTile error:', e); }
}

// ─── Drawer: Financial Correlation ────────────────────────────────────────────
var finopsDrawerRange = '';  // '' = follow activeRange

function openFinOpsDrawer() {
  finopsDrawerRange = activeRange;
  drawerSort = { col: '_idx', dir: 'desc' };
  openDrawer('Financial Correlation — FinOps Detail', renderFinOpsDrawer);
}

async function renderFinOpsDrawer() {
  try {
    var range = finopsDrawerRange || activeRange;
    var chartNs = tileNs.finops || activeNs;
    var showSys = document.getElementById('global-show-system') ? document.getElementById('global-show-system').checked : false;
    var url = '/api/history?range=' + range + '&system=' + showSys;
    if (chartNs) url += '&namespace=' + encodeURIComponent(chartNs);
    var h = await (await fetchAuth(url)).json();
    var fUrl = range !== 'custom' ? '/api/forecast?range=' + range + '&system=' + showSys + (chartNs ? '&namespace=' + encodeURIComponent(chartNs) : '') : null;
    var f = null;
    if (fUrl) { try { f = await (await fetchAuth(fUrl)).json(); } catch(e) { f = null; } }

    h = h || [];
    var totalBudget = h.reduce(function(s, p) { return s + p.reqCost; }, 0);
    var totalActual = h.reduce(function(s, p) { return s + p.useCost; }, 0);
    var totalWaste  = totalBudget - totalActual;
    var wastePct    = totalBudget > 0 ? (totalWaste / totalBudget * 100) : 0;

    var rangeOpts = [
      ['30m','30 min'],['1h','1 hour'],['6h','6 hours'],['24h','24 hours'],
      ['7d','7 days'],['30d','30 days'],['90d','90 days'],['365d','1 year']
    ].map(function(o) {
      return '<option value="' + o[0] + '"' + (range === o[0] ? ' selected' : '') + '>' + o[1] + '</option>';
    }).join('');

    var toolbar = '<div class="drawer-toolbar">' +
      '<button class="grade-info-btn" id="finops-info-btn">ⓘ What these metrics mean</button>' +
      '<div class="dtool-sep"></div>' +
      '<span class="dtool-label">Period</span>' +
      '<select class="dtool-select" id="dfinops-range">' + rangeOpts + '</select>' +
      '<div class="dtool-sep"></div>' +
      '<span class="drawer-count" id="dfinops-pts"></span>' +
    '</div>';

    var statsHtml = '<div class="drawer-stats">' +
      dstat('Total Budget', '$' + totalBudget.toFixed(4), 'var(--red)') +
      dstat('Total Actual', '$' + totalActual.toFixed(4), 'var(--green)') +
      dstat('Total Waste',  '$' + totalWaste.toFixed(4), wastePct > 40 ? 'var(--red)' : wastePct > 20 ? 'var(--orange)' : 'var(--yellow)') +
      dstat('Waste %', wastePct.toFixed(1) + '%', wastePct > 40 ? 'var(--red)' : wastePct > 20 ? 'var(--orange)' : 'var(--green)') +
    '</div>';

    var forecastHtml = '';
    if (f && f.length > 0) {
      var projBudget = f.reduce(function(s, p) { return s + p.reqCost; }, 0);
      var projUsage  = f.reduce(function(s, p) { return s + p.useCost; }, 0);
      var projWaste  = projBudget - projUsage;
      var projPct    = projBudget > 0 ? (projWaste / projBudget * 100) : 0;
      forecastHtml =
        '<div style="font-size:.72em;color:var(--text-dim);text-transform:uppercase;letter-spacing:.8px">Forecast (' + f[0].time + ' → ' + f[f.length-1].time + ')</div>' +
        '<div class="drawer-stats">' +
        dstat('Proj. Budget', '$' + projBudget.toFixed(4), 'var(--purple)') +
        dstat('Proj. Usage',  '$' + projUsage.toFixed(4),  'var(--cyan)') +
        dstat('Proj. Waste',  '$' + projWaste.toFixed(4) + ' (' + projPct.toFixed(0) + '%)', 'var(--orange)') +
        '</div>' +
        '<div style="font-size:.65em;color:var(--text-dim);text-align:center;margin-top:-6px;font-style:italic">Linear regression &bull; ±1.5σ confidence band</div>';
    }

    // Add computed fields + index for default sort (most recent first)
    var tableData = h.map(function(p, i) {
      return Object.assign({}, p, {
        _idx:     i,
        _waste:   p.reqCost - p.useCost,
        _wastePct: p.reqCost > 0 ? ((p.reqCost - p.useCost) / p.reqCost * 100) : 0
      });
    });

    // Sort
    var col = drawerSort.col || '_idx';
    var sortField = { 'time': 'time', 'reqCost': 'reqCost', 'useCost': 'useCost',
                      'waste': '_waste', 'wastePct': '_wastePct', '_idx': '_idx' }[col] || '_idx';
    tableData = sortData(tableData, sortField, drawerSort.dir);

    var rows = tableData.map(function(p) {
      var wc = p._wastePct > 40 ? 'var(--orange)' : p._wastePct > 20 ? 'var(--yellow)' : 'var(--text-dim)';
      return '<tr>' +
        '<td class="mono" style="color:var(--text-dim);font-size:.78em;white-space:nowrap">' + esc(p.time) + '</td>' +
        '<td class="mono" style="color:var(--red)">'    + p.reqCost.toFixed(6) + '</td>' +
        '<td class="mono" style="color:var(--green)">'  + p.useCost.toFixed(6) + '</td>' +
        '<td class="mono" style="color:' + wc + '">'   + p._waste.toFixed(6)  + '</td>' +
        '<td class="mono" style="color:' + wc + '">'   + p._wastePct.toFixed(1) + '%</td>' +
      '</tr>';
    }).join('');

    drawerHTML(toolbar + statsHtml + forecastHtml +
      '<div style="font-size:.72em;color:var(--text-dim);text-transform:uppercase;letter-spacing:.8px">Historical Data</div>' +
      '<div class="drawer-table-wrap"><table class="wtable"><thead><tr>' +
      makeSortHeader('Time', 'time', drawerSort) +
      '<th class="th-sort' + (drawerSort.col === 'reqCost' ? ' ' + drawerSort.dir : '') + '" data-col="reqCost" style="color:var(--red)">Budget ($)</th>' +
      '<th class="th-sort' + (drawerSort.col === 'useCost' ? ' ' + drawerSort.dir : '') + '" data-col="useCost" style="color:var(--green)">Actual ($)</th>' +
      '<th class="th-sort' + (drawerSort.col === 'waste'   ? ' ' + drawerSort.dir : '') + '" data-col="waste"   style="color:var(--orange)">Waste ($)</th>' +
      '<th class="th-sort' + (drawerSort.col === 'wastePct'? ' ' + drawerSort.dir : '') + '" data-col="wastePct">Waste %</th>' +
      '</tr></thead><tbody>' +
      (rows || '<tr><td colspan="5" style="text-align:center;color:var(--text-dim);padding:16px">No historical data for this range</td></tr>') +
      '</tbody></table></div>');

    document.getElementById('dfinops-pts').textContent = h.length + ' points';

    // Period selector → refetch drawer data + sync main chart
    document.getElementById('dfinops-range').addEventListener('change', function() {
      finopsDrawerRange = this.value;
      // sync range buttons on main panel
      activeRange = this.value;
      document.querySelectorAll('.range-btn').forEach(function(b) {
        b.classList.toggle('active', b.dataset.range === activeRange);
      });
      document.getElementById('custom-range-wrap').style.display = 'none';
      drawerSort = { col: '_idx', dir: 'desc' };
      renderFinOpsDrawer();
      fetchChart();
    });

    attachSortHandlers('', renderFinOpsDrawer);

    document.getElementById('finops-info-btn').addEventListener('click', function(e) {
      e.stopPropagation();
      var tip = document.getElementById('finops-legend-tip');
      if (!tip) return;
      if (tip.classList.contains('visible')) {
        tip.classList.remove('visible');
      } else {
        var rect = this.getBoundingClientRect();
        tip.style.top = (rect.bottom + 6) + 'px';
        tip.style.left = rect.left + 'px';
        tip.style.bottom = 'auto';
        tip.classList.add('visible');
        var tipRect = tip.getBoundingClientRect();
        if (tipRect.bottom > window.innerHeight - 10) {
          tip.style.top = (rect.top - tipRect.height - 6) + 'px';
        }
        if (tipRect.right > window.innerWidth - 10) {
          tip.style.left = (window.innerWidth - tipRect.width - 10) + 'px';
        }
      }
    });
  } catch(e) { drawerHTML('<div style="color:var(--red);padding:20px">Error loading FinOps data: ' + esc(e.message) + '</div>'); }
}

// ─── Workloads tab ────────────────────────────────────────────────────────────
async function updateWorkloads() {
  try {
    var data = await (await fetchAuth(apiUrl('/api/workloads'))).json();
    data = data || [];
    document.getElementById('wl-count').textContent = data.length + ' workload' + (data.length !== 1 ? 's' : '');
    if (data.length === 0) {
      document.getElementById('wl-body').innerHTML =
        '<tr><td colspan="7" style="text-align:center;color:var(--text-dim);padding:20px">No workloads found</td></tr>';
      return;
    }
    var rows = '';
    data.forEach(function(w) {
      var allReady = w.ready >= w.desired;
      var statusBadge = allReady
        ? '<span class="badge b-ok">Ready</span>'
        : '<span class="badge b-warn">' + w.ready + '/' + w.desired + '</span>';
      var kindColor = w.kind === 'Deployment' ? 'var(--cyan)' : 'var(--purple)';
      rows += '<tr>' +
        '<td class="mono" style="font-weight:600;color:var(--text-bright)">' + esc(w.name) + '</td>' +
        '<td><span class="ns-tag">' + esc(w.namespace) + '</span></td>' +
        '<td><span style="color:' + kindColor + ';font-size:.78em;font-weight:600">' + esc(w.kind) + '</span></td>' +
        '<td class="mono">' + w.ready + '/' + w.desired + '</td>' +
        '<td class="mono" style="color:var(--text-dim);font-size:.78em;max-width:220px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="' + esc(w.image) + '">' + esc(w.image) + '</td>' +
        '<td style="color:var(--text-dim)">' + esc(w.age) + '</td>' +
        '<td>' + statusBadge + '</td>' +
        '</tr>';
    });
    document.getElementById('wl-body').innerHTML = rows;
  } catch(e) {
    console.error('updateWorkloads error:', e);
    document.getElementById('wl-body').innerHTML =
      '<tr><td colspan="7" style="text-align:center;color:var(--red);padding:20px">Error loading workloads</td></tr>';
  }
}

// ─── Pods tab ─────────────────────────────────────────────────────────────────
async function updatePods() {
  try {
    var data = await (await fetchAuth(apiUrl('/api/pods'))).json();
    data = data || [];
    document.getElementById('pod-count').textContent = data.length + ' pod' + (data.length !== 1 ? 's' : '');
    if (data.length === 0) {
      document.getElementById('pod-body').innerHTML =
        '<tr><td colspan="8" style="text-align:center;color:var(--text-dim);padding:20px">No pods found</td></tr>';
      return;
    }
    var rows = '';
    data.forEach(function(p) {
      var phaseColor = p.phase === 'Running' ? 'var(--green)' :
                       p.phase === 'Pending' ? 'var(--orange)' :
                       p.phase === 'Succeeded' ? 'var(--cyan)' : 'var(--red)';
      var restartColor = p.restarts > 10 ? 'var(--orange)' : 'var(--text-dim)';
      rows += '<tr>' +
        '<td class="mono" style="font-weight:600;color:var(--text-bright);max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="' + esc(p.name) + '">' + esc(p.name) + '</td>' +
        '<td><span class="ns-tag">' + esc(p.namespace) + '</span></td>' +
        '<td><span style="color:' + phaseColor + ';font-weight:600;font-size:.82em">' + esc(p.phase) + '</span></td>' +
        '<td class="mono" style="color:var(--text-dim)">' + esc(p.ready) + '</td>' +
        '<td class="mono" style="color:' + restartColor + '">' + p.restarts + '</td>' +
        '<td style="color:var(--text-dim);font-size:.82em">' + esc(p.node) + '</td>' +
        '<td style="color:var(--text-dim)">' + esc(p.age) + '</td>' +
        '<td><button class="btn-logs" data-ns="' + esc(p.namespace) + '" data-name="' + esc(p.name) + '">Logs</button></td>' +
        '</tr>';
    });
    document.getElementById('pod-body').innerHTML = rows;
    // attach log button events
    document.querySelectorAll('.btn-logs').forEach(function(btn) {
      btn.addEventListener('click', function() {
        openLogs(btn.dataset.ns, btn.dataset.name);
      });
    });
  } catch(e) {
    console.error('updatePods error:', e);
    document.getElementById('pod-body').innerHTML =
      '<tr><td colspan="8" style="text-align:center;color:var(--red);padding:20px">Error loading pods</td></tr>';
  }
}

// ─── Log modal ────────────────────────────────────────────────────────────────
function openLogs(ns, name) {
  logTarget = { namespace: ns, name: name };
  document.getElementById('log-modal-title').textContent = name + '  (' + ns + ')';
  document.getElementById('log-content').textContent = 'Loading...';
  document.getElementById('log-modal').style.display = 'flex';
  fetchLogs();
}

async function fetchLogs() {
  if (!logTarget) return;
  var pre = document.getElementById('log-content');
  pre.textContent = 'Loading...';
  try {
    var resp = await fetchAuth('/api/pods/' + encodeURIComponent(logTarget.namespace) + '/' + encodeURIComponent(logTarget.name) + '/logs');
    var text = await resp.text();
    pre.textContent = text || '(no log output)';
    pre.scrollTop = pre.scrollHeight;
  } catch(e) {
    pre.textContent = 'Error fetching logs: ' + e.message;
  }
}

function closeLogs() {
  logTarget = null;
  document.getElementById('log-modal').style.display = 'none';
}

// ─── Master update loop ───────────────────────────────────────────────────────
// ─── Namespace Efficiency ─────────────────────────────────────────────────────
// Sort pattern for inline panel tables: each panel owns its sort state.
// Convention: { col: '<field>', dir: 'asc'|'desc' }
// Use attachPanelSortHandlers(headerId, sortState, renderFn) to wire up.
var lastEfficiency = [];
var effSort = { col: 'score', dir: 'asc' }; // asc = worst first

function closeGradeLegend() {
  var tip = document.getElementById('grade-legend-tip');
  if (tip) tip.classList.remove('visible');
}
function toggleGradeLegend() {
  var tip = document.getElementById('grade-legend-tip');
  var btn = document.getElementById('grade-info-btn');
  if (!tip) return;
  if (tip.classList.contains('visible')) { closeGradeLegend(); return; }
  if (btn) {
    var rect = btn.getBoundingClientRect();
    // default: open below the button
    tip.style.top    = (rect.bottom + 6) + 'px';
    tip.style.left   = rect.left + 'px';
    tip.style.bottom = 'auto';
    tip.classList.add('visible');
    // after render, check if clipped below viewport and flip above
    var tipRect = tip.getBoundingClientRect();
    if (tipRect.bottom > window.innerHeight - 10) {
      tip.style.top = (rect.top - tipRect.height - 6) + 'px';
    }
    // check if clipped on the right
    tipRect = tip.getBoundingClientRect();
    if (tipRect.right > window.innerWidth - 10) {
      tip.style.left = (window.innerWidth - tipRect.width - 10) + 'px';
    }
  }
}
// Close legend on outside click or any scroll
document.addEventListener('click', function(e) {
  var tip = document.getElementById('grade-legend-tip');
  if (tip && tip.classList.contains('visible')) {
    if (!document.getElementById('grade-info-btn').contains(e.target)) {
      closeGradeLegend();
    }
  }
  var ftip = document.getElementById('finops-legend-tip');
  if (ftip && ftip.classList.contains('visible')) {
    var btn = document.getElementById('finops-info-btn');
    if (!btn || !btn.contains(e.target)) {
      ftip.classList.remove('visible');
    }
  }
});
window.addEventListener('scroll', function() {
  var ftip = document.getElementById('finops-legend-tip');
  if (ftip) ftip.classList.remove('visible');
  closeGradeLegend();
}, true);

function gradeColor(g) {
  return g === 'A' ? 'var(--green)' : g === 'B' ? 'var(--cyan)' : g === 'C' ? '#fbbf24' : g === 'D' ? '#f97316' : 'var(--red)';
}
var _GRADE_BADGE = {
  'A': {c:'#00cc8f',bg:'rgba(0,204,143,.14)',br:'rgba(0,204,143,.28)'},
  'B': {c:'#00b4ff',bg:'rgba(0,180,255,.14)',br:'rgba(0,180,255,.28)'},
  'C': {c:'#fbbf24',bg:'rgba(251,191,36,.14)',br:'rgba(251,191,36,.28)'},
  'D': {c:'#f97316',bg:'rgba(249,115,22,.14)',br:'rgba(249,115,22,.28)'},
  'F': {c:'#e54949',bg:'rgba(229,73,73,.14)', br:'rgba(229,73,73,.28)'},
  'UNMANAGED': {c:'#a855f7',bg:'rgba(168,85,247,.14)',br:'rgba(168,85,247,.28)'}
};
function gradeBadgeStyle(g) {
  var t = _GRADE_BADGE[g] || _GRADE_BADGE['F'];
  return 'background:'+t.bg+';color:'+t.c+';border:1px solid '+t.br+';';
}

// Generic sort handler for inline panel tables.
// headerId: id of <tr> containing <th class="th-sort" data-col="...">
// sortState: { col, dir } mutated in place
// renderFn: re-render callback (no fetch)
function attachPanelSortHandlers(headerId, sortState, renderFn) {
  var head = document.getElementById(headerId);
  if (!head) return;
  head.querySelectorAll('.th-sort').forEach(function(th) {
    th.addEventListener('click', function() {
      var col = th.dataset.col;
      if (sortState.col === col) {
        sortState.dir = sortState.dir === 'asc' ? 'desc' : 'asc';
      } else {
        sortState.col = col;
        sortState.dir = col === 'namespace' || col === 'grade' ? 'asc' : 'desc';
      }
      renderFn();
    });
  });
}

function updateEffSortHeaders() {
  var head = document.getElementById('eff-thead');
  if (!head) return;
  head.querySelectorAll('.th-sort').forEach(function(th) {
    th.classList.remove('asc', 'desc');
    if (th.dataset.col === effSort.col) th.classList.add(effSort.dir);
  });
}

function renderEfficiencyRows() {
  var tbody = document.getElementById('eff-ns-body');
  if (!tbody || !lastEfficiency.length) return;

  var sorted = sortData(lastEfficiency, effSort.col, effSort.dir);
  tbody.innerHTML = sorted.map(function(ns) {
    var barColor = gradeColor(ns.grade);
    var cpuPct   = ns.cpuRequest > 0 ? ns.cpuScore : 0;
    var memPct   = ns.memRequest > 0 ? Math.min(ns.memScore, 100) : 0;
    var cpuColor = cpuPct >= 75 ? 'var(--green)' : cpuPct >= 40 ? 'var(--cyan)' : 'var(--orange)';
    var memColor = memPct >= 75 ? 'var(--green)' : memPct >= 40 ? 'var(--purple)' : 'var(--orange)';
    var noReq    = ns.cpuRequest === 0 && ns.memRequest === 0;
    var noMem    = ns.memRequest === 0;
    var noCpu    = ns.cpuRequest === 0;
    return '<tr class="eff-clickable-row" data-ns="'+esc(ns.namespace)+'">' +
      '<td><span class="ns-tag">'+esc(ns.namespace)+'</span></td>' +
      '<td><div class="eff-bar-cell">' +
        '<div class="eff-score-track"><div class="eff-bar" style="width:'+(noReq?'0':ns.score.toFixed(1))+'%;background:'+barColor+'"></div></div>' +
        '<span class="eff-pct" style="color:'+barColor+'">'+ns.score.toFixed(0)+'%</span>' +
      '</div></td>' +
      '<td><div class="eff-bar-cell">' +
        '<div class="eff-mini-track"><div class="eff-mini-fill" style="width:'+cpuPct.toFixed(1)+'%;background:'+cpuColor+'"></div></div>' +
        '<span class="eff-pct" style="color:'+(noCpu?'var(--text-dim)':cpuColor)+'">'+cpuPct.toFixed(0)+'%</span>' +
        (noCpu ? '<span style="font-size:.7em;color:var(--text-dim);margin-left:4px">no req</span>' : '') +
      '</div></td>' +
      '<td><div class="eff-bar-cell">' +
        '<div class="eff-mini-track"><div class="eff-mini-fill" style="width:'+memPct.toFixed(1)+'%;background:'+memColor+'"></div></div>' +
        '<span class="eff-pct" style="color:'+(noMem?'var(--text-dim)':memColor)+'">'+memPct.toFixed(0)+'%</span>' +
        (noMem ? '<span style="font-size:.7em;color:var(--text-dim);margin-left:4px">no req</span>' : '') +
      '</div></td>' +
      '<td class="td-c">'+(ns.unmanaged
        ? '<span class="eff-unmanaged">UNMANAGED</span>'
        : '<span class="eff-grade '+esc(ns.grade)+'">'+esc(ns.grade)+'</span>')+'</td>' +
    '</tr>';
  }).join('');

  updateEffSortHeaders();
  tbody.querySelectorAll('.eff-clickable-row').forEach(function(row) {
    row.addEventListener('click', function() { openEfficiencyDrawer(row.dataset.ns); });
  });
}

async function updateEfficiency() {
  try {
    var showSystem = document.getElementById('eff-show-system');
    var inclSystem = showSystem && showSystem.checked;
    var url = '/api/efficiency' + (inclSystem ? '?system=true' : '');
    var data = await (await fetchAuth(url)).json();
    lastEfficiency = data || [];

    var viewNs = tileNs.eff || activeNs;
    if (viewNs) {
      lastEfficiency = lastEfficiency.filter(function(n) { return n.namespace === viewNs; });
    }

    var tbody = document.getElementById('eff-ns-body');
    var badge = document.getElementById('eff-badge');
    var unmBadge = document.getElementById('eff-unmanaged-badge');

    if (!lastEfficiency.length) {
      if (tbody) tbody.innerHTML = '<tr><td colspan="5" style="color:var(--text-dim);padding:16px;font-size:.84em">No data</td></tr>';
      return;
    }

    // Count unmanaged (non-system) namespaces
    var unmanagedCount = lastEfficiency.filter(function(n){ return n.unmanaged && !n.isSystem; }).length;
    if (unmBadge) {
      if (unmanagedCount > 0) {
        unmBadge.textContent = unmanagedCount + ' without resource limits';
        unmBadge.style.display = '';
      } else {
        unmBadge.style.display = 'none';
      }
    }

    // Badge: worst managed namespace by score
    var managed = lastEfficiency.filter(function(n){ return !n.unmanaged; });
    if (badge) {
      if (managed.length) {
        var worst = managed[0];
        badge.textContent = 'Worst: ' + worst.namespace + ' — ' + worst.grade;
        badge.className = 'badge';
        badge.style.cssText = gradeBadgeStyle(worst.grade);
      } else {
        badge.textContent = lastEfficiency.length + ' namespaces';
        badge.className = 'badge b-warn';
      }
    }

    // ── Compact donut (eff-panel-compact) ─────────────────────────────
    var grades = ['A','B','C','D','F','UNMANAGED'];
    var gradeColorsHex = ['#00cc8f','#00b4ff','#fbbf24','#f97316','#e54949','#a855f7'];
    var gCount = {A:0,B:0,C:0,D:0,F:0,UNMANAGED:0};
    var totalScore = 0, scoredCount = 0;
    lastEfficiency.forEach(function(n) {
      if (n.grade === 'UNMANAGED' || n.unmanaged) gCount.UNMANAGED++;
      else if (gCount[n.grade] !== undefined) gCount[n.grade]++;
      if (!n.unmanaged && n.score > 0) { totalScore += n.score; scoredCount++; }
    });
    var donutLabels = grades.filter(function(g){ return gCount[g] > 0; });
    var donutData = donutLabels.map(function(g){ return gCount[g]; });
    var donutColors = donutLabels.map(function(g){ return gradeColorsHex[grades.indexOf(g)]; });
    uDonut('effDonut', donutLabels, donutData, donutColors);
    uDonut('effDonut2', donutLabels, donutData, donutColors);

    var avgScore = scoredCount > 0 ? (totalScore / scoredCount) : 0;
    var avgEl = document.getElementById('eff-avg-score');
    if (avgEl) avgEl.textContent = avgScore.toFixed(0) + '%';
    var avgEl2 = document.getElementById('eff-avg-score2');
    if (avgEl2) avgEl2.textContent = avgScore.toFixed(0) + '%';

    var legendEl = document.getElementById('eff-donut-legend');
    if (legendEl) {
      legendEl.innerHTML = donutLabels.map(function(g) {
        return '<div class="edl"><b class="edl-dot" style="background:' + gradeColorsHex[grades.indexOf(g)] + '"></b><span class="edl-name">' + g + '</span><span class="edl-val">' + gCount[g] + '</span></div>';
      }).join('');
    }
    var legendEl2 = document.getElementById('eff-donut-legend2');
    if (legendEl2) {
      legendEl2.innerHTML = donutLabels.map(function(g) {
        return '<div class="edl"><b class="edl-dot" style="background:' + gradeColorsHex[grades.indexOf(g)] + '"></b><span class="edl-name">' + g + '</span><span class="edl-val">' + gCount[g] + '</span></div>';
      }).join('');
    }

    var worstEl = document.getElementById('eff-worst');
    if (worstEl) {
      var worst2 = managed.slice(0, 2);
      if (worst2.length) {
        worstEl.innerHTML = '<span style="color:var(--text-dim)">Worst: </span>' + worst2.map(function(n) {
          return '<span class="ns-tag" style="margin-left:4px">' + n.namespace + ' <span style="color:' + (gradeColorsHex[grades.indexOf(n.grade)] || 'var(--text-dim)') + '">' + n.score.toFixed(0) + '%</span></span>';
        }).join('');
      } else {
        worstEl.innerHTML = '';
      }
    }
    var worstEl2 = document.getElementById('eff-worst2');
    if (worstEl2) {
      var worst3 = managed.slice(0, 3);
      if (worst3.length) {
        worstEl2.innerHTML = '<span style="color:var(--text-dim)">Worst: </span>' + worst3.map(function(n) {
          return '<span class="ns-tag" style="margin-left:4px">' + n.namespace + ' <span style="color:' + (gradeColorsHex[grades.indexOf(n.grade)] || 'var(--text-dim)') + '">' + n.score.toFixed(0) + '% ' + n.grade + '</span></span>';
        }).join('');
      } else {
        worstEl2.innerHTML = '';
      }
    }

    if (tbody) {
      renderEfficiencyRows();
      attachPanelSortHandlers('eff-thead', effSort, renderEfficiencyRows);
    }
  } catch(e) { console.error('efficiency update error:', e); }
}

function openEfficiencyDrawer(focusNs) {
  openDrawer('Namespace Efficiency — Detail', function() { renderEfficiencyDrawer(focusNs); });
}

function renderEfficiencyDrawer(focusNs) {
  var data = lastEfficiency;
  if (!data || !data.length) {
    drawerHTML('<div style="color:var(--text-dim);padding:20px">No efficiency data available.</div>');
    return;
  }

  var avgScore = data.reduce(function(s, n){ return s + n.score; }, 0) / data.length;
  var worstNs  = data[0];
  var bestNs   = data[data.length - 1];

  var stats = '<div class="drawer-stats" style="margin-bottom:14px">' +
    dstat('Namespaces', data.length, 'var(--cyan)') +
    dstat('Avg Score', avgScore.toFixed(1) + '%', avgScore >= 60 ? 'var(--green)' : avgScore >= 30 ? 'var(--orange)' : 'var(--red)') +
    dstat('Worst', worstNs.namespace + ' (' + worstNs.grade + ')', gradeColor(worstNs.grade)) +
    dstat('Best', bestNs.namespace + ' (' + bestNs.grade + ')', gradeColor(bestNs.grade)) +
  '</div>';

  var note = '<div style="font-size:.72em;color:var(--text-dim);margin-bottom:10px;font-family:\'JetBrains Mono\',monospace">' +
    'Score = actual usage / requested resources &bull; 100% = perfectly provisioned &bull; sorted worst → best</div>';

  var rows = data.map(function(ns) {
    var isFocus = ns.namespace === focusNs;
    var gc = gradeColor(ns.grade);
    var cpuInfo = ns.cpuRequest > 0
      ? ns.cpuUsage + 'm / ' + ns.cpuRequest + 'm'
      : ns.cpuUsage + 'm (no req)';
    var memInfo = ns.memRequest > 0
      ? ns.memUsage + 'Mi / ' + ns.memRequest + 'Mi'
      : ns.memUsage + 'Mi (no req)';
    return '<tr'+(isFocus?' style="background:rgba(0,180,255,.06)"':'')+'>'+
      '<td><span class="ns-tag">'+esc(ns.namespace)+'</span></td>'+
      '<td class="mono" style="color:var(--text-dim)">'+ns.podCount+'</td>'+
      '<td class="mono" style="font-size:.78em;color:var(--text-dim)">'+cpuInfo+'</td>'+
      '<td class="mono" style="color:var(--cyan)">'+ns.cpuScore.toFixed(1)+'%</td>'+
      '<td class="mono" style="font-size:.78em;color:var(--text-dim)">'+memInfo+'</td>'+
      '<td class="mono" style="color:var(--purple)">'+ns.memScore.toFixed(1)+'%</td>'+
      '<td class="mono" style="font-weight:700;color:'+gc+'">'+ns.score.toFixed(1)+'%</td>'+
      '<td><span class="eff-grade '+ns.grade+'">'+ns.grade+'</span></td>'+
    '</tr>';
  }).join('');

  drawerHTML(stats + note +
    '<div class="drawer-table-wrap"><table class="wtable"><thead><tr>' +
    '<th>Namespace</th><th>Pods</th><th>CPU (use/req)</th><th>CPU Score</th>' +
    '<th>Mem (use/req)</th><th>Mem Score</th><th>Overall</th><th>Grade</th>' +
    '</tr></thead><tbody>' + rows + '</tbody></table></div>');
}

function update() {
  if (activeTab === 'overview') { updateOverview(); updateEfficiency(); }
  if (activeTab === 'workloads') updateWorkloads();
  if (activeTab === 'pods') updatePods();
  updateSpillTip(); // keep session uptime current on every tick
}

// ─── Bootstrap ────────────────────────────────────────────────────────────────
document.querySelectorAll('.tab-btn').forEach(function(btn) {
  btn.addEventListener('click', function() { switchTab(btn.dataset.tab); });
});

var _workloadsSysToggle = document.getElementById('workloads-show-system');
if (_workloadsSysToggle) _workloadsSysToggle.addEventListener('change', function() {
  renderDropdowns();
  updateWorkloads();
});

var _eventsSysToggle = document.getElementById('events-show-system');
if (_eventsSysToggle) _eventsSysToggle.addEventListener('change', function() {
  renderDropdowns();
  renderOverviewEvents();
});

var _eventsNsSelect = document.getElementById('tile-ns-events');
if (_eventsNsSelect) _eventsNsSelect.addEventListener('change', function() {
  renderOverviewEvents();
});

var _globalSysToggle = document.getElementById('global-show-system');
if (_globalSysToggle) _globalSysToggle.addEventListener('change', function() {
  renderDropdowns();
  if (sysNsList.indexOf(activeNs) !== -1 && !_globalSysToggle.checked) {
    activeNs = '';
    var nsSel = document.getElementById('nsFilter');
    if (nsSel) nsSel.value = '';
  }
  update();
  fetchChart();
});

document.getElementById('nsFilter').addEventListener('change', function() {
  activeNs = this.value;
  update();
  fetchChart();
});

// ─── Range preset buttons ─────────────────────────────────────────────────────
document.querySelectorAll('.range-btn').forEach(function(btn) {
  btn.addEventListener('click', function() {
    var range = btn.dataset.range;
    document.querySelectorAll('.range-btn').forEach(function(b) { b.classList.remove('active'); });
    btn.classList.add('active');
    activeRange = range;
    var cw = document.getElementById('custom-range-wrap');
    if (range === 'custom') {
      cw.style.display = 'flex';
    } else {
      cw.style.display = 'none';
      fetchChart();
    }
  });
});

document.getElementById('customApply').addEventListener('click', function() {
  customFrom = document.getElementById('customFrom').value;
  customTo   = document.getElementById('customTo').value;
  if (!customFrom || !customTo) return;
  fetchChart();
});

document.getElementById('log-modal-close').addEventListener('click', closeLogs);
document.getElementById('log-refresh-btn').addEventListener('click', fetchLogs);
document.getElementById('log-modal').addEventListener('click', function(e) {
  if (e.target === this) closeLogs();
});
document.addEventListener('keydown', function(e) {
  if (e.key === 'Escape') closeLogs();
});

// ─── Drawer engine ────────────────────────────────────────────────────────────
var drawerOpen = false;

function openDrawer(title, renderFn) {
  document.getElementById('drawer-title').textContent = title;
  document.getElementById('drawer-body').innerHTML = '<div style="color:var(--text-dim);font-size:.84em;padding:20px 0">Loading...</div>';
  document.getElementById('detail-drawer').classList.add('open');
  document.getElementById('drawer-overlay').classList.add('open');
  document.body.style.overflow = 'hidden';
  drawerOpen = true;
  renderFn();
}

function closeDrawer() {
  document.getElementById('detail-drawer').classList.remove('open');
  document.getElementById('drawer-overlay').classList.remove('open');
  document.body.style.overflow = '';
  drawerOpen = false;
}

function drawerHTML(html) {
  document.getElementById('drawer-body').innerHTML = html;
}

// sort state per drawer
var drawerSort = { col: null, dir: 'desc' };

// system namespaces — same list as Go agent
var _SYSTEM_NS = {
  'kube-system':1,'kube-public':1,'kube-node-lease':1,
  'kubernetes-dashboard':1,'cert-manager':1,'ingress-nginx':1,
  'monitoring':1,'cattle-system':1,'gatekeeper-system':1
};

function makeSortHeader(th, col, currentSort) {
  var cls = '';
  if (currentSort.col === col) cls = currentSort.dir;
  return '<th class="th-sort ' + cls + '" data-col="' + col + '">' + th + '</th>';
}

function sortData(arr, col, dir) {
  return arr.slice().sort(function(a, b) {
    var av = a[col], bv = b[col];
    if (av === undefined || av === null) av = '';
    if (bv === undefined || bv === null) bv = '';
    if (typeof av === 'string') av = av.toLowerCase();
    if (typeof bv === 'string') bv = bv.toLowerCase();
    if (av < bv) return dir === 'asc' ? -1 : 1;
    if (av > bv) return dir === 'asc' ? 1 : -1;
    return 0;
  });
}

function attachSortHandlers(tbodyId, renderFn) {
  document.querySelectorAll('#detail-drawer .th-sort').forEach(function(th) {
    th.addEventListener('click', function() {
      var col = th.dataset.col;
      if (drawerSort.col === col) {
        drawerSort.dir = drawerSort.dir === 'desc' ? 'asc' : 'desc';
      } else {
        drawerSort.col = col;
        drawerSort.dir = 'desc';
      }
      renderFn();
    });
  });
}

// ─── Drawer: Node Health Map ───────────────────────────────────────────────────
function openNodeDrawer() {
  openDrawer('Node Health Map — Detail', renderNodeDrawer);
}

async function renderNodeDrawer() {
  try {
    var s = await (await fetchAuth('/api/summary')).json();
    var m = await (await fetchAuth('/api/metrics')).json();
    var nodes = s.nodes || [];
    var pods  = s.podsByPhase || {};
    var totalPods = Object.values(pods).reduce(function(a,b){return a+b;},0);
    var reqPct = s.cpuAllocatable > 0 ? (s.cpuRequested / s.cpuAllocatable * 100) : 0;

    var nodeInfoCard =
      '<button class="grade-info-btn" id="node-info-btn" style="margin-bottom:8px">ⓘ What these metrics mean</button>' +
      '<div id="node-info-card" style="display:none;background:var(--surface2);border:1px solid var(--border);border-radius:8px;padding:14px 16px;margin-bottom:12px;font-size:.82em;line-height:1.6">' +
        '<div class="gl-title" style="margin-bottom:8px">Node Health Map — metric glossary</div>' +
        '<div class="gl-row"><span style="color:var(--cyan);font-weight:600;min-width:160px">Total Nodes</span><span class="gl-desc">Number of worker nodes registered and reporting to the cluster.</span></div>' +
        '<div class="gl-row"><span style="color:var(--green);font-weight:600;min-width:160px">Total Pods</span><span class="gl-desc">All pods across all namespaces and phases (Running, Pending, etc.).</span></div>' +
        '<div class="gl-row"><span style="color:var(--orange);font-weight:600;min-width:160px">CPU Requested</span><span class="gl-desc">Total CPU reserved by all pods via <code>resources.requests.cpu</code>. What the scheduler has committed.</span></div>' +
        '<div class="gl-row"><span style="color:var(--text-bright);font-weight:600;min-width:160px">CPU Allocatable</span><span class="gl-desc">Node capacity minus OS/kubelet overhead. The real scheduling budget.</span></div>' +
        '<div class="gl-row"><span style="color:var(--purple);font-weight:600;min-width:160px">Memory Requested</span><span class="gl-desc">Total memory reserved across all pods. High values risk OOM evictions.</span></div>' +
        '<div class="gl-row" style="border-bottom:none"><span style="color:var(--cyan);font-weight:600;min-width:160px">Efficiency</span><span class="gl-desc">Actual CPU usage ÷ CPU requested. Low = over-provisioned; high (&gt;85%) = risk of throttling.</span></div>' +
      '</div>';

    var statsHtml = '<div class="drawer-stats">' +
      dstat('Total Nodes', nodes.length, 'var(--cyan)') +
      dstat('Total Pods', totalPods, 'var(--green)') +
      dstat('CPU Requested', s.cpuRequested + 'm', 'var(--orange)') +
      dstat('CPU Allocatable', s.cpuAllocatable + 'm', 'var(--text-bright)') +
      dstat('Memory Requested', s.memRequested + 'Mi', 'var(--purple)') +
      dstat('Efficiency', s.efficiency.toFixed(1) + '%', s.efficiency > 85 ? 'var(--red)' : s.efficiency > 70 ? 'var(--orange)' : 'var(--cyan)') +
    '</div>';

    var nodeCards = nodes.map(function(n) {
      var isOk = n.status === 'Running';
      var color = isOk ? 'var(--green)' : 'var(--red)';
      return '<div class="pod-detail-card">' +
        '<div class="pod-detail-row"><span class="pod-detail-label">Node</span><span class="pod-detail-val" style="color:var(--cyan)">' + esc(n.name) + '</span></div>' +
        '<div class="pod-detail-row"><span class="pod-detail-label">Status</span><span class="pod-detail-val" style="color:' + color + '">' + esc(n.status) + '</span></div>' +
        '<div class="pod-detail-row"><span class="pod-detail-label">CPU Requested</span>' +
          '<span class="pod-detail-val">' + s.cpuRequested + 'm / ' + s.cpuAllocatable + 'm</span>' +
          '<div class="pod-detail-bar" style="max-width:200px"><div class="pod-detail-fill" style="width:' + Math.min(reqPct,100).toFixed(1) + '%;background:var(--cyan)"></div></div>' +
        '</div>' +
        '<div class="pod-detail-row"><span class="pod-detail-label">Memory Requested</span>' +
          '<span class="pod-detail-val">' + s.memRequested + 'Mi / ' + s.memAllocatable + 'Mi</span>' +
          '<div class="pod-detail-bar" style="max-width:200px"><div class="pod-detail-fill" style="width:' + Math.min(s.memAllocatable>0?s.memRequested/s.memAllocatable*100:0,100).toFixed(1) + '%;background:var(--purple)"></div></div>' +
        '</div>' +
      '</div>';
    }).join('');

    // Top pods on this node
    var topPods = (m || []).slice(0,8);
    var podRows = topPods.map(function(p,i) {
      var pct = p.cpuRequestPresent && p.cpuRequest > 0 ? (p.cpuUsage / p.cpuRequest * 100) : 0;
      return '<tr><td class="mono">' + (i+1) + '</td>' +
        '<td class="mono" style="color:var(--text-bright)">' + esc(p.name||'--') + '</td>' +
        '<td><span class="ns-tag">' + esc(p.namespace||'--') + '</span></td>' +
        '<td class="mono" style="color:var(--cyan)">' + p.cpuUsage + 'm</td>' +
        '<td class="mono" style="color:var(--text-dim)">' + (p.cpuRequestPresent ? p.cpuRequest+'m' : 'N/A') + '</td>' +
        '<td class="mono" style="color:' + (pct>85?'var(--red)':pct>70?'var(--orange)':'var(--green)') + '">' + pct.toFixed(0) + '%</td></tr>';
    }).join('');

    drawerHTML(nodeInfoCard + statsHtml + nodeCards +
      '<div style="font-size:.72em;color:var(--text-dim);text-transform:uppercase;letter-spacing:.8px;margin-top:4px">Top Pods by CPU</div>' +
      '<div class="drawer-table-wrap"><table class="wtable"><thead><tr><th>#</th><th>Pod</th><th>Namespace</th><th>CPU Usage</th><th>CPU Request</th><th>Utilization</th></tr></thead>' +
      '<tbody>' + (podRows || '<tr><td colspan="6" style="text-align:center;color:var(--text-dim);padding:16px">No data</td></tr>') + '</tbody></table></div>');

    document.getElementById('node-info-btn').addEventListener('click', function() {
      var c = document.getElementById('node-info-card');
      if (c) c.style.display = c.style.display === 'none' ? '' : 'none';
    });
  } catch(e) { drawerHTML('<div style="color:var(--red);padding:20px">Error loading node data: ' + esc(e.message) + '</div>'); }
}

// ─── Drawer: Pod Distribution ─────────────────────────────────────────────────
function openPodDrawer() {
  drawerSort = { col: 'phase', dir: 'asc' };
  openDrawer('Pod Distribution — Detail', renderPodDrawer);
}

async function renderPodDrawer() {
  try {
    var all = await (await fetchAuth('/api/pods')).json();
    all = all || [];

    // inherit tile NS on first render; drawer dropdown overrides on subsequent renders
    var nsFilter  = document.getElementById('dfilter-pod-ns')     ? document.getElementById('dfilter-pod-ns').value     : (tileNs.pods || '');
    var filterVal = document.getElementById('dfilter-pod-phase')  ? document.getElementById('dfilter-pod-phase').value  : '';
    var searchVal = document.getElementById('dfilter-pod-search') ? document.getElementById('dfilter-pod-search').value.toLowerCase() : '';
    var showSysNs = document.getElementById('pod-show-system')    ? document.getElementById('pod-show-system').checked  : false;

    // NS dropdown options (built from all pods, regardless of filters)
    var nsSet = {};
    all.forEach(function(p){ nsSet[p.namespace] = 1; });
    var nsOpts = '<option value=""' + (!nsFilter ? ' selected' : '') + '>All Namespaces</option>' +
      Object.keys(nsSet).sort().map(function(ns){
        return '<option value="'+esc(ns)+'"'+(nsFilter===ns?' selected':'')+'>'+esc(ns)+'</option>';
      }).join('');

    // view: apply NS + system filters (stats + table use this)
    var dataView = all.filter(function(p) {
      return (!nsFilter || p.namespace === nsFilter) && (showSysNs || !_SYSTEM_NS[p.namespace]);
    });

    // stats from view
    var phases = {};
    dataView.forEach(function(p){ phases[p.phase] = (phases[p.phase]||0)+1; });
    var statsHtml = '<div class="drawer-stats">' + dstat('Total Pods', dataView.length, 'var(--text-bright)');
    Object.keys(phases).forEach(function(ph) {
      var c = ph === 'Running' ? 'var(--green)' : ph === 'Pending' ? 'var(--orange)' : ph === 'Succeeded' ? 'var(--cyan)' : 'var(--red)';
      statsHtml += dstat(ph, phases[ph], c);
    });
    statsHtml += '</div>';

    var phaseOpts = '<option value="">All Phases</option>' +
      Object.keys(phases).map(function(ph){ return '<option value="'+ph+'"'+(filterVal===ph?' selected':'')+'>'+esc(ph)+'</option>'; }).join('');

    var toolbar = '<div class="drawer-toolbar">' +
      '<span class="dtool-label">Namespace</span>' +
      '<select class="dtool-select" id="dfilter-pod-ns">' + nsOpts + '</select>' +
      '<div class="dtool-sep"></div>' +
      '<span class="dtool-label">Phase</span>' +
      '<select class="dtool-select" id="dfilter-pod-phase">' + phaseOpts + '</select>' +
      '<div class="dtool-sep"></div>' +
      '<span class="dtool-label">Search</span>' +
      '<input class="dtool-input" id="dfilter-pod-search" placeholder="pod name..." value="' + esc(searchVal) + '">' +
      '<span class="drawer-count" id="dpod-count"></span>' +
      '<div class="dtool-sep"></div>' +
      '<label style="display:flex;align-items:center;gap:6px;font-size:.75em;color:var(--text-dim);cursor:pointer">' +
        '<input type="checkbox" id="pod-show-system"' + (showSysNs ? ' checked' : '') + '> Show system NS' +
      '</label>' +
    '</div>';

    var filtered = dataView.filter(function(p){
      return (!filterVal || p.phase === filterVal) && (!searchVal || p.name.toLowerCase().includes(searchVal));
    });
    filtered = sortData(filtered, drawerSort.col || 'phase', drawerSort.dir);

    var rows = filtered.map(function(p) {
      var pc = p.phase === 'Running' ? 'var(--green)' : p.phase === 'Pending' ? 'var(--orange)' : p.phase === 'Succeeded' ? 'var(--cyan)' : 'var(--red)';
      var rc = p.restarts > 10 ? 'var(--orange)' : 'var(--text-dim)';
      return '<tr>' +
        '<td class="mono" style="color:var(--text-bright);max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="'+esc(p.name)+'">'+esc(p.name)+'</td>' +
        '<td><span class="ns-tag">'+esc(p.namespace)+'</span></td>' +
        '<td><span style="color:'+pc+';font-weight:600;font-size:.82em">'+esc(p.phase)+'</span></td>' +
        '<td class="mono" style="color:var(--text-dim)">'+esc(p.ready)+'</td>' +
        '<td class="mono" style="color:'+rc+'">'+p.restarts+'</td>' +
        '<td style="color:var(--text-dim)">'+esc(p.age)+'</td></tr>';
    }).join('');

    drawerHTML(statsHtml + toolbar +
      '<div class="drawer-table-wrap"><table class="wtable"><thead><tr>' +
      makeSortHeader('Pod Name','name',drawerSort) +
      makeSortHeader('Namespace','namespace',drawerSort) +
      makeSortHeader('Phase','phase',drawerSort) +
      makeSortHeader('Ready','ready',drawerSort) +
      makeSortHeader('Restarts','restarts',drawerSort) +
      makeSortHeader('Age','age',drawerSort) +
      '</tr></thead><tbody>' + (rows || '<tr><td colspan="6" style="text-align:center;color:var(--text-dim);padding:16px">No pods</td></tr>') + '</tbody></table></div>');

    document.getElementById('dpod-count').textContent = filtered.length + ' pods';
    document.getElementById('dfilter-pod-ns').addEventListener('change', renderPodDrawer);
    document.getElementById('dfilter-pod-phase').addEventListener('change', renderPodDrawer);
    document.getElementById('dfilter-pod-search').addEventListener('input', renderPodDrawer);
    document.getElementById('pod-show-system').addEventListener('change', renderPodDrawer);
    attachSortHandlers('', renderPodDrawer);
  } catch(e) { drawerHTML('<div style="color:var(--red);padding:20px">Error: ' + esc(e.message) + '</div>'); }
}

// ─── Drawer: Active Alerts ────────────────────────────────────────────────────
function openAlertsDrawer() {
  openDrawer('Active Alerts — Detail', renderAlertsDrawer);
}

async function renderAlertsDrawer() {
  try {
    var showSysGlobal = document.getElementById('global-show-system') ? document.getElementById('global-show-system').checked : false;
    var incidents = await (await fetchAuth('/api/incidents')).json();
    incidents = incidents || [];
    var nsIncidents = activeNs ? incidents.filter(function(i){ return i.namespace === activeNs; }) : incidents;
    var healthIncidents = nsIncidents.filter(function(i) { return !i.isWaste && (showSysGlobal || !_SYSTEM_NS[i.namespace]); });

    var critIncs = healthIncidents.filter(function(i) { return i.severity === 'CRITICAL' || i.severity === 'critical'; });
    var warnIncs = healthIncidents.filter(function(i) { return i.severity === 'WARNING' || i.severity === 'warning'; });

    var alertInfoCard =
      '<button class="grade-info-btn" id="alert-info-btn" style="margin-bottom:8px">ⓘ What these metrics mean</button>' +
      '<div id="alert-info-card" style="display:none;background:var(--surface2);border:1px solid var(--border);border-radius:8px;padding:14px 16px;margin-bottom:12px;font-size:.82em;line-height:1.6">' +
        '<div class="gl-title" style="margin-bottom:8px">Active Alerts — metric glossary</div>' +
        '<div class="gl-row"><span style="color:var(--red);font-weight:600;min-width:160px">Critical</span><span class="gl-desc">Severe issues requiring immediate attention (e.g., CrashLoopBackOff, high CPU).</span></div>' +
        '<div class="gl-row"><span style="color:var(--orange);font-weight:600;min-width:160px">Warnings</span><span class="gl-desc">Potential problems that could degrade performance if ignored.</span></div>' +
        '<div class="gl-row" style="border-bottom:none"><span style="color:var(--green);font-weight:600;min-width:160px">Total Issues</span><span class="gl-desc">The total count of all active alerts in the cluster.</span></div>' +
      '</div>';

    var statsHtml = '<div class="drawer-stats">' +
      dstat('Critical', critIncs.length, critIncs.length > 0 ? 'var(--red)' : 'var(--green)') +
      dstat('Warnings', warnIncs.length, warnIncs.length > 0 ? 'var(--orange)' : 'var(--green)') +
      dstat('Total Issues', healthIncidents.length, healthIncidents.length > 0 ? 'var(--orange)' : 'var(--green)') +
    '</div>';

    var alertItems = '';
    healthIncidents.forEach(function(inc) {
      var isCrit = (inc.severity === 'CRITICAL' || inc.severity === 'critical');
      var color = isCrit ? 'var(--red)' : 'var(--orange)';
      var icon = isCrit ? '&#9888;' : '&#9203;';
      var cls = isCrit ? 'failed' : 'pending';
      var typeStr = esc(inc.type || 'ALERT').toUpperCase();
      var msg = esc(inc.message || '');
      if (inc.age) msg += ' <span style="opacity:0.7">(' + esc(inc.age) + ')</span>';

      alertItems += alertCard(inc.podName || inc.name || '--', inc.namespace, typeStr, cls, color, icon, msg);
    });

    if (!alertItems) {
      alertItems = '<div class="alert ok"><span class="alert-ico" style="color:var(--green)">&#10003;</span><div><b>No active alerts</b><div class="alert-ns" style="margin-top:4px">All pods are healthy. Cluster is operating normally.</div></div></div>';
    }

    drawerHTML(alertInfoCard + statsHtml + '<div style="display:flex;flex-direction:column;gap:8px">' + alertItems + '</div>');

    document.getElementById('alert-info-btn').addEventListener('click', function() {
      var c = document.getElementById('alert-info-card');
      if (c) c.style.display = c.style.display === 'none' ? '' : 'none';
    });
    } catch(e) { drawerHTML('<div style="color:var(--red);padding:20px">Error: ' + esc(e.message) + '</div>'); }
    }
function alertCard(name, ns, label, cls, color, icon, hint) {
  return '<div class="alert ' + cls + '" style="padding:12px 14px">' +
    '<span class="alert-ico" style="color:' + color + ';font-size:1.1em">' + icon + '</span>' +
    '<div style="flex:1">' +
      '<div style="display:flex;align-items:center;justify-content:space-between">' +
        '<b style="font-size:.9em">' + esc(name) + '</b>' +
        '<span class="badge ' + (cls==='failed'?'b-crit':'b-warn') + '">' + label + '</span>' +
      '</div>' +
      '<div class="alert-ns" style="margin-top:3px">' + esc(ns) + '</div>' +
      '<div style="font-size:.76em;color:var(--text-dim);margin-top:6px;font-style:italic">' + hint + '</div>' +
    '</div></div>';
}

// ─── Drawer: CPU Resource Allocation ─────────────────────────────────────────
function openCpuDrawer() {
  drawerSort = { col: 'cpuUsage', dir: 'desc' };
  openDrawer('CPU Resource Allocation — Detail', renderCpuDrawer);
}

async function renderCpuDrawer() {
  try {
    var s = await (await fetchAuth('/api/summary')).json();
    var m = await (await fetchAuth(apiUrl('/api/metrics'))).json();
    m = m || [];

    var searchVal  = document.getElementById('dfilter-cpu-search')  ? document.getElementById('dfilter-cpu-search').value.toLowerCase()  : '';
    var showSysNs  = document.getElementById('cpu-show-system')     ? document.getElementById('cpu-show-system').checked                  : false;

    var cpuPct  = s.cpuAllocatable > 0 ? (s.cpuRequested / s.cpuAllocatable * 100) : 0;
    var cpuFree = Math.max(0, s.cpuAllocatable - s.cpuRequested);

    var cpuInfoCard =
      '<button class="grade-info-btn" id="cpu-info-btn" style="margin-bottom:8px">ⓘ What these metrics mean</button>' +
      '<div id="cpu-info-card" style="display:none;background:var(--surface2);border:1px solid var(--border);border-radius:8px;padding:14px 16px;margin-bottom:12px;font-size:.82em;line-height:1.6">' +
        '<div class="gl-title" style="margin-bottom:8px">CPU &amp; Memory — metric glossary</div>' +
        '<div class="gl-row"><span style="color:var(--cyan);font-weight:600;min-width:140px">CPU Requested</span><span class="gl-desc">CPU reserved by all pods via <code>resources.requests.cpu</code>. What the scheduler has committed.</span></div>' +
        '<div class="gl-row"><span style="color:var(--text-bright);font-weight:600;min-width:140px">CPU Allocatable</span><span class="gl-desc">Node capacity minus OS/kubelet overhead. The real scheduling budget.</span></div>' +
        '<div class="gl-row"><span style="color:var(--green);font-weight:600;min-width:140px">CPU Free</span><span class="gl-desc">Allocatable − Requested. Headroom still available for new pods.</span></div>' +
        '<div class="gl-row"><span style="color:var(--cyan);font-weight:600;min-width:140px">CPU Pressure</span><span class="gl-desc">Requested ÷ Allocatable. Scheduling saturation — not actual usage. &gt;70% = warn; &gt;85% = critical.</span></div>' +
        '<div class="gl-row"><span style="color:var(--purple);font-weight:600;min-width:140px">Mem Requested</span><span class="gl-desc">Memory reserved by all pods via <code>resources.requests.memory</code>.</span></div>' +
        '<div class="gl-row" style="border-bottom:none"><span style="color:var(--text-bright);font-weight:600;min-width:140px">Mem Allocatable</span><span class="gl-desc">Total memory available for scheduling across all nodes.</span></div>' +
      '</div>';

    // top stats always cluster-wide (incluem system NS)
    var statsHtml = '<div class="drawer-stats">' +
      dstat('CPU Requested', s.cpuRequested + 'm', 'var(--cyan)') +
      dstat('CPU Allocatable', s.cpuAllocatable + 'm', 'var(--text-bright)') +
      dstat('CPU Free', cpuFree + 'm', cpuFree < s.cpuAllocatable * 0.1 ? 'var(--red)' : 'var(--green)') +
      dstat('CPU Pressure', cpuPct.toFixed(1) + '%', cpuPct > 85 ? 'var(--red)' : cpuPct > 70 ? 'var(--orange)' : 'var(--cyan)') +
      dstat('Mem Requested', s.memRequested + 'Mi', 'var(--purple)') +
      dstat('Mem Allocatable', s.memAllocatable + 'Mi', 'var(--text-bright)') +
    '</div>';

    // view: filter system NS from bars + table (not from top stats)
    var mView = showSysNs ? m : m.filter(function(p){ return !_SYSTEM_NS[p.namespace]; });

    // Namespace breakdown
    var nsMap = {};
    mView.forEach(function(p) {
      if (!nsMap[p.namespace]) nsMap[p.namespace] = { req: 0, use: 0 };
      nsMap[p.namespace].req += (p.cpuRequestPresent ? p.cpuRequest : 0);
      nsMap[p.namespace].use += p.cpuUsage;
    });
    var maxNsReq = Math.max.apply(null, Object.values(nsMap).map(function(v){return v.req;})) || 1;
    var nsBars = Object.keys(nsMap).sort(function(a,b){return nsMap[b].req - nsMap[a].req;}).map(function(ns) {
      var v = nsMap[ns];
      var pct = (v.req / maxNsReq * 100).toFixed(1);
      var usePct = v.req > 0 ? (v.use / v.req * 100) : 0;
      var fc = usePct > 85 ? 'var(--red)' : usePct > 70 ? 'var(--orange)' : 'var(--cyan)';
      return '<div class="ns-bar-row">' +
        '<span class="ns-bar-name">' + esc(ns) + '</span>' +
        '<div class="ns-bar-track"><div class="ns-bar-fill" style="width:'+pct+'%;background:'+fc+'"></div></div>' +
        '<span class="ns-bar-val">' + v.req + 'm req / ' + v.use + 'm use</span>' +
      '</div>';
    }).join('');

    var toolbar = '<div class="drawer-toolbar">' +
      '<span class="dtool-label">Search</span>' +
      '<input class="dtool-input" id="dfilter-cpu-search" placeholder="pod or namespace..." value="' + esc(searchVal) + '">' +
      '<span class="drawer-count" id="dcpu-count"></span>' +
      '<div class="dtool-sep"></div>' +
      '<label style="display:flex;align-items:center;gap:6px;font-size:.75em;color:var(--text-dim);cursor:pointer">' +
        '<input type="checkbox" id="cpu-show-system"' + (showSysNs?' checked':'') + '> Show system NS' +
      '</label>' +
    '</div>';

    var filtered = mView.filter(function(p){ return !searchVal || p.name.toLowerCase().includes(searchVal) || (p.namespace||'').toLowerCase().includes(searchVal); });
    filtered = sortData(filtered, drawerSort.col || 'cpuUsage', drawerSort.dir);

    var rows = filtered.map(function(p) {
      var pct = p.cpuRequestPresent && p.cpuRequest > 0 ? (p.cpuUsage / p.cpuRequest * 100) : 0;
      var fc = pct > 85 ? 'var(--red)' : pct > 70 ? 'var(--orange)' : pct > 40 ? 'var(--green)' : 'var(--text-dim)';
      return '<tr>' +
        '<td class="mono" style="color:var(--text-bright);max-width:180px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="'+esc(p.name)+'">'+esc(p.name)+'</td>' +
        '<td><span class="ns-tag">'+esc(p.namespace)+'</span></td>' +
        '<td class="mono" style="color:var(--cyan)">'+p.cpuUsage+'m</td>' +
        '<td class="mono" style="color:var(--text-dim)">'+(p.cpuRequestPresent?p.cpuRequest+'m':'N/A')+'</td>' +
        '<td class="mono" style="color:var(--purple)">'+p.memUsage+'Mi</td>' +
        '<td><div class="util-wrap"><div class="util-bg"><div class="util-fill" style="width:'+Math.min(pct,100).toFixed(0)+'%;background:'+fc+'"></div></div><span class="util-pct">'+pct.toFixed(0)+'%</span></div></td>' +
      '</tr>';
    }).join('');

    drawerHTML(cpuInfoCard + statsHtml +
      '<div style="font-size:.72em;color:var(--text-dim);text-transform:uppercase;letter-spacing:.8px">CPU by Namespace</div>' +
      '<div style="background:var(--surface2);border:1px solid var(--border);border-radius:5px;padding:10px 14px">' + (nsBars || '<span style="color:var(--text-dim)">No data</span>') + '</div>' +
      toolbar +
      '<div class="drawer-table-wrap"><table class="wtable"><thead><tr>' +
      makeSortHeader('Pod','name',drawerSort) +
      makeSortHeader('Namespace','namespace',drawerSort) +
      makeSortHeader('CPU Usage','cpuUsage',drawerSort) +
      makeSortHeader('CPU Request','cpuRequest',drawerSort) +
      makeSortHeader('Mem Usage','memUsage',drawerSort) +
      '<th>Utilization</th></tr></thead>' +
      '<tbody>' + (rows || '<tr><td colspan="6" style="text-align:center;color:var(--text-dim);padding:16px">No data</td></tr>') + '</tbody></table></div>');

    document.getElementById('dcpu-count').textContent = filtered.length + ' pods';
    document.getElementById('dfilter-cpu-search').addEventListener('input', renderCpuDrawer);
    document.getElementById('cpu-show-system').addEventListener('change', renderCpuDrawer);
    document.getElementById('cpu-info-btn').addEventListener('click', function() {
      var c = document.getElementById('cpu-info-card');
      if (c) c.style.display = c.style.display === 'none' ? '' : 'none';
    });
    attachSortHandlers('', renderCpuDrawer);
  } catch(e) { drawerHTML('<div style="color:var(--red);padding:20px">Error: ' + esc(e.message) + '</div>'); }
}

// ─── Drawer: Waste Intelligence ───────────────────────────────────────────────
function openWasteDrawer() {
  drawerSort = { col: 'potentialSavingMCpu', dir: 'desc' };
  openDrawer('Waste Intelligence — Full Report', renderWasteDrawer);
}

async function renderWasteDrawer() {
  try {
    var data = await (await fetchAuth(apiUrl('/api/waste'))).json();
    var entries = (data && data.entries) ? data.entries : [];

    var viewMode  = document.getElementById('waste-view-mode')    ? document.getElementById('waste-view-mode').value    : 'pod';
    var sevFilter = document.getElementById('dfilter-waste-sev')  ? document.getElementById('dfilter-waste-sev').value  : '';
    var nsFilter2 = document.getElementById('dfilter-waste-ns')   ? document.getElementById('dfilter-waste-ns').value   : '';
    var searchVal = document.getElementById('dfilter-waste-search')? document.getElementById('dfilter-waste-search').value.toLowerCase() : '';
    var showSysNs = document.getElementById('waste-show-system')  ? document.getElementById('waste-show-system').checked : false;

    var totalMemOver = entries.reduce(function(s,e){
      var over = Number(e.memRequest||0) - Number(e.memUsage||0);
      return s + (over > 0 ? over : 0);
    }, 0);
    var memOverLabel = totalMemOver >= 1024 ? (totalMemOver/1024).toFixed(1) + ' GB' : totalMemOver + ' Mi';

    var wasteInfoCard =
      '<button class="grade-info-btn" id="waste-info-btn" style="margin-bottom:8px">ⓘ What these metrics mean</button>' +
      '<div id="waste-info-card" style="display:none;background:var(--surface2);border:1px solid var(--border);border-radius:8px;padding:14px 16px;margin-bottom:12px;font-size:.82em;line-height:1.6">' +
        '<div class="gl-title" style="margin-bottom:8px">Waste Intelligence — metric glossary</div>' +
        '<div class="gl-row"><span style="color:var(--orange);font-weight:600;min-width:170px">Wasted Pods</span><span class="gl-desc">Pods consuming less CPU than they reserved. Waste = unused reserved capacity.</span></div>' +
        '<div class="gl-row"><span style="color:var(--orange);font-weight:600;min-width:170px">CPU Saveable</span><span class="gl-desc">Total mCPU that could be freed by right-sizing pod requests to actual usage.</span></div>' +
        '<div class="gl-row"><span style="color:var(--purple);font-weight:600;min-width:170px">Mem Allocated, Not Used</span><span class="gl-desc">Memory reserved (requests) but not consumed. Blocks scheduling of new pods.</span></div>' +
        '<div class="gl-row" style="border-bottom:none"><span style="color:var(--yellow);font-weight:600;min-width:170px">Est. Cost Save</span><span class="gl-desc">Rough savings estimate based on saveable CPU (uses ~$0.048/core-hr reference).</span></div>' +
      '</div>';

    var statsHtml = '<div class="drawer-stats">' +
      dstat('Wasted Pods', data.wastedPods||0, data.wastedPods>0?'var(--orange)':'var(--green)') +
      dstat('CPU Saveable', (data.totalSavingMCpu||0) + 'm', 'var(--orange)') +
      dstat('Mem Allocated, Not Used', memOverLabel, 'var(--purple)') +
      dstat('Est. Cost Save', '$' + (data.totalSavingUSD||0).toFixed(4)+'/hr', 'var(--yellow)') +
    '</div>';

    var nsSet = {};
    entries.forEach(function(e){ nsSet[e.namespace] = 1; });
    var nsOpts = '<option value="">All Namespaces</option>' + Object.keys(nsSet).sort().map(function(ns){ return '<option value="'+ns+'"'+(nsFilter2===ns?' selected':'')+'>'+esc(ns)+'</option>'; }).join('');

    // View toggle tabs
    var viewTabs =
      '<div style="display:flex;gap:0;margin-bottom:10px;border:1px solid var(--border);border-radius:6px;overflow:hidden;width:fit-content">' +
        '<button id="waste-tab-pod" style="padding:5px 16px;font-size:.8em;border:none;cursor:pointer;background:'+(viewMode==='pod'?'var(--cyan)':'var(--surface2)')+';color:'+(viewMode==='pod'?'#000':'var(--text-dim)')+'">By Pod</button>' +
        '<button id="waste-tab-dep" style="padding:5px 16px;font-size:.8em;border:none;border-left:1px solid var(--border);cursor:pointer;background:'+(viewMode==='dep'?'var(--cyan)':'var(--surface2)')+';color:'+(viewMode==='dep'?'#000':'var(--text-dim)')+'">By Deployment</button>' +
        '<input type="hidden" id="waste-view-mode" value="'+viewMode+'">' +
      '</div>';

    var toolbar = '<div class="drawer-toolbar">' +
      (viewMode === 'pod' ?
        '<span class="dtool-label">Severity</span>' +
        '<select class="dtool-select" id="dfilter-waste-sev">' +
          '<option value="">All</option>' +
          '<option value="critical"'+(sevFilter==='critical'?' selected':'')+'>Critical</option>' +
          '<option value="warning"'+(sevFilter==='warning'?' selected':'')+'>Warning</option>' +
        '</select>' +
        '<div class="dtool-sep"></div>' : '') +
      '<span class="dtool-label">Namespace</span>' +
      '<select class="dtool-select" id="dfilter-waste-ns">' + nsOpts + '</select>' +
      '<div class="dtool-sep"></div>' +
      (viewMode === 'pod' ?
        '<span class="dtool-label">Search</span>' +
        '<input class="dtool-input" id="dfilter-waste-search" placeholder="pod name..." value="' + esc(searchVal) + '">' : '') +
      '<span class="drawer-count" id="dwaste-count"></span>' +
      '<div class="dtool-sep"></div>' +
      '<label class="eff-sys-toggle" style="cursor:pointer;display:flex;align-items:center;gap:6px;font-size:.78em;color:var(--text-dim)">' +
        '<input type="checkbox" id="waste-show-system" style="accent-color:var(--cyan)"' + (showSysNs ? ' checked' : '') + '> Show system NS' +
      '</label>' +
    '</div>';

    var filtered = entries.filter(function(e) {
      return (!sevFilter || e.severity === sevFilter) &&
             (!nsFilter2 || e.namespace === nsFilter2) &&
             (!searchVal || e.name.toLowerCase().includes(searchVal)) &&
             (showSysNs || !e.isSystem);
    });

    var tableHtml;
    if (viewMode === 'dep') {
      // Aggregate by appLabel
      var depMap = {};
      filtered.forEach(function(e) {
        var key = (e.appLabel && e.appLabel !== '') ? e.appLabel : '(unlabeled)';
        if (!depMap[key]) depMap[key] = { label: key, pods: 0, cpuSaving: 0, memOver: 0, namespaces: {} };
        depMap[key].pods++;
        depMap[key].cpuSaving += Number(e.potentialSavingMCpu || 0);
        var over = Number(e.memRequest||0) - Number(e.memUsage||0);
        depMap[key].memOver += over > 0 ? over : 0;
        depMap[key].namespaces[e.namespace] = 1;
      });
      var deps = Object.values(depMap).sort(function(a,b){ return b.cpuSaving - a.cpuSaving; });
      document.getElementById('dwaste-count') && (document.getElementById('dwaste-count').textContent = deps.length + ' deployments');
      var depRows = deps.map(function(d) {
        var nsLabels = Object.keys(d.namespaces).map(function(ns){ return '<span class="ns-tag">'+esc(ns)+'</span>'; }).join(' ');
        var memStr = d.memOver >= 1024 ? (d.memOver/1024).toFixed(1)+'GB' : d.memOver+'Mi';
        var estSave = (d.cpuSaving / 1000 * 0.048).toFixed(4);
        return '<tr>' +
          '<td class="mono" style="color:var(--text-bright)">'+esc(d.label)+'</td>' +
          '<td>'+nsLabels+'</td>' +
          '<td class="mono" style="color:var(--text-dim);text-align:center">'+d.pods+'</td>' +
          '<td class="mono" style="color:var(--orange)">'+d.cpuSaving+'m</td>' +
          '<td class="mono" style="color:var(--purple)">'+memStr+'</td>' +
          '<td class="mono" style="color:var(--yellow)">$'+estSave+'/hr</td></tr>';
      }).join('');
      tableHtml = '<div class="drawer-table-wrap"><table class="wtable"><thead><tr>' +
        '<th>Deployment</th><th>Namespaces</th><th style="text-align:center">Pods</th>' +
        '<th>CPU Saveable</th><th>Mem Not Used</th><th>Est. Saving</th>' +
        '</tr></thead><tbody>' +
        (depRows || '<tr><td colspan="6" style="text-align:center;color:var(--text-dim);padding:16px">No waste detected</td></tr>') +
        '</tbody></table></div>';
    } else {
      filtered = sortData(filtered, drawerSort.col || 'potentialSavingMCpu', drawerSort.dir);
      var rows = filtered.map(function(e) {
        var sevColor = e.severity === 'critical' ? 'var(--red)' : 'var(--orange)';
        var sevBadge = '<span class="badge '+(e.severity==='critical'?'b-crit':'b-warn')+'">'+esc(e.severity)+'</span>';
        var memOver = Number(e.memRequest||0) - Number(e.memUsage||0);
        var memOverStr = memOver > 0 ? (memOver >= 1024 ? (memOver/1024).toFixed(1)+'GB' : memOver+'Mi') : '—';
        var memOverColor = memOver > 512 ? 'var(--purple)' : memOver > 0 ? 'var(--text-dim)' : 'var(--green)';
        return '<tr class="waste-row-clickable" data-pod="'+esc(e.name)+'" data-ns="'+esc(e.namespace)+'">' +
          '<td class="mono" style="color:var(--text-bright);max-width:180px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="'+esc(e.name)+'">'+esc(e.name)+'</td>' +
          '<td><span class="ns-tag">'+esc(e.namespace)+'</span></td>' +
          '<td class="mono" style="color:var(--cyan)">'+e.cpuUsage+'m</td>' +
          '<td class="mono" style="color:var(--text-dim)">'+e.cpuRequest+'m</td>' +
          '<td class="mono" style="color:'+sevColor+'">'+e.potentialSavingMCpu+'m</td>' +
          '<td class="mono" style="color:'+memOverColor+'">'+memOverStr+'</td>' +
          '<td class="mono" style="color:'+sevColor+'">'+e.wastePct.toFixed(1)+'%</td>' +
          '<td>'+sevBadge+'</td></tr>';
      }).join('');
      tableHtml = '<div class="drawer-table-wrap"><table class="wtable"><thead><tr>' +
        makeSortHeader('Pod','name',drawerSort) +
        makeSortHeader('Namespace','namespace',drawerSort) +
        makeSortHeader('CPU Usage','cpuUsage',drawerSort) +
        makeSortHeader('CPU Request','cpuRequest',drawerSort) +
        makeSortHeader('Saving (mCPU)','potentialSavingMCpu',drawerSort) +
        '<th>Mem Not Used</th>' +
        makeSortHeader('Waste %','wastePct',drawerSort) +
        '<th>Severity</th></tr></thead>' +
        '<tbody>' + (rows || '<tr><td colspan="8" style="text-align:center;color:var(--text-dim);padding:16px">No waste detected</td></tr>') + '</tbody></table></div>';
    }

    drawerHTML(wasteInfoCard + statsHtml + viewTabs + toolbar + tableHtml);

    // View toggle listeners
    document.getElementById('waste-tab-pod').addEventListener('click', function() {
      document.getElementById('waste-view-mode').value = 'pod';
      drawerSort = { col: 'potentialSavingMCpu', dir: 'desc' };
      renderWasteDrawer();
    });
    document.getElementById('waste-tab-dep').addEventListener('click', function() {
      document.getElementById('waste-view-mode').value = 'dep';
      renderWasteDrawer();
    });

    var countEl = document.getElementById('dwaste-count');
    if (countEl && viewMode === 'pod') countEl.textContent = filtered.length + ' pods';

    var sevEl = document.getElementById('dfilter-waste-sev');
    if (sevEl) sevEl.addEventListener('change', renderWasteDrawer);
    document.getElementById('dfilter-waste-ns').addEventListener('change', renderWasteDrawer);
    var searchEl = document.getElementById('dfilter-waste-search');
    if (searchEl) searchEl.addEventListener('input', renderWasteDrawer);
    document.getElementById('waste-show-system').addEventListener('change', renderWasteDrawer);
    document.getElementById('waste-info-btn').addEventListener('click', function() {
      var c = document.getElementById('waste-info-card');
      if (c) c.style.display = c.style.display === 'none' ? '' : 'none';
    });
    if (viewMode === 'pod') attachSortHandlers('', renderWasteDrawer);

    // Click on row → pod detail (By Pod view only)
    document.querySelectorAll('#detail-drawer .waste-row-clickable').forEach(function(row) {
      row.addEventListener('click', function() {
        var pod  = row.dataset.pod;
        var ns   = row.dataset.ns;
        var entry = entries.find(function(e){ return e.name === pod && e.namespace === ns; });
        if (entry) openWastePodDetail(entry, entries);
      });
    });
  } catch(e) { drawerHTML('<div style="color:var(--red);padding:20px">Error: ' + esc(e.message) + '</div>'); }
}

function openWastePodDetail(entry, allEntries) {
  var sevColor  = entry.severity === 'critical' ? 'var(--red)' : 'var(--orange)';
  var wastePct  = entry.wastePct.toFixed(1);
  var effPct    = (100 - entry.wastePct).toFixed(1);
  var rankIdx   = allEntries.findIndex(function(e){ return e.name === entry.name && e.namespace === entry.namespace; });
  var rank      = rankIdx >= 0 ? '#' + (rankIdx + 1) + ' of ' + allEntries.length : '--';

  var html =
    '<div style="display:flex;align-items:center;gap:8px;margin-bottom:4px">' +
      '<button class="btn-refresh" id="waste-detail-back" style="font-size:.72em">&#8592; Back to list</button>' +
    '</div>' +
    '<div class="pod-detail-card">' +
      '<div class="pod-detail-row"><span class="pod-detail-label">Pod</span><span class="pod-detail-val" style="color:var(--cyan)">' + esc(entry.name) + '</span></div>' +
      '<div class="pod-detail-row"><span class="pod-detail-label">Namespace</span><span class="pod-detail-val"><span class="ns-tag">' + esc(entry.namespace) + '</span></span></div>' +
      '<div class="pod-detail-row"><span class="pod-detail-label">Severity</span><span class="pod-detail-val"><span class="badge '+(entry.severity==='critical'?'b-crit':'b-warn')+'">'+esc(entry.severity)+'</span></span></div>' +
      '<div class="pod-detail-row"><span class="pod-detail-label">Waste Rank</span><span class="pod-detail-val" style="color:var(--text-dim)">' + rank + '</span></div>' +
    '</div>' +

    '<div style="font-size:.7em;color:var(--text-dim);text-transform:uppercase;letter-spacing:.8px">CPU Analysis</div>' +
    '<div class="pod-detail-card">' +
      '<div class="pod-detail-row">' +
        '<span class="pod-detail-label">CPU Usage</span>' +
        '<span class="pod-detail-val" style="color:var(--cyan)">' + entry.cpuUsage + 'm</span>' +
      '</div>' +
      '<div class="pod-detail-row">' +
        '<span class="pod-detail-label">CPU Request</span>' +
        '<span class="pod-detail-val" style="color:var(--text-bright)">' + entry.cpuRequest + 'm</span>' +
      '</div>' +
      '<div class="pod-detail-row">' +
        '<span class="pod-detail-label">Potential Saving</span>' +
        '<span class="pod-detail-val" style="color:' + sevColor + '">' + entry.potentialSavingMCpu + 'm (' + entry.opportunity + ')</span>' +
      '</div>' +
      '<div class="pod-detail-row">' +
        '<span class="pod-detail-label">Waste</span>' +
        '<div class="pod-detail-bar"><div class="pod-detail-fill" style="width:' + Math.min(parseFloat(wastePct),100) + '%;background:' + sevColor + '"></div></div>' +
        '<span class="pod-detail-val" style="color:' + sevColor + '">' + wastePct + '%</span>' +
      '</div>' +
      '<div class="pod-detail-row">' +
        '<span class="pod-detail-label">Efficiency</span>' +
        '<div class="pod-detail-bar"><div class="pod-detail-fill" style="width:' + Math.min(parseFloat(effPct),100) + '%;background:var(--green)"></div></div>' +
        '<span class="pod-detail-val" style="color:var(--green)">' + effPct + '%</span>' +
      '</div>' +
    '</div>' +

    '<div style="font-size:.7em;color:var(--text-dim);text-transform:uppercase;letter-spacing:.8px">Recommendation</div>' +
    '<div class="pod-detail-card" style="background:rgba(240,112,0,.06);border-color:rgba(240,112,0,.3)">' +
      '<div style="font-size:.84em;color:var(--text-bright);line-height:1.6">' +
        'This pod is using <b style="color:var(--cyan)">' + entry.cpuUsage + 'm</b> CPU but requesting <b style="color:var(--text-bright)">' + entry.cpuRequest + 'm</b>. ' +
        'Consider setting <code style="color:var(--cyan);background:rgba(0,180,255,.1);padding:1px 5px;border-radius:3px">resources.requests.cpu: ' + Math.ceil(entry.cpuUsage * 1.3) + 'm</code> ' +
        '(actual usage + 30% headroom) to free <b style="color:' + sevColor + '">' + entry.potentialSavingMCpu + 'm</b> for other workloads.' +
      '</div>' +
    '</div>';

  drawerHTML(html);
  document.getElementById('waste-detail-back').addEventListener('click', function() {
    drawerSort = { col: 'potentialSavingMCpu', dir: 'desc' };
    renderWasteDrawer();
  });
}

// ─── Drawer: Top Workloads ────────────────────────────────────────────────────
function openWorkloadsDrawer() {
  drawerSort = { col: 'cpuUsage', dir: 'desc' };
  openDrawer('Top Workloads — Full View', renderWorkloadsDrawer);
}

async function renderWorkloadsDrawer() {
  try {
    var m = await (await fetchAuth(apiUrl('/api/metrics'))).json();
    m = m || [];

    var nsFilter3  = document.getElementById('dfilter-wl-ns')     ? document.getElementById('dfilter-wl-ns').value     : '';
    var sevFilter2 = document.getElementById('dfilter-wl-sev')    ? document.getElementById('dfilter-wl-sev').value    : '';
    var searchVal  = document.getElementById('dfilter-wl-search') ? document.getElementById('dfilter-wl-search').value.toLowerCase() : '';

    var nsSet2 = {};
    m.forEach(function(p){ nsSet2[p.namespace] = 1; });
    var nsOpts2 = '<option value="">All Namespaces</option>' + Object.keys(nsSet2).sort().map(function(ns){ return '<option value="'+ns+'"'+(nsFilter3===ns?' selected':'')+'>'+esc(ns)+'</option>'; }).join('');

    var toolbar = '<div class="drawer-toolbar">' +
      '<span class="dtool-label">Namespace</span>' +
      '<select class="dtool-select" id="dfilter-wl-ns">' + nsOpts2 + '</select>' +
      '<div class="dtool-sep"></div>' +
      '<span class="dtool-label">Severity</span>' +
      '<select class="dtool-select" id="dfilter-wl-sev">' +
        '<option value="">All</option>' +
        '<option value="critical"'+(sevFilter2==='critical'?' selected':'')+'>Critical</option>' +
        '<option value="warning"'+(sevFilter2==='warning'?' selected':'')+'>Warning</option>' +
        '<option value="ok"'+(sevFilter2==='ok'?' selected':'')+'>OK</option>' +
      '</select>' +
      '<div class="dtool-sep"></div>' +
      '<span class="dtool-label">Search</span>' +
      '<input class="dtool-input" id="dfilter-wl-search" placeholder="pod name..." value="' + esc(searchVal) + '">' +
      '<span class="drawer-count" id="dwl-count"></span>' +
    '</div>';

    var filtered = m.filter(function(p) {
      return (!nsFilter3  || p.namespace === nsFilter3) &&
             (!sevFilter2 || (p.severity||'ok') === sevFilter2) &&
             (!searchVal  || p.name.toLowerCase().includes(searchVal));
    });
    filtered = sortData(filtered, drawerSort.col || 'cpuUsage', drawerSort.dir);

    var totalUsage = filtered.reduce(function(s,p){return s+p.cpuUsage;},0);
    var statsHtml = '<div class="drawer-stats">' +
      dstat('Pods Shown', filtered.length, 'var(--text-bright)') +
      dstat('Total CPU Usage', totalUsage + 'm', 'var(--cyan)') +
      dstat('Waste Ops', filtered.filter(function(p){return (p.potentialSavingMCpu||0)>0;}).length, 'var(--orange)') +
    '</div>';

    var rows = filtered.map(function(p, i) {
      var pct = p.cpuRequestPresent && p.cpuRequest > 0 ? (p.cpuUsage / p.cpuRequest * 100) : 0;
      var fc  = pct > 70 ? 'var(--green)' : pct > 40 ? 'var(--orange)' : 'var(--red)';
      var hasSaving = Number(p.potentialSavingMCpu || 0) > 0;
      var opp = hasSaving
        ? '<span style="color:var(--orange);font-family:monospace">-' + Number(p.potentialSavingMCpu) + 'm</span>'
        : '<span style="color:var(--green)">&#10003;</span>';
      var sev = p.severity || 'ok';
      var sevBadge = sev === 'ok' ? '' : '<span class="badge '+(sev==='critical'?'b-crit':'b-warn')+'">'+sev+'</span>';
      return '<tr>' +
        '<td style="color:var(--text-dim)">'+(i+1)+'</td>' +
        '<td class="mono" style="color:var(--text-bright);max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="'+esc(p.name)+'">'+esc(p.name||'--')+'</td>' +
        '<td><span class="ns-tag">'+esc(p.namespace||'--')+'</span></td>' +
        '<td class="mono" style="color:var(--cyan)">'+p.cpuUsage+'m</td>' +
        '<td class="mono" style="color:var(--text-dim)">'+(p.cpuRequestPresent?p.cpuRequest+'m':'N/A')+'</td>' +
        '<td class="mono" style="color:var(--purple)">'+p.memUsage+'Mi</td>' +
        '<td><div class="util-wrap"><div class="util-bg"><div class="util-fill" style="width:'+Math.min(pct,100).toFixed(0)+'%;background:'+fc+'"></div></div><span class="util-pct">'+pct.toFixed(0)+'%</span></div></td>' +
        '<td>'+opp+'</td>' +
        '<td>'+sevBadge+'</td></tr>';
    }).join('');

    var workloadsInfoCard =
      '<button class="grade-info-btn" id="workloads-info-btn" style="margin-bottom:8px">ⓘ What these metrics mean</button>' +
      '<div id="workloads-info-card" style="display:none;background:var(--surface2);border:1px solid var(--border);border-radius:8px;padding:14px 16px;margin-bottom:12px;font-size:.82em;line-height:1.6">' +
        '<div class="gl-title" style="margin-bottom:8px">Top Workloads — metric glossary</div>' +
        '<div class="gl-row"><span style="color:var(--text-bright);font-weight:600;min-width:160px">Pods Shown</span><span class="gl-desc">Number of pods matching the current filters.</span></div>' +
        '<div class="gl-row"><span style="color:var(--cyan);font-weight:600;min-width:160px">Total CPU Usage</span><span class="gl-desc">The aggregated CPU currently consumed by the displayed pods.</span></div>' +
        '<div class="gl-row" style="border-bottom:none"><span style="color:var(--orange);font-weight:600;min-width:160px">Waste Ops</span><span class="gl-desc">Opportunities to reduce requested resources without impacting performance.</span></div>' +
      '</div>';

    drawerHTML(workloadsInfoCard + statsHtml + toolbar +
      '<div class="drawer-table-wrap"><table class="wtable"><thead><tr>' +
      '<th>#</th>' +
      makeSortHeader('Pod','name',drawerSort) +
      makeSortHeader('Namespace','namespace',drawerSort) +
      makeSortHeader('CPU Usage','cpuUsage',drawerSort) +
      makeSortHeader('CPU Request','cpuRequest',drawerSort) +
      makeSortHeader('Mem Usage','memUsage',drawerSort) +
      '<th>Utilization</th>' +
      makeSortHeader('Waste','potentialSavingMCpu',drawerSort) +
      '<th>Severity</th></tr></thead>' +
      '<tbody>' + (rows || '<tr><td colspan="9" style="text-align:center;color:var(--text-dim);padding:16px">No data</td></tr>') + '</tbody></table></div>');

    document.getElementById('dwl-count').textContent = filtered.length + ' pods';
    document.getElementById('dfilter-wl-ns').addEventListener('change', renderWorkloadsDrawer);
    document.getElementById('dfilter-wl-sev').addEventListener('change', renderWorkloadsDrawer);
    document.getElementById('dfilter-wl-search').addEventListener('input', renderWorkloadsDrawer);
    attachSortHandlers('', renderWorkloadsDrawer);

    document.getElementById('workloads-info-btn').addEventListener('click', function() {
      var c = document.getElementById('workloads-info-card');
      if (c) c.style.display = c.style.display === 'none' ? '' : 'none';
    });
  } catch(e) { drawerHTML('<div style="color:var(--red);padding:20px">Error: ' + esc(e.message) + '</div>'); }
}

// ─── Drawer: Memory Resource Allocation ──────────────────────────────────────
function openMemDrawer() {
  drawerSort = { col: 'memUsage', dir: 'desc' };
  openDrawer('Memory Resource Allocation — Detail', renderMemDrawer);
}

async function renderMemDrawer() {
  try {
    var s = await (await fetchAuth('/api/summary')).json();
    var m = await (await fetchAuth(apiUrl('/api/metrics'))).json();
    m = m || [];

    var searchVal  = document.getElementById('dfilter-mem-search')  ? document.getElementById('dfilter-mem-search').value.toLowerCase()  : '';
    var showSysNs  = document.getElementById('mem-show-system')     ? document.getElementById('mem-show-system').checked                  : false;

    var memReqPct = s.memAllocatable > 0 ? (s.memRequested / s.memAllocatable * 100) : 0;
    var memFree   = Math.max(0, s.memAllocatable - s.memRequested);

    var memInfoCard =
      '<button class="grade-info-btn" id="mem-info-btn" style="margin-bottom:8px">ⓘ What these metrics mean</button>' +
      '<div id="mem-info-card" style="display:none;background:var(--surface2);border:1px solid var(--border);border-radius:8px;padding:14px 16px;margin-bottom:12px;font-size:.82em;line-height:1.6">' +
        '<div class="gl-title" style="margin-bottom:8px">Memory — metric glossary</div>' +
        '<div class="gl-row"><span style="color:var(--purple);font-weight:600;min-width:140px">Mem Requested</span><span class="gl-desc">Memory reserved by all pods via <code>resources.requests.memory</code>. What the scheduler has committed.</span></div>' +
        '<div class="gl-row"><span style="color:var(--text-bright);font-weight:600;min-width:140px">Mem Allocatable</span><span class="gl-desc">Node capacity minus OS/kubelet overhead. The real scheduling budget.</span></div>' +
        '<div class="gl-row"><span style="color:var(--green);font-weight:600;min-width:140px">Mem Free</span><span class="gl-desc">Allocatable − Requested. Headroom still available for new pods.</span></div>' +
        '<div class="gl-row" style="border-bottom:none"><span style="color:var(--purple);font-weight:600;min-width:140px">Pressure</span><span class="gl-desc">Requested ÷ Allocatable. Scheduling saturation. &gt;75% = warn; &gt;90% = critical (OOM eviction risk).</span></div>' +
      '</div>';

    // top stats always cluster-wide
    var statsHtml = '<div class="drawer-stats">' +
      dstat('Mem Requested', s.memRequested + 'Mi', 'var(--purple)') +
      dstat('Mem Allocatable', s.memAllocatable + 'Mi', 'var(--text-bright)') +
      dstat('Mem Free', memFree + 'Mi', memFree < s.memAllocatable * 0.1 ? 'var(--red)' : 'var(--green)') +
      dstat('Pressure', memReqPct.toFixed(1) + '%', memReqPct > 90 ? 'var(--red)' : memReqPct > 75 ? 'var(--orange)' : 'var(--purple)') +
    '</div>';

    // view: filter system NS from bars + table
    var mView = showSysNs ? m : m.filter(function(p){ return !_SYSTEM_NS[p.namespace]; });

    // Namespace breakdown by mem usage
    var nsMap = {};
    mView.forEach(function(p) {
      if (!nsMap[p.namespace]) nsMap[p.namespace] = 0;
      nsMap[p.namespace] += (p.memUsage || 0);
    });
    var maxNsMem = Math.max.apply(null, Object.values(nsMap)) || 1;
    var nsBars = Object.keys(nsMap).sort(function(a,b){ return nsMap[b] - nsMap[a]; }).map(function(ns) {
      var v = nsMap[ns];
      var pct = (v / maxNsMem * 100).toFixed(1);
      var pressColor = v > 4000 ? 'var(--red)' : v > 2000 ? 'var(--orange)' : 'var(--purple)';
      return '<div class="ns-bar-row">' +
        '<span class="ns-bar-name">' + esc(ns) + '</span>' +
        '<div class="ns-bar-track"><div class="ns-bar-fill" style="width:'+pct+'%;background:'+pressColor+'"></div></div>' +
        '<span class="ns-bar-val">' + v + 'Mi</span>' +
      '</div>';
    }).join('');

    var toolbar = '<div class="drawer-toolbar">' +
      '<span class="dtool-label">Search</span>' +
      '<input class="dtool-input" id="dfilter-mem-search" placeholder="pod or namespace..." value="' + esc(searchVal) + '">' +
      '<span class="drawer-count" id="dmem-count"></span>' +
      '<div class="dtool-sep"></div>' +
      '<label style="display:flex;align-items:center;gap:6px;font-size:.75em;color:var(--text-dim);cursor:pointer">' +
        '<input type="checkbox" id="mem-show-system"' + (showSysNs?' checked':'') + '> Show system NS' +
      '</label>' +
    '</div>';

    var filtered = mView.filter(function(p) {
      return !searchVal || p.name.toLowerCase().includes(searchVal) || (p.namespace||'').toLowerCase().includes(searchVal);
    });
    filtered = sortData(filtered, drawerSort.col || 'memUsage', drawerSort.dir);

    // OOMKill risk: pod using mem close to request (if request == 0, flag as unset)
    var rows = filtered.map(function(p) {
      var memReq    = p.memRequest || 0;
      var memUse    = p.memUsage  || 0;
      var oomRisk   = memReq > 0 && (memUse / memReq) > 0.85;
      var oomLabel  = memReq === 0
        ? '<span style="color:var(--text-dim);font-size:.75em">no limit</span>'
        : oomRisk
          ? '<span class="badge b-crit">OOM risk</span>'
          : '<span style="color:var(--green);font-size:.75em">&#10003;</span>';
      var memReqTxt = memReq > 0 ? memReq + 'Mi' : 'N/A';
      return '<tr>' +
        '<td class="mono" style="color:var(--text-bright);max-width:180px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="'+esc(p.name)+'">'+esc(p.name)+'</td>' +
        '<td><span class="ns-tag">'+esc(p.namespace)+'</span></td>' +
        '<td class="mono" style="color:var(--purple)">'+memUse+'Mi</td>' +
        '<td class="mono" style="color:var(--text-dim)">'+memReqTxt+'</td>' +
        '<td>'+oomLabel+'</td>' +
      '</tr>';
    }).join('');

    drawerHTML(memInfoCard + statsHtml +
      '<div style="font-size:.72em;color:var(--text-dim);text-transform:uppercase;letter-spacing:.8px">Memory by Namespace</div>' +
      '<div style="background:var(--surface2);border:1px solid var(--border);border-radius:5px;padding:10px 14px">' + (nsBars || '<span style="color:var(--text-dim)">No data</span>') + '</div>' +
      toolbar +
      '<div class="drawer-table-wrap"><table class="wtable"><thead><tr>' +
      makeSortHeader('Pod','name',drawerSort) +
      makeSortHeader('Namespace','namespace',drawerSort) +
      makeSortHeader('Mem Usage','memUsage',drawerSort) +
      '<th>Mem Request</th>' +
      '<th>OOM Risk</th></tr></thead>' +
      '<tbody>' + (rows || '<tr><td colspan="5" style="text-align:center;color:var(--text-dim);padding:16px">No data</td></tr>') + '</tbody></table></div>' +
      '<div style="font-size:.68em;color:var(--text-dim);margin-top:4px;font-style:italic">OOM risk flagged when mem usage > 85% of request. Pods without memory request have no protection against eviction.</div>');

    document.getElementById('dmem-count').textContent = filtered.length + ' pods';
    document.getElementById('dfilter-mem-search').addEventListener('input', renderMemDrawer);
    document.getElementById('mem-show-system').addEventListener('change', renderMemDrawer);
    document.getElementById('mem-info-btn').addEventListener('click', function() {
      var c = document.getElementById('mem-info-card');
      if (c) c.style.display = c.style.display === 'none' ? '' : 'none';
    });
    attachSortHandlers('', renderMemDrawer);
  } catch(e) { drawerHTML('<div style="color:var(--red);padding:20px">Error: ' + esc(e.message) + '</div>'); }
}

// ─── Helper: dstat card ───────────────────────────────────────────────────────
function dstat(label, value, color) {
  return '<div class="dstat"><div class="dstat-lbl">'+esc(label)+'</div><div class="dstat-val" style="color:'+color+'">'+esc(String(value))+'</div></div>';
}

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

// ─── Per-tile namespace selects ───────────────────────────────────────────────
['tile-ns-pods','tile-ns-cpu','tile-ns-mem','tile-ns-finops','tile-ns-eff','tile-ns-workloads','tile-ns-events'].forEach(function(id) {
  var el = document.getElementById(id);
  if (!el) return;
  el.addEventListener('click', function(e) { e.stopPropagation(); });
  el.addEventListener('change', function(e) {
    e.stopPropagation();
    var key = id === 'tile-ns-pods' ? 'pods' : id === 'tile-ns-cpu' ? 'cpu' : id === 'tile-ns-mem' ? 'mem' : id === 'tile-ns-finops' ? 'finops' : id === 'tile-ns-eff' ? 'eff' : 'workloads';
    tileNs[key] = this.value;
    if (key === 'pods') updatePodsTile();
    else if (key === 'cpu') updateCpuTile();
    else if (key === 'mem') updateMemTile();
    else if (key === 'finops') { fetchChart(); updateEfficiency(); }
    else if (key === 'eff') updateEfficiency();
    else updateWorkloads();
  });
});

// ─── Chart area click → same drawer ──────────────────────────────────────────
document.getElementById('honeycomb').addEventListener('click', openNodeDrawer);
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
async function loadVersion() {
  try {
    var data = await (await fetchAuth('/health')).json();
    var v = data && data.version ? data.version : null;
    if (!v) return;
    var badge = document.getElementById('verBadge');
    if (badge) {
      badge.textContent = 'v' + v;
      badge.title = 'Sentinel v' + v + '\nKubernetes Observability\n\u00a9 2026 Sentinel Project';
    }
    // populate Connected tooltip with DB status from /health
    var dbSt = (data.checks && data.checks.database) ? data.checks.database.status : 'unknown';
    updateSpillTip(dbSt);
  } catch(e) { updateSpillTip('unknown'); }
}

loadNamespaces();
loadVersion();
setInterval(update, 5000);
update();
fetchChart();
updateEfficiency();
