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

クエリ:
- `projectId` 任意

レスポンス例:
```json
{
  "health": "healthy",
  "checkedAt": "2026-04-15T12:00:00.000Z",
  "schedulerBaseUrl": "http://127.0.0.1:8082",
  "host": "127.0.0.1",
  "port": 8082,
  "isLocalhost": true,
  "isManagedByStation": true,
  "isProcessAlive": true,
  "portConflict": false,
  "pid": 12345,
  "startedAt": "2026-04-15T11:59:58.000Z",
  "pidFilePath": "/path/to/station-runtime/scheduler/luigid.pid.json",
  "logDirectory": "/path/to/station-runtime/scheduler/logs",
  "stdoutLogPath": "/path/to/station-runtime/scheduler/logs/stdout.log",
  "stderrLogPath": "/path/to/station-runtime/scheduler/logs/stderr.log",
  "message": "Scheduler is reachable."
}
```

### `POST /api/scheduler/start`
local `luigid` 起動。operator / managed のみ。

リクエスト:
```json
{
  "projectId": "proj_xxx"
}
```

レスポンス:
- `GET /api/scheduler/health` と同じ shape

### `POST /api/scheduler/stop`
local `luigid` 停止。operator / managed のみ。

リクエスト:
```json
{
  "projectId": "proj_xxx"
}
```

レスポンス:
- `GET /api/scheduler/health` と同じ shape

### `POST /api/scheduler/restart`
local `luigid` 再起動。operator / managed のみ。

リクエスト:
```json
{
  "projectId": "proj_xxx"
}
```

レスポンス:
- `GET /api/scheduler/health` と同じ shape

### `GET /api/scheduler/logs`
scheduler log 取得。

クエリ:
- `limit` 任意

レスポンス例:
```json
{
  "stdoutLogPath": "/path/to/station-runtime/scheduler/logs/stdout.log",
  "stderrLogPath": "/path/to/station-runtime/scheduler/logs/stderr.log",
  "lines": [
    {
      "stream": "stdout",
      "line": "mock luigid listening on 127.0.0.1:8082"
    }
  ]
}
```

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
    "workspaceDirectory": "/Users/me/data/sample-workspace",
    "allowWorkspaceDirectorySymlink": false
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
    "allowWorkspaceDirectorySymlink": false,
    "luigiConfigPath": "/Users/me/dev/sample/luigi.cfg",
    "envSourcePath": "/Users/me/dev/sample/.env",
    "schedulerBaseUrl": "http://127.0.0.1:8082"
  }
}
```

補足:
- `allowWorkspaceDirectorySymlink` は optional boolean で default は `false`
- `projectRootDir` は symlink 不可
- `workspaceDirectory` は `allowWorkspaceDirectorySymlink = true` のときだけ symlink を許可する
- `luigiConfigPath` / `envSourcePath` は symlink 不可

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

レスポンス:
- `Run`

### `GET /api/runs/:runId`
レスポンス:
- `Run`

### `POST /api/runs/:runId/stop`
operator / managed のみ。

リクエスト:
```json
{
  "mode": "graceful"
}
```

`mode` は `graceful | force`。  
未指定時は `graceful`。

レスポンス:
- `Run`

### `POST /api/runs/:runId/rerun`
operator / managed のみ。

リクエスト例:
```json
{
  "rerunMode": "with_param_override",
  "label": "rerun after fixing input",
  "parameters": {
    "date": "2026-04-16",
    "rerun": true
  }
}
```

レスポンス:
- 新しく作られた `Run`

### `GET /api/runs/:runId/timeline`
レスポンス:
- `TimelineEvent[]`

### `GET /api/runs/:runId/logs`
### `GET /api/runs/:runId/logs/stream`

`GET /api/runs/:runId/logs` は巨大ログ向けにページング query を受けてよい。

クエリ:
- `limit` 任意
- `offset` 任意

レスポンス:
- `LogEvent[]`

`GET /api/runs/:runId/logs/stream` は `text/event-stream` を返す。  
SSE event 名は次を使う。

- `run`
- `log`
- `timeline`
- `scheduler`

data payload はそれぞれ `Run`, `LogEvent`, `TimelineEvent`, `SchedulerSnapshot` の JSON。

補足:
- 接続時に既存 persisted event を replay してよい
- run が active の間は後続 event を push する
- terminal status 到達後は stream を close してよい

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
- compare target resolution metadata

compare target resolution は次の順で行う。
- `uniqueId` 完全一致
- parameter fingerprint 一致
- upstream / downstream signature 一致
- output path signature 一致
- 上記で解決できず、previous successful run 内の同名 candidate が 1 件だけならそれを使う fallback を許容する

一意に解決できない場合は `previous = null` とし、`diff.compareResolution.status = "ambiguous"` を返す。

artifact content diff は後回しとする。

---

## 7. Artifacts / Raw

### `GET /api/runs/:runId/artifacts`
### `GET /api/artifacts/:artifactId/content`

`GET /api/artifacts/:artifactId/content` は preview payload を返す。

text 例:
```json
{
  "artifactId": "art_xxx",
  "mimeType": "application/json",
  "contentType": "text",
  "text": "{\n  \"ok\": true\n}",
  "truncated": false,
  "byteLength": 18
}
```

binary 例:
```json
{
  "artifactId": "art_xxx",
  "mimeType": "application/octet-stream",
  "contentType": "binary",
  "base64": "AAEC",
  "truncated": false,
  "byteLength": 3
}
```

### `GET /api/runs/:runId/raw/task-info-tree`
### `GET /api/runs/:runId/raw/task-info-table`
### `GET /api/runs/:runId/raw/scheduler`
### `GET /api/runs/:runId/raw/adapter-events`

補足:
- `raw/task-info-tree` と `raw/task-info-table` は adapter が出した JSON をそのまま返してよい
- `raw/scheduler` は `snapshotId`, `health`, `activeTaskCount`, `pendingTaskCount`, `failedTaskCount`, `workerCount`, `capturedAt`, `raw` を持つ snapshot 配列を返してよい
- `raw/adapter-events` は adapter JSONL を parse した event 配列を返してよい

---

## 8. Files / Watch / Support

### `GET /api/projects/:projectId/files/tree`
observer でも許可。scope は mode により制限される。

レスポンス:
- `FileTreeNode[]`

補足:
- root node は `workspace`, `projectRoot`, `luigiConfigPath`, `envSourcePath` などの sandbox scope 単位で返してよい
- symlink は follow せず、tree から除外してよい
- 大規模 directory は station 側の scan limit を持ってよい

### `GET /api/projects/:projectId/watch-events`
observer でも許可。

クエリ:
- `limit` 任意

レスポンス:
- `WatchEvent[]`

補足:
- watch event は補助情報であり、run state の真実源として扱わない
- run と紐づかない watch event は `runId = null` でよい
- 返却順は `occurredAt desc` を基本とする

### `POST /api/projects/:projectId/support-bundle`
observer / operator ともに許可。  
MVP では station runtime 配下に support bundle directory を生成し、`bundle.json` manifest artifact を返してよい。

レスポンス:
- `ArtifactManifestEntry`

最低限含める内容:
- project connection metadata
- mode / capability snapshot
- validation snapshot
- recent watch events
- files tree snapshot
- recent runs summary
- latest run の logs / timeline / artifact manifest / raw payloads の一部

制約:
- bundle には masked 済み payload と metadata を含める
- env / config profile の生値や source file content は bundle に含めない

---

## 9. 代表的な 403 ルール

- observer mode で `/runs` POST は 403
- observer mode で `/profiles` POST/PATCH/DELETE は 403
- observer mode で `/scheduler/start|stop|restart` は 403
- capability 不足時は `{ code, message, requiredCapability }` を返す
