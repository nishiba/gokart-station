import fs from "node:fs/promises";
import path from "node:path";
import type { ArtifactKind, FileTreeNode } from "@gokart-station/shared";
import type { SandboxScope } from "../services/path-sandbox-service";

const ignoredDirectoryNames = new Set([
  ".git",
  ".mypy_cache",
  ".pytest_cache",
  ".ruff_cache",
  ".venv",
  "__pycache__",
  "node_modules",
  "venv",
]);

export type FileSnapshotEntry = {
  absolutePath: string;
  relativePath: string;
  scopeKey: SandboxScope["key"];
  mtimeMs: number;
  sizeBytes: number;
  inferredArtifactKind?: ArtifactKind | null | undefined;
};

type ScanOptions = {
  maxDepth?: number;
  maxEntriesPerDirectory?: number;
};

const buildDisplayRelativePath = (scope: SandboxScope, absolutePath: string) => {
  if (scope.kind === "file") {
    return scope.label;
  }

  const relativePath = path.relative(scope.realPath, absolutePath);
  return relativePath.length === 0
    ? scope.label
    : path.posix.join(scope.label, relativePath.split(path.sep).join(path.posix.sep));
};

const toPosixBasename = (absolutePath: string) => {
  return path.basename(absolutePath);
};

export const inferArtifactKindFromPath = (absolutePath: string): ArtifactKind | null => {
  const normalizedPath = absolutePath.toLowerCase();

  if (normalizedPath.endsWith("task-info-tree.json")) {
    return "task_info_tree";
  }
  if (normalizedPath.endsWith("task-info-table.json")) {
    return "task_info_table";
  }
  if (normalizedPath.endsWith("adapter-events.jsonl")) {
    return "adapter_events";
  }
  if (
    normalizedPath.endsWith("stderr.log") ||
    normalizedPath.endsWith("stdout.log") ||
    normalizedPath.includes("/logs/")
  ) {
    return "task_log";
  }
  if (normalizedPath.endsWith(".env")) {
    return "env_source";
  }
  if (normalizedPath.endsWith(".cfg") || normalizedPath.endsWith(".conf")) {
    return "config_source";
  }
  if (normalizedPath.includes("support-bundles") || normalizedPath.endsWith("bundle.json")) {
    return "support_bundle";
  }
  if (
    normalizedPath.endsWith(".json") ||
    normalizedPath.endsWith(".csv") ||
    normalizedPath.endsWith(".parquet")
  ) {
    return "output";
  }

  return null;
};

const buildFileTreeNode = async (
  scope: SandboxScope,
  absolutePath: string,
  depth: number,
  options: Required<ScanOptions>,
): Promise<FileTreeNode | null> => {
  let stats: Awaited<ReturnType<typeof fs.lstat>>;
  try {
    stats = await fs.lstat(absolutePath);
  } catch {
    return null;
  }

  if (stats.isSymbolicLink()) {
    return null;
  }

  const relativePath = buildDisplayRelativePath(scope, absolutePath);
  if (!stats.isDirectory()) {
    return {
      name: toPosixBasename(absolutePath),
      absolutePath,
      relativePath,
      isDirectory: false,
      sizeBytes: stats.size,
      inferredArtifactKind: inferArtifactKindFromPath(absolutePath),
    };
  }

  if (depth >= options.maxDepth) {
    return {
      name: absolutePath === scope.realPath ? scope.label : toPosixBasename(absolutePath),
      absolutePath,
      relativePath,
      isDirectory: true,
      children: [],
    };
  }

  const directoryEntries = await fs.readdir(absolutePath, {
    withFileTypes: true,
  });
  const children: FileTreeNode[] = [];

  for (const entry of directoryEntries
    .filter((candidate) => !ignoredDirectoryNames.has(candidate.name))
    .sort((left, right) => left.name.localeCompare(right.name))
    .slice(0, options.maxEntriesPerDirectory)) {
    const childPath = path.join(absolutePath, entry.name);
    const childNode = await buildFileTreeNode(scope, childPath, depth + 1, options);
    if (childNode) {
      children.push(childNode);
    }
  }

  return {
    name: absolutePath === scope.realPath ? scope.label : toPosixBasename(absolutePath),
    absolutePath,
    relativePath,
    isDirectory: true,
    children,
  };
};

const collectFileSnapshotEntries = async (
  scope: SandboxScope,
  absolutePath: string,
  depth: number,
  options: Required<ScanOptions>,
  results: Map<string, FileSnapshotEntry>,
) => {
  let stats: Awaited<ReturnType<typeof fs.lstat>>;
  try {
    stats = await fs.lstat(absolutePath);
  } catch {
    return;
  }

  if (stats.isSymbolicLink()) {
    return;
  }

  if (!stats.isDirectory()) {
    results.set(absolutePath, {
      absolutePath,
      relativePath: buildDisplayRelativePath(scope, absolutePath),
      scopeKey: scope.key,
      mtimeMs: stats.mtimeMs,
      sizeBytes: stats.size,
      inferredArtifactKind: inferArtifactKindFromPath(absolutePath),
    });
    return;
  }

  if (depth >= options.maxDepth) {
    return;
  }

  const directoryEntries = await fs.readdir(absolutePath, {
    withFileTypes: true,
  });
  for (const entry of directoryEntries) {
    if (ignoredDirectoryNames.has(entry.name)) {
      continue;
    }

    await collectFileSnapshotEntries(
      scope,
      path.join(absolutePath, entry.name),
      depth + 1,
      options,
      results,
    );
  }
};

export const buildFileTree = async (scopes: SandboxScope[], options: ScanOptions = {}) => {
  const resolvedOptions: Required<ScanOptions> = {
    maxDepth: options.maxDepth ?? 4,
    maxEntriesPerDirectory: options.maxEntriesPerDirectory ?? 200,
  };

  const nodes: FileTreeNode[] = [];
  for (const scope of scopes) {
    const rootNode = await buildFileTreeNode(scope, scope.realPath, 0, resolvedOptions);
    if (rootNode) {
      nodes.push(rootNode);
    }
  }

  return nodes;
};

export const collectFileSnapshot = async (scopes: SandboxScope[], options: ScanOptions = {}) => {
  const resolvedOptions: Required<ScanOptions> = {
    maxDepth: options.maxDepth ?? 8,
    maxEntriesPerDirectory: options.maxEntriesPerDirectory ?? 500,
  };
  const results = new Map<string, FileSnapshotEntry>();

  for (const scope of scopes) {
    await collectFileSnapshotEntries(scope, scope.realPath, 0, resolvedOptions, results);
  }

  return results;
};
