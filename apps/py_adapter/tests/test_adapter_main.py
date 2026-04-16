from __future__ import annotations

import json
import os
import signal
import shutil
import subprocess
import sys
import tempfile
import time
import unittest
from pathlib import Path


PACKAGE_ROOT = Path(__file__).resolve().parents[1]
REPO_ROOT = Path(__file__).resolve().parents[3]
SAMPLE_PROJECT_SOURCE_DIR = REPO_ROOT / "examples" / "sample_gokart_project"


def build_request(
    *,
    project_root_dir: str,
    workspace_directory: str,
    root_task_name: str = "PublishReport",
    **parameter_overrides: object,
) -> dict[str, object]:
    parameters = {
        "simulateDelayMs": 0,
        "message": "hello from adapter test",
        "report_date": "2026-04-15",
        "rerun_token": "baseline",
    }
    parameters.update(parameter_overrides)
    return {
        "runId": "run_test",
        "projectId": "project_test",
        "projectName": "sample_gokart_project",
        "accessMode": "operator",
        "projectRootDir": project_root_dir,
        "workspaceDirectory": workspace_directory,
        "pythonExecutable": sys.executable,
        "entrypointPath": "main.py",
        "schedulerBaseUrl": None,
        "configValues": {"sample_key": "value"},
        "envValues": {"ENV_NAME": "value"},
        "envMaskedKeys": ["SECRET_TOKEN"],
        "spec": {
            "rootTaskName": root_task_name,
            "parameters": parameters,
            "rerunMode": "same_spec",
            "captureTaskInfoTree": True,
            "captureTaskInfoTable": True,
            "captureArtifactManifest": True,
        },
    }


def prepare_sample_project_copy() -> tuple[str, str, str]:
    temp_root_dir = tempfile.mkdtemp(prefix="gokart-station-sample-project-")
    target_project_dir = Path(temp_root_dir) / "target_project"
    workspace_directory = Path(temp_root_dir) / "workspace"
    shutil.copytree(SAMPLE_PROJECT_SOURCE_DIR, target_project_dir)
    workspace_directory.mkdir(parents=True, exist_ok=True)
    return temp_root_dir, str(target_project_dir), str(workspace_directory)


def run_adapter_via_stdin(
    request: dict[str, object],
    *,
    target_project_dir: str,
) -> subprocess.CompletedProcess[str]:
    environment = dict(os.environ)
    environment["PYTHONPATH"] = str(PACKAGE_ROOT)
    return subprocess.run(
        [sys.executable, "-m", "gokart_station_adapter.main"],
        cwd=target_project_dir,
        input=json.dumps(request),
        text=True,
        capture_output=True,
        env=environment,
        check=False,
    )


class AdapterMainTests(unittest.TestCase):
    def test_reads_request_from_stdin_and_emits_jsonl(self) -> None:
        temp_root_dir, target_project_dir, workspace_directory = prepare_sample_project_copy()
        try:
            completed = run_adapter_via_stdin(
                build_request(
                    project_root_dir=target_project_dir,
                    workspace_directory=workspace_directory,
                ),
                target_project_dir=target_project_dir,
            )
            self.assertEqual(completed.returncode, 0, completed.stderr)

            events = [json.loads(line) for line in completed.stdout.splitlines() if line.strip()]
            event_types = [event["type"] for event in events]

            self.assertIn("run.started", event_types)
            self.assertIn("scheduler.snapshot", event_types)
            self.assertIn("task.discovered", event_types)
            self.assertIn("task.status_changed", event_types)
            self.assertIn("task.log", event_types)
            self.assertIn("artifact.discovered", event_types)
            self.assertIn("raw.task_info_tree", event_types)
            self.assertIn("raw.task_info_table", event_types)
            self.assertEqual(events[0]["projectRootDir"], target_project_dir)
            self.assertEqual(events[-1]["type"], "run.finished")
        finally:
            shutil.rmtree(temp_root_dir, ignore_errors=True)

    def test_reads_request_from_spec_file(self) -> None:
        temp_root_dir, target_project_dir, workspace_directory = prepare_sample_project_copy()
        try:
            request = build_request(
                project_root_dir=target_project_dir,
                workspace_directory=workspace_directory,
            )
            with tempfile.NamedTemporaryFile("w", encoding="utf-8", delete=False) as handle:
                json.dump(request, handle)
                spec_path = handle.name

            completed = subprocess.run(
                [sys.executable, "-m", "gokart_station_adapter.main", "--spec-path", spec_path],
                cwd=target_project_dir,
                text=True,
                capture_output=True,
                env={
                    **os.environ,
                    "PYTHONPATH": str(PACKAGE_ROOT),
                },
                check=False,
            )
            os.unlink(spec_path)
        finally:
            shutil.rmtree(temp_root_dir, ignore_errors=True)

        self.assertEqual(completed.returncode, 0, completed.stderr)
        events = [json.loads(line) for line in completed.stdout.splitlines() if line.strip()]
        self.assertGreaterEqual(len(events), 3)
        self.assertEqual(events[0]["type"], "run.started")
        self.assertEqual(events[-1]["type"], "run.finished")

    def test_graceful_stop_signal_finishes_with_canceled(self) -> None:
        temp_root_dir, target_project_dir, workspace_directory = prepare_sample_project_copy()
        request = build_request(
            project_root_dir=target_project_dir,
            workspace_directory=workspace_directory,
            simulateDelayMs=600,
        )
        process = subprocess.Popen(
            [sys.executable, "-m", "gokart_station_adapter.main"],
            cwd=target_project_dir,
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            env={
                **os.environ,
                "PYTHONPATH": str(PACKAGE_ROOT),
            },
        )

        try:
            assert process.stdin is not None
            process.stdin.write(json.dumps(request))
            process.stdin.close()
            process.stdin = None

            first_lines: list[str] = []
            assert process.stdout is not None
            deadline = time.time() + 5
            while time.time() < deadline:
                line = process.stdout.readline()
                if not line:
                    continue
                first_lines.append(line)
                if '"type": "task.status_changed"' in line and '"state": "RUNNING"' in line:
                    break

            process.send_signal(signal.SIGTERM)
            stdout, stderr = process.communicate(timeout=5)
            self.assertEqual(process.returncode, 130, stderr)

            events = [
                json.loads(line)
                for line in (*first_lines, *stdout.splitlines())
                if isinstance(line, str) and line.strip()
            ]
            event_types = [event["type"] for event in events]
            self.assertIn("run.finished", event_types)
            self.assertEqual(events[-1]["status"], "canceled")
        finally:
            shutil.rmtree(temp_root_dir, ignore_errors=True)


if __name__ == "__main__":
    unittest.main()
