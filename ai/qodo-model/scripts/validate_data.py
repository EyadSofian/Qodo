#!/usr/bin/env python3
"""Fail closed on malformed, unsafe, or incompatible Qodo training samples."""

from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path


ALLOWED_ROLES = {"system", "user", "assistant", "tool"}
SECRET_PATTERNS = [
    re.compile(r"\bsk-[A-Za-z0-9_-]{12,}"),
    re.compile(r"-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----"),
    re.compile(r"\b[A-Za-z0-9._%+-]+@gmail\.com\b", re.IGNORECASE),
]
EXPLICIT_CREATE = re.compile(
    r"(?:اعمل|أعمل|ضيف|أضيف|سجل|سجّل|انشئ|أنشئ|حط|create|add|record)", re.IGNORECASE
)


def fail(message):
    raise ValueError(message)


def validate_sample(sample, label="sample"):
    if not isinstance(sample, dict):
        fail(f"{label}: root must be an object")
    messages = sample.get("messages")
    if not isinstance(messages, list) or len(messages) < 2:
        fail(f"{label}: messages must contain at least two turns")
    if messages[0].get("role") != "system":
        fail(f"{label}: first message must be system")
    if messages[-1].get("role") != "assistant":
        fail(f"{label}: final message must be assistant")

    for index, message in enumerate(messages):
        role = message.get("role")
        if role not in ALLOWED_ROLES:
            fail(f"{label}: invalid role at messages[{index}]")
        if not isinstance(message.get("content", ""), str):
            fail(f"{label}: content must be text at messages[{index}]")
        for call in message.get("tool_calls", []):
            function = call.get("function", {})
            if not isinstance(function.get("name"), str):
                fail(f"{label}: tool call is missing a name")
            if not isinstance(function.get("arguments"), dict):
                fail(f"{label}: tool arguments must be an object, not encoded JSON")

    text = json.dumps(sample, ensure_ascii=False)
    for pattern in SECRET_PATTERNS:
        if pattern.search(text):
            fail(f"{label}: possible secret or personal Gmail address")

    known = {
        tool.get("function", {}).get("name")
        for tool in sample.get("tools", [])
        if isinstance(tool, dict)
    }
    for index, message in enumerate(messages):
        for call in message.get("tool_calls", []):
            name = call["function"]["name"]
            if name not in known:
                fail(f"{label}: tool call {name!r} has no definition")
            if name == "create_task":
                preceding = " ".join(
                    m.get("content", "") for m in messages[:index] if m.get("role") == "user"
                )
                if not EXPLICIT_CREATE.search(preceding):
                    fail(f"{label}: create_task is not backed by an explicit user request")


def validate_file(path):
    count = 0
    with path.open(encoding="utf-8") as handle:
        for line_number, line in enumerate(handle, 1):
            if not line.strip():
                continue
            try:
                sample = json.loads(line)
            except json.JSONDecodeError as exc:
                fail(f"{path}:{line_number}: invalid JSON: {exc}")
            validate_sample(sample, f"{path}:{line_number}")
            count += 1
    if count == 0:
        fail(f"{path}: dataset is empty")
    return count


def self_test():
    broken = {
        "messages": [
            {"role": "user", "content": "اعمل تاسك"},
            {"role": "assistant", "content": ""},
        ]
    }
    try:
        validate_sample(broken, "intentional-broken-sample")
    except ValueError as exc:
        print(f"self-test caught expected failure: {exc}")
        return
    fail("self-test failed: broken sample was accepted")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("data", type=Path, nargs="?", default=Path("data/generated"))
    parser.add_argument("--self-test", action="store_true")
    args = parser.parse_args()
    if args.self_test:
        self_test()
    paths = [args.data] if args.data.is_file() else [args.data / name for name in ("train.jsonl", "valid.jsonl", "test.jsonl")]
    total = sum(validate_file(path) for path in paths)
    print(f"validated {total} samples across {len(paths)} files")


if __name__ == "__main__":
    try:
        main()
    except (OSError, ValueError) as exc:
        print(f"validation failed: {exc}", file=sys.stderr)
        raise SystemExit(1)
