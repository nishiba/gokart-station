import type { AccessMode } from "@gokart-station/shared";
import { useEffect, useState } from "react";
import { FieldLabel, InlineNotice, inputClassName, selectClassName } from "@/components/surface";
import { Button } from "@/components/ui/button";
import type { ProfileRecord, ProjectRecord } from "@/lib/api";

export type ProjectFormValues = {
  name: string;
  accessMode: AccessMode;
  projectRootDir: string;
  pythonExecutable: string;
  entrypointPath: string;
  workspaceDirectory: string;
  luigiConfigPath: string;
  envSourcePath: string;
  schedulerBaseUrl: string;
  defaultConfigProfileId: string;
  defaultEnvProfileId: string;
};

export const emptyProjectFormValues: ProjectFormValues = {
  name: "",
  accessMode: "observer",
  projectRootDir: "",
  pythonExecutable: "",
  entrypointPath: "",
  workspaceDirectory: "",
  luigiConfigPath: "",
  envSourcePath: "",
  schedulerBaseUrl: "",
  defaultConfigProfileId: "",
  defaultEnvProfileId: "",
};

export const projectToFormValues = (project: ProjectRecord): ProjectFormValues => {
  return {
    name: project.name,
    accessMode: project.connection.accessMode,
    projectRootDir: project.connection.projectRootDir ?? "",
    pythonExecutable: project.connection.pythonExecutable ?? "",
    entrypointPath: project.connection.entrypointPath ?? "",
    workspaceDirectory: project.connection.workspaceDirectory,
    luigiConfigPath: project.connection.luigiConfigPath ?? "",
    envSourcePath: project.connection.envSourcePath ?? "",
    schedulerBaseUrl: project.connection.schedulerBaseUrl ?? "",
    defaultConfigProfileId: project.defaultConfigProfileId ?? "",
    defaultEnvProfileId: project.defaultEnvProfileId ?? "",
  };
};

export const projectFormValuesToRequest = (values: ProjectFormValues) => {
  return {
    name: values.name.trim(),
    connection: {
      accessMode: values.accessMode,
      workspaceDirectory: values.workspaceDirectory.trim(),
      projectRootDir: values.projectRootDir.trim() || null,
      pythonExecutable: values.pythonExecutable.trim() || null,
      entrypointPath: values.entrypointPath.trim() || null,
      luigiConfigPath: values.luigiConfigPath.trim() || null,
      envSourcePath: values.envSourcePath.trim() || null,
      schedulerBaseUrl: values.schedulerBaseUrl.trim() || null,
    },
    defaultConfigProfileId: values.defaultConfigProfileId || null,
    defaultEnvProfileId: values.defaultEnvProfileId || null,
  };
};

export const ProjectForm = ({
  initialValues,
  configProfiles,
  envProfiles,
  submitLabel,
  busy = false,
  onSubmit,
}: {
  initialValues: ProjectFormValues;
  configProfiles: ProfileRecord[];
  envProfiles: ProfileRecord[];
  submitLabel: string;
  busy?: boolean;
  onSubmit: (values: ProjectFormValues) => void | Promise<void>;
}) => {
  const [values, setValues] = useState(initialValues);

  useEffect(() => {
    setValues(initialValues);
  }, [initialValues]);

  const requiresOperatorPaths = values.accessMode !== "observer";

  return (
    <form
      className="space-y-5"
      onSubmit={(event) => {
        event.preventDefault();
        void onSubmit(values);
      }}
    >
      {values.accessMode === "observer" ? (
        <InlineNotice title="Workspace-only observer" tone="warning">
          Run control, profile editing, and scheduler lifecycle stay disabled until this connection
          is switched to operator or managed.
        </InlineNotice>
      ) : (
        <InlineNotice title="Control plane mode" tone="info">
          Operator and managed require explicit target repo, python executable, entrypoint, and
          workspace paths so station can spawn the adapter safely.
        </InlineNotice>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="space-y-2">
          <FieldLabel label="Project name" required />
          <input
            aria-label="Project name"
            className={inputClassName}
            onChange={(event) => setValues((current) => ({ ...current, name: event.target.value }))}
            required
            value={values.name}
          />
        </div>
        <div className="space-y-2">
          <FieldLabel label="Access mode" required />
          <select
            aria-label="Access mode"
            className={selectClassName}
            onChange={(event) =>
              setValues((current) => ({
                ...current,
                accessMode: event.target.value as AccessMode,
              }))
            }
            value={values.accessMode}
          >
            <option value="observer">observer</option>
            <option value="operator">operator</option>
            <option value="managed">managed</option>
          </select>
        </div>
      </div>

      <div className="space-y-2">
        <FieldLabel
          hint="This stays outside the station repo. Observer only needs the workspace."
          label="Workspace directory"
          required
        />
        <input
          aria-label="Workspace directory"
          className={inputClassName}
          onChange={(event) =>
            setValues((current) => ({
              ...current,
              workspaceDirectory: event.target.value,
            }))
          }
          required
          value={values.workspaceDirectory}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="space-y-2">
          <FieldLabel
            hint="Required for operator and managed."
            label="Target project root"
            required={requiresOperatorPaths}
          />
          <input
            aria-label="Target project root"
            className={inputClassName}
            onChange={(event) =>
              setValues((current) => ({ ...current, projectRootDir: event.target.value }))
            }
            required={requiresOperatorPaths}
            value={values.projectRootDir}
          />
        </div>
        <div className="space-y-2">
          <FieldLabel
            hint="Relative to the target project root or absolute."
            label="Entrypoint path"
            required={requiresOperatorPaths}
          />
          <input
            aria-label="Entrypoint path"
            className={inputClassName}
            onChange={(event) =>
              setValues((current) => ({ ...current, entrypointPath: event.target.value }))
            }
            required={requiresOperatorPaths}
            value={values.entrypointPath}
          />
        </div>
        <div className="space-y-2">
          <FieldLabel label="Python executable" required={requiresOperatorPaths} />
          <input
            aria-label="Python executable"
            className={inputClassName}
            onChange={(event) =>
              setValues((current) => ({ ...current, pythonExecutable: event.target.value }))
            }
            required={requiresOperatorPaths}
            value={values.pythonExecutable}
          />
        </div>
        <div className="space-y-2">
          <FieldLabel
            hint="Optional override. Defaults to localhost scheduler."
            label="Scheduler URL"
          />
          <input
            aria-label="Scheduler URL"
            className={inputClassName}
            onChange={(event) =>
              setValues((current) => ({ ...current, schedulerBaseUrl: event.target.value }))
            }
            placeholder="http://127.0.0.1:8082"
            value={values.schedulerBaseUrl}
          />
        </div>
        <div className="space-y-2">
          <FieldLabel label="Luigi config path" />
          <input
            aria-label="Luigi config path"
            className={inputClassName}
            onChange={(event) =>
              setValues((current) => ({ ...current, luigiConfigPath: event.target.value }))
            }
            value={values.luigiConfigPath}
          />
        </div>
        <div className="space-y-2">
          <FieldLabel label="Env source path" />
          <input
            aria-label="Env source path"
            className={inputClassName}
            onChange={(event) =>
              setValues((current) => ({ ...current, envSourcePath: event.target.value }))
            }
            value={values.envSourcePath}
          />
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="space-y-2">
          <FieldLabel label="Default config profile" />
          <select
            aria-label="Default config profile"
            className={selectClassName}
            onChange={(event) =>
              setValues((current) => ({ ...current, defaultConfigProfileId: event.target.value }))
            }
            value={values.defaultConfigProfileId}
          >
            <option value="">None</option>
            {configProfiles.map((profile) => (
              <option key={profile.id} value={profile.id}>
                {profile.name}
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-2">
          <FieldLabel label="Default env profile" />
          <select
            aria-label="Default env profile"
            className={selectClassName}
            onChange={(event) =>
              setValues((current) => ({ ...current, defaultEnvProfileId: event.target.value }))
            }
            value={values.defaultEnvProfileId}
          >
            <option value="">None</option>
            {envProfiles.map((profile) => (
              <option key={profile.id} value={profile.id}>
                {profile.name}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="flex justify-end">
        <Button disabled={busy} type="submit">
          {submitLabel}
        </Button>
      </div>
    </form>
  );
};
