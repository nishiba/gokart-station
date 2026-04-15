# 08. gokart lineage and artifacts

目的:
- Python adapter から gokart task info / artifact manifest / lineage を構造化する
- graph / lineage / artifacts API を完成させる
- previous-success compare の MVP を明確に実装する

必須 API:
- GET /api/runs/:runId/graph
- GET /api/runs/:runId/lineage
- GET /api/runs/:runId/lineage/:taskNodeId
- GET /api/runs/:runId/lineage/:taskNodeId/compare-previous-success
- GET /api/runs/:runId/artifacts
- GET /api/artifacts/:artifactId/content
- GET /api/runs/:runId/raw/task-info-tree
- GET /api/runs/:runId/raw/task-info-table
- GET /api/runs/:runId/raw/scheduler
- GET /api/runs/:runId/raw/adapter-events

重要要件:
- tree-info raw は保存する
- 主要 read model は Python adapter が作る JSON を使う
- `TaskLineageNode` と `ArtifactManifestEntry` を first-class として扱う
- partial failure に強くする
- preview は text と binary を分ける
- compare MVP は parameter / state / processingTime / outputPath diff に限定する

受け入れ条件:
- run detail で graph, lineage, artifacts を取得できる
- 失敗 task の task_log / params / output が辿れる
- previous-success compare が動く
