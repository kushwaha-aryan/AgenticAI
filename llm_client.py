import json
import os
import re
import sys
import time

from groq import Groq, RateLimitError

DEFAULT_MODEL = "openai/gpt-oss-20b"
MAX_ATTEMPTS = 4


def load_dotenv():
    path = os.path.join(os.path.dirname(os.path.abspath(__file__)), ".env")
    if not os.path.exists(path):
        return
    with open(path, encoding="utf-8-sig") as fh:
        for line in fh:
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, _, value = line.partition("=")
            key = key.strip()
            value = value.strip().strip('"').strip("'")
            if key and key not in os.environ:
                os.environ[key] = value


load_dotenv()


def _get_client():
    api_key = os.environ.get("GROQ_API_KEY") or os.environ.get("GROQ_KEY")
    if not api_key:
        raise RuntimeError(
            "GROQ_API_KEY environment variable is not set. "
            "Set it to your Groq API key (or add a .env file) before running the advisor."
        )
    return Groq(api_key=api_key)


def _assistant_tool_message(message):
    return {
        "role": "assistant",
        "content": message.content,
        "tool_calls": [
            {
                "id": call.id,
                "type": "function",
                "function": {
                    "name": call.function.name,
                    "arguments": call.function.arguments,
                },
            }
            for call in (message.tool_calls or [])
        ],
    }


def _wait_seconds_on_rate_limit(exc):
    match = re.search(r"try again in ([\d.]+)\s*s", str(exc))
    return float(match.group(1)) if match else None


def _create_with_retries(client, **kwargs):
    last_error = None
    for attempt in range(MAX_ATTEMPTS):
        try:
            return client.chat.completions.create(**kwargs)
        except RateLimitError as exc:
            last_error = exc
            wait = _wait_seconds_on_rate_limit(exc)
            if wait is None:
                wait = 1.5 * (2**attempt)
            print(
                f"[rate limit] Groq is busy, retrying in {wait + 1.0:.1f}s "
                f"(attempt {attempt + 1}/{MAX_ATTEMPTS})...",
                file=sys.stderr,
            )
            time.sleep(wait + 1.0)
    raise last_error


def chat_completion(
    messages, *, model=DEFAULT_MODEL, tools=None, tool_choice="auto", temperature=0.7
):
    kwargs = {"model": model, "messages": messages, "temperature": temperature}
    if tools is not None:
        kwargs["tools"] = tools
        kwargs["tool_choice"] = tool_choice
    response = _create_with_retries(_get_client(), **kwargs)
    return response.choices[0].message


def chat_multiturn(messages, *, model=DEFAULT_MODEL, temperature=0.3):
    return chat_completion(messages, model=model, tools=None, temperature=temperature)


def run_tool_loop(
    messages,
    tool_registry,
    tool_schemas,
    *,
    model=DEFAULT_MODEL,
    temperature=0.2,
    max_turns=4,
):
    final_message = None
    for _ in range(max_turns):
        final_message = chat_completion(
            messages,
            model=model,
            tools=tool_schemas,
            tool_choice="auto",
            temperature=temperature,
        )
        if not final_message.tool_calls:
            break
        messages.append(_assistant_tool_message(final_message))
        for call in final_message.tool_calls:
            function = tool_registry.get(call.function.name)
            if function is None:
                raise ValueError(f"Unknown tool requested: {call.function.name}")
            try:
                arguments = json.loads(call.function.arguments or "{}")
            except json.JSONDecodeError:
                arguments = {}
            output = function(**arguments)
            messages.append(
                {
                    "role": "tool",
                    "tool_call_id": call.id,
                    "name": call.function.name,
                    "content": json.dumps(output, indent=2, default=str),
                }
            )
    return final_message, messages