# 07. run control and SSE

目的:
- run create / stop / list / detail
- adapter spawn
- SSE log / timeline / scheduler stream
- Run lifecycle 永続化
- observer では制御系 API を拒否する

必須 API:
- GET /api/projects/:projectId/runs
- POST /api/projects/:projectId/runs
- GET /api/runs/:runId
- POST /api/runs/:runId/stop
- POST /api/runs/:runId/rerun
- GET /api/runs/:runId/logs
- GET /api/runs/:runId/logs/stream
- GET /api/runs/:runId/timeline

重要要件:
- process group で管理する
- stop は graceful / force の 2 段
- adapter events を timeline に正規化する
- stderr を保持する
- run status 遷移を docs に合わせる
- observer mode で POST /runs, stop, rerun は 403 にする

受け入れ条件:
- operator project で run を起動できる
- run を止められる
- SSE で event が流れる
- DB に run / timeline / log が残る
- observer project で制御系 API が拒否される
