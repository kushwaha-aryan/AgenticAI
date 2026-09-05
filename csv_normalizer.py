import csv
import io
import json
import re

import llm_client

CANONICAL_FIELDS = [
    "ticker",
    "name",
    "sector",
    "asset_class",
    "quantity",
    "buy_price",
    "current_price",
    "holding_months",
]

OPTIONAL_FIELDS = {"name"}

REQUIRED_FIELDS = [
    "ticker",
    "quantity",
    "buy_price",
    "current_price",
    "holding_months",
    "sector",
    "asset_class",
]

HEADER_ALIASES = {
    "ticker": [
        "ticker",
        "symbol",
        "code",
        "stock",
        "scrip",
        "instrument code",
        "stock code",
    ],
    "name": [
        "name",
        "company",
        "company name",
        "instrument",
        "security",
        "security name",
        "description",
        "label",
    ],
    "sector": ["sector", "industry", "segment", "subsector", "sector name"],
    "asset_class": [
        "asset class",
        "assetclass",
        "class",
        "type",
        "asset type",
        "asset category",
        "category",
    ],
    "quantity": [
        "quantity",
        "qty",
        "shares",
        "units",
        "nos",
        "no of shares",
        "count",
        "holding qty",
        "units held",
    ],
    "buy_price": [
        "buy price",
        "buyprice",
        "purchase price",
        "purchase",
        "cost",
        "cost price",
        "avg cost",
        "average cost",
        "buy",
        "price paid",
        "invested price",
        "buy value",
    ],
    "current_price": [
        "current price",
        "currentprice",
        "market price",
        "market",
        "price",
        "last price",
        "last",
        "ltp",
        "close",
        "sell price",
        "sell",
        "current",
        "nav",
    ],
    "holding_months": [
        "holding months",
        "holdingmonths",
        "holding period",
        "holding",
        "months",
        "months held",
        "tenure",
        "hold period",
        "duration",
        "age",
        "investment period",
        "months held",
    ],
}


def _norm(name):
    return re.sub(r"[^a-z0-9]+", " ", name.lower()).strip()


def _norm_alias(field):
    return _norm(field)


def _score_field(norm_header, field):
    if norm_header == _norm_alias(field):
        return 100
    for alias in HEADER_ALIASES[field]:
        if norm_header == _norm(alias):
            return 80
    return 0


def match_headers(header_cells):
    norm_headers = [_norm(h) for h in header_cells]
    mapping = {}
    ambiguous = {}
    used = set()
    for field in CANONICAL_FIELDS:
        best = 0
        best_indices = []
        for i, nh in enumerate(norm_headers):
            if i in used:
                continue
            score = _score_field(nh, field)
            if score > best:
                best = score
                best_indices = [i]
            elif score == best and score > 0:
                best_indices.append(i)
        if best >= 80 and len(best_indices) == 1:
            mapping[field] = best_indices[0]
            used.add(best_indices[0])
        elif len(best_indices) > 1:
            ambiguous[field] = [header_cells[i] for i in best_indices]
    return mapping, ambiguous


def _to_float(raw):
    if raw is None:
        return None
    t = str(raw).strip()
    if not t:
        return None
    negative = False
    if t.startswith("(") and t.endswith(")"):
        negative = True
        t = t[1:-1]
    t = t.replace(",", "").replace(" ", "")
    t = re.sub(
        r"(?i)^(rs\.|rs|inr|rupee(?:s)?|\u20b9|\$|usd|us\\$)", "", t
    )
    t = re.sub(r"(?i)(rs\.|rs|inr|\u20b9|\$)$", "", t)
    t = re.sub(r"[^0-9.eE+\-]", "", t)
    if not t or t in ("-", "+", ".", ""):
        return None
    try:
        value = float(t)
    except ValueError:
        return None
    return -value if negative else value


def _parse_months(raw):
    if raw is None:
        return None
    t = str(raw).strip().lower()
    t = re.sub(r"\s+", " ", t)
    m = re.fullmatch(r"(\d+(?:\.\d+)?)\s*(m|mo|mos|month|months)?", t)
    if m:
        base = float(m.group(1))
        return int(base)
    m = re.fullmatch(r"(\d+(?:\.\d+)?)\s*(y|yr|yrs|year|years)", t)
    if m:
        return int(float(m.group(1)) * 12)
    m = re.fullmatch(r"(\d+(?:\.\d+)?)\s*(d|day|days)", t)
    if m:
        return max(1, int(float(m.group(1)) // 30))
    return None


def coerce_value(raw, field):
    if field == "holding_months":
        return _parse_months(raw)
    if field in ("quantity", "buy_price", "current_price"):
        return _to_float(raw)
    if raw is None:
        return None
    value = str(raw).strip().strip('"').strip("'")
    return value or None


def _derived(raw_value, quantity, via):
    value = _to_float(raw_value)
    if value is None:
        return None
    if via == "mul":
        if quantity:
            return round(value / quantity, 4)
    return None


def _resolve_force_map(force_mapping, header_cells):
    mapping = {}
    derived = {}
    errors = []
    for field in CANONICAL_FIELDS:
        spec = force_mapping.get(field)
        if spec is None:
            continue
        if isinstance(spec, dict):
            source_name = spec.get("from")
            via = spec.get("via")
            if via != "mul":
                errors.append(f"unsupported derivation for {field}: {via}")
                continue
            if source_name in header_cells:
                derived[field] = (header_cells.index(source_name), via)
            else:
                errors.append(f"mapped source '{source_name}' for {field} not found in headers")
        else:
            source_name = str(spec)
            if source_name in header_cells:
                mapping[field] = header_cells.index(source_name)
            else:
                errors.append(f"mapped source '{source_name}' for {field} not found in headers")
    return mapping, derived, errors


def normalize_text(raw, force_mapping=None):
    text = str(raw or "")
    if text.startswith("\ufeff"):
        text = text[1:]
    reader = csv.reader(io.StringIO(text), skipinitialspace=True)
    rows_raw = []
    for row in reader:
        cells = [c.strip() for c in row]
        if not any(cells):
            continue
        rows_raw.append(cells)

    meta = {
        "mapping_used": {},
        "missing_fields": [],
        "ambiguous": {},
        "skipped_rows": 0,
        "warnings": [],
        "reason": None,
    }
    if not rows_raw:
        meta["reason"] = "The data source is empty. Expected a CSV with a header row and at least one holding."
        return [], meta

    headers = rows_raw[0]
    data_rows = rows_raw[1:]
    mapping, ambiguous = match_headers(headers)
    derived = {}

    if force_mapping:
        forced, forced_derived, map_errors = _resolve_force_map(force_mapping, headers)
        if map_errors:
            meta["reason"] = "AI mapping failed: " + "; ".join(map_errors)
            return [], meta
        mapping = forced
        derived = forced_derived

    if ambiguous:
        meta["ambiguous"] = ambiguous

    missing = [f for f in REQUIRED_FIELDS if f not in mapping and f not in derived and f not in ambiguous]
    meta["missing_fields"] = missing
    meta["mapping_used"] = {
        f: headers[i] for f, i in mapping.items()
    }
    for field, (idx, via) in derived.items():
        meta["mapping_used"][field] = headers[idx] + " (derived: price = value / quantity)"

    if missing:
        meta["reason"] = (
            "Could not identify required column(s): "
            + ", ".join(missing)
            + ". Found headers: "
            + (", ".join(headers) if headers else "(none)")
            + "."
        )
        return [], meta

    if ambiguous:
        detail = ", ".join(f"{field}: {', '.join(names)}" for field, names in ambiguous.items())
        meta["reason"] = (
            "Header name(s) could match more than one required column: " + detail + "."
        )
        return [], meta

    rows = []
    warnings = []
    for row_index, cells in enumerate(data_rows, start=2):
        padded = (cells + [""] * len(headers))[: len(headers)]
        record = {}
        invalid = False
        for field in CANONICAL_FIELDS:
            if field in derived:
                idx, via = derived[field]
                quantity = record.get("quantity")
                value = _derived(padded[idx] if idx < len(padded) else None, quantity, via)
                if value is None:
                    invalid = True
                    warnings.append((row_index, field, "non-numeric value"))
                record[field] = value
            elif field in mapping:
                idx = mapping[field]
                record[field] = coerce_value(padded[idx] if idx < len(padded) else None, field)
            else:
                record[field] = None
        if invalid:
            continue
        if not record["ticker"]:
            warnings.append((row_index, "ticker", "empty"))
            continue
        numeric_ok = all(
            record[f] is not None for f in ("quantity", "buy_price", "current_price", "holding_months", "sector", "asset_class")
        )
        if not numeric_ok:
            bad = [f for f in ("quantity", "buy_price", "current_price", "holding_months", "sector", "asset_class") if record[f] is None]
            warnings.append((row_index, ", ".join(bad), "missing or non-numeric"))
            continue
        rows.append(
            {
                "ticker": str(record["ticker"]),
                "name": record["name"] or "",
                "sector": str(record["sector"]),
                "asset_class": str(record["asset_class"]),
                "quantity": float(record["quantity"]),
                "buy_price": float(record["buy_price"]),
                "current_price": float(record["current_price"]),
                "holding_months": int(record["holding_months"]),
            }
        )

    meta["skipped_rows"] = len(warnings)
    meta["warnings"] = [{"row": r, "field": f, "value": v} for r, f, v in warnings]
    if not rows:
        meta["reason"] = "No usable holdings after parsing. Rows were dropped (see warnings)."
    return rows, meta


def llm_resolve_mapping(raw_text, model=llm_client.DEFAULT_MODEL):
    system = (
        "You map the header columns of an investment holdings CSV onto a fixed "
        "schema. The schema columns are: ticker (stock code or symbol), "
        "name (company/label), sector (industry), asset_class (equity/debt/etc.), "
        "quantity (shares or units held), buy_price (price paid per share), "
        "current_price (latest price per share), holding_months (how long held, "
        "in months). "
        'Reply with ONLY valid JSON in the form '
        '{"mapping": {"<schema_column>": "<exact source header string>"}, '
        '"missing": ["<schema_column>", ...]}. '
        'Use the exact source header strings verbatim. If a schema column has no '
        'matching column but is clearly derivable as a total/market value column '
        '(current_price = value/quantity or buy_price = value/quantity), map it as '
        '{"from": "<exact source header string>", "via": "mul"}. No prose, no '
        "markdown fences."
    )
    user = "CSV content to map:\n" + str(raw_text)
    message = llm_client.chat_completion(
        [
            {"role": "system", "content": system},
            {"role": "user", "content": user},
        ],
        model=model,
        temperature=0,
    )
    text = (message.content or "").strip()
    text = re.sub(r"^```(?:json)?\s*", "", text)
    text = re.sub(r"\s*```$", "", text)
    parsed = json.loads(text)
    if not isinstance(parsed, dict) or not isinstance(parsed.get("mapping"), dict):
        raise ValueError("the model did not return a valid mapping")
    return parsed["mapping"]