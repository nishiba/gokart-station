# 10. files / watch / hardening

目的:
- 補助機能として file tree / watch events / support export を追加する
- セキュリティと運用品質を高める

実装対象:
- GET /api/projects/:projectId/files/tree
- GET /api/projects/:projectId/watch-events
- POST /api/projects/:projectId/support-bundle
- path sandbox hardening
- process cleanup
- large log paging
- basic tests

重要要件:
- watch event は補助情報として扱う
- run state の真実源にはしない
- symlink 逸脱を防ぐ
- zombie process を残さない
- support bundle に mode / capability / validation snapshot を含める
- docs と AGENTS を更新する

受け入れ条件:
- watch event が確認できる
- support bundle を export できる
- 強制終了後に cleanup される
