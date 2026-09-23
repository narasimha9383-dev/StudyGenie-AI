"""Process-local AI metrics. Persistence remains owned by the Node backend."""

from __future__ import annotations

from collections import Counter
from threading import Lock
from typing import Dict


class AnalyticsService:
    def __init__(self):
        self._counts = Counter()
        self._lock = Lock()

    def record(self, event: str, amount: int = 1) -> None:
        with self._lock:
            self._counts[event] += max(0, int(amount))

    def snapshot(self) -> Dict[str, int]:
        with self._lock:
            return dict(self._counts)

    def reset(self) -> None:
        with self._lock:
            self._counts.clear()


analytics_service = AnalyticsService()
