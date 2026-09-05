CONCENTRATION_THRESHOLD_PCT = 40.0


def calculate_allocation(df):
    total_current_value = sum(
        float(row["quantity"]) * float(row["current_price"]) for _, row in df.iterrows()
    )

    sector_value = {}
    asset_class_value = {}
    for _, row in df.iterrows():
        current_value = float(row["quantity"]) * float(row["current_price"])
        sector_value[row["sector"]] = sector_value.get(row["sector"], 0.0) + current_value
        asset_class_value[row["asset_class"]] = (
            asset_class_value.get(row["asset_class"], 0.0) + current_value
        )

    sector_allocation = {
        sector: round(value / total_current_value * 100.0, 2)
        for sector, value in sector_value.items()
    }
    asset_class_allocation = {
        cls: round(value / total_current_value * 100.0, 2)
        for cls, value in asset_class_value.items()
    }
    sector_allocation = dict(
        sorted(sector_allocation.items(), key=lambda kv: kv[1], reverse=True)
    )
    asset_class_allocation = dict(
        sorted(asset_class_allocation.items(), key=lambda kv: kv[1], reverse=True)
    )

    top_sector = max(sector_allocation, key=sector_allocation.get)
    top_sector_pct = sector_allocation[top_sector]
    concentration_flag = top_sector_pct > CONCENTRATION_THRESHOLD_PCT

    return {
        "sector_allocation": sector_allocation,
        "asset_class_allocation": asset_class_allocation,
        "top_sector": top_sector,
        "top_sector_pct": top_sector_pct,
        "concentration_flag": concentration_flag,
        "concentration_threshold_pct": CONCENTRATION_THRESHOLD_PCT,
        "total_current_value": round(total_current_value, 2),
    }