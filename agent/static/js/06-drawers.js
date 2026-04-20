
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
  var clean = (typeof DOMPurify !== 'undefined') ? DOMPurify.sanitize(html) : html;
  document.getElementById('drawer-body').innerHTML = clean;
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
function openNodeDrawer(focusNode) {
  _evtDrawerState.focusNode = typeof focusNode === 'string' ? focusNode : null;
  var title = _evtDrawerState.focusNode ? 'Node Health Map — ' + _evtDrawerState.focusNode : 'Node Health Map — Detail';
  openDrawer(title, renderNodeDrawer);
}

async function renderNodeDrawer() {
  try {
    var focusNode = _evtDrawerState.focusNode;
    var s = await (await fetchAuth('/api/summary')).json();
    var mData = await (await fetchAuth('/api/metrics')).json();
    var nodes = s.nodes || [];
    
    // Fallback for mock data
    if (nodes.length === 1 && window._mockNodes) {
       nodes = window._mockNodes;
    }
    
    var pods  = s.podsByPhase || {};
    var totalPods = Object.values(pods).reduce(function(a,b){return a+b;},0);
    var reqPct = s.cpuAllocatable > 0 ? (s.cpuRequested / s.cpuAllocatable * 100) : 0;
    
    var targetNode = null;
    if (focusNode) {
      targetNode = nodes.find(function(n) { return n.name === focusNode; });
    }

    // 1. Glossary Card
    var nodeInfoCard = '';
    if (focusNode) {
      nodeInfoCard = '<div style="display:flex;align-items:center;gap:8px;margin-bottom:12px">' +
        '<button class="btn-refresh" id="node-detail-back" style="font-size:.72em">&#8592; Back to node list</button>' +
      '</div>' +
      '<button class="grade-info-btn" id="node-info-btn" style="margin-bottom:16px;width:100%;padding:10px;text-align:center;font-size:.8em;background:rgba(0,180,255,.08)">ⓘ What these metrics mean</button>' +
      '<div id="node-info-card" style="display:none;background:var(--surface2);border:1px solid var(--border);border-radius:8px;padding:14px 16px;margin-bottom:12px;font-size:.82em;line-height:1.6">' +
        '<div class="gl-title" style="margin-bottom:8px">Node Detail — metric glossary</div>' +
        '<div class="gl-row"><span style="color:var(--green);font-weight:600;min-width:160px">Node Status</span><span class="gl-desc">Current condition of the Kubelet. Red indicates network/system unreachability.</span></div>' +
        '<div class="gl-row"><span style="color:var(--cyan);font-weight:600;min-width:160px">Pod Count</span><span class="gl-desc">Total pods assigned to this node, regardless of phase.</span></div>' +
        '<div class="gl-row"><span style="color:var(--orange);font-weight:600;min-width:160px">CPU Saturation</span><span class="gl-desc">Total CPU Requested ÷ Node CPU Allocatable. High values (&gt;85%) risk scheduling delays.</span></div>' +
        '<div class="gl-row" style="border-bottom:none"><span style="color:var(--purple);font-weight:600;min-width:160px">Mem Saturation</span><span class="gl-desc">Total Memory Requested ÷ Node Mem Allocatable. High values risk OOM.</span></div>' +
      '</div>';
    } else {
      nodeInfoCard = '<button class="grade-info-btn" id="node-info-btn" style="margin-bottom:16px;width:100%;padding:10px;text-align:center;font-size:.8em;background:rgba(0,180,255,.08)">ⓘ What these metrics mean</button>' +
      '<div id="node-info-card" style="display:none;background:var(--surface2);border:1px solid var(--border);border-radius:8px;padding:14px 16px;margin-bottom:12px;font-size:.82em;line-height:1.6">' +
        '<div class="gl-title" style="margin-bottom:8px">Node Health Map — metric glossary</div>' +
        '<div class="gl-row"><span style="color:var(--cyan);font-weight:600;min-width:160px">Total Nodes</span><span class="gl-desc">Number of worker nodes registered and reporting to the cluster.</span></div>' +
        '<div class="gl-row"><span style="color:var(--green);font-weight:600;min-width:160px">Total Pods</span><span class="gl-desc">All pods across all namespaces and phases (Running, Pending, etc.).</span></div>' +
        '<div class="gl-row"><span style="color:var(--orange);font-weight:600;min-width:160px">CPU Requested</span><span class="gl-desc">Total CPU reserved by all pods via <code>resources.requests.cpu</code>. What the scheduler has committed.</span></div>' +
        '<div class="gl-row"><span style="color:var(--text-bright);font-weight:600;min-width:160px">CPU Allocatable</span><span class="gl-desc">Node capacity minus OS/kubelet overhead. The real scheduling budget.</span></div>' +
        '<div class="gl-row"><span style="color:var(--purple);font-weight:600;min-width:160px">Memory Requested</span><span class="gl-desc">Total memory reserved across all pods. High values risk OOM evictions.</span></div>' +
        '<div class="gl-row" style="border-bottom:none"><span style="color:var(--cyan);font-weight:600;min-width:160px">Efficiency</span><span class="gl-desc">Actual CPU usage ÷ CPU requested. Low = over-provisioned; high (&gt;85%) = risk of throttling.</span></div>' +
      '</div>';
    }

    // 2. Stats Block and Pod List Filtering
    var statsHtml = '';
    var nodeCards = '';
    var displayPods = [];

    if (targetNode) {
      var nCpuSat = targetNode.cpuAllocatable > 0 ? (targetNode.cpuRequested / targetNode.cpuAllocatable) * 100 : 0;
      var nMemSat = targetNode.memAllocatable > 0 ? (targetNode.memRequested / targetNode.memAllocatable) * 100 : 0;
      
      statsHtml = '<div class="drawer-stats" style="margin-bottom:20px">' +
        dstat('Node Status', targetNode.status, targetNode.status === 'Running' ? 'var(--green)' : 'var(--red)') +
        dstat('Pod Count', targetNode.podCount || 0, 'var(--cyan)') +
        dstat('CPU Saturation', nCpuSat.toFixed(1) + '%', nCpuSat > 85 ? 'var(--red)' : nCpuSat > 75 ? 'var(--orange)' : 'var(--green)') +
        dstat('Mem Saturation', nMemSat.toFixed(1) + '%', nMemSat > 85 ? 'var(--red)' : nMemSat > 75 ? 'var(--orange)' : 'var(--purple)') +
      '</div>' + 
      '<div style="margin-bottom:24px;display:flex;flex-direction:column;gap:12px;background:var(--surface);padding:16px;border-radius:6px;border:1px solid var(--border)">' +
        '<div class="pod-detail-row" style="border:none;padding:0;margin:0"><span class="pod-detail-label" style="width:140px;color:var(--text-dim);font-size:.75em;text-transform:uppercase;letter-spacing:1px">CPU Requested</span>' +
          '<span class="pod-detail-val mono" style="width:160px">' + Math.floor(targetNode.cpuRequested) + 'm / ' + Math.floor(targetNode.cpuAllocatable) + 'm</span>' +
          '<div class="pod-detail-bar" style="max-width:300px;flex-grow:1;height:8px;background:rgba(255,255,255,.12)"><div class="pod-detail-fill" style="width:' + Math.min(nCpuSat,100).toFixed(1) + '%;background:' + (nCpuSat > 85 ? 'var(--red)' : nCpuSat > 75 ? 'var(--orange)' : 'var(--green)') + '"></div></div>' +
          '<span class="mono" style="margin-left:12px;font-size:0.9em;color:var(--text-bright)">' + nCpuSat.toFixed(1) + '%</span>' +
        '</div>' +
        '<div class="pod-detail-row" style="border:none;padding:0;margin:0"><span class="pod-detail-label" style="width:140px;color:var(--text-dim);font-size:.75em;text-transform:uppercase;letter-spacing:1px">Memory Requested</span>' +
          '<span class="pod-detail-val mono" style="width:160px">' + Math.floor(targetNode.memRequested) + 'Mi / ' + Math.floor(targetNode.memAllocatable) + 'Mi</span>' +
          '<div class="pod-detail-bar" style="max-width:300px;flex-grow:1;height:8px;background:rgba(255,255,255,.12)"><div class="pod-detail-fill" style="width:' + Math.min(nMemSat,100).toFixed(1) + '%;background:var(--purple)"></div></div>' +
          '<span class="mono" style="margin-left:12px;font-size:0.9em;color:var(--text-bright)">' + nMemSat.toFixed(1) + '%</span>' +
        '</div>' +
      '</div>';
      
      if (focusNode.startsWith('mock-node-')) {
         var numMockPods = targetNode.podCount || 0;
         var cpuBudget = targetNode.cpuRequested;
         for (var i=0; i<numMockPods; i++) {
           var rCpu = Math.floor(cpuBudget / numMockPods) + Math.floor(Math.random() * 50);
           var uCpu = Math.floor(rCpu * (0.6 + Math.random() * 0.4));
           displayPods.push({
             name: 'mock-workload-' + (i+1),
             namespace: i%2===0 ? 'sentinel-gemini' : 'default',
             cpuUsage: uCpu,
             cpuRequest: rCpu,
             cpuRequestPresent: true
           });
         }
      } else {
         displayPods = mData.filter(function(p) { return p.nodeName === focusNode; });
      }
    } else {
      var clusterMemSat = s.memAllocatable > 0 ? (s.memRequested / s.memAllocatable * 100) : 0;
      var clusterCpuSat = s.cpuAllocatable > 0 ? (s.cpuRequested / s.cpuAllocatable * 100) : 0;

      statsHtml = '<div class="drawer-stats" style="margin-bottom:20px">' +
        dstat('Total Nodes', nodes.length, 'var(--cyan)') +
        dstat('Total Pods', totalPods, 'var(--green)') +
        dstat('CPU Requested', s.cpuRequested + 'm', 'var(--orange)') +
        dstat('CPU Allocatable', s.cpuAllocatable + 'm', 'var(--text-bright)') +
        dstat('Memory Requested', s.memRequested + 'Mi', 'var(--purple)') +
        dstat('Efficiency', s.efficiency.toFixed(1) + '%', s.efficiency > 85 ? 'var(--red)' : s.efficiency > 70 ? 'var(--orange)' : 'var(--cyan)') +
      '</div>' +
      '<div style="margin-bottom:24px;display:flex;flex-direction:column;gap:12px;background:var(--surface);padding:16px;border-radius:6px;border:1px solid var(--border)">' +
        '<div class="pod-detail-row" style="border:none;padding:0;margin:0"><span class="pod-detail-label" style="width:140px;color:var(--text-dim);font-size:.75em;text-transform:uppercase;letter-spacing:1px">Cluster CPU Reservation</span>' +
          '<div class="pod-detail-bar" style="max-width:300px;flex-grow:1;height:8px;background:rgba(255,255,255,.12)"><div class="pod-detail-fill" style="width:' + Math.min(clusterCpuSat,100).toFixed(1) + '%;background:' + (clusterCpuSat > 85 ? 'var(--red)' : clusterCpuSat > 70 ? 'var(--orange)' : 'var(--cyan)') + '"></div></div>' +
          '<span class="mono" style="margin-left:12px;font-size:0.9em;color:var(--text-bright)">' + clusterCpuSat.toFixed(1) + '%</span>' +
        '</div>' +
        '<div class="pod-detail-row" style="border:none;padding:0;margin:0"><span class="pod-detail-label" style="width:140px;color:var(--text-dim);font-size:.75em;text-transform:uppercase;letter-spacing:1px">Cluster Mem Reservation</span>' +
          '<div class="pod-detail-bar" style="max-width:300px;flex-grow:1;height:8px;background:rgba(255,255,255,.12)"><div class="pod-detail-fill" style="width:' + Math.min(clusterMemSat,100).toFixed(1) + '%;background:var(--purple)"></div></div>' +
          '<span class="mono" style="margin-left:12px;font-size:0.9em;color:var(--text-bright)">' + clusterMemSat.toFixed(1) + '%</span>' +
        '</div>' +
      '</div>';

      nodeCards = nodes.slice().sort(function(a,b){
        var aScore = (a.status !== 'Running' ? 1000 : 0) + (a.cpuAllocatable > 0 ? (a.cpuRequested / a.cpuAllocatable * 100) : 0);
        var bScore = (b.status !== 'Running' ? 1000 : 0) + (b.cpuAllocatable > 0 ? (b.cpuRequested / b.cpuAllocatable * 100) : 0);
        return bScore - aScore;
      }).map(function(n) {
        var isOk = n.status === 'Running';
        var nCpuSat = n.cpuAllocatable > 0 ? (n.cpuRequested / n.cpuAllocatable * 100) : 0;
        var nMemSat = n.memAllocatable > 0 ? (n.memRequested / n.memAllocatable * 100) : 0;
        var hasPressure = nCpuSat >= 100 || nMemSat >= 100;
        var cpuBarColor = nCpuSat > 85 ? 'var(--red)' : nCpuSat > 70 ? 'var(--orange)' : 'var(--cyan)';
        var memBarColor = nMemSat > 90 ? 'var(--red)' : nMemSat > 75 ? 'var(--orange)' : 'var(--purple)';
        
        var cardStyle = 'cursor:pointer';
        if (hasPressure) cardStyle += ';border:1px solid var(--red);background:rgba(220,38,38,0.05)';

        return '<div class="pod-detail-card node-card-clickable" data-node="' + esc(n.name) + '" style="' + cardStyle + '">' +
          '<div class="pod-detail-row">' +
            '<span class="pod-detail-label">Node</span>' +
            '<span class="pod-detail-val" style="color:var(--cyan)">' + esc(n.name) + '</span>' +
            '<span class="badge ' + (isOk ? 'b-ok' : 'b-crit') + '" style="font-size:.7em;margin-left:8px">' + (isOk ? 'Ready' : 'NotReady') + '</span>' +
            (hasPressure ? '<span class="badge b-crit" style="font-size:.7em;margin-left:8px">PRESSURE</span>' : '') +
            '<span style="color:var(--text-dim);font-size:.78em;margin-left:auto">' + (n.podCount || 0) + ' pods</span>' +
          '</div>' +
          '<div class="pod-detail-row" style="align-items:center">' +
            '<span class="pod-detail-label" style="min-width:80px">CPU</span>' +
            '<span class="pod-detail-val mono" style="min-width:130px">' + Math.floor(n.cpuRequested) + 'm / ' + Math.floor(n.cpuAllocatable) + 'm</span>' +
            '<div class="pod-detail-bar" style="flex:1;max-width:200px"><div class="pod-detail-fill" style="width:' + Math.min(nCpuSat,100).toFixed(1) + '%;background:' + cpuBarColor + '"></div></div>' +
            '<span class="mono" style="margin-left:8px;font-size:.8em;min-width:36px;text-align:right;color:' + cpuBarColor + '">' + nCpuSat.toFixed(0) + '%</span>' +
          '</div>' +
          '<div class="pod-detail-row" style="align-items:center">' +
            '<span class="pod-detail-label" style="min-width:80px">Memory</span>' +
            '<span class="pod-detail-val mono" style="min-width:130px">' + Math.floor(n.memRequested) + 'Mi / ' + Math.floor(n.memAllocatable) + 'Mi</span>' +
            '<div class="pod-detail-bar" style="flex:1;max-width:200px"><div class="pod-detail-fill" style="width:' + Math.min(nMemSat,100).toFixed(1) + '%;background:' + memBarColor + '"></div></div>' +
            '<span class="mono" style="margin-left:8px;font-size:.8em;min-width:36px;text-align:right;color:' + memBarColor + '">' + nMemSat.toFixed(0) + '%</span>' +
          '</div>' +
        '</div>';
      }).join('');
      displayPods = mData;
    }

    // 3. Build Pod Table Rows
    displayPods.sort(function(a,b){ return b.cpuUsage - a.cpuUsage; });
    var podRows = '';
    if (displayPods.length === 0) {
      podRows = '<tr><td colspan="7" style="text-align:center;color:var(--text-dim);padding:20px">No data</td></tr>';
    } else {
      podRows = displayPods.map(function(p, i) {
        var pctVal = p.cpuRequestPresent && p.cpuRequest > 0 ? (p.cpuUsage / p.cpuRequest * 100) : 0;
        var pctStr = p.cpuRequestPresent && p.cpuRequest > 0 ? pctVal.toFixed(1) + '%' : 'N/A';
        return '<tr class="waste-row-clickable">' +
          '<td class="mono" style="color:var(--text-dim)">' + (i+1) + '</td>' +
          '<td class="mono" style="color:var(--text-bright)">' + esc(p.name||'--') + '</td>' +
          '<td><span class="ns-tag">' + esc(p.namespace||'--') + '</span></td>' +
          '<td class="mono" style="color:var(--orange)">' + (p.cpuUsage||0) + 'm</td>' +
          '<td class="mono" style="color:var(--text-dim)">' + (p.cpuRequestPresent ? p.cpuRequest+'m' : 'N/A') + '</td>' +
          '<td class="mono" style="color:var(--purple)">' + (p.memUsage||0) + 'Mi</td>' +
          '<td class="mono" style="color:var(--cyan)">' + pctStr + '</td></tr>';
      }).join('');
    }

    // 4. Final Assemblage
    var finalHTML = nodeInfoCard + statsHtml + nodeCards;
    
    if (focusNode) {
      finalHTML += '<div style="font-size:.72em;color:var(--text-dim);text-transform:uppercase;letter-spacing:1px;margin-bottom:8px;margin-top:16px">Pods on this Node (' + displayPods.length + ')</div>' +
        '<div class="drawer-table-wrap" style="padding-bottom:10px">' +
          '<table class="wtable" style="font-size:0.85em;margin-bottom:20px">' +
            '<thead><tr><th>#</th><th>Pod</th><th>Namespace</th><th>CPU Usage</th><th>CPU Request</th><th>Mem Usage</th><th>CPU Util</th></tr></thead>' +
            '<tbody>' + podRows + '</tbody>' +
          '</table>' +
        '</div>';
    }

    drawerHTML(finalHTML);

    document.getElementById('node-info-btn').addEventListener('click', function() {
      var c = document.getElementById('node-info-card');
      if (c) c.style.display = c.style.display === 'none' ? '' : 'none';
    });

    if (document.getElementById('node-detail-back')) {
      document.getElementById('node-detail-back').addEventListener('click', function() {
        openNodeDrawer(null);
      });
    }
  } catch(e) { 
    console.error('Drawer render error:', e);
    drawerHTML('<div style="color:var(--red);padding:20px">Error loading node data: ' + esc(e.message) + '</div>'); 
  }
}

// Global event delegation for node cards within the drawer
(function() {
  var db = document.getElementById('drawer-body');
  if (db) {
    db.addEventListener('click', function(e) {
      var card = e.target.closest('.node-card-clickable');
      if (card && card.dataset.node) {
        openNodeDrawer(card.dataset.node);
      }
    });
  }
})();

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
      if (inc.narrative) msg += '<div style="font-size:.74em;color:var(--text-dim);margin-top:6px;font-style:italic;border-left:2px solid var(--orange);padding-left:8px">' + esc(inc.narrative) + '</div>';

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
      dstat('Est. Cost Save', '$' + fmtMoney(data.totalSavingUSD||0)+'/hr', 'var(--yellow)') +
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
        '<span class="pod-detail-val" style="color:' + sevColor + '">' + entry.potentialSavingMCpu + 'm (' + esc(entry.opportunity) + ')</span>' +
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

