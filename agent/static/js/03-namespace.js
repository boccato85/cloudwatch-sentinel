
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
  var selIds = ['nsFilter', 'tile-ns-finops', 'tile-ns-eff', 'tile-ns-workloads', 'tile-ns-events'];
  
  var showSysGlobal = document.getElementById('global-show-system') ? document.getElementById('global-show-system').checked : false;
  
  selIds.forEach(function(id) {
    var sel = document.getElementById(id);
    if (!sel) return;
    var curVal = sel.value;
    sel.innerHTML = '<option value="">All NS</option>';
    allNamespaces.forEach(function(n) {
      if (sysNsList.indexOf(n) !== -1 && !showSysGlobal) return;
      var opt = document.createElement('option');
      opt.value = n;
      opt.textContent = n;
      sel.appendChild(opt);
    });
    if (curVal && sel.querySelector('option[value="' + curVal + '"]')) {
      sel.value = curVal;
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
