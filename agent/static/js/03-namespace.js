
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
