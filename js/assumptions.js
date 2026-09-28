/*
 * Asset class assumption sets: the built-in placeholder set, CSV import/export,
 * and storage of uploaded sets in this browser.
 *
 * CSV layout (opens and saves cleanly in Excel):
 *   Assumption set,Q3 2026 house view
 *   As at,2026-09-30
 *   Source,Example Consulting capital market assumptions
 *   (blank line)
 *   Asset class,Return over gilts %,Volatility %,Global equity,Property,...
 *   Global equity,4.5,17,1,0.5,...
 *   Property,3.0,14,0.5,1,...
 * The columns after Volatility % form the correlation matrix, in the same order as the rows.
 */
(function (global) {
  'use strict';

  const STORAGE_KEY = 'headroom.assumptionSets.v1';

  const BUILT_IN = {
    id: 'builtin-placeholder',
    name: 'Placeholder assumptions',
    asAt: '2026-09-28',
    source: 'Illustrative round numbers chosen for the prototype. Not calibrated to any published assumptions.',
    builtIn: true,
    classes: [
      { name: 'Global equity', premium: 0.045, vol: 0.17 },
      { name: 'Emerging market equity', premium: 0.055, vol: 0.22 },
      { name: 'Private equity', premium: 0.065, vol: 0.25 },
      { name: 'Property', premium: 0.030, vol: 0.14 },
      { name: 'Infrastructure', premium: 0.035, vol: 0.12 },
      { name: 'Multi-asset credit', premium: 0.025, vol: 0.08 },
      { name: 'Private credit', premium: 0.035, vol: 0.10 },
      { name: 'Diversified growth fund', premium: 0.030, vol: 0.10 }
    ],
    corr: [
      [1.0, 0.8, 0.7, 0.5, 0.5, 0.6, 0.5, 0.8],
      [0.8, 1.0, 0.6, 0.4, 0.4, 0.5, 0.4, 0.7],
      [0.7, 0.6, 1.0, 0.5, 0.5, 0.5, 0.5, 0.6],
      [0.5, 0.4, 0.5, 1.0, 0.6, 0.4, 0.4, 0.5],
      [0.5, 0.4, 0.5, 0.6, 1.0, 0.4, 0.4, 0.5],
      [0.6, 0.5, 0.5, 0.4, 0.4, 1.0, 0.7, 0.6],
      [0.5, 0.4, 0.5, 0.4, 0.4, 0.7, 1.0, 0.5],
      [0.8, 0.7, 0.6, 0.5, 0.5, 0.6, 0.5, 1.0]
    ]
  };

  // Default allocation, as % of total assets, by asset class name.
  const DEFAULT_ALLOCATION = {
    'Global equity': 0.12,
    'Emerging market equity': 0.03,
    'Private equity': 0.03,
    'Property': 0.03,
    'Infrastructure': 0.03,
    'Multi-asset credit': 0.03,
    'Private credit': 0.03,
    'Diversified growth fund': 0
  };

  // True if the matrix is positive semi-definite (a valid correlation matrix).
  function isPositiveSemiDefinite(m) {
    const n = m.length;
    const L = Array.from({ length: n }, () => new Array(n).fill(0));
    for (let i = 0; i < n; i++) {
      for (let j = 0; j <= i; j++) {
        let sum = m[i][j];
        for (let k = 0; k < j; k++) sum -= L[i][k] * L[j][k];
        if (i === j) {
          if (sum < -1e-9) return false;
          L[i][i] = Math.sqrt(Math.max(sum, 0));
        } else {
          L[i][j] = L[j][j] > 1e-12 ? sum / L[j][j] : 0;
        }
      }
    }
    return true;
  }

  function validate(set) {
    const errors = [];
    const n = set.classes.length;
    if (!set.name) errors.push('The "Assumption set" name is missing.');
    if (n === 0) errors.push('No asset classes found.');
    const names = new Set();
    set.classes.forEach((c, i) => {
      if (!c.name) errors.push(`Row ${i + 1} has no asset class name.`);
      if (names.has(c.name)) errors.push(`"${c.name}" appears more than once.`);
      names.add(c.name);
      if (!Number.isFinite(c.premium)) errors.push(`"${c.name}": return over gilts is not a number.`);
      if (!Number.isFinite(c.vol) || c.vol < 0) errors.push(`"${c.name}": volatility must be a number of 0 or more.`);
    });
    if (set.corr.length !== n || set.corr.some((row) => row.length !== n)) {
      errors.push(`The correlation matrix must be ${n} by ${n}, one column per asset class in the same order as the rows.`);
      return errors;
    }
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        const v = set.corr[i][j];
        if (!Number.isFinite(v) || v < -1 || v > 1) {
          errors.push(`Correlation between "${set.classes[i].name}" and "${set.classes[j].name}" must be between -1 and 1.`);
        } else if (i === j && Math.abs(v - 1) > 1e-9) {
          errors.push(`"${set.classes[i].name}" must have a correlation of 1 with itself.`);
        } else if (j > i && Math.abs(v - set.corr[j][i]) > 1e-9) {
          errors.push(`Correlations between "${set.classes[i].name}" and "${set.classes[j].name}" differ above and below the diagonal.`);
        }
      }
    }
    if (!errors.length && !isPositiveSemiDefinite(set.corr)) {
      errors.push('The correlations are not internally consistent (the matrix is not positive semi-definite). Check for combinations that cannot all be true at once.');
    }
    return errors;
  }

  function parseCsvLine(line) {
    const cells = [];
    let cur = '', quoted = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (quoted) {
        if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; }
        else if (ch === '"') quoted = false;
        else cur += ch;
      } else if (ch === '"') quoted = true;
      else if (ch === ',') { cells.push(cur.trim()); cur = ''; }
      else cur += ch;
    }
    cells.push(cur.trim());
    return cells;
  }

  function parseNumber(text) {
    return parseFloat(String(text).replace(/[%\s]/g, ''));
  }

  // Returns { set, errors }.
  function fromCsv(text) {
    const lines = text.replace(/^﻿/, '').split(/\r?\n/).map(parseCsvLine);
    const meta = {};
    let headerIndex = -1;
    for (let i = 0; i < lines.length; i++) {
      const [key, value] = lines[i];
      if (!key) continue;
      if (key.toLowerCase() === 'asset class') { headerIndex = i; break; }
      meta[key.toLowerCase()] = value || '';
    }
    if (headerIndex < 0) {
      return { set: null, errors: ['Could not find the header row starting with "Asset class". Download the template to see the layout.'] };
    }

    const classes = [];
    const corr = [];
    for (let i = headerIndex + 1; i < lines.length; i++) {
      const row = lines[i];
      if (!row[0]) continue;
      classes.push({ name: row[0], premium: parseNumber(row[1]) / 100, vol: parseNumber(row[2]) / 100 });
      corr.push(row.slice(3).filter((c) => c !== '').map(parseNumber));
    }

    const set = {
      id: `upload-${Date.now()}`,
      name: meta['assumption set'] || '',
      asAt: meta['as at'] || '',
      source: meta['source'] || '',
      builtIn: false,
      classes,
      corr
    };
    return { set, errors: validate(set) };
  }

  function csvCell(value) {
    const s = String(value);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  }

  function toCsv(set) {
    const num = (v) => +(v * 100).toFixed(4);
    const lines = [
      ['Assumption set', set.name],
      ['As at', set.asAt],
      ['Source', set.source],
      [],
      ['Asset class', 'Return over gilts %', 'Volatility %', ...set.classes.map((c) => c.name)],
      ...set.classes.map((c, i) => [c.name, num(c.premium), num(c.vol), ...set.corr[i]])
    ];
    return lines.map((row) => row.map(csvCell).join(',')).join('\r\n') + '\r\n';
  }

  function loadUploaded() {
    try {
      const sets = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
      return Array.isArray(sets) ? sets.filter((s) => validate(s).length === 0) : [];
    } catch (e) {
      return [];
    }
  }

  function saveUploaded(sets) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(sets));
      return true;
    } catch (e) {
      return false;
    }
  }

  global.HeadroomAssumptions = {
    BUILT_IN, DEFAULT_ALLOCATION, validate, fromCsv, toCsv, loadUploaded, saveUploaded
  };
})(window);
