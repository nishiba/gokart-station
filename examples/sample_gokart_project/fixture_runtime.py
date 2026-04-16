from __future__ import annotations

import argparse
import json
import logging
import os
import time
from dataclasses import dataclass, field
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import luigi
from luigi import configuration as luigi_configuration
from luigi.execution_summary import LuigiStatusCode

LOGGER = logging.getLogger("sample_gokart_project")
DEFAULT_WORKSPACE_DIR = os.environ.get(
    "SAMPLE_GOKART_WORKSPACE_DIR",
    str(Path("/tmp/sample-gokart-workspace").resolve()),
)
BaseTask = luigi.Task


@dataclass(slots=True)
class RuntimeSettings:
    message_prefix: str
    message_suffix: str
    uppercase_report: bool
    metadata_tag: str | None
    secret_token: str | None
    config_secret_note: str | None
    station_run_id: str | None
    station_project_id: str | None

    def render_message(self, base_message: str) -> str:
        return f"{self.message_prefix}{base_message}{self.message_suffix}"


@dataclass(slots=True)
class TaskRecord:
    task_name: str
    unique_id: str
    state: str = "PENDING"
    parameters: dict[str, Any] = field(default_factory=dict)
    outputs: list[str] = field(default_factory=list)
    processing_time_sec: float | None = None
    task_log: dict[str, Any] = field(default_factory=lambda: {"entries": []})
    rerun_reason: str | None = None
    code_version_hint: str | None = None
    upstream_unique_ids: list[str] = field(default_factory=list)
    downstream_unique_ids: list[str] = field(default_factory=list)

    def to_dict(self) -> dict[str, Any]:
        return {
            "taskName": self.task_name,
            "uniqueId": self.unique_id,
            "state": self.state,
            "parameters": self.parameters,
            "outputs": self.outputs,
            "processingTimeSec": self.processing_time_sec,
            "taskLog": self.task_log,
            "rerunReason": self.rerun_reason,
            "codeVersionHint": self.code_version_hint,
            "upstreamUniqueIds": self.upstream_unique_ids,
            "downstreamUniqueIds": self.downstream_unique_ids,
        }


@dataclass(slots=True)
class SampleRunArguments:
    root_task_name: str
    workspace_directory: str
    message: str
    report_date: str
    rerun_token: str
    simulate_delay_ms: int
    tree_info_mode: str | None
    tree_info_output_path: str | None
    local_scheduler: bool
    scheduler_host: str | None
    scheduler_port: int | None
    workers: int


class SampleTaskMixin:
    workspace_directory = luigi.Parameter(default=DEFAULT_WORKSPACE_DIR)
    report_date = luigi.Parameter(default="2026-04-15")
    message = luigi.Parameter(default="hello from gokart-station")
    rerun_token = luigi.Parameter(default="baseline")
    simulate_delay_ms = luigi.IntParameter(default=0)

    def workspace_root(self) -> Path:
        return Path(str(self.workspace_directory)).expanduser().resolve()

    def artifact_path(self, *parts: str) -> Path:
        return self.workspace_root().joinpath(*parts)

    def local_target(self, *parts: str) -> luigi.LocalTarget:
        target_path = self.artifact_path(*parts)
        target_path.parent.mkdir(parents=True, exist_ok=True)
        return luigi.LocalTarget(str(target_path))

    def sample_parameters(self) -> dict[str, Any]:
        return {
            "message": str(self.message),
            "report_date": str(self.report_date),
            "rerun_token": str(self.rerun_token),
            "simulateDelayMs": int(self.simulate_delay_ms),
        }

    def _sleep_if_requested(self) -> None:
        _sleep_ms(int(self.simulate_delay_ms))


class PrepareInput(SampleTaskMixin, BaseTask):
    def output(self) -> luigi.LocalTarget:
        return self.local_target(
            "prepare",
            f"{self.report_date}-{self.rerun_token}-payload.json",
        )

    def run(self) -> None:
        runtime_settings = load_runtime_settings()
        rendered_message = runtime_settings.render_message(str(self.message))
        LOGGER.info(
            "PrepareInput started message=%s report_date=%s rerun_token=%s station_run_id=%s",
            rendered_message,
            self.report_date,
            self.rerun_token,
            runtime_settings.station_run_id,
        )
        _log_secret_if_present("PrepareInput", runtime_settings)
        self._sleep_if_requested()
        payload = {
            "message": rendered_message,
            "report_date": str(self.report_date),
            "rerun_token": str(self.rerun_token),
            "prepared_at": _utc_now_iso(),
            "station_run_id": runtime_settings.station_run_id,
            "station_project_id": runtime_settings.station_project_id,
        }
        with self.output().open("w") as output_file:
            json.dump(payload, output_file, ensure_ascii=True, indent=2, sort_keys=True)
        LOGGER.info("PrepareInput finished output=%s", self.output().path)


class RenderReport(SampleTaskMixin, BaseTask):
    def requires(self) -> PrepareInput:
        return PrepareInput(
            workspace_directory=self.workspace_directory,
            report_date=self.report_date,
            message=self.message,
            rerun_token=self.rerun_token,
            simulate_delay_ms=self.simulate_delay_ms,
        )

    def output(self) -> luigi.LocalTarget:
        return self.local_target(
            "reports",
            f"{self.report_date}-{self.rerun_token}-report.txt",
        )

    def run(self) -> None:
        runtime_settings = load_runtime_settings()
        with self.input().open("r") as input_file:
            payload = json.load(input_file)

        LOGGER.info("RenderReport consumed payload=%s", payload)
        _log_secret_if_present("RenderReport", runtime_settings)
        self._sleep_if_requested()
        report_lines = [
            f"report_date={payload['report_date']}",
            f"message={payload['message']}",
            f"rerun_token={payload['rerun_token']}",
        ]
        if runtime_settings.metadata_tag:
            report_lines.append(f"metadata_tag={runtime_settings.metadata_tag}")
        if runtime_settings.uppercase_report:
            report_lines = [line.upper() for line in report_lines]
        with self.output().open("w") as output_file:
            output_file.write("\n".join(report_lines) + "\n")
        LOGGER.info("RenderReport finished output=%s", self.output().path)


class PublishReport(SampleTaskMixin, BaseTask):
    def requires(self) -> RenderReport:
        return RenderReport(
            workspace_directory=self.workspace_directory,
            report_date=self.report_date,
            message=self.message,
            rerun_token=self.rerun_token,
            simulate_delay_ms=self.simulate_delay_ms,
        )

    def output(self) -> luigi.LocalTarget:
        return self.local_target(
            "published",
            f"{self.report_date}-{self.rerun_token}-metadata.json",
        )

    def run(self) -> None:
        runtime_settings = load_runtime_settings()
        with self.input().open("r") as input_file:
            report_text = input_file.read()

        LOGGER.info("PublishReport publishing report_length=%s", len(report_text))
        _log_secret_if_present("PublishReport", runtime_settings)
        self._sleep_if_requested()
        payload = {
            "report_date": str(self.report_date),
            "message": runtime_settings.render_message(str(self.message)),
            "rerun_token": str(self.rerun_token),
            "report_path": self.input().path,
            "metadata_tag": runtime_settings.metadata_tag,
            "station_run_id": runtime_settings.station_run_id,
            "station_project_id": runtime_settings.station_project_id,
            "published_at": _utc_now_iso(),
        }
        with self.output().open("w") as output_file:
            json.dump(payload, output_file, ensure_ascii=True, indent=2, sort_keys=True)
        LOGGER.info("PublishReport finished output=%s", self.output().path)


class BrokenReport(SampleTaskMixin, BaseTask):
    def requires(self) -> RenderReport:
        return RenderReport(
            workspace_directory=self.workspace_directory,
            report_date=self.report_date,
            message=self.message,
            rerun_token=self.rerun_token,
            simulate_delay_ms=self.simulate_delay_ms,
        )

    def output(self) -> luigi.LocalTarget:
        return self.local_target(
            "failed",
            f"{self.report_date}-{self.rerun_token}-broken.json",
        )

    def run(self) -> None:
        runtime_settings = load_runtime_settings()
        LOGGER.error(
            "BrokenReport intentionally failing report_date=%s rerun_token=%s",
            self.report_date,
            self.rerun_token,
        )
        _log_secret_if_present("BrokenReport", runtime_settings)
        self._sleep_if_requested()
        payload = {
            "report_date": str(self.report_date),
            "message": runtime_settings.render_message(str(self.message)),
            "rerun_token": str(self.rerun_token),
            "failed_at": _utc_now_iso(),
            "error": "BrokenReport is an intentional fixture failure.",
        }
        with self.output().open("w") as output_file:
            json.dump(payload, output_file, ensure_ascii=True, indent=2, sort_keys=True)
        raise RuntimeError("BrokenReport is an intentional fixture failure.")


class ImmediateFailure(SampleTaskMixin, BaseTask):
    def output(self) -> luigi.LocalTarget:
        return self.local_target(
            "failed",
            f"{self.report_date}-{self.rerun_token}-immediate.json",
        )

    def run(self) -> None:
        runtime_settings = load_runtime_settings()
        LOGGER.error(
            "ImmediateFailure intentionally failing without upstream dependencies report_date=%s rerun_token=%s",
            self.report_date,
            self.rerun_token,
        )
        _log_secret_if_present("ImmediateFailure", runtime_settings)
        self._sleep_if_requested()
        payload = {
            "report_date": str(self.report_date),
            "message": runtime_settings.render_message(str(self.message)),
            "rerun_token": str(self.rerun_token),
            "failed_at": _utc_now_iso(),
            "error": "ImmediateFailure is an intentional fixture failure.",
        }
        with self.output().open("w") as output_file:
            json.dump(payload, output_file, ensure_ascii=True, indent=2, sort_keys=True)
        raise RuntimeError("ImmediateFailure is an intentional fixture failure.")


class PartialFailureReport(SampleTaskMixin, luigi.WrapperTask):
    def requires(self) -> dict[str, luigi.Task]:
        return {
            "published": PublishReport(
                workspace_directory=self.workspace_directory,
                report_date=self.report_date,
                message=self.message,
                rerun_token=self.rerun_token,
                simulate_delay_ms=self.simulate_delay_ms,
            ),
            "broken": BrokenReport(
                workspace_directory=self.workspace_directory,
                report_date=self.report_date,
                message=self.message,
                rerun_token=self.rerun_token,
                simulate_delay_ms=self.simulate_delay_ms,
            ),
        }


TASK_TYPE_BY_NAME = {
    "PrepareInput": PrepareInput,
    "RenderReport": RenderReport,
    "PublishReport": PublishReport,
    "BrokenReport": BrokenReport,
    "ImmediateFailure": ImmediateFailure,
    "PartialFailureReport": PartialFailureReport,
}


def main(argv: list[str] | None = None) -> int:
    logging.basicConfig(level=logging.INFO)
    parser = build_parser()
    args, _unknown = parser.parse_known_args(argv)
    sample_args = SampleRunArguments(
        root_task_name=args.root_task_name,
        workspace_directory=args.workspace_directory,
        message=args.message,
        report_date=args.report_date,
        rerun_token=args.rerun_token,
        simulate_delay_ms=args.simulate_delay_ms,
        tree_info_mode=args.tree_info_mode,
        tree_info_output_path=args.tree_info_output_path,
        local_scheduler=bool(args.local_scheduler or not args.scheduler_host),
        scheduler_host=args.scheduler_host,
        scheduler_port=args.scheduler_port,
        workers=args.workers,
    )
    return run_fixture(sample_args)


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="sample gokart project fixture runtime")
    parser.add_argument("root_task_name")
    parser.add_argument("--workspace-directory", default=DEFAULT_WORKSPACE_DIR)
    parser.add_argument("--message", default="hello from gokart-station")
    parser.add_argument("--report-date", default="2026-04-15")
    parser.add_argument("--rerun-token", default="baseline")
    parser.add_argument("--simulate-delay-ms", type=int, default=0)
    parser.add_argument("--tree-info-mode")
    parser.add_argument("--tree-info-output-path")
    parser.add_argument("--local-scheduler", action="store_true")
    parser.add_argument("--scheduler-host")
    parser.add_argument("--scheduler-port", type=int)
    parser.add_argument("--workers", type=int, default=1)
    return parser


def run_fixture(args: SampleRunArguments) -> int:
    workspace_root = Path(args.workspace_directory).expanduser().resolve()
    workspace_root.mkdir(parents=True, exist_ok=True)

    build_kwargs: dict[str, Any] = {
        "detailed_summary": True,
        "workers": max(args.workers, 1),
    }
    if args.local_scheduler:
        build_kwargs["local_scheduler"] = True
    else:
        build_kwargs["scheduler_host"] = args.scheduler_host
        if args.scheduler_port is not None:
            build_kwargs["scheduler_port"] = args.scheduler_port

    build_result = luigi.build([_build_root_task(args)], **build_kwargs)
    tasks = _materialize_task_records(args, workspace_root)
    _apply_execution_results(tasks, args.root_task_name, args.simulate_delay_ms)
    _write_tree_info_files(args, tasks)

    return 0 if build_result.status in {LuigiStatusCode.SUCCESS, LuigiStatusCode.SUCCESS_WITH_RETRY} else 1


def _build_root_task(args: SampleRunArguments) -> luigi.Task:
    task_type = TASK_TYPE_BY_NAME.get(args.root_task_name)
    if task_type is None:
        raise ValueError(f"Unsupported sample task: {args.root_task_name}")

    return task_type(
        workspace_directory=args.workspace_directory,
        report_date=args.report_date,
        message=args.message,
        rerun_token=args.rerun_token,
        simulate_delay_ms=args.simulate_delay_ms,
    )


def _materialize_task_records(args: SampleRunArguments, workspace_root: Path) -> list[TaskRecord]:
    parameters = {
        "message": args.message,
        "report_date": args.report_date,
        "rerun_token": args.rerun_token,
        "simulateDelayMs": args.simulate_delay_ms,
    }
    rerun_reason = "same_spec_manual"

    tasks: list[TaskRecord] = []
    for task_name, upstream_task_names, downstream_task_names in _task_plan_for_root_task(
        args.root_task_name
    ):
        outputs = _task_outputs(workspace_root, task_name, parameters)
        tasks.append(
            TaskRecord(
                task_name=task_name,
                unique_id=_build_unique_id(task_name, parameters),
                parameters=dict(parameters),
                outputs=[str(path) for path in outputs],
                rerun_reason=rerun_reason,
                upstream_unique_ids=[
                    _build_unique_id(upstream_task_name, parameters)
                    for upstream_task_name in upstream_task_names
                ],
                downstream_unique_ids=[
                    _build_unique_id(downstream_task_name, parameters)
                    for downstream_task_name in downstream_task_names
                ],
            )
        )

    return tasks


def _apply_execution_results(
    tasks: list[TaskRecord],
    root_task_name: str,
    simulate_delay_ms: int,
) -> None:
    runtime_settings = load_runtime_settings()
    state_overrides = _state_overrides(root_task_name)
    for task in tasks:
        output_paths = [Path(output_path) for output_path in task.outputs]
        outputs_exist = any(output_path.exists() for output_path in output_paths)
        task.state = state_overrides.get(
            task.task_name,
            "DONE" if outputs_exist else "PENDING",
        )
        task.processing_time_sec = _processing_time_seconds(task.task_name, simulate_delay_ms)
        task.task_log = {"entries": _task_log_entries(task, runtime_settings)}


def _state_overrides(root_task_name: str) -> dict[str, str]:
    if root_task_name == "BrokenReport":
        return {
            "PrepareInput": "DONE",
            "RenderReport": "DONE",
            "BrokenReport": "FAILED",
        }

    if root_task_name == "ImmediateFailure":
        return {"ImmediateFailure": "FAILED"}

    if root_task_name == "PartialFailureReport":
        return {
            "PrepareInput": "DONE",
            "RenderReport": "DONE",
            "PublishReport": "DONE",
            "BrokenReport": "FAILED",
            "PartialFailureReport": "PENDING",
        }

    return {}


def _task_log_entries(task: TaskRecord, runtime_settings: RuntimeSettings) -> list[dict[str, str]]:
    timestamp = _utc_now_iso()
    secret_entries = (
        [
            {
                "at": timestamp,
                "stream": "stderr",
                "line": f"{task.task_name} secret_token={runtime_settings.secret_token}",
            }
        ]
        if runtime_settings.secret_token
        else []
    )
    if runtime_settings.config_secret_note:
        secret_entries.append(
            {
                "at": timestamp,
                "stream": "stderr",
                "line": f"{task.task_name} config_secret_note={runtime_settings.config_secret_note}",
            }
        )
    if task.task_name == "PrepareInput":
        return [
            {
                "at": timestamp,
                "stream": "stdout",
                "line": f"PrepareInput started message={runtime_settings.render_message(str(task.parameters['message']))}",
            },
            {
                "at": timestamp,
                "stream": "stdout",
                "line": f"PrepareInput finished output={task.outputs[0]}",
            },
            *secret_entries,
        ]

    if task.task_name == "RenderReport":
        return [
            {"at": timestamp, "stream": "stdout", "line": "RenderReport started"},
            {
                "at": timestamp,
                "stream": "stdout",
                "line": f"RenderReport finished output={task.outputs[0]}",
            },
            *secret_entries,
        ]

    if task.task_name == "PublishReport":
        return [
            {"at": timestamp, "stream": "stdout", "line": "PublishReport started"},
            {
                "at": timestamp,
                "stream": "stdout",
                "line": f"PublishReport finished output={task.outputs[0]}",
            },
            *secret_entries,
        ]

    if task.task_name == "BrokenReport":
        return [
            {"at": timestamp, "stream": "stdout", "line": "BrokenReport started"},
            {
                "at": timestamp,
                "stream": "stderr",
                "line": "BrokenReport is an intentional fixture failure.",
            },
            *secret_entries,
        ]

    if task.task_name == "ImmediateFailure":
        return [
            {"at": timestamp, "stream": "stdout", "line": "ImmediateFailure started"},
            {
                "at": timestamp,
                "stream": "stderr",
                "line": "ImmediateFailure is an intentional fixture failure.",
            },
            *secret_entries,
        ]

    if task.task_name == "PartialFailureReport":
        return [
            {
                "at": timestamp,
                "stream": "stderr",
                "line": "Wrapper task kept pending because BrokenReport failed.",
            }
        ]

    return []


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


def _task_outputs(
    workspace_root: Path,
    task_name: str,
    parameters: dict[str, Any],
) -> list[Path]:
    report_date = str(parameters["report_date"])
    rerun_token = str(parameters["rerun_token"])
    if task_name == "PrepareInput":
        return [workspace_root / "prepare" / f"{report_date}-{rerun_token}-payload.json"]
    if task_name == "RenderReport":
        return [workspace_root / "reports" / f"{report_date}-{rerun_token}-report.txt"]
    if task_name == "PublishReport":
        return [workspace_root / "published" / f"{report_date}-{rerun_token}-metadata.json"]
    if task_name == "BrokenReport":
        return [workspace_root / "failed" / f"{report_date}-{rerun_token}-broken.json"]
    if task_name == "ImmediateFailure":
        return [workspace_root / "failed" / f"{report_date}-{rerun_token}-immediate.json"]
    return []


def _write_tree_info_files(args: SampleRunArguments, tasks: list[TaskRecord]) -> None:
    if args.tree_info_mode != "json" or not args.tree_info_output_path:
        return

    output_base_path = Path(args.tree_info_output_path).expanduser().resolve()
    output_base_path.parent.mkdir(parents=True, exist_ok=True)

    tree_payload = _build_task_info_tree(tasks)
    table_payload = [task.to_dict() for task in tasks]

    Path(f"{output_base_path}-tree.json").write_text(
        json.dumps(tree_payload, ensure_ascii=True, indent=2, sort_keys=True),
        encoding="utf-8",
    )
    Path(f"{output_base_path}-table.json").write_text(
        json.dumps(table_payload, ensure_ascii=True, indent=2, sort_keys=True),
        encoding="utf-8",
    )


def _build_task_info_tree(tasks: list[TaskRecord]) -> dict[str, Any]:
    task_by_unique_id = {task.unique_id: task for task in tasks}
    root_task = next((task for task in tasks if len(task.downstream_unique_ids) == 0), tasks[-1])
    return _tree_node(root_task, task_by_unique_id)


def _tree_node(task: TaskRecord, task_by_unique_id: dict[str, TaskRecord]) -> dict[str, Any]:
    return {
        "taskName": task.task_name,
        "uniqueId": task.unique_id,
        "state": task.state,
        "parameters": task.parameters,
        "outputs": task.outputs,
        "processingTimeSec": task.processing_time_sec,
        "taskLog": task.task_log,
        "rerunReason": task.rerun_reason,
        "codeVersionHint": task.code_version_hint,
        "children": [
            _tree_node(task_by_unique_id[unique_id], task_by_unique_id)
            for unique_id in task.upstream_unique_ids
            if unique_id in task_by_unique_id
        ],
    }


def _processing_time_seconds(task_name: str, simulate_delay_ms: int) -> float:
    base_seconds_by_task = {
        "PrepareInput": 0.05,
        "RenderReport": 0.08,
        "PublishReport": 0.04,
        "BrokenReport": 0.03,
        "ImmediateFailure": 0.02,
        "PartialFailureReport": 0.02,
    }
    return round(base_seconds_by_task.get(task_name, 0.02) + max(simulate_delay_ms, 0) / 1000.0, 6)


def _build_unique_id(task_name: str, parameters: dict[str, Any]) -> str:
    return (
        f"{task_name}(report_date={parameters['report_date']},"
        f"rerun_token={parameters['rerun_token']})"
    )


def _sleep_ms(duration_ms: int) -> None:
    if duration_ms <= 0:
        return
    time.sleep(duration_ms / 1000.0)


def _utc_now_iso() -> str:
    return datetime.now(UTC).isoformat().replace("+00:00", "Z")


def load_runtime_settings() -> RuntimeSettings:
    config = luigi_configuration.get_config()
    return RuntimeSettings(
        message_prefix=os.environ.get("SAMPLE_GOKART_MESSAGE_PREFIX", ""),
        message_suffix=_get_config_value(config, "sample_gokart", "message_suffix") or "",
        uppercase_report=_get_config_bool(config, "sample_gokart", "uppercase_report", default=False),
        metadata_tag=_get_config_value(config, "sample_gokart", "metadata_tag"),
        secret_token=os.environ.get("SAMPLE_GOKART_SECRET_TOKEN"),
        config_secret_note=_get_config_value(config, "sample_gokart", "secret_note"),
        station_run_id=os.environ.get("GOKART_STATION_RUN_ID"),
        station_project_id=os.environ.get("GOKART_STATION_PROJECT_ID"),
    )


def _log_secret_if_present(task_name: str, runtime_settings: RuntimeSettings) -> None:
    if runtime_settings.secret_token is None:
        if runtime_settings.config_secret_note is None:
            return
    else:
        LOGGER.warning("%s secret_token=%s", task_name, runtime_settings.secret_token)

    if runtime_settings.config_secret_note is not None:
        LOGGER.warning(
            "%s config_secret_note=%s",
            task_name,
            runtime_settings.config_secret_note,
        )


def _get_config_value(config: Any, section_name: str, option_name: str) -> str | None:
    if not config.has_option(section_name, option_name):
        return None
    return str(config.get(section_name, option_name))


def _get_config_bool(config: Any, section_name: str, option_name: str, *, default: bool) -> bool:
    if not config.has_option(section_name, option_name):
        return default
    return bool(config.getboolean(section_name, option_name))
