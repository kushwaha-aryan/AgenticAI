# TeenTitans — Two-Agent Portfolio Advisor (Analyst → Risk → Advisor → Q&A)

A hackathon-ready, Groq-powered portfolio health advisor. It turns a raw CSV of
holdings into (a) mathematically verified facts, (b) a risk-only fact sheet, and
(c) grounded, plain-English advice — then enters an interactive Q&A loop that
remembers the whole conversation.

Two builds:

- **CLI (Python)** — the original multi-agent pipeline at the project root.
- **Web (GitHub Pages)** — a static `docs/` site that re-implements all 3 tools
  in plain JavaScript and talks to the Groq API straight from the browser.

> **Not financial advice.** Everything the models generate is educational. The
> tax computation is a simplified, clearly-labeled illustration (see
> `tools/tax_estimator.py` and `docs/js/tools.js`).

---

## 1. The big picture — why a multi-agent pipeline?

A retail investor has a spreadsheet of raw holdings. Raw numbers (prices,
quantities) don't tell them anything useful on their own. They need two things:

1. **Computed facts** — gains, concentration, tax exposure. These must be exact.
2. **Interpretation** — what should I actually think/do about these facts?

We split that into three agents plus a Q&A stage. The core principle:

> **Keep deterministic computation separate from generative reasoning.**
> Computation is testable; reasoning is not. If one agent both computed numbers
> and gave advice, a hallucination in the reasoning step could silently corrupt
> the facts too, and you would not be able to audit which part failed.

So the Analyst and Risk Agent output *structured JSON facts* computed by plain
Python (with tool calls driven by the LLM), and only the Advisor generates
subjective text. This is the same separation that makes calculators not-LLMs and
RAG systems retrieve facts before generating answers.

---

## 2. Architecture

```
 holdrings.csv
      │  pandas reads once into a DataFrame
      ▼
┌─────────────────────────┐   ┌───────────────────────────┐
│ 1. ANALYST AGENT        │   │ 2. RISK AGENT             │
│    LLM + tool-calling   │   │    LLM + tool-calling     │
│    tools:               │   │    tool:                  │
│   • calculate_returns   │   │   • estimate_tax_impact   │
│   • calculate_allocation│   │   + verified HHI facts,   │
│    output: narrative +  │   │     dispersion, tax drag  │
│    structured findings  │   │    output: risk report    │
└──────────┬──────────────┘   └───────────┬───────────────┘
           │ structured_findings (dict)   │ risk_facts (dict)
           ▼                              ▼
┌─────────────────────────────────────────────────────────┐
│ 3. ADVISOR AGENT  (no tools — pure reasoning over facts)│
│    output: 1-2 grounded suggestions + disclaimer        │
└──────────────────────────┬──────────────────────────────┘
                           │ advisor messages (system + advice)
                           ▼
┌─────────────────────────────────────────────────────────┐
│ 4. Q&A LOOP  (llm_client.chat_multiturn)                │
│    conversation_history persists across every question  │
│    (skippable with --no-qa)                             │
└─────────────────────────────────────────────────────────┘
```

### What "calling a tool" actually means (agentic function-calling)

The LLM never does the arithmetic. It only *decides* which Python function to
call, and then narrates the already-computed deterministic result.

```
1. Code sends:  system + user prompt + tool schemas  → LLM
2. LLM answers: "call calculate_returns()"          ← tool_calls field, not prose
3. Code intercepts the request and actually runs the Python function
4. Code feeds the function RESULT back as a new "tool" message
5. LLM reads the result and writes the final narrative
```

Notes:

- Tool schemas declare **zero arguments** — the data is pre-bound to the
  registered Python functions (`tool_registry`), so the model cannot pass bogus
  numbers.
- `tool_choice="auto"` lets the model genuinely decide whether/when to call —
  this is what makes the pipeline agentic rather than scripted.
- Groq (open models on fast LPU hardware, free-tier friendly) is used; the flow
  is OpenAI-compatible and generalizes to any function-calling provider.
- `temperature`: Analyst 0.1 (near-deterministic fact reporting),
  Risk 0.2 (facts), Advisor 0.3 (varied prose, still grounded).

---

## 3. Agents and tools

### Agent 1 — Analyst (`agents/analyst_agent.py`)
Facts only, architecturally enforced by the system prompt **and** by the fact
that the Advisor only ever receives the `structured_findings` dict.

- **Tool 1 — Return Calculator** (`tools/return_calculator.py`)
  `cost_basis = qty × buy_price`, `current_value = qty × current_price`,
  `gain_loss = current_value − cost_basis`,
  `gain_loss_pct = gain_loss / cost_basis × 100`.
  Also aggregates portfolio totals and best/worst performer.
  Both % and absolute report because a ₹500 gain on ₹1,000 (50%) is very different
  from a ₹500 gain on ₹50,000 (1%).
- **Tool 2 — Allocation Breakdown** (`tools/allocation_breakdown.py`)
  Groups by `sector` and `asset_class` as a % of **current value** (risk is about
  current exposure, not what you originally invested). Flags any sector > 40%.

> 40% is a reasonable hackathon simplification. A production system might use a
> more nuanced measure such as the Herfindahl-Hirschman Index (HHI) across all
> holdings instead of a single threshold — which is exactly what the Risk Agent
> adds next.

### Agent 3 — Risk Agent (`agents/risk_agent.py`, sits between Analyst and Advisor)
Calls **Tool 3 — Tax-Impact Estimator** itself via real LLM function-calling
(one tool in this agent's catalog), then reports facts only — no advice:

- **HHI interpretation** — HHI = Σ(sector weight²). > 2,500 = highly
  concentrated, 1,500–2,500 = moderate, < 1,500 = well diversified.
- **Tax drag** — `total_estimated_tax / total_current_value × 100`.
- **Return dispersion** — spread between best and worst performer in percentage
  points.

`risk_facts` is the authoritative machine-readable dict passed downstream; the
`risk_report` is the model's prose interpretation of it.

### Tool 3 — Tax-Impact Estimator (`tools/tax_estimator.py`)
Simplified LTCG/STCG-style estimate if the portfolio were sold today:

- `holding_months ≥ 12` → **LTCG** at a flat 10% (illustrative).
- `holding_months < 12` → **STCG** at 20%.
- No-gain holdings → ₹0 tax; losses do **not** offset gains.

Per-holding tax, total estimated tax, and blended effective rate
(`total_tax / total_taxable_gains`). On the bundled sample data this yields
**₹820 estimated tax on ₹8,200 in gains → 10% blended effective rate**, and the
output is always labeled as **illustrative, not tax advice**.

### Agent 2 — Advisor (`agents/advisor_agent.py`) + Multi-turn Q&A
No tools — its job is pure reasoning over already-computed structured facts
(simplest sufficient architecture: not every agent needs tools).
The prompt forces grounding: it must quote actual percentages / rupee figures
from the findings (the same "citation grounding" principle as RAG), and it ends
every answer with a "not personalized financial advice" disclaimer.

**Multi-turn Q&A** — after the advice is printed, `run_qa_loop` starts an
interactive loop:
- `llm_client.chat_multiturn()` supports a growing message history.
- A single `conversation_history` list persists across questions, so it remembers
  earlier answers, not just the original findings.
- `--no-qa` skips the loop entirely (for scripted/CI demos).

---

## 4. End-to-end data flow

```
CSV file
  → pandas DataFrame (main.py loads it once)
  → Analyst: LLM decides to call calculate_returns() and calculate_allocation()
      → Python executes both, returns dicts
      → LLM narrates (narrative_findings); raw dicts kept (structured_findings)
  → structured_findings → Risk Agent
      → LLM calls estimate_tax_impact(); Python executes; +verified HHI facts
      → risk_facts dict + risk_report prose (facts only)
  → structured_findings + risk_facts → Advisor
      → reasons over JSON facts, no tool calls, produces 1-2 suggestions
  → all steps printed; Q&A loop continues the conversation
```

---

## 5. Setup & run

```bash
# in an activated environment with Python 3.11+
pip install -r requirements.txt

# set your Groq API key
# PowerShell:  $env:GROQ_API_KEY="gsk_..."
# or export GROQ_API_KEY=... on bash/macOS/Linux
# (optional: copy .env.example to .env and fill it in - the server reads it too)
# optional: pip install matplotlib  (enables the 'View as graph?' charts)

python main.py                       # full run + interactive Q&A
python main.py --no-qa               # scripted/CI demo, no Q&A
python main.py --csv path/to/holdings.csv
python main.py --csv path/to/messy.csv --llm-map   # let the model map unknown headers
python main.py --model openai/gpt-oss-120b   # optional override (e.g. bigger model)

# Web version, locally:
#   option A - just open docs/index.html in a browser (paste a key in the page)
#   option B - demo server (serves docs/ AND provides the key from env/.env):
python serve.py                      # -> http://localhost:8000
#   option C - one command (creates venv on first run, then opens the browser):
.\run.ps1      # Windows ·  ./run.sh on macOS/Linux
```

### Sample output (eligibility: `sample_data/holdings.csv`)

```
STEP 1/4 - ANALYST AGENT (facts only, via tools)
   ...narrative...
[verified by Python] value Rs.54,040.00 | cost Rs.45,840.00 | gain Rs.8,200.00 (+17.89%)
[verified by Python] top sector IT at 44.04% of portfolio | >40% concentration flag: YES

STEP 2/4 - RISK AGENT (facts only, tax impact via tool)
   ...risk report...
[verified by Python] HHI 2,706.89 (highly concentrated) | dispersion 76.67pp | tax drag 1.52%
[verified by Python] estimated tax Rs.820.00 on Rs.8,200.00 gains => 10.00% blended effective rate

STEP 3/4 - ADVISOR AGENT (interpretation over facts)
   ...grounded advice incl. IT concentration & tax impact, ending with disclaimer...

STEP 4/4 - INTERACTIVE Q&A (conversation history persists)
You: why is my risk high?
Advisor: ...answers citing HHI 2,706.89, 44% IT concentration, 76.67pp dispersion...
```

### Optional interactive features (CLI)

- At the start it asks **Investment time horizon (years)** (blank = 5) and an
  optional **Goal label** (retirement, house, education…, any free text). This
  `goal_context` is passed to the Advisor for the initial report, the Q&A loop,
  and the what-if re-run — no need to re-enter it.
- After the Advisor report it asks **View as graph? (y/n)** — `y` shows the sector
  allocation pie and the gain/loss-per-holding bar chart (needs `matplotlib`; `n`
  or blank to continue normally).
- After Q&A it asks **Run a what-if simulation? (y/n)**. It clones the DataFrame,
  sells a % of one holding, reallocates the proceeds into another holding or a
  defensive asset (`BONDS`, `GOLD`, `CASH`), re-runs the deterministic
  calculations, and re-runs the Advisor in "hypothetical" mode (clearly labelled
  as simulated — your portfolio and CSV are never modified). It can then show the
  before/after allocation pies side by side.

### Accepted CSV formats

The app accepts your holdings CSV in many layouts — it does **not** require the
exact canonical header. The canonical schema used internally is:

```
ticker, name, sector, asset_class, quantity, buy_price, current_price, holding_months
```

Common aliases are recognized automatically, in any order, case- and
punctuation-insensitive (if two columns both claim the same field, you'll get an
ambiguity error rather than a wrong guess):

| Canonical field | Common aliases it accepts |
| --- | --- |
| `ticker` | symbol, code, stock, scrip, instrument code |
| `name` | company, instrument, security, description |
| `sector` | industry, segment, sector name |
| `asset_class` | class, type, asset type, category |
| `quantity` | qty, shares, units, no of shares, holding qty |
| `buy_price` | purchase price, cost, avg cost, price paid, buy value |
| `current_price` | market price, price, last price, ltp, sell price, nav |
| `holding_months` | months held, tenure, holding period, duration |

Value parsing is forgiving too: `₹1,500.00` / `1,500` / `(1,000)` (negative)
work for numbers, and `1y` / `3y` / `5m` / `24` all work for `holding_months`.
Header/name columns are case-insensitive and extra columns (P/E, notes, …) are
ignored. Rows with missing or non-numeric values are **skipped with a warning**
(make sure you're not silently dropping data).

If headers still can't be identified deterministically, the error message shows
you the detected first line and the expected aliases, and you have two ways to
fall back to AI mapping (the model maps source columns → canonical ones, and the
result is re-validated by the deterministic parser):

- Web: a **"Try AI-assisted mapping"** button appears under the CSV editor.
- CLI: re-run with `python main.py --csv yours.csv --llm-map`.

## 6. Web version — GitHub Pages (`docs/`)

GitHub Pages only serves static files (HTML/CSS/JS): it cannot run Python. So the
web build is a small vanilla-JS app that mirrors the CLI pipeline 1:1:

- `docs/index.html`, `docs/style.css` — the app UI.
- `docs/js/tools.js` — the 3 tools + HHI/dispersion/tax-drag re-implemented in
  JS (deterministic, same numbers as the Python side).
- `docs/js/groq.js` — browser client for the Groq API: `groqChat`, the
  function-calling `runToolLoop`, and `chatMultiturn` for the Q&A loop.
- `docs/js/agents.js` — Analyst / Risk / Advisor prompts + steps + Q&A context.
- `docs/js/app.js` — CSV parsing, pipeline orchestration, UI wiring.
- `docs/js/normalize.js` — browser mirror of the CSV normalizer (alias/header
  matching, value coercion, skip+warn) plus `llmMapCsv` for the on-demand
  AI-assisted mapping button.

How it works:

1. The API key is obtained two ways: by default the page calls `GET /api/config`
   and uses the key that the **demo server** (`serve.py`) serves from its
   environment/`.env` (`GROQ_API_KEY`) — or the user picks "Paste my own API key"
   and the key stays **only in their browser** (localStorage) and is sent
   straight to `api.groq.com` with an `Authorization: Bearer` header. Nothing is
   transmitted to any other server, and no key is ever stored in the repo.
   If the page is opened **without** the demo server (e.g. PyCharm's built-in
   preview, `file://`, or GitHub Pages), it detects that `/api/config` is missing
   and **auto-switches to the paste option** with a hint.
2. The user pastes, loads the sample, or **uploads a CSV file** — parsed entirely
   in the browser.
3. The Analyst and Risk agents run the same tool-calling loop as the CLI, but the
   "tools" are the JS functions in `tools.js`.
4. Results appear in a **tabbed report** (view Analyst, Risk, Advisor, or Q&A one
   at a time) with markdown rendered as clean tables/headings, plus a sticky
   right-hand **"Portfolio visuals"** panel of hand-drawn SVG charts (allocation
   donut, sector bars, gain/loss bars, tax bars, HHI/dispersion/tax-drag meters)
   built from the same verified facts.
5. The Advisor produces the grounded advice, then the Q&A panel keeps a growing
   `conversation_history` across questions.

### Important trade-offs (design + security)

- All arithmetic runs client-side in JS — same "deterministic tools, generative
  reasoning" separation. The model only *decides* tool calls and *narrates*
  results.
- The Groq API key living in the browser is **only acceptable for a demo/private
  repo**. Anyone who opens the site (or the repo) can read it from the page
  source or devtools. If you deploy publicly, use a free proxy like a Cloudflare
  Worker to hold the key server-side, or rotate your key after the demo.

### Deploying to GitHub Pages (no build step)

1. Push this repo to GitHub (git init, add, commit, push — or create the repo on
   GitHub first and push into it).
2. In the repo on GitHub: **Settings → Pages → Source: "Deploy from a branch"**,
   branch `main`, folder `/docs`. Save.
3. Wait ~1 minute. Your site is live at
   `https://<username>.github.io/<repo-name>/`.
4. Open it, paste your free Groq key (console.groq.com, Projects → API Keys),
   and hit **Analyze portfolio**.

> The Python CLI at the project root is unaffected — the web app lives entirely
> inside `docs/`.

### Sign-ups you need (all free)

| Service | Why |
| --- | --- |
| GitHub | Host the repo + Pages. |
| Groq | API account + key at console.groq.com (free tier). |

### Running for the hackathon FAQ

- **Is a key / env file in the repo?** No. The CLI reads `GROQ_API_KEY` from your
  environment **or a `.env` file** (gitignored) at runtime. The web version reads
  it either from the demo server's env (served via `/api/config`, never stored in
  files) or from the visitor's own browser (paste option). Only `.env.example`
  (with a placeholder) is committed.
- **When I push to GitHub, do I remove the API key?** There is nothing to remove —
  keys never live in any file in the repo. Anyone cloning gets code only and uses
  their own key with zero code changes (set the env var / `.env`, or paste in the
  page).
- **How do I demo on stage / in the viva?** Two paths from one repo:
  - *CLI:* set `GROQ_API_KEY` (or use `.env`), run `python main.py --no-qa` (or
    with Q&A).
  - *Web:* `.\run.ps1` (or `& .venv\Scripts\python.exe serve.py`), open
    `http://localhost:8000`, press **Load sample data**, hit **Analyze portfolio**
    — the provided env key is used automatically. Judges can also **upload their
    own `.csv`** and ask follow-up questions in plain English.
  - *PyCharm preview / no server:* the page auto-switches to "Paste my own API
    key" — judge pastes their key and it still works.
- **I keep getting "Rate limit reached ... tokens per minute".** That limit is
  Groq's free-tier cap, not ours. Default model is now `openai/gpt-oss-20b`
  (≈2× the token budget of `gpt-oss-120b`), and the app **auto-retries with
  backoff** when Groq returns a 429 (CLI and web), so a spike usually just pauses
  a few seconds and continues on its own. For max quality pass
  `--model openai/gpt-oss-120b`.
- **Why is "no key in source" a good line to say out loud?** It lets you state
  that the only thing in the repo is code — an attacker or a judge gets zero
  credentials from a clone.

---

## 7. Design notes (viva talking points)

- **Why two/three agents?** Separation of concerns. Deterministic computation is
  testable; generative reasoning is not. Pipeline (chain) pattern — one agent's
  output is the next agent's input, no back-and-forth.
- **Why safe numbers?** The LLM only *decides* tool calls; the *arithmetic* is
  plain Python/JS. `structured_findings`/`risk_facts` are rebuilt deterministically
  in code, so even a weird model response cannot corrupt downstream facts.
- **Why current value for allocation?** Risk is about current exposure.
- **Why % and ₹ both?** Context: 50% on a small position ≠ 1% on a large one.
- **Why HHI?** A production-grade single concentration metric; 40% threshold is
  the hackathon simplification, HHI is the shown extension.
- **Why citation grounding?** Prevents generic filler ("diversify!") by forcing
  the Advisor to quote the actual portfolio numbers back.
- **Why the disclaimer?** Responsible-AI practice for a tool that influences
  financial decisions.
- **Why temperature differences?** Facts should be near-deterministic (0.1/0.2);
  prose can vary a little (0.3). `tool_choice="auto"` keeps decisions agentic.

## 8. Project layout

```
main.py                    CLI entry: Analyst → Risk → Advisor → Q&A
llm_client.py              Groq client: chat_completion, chat_multiturn, run_tool_loop
agents/                    analyst_agent.py · risk_agent.py · advisor_agent.py
tools/                     return_calculator.py · allocation_breakdown.py · tax_estimator.py
sample_data/holdings.csv   sample portfolio (820 tax / 8,200 gains / 10% blended)
serve.py                   demo server for the web app (serves docs/ + env/.env key)
run.ps1 · run.sh           one-command web demo launchers (venv setup + opens browser)
docs/                      static GitHub Pages app (HTML + CSS + JS mirror of the CLI)
.env.example               template for your local key (real .env is gitignored)
requirements.txt           groq, pandas
```