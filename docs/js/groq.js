const GROQ_MODEL = "openai/gpt-oss-20b";
const GROQ_ENDPOINT = "https://api.groq.com/openai/v1/chat/completions";
const MAX_RETRIES = 4;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function retryWaitSeconds(message, attempt) {
  const m = message && message.match(/try again in ([\d.]+)\s*s/);
  return m ? parseFloat(m[1]) : 1.5 * Math.pow(2, attempt);
}

async function groqChat(messages, opts = {}) {
  const apiKey = opts.apiKey;
  if (!apiKey) {
    throw new Error("Missing Groq API key — paste it in step 1.");
  }
  const body = {
    model: opts.model || GROQ_MODEL,
    messages,
    temperature: opts.temperature !== undefined ? opts.temperature : 0.7,
  };
  if (opts.tools) {
    body.tools = opts.tools;
    body.tool_choice = opts.tool_choice || "auto";
  }
  let lastError = new Error("Request failed");
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    let res;
    try {
      res = await fetch(GROQ_ENDPOINT, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify(body),
      });
    } catch (err) {
      lastError = err;
      await sleep(1000);
      continue;
    }
    if (res.status === 429 && attempt < MAX_RETRIES - 1) {
      let wait = retryWaitSeconds("", attempt);
      try {
        const errData = await res.json();
        const msg = errData.error && errData.error.message ? errData.error.message : "";
        wait = retryWaitSeconds(msg, attempt);
      } catch (_) {}
      await sleep((wait + 1) * 1000);
      continue;
    }
    if (!res.ok) {
      let detail = `HTTP ${res.status}`;
      try {
        const errData = await res.json();
        detail = errData.error && errData.error.message ? errData.error.message : detail;
      } catch (_) {}
      throw new Error(detail);
    }
    const data = await res.json();
    return data.choices[0].message;
  }
  throw lastError;
}

async function chatMultiturn(messages, opts = {}) {
  return groqChat(messages, { apiKey: opts.apiKey, model: opts.model, temperature: opts.temperature !== undefined ? opts.temperature : 0.3 });
}

async function runToolLoop(messages, registry, schemas, opts = {}) {
  const maxTurns = opts.maxTurns || 4;
  let finalMessage = null;
  for (let i = 0; i < maxTurns; i++) {
    finalMessage = await groqChat(messages, {
      apiKey: opts.apiKey,
      model: opts.model,
      tools: schemas,
      tool_choice: "auto",
      temperature: opts.temperature !== undefined ? opts.temperature : 0.2,
    });
    if (!finalMessage.tool_calls || finalMessage.tool_calls.length === 0) {
      break;
    }
    messages.push({
      role: "assistant",
      content: finalMessage.content || null,
      tool_calls: finalMessage.tool_calls.map((tc) => ({
        id: tc.id,
        type: "function",
        function: {
          name: tc.function.name,
          arguments: tc.function.arguments,
        },
      })),
    });
    for (const tc of finalMessage.tool_calls) {
      const fn = registry[tc.function.name];
      if (!fn) {
        throw new Error(`Unknown tool requested: ${tc.function.name}`);
      }
      let args;
      try {
        args = JSON.parse(tc.function.arguments || "{}");
      } catch (_) {
        args = {};
      }
      const output = await fn(args);
      messages.push({
        role: "tool",
        tool_call_id: tc.id,
        name: tc.function.name,
        content: JSON.stringify(output, null, 2),
      });
    }
  }
  return { message: finalMessage, messages };
}