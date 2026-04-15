# 11. stabilization / E2E / release

目的:
- gokart-station を完成に持っていく
- sample project を使った E2E と release チェックを整える

必須要件:
- Playwright か同等で web smoke test を入れる
- sample gokart project を使った integration test を入れる
- success / failed / partial failure の 3 ケースをテストする
- observer / operator の mode 差分をテストする
- scheduler lifecycle の E2E を入れる
- support bundle の内容をテストする
- docs/README.md, docs/10-acceptance-criteria.md, AGENTS.md を最終整合する
- known limitations を明文化する

受け入れ条件:
- 第三者が clone して sample project で動かせる
- observer と operator の主要導線が壊れていない
- リリース前チェック項目が文書化されている
