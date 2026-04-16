import { Search } from "lucide-react";
import {
  startTransition,
  useDeferredValue,
  useEffect,
  useEffectEvent,
  useRef,
  useState,
} from "react";
import { cn } from "@/lib/utils";

export type CommandPaletteCommand = {
  id: string;
  label: string;
  description: string;
  keywords?: string[];
  disabled?: boolean;
  onSelect: () => void;
};

export const CommandPalette = ({
  commands,
  open,
  onOpenChange,
}: {
  commands: CommandPaletteCommand[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) => {
  const [query, setQuery] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const deferredQuery = useDeferredValue(query);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const filteredCommands = commands.filter((command) => {
    const haystack =
      `${command.label} ${command.description} ${(command.keywords ?? []).join(" ")}`.toLowerCase();
    return haystack.includes(deferredQuery.trim().toLowerCase());
  });

  useEffect(() => {
    if (!open) {
      setQuery("");
      setSelectedIndex(0);
      return;
    }

    setSelectedIndex(0);
    const frame = requestAnimationFrame(() => {
      inputRef.current?.focus();
    });

    return () => cancelAnimationFrame(frame);
  }, [open]);

  const onKeyDown = useEffectEvent((event: KeyboardEvent) => {
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
      event.preventDefault();
      onOpenChange(!open);
      return;
    }

    if (!open) {
      return;
    }

    if (event.key === "Escape") {
      onOpenChange(false);
      return;
    }

    if (event.key === "ArrowDown") {
      event.preventDefault();
      setSelectedIndex((current) =>
        filteredCommands.length === 0 ? 0 : Math.min(current + 1, filteredCommands.length - 1),
      );
      return;
    }

    if (event.key === "ArrowUp") {
      event.preventDefault();
      setSelectedIndex((current) => Math.max(current - 1, 0));
      return;
    }

    if (event.key === "Enter") {
      const command = filteredCommands[selectedIndex];
      if (!command || command.disabled) {
        return;
      }

      event.preventDefault();
      startTransition(() => {
        command.onSelect();
        onOpenChange(false);
      });
    }
  });

  useEffect(() => {
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  if (!open) {
    return null;
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-slate-950/35 px-4 py-20 backdrop-blur-sm">
      <div className="w-full max-w-2xl rounded-[2rem] border border-white/80 bg-white/95 p-4 shadow-2xl">
        <div className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-slate-50/90 px-4 py-3">
          <Search className="size-4 text-slate-500" />
          <input
            className="w-full bg-transparent text-sm text-slate-900 outline-none placeholder:text-slate-400"
            onChange={(event) => {
              setQuery(event.target.value);
              setSelectedIndex(0);
            }}
            placeholder="Jump to a project, open a run, or validate connection state"
            ref={inputRef}
            value={query}
          />
          <span className="rounded-full border border-slate-200 px-2 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">
            esc
          </span>
        </div>
        <div className="mt-4 max-h-[28rem] overflow-auto">
          {filteredCommands.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-slate-300 p-6 text-center text-sm text-slate-600">
              No command matches the current query.
            </div>
          ) : (
            <div className="space-y-2">
              {filteredCommands.map((command, index) => (
                <button
                  className={cn(
                    "w-full rounded-2xl border px-4 py-3 text-left transition",
                    index === selectedIndex
                      ? "border-primary bg-primary/5"
                      : "border-transparent bg-slate-50/80 hover:border-slate-200",
                    command.disabled ? "cursor-not-allowed opacity-50" : "",
                  )}
                  disabled={command.disabled}
                  key={command.id}
                  onClick={() => {
                    startTransition(() => {
                      command.onSelect();
                      onOpenChange(false);
                    });
                  }}
                  type="button"
                >
                  <div className="text-sm font-semibold text-slate-950">{command.label}</div>
                  <div className="mt-1 text-sm text-slate-600">{command.description}</div>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
