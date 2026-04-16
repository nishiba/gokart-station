from __future__ import annotations

import os

from gokart_station_adapter.models import AdapterRunRequest


def build_runtime_configuration(request: AdapterRunRequest) -> dict[str, str]:
    return dict(request.config_values)


def build_runtime_environment(request: AdapterRunRequest) -> dict[str, str]:
    runtime_environment = dict(os.environ)
    runtime_environment.update(request.env_values)
    runtime_environment["GOKART_STATION_RUN_ID"] = request.run_id
    runtime_environment["GOKART_STATION_PROJECT_ID"] = request.project_id
    return runtime_environment


def masked_environment_preview(request: AdapterRunRequest) -> dict[str, str]:
    preview = dict(request.env_values)
    for key in request.env_masked_keys:
        if key in preview:
            preview[key] = "***MASKED***"
    return preview
