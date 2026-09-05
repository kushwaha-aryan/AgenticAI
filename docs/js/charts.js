const CHART_PALETTE = ["#2dd4bf", "#4f8ef7", "#f8b84b", "#f06b6b", "#41b883", "#e6ebf5", "#94a3b8"];

function escHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function fmtRupee(x) {
  return "₹" + Number(x).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fmtPctIn(x, d) {
  return Number(x).toLocaleString("en-IN", {
    minimumFractionDigits: d === undefined ? 2 : d,
    maximumFractionDigits: d === undefined ? 2 : d,
  }) + "%";
}

function chipsHTML(portfolio, riskFacts) {
  const gainPct = portfolio.total_gain_loss_pct;
  const hhiOk = riskFacts.hhi_level === "well diversified";
  const hhiClass = riskFacts.hhi >= 2500 ? "warn" : riskFacts.hhi >= 1500 ? "mild" : "ok";
  return (
    '<div class="chips">' +
    chip("Value", fmtRupee(portfolio.total_current_value)) +
    chip(
      "Net gain",
      (gainPct >= 0 ? "+" : "") + fmtRupee(portfolio.total_gain_loss) +
        " (" + (gainPct >= 0 ? "+" : "") + fmtPctIn(gainPct) + ")",
      gainPct >= 0 ? "pos" : "neg"
    ) +
    chip("Est. tax", fmtRupee(riskFacts.tax.total_estimated_tax)) +
    chip(
      "HHI",
      Number(riskFacts.hhi).toLocaleString("en-IN", { maximumFractionDigits: 0 }) + " · " + escHtml(riskFacts.hhi_level),
      hhiOk ? "ok" : hhiClass
    ) +
    "</div>"
  );
}

function chip(label, value, tone) {
  return (
    '<div class="chip"><span class="chip-label">' + label + "</span>" +
    '<span class="chip-value' + (tone ? " " + tone : "") + '">' + value + "</span></div>"
  );
}

function assetDonutHTML(allocation, size) {
  const entries = Object.entries(allocation.asset_class_allocation);
  const r = size / 2 - 12;
  const C = 2 * Math.PI * r;
  let acc = 0;
  const segs = entries.map((entry, idx) => {
    const frac = Math.max(0, Math.min(1, entry[1] / 100));
    const len = frac * C;
    const circle =
      '<circle r="' + r + '" fill="transparent" stroke="' + CHART_PALETTE[idx % CHART_PALETTE.length] +
      '" stroke-width="' + Math.round(size / 8) + '" stroke-dasharray="' + len + " " + (C - len) +
      '" stroke-dashoffset="' + -acc + '"></circle>';
    acc += len;
    return circle;
  });
  const legend = entries
    .map((entry, idx) => {
      return (
        '<span class="legend-item"><i style="background:' + CHART_PALETTE[idx % CHART_PALETTE.length] + '"></i>' +
        escHtml(entry[0]) + " " + fmtPctIn(entry[1], 1) + "</span>"
      );
    })
    .join("");
  const svg =
    '<svg class="donut" width="' + size + '" height="' + size + '" viewBox="0 0 ' + size + " " + size + '">' +
    '<g transform="rotate(-90 ' + size / 2 + " " + size / 2 + ')">' + segs.join("") + "</g>" +
    '<text class="donut-center" x="50%" y="48%" text-anchor="middle">' + fmtRupee(allocation.total_current_value) + "</text>" +
    '<text class="donut-sub" x="50%" y="60%" text-anchor="middle">current value</text></svg>';
  return (
    '<h4 class="vis-title">Asset classes</h4><div class="donut-wrap">' + svg +
    '<div class="legend">' + legend + "</div></div>"
  );
}

function sectorBarsHTML(allocation) {
  const entries = Object.entries(allocation.sector_allocation);
  const flag = allocation.concentration_flag;
  const topWarn = flag
    ? '<span class="vis-warn">' + fmtPctIn(allocation.top_sector_pct, 1) + " > " + allocation.concentration_threshold_pct + "% threshold</span>"
    : "";
  const rows = entries
    .map((entry) => {
      const isTop = entry[0] === allocation.top_sector;
      const fillClass =
        isTop && flag ? "fill warn" : isTop ? "fill accent" : "fill";
      return (
        '<div class="hbar"><div class="hbar-label"><span>' + escHtml(entry[0]) + '</span><span>' + fmtPctIn(entry[1], 1) + "</span></div>" +
        '<div class="hbar-track"><div class="' + fillClass + '" style="width:' + Math.min(100, entry[1]) + '%"></div></div></div>'
      );
    })
    .join("");
  return '<h4 class="vis-title">Sector exposure ' + topWarn + "</h4>" + rows;
}

function gainBarsHTML(holdings) {
  const maxAbs = Math.max.apply(null, holdings.map((h) => Math.abs(h.gain_loss_pct)).concat([1]));
  const rows = holdings
    .map((h) => {
      const p = h.gain_loss_pct;
      const isNeg = p < 0;
      const width = (Math.abs(p) / maxAbs) * 50;
      const bars = isNeg
        ? '<div class="dv-left"><div class="dv-fill neg" style="width:' + width + '%"></div></div><div class="dv-right"></div>'
        : '<div class="dv-left"></div><div class="dv-right"><div class="dv-fill pos" style="width:' + width + '%"></div></div>';
      return (
        '<div class="grow"><div class="grow-label"><span>' + escHtml(h.ticker) + " <em>" + escHtml(h.name) +
        '</em></span><span class="' + (isNeg ? "neg" : "pos") + '">' + (isNeg ? "" : "+") + fmtPctIn(p) + "</span></div>" +
        bars + "</div>"
      );
    })
    .join("");
  return '<h4 class="vis-title">Gain / loss vs cost</h4>' + rows;
}

function taxBarsHTML(taxHoldings) {
  const maxTax = Math.max.apply(null, taxHoldings.map((t) => t.tax).concat([1]));
  const rows = taxHoldings
    .map((t) => {
      const cls = t.category === "LTCG" ? "a2" : t.category === "STCG" ? "danger" : "muted";
      return (
        '<div class="hbar tax"><div class="hbar-label"><span>' + escHtml(t.ticker) + " <em>" + escHtml(t.name) +
        '</em></span><span>' + fmtRupee(t.tax) + " · " + fmtPctIn(t.rate_pct, 0) + (t.category === "no_gain" ? " · no gain" : "") + "</span></div>" +
        '<div class="hbar-track"><div class="fill ' + cls + '" style="width:' + (t.tax / maxTax) * 100 + '%"></div></div></div>'
      );
    })
    .join("");
  return '<h4 class="vis-title">Estimated tax by holding</h4>' + rows;
}

function meter(label, value, max, ticks, tone, display) {
  const pos = Math.min(100, (value / max) * 100);
  const ticksHtml = ticks
    .map((t) => {
      return '<span class="meter-tick" style="left:' + (t / max) * 100 + '%"><b>' + t + "</b></span>";
    })
    .join("");
  return (
    '<div class="meter"><div class="meter-head"><span>' + label + '</span><span class="' + tone + '">' + display + "</span></div>" +
    '<div class="meter-track"><div class="meter-fill ' + tone + '" style="width:' + pos + '%"></div></div>' +
    '<div class="meter-scale">' + ticksHtml + "</div></div>"
  );
}

function riskMetersHTML(r) {
  const hhiTone = r.hhi >= 2500 ? "warn" : r.hhi >= 1500 ? "mild" : "ok";
  const dispTone = r.return_dispersion_pct > 50 ? "warn" : r.return_dispersion_pct > 25 ? "mild" : "ok";
  const dragTone = r.tax_drag_pct > 5 ? "warn" : r.tax_drag_pct > 2 ? "mild" : "ok";
  return (
    '<h4 class="vis-title">Risk meters</h4>' +
    meter(
      "Concentration (HHI)",
      r.hhi,
      3500,
      [1500, 2500],
      hhiTone,
      Number(r.hhi).toLocaleString("en-IN", { maximumFractionDigits: 0 }) + " · " + escHtml(r.hhi_level)
    ) +
    meter("Return dispersion", r.return_dispersion_pct, 100, [25, 50], dispTone, fmtPctIn(r.return_dispersion_pct)) +
    meter("Tax drag", r.tax_drag_pct, 10, [2, 5], dragTone, fmtPctIn(r.tax_drag_pct))
  );
}

function renderVisuals(el, structured, riskFacts) {
  el.innerHTML =
    chipsHTML(structured.returns.portfolio, riskFacts) +
    '<hr class="vis-sep">' +
    assetDonutHTML(structured.allocation) +
    '<hr class="vis-sep">' +
    riskMetersHTML(riskFacts) +
    '<hr class="vis-sep">' +
    sectorBarsHTML(structured.allocation) +
    '<hr class="vis-sep">' +
    gainBarsHTML(structured.returns.holdings) +
    '<hr class="vis-sep">' +
    taxBarsHTML(riskFacts.tax.holdings);
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    renderVisuals,
    chipsHTML,
    assetDonutHTML,
    sectorBarsHTML,
    gainBarsHTML,
    taxBarsHTML,
    riskMetersHTML,
  };
}