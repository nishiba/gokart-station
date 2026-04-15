# 09. web core UI

目的:
- docs/02-screen-spec.md を source of truth として UI を作る
- mode-aware UX を入れる

実装対象:
- Projects 一覧
- Project Detail
- New Run
- Run Detail
- Profiles
- Connection
- Command Palette

重要要件:
- TanStack Query
- React Router
- Tailwind + shadcn/ui
- React Flow
- xterm.js
- loading / error / empty state を丁寧に作る
- ホームは file browser ではなく control surface にする
- Run Detail で Graph / Lineage / Logs / Artifacts / Raw を分ける
- observer mode では run / stop / rerun / profile edit を隠すか disable する
- access mode と capability を常時見える位置に出す

受け入れ条件:
- end-to-end で project 登録 → run 作成 → run 詳細確認 ができる
- observer project では read-only で安全に見える
- stop / rerun / compare が operator UI から使える
