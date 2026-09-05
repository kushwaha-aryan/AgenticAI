import json

import llm_client

ADVISOR_SYSTEM_PROMPT = (
    "You are a Portfolio Advisor agent. You give reasoned, plain-English guidance "
    "to a retail investor. Ground every observation in the ACTUAL numbers from the "
    "Analyst findings and Risk Agent report - quote specific percentages and rupee "
    "figures, never generic filler. Offer 1-2 concrete, proportionate suggestions. "
    "You are NOT a licensed financial advisor: end with a brief disclaimer that "
    "this is not personalized financial advice. Use the investor's stated goal and "
    "time horizon only as framing context: for short horizons weigh volatility, "
    "concentration, downside exposure and capital preservation more heavily; for "
    "long horizons reasonable short-term volatility is more tolerable and "
    "immediate tax drag matters relatively less. Do not dictate fixed rules from "
    "the number of years alone."
)


def _context_payload(structured_findings, risk_facts, goal_context=None):
    payload = {
        "analyst_findings": structured_findings,
        "risk_facts": {
            "hhi": risk_facts["hhi"],
            "hhi_level": risk_facts["hhi_level"],
            "top_sector": risk_facts["top_sector"],
            "top_sector_pct": risk_facts["top_sector_pct"],
            "concentration_flag": risk_facts["concentration_flag"],
            "return_dispersion_pct": risk_facts["return_dispersion_pct"],
            "best_performer": risk_facts["best_performer"],
            "worst_performer": risk_facts["worst_performer"],
            "total_estimated_tax": risk_facts["tax"]["total_estimated_tax"],
            "blended_effective_rate_pct": risk_facts["tax"][
                "blended_effective_rate_pct"
            ],
            "tax_drag_pct": risk_facts["tax_drag_pct"],
        },
    }
    if goal_context:
        payload["investor_context"] = goal_context
    return payload


def run_advisor(
    structured_findings,
    risk_facts,
    model=llm_client.DEFAULT_MODEL,
    temperature=0.3,
    goal_context=None,
    hypothetical=False,
):
    payload = _context_payload(structured_findings, risk_facts, goal_context)
    content_lines = ["Give portfolio advice based on these verified findings:"]
    if hypothetical:
        content_lines.append(
            "IMPORTANT: This is a SIMULATED / WHAT-IF portfolio (a hypothetical "
            "rebalance scenario). Treat every number as hypothetical - it does NOT "
            "represent the user's actual portfolio or any real positions."
        )
    content_lines.append(json.dumps(payload, indent=2, default=str))
    messages = [
        {"role": "system", "content": ADVISOR_SYSTEM_PROMPT},
        {"role": "user", "content": "\n".join(content_lines)},
    ]
    final_message = llm_client.chat_completion(
        messages, model=model, temperature=temperature
    )
    advice = final_message.content or ""
    messages.append({"role": "assistant", "content": advice})
    return {"advice": advice, "messages": messages}


def run_qa_loop(messages, model=llm_client.DEFAULT_MODEL, temperature=0.3):
    conversation_history = list(messages)
    print("\n" + "-" * 72)
    print("Q&A MODE  (ask follow-ups; type 'exit' or 'quit' to leave)")
    print("-" * 72)
    while True:
        question = input("\nYou: ").strip()
        if not question:
            continue
        if question.lower() in {"exit", "quit", "q"}:
            break
        conversation_history.append({"role": "user", "content": question})
        answer = llm_client.chat_multiturn(
            conversation_history, model=model, temperature=temperature
        )
        response_text = answer.content or ""
        conversation_history.append({"role": "assistant", "content": response_text})
        print(f"\nAdvisor: {response_text}")
    return conversation_history