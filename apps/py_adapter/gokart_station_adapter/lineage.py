from __future__ import annotations

from pathlib import Path
from typing import Any


def load_task_info_json(path: Path | None) -> Any | None:
    if path is None or not path.exists():
        return None

    return _read_json(path)


def normalize_task_info_tree(raw_tree: Any) -> dict[str, Any] | None:
    if not isinstance(raw_tree, dict):
        return None

    return {
        "taskName": _coerce_string(raw_tree.get("taskName"), "unknown"),
        "uniqueId": _coerce_string(raw_tree.get("uniqueId"), "unknown"),
        "state": _coerce_string(raw_tree.get("state"), "UNKNOWN"),
        "parameters": _coerce_mapping(raw_tree.get("parameters")),
        "outputs": _coerce_string_list(raw_tree.get("outputs")),
        "processingTimeSec": _coerce_optional_float(raw_tree.get("processingTimeSec")),
        "taskLog": _normalize_task_log(raw_tree.get("taskLog")),
        "rerunReason": _coerce_optional_string(raw_tree.get("rerunReason")),
        "codeVersionHint": _coerce_optional_string(raw_tree.get("codeVersionHint")),
        "children": [
            normalized_child
            for child in _coerce_list(raw_tree.get("children"))
            if (normalized_child := normalize_task_info_tree(child)) is not None
        ],
    }


def normalize_task_info_table(raw_table: Any, rerun_reason: str | None = None) -> list[dict[str, Any]]:
    normalized_entries: list[dict[str, Any]] = []
    for raw_entry in _coerce_list(raw_table):
        if not isinstance(raw_entry, dict):
            continue

        task_name = _coerce_string(raw_entry.get("taskName"), "")
        unique_id = _coerce_string(raw_entry.get("uniqueId"), "")
        if task_name == "" or unique_id == "":
            continue

        normalized_entries.append(
            {
                "taskName": task_name,
                "uniqueId": unique_id,
                "state": _coerce_string(raw_entry.get("state"), "UNKNOWN"),
                "parameters": _coerce_mapping(raw_entry.get("parameters")),
                "outputs": _coerce_string_list(raw_entry.get("outputs")),
                "processingTimeSec": _coerce_optional_float(raw_entry.get("processingTimeSec")),
                "taskLog": _normalize_task_log(raw_entry.get("taskLog")),
                "rerunReason": _coerce_optional_string(raw_entry.get("rerunReason"))
                or rerun_reason,
                "codeVersionHint": _coerce_optional_string(raw_entry.get("codeVersionHint")),
                "upstreamUniqueIds": _coerce_string_list(raw_entry.get("upstreamUniqueIds")),
                "downstreamUniqueIds": _coerce_string_list(raw_entry.get("downstreamUniqueIds")),
            }
        )

    return normalized_entries


def build_rerun_reason(rerun_mode: str) -> str | None:
    if rerun_mode == "none":
        return None
    if rerun_mode == "same_spec":
        return "same_spec_manual"
    return rerun_mode


def _read_json(path: Path) -> Any:
    import json

    return json.loads(path.read_text(encoding="utf-8"))


def _coerce_list(value: Any) -> list[Any]:
    return list(value) if isinstance(value, list) else []


def _coerce_mapping(value: Any) -> dict[str, Any]:
    if not isinstance(value, dict):
        return {}

    return {str(key): entry_value for key, entry_value in value.items()}


def _coerce_string(value: Any, fallback: str) -> str:
    if isinstance(value, str):
        return value
    if value is None:
        return fallback
    return str(value)


def _coerce_optional_string(value: Any) -> str | None:
    if value is None:
        return None
    if isinstance(value, str):
        return value
    return str(value)


def _coerce_string_list(value: Any) -> list[str]:
    if not isinstance(value, list):
        return []
    return [_coerce_string(entry, "") for entry in value if _coerce_string(entry, "") != ""]


def _coerce_optional_float(value: Any) -> float | None:
    if value is None:
        return None
    if isinstance(value, bool):
        return None
    if isinstance(value, (int, float)):
        return float(value)
    if isinstance(value, str):
        try:
            return float(value)
        except ValueError:
            return None
    return None


def _normalize_task_log(value: Any) -> dict[str, Any]:
    task_log = value if isinstance(value, dict) else {}
    entries = _coerce_list(task_log.get("entries"))
    normalized_entries: list[dict[str, str]] = []
    for entry in entries:
        if not isinstance(entry, dict):
            continue
        normalized_entries.append(
            {
                "at": _coerce_string(entry.get("at"), ""),
                "stream": _coerce_string(entry.get("stream"), "stdout"),
                "line": _coerce_string(entry.get("line"), ""),
            }
        )

    return {"entries": normalized_entries}
