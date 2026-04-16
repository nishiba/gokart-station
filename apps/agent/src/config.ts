import path from "node:path";
import { fileURLToPath } from "node:url";

const sourceDir = path.dirname(fileURLToPath(import.meta.url));

export const repoRootDir = path.resolve(sourceDir, "../../..");
export const prismaDir = path.join(repoRootDir, "prisma");
export const migrationsDir = path.join(prismaDir, "migrations");
export const pyAdapterRootDir = path.join(repoRootDir, "apps", "py_adapter");
export const defaultDatabaseUrl = `file:${path.join(prismaDir, "dev.db")}`;
export const defaultSchedulerHost = "127.0.0.1";
export const defaultSchedulerPort = 8082;
export const defaultSchedulerBaseUrl = "http://127.0.0.1:8082";
export const defaultSchedulerExecutable = process.env.GOKART_STATION_LUIGID_EXECUTABLE ?? "luigid";
export const defaultAdapterPythonExecutable =
  process.env.GOKART_STATION_ADAPTER_PYTHON_EXECUTABLE ?? "python3";
export const defaultSchedulerRuntimeDirectory = path.join(
  repoRootDir,
  ".gokart-station",
  "runtime",
  "scheduler",
);
export const defaultRunRuntimeDirectory = path.join(
  repoRootDir,
  ".gokart-station",
  "runtime",
  "runs",
);
export const defaultSupportBundleRuntimeDirectory = path.join(
  repoRootDir,
  ".gokart-station",
  "runtime",
  "support-bundles",
);
export const schedulerHealthTimeoutMs = 1_500;
export const schedulerStartTimeoutMs = 5_000;
export const schedulerStopTimeoutMs = 5_000;
export const schedulerProbeIntervalMs = 150;
export const runGracefulStopTimeoutMs = 1_500;
