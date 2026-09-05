import json

import llm_client
from tools.tax_estimator import estimate_tax_impact

HHI_HIGH = 2500.0
HHI_MODERATE = 1500.0

RISK_SYSTEM_PROMPT = (
    "You are a Risk Assessment agent. You sit between an Analyst and an Advisor. "
    "You report RISK FACTS ONLY - no advice, no recommendations, no action items. "
    "Use the provided tool for capital-gains tax estimation; the tool is pre-bound "
    "to the data and takes no arguments. Additional facts (HHI concentration, "
    "return dispersion, tax drag) are provided to you as verified machine output - "
    "quote them exactly. Interpret what these facts mean numerically, but do not "
    "suggest what the investor should do."
)


def _tool_schemas():
    return [
        {
            "type": "function",
            "function": {
                "name": "estimate_tax_impact",
                "description": (
                    "Estimate illustrative LTCG/STCG capital-gains tax if the whole "
                    "portfolio were sold today, per holding and total, with blended "
                    "effective rate. No arguments: data is pre-bound."
                ),
                "parameters": {"type": "object", "properties": {}},
            },
        },
    ]


def _compute_risk_facts(df, structured_findings):
    allocation = structured_findings["allocation"]
    sector_allocation = allocation["sector_allocation"]
    hhi = round(sum(pct * pct for pct in sector_allocation.values()), 2)
    if hhi >= HHI_HIGH:
        hhi_level = "highly concentrated"
    elif hhi >= HHI_MODERATE:
        hhi_level = "moderately concentrated"
    else:
        hhi_level = "well diversified"

    returns = structured_findings["returns"]
    best = returns["best_performer"]
    worst = returns["worst_performer"]
    dispersion_pct = round(best["gain_loss_pct"] - worst["gain_loss_pct"], 2)

    tax = estimate_tax_impact(df)
    tax_drag_pct = round(
        tax["total_estimated_tax"] / allocation["total_current_value"] * 100.0, 2
    )

    return {
        "hhi": hhi,
        "hhi_level": hhi_level,
        "sector_allocation": sector_allocation,
        "top_sector": allocation["top_sector"],
        "top_sector_pct": allocation["top_sector_pct"],
        "concentration_flag": allocation["concentration_flag"],
        "best_performer": best,
        "worst_performer": worst,
        "return_dispersion_pct": dispersion_pct,
        "tax": tax,
        "tax_drag_pct": tax_drag_pct,
    }


def _facts_brief(facts):
    return {
        "hhi": facts["hhi"],
        "hhi_level": facts["hhi_level"],
        "top_sector": facts["top_sector"],
        "top_sector_pct": facts["top_sector_pct"],
        "concentration_flag": facts["concentration_flag"],
        "best_performer": facts["best_performer"],
        "worst_performer": facts["worst_performer"],
        "return_dispersion_pct": facts["return_dispersion_pct"],
        "tax_drag_pct": facts["tax_drag_pct"],
    }


def run_risk(df, structured_findings, model=llm_client.DEFAULT_MODEL, temperature=0.2):
    facts = _compute_risk_facts(df, structured_findings)

    messages = [
        {"role": "system", "content": RISK_SYSTEM_PROMPT},
        {
            "role": "user",
            "content": (
                "Portfolio risk facts (verified machine output) follow. Call the "
                "tax estimator tool yourself, then summarize all of these facts as "
                "a risk report.\nFact sheet:\n"
                + json.dumps(_facts_brief(facts), indent=2, default=str)
            ),
        },
    ]
    registry = {"estimate_tax_impact": lambda: estimate_tax_impact(df)}
    final_message, messages = llm_client.run_tool_loop(
        messages, registry, _tool_schemas(), model=model, temperature=temperature
    )

    narrative = (
        final_message.content
        if final_message and final_message.content
        else "Risk tool outputs captured; no narrative produced."
    )
    return {
        "risk_report": narrative,
        "risk_facts": facts,
        "messages": messages,
    }