
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

    if (!activeNs) {
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
    if (!activeNs) {
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

    var drawNodes = nodes;

    // ── Honeycomb: Auto-Scaling and dynamic packing ──────────────────────────
    hc.style.display = 'none';
    var containerWidth = hc.parentElement ? hc.parentElement.clientWidth - 28 : 300;
    hc.style.display = 'flex';
    if (containerWidth < 100) containerWidth = 300;

    var count = drawNodes.length;
    var hexW = 40;
    if (count > 24) hexW = 32;
    if (count > 50) hexW = 24;
    if (count > 100) hexW = 16;
    if (count > 250) hexW = 10;

    var hexesPerRow = Math.max(1, Math.floor((containerWidth - (hexW/2)) / hexW));
    hc.style.setProperty('--hex-w', hexW + 'px');

    var gridWrap = document.createElement('div');
    gridWrap.style.display = 'flex';
    gridWrap.style.flexDirection = 'column';
    gridWrap.style.alignItems = 'flex-start';

    var totalRows = Math.ceil(count / hexesPerRow);
    for (var rowIdx = 0; rowIdx < totalRows; rowIdx++) {
      var rowEl = document.createElement('div');
      rowEl.className = 'hcomb-row' + (rowIdx % 2 === 1 ? ' odd' : '');
      var rowStart = rowIdx * hexesPerRow;
      var rowEnd = Math.min(rowStart + hexesPerRow, count);
      for (var ni = rowStart; ni < rowEnd; ni++) {
        var nd = drawNodes[ni];
        var d = document.createElement('div');
        var cpuSat = nd.cpuAllocatable > 0 ? (nd.cpuRequested / nd.cpuAllocatable) * 100 : 0;
        var memSat = nd.memAllocatable > 0 ? (nd.memRequested / nd.memAllocatable) * 100 : 0;
        var maxSat = Math.max(cpuSat, memSat);

        var hexClass = 'hex';
        if (nd.status !== 'Running') {
          hexClass += ' issue';
          d.style.background = '#dc2626';
          d.style.color = '#fff';
        } else {
          var hue = Math.round(120 - maxSat * 1.2);
          d.style.background = 'hsl(' + hue + ',72%,40%)';
          d.style.color = '#fff';
        }

        d.className = hexClass;
        d.dataset.node = nd.name;
        var nsPodsOnNode = activeNs ? nsPods.filter(function(p) { return p.node === nd.name; }).length : 0;
        var podInfoText = activeNs ? 'Total Pods: ' + (nd.podCount || 0) + ' (' + nsPodsOnNode + ' in ' + activeNs + ')' : 'Pods: ' + (nd.podCount || 0);
        d.title = nd.name + '\nCPU: ' + cpuSat.toFixed(1) + '% | Mem: ' + memSat.toFixed(1) + '% | ' + podInfoText;
        var _abbrev = (function(nm) {
          var m = nm.match(/(\d+)$/);
          if (m) return '#' + m[1];
          return nm.length <= 5 ? nm : nm.slice(-4);
        })(nd.name);
        var showText = (hexW >= 30);
        d.innerHTML = showText ?
          '<div style="display:flex;flex-direction:column;align-items:center;justify-content:center;' +
          'line-height:1.2;gap:0;pointer-events:none">' +
          '<span style="font-size:7px;font-family:monospace;font-weight:600;letter-spacing:-.2px;opacity:.85">' + esc(_abbrev) + '</span>' +
          '<span style="font-size:11px;font-weight:900;opacity:.95">' + (nd.podCount || 0) + '</span>' +
          '</div>' : '';
        d.style.cursor = 'pointer';
        d.onclick = function(e) {
          e.stopPropagation();
          if (typeof openNodeDrawer === 'function') openNodeDrawer(this.dataset.node);
        };
        rowEl.appendChild(d);
      }
      gridWrap.appendChild(rowEl);
    }
    hc.appendChild(gridWrap);

    var nb = document.getElementById('nbadge');
    nb.textContent = issues > 0 ? issues + ' Issues' : 'All OK';
    nb.className = 'badge ' + (issues > 0 ? 'b-crit' : 'b-ok');

    if (!activeNs) {
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
      
      var fillPct = 0;
      if (topCpuPod.cpuRequest > 0) {
        fillPct = Math.min(100, (topCpuPod.cpuUsage / topCpuPod.cpuRequest) * 100);
      }
      if(fillPct === Infinity || isNaN(fillPct)) fillPct = 0;
      var cCard = document.getElementById('kCpuCard');
      if (cCard) {
        if (topCpuPod.cpuRequest > 0) {
           cCard.style.backgroundImage = 'linear-gradient(to right, rgba(0, 180, 255, 0.12) ' + fillPct.toFixed(0) + '%, transparent ' + fillPct.toFixed(0) + '%)';
        } else {
           cCard.style.backgroundImage = 'linear-gradient(to right, rgba(255, 255, 255, 0.03) 100%, transparent 100%)';
        }
      }
    }
    // top memory consumer KPI
    var topByMem = m.slice().sort(function(a,b){ return (b.memUsage||0) - (a.memUsage||0); });
    if (topByMem.length > 0) {
      var topMemPod = topByMem[0];
      document.getElementById('kMem').textContent  = (topMemPod.memUsage || 0) + 'Mi';
      document.getElementById('kMems').textContent = topMemPod.name || '--';
      
      var fillPctM = 0;
      if (topMemPod.memRequest > 0) {
         fillPctM = Math.min(100, (topMemPod.memUsage / topMemPod.memRequest) * 100);
      }
      if(fillPctM === Infinity || isNaN(fillPctM)) fillPctM = 0;
      var mCard = document.getElementById('kMemCard');
      if (mCard) {
         if (topMemPod.memRequest > 0) {
            mCard.style.backgroundImage = 'linear-gradient(to right, rgba(168, 85, 247, 0.12) ' + fillPctM.toFixed(0) + '%, transparent ' + fillPctM.toFixed(0) + '%)';
         } else {
            mCard.style.backgroundImage = 'linear-gradient(to right, rgba(255, 255, 255, 0.03) 100%, transparent 100%)';
         }
      }
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
    if (sorted.length > 0 && totalCpuM > 0) {
      var cum = 0, n = 0;
      for (var i = 0; i < sorted.length; i++) {
        cum += Number(sorted[i].potentialSavingMCpu||0);
        n++;
        if (cum / totalCpuM >= 0.6) break;
      }
      var pct = Math.round(cum / totalCpuM * 100);
      paretoLabel = 'top ' + n + ' pod' + (n !== 1 ? 's' : '') + ' → ' + pct + '% of waste';
    } else {
      paretoLabel = 'all pods rightsized';
    }
    var kWpareto = document.getElementById('kWpareto');
    if (kWpareto) kWpareto.textContent = paretoLabel;

    var wc = document.getElementById('wcnt');
    if (wc) {
      wc.textContent = waste.length > 0 ? waste.length + ' waste item' + (waste.length !== 1 ? 's' : '') : 'All rightsized';
      wc.className = 'badge ' + (waste.length > 0 ? 'b-warn' : 'b-ok');
    }

    var topClock = document.getElementById('lastUp');
    if (topClock) topClock.textContent = 'Updated: ' + new Date().toLocaleTimeString();

    var ctxNs = document.getElementById('ctx-ns');
    if (ctxNs) {
      ctxNs.textContent = (activeNs || 'All Namespaces');
      ctxNs.className = activeNs ? 'badge b-finops' : 'badge b-ok';
    }

    var ctxPods = document.getElementById('ctx-pods');
    if (ctxPods) ctxPods.textContent = (allPods.length) + ' pods';

    var ctxHealth = document.getElementById('ctx-health');
    if (ctxHealth) {
      var hCrit = critIncs.length;
      var hWarn = warnIncs.length;
      if (hCrit > 0) {
        ctxHealth.innerHTML = '<span style="font-weight:700">' + hCrit + ' Critical</span>' + (hWarn > 0 ? ' &nbsp; <span style="opacity:0.8">•</span> &nbsp; ' + hWarn + ' Warn' : '');
        ctxHealth.className = 'badge b-crit';
      } else if (hWarn > 0) {
        ctxHealth.innerHTML = '<span style="font-weight:700">' + hWarn + ' Warning' + (hWarn > 1 ? 's' : '') + '</span>';
        ctxHealth.className = 'badge b-warn';
      } else {
        ctxHealth.textContent = 'Health: OK';
        ctxHealth.className = 'badge b-ok';
      }
    }

    var ctxWaste = document.getElementById('ctx-waste');
    if (ctxWaste) {
      ctxWaste.innerHTML = waste.length > 0 ? '<span style="font-weight:700">' + waste.length + ' Waste item' + (waste.length > 1 ? 's' : '') + '</span>' : 'Waste: 0';
      ctxWaste.className = waste.length > 0 ? 'badge b-warn' : 'badge b-ok';
    }

    var ctxEff = document.getElementById('ctx-eff');
    if (ctxEff) {
      var effVal = isNaN(eff) ? 100 : eff;
      ctxEff.innerHTML = 'Eff: <span style="font-weight:700">' + effVal.toFixed(1) + '%</span>';
      ctxEff.className = effVal < 50 ? 'badge b-crit' : (effVal < 75 ? 'badge b-warn' : 'badge b-ok');
    }

  } catch(e) { console.error('Sentinel overview error:', e); }
}

// ─── Overview Recent Events ─────────────────────────────────────────────────────
var lastIncidents = [];
var eventsSort = { col: 'severity', dir: 'desc' };

async function renderOverviewEvents() {
  try {
    var ns = activeNs; // Usa o filtro global do topo
    var url = '/api/incidents';
    if (ns) url += '?namespace=' + encodeURIComponent(ns);
    var incidents = await (await fetchAuth(url)).json();
    incidents = incidents || [];
    
    // Filtro adicional local baseado na flag de sistema global e no activeNs
    var showSysGlobal = document.getElementById('global-show-system') ? document.getElementById('global-show-system').checked : false;
    
    lastIncidents = incidents.filter(function(i) {
      // 1. Respeito ao Filtro Global: Se houver um namespace selecionado no topo, só mostrar ele.
      if (activeNs && i.namespace !== activeNs) return false;

      // 2. Filtro de Sistema: Se 'Show system NS' estiver desligado, esconder namespaces do sistema.
      if (!showSysGlobal && _SYSTEM_NS[i.namespace]) return false;

      return true;
    });

    // Ordenação dinâmica baseada em eventsSort
    lastIncidents.sort(function(a, b) {
      if (eventsSort.col === 'severity') {
        var scoreA = (a.type === 'HighCPU') ? 4 : (a.severity === 'CRITICAL' || a.severity === 'critical') ? 3 : (a.severity === 'WARNING' || a.severity === 'warning') ? 1 : 0;
        var scoreB = (b.type === 'HighCPU') ? 4 : (b.severity === 'CRITICAL' || b.severity === 'critical') ? 3 : (b.severity === 'WARNING' || b.severity === 'warning') ? 1 : 0;
        if (scoreA !== scoreB) {
          return eventsSort.dir === 'desc' ? (scoreB - scoreA) : (scoreA - scoreB);
        }
      } else {
        var av = a[eventsSort.col] || '';
        var bv = b[eventsSort.col] || '';
        if (typeof av === 'string') { av = av.toLowerCase(); bv = bv.toLowerCase(); }
        if (av < bv) return eventsSort.dir === 'asc' ? -1 : 1;
        if (av > bv) return eventsSort.dir === 'asc' ? 1 : -1;
      }
      
      // Desempate pela idade (mais novos primeiro)
      return _parseIncidentAgeSeconds(a.age) - _parseIncidentAgeSeconds(b.age);
    });

    var cnt = lastIncidents.length;
    var evtcnt = document.getElementById('evtcnt');
    if (evtcnt) {
      evtcnt.textContent = cnt + ' incident' + (cnt !== 1 ? 's' : '');
      evtcnt.className = 'badge ' + (lastIncidents.some(function(i){ return i.severity === 'CRITICAL'; }) ? 'b-crit' : cnt > 0 ? 'b-warn' : 'b-ok');
    }

    var rows = '';
    lastIncidents.forEach(function(inc, i) {
      var sevClass = (inc.severity === 'CRITICAL' || inc.severity === 'critical') ? 'b-crit' : 'b-warn';
      var msg = esc(inc.message || '--');
      if (msg.length > 100) msg = msg.substring(0, 97) + '...';
      rows += '<tr class="waste-row-clickable" data-inc-idx="' + i + '">' +
        '<td><span class="badge ' + sevClass + '" style="font-size:.7em">' + esc(inc.severity||'--') + '</span></td>' +
        '<td style="font-size:.78em;color:var(--text-dim)">' + esc(inc.type||'--') + '</td>' +
        '<td style="font-size:.78em;max-width:120px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="' + esc(inc.podName||'') + '">' + esc(inc.podName||'--') + '</td>' +
        '<td style="font-size:.72em"><span class="ns-tag">' + esc(inc.namespace||'--') + '</span></td>' +
        '<td style="font-size:.72em;color:var(--text-dim)">' + esc(inc.age||'--') + '</td>' +
        '<td style="font-size:.72em;color:var(--text-dim);max-width:250px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="' + esc(inc.message||'').replace(/"/g, '&quot;') + '">' + msg + '</td>' +
        '</tr>';
    });
    
    var h = document.getElementById('evthead');
    if (h) {
      var sFn = function(l,c) { return '<th class="th-sort '+(eventsSort.col===c?eventsSort.dir:'')+'" data-col="'+c+'">'+l+'</th>'; };
      h.innerHTML = sFn('Severity','severity') + sFn('Type','type') + sFn('Pod','podName') + sFn('NS','namespace') + sFn('Age','age') + '<th>Message</th>';
      
      h.querySelectorAll('.th-sort').forEach(function(th) {
        th.addEventListener('click', function() {
          var col = th.dataset.col;
          if (eventsSort.col === col) {
            eventsSort.dir = eventsSort.dir === 'desc' ? 'asc' : 'desc';
          } else {
            eventsSort.col = col;
            eventsSort.dir = 'desc';
          }
          renderOverviewEvents();
        });
      });
    }
    
    document.getElementById('evtbody').innerHTML = rows || '<tr><td colspan="6" style="text-align:center;color:var(--text-dim);padding:16px">No incidents detected</td></tr>';

    document.querySelectorAll('#evtbody .waste-row-clickable').forEach(function(row) {
      row.addEventListener('click', function() {
        var inc = lastIncidents[this.dataset.incIdx];
        if (inc && typeof openIncidentDetailDrawer === 'function') openIncidentDetailDrawer(inc);
      });
    });
  } catch(e) { console.error('incidents tile error:', e); }
}

// ─── Drawer: Incidents ────────────────────────────────────────────────────────
var _evtDrawerState = { ns: '', range: '24h', search: '' };
var _evtDrawerAbortable = null;
var _evtDrawerSearchTimer = null;
var _evtDrawerReqId = 0;

var _INCIDENT_RANGES = [
  { label: '30m', seconds: 1800 },
  { label: '1h',  seconds: 3600 },
  { label: '6h',  seconds: 21600 },
  { label: '24h', seconds: 86400 },
  { label: '7d',  seconds: 604800 },
  { label: 'All', seconds: Infinity }
];

function _parseIncidentAgeSeconds(age) {
  if (!age) return Infinity;
  var m;
  if ((m = age.match(/^(\d+)s$/))) return parseInt(m[1]);
  if ((m = age.match(/^(\d+)m(?:\s*(\d+)s)?$/))) return parseInt(m[1]) * 60 + (m[2] ? parseInt(m[2]) : 0);
  if ((m = age.match(/^(\d+)h(?:\s*(\d+)m)?$/))) return parseInt(m[1]) * 3600 + (m[2] ? parseInt(m[2]) * 60 : 0);
  if ((m = age.match(/^(\d+)d$/))) return parseInt(m[1]) * 86400;
  return Infinity;
}

function openEventsDrawer() {
  var curNs = document.getElementById('tile-ns-events') ? document.getElementById('tile-ns-events').value : '';
  _evtDrawerState = { ns: curNs, range: '24h', search: '' };
  openDrawer('Sentinel Incidents', renderEventsDrawer);
}

async function renderEventsDrawer() {
  try {
    var nsFilter = _evtDrawerState.ns;
    var rangeLabel = _evtDrawerState.range;
    var searchVal = _evtDrawerState.search;
    var rangeObj = _INCIDENT_RANGES.find(function(r){ return r.label === rangeLabel; }) || _INCIDENT_RANGES[3];
    var maxSec = rangeObj.seconds;

    var myReqId = ++_evtDrawerReqId;

    if (_evtDrawerAbortable) _evtDrawerAbortable.abort();
    var ctrl = new AbortController();
    _evtDrawerAbortable = ctrl;

    var incidents = await (await fetchAuth('/api/incidents', { signal: ctrl.signal })).json();
    if (myReqId !== _evtDrawerReqId) return;
    incidents = incidents || [];

    var filtered = incidents.filter(function(inc) {
      if (nsFilter && inc.namespace !== nsFilter) return false;
      if (searchVal && !(inc.podName||'').toLowerCase().includes(searchVal) && !(inc.message||'').toLowerCase().includes(searchVal) && !(inc.type||'').toLowerCase().includes(searchVal)) return false;
      // HighCPU fura o filtro de tempo para garantir visibilidade máxima
      if (inc.type !== 'HighCPU' && maxSec !== Infinity && _parseIncidentAgeSeconds(inc.age) > maxSec) return false;
      return true;
    });

    filtered = filtered.slice().sort(function(a, b) {
      var av, bv;
      if (eventsSort.col === 'severity') {
        var getScore = function(inc) {
          if (inc.type === 'HighCPU') return 4; // Fura a fila de todos
          if (inc.severity === 'CRITICAL' || inc.severity === 'critical') return 3;
          if (inc.severity === 'WARNING' || inc.severity === 'warning') return 1;
          return 0;
        };
        av = getScore(a);
        bv = getScore(b);
      } else {
        av = a[eventsSort.col] || ''; bv = b[eventsSort.col] || '';
        if (typeof av === 'string') { av = av.toLowerCase(); bv = bv.toLowerCase(); }
      }
      if (av < bv) return eventsSort.dir === 'asc' ? -1 : 1;
      if (av > bv) return eventsSort.dir === 'asc' ? 1 : -1;
      
      // Empate: mais novos primeiro
      return _parseIncidentAgeSeconds(a.age) - _parseIncidentAgeSeconds(b.age);
    });

    var allNs = await (await fetchAuth('/api/namespaces')).json();
    allNs = allNs || [];
    var nsOpts = '<option value="">All Namespaces</option>' + allNs.sort().map(function(n){ return '<option value="'+esc(n)+'"'+(nsFilter===n?' selected':'')+'>' + esc(n) + '</option>'; }).join('');

    var rangeOpts = _INCIDENT_RANGES.map(function(r){
      return '<option value="'+r.label+'"'+(rangeLabel===r.label?' selected':'')+'>'+r.label+'</option>';
    }).join('');

    var tableHTML = '';
    if (!filtered.length) {
      tableHTML = '<div style="text-align:center;color:var(--text-dim);padding:40px">No incidents matching filters</div>';
    } else {
      tableHTML = '<table class="wtable" style="table-layout:fixed"><thead><tr id="devthead">' +
        makeSortHeader('Severity', 'severity', eventsSort) +
        makeSortHeader('Type', 'type', eventsSort) +
        makeSortHeader('Pod', 'podName', eventsSort) +
        makeSortHeader('NS', 'namespace', eventsSort) +
        makeSortHeader('Age', 'age', eventsSort) +
        '<th>Message</th>' +
        '</tr></thead><tbody>';

      filtered.forEach(function(inc, i) {
        var sevClass = inc.severity === 'CRITICAL' ? 'b-crit' : 'b-warn';
        tableHTML += '<tr class="waste-row-clickable" data-inc-idx="' + i + '">' +
          '<td><span class="badge ' + sevClass + '" style="font-size:.7em">' + esc(inc.severity||'--') + '</span></td>' +
          '<td style="font-size:.78em;color:var(--text-dim)">' + esc(inc.type||'--') + '</td>' +
          '<td style="font-size:.78em;max-width:140px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="' + esc(inc.podName||'') + '">' + esc(inc.podName||'--') + '</td>' +
          '<td style="font-size:.72em"><span class="ns-tag">' + esc(inc.namespace||'--') + '</span></td>' +
          '<td style="font-size:.72em;color:var(--text-dim)">' + esc(inc.age||'--') + '</td>' +
          '<td style="font-size:.72em;color:var(--text-dim);max-width:250px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="' + esc(inc.message||'').replace(/"/g, '&quot;') + '">' + esc(inc.message||'--') + '</td>' +
          '</tr>';
      });
      tableHTML += '</tbody></table>';
    }

    var existingTable = document.getElementById('devt-table');
    if (!existingTable) {
      var controlsHTML = '<div style="padding:0 0 12px;display:flex;gap:10px;flex-wrap:wrap;align-items:center">' +
        '<input class="dtool-input" id="devt-search" placeholder="search type, pod, message..." value="' + esc(searchVal) + '" style="flex:1;min-width:200px">' +
        '<select id="devt-ns" class="dtool-select">' + nsOpts + '</select>' +
        '<select id="devt-range" class="dtool-select" title="Age filter">' + rangeOpts + '</select>' +
        '</div>';
      drawerHTML(controlsHTML + '<div id="devt-table">' + tableHTML + '</div>');

      var searchInput = document.getElementById('devt-search');
      var nsSelect = document.getElementById('devt-ns');
      var rangeSelect = document.getElementById('devt-range');
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
      if (rangeSelect) {
        rangeSelect.addEventListener('change', function() {
          _evtDrawerState.range = rangeSelect.value;
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
      var nsSelect = document.getElementById('devt-ns');
      var rangeSelect = document.getElementById('devt-range');
      if (nsSelect) nsSelect.value = nsFilter;
      if (rangeSelect) rangeSelect.value = rangeLabel;
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

    document.querySelectorAll('#devt-table .waste-row-clickable').forEach(function(row) {
      row.addEventListener('click', function() {
        var inc = filtered[this.dataset.incIdx];
        if (inc && typeof openIncidentDetailDrawer === 'function') openIncidentDetailDrawer(inc);
      });
    });
  } catch(e) { drawerHTML('<div style="color:var(--red);padding:20px">Error: ' + esc(e.message) + '</div>'); }
}

// ─── Incident Detail Drawer ───────────────────────────────────────────────────
function openIncidentDetailDrawer(inc) {
  var title = 'Incident Detail — ' + esc(inc.podName||'--');
  openDrawer(title, function() {
    var sevClass = inc.severity === 'CRITICAL' ? 'b-crit' : 'b-warn';
    var backBtnHtml = '<button id="incident-detail-back" style="background:rgba(0,204,143,.1);border:1px solid rgba(0,204,143,.3);color:var(--green);border-radius:4px;padding:3px 10px;cursor:pointer;margin-bottom:14px;font-size:.72em;align-self:flex-start">&larr; Back to incidents</button>';

    var html = '<div style="background:var(--surface2);border:1px solid var(--border);border-radius:6px;padding:16px;line-height:1.6;font-size:0.9em;color:var(--text-bright)">' +
      '<div style="display:flex;gap:10px;margin-bottom:16px;align-items:center">' +
        '<span class="badge ' + sevClass + '">' + esc(inc.severity||'--') + '</span>' +
        '<span style="font-size:.88em;color:var(--text-dim)">' + esc(inc.type||'--') + '</span>' +
        '<span class="ns-tag">' + esc(inc.namespace||'--') + '</span>' +
      '</div>' +
      '<div style="margin-bottom:12px"><b style="color:var(--text-dim)">Pod:</b> ' + esc(inc.podName||'--') + '</div>' +
      '<div style="margin-bottom:12px"><b style="color:var(--text-dim)">Age:</b> ' + esc(inc.age||'--') + '</div>' +
      '<div style="margin-bottom:12px"><b style="color:var(--text-dim)">Message:</b> ' + esc(inc.message||'--') + '</div>' +
      (inc.narrative ? '<div style="margin-bottom:12px;padding:10px 12px;background:rgba(0,0,0,.2);border:1px solid rgba(255,255,255,.05);border-radius:4px;font-size:.84em;color:var(--text-dim)">' + esc(inc.narrative) + '</div>' : '') +
      (inc.runbook ? '<div style="margin-bottom:0"><b style="color:var(--text-dim)">Runbook:</b><br><code style="font-size:.82em;color:var(--cyan);background:rgba(0,0,0,.3);padding:4px 8px;border-radius:4px;display:inline-block;margin-top:4px">' + esc(inc.runbook) + '</code></div>' : '') +
      '</div>';

    drawerHTML(backBtnHtml + html);

    var backBtn = document.getElementById('incident-detail-back');
    if (backBtn) {
      backBtn.addEventListener('click', function() {
        if (typeof openEventsDrawer === 'function') openEventsDrawer();
      });
    }
  });
}


// ─── Pod Detail Drawer ────────────────────────────────────────────────────────
function openPodDetailDrawer(p) {
  var title = 'Pod Detail — Waste Analysis';
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

    '<div style="font-size:.80em;color:var(--text-dim);margin-bottom:14px">Real-time snapshot &bull; data collected every ~5s</div>' +

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

  openDrawer(title, function() {
    var backBtnHtml = '';
    if (typeof _evtDrawerState !== 'undefined' && _evtDrawerState.focusNode) {
      backBtnHtml = '<button id="pod-detail-back" style="background:rgba(0,204,143,.1);border:1px solid rgba(0,204,143,.3);color:var(--green);border-radius:4px;padding:3px 10px;cursor:pointer;margin-bottom:14px;font-size:.72em;align-self:flex-start">&larr; Back to node</button>';
    }
    drawerHTML(backBtnHtml + html);
    if (document.getElementById('pod-detail-back')) {
      document.getElementById('pod-detail-back').addEventListener('click', function() {
        if (typeof openNodeDrawer === 'function') openNodeDrawer(_evtDrawerState.focusNode);
      });
    }
  });
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
  document.getElementById('fcProjBudget').textContent = '$' + fmtMoney(projBudget);
  document.getElementById('fcProjUsage').textContent  = '$' + fmtMoney(projUsage);
  document.getElementById('fcProjWaste').textContent  = '$' + fmtMoney(projWaste) + ' (' + projPct.toFixed(0) + '%)';
  document.getElementById('fcPeriod').textContent = fData[0].time + ' → ' + fData[fData.length - 1].time;
}

// ─── Per-tile namespace update functions ──────────────────────────────────────
async function updatePodsTile() {
  try {
    var ns = activeNs;
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
    var ns = activeNs;
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
    var ns = activeNs;
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


