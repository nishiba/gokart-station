from __future__ import annotations

import json
import queue
import signal
import subprocess
import threading
import time
import traceback
from dataclasses import dataclass
from typing import Any, TextIO

from gokart_station_adapter.artifacts import discover_artifacts
from gokart_station_adapter.command import build_target_command
from gokart_station_adapter.events import JsonLineEventWriter, StopController
from gokart_station_adapter.lineage import (
    build_rerun_reason,
    load_task_info_json,
    normalize_task_info_table,
    normalize_task_info_tree,
)
from gokart_station_adapter.models import AdapterRunRequest
from gokart_station_adapter.profiles import (
    build_runtime_configuration,
    build_runtime_environment,
    build_runtime_redactor,
    masked_environment_preview,
    RuntimeConfiguration,
    RuntimeRedactor,
)
from gokart_station_adapter.scheduler import collect_scheduler_snapshot

_scheduler_snapshot_interval_seconds = 0.5


@dataclass(slots=True)
class _StreamMessage:
    stream: str
    line: str | None


def run_adapter(request: AdapterRunRequest) -> int:
    writer = JsonLineEventWriter()
    stop_controller = StopController()
    stop_controller.install_signal_handlers()
    runtime_environment = build_runtime_environment(request)
    runtime_configuration = RuntimeConfiguration(values=dict(request.config_values), luigi_config_path=None)
    runtime_redactor = build_runtime_redactor(request)

    writer.debug(f"adapter started for runId={request.run_id}")
    writer.debug(f"config keys={sorted(request.config_values.keys())}")
    writer.debug(f"env preview={json.dumps(masked_environment_preview(request), ensure_ascii=True)}")

    try:
        command_plan = build_target_command(request)
        runtime_configuration = build_runtime_configuration(
            request,
            base_luigi_config_path=command_plan.env_overrides.get("LUIGI_CONFIG_PATH"),
        )
        writer.debug(f"resolved entrypoint={command_plan.resolved_entrypoint_path}")
        writer.debug(f"target argv={json.dumps(command_plan.argv, ensure_ascii=True)}")

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

        writer.emit("run.status_changed", request.run_id, status="running")
        return _run_target_process(
            request,
            writer,
            stop_controller,
            command_plan.argv,
            command_plan.cwd,
            {
                **runtime_environment,
                **command_plan.env_overrides,
                **(
                    {"LUIGI_CONFIG_PATH": runtime_configuration.luigi_config_path}
                    if runtime_configuration.luigi_config_path
                    else {}
                ),
                "PYTHONUNBUFFERED": "1",
            },
            command_plan.tree_info_paths.tree_path if command_plan.tree_info_paths else None,
            command_plan.tree_info_paths.table_path if command_plan.tree_info_paths else None,
            runtime_redactor,
        )
    except Exception as error:  # noqa: BLE001
        writer.debug(runtime_redactor.redact_text(traceback.format_exc()))
        error_message = runtime_redactor.redact_text(str(error))
        writer.emit(
            "adapter.error",
            request.run_id,
            code="adapter_runtime_error",
            message=error_message,
            detail={"errorType": type(error).__name__},
        )
        writer.emit("run.status_changed", request.run_id, status="failed", reason=error_message)
        writer.emit(
            "run.finished",
            request.run_id,
            status="failed",
            exitCode=1,
            errorSummary=error_message,
        )
        return 1
    finally:
        runtime_configuration.cleanup()


def _run_target_process(
    request: AdapterRunRequest,
    writer: JsonLineEventWriter,
    stop_controller: StopController,
    argv: list[str],
    cwd: str,
    env: dict[str, str],
    task_info_tree_path,
    task_info_table_path,
    runtime_redactor: RuntimeRedactor,
) -> int:
    child = subprocess.Popen(
        argv,
        cwd=cwd,
        env=env,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
        bufsize=1,
    )
    if child.stdout is None or child.stderr is None:
        raise RuntimeError("Target process did not provide stdout/stderr streams.")

    line_queue: queue.Queue[_StreamMessage] = queue.Queue()
    stdout_thread = _start_stream_thread(child.stdout, "stdout", line_queue)
    stderr_thread = _start_stream_thread(child.stderr, "stderr", line_queue)
    active_streams = {"stdout", "stderr"}
    process_log_reference = _build_process_log_reference(request)
    forwarded_stop_signal = False
    next_scheduler_snapshot_at = time.monotonic()

    _emit_scheduler_snapshot(request, writer, emit_warning=True)
    next_scheduler_snapshot_at = time.monotonic() + _scheduler_snapshot_interval_seconds

    while active_streams or child.poll() is None:
        if stop_controller.should_stop and not forwarded_stop_signal and child.poll() is None:
            try:
                child.send_signal(signal.SIGTERM)
            except ProcessLookupError:
                pass
            forwarded_stop_signal = True

        if request.scheduler_base_url and child.poll() is None and time.monotonic() >= next_scheduler_snapshot_at:
            _emit_scheduler_snapshot(request, writer)
            next_scheduler_snapshot_at = time.monotonic() + _scheduler_snapshot_interval_seconds

        try:
            message = line_queue.get(timeout=0.1)
        except queue.Empty:
            continue

        if message.line is None:
            active_streams.discard(message.stream)
            continue

        writer.emit(
            "task.log",
            request.run_id,
            taskName=process_log_reference["taskName"],
            uniqueId=process_log_reference["uniqueId"],
            stream=message.stream,
            line=runtime_redactor.redact_text(message.line),
        )

    stdout_thread.join(timeout=0.5)
    stderr_thread.join(timeout=0.5)
    exit_code = child.wait()

    if request.scheduler_base_url:
        _emit_scheduler_snapshot(request, writer)

    normalized_tasks, raw_tree, raw_table = _emit_post_run_payloads(
        request,
        writer,
        task_info_tree_path=task_info_tree_path,
        task_info_table_path=task_info_table_path,
        runtime_redactor=runtime_redactor,
    )

    if stop_controller.should_stop:
        writer.emit("run.status_changed", request.run_id, status="stopping", reason="graceful_stop_requested")
        writer.emit("run.status_changed", request.run_id, status="canceled", reason="graceful_stop_requested")
        writer.emit(
            "run.finished",
            request.run_id,
            status="canceled",
            exitCode=130,
            errorSummary="Run canceled after graceful stop request.",
        )
        return 130

    if exit_code == 0:
        writer.emit("run.status_changed", request.run_id, status="success")
        writer.emit("run.finished", request.run_id, status="success", exitCode=0)
        writer.debug(f"adapter finished successfully for runId={request.run_id}")
        return 0

    error_summary = _failure_summary(normalized_tasks, raw_table, exit_code)
    writer.emit(
        "adapter.error",
        request.run_id,
        code="target_process_failed",
        message=error_summary,
        detail={
            "exitCode": exit_code,
            "taskInfoTreePath": str(task_info_tree_path) if task_info_tree_path else None,
            "taskInfoTablePath": str(task_info_table_path) if task_info_table_path else None,
        },
    )
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


def _emit_scheduler_snapshot(
    request: AdapterRunRequest,
    writer: JsonLineEventWriter,
    *,
    emit_warning: bool = False,
) -> dict[str, Any]:
    scheduler_snapshot = collect_scheduler_snapshot(request)
    writer.emit("scheduler.snapshot", request.run_id, **scheduler_snapshot)

    if emit_warning and scheduler_snapshot["health"] != "healthy":
        writer.emit(
            "adapter.warning",
            request.run_id,
            code="scheduler_snapshot_unhealthy",
            message=f"Scheduler snapshot completed with health={scheduler_snapshot['health']}.",
            detail=scheduler_snapshot["raw"],
        )

    return scheduler_snapshot


def _emit_post_run_payloads(
    request: AdapterRunRequest,
    writer: JsonLineEventWriter,
    *,
    task_info_tree_path,
    task_info_table_path,
    runtime_redactor: RuntimeRedactor,
) -> tuple[list[dict[str, Any]], dict[str, Any] | None, list[dict[str, Any]] | None]:
    raw_tree_payload = runtime_redactor.redact_value(load_task_info_json(task_info_tree_path))
    raw_table_payload = runtime_redactor.redact_value(load_task_info_json(task_info_table_path))
    normalized_tree = runtime_redactor.redact_value(normalize_task_info_tree(raw_tree_payload))
    normalized_tasks = runtime_redactor.redact_value(
        normalize_task_info_table(
            raw_table_payload,
            rerun_reason=build_rerun_reason(request.spec.rerun_mode),
        )
    )

    if request.spec.capture_task_info_tree:
        if normalized_tree is not None:
            writer.emit("raw.task_info_tree", request.run_id, raw=normalized_tree)
        else:
            writer.emit(
                "adapter.warning",
                request.run_id,
                code="task_info_tree_missing",
                message="Target project did not produce raw task info tree JSON.",
                detail={"path": str(task_info_tree_path) if task_info_tree_path else None},
            )

    if request.spec.capture_task_info_table:
        if raw_table_payload is not None:
            writer.emit("raw.task_info_table", request.run_id, raw=raw_table_payload)
        else:
            writer.emit(
                "adapter.warning",
                request.run_id,
                code="task_info_table_missing",
                message="Target project did not produce raw task info table JSON.",
                detail={"path": str(task_info_table_path) if task_info_table_path else None},
            )

    for task in normalized_tasks:
        writer.emit("task.discovered", request.run_id, **task)
    for task in normalized_tasks:
        writer.emit(
            "task.status_changed",
            request.run_id,
            taskName=task["taskName"],
            uniqueId=task["uniqueId"],
            state=task["state"],
            message=f"Task finished with state={task['state']}.",
        )

    normalized_table_payload = normalized_tasks if raw_table_payload is not None else None
    for artifact in discover_artifacts(
        request,
        normalized_tasks,
        task_info_tree=normalized_tree,
        task_info_table=normalized_table_payload,
        task_info_tree_path=task_info_tree_path,
        task_info_table_path=task_info_table_path,
    ):
        writer.emit("artifact.discovered", request.run_id, **artifact)

    return normalized_tasks, normalized_tree, normalized_table_payload


def _start_stream_thread(
    stream: TextIO,
    stream_name: str,
    line_queue: "queue.Queue[_StreamMessage]",
) -> threading.Thread:
    thread = threading.Thread(
        target=_pump_stream,
        args=(stream, stream_name, line_queue),
        daemon=True,
    )
    thread.start()
    return thread


def _pump_stream(
    stream: TextIO,
    stream_name: str,
    line_queue: "queue.Queue[_StreamMessage]",
) -> None:
    try:
        for line in iter(stream.readline, ""):
            normalized_line = line.rstrip("\r\n")
            if normalized_line == "":
                continue
            line_queue.put(_StreamMessage(stream=stream_name, line=normalized_line))
    finally:
        line_queue.put(_StreamMessage(stream=stream_name, line=None))


def _build_process_log_reference(request: AdapterRunRequest) -> dict[str, str]:
    parameter_parts = [
        f"{key}={value}"
        for key, value in sorted(request.spec.parameters.items(), key=lambda entry: entry[0])
    ]
    suffix = ",".join(parameter_parts)
    return {
        "taskName": request.spec.root_task_name,
        "uniqueId": f"{request.spec.root_task_name}({suffix})" if suffix else request.spec.root_task_name,
    }


def _failure_summary(
    normalized_tasks: list[dict[str, Any]],
    raw_table: list[dict[str, Any]] | None,
    exit_code: int,
) -> str:
    failed_task = next((task for task in normalized_tasks if task["state"] == "FAILED"), None)
    if failed_task is not None:
        task_log_entries = failed_task.get("taskLog", {}).get("entries", [])
        failed_line = next(
            (
                entry.get("line")
                for entry in reversed(task_log_entries)
                if isinstance(entry, dict)
                and entry.get("stream") == "stderr"
                and isinstance(entry.get("line"), str)
            ),
            None,
        )
        if isinstance(failed_line, str) and failed_line.strip() != "":
            return failed_line
        return f"{failed_task['taskName']} failed."

    if raw_table is None:
        return f"Target process exited with code {exit_code} without raw task info."

    return f"Target process exited with code {exit_code}."
