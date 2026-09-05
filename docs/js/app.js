const SAMPLE_CSV = [
  "ticker,name,sector,asset_class,quantity,buy_price,current_price,holding_months",
  "TCS,Tata Consultancy Services,IT,Equity,4,2800.00,3400.00,24",
  "INFY,Infosys,IT,Equity,6,1500.00,1700.00,30",
  "HDFCBANK,HDFC Bank,Banks,Equity,10,900.00,1050.00,18",
  "NTPC,NTPC,Energy,Equity,10,150.00,270.00,12",
  "ITC,ITC,FMCG,Equity,30,240.00,248.00,20",
  "MM,Mahindra & Mahindra,Auto,Equity,1,4940.00,6400.00,15",
  "HDFCBOND,HDFC Corporate Bond Fund,Debt,Debt,100,30.00,32.00,60",
].join("\n");

const $ = (id) => document.getElementById(id);

const apiKeyInput = $("apiKey");
const showKeyBtn = $("showKey");
const keySourceEnv = $("keySourceEnv");
const keySourceManual = $("keySourceManual");
const keyStatus = $("keyStatus");
const csvInput = $("csvInput");
const loadSampleBtn = $("loadSample");
const uploadBtn = $("uploadBtn");
const uploadName = $("uploadName");
const csvFile = $("csvFile");
const analyzeBtn = $("analyze");
const parseMsg = $("parseMsg");
const llmMapBtn = $("llmMapBtn");
const resultsCard = $("resultsCard");
const visualsCard = $("visualsCard");
const visualsEl = $("visuals");
const qaInput = $("qaInput");
const qaSendBtn = $("qaSend");
const qaHistory = $("qaHistory");

const TAB_NAMES = ["analyst", "risk", "advisor", "qa"];
const TAB_IDS = {
  analyst: { tab: $("tabAnalyst"), panel: $("panelAnalyst") },
  risk: { tab: $("tabRisk"), panel: $("panelRisk") },
  advisor: { tab: $("tabAdvisor"), panel: $("panelAdvisor") },
  qa: { tab: $("tabQa"), panel: $("panelQa") },
};
let currentTab = "analyst";

let state = {
  rows: null,
  advisorMessages: null,
  apiKey: localStorage.getItem("groqApiKey") || "",
  providedKey: null,
  busy: false,
};

function selectedKeySource() {
  return keySourceManual.checked ? "manual" : "env";
}

function getApiKey() {
  return selectedKeySource() === "env" ? state.providedKey : state.apiKey.trim();
}

function activateTab(name) {
  const entry = TAB_IDS[name];
  if (!entry || entry.tab.disabled) return;
  currentTab = name;
  TAB_NAMES.forEach((n) => {
    const e = TAB_IDS[n];
    const active = n === name;
    e.tab.classList.toggle("active", active);
    e.tab.setAttribute("aria-selected", String(active));
    e.panel.classList.toggle("active", active);
    e.panel.setAttribute("aria-hidden", String(!active));
  });
}

function enableTab(name) {
  TAB_IDS[name].tab.disabled = false;
}

function updateKeyControls() {
  const manual = selectedKeySource() === "manual";
  apiKeyInput.disabled = !manual;
  showKeyBtn.disabled = !manual;
  if (manual) {
    apiKeyInput.value = state.apiKey;
    keyStatus.textContent = state.apiKey
      ? "Using the key you pasted (saved in this browser)."
      : "Paste your Groq API key above.";
  } else if (state.providedKey) {
    keyStatus.textContent = "Using the provided API key from the demo server env.";
  } else {
    keyStatus.textContent =
      "No provided key found. Start the demo server with `python serve.py` (GROQ_API_KEY set or in .env), or switch to 'Paste my own API key'.";
  }
}

function notifyNoDemoServer() {
  state.providedKey = null;
  keySourceManual.checked = true;
  updateKeyControls();
  if (location.protocol !== "file:") {
    keyStatus.textContent =
      "No demo server detected (open via `python serve.py` to auto-load the env key). " +
      "Paste your own Groq key to continue - it stays in your browser only.";
    apiKeyInput.focus();
  } else if (!state.apiKey) {
    keyStatus.textContent =
      "Opened directly from your files, so the server key isn't reachable. Paste your own Groq key once — " +
      "it's saved in this browser for this page. Or run `python serve.py` and open http://127.0.0.1:8080 for the env key.";
    apiKeyInput.focus();
  }
}

async function loadProvidedKey() {
  if (location.protocol === "file:") {
    notifyNoDemoServer();
    return;
  }
  try {
    const res = await fetch("/api/config", { cache: "no-store" });
    if (!res.ok) {
      throw new Error("no config endpoint");
    }
    const data = await res.json();
    state.providedKey = (data && data.api_key) || null;
  } catch (_) {
    state.providedKey = null;
  }
  if (state.providedKey) {
    keySourceEnv.checked = true;
    updateKeyControls();
  } else {
    notifyNoDemoServer();
  }
}

keySourceEnv.addEventListener("change", updateKeyControls);
keySourceManual.addEventListener("change", updateKeyControls);
apiKeyInput.addEventListener("input", () => {
  state.apiKey = apiKeyInput.value.trim();
  localStorage.setItem("groqApiKey", state.apiKey);
  updateKeyControls();
});
showKeyBtn.addEventListener("click", () => {
  const currentType = apiKeyInput.type;
  apiKeyInput.type = currentType === "password" ? "text" : "password";
  showKeyBtn.textContent = currentType === "password" ? "Hide" : "Show";
});

TAB_NAMES.forEach((n) => TAB_IDS[n].tab.addEventListener("click", () => activateTab(n)));

loadSampleBtn.addEventListener("click", () => {
  csvInput.value = SAMPLE_CSV;
  uploadName.textContent = "";
  setMessage("Sample data loaded.", "ok");
});

uploadBtn.addEventListener("click", () => csvFile.click());
csvFile.addEventListener("change", (e) => {
  const file = e.target.files && e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    csvInput.value = String(reader.result || "");
    uploadName.textContent = file.name;
    setMessage("", "");
  };
  reader.readAsText(file);
  csvFile.value = "";
});

function setMessage(text, type) {
  parseMsg.textContent = text;
  parseMsg.className = "msg " + (type || "");
}

function mappedSummary(meta) {
  return Object.keys(meta.mapping_used)
    .map((f) => meta.mapping_used[f] + "→" + f)
    .join(", ");
}

function showParseMeta(meta) {
  const needsAi =
    meta.missing_fields.length > 0 || Object.keys(meta.ambiguous).length > 0;
  llmMapBtn.hidden = !needsAi;
  return needsAi;
}

function makeMessageFromMeta(meta, kind) {
  const parts = [];
  if (meta.missing_fields.length) {
    parts.push("Could not identify required column(s): " + meta.missing_fields.join(", ") + ".");
  }
  if (Object.keys(meta.ambiguous).length) {
    parts.push(
      "Ambiguous column(s): " +
        Object.keys(meta.ambiguous)
          .map((f) => f + " = " + meta.ambiguous[f].join(" or "))
          .join("; ") +
        "."
    );
  }
  if (parts.length) {
    parts.push("Fix the headers or try AI-assisted mapping.");
    return { text: parts.join(" "), type: "warn" };
  }
  const mapped = mappedSummary(meta);
  parts.push("Loaded " + kind + " holdings.");
  if (mapped) parts.push("Columns mapped: " + mapped + ".");
  if (meta.skipped_rows) {
    parts.push("Skipped " + meta.skipped_rows + " row(s) with missing or non-numeric values.");
    return { text: parts.join(" "), type: "warn" };
  }
  return { text: parts.join(" "), type: "ok" };
}

async function tryLlmMap() {
  if (state.busy) return;
  const apiKey = getApiKey();
  if (!apiKey) {
    setMessage("Paste your Groq API key first (step 1).", "error");
    return;
  }
  state.busy = true;
  llmMapBtn.disabled = true;
  setMessage("Mapping columns with the model…", "");
  try {
    const mapping = await llmMapCsv(csvInput.value, { apiKey });
    const result = normalizeCsvText(csvInput.value, mapping);
    if (!result.rows.length) {
      throw new Error(result.meta.reason || "No usable holdings after AI mapping.");
    }
    state.rows = result.rows;
    state.meta = result.meta;
    llmMapBtn.hidden = true;
    const msg = makeMessageFromMeta(result.meta, "mapped by AI");
    setMessage("AI mapping applied. " + msg.text, msg.type);
  } catch (err) {
    setMessage("AI-assisted mapping failed: " + err.message, "error");
  } finally {
    state.busy = false;
    llmMapBtn.disabled = false;
  }
}

function fmtRupee(x) {
  return "Rs." + x.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fmtPct(x) {
  return x.toFixed(2) + "%";
}

function analystFactsText(structured) {
  const p = structured.returns.portfolio;
  const a = structured.allocation;
  return [
    `[verified] value ${fmtRupee(p.total_current_value)}  |  cost ${fmtRupee(p.total_cost_basis)}  |  gain ${fmtRupee(p.total_gain_loss)} (+${p.total_gain_loss_pct.toFixed(2)}%)`,
    `[verified] top sector ${a.top_sector} at ${a.top_sector_pct.toFixed(2)}% of portfolio  |  >40% concentration flag: ${a.concentration_flag ? "YES" : "no"}`,
  ].join("\n");
}

function riskFactsText(riskFacts) {
  const t = riskFacts.tax;
  return [
    `[verified] HHI ${riskFacts.hhi.toLocaleString("en-IN")} (${riskFacts.hhi_level})  |  dispersion ${riskFacts.return_dispersion_pct.toFixed(2)}pp  |  tax drag ${riskFacts.tax_drag_pct.toFixed(2)}%`,
    `[verified] estimated tax ${fmtRupee(t.total_estimated_tax)} on ${fmtRupee(t.total_taxable_gains)} gains => ${t.blended_effective_rate_pct.toFixed(2)}% blended effective rate`,
  ].join("\n");
}

function setStatus(id, text) {
  const el = document.getElementById(id);
  if (el) {
    el.textContent = text;
  }
}

function resetPanels() {
  resultsCard.hidden = true;
  visualsCard.hidden = true;
  visualsEl.innerHTML = "";
  TAB_NAMES.forEach((n, i) => {
    TAB_IDS[n].tab.disabled = i !== 0;
    TAB_IDS[n].tab.classList.remove("active");
    TAB_IDS[n].tab.setAttribute("aria-selected", "false");
    TAB_IDS[n].panel.classList.remove("active");
    TAB_IDS[n].panel.setAttribute("aria-hidden", "true");
  });
  TAB_IDS.analyst.tab.classList.add("active");
  TAB_IDS.analyst.tab.setAttribute("aria-selected", "true");
  TAB_IDS.analyst.panel.classList.add("active");
  TAB_IDS.analyst.panel.setAttribute("aria-hidden", "false");
  currentTab = "analyst";
  ["analystFacts", "riskFacts"].forEach((id) => {
    $(id).textContent = "";
  });
  ["analystNarrative", "riskNarrative", "advisorNarrative"].forEach((id) => {
    $(id).innerHTML = "";
  });
  qaHistory.innerHTML = "";
  qaInput.value = "";
}

async function runAnalysis() {
  if (state.busy) return;
  const apiKey = getApiKey();
  if (!apiKey) {
    if (selectedKeySource() === "env") {
      setMessage(
        "No provided API key found. Run `python serve.py` with GROQ_API_KEY set (or in a .env file), or switch to 'Paste my own API key'.",
        "error"
      );
    } else {
      setMessage("Paste your Groq API key first (step 1).", "error");
    }
    if (selectedKeySource() === "env") {
      loadProvidedKey();
    }
    return;
  }
  let rows;
  let meta;
  try {
    const result = normalizeCsvText(csvInput.value);
    rows = result.rows;
    meta = result.meta;
  } catch (err) {
    setMessage(err.message, "error");
    return;
  }
  if (!rows.length) {
    if (meta.missing_fields.length || Object.keys(meta.ambiguous).length) {
      showParseMeta(meta);
      setMessage(makeMessageFromMeta(meta, "").text, "warn");
      return;
    }
    setMessage(meta.reason || "No usable holdings found in the CSV.", "error");
    return;
  }
  state.rows = rows;
  state.meta = meta;
  const msg = makeMessageFromMeta(meta, rows.length + " holdings");
  setMessage(msg.text, msg.type);
  state.busy = true;
  analyzeBtn.disabled = true;
  setMessage("Analyzing with " + rows.length + " holdings…", "");
  resetPanels();
  resultsCard.hidden = false;

  try {
    setStatus("analystStatus", "Analyst agent calling tools (return calculator, allocation breakdown)…");
    const analyst = await runAnalyst(rows, apiKey);
    $("analystFacts").textContent = analystFactsText(analyst.structured_findings);
    renderMarkdown($("analystNarrative"), analyst.narrative_findings);
    setStatus("analystStatus", "");
    enableTab("risk");

    activateTab("risk");
    setStatus("riskStatus", "Risk agent calling the tax-impact estimator tool…");
    const risk = await runRisk(rows, analyst.structured_findings, apiKey);
    $("riskFacts").textContent = riskFactsText(risk.risk_facts);
    renderMarkdown($("riskNarrative"), risk.risk_report);
    setStatus("riskStatus", "");
    enableTab("advisor");

    activateTab("advisor");
    setStatus("advisorStatus", "Advisor reasoning over verified facts…");
    const advisor = await runAdvisor(analyst.structured_findings, risk.risk_facts, apiKey);
    renderMarkdown($("advisorNarrative"), advisor.advice);
    setStatus("advisorStatus", "");
    state.advisorMessages = advisor.messages;
    enableTab("qa");

    visualsCard.hidden = false;
    renderVisuals(visualsEl, analyst.structured_findings, risk.risk_facts);
    setMessage("Analysis complete. Ask a follow-up question below.", "ok");
  } catch (err) {
    setMessage("Error: " + err.message, "error");
  } finally {
    state.busy = false;
    analyzeBtn.disabled = false;
  }
}

async function askQuestion() {
  if (state.busy) return;
  const question = qaInput.value.trim();
  if (!question) return;
  if (!state.advisorMessages) {
    setMessage("Run an analysis first.", "error");
    return;
  }
  state.busy = true;
  qaSendBtn.disabled = true;
  qaInput.disabled = true;

  const qItem = document.createElement("div");
  qItem.className = "qa-item";
  const qEl = document.createElement("div");
  qEl.className = "qa-q";
  qEl.textContent = "Q: " + question;
  const aEl = document.createElement("div");
  aEl.className = "qa-a md";
  aEl.textContent = "Thinking…";
  qItem.appendChild(qEl);
  qItem.appendChild(aEl);
  qaHistory.appendChild(qItem);
  qaInput.value = "";

  try {
    const apiKey = getApiKey();
    const history = state.advisorMessages;
    history.push({ role: "user", content: question });
    const message = await chatMultiturn(history, { apiKey, temperature: 0.3 });
    const answer = message.content || "";
    renderMarkdown(aEl, answer);
    history.push({ role: "assistant", content: answer });
  } catch (err) {
    aEl.textContent = "Error: " + err.message;
  } finally {
    state.busy = false;
    qaSendBtn.disabled = false;
    qaInput.disabled = false;
    qaInput.focus();
  }
}

analyzeBtn.addEventListener("click", runAnalysis);
llmMapBtn.addEventListener("click", tryLlmMap);
qaSendBtn.addEventListener("click", askQuestion);
qaInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    askQuestion();
  }
});

if (!csvInput.value) {
  csvInput.value = SAMPLE_CSV;
}

loadProvidedKey();