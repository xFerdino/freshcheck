"""In-memory runtime helpers: rate limiting, run store, TTL cache, retries, date parsing."""
import asyncio
import math
import time
from collections import OrderedDict, deque
from datetime import datetime, timezone
from email.utils import parsedate_to_datetime
from typing import Optional

import httpx


class RateLimiter:
    def __init__(self, limit: int, window: float, clock=time.monotonic):
        self.limit, self.window, self.clock = limit, window, clock
        self.hits: dict = {}

    def hit(self, key: str) -> int:
        """Records a hit. Returns 0 if allowed, else seconds until the next slot frees up."""
        now = self.clock()
        q = self.hits.setdefault(key, deque())
        while q and now - q[0] >= self.window:
            q.popleft()
        if len(q) >= self.limit:
            return max(1, math.ceil(self.window - (now - q[0])))
        q.append(now)
        if len(self.hits) > 10000:
            self.hits = {k: v for k, v in self.hits.items() if v and now - v[-1] < self.window}
        return 0


class LRU:
    def __init__(self, max_items: int):
        self.max_items = max_items
        self.data: OrderedDict = OrderedDict()

    def get(self, key):
        if key not in self.data:
            return None
        self.data.move_to_end(key)
        return self.data[key]

    def set(self, key, value):
        self.data[key] = value
        self.data.move_to_end(key)
        while len(self.data) > self.max_items:
            self.data.popitem(last=False)


class TTLCache(LRU):
    def __init__(self, ttl: float, max_items: int, clock=time.monotonic):
        super().__init__(max_items)
        self.ttl, self.clock = ttl, clock

    def get(self, key):
        item = super().get(key)
        if item is None:
            return None
        ts, value = item
        if self.clock() - ts > self.ttl:
            self.data.pop(key, None)
            return None
        return value

    def set(self, key, value):
        super().set(key, (self.clock(), value))


async def with_retries(fn, is_retryable, retries: int = 2, base_delay: float = 0.5):
    attempt = 0
    while True:
        try:
            return await fn()
        except Exception as exc:
            if attempt >= retries or not is_retryable(exc):
                raise
            await asyncio.sleep(base_delay * (3 ** attempt))
            attempt += 1


def http_retryable(exc: Exception) -> bool:
    if isinstance(exc, httpx.HTTPStatusError):
        s = exc.response.status_code
        return s == 429 or s >= 500
    return isinstance(exc, (httpx.TimeoutException, httpx.TransportError, asyncio.TimeoutError))


def llm_retryable(exc: Exception) -> bool:
    status = getattr(exc, "status_code", None) or getattr(getattr(exc, "response", None), "status_code", None)
    if isinstance(status, int):
        return status == 429 or status >= 500
    name = type(exc).__name__.lower()
    return isinstance(exc, asyncio.TimeoutError) or any(
        k in name for k in ("timeout", "ratelimit", "serviceunavailable", "internalserver", "apiconnection"))


def parse_date(value) -> Optional[datetime]:
    if not value:
        return None
    s = str(value).strip()
    for parse in (lambda x: datetime.fromisoformat(x.replace("Z", "+00:00")), parsedate_to_datetime):
        try:
            d = parse(s)
            return d if d.tzinfo else d.replace(tzinfo=timezone.utc)
        except (ValueError, TypeError, IndexError):
            continue
    return None


def client_ip(request, trusted_hops: int = 2) -> str:
    """Client IP from CF-Connecting-IP, X-Real-IP, or X-Forwarded-For (Cloudflare & proxy safe)."""
    cf_ip = request.headers.get("cf-connecting-ip")
    if cf_ip and cf_ip.strip():
        return cf_ip.strip()
    real_ip = request.headers.get("x-real-ip")
    if real_ip and real_ip.strip():
        return real_ip.strip()
    xff = [p.strip() for p in (request.headers.get("x-forwarded-for") or "").split(",") if p.strip()]
    if xff:
        return xff[-(trusted_hops + 1)] if len(xff) > trusted_hops else xff[0]
    return request.client.host if request.client else "unknown"
