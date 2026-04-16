# sample_gokart_project

`gokart-station` の fixture 用 target project です。station repo とは別 repo / 別ディレクトリとして扱う前提で作っています。

## What It Covers

- `PublishReport`
  - success path
  - 3 task dependency chain
  - parameter (`message`, `report_date`, `rerun_token`)
  - task log output
- `BrokenReport`
  - intentional failure path
- `rerun_token`
  - output path と payload に反映されるので rerun / parameter diff の fixture に使える

## Files

- [main.py](/Users/nishiba/Documents/Developments/gokart-station/examples/sample_gokart_project/main.py)
- [requirements.txt](/Users/nishiba/Documents/Developments/gokart-station/examples/sample_gokart_project/requirements.txt)

## Workspace

workspace は repo 外ディレクトリを向ける想定です。

```bash
export SAMPLE_GOKART_WORKSPACE_DIR=/tmp/gokart-station-sample-workspace
mkdir -p "$SAMPLE_GOKART_WORKSPACE_DIR"
```

task の output はすべて `SAMPLE_GOKART_WORKSPACE_DIR` 配下に出ます。未指定時は `/tmp/sample-gokart-workspace` を使います。

## Manual Run

依存を入れた Python 環境で実行します。

```bash
python3 -m pip install -r requirements.txt
python3 main.py PublishReport --local-scheduler --message "hello" --report-date 2026-04-15 --rerun-token first
python3 main.py BrokenReport --local-scheduler --message "boom" --report-date 2026-04-15 --rerun-token failing
```

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

## Integration Fixture

adapter integration test では、この project を temp directory に copy して使う想定です。station repo から直接 import させず、`projectRootDir` と `workspaceDirectory` を分離して検証します。
