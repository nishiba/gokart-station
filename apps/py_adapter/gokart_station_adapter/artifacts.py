from __future__ import annotations

import json
import mimetypes
import re
from pathlib import Path
from typing import Any

from gokart_station_adapter.models import AdapterRunRequest


def discover_artifacts(
    request: AdapterRunRequest,
    tasks: list[dict[str, Any]],
    task_info_tree: dict[str, Any],
    task_info_table: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    artifact_directory = _artifact_directory(request)
    artifact_directory.mkdir(parents=True, exist_ok=True)

    artifacts: list[dict[str, Any]] = []
    for task in tasks:
        task_artifact_directory = artifact_directory / "tasks" / _safe_path_component(task["taskName"])
        task_artifact_directory.mkdir(parents=True, exist_ok=True)

        for output_path in task["outputs"]:
            output_file = Path(output_path)
            if output_file.exists():
                artifacts.append(
                    _build_manifest_entry(
                        request,
                        output_file,
                        "output",
                        task_name=task["taskName"],
                        unique_id=task["uniqueId"],
                    )
                )

        task_log_path = task_artifact_directory / "task-log.json"
        artifacts.append(
            _write_json_artifact(
                request,
                task_log_path,
                "task_log",
                task["taskLog"],
                task_name=task["taskName"],
                unique_id=task["uniqueId"],
            )
        )

        task_params_path = task_artifact_directory / "task-params.json"
        artifacts.append(
            _write_json_artifact(
                request,
                task_params_path,
                "task_params",
                task["parameters"],
                task_name=task["taskName"],
                unique_id=task["uniqueId"],
            )
        )

        processing_time_path = task_artifact_directory / "processing-time.json"
        artifacts.append(
            _write_json_artifact(
                request,
                processing_time_path,
                "processing_time",
                {"processingTimeSec": task["processingTimeSec"]},
                task_name=task["taskName"],
                unique_id=task["uniqueId"],
            )
        )

    if request.spec.capture_task_info_tree:
        tree_path = artifact_directory / "task-info-tree.json"
        artifacts.append(
            _write_json_artifact(
                request,
                tree_path,
                "task_info_tree",
                task_info_tree,
                task_name=tasks[-1]["taskName"],
                unique_id=tasks[-1]["uniqueId"],
            )
        )

    if request.spec.capture_task_info_table:
        table_path = artifact_directory / "task-info-table.json"
        artifacts.append(
            _write_json_artifact(
                request,
                table_path,
                "task_info_table",
                task_info_table,
                task_name=tasks[-1]["taskName"],
                unique_id=tasks[-1]["uniqueId"],
            )
        )

    return artifacts


def raw_task_info_tree_path(request: AdapterRunRequest) -> Path:
    return _artifact_directory(request) / "task-info-tree.json"


def raw_task_info_table_path(request: AdapterRunRequest) -> Path:
    return _artifact_directory(request) / "task-info-table.json"


def _artifact_directory(request: AdapterRunRequest) -> Path:
    return Path(request.workspace_directory).resolve() / ".gokart-station" / "adapter" / request.run_id


def _write_json_artifact(
    request: AdapterRunRequest,
    artifact_path: Path,
    kind: str,
    payload: Any,
    *,
    task_name: str,
    unique_id: str,
) -> dict[str, Any]:
    artifact_path.write_text(
        json.dumps(payload, ensure_ascii=True, indent=2, sort_keys=True),
        encoding="utf-8",
    )

    return _build_manifest_entry(
        request,
        artifact_path,
        kind,
        task_name=task_name,
        unique_id=unique_id,
    )


def _build_manifest_entry(
    request: AdapterRunRequest,
    artifact_path: Path,
    kind: str,
    *,
    task_name: str,
    unique_id: str,
) -> dict[str, Any]:
    resolved_path = artifact_path.resolve()
    mime_type, _ = mimetypes.guess_type(resolved_path.name)
    effective_mime_type = mime_type or "application/octet-stream"

    return {
        "kind": kind,
        "absolutePath": str(resolved_path),
        "relativePath": str(resolved_path.relative_to(Path(request.workspace_directory).resolve())),
        "sizeBytes": artifact_path.stat().st_size,
        "mimeType": effective_mime_type,
        "previewable": _is_previewable(effective_mime_type),
        "taskName": task_name,
        "uniqueId": unique_id,
    }


def _is_previewable(mime_type: str) -> bool:
    return (
        mime_type.startswith("text/")
        or mime_type == "application/json"
        or mime_type == "application/x-ndjson"
    )


def _safe_path_component(value: str) -> str:
    return re.sub(r"[^a-zA-Z0-9_.-]+", "_", value)
