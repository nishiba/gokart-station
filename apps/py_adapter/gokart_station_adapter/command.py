from __future__ import annotations

import json
import re
from dataclasses import dataclass
from pathlib import Path
from typing import Any
from urllib.parse import urlparse

from gokart_station_adapter.models import AdapterRunRequest


@dataclass(slots=True)
class TreeInfoPaths:
    base_path: Path
    tree_path: Path
    table_path: Path


@dataclass(slots=True)
class TargetCommandPlan:
    argv: list[str]
    cwd: str
    env_overrides: dict[str, str]
    tree_info_paths: TreeInfoPaths | None
    resolved_entrypoint_path: Path


def build_target_command(request: AdapterRunRequest) -> TargetCommandPlan:
    resolved_entrypoint_path = resolve_entrypoint_path(request)
    cwd = str(
        (Path(request.project_root_dir).expanduser().resolve() if request.project_root_dir else Path(request.workspace_directory).expanduser().resolve())
    )

    argv = [
        request.python_executable or "python3",
        str(resolved_entrypoint_path),
        request.spec.root_task_name,
        "--workspace-directory",
        request.workspace_directory,
    ]

    if request.spec.worker_count is not None:
        argv.extend(["--workers", str(request.spec.worker_count)])

    for key, value in request.spec.parameters.items():
        argv.extend([_parameter_option_name(key), _encode_parameter_value(value)])

    tree_info_paths = _build_tree_info_paths(request)
    if tree_info_paths is not None:
        tree_info_paths.base_path.parent.mkdir(parents=True, exist_ok=True)
        argv.extend(
            [
                "--tree-info-mode",
                "json",
                "--tree-info-output-path",
                str(tree_info_paths.base_path),
            ]
        )

    if request.scheduler_base_url:
        parsed_url = urlparse(request.scheduler_base_url)
        if parsed_url.hostname:
            argv.extend(["--scheduler-host", parsed_url.hostname])
        if parsed_url.port:
            argv.extend(["--scheduler-port", str(parsed_url.port)])
    else:
        argv.append("--local-scheduler")

    env_overrides: dict[str, str] = {}
    if request.luigi_config_path:
        env_overrides["LUIGI_CONFIG_PATH"] = request.luigi_config_path

    return TargetCommandPlan(
        argv=argv,
        cwd=cwd,
        env_overrides=env_overrides,
        tree_info_paths=tree_info_paths,
        resolved_entrypoint_path=resolved_entrypoint_path,
    )


def resolve_entrypoint_path(request: AdapterRunRequest) -> Path:
    if not request.project_root_dir or not request.entrypoint_path:
        raise FileNotFoundError("projectRootDir and entrypointPath are required for adapter execution.")

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


def _build_tree_info_paths(request: AdapterRunRequest) -> TreeInfoPaths | None:
    if not request.spec.capture_task_info_tree and not request.spec.capture_task_info_table:
        return None

    base_path = (
        Path(request.workspace_directory).expanduser().resolve()
        / ".gokart-station"
        / "adapter"
        / request.run_id
        / "task-info"
    )
    return TreeInfoPaths(
        base_path=base_path,
        tree_path=Path(f"{base_path}-tree.json"),
        table_path=Path(f"{base_path}-table.json"),
    )


def _parameter_option_name(key: str) -> str:
    normalized_key = (
        re.sub(r"([a-z0-9])([A-Z])", r"\1-\2", key.strip()).replace("_", "-").lower()
    )
    return f"--{normalized_key}"


def _encode_parameter_value(value: Any) -> str:
    if isinstance(value, str):
        return value
    if isinstance(value, (int, float)) and not isinstance(value, bool):
        return str(value)
    return json.dumps(value, ensure_ascii=True)
