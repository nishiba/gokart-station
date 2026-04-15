# 04. API Contract

base path は `/api` とする。  
リアルタイム更新は SSE を用いる。  
observer / operator / managed の capability に応じて、一部 API は 403 を返す。

## 1. Health

### `GET /api/health`
agent の生存確認。

### `GET /api/scheduler/health`
`luigid` との接続状態確認。  
observer mode の project では global scheduler health として返してよい。

### `POST /api/scheduler/start`
local `luigid` 起動。operator / managed のみ。

### `POST /api/scheduler/stop`
local `luigid` 停止。operator / managed のみ。

### `POST /api/scheduler/restart`
local `luigid` 再起動。operator / managed のみ。

### `GET /api/scheduler/logs`
scheduler log 取得。

---

## 2. Projects

### `GET /api/projects`
レスポンス:
- `Project[]`

### `POST /api/projects`
observer 例:
```json
{
  "name": "sample-observer",
  "connection": {
    "accessMode": "observer",
    "workspaceDirectory": "/Users/me/data/sample-workspace"
  }
}
```

operator 例:
```json
{
  "name": "sample-operator",
  "connection": {
    "accessMode": "operator",
    "projectRootDir": "/Users/me/dev/sample",
    "pythonExecutable": "/Users/me/.pyenv/shims/python",
    "entrypointPath": "main.py",
    "workspaceDirectory": "/Users/me/data/sample-workspace",
    "luigiConfigPath": "/Users/me/dev/sample/luigi.cfg",
    "envSourcePath": "/Users/me/dev/sample/.env",
    "schedulerBaseUrl": "http://127.0.0.1:8082"
  }
}
```

### `GET /api/projects/:projectId`
レスポンス:
- `Project`

### `PATCH /api/projects/:projectId`
部分更新。

### `POST /api/projects/:projectId/validate`
mode-aware validation を行う。  
observer では workspace sandbox を主に検証し、operator / managed では project root / python / entrypoint / config / env / scheduler まで検証する。

### `DELETE /api/projects/:projectId`
レスポンス:
```json
{ "ok": true }
```

---

## 3. Profiles

### `GET /api/projects/:projectId/profiles`
クエリ:
- `kind=config|env` 任意

### `POST /api/projects/:projectId/profiles`
observer では 403。operator / managed のみ。

### `GET /api/profiles/:profileId`
### `PATCH /api/profiles/:profileId`
### `DELETE /api/profiles/:profileId`

### `POST /api/profiles/:profileId/resolve`
継承込みで resolve した最終 key-value を返す。

---

## 4. Runs

### `GET /api/projects/:projectId/runs`
observer でも許可。既存 run / discovered run の read-only 表示に使う。

### `POST /api/projects/:projectId/runs`
operator / managed のみ。  
Run 作成と起動。

リクエスト:
```json
{
  "rootTaskName": "sample.SomeTask",
  "label": "manual run",
  "parameters": {
    "date": "2026-04-15",
    "rerun": false
  },
  "configProfileId": "prof_xxx",
  "envProfileId": "prof_env_xxx",
  "rerunMode": "same_spec",
  "workerCount": 1,
  "captureTaskInfoTree": true,
  "captureTaskInfoTable": true,
  "captureArtifactManifest": true
}
```

### `GET /api/runs/:runId`
レスポンス:
- `Run`

### `POST /api/runs/:runId/stop`
operator / managed のみ。

### `POST /api/runs/:runId/rerun`
operator / managed のみ。

### `GET /api/runs/:runId/timeline`
レスポンス:
- `TimelineEvent[]`

### `GET /api/runs/:runId/logs`
### `GET /api/runs/:runId/logs/stream`

---

## 5. Scheduler

### `GET /api/runs/:runId/scheduler-snapshots`
### `GET /api/runs/:runId/scheduler-latest`

---

## 6. Graph / Lineage

### `GET /api/runs/:runId/graph`
### `GET /api/runs/:runId/lineage`
### `GET /api/runs/:runId/lineage/:taskNodeId`
### `GET /api/runs/:runId/lineage/:taskNodeId/compare-previous-success`

compare MVP は次に限定する。
- parameter diff
- state diff
- processing time diff
- output path diff

artifact content diff は後回しとする。

---

## 7. Artifacts / Raw

### `GET /api/runs/:runId/artifacts`
### `GET /api/artifacts/:artifactId/content`

### `GET /api/runs/:runId/raw/task-info-tree`
### `GET /api/runs/:runId/raw/task-info-table`
### `GET /api/runs/:runId/raw/scheduler`
### `GET /api/runs/:runId/raw/adapter-events`

---

## 8. Files / Watch / Support

### `GET /api/projects/:projectId/files/tree`
observer でも許可。scope は mode により制限される。

### `GET /api/projects/:projectId/watch-events`
observer でも許可。

### `POST /api/projects/:projectId/support-bundle`
support bundle zip を生成する。observer / operator ともに許可。  
含める内容は mode に応じて変わる。

---

## 9. 代表的な 403 ルール

- observer mode で `/runs` POST は 403
- observer mode で `/profiles` POST/PATCH/DELETE は 403
- observer mode で `/scheduler/start|stop|restart` は 403
- capability 不足時は `{ code, message, requiredCapability }` を返す
