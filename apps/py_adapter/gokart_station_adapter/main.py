from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from gokart_station_adapter.models import AdapterRunRequest
from gokart_station_adapter.runner import run_adapter


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="gokart-station Python adapter")
    parser.add_argument(
        "--print-example-spec",
        action="store_true",
        help="Print an example run spec envelope and exit.",
    )
    parser.add_argument(
        "--spec-path",
        help="Read AdapterRunRequest JSON from the provided file path instead of stdin.",
    )
    return parser


def main() -> int:
    parser = build_parser()
    args = parser.parse_args()

    if args.print_example_spec:
        example = AdapterRunRequest.build_example()
        print(json.dumps(example.to_dict(), ensure_ascii=True))
        return 0

    try:
        request = _load_run_request(spec_path=args.spec_path)
    except ValueError as error:
        print(str(error), file=sys.stderr)
        return 2

    return run_adapter(request)


def _load_run_request(spec_path: str | None) -> AdapterRunRequest:
    if spec_path:
        raw_payload = Path(spec_path).read_text(encoding="utf-8")
    else:
        raw_payload = sys.stdin.read()

    if raw_payload.strip() == "":
        raise ValueError("AdapterRunRequest JSON was not provided.")

    try:
        payload = json.loads(raw_payload)
    except json.JSONDecodeError as error:
        raise ValueError(f"Failed to decode AdapterRunRequest JSON: {error}") from error

    if not isinstance(payload, dict):
        raise ValueError("AdapterRunRequest must decode to a JSON object.")

    return AdapterRunRequest.from_dict(payload)


if __name__ == "__main__":
    raise SystemExit(main())
