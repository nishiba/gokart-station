import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { expect, test } from "@playwright/test";

type E2eFixture = {
  targetProjectDir: string;
  workspaceDirectory: string;
  observerWorkspaceDirectory: string;
  pythonExecutable: string;
  entrypointPath: string;
  schedulerBaseUrl: string;
};

const fixtureFilePath = path.join(os.tmpdir(), "gokart-station-playwright", "fixture.json");

const readFixture = async (): Promise<E2eFixture> => {
  const deadline = Date.now() + 15_000;

  while (Date.now() < deadline) {
    try {
      const content = await fs.readFile(fixtureFilePath, "utf8");
      return JSON.parse(content) as E2eFixture;
    } catch {
      await new Promise((resolve) => {
        setTimeout(resolve, 100);
      });
    }
  }

  throw new Error(`Timed out waiting for Playwright fixture file at ${fixtureFilePath}.`);
};

const fillProjectForm = async (
  page: Parameters<typeof test>[0]["page"],
  values: {
    projectName: string;
    accessMode: "observer" | "operator";
    workspaceDirectory: string;
    projectRootDir?: string;
    entrypointPath?: string;
    pythonExecutable?: string;
    schedulerBaseUrl?: string;
  },
) => {
  await page.getByLabel("Project name").fill(values.projectName);
  await page.getByLabel("Access mode").selectOption(values.accessMode);
  await page.getByLabel("Workspace directory").fill(values.workspaceDirectory);

  if (values.accessMode === "operator") {
    await page.getByLabel("Target project root").fill(values.projectRootDir ?? "");
    await page.getByLabel("Entrypoint path").fill(values.entrypointPath ?? "");
    await page.getByLabel("Python executable").fill(values.pythonExecutable ?? "");
    await page.getByLabel("Scheduler URL").fill(values.schedulerBaseUrl ?? "");
  }

  await page.getByRole("button", { name: "Create project" }).click();
};

test("operator flow supports scheduler lifecycle, run creation, rerun, watch, files, and support bundle", async ({
  page,
}) => {
  const fixture = await readFixture();

  await page.goto("/projects");
  await fillProjectForm(page, {
    projectName: "operator-ui-project",
    accessMode: "operator",
    workspaceDirectory: fixture.workspaceDirectory,
    projectRootDir: fixture.targetProjectDir,
    entrypointPath: fixture.entrypointPath,
    pythonExecutable: fixture.pythonExecutable,
    schedulerBaseUrl: fixture.schedulerBaseUrl,
  });

  await expect(page.getByRole("heading", { name: "operator-ui-project" })).toBeVisible();

  await page.getByRole("button", { name: "Validate project" }).click();
  await expect(page.getByRole("heading", { name: "Latest Validation" })).toBeVisible();

  await page.getByRole("button", { name: "connection", exact: true }).click();
  const schedulerSection = page.locator("section").filter({
    has: page.getByRole("heading", { name: "Scheduler Lifecycle", exact: true }),
  });

  await schedulerSection.getByRole("button", { name: "Start", exact: true }).click();
  await expect(schedulerSection).toContainText(/healthy/i);

  await schedulerSection.getByRole("button", { name: "Restart", exact: true }).click();
  await expect(schedulerSection).toContainText(/healthy/i);

  await page.getByRole("link", { name: "New run" }).first().click();
  await expect(page.getByRole("heading", { name: "New Run" })).toBeVisible();

  await page.getByLabel("Run label").fill("ui success run");
  await page.getByRole("button", { name: "Run now" }).click();

  await expect(page.getByRole("heading", { name: "ui success run" })).toBeVisible();
  const runHeaderSection = page.locator("section").filter({ hasText: "Run Header" });
  await expect(runHeaderSection).toContainText(/success/i);

  await page.getByRole("button", { name: "Rerun same spec" }).click();
  await expect(runHeaderSection).toContainText(/success/i);

  await page.getByRole("button", { name: "lineage", exact: true }).click();
  await expect(page.locator("section").filter({ hasText: "Selected Task Lineage" })).toContainText(
    /Previous-success compare/i,
  );

  await page.getByRole("link", { name: "Back" }).click();
  await expect(page.getByRole("heading", { name: "operator-ui-project" })).toBeVisible();

  await page.getByRole("button", { name: "watch", exact: true }).click();
  await expect(page.locator("section").filter({ hasText: "Watch" })).toContainText(
    /published\/2026-04-15-ui-metadata\.json/i,
  );
  await page.getByRole("button", { name: "Export support bundle" }).click();
  await expect(page.locator("section").filter({ hasText: "Watch" })).toContainText(
    /Support bundle manifest written to/i,
  );

  await page.getByRole("button", { name: "files", exact: true }).click();
  await expect(page.locator("section").filter({ hasText: "Files" })).toContainText(/workspace/i);
  await expect(page.locator("section").filter({ hasText: "Files" })).toContainText(
    /metadata-only file browsing/i,
  );

  await page.getByRole("button", { name: "connection", exact: true }).click();
  await schedulerSection.getByRole("button", { name: "Stop", exact: true }).click();
  await expect(schedulerSection).toContainText(/unknown|unreachable|degraded/i);
});

test("observer flow stays read-only and safe", async ({ page }) => {
  const fixture = await readFixture();

  await page.goto("/projects");
  await fillProjectForm(page, {
    projectName: "observer-ui-project",
    accessMode: "observer",
    workspaceDirectory: fixture.observerWorkspaceDirectory,
  });

  await expect(page.getByRole("heading", { name: "observer-ui-project" })).toBeVisible();
  await expect(page.locator("body")).toContainText(/read-only/i);

  await page.getByRole("button", { name: "files", exact: true }).click();
  await expect(page.locator("section").filter({ hasText: "Files" })).toContainText(
    /observer-note\.txt/i,
  );

  const projectId = new URL(page.url()).pathname.split("/").at(-1);
  await page.goto(`/projects/${projectId}/runs/new`);
  await expect(page.getByText(/Run creation is disabled for this project/i)).toBeVisible();

  await page.goto(`/projects/${projectId}/connection`);
  await expect(page.getByRole("button", { name: "Start", exact: true })).toBeDisabled();
});
