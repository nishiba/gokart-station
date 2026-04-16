from __future__ import annotations

import json
import time
import traceback
from pathlib import Path
from typing import Any

from gokart_station_adapter.artifacts import discover_artifacts
from gokart_station_adapter.events import JsonLineEventWriter, StopController, utc_now_iso
from gokart_station_adapter.lineage import build_task_info_table, build_task_info_tree, build_tasks
from gokart_station_adapter.models import AdapterRunRequest
from gokart_station_adapter.profiles import (
    build_runtime_configuration,
    build_runtime_environment,
    masked_environment_preview,
)
from gokart_station_adapter.scheduler import collect_scheduler_snapshot


def run_adapter(request: AdapterRunRequest) -> int:
    writer = JsonLineEventWriter()
    stop_controller = StopController()
    stop_controller.install_signal_handlers()
    resolved_entrypoint_path = _resolve_entrypoint_path(request)
    tasks: list[dict[str, Any]] = []
    finalized_raw_payloads = False

    writer.debug(f"adapter started for runId={request.run_id}")
    if resolved_entrypoint_path is not None:
        writer.debug(f"resolved entrypoint={resolved_entrypoint_path}")
    writer.debug(f"config keys={sorted(build_runtime_configuration(request).keys())}")
    writer.debug(f"env preview={json.dumps(masked_environment_preview(request), ensure_ascii=True)}")
    build_runtime_environment(request)

    try:
        writer.emit(
            "run.started",
            request.run_id,
            projectId=request.project_id,
            rootTaskName=request.spec.root_task_name,
            workspaceDirectory=request.workspace_directory,
            projectRootDir=request.project_root_dir,
            schedulerBaseUrl=request.scheduler_base_url,
        )
        writer.emit("run.status_changed", request.run_id, status="starting")

        scheduler_snapshot = collect_scheduler_snapshot(request)
        writer.emit("scheduler.snapshot", request.run_id, **scheduler_snapshot)

        if scheduler_snapshot["health"] in {"unknown", "unreachable"}:
            writer.emit(
                "adapter.warning",
                request.run_id,
                code="scheduler_health_unavailable",
                message="Scheduler health is unavailable for this adapter invocation.",
                detail=scheduler_snapshot["raw"],
            )

        tasks = build_tasks(request)

        for task in tasks:
            writer.emit("task.discovered", request.run_id, **task)

        writer.emit("run.status_changed", request.run_id, status="running")

        status = "success"
        exit_code = 0
        error_summary: str | None = None

        for task in tasks:
            task_error = _run_task(request, writer, stop_controller, task)
            if task_error is not None:
                status = "failed"
                exit_code = 1
                error_summary = task_error
                writer.emit(
                    "adapter.error",
                    request.run_id,
                    code="task_runtime_error",
                    message=task_error,
                    detail={
                        "taskName": task["taskName"],
                        "uniqueId": task["uniqueId"],
                    },
                )
                break

        if status == "success" and _parameter_flag(request, "emitWarning"):
            writer.emit(
                "adapter.warning",
                request.run_id,
                code="simulated_warning",
                message="Simulated adapter warning requested by RunSpec.parameters.emitWarning.",
            )

        if status == "success" and (
            _parameter_flag(request, "emitError") or _parameter_flag(request, "simulateError")
        ):
            status = "failed"
            exit_code = 1
            error_summary = "Simulated adapter failure requested by RunSpec parameters."
            writer.emit(
                "adapter.error",
                request.run_id,
                code="adapter_runtime_error",
                message=error_summary,
                detail={"errorType": "RuntimeError"},
            )

        _emit_raw_payloads_and_artifacts(writer, request, tasks)
        finalized_raw_payloads = True

        if status == "success":
            writer.emit("run.status_changed", request.run_id, status="success")
            writer.emit("run.finished", request.run_id, status="success", exitCode=0)
            writer.debug(f"adapter finished successfully for runId={request.run_id}")
            return 0

        writer.emit("run.status_changed", request.run_id, status="failed", reason=error_summary)
        writer.emit(
            "run.finished",
            request.run_id,
            status="failed",
            exitCode=exit_code,
            errorSummary=error_summary,
        )
        writer.debug(f"adapter finished with failure for runId={request.run_id}")
        return exit_code
    except _GracefulStop as stop_signal:
        if tasks and not finalized_raw_payloads:
            _emit_raw_payloads_and_artifacts(writer, request, tasks)
        writer.emit("run.status_changed", request.run_id, status="stopping", reason=stop_signal.reason)
        writer.emit("run.status_changed", request.run_id, status="canceled", reason=stop_signal.reason)
        writer.emit(
            "run.finished",
            request.run_id,
            status="canceled",
            exitCode=130,
            errorSummary="Run canceled after graceful stop request.",
        )
        writer.debug(f"adapter canceled for runId={request.run_id}")
        return 130
    except Exception as error:  # noqa: BLE001
        writer.debug(traceback.format_exc())
        if tasks and not finalized_raw_payloads:
            _emit_raw_payloads_and_artifacts(writer, request, tasks)
        writer.emit(
            "adapter.error",
            request.run_id,
            code="adapter_runtime_error",
            message=str(error),
            detail={"errorType": type(error).__name__},
        )
        writer.emit("run.status_changed", request.run_id, status="failed", reason=str(error))
        writer.emit(
            "run.finished",
            request.run_id,
            status="failed",
            exitCode=1,
            errorSummary=str(error),
        )
        return 1


def _resolve_entrypoint_path(request: AdapterRunRequest) -> Path | None:
    if not request.project_root_dir or not request.entrypoint_path:
        return None

    project_root_dir = Path(request.project_root_dir).expanduser().resolve()
    entrypoint_path = Path(request.entrypoint_path)
    resolved_path = (
        entrypoint_path.expanduser().resolve()
        if entrypoint_path.is_absolute()
        else project_root_dir.joinpath(entrypoint_path).resolve()
    )

    if not resolved_path.exists():
        raise FileNotFoundError(f"Entrypoint not found: {resolved_path}")

    if not resolved_path.is_file():
        raise FileNotFoundError(f"Entrypoint is not a file: {resolved_path}")

    return resolved_path


class _GracefulStop(RuntimeError):
    def __init__(self, reason: str) -> None:
        super().__init__(reason)
        self.reason = reason


def _run_task(
    request: AdapterRunRequest,
    writer: JsonLineEventWriter,
    stop_controller: StopController,
    task: dict[str, Any],
) -> str | None:
    if stop_controller.should_stop:
        raise _GracefulStop("graceful_stop_requested")

    task_started_at = time.monotonic()
    _update_task_state(writer, request, task, "RUNNING", "Task execution started.")
    _append_task_log(writer, request, task, "stdout", f"Running {task['taskName']}")

    _sleep_with_stop(stop_controller, _parameter_delay_seconds(request))

    if stop_controller.should_stop:
        task["processingTimeSec"] = _planned_processing_time_seconds(request, task["taskName"])
        _update_task_state(
            writer,
            request,
            task,
            "CANCELED",
            "Task canceled after graceful stop request.",
        )
        raise _GracefulStop("graceful_stop_requested")

    try:
        _materialize_task_output(request, task)
    except RuntimeError as error:
        task["processingTimeSec"] = _planned_processing_time_seconds(request, task["taskName"])
        _append_task_log(writer, request, task, "stderr", str(error))
        _update_task_state(writer, request, task, "FAILED", str(error))
        return str(error)

    if task["outputs"]:
        _append_task_log(
            writer,
            request,
            task,
            "stdout",
            f"{task['taskName']} wrote {task['outputs'][0]}",
        )
    _append_task_log(writer, request, task, "stdout", f"Finished {task['taskName']}")
    task["processingTimeSec"] = _planned_processing_time_seconds(request, task["taskName"])
    _update_task_state(writer, request, task, "DONE", "Task execution completed.")
    task["processingTimeSecObservedSec"] = round(time.monotonic() - task_started_at, 6)
    return None


def _emit_raw_payloads_and_artifacts(
    writer: JsonLineEventWriter,
    request: AdapterRunRequest,
    tasks: list[dict[str, Any]],
) -> None:
    if not tasks:
        return

    task_info_tree = build_task_info_tree(tasks)
    task_info_table = build_task_info_table(tasks)

    if request.spec.capture_task_info_tree:
        writer.emit("raw.task_info_tree", request.run_id, raw=task_info_tree)

    if request.spec.capture_task_info_table:
        writer.emit("raw.task_info_table", request.run_id, raw=task_info_table)

    if request.spec.capture_artifact_manifest:
        for artifact in discover_artifacts(
            request,
            tasks=tasks,
            task_info_tree=task_info_tree,
            task_info_table=task_info_table,
        ):
            writer.emit("artifact.discovered", request.run_id, **artifact)


def _update_task_state(
    writer: JsonLineEventWriter,
    request: AdapterRunRequest,
    task: dict[str, Any],
    state: str,
    message: str,
) -> None:
    task["state"] = state
    writer.emit(
        "task.status_changed",
        request.run_id,
        taskName=task["taskName"],
        uniqueId=task["uniqueId"],
        state=state,
        message=message,
    )


def _append_task_log(
    writer: JsonLineEventWriter,
    request: AdapterRunRequest,
    task: dict[str, Any],
    stream: str,
    line: str,
) -> None:
    task_log = task.setdefault("taskLog", {"entries": []})
    task_log.setdefault("entries", []).append(
        {
            "at": utc_now_iso(),
            "stream": stream,
            "line": line,
        }
    )
    writer.emit(
        "task.log",
        request.run_id,
        taskName=task["taskName"],
        uniqueId=task["uniqueId"],
        stream=stream,
        line=line,
    )


def _materialize_task_output(request: AdapterRunRequest, task: dict[str, Any]) -> None:
    output_path = Path(task["outputs"][0]).resolve()
    output_path.parent.mkdir(parents=True, exist_ok=True)
    parameters = task["parameters"]
    report_date = str(parameters["report_date"])
    message = str(parameters["message"])
    rerun_token = str(parameters["rerun_token"])

    if task["taskName"] == "PrepareInput":
        output_path.write_text(
            json.dumps(
                {
                    "message": message,
                    "report_date": report_date,
                    "rerun_token": rerun_token,
                    "prepared_at": utc_now_iso(),
                },
                ensure_ascii=True,
                indent=2,
                sort_keys=True,
            ),
            encoding="utf-8",
        )
        return

    if task["taskName"] == "RenderReport":
        output_path.write_text(
            "\n".join(
                [
                    f"report_date={report_date}",
                    f"message={message}",
                    f"rerun_token={rerun_token}",
                ]
            )
            + "\n",
            encoding="utf-8",
        )
        return

    if task["taskName"] == "PublishReport":
        output_path.write_text(
            json.dumps(
                {
                    "report_date": report_date,
                    "message": message,
                    "rerun_token": rerun_token,
                    "published_at": utc_now_iso(),
                    "report_path": str(
                        Path(request.workspace_directory).resolve()
                        / "reports"
                        / f"{report_date}-{rerun_token}-report.txt"
                    ),
                },
                ensure_ascii=True,
                indent=2,
                sort_keys=True,
            ),
            encoding="utf-8",
        )
        return

    if task["taskName"] == "BrokenReport":
        output_path.write_text(
            json.dumps(
                {
                    "report_date": report_date,
                    "message": message,
                    "rerun_token": rerun_token,
                    "failed_at": utc_now_iso(),
                    "error": "BrokenReport is an intentional fixture failure.",
                },
                ensure_ascii=True,
                indent=2,
                sort_keys=True,
            ),
            encoding="utf-8",
        )
        raise RuntimeError("BrokenReport is an intentional fixture failure.")

    if task["taskName"] == "ImmediateFailure":
        output_path.write_text(
            json.dumps(
                {
                    "report_date": report_date,
                    "message": message,
                    "rerun_token": rerun_token,
                    "failed_at": utc_now_iso(),
                    "error": "ImmediateFailure is an intentional fixture failure.",
                },
                ensure_ascii=True,
                indent=2,
                sort_keys=True,
            ),
            encoding="utf-8",
        )
        raise RuntimeError("ImmediateFailure is an intentional fixture failure.")

    if task["taskName"] == "PartialFailureReport":
        output_path.write_text(
            json.dumps(
                {
                    "report_date": report_date,
                    "message": message,
                    "rerun_token": rerun_token,
                    "published_path": str(
                        Path(request.workspace_directory).resolve()
                        / "published"
                        / f"{report_date}-{rerun_token}-metadata.json"
                    ),
                    "broken_path": str(
                        Path(request.workspace_directory).resolve()
                        / "failed"
                        / f"{report_date}-{rerun_token}-broken.json"
                    ),
                },
                ensure_ascii=True,
                indent=2,
                sort_keys=True,
            ),
            encoding="utf-8",
        )
        return

    output_path.write_text(
        json.dumps(
            {
                "taskName": task["taskName"],
                "parameters": parameters,
            },
            ensure_ascii=True,
            indent=2,
            sort_keys=True,
        ),
        encoding="utf-8",
    )


def _sleep_with_stop(stop_controller: StopController, duration_seconds: float) -> None:
    deadline = time.monotonic() + duration_seconds
    while time.monotonic() < deadline:
        if stop_controller.should_stop:
            return
        time.sleep(0.05)


def _parameter_flag(request: AdapterRunRequest, key: str) -> bool:
    value = request.spec.parameters.get(key)
    return value is True or value == "true" or value == 1


def _parameter_delay_seconds(request: AdapterRunRequest) -> float:
    raw_value = request.spec.parameters.get("simulateDelayMs", 0)
    if isinstance(raw_value, bool):
        return 0.0
    if isinstance(raw_value, (int, float)):
        return max(float(raw_value), 0.0) / 1000.0
    if isinstance(raw_value, str):
        try:
            return max(float(raw_value), 0.0) / 1000.0
        except ValueError:
            return 0.0
    return 0.0


def _planned_processing_time_seconds(request: AdapterRunRequest, task_name: str) -> float:
    base_seconds_by_task = {
        "PrepareInput": 0.05,
        "RenderReport": 0.08,
        "PublishReport": 0.04,
        "BrokenReport": 0.03,
        "ImmediateFailure": 0.02,
        "PartialFailureReport": 0.02,
    }
    return round(base_seconds_by_task.get(task_name, 0.02) + _parameter_delay_seconds(request), 6)
