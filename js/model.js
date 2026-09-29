/*
 * Headroom model: a simplified stochastic projection of a UK defined benefit scheme.
 * Illustrative only. Not an actuarial model and not advice.
 *
 * Each year, per scenario:
 *   - liabilities (on the main funding basis) accrue at gilts + margin, pay benefits, and are
 *     revalued for the change in gilt yields (duration), the change in market implied
 *     inflation (on the inflation-linked share) and a random longevity shock
 *   - matching assets earn gilts + margin; growth assets earn gilts + premium + noise, where
 *     the premium and volatility come from the asset class mix and correlations
 *   - the interest rate and inflation hedges offset the chosen share of each liability sensitivity
 *   - if funding is below 100% (on the chosen basis), the employer pays the shortfall over the
 *     recovery period
 * An optional second funding basis values the same benefits at a different margin over gilts,
 * using the liability duration: L2 = L * exp(-duration * (margin2 - margin)).
 * All three options use the same random scenarios so the comparison is like for like.
 */
(function (global) {
  'use strict';

  const MODEL_VERSION = '0.3.0';
  const MEAN_REVERSION = 0.1;   // pull of gilt yields and implied inflation back to their starting level each year
  const DURATION_RUNOFF = 0.3;  // liability duration shortens as the scheme matures
  const MIN_DURATION = 5;

  const DEFAULTS = {
    assets: 530,
    liabilities: 500,
    outgoPct: 0.05,
    duration: 14,
    inflationLinkedPct: 0.60,
    hedgeRatio: 0.90,
    inflationHedgeRatio: 0.80,
    giltYield: 0.045,
    basis1Name: 'Main funding basis',
    discountMargin: 0.005,
    basis2On: false,
    basis2Name: 'Second funding basis',
    basis2Margin: null, // entered by the user
    releaseBasis: 1,
    contribBasis: 1,
    yieldVol: 0.007,
    inflationVol: 0.004,
    longevityVol: 0.004,
    buyoutPremium: 0.08,
    buyoutGrowthPct: 0.10,
    releaseThreshold: 1.10,
    memberShare: 0.30,
    employerTax: 0.25,
    recoveryYears: 7,
    horizon: 20,
    numSims: 2000,
    seed: 20260928
  };

  const STRATEGIES = ['buyout', 'runon', 'release'];

  function rateShock(state, p, dy) {
    const f = Math.exp(-p.duration * dy);
    return { A: state.A + p.hedgeRatio * state.L * (f - 1), L: state.L * f, y: state.y + dy };
  }

  function inflationShock(state, p, dpi) {
    const f = Math.exp(p.inflationLinkedPct * p.duration * dpi);
    return { A: state.A + p.inflationHedgeRatio * state.L * (f - 1), L: state.L * f, y: state.y };
  }

  // Growth portfolio from an asset class set and allocations (fractions of total assets).
  // Returns the total growth allocation and the premium and volatility per unit of growth assets.
  function growthPortfolio(set, allocation) {
    const w = set.classes.map((c) => allocation[c.name] || 0);
    const total = w.reduce((a, b) => a + b, 0);
    if (total <= 0) return { growthPct: 0, premium: 0, vol: 0 };
    let variance = 0;
    for (let i = 0; i < w.length; i++) {
      for (let j = 0; j < w.length; j++) {
        variance += w[i] * w[j] * set.classes[i].vol * set.classes[j].vol * set.corr[i][j];
      }
    }
    return {
      growthPct: total,
      premium: w.reduce((sum, wi, i) => sum + wi * set.classes[i].premium, 0) / total,
      vol: Math.sqrt(Math.max(variance, 0)) / total
    };
  }

  // Yield at a given term, interpolating linearly along the curve and flat beyond its ends.
  function yieldAtTerm(curve, term) {
    const pts = [...curve].sort((a, b) => a.term - b.term);
    if (term <= pts[0].term) return pts[0].yield;
    for (let i = 1; i < pts.length; i++) {
      if (term <= pts[i].term) {
        const f = (term - pts[i - 1].term) / (pts[i].term - pts[i - 1].term);
        return pts[i - 1].yield + f * (pts[i].yield - pts[i - 1].yield);
      }
    }
    return pts[pts.length - 1].yield;
  }

  // Instant shocks applied to the scheme today, before projecting forward.
  const STRESSES = [
    { key: 'giltDown', label: 'Gilt yields fall 1%', excludes: 'giltUp',
      apply: (s, p) => rateShock(s, p, -0.01) },
    { key: 'giltUp', label: 'Gilt yields rise 1.5%', excludes: 'giltDown',
      apply: (s, p) => rateShock(s, p, 0.015) },
    { key: 'inflationUp', label: 'Inflation expectations rise 1%',
      apply: (s, p) => inflationShock(s, p, 0.01) },
    { key: 'longevity', label: 'People live 1 year longer',
      apply: (s) => ({ A: s.A, L: s.L * 1.04, y: s.y }) },
    { key: 'equityCrash', label: 'Growth assets fall 25%',
      apply: (s, p) => ({ A: s.A - s.A * p.growthPct * 0.25, L: s.L, y: s.y }) }
  ];

  function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function normalGenerator(rand) {
    let spare = null;
    return function () {
      if (spare !== null) { const s = spare; spare = null; return s; }
      let u = 0;
      while (u === 0) u = rand();
      const v = rand();
      const r = Math.sqrt(-2 * Math.log(u));
      spare = r * Math.sin(2 * Math.PI * v);
      return r * Math.cos(2 * Math.PI * v);
    };
  }

  function generateShocks(p) {
    const size = p.numSims * p.horizon;
    const norm = normalGenerator(mulberry32(p.seed));
    const zG = new Float64Array(size);
    const zY = new Float64Array(size);
    const zL = new Float64Array(size);
    const zI = new Float64Array(size);
    for (let i = 0; i < size; i++) {
      zG[i] = norm();
      zY[i] = norm();
      zL[i] = norm();
      zI[i] = norm();
    }
    return { zG, zY, zL, zI };
  }

  function quantile(sorted, q) {
    return sorted[Math.min(sorted.length - 1, Math.floor(q * (sorted.length - 1)))];
  }

  function percentilesOf(values, n, W) {
    const out = { p5: [], p25: [], p50: [], p75: [], p95: [] };
    const col = new Float64Array(n);
    for (let t = 0; t < W; t++) {
      for (let s = 0; s < n; s++) col[s] = values[s * W + t];
      col.sort();
      out.p5.push(quantile(col, 0.05) * 100);
      out.p25.push(quantile(col, 0.25) * 100);
      out.p50.push(quantile(col, 0.50) * 100);
      out.p75.push(quantile(col, 0.75) * 100);
      out.p95.push(quantile(col, 0.95) * 100);
    }
    return out;
  }

  function simulate(p, strategy, start, shocks) {
    const n = p.numSims;
    const H = p.horizon;
    const W = H + 1;
    const growthPct = strategy === 'buyout' ? p.buyoutGrowthPct : p.growthPct;
    const buyoutLevel = 1 + p.buyoutPremium;

    // Second basis liabilities as a multiple of main basis liabilities, at duration D.
    const basis2 = p.basis2On;
    const spread = basis2 ? p.basis2Margin - p.discountMargin : 0;
    const basis2Factor = (D) => Math.exp(-D * spread);
    const releaseFactor = (D) => (basis2 && p.releaseBasis === 2 ? basis2Factor(D) : 1);
    const contribFactor = (D) => (basis2 && p.contribBasis === 2 ? basis2Factor(D) : 1);

    const funding = new Float64Array(n * W);
    const funding2 = basis2 ? new Float64Array(n * W) : null;

    let nContrib = 0, nBelow = 0, nBelow2 = 0, nBought = 0;
    let totContrib = 0, totEmployer = 0, totMember = 0, totRemaining = 0;
    const buyoutYears = [];

    for (let s = 0; s < n; s++) {
      let A = start.A, L = start.L, y = start.y, D = p.duration, inflationDrift = 0;
      let contrib = 0, employer = 0, member = 0, boughtAt = -1;
      let below = A < L;
      let below2 = basis2 && A < L * basis2Factor(D);
      let frozen2 = 0; // funding on the second basis once bought out

      const payOut = (amount) => {
        employer += amount * (1 - p.memberShare) * (1 - p.employerTax);
        member += amount * p.memberShare;
      };
      const record = (t) => {
        funding[s * W + t] = boughtAt >= 0 ? buyoutLevel : A / L;
        if (basis2) funding2[s * W + t] = boughtAt >= 0 ? frozen2 : A / (L * basis2Factor(D));
      };
      const buyOut = (t) => {
        payOut(A - L * buyoutLevel);
        boughtAt = t;
        frozen2 = buyoutLevel / basis2Factor(D);
      };

      if (strategy === 'buyout' && A >= L * buyoutLevel) buyOut(0);
      record(0);

      for (let t = 1; t <= H; t++) {
        if (boughtAt >= 0) { record(t); continue; }

        const target = L * contribFactor(D);
        if (A < target) {
          const c = (target - A) / p.recoveryYears;
          A += c;
          contrib += c;
        }

        const k = s * H + t - 1;
        const dY = MEAN_REVERSION * (p.giltYield - y) + p.yieldVol * shocks.zY[k];
        const rateFactor = Math.exp(-D * dY);
        const dPi = -MEAN_REVERSION * inflationDrift + p.inflationVol * shocks.zI[k];
        const inflationFactor = Math.exp(p.inflationLinkedPct * D * dPi);
        const growth = A * growthPct;
        const outgo = L * p.outgoPct;
        const growthReturn = y + p.growthPremium + p.growthVol * shocks.zG[k];
        const matchingReturn = y + p.discountMargin;

        A = growth * (1 + growthReturn) + (A - growth) * (1 + matchingReturn)
          + p.hedgeRatio * L * (rateFactor - 1)
          + p.inflationHedgeRatio * L * (inflationFactor - 1) - outgo;
        L = (L * (1 + matchingReturn) - outgo) * rateFactor * inflationFactor
          * (1 + p.longevityVol * shocks.zL[k]);
        A = Math.max(A, 0);
        y += dY;
        inflationDrift += dPi;
        D = Math.max(D - DURATION_RUNOFF, MIN_DURATION);

        if (A < L) below = true;
        if (basis2 && A < L * basis2Factor(D)) below2 = true;

        const releaseLevel = L * releaseFactor(D) * p.releaseThreshold;
        if (strategy === 'buyout' && A >= L * buyoutLevel) {
          buyOut(t);
        } else if (strategy === 'release' && A > releaseLevel) {
          payOut(A - releaseLevel);
          A = releaseLevel;
        }
        record(t);
      }

      if (contrib > 0) nContrib++;
      if (below) nBelow++;
      if (below2) nBelow2++;
      if (boughtAt >= 0) {
        nBought++;
        buyoutYears.push(boughtAt);
      } else {
        totRemaining += Math.max(A - L, 0);
      }
      totContrib += contrib;
      totEmployer += employer;
      totMember += member;
    }

    const percentiles = percentilesOf(funding, n, W);
    const percentiles2 = basis2 ? percentilesOf(funding2, n, W) : null;
    buyoutYears.sort((a, b) => a - b);

    return {
      strategy,
      percentiles,
      percentiles2,
      medianFundingEnd: percentiles.p50[H] / 100,
      medianFundingEnd2: basis2 ? percentiles2.p50[H] / 100 : null,
      probContrib: nContrib / n,
      expContrib: totContrib / n,
      probBelow100: nBelow / n,
      probBelow100_2: basis2 ? nBelow2 / n : null,
      expEmployer: totEmployer / n,
      expMember: totMember / n,
      expRemaining: totRemaining / n,
      probBuyout: nBought / n,
      medianBuyoutYear: buyoutYears.length ? quantile(buyoutYears, 0.5) : null
    };
  }

  function run(p, stressKeys) {
    let start = { A: p.assets, L: p.liabilities, y: p.giltYield };
    STRESSES.forEach((st) => {
      if (stressKeys.includes(st.key)) start = st.apply(start, p);
    });
    const shocks = generateShocks(p);
    return {
      start,
      results: STRATEGIES.map((k) => simulate(p, k, start, shocks))
    };
  }

  global.HeadroomModel = { MODEL_VERSION, DEFAULTS, STRATEGIES, STRESSES, run, growthPortfolio, yieldAtTerm };
})(window);
