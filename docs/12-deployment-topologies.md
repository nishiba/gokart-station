# 12. Deployment Topologies

## 1. Local Observer

```text
gokart-station repo
  └─ agent + web

workspace_directory
  └─ outputs / logs / task info
```

用途:
- 既存 workspace の read-only 監査
- support bundle 作成
- 過去 run の可視化

## 2. Local Operator

```text
gokart-station repo
  ├─ web
  ├─ agent
  └─ py_adapter

target gokart repo
  ├─ main.py
  ├─ luigi.cfg
  └─ tasks/...

workspace_directory
  └─ outputs / logs / task info

localhost luigid
```

用途:
- 日常の実行・停止・再実行・検証

## 3. Local Operator with separate workspace

```text
~/src/gokart-station/
~/src/my-pipeline/
~/data/my-pipeline-workspace/
```

この形を基本推奨とする。  
workspace は target repo の外でもよい。

## 4. Managed-ready topology

```text
gokart-station repo
target repo
target venv
  └─ gokart-station-adapter package
workspace
scheduler
```

用途:
- 将来の package install / sidecar / remote store 拡張

## 選定指針

- まず observer が必要か operator が必要かを決める
- run 制御が必要なら operator 以上を選ぶ
- workspace しか触れない環境なら observer に限定する
