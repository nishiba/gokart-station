-- CreateTable
CREATE TABLE "projects" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "defaultConfigProfileId" TEXT,
    "defaultEnvProfileId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "project_connections" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "projectId" TEXT NOT NULL,
    "accessMode" TEXT NOT NULL,
    "projectRootDir" TEXT,
    "pythonExecutable" TEXT,
    "entrypointPath" TEXT,
    "workspaceDirectory" TEXT NOT NULL,
    "luigiConfigPath" TEXT,
    "envSourcePath" TEXT,
    "schedulerBaseUrl" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "project_connections_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "profiles" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "projectId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "extendsProfileId" TEXT,
    "valuesJson" TEXT NOT NULL DEFAULT '{}',
    "maskedKeysJson" TEXT NOT NULL DEFAULT '[]',
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "enabledForModesJson" TEXT NOT NULL DEFAULT '[]',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "profiles_extendsProfileId_fkey" FOREIGN KEY ("extendsProfileId") REFERENCES "profiles" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "profiles_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "run_specs" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "projectId" TEXT NOT NULL,
    "configProfileId" TEXT,
    "envProfileId" TEXT,
    "rootTaskName" TEXT NOT NULL,
    "label" TEXT,
    "parametersJson" TEXT NOT NULL DEFAULT '{}',
    "rerunMode" TEXT NOT NULL,
    "workerCount" INTEGER,
    "captureTaskInfoTree" BOOLEAN NOT NULL,
    "captureTaskInfoTable" BOOLEAN NOT NULL,
    "captureArtifactManifest" BOOLEAN NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "run_specs_configProfileId_fkey" FOREIGN KEY ("configProfileId") REFERENCES "profiles" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "run_specs_envProfileId_fkey" FOREIGN KEY ("envProfileId") REFERENCES "profiles" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "run_specs_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "runs" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "projectId" TEXT NOT NULL,
    "runSpecId" TEXT NOT NULL,
    "accessMode" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "exitCode" INTEGER,
    "stopMode" TEXT,
    "adapterPid" INTEGER,
    "processGroupId" INTEGER,
    "schedulerTaskId" TEXT,
    "startedAt" DATETIME,
    "finishedAt" DATETIME,
    "errorSummary" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "runs_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "runs_runSpecId_fkey" FOREIGN KEY ("runSpecId") REFERENCES "run_specs" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "run_control_actions" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "projectId" TEXT NOT NULL,
    "runId" TEXT,
    "type" TEXT NOT NULL,
    "stopMode" TEXT,
    "payloadJson" TEXT NOT NULL DEFAULT '{}',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "run_control_actions_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "run_control_actions_runId_fkey" FOREIGN KEY ("runId") REFERENCES "runs" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "capability_snapshots" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "projectId" TEXT NOT NULL,
    "canReadWorkspace" BOOLEAN NOT NULL,
    "canReadArtifacts" BOOLEAN NOT NULL,
    "canRun" BOOLEAN NOT NULL,
    "canStop" BOOLEAN NOT NULL,
    "canRerun" BOOLEAN NOT NULL,
    "canEditProfiles" BOOLEAN NOT NULL,
    "canManageScheduler" BOOLEAN NOT NULL,
    "canInstallAdapter" BOOLEAN NOT NULL,
    "schedulerHealth" TEXT NOT NULL,
    "validationOk" BOOLEAN NOT NULL,
    "issuesJson" TEXT NOT NULL DEFAULT '[]',
    "capturedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "capability_snapshots_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "scheduler_snapshots" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "runId" TEXT,
    "projectId" TEXT NOT NULL,
    "health" TEXT NOT NULL,
    "activeTaskCount" INTEGER NOT NULL,
    "pendingTaskCount" INTEGER NOT NULL,
    "failedTaskCount" INTEGER NOT NULL,
    "workerCount" INTEGER NOT NULL,
    "rawJson" TEXT NOT NULL DEFAULT '{}',
    "capturedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "scheduler_snapshots_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "scheduler_snapshots_runId_fkey" FOREIGN KEY ("runId") REFERENCES "runs" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "task_lineage_nodes" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "runId" TEXT NOT NULL,
    "taskName" TEXT NOT NULL,
    "uniqueId" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "parametersJson" TEXT NOT NULL DEFAULT '{}',
    "outputsJson" TEXT NOT NULL DEFAULT '[]',
    "processingTimeSec" REAL,
    "taskLogJson" TEXT,
    "rerunReason" TEXT,
    "codeVersionHint" TEXT,
    "upstreamNodeIdsJson" TEXT NOT NULL DEFAULT '[]',
    "downstreamNodeIdsJson" TEXT NOT NULL DEFAULT '[]',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "task_lineage_nodes_runId_fkey" FOREIGN KEY ("runId") REFERENCES "runs" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "task_graph_edges" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "runId" TEXT NOT NULL,
    "sourceTaskNodeId" TEXT NOT NULL,
    "targetTaskNodeId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "task_graph_edges_runId_fkey" FOREIGN KEY ("runId") REFERENCES "runs" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "task_graph_edges_sourceTaskNodeId_fkey" FOREIGN KEY ("sourceTaskNodeId") REFERENCES "task_lineage_nodes" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "task_graph_edges_targetTaskNodeId_fkey" FOREIGN KEY ("targetTaskNodeId") REFERENCES "task_lineage_nodes" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "artifacts" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "projectId" TEXT NOT NULL,
    "runId" TEXT,
    "taskNodeId" TEXT,
    "kind" TEXT NOT NULL,
    "absolutePath" TEXT NOT NULL,
    "relativePath" TEXT NOT NULL,
    "sizeBytes" INTEGER,
    "mimeType" TEXT,
    "previewable" BOOLEAN NOT NULL,
    "modifiedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "artifacts_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "artifacts_runId_fkey" FOREIGN KEY ("runId") REFERENCES "runs" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "artifacts_taskNodeId_fkey" FOREIGN KEY ("taskNodeId") REFERENCES "task_lineage_nodes" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "timeline_events" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "runId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "at" DATETIME NOT NULL,
    "payloadJson" TEXT,
    CONSTRAINT "timeline_events_runId_fkey" FOREIGN KEY ("runId") REFERENCES "runs" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "log_events" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "runId" TEXT NOT NULL,
    "stream" TEXT NOT NULL,
    "line" TEXT NOT NULL,
    "at" DATETIME NOT NULL,
    CONSTRAINT "log_events_runId_fkey" FOREIGN KEY ("runId") REFERENCES "runs" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "watch_events" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "projectId" TEXT NOT NULL,
    "runId" TEXT,
    "kind" TEXT NOT NULL,
    "absolutePath" TEXT NOT NULL,
    "relativePath" TEXT NOT NULL,
    "inferredArtifactKind" TEXT,
    "occurredAt" DATETIME NOT NULL,
    CONSTRAINT "watch_events_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "watch_events_runId_fkey" FOREIGN KEY ("runId") REFERENCES "runs" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "project_connections_projectId_key" ON "project_connections"("projectId");

-- CreateIndex
CREATE INDEX "project_connections_accessMode_idx" ON "project_connections"("accessMode");

-- CreateIndex
CREATE INDEX "profiles_projectId_kind_idx" ON "profiles"("projectId", "kind");

-- CreateIndex
CREATE INDEX "run_specs_projectId_createdAt_idx" ON "run_specs"("projectId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "runs_runSpecId_key" ON "runs"("runSpecId");

-- CreateIndex
CREATE INDEX "runs_projectId_status_idx" ON "runs"("projectId", "status");

-- CreateIndex
CREATE INDEX "runs_schedulerTaskId_idx" ON "runs"("schedulerTaskId");

-- CreateIndex
CREATE INDEX "run_control_actions_projectId_createdAt_idx" ON "run_control_actions"("projectId", "createdAt");

-- CreateIndex
CREATE INDEX "run_control_actions_runId_createdAt_idx" ON "run_control_actions"("runId", "createdAt");

-- CreateIndex
CREATE INDEX "capability_snapshots_projectId_capturedAt_idx" ON "capability_snapshots"("projectId", "capturedAt");

-- CreateIndex
CREATE INDEX "scheduler_snapshots_projectId_capturedAt_idx" ON "scheduler_snapshots"("projectId", "capturedAt");

-- CreateIndex
CREATE INDEX "scheduler_snapshots_runId_capturedAt_idx" ON "scheduler_snapshots"("runId", "capturedAt");

-- CreateIndex
CREATE INDEX "task_lineage_nodes_runId_state_idx" ON "task_lineage_nodes"("runId", "state");

-- CreateIndex
CREATE INDEX "task_lineage_nodes_runId_uniqueId_idx" ON "task_lineage_nodes"("runId", "uniqueId");

-- CreateIndex
CREATE INDEX "task_graph_edges_runId_idx" ON "task_graph_edges"("runId");

-- CreateIndex
CREATE INDEX "task_graph_edges_sourceTaskNodeId_idx" ON "task_graph_edges"("sourceTaskNodeId");

-- CreateIndex
CREATE INDEX "task_graph_edges_targetTaskNodeId_idx" ON "task_graph_edges"("targetTaskNodeId");

-- CreateIndex
CREATE INDEX "artifacts_projectId_kind_idx" ON "artifacts"("projectId", "kind");

-- CreateIndex
CREATE INDEX "artifacts_runId_kind_idx" ON "artifacts"("runId", "kind");

-- CreateIndex
CREATE INDEX "artifacts_taskNodeId_idx" ON "artifacts"("taskNodeId");

-- CreateIndex
CREATE INDEX "timeline_events_runId_at_idx" ON "timeline_events"("runId", "at");

-- CreateIndex
CREATE INDEX "log_events_runId_at_idx" ON "log_events"("runId", "at");

-- CreateIndex
CREATE INDEX "watch_events_projectId_occurredAt_idx" ON "watch_events"("projectId", "occurredAt");

-- CreateIndex
CREATE INDEX "watch_events_runId_occurredAt_idx" ON "watch_events"("runId", "occurredAt");
