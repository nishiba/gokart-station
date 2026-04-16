import type {
  AccessMode,
  CapabilitySet,
  RunStatus,
  SchedulerHealth,
  TaskState,
} from "@gokart-station/shared";

export type StatusValue =
  | RunStatus
  | TaskState
  | SchedulerHealth
  | "idle"
  | "ok"
  | "success"
  | "warning";

export const formatAccessModeLabel = (accessMode: AccessMode) => {
  switch (accessMode) {
    case "observer":
      return "Observer";
    case "operator":
      return "Operator";
    case "managed":
      return "Managed";
  }
};

export const formatStatusLabel = (status: StatusValue) => {
  if (status === "ok") {
    return "OK";
  }

  return status.toLowerCase().replaceAll("_", " ");
};

export const formatDateTime = (value: string | null | undefined) => {
  if (!value) {
    return "Not available";
  }

  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
};

export const formatDuration = (
  startedAt: string | null | undefined,
  finishedAt: string | null | undefined,
) => {
  if (!startedAt) {
    return "Pending";
  }

  const start = new Date(startedAt).getTime();
  const end = finishedAt ? new Date(finishedAt).getTime() : Date.now();
  const deltaMs = Math.max(end - start, 0);
  const seconds = Math.floor(deltaMs / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);

  if (hours > 0) {
    return `${hours}h ${minutes % 60}m`;
  }

  if (minutes > 0) {
    return `${minutes}m ${seconds % 60}s`;
  }

  return `${seconds}s`;
};

export const formatBytes = (value: number | null | undefined) => {
  if (value == null) {
    return "Unknown";
  }

  if (value < 1024) {
    return `${value} B`;
  }

  const units = ["KB", "MB", "GB", "TB"];
  let current = value / 1024;
  let unitIndex = 0;

  while (current >= 1024 && unitIndex < units.length - 1) {
    current /= 1024;
    unitIndex += 1;
  }

  return `${current.toFixed(current >= 10 ? 0 : 1)} ${units[unitIndex]}`;
};

export const formatCapabilityLabel = (key: keyof CapabilitySet) => {
  return key
    .replace(/^can/, "")
    .replace(/([A-Z])/g, " $1")
    .trim();
};

export const summarizePath = (value: string | null | undefined) => {
  if (!value) {
    return "Not set";
  }

  if (value.length <= 48) {
    return value;
  }

  return `${value.slice(0, 20)}…${value.slice(-24)}`;
};

export const statusTone = (status: StatusValue) => {
  switch (status) {
    case "success":
    case "DONE":
    case "healthy":
    case "ok":
      return "success";
    case "failed":
    case "FAILED":
    case "unreachable":
    case "canceled":
      return "danger";
    case "running":
    case "RUNNING":
    case "starting":
    case "queued":
    case "PENDING":
      return "info";
    case "stopping":
    case "warning":
    case "degraded":
      return "warning";
    default:
      return "muted";
  }
};
