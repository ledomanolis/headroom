/*
 * Headroom model: a simplified stochastic projection of a UK defined benefit scheme.
 * Illustrative only. Not an actuarial model and not advice.
 *
 * Each year, per scenario:
 *   - liabilities (low dependency basis) accrue at gilts + margin, pay benefits, and are
 *     revalued for the change in gilt yields (duration) and a random longevity shock
 *   - matching assets earn gilts + margin; growth assets earn gilts + premium + noise
 *   - the interest rate hedge offsets the chosen share of the liability rate sensitivity
 *   - if funding is below 100%, the employer pays the shortfall over the recovery period
 * All three options use the same random scenarios so the comparison is like for like.
 */
(function (global) {
  'use strict';

  const MODEL_VERSION = '0.1.0';
  const MEAN_REVERSION = 0.1;   // pull of gilt yields back to their starting level each year
  const DURATION_RUNOFF = 0.3;  // liability duration shortens as the scheme matures
  const MIN_DURATION = 5;

  const DEFAULTS = {
    assets: 530,
    liabilities: 500,
    outgoPct: 0.05,
    duration: 14,
    growthPct: 0.30,
    hedgeRatio: 0.90,
    growthPremium: 0.035,
    growthVol: 0.15,
    giltYield: 0.045,
    ldMargin: 0.005,
    yieldVol: 0.007,
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

  // Instant shocks applied to the scheme today, before projecting forward.
  const STRESSES = [
    { key: 'giltDown', label: 'Gilt yields fall 1%', excludes: 'giltUp',
      apply: (s, p) => rateShock(s, p, -0.01) },
    { key: 'giltUp', label: 'Gilt yields rise 1.5%', excludes: 'giltDown',
      apply: (s, p) => rateShock(s, p, 0.015) },
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
    for (let i = 0; i < size; i++) {
      zG[i] = norm();
      zY[i] = norm();
      zL[i] = norm();
    }
    return { zG, zY, zL };
  }

  function quantile(sorted, q) {
    return sorted[Math.min(sorted.length - 1, Math.floor(q * (sorted.length - 1)))];
  }

  function simulate(p, strategy, start, shocks) {
    const n = p.numSims;
    const H = p.horizon;
    const W = H + 1;
    const funding = new Float64Array(n * W);
    const growthPct = strategy === 'buyout' ? p.buyoutGrowthPct : p.growthPct;
    const buyoutLevel = 1 + p.buyoutPremium;

    let nContrib = 0, nBelow = 0, nBought = 0;
    let totContrib = 0, totEmployer = 0, totMember = 0, totRemaining = 0;
    const buyoutYears = [];

    for (let s = 0; s < n; s++) {
      let A = start.A, L = start.L, y = start.y, D = p.duration;
      let contrib = 0, employer = 0, member = 0, below = A < L, boughtAt = -1;

      const payOut = (amount) => {
        employer += amount * (1 - p.memberShare) * (1 - p.employerTax);
        member += amount * p.memberShare;
      };

      if (strategy === 'buyout' && A >= L * buyoutLevel) {
        payOut(A - L * buyoutLevel);
        boughtAt = 0;
      }
      funding[s * W] = boughtAt >= 0 ? buyoutLevel : A / L;

      for (let t = 1; t <= H; t++) {
        if (boughtAt >= 0) { funding[s * W + t] = buyoutLevel; continue; }

        if (A < L) {
          const c = (L - A) / p.recoveryYears;
          A += c;
          contrib += c;
        }

        const k = s * H + t - 1;
        const dY = MEAN_REVERSION * (p.giltYield - y) + p.yieldVol * shocks.zY[k];
        const rateFactor = Math.exp(-D * dY);
        const growth = A * growthPct;
        const outgo = L * p.outgoPct;
        const growthReturn = y + p.growthPremium + p.growthVol * shocks.zG[k];
        const matchingReturn = y + p.ldMargin;

        A = growth * (1 + growthReturn) + (A - growth) * (1 + matchingReturn)
          + p.hedgeRatio * L * (rateFactor - 1) - outgo;
        L = (L * (1 + matchingReturn) - outgo) * rateFactor * (1 + p.longevityVol * shocks.zL[k]);
        A = Math.max(A, 0);
        y += dY;
        D = Math.max(D - DURATION_RUNOFF, MIN_DURATION);

        if (A < L) below = true;

        if (strategy === 'buyout' && A >= L * buyoutLevel) {
          payOut(A - L * buyoutLevel);
          boughtAt = t;
        } else if (strategy === 'release' && A > L * p.releaseThreshold) {
          payOut(A - L * p.releaseThreshold);
          A = L * p.releaseThreshold;
        }
        funding[s * W + t] = boughtAt >= 0 ? buyoutLevel : A / L;
      }

      if (contrib > 0) nContrib++;
      if (below) nBelow++;
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

    const percentiles = { p5: [], p25: [], p50: [], p75: [], p95: [] };
    const col = new Float64Array(n);
    for (let t = 0; t < W; t++) {
      for (let s = 0; s < n; s++) col[s] = funding[s * W + t];
      col.sort();
      percentiles.p5.push(quantile(col, 0.05) * 100);
      percentiles.p25.push(quantile(col, 0.25) * 100);
      percentiles.p50.push(quantile(col, 0.50) * 100);
      percentiles.p75.push(quantile(col, 0.75) * 100);
      percentiles.p95.push(quantile(col, 0.95) * 100);
    }

    buyoutYears.sort((a, b) => a - b);

    return {
      strategy,
      percentiles,
      medianFundingEnd: percentiles.p50[H] / 100,
      probContrib: nContrib / n,
      expContrib: totContrib / n,
      probBelow100: nBelow / n,
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

  global.HeadroomModel = { MODEL_VERSION, DEFAULTS, STRATEGIES, STRESSES, run };
})(window);
