"""
Agent 2: Advisor Agent

Job: take Agent 1's STRUCTURED FINDINGS (facts only) and reason over
them to produce a short, plain-English summary + 1-2 actionable
suggestions. No tools needed here — pure reasoning over given data.
This is the "sequential handoff": Agent 1 output -> Agent 2 input.
"""
import json
from llm_client import chat

ADVISOR_SYSTEM_PROMPT = """You are the Advisor Agent in a portfolio analysis pipeline.
You receive FACTUAL findings (returns and allocation data) from an Analyst
Agent. Your job is to:
1. Summarize the portfolio's health in plain English (2-4 sentences).
2. Give exactly 1-2 concrete, actionable suggestions based on the data
   (e.g., rebalancing due to concentration risk, or noting strong/weak
   performers).
Be specific and reference actual numbers from the findings. Do not
invent data that isn't in the findings. Keep the tone helpful and
non-alarmist — this is general educational information, not personalized
financial advice, and you should say so briefly at the end."""


def run_advisor(structured_findings: dict) -> str:
    """
    structured_findings: the dict produced by analyst_agent.run_analyst()
    ["structured_findings"] — contains "returns" and "allocation" keys.
    """
    user_prompt = (
        "Here are the structured findings from the Analyst Agent:\n\n"
        f"{json.dumps(structured_findings, indent=2, default=str)}\n\n"
        "Produce the plain-English summary and 1-2 actionable suggestions."
    )
    return chat(ADVISOR_SYSTEM_PROMPT, user_prompt)


if __name__ == "__main__":
    # Quick standalone test using the analyst's real output
    from analyst_agent import run_analyst
    findings = run_analyst("../sample_data/sample_portfolio.csv")
    advice = run_advisor(findings["structured_findings"])
    print(advice)
