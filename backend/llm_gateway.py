"""LLM gateway: routes every call through Bifrost (OpenAI-compatible) when BIFROST_BASE_URL is set, else Emergent key."""
import json
import os
import re
import time
import uuid

from runtime import llm_retryable, with_retries

BIFROST_BASE_URL = os.environ.get("BIFROST_BASE_URL", "").strip().rstrip("/")
EXTRACT_MODEL = os.environ.get("EXTRACT_MODEL") or "openai/gpt-5.4-mini"
VERDICT_MODEL = os.environ.get("VERDICT_MODEL") or "openai/gpt-5.4"
ROUTE = "bifrost" if BIFROST_BASE_URL else "direct"

_client = None


class GatewayError(Exception):
    def __init__(self, message: str, log: dict):
        super().__init__(message)
        self.log = log


def _bifrost_client():
    global _client
    if _client is None:
        from openai import AsyncOpenAI
        base = BIFROST_BASE_URL if BIFROST_BASE_URL.endswith("/v1") else f"{BIFROST_BASE_URL}/v1"
        _client = AsyncOpenAI(base_url=base, api_key=os.environ.get("BIFROST_API_KEY") or "bifrost-local")
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
    log = {"kind": "llm", "stage": stage, "ref": ref, "model": model, "route": ROUTE,
           "prompt_tokens": 0, "completion_tokens": 0, "status": "ok"}
    try:
        call = _call_bifrost if BIFROST_BASE_URL else _call_direct
        text, log["prompt_tokens"], log["completion_tokens"] = await with_retries(
            lambda: call(model, system, prompt), llm_retryable)
        data = parse_json(text)
    except Exception as exc:
        log.update(status="error", error=str(exc)[:200], latency_ms=round((time.perf_counter() - start) * 1000))
        raise GatewayError(str(exc), log) from exc
    log["latency_ms"] = round((time.perf_counter() - start) * 1000)
    return data, log
