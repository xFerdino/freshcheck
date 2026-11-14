"""LLM gateway: routes every call through Bifrost (OpenAI-compatible) when BIFROST_BASE_URL is set, else Emergent key."""
import json
import os
import re
import time
import uuid

from runtime import llm_retryable, with_retries

BIFROST_BASE_URL = os.environ.get("BIFROST_BASE_URL", "").strip().rstrip("/")

if os.environ.get("OPENROUTER_API_KEY") and not os.environ.get("OPENAI_API_KEY"):
    _default_extract = "openrouter/openai/gpt-4o-mini"
    _default_verdict = "openrouter/openai/gpt-4o"
else:
    _default_extract = "openai/gpt-4o-mini"
    _default_verdict = "openai/gpt-4o"

EXTRACT_MODEL = os.environ.get("EXTRACT_MODEL") or _default_extract
VERDICT_MODEL = os.environ.get("VERDICT_MODEL") or _default_verdict


def get_bifrost_base_url() -> str:
    return os.environ.get("BIFROST_BASE_URL", "").strip().rstrip("/")


def get_route() -> str:
    return "bifrost" if get_bifrost_base_url() else "direct"


ROUTE = get_route()

_client = None
_client_key = None


class GatewayError(Exception):
    def __init__(self, message: str, log: dict):
        super().__init__(message)
        self.log = log


def _bifrost_client():
    global _client, _client_key
    base_url = get_bifrost_base_url()
    api_key = os.environ.get("BIFROST_API_KEY") or "bifrost-local"
    current_key = (base_url, api_key)
    if _client is None or _client_key != current_key:
        from openai import AsyncOpenAI
        base = base_url if base_url.endswith("/v1") else f"{base_url}/v1"
        _client = AsyncOpenAI(base_url=base, api_key=api_key)
        _client_key = current_key
    return _client


def parse_json(text: str) -> dict:
    m = re.search(r"\{.*\}", text or "", re.S)
    return json.loads(m.group(0) if m else text)


async def _call_bifrost(model: str, system: str, prompt: str):
    resp = await _bifrost_client().chat.completions.create(
        model=model,
        messages=[{"role": "system", "content": system}, {"role": "user", "content": prompt}],
        response_format={"type": "json_object"},
    )
    u = resp.usage
    return resp.choices[0].message.content, (u.prompt_tokens if u else 0), (u.completion_tokens if u else 0)


async def _call_direct(model: str, system: str, prompt: str):
    from emergentintegrations.llm.chat import LlmChat, UserMessage
    provider, name = model.split("/", 1) if "/" in model else ("openai", model)
    chat = LlmChat(api_key=os.environ["EMERGENT_LLM_KEY"], session_id=str(uuid.uuid4()), system_message=system)
    chat.with_model(provider, name)
    r = await chat.send_message_with_tools(UserMessage(text=prompt))
    return r.content, r.usage.input_tokens, r.usage.output_tokens


async def chat_json(model: str, system: str, prompt: str, stage: str, ref: str = None):
    """Returns (parsed_json, log). Raises GatewayError carrying the log on failure."""
    start = time.perf_counter()
    bifrost_url = get_bifrost_base_url()
    route = "bifrost" if bifrost_url else "direct"
    log = {"kind": "llm", "stage": stage, "ref": ref, "model": model, "route": route,
           "prompt_tokens": 0, "completion_tokens": 0, "status": "ok"}
    try:
        call = _call_bifrost if bifrost_url else _call_direct
        text, log["prompt_tokens"], log["completion_tokens"] = await with_retries(
            lambda: call(model, system, prompt), llm_retryable)
        data = parse_json(text)
    except Exception as exc:
        log.update(status="error", error=str(exc)[:200], latency_ms=round((time.perf_counter() - start) * 1000))
        raise GatewayError(str(exc), log) from exc
    log["latency_ms"] = round((time.perf_counter() - start) * 1000)
    return data, log
