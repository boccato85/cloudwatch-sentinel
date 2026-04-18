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
      ? ' | <span style="color:var(--purple)">Forecast Budget: $' + fmtMoney(forecastTotal) +
        '</span> | <span style="color:#00b4ff">Forecast Usage: $' + fmtMoney(forecastUse) + '</span>'
      : '';
    summaryEl.innerHTML =
      '<span style="color:var(--red)">Budget: $' + fmtMoney(totalBudget) + '</span> | ' +
      '<span style="color:var(--green)">Actual: $' + fmtMoney(totalActual) + '</span> | ' +
      '<span style="color:var(--orange)">Waste: $' + fmtMoney(totalSaved) + ' (' + savingsPct.toFixed(0) + '%)</span>' +
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
