(function () {
  'use strict';

  const M = window.HeadroomModel;
  const AS = window.HeadroomAssumptions;
  // Saved market data bundled with the page; replaced by live data from the server when available.
  let MARKET = window.HEADROOM_MARKET || null;

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
      missing: 'Enter the liability increase per extra year of life expectancy above to use the ONS-based figure.',
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
    { key: 'longevitySensitivity', label: 'Liability increase per extra year of life expectancy', unit: '% of liabilities',
      pct: true, step: 0.5, min: 0, max: 15, optional: true,
      help: 'Used for longevity uncertainty and the longevity stress. Leave blank to leave longevity out.' },
    { key: 'longevityVol', label: 'Longevity uncertainty', unit: '% of liabilities a year', pct: true, step: 0.01, min: 0, max: 3,
      optional: true, custom: 'market-lvol' },
    { key: 'buyoutPremium', label: 'Insurer price above liabilities', unit: '%', pct: true, step: 1, min: 0, max: 30 },

    { group: 'Buyout and surplus release' },
    { key: 'buyoutGrowthPct', label: 'Buyout: growth assets while waiting', unit: '% of assets', pct: true, step: 5, min: 0, max: 100 },
    { key: 'buyoutYear', label: 'Buyout: employer pays any shortfall to buy out by year', unit: '', step: 1, min: 1, max: 40,
      int: true, optional: true, help: 'Leave blank to wait until the scheme can afford the insurer\'s price.' },
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
    { key: 'rpOutperformance', label: 'Investment outperformance allowed for', unit: '% a year above gilts', pct: true, step: 0.1, min: 0, max: 10,
      optional: true, when: 'rpOn', help: 'Assumed return on the assets above gilts. Leave blank to assume the assets earn the discount rate.' },
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
      blurb: (p) => `Cut growth assets to ${fmtPct(p.buyoutGrowthPct)} and insure the scheme as soon as the insurer's price is affordable` +
        (p.buyoutYear !== null ? `, with the employer paying any shortfall to buy out by year ${p.buyoutYear}.` : '.')
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
    { key: 'expEmployer', except: 'buyout', label: () => `Expected surplus to employer by year ${viewYear} (after tax)`, fmt: fmtMoney, better: 'up' },
    { key: 'expMember', except: 'buyout', label: () => `Expected surplus to members by year ${viewYear} (before tax)`, fmt: fmtMoney, better: 'up' },
    { key: 'expRemaining', except: 'buyout', label: () => `Surplus still in scheme in year ${viewYear}`, fmt: fmtMoney },
    { key: 'probBuyout', only: 'buyout', label: () => `Chance of buyout by year ${viewYear}`, fmt: fmtPct, better: 'up' },
    { key: 'medianBuyoutYear', only: 'buyout', label: () => `Typical year of buyout, if by year ${viewYear}`, fmt: fmtYear }
  ];

  // The few big numbers shown on each option card; everything else sits under "More detail".
  const HEADLINES = [
    { key: 'medianFunding', label: (p) => onBasis(p, 'Median funding', 1), fmt: fmtPct, better: 'up' },
    { key: 'probBelow', label: (p) => onBasis(p, 'Chance below 100%', 1), fmt: fmtPct, better: 'down' },
    { key: 'probContrib', label: () => 'Chance employer pays in', fmt: fmtPct, better: 'down' },
    { key: 'probBuyout', only: 'buyout', label: () => 'Chance of buyout', fmt: fmtPct, better: 'up' },
    { key: 'expRemaining', only: 'runon', label: () => 'Surplus still in scheme', fmt: fmtMoney },
    { key: 'expEmployer', only: 'release', label: () => 'Surplus to employer (after tax)', fmt: fmtMoney, better: 'up' }
  ];

  // Contributions are drawn left of zero (paid in); the rest stack to the right.
  const MONEY_SERIES = [
    { key: 'expContrib', label: 'Paid in by employer', color: '#c2410c', labelColor: '#fff', paidIn: true },
    { key: 'expEmployer', label: 'To employer (after tax)', color: '#1b2f5e', labelColor: '#fff' },
    { key: 'expMember', label: 'To members (before tax)', color: '#86a6e3', labelColor: '#0f1f3d' },
    { key: 'expRemaining', label: 'Still in scheme (not paid out)', color: 'hatch', labelColor: '#3f4d66' }
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
    // Each group is a collapsible section; only the first starts open.
    let fieldset = null;
    FIELDS.forEach((f) => {
      if (f.group) {
        const section = document.createElement('details');
        section.className = 'section';
        section.open = !form.children.length;
        section.innerHTML = `<summary>${f.group}</summary><div class="section-body">${f.custom ? `<div id="${f.custom}"></div>` : ''}</div>`;
        form.appendChild(section);
        fieldset = section.querySelector('.section-body');
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

  // One card per option, built once so the charts and "More detail" state survive updates.
  function buildCards() {
    document.getElementById('cards').innerHTML = M.STRATEGIES.map((s) => `
      <article class="card" style="--c:${INFO[s].color}" data-strategy="${s}">
        <header><span class="swatch"></span><h3>${INFO[s].name}</h3></header>
        <p class="blurb"></p>
        <div class="kpis"></div>
        <div class="chart-box"><canvas id="chart-${s}"></canvas></div>
        <details class="more"><summary>More detail</summary><dl></dl></details>
      </article>`).join('');
  }

  function renderCards(p, results, baseResults) {
    results.forEach((r, i) => {
      const card = document.querySelector(`.card[data-strategy="${r.strategy}"]`);
      const base = baseResults ? baseResults[i] : null;
      const val = (row, res) => res[row.key][viewYear];
      const applies = (row) => (!row.only || row.only === r.strategy) && row.except !== r.strategy && (!row.show || row.show(p));
      card.querySelector('.blurb').innerHTML = INFO[r.strategy].blurb(p);
      card.querySelector('.kpis').innerHTML = HEADLINES.filter(applies).map((row) => `
        <div class="kpi">
          <span class="kpi-val">${row.fmt(val(row, r))}</span>
          <span class="kpi-label">${row.label(p)}</span>
          ${base ? deltaHtml(row, val(row, r), val(row, base)) : ''}
        </div>`).join('');
      card.querySelector('.more dl').innerHTML = ROWS.filter(applies).map((row) => `
        <div class="row">
          <dt>${row.label(p)}</dt>
          <dd><span class="val">${row.fmt(val(row, r))}</span>${base ? deltaHtml(row, val(row, r), val(row, base)) : ''}</dd>
        </div>`).join('');
    });
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
    document.getElementById('basis-control').hidden = !p.basis2On;
    if (!p.basis2On) return;
    box.innerHTML = [1, 2].map((b) => `
      <button type="button" data-basis="${b}" aria-pressed="${chartBasis === b}">${escapeHtml(basisName(p, b))}</button>`).join('');
  }

  function renderFanCharts(p, results) {
    const viewing = p.basis2On ? chartBasis : 1;
    const pcOf = (r) => (viewing === 2 ? r.percentiles2 : r.percentiles);
    document.getElementById('funding-sub').textContent = `Charts show funding on ${theBasis(p, viewing)} over the first ` +
      `${viewYear} years: the line is the median, shaded bands cover the middle 50% and 90% of scenarios. Each chart has its own scale.`;

    // Only the years up to the one chosen with the year switch.
    const upTo = (pc) => Object.fromEntries(Object.entries(pc).map(([k, v]) => [k, v.slice(0, viewYear + 1)]));
    const labels = Array.from({ length: viewYear + 1 }, (_, t) => t);
    const releaseBasis = p.basis2On ? p.releaseBasis : 1;

    results.forEach((r) => {
      const info = INFO[r.strategy];
      const pc = upTo(pcOf(r));
      const refs = [{ label: '100% funded', value: 100, color: '#8b94a6' }];
      if (r.strategy === 'buyout' && viewing === 1) refs.push({ label: 'Insurer price', value: (1 + p.buyoutPremium) * 100, color: info.color });
      if (r.strategy === 'release' && viewing === releaseBasis) refs.push({ label: 'Release above', value: p.releaseThreshold * 100, color: info.color });
      const datasets = fanDatasets(pc, info.color, refs);

      // Fit the scale to this chart's outcomes and reference lines, on a round step.
      const lo = Math.min(...pc.p5, ...refs.map((x) => x.value));
      const hi = Math.max(...pc.p95, ...refs.map((x) => x.value));
      const step = [1, 2, 5, 10, 20, 25, 50, 100].find((s) => (hi - lo) / s <= 6) || 100;
      const yMin = Math.max(0, Math.floor((lo - step / 2) / step) * step);
      const yMax = Math.ceil((hi + step / 2) / step) * step;

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
            y: { min: yMin, max: yMax, border: { display: false }, ticks: { maxTicksLimit: 5, callback: (v) => `${v}%`, font: { size: 11 } }, grid: { color: '#edf1f7' } },
            x: { border: { display: false }, ticks: { maxTicksLimit: 6, font: { size: 11 }, callback: (v) => `Yr ${v}` }, grid: { display: false } }
          }
        }
      });
    });
  }

  // Pale diagonal hatching for surplus that is still in the scheme (not paid to anyone).
  function hatchPattern() {
    const c = document.createElement('canvas');
    c.width = c.height = 8;
    const x = c.getContext('2d');
    x.fillStyle = '#e6ebf3';
    x.fillRect(0, 0, 8, 8);
    x.strokeStyle = '#bcc7d8';
    x.lineWidth = 1.5;
    x.beginPath();
    x.moveTo(-1, 9); x.lineTo(9, -1);
    x.stroke();
    return x.createPattern(c, 'repeat');
  }

  // Writes each segment's value on the bar when there is room for it.
  const segmentLabels = {
    id: 'segmentLabels',
    afterDatasetsDraw(chart) {
      const { ctx } = chart;
      ctx.save();
      ctx.font = "600 12px 'Inter', system-ui, sans-serif";
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      chart.data.datasets.forEach((ds, i) => {
        chart.getDatasetMeta(i).data.forEach((bar, j) => {
          const text = fmtMoney(Math.abs(ds.data[j]));
          if (Math.abs(ds.data[j]) < 0.05 || Math.abs(bar.x - bar.base) < ctx.measureText(text).width + 12) return;
          ctx.fillStyle = ds.labelColor;
          ctx.fillText(text, (bar.x + bar.base) / 2, bar.y);
        });
      });
      ctx.restore();
    }
  };

  function signedMoney(v) {
    return `${v < 0 ? '−' : v > 0 ? '+' : ''}${fmtMoney(Math.abs(v))}`;
  }

  function renderMoneyChart(results) {
    document.getElementById('money-sub').textContent =
      `Average across all scenarios over the first ${viewYear} years, in £m, not discounted. ` +
      'Left of zero is paid in by the employer; right is paid out, or still held in the scheme.';

    // Net to employer = surplus received after tax less contributions paid in.
    document.getElementById('money-net').innerHTML = results.map((r) => {
      const net = r.expEmployer[viewYear] - r.expContrib[viewYear];
      return `<div class="net"><span class="net-name"><span class="swatch" style="--c:${INFO[r.strategy].color}"></span>${INFO[r.strategy].name}</span>
        <span class="net-val ${net < 0 ? 'neg' : ''}">${signedMoney(net)}</span><span class="net-label">net to employer</span></div>`;
    }).join('');

    const labels = results.map((r) => INFO[r.strategy].name);
    const datasets = MONEY_SERIES.map((s) => ({
      label: s.label,
      // For buyout, surplus not yet bought out is needed to meet the insurer's price, so it is not shown as kept.
      data: results.map((r) => (s.key === 'expRemaining' && r.strategy === 'buyout' ? 0 : (s.paidIn ? -1 : 1) * +r[s.key][viewYear].toFixed(1))),
      backgroundColor: s.color === 'hatch' ? hatchPattern() : s.color,
      labelColor: s.labelColor,
      borderRadius: 6,
      borderSkipped: false,
      barThickness: 34
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
      plugins: [segmentLabels],
      options: {
        indexAxis: 'y',
        responsive: true,
        maintainAspectRatio: false,
        animation: false,
        plugins: {
          legend: { position: 'bottom', labels: { boxWidth: 12, boxHeight: 12, usePointStyle: true, pointStyle: 'rectRounded', padding: 16 } },
          tooltip: { callbacks: { label: (c) => `${c.dataset.label}: ${fmtMoney(Math.abs(c.parsed.x))}` } }
        },
        scales: {
          x: {
            stacked: true,
            border: { display: false },
            ticks: { callback: (v) => `£${Math.abs(v)}m`, font: { size: 11 } },
            grid: {
              color: (c) => (c.tick && c.tick.value === 0 ? '#9aa6bb' : '#edf1f7'),
              lineWidth: (c) => (c.tick && c.tick.value === 0 ? 1.5 : 1)
            }
          },
          y: {
            stacked: true,
            border: { display: false },
            grid: { display: false },
            ticks: { color: '#121a2b', font: { size: 13, weight: '600' } },
            // Reserve room for the longest name (web fonts can load after the first measure).
            afterFit: (scale) => { scale.width = Math.max(scale.width, 128); }
          }
        }
      }
    });
  }

  // ---------- Printable summary report ----------
  const REPORT_ROWS = [
    { label: 'Median funding', key: 'medianFunding', fmt: fmtPct },
    { label: 'Chance funding is below 100%', key: 'probBelow', fmt: fmtPct },
    { label: 'Chance employer pays in', key: 'probContrib', fmt: fmtPct },
    { label: 'Employer contributions paid in', key: 'expContrib', fmt: fmtMoney },
    { label: 'Surplus to employer (after tax)', key: 'expEmployer', fmt: fmtMoney, except: 'buyout' },
    { label: 'Surplus to members (before tax)', key: 'expMember', fmt: fmtMoney, except: 'buyout' },
    { label: 'Surplus still in the scheme', key: 'expRemaining', fmt: fmtMoney, except: 'buyout' },
    { label: 'Chance of buyout', key: 'probBuyout', fmt: fmtPct, only: 'buyout' },
    { label: 'Net to employer', value: (r) => r.expEmployer[viewYear] - r.expContrib[viewYear], fmt: signedMoney, strong: true }
  ];

  function reportAssumptions(p, record) {
    const pct = (v, dp = 1) => `${(v * 100).toFixed(dp)}%`;
    const set = record.assumptionSet;
    const market = record.marketData;
    const items = [
      ['Funding basis', `${basisName(p, 1)}: gilts + ${pct(p.discountMargin, 2)}` +
        (p.basis2On ? `; ${basisName(p, 2)}: gilts + ${pct(p.basis2Margin, 2)}` : '')],
      ['Gilt yield', `${pct(p.giltYield, 2)}${market ? ` (Bank of England, as at ${market.asAt})` : ''}`],
      ['Growth assets', `${pct(p.growthPct)} of assets, ${pct(p.growthPremium, 2)} a year over gilts, ${pct(p.growthVol)} volatility ` +
        `(${set.name}${set.asAt ? `, as at ${set.asAt}` : ''})`],
      ['Hedging', `Interest rates ${pct(p.hedgeRatio, 0)}, inflation ${pct(p.inflationHedgeRatio, 0)} of liabilities`],
      ['Liabilities', `Duration ${p.duration} years, ${pct(p.inflationLinkedPct, 0)} inflation-linked, benefits paid ${pct(p.outgoPct)} a year`],
      ['Longevity', p.longevitySensitivity === null ? 'Not included'
        : `${pct(p.longevitySensitivity)} of liabilities per extra year of life; uncertainty ${pct(p.longevityVol || 0, 2)} a year`],
      ['Buyout', `Insurer price ${pct(p.buyoutPremium, 0)} above liabilities; ${pct(p.buyoutGrowthPct, 0)} growth assets while waiting` +
        (p.buyoutYear !== null ? `; employer pays any shortfall to buy out by year ${p.buyoutYear}` : '')],
      ['Surplus release', `Anything above ${pct(p.releaseThreshold, 0)} funded${p.basis2On ? ` on ${theBasis(p, p.releaseBasis)}` : ''}; ` +
        `${pct(p.memberShare, 0)} to members; ${pct(p.employerTax, 0)} tax on payments to the employer`],
      ['Recovery plan', !p.rpOn ? 'No employer deficit contributions'
        : `Valuations every ${p.valuationYears} years, deficits cleared over ${p.recoveryYears} years` +
          (p.rpOutperformance !== null ? `, allowing for ${pct(p.rpOutperformance, 2)} a year over gilts` : '') +
          (p.rpTrigger !== null ? `, only if funding is below ${pct(p.rpTrigger, 0)}` : '')],
      ['Simulation', `${p.numSims.toLocaleString('en-GB')} scenarios over ${p.horizon} years, seed ${p.seed}`]
    ];
    return items.map(([k, v]) => `<div><dt>${k}</dt><dd>${escapeHtml(v)}</dd></div>`).join('');
  }

  function buildReport() {
    if (!lastRun) return;
    const p = lastRun.inputs;
    const results = lastRun.results;
    const start = lastRun.startingPosition;
    const image = (key) => (charts[key] ? `<img src="${charts[key].toBase64Image('image/png', 1)}" alt="">` : '');
    const stressText = lastRun.stresses.length
      ? lastRun.stresses.map((k) => M.STRESSES.find((s) => s.key === k).label).join(', ') : 'None';

    const head = results.map((r) => `<th><span class="swatch" style="--c:${INFO[r.strategy].color}"></span>${INFO[r.strategy].name}</th>`).join('');
    const body = REPORT_ROWS.map((row) => `
      <tr class="${row.strong ? 'strong' : ''}"><td>${row.label}</td>${results.map((r) => {
        const applies = (!row.only || row.only === r.strategy) && row.except !== r.strategy;
        return `<td>${applies ? row.fmt(row.value ? row.value(r) : r[row.key][viewYear]) : '–'}</td>`;
      }).join('')}</tr>`).join('');

    document.getElementById('report').innerHTML = `
      <header class="r-head">
        <div class="r-brand"><span class="logo">H</span><div><div class="r-title">Surplus options summary</div>
          <div class="r-meta">Headroom · ${new Date(lastRun.runAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}
          · Results for year ${viewYear} · Stresses: ${escapeHtml(stressText)}</div></div></div>
      </header>

      <section class="r-scheme">
        <div><span>Assets</span><strong>${fmtMoney(start.A)}</strong></div>
        <div><span>Liabilities (${escapeHtml(basisName(p, 1))})</span><strong>${fmtMoney(start.L)}</strong></div>
        <div><span>Funding level</span><strong>${Math.round(start.A / start.L * 100)}%</strong></div>
        <div><span>Insurer price</span><strong>${fmtMoney(start.L * (1 + p.buyoutPremium))}</strong></div>
      </section>

      <h2>Results by year ${viewYear}</h2>
      <table class="r-table"><thead><tr><th></th>${head}</tr></thead><tbody>${body}</tbody></table>
      <p class="r-note">Averages across ${p.numSims.toLocaleString('en-GB')} scenarios, in £m, not discounted. Net to employer is surplus received after tax less contributions paid in.</p>

      <h2>Funding level over time</h2>
      <div class="r-charts">${results.map((r) => `<figure><figcaption>${INFO[r.strategy].name}</figcaption>${image(r.strategy)}</figure>`).join('')}</div>
      <p class="r-note">On ${escapeHtml(theBasis(p, p.basis2On ? chartBasis : 1))}. The line is the median; shaded bands cover the middle 50% and 90% of scenarios. Each chart has its own scale.</p>

      <h2>Where the money goes</h2>
      <div class="r-money">${image('money')}</div>

      <h2 class="r-break">Key assumptions</h2>
      <dl class="r-assumptions">${reportAssumptions(p, lastRun)}</dl>
      <p class="r-note">Model version ${lastRun.modelVersion}. Market data: ${lastRun.marketData ? `${escapeHtml(lastRun.marketData.source)}, as at ${lastRun.marketData.asAt}` : 'none loaded'}.
        The full inputs and year-by-year results are in the Excel download.</p>
      <p class="r-disclaimer">${document.querySelector('.limits').textContent.trim()}</p>`;
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
        The Excel download includes the full correlation matrix.</p>`;
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

  // ---------- Excel download ----------
  // Cells can be plain values or { v, z } where z is an Excel number format.
  const XL = {
    pct: (v) => (v === null || v === undefined ? '' : { v, z: '0.0%' }),
    pct2: (v) => (v === null || v === undefined ? '' : { v, z: '0.00%' }),
    money: (v) => ({ v: +v.toFixed(3), z: '"£"#,##0.0"m";-"£"#,##0.0"m"' })
  };

  function toSheet(rows, widths) {
    const ws = XLSX.utils.aoa_to_sheet(rows.map((r) => r.map((c) => (c && typeof c === 'object' ? c.v : c))));
    rows.forEach((r, i) => r.forEach((c, j) => {
      if (c && typeof c === 'object' && c.z) ws[XLSX.utils.encode_cell({ r: i, c: j })].z = c.z;
    }));
    ws['!cols'] = widths.map((w) => ({ wch: w }));
    return ws;
  }

  function buildWorkbook(record) {
    const p = record.inputs;
    const results = record.results;
    const names = results.map((r) => INFO[r.strategy].name);
    const stressText = record.stresses.length
      ? record.stresses.map((k) => M.STRESSES.find((s) => s.key === k).label).join(', ') : 'None';
    const wb = XLSX.utils.book_new();

    // 1. Summary: run details and the headline results for the chosen year.
    const summary = [
      ['Headroom: surplus options summary'],
      [],
      ['Run at', new Date(record.runAt).toLocaleString('en-GB')],
      ['Model version', record.modelVersion],
      ['Results for year', viewYear],
      ['Stresses applied', stressText],
      ['Asset class assumptions', `${record.assumptionSet.name}${record.assumptionSet.asAt ? `, as at ${record.assumptionSet.asAt}` : ''}`],
      ['Market data', record.marketData ? `${record.marketData.source}, as at ${record.marketData.asAt}` : 'None loaded'],
      [],
      ['Scheme today'],
      ['Assets', XL.money(record.startingPosition.A)],
      [`Liabilities (${basisName(p, 1)})`, XL.money(record.startingPosition.L)],
      ['Funding level', XL.pct(record.startingPosition.A / record.startingPosition.L)],
      ['Insurer price', XL.money(record.startingPosition.L * (1 + p.buyoutPremium))],
      [],
      [`Results by year ${viewYear}`, ...names],
      ...REPORT_ROWS.map((row) => [row.label, ...results.map((r) => {
        const applies = (!row.only || row.only === r.strategy) && row.except !== r.strategy;
        if (!applies) return '–';
        const v = row.value ? row.value(r) : r[row.key][viewYear];
        return row.fmt === fmtPct ? XL.pct(v) : XL.money(v);
      })]),
      [],
      ['Averages across all scenarios, £m, not discounted. Net to employer is surplus received after tax less contributions paid in.'],
      ['Illustrative only. Results need review by a qualified actuary before being relied on.']
    ];
    XLSX.utils.book_append_sheet(wb, toSheet(summary, [44, 20, 20, 20]), 'Summary');

    // 2. Results by year: every figure for each option, one row per year.
    const byYear = [['Option', 'Year', 'Median funding', 'Funding 5th percentile', 'Funding 95th percentile',
      'Chance below 100%', 'Chance employer has paid in', 'Employer contributions to date',
      'Surplus to employer to date (after tax)', 'Surplus to members to date (before tax)',
      'Surplus still in scheme', 'Chance bought out']];
    results.forEach((r) => {
      r.medianFunding.forEach((_, t) => byYear.push([
        INFO[r.strategy].name, t, XL.pct(r.medianFunding[t]), XL.pct(r.percentiles.p5[t] / 100), XL.pct(r.percentiles.p95[t] / 100),
        XL.pct(r.probBelow[t]), XL.pct(r.probContrib[t]), XL.money(r.expContrib[t]),
        XL.money(r.expEmployer[t]), XL.money(r.expMember[t]), r.strategy === 'buyout' ? '–' : XL.money(r.expRemaining[t]), XL.pct(r.probBuyout[t])
      ]));
    });
    XLSX.utils.book_append_sheet(wb, toSheet(byYear, [16, 6, 14, 14, 14, 14, 16, 18, 20, 20, 16, 14]), 'Results by year');

    // 3. Inputs: every assumption as entered.
    const inputs = [['Section', 'Input', 'Value', 'Unit']];
    let section = '';
    FIELDS.forEach((f) => {
      if (f.group) { section = f.group; return; }
      if (![].concat(f.when || []).every((k) => p[k])) return;
      const v = p[f.key];
      let cell;
      if (v === null) cell = 'Not set';
      else if (f.type === 'checkbox') cell = v ? 'Yes' : 'No';
      else if (f.type === 'select') cell = basisName(p, v);
      else if (f.type === 'text') cell = v;
      else cell = f.pct ? XL.pct2(v) : v;
      inputs.push([section, f.auditLabel || f.label, cell, f.pct ? '' : f.unit || '']);
    });
    XLSX.utils.book_append_sheet(wb, toSheet(inputs, [26, 48, 22, 18]), 'Inputs');

    // 4. Asset classes: allocations, assumptions and correlations.
    const set = record.assumptionSet;
    const classes = [
      ['Assumption set', set.name], ['As at', set.asAt || ''], ['Source', set.source || ''], [],
      ['Asset class', 'Allocation (% of assets)', 'Return over gilts', 'Volatility'],
      ...set.classes.map((c) => [c.name, XL.pct(record.allocation[c.name] || 0), XL.pct2(c.premium), XL.pct(c.vol)]),
      ['Growth portfolio', XL.pct(p.growthPct), XL.pct2(p.growthPremium), XL.pct(p.growthVol)],
      [], ['Correlations', ...set.classes.map((c) => c.name)],
      ...set.classes.map((c, i) => [c.name, ...set.corr[i]])
    ];
    XLSX.utils.book_append_sheet(wb, toSheet(classes, [26, ...set.classes.map(() => 16)]), 'Asset classes');

    // 5. Market data used.
    const m = record.marketData;
    const market = m ? [
      ['Source', m.source], ['As at', m.asAt], [],
      ['Term (years)', 'Gilt yield', 'Gilt yield volatility', 'Implied inflation volatility'],
      ...m.giltCurve.map((g) => {
        const v = (m.volatility && m.volatility.curve.find((x) => x.term === g.term)) || {};
        return [g.term, XL.pct2(g.yield), XL.pct2(v.yieldVol), XL.pct2(v.inflationVol)];
      }),
      [],
      ['Volatility method', m.volatility ? `${m.volatility.method}, ${m.volatility.from} to ${m.asAt}` : ''],
      ...(m.longevity ? [
        [], ['Longevity source', m.longevity.source],
        ['Method', `${m.longevity.method}, ${m.longevity.fromPeriod} to ${m.longevity.toPeriod}`],
        ['Volatility (years a year)', m.longevity.volYears], [],
        ['Period', 'Life expectancy at 65 (years)'],
        ...m.longevity.lifeExpectancy65.map((x) => [x.period, x.years])
      ] : [])
    ] : [['No market data loaded']];
    XLSX.utils.book_append_sheet(wb, toSheet(market, [26, 22, 22, 26]), 'Market data');

    return wb;
  }

  function download() {
    if (!lastRun) return;
    if (!window.XLSX) {
      window.alert('The Excel download needs an internet connection to load. Please check your connection and try again.');
      return;
    }
    const d = new Date(lastRun.runAt);
    const date = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    XLSX.writeFile(buildWorkbook(lastRun), `headroom-results-${date}.xlsx`);
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
  document.getElementById('pdf').addEventListener('click', downloadPdf);
  // If the page is printed from the browser, paper gets the summary rather than the whole page.
  window.addEventListener('beforeprint', buildReport);

  async function downloadPdf() {
    if (!lastRun) return;
    if (!window.html2pdf) {
      window.alert('The PDF download needs an internet connection to load. Please check your connection and try again.');
      return;
    }
    const btn = document.getElementById('pdf');
    const report = document.getElementById('report');
    btn.disabled = true;
    btn.textContent = 'Preparing PDF…';
    buildReport();
    report.classList.add('rendering');
    const d = new Date(lastRun.runAt);
    const date = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    try {
      await html2pdf().set({
        margin: [12, 12, 14, 12],
        filename: `headroom-summary-${date}.pdf`,
        image: { type: 'jpeg', quality: 0.95 },
        // scrollX/scrollY 0: otherwise the capture is offset by how far the page is scrolled and comes out blank.
        html2canvas: { scale: 2, backgroundColor: '#ffffff', scrollX: 0, scrollY: 0 },
        jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' },
        pagebreak: { mode: ['css'], before: '.r-break', avoid: ['tr', '.r-charts', '.r-money', '.r-scheme', '.r-assumptions div'] }
      }).from(report).save();
    } finally {
      report.classList.remove('rendering');
      btn.disabled = false;
      btn.textContent = 'Download PDF summary';
    }
  }

  Chart.defaults.font.family = "'Inter', system-ui, sans-serif";
  Chart.defaults.color = '#5b6578';

  buildForm();
  buildCards();
  renderGrowth();
  wireGrowth();
  renderMarketNote();
  refreshBasisUI();
  buildStresses();
  update();
  refreshMarket();

  // ---------- Live market data ----------
  function setMarketStatus(text, kind) {
    const el = document.getElementById('market-status');
    el.textContent = text;
    el.className = `market-status ${kind || ''}`;
  }

  // Asks the local server for the latest market data (it fetches from the Bank of England if its
  // copy is over an hour old). Inputs still at the old market value move to the new one; inputs
  // the user has typed over are left alone.
  async function refreshMarket() {
    if (!MARKET) { setMarketStatus('No market data', 'warn'); return; }
    if (location.protocol === 'file:') { setMarketStatus(`Market data as at ${fmtDate(MARKET.asAt)}`); return; }
    setMarketStatus('Checking for latest market data…', 'busy');
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 120000);
      const res = await fetch('api/market', { cache: 'no-store', signal: ctrl.signal });
      clearTimeout(timer);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const fresh = await res.json();
      const refreshFailed = res.headers.get('X-Market-Refresh') === 'failed';

      const p = readParams();
      const before = {};
      Object.entries(MARKET_FIELDS).forEach(([key, m]) => { before[key] = m.value(p); });
      MARKET = fresh;
      Object.entries(MARKET_FIELDS).forEach(([key, m]) => {
        const el = form.elements[key];
        const now = m.value(p);
        const untouched = before[key] !== null && el.value !== '' && Math.abs(parseFloat(el.value) - before[key] * 100) < 0.005;
        if (now !== null && untouched) el.value = +(now * 100).toFixed(2);
        const startValue = m.value(M.DEFAULTS);
        if (startValue !== null) START[key] = startValue;
      });
      renderMarketNote();
      update();
      setMarketStatus(refreshFailed
        ? `Couldn't reach the Bank of England; using data as at ${fmtDate(MARKET.asAt)}`
        : `Market data as at ${fmtDate(MARKET.asAt)}`, refreshFailed ? 'warn' : 'ok');
    } catch (e) {
      setMarketStatus(`Using saved market data as at ${fmtDate(MARKET.asAt)}`, 'warn');
    }
  }
})();
