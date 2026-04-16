# gokart-station

`gokart-station` is a local control plane for gokart / Luigi pipelines.

## Repository Boundaries

`gokart-station` assumes the station repo and the target gokart repo are independent.

- `gokart-station` lives in its own repository and directory.
- The target gokart project lives in a separate repository and directory.
- A workspace-only connection is treated as `observer`.
- Run control is enabled only for `operator` and `managed`.

Example layout:

```text
~/src/gokart-station/
~/src/my-gokart-pipeline/
~/data/my-gokart-workspace/
```

## Workspace Layout

```text
apps/web        React + Vite UI
apps/agent      Fastify control plane
apps/py_adapter Python adapter scaffold
packages/shared Shared domain types and zod schemas
prisma/         Prisma schema backed by SQLite
```

## Development

Install dependencies:

```bash
pnpm install
```

Run type checks:

```bash
pnpm typecheck
```

Start the web app:

```bash
pnpm --filter web dev
```

Start the agent:

```bash
pnpm --filter agent dev
```

## Sample Project Quickstart

`examples/sample_gokart_project` is the release fixture for smoke tests and integration tests.

1. Clone `gokart-station` and keep your target gokart project in a separate directory.
2. Run `pnpm install`.
3. Start the station services with `pnpm --filter agent dev` and `pnpm --filter web dev`.
4. Use `examples/sample_gokart_project` as the target repo and point `workspaceDirectory` to a separate writable directory outside the station repo.
5. In `observer`, register only the workspace directory and inspect runs, lineage, artifacts, raw payloads, files, watch events, and support bundles in read-only mode.
6. In `operator`, also provide `projectRootDir`, `pythonExecutable`, and `entrypointPath` (`main.py` for the sample) and then validate, start the scheduler, create a run, stop or rerun it, and inspect the resulting graph / lineage / artifacts.

Release-oriented verification:

```bash
pnpm release:check
```

`pnpm release:check` runs lint, typecheck, web build, agent integration tests, Python adapter tests, and Playwright web smoke tests. It requires a local environment that can bind localhost ports for the agent, web dev server, browser automation, and scheduler fixture.

## Known Limitations

- The file tree is metadata-only in this release. Direct text preview and editing are intentionally out of scope.
- Support bundle export returns a runtime directory plus `bundle.json` manifest, not a single archive file yet.
- Automated scheduler lifecycle coverage uses a localhost fixture process. A final pre-release smoke on a machine with real `luigid` installed is still recommended.
