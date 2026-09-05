import pandas as pd

DEFENSIVE_ASSETS = {
    "BONDS": {
        "ticker": "BONDS",
        "name": "Bond Index Fund",
        "sector": "Debt",
        "asset_class": "Debt",
        "buy_price": 100.0,
        "current_price": 100.0,
        "holding_months": 0,
    },
    "GOLD": {
        "ticker": "GOLD",
        "name": "Gold",
        "sector": "Commodities",
        "asset_class": "Commodity",
        "buy_price": 100.0,
        "current_price": 100.0,
        "holding_months": 0,
    },
    "CASH": {
        "ticker": "CASH",
        "name": "Cash",
        "sector": "Cash",
        "asset_class": "Debt",
        "buy_price": 100.0,
        "current_price": 100.0,
        "holding_months": 0,
    },
}


def _norm(text):
    return str(text).strip().upper()


def _lookup_row_by_ticker(df, ticker):
    for _, row in df.iterrows():
        if _norm(row["ticker"]) == ticker:
            return dict(row)
    return None


def simulate_rebalance(df, ticker, sell_pct, reallocate_into):
    if df is None or len(df) == 0:
        raise ValueError("portfolio is empty")

    try:
        sell_pct = float(sell_pct)
    except (TypeError, ValueError):
        raise ValueError("sell percentage must be a number")
    if sell_pct <= 0:
        raise ValueError("sell percentage must be greater than 0")
    if sell_pct > 100:
        raise ValueError("sell percentage must not exceed 100")

    target = _norm(ticker)
    if _lookup_row_by_ticker(df, target) is None:
        raise ValueError(f"ticker '{ticker}' not found in the portfolio")

    dest = _norm(reallocate_into)
    if dest == target:
        raise ValueError("must reallocate into a different holding than the one being sold")

    existing_tickers = {_norm(row["ticker"]) for _, row in df.iterrows()}
    if dest not in existing_tickers and dest not in DEFENSIVE_ASSETS:
        raise ValueError(
            f"destination '{reallocate_into}' is neither a portfolio holding nor a "
            "supported defensive asset (BONDS, GOLD, CASH)"
        )

    src_row = _lookup_row_by_ticker(df, target)
    dest_row = _lookup_row_by_ticker(df, dest)
    if dest_row is None:
        dest_row = dict(DEFENSIVE_ASSETS[dest])

    src_qty = float(src_row["quantity"])
    src_price = float(src_row["current_price"])
    dest_price = float(dest_row["current_price"])
    if dest_price <= 0:
        raise ValueError(f"destination '{dest}' has a non-positive current price")

    proceeds = src_qty * src_price * (sell_pct / 100.0)
    sell_qty = proceeds / src_price if src_price else 0.0
    remaining_qty = round(src_qty - sell_qty, 6)
    dest_add_qty = round(proceeds / dest_price, 6)

    new_rows = []
    for _, row in df.iterrows():
        row_dict = dict(row)
        tn = _norm(row["ticker"])
        if tn == target:
            if remaining_qty > 1e-9:
                row_dict["quantity"] = remaining_qty
                new_rows.append(row_dict)
        elif tn == dest:
            row_dict["quantity"] = round(float(row_dict["quantity"]) + dest_add_qty, 6)
            new_rows.append(row_dict)
        else:
            new_rows.append(row_dict)

    if dest not in existing_tickers:
        new_rows.append(dict(dest_row, quantity=dest_add_qty))

    return pd.DataFrame(new_rows, columns=list(df.columns))