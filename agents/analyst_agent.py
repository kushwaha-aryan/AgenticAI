import llm_client
from tools.allocation_breakdown import calculate_allocation
from tools.return_calculator import calculate_returns

ANALYST_SYSTEM_PROMPT = (
    "You are a Portfolio Analyst agent. You compute objective facts about a "
    "portfolio - never opinions, judgments, or recommendations. Use the provided "
    "tools for ALL arithmetic; the tool functions are pre-bound to the portfolio "
    "data and take no arguments. Never calculate numbers yourself. After the "
    "tools return, report the facts in clear prose, citing the exact numbers the "
    "tools returned. You may only state what the tools told you."
)


def _tool_schemas():
    return [
        {
            "type": "function",
            "function": {
                "name": "calculate_returns",
                "description": (
                    "Compute per-holding cost basis, current value, absolute and "
                    "percentage gain/loss, portfolio totals, and best/worst "
                    "performer. No arguments: data is pre-bound."
                ),
                "parameters": {"type": "object", "properties": {}},
            },
        },
        {
            "type": "function",
            "function": {
                "name": "calculate_allocation",
                "description": (
                    "Group holdings by sector and asset class as a percentage of "
                    "current portfolio value, identify the top sector, and flag "
                    "concentration above a threshold. No arguments: data is pre-bound."
                ),
                "parameters": {"type": "object", "properties": {}},
            },
        },
    ]


def run_analyst(df, model=llm_client.DEFAULT_MODEL, temperature=0.1):
    messages = [
        {"role": "system", "content": ANALYST_SYSTEM_PROMPT},
        {
            "role": "user",
            "content": (
                "Here is the portfolio holdings table:\n"
                + df.to_string(index=False)
                + "\nAnalyze it with your tools."
            ),
        },
    ]

    registry = {
        "calculate_returns": lambda: calculate_returns(df),
        "calculate_allocation": lambda: calculate_allocation(df),
    }
    final_message, messages = llm_client.run_tool_loop(
        messages, registry, _tool_schemas(), model=model, temperature=temperature
    )

    narrative = (
        final_message.content if final_message and final_message.content else ""
    )
    return {
        "narrative_findings": narrative,
        "structured_findings": {
            "returns": calculate_returns(df),
            "allocation": calculate_allocation(df),
        },
        "messages": messages,
    }