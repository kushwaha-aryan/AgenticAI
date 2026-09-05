const NORM_CANONICAL = [
  "ticker",
  "name",
  "sector",
  "asset_class",
  "quantity",
  "buy_price",
  "current_price",
  "holding_months",
];

const NORM_REQUIRED = [
  "ticker",
  "quantity",
  "buy_price",
  "current_price",
  "holding_months",
  "sector",
  "asset_class",
];

const NORM_OPTIONAL = ["name"];

const NORM_ALIASES = {
  ticker: ["ticker", "symbol", "code", "stock", "scrip", "instrument code", "stock code"],
  name: ["name", "company", "company name", "instrument", "security", "security name", "description", "label"],
  sector: ["sector", "industry", "segment", "subsector", "sector name"],
  asset_class: ["asset class", "assetclass", "class", "type", "asset type", "asset category", "category"],
  quantity: ["quantity", "qty", "shares", "units", "nos", "no of shares", "count", "holding qty", "units held"],
  buy_price: ["buy price", "buyprice", "purchase price", "purchase", "cost", "cost price", "avg cost", "average cost", "buy", "price paid", "invested price", "buy value"],
  current_price: ["current price", "currentprice", "market price", "market", "price", "last price", "last", "ltp", "close", "sell price", "sell", "current", "nav"],
  holding_months: ["holding months", "holdingmonths", "holding period", "holding", "months", "months held", "tenure", "hold period", "duration", "age", "investment period", "months held"],
};

function normHeader(name) {
  return String(name).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function scoreField(normHeaderValue, field) {
  if (normHeaderValue === normHeader(field)) return 100;
  for (const alias of NORM_ALIASES[field]) {
    if (normHeaderValue === normHeader(alias)) return 80;
  }
  return 0;
}

function matchHeaders(headerCells) {
  const normHeaders = headerCells.map(normHeader);
  const mapping = {};
  const ambiguous = {};
  const used = {};
  for (const field of NORM_CANONICAL) {
    let best = 0;
    let bestIndices = [];
    for (let i = 0; i < normHeaders.length; i++) {
      if (used[i]) continue;
      const score = scoreField(normHeaders[i], field);
      if (score > best) {
        best = score;
        bestIndices = [i];
      } else if (score === best && score > 0) {
        bestIndices.push(i);
      }
    }
    if (best >= 80 && bestIndices.length === 1) {
      mapping[field] = bestIndices[0];
      used[bestIndices[0]] = true;
    } else if (bestIndices.length > 1) {
      ambiguous[field] = bestIndices.map((i) => headerCells[i]);
    }
  }
  return { mapping, ambiguous };
}

function toFloat(raw) {
  if (raw === null || raw === undefined) return null;
  let t = String(raw).trim();
  if (!t) return null;
  let negative = false;
  if (t.startsWith("(") && t.endsWith(")")) {
    negative = true;
    t = t.slice(1, -1);
  }
  t = t.replace(/,/g, "").replace(/\s/g, "");
  t = t.replace(/^(rs\.|rs|inr|rupees?|\u20a8|\u20b9|\$|us\$|usd)/i, "");
  t = t.replace(/(rs\.|rs|inr|\u20a8|\u20b9|\$)$/i, "");
  t = t.replace(/[^0-9.eE+\-]/g, "");
  if (!t || t === "-" || t === "+" || t === ".") return null;
  const value = Number(t);
  if (!Number.isFinite(value)) return null;
  return negative ? -value : value;
}

function parseMonths(raw) {
  if (raw === null || raw === undefined) return null;
  const t = String(raw).trim().toLowerCase().replace(/\s+/g, " ");
  let m = t.match(/^(\d+(?:\.\d+)?)\s*(m|mo|mos|month|months)?$/);
  if (m) return Math.trunc(Number(m[1]));
  m = t.match(/^(\d+(?:\.\d+)?)\s*(y|yr|yrs|year|years)$/);
  if (m) return Math.trunc(Number(m[1]) * 12);
  m = t.match(/^(\d+(?:\.\d+)?)\s*(d|day|days)$/);
  if (m) return Math.max(1, Math.trunc(Number(m[1]) / 30));
  return null;
}

function coerceValue(raw, field) {
  if (field === "holding_months") return parseMonths(raw);
  if (field === "quantity" || field === "buy_price" || field === "current_price") return toFloat(raw);
  if (raw === null || raw === undefined) return null;
  const value = String(raw).trim().replace(/^["']|["']$/g, "");
  return value || null;
}

function derivedPrice(rawValue, quantity, via) {
  const value = toFloat(rawValue);
  if (value === null || value === undefined) return null;
  if (via === "mul") {
    if (quantity) return Math.round((value / quantity) * 10000) / 10000;
  }
  return null;
}

function resolveForceMap(forceMapping, headerCells) {
  const mapping = {};
  const derived = {};
  const errors = [];
  for (const field of NORM_CANONICAL) {
    const spec = forceMapping[field];
    if (spec === null || spec === undefined) continue;
    if (typeof spec === "object") {
      const sourceName = spec.from;
      const via = spec.via;
      if (via !== "mul") {
        errors.push("unsupported derivation for " + field + ": " + via);
        continue;
      }
      const idx = headerCells.indexOf(sourceName);
      if (idx >= 0) derived[field] = { idx, via };
      else errors.push("mapped source '" + sourceName + "' for " + field + " not found in headers");
    } else {
      const sourceName = String(spec);
      const idx = headerCells.indexOf(sourceName);
      if (idx >= 0) mapping[field] = idx;
      else errors.push("mapped source '" + sourceName + "' for " + field + " not found in headers");
    }
  }
  return { mapping, derived, errors };
}

function splitCsvLine(line) {
  const out = [];
  let cur = "";
  let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQ) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i++;
        } else {
          inQ = false;
        }
      } else {
        cur += ch;
      }
    } else if (ch === '"') {
      inQ = true;
    } else if (ch === ",") {
      out.push(cur.trim());
      cur = "";
    } else {
      cur += ch;
    }
  }
  out.push(cur.trim());
  return out;
}

function normalizeCsvText(raw, forceMapping) {
  let text = String(raw || "");
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter((l) => l.length > 0);
  const rowsRaw = lines.map(splitCsvLine);

  const meta = {
    mapping_used: {},
    missing_fields: [],
    ambiguous: {},
    skipped_rows: 0,
    warnings: [],
    reason: null,
  };
  if (rowsRaw.length === 0) {
    meta.reason = "The data source is empty. Expected a CSV with a header row and at least one holding.";
    return { rows: [], meta };
  }

  const headers = rowsRaw[0];
  const dataRows = rowsRaw.slice(1);
  let resolved = matchHeaders(headers);
  let mapping = resolved.mapping;
  let ambiguous = resolved.ambiguous;
  let derived = {};

  if (forceMapping) {
    const forced = resolveForceMap(forceMapping, headers);
    if (forced.errors.length) {
      meta.reason = "AI mapping failed: " + forced.errors.join("; ");
      return { rows: [], meta };
    }
    mapping = forced.mapping;
    derived = forced.derived;
    ambiguous = {};
  }

  if (Object.keys(ambiguous).length) meta.ambiguous = ambiguous;
  const missing = NORM_REQUIRED.filter(
    (f) => mapping[f] === undefined && derived[f] === undefined && ambiguous[f] === undefined
  );
  meta.missing_fields = missing;
  for (const f of Object.keys(mapping)) meta.mapping_used[f] = headers[mapping[f]];
  for (const f of Object.keys(derived)) meta.mapping_used[f] = headers[derived[f].idx] + " (derived: price = value / quantity)";

  if (missing.length) {
    meta.reason =
      "Could not identify required column(s): " +
      missing.join(", ") +
      ". Found headers: " +
      (headers.length ? headers.join(", ") : "(none)") +
      ".";
    return { rows: [], meta };
  }

  if (Object.keys(ambiguous).length) {
    const detail = Object.keys(ambiguous)
      .map((field) => field + ": " + ambiguous[field].join(", "))
      .join("; ");
    meta.reason = "Header name(s) could match more than one required column: " + detail + ".";
    return { rows: [], meta };
  }

  const rows = [];
  const warnings = [];
  for (let r = 0; r < dataRows.length; r++) {
    const cells = dataRows[r];
    const padded = cells.concat(new Array(headers.length).fill("")).slice(0, headers.length);
    const rowNum = r + 2;
    const record = {};
    let invalid = false;
    for (const field of NORM_CANONICAL) {
      if (derived[field]) {
        const d = derived[field];
        const value = derivedPrice(padded[d.idx], record.quantity, d.via);
        if (value === null) {
          invalid = true;
          warnings.push([rowNum, field, "non-numeric value"]);
        }
        record[field] = value;
      } else if (mapping[field] !== undefined) {
        record[field] = coerceValue(padded[mapping[field]], field);
      } else {
        record[field] = null;
      }
    }
    if (invalid) continue;
    if (!record.ticker) {
      warnings.push([rowNum, "ticker", "empty"]);
      continue;
    }
    const numericFields = ["quantity", "buy_price", "current_price", "holding_months", "sector", "asset_class"];
    const numericOk = numericFields.every((f) => record[f] !== null && record[f] !== undefined);
    if (!numericOk) {
      const bad = numericFields.filter((f) => record[f] === null || record[f] === undefined);
      warnings.push([rowNum, bad.join(", "), "missing or non-numeric"]);
      continue;
    }
    rows.push({
      ticker: String(record.ticker),
      name: record.name || "",
      sector: String(record.sector),
      asset_class: String(record.asset_class),
      quantity: Number(record.quantity),
      buy_price: Number(record.buy_price),
      current_price: Number(record.current_price),
      holding_months: Number(record.holding_months),
    });
  }

  meta.skipped_rows = warnings.length;
  meta.warnings = warnings.map((w) => ({ row: w[0], field: w[1], value: w[2] }));
  if (!rows.length) meta.reason = "No usable holdings after parsing. Rows were dropped (see warnings).";
  return { rows, meta };
}

async function llmMapCsv(rawText, opts = {}) {
  const system =
    "You map the header columns of an investment holdings CSV onto a fixed " +
    "schema. The schema columns are: ticker (stock code or symbol), " +
    "name (company/label), sector (industry), asset_class (equity/debt/etc.), " +
    "quantity (shares or units held), buy_price (price paid per share), " +
    "current_price (latest price per share), holding_months (how long held, " +
    "in months). " +
    'Reply with ONLY valid JSON: {"mapping": {"<schema_column>": "<exact source ' +
    'header string>"}, "missing": ["<schema_column>", ...]}. Use the exact source ' +
    "header strings verbatim. If a schema column is clearly derivable from a " +
    "total/market-value column (current_price = value/quantity, or buy_price = " +
    'value/quantity), map it as {"from": "<exact source header string>", "via": ' +
    '"mul"}. No prose, no markdown fences.';
  const message = await groqChat(
    [
      { role: "system", content: system },
      { role: "user", content: "CSV content to map:\n" + String(rawText) },
    ],
    { apiKey: opts.apiKey, temperature: 0 }
  );
  let text = (message.content || "").trim();
  text = text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  const parsed = JSON.parse(text);
  if (!parsed || typeof parsed !== "object" || !parsed.mapping || typeof parsed.mapping !== "object") {
    throw new Error("the model did not return a valid mapping");
  }
  return parsed.mapping;
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    normalizeCsvText,
    matchHeaders,
    coerceValue,
    splitCsvLine,
    normHeader,
    NORM_ALIASES,
  };
}