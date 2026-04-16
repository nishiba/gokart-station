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
apps/py_adapter Python adapter for real gokart / Luigi execution
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

`examples/sample_gokart_project` is a minimal real gokart / Luigi target project used by the smoke and integration checks. For `operator` flows, copy it to a directory outside this repo so the station repo and target repo stay independent.

1. Clone `gokart-station`.
2. Run `pnpm install`.
3. Prepare a separate sample target repo and workspace:

```bash
cp -R examples/sample_gokart_project ../sample-gokart-project
python3 -m venv ../sample-gokart-project/.venv
../sample-gokart-project/.venv/bin/pip install -r ../sample-gokart-project/requirements.txt
mkdir -p ../sample-gokart-workspace
```

4. Start the station services with `pnpm --filter agent dev` and `pnpm --filter web dev`.
5. In `observer`, register only `workspaceDirectory = ../sample-gokart-workspace` and inspect runs, lineage, artifacts, raw payloads, files, watch events, and support bundles in read-only mode.
6. In `operator`, register `projectRootDir = ../sample-gokart-project`, `pythonExecutable = ../sample-gokart-project/.venv/bin/python`, `entrypointPath = main.py`, and `workspaceDirectory = ../sample-gokart-workspace`. Then validate, start the scheduler, create a run, stop or rerun it, and inspect the resulting graph / lineage / artifacts.
7. Read [examples/sample_gokart_project/README.md](./examples/sample_gokart_project/README.md) for direct CLI runs and profile-driven behavior changes.

## Support Bundle Safety

Support bundles contain connection metadata, mode / capability / validation snapshots, scheduler state, and already-masked run payloads. Raw env/config profile values and profile source file contents are not exported.

## Release Preflight

1. Run `pnpm install`.
2. Run `pnpm release:check`.
3. Manually verify the copied sample project in both `observer` and `operator` with a separate workspace directory.
4. On a release candidate machine, run one final `operator` smoke against a real `luigid`.

`pnpm release:check` runs lint, typecheck, web build, agent integration tests, Python adapter tests, and Playwright web smoke tests. It requires a local environment that can bind localhost ports for the agent, web dev server, browser automation, and scheduler fixture.

## Known Limitations

- The file tree is metadata-only in this release. Direct text preview and editing are intentionally out of scope.
- Support bundle export returns a runtime directory plus `bundle.json` manifest, not a single archive file yet.
- Automated scheduler lifecycle coverage uses a localhost fixture process. A final pre-release smoke on a machine with real `luigid` installed is still recommended.
