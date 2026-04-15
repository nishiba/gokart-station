# 03. project / profile / mode API

目的:
- Project CRUD
- Profile CRUD
- Profile resolve
- Project validate
- mode-aware capability resolve
- Scheduler health

必須 API:
- GET /api/health
- GET /api/scheduler/health
- GET/POST/PATCH/DELETE /api/projects
- POST /api/projects/:projectId/validate
- GET/POST /api/projects/:projectId/profiles
- GET/PATCH/DELETE /api/profiles/:profileId
- POST /api/profiles/:profileId/resolve

重要要件:
- path sandbox を実装する
- rootDir 外アクセスを拒否する
- observer mode では projectRootDir, pythonExecutable, entrypointPath を必須にしない
- operator / managed では projectRootDir, pythonExecutable, entrypointPath, workspaceDirectory を検証する
- capability snapshot を返す
- profile は observer では作成不可にする

受け入れ条件:
- Project と Profile を UI なしで API テストできる
- validate で warnings / errors を返せる
- mode ごとの capability が返る
- observer project を作れる
- operator project を作れる
