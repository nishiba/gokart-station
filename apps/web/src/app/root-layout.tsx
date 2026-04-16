import { useQuery } from "@tanstack/react-query";
import { Command, HeartPulse, PlusCircle } from "lucide-react";
import { startTransition, useMemo, useState } from "react";
import { Link, NavLink, Outlet, useLocation, useNavigate, useParams } from "react-router-dom";
import { CapabilityStrip, InlineNotice, ModeBadge, StatusBadge } from "@/components/surface";
import { buttonVariants } from "@/components/ui/button";
import {
  CommandPalette,
  type CommandPaletteCommand,
} from "@/features/command-palette/command-palette";
import { api, type ProjectRecord, queryKeys } from "@/lib/api";
import { cn } from "@/lib/utils";

const navClassName = ({ isActive }: { isActive: boolean }) =>
  cn(
    "rounded-full px-4 py-2 text-sm font-medium transition",
    isActive ? "bg-slate-950 text-white" : "text-slate-700 hover:bg-white/80",
  );

export const RootLayout = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const params = useParams();
  const [paletteOpen, setPaletteOpen] = useState(false);

  const healthQuery = useQuery({
    queryKey: queryKeys.health,
    queryFn: api.getHealth,
  });
  const projectsQuery = useQuery({
    queryKey: queryKeys.projects,
    queryFn: api.listProjects,
  });
  const projects = projectsQuery.data ?? [];

  const currentProject =
    projects.find((project: ProjectRecord) => project.id === params.projectId) ?? null;
  const commands: CommandPaletteCommand[] = [
    {
      id: "projects",
      label: "Open Projects",
      description: "Go back to the control surface and registered project list.",
      keywords: ["home", "control surface"],
      onSelect: () => navigate("/projects"),
    },
    ...projects.flatMap((project: ProjectRecord) => [
      {
        id: `project:${project.id}`,
        label: `Open ${project.name}`,
        description: `${project.connection.accessMode} project overview and runs.`,
        keywords: [project.connection.workspaceDirectory, project.connection.projectRootDir ?? ""],
        onSelect: () => navigate(`/projects/${project.id}`),
      },
      {
        id: `project:${project.id}:profiles`,
        label: `${project.name}: Profiles`,
        description: "Inspect config and env profiles for this target project.",
        onSelect: () => navigate(`/projects/${project.id}/profiles`),
      },
      {
        id: `project:${project.id}:connection`,
        label: `${project.name}: Connection`,
        description: "Review mode, paths, validation, and scheduler state.",
        onSelect: () => navigate(`/projects/${project.id}/connection`),
      },
      {
        id: `project:${project.id}:run`,
        label: `${project.name}: New Run`,
        description: "Open the run spec form for this project.",
        disabled: !project.capabilities.canRun,
        onSelect: () => navigate(`/projects/${project.id}/runs/new`),
      },
    ]),
  ];

  const recentProjects = useMemo(() => projects.slice(0, 6), [projects]);

  return (
    <div className="min-h-screen">
      <CommandPalette commands={commands} onOpenChange={setPaletteOpen} open={paletteOpen} />
      <div className="mx-auto grid min-h-screen max-w-[1600px] gap-6 px-4 py-4 lg:grid-cols-[280px_minmax(0,1fr)] lg:px-6">
        <aside className="rounded-[2rem] border border-white/70 bg-white/90 p-5 shadow-[0_20px_60px_-36px_rgba(15,23,42,0.5)] backdrop-blur">
          <div className="space-y-5">
            <div>
              <div className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-500">
                gokart-station
              </div>
              <h1 className="mt-3 text-2xl font-semibold tracking-tight text-slate-950">
                Local gokart control surface
              </h1>
              <p className="mt-2 text-sm leading-6 text-slate-600">
                Station and target repos stay independent. Observer remains workspace-only.
              </p>
            </div>

            <div className="flex flex-wrap gap-2">
              <NavLink className={navClassName} to="/projects">
                Projects
              </NavLink>
              <button
                className={cn(buttonVariants({ variant: "ghost", size: "sm" }), "rounded-full")}
                onClick={() => setPaletteOpen(true)}
                type="button"
              >
                <Command className="size-4" />
                Palette
              </button>
            </div>

            <div className="rounded-[1.5rem] border border-slate-200 bg-slate-50/80 p-4">
              <div className="flex items-center justify-between gap-2">
                <div className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">
                  Agent Health
                </div>
                {healthQuery.data ? <StatusBadge status={healthQuery.data.status} /> : null}
              </div>
              <div className="mt-3 flex items-center gap-3 text-sm text-slate-700">
                <HeartPulse className="size-4 text-primary" />
                {healthQuery.data ? "Agent ready for local control." : "Checking agent state..."}
              </div>
            </div>

            <div className="space-y-3">
              <div className="flex items-center justify-between gap-3">
                <div className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">
                  Recent Projects
                </div>
                <Link className={cn(buttonVariants({ size: "sm" }), "rounded-full")} to="/projects">
                  <PlusCircle className="size-4" />
                  New
                </Link>
              </div>
              <div className="space-y-2">
                {recentProjects.map((project: ProjectRecord) => (
                  <button
                    className={cn(
                      "w-full rounded-2xl border px-4 py-3 text-left transition",
                      location.pathname.startsWith(`/projects/${project.id}`)
                        ? "border-primary bg-primary/5"
                        : "border-slate-200 bg-white hover:border-slate-300",
                    )}
                    key={project.id}
                    onClick={() => {
                      startTransition(() => {
                        navigate(`/projects/${project.id}`);
                      });
                    }}
                    type="button"
                  >
                    <div className="flex items-center justify-between gap-3">
                      <div className="truncate text-sm font-semibold text-slate-950">
                        {project.name}
                      </div>
                      <ModeBadge accessMode={project.connection.accessMode} />
                    </div>
                    <div className="mt-2 text-xs leading-5 text-slate-500">
                      {project.connection.workspaceDirectory}
                    </div>
                  </button>
                ))}
              </div>
            </div>
          </div>
        </aside>

        <div className="space-y-4">
          <header className="sticky top-4 z-20 rounded-[2rem] border border-white/70 bg-white/85 px-5 py-4 shadow-[0_18px_60px_-36px_rgba(15,23,42,0.5)] backdrop-blur">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
              <div>
                <div className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">
                  Current Surface
                </div>
                <div className="mt-1 text-lg font-semibold text-slate-950">
                  {currentProject ? currentProject.name : "Projects"}
                </div>
                <div className="text-sm text-slate-600">
                  {currentProject
                    ? (currentProject.connection.projectRootDir ??
                      "Workspace-only observer connection")
                    : "Register and inspect target gokart repos from here."}
                </div>
              </div>
              <div className="space-y-3 lg:max-w-[60%]">
                {currentProject ? (
                  <>
                    <div className="flex flex-wrap items-center gap-2">
                      <ModeBadge accessMode={currentProject.connection.accessMode} />
                      <span className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] text-slate-600">
                        {currentProject.capabilities.canRun ? "Run control enabled" : "Read-only"}
                      </span>
                    </div>
                    <CapabilityStrip capabilities={currentProject.capabilities} dense />
                  </>
                ) : (
                  <InlineNotice title="Command palette">
                    Use <strong>Cmd/Ctrl + K</strong> to jump between project detail, profiles,
                    connection, and run creation screens.
                  </InlineNotice>
                )}
              </div>
            </div>
          </header>
          <main className="pb-8">
            <Outlet />
          </main>
        </div>
      </div>
    </div>
  );
};
