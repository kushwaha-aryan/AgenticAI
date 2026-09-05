import argparse
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

for _stream in (sys.stdout, sys.stderr):
    if hasattr(_stream, "reconfigure"):
        _stream.reconfigure(encoding="utf-8")

import pandas as pd

import llm_client
from agents.advisor_agent import run_advisor, run_qa_loop
from agents.analyst_agent import run_analyst
from agents.risk_agent import _compute_risk_facts, run_risk
from csv_normalizer import llm_resolve_mapping, normalize_text
from tools.allocation_breakdown import calculate_allocation
from tools.chart_view import (
    show_allocation_pie,
    show_gainloss_bar,
    show_rebalance_comparison,
)
from tools.rebalance_simulator import simulate_rebalance
from tools.return_calculator import calculate_returns

DEFAULT_CSV = "sample_data/holdings.csv"


def _print_section(title):
    print("\n" + "=" * 72)
    print(title)
    print("=" * 72)


def _print_verified_analyst(structured):
    returns = structured["returns"]["portfolio"]
    allocation = structured["allocation"]
    flag = "YES" if allocation["concentration_flag"] else "no"
    print(
        f"[verified by Python] value Rs.{returns['total_current_value']:,.2f} | "
        f"cost Rs.{returns['total_cost_basis']:,.2f} | "
        f"gain Rs.{returns['total_gain_loss']:,.2f} "
        f"(+{returns['total_gain_loss_pct']:.2f}%)"
    )
    print(
        f"[verified by Python] top sector {allocation['top_sector']} at "
        f"{allocation['top_sector_pct']:.2f}% of portfolio | "
        f">40% concentration flag: {flag}"
    )


def _print_verified_risk(risk_facts):
    tax = risk_facts["tax"]
    print(
        f"[verified by Python] HHI {risk_facts['hhi']:,.2f} "
        f"({risk_facts['hhi_level']}) | "
        f"dispersion {risk_facts['return_dispersion_pct']:.2f}pp | "
        f"tax drag {risk_facts['tax_drag_pct']:.2f}%"
    )
    print(
        f"[verified by Python] estimated tax Rs.{tax['total_estimated_tax']:,.2f} "
        f"on Rs.{tax['total_taxable_gains']:,.2f} gains => "
        f"{tax['blended_effective_rate_pct']:.2f}% blended effective rate"
    )


def _ask_goal_context():
    print("\n" + "-" * 72)
    print("GOAL SETUP  (used as context by the Advisor agent)")
    print("-" * 72)
    years_raw = input("\nInvestment time horizon (years): ").strip()
    try:
        time_horizon_years = float(years_raw) if years_raw else 5.0
    except ValueError:
        time_horizon_years = 5.0
    goal = input("Goal label (optional): ").strip()
    return {"time_horizon_years": time_horizon_years, "goal": goal}


def _ask_view_graph():
    answer = input("\nView as graph? (y/n): ").strip().lower()
    return answer == "y"


def _show_normal_charts(structured_findings):
    if not _ask_view_graph():
        return
    try:
        show_allocation_pie(structured_findings["allocation"])
        show_gainloss_bar(structured_findings["returns"]["holdings"])
    except RuntimeError as exc:
        print(f"Charts unavailable: {exc}")


def _allocation_summary(allocation):
    return ", ".join(
        f"{sector} {pct:.2f}%" for sector, pct in allocation["sector_allocation"].items()
    )


def _concentration_summary(allocation):
    flag = "YES" if allocation["concentration_flag"] else "no"
    return (
        f"{allocation['top_sector']} {allocation['top_sector_pct']:.2f}% "
        f"(>40% flag: {flag})"
    )


def _run_what_if(df, goal_context, model):
    answer = input("\nRun a what-if simulation? (y/n): ").strip().lower()
    if answer != "y":
        return
    _print_section(
        "WHAT-IF SIMULATION (hypothetical - never changes your portfolio or CSV)"
    )
    try:
        ticker = input("Ticker to sell: ").strip()
        pct_raw = input("Percentage to sell: ").strip()
        destination = input("Asset/ticker to reallocate into: ").strip()
        sell_pct = float(pct_raw)
        sim_df = simulate_rebalance(df, ticker, sell_pct, destination)
    except ValueError as exc:
        print(f"Simulation aborted: {exc}")
        return

    before_returns = calculate_returns(df)
    before_allocation = calculate_allocation(df)
    after_returns = calculate_returns(sim_df)
    after_allocation = calculate_allocation(sim_df)
    sim_structured = {"returns": after_returns, "allocation": after_allocation}
    sim_risk_facts = _compute_risk_facts(sim_df, sim_structured)
    advisor = run_advisor(
        sim_structured,
        sim_risk_facts,
        model,
        goal_context=goal_context,
        hypothetical=True,
    )

    print("\n" + "=" * 72)
    print("SIMULATED SCENARIO")
    print("(hypothetical rebalance - NOT your actual portfolio)")
    print("=" * 72)
    print("\nBefore vs After\n")
    print("Portfolio Value")
    print(f"Before: Rs.{before_returns['portfolio']['total_current_value']:,.2f}")
    print(f"After: Rs.{after_returns['portfolio']['total_current_value']:,.2f}")
    print("\nGain/Loss %")
    print(f"Before: {before_returns['portfolio']['total_gain_loss_pct']:+.2f}%")
    print(f"After: {after_returns['portfolio']['total_gain_loss_pct']:+.2f}%")
    print("\nSector/Asset Allocation")
    print("Before: " + _allocation_summary(before_allocation))
    print("After: " + _allocation_summary(after_allocation))
    print("\nConcentration")
    print("Before: " + _concentration_summary(before_allocation))
    print("After: " + _concentration_summary(after_allocation))
    print("\nUpdated Advisor Analysis")
    print("(hypothetical scenario - the model was told this is a what-if)")
    print(advisor["advice"])

    if _ask_view_graph():
        try:
            show_rebalance_comparison(before_allocation, after_allocation)
        except RuntimeError as exc:
            print(f"Charts unavailable: {exc}")
    print("\nNote: the simulation ran on a copy. Your original portfolio and CSV "
          "were not modified.")


def main():
    parser = argparse.ArgumentParser(
        description="Three-agent portfolio health advisor (Analyst -> Risk -> Advisor -> Q&A)."
    )
    parser.add_argument("--csv", default=DEFAULT_CSV, help="Path to holdings CSV.")
    parser.add_argument("--model", default=llm_client.DEFAULT_MODEL, help="Groq model id.")
    parser.add_argument(
        "--no-qa", action="store_true", help="Skip the interactive Q&A loop."
    )
    parser.add_argument(
        "--llm-map",
        action="store_true",
        help="Let the model map unrecognized CSV headers (incomplete mapping fallback).",
    )
    args = parser.parse_args()

    goal_context = _ask_goal_context()

    with open(args.csv, encoding="utf-8-sig") as fh:
        raw_csv = fh.read()

    rows, meta = normalize_text(raw_csv)
    if (meta["missing_fields"] or meta["ambiguous"] or (not rows)) and args.llm_map:
        print("Deterministic header mapping incomplete; asking the model to map columns...")
        try:
            mapping = llm_resolve_mapping(raw_csv, model=args.model)
            rows, meta = normalize_text(raw_csv, force_mapping=mapping)
        except Exception as exc:
            print(f"AI-assisted mapping failed: {exc}")
            rows, meta = [], {"missing_fields": ["(unknown)"], "reason": str(exc), "ambiguous": {}, "mapping_used": {}, "warnings": [], "skipped_rows": 0}

    if not rows:
        print("Unsupported data layout: unable to map a usable holdings table.")
        print(meta.get("reason", ""))
        found_headers = raw_csv.lstrip().splitlines()
        if found_headers:
            print("Found first line: " + found_headers[0].strip())
        print(
            "Expected canonical columns (or common aliases like symbol/qty/market price): "
            "ticker, name, sector, asset_class, quantity, buy_price, current_price, holding_months."
        )
        print("Re-run with --llm-map to let the model map unknown columns.")
        sys.exit(1)

    mapped = ", ".join(f"{src}->{field}" for field, src in meta["mapping_used"].items())
    print(f"Loaded {len(rows)} holdings from {args.csv}")
    print("Columns mapped: " + mapped)
    if meta["skipped_rows"]:
        print(f"Skipped {meta['skipped_rows']} row(s) with missing or non-numeric values.")

    df = pd.DataFrame(rows)

    _print_section("STEP 1/4 - ANALYST AGENT (facts only, via tools)")
    analyst = run_analyst(df, args.model)
    print(analyst["narrative_findings"])
    _print_verified_analyst(analyst["structured_findings"])

    _print_section("STEP 2/4 - RISK AGENT (facts only, tax impact via tool)")
    risk = run_risk(df, analyst["structured_findings"], args.model)
    print(risk["risk_report"])
    _print_verified_risk(risk["risk_facts"])

    _print_section("STEP 3/4 - ADVISOR AGENT (interpretation over facts)")
    advisor = run_advisor(
        analyst["structured_findings"], risk["risk_facts"], args.model,
        goal_context=goal_context,
    )
    print(advisor["advice"])

    _show_normal_charts(analyst["structured_findings"])

    if not args.no_qa:
        _print_section("STEP 4/4 - INTERACTIVE Q&A (conversation history persists)")
        run_qa_loop(advisor["messages"], args.model)
    else:
        print("\n--no-qa set: skipping interactive Q&A loop.")

    _run_what_if(df, goal_context, args.model)

    print("\nDone.")


if __name__ == "__main__":
    main()