from __future__ import annotations

import json
import urllib.error
import urllib.parse
import urllib.request
from collections.abc import Mapping
from typing import Any

from gokart_station_adapter.models import AdapterRunRequest

_scheduler_timeout_seconds = 1.5

_scheduler_snapshot_endpoints = (
    ("workers", "worker_list", {"include_running": True}),
    ("runningTasks", "task_list", {"status": "RUNNING", "limit": False}),
    ("batchRunningTasks", "task_list", {"status": "BATCH_RUNNING", "limit": False}),
    ("pendingTasks", "task_list", {"status": "PENDING", "limit": False}),
    ("failedTasks", "task_list", {"status": "FAILED", "limit": False}),
)


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
                "schedulerBaseUrl": None,
                "snapshotSource": "luigid_rpc",
                "completeness": "not_configured",
                "counts": {
                    "running": 0,
                    "batchRunning": 0,
                    "active": 0,
                    "pending": 0,
                    "failed": 0,
                    "workers": 0,
                },
                "healthProbe": {
                    "status": "not_configured",
                    "reason": "schedulerBaseUrl is not configured.",
                },
                "endpoints": {},
                "errors": [],
            },
        }

    scheduler_base_url = request.scheduler_base_url.rstrip("/")
    health_probe = _probe_scheduler_health(scheduler_base_url)

    endpoint_payloads: dict[str, Any] = {}
    errors: list[dict[str, Any]] = []
    counts = {
        "running": 0,
        "batchRunning": 0,
        "active": 0,
        "pending": 0,
        "failed": 0,
        "workers": 0,
    }

    successful_endpoints = 0

    for endpoint_key, rpc_method, rpc_payload in _scheduler_snapshot_endpoints:
        endpoint_result = _fetch_scheduler_rpc(scheduler_base_url, rpc_method, rpc_payload)
        endpoint_payloads[endpoint_key] = endpoint_result["raw"]

        if not endpoint_result["ok"]:
            errors.append(
                {
                    "endpoint": endpoint_key,
                    "rpcMethod": rpc_method,
                    "kind": endpoint_result["kind"],
                    "message": endpoint_result["message"],
                }
            )
            continue

        try:
            if endpoint_key == "workers":
                counts["workers"] = _parse_worker_list(endpoint_result["response"])
            else:
                task_count = _parse_task_list(endpoint_result["response"])
                if endpoint_key == "runningTasks":
                    counts["running"] = task_count
                elif endpoint_key == "batchRunningTasks":
                    counts["batchRunning"] = task_count
                elif endpoint_key == "pendingTasks":
                    counts["pending"] = task_count
                elif endpoint_key == "failedTasks":
                    counts["failed"] = task_count
        except ValueError as error:
            errors.append(
                {
                    "endpoint": endpoint_key,
                    "rpcMethod": rpc_method,
                    "kind": "malformed",
                    "message": str(error),
                }
            )
            endpoint_payloads[endpoint_key] = {
                **endpoint_result["raw"],
                "malformed": True,
                "message": str(error),
            }
            continue

        successful_endpoints += 1

    counts["active"] = counts["running"] + counts["batchRunning"]
    health, completeness = _resolve_snapshot_state(
        probe_health=health_probe["health"],
        successful_endpoints=successful_endpoints,
        total_endpoints=len(_scheduler_snapshot_endpoints),
        errors=errors,
    )

    return {
        "schedulerBaseUrl": scheduler_base_url,
        "health": health,
        "activeTaskCount": counts["active"],
        "pendingTaskCount": counts["pending"],
        "failedTaskCount": counts["failed"],
        "workerCount": counts["workers"],
        "raw": {
            "schedulerBaseUrl": scheduler_base_url,
            "snapshotSource": "luigid_rpc",
            "completeness": completeness,
            "counts": counts,
            "healthProbe": health_probe["raw"],
            "endpoints": endpoint_payloads,
            "errors": errors,
        },
    }


def serialize_scheduler_snapshot(snapshot: dict[str, Any]) -> str:
    return json.dumps(snapshot, ensure_ascii=True, sort_keys=True)


def _probe_scheduler_health(scheduler_base_url: str) -> dict[str, Any]:
    try:
        with urllib.request.urlopen(scheduler_base_url, timeout=_scheduler_timeout_seconds) as response:
            status_code = response.getcode() or 0
            body = response.read(4096).decode("utf-8", errors="replace")

        return {
            "health": "degraded" if status_code >= 500 else "healthy",
            "raw": {
                "url": scheduler_base_url,
                "statusCode": status_code,
                "bodyPreview": body[:512],
            },
        }
    except (urllib.error.URLError, TimeoutError, OSError) as error:
        return {
            "health": "unreachable",
            "raw": {
                "url": scheduler_base_url,
                "error": str(error),
                "errorType": type(error).__name__,
            },
        }


def _fetch_scheduler_rpc(
    scheduler_base_url: str,
    method: str,
    payload: Mapping[str, Any],
) -> dict[str, Any]:
    rpc_url = _build_scheduler_rpc_url(scheduler_base_url, method, payload)

    try:
        with urllib.request.urlopen(rpc_url, timeout=_scheduler_timeout_seconds) as response:
            status_code = response.getcode() or 0
            body = response.read().decode("utf-8", errors="replace")
    except urllib.error.HTTPError as error:
        body = error.read().decode("utf-8", errors="replace")
        return {
            "ok": False,
            "kind": "http_error",
            "message": f"HTTP {error.code} from {rpc_url}",
            "raw": {
                "url": rpc_url,
                "statusCode": error.code,
                "bodyPreview": body[:512],
            },
        }
    except (urllib.error.URLError, TimeoutError, OSError) as error:
        return {
            "ok": False,
            "kind": "unreachable",
            "message": str(error),
            "raw": {
                "url": rpc_url,
                "error": str(error),
                "errorType": type(error).__name__,
            },
        }

    try:
        payload_wrapper = json.loads(body)
    except json.JSONDecodeError as error:
        return {
            "ok": False,
            "kind": "malformed",
            "message": f"Malformed JSON payload from {rpc_url}: {error.msg}",
            "raw": {
                "url": rpc_url,
                "statusCode": status_code,
                "bodyPreview": body[:512],
            },
        }

    if not isinstance(payload_wrapper, Mapping) or "response" not in payload_wrapper:
        return {
            "ok": False,
            "kind": "malformed",
            "message": f"Scheduler RPC payload from {rpc_url} does not include response.",
            "raw": {
                "url": rpc_url,
                "statusCode": status_code,
                "body": payload_wrapper,
            },
        }

    return {
        "ok": True,
        "kind": "ok",
        "message": None,
        "response": payload_wrapper["response"],
        "raw": {
            "url": rpc_url,
            "statusCode": status_code,
            "response": payload_wrapper["response"],
        },
    }


def _build_scheduler_rpc_url(
    scheduler_base_url: str,
    method: str,
    payload: Mapping[str, Any],
) -> str:
    query_string = urllib.parse.urlencode(
        {
            "data": json.dumps(payload, ensure_ascii=True, separators=(",", ":")),
        }
    )
    return f"{scheduler_base_url}/api/{method}?{query_string}"


def _parse_worker_list(response: Any) -> int:
    if not isinstance(response, list):
        raise ValueError("worker_list response must be a list.")

    return len(response)


def _parse_task_list(response: Any) -> int:
    if not isinstance(response, Mapping):
        raise ValueError("task_list response must be an object.")

    if set(response.keys()) == {"num_tasks"} and isinstance(response.get("num_tasks"), int):
        return max(int(response["num_tasks"]), 0)

    return len(response)


def _resolve_snapshot_state(
    *,
    probe_health: str,
    successful_endpoints: int,
    total_endpoints: int,
    errors: list[dict[str, Any]],
) -> tuple[str, str]:
    if successful_endpoints == 0:
        if probe_health == "unreachable" or any(error["kind"] == "unreachable" for error in errors):
            return "unreachable", "unavailable"
        if errors and all(error["kind"] == "malformed" for error in errors):
            return "degraded", "malformed"
        return "degraded", "unavailable"

    if successful_endpoints < total_endpoints:
        return "partial", "partial"

    if probe_health == "degraded":
        return "degraded", "complete"

    return "healthy", "complete"
