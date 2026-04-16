from __future__ import annotations

import json
import logging
import os
from datetime import datetime
from pathlib import Path

import luigi

try:
    import gokart  # type: ignore
except ImportError:  # pragma: no cover - the example stays importable even before deps are installed
    gokart = None


LOGGER = logging.getLogger("sample_gokart_project")

DEFAULT_WORKSPACE_DIR = os.environ.get(
    "SAMPLE_GOKART_WORKSPACE_DIR",
    str(Path("/tmp/sample-gokart-workspace").resolve()),
)

BaseTask = gokart.TaskOnKart if gokart is not None else luigi.Task


class SampleTaskMixin:
    workspace_directory = luigi.Parameter(default=DEFAULT_WORKSPACE_DIR)
    report_date = luigi.Parameter(default="2026-04-15")
    message = luigi.Parameter(default="hello from gokart-station")
    rerun_token = luigi.Parameter(default="baseline")

    def workspace_root(self) -> Path:
        return Path(str(self.workspace_directory)).expanduser().resolve()

    def artifact_path(self, *parts: str) -> Path:
        return self.workspace_root().joinpath(*parts)

    def local_target(self, *parts: str) -> luigi.LocalTarget:
        target_path = self.artifact_path(*parts)
        target_path.parent.mkdir(parents=True, exist_ok=True)
        return luigi.LocalTarget(str(target_path))


class PrepareInput(SampleTaskMixin, BaseTask):
    def output(self) -> luigi.LocalTarget:
        return self.local_target(
            "prepare",
            f"{self.report_date}-{self.rerun_token}-payload.json",
        )

    def run(self) -> None:
        LOGGER.info(
            "PrepareInput started message=%s report_date=%s rerun_token=%s",
            self.message,
            self.report_date,
            self.rerun_token,
        )
        payload = {
            "message": str(self.message),
            "report_date": str(self.report_date),
            "rerun_token": str(self.rerun_token),
            "prepared_at": datetime.utcnow().isoformat() + "Z",
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
        )

    def output(self) -> luigi.LocalTarget:
        return self.local_target(
            "reports",
            f"{self.report_date}-{self.rerun_token}-report.txt",
        )

    def run(self) -> None:
        with self.input().open("r") as input_file:
            payload = json.load(input_file)

        LOGGER.info("RenderReport consumed payload=%s", payload)
        report_lines = [
            f"report_date={payload['report_date']}",
            f"message={payload['message']}",
            f"rerun_token={payload['rerun_token']}",
        ]
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
        )

    def output(self) -> luigi.LocalTarget:
        return self.local_target(
            "published",
            f"{self.report_date}-{self.rerun_token}-metadata.json",
        )

    def run(self) -> None:
        with self.input().open("r") as input_file:
            report_text = input_file.read()

        LOGGER.info("PublishReport publishing report_length=%s", len(report_text))
        payload = {
            "report_date": str(self.report_date),
            "message": str(self.message),
            "rerun_token": str(self.rerun_token),
            "report_path": self.input().path,
            "published_at": datetime.utcnow().isoformat() + "Z",
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
        )

    def output(self) -> luigi.LocalTarget:
        return self.local_target(
            "failed",
            f"{self.report_date}-{self.rerun_token}-broken.json",
        )

    def run(self) -> None:
        LOGGER.error(
            "BrokenReport intentionally failing report_date=%s rerun_token=%s",
            self.report_date,
            self.rerun_token,
        )
        raise RuntimeError("BrokenReport is an intentional fixture failure.")


class ImmediateFailure(SampleTaskMixin, BaseTask):
    def output(self) -> luigi.LocalTarget:
        return self.local_target(
            "failed",
            f"{self.report_date}-{self.rerun_token}-immediate.json",
        )

    def run(self) -> None:
        LOGGER.error(
            "ImmediateFailure intentionally failing without upstream dependencies report_date=%s rerun_token=%s",
            self.report_date,
            self.rerun_token,
        )
        raise RuntimeError("ImmediateFailure is an intentional fixture failure.")


class PartialFailureReport(SampleTaskMixin, luigi.WrapperTask):
    def requires(self) -> dict[str, luigi.Task]:
        return {
            "published": PublishReport(
                workspace_directory=self.workspace_directory,
                report_date=self.report_date,
                message=self.message,
                rerun_token=self.rerun_token,
            ),
            "broken": BrokenReport(
                workspace_directory=self.workspace_directory,
                report_date=self.report_date,
                message=self.message,
                rerun_token=self.rerun_token,
            ),
        }


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    luigi.run()
