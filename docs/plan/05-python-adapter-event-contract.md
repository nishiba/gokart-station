# 05. python adapter event contract

目的:
- gokart-station の Python adapter を apps/py_adapter に追加する
- RunSpec を受けて構造化イベントを stdout JSONL で返す
- event contract を先に固定し、後工程のぶれを防ぐ

必須要件:
- apps/py_adapter を追加する
- `main.py`, `runner.py`, `models.py`, `events.py`, `profiles.py`, `scheduler.py`, `lineage.py`, `artifacts.py` を作る
- stdin か temp json file から RunSpec を読み取れる
- stdout に JSONL で event を出す
- stderr は raw debug 用に分ける
- graceful stop の入り口を用意する
- adapter 自体の unit test を最小限追加する

最低限の event type:
- run.started
- run.status_changed
- scheduler.snapshot
- task.discovered
- task.status_changed
- task.log
- artifact.discovered
- raw.task_info_tree
- raw.task_info_table
- adapter.warning
- adapter.error
- run.finished

重要要件:
- station repo と target repo が別でも spawn できる設計にする
- target repo に station 固有コードを import させない
- event payload schema を docs と shared schema に揃える

受け入れ条件:
- ダミー RunSpec で adapter が起動する
- JSONL event が返る
- agent 側から spawn できる
