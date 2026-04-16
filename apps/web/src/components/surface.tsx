import type { AccessMode, CapabilitySet } from "@gokart-station/shared";
import { AlertTriangle, LoaderCircle } from "lucide-react";
import type { PropsWithChildren, ReactNode } from "react";
import {
  formatAccessModeLabel,
  formatCapabilityLabel,
  formatStatusLabel,
  type StatusValue,
  statusTone,
} from "@/lib/format";
import { cn } from "@/lib/utils";

export const inputClassName =
  "h-11 w-full rounded-xl border border-slate-200 bg-white/90 px-3 text-sm text-slate-900 shadow-sm outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/20";
export const textareaClassName =
  "min-h-28 w-full rounded-xl border border-slate-200 bg-white/90 px-3 py-3 text-sm text-slate-900 shadow-sm outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/20";
export const selectClassName =
  "h-11 w-full rounded-xl border border-slate-200 bg-white/90 px-3 text-sm text-slate-900 shadow-sm outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/20";

const toneClassName = {
  success: "border-emerald-200 bg-emerald-50 text-emerald-900",
  danger: "border-rose-200 bg-rose-50 text-rose-900",
  warning: "border-amber-200 bg-amber-50 text-amber-900",
  info: "border-sky-200 bg-sky-50 text-sky-900",
  muted: "border-slate-200 bg-slate-100 text-slate-700",
} as const;

export const PageHeader = ({
  title,
  description,
  actions,
}: {
  title: string;
  description: string;
  actions?: ReactNode;
}) => {
  return (
    <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
      <div className="space-y-2">
        <h1 className="text-3xl font-semibold tracking-tight text-slate-950">{title}</h1>
        <p className="max-w-3xl text-sm leading-6 text-slate-600">{description}</p>
      </div>
      {actions ? <div className="flex flex-wrap gap-2">{actions}</div> : null}
    </div>
  );
};

export const SectionCard = ({
  title,
  description,
  actions,
  children,
  className,
}: PropsWithChildren<{
  title: string;
  description?: string;
  actions?: ReactNode;
  className?: string;
}>) => {
  return (
    <section
      className={cn(
        "rounded-[1.5rem] border border-white/70 bg-white/90 p-5 shadow-[0_18px_48px_-30px_rgba(15,23,42,0.45)] backdrop-blur",
        className,
      )}
    >
      <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div className="space-y-1">
          <h2 className="text-lg font-semibold text-slate-950">{title}</h2>
          {description ? <p className="text-sm leading-6 text-slate-600">{description}</p> : null}
        </div>
        {actions ? <div className="flex flex-wrap gap-2">{actions}</div> : null}
      </div>
      {children}
    </section>
  );
};

export const InlineNotice = ({
  title,
  children,
  tone = "warning",
}: PropsWithChildren<{
  title: string;
  tone?: keyof typeof toneClassName;
}>) => {
  return (
    <div className={cn("rounded-2xl border p-4", toneClassName[tone])}>
      <div className="flex gap-3">
        <AlertTriangle className="mt-0.5 size-4 shrink-0" />
        <div className="space-y-1">
          <div className="text-sm font-semibold">{title}</div>
          <div className="text-sm leading-6">{children}</div>
        </div>
      </div>
    </div>
  );
};

export const ModeBadge = ({ accessMode }: { accessMode: AccessMode }) => {
  const tone =
    accessMode === "observer" ? "warning" : accessMode === "operator" ? "info" : "success";
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border px-3 py-1 text-xs font-semibold uppercase tracking-[0.2em]",
        toneClassName[tone],
      )}
    >
      {formatAccessModeLabel(accessMode)}
    </span>
  );
};

export const StatusBadge = ({ status }: { status: StatusValue }) => {
  const tone = statusTone(status);
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em]",
        toneClassName[tone],
      )}
    >
      {formatStatusLabel(status)}
    </span>
  );
};

export const CapabilityStrip = ({
  capabilities,
  dense = false,
}: {
  capabilities: CapabilitySet;
  dense?: boolean;
}) => {
  return (
    <div className={cn("flex flex-wrap gap-2", dense ? "text-[11px]" : "text-xs")}>
      {Object.entries(capabilities).map(([key, value]) => (
        <span
          className={cn(
            "inline-flex items-center rounded-full border px-3 py-1 font-medium",
            value ? toneClassName.success : toneClassName.muted,
          )}
          key={key}
        >
          {formatCapabilityLabel(key as keyof CapabilitySet)}
        </span>
      ))}
    </div>
  );
};

export const LoadingState = ({ label = "Loading station data..." }: { label?: string }) => {
  return (
    <div className="flex min-h-40 items-center justify-center rounded-3xl border border-dashed border-slate-300 bg-white/70 text-sm text-slate-600">
      <div className="flex items-center gap-3">
        <LoaderCircle className="size-4 animate-spin" />
        {label}
      </div>
    </div>
  );
};

export const ErrorState = ({
  title,
  message,
  action,
}: {
  title: string;
  message: string;
  action?: ReactNode;
}) => {
  return (
    <div className="rounded-3xl border border-rose-200 bg-rose-50/90 p-5 text-rose-950">
      <div className="space-y-2">
        <h3 className="text-base font-semibold">{title}</h3>
        <p className="text-sm leading-6">{message}</p>
      </div>
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  );
};

export const EmptyState = ({
  title,
  message,
  action,
}: {
  title: string;
  message: string;
  action?: ReactNode;
}) => {
  return (
    <div className="rounded-3xl border border-dashed border-slate-300 bg-slate-50/80 p-6 text-center">
      <div className="space-y-2">
        <h3 className="text-base font-semibold text-slate-900">{title}</h3>
        <p className="text-sm leading-6 text-slate-600">{message}</p>
      </div>
      {action ? <div className="mt-4 flex justify-center">{action}</div> : null}
    </div>
  );
};

export const FieldLabel = ({
  label,
  hint,
  required = false,
}: {
  label: string;
  hint?: string | undefined;
  required?: boolean | undefined;
}) => {
  return (
    <div className="space-y-1">
      <div className="text-sm font-medium text-slate-800">
        {label}
        {required ? <span className="ml-1 text-rose-600">*</span> : null}
      </div>
      {hint ? <div className="text-xs text-slate-500">{hint}</div> : null}
    </div>
  );
};

export const StatTile = ({
  label,
  value,
  accent,
}: {
  label: string;
  value: ReactNode;
  accent?: ReactNode;
}) => {
  return (
    <div className="rounded-2xl border border-slate-200 bg-slate-50/80 p-4">
      <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
        {label}
      </div>
      <div className="mt-3 flex items-end justify-between gap-3">
        <div className="text-xl font-semibold text-slate-950">{value}</div>
        {accent ? <div>{accent}</div> : null}
      </div>
    </div>
  );
};

export const CodeBlock = ({ value }: { value: unknown }) => {
  return (
    <pre className="max-h-[32rem] overflow-auto rounded-2xl bg-slate-950 p-4 text-xs leading-6 text-slate-100">
      {typeof value === "string" ? value : JSON.stringify(value, null, 2)}
    </pre>
  );
};

export const ModalCard = ({
  title,
  description,
  onClose,
  children,
}: PropsWithChildren<{
  title: string;
  description?: string;
  onClose: () => void;
}>) => {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/35 px-4 py-8 backdrop-blur-sm">
      <div className="max-h-[90vh] w-full max-w-3xl overflow-auto rounded-[2rem] border border-white/70 bg-white p-6 shadow-2xl">
        <div className="mb-4 flex items-start justify-between gap-4">
          <div className="space-y-1">
            <h3 className="text-xl font-semibold text-slate-950">{title}</h3>
            {description ? <p className="text-sm leading-6 text-slate-600">{description}</p> : null}
          </div>
          <button
            className="rounded-full border border-slate-200 px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] text-slate-600"
            onClick={onClose}
            type="button"
          >
            Close
          </button>
        </div>
        {children}
      </div>
    </div>
  );
};
