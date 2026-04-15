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
- `luigid` 前提で gokart run を実行する
- task info tree / table を出力する
- lineage node を JSON に変換する
- artifact manifest を生成する
- log event を逐次出力する
- scheduler snapshot を定期取得する
- cooperative stop / process stop を受け取る

## 実行方式

### RunSpec -> temp file / stdin
RunSpec は stdin または temp JSON file で渡す。  
station 本体と target repo を分離しやすくするため、target repo 内の Python コードへ station 固有型を直接 import させない。

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

### output
stdout は JSON Lines を優先する。  
stderr は debug / raw error 用とする。

event 例:
```json
{"type":"run.started","runId":"run_1","at":"..."}
{"type":"scheduler.snapshot","health":"healthy","activeTaskCount":3,"at":"..."}
{"type":"task.status_changed","taskName":"sample.SomeTask","state":"RUNNING","at":"..."}
{"type":"artifact.discovered","path":"/tmp/resources/output.pkl","kind":"output","at":"..."}
{"type":"run.finished","runId":"run_1","status":"success","at":"..."}
```

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

## observer mode との関係

observer mode では adapter を run 実行のためには使わない。  
必要なら raw artifact の後処理や support bundle 生成に限定して使う。
