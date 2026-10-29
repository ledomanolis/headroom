/*
 * Headroom model: a simplified stochastic projection of a UK defined benefit scheme.
 * Illustrative only. Not an actuarial model and not advice.
 *
 * Each year, per scenario:
 *   - liabilities (on the main funding basis) accrue at gilts + margin, pay benefits, and are
 *     revalued for the change in gilt yields (duration), the change in market implied
 *     inflation (on the inflation-linked share) and a random longevity shock
 *   - matching assets (gilts / LDI) earn the gilt yield; growth assets earn gilts + premium + noise, where
 *     the premium and volatility come from the asset class mix and correlations
 *   - the interest rate and inflation hedges offset the chosen share of each liability sensitivity
 *   - at each valuation (today, then every few years), a deficit on the chosen funding basis leads
 *     to a recovery plan: a level annual contribution, fixed until the next valuation, that
 *     clears the deficit over the recovery period at the discount rate, adjusted for any assumed
 *     asset return above gilts (relative to the discount rate). An optional trigger level sets a plan only
 *     when funding is below it.
 * An optional second funding basis values the same benefits at a different margin over gilts,
 * using the liability duration: L2 = L * exp(-duration * (margin2 - margin)).
 * All three options use the same random scenarios so the comparison is like for like.
 */
(function (global) {
  'use strict';

  const MODEL_VERSION = '0.5.0';
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
    yieldVol: 0.007,
    inflationVol: 0.004,
    longevitySensitivity: null, // liability increase per extra year of life expectancy; entered by the user
    longevityVol: null,         // blank means no longevity uncertainty
    buyoutPremium: 0.08,
    buyoutGrowthPct: null, // growth assets while waiting to buy out; blank means today's allocation
    buyoutYear: null, // employer pays any shortfall to buy out in this year; blank means wait until affordable
    releaseThreshold: 1.10,
    memberShare: 0.30,
    employerTax: 0.25,
    rpOn: true,             // employer pays deficit contributions under recovery plans
    valuationYears: 3,
    rpBasis: 1,             // funding basis the recovery plan uses (2 = second basis, if added)
    recoveryYears: 7,
    rpOutperformance: null, // entered by the user; blank means no allowance
    rpTrigger: null,        // entered by the user; blank means any deficit sets a plan
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
      needs: 'longevitySensitivity',
      apply: (s, p) => ({ A: s.A, L: s.L * (1 + (p.longevitySensitivity || 0)), y: s.y }) },
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

  // Share of scenarios below 100% funded at each year end (index 0 = today).
  function shareBelow100(values, n, W) {
    const out = [];
    for (let t = 0; t < W; t++) {
      let count = 0;
      for (let s = 0; s < n; s++) if (values[s * W + t] < 1) count++;
      out.push(count / n);
    }
    return out;
  }

  function simulate(p, strategy, start, shocks) {
    const n = p.numSims;
    const H = p.horizon;
    const W = H + 1;
    const growthPct = strategy === 'buyout' && p.buyoutGrowthPct !== null ? p.buyoutGrowthPct : p.growthPct;
    const buyoutLevel = 1 + p.buyoutPremium;

    // Second basis liabilities as a multiple of main basis liabilities, at duration D.
    const basis2 = p.basis2On;
    const spread = basis2 ? p.basis2Margin - p.discountMargin : 0;
    const basis2Factor = (D) => Math.exp(-D * spread);
    const releaseFactor = (D) => (basis2 && p.releaseBasis === 2 ? basis2Factor(D) : 1);
    const rpOnBasis2 = basis2 && p.rpBasis === 2;
    const rpFactor = (D) => (rpOnBasis2 ? basis2Factor(D) : 1);
    const rpMargin = rpOnBasis2 ? p.basis2Margin : p.discountMargin;
    const trigger = p.rpTrigger === null ? 1 : Math.min(p.rpTrigger, 1);
    // Outperformance is entered above gilts; the plan allows for the part above the discount rate
    // (negative if below it, which raises contributions). Blank means assets earn the discount rate.
    const outperformance = p.rpOutperformance === null ? 0 : p.rpOutperformance - rpMargin;

    const funding = new Float64Array(n * W);
    const funding2 = basis2 ? new Float64Array(n * W) : null;

    // Running totals by year (index t = position at the end of year t; 0 = today).
    const anyContribBy = new Float64Array(W);
    const contribBy = new Float64Array(W);
    const employerBy = new Float64Array(W);
    const memberBy = new Float64Array(W);
    const remainingAt = new Float64Array(W);
    const boughtBy = new Float64Array(W);
    const boughtIn = new Float64Array(W); // number bought out in exactly year t

    for (let s = 0; s < n; s++) {
      let A = start.A, L = start.L, y = start.y, D = p.duration, inflationDrift = 0;
      let contrib = 0, employer = 0, member = 0, boughtAt = -1;
      let frozen2 = 0; // funding on the second basis once bought out
      let planContribution = 0, planYearsLeft = 0; // current recovery plan

      const payOut = (amount) => {
        employer += amount * (1 - p.memberShare) * (1 - p.employerTax);
        member += amount * p.memberShare;
      };
      const record = (t) => {
        funding[s * W + t] = boughtAt >= 0 ? buyoutLevel : A / L;
        if (basis2) funding2[s * W + t] = boughtAt >= 0 ? frozen2 : A / (L * basis2Factor(D));
        if (contrib > 0) anyContribBy[t]++;
        contribBy[t] += contrib;
        employerBy[t] += employer;
        memberBy[t] += member;
        if (boughtAt >= 0) boughtBy[t]++;
        else remainingAt[t] += Math.max(A - L, 0);
      };
      const buyOut = (t) => {
        payOut(A - L * buyoutLevel);
        boughtAt = t;
        boughtIn[t]++;
        frozen2 = buyoutLevel / basis2Factor(D);
      };

      if (strategy === 'buyout' && A >= L * buyoutLevel) buyOut(0);
      record(0);

      for (let t = 1; t <= H; t++) {
        if (boughtAt >= 0) { record(t); continue; }

        // Valuation at the start of the year: set a new recovery plan or end the current one.
        if (p.rpOn && (t - 1) % p.valuationYears === 0) {
          planYearsLeft = 0;
          const Lrp = L * rpFactor(D);
          if (A < Lrp * trigger) {
            const d = y + rpMargin;
            const R = p.recoveryYears;
            const annuity = Math.abs(d) > 1e-9 ? (1 - Math.pow(1 + d, -R)) / d : R;
            planContribution = Math.max(0, (Lrp - A) / annuity - outperformance * A);
            planYearsLeft = R;
          }
        }
        if (planYearsLeft > 0) {
          A += planContribution;
          contrib += planContribution;
          planYearsLeft--;
        }

        const k = s * H + t - 1;
        const dY = MEAN_REVERSION * (p.giltYield - y) + p.yieldVol * shocks.zY[k];
        const rateFactor = Math.exp(-D * dY);
        const dPi = -MEAN_REVERSION * inflationDrift + p.inflationVol * shocks.zI[k];
        const inflationFactor = Math.exp(p.inflationLinkedPct * D * dPi);
        const growth = A * growthPct;
        const outgo = L * p.outgoPct;
        const growthReturn = y + p.growthPremium + p.growthVol * shocks.zG[k];
        const matchingReturn = y;                  // matching assets (gilts / LDI) earn the gilt yield
        const discountRate = y + p.discountMargin; // liabilities unwind at the discount rate

        A = growth * (1 + growthReturn) + (A - growth) * (1 + matchingReturn)
          + p.hedgeRatio * L * (rateFactor - 1)
          + p.inflationHedgeRatio * L * (inflationFactor - 1) - outgo;
        L = (L * (1 + discountRate) - outgo) * rateFactor * inflationFactor
          * (1 + (p.longevityVol || 0) * shocks.zL[k]);
        A = Math.max(A, 0);
        y += dY;
        inflationDrift += dPi;
        D = Math.max(D - DURATION_RUNOFF, MIN_DURATION);


        const releaseLevel = L * releaseFactor(D) * p.releaseThreshold;
        if (strategy === 'buyout') {
          // By the chosen year, the employer pays whatever is still needed to meet the insurer's price.
          if (p.buyoutYear !== null && t >= p.buyoutYear && A < L * buyoutLevel) {
            contrib += L * buyoutLevel - A;
            A = L * buyoutLevel;
          }
          if (A >= L * buyoutLevel) buyOut(t);
        } else if (strategy === 'release' && A > releaseLevel) {
          payOut(A - releaseLevel);
          A = releaseLevel;
        }
        record(t);
      }
    }

    const percentiles = percentilesOf(funding, n, W);
    const percentiles2 = basis2 ? percentilesOf(funding2, n, W) : null;
    const mean = (arr) => Array.from(arr, (v) => v / n);

    // Median year of buyout among scenarios bought out by year t.
    const medianBuyoutYearBy = [];
    for (let t = 0; t < W; t++) {
      let target = boughtBy[t] / 2, cum = 0, year = null;
      for (let u = 0; u <= t && boughtBy[t] > 0; u++) {
        cum += boughtIn[u];
        if (cum >= target) { year = u; break; }
      }
      medianBuyoutYearBy.push(year);
    }

    // Every metric is an array by year, so results can be read at any year up to the horizon.
    return {
      strategy,
      percentiles,
      percentiles2,
      medianFunding: percentiles.p50.map((v) => v / 100),
      medianFunding2: basis2 ? percentiles2.p50.map((v) => v / 100) : null,
      probBelow: shareBelow100(funding, n, W),
      probBelow2: basis2 ? shareBelow100(funding2, n, W) : null,
      probContrib: mean(anyContribBy),
      expContrib: mean(contribBy),
      expEmployer: mean(employerBy),
      expMember: mean(memberBy),
      expRemaining: mean(remainingAt),
      probBuyout: mean(boughtBy),
      medianBuyoutYear: medianBuyoutYearBy
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
