import assert from "node:assert/strict";
import fs from "node:fs/promises";
import http from "node:http";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { buildApp } from "../src/app";
import { SchedulerService } from "../src/services/scheduler-service";
import { removeDirectoryWithRetries } from "./helpers/cleanup";

const createTempDirectory = async (prefix: string) => {
  return fs.mkdtemp(path.join(os.tmpdir(), prefix));
};

const findFreePort = async () => {
  return new Promise<number>((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        reject(new Error("Failed to resolve a free port."));
        return;
      }

      const { port } = address;
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }

        resolve(port);
      });
    });
  });
};

const createOperatorProject = async (app: Awaited<ReturnType<typeof buildApp>>, port: number) => {
  const operatorProjectRootDir = await createTempDirectory("gokart-station-operator-root-");
  const operatorWorkspaceDir = await createTempDirectory("gokart-station-operator-workspace-");
  const entrypointPath = path.join(operatorProjectRootDir, "main.py");

  await fs.writeFile(entrypointPath, "print('hello')\n", "utf8");

  const createResponse = await app.inject({
    method: "POST",
    url: "/api/projects",
    payload: {
      name: `operator-${port}`,
      connection: {
        accessMode: "operator",
        projectRootDir: operatorProjectRootDir,
        pythonExecutable: process.execPath,
        entrypointPath: "main.py",
        workspaceDirectory: operatorWorkspaceDir,
        schedulerBaseUrl: `http://127.0.0.1:${port}`,
      },
    },
  });

  assert.equal(createResponse.statusCode, 201);
  return createResponse.json();
};

const createObserverProject = async (app: Awaited<ReturnType<typeof buildApp>>) => {
  const observerWorkspaceDir = await createTempDirectory("gokart-station-observer-workspace-");
  const createResponse = await app.inject({
    method: "POST",
    url: "/api/projects",
    payload: {
      name: "observer-scheduler-project",
      connection: {
        accessMode: "observer",
        workspaceDirectory: observerWorkspaceDir,
      },
    },
  });

  assert.equal(createResponse.statusCode, 201);
  return createResponse.json();
};

test("scheduler lifecycle start/stop/restart/logs are available for operator projects", async () => {
  const testRootDir = await createTempDirectory("gokart-station-scheduler-");
  const databaseUrl = `file:${path.join(testRootDir, "test.db")}`;
  const schedulerRuntimeDir = path.join(testRootDir, "scheduler-runtime");
  const schedulerScriptPath = fileURLToPath(new URL("./fixtures/mock-luigid.mjs", import.meta.url));
  const port = await findFreePort();
  const app = await buildApp({
    databaseUrl,
    scheduler: {
      executable: process.execPath,
      argumentPrefix: [schedulerScriptPath],
      runtimeDirectory: schedulerRuntimeDir,
      stopProcessOnDispose: true,
    },
  });

  try {
    const observerProject = await createObserverProject(app);
    const operatorProject = await createOperatorProject(app, port);

    const observerStartResponse = await app.inject({
      method: "POST",
      url: "/api/scheduler/start",
      payload: {
        projectId: observerProject.id,
      },
    });

    assert.equal(observerStartResponse.statusCode, 403);

    const startResponse = await app.inject({
      method: "POST",
      url: "/api/scheduler/start",
      payload: {
        projectId: operatorProject.id,
      },
    });

    assert.equal(startResponse.statusCode, 200);
    const startedHealth = startResponse.json();
    assert.equal(startedHealth.health, "healthy");
    assert.equal(startedHealth.isManagedByStation, true);
    assert.equal(startedHealth.isProcessAlive, true);
    assert.equal(startedHealth.port, port);
    assert.equal(startedHealth.pidFilePath, path.join(schedulerRuntimeDir, "luigid.pid.json"));

    const snapshotService = new SchedulerService({
      runtimeDirectory: schedulerRuntimeDir,
    });
    const schedulerSnapshot = await snapshotService.getSnapshot(startedHealth.schedulerBaseUrl);
    assert.equal(schedulerSnapshot.health, "healthy");
    assert.equal(schedulerSnapshot.workerCount, 1);
    assert.equal(schedulerSnapshot.activeTaskCount, 1);
    assert.equal(schedulerSnapshot.pendingTaskCount, 2);
    assert.equal(schedulerSnapshot.failedTaskCount, 1);
    assert.equal((schedulerSnapshot.raw as { completeness: string }).completeness, "complete");

    const healthResponse = await app.inject({
      method: "GET",
      url: `/api/scheduler/health?projectId=${operatorProject.id}`,
    });

    assert.equal(healthResponse.statusCode, 200);
    const healthPayload = healthResponse.json();
    assert.equal(healthPayload.health, "healthy");
    assert.equal(healthPayload.portConflict, false);

    const logsResponse = await app.inject({
      method: "GET",
      url: "/api/scheduler/logs?limit=20",
    });

    assert.equal(logsResponse.statusCode, 200);
    const logsPayload = logsResponse.json();
    assert.ok(
      logsPayload.lines.some((entry: { line: string }) => entry.line.includes("mock luigid")),
    );

    const restartResponse = await app.inject({
      method: "POST",
      url: "/api/scheduler/restart",
      payload: {
        projectId: operatorProject.id,
      },
    });

    assert.equal(restartResponse.statusCode, 200);
    const restartedHealth = restartResponse.json();
    assert.equal(restartedHealth.health, "healthy");
    assert.equal(restartedHealth.isProcessAlive, true);

    const stopResponse = await app.inject({
      method: "POST",
      url: "/api/scheduler/stop",
      payload: {
        projectId: operatorProject.id,
      },
    });

    assert.equal(stopResponse.statusCode, 200);
    const stoppedHealth = stopResponse.json();
    assert.equal(stoppedHealth.isProcessAlive, false);
    assert.equal(stoppedHealth.portConflict, false);
    assert.equal(stoppedHealth.health, "unknown");
  } finally {
    await app.close();
    await removeDirectoryWithRetries(testRootDir);
  }
});

test("scheduler snapshot distinguishes partial payloads from basic health reachability", async () => {
  const port = await findFreePort();
  const schedulerService = new SchedulerService();
  const partialServer = http.createServer((request, response) => {
    const requestUrl = new URL(request.url ?? "/", `http://127.0.0.1:${port}`);

    if (requestUrl.pathname === "/api/worker_list") {
      response.writeHead(200, {
        "content-type": "application/json; charset=utf-8",
      });
      response.end(
        JSON.stringify({
          response: [{ name: "partial-worker" }],
        }),
      );
      return;
    }

    if (requestUrl.pathname === "/api/task_list") {
      const rawData = requestUrl.searchParams.get("data");
      const payload = rawData ? (JSON.parse(rawData) as { status?: string }) : {};

      if (payload.status === "RUNNING") {
        response.writeHead(200, {
          "content-type": "application/json; charset=utf-8",
        });
        response.end(JSON.stringify({ response: "not-an-object" }));
        return;
      }

      if (payload.status === "PENDING") {
        response.writeHead(503, {
          "content-type": "application/json; charset=utf-8",
        });
        response.end(JSON.stringify({ error: "temporarily unavailable" }));
        return;
      }

      response.writeHead(200, {
        "content-type": "application/json; charset=utf-8",
      });
      response.end(JSON.stringify({ response: {} }));
      return;
    }

    response.writeHead(200, {
      "content-type": "text/plain; charset=utf-8",
    });
    response.end("partial scheduler ok");
  });

  try {
    await new Promise<void>((resolve, reject) => {
      partialServer.once("error", reject);
      partialServer.listen(port, "127.0.0.1", () => resolve());
    });

    const health = await schedulerService.getHealth(`http://127.0.0.1:${port}`);
    assert.equal(health.health, "healthy");

    const snapshot = await schedulerService.getSnapshot(`http://127.0.0.1:${port}`);
    assert.equal(snapshot.health, "partial");
    assert.equal(snapshot.workerCount, 1);
    assert.equal(snapshot.activeTaskCount, 0);
    assert.equal(snapshot.pendingTaskCount, 0);
    assert.equal(snapshot.failedTaskCount, 0);
    assert.equal((snapshot.raw as { completeness: string }).completeness, "partial");
    assert.ok(((snapshot.raw as { errors: unknown[] }).errors ?? []).length >= 2);
  } finally {
    await new Promise<void>((resolve, reject) => {
      partialServer.close((error) => {
        if (error) {
          reject(error);
          return;
        }

        resolve();
      });
    });
  }
});

test("scheduler start detects localhost port conflicts", async () => {
  const testRootDir = await createTempDirectory("gokart-station-scheduler-conflict-");
  const databaseUrl = `file:${path.join(testRootDir, "test.db")}`;
  const schedulerRuntimeDir = path.join(testRootDir, "scheduler-runtime");
  const schedulerScriptPath = fileURLToPath(new URL("./fixtures/mock-luigid.mjs", import.meta.url));
  const conflictPort = await findFreePort();
  const app = await buildApp({
    databaseUrl,
    scheduler: {
      executable: process.execPath,
      argumentPrefix: [schedulerScriptPath],
      runtimeDirectory: schedulerRuntimeDir,
      stopProcessOnDispose: true,
    },
  });

  const conflictServer = http.createServer((_request, response) => {
    response.writeHead(200, {
      "content-type": "text/plain; charset=utf-8",
    });
    response.end("occupied");
  });

  try {
    await new Promise<void>((resolve, reject) => {
      conflictServer.once("error", reject);
      conflictServer.listen(conflictPort, "127.0.0.1", () => resolve());
    });

    const operatorProject = await createOperatorProject(app, conflictPort);

    const healthResponse = await app.inject({
      method: "GET",
      url: `/api/scheduler/health?projectId=${operatorProject.id}`,
    });

    assert.equal(healthResponse.statusCode, 200);
    const healthPayload = healthResponse.json();
    assert.equal(healthPayload.portConflict, true);

    const startResponse = await app.inject({
      method: "POST",
      url: "/api/scheduler/start",
      payload: {
        projectId: operatorProject.id,
      },
    });

    assert.equal(startResponse.statusCode, 409);
    const errorPayload = startResponse.json();
    assert.equal(errorPayload.code, "scheduler_port_conflict");
  } finally {
    await new Promise<void>((resolve, reject) => {
      conflictServer.close((error) => {
        if (error) {
          reject(error);
          return;
        }

        resolve();
      });
    });
    await app.close();
    await removeDirectoryWithRetries(testRootDir);
  }
});
