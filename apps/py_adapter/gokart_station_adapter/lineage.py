from __future__ import annotations

import re
from pathlib import Path
from typing import Any

from gokart_station_adapter.models import AdapterRunRequest


def build_tasks(request: AdapterRunRequest) -> list[dict[str, Any]]:
    parameters = _task_parameters(request)
    task_plan = _task_plan_for_root_task(request.spec.root_task_name)

    tasks: list[dict[str, Any]] = []
    for task_name, upstream_task_names, downstream_task_names in task_plan:
        outputs = [str(_task_output_path(request, task_name, parameters).resolve())]

        tasks.append(
            {
                "taskName": task_name,
                "uniqueId": _build_unique_id(task_name, parameters),
                "state": "PENDING",
                "parameters": dict(parameters),
                "outputs": outputs,
                "processingTimeSec": None,
                "taskLog": {"entries": []},
                "rerunReason": _build_rerun_reason(request),
                "codeVersionHint": None,
                "upstreamUniqueIds": [
                    _build_unique_id(upstream_task_name, parameters)
                    for upstream_task_name in upstream_task_names
                ],
                "downstreamUniqueIds": [
                    _build_unique_id(downstream_task_name, parameters)
                    for downstream_task_name in downstream_task_names
                ],
            }
        )

    return tasks


def build_task_info_tree(tasks: list[dict[str, Any]]) -> dict[str, Any]:
    if not tasks:
        return {"tasks": []}

    task_map = {task["uniqueId"]: task for task in tasks}
    root_task = next(
        (task for task in tasks if len(task["downstreamUniqueIds"]) == 0),
        tasks[-1],
    )

    return _build_tree_node(root_task, task_map)


def build_task_info_table(tasks: list[dict[str, Any]]) -> list[dict[str, Any]]:
    return [
        {
            "taskName": task["taskName"],
            "uniqueId": task["uniqueId"],
            "state": task["state"],
            "parameters": task["parameters"],
            "outputs": task["outputs"],
            "processingTimeSec": task["processingTimeSec"],
            "taskLog": task["taskLog"],
            "rerunReason": task["rerunReason"],
            "codeVersionHint": task["codeVersionHint"],
            "upstreamUniqueIds": task["upstreamUniqueIds"],
            "downstreamUniqueIds": task["downstreamUniqueIds"],
        }
        for task in tasks
    ]


def task_for_unique_id(tasks: list[dict[str, Any]], unique_id: str) -> dict[str, Any] | None:
    return next((task for task in tasks if task["uniqueId"] == unique_id), None)


def _build_tree_node(task: dict[str, Any], task_map: dict[str, dict[str, Any]]) -> dict[str, Any]:
    return {
        "taskName": task["taskName"],
        "uniqueId": task["uniqueId"],
        "state": task["state"],
        "parameters": task["parameters"],
        "outputs": task["outputs"],
        "processingTimeSec": task["processingTimeSec"],
        "taskLog": task["taskLog"],
        "rerunReason": task["rerunReason"],
        "codeVersionHint": task["codeVersionHint"],
        "children": [
            _build_tree_node(task_map[unique_id], task_map)
            for unique_id in task["upstreamUniqueIds"]
            if unique_id in task_map
        ],
    }


def _task_plan_for_root_task(root_task_name: str) -> list[tuple[str, list[str], list[str]]]:
    if root_task_name == "PublishReport":
        return [
            ("PrepareInput", [], ["RenderReport"]),
            ("RenderReport", ["PrepareInput"], ["PublishReport"]),
            ("PublishReport", ["RenderReport"], []),
        ]

    if root_task_name == "BrokenReport":
        return [
            ("PrepareInput", [], ["RenderReport"]),
            ("RenderReport", ["PrepareInput"], ["BrokenReport"]),
            ("BrokenReport", ["RenderReport"], []),
        ]

    if root_task_name == "ImmediateFailure":
        return [("ImmediateFailure", [], [])]

    if root_task_name == "PartialFailureReport":
        return [
            ("PrepareInput", [], ["RenderReport"]),
            ("RenderReport", ["PrepareInput"], ["PublishReport", "BrokenReport"]),
            ("PublishReport", ["RenderReport"], ["PartialFailureReport"]),
            ("BrokenReport", ["RenderReport"], ["PartialFailureReport"]),
            ("PartialFailureReport", ["PublishReport", "BrokenReport"], []),
        ]

    return [(root_task_name, [], [])]


def _task_parameters(request: AdapterRunRequest) -> dict[str, Any]:
    return {
        "message": request.spec.parameters.get("message", "hello from gokart-station"),
        "report_date": request.spec.parameters.get("report_date", "2026-04-15"),
        "rerun_token": request.spec.parameters.get("rerun_token", "baseline"),
    }


def _build_rerun_reason(request: AdapterRunRequest) -> str | None:
    if request.spec.rerun_mode == "none":
        return None

    if request.spec.rerun_mode == "same_spec":
        return "same_spec_manual"

    return request.spec.rerun_mode


def _task_output_path(
    request: AdapterRunRequest,
    task_name: str,
    parameters: dict[str, Any],
) -> Path:
    workspace_root = Path(request.workspace_directory).expanduser().resolve()
    report_date = str(parameters["report_date"])
    rerun_token = str(parameters["rerun_token"])

    if task_name == "PrepareInput":
        return workspace_root / "prepare" / f"{report_date}-{rerun_token}-payload.json"

    if task_name == "RenderReport":
        return workspace_root / "reports" / f"{report_date}-{rerun_token}-report.txt"

    if task_name == "PublishReport":
        return workspace_root / "published" / f"{report_date}-{rerun_token}-metadata.json"

    if task_name == "BrokenReport":
        return workspace_root / "failed" / f"{report_date}-{rerun_token}-broken.json"

    if task_name == "ImmediateFailure":
        return workspace_root / "failed" / f"{report_date}-{rerun_token}-immediate.json"

    if task_name == "PartialFailureReport":
        return workspace_root / "partial" / f"{report_date}-{rerun_token}-summary.json"

    safe_task_name = re.sub(r"[^a-zA-Z0-9_.-]+", "_", task_name)
    return workspace_root / "misc" / f"{safe_task_name}-{rerun_token}.json"


def _build_unique_id(task_name: str, parameters: dict[str, Any]) -> str:
    report_date = str(parameters["report_date"])
    rerun_token = str(parameters["rerun_token"])
    raw_identifier = f"{task_name}(report_date={report_date},rerun_token={rerun_token})"
    return re.sub(r"[^a-zA-Z0-9_.=(),-]+", "_", raw_identifier)
