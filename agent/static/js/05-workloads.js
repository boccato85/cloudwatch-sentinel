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
      dstat('Total Budget', '$' + fmtMoney(totalBudget), 'var(--red)') +
      dstat('Total Actual', '$' + fmtMoney(totalActual), 'var(--green)') +
      dstat('Total Waste',  '$' + fmtMoney(totalWaste), wastePct > 40 ? 'var(--red)' : wastePct > 20 ? 'var(--orange)' : 'var(--yellow)') +
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
        dstat('Proj. Budget', '$' + fmtMoney(projBudget), 'var(--purple)') +
        dstat('Proj. Usage',  '$' + fmtMoney(projUsage),  'var(--cyan)') +
        dstat('Proj. Waste',  '$' + fmtMoney(projWaste) + ' (' + projPct.toFixed(0) + '%)', 'var(--orange)') +
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
function toggleFinOpsLegend() {
  var tip = document.getElementById('finops-legend-tip');
  var btn = document.getElementById('finopsHelp');
  if (!tip || !btn) return;
  if (tip.classList.contains('visible')) { tip.classList.remove('visible'); return; }
  var rect = btn.getBoundingClientRect();
  tip.style.top = (rect.bottom + 6) + 'px';
  tip.style.left = (rect.left - 200) + 'px'; // offset to the left to align better
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
    var hbtn = document.getElementById('finopsHelp');
    if ((!btn || !btn.contains(e.target)) && (!hbtn || !hbtn.contains(e.target))) {
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
          return '<span class="ns-tag" style="margin-left:4px">' + esc(n.namespace) + ' <span style="color:' + (gradeColorsHex[grades.indexOf(n.grade)] || 'var(--text-dim)') + '">' + n.score.toFixed(0) + '%</span></span>';
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
          return '<span class="ns-tag" style="margin-left:4px">' + esc(n.namespace) + ' <span style="color:' + (gradeColorsHex[grades.indexOf(n.grade)] || 'var(--text-dim)') + '">' + n.score.toFixed(0) + '% ' + esc(n.grade) + '</span></span>';
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
