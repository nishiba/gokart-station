import type { JsonParameterValue } from "@gokart-station/shared";
import { Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { FieldLabel, inputClassName, selectClassName, textareaClassName } from "./surface";

export type ParameterRow = {
  id: string;
  key: string;
  type: "string" | "number" | "boolean" | "json";
  value: string;
};

export type StringRow = {
  id: string;
  key: string;
  value: string;
};

const createId = () => crypto.randomUUID();

export const parameterRowsFromValues = (
  values: Record<string, JsonParameterValue | unknown>,
): ParameterRow[] => {
  const entries = Object.entries(values);
  if (entries.length === 0) {
    return [createEmptyParameterRow()];
  }

  return entries.map(([key, value]) => {
    if (typeof value === "number") {
      return { id: createId(), key, type: "number", value: String(value) };
    }
    if (typeof value === "boolean") {
      return { id: createId(), key, type: "boolean", value: value ? "true" : "false" };
    }
    if (typeof value === "string" || value === null) {
      return { id: createId(), key, type: "string", value: value ?? "" };
    }

    return {
      id: createId(),
      key,
      type: "json",
      value: JSON.stringify(value, null, 2),
    };
  });
};

export const parameterRowsToRecord = (rows: ParameterRow[]) => {
  const result: Record<string, JsonParameterValue> = {};

  for (const row of rows) {
    const normalizedKey = row.key.trim();
    if (!normalizedKey) {
      continue;
    }

    switch (row.type) {
      case "string":
        result[normalizedKey] = row.value;
        break;
      case "number":
        result[normalizedKey] = Number(row.value);
        break;
      case "boolean":
        result[normalizedKey] = row.value === "true";
        break;
      case "json":
        result[normalizedKey] = JSON.parse(row.value) as JsonParameterValue;
        break;
    }
  }

  return result;
};

export const stringRowsFromRecord = (values: Record<string, string>) => {
  const entries = Object.entries(values);
  if (entries.length === 0) {
    return [createEmptyStringRow()];
  }

  return entries.map(([key, value]) => ({
    id: createId(),
    key,
    value,
  }));
};

export const stringRowsToRecord = (rows: StringRow[]) => {
  return Object.fromEntries(
    rows.map((row) => [row.key.trim(), row.value] as const).filter(([key]) => key.length > 0),
  );
};

export const createEmptyParameterRow = (): ParameterRow => ({
  id: createId(),
  key: "",
  type: "string",
  value: "",
});

export const createEmptyStringRow = (): StringRow => ({
  id: createId(),
  key: "",
  value: "",
});

export const ParameterEditor = ({
  rows,
  onChange,
  label,
  hint,
}: {
  rows: ParameterRow[];
  onChange: (rows: ParameterRow[]) => void;
  label: string;
  hint?: string;
}) => {
  return (
    <div className="space-y-3">
      <FieldLabel hint={hint} label={label} />
      <div className="space-y-3">
        {rows.map((row) => (
          <div
            className="grid gap-3 rounded-2xl border border-slate-200 bg-slate-50/80 p-3 lg:grid-cols-[1.2fr_160px_1.5fr_auto]"
            key={row.id}
          >
            <input
              className={inputClassName}
              onChange={(event) =>
                onChange(
                  rows.map((entry) =>
                    entry.id === row.id ? { ...entry, key: event.target.value } : entry,
                  ),
                )
              }
              placeholder="parameter_key"
              value={row.key}
            />
            <select
              className={selectClassName}
              onChange={(event) =>
                onChange(
                  rows.map((entry) =>
                    entry.id === row.id
                      ? {
                          ...entry,
                          type: event.target.value as ParameterRow["type"],
                          value: event.target.value === "boolean" ? "true" : entry.value,
                        }
                      : entry,
                  ),
                )
              }
              value={row.type}
            >
              <option value="string">string</option>
              <option value="number">number</option>
              <option value="boolean">boolean</option>
              <option value="json">json</option>
            </select>
            {row.type === "json" ? (
              <textarea
                className={textareaClassName}
                onChange={(event) =>
                  onChange(
                    rows.map((entry) =>
                      entry.id === row.id ? { ...entry, value: event.target.value } : entry,
                    ),
                  )
                }
                placeholder='{"key":"value"}'
                value={row.value}
              />
            ) : row.type === "boolean" ? (
              <select
                className={selectClassName}
                onChange={(event) =>
                  onChange(
                    rows.map((entry) =>
                      entry.id === row.id ? { ...entry, value: event.target.value } : entry,
                    ),
                  )
                }
                value={row.value}
              >
                <option value="true">true</option>
                <option value="false">false</option>
              </select>
            ) : (
              <input
                className={inputClassName}
                onChange={(event) =>
                  onChange(
                    rows.map((entry) =>
                      entry.id === row.id ? { ...entry, value: event.target.value } : entry,
                    ),
                  )
                }
                placeholder={row.type === "number" ? "42" : "value"}
                value={row.value}
              />
            )}
            <Button
              onClick={() =>
                onChange(
                  rows.length === 1
                    ? [createEmptyParameterRow()]
                    : rows.filter((entry) => entry.id !== row.id),
                )
              }
              size="sm"
              type="button"
              variant="ghost"
            >
              <Trash2 className="size-4" />
            </Button>
          </div>
        ))}
      </div>
      <Button
        onClick={() => onChange([...rows, createEmptyParameterRow()])}
        type="button"
        variant="outline"
      >
        Add parameter
      </Button>
    </div>
  );
};

export const StringRecordEditor = ({
  rows,
  onChange,
  label,
  hint,
}: {
  rows: StringRow[];
  onChange: (rows: StringRow[]) => void;
  label: string;
  hint?: string;
}) => {
  return (
    <div className="space-y-3">
      <FieldLabel hint={hint} label={label} />
      <div className="space-y-3">
        {rows.map((row) => (
          <div
            className="grid gap-3 rounded-2xl border border-slate-200 bg-slate-50/80 p-3 lg:grid-cols-[1fr_1.4fr_auto]"
            key={row.id}
          >
            <input
              className={inputClassName}
              onChange={(event) =>
                onChange(
                  rows.map((entry) =>
                    entry.id === row.id ? { ...entry, key: event.target.value } : entry,
                  ),
                )
              }
              placeholder="KEY_NAME"
              value={row.key}
            />
            <input
              className={inputClassName}
              onChange={(event) =>
                onChange(
                  rows.map((entry) =>
                    entry.id === row.id ? { ...entry, value: event.target.value } : entry,
                  ),
                )
              }
              placeholder="value"
              value={row.value}
            />
            <Button
              onClick={() =>
                onChange(
                  rows.length === 1
                    ? [createEmptyStringRow()]
                    : rows.filter((entry) => entry.id !== row.id),
                )
              }
              size="sm"
              type="button"
              variant="ghost"
            >
              <Trash2 className="size-4" />
            </Button>
          </div>
        ))}
      </div>
      <Button
        onClick={() => onChange([...rows, createEmptyStringRow()])}
        type="button"
        variant="outline"
      >
        Add override
      </Button>
    </div>
  );
};
