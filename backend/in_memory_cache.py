from __future__ import annotations

from threading import RLock
from time import monotonic
from typing import Any


_LOCK = RLock()
_STORE: dict[str, tuple[float, Any]] = {}


def cache_get(key: str):
    now = monotonic()
    with _LOCK:
        entry = _STORE.get(key)
        if entry is None:
            return None
        expires_at, value = entry
        if expires_at <= now:
            _STORE.pop(key, None)
            return None
        return value


def cache_set(key: str, value: Any, ttl_seconds: float):
    ttl = max(0.0, float(ttl_seconds))
    with _LOCK:
        _STORE[key] = (monotonic() + ttl, value)


def cache_delete(key: str):
    with _LOCK:
        _STORE.pop(key, None)


def cache_delete_prefix(prefix: str):
    with _LOCK:
        keys = [key for key in _STORE.keys() if key.startswith(prefix)]
        for key in keys:
            _STORE.pop(key, None)


def cache_clear():
    with _LOCK:
        _STORE.clear()
