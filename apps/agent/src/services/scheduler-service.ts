import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import net from "node:net";
import path from "node:path";
import type {
  SchedulerHealth,
  SchedulerHealthResponse,
  SchedulerLogLine,
  SchedulerLogsResponse,
} from "@gokart-station/shared";
import {
  defaultSchedulerBaseUrl,
  defaultSchedulerExecutable,
  defaultSchedulerHost,
  defaultSchedulerPort,
  defaultSchedulerRuntimeDirectory,
  schedulerHealthTimeoutMs,
  schedulerProbeIntervalMs,
  schedulerStartTimeoutMs,
  schedulerStopTimeoutMs,
} from "../config";
import { HttpError } from "../lib/http-errors";

const localhostHosts = new Set(["127.0.0.1", "localhost", "::1"]);

type SchedulerTarget = {
  schedulerBaseUrl: string;
  host: string;
  port: number;
  isLocalhost: boolean;
};

type SchedulerRuntimeRecord = {
  pid: number;
  host: string;
  port: number;
  schedulerBaseUrl: string;
  startedAt: string;
  executable: string;
  args: string[];
};

export type SchedulerServiceOptions = {
  executable?: string;
  argumentPrefix?: string[];
  runtimeDirectory?: string;
  healthTimeoutMs?: number;
  startTimeoutMs?: number;
  stopTimeoutMs?: number;
  stopProcessOnDispose?: boolean;
};

const sleep = async (durationMs: number) =>
  new Promise<void>((resolve) => {
    setTimeout(resolve, durationMs);
  });

const tailLines = (input: string, limit: number) => {
  return input
    .split(/\r?\n/u)
    .filter((line) => line.length > 0)
    .slice(-limit);
};

const normalizeHost = (hostname: string) => hostname.replace(/^\[(.*)\]$/u, "$1");

const healthFromResponse = (statusCode: number): SchedulerHealth => {
  if (statusCode >= 500) {
    return "degraded";
  }

  return "healthy";
};

export class SchedulerService {
  private readonly executable: string;
  private readonly argumentPrefix: string[];
  private readonly runtimeDirectory: string;
  private readonly healthTimeoutMs: number;
  private readonly startTimeoutMs: number;
  private readonly stopTimeoutMs: number;
  private readonly stopProcessOnDispose: boolean;

  constructor(options: SchedulerServiceOptions = {}) {
    this.executable = options.executable ?? defaultSchedulerExecutable;
    this.argumentPrefix = options.argumentPrefix ?? [];
    this.runtimeDirectory = options.runtimeDirectory ?? defaultSchedulerRuntimeDirectory;
    this.healthTimeoutMs = options.healthTimeoutMs ?? schedulerHealthTimeoutMs;
    this.startTimeoutMs = options.startTimeoutMs ?? schedulerStartTimeoutMs;
    this.stopTimeoutMs = options.stopTimeoutMs ?? schedulerStopTimeoutMs;
    this.stopProcessOnDispose = options.stopProcessOnDispose ?? false;
  }

  async dispose() {
    if (!this.stopProcessOnDispose) {
      return;
    }

    const runtimeRecord = await this.readRuntimeRecord();
    if (!runtimeRecord) {
      return;
    }

    try {
      await this.stop(runtimeRecord.schedulerBaseUrl);
    } catch {
      await this.removeRuntimeRecord();
    }
  }

  async getHealth(schedulerBaseUrl?: string | null): Promise<SchedulerHealthResponse> {
    const target = this.resolveTarget(schedulerBaseUrl);
    const runtimeRecord = await this.readRuntimeRecord();
    const matchingRuntime =
      runtimeRecord && runtimeRecord.host === target.host && runtimeRecord.port === target.port
        ? runtimeRecord
        : null;

    const isProcessAlive = matchingRuntime ? await this.isProcessAlive(matchingRuntime.pid) : false;

    if (matchingRuntime && !isProcessAlive) {
      await this.removeRuntimeRecord();
    }

    const [probeResult, portListening] = await Promise.all([
      this.probeScheduler(target.schedulerBaseUrl),
      this.isPortListening(target.host, target.port),
    ]);

    const portConflict = portListening && !isProcessAlive;
    const health = probeResult.isReachable
      ? probeResult.health
      : isProcessAlive
        ? "unreachable"
        : portConflict
          ? "degraded"
          : "unknown";

    return {
      health,
      checkedAt: new Date().toISOString(),
      schedulerBaseUrl: target.schedulerBaseUrl,
      host: target.host,
      port: target.port,
      isLocalhost: target.isLocalhost,
      isManagedByStation: isProcessAlive,
      isProcessAlive,
      portConflict,
      ...(matchingRuntime && isProcessAlive ? { pid: matchingRuntime.pid } : {}),
      ...(matchingRuntime && isProcessAlive ? { startedAt: matchingRuntime.startedAt } : {}),
      pidFilePath: this.getPidFilePath(),
      logDirectory: this.getLogDirectory(),
      stdoutLogPath: this.getStdoutLogPath(),
      stderrLogPath: this.getStderrLogPath(),
      message: this.buildHealthMessage({
        health,
        isProcessAlive,
        portConflict,
        isReachable: probeResult.isReachable,
      }),
    };
  }

  async start(schedulerBaseUrl?: string | null): Promise<SchedulerHealthResponse> {
    const target = this.resolveTarget(schedulerBaseUrl);
    const currentHealth = await this.getHealth(target.schedulerBaseUrl);

    if (currentHealth.isManagedByStation && currentHealth.isProcessAlive) {
      return currentHealth;
    }

    if (currentHealth.portConflict) {
      throw new HttpError(409, "Scheduler port is already in use by another process.", {
        code: "scheduler_port_conflict",
        message: "Scheduler port is already in use by another process.",
      });
    }

    await this.ensureRuntimePaths();
    const startedAt = new Date().toISOString();
    await fs.appendFile(
      this.getStdoutLogPath(),
      `[${startedAt}] scheduler start requested for ${target.schedulerBaseUrl}\n`,
      "utf8",
    );

    const stdoutHandle = await fs.open(this.getStdoutLogPath(), "a");
    const stderrHandle = await fs.open(this.getStderrLogPath(), "a");
    const args = [...this.argumentPrefix, "--address", target.host, "--port", `${target.port}`];

    try {
      const child = await new Promise<ReturnType<typeof spawn>>((resolve, reject) => {
        const spawnedChild = spawn(this.executable, args, {
          cwd: this.runtimeDirectory,
          detached: true,
          env: process.env,
          stdio: ["ignore", stdoutHandle.fd, stderrHandle.fd],
        });

        spawnedChild.once("error", reject);
        spawnedChild.once("spawn", () => resolve(spawnedChild));
      });

      if (child.pid === undefined) {
        throw new HttpError(500, "Scheduler process did not provide a PID.");
      }

      await this.writeRuntimeRecord({
        pid: child.pid,
        host: target.host,
        port: target.port,
        schedulerBaseUrl: target.schedulerBaseUrl,
        startedAt,
        executable: this.executable,
        args,
      });

      child.unref();

      const startupHealth = await this.waitForStartup(target.schedulerBaseUrl, child.pid);
      return startupHealth;
    } catch (error) {
      await this.removeRuntimeRecord();
      const stderrLines = await this.readTail(this.getStderrLogPath(), 20);
      const detail = stderrLines.at(-1);
      const message =
        error instanceof Error
          ? `Failed to start scheduler: ${error.message}`
          : "Failed to start scheduler.";
      throw new HttpError(500, detail ? `${message} ${detail}` : message);
    } finally {
      await stdoutHandle.close();
      await stderrHandle.close();
    }
  }

  async stop(schedulerBaseUrl?: string | null): Promise<SchedulerHealthResponse> {
    const target = this.resolveTarget(schedulerBaseUrl);
    const runtimeRecord = await this.readRuntimeRecord();

    if (
      !runtimeRecord ||
      runtimeRecord.host !== target.host ||
      runtimeRecord.port !== target.port
    ) {
      const currentHealth = await this.getHealth(target.schedulerBaseUrl);
      if (currentHealth.portConflict) {
        throw new HttpError(
          409,
          "Scheduler is running on the requested port but is not managed by station.",
          {
            code: "scheduler_not_managed",
            message: "Scheduler is running on the requested port but is not managed by station.",
          },
        );
      }
      return currentHealth;
    }

    const isAlive = await this.isProcessAlive(runtimeRecord.pid);
    if (!isAlive) {
      await this.removeRuntimeRecord();
      return this.getHealth(target.schedulerBaseUrl);
    }

    this.sendSignal(runtimeRecord.pid, "SIGTERM");
    const exitedGracefully = await this.waitForExit(runtimeRecord.pid, this.stopTimeoutMs);

    if (!exitedGracefully) {
      this.sendSignal(runtimeRecord.pid, "SIGKILL");
      const exitedForcefully = await this.waitForExit(runtimeRecord.pid, 1_000);
      if (!exitedForcefully) {
        throw new HttpError(500, "Scheduler process did not exit after SIGKILL.");
      }
    }

    await this.removeRuntimeRecord();
    return this.getHealth(target.schedulerBaseUrl);
  }

  async restart(schedulerBaseUrl?: string | null): Promise<SchedulerHealthResponse> {
    const target = this.resolveTarget(schedulerBaseUrl);
    const currentHealth = await this.getHealth(target.schedulerBaseUrl);

    if (currentHealth.portConflict) {
      throw new HttpError(
        409,
        "Scheduler is running on the requested port but is not managed by station.",
        {
          code: "scheduler_not_managed",
          message: "Scheduler is running on the requested port but is not managed by station.",
        },
      );
    }

    await this.stop(target.schedulerBaseUrl);
    return this.start(target.schedulerBaseUrl);
  }

  async getLogs(limit = 200): Promise<SchedulerLogsResponse> {
    await this.ensureRuntimePaths();

    const [stdoutLines, stderrLines] = await Promise.all([
      this.readTail(this.getStdoutLogPath(), limit),
      this.readTail(this.getStderrLogPath(), limit),
    ]);

    const lines: SchedulerLogLine[] = [
      ...stdoutLines.map((line) => ({ stream: "stdout" as const, line })),
      ...stderrLines.map((line) => ({ stream: "stderr" as const, line })),
    ];

    return {
      stdoutLogPath: this.getStdoutLogPath(),
      stderrLogPath: this.getStderrLogPath(),
      lines,
    };
  }

  private resolveTarget(schedulerBaseUrl?: string | null): SchedulerTarget {
    const url = new URL(schedulerBaseUrl ?? defaultSchedulerBaseUrl);
    const host = normalizeHost(url.hostname || defaultSchedulerHost);
    const port = Number(url.port || defaultSchedulerPort);
    const isLocalhost = localhostHosts.has(host);

    if (!isLocalhost) {
      throw new HttpError(400, "schedulerBaseUrl must point to localhost.");
    }

    return {
      schedulerBaseUrl: `${url.protocol}//${url.host}`,
      host,
      port,
      isLocalhost,
    };
  }

  private async probeScheduler(schedulerBaseUrl: string) {
    try {
      const response = await fetch(schedulerBaseUrl, {
        method: "GET",
        signal: AbortSignal.timeout(this.healthTimeoutMs),
      });

      return {
        health: healthFromResponse(response.status),
        isReachable: true,
      };
    } catch {
      return {
        health: "unreachable" as const,
        isReachable: false,
      };
    }
  }

  private async waitForStartup(
    schedulerBaseUrl: string,
    pid: number,
  ): Promise<SchedulerHealthResponse> {
    const deadline = Date.now() + this.startTimeoutMs;

    while (Date.now() < deadline) {
      const health = await this.getHealth(schedulerBaseUrl);
      if (health.health === "healthy" || health.health === "degraded") {
        return health;
      }

      if (!(await this.isProcessAlive(pid))) {
        throw new HttpError(500, "Scheduler process exited before becoming healthy.");
      }

      await sleep(schedulerProbeIntervalMs);
    }

    return this.getHealth(schedulerBaseUrl);
  }

  private async waitForExit(pid: number, timeoutMs: number) {
    const deadline = Date.now() + timeoutMs;

    while (Date.now() < deadline) {
      if (!(await this.isProcessAlive(pid))) {
        return true;
      }

      await sleep(schedulerProbeIntervalMs);
    }

    return !(await this.isProcessAlive(pid));
  }

  private sendSignal(pid: number, signal: NodeJS.Signals) {
    try {
      process.kill(-pid, signal);
      return;
    } catch (error) {
      const errorCode = (error as NodeJS.ErrnoException).code;
      if (errorCode !== "ESRCH" && errorCode !== "EINVAL") {
        throw error;
      }
    }

    try {
      process.kill(pid, signal);
    } catch (error) {
      const errorCode = (error as NodeJS.ErrnoException).code;
      if (errorCode !== "ESRCH") {
        throw error;
      }
    }
  }

  private async isProcessAlive(pid: number) {
    try {
      process.kill(pid, 0);
      return true;
    } catch (error) {
      return (error as NodeJS.ErrnoException).code === "EPERM";
    }
  }

  private async isPortListening(host: string, port: number) {
    return new Promise<boolean>((resolve) => {
      const socket = net.createConnection({
        host,
        port,
      });
      let settled = false;

      const finish = (value: boolean) => {
        if (settled) {
          return;
        }
        settled = true;
        socket.destroy();
        resolve(value);
      };

      socket.once("connect", () => finish(true));
      socket.once("error", () => finish(false));
      socket.setTimeout(this.healthTimeoutMs, () => finish(false));
    });
  }

  private async ensureRuntimePaths() {
    await fs.mkdir(this.getLogDirectory(), {
      recursive: true,
    });
  }

  private getPidFilePath() {
    return path.join(this.runtimeDirectory, "luigid.pid.json");
  }

  private getLogDirectory() {
    return path.join(this.runtimeDirectory, "logs");
  }

  private getStdoutLogPath() {
    return path.join(this.getLogDirectory(), "stdout.log");
  }

  private getStderrLogPath() {
    return path.join(this.getLogDirectory(), "stderr.log");
  }

  private async writeRuntimeRecord(record: SchedulerRuntimeRecord) {
    await fs.writeFile(this.getPidFilePath(), JSON.stringify(record, null, 2), "utf8");
  }

  private async readRuntimeRecord() {
    try {
      const raw = await fs.readFile(this.getPidFilePath(), "utf8");
      return JSON.parse(raw) as SchedulerRuntimeRecord;
    } catch {
      return null;
    }
  }

  private async removeRuntimeRecord() {
    await fs.rm(this.getPidFilePath(), {
      force: true,
    });
  }

  private async readTail(filePath: string, limit: number) {
    try {
      const contents = await fs.readFile(filePath, "utf8");
      return tailLines(contents, limit);
    } catch {
      return [];
    }
  }

  private buildHealthMessage(input: {
    health: SchedulerHealth;
    isProcessAlive: boolean;
    portConflict: boolean;
    isReachable: boolean;
  }) {
    if (input.isReachable) {
      return "Scheduler is reachable.";
    }

    if (input.portConflict) {
      return "Requested localhost port is occupied by a non-managed process.";
    }

    if (input.isProcessAlive) {
      return "Scheduler process is running but health check failed.";
    }

    if (input.health === "unknown") {
      return "Scheduler is not running.";
    }

    return "Scheduler health is unavailable.";
  }
}
