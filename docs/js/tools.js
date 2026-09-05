const LTCG_MONTHS = 12;
const STCG_RATE = 0.20;
const LTCG_RATE = 0.10;
const CONCENTRATION_THRESHOLD_PCT = 40;

const TAX_DISCLAIMER =
  "Illustrative estimate only, not tax advice. Assumes a simplified flat-rate " +
  "LTCG/STCG treatment: 10% for holdings held 12 months or longer, 20% otherwise. " +
  "Real LTCG/STCG rules vary by asset class, and exemptions or set-offs are ignored.";

function round2(x) {
  return Math.round((x + Number.EPSILON) * 100) / 100;
}

function computeReturns(rows) {
  const holdings = rows.map((r) => {
    const costBasis = r.quantity * r.buy_price;
    const currentValue = r.quantity * r.current_price;
    const gainLoss = currentValue - costBasis;
    const gainLossPct = costBasis ? (gainLoss / costBasis) * 100 : 0;
    return {
      ticker: r.ticker,
      name: r.name,
      sector: r.sector,
      asset_class: r.asset_class,
      quantity: r.quantity,
      cost_basis: round2(costBasis),
      current_value: round2(currentValue),
      gain_loss: round2(gainLoss),
      gain_loss_pct: round2(gainLossPct),
    };
  });

  const totalCostBasis = round2(holdings.reduce((s, h) => s + h.cost_basis, 0));
  const totalCurrentValue = round2(holdings.reduce((s, h) => s + h.current_value, 0));
  const totalGainLoss = round2(holdings.reduce((s, h) => s + h.gain_loss, 0));
  const totalGainLossPct = totalCostBasis
    ? round2((totalGainLoss / totalCostBasis) * 100)
    : 0;

  const best = holdings.reduce((a, b) => (b.gain_loss_pct > a.gain_loss_pct ? b : a));
  const worst = holdings.reduce((a, b) => (b.gain_loss_pct < a.gain_loss_pct ? b : a));

  return {
    holdings,
    portfolio: {
      total_cost_basis: totalCostBasis,
      total_current_value: totalCurrentValue,
      total_gain_loss: totalGainLoss,
      total_gain_loss_pct: totalGainLossPct,
    },
    best_performer: { ticker: best.ticker, gain_loss_pct: best.gain_loss_pct },
    worst_performer: { ticker: worst.ticker, gain_loss_pct: worst.gain_loss_pct },
  };
}

function computeAllocation(rows) {
  const total = rows.reduce((s, r) => s + r.quantity * r.current_price, 0);
  const sectorValue = {};
  const classValue = {};
  for (const r of rows) {
    const v = r.quantity * r.current_price;
    sectorValue[r.sector] = (sectorValue[r.sector] || 0) + v;
    classValue[r.asset_class] = (classValue[r.asset_class] || 0) + v;
  }

  const toSortedPctMap = (obj) => {
    const map = {};
    Object.entries(obj)
      .map(([k, v]) => [k, round2((v / total) * 100)])
      .sort((a, b) => b[1] - a[1])
      .forEach(([k, v]) => { map[k] = v; });
    return map;
  };

  const sectorAllocation = toSortedPctMap(sectorValue);
  const assetClassAllocation = toSortedPctMap(classValue);
  const topSector = Object.keys(sectorAllocation)[0];
  const topSectorPct = sectorAllocation[topSector];
  const concentrationFlag = topSectorPct > CONCENTRATION_THRESHOLD_PCT;

  return {
    sector_allocation: sectorAllocation,
    asset_class_allocation: assetClassAllocation,
    top_sector: topSector,
    top_sector_pct: topSectorPct,
    concentration_flag: concentrationFlag,
    concentration_threshold_pct: CONCENTRATION_THRESHOLD_PCT,
    total_current_value: round2(total),
  };
}

function estimateTax(rows) {
  const holdings = rows.map((r) => {
    const gain = r.quantity * r.current_price - r.quantity * r.buy_price;
    const months = Math.round(r.holding_months);
    let category;
    let ratePct;
    let tax;
    if (gain <= 0) {
      category = "no_gain";
      ratePct = 0;
      tax = 0;
    } else if (months >= LTCG_MONTHS) {
      category = "LTCG";
      ratePct = LTCG_RATE * 100;
      tax = gain * LTCG_RATE;
    } else {
      category = "STCG";
      ratePct = STCG_RATE * 100;
      tax = gain * STCG_RATE;
    }
    return {
      ticker: r.ticker,
      name: r.name,
      category,
      holding_months: months,
      gain: round2(gain),
      rate_pct: ratePct,
      tax: round2(tax),
    };
  });

  const totalTaxableGains = round2(
    holdings.reduce((s, r) => s + (r.gain > 0 ? r.gain : 0), 0)
  );
  const totalEstimatedTax = round2(holdings.reduce((s, r) => s + r.tax, 0));
  const blendedEffectiveRatePct = totalTaxableGains
    ? round2((totalEstimatedTax / totalTaxableGains) * 100)
    : 0;

  return {
    holdings,
    total_taxable_gains: totalTaxableGains,
    total_estimated_tax: totalEstimatedTax,
    blended_effective_rate_pct: blendedEffectiveRatePct,
    assumptions: {
      ltcg_months: LTCG_MONTHS,
      ltcg_rate_pct: LTCG_RATE * 100,
      stcg_rate_pct: STCG_RATE * 100,
      losses_offset_against_gains: false,
    },
    disclaimer: TAX_DISCLAIMER,
  };
}

const HHI_HIGH = 2500;
const HHI_MODERATE = 1500;

function computeRiskFacts(returns, allocation, tax) {
  const hhi = round2(
    Object.values(allocation.sector_allocation).reduce((s, v) => s + v * v, 0)
  );
  const hhiLevel =
    hhi >= HHI_HIGH
      ? "highly concentrated"
      : hhi >= HHI_MODERATE
        ? "moderately concentrated"
        : "well diversified";
  const dispersionPct = round2(
    returns.best_performer.gain_loss_pct - returns.worst_performer.gain_loss_pct
  );
  const taxDragPct = round2(
    allocation.total_current_value
      ? (tax.total_estimated_tax / allocation.total_current_value) * 100
      : 0
  );
  return {
    hhi,
    hhi_level: hhiLevel,
    sector_allocation: allocation.sector_allocation,
    top_sector: allocation.top_sector,
    top_sector_pct: allocation.top_sector_pct,
    concentration_flag: allocation.concentration_flag,
    best_performer: returns.best_performer,
    worst_performer: returns.worst_performer,
    return_dispersion_pct: dispersionPct,
    tax,
    tax_drag_pct: taxDragPct,
  };
}