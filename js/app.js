(function () {
  'use strict';

  const M = window.HeadroomModel;
  const AS = window.HeadroomAssumptions;
  const MARKET = window.HEADROOM_MARKET || null;

  // Inputs with a sourced value: Bank of England curves read at the liability duration, and
  // ONS life expectancy volatility scaled by the scheme's sensitivity to an extra year of life.
  const fmtDate = (d) => new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
  const MARKET_FIELDS = {
    giltYield: {
      note: 'market-yield', button: 'Use market yield',
      value: (p) => atTerm(MARKET && MARKET.giltCurve, p.duration),
      text: (p, v) => `Market: ${(v * 100).toFixed(2)}% at ${p.duration} years (Bank of England, ${fmtDate(MARKET.asAt)}).`
    },
    yieldVol: {
      note: 'market-yvol', button: 'Use historical',
      value: (p) => atTerm(volCurve('yieldVol'), p.duration),
      text: (p, v) => `Historical: ${(v * 100).toFixed(2)}% at ${p.duration} years (Bank of England, 12-month changes, ` +
        `${fmtDate(MARKET.volatility.from)} to ${fmtDate(MARKET.asAt)}).`
    },
    inflationVol: {
      note: 'market-ivol', button: 'Use historical',
      value: (p) => atTerm(volCurve('inflationVol'), p.duration),
      text: (p, v) => `Historical: ${(v * 100).toFixed(2)}% at ${p.duration} years (Bank of England, 12-month changes, ` +
        `${fmtDate(MARKET.volatility.from)} to ${fmtDate(MARKET.asAt)}).`
    },
    longevityVol: {
      note: 'market-lvol', button: 'Use historical',
      missing: 'Enter the liability increase per extra year of life expectancy to use the ONS-based figure.',
      value: (p) => (MARKET && MARKET.longevity && p.longevitySensitivity !== null
        ? +(MARKET.longevity.volYears * p.longevitySensitivity).toFixed(4) : null),
      text: (p, v) => `Historical: ${(v * 100).toFixed(2)}% a year = ONS life expectancy at 65 varying by ` +
        `${MARKET.longevity.volYears.toFixed(2)} years a year (${MARKET.longevity.fromPeriod} to ${MARKET.longevity.toPeriod}) ` +
        `× ${(p.longevitySensitivity * 100).toFixed(1)}% per year.`
    }
  };

  function volCurve(key) {
    return MARKET && MARKET.volatility ? MARKET.volatility.curve.map((c) => ({ term: c.term, yield: c[key] })) : null;
  }

  function atTerm(curve, term) {
    return curve ? +M.yieldAtTerm(curve, term).toFixed(4) : null;
  }

  // Starting values: model defaults, replaced by sourced data where it is available.
  const START = Object.assign({}, M.DEFAULTS);
  Object.entries(MARKET_FIELDS).forEach(([key, m]) => {
    const v = m.value(M.DEFAULTS);
    if (v !== null) START[key] = v;
  });

  const FIELDS = [
    { group: 'Scheme today' },
    { key: 'assets', label: 'Assets', unit: '£m', step: 5, min: 1 },
    { key: 'liabilities', label: 'Liabilities', unit: '£m', step: 5, min: 1,
      help: 'Valued on the main funding basis (set under Funding basis below).' },
    { key: 'outgoPct', label: 'Benefits paid each year', unit: '% of liabilities', pct: true, step: 0.5, min: 0, max: 20 },
    { key: 'duration', label: 'Liability duration', unit: 'years', step: 1, min: 2, max: 30 },
    { key: 'inflationLinkedPct', label: 'Inflation-linked benefits', unit: '% of liabilities', pct: true, step: 5, min: 0, max: 100,
      help: 'Share of liabilities that rises with inflation (for example RPI or CPI pension increases).' },
    { key: 'longevitySensitivity', label: 'Liability increase per extra year of life expectancy', unit: '% of liabilities',
      pct: true, step: 0.5, min: 0, max: 15, optional: true,
      help: 'Used for longevity uncertainty and the longevity stress. Leave blank to leave longevity out.' },

    { group: 'Funding basis' },
    { key: 'basis1Name', label: 'Basis name', auditLabel: 'Main basis name', type: 'text' },
    { key: 'discountMargin', label: 'Discount rate: margin over gilts', auditLabel: 'Main basis: margin over gilts',
      unit: '%', pct: true, step: 0.1, min: -2, max: 5 },
    { key: 'basis2On', label: 'Add a second funding basis', type: 'checkbox' },
    { key: 'basis2Name', label: 'Second basis name', type: 'text', when: 'basis2On' },
    { key: 'basis2Margin', label: 'Discount rate: margin over gilts', auditLabel: 'Second basis: margin over gilts',
      unit: '%', pct: true, step: 0.1, min: -2, max: 5, optional: true, when: 'basis2On', custom: 'basis2-note' },
    { key: 'releaseBasis', label: 'Test surplus release on', type: 'select', when: 'basis2On' },

    { group: 'Growth assets', custom: 'growth' },

    { group: 'Hedging' },
    { key: 'hedgeRatio', label: 'Interest rate hedge', unit: '% of liabilities', pct: true, step: 5, min: 0, max: 120,
      help: 'Share of the liabilities\' interest rate sensitivity that the assets hedge.' },
    { key: 'inflationHedgeRatio', label: 'Inflation hedge', unit: '% of liabilities', pct: true, step: 5, min: 0, max: 120,
      help: 'Share of the liabilities\' inflation sensitivity that the assets hedge.' },

    { group: 'Markets and pricing' },
    { key: 'giltYield', label: 'Gilt yield', unit: '%', pct: true, step: 0.01, min: 0, max: 10, custom: 'market-yield' },
    { key: 'yieldVol', label: 'Gilt yield volatility', unit: '% a year', pct: true, step: 0.01, min: 0, max: 3, custom: 'market-yvol' },
    { key: 'inflationVol', label: 'Implied inflation volatility', unit: '% a year', pct: true, step: 0.01, min: 0, max: 3, custom: 'market-ivol' },
    { key: 'longevityVol', label: 'Longevity uncertainty', unit: '% of liabilities a year', pct: true, step: 0.01, min: 0, max: 3,
      optional: true, custom: 'market-lvol' },
    { key: 'buyoutPremium', label: 'Insurer price above liabilities', unit: '%', pct: true, step: 1, min: 0, max: 30 },

    { group: 'The options' },
    { key: 'buyoutGrowthPct', label: 'Buyout: growth assets while waiting', unit: '% of assets', pct: true, step: 5, min: 0, max: 100 },
    { key: 'releaseThreshold', label: 'Release: anything above', unit: '% funded', pct: true, step: 1, min: 100, max: 200 },
    { key: 'memberShare', label: 'Share of surplus to members', unit: '%', pct: true, step: 5, min: 0, max: 100,
      help: 'Members\' payments are shown before tax.' },
    { key: 'employerTax', label: 'Tax on payments to employer', unit: '%', pct: true, step: 1, min: 0, max: 50 },

    { group: 'Recovery plan' },
    { key: 'rpOn', label: 'Employer pays deficit contributions', type: 'checkbox',
      help: 'Untick to leave any deficit to be closed by investment returns alone.' },
    { key: 'valuationYears', label: 'Valuations every', unit: 'years', step: 1, min: 1, max: 10, int: true, when: 'rpOn',
      help: 'A deficit at a valuation leads to a recovery plan, fixed until the next valuation.' },
    { key: 'rpBasis', label: 'Funding basis for the recovery plan', type: 'select', when: ['rpOn', 'basis2On'] },
    { key: 'recoveryYears', label: 'Recovery period', unit: 'years', step: 1, min: 1, max: 20, int: true, when: 'rpOn' },
    { key: 'rpOutperformance', label: 'Investment outperformance allowed for', unit: '% a year', pct: true, step: 0.1, min: 0, max: 5,
      optional: true, when: 'rpOn', help: 'Assumed return on the assets above the discount rate. Leave blank for no allowance.' },
    { key: 'rpTrigger', label: 'Only set a plan if funding is below', unit: '%', pct: true, step: 1, min: 50, max: 100,
      optional: true, when: 'rpOn', help: 'Leave blank to set a plan for any deficit.' },

    { group: 'Simulation' },
    { key: 'horizon', label: 'Projection', unit: 'years', step: 1, min: 5, max: 40, int: true },
    { key: 'numSims', label: 'Scenarios', unit: '', step: 500, min: 200, max: 10000, int: true },
    { key: 'seed', label: 'Random seed', unit: '', step: 1, min: 1, int: true,
      help: 'The same seed and inputs always give the same results.' }
  ];

  const INFO = {
    buyout: {
      name: 'Buyout', color: '#3d5a99',
      blurb: (p) => `Cut growth assets to ${fmtPct(p.buyoutGrowthPct)} and insure the scheme as soon as the insurer's price is affordable.`
    },
    runon: {
      name: 'Run-on', color: '#b7791f',
      blurb: () => 'Keep running the scheme with today\'s investment strategy. Surplus builds up but stays inside.'
    },
    release: {
      name: 'Surplus release', color: '#13805f',
      blurb: (p) => `Run on and release anything above ${fmtPct(p.releaseThreshold)} funded${p.basis2On
        ? ` on ${escapeHtml(theBasis(p, p.releaseBasis))}` : ''} each year, shared between employer and members.`
    }
  };

  // Adds the basis name to a label, but only when there is more than one basis to tell apart.
  const onBasis = (p, text, basis) => (p.basis2On ? `${text} (${escapeHtml(basisName(p, basis))})` : text);

  // Every metric is read at the year chosen with the year switch (viewYear).
  const ROWS = [
    { key: 'medianFunding', label: (p) => onBasis(p, `Median funding in year ${viewYear}`, 1), fmt: fmtPct, better: 'up' },
    { key: 'medianFunding2', show: (p) => p.basis2On, label: (p) => onBasis(p, `Median funding in year ${viewYear}`, 2), fmt: fmtPct, better: 'up' },
    { key: 'probBelow', label: (p) => onBasis(p, `Chance funding is below 100% in year ${viewYear}`, 1), fmt: fmtPct, better: 'down' },
    { key: 'probBelow2', show: (p) => p.basis2On, label: (p) => onBasis(p, `Chance funding is below 100% in year ${viewYear}`, 2), fmt: fmtPct, better: 'down' },
    { key: 'probContrib', label: () => `Chance employer pays in by year ${viewYear}`, fmt: fmtPct, better: 'down' },
    { key: 'expContrib', label: () => `Expected employer contributions by year ${viewYear}`, fmt: fmtMoney, better: 'down' },
    { key: 'expEmployer', label: () => `Expected surplus to employer by year ${viewYear} (after tax)`, fmt: fmtMoney, better: 'up' },
    { key: 'expMember', label: () => `Expected surplus to members by year ${viewYear} (before tax)`, fmt: fmtMoney, better: 'up' },
    { key: 'expRemaining', label: () => `Surplus still in scheme in year ${viewYear}`, fmt: fmtMoney },
    { key: 'probBuyout', only: 'buyout', label: () => `Chance of buyout by year ${viewYear}`, fmt: fmtPct, better: 'up' },
    { key: 'medianBuyoutYear', only: 'buyout', label: () => `Typical year of buyout, if by year ${viewYear}`, fmt: fmtYear }
  ];

  const MONEY_SERIES = [
    { key: 'expEmployer', label: 'To employer (after tax)', color: '#0b3b2d' },
    { key: 'expMember', label: 'To members (before tax)', color: '#3cc39a' },
    { key: 'expRemaining', label: 'Still in scheme', color: '#bccac4' },
    { key: 'expContrib', label: 'Employer contributions paid in', color: '#c2410c' }
  ];

  const form = document.getElementById('form');
  const stressBox = document.getElementById('stresses');
  const activeStresses = new Set();
  const charts = {};
  let lastRun = null;

  let uploadedSets = AS.loadUploaded();
  let currentSet = AS.BUILT_IN;
  let allocation = Object.assign({}, AS.DEFAULT_ALLOCATION);
  let setMessage = null; // { kind: 'error' | 'info', lines: [] }
  let chartBasis = 1;
  const VIEW_YEARS = [5, 10, 20];
  let viewYear = VIEW_YEARS[VIEW_YEARS.length - 1];

  function basisName(p, basis) {
    return (basis === 2 ? p.basis2Name : p.basis1Name) || (basis === 2 ? 'Second funding basis' : 'Main funding basis');
  }

  // "the Technical provisions basis", avoiding "basis basis" when the name already says it.
  function theBasis(p, basis) {
    const name = basisName(p, basis);
    return `the ${name}${/\bbasis$/i.test(name) ? '' : ' basis'}`;
  }

  // Second basis liabilities as a multiple of main basis liabilities today.
  function basis2Factor(p) {
    return Math.exp(-p.duration * (p.basis2Margin - p.discountMargin));
  }

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

  // How a field's value reads in the run record.
  function auditValue(field, p) {
    const v = p[field.key];
    if (v === null) return 'Not set';
    if (field.type === 'checkbox') return v ? 'Yes' : 'No';
    if (field.type === 'select') return escapeHtml(basisName(p, v));
    if (field.type === 'text') return escapeHtml(v);
    const unit = field.unit === 'years' && v === 1 ? 'year' : field.unit;
    return `${toDisplay(field, v)}${unit ? ` ${unit}` : ''}`;
  }

  function buildForm() {
    let fieldset = null;
    FIELDS.forEach((f) => {
      if (f.group) {
        fieldset = document.createElement('fieldset');
        fieldset.innerHTML = `<legend>${f.group}</legend>${f.custom ? `<div id="${f.custom}"></div>` : ''}`;
        form.appendChild(fieldset);
        return;
      }
      const wrap = document.createElement('label');
      wrap.className = f.type === 'checkbox' ? 'field check' : 'field';
      if (f.when) wrap.dataset.when = [].concat(f.when).join(' ');
      let control;
      if (f.type === 'checkbox') {
        control = `<input type="checkbox" name="${f.key}"><span class="field-label">${f.label}</span>`;
      } else if (f.type === 'text') {
        control = `<span class="field-label">${f.label}</span>
          <span class="field-input"><input type="text" name="${f.key}" maxlength="60" class="wide"></span>`;
      } else if (f.type === 'select') {
        control = `<span class="field-label">${f.label}</span>
          <span class="field-input"><select name="${f.key}" class="wide"><option value="1"></option><option value="2"></option></select></span>`;
      } else {
        control = `<span class="field-label">${f.label}</span>
          <span class="field-input">
            <input type="number" name="${f.key}" step="${f.step}" ${f.min !== undefined ? `min="${f.min}"` : ''} ${f.max !== undefined ? `max="${f.max}"` : ''}>
            ${f.unit ? `<span class="unit">${f.unit}</span>` : ''}
          </span>`;
      }
      wrap.innerHTML = `${control}
        ${f.help ? `<span class="help">${f.help}</span>` : ''}
        ${f.custom ? `<span class="help" id="${f.custom}"></span>` : ''}`;
      fieldset.appendChild(wrap);
    });
    setValues(START);
  }

  // Shows or hides the second basis inputs and keeps basis names in step.
  function refreshBasisUI() {
    const p = readParams();
    form.querySelectorAll('[data-when]').forEach((el) => {
      el.hidden = !el.dataset.when.split(' ').every((key) => form.elements[key].checked);
    });
    ['releaseBasis', 'rpBasis'].forEach((key) => {
      const select = form.elements[key];
      select.options[0].textContent = basisName(p, 1);
      select.options[1].textContent = basisName(p, 2);
    });
    if (p.basis2Pending) {
      document.getElementById('basis2-note').textContent = 'Enter a margin to add this basis to the results.';
      return;
    }
    if (!p.basis2On) return;
    const change = basis2Factor(p) - 1;
    document.getElementById('basis2-note').textContent =
      `Gives liabilities of about ${fmtMoney(p.liabilities * basis2Factor(p))} today on this basis ` +
      `(${change >= 0 ? '+' : ''}${(change * 100).toFixed(1)}% against the main basis), ` +
      `from the same benefits discounted at this rate over a ${p.duration}-year duration.`;
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  function renderMarketNote() {
    const p = readParams();
    Object.entries(MARKET_FIELDS).forEach(([key, m]) => {
      const el = document.getElementById(m.note);
      const v = m.value(p);
      if (v === null) {
        el.textContent = MARKET && m.missing ? m.missing : 'No market data loaded. Run tools/update-market-data.ps1 to fetch it.';
        return;
      }
      el.innerHTML = `${escapeHtml(m.text(p, v))} <button type="button" class="link" data-use-market="${key}">${m.button}</button>`;
    });
  }

  function allSets() {
    const uploaded = [...uploadedSets].sort((a, b) => String(b.asAt).localeCompare(String(a.asAt)));
    return [AS.BUILT_IN, ...uploaded];
  }

  function growthTotalHtml() {
    const gp = M.growthPortfolio(currentSet, allocation);
    const dropped = Object.keys(allocation).filter((k) => allocation[k] > 0 && !currentSet.classes.some((c) => c.name === k));
    return `
      <span>Growth assets total <strong>${(gp.growthPct * 100).toFixed(1)}%</strong></span>
      <span>Portfolio return over gilts <strong>${(gp.premium * 100).toFixed(2)}%</strong></span>
      <span>Portfolio volatility <strong>${(gp.vol * 100).toFixed(1)}%</strong></span>
      <span class="help">The rest (${Math.max(0, 100 - gp.growthPct * 100).toFixed(1)}%) is held in matching assets.</span>
      ${gp.growthPct > 1 ? '<span class="warn">Growth allocations add up to more than 100% of assets.</span>' : ''}
      ${dropped.length ? `<span class="warn">Not in this set, so ignored: ${dropped.map(escapeHtml).join(', ')}.</span>` : ''}`;
  }

  function renderGrowth() {
    const options = allSets().map((s) => `<option value="${escapeHtml(s.id)}" ${s.id === currentSet.id ? 'selected' : ''}>
      ${escapeHtml(s.name)}${s.asAt ? ` (as at ${escapeHtml(s.asAt)})` : ''}</option>`).join('');
    const rows = currentSet.classes.map((c) => `
      <label class="alloc-row">
        <span class="alloc-name">${escapeHtml(c.name)}</span>
        <input type="number" data-class="${escapeHtml(c.name)}" step="1" min="0" max="100" value="${+((allocation[c.name] || 0) * 100).toFixed(2)}">
        <span class="alloc-stats">${(c.premium * 100).toFixed(1)}% · ${(c.vol * 100).toFixed(0)}%</span>
      </label>`).join('');
    const message = setMessage ? `<div class="set-msg ${setMessage.kind}">${setMessage.lines.map((l) => `<p>${escapeHtml(l)}</p>`).join('')}</div>` : '';

    document.getElementById('growth').innerHTML = `
      <div class="set-picker">
        <span class="field-label">Asset class assumptions</span>
        <select id="set-select">${options}</select>
        <p class="help">${escapeHtml(currentSet.source || 'No source given.')}</p>
        <div class="set-actions">
          <button type="button" class="link" id="set-upload">Upload CSV</button>
          <button type="button" class="link" id="set-download">Download as CSV</button>
          ${currentSet.builtIn ? '' : '<button type="button" class="link danger" id="set-delete">Remove this set</button>'}
        </div>
        <input type="file" id="set-file" accept=".csv,text/csv" hidden>
        ${message}
      </div>
      <div class="alloc-head"><span>Asset class</span><span>% of assets</span><span>Return over gilts · volatility</span></div>
      ${rows}
      <div class="alloc-total" id="growth-total">${growthTotalHtml()}</div>`;
  }

  function selectSet(id) {
    currentSet = allSets().find((s) => s.id === id) || AS.BUILT_IN;
    setMessage = null;
    renderGrowth();
    update();
  }

  function handleUpload(file) {
    const reader = new FileReader();
    reader.onload = () => {
      const { set, errors } = AS.fromCsv(String(reader.result));
      if (errors.length) {
        setMessage = { kind: 'error', lines: [`Could not use ${file.name}:`, ...errors.slice(0, 6)] };
        renderGrowth();
        return;
      }
      uploadedSets = uploadedSets.filter((s) => !(s.name === set.name && s.asAt === set.asAt)).concat(set);
      const saved = AS.saveUploaded(uploadedSets);
      currentSet = set;
      setMessage = {
        kind: 'info',
        lines: [saved
          ? `Loaded "${set.name}". It's saved in this browser for next time.`
          : `Loaded "${set.name}" for this visit only. This browser wouldn't let the app save it.`]
      };
      renderGrowth();
      update();
    };
    reader.readAsText(file);
  }

  function downloadFile(name, text, type) {
    const blob = new Blob([text], { type });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  function wireGrowth() {
    const box = document.getElementById('growth');
    box.addEventListener('change', (e) => {
      if (e.target.id === 'set-select') selectSet(e.target.value);
      if (e.target.id === 'set-file' && e.target.files[0]) handleUpload(e.target.files[0]);
    });
    box.addEventListener('input', (e) => {
      const name = e.target.dataset.class;
      if (!name) return;
      e.stopPropagation();
      const v = parseFloat(e.target.value);
      allocation[name] = Number.isFinite(v) ? Math.min(Math.max(v, 0), 100) / 100 : 0;
      document.getElementById('growth-total').innerHTML = growthTotalHtml();
      scheduleUpdate();
    });
    box.addEventListener('click', (e) => {
      if (e.target.id === 'set-upload') box.querySelector('#set-file').click();
      if (e.target.id === 'set-download') {
        const safe = currentSet.name.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase();
        downloadFile(`${safe || 'assumptions'}.csv`, AS.toCsv(currentSet), 'text/csv');
      }
      if (e.target.id === 'set-delete' && window.confirm(`Remove "${currentSet.name}" from this browser?`)) {
        uploadedSets = uploadedSets.filter((s) => s.id !== currentSet.id);
        AS.saveUploaded(uploadedSets);
        selectSet(AS.BUILT_IN.id);
      }
    });
  }

  function setValues(values) {
    FIELDS.forEach((f) => {
      if (!f.key) return;
      if (f.type === 'checkbox') form.elements[f.key].checked = !!values[f.key];
      else form.elements[f.key].value = values[f.key] === null ? '' : toDisplay(f, values[f.key]);
    });
  }

  function readParams() {
    const p = {};
    FIELDS.forEach((f) => {
      if (!f.key) return;
      const el = form.elements[f.key];
      if (f.type === 'checkbox') { p[f.key] = el.checked; return; }
      if (f.type === 'text') { p[f.key] = el.value.trim() || START[f.key]; return; }
      if (f.type === 'select') { p[f.key] = el.value === '2' ? 2 : 1; return; }
      let v = parseFloat(el.value);
      if (!Number.isFinite(v) && f.optional) { p[f.key] = null; return; }
      if (!Number.isFinite(v)) v = toDisplay(f, START[f.key]);
      if (f.min !== undefined) v = Math.max(v, f.min);
      if (f.max !== undefined) v = Math.min(v, f.max);
      if (f.int) v = Math.round(v);
      p[f.key] = f.pct ? v / 100 : v;
    });
    // The second basis only counts once its margin has been entered.
    p.basis2Pending = p.basis2On && p.basis2Margin === null;
    if (p.basis2Pending) p.basis2On = false;
    const gp = M.growthPortfolio(currentSet, allocation);
    p.growthPct = gp.growthPct;
    p.growthPremium = gp.premium;
    p.growthVol = gp.vol;
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

  // Stresses that need an input (e.g. longevity sensitivity) are unavailable until it is entered.
  function refreshStresses(p) {
    M.STRESSES.forEach((s) => {
      const btn = stressBox.querySelector(`[data-key="${s.key}"]`);
      const unavailable = !!s.needs && p[s.needs] === null;
      btn.disabled = unavailable;
      btn.title = unavailable ? 'Enter the liability increase per extra year of life expectancy to use this stress.' : '';
      if (unavailable && activeStresses.has(s.key)) {
        activeStresses.delete(s.key);
        btn.setAttribute('aria-pressed', 'false');
      }
    });
  }

  function renderSnapshot(p, start) {
    const stressed = activeStresses.size > 0;
    const L2 = start.L * basis2Factor(p);
    const second = p.basis2On ? `
      <div><span class="k">${onBasis(p, 'Liabilities', 2)}</span><span class="v">${fmtMoney(L2)}</span></div>
      <div><span class="k">${onBasis(p, 'Funding level', 2)}</span><span class="v">${Math.round(start.A / L2 * 100)}%</span></div>` : '';
    document.getElementById('snapshot').innerHTML = `
      <div><span class="k">Assets</span><span class="v">${fmtMoney(start.A)}</span></div>
      <div><span class="k">Insurer price</span><span class="v">${fmtMoney(start.L * (1 + p.buyoutPremium))}</span></div>
      <div><span class="k">${onBasis(p, 'Liabilities', 1)}</span><span class="v">${fmtMoney(start.L)}</span></div>
      <div><span class="k">${onBasis(p, 'Funding level', 1)}</span><span class="v">${Math.round(start.A / start.L * 100)}%</span></div>
      ${second}
      <p class="snap-note">${stressed ? 'After the stress' : 'Today'}, on the chosen funding ${p.basis2On ? 'bases' : 'basis'}.</p>`;
  }

  function deltaHtml(row, cur, base) {
    if (base === undefined || base === null || cur === null) return '';
    if (row.fmt(cur) === row.fmt(base)) return '<span class="delta">unchanged</span>';
    const diff = cur - base;
    let cls = '';
    if (row.better) cls = (diff > 0) === (row.better === 'up') ? 'better' : 'worse';
    return `<span class="delta ${cls}">was ${row.fmt(base)}</span>`;
  }

  function renderYearToggle(p) {
    const years = VIEW_YEARS.filter((y) => y <= p.horizon);
    if (!years.includes(viewYear)) viewYear = years[years.length - 1];
    document.getElementById('year-toggle').innerHTML = years.map((y) => `
      <button type="button" data-year="${y}" aria-pressed="${y === viewYear}">Year ${y}</button>`).join('');
  }

  function renderCards(p, results, baseResults) {
    const box = document.getElementById('cards');
    box.innerHTML = results.map((r, i) => {
      const info = INFO[r.strategy];
      const base = baseResults ? baseResults[i] : null;
      const val = (row, res) => res[row.key][viewYear];
      const rows = ROWS.filter((row) => (!row.only || row.only === r.strategy) && (!row.show || row.show(p))).map((row) => `
        <div class="row">
          <dt>${row.label(p)}</dt>
          <dd><span class="val">${row.fmt(val(row, r))}</span>${base ? deltaHtml(row, val(row, r), val(row, base)) : ''}</dd>
        </div>`).join('');
      return `
        <article class="card" style="--c:${info.color}">
          <header><span class="swatch"></span><h3>${info.name}</h3></header>
          <p class="blurb">${info.blurb(p)}</p>
          <dl>${rows}</dl>
        </article>`;
    }).join('');
  }

  function fanDatasets(pc, color, refLines) {
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

  function renderBasisToggle(p) {
    const box = document.getElementById('basis-toggle');
    box.hidden = !p.basis2On;
    if (!p.basis2On) return;
    box.innerHTML = [1, 2].map((b) => `
      <button type="button" data-basis="${b}" aria-pressed="${chartBasis === b}">${escapeHtml(basisName(p, b))}</button>`).join('');
  }

  function renderFanCharts(p, results) {
    const viewing = p.basis2On ? chartBasis : 1;
    const pcOf = (r) => (viewing === 2 ? r.percentiles2 : r.percentiles);
    document.getElementById('funding-sub').textContent = `On ${theBasis(p, viewing)}. ` +
      'The line is the median outcome. Shaded bands cover the middle 50% and 90% of scenarios.';

    let lo = Infinity, hi = -Infinity;
    results.forEach((r) => {
      lo = Math.min(lo, ...pcOf(r).p5);
      hi = Math.max(hi, ...pcOf(r).p95);
    });
    const yMin = Math.max(0, Math.floor(Math.min(lo, 95) / 10) * 10);
    const yMax = Math.ceil(Math.max(hi, p.releaseThreshold * 100 + 5) / 10) * 10;
    const labels = results[0].percentiles.p50.map((_, t) => t);
    const releaseBasis = p.basis2On ? p.releaseBasis : 1;

    results.forEach((r) => {
      const info = INFO[r.strategy];
      const refs = [{ label: '100% funded', value: 100, color: '#869690' }];
      if (r.strategy === 'buyout' && viewing === 1) refs.push({ label: 'Insurer price', value: (1 + p.buyoutPremium) * 100, color: info.color });
      if (r.strategy === 'release' && viewing === releaseBasis) refs.push({ label: 'Release above', value: p.releaseThreshold * 100, color: info.color });
      const datasets = fanDatasets(pcOf(r), info.color, refs);

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
            y: { min: yMin, max: yMax, ticks: { callback: (v) => `${v}%` }, grid: { color: '#e9f0ed' } },
            x: { title: { display: true, text: 'Year' }, ticks: { maxTicksLimit: 6 }, grid: { display: false } }
          }
        }
      });
    });
  }

  function renderMoneyChart(results) {
    document.getElementById('money-sub').textContent =
      `Average across all scenarios over the first ${viewYear} years, in £m, not discounted.`;
    const labels = results.map((r) => INFO[r.strategy].name);
    const datasets = MONEY_SERIES.map((s) => ({
      label: s.label,
      data: results.map((r) => +r[s.key][viewYear].toFixed(1)),
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
          y: { ticks: { callback: (v) => `£${v}m` }, grid: { color: '#e9f0ed' }, beginAtZero: true },
          x: { grid: { display: false } }
        }
      }
    });
  }

  function renderAudit(record) {
    const stressText = record.stresses.length
      ? record.stresses.map((k) => M.STRESSES.find((s) => s.key === k).label).join(', ')
      : 'None';
    const p = record.inputs;
    const inputs = FIELDS.filter((f) => f.key && [].concat(f.when || []).every((k) => p[k])).map((f) => `
      <div><dt>${f.auditLabel || f.label}</dt><dd>${auditValue(f, p)}</dd></div>`).join('');
    const set = record.assumptionSet;
    const growth = set.classes.map((c) => `
      <div><dt>${escapeHtml(c.name)}</dt><dd>${+(record.allocation[c.name] * 100).toFixed(2)}% of assets ·
        ${(c.premium * 100).toFixed(1)}% over gilts · ${(c.vol * 100).toFixed(0)}% vol</dd></div>`).join('');
    document.getElementById('audit-body').innerHTML = `
      <div class="audit-meta">
        <div><span class="k">Run at</span><span>${new Date(record.runAt).toLocaleString('en-GB')}</span></div>
        <div><span class="k">Model version</span><span>${record.modelVersion}</span></div>
        <div><span class="k">Stresses applied</span><span>${stressText}</span></div>
        <div><span class="k">Asset class assumptions</span><span>${escapeHtml(set.name)}${set.asAt ? `, as at ${escapeHtml(set.asAt)}` : ''}</span></div>
        <div><span class="k">Market data</span><span>${record.marketData ? `${escapeHtml(record.marketData.source)}, as at ${escapeHtml(record.marketData.asAt)}` : 'None loaded'}</span></div>
      </div>
      <h3 class="audit-sub">Scheme and model inputs</h3>
      <dl class="audit-inputs">${inputs}</dl>
      <h3 class="audit-sub">Growth assets</h3>
      <dl class="audit-inputs wide">${growth}</dl>
      <p class="help">Portfolio: ${(record.inputs.growthPct * 100).toFixed(1)}% of assets,
        ${(record.inputs.growthPremium * 100).toFixed(2)}% a year over gilts, ${(record.inputs.growthVol * 100).toFixed(1)}% volatility.
        The downloaded run record includes the full correlation matrix.</p>`;
  }

  function update() {
    const p = readParams();
    refreshStresses(p);
    const stresses = [...activeStresses];
    const run = M.run(p, stresses);
    const base = stresses.length ? M.run(p, []) : null;

    renderSnapshot(p, run.start);
    renderYearToggle(p);
    renderCards(p, run.results, base ? base.results : null);
    renderBasisToggle(p);
    renderFanCharts(p, run.results);
    renderMoneyChart(run.results);

    lastRun = {
      tool: 'Headroom prototype',
      modelVersion: M.MODEL_VERSION,
      runAt: new Date().toISOString(),
      inputs: p,
      allocation: Object.fromEntries(currentSet.classes.map((c) => [c.name, allocation[c.name] || 0])),
      assumptionSet: currentSet,
      marketData: MARKET,
      stresses,
      startingPosition: run.start,
      results: run.results,
      baseResults: base ? base.results : null
    };
    renderAudit(lastRun);
  }

  function download() {
    if (!lastRun) return;
    downloadFile(`headroom-run-${lastRun.runAt.slice(0, 19).replace(/[:T]/g, '-')}.json`,
      JSON.stringify(lastRun, null, 2), 'application/json');
  }

  let timer = null;
  function scheduleUpdate() {
    clearTimeout(timer);
    timer = setTimeout(update, 200);
  }

  form.addEventListener('input', (e) => {
    // Fill longevity uncertainty from the ONS figure the first time a sensitivity is entered.
    if (e.target.name === 'longevitySensitivity' && form.elements.longevityVol.value === '') {
      const v = MARKET_FIELDS.longevityVol.value(readParams());
      if (v !== null) form.elements.longevityVol.value = +(v * 100).toFixed(2);
    }
    renderMarketNote();
    refreshBasisUI();
    scheduleUpdate();
  });
  document.getElementById('year-toggle').addEventListener('click', (e) => {
    const b = e.target.closest('[data-year]');
    if (!b) return;
    viewYear = Number(b.dataset.year);
    update();
  });
  document.getElementById('basis-toggle').addEventListener('click', (e) => {
    const b = e.target.closest('[data-basis]');
    if (!b) return;
    chartBasis = Number(b.dataset.basis);
    update();
  });
  form.addEventListener('submit', (e) => e.preventDefault());
  form.addEventListener('click', (e) => {
    const key = e.target.dataset.useMarket;
    if (!key) return;
    form.elements[key].value = +(MARKET_FIELDS[key].value(readParams()) * 100).toFixed(2);
    update();
  });
  document.getElementById('reset').addEventListener('click', () => {
    setValues(START);
    allocation = Object.assign({}, AS.DEFAULT_ALLOCATION);
    setMessage = null;
    renderGrowth();
    renderMarketNote();
    refreshBasisUI();
    update();
  });
  document.getElementById('download').addEventListener('click', download);
  document.getElementById('print').addEventListener('click', () => window.print());

  Chart.defaults.font.family = "'Inter', system-ui, sans-serif";
  Chart.defaults.color = '#55665f';

  buildForm();
  renderGrowth();
  wireGrowth();
  renderMarketNote();
  refreshBasisUI();
  buildStresses();
  update();
})();
