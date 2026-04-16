from __future__ import annotations

import os
import shutil
import tempfile
from configparser import ConfigParser
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from gokart_station_adapter.models import AdapterRunRequest

MASKED_VALUE = "***MASKED***"


@dataclass(slots=True)
class RuntimeConfiguration:
    values: dict[str, str]
    luigi_config_path: str | None
    cleanup_directory: Path | None = None

    def cleanup(self) -> None:
        if self.cleanup_directory is None:
            return

        shutil.rmtree(self.cleanup_directory, ignore_errors=True)


@dataclass(slots=True)
class RuntimeRedactor:
    masked_values: tuple[str, ...]

    def redact_text(self, value: str) -> str:
        redacted = value
        for masked_value in self.masked_values:
            if masked_value in redacted:
                redacted = redacted.replace(masked_value, MASKED_VALUE)
        return redacted

    def redact_value(self, value: Any) -> Any:
        if isinstance(value, str):
            return self.redact_text(value)

        if isinstance(value, list):
            return [self.redact_value(entry) for entry in value]

        if isinstance(value, dict):
            return {
                dict_key: self.redact_value(dict_value)
                for dict_key, dict_value in value.items()
            }

        return value


def build_runtime_configuration(
    request: AdapterRunRequest,
    *,
    base_luigi_config_path: str | None = None,
) -> RuntimeConfiguration:
    values = dict(request.config_values)
    if not values:
        return RuntimeConfiguration(
            values=values,
            luigi_config_path=base_luigi_config_path,
        )

    config_parser = ConfigParser()
    config_parser.optionxform = str

    if base_luigi_config_path:
        base_config_path = Path(base_luigi_config_path).expanduser().resolve()
        if not base_config_path.exists():
            raise FileNotFoundError(f"Luigi config path not found: {base_config_path}")
        if not base_config_path.is_file():
            raise FileNotFoundError(f"Luigi config path is not a file: {base_config_path}")
        with base_config_path.open("r", encoding="utf-8") as handle:
            config_parser.read_file(handle)

    for full_key, entry_value in values.items():
        section_name, option_name = _split_config_key(full_key)
        if section_name == "DEFAULT":
            config_parser["DEFAULT"][option_name] = entry_value
            continue

        if not config_parser.has_section(section_name):
            config_parser.add_section(section_name)
        config_parser.set(section_name, option_name, entry_value)

    cleanup_directory = Path(tempfile.mkdtemp(prefix="gokart-station-config-")).resolve()
    luigi_config_path = cleanup_directory / "luigi-runtime.cfg"
    with luigi_config_path.open("w", encoding="utf-8") as handle:
        config_parser.write(handle)

    return RuntimeConfiguration(
        values=values,
        luigi_config_path=str(luigi_config_path),
        cleanup_directory=cleanup_directory,
    )


def build_runtime_environment(request: AdapterRunRequest) -> dict[str, str]:
    runtime_environment = dict(os.environ)
    runtime_environment.pop("LUIGI_CONFIG_PATH", None)
    runtime_environment.update(request.env_values)
    runtime_environment["GOKART_STATION_RUN_ID"] = request.run_id
    runtime_environment["GOKART_STATION_PROJECT_ID"] = request.project_id
    return runtime_environment


def build_runtime_redactor(request: AdapterRunRequest) -> RuntimeRedactor:
    masked_values = {
        request.config_values[key]
        for key in request.config_masked_keys
        if key in request.config_values and request.config_values[key] != ""
    }
    masked_values.update(
        request.env_values[key]
        for key in request.env_masked_keys
        if key in request.env_values and request.env_values[key] != ""
    )
    return RuntimeRedactor(
        masked_values=tuple(sorted(masked_values, key=len, reverse=True)),
    )


def masked_environment_preview(request: AdapterRunRequest) -> dict[str, str]:
    preview = dict(request.env_values)
    for key in request.env_masked_keys:
        if key in preview:
            preview[key] = MASKED_VALUE
    return preview


def _split_config_key(full_key: str) -> tuple[str, str]:
    section_name, separator, option_name = full_key.partition(".")
    if separator == "" or option_name == "":
        return ("DEFAULT", full_key)
    return (section_name, option_name)
