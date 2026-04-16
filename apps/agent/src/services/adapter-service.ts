import { type ChildProcessWithoutNullStreams, type StdioOptions, spawn } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  type AdapterEvent,
  type AdapterRunRequest,
  adapterEventSchema,
  adapterRunRequestSchema,
} from "@gokart-station/shared";
import { defaultAdapterPythonExecutable, pyAdapterRootDir } from "../config";

export type AdapterSpecTransport = "stdin" | "temp_file";

export type AdapterServiceOptions = {
  adapterRootDir?: string;
  pythonExecutable?: string;
  timeoutMs?: number;
};

export type RunAdapterOptions = {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  pythonExecutable?: string;
  transport?: AdapterSpecTransport;
  timeoutMs?: number;
};

export type RunAdapterResult = {
  exitCode: number | null;
  events: AdapterEvent[];
  stderr: string;
};

export type PreparedAdapterInvocation = {
  request: AdapterRunRequest;
  cwd: string;
  env: NodeJS.ProcessEnv;
  pythonExecutable: string;
  args: string[];
  transport: AdapterSpecTransport;
  cleanup: () => Promise<void>;
};

export type SpawnAdapterOptions = RunAdapterOptions & {
  detached?: boolean;
  stdio?: StdioOptions;
};

export type SpawnAdapterHandle = PreparedAdapterInvocation & {
  child: ChildProcessWithoutNullStreams;
};

export class AdapterService {
  private readonly adapterRootDir: string;
  private readonly pythonExecutable: string;
  private readonly timeoutMs: number;

  constructor(options: AdapterServiceOptions = {}) {
    this.adapterRootDir = options.adapterRootDir ?? pyAdapterRootDir;
    this.pythonExecutable = options.pythonExecutable ?? defaultAdapterPythonExecutable;
    this.timeoutMs = options.timeoutMs ?? 10_000;
  }

  async runOnce(
    input: AdapterRunRequest,
    options: RunAdapterOptions = {},
  ): Promise<RunAdapterResult> {
    const timeoutMs = options.timeoutMs ?? this.timeoutMs;
    const invocation = await this.prepareInvocation(input, options);

    try {
      return await new Promise<RunAdapterResult>((resolve, reject) => {
        const child = spawn(invocation.pythonExecutable, invocation.args, {
          cwd: invocation.cwd,
          env: invocation.env,
          stdio: ["pipe", "pipe", "pipe"],
        });

        const stdoutChunks: Buffer[] = [];
        const stderrChunks: Buffer[] = [];
        const timer = setTimeout(() => {
          child.kill("SIGTERM");
        }, timeoutMs);

        child.once("error", (error) => {
          clearTimeout(timer);
          reject(error);
        });

        child.stdout.on("data", (chunk: Buffer) => {
          stdoutChunks.push(chunk);
        });
        child.stderr.on("data", (chunk: Buffer) => {
          stderrChunks.push(chunk);
        });

        child.once("close", (exitCode) => {
          clearTimeout(timer);

          try {
            const stdout = Buffer.concat(stdoutChunks).toString("utf8");
            const stderr = Buffer.concat(stderrChunks).toString("utf8");
            const events = stdout
              .split(/\r?\n/u)
              .filter((line) => line.trim().length > 0)
              .map((line) => adapterEventSchema.parse(JSON.parse(line)));

            resolve({
              exitCode,
              events,
              stderr,
            });
          } catch (error) {
            reject(error);
          }
        });

        if (invocation.transport === "temp_file") {
          child.stdin.end();
          return;
        }

        child.stdin.end(`${JSON.stringify(invocation.request)}\n`);
      });
    } finally {
      await invocation.cleanup();
    }
  }

  async prepareInvocation(
    input: AdapterRunRequest,
    options: RunAdapterOptions = {},
  ): Promise<PreparedAdapterInvocation> {
    const request = adapterRunRequestSchema.parse(input);
    const transport = options.transport ?? "stdin";
    const cwd = options.cwd ?? request.projectRootDir ?? request.workspaceDirectory;
    const pythonExecutable = options.pythonExecutable ?? this.pythonExecutable;
    const env = this.buildProcessEnvironment(options.env);
    const specFileState =
      transport === "temp_file" ? await this.createSpecFile(request) : undefined;
    const args = ["-m", "gokart_station_adapter.main"];

    if (specFileState) {
      args.push("--spec-path", specFileState.specPath);
    }

    return {
      request,
      cwd,
      env,
      pythonExecutable,
      args,
      transport,
      cleanup: async () => {
        if (specFileState) {
          await fs.rm(specFileState.tempDirectory, {
            recursive: true,
            force: true,
          });
        }
      },
    };
  }

  async spawn(
    input: AdapterRunRequest,
    options: SpawnAdapterOptions = {},
  ): Promise<SpawnAdapterHandle> {
    const invocation = await this.prepareInvocation(input, options);
    const child = spawn(invocation.pythonExecutable, invocation.args, {
      cwd: invocation.cwd,
      env: invocation.env,
      detached: options.detached ?? false,
      stdio: options.stdio ?? ["pipe", "pipe", "pipe"],
    });

    if (!child.stdin || !child.stdout || !child.stderr) {
      await invocation.cleanup();
      throw new Error("Adapter process did not provide stdin/stdout/stderr pipes.");
    }

    if (invocation.transport === "temp_file") {
      child.stdin.end();
    } else {
      child.stdin.end(`${JSON.stringify(invocation.request)}\n`);
    }

    return {
      ...invocation,
      child: child as ChildProcessWithoutNullStreams,
    };
  }

  private buildProcessEnvironment(env?: NodeJS.ProcessEnv) {
    const pythonPathEntries = [this.adapterRootDir];
    const existingPythonPath = env?.PYTHONPATH ?? process.env.PYTHONPATH;
    if (existingPythonPath) {
      pythonPathEntries.push(existingPythonPath);
    }

    return {
      ...process.env,
      ...env,
      PYTHONPATH: pythonPathEntries.join(path.delimiter),
    };
  }

  private async createSpecFile(request: AdapterRunRequest) {
    const tempDirectory = await fs.mkdtemp(path.join(os.tmpdir(), "gokart-station-adapter-"));
    const specPath = path.join(tempDirectory, "adapter-run-request.json");
    await fs.writeFile(specPath, JSON.stringify(request), "utf8");
    return {
      tempDirectory,
      specPath,
    };
  }
}
