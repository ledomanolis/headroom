(function () {
  'use strict';

  const M = window.HeadroomModel;

  const FIELDS = [
    { group: 'Scheme today' },
    { key: 'assets', label: 'Assets', unit: '£m', step: 5, min: 1 },
    { key: 'liabilities', label: 'Liabilities', unit: '£m', step: 5, min: 1,
      help: 'Valued on the low dependency basis (gilts plus the margin below).' },
    { key: 'outgoPct', label: 'Benefits paid each year', unit: '% of liabilities', pct: true, step: 0.5, min: 0, max: 20 },
    { key: 'duration', label: 'Liability duration', unit: 'years', step: 1, min: 2, max: 30 },

    { group: 'Investment' },
    { key: 'growthPct', label: 'Growth assets', unit: '% of assets', pct: true, step: 5, min: 0, max: 100 },
    { key: 'hedgeRatio', label: 'Interest rate hedge', unit: '% of liabilities', pct: true, step: 5, min: 0, max: 120 },
    { key: 'growthPremium', label: 'Growth return above gilts', unit: '% a year', pct: true, step: 0.25, min: -5, max: 10 },
    { key: 'growthVol', label: 'Growth asset volatility', unit: '% a year', pct: true, step: 1, min: 0, max: 40 },

    { group: 'Markets and pricing' },
    { key: 'giltYield', label: 'Gilt yield', unit: '%', pct: true, step: 0.1, min: 0, max: 10 },
    { key: 'ldMargin', label: 'Low dependency margin over gilts', unit: '%', pct: true, step: 0.1, min: 0, max: 2 },
    { key: 'yieldVol', label: 'Gilt yield volatility', unit: '% a year', pct: true, step: 0.1, min: 0, max: 3 },
    { key: 'longevityVol', label: 'Longevity uncertainty', unit: '% a year', pct: true, step: 0.1, min: 0, max: 3 },
    { key: 'buyoutPremium', label: 'Insurer price above liabilities', unit: '%', pct: true, step: 1, min: 0, max: 30 },

    { group: 'The options' },
    { key: 'buyoutGrowthPct', label: 'Buyout: growth assets while waiting', unit: '% of assets', pct: true, step: 5, min: 0, max: 100 },
    { key: 'releaseThreshold', label: 'Release: anything above', unit: '% funded', pct: true, step: 1, min: 100, max: 200 },
    { key: 'memberShare', label: 'Share of surplus to members', unit: '%', pct: true, step: 5, min: 0, max: 100 },
    { key: 'employerTax', label: 'Tax on payments to employer', unit: '%', pct: true, step: 1, min: 0, max: 50 },
    { key: 'recoveryYears', label: 'Deficit recovery period', unit: 'years', step: 1, min: 1, max: 20, int: true,
      help: 'If funding falls below 100%, the employer pays the shortfall over this many years.' },

    { group: 'Simulation' },
    { key: 'horizon', label: 'Projection', unit: 'years', step: 1, min: 5, max: 40, int: true },
    { key: 'numSims', label: 'Scenarios', unit: '', step: 500, min: 200, max: 10000, int: true },
    { key: 'seed', label: 'Random seed', unit: '', step: 1, min: 1, int: true,
      help: 'The same seed and inputs always give the same results.' }
  ];

  const INFO = {
    buyout: {
      name: 'Buyout', color: '#3b5b92',
      blurb: (p) => `Cut growth assets to ${fmtPct(p.buyoutGrowthPct)} and insure the scheme as soon as the insurer's price is affordable.`
    },
    runon: {
      name: 'Run-on', color: '#b7791f',
      blurb: () => 'Keep running the scheme with today\'s investment strategy. Surplus builds up but stays inside.'
    },
    release: {
      name: 'Surplus release', color: '#2f855a',
      blurb: (p) => `Run on and release anything above ${fmtPct(p.releaseThreshold)} funded each year, shared between employer and members.`
    }
  };

  const ROWS = [
    { key: 'medianFundingEnd', label: (p) => `Median funding in year ${p.horizon}`, fmt: fmtPct, better: 'up' },
    { key: 'probContrib', label: () => 'Chance employer has to pay in more', fmt: fmtPct, better: 'down' },
    { key: 'expContrib', label: () => 'Expected employer contributions', fmt: fmtMoney, better: 'down' },
    { key: 'probBelow100', label: () => 'Chance funding dips below 100%', fmt: fmtPct, better: 'down' },
    { key: 'expEmployer', label: () => 'Expected surplus to employer (after tax)', fmt: fmtMoney, better: 'up' },
    { key: 'expMember', label: () => 'Expected surplus to members', fmt: fmtMoney, better: 'up' },
    { key: 'expRemaining', label: (p) => `Surplus still in scheme, year ${p.horizon}`, fmt: fmtMoney },
    { key: 'probBuyout', only: 'buyout', label: (p) => `Chance of buyout by year ${p.horizon}`, fmt: fmtPct, better: 'up' },
    { key: 'medianBuyoutYear', only: 'buyout', label: () => 'Typical year of buyout, if it happens', fmt: fmtYear }
  ];

  const MONEY_SERIES = [
    { key: 'expEmployer', label: 'To employer (after tax)', color: '#1f3a5f' },
    { key: 'expMember', label: 'To members', color: '#2a9d8f' },
    { key: 'expRemaining', label: 'Still in scheme at end', color: '#b8c0cc' },
    { key: 'expContrib', label: 'Employer contributions paid in', color: '#c2410c' }
  ];

  const form = document.getElementById('form');
  const stressBox = document.getElementById('stresses');
  const activeStresses = new Set();
  const charts = {};
  let lastRun = null;

  function fmtPct(v) { return `${Math.round(v * 100)}%`; }
  function fmtMoney(v) { return `£${v >= 100 ? v.toFixed(0) : v.toFixed(1)}m`; }
  function fmtYear(v) { return v === null ? '—' : v === 0 ? 'Now' : `Year ${v}`; }

  function hexToRgba(hex, alpha) {
    const n = parseInt(hex.slice(1), 16);
    return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
  }

  function toDisplay(field, value) {
    return field.pct ? +(value * 100).toFixed(4) : value;
  }

  function buildForm() {
    let fieldset = null;
    FIELDS.forEach((f) => {
      if (f.group) {
        fieldset = document.createElement('fieldset');
        fieldset.innerHTML = `<legend>${f.group}</legend>`;
        form.appendChild(fieldset);
        return;
      }
      const wrap = document.createElement('label');
      wrap.className = 'field';
      wrap.innerHTML = `
        <span class="field-label">${f.label}</span>
        <span class="field-input">
          <input type="number" name="${f.key}" step="${f.step}" ${f.min !== undefined ? `min="${f.min}"` : ''} ${f.max !== undefined ? `max="${f.max}"` : ''}>
          ${f.unit ? `<span class="unit">${f.unit}</span>` : ''}
        </span>
        ${f.help ? `<span class="help">${f.help}</span>` : ''}`;
      fieldset.appendChild(wrap);
    });
    setValues(M.DEFAULTS);
  }

  function setValues(values) {
    FIELDS.forEach((f) => {
      if (f.key) form.elements[f.key].value = toDisplay(f, values[f.key]);
    });
  }

  function readParams() {
    const p = {};
    FIELDS.forEach((f) => {
      if (!f.key) return;
      let v = parseFloat(form.elements[f.key].value);
      if (!Number.isFinite(v)) v = toDisplay(f, M.DEFAULTS[f.key]);
      if (f.min !== undefined) v = Math.max(v, f.min);
      if (f.max !== undefined) v = Math.min(v, f.max);
      if (f.int) v = Math.round(v);
      p[f.key] = f.pct ? v / 100 : v;
    });
    return p;
  }

  function buildStresses() {
    M.STRESSES.forEach((s) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'chip';
      btn.textContent = s.label;
      btn.dataset.key = s.key;
      btn.setAttribute('aria-pressed', 'false');
      btn.addEventListener('click', () => {
        if (activeStresses.has(s.key)) {
          activeStresses.delete(s.key);
        } else {
          activeStresses.add(s.key);
          if (s.excludes) activeStresses.delete(s.excludes);
        }
        stressBox.querySelectorAll('.chip').forEach((c) => {
          c.setAttribute('aria-pressed', String(activeStresses.has(c.dataset.key)));
        });
        update();
      });
      stressBox.appendChild(btn);
    });
  }

  function renderSnapshot(p, start) {
    const funding = start.A / start.L;
    const stressed = activeStresses.size > 0;
    document.getElementById('snapshot').innerHTML = `
      <div><span class="k">Assets</span><span class="v">${fmtMoney(start.A)}</span></div>
      <div><span class="k">Liabilities</span><span class="v">${fmtMoney(start.L)}</span></div>
      <div><span class="k">Funding level</span><span class="v">${Math.round(funding * 100)}%</span></div>
      <div><span class="k">Insurer price</span><span class="v">${fmtMoney(start.L * (1 + p.buyoutPremium))}</span></div>
      <p class="snap-note">${stressed ? 'After the stress, on the low dependency basis.' : 'Today, on the low dependency basis.'}</p>`;
  }

  function deltaHtml(row, cur, base) {
    if (base === undefined || base === null || cur === null) return '';
    if (row.fmt(cur) === row.fmt(base)) return '<span class="delta">unchanged</span>';
    const diff = cur - base;
    let cls = '';
    if (row.better) cls = (diff > 0) === (row.better === 'up') ? 'better' : 'worse';
    return `<span class="delta ${cls}">was ${row.fmt(base)}</span>`;
  }

  function renderCards(p, results, baseResults) {
    const box = document.getElementById('cards');
    box.innerHTML = results.map((r, i) => {
      const info = INFO[r.strategy];
      const base = baseResults ? baseResults[i] : null;
      const rows = ROWS.filter((row) => !row.only || row.only === r.strategy).map((row) => `
        <div class="row">
          <dt>${row.label(p)}</dt>
          <dd><span class="val">${row.fmt(r[row.key])}</span>${base ? deltaHtml(row, r[row.key], base[row.key]) : ''}</dd>
        </div>`).join('');
      return `
        <article class="card" style="--c:${info.color}">
          <header><span class="swatch"></span><h3>${info.name}</h3></header>
          <p class="blurb">${info.blurb(p)}</p>
          <dl>${rows}</dl>
        </article>`;
    }).join('');
  }

  function fanDatasets(r, color, refLines) {
    const pc = r.percentiles;
    const band = (label, data, fill, alpha) => ({
      label, data, fill, borderWidth: 0, pointRadius: 0,
      backgroundColor: hexToRgba(color, alpha), tension: 0.25
    });
    const sets = [
      band('95th percentile', pc.p95, false, 0.14),
      band('5th percentile', pc.p5, '-1', 0.14),
      band('75th percentile', pc.p75, false, 0.28),
      band('25th percentile', pc.p25, '-1', 0.28),
      { label: 'Median', data: pc.p50, borderColor: color, borderWidth: 2.5, pointRadius: 0, fill: false, tension: 0.25 }
    ];
    refLines.forEach((ref) => {
      sets.push({
        label: ref.label, data: pc.p50.map(() => ref.value), borderColor: ref.color,
        borderDash: [5, 4], borderWidth: 1.25, pointRadius: 0, fill: false
      });
    });
    return sets;
  }

  function renderFanCharts(p, results) {
    let lo = Infinity, hi = -Infinity;
    results.forEach((r) => {
      lo = Math.min(lo, ...r.percentiles.p5);
      hi = Math.max(hi, ...r.percentiles.p95);
    });
    const yMin = Math.max(0, Math.floor(Math.min(lo, 95) / 10) * 10);
    const yMax = Math.ceil(Math.max(hi, p.releaseThreshold * 100 + 5) / 10) * 10;
    const labels = results[0].percentiles.p50.map((_, t) => t);

    results.forEach((r) => {
      const info = INFO[r.strategy];
      const refs = [{ label: '100% funded', value: 100, color: '#8a93a3' }];
      if (r.strategy === 'buyout') refs.push({ label: 'Insurer price', value: (1 + p.buyoutPremium) * 100, color: info.color });
      if (r.strategy === 'release') refs.push({ label: 'Release above', value: p.releaseThreshold * 100, color: info.color });
      const datasets = fanDatasets(r, info.color, refs);

      const chart = charts[r.strategy];
      if (chart) {
        chart.data.labels = labels;
        chart.data.datasets = datasets;
        chart.options.scales.y.min = yMin;
        chart.options.scales.y.max = yMax;
        chart.update();
        return;
      }
      charts[r.strategy] = new Chart(document.getElementById(`chart-${r.strategy}`), {
        type: 'line',
        data: { labels, datasets },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          animation: false,
          interaction: { mode: 'index', intersect: false },
          plugins: {
            legend: { display: false },
            tooltip: {
              callbacks: {
                title: (items) => `Year ${items[0].label}`,
                label: (c) => `${c.dataset.label}: ${Math.round(c.parsed.y)}%`
              }
            }
          },
          scales: {
            y: { min: yMin, max: yMax, ticks: { callback: (v) => `${v}%` }, grid: { color: '#eef0f3' } },
            x: { title: { display: true, text: 'Year' }, ticks: { maxTicksLimit: 6 }, grid: { display: false } }
          }
        }
      });
    });
  }

  function renderMoneyChart(results) {
    const labels = results.map((r) => INFO[r.strategy].name);
    const datasets = MONEY_SERIES.map((s) => ({
      label: s.label,
      data: results.map((r) => +r[s.key].toFixed(1)),
      backgroundColor: s.color,
      borderRadius: 4,
      maxBarThickness: 36
    }));
    if (charts.money) {
      charts.money.data.labels = labels;
      charts.money.data.datasets = datasets;
      charts.money.update();
      return;
    }
    charts.money = new Chart(document.getElementById('chart-money'), {
      type: 'bar',
      data: { labels, datasets },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: false,
        plugins: {
          legend: { position: 'bottom', labels: { boxWidth: 12, boxHeight: 12, usePointStyle: true, pointStyle: 'rectRounded' } },
          tooltip: { callbacks: { label: (c) => `${c.dataset.label}: £${c.parsed.y.toFixed(1)}m` } }
        },
        scales: {
          y: { ticks: { callback: (v) => `£${v}m` }, grid: { color: '#eef0f3' }, beginAtZero: true },
          x: { grid: { display: false } }
        }
      }
    });
  }

  function renderAudit(record) {
    const stressText = record.stresses.length
      ? record.stresses.map((k) => M.STRESSES.find((s) => s.key === k).label).join(', ')
      : 'None';
    const inputs = FIELDS.filter((f) => f.key).map((f) => `
      <div><dt>${f.label}</dt><dd>${toDisplay(f, record.inputs[f.key])}${f.unit ? ` ${f.unit}` : ''}</dd></div>`).join('');
    document.getElementById('audit-body').innerHTML = `
      <div class="audit-meta">
        <div><span class="k">Run at</span><span>${new Date(record.runAt).toLocaleString('en-GB')}</span></div>
        <div><span class="k">Model version</span><span>${record.modelVersion}</span></div>
        <div><span class="k">Stresses applied</span><span>${stressText}</span></div>
      </div>
      <dl class="audit-inputs">${inputs}</dl>`;
  }

  function update() {
    const p = readParams();
    const stresses = [...activeStresses];
    const run = M.run(p, stresses);
    const base = stresses.length ? M.run(p, []) : null;

    renderSnapshot(p, run.start);
    renderCards(p, run.results, base ? base.results : null);
    renderFanCharts(p, run.results);
    renderMoneyChart(run.results);

    lastRun = {
      tool: 'Headroom prototype',
      modelVersion: M.MODEL_VERSION,
      runAt: new Date().toISOString(),
      inputs: p,
      stresses,
      startingPosition: run.start,
      results: run.results,
      baseResults: base ? base.results : null
    };
    renderAudit(lastRun);
  }

  function download() {
    if (!lastRun) return;
    const blob = new Blob([JSON.stringify(lastRun, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `headroom-run-${lastRun.runAt.slice(0, 19).replace(/[:T]/g, '-')}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  let timer = null;
  form.addEventListener('input', () => {
    clearTimeout(timer);
    timer = setTimeout(update, 200);
  });
  form.addEventListener('submit', (e) => e.preventDefault());
  document.getElementById('reset').addEventListener('click', () => {
    setValues(M.DEFAULTS);
    update();
  });
  document.getElementById('download').addEventListener('click', download);
  document.getElementById('print').addEventListener('click', () => window.print());

  Chart.defaults.font.family = "'Inter', system-ui, sans-serif";
  Chart.defaults.color = '#5b6478';

  buildForm();
  buildStresses();
  update();
})();
