from __future__ import annotations

import json
import urllib.error
import urllib.request
from typing import Any

from gokart_station_adapter.models import AdapterRunRequest


def collect_scheduler_snapshot(request: AdapterRunRequest) -> dict[str, Any]:
    if not request.scheduler_base_url:
        return {
            "schedulerBaseUrl": None,
            "health": "unknown",
            "activeTaskCount": 0,
            "pendingTaskCount": 0,
            "failedTaskCount": 0,
            "workerCount": 0,
            "raw": {
                "reason": "schedulerBaseUrl is not configured.",
            },
        }

    try:
        with urllib.request.urlopen(request.scheduler_base_url, timeout=1.5) as response:
            status_code = response.getcode() or 0
            body = response.read(4096).decode("utf-8", errors="replace")

        return {
            "schedulerBaseUrl": request.scheduler_base_url,
            "health": "degraded" if status_code >= 500 else "healthy",
            "activeTaskCount": 0,
            "pendingTaskCount": 0,
            "failedTaskCount": 0,
            "workerCount": 0,
            "raw": {
                "statusCode": status_code,
                "bodyPreview": body[:512],
            },
        }
    except (urllib.error.URLError, TimeoutError, OSError) as error:
        return {
            "schedulerBaseUrl": request.scheduler_base_url,
            "health": "unreachable",
            "activeTaskCount": 0,
            "pendingTaskCount": 0,
            "failedTaskCount": 0,
            "workerCount": 0,
            "raw": {
                "error": str(error),
            },
        }


def serialize_scheduler_snapshot(snapshot: dict[str, Any]) -> str:
    return json.dumps(snapshot, ensure_ascii=True, sort_keys=True)
