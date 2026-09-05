LTCG_MONTHS = 12
STCG_RATE = 0.20
LTCG_RATE = 0.10
DISCLAIMER = (
    "Illustrative estimate only, not tax advice. Assumes a simplified flat-rate "
    "LTCG/STCG treatment: 10% for holdings held 12 months or longer, 20% otherwise. "
    "Real LTCG/STCG rules vary by asset class, and exemptions or set-offs are ignored."
)


def estimate_tax_impact(df):
    rows = []
    for _, row in df.iterrows():
        cost_basis = float(row["quantity"]) * float(row["buy_price"])
        current_value = float(row["quantity"]) * float(row["current_price"])
        gain = current_value - cost_basis
        holding_months = int(row["holding_months"])

        if gain <= 0:
            category = "no_gain"
            rate_pct = 0.0
            tax = 0.0
        elif holding_months >= LTCG_MONTHS:
            category = "LTCG"
            rate_pct = LTCG_RATE * 100.0
            tax = gain * LTCG_RATE
        else:
            category = "STCG"
            rate_pct = STCG_RATE * 100.0
            tax = gain * STCG_RATE

        rows.append(
            {
                "ticker": row["ticker"],
                "name": row["name"],
                "category": category,
                "holding_months": holding_months,
                "gain": round(gain, 2),
                "rate_pct": rate_pct,
                "tax": round(tax, 2),
            }
        )

    total_taxable_gains = round(sum(r["gain"] for r in rows if r["gain"] > 0), 2)
    total_estimated_tax = round(sum(r["tax"] for r in rows), 2)
    blended_effective_rate_pct = (
        round(total_estimated_tax / total_taxable_gains * 100.0, 2)
        if total_taxable_gains
        else 0.0
    )

    return {
        "holdings": rows,
        "total_taxable_gains": total_taxable_gains,
        "total_estimated_tax": total_estimated_tax,
        "blended_effective_rate_pct": blended_effective_rate_pct,
        "assumptions": {
            "ltcg_months": LTCG_MONTHS,
            "ltcg_rate_pct": LTCG_RATE * 100.0,
            "stcg_rate_pct": STCG_RATE * 100.0,
            "losses_offset_against_gains": False,
        },
        "disclaimer": DISCLAIMER,
    }