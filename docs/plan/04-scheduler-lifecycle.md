# 04. scheduler lifecycle

目的:
- local `luigid` の start / stop / restart / health / logs を実装する
- station を local control plane として成立させる

必須 API:
- GET /api/scheduler/health
- POST /api/scheduler/start
- POST /api/scheduler/stop
- POST /api/scheduler/restart
- GET /api/scheduler/logs

重要要件:
- scheduler は localhost 前提
- operator / managed のみ操作可能
- port conflict を検出する
- pidfile と logdir を管理する
- UI に出せる health payload を整形する
- observer mode では lifecycle 操作を拒否する

受け入れ条件:
- `luigid` を API 経由で起動できる
- `luigid` を API 経由で停止できる
- health と logs を取得できる
