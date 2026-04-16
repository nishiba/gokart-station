import { createBrowserRouter, Navigate } from "react-router-dom";
import { ErrorState } from "@/components/surface";
import { ProjectWorkspacePage } from "@/features/projects/project-workspace-page";
import { ProjectsPage } from "@/features/projects/projects-page";
import { NewRunPage } from "@/features/runs/new-run-page";
import { RunDetailPage } from "@/features/runs/run-detail-page";
import { RootLayout } from "./root-layout";

const RouteError = () => {
  return (
    <div className="mx-auto max-w-3xl">
      <ErrorState
        message="The requested route could not be resolved. Use the project list to recover navigation."
        title="Route not found"
      />
    </div>
  );
};

export const router = createBrowserRouter([
  {
    path: "/",
    element: <RootLayout />,
    errorElement: <RouteError />,
    children: [
      {
        index: true,
        element: <Navigate replace to="/projects" />,
      },
      {
        path: "projects",
        element: <ProjectsPage />,
      },
      {
        path: "projects/:projectId",
        element: <ProjectWorkspacePage />,
      },
      {
        path: "projects/:projectId/profiles",
        element: <ProjectWorkspacePage />,
      },
      {
        path: "projects/:projectId/connection",
        element: <ProjectWorkspacePage />,
      },
      {
        path: "projects/:projectId/runs/new",
        element: <NewRunPage />,
      },
      {
        path: "projects/:projectId/runs/:runId",
        element: <RunDetailPage />,
      },
    ],
  },
]);
