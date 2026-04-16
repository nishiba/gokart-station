# sample_gokart_project

`gokart-station` の release smoke と integration test に使う最小の real gokart / Luigi target project です。station repo とは別 repo / 別ディレクトリとして扱う前提で作っています。

## What It Covers

- `PublishReport`
  - success path
  - 3 task dependency chain
  - parameter (`message`, `report_date`, `rerun_token`)
  - task log output
- `BrokenReport`
  - intentional failure path
- `rerun_token`
  - output path と payload に反映されるので rerun / parameter diff を確認できる
- env profile
  - `SAMPLE_GOKART_MESSAGE_PREFIX` が report / metadata に反映される
  - `SAMPLE_GOKART_SECRET_TOKEN` は task log に出すが station 側で mask される前提の確認に使う
- config profile
  - `sample_gokart.message_suffix`, `sample_gokart.metadata_tag`, `sample_gokart.uppercase_report` が runtime behavior を変える
  - `sample_gokart.secret_note` は task log に出すが station 側で mask される前提の確認に使う

## Files

- `main.py`
  - Luigi entrypoint
- `fixture_runtime.py`
  - sample project 固有の task info / artifact helper
- `requirements.txt`
  - sample project の Python dependencies

## Separate Repo Setup

station repo と target repo を分けた確認をしたい場合は、repo root からこの directory を別場所へ copy して使います。

```bash
cp -R examples/sample_gokart_project ../sample-gokart-project
mkdir -p ../sample-gokart-workspace
```

## Workspace

workspace は repo 外ディレクトリを向ける想定です。

```bash
export SAMPLE_GOKART_WORKSPACE_DIR=/tmp/gokart-station-sample-workspace
mkdir -p "$SAMPLE_GOKART_WORKSPACE_DIR"
```

task の output はすべて `SAMPLE_GOKART_WORKSPACE_DIR` 配下に出ます。未指定時は `/tmp/sample-gokart-workspace` を使います。

## Manual Run

entrypoint は station adapter が想定する CLI contract を受けます。sample project 自体は Luigi task を本当に実行するので、先に依存を入れます。

```bash
python3 -m venv .venv
. .venv/bin/activate
python3 -m pip install -r requirements.txt
python3 main.py PublishReport --local-scheduler --message "hello" --report-date 2026-04-15 --rerun-token first
python3 main.py BrokenReport --local-scheduler --message "boom" --report-date 2026-04-15 --rerun-token failing
python3 main.py PublishReport \
  --local-scheduler \
  --message "hello" \
  --report-date 2026-04-15 \
  --rerun-token first \
  --tree-info-mode json \
  --tree-info-output-path /tmp/sample-task-info
```

`main.py` は real Luigi task を実行しつつ、station が読む raw task info JSON も `fixture_runtime.py` から出します。
`--tree-info-mode json --tree-info-output-path <base>` を渡すと `<base>-tree.json` と `<base>-table.json` が出ます。

profile 差分を手で試す場合は Luigi config を渡します。

```bash
cat >/tmp/sample-gokart-profile.cfg <<'EOF'
[sample_gokart]
message_suffix = [config-profile]
metadata_tag = config-profile-tag
uppercase_report = true
secret_note = config-secret-note
EOF

export SAMPLE_GOKART_MESSAGE_PREFIX='[env-profile] '
export SAMPLE_GOKART_SECRET_TOKEN='env-secret-token'
export LUIGI_CONFIG_PATH=/tmp/sample-gokart-profile.cfg
python3 main.py PublishReport --local-scheduler --message "hello" --report-date 2026-04-15 --rerun-token profiled
```

station adapter は UI / API profile から同等の env / config を作り、target process に適用します。config key は `section.option` 形式で扱います。

## Station Usage

### Observer mode

- `workspaceDirectory` のみを sample workspace に向けて project を作る
- run / stop / rerun / scheduler lifecycle は使わない
- 既存 output, task log, raw artifact を read-only で観測する

### Operator mode

- `projectRootDir` を sample project の clone / copy に向ける
- `entrypointPath` は `main.py`
- `workspaceDirectory` は repo 外ディレクトリ
- `rootTaskName` は `PublishReport` または `BrokenReport`
- `schedulerBaseUrl` は local `luigid`

## Integration Use

adapter integration test では、この project を temp directory に copy して使います。station repo から直接 import させず、`projectRootDir` と `workspaceDirectory` を分離して検証します。
