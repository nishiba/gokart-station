# 06. Python Adapter and Runner

## 役割

Python adapter は、gokart / Luigi の task information・lineage・artifact manifest・scheduler snapshot を構造化する。

## なぜ Node だけでやらないか

Node 側で `tree-info` テキストを正規表現で読む設計は脆い。  
gokart には task info の table / tree を生成する API があり、Python 側から扱う方が自然である。

## OSS 配布前提の原則

- adapter は target repo に恒久的に埋め込まない
- `apps/py_adapter` は station repo 内に持つが、将来的には独立 package 化できる構造にする
- target repo に必要なのは **gokart が動く Python 環境** と **entrypoint** だけである
- managed mode では adapter package を install して使える構成にする

## adapter の責務

- run spec を受け取る
- config / env profile を展開する
- config profile を temporary Luigi config に materialize して merge する
- target project の entrypoint command を組み立てる
- target project の entrypoint を subprocess で起動する
- stdout / stderr を購読し、station event contract に変換する
- task info tree / table raw を target project から受け取る
- lineage node を JSON に正規化する
- artifact manifest を生成する
- log event を逐次出力する
- scheduler snapshot を定期取得する
- cooperative stop / process stop を受け取る

## 実行方式

### RunSpec -> temp file / stdin
RunSpec は stdin または temp JSON file で渡す。  
station 本体と target repo を分離しやすくするため、target repo 内の Python コードへ station 固有型を直接 import させない。

### command build
adapter 自体は fixed task plan を持たず、request から target project 実行 command を組み立てる。

- `pythonExecutable`
- `entrypointPath`
- `rootTaskName`
- `parameters`
- `--tree-info-mode`
- `--tree-info-output-path`
- `schedulerBaseUrl` がある場合は `--local-scheduler` より localhost scheduler host / port 指定を優先
- `configValues` は `section.option` key を INI に materialize し、`LUIGI_CONFIG_PATH` へ merge 済み temp config path を渡す
- `envValues` は subprocess env に merge し、`GOKART_STATION_RUN_ID` / `GOKART_STATION_PROJECT_ID` も追加する
- masked key の値は target stdout / stderr と raw task info を station event に変換する前に再マスクする

sample project 固有の DAG / task info helper は adapter 本体ではなく `examples/*` 側に置く。

### 生成物
- `task-info-tree.pkl` または text raw
- `task-info-table.json` または `csv`
- `artifact-manifest.json`
- `scheduler-snapshot.jsonl`
- `adapter-events.jsonl`

## 推奨実装レイアウト

```text
apps/py_adapter/
  pyproject.toml
  gokart_station_adapter/
    __init__.py
    main.py
    runner.py
    profiles.py
    scheduler.py
    lineage.py
    artifacts.py
    events.py
    models.py
```

## adapter 入出力

### input
stdin または temp file で RunSpec を渡す。

実際の process contract は `RunSpec` 単体ではなく、station と target repo を分離したまま spawn できる `AdapterRunRequest` envelope とする。

```json
{
  "runId": "run_1",
  "projectId": "proj_1",
  "projectName": "sample-project",
  "accessMode": "operator",
  "projectRootDir": "/Users/me/dev/sample",
  "workspaceDirectory": "/Users/me/data/sample-workspace",
  "pythonExecutable": "/Users/me/.pyenv/shims/python",
  "entrypointPath": "main.py",
  "schedulerBaseUrl": "http://127.0.0.1:8082",
  "configValues": {
    "sample_gokart.message_suffix": "[profile-config]"
  },
  "configMaskedKeys": [
    "sample_gokart.secret_value"
  },
  "envValues": {
    "SAMPLE_GOKART_MESSAGE_PREFIX": "[profile-env] "
  },
  "envMaskedKeys": [
    "SAMPLE_GOKART_SECRET_TOKEN"
  ],
  "spec": {
    "rootTaskName": "sample.SomeTask",
    "parameters": {},
    "rerunMode": "same_spec",
    "captureTaskInfoTree": true,
    "captureTaskInfoTable": true,
    "captureArtifactManifest": true
  }
}
```

### output
stdout は JSON Lines を優先する。  
stderr は debug / raw error 用とする。

event 例:
```json
{"type":"run.started","runId":"run_1","at":"..."}
{"type":"scheduler.snapshot","health":"partial","activeTaskCount":3,"workerCount":1,"raw":{"snapshotSource":"luigid_rpc","completeness":"partial"},"at":"..."}
{"type":"task.status_changed","taskName":"sample.SomeTask","state":"RUNNING","at":"..."}
{"type":"artifact.discovered","path":"/tmp/resources/output.pkl","kind":"output","at":"..."}
{"type":"run.finished","runId":"run_1","status":"success","at":"..."}
```

event contract は次を最低限固定する。

- `run.started`
- `run.status_changed`
- `scheduler.snapshot`
- `task.discovered`
- `task.status_changed`
- `task.log`
- `artifact.discovered`
- `raw.task_info_tree`
- `raw.task_info_table`
- `adapter.warning`
- `adapter.error`
- `run.finished`

各 event は `type`, `runId`, `at` を共通で持つ。

`scheduler.snapshot` は health probe と分離して `luigid` RPC から取得する。

- health は疎通確認を示す
- snapshot は worker / task 概況を示す
- `health` は `healthy | partial | degraded | unreachable | unknown`
- `raw.completeness` は `complete | partial | unavailable | malformed | not_configured`
- endpoint 単位の失敗は `raw.errors[]` に残し、取得できた payload は `raw.endpoints` に残す

## scheduler 連携

MVP では以下を行う。

- `luigid` health check
- localhost 固定接続
- run 中の snapshot 取得
- failure / pending / active task 数の取得

## lineage 生成

lineage node は最低限以下を持つ。

- task name
- unique id
- state
- parameters
- outputs
- processing time
- task log
- upstream / downstream

MVP では target project が task info tree / table raw を JSON で出力し、adapter はそれを読み取って station event contract に変換する。  
Node 側の主要 read model はその JSON を優先して構築する。text tree-info は raw artifact として保持するが、中心 read model にはしない。

## artifact manifest 生成

gokart supplementary files を kind に分類する。

- output
- task_log
- task_params
- processing_time
- module_versions
- random_seed
- task_info_tree
- task_info_table
- adapter_events
- scheduler_snapshot

MVP では task ごとに最低限次を artifact として辿れるようにする。

- output
- task_log
- task_params
- processing_time
- task_info_tree
- task_info_table

## stop 実装

### graceful
- adapter に停止要求を送る
- adapter は child process group に soft signal を送る

### force
- process group を強制 kill

## failure 設計

adapter は partial failure を許容する。

- task info table 取得失敗でも run 自体は failed reason を残して継続保存
- artifact manifest 生成失敗でも logs と scheduler snapshot は残す
- どれか一つが壊れても UI 全体を壊さない

## config / env profile の runtime 反映

- env profile は subprocess env に merge する
- config profile は `section.option` 形式の key を temp Luigi config INI に materialize して target process に渡す
- project connection に `luigiConfigPath` がある場合は、その内容を base として temp config へ overlay する
- target process には `GOKART_STATION_RUN_ID` と `GOKART_STATION_PROJECT_ID` を常に渡す
- temp config file は run 後に cleanup する

## observer mode との関係

observer mode では adapter を run 実行のためには使わない。  
必要なら raw artifact の後処理や support bundle 生成に限定して使う。

## sample project

検証用 target repo は `examples/sample_gokart_project` に置く。

- station repo と同じディレクトリ配下に同梱してよいが、test では temp copy を作って **別ディレクトリの target repo** として扱う
- README では maintainer ローカル絶対パスを避け、copy 先が変わっても使える相対手順を書く
- workspace は `projectRootDir` とは別の外部ディレクトリを向けられるようにする
- sample project 固有の task info / artifact helper は `examples/sample_gokart_project` 側に閉じる
- observer mode では sample project の workspace を read-only で観測し、run / scheduler lifecycle は使わない
- operator mode では sample project の `main.py` を entrypoint にして validate / scheduler / adapter integration を行う
