const ANALYST_SYSTEM_PROMPT =
  "You are a Portfolio Analyst agent. You compute objective facts about a " +
  "portfolio - never opinions, judgments, or recommendations. Use the provided " +
  "tools for ALL arithmetic; the tool functions are pre-bound to the portfolio " +
  "data and take no arguments. Never calculate numbers yourself. After the " +
  "tools return, report the facts in clear prose, citing the exact numbers the " +
  "tools returned. You may only state what the tools told you.";

const RISK_SYSTEM_PROMPT =
  "You are a Risk Assessment agent. You sit between an Analyst and an Advisor. " +
  "You report RISK FACTS ONLY - no advice, no recommendations, no action items. " +
  "Use the provided tool for capital-gains tax estimation; the tool is pre-bound " +
  "to the data and takes no arguments. Additional facts (HHI concentration, " +
  "return dispersion, tax drag) are provided to you as verified machine output - " +
  "quote them exactly. Interpret what these facts mean numerically, but do not " +
  "suggest what the investor should do.";

const ADVISOR_SYSTEM_PROMPT =
  "You are a Portfolio Advisor agent. You give reasoned, plain-English guidance " +
  "to a retail investor. Ground every observation in the ACTUAL numbers from the " +
  "Analyst findings and Risk Agent report - quote specific percentages and rupee " +
  "figures, never generic filler. Offer 1-2 concrete, proportionate suggestions. " +
  "You are NOT a licensed financial advisor: end with a brief disclaimer that " +
  "this is not personalized financial advice.";

function toolSchema(name, description) {
  return {
    type: "function",
    function: {
      name,
      description,
      parameters: { type: "object", properties: {} },
    },
  };
}

function analystSchemas() {
  return [
    toolSchema(
      "calculate_returns",
      "Compute per-holding cost basis, current value, absolute and percentage " +
        "gain/loss, portfolio totals, and best/worst performer. No arguments: data is pre-bound."
    ),
    toolSchema(
      "calculate_allocation",
      "Group holdings by sector and asset class as a percentage of current " +
        "portfolio value, identify the top sector, and flag concentration above a " +
        "threshold. No arguments: data is pre-bound."
    ),
  ];
}

function riskSchemas() {
  return [
    toolSchema(
      "estimate_tax_impact",
      "Estimate illustrative LTCG/STCG capital-gains tax if the whole portfolio " +
        "were sold today, per holding and total, with blended effective rate. " +
        "No arguments: data is pre-bound."
    ),
  ];
}

async function runAnalyst(rows, apiKey) {
  const messages = [
    { role: "system", content: ANALYST_SYSTEM_PROMPT },
    {
      role: "user",
      content:
        "Here is the portfolio holdings table:\n" +
        JSON.stringify(rows, null, 2) +
        "\nAnalyze it with your tools.",
    },
  ];
  const registry = {
    calculate_returns: () => computeReturns(rows),
    calculate_allocation: () => computeAllocation(rows),
  };
  const { message, messages: finalMessages } = await runToolLoop(
    messages,
    registry,
    analystSchemas(),
    { apiKey, temperature: 0.1 }
  );
  return {
    narrative_findings: (message && message.content) || "",
    structured_findings: {
      returns: computeReturns(rows),
      allocation: computeAllocation(rows),
    },
    messages: finalMessages,
  };
}

async function runRisk(rows, structuredFindings, apiKey) {
  const allocation = structuredFindings.allocation;
  const tax = estimateTax(rows);
  const facts = computeRiskFacts(
    structuredFindings.returns,
    allocation,
    tax
  );

  const factsBrief = {
    hhi: facts.hhi,
    hhi_level: facts.hhi_level,
    top_sector: facts.top_sector,
    top_sector_pct: facts.top_sector_pct,
    concentration_flag: facts.concentration_flag,
    best_performer: facts.best_performer,
    worst_performer: facts.worst_performer,
    return_dispersion_pct: facts.return_dispersion_pct,
    tax_drag_pct: facts.tax_drag_pct,
  };

  const messages = [
    { role: "system", content: RISK_SYSTEM_PROMPT },
    {
      role: "user",
      content:
        "Portfolio risk facts (verified machine output) follow. Call the tax " +
        "estimator tool yourself, then summarize all of these facts as a risk " +
        "report.\nFact sheet:\n" +
        JSON.stringify(factsBrief, null, 2),
    },
  ];
  const registry = { estimate_tax_impact: () => estimateTax(rows) };
  const { message, messages: finalMessages } = await runToolLoop(
    messages,
    registry,
    riskSchemas(),
    { apiKey, temperature: 0.2 }
  );
  const narrative =
    (message && message.content) || "Risk tool outputs captured; no narrative produced.";
  return { risk_report: narrative, risk_facts: facts, messages: finalMessages };
}

function advisorContext(structuredFindings, riskFacts) {
  return {
    analyst_findings: structuredFindings,
    risk_facts: {
      hhi: riskFacts.hhi,
      hhi_level: riskFacts.hhi_level,
      top_sector: riskFacts.top_sector,
      top_sector_pct: riskFacts.top_sector_pct,
      concentration_flag: riskFacts.concentration_flag,
      return_dispersion_pct: riskFacts.return_dispersion_pct,
      best_performer: riskFacts.best_performer,
      worst_performer: riskFacts.worst_performer,
      total_estimated_tax: riskFacts.tax.total_estimated_tax,
      blended_effective_rate_pct: riskFacts.tax.blended_effective_rate_pct,
      tax_drag_pct: riskFacts.tax_drag_pct,
    },
  };
}

async function runAdvisor(structuredFindings, riskFacts, apiKey) {
  const messages = [
    { role: "system", content: ADVISOR_SYSTEM_PROMPT },
    {
      role: "user",
      content:
        "Give portfolio advice based on these verified findings:\n" +
        JSON.stringify(advisorContext(structuredFindings, riskFacts), null, 2),
    },
  ];
  const message = await groqChat(messages, { apiKey, temperature: 0.3 });
  const advice = message.content || "";
  messages.push({ role: "assistant", content: advice });
  return { advice, messages };
}