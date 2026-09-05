"""
Agent 1: Analyst Agent

Job: read portfolio data, CALL both tools (Return Calculator +
Allocation Breakdown), and output structured FACTS ONLY — no opinions,
no advice. That separation of concerns is what makes this a clean
two-agent handoff rather than one agent doing everything.
"""
import json
import pandas as pd

from tools.return_calculator import calculate_returns
from tools.allocation_breakdown import calculate_allocation
from llm_client import chat_with_tools

# --- Tool schemas the LLM sees (function-calling format) ---
TOOL_SCHEMAS = [
    {
        "type": "function",
        "function": {
            "name": "calculate_returns",
            "description": "Calculates current value and gain/loss for each holding and for the overall portfolio.",
            "parameters": {"type": "object", "properties": {}, "required": []},
        },
    },
    {
        "type": "function",
        "function": {
            "name": "calculate_allocation",
            "description": "Calculates percentage concentration of the portfolio by sector and by asset class, and flags concentration risk.",
            "parameters": {"type": "object", "properties": {}, "required": []},
        },
    },
]

ANALYST_SYSTEM_PROMPT = """You are the Analyst Agent in a portfolio analysis pipeline.
Your ONLY job is to call the available tools and report FACTS.
Do NOT give any advice, opinions, or recommendations — that is a different
agent's job. Just report what the numbers say: returns, gains/losses,
and allocation percentages. Be precise and use the exact numbers the
tools return."""


def run_analyst(csv_path: str) -> dict:
    """
    Loads the CSV, runs both tools directly (deterministic — guarantees
    the numbers are always computed even if the LLM's tool-calling
    decision-making misfires), then asks the LLM to narrate the findings
    as a clean structured summary using those real numbers.
    """
    df = pd.read_csv(csv_path)

    # Bind the DataFrame so the LLM only needs to name the tool, not pass data
    tool_functions = {
        "calculate_returns": lambda: calculate_returns(df),
        "calculate_allocation": lambda: calculate_allocation(df),
    }

    user_prompt = (
        "Analyze the loaded portfolio. Call both calculate_returns and "
        "calculate_allocation, then summarize the findings as factual "
        "bullet points. No advice."
    )

    result = chat_with_tools(
        ANALYST_SYSTEM_PROMPT, user_prompt, TOOL_SCHEMAS, tool_functions
    )

    # Also keep the raw structured tool outputs — this is what actually
    # gets passed to Agent 2 (more reliable than parsing the LLM's prose)
    raw_returns = calculate_returns(df)
    raw_allocation = calculate_allocation(df)

    return {
        "narrative_findings": result["final_text"],
        "tool_calls_made": result["tool_calls_made"],
        "structured_findings": {
            "returns": raw_returns,
            "allocation": raw_allocation,
        },
    }


if __name__ == "__main__":
    findings = run_analyst("sample_data/sample_portfolio.csv")
    print(json.dumps(findings, indent=2, default=str))
