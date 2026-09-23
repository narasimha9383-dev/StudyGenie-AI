"""Small bounded TTL cache used by AI processing services."""

from __future__ import annotations

import time
from collections import OrderedDict
from threading import RLock
from typing import Generic, Optional, Tuple, TypeVar


T = TypeVar("T")


class TTLCache(Generic[T]):
    """Thread-safe bounded cache with deterministic expiration."""

    def __init__(self, max_size: int = 256, ttl_seconds: int = 900):
        self.max_size = max(1, int(max_size))
        self.ttl_seconds = max(1, int(ttl_seconds))
        self._items: "OrderedDict[str, Tuple[float, T]]" = OrderedDict()
        self._lock = RLock()

    def get(self, key: str) -> Optional[T]:
        with self._lock:
            item = self._items.get(key)
            if item is None:
                return None
            expires_at, value = item
            if expires_at <= time.monotonic():
                self._items.pop(key, None)
                return None
            self._items.move_to_end(key)
            return value

    def set(self, key: str, value: T) -> None:
        with self._lock:
            self._items[key] = (time.monotonic() + self.ttl_seconds, value)
            self._items.move_to_end(key)
            while len(self._items) > self.max_size:
                self._items.popitem(last=False)

    def delete(self, key: str) -> None:
        with self._lock:
            self._items.pop(key, None)

    def clear(self) -> None:
        with self._lock:
            self._items.clear()

    def __len__(self) -> int:
        with self._lock:
            return len(self._items)
