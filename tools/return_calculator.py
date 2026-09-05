def calculate_returns(df):
    holdings = []
    for _, row in df.iterrows():
        cost_basis = float(row["quantity"]) * float(row["buy_price"])
        current_value = float(row["quantity"]) * float(row["current_price"])
        gain_loss = current_value - cost_basis
        gain_loss_pct = (gain_loss / cost_basis * 100.0) if cost_basis else 0.0
        holdings.append(
            {
                "ticker": row["ticker"],
                "name": row["name"],
                "sector": row["sector"],
                "asset_class": row["asset_class"],
                "quantity": float(row["quantity"]),
                "cost_basis": round(cost_basis, 2),
                "current_value": round(current_value, 2),
                "gain_loss": round(gain_loss, 2),
                "gain_loss_pct": round(gain_loss_pct, 2),
            }
        )

    total_cost_basis = round(sum(h["cost_basis"] for h in holdings), 2)
    total_current_value = round(sum(h["current_value"] for h in holdings), 2)
    total_gain_loss = round(sum(h["gain_loss"] for h in holdings), 2)
    total_gain_loss_pct = (
        round(total_gain_loss / total_cost_basis * 100.0, 2) if total_cost_basis else 0.0
    )

    best_performer = max(holdings, key=lambda h: h["gain_loss_pct"])
    worst_performer = min(holdings, key=lambda h: h["gain_loss_pct"])

    return {
        "holdings": holdings,
        "portfolio": {
            "total_cost_basis": total_cost_basis,
            "total_current_value": total_current_value,
            "total_gain_loss": total_gain_loss,
            "total_gain_loss_pct": total_gain_loss_pct,
        },
        "best_performer": {
            "ticker": best_performer["ticker"],
            "gain_loss_pct": best_performer["gain_loss_pct"],
        },
        "worst_performer": {
            "ticker": worst_performer["ticker"],
            "gain_loss_pct": worst_performer["gain_loss_pct"],
        },
    }