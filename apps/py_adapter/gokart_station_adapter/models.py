from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Mapping


@dataclass(slots=True)
class RunSpec:
    root_task_name: str
    label: str | None = None
    parameters: dict[str, Any] = field(default_factory=dict)
    config_profile_id: str | None = None
    env_profile_id: str | None = None
    rerun_mode: str = "same_spec"
    worker_count: int | None = None
    capture_task_info_tree: bool = True
    capture_task_info_table: bool = True
    capture_artifact_manifest: bool = True

    @classmethod
    def from_dict(cls, data: Mapping[str, Any]) -> "RunSpec":
        return cls(
            root_task_name=_require_string(data, "rootTaskName"),
            label=_optional_string(data, "label"),
            parameters=_require_mapping(data, "parameters"),
            config_profile_id=_optional_string(data, "configProfileId"),
            env_profile_id=_optional_string(data, "envProfileId"),
            rerun_mode=_require_string(data, "rerunMode"),
            worker_count=_optional_int(data, "workerCount"),
            capture_task_info_tree=_require_bool(data, "captureTaskInfoTree"),
            capture_task_info_table=_require_bool(data, "captureTaskInfoTable"),
            capture_artifact_manifest=_require_bool(data, "captureArtifactManifest"),
        )

    def to_dict(self) -> dict[str, Any]:
        return {
            "rootTaskName": self.root_task_name,
            "label": self.label,
            "parameters": self.parameters,
            "configProfileId": self.config_profile_id,
            "envProfileId": self.env_profile_id,
            "rerunMode": self.rerun_mode,
            "workerCount": self.worker_count,
            "captureTaskInfoTree": self.capture_task_info_tree,
            "captureTaskInfoTable": self.capture_task_info_table,
            "captureArtifactManifest": self.capture_artifact_manifest,
        }


@dataclass(slots=True)
class AdapterRunRequest:
    run_id: str
    project_id: str
    project_name: str
    access_mode: str
    workspace_directory: str
    spec: RunSpec
    project_root_dir: str | None = None
    python_executable: str | None = None
    entrypoint_path: str | None = None
    luigi_config_path: str | None = None
    env_source_path: str | None = None
    scheduler_base_url: str | None = None
    config_values: dict[str, str] = field(default_factory=dict)
    env_values: dict[str, str] = field(default_factory=dict)
    env_masked_keys: list[str] = field(default_factory=list)

    @classmethod
    def from_dict(cls, data: Mapping[str, Any]) -> "AdapterRunRequest":
        return cls(
            run_id=_require_string(data, "runId"),
            project_id=_require_string(data, "projectId"),
            project_name=_require_string(data, "projectName"),
            access_mode=_require_string(data, "accessMode"),
            workspace_directory=_require_string(data, "workspaceDirectory"),
            spec=RunSpec.from_dict(_require_mapping(data, "spec")),
            project_root_dir=_optional_string(data, "projectRootDir"),
            python_executable=_optional_string(data, "pythonExecutable"),
            entrypoint_path=_optional_string(data, "entrypointPath"),
            luigi_config_path=_optional_string(data, "luigiConfigPath"),
            env_source_path=_optional_string(data, "envSourcePath"),
            scheduler_base_url=_optional_string(data, "schedulerBaseUrl"),
            config_values=_require_string_mapping(data, "configValues"),
            env_values=_require_string_mapping(data, "envValues"),
            env_masked_keys=_require_string_list(data, "envMaskedKeys"),
        )

    def to_dict(self) -> dict[str, Any]:
        return {
            "runId": self.run_id,
            "projectId": self.project_id,
            "projectName": self.project_name,
            "accessMode": self.access_mode,
            "projectRootDir": self.project_root_dir,
            "workspaceDirectory": self.workspace_directory,
            "pythonExecutable": self.python_executable,
            "entrypointPath": self.entrypoint_path,
            "luigiConfigPath": self.luigi_config_path,
            "envSourcePath": self.env_source_path,
            "schedulerBaseUrl": self.scheduler_base_url,
            "configValues": self.config_values,
            "envValues": self.env_values,
            "envMaskedKeys": self.env_masked_keys,
            "spec": self.spec.to_dict(),
        }

    @classmethod
    def build_example(cls) -> "AdapterRunRequest":
        return cls(
            run_id="run_example",
            project_id="project_example",
            project_name="sample-project",
            access_mode="operator",
            project_root_dir="/tmp/sample-project",
            workspace_directory="/tmp/sample-workspace",
            python_executable="/usr/bin/python3",
            entrypoint_path="main.py",
            scheduler_base_url="http://127.0.0.1:8082",
            config_values={"sample_key": "value"},
            env_values={"ENV_NAME": "value"},
            env_masked_keys=["SECRET_TOKEN"],
            spec=RunSpec(
                root_task_name="sample.SomeTask",
                parameters={},
                rerun_mode="same_spec",
                capture_task_info_tree=True,
                capture_task_info_table=True,
                capture_artifact_manifest=True,
            ),
        )
def _require_string(data: Mapping[str, Any], key: str) -> str:
    value = data.get(key)
    if not isinstance(value, str) or value == "":
        raise ValueError(f"{key} must be a non-empty string.")
    return value


def _optional_string(data: Mapping[str, Any], key: str) -> str | None:
    value = data.get(key)
    if value is None:
        return None
    if not isinstance(value, str):
        raise ValueError(f"{key} must be a string when provided.")
    return value


def _require_bool(data: Mapping[str, Any], key: str) -> bool:
    value = data.get(key)
    if not isinstance(value, bool):
        raise ValueError(f"{key} must be a boolean.")
    return value


def _optional_int(data: Mapping[str, Any], key: str) -> int | None:
    value = data.get(key)
    if value is None:
        return None
    if not isinstance(value, int):
        raise ValueError(f"{key} must be an integer when provided.")
    return value


def _require_mapping(data: Mapping[str, Any], key: str) -> dict[str, Any]:
    value = data.get(key)
    if not isinstance(value, Mapping):
        raise ValueError(f"{key} must be an object.")
    return dict(value)


def _require_string_mapping(data: Mapping[str, Any], key: str) -> dict[str, str]:
    value = _require_mapping(data, key)
    result: dict[str, str] = {}
    for entry_key, entry_value in value.items():
        if not isinstance(entry_key, str) or not isinstance(entry_value, str):
            raise ValueError(f"{key} must contain only string key-value pairs.")
        result[entry_key] = entry_value
    return result


def _require_string_list(data: Mapping[str, Any], key: str) -> list[str]:
    value = data.get(key)
    if not isinstance(value, list) or not all(isinstance(entry, str) for entry in value):
        raise ValueError(f"{key} must be a list of strings.")
    return list(value)
