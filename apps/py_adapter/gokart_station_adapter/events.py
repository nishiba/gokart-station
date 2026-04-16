from __future__ import annotations

import json
import signal
import sys
import threading
from dataclasses import dataclass, field
from datetime import UTC, datetime
from typing import Any, Callable


def utc_now_iso() -> str:
    return datetime.now(UTC).isoformat().replace("+00:00", "Z")


@dataclass(slots=True)
class StopController:
    _stop_requested: threading.Event = field(default_factory=threading.Event)

    def install_signal_handlers(self) -> None:
        def _handle_signal(signum: int, _frame: Any) -> None:
            self.request_stop(f"signal:{signum}")

        signal.signal(signal.SIGTERM, _handle_signal)
        signal.signal(signal.SIGINT, _handle_signal)

    def request_stop(self, _reason: str | None = None) -> None:
        self._stop_requested.set()

    @property
    def should_stop(self) -> bool:
        return self._stop_requested.is_set()


class JsonLineEventWriter:
    def __init__(
        self,
        stdout_write: Callable[[str], int] | None = None,
        stderr_write: Callable[[str], int] | None = None,
    ) -> None:
        self._stdout_write = stdout_write or sys.stdout.write
        self._stderr_write = stderr_write or sys.stderr.write

    def emit(self, event_type: str, run_id: str, **payload: Any) -> dict[str, Any]:
        event = {
            "type": event_type,
            "runId": run_id,
            "at": utc_now_iso(),
            **payload,
        }
        self._stdout_write(f"{json.dumps(event, ensure_ascii=True)}\n")
        sys.stdout.flush()
        return event

    def debug(self, message: str) -> None:
        self._stderr_write(f"{message}\n")
        sys.stderr.flush()
