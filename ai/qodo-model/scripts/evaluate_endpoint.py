#!/usr/bin/env python3
"""Evaluate an OpenAI-compatible Qodo endpoint with the frozen golden set."""

from __future__ import annotations

import argparse
import json
import time
import urllib.error
import urllib.request
from pathlib import Path

from scoring import read_jsonl, score


ROOT = Path(__file__).resolve().parents[1]


def completion_text(message):
    calls = message.get("tool_calls") or []
    if calls:
        function = calls[0].get("function") or {}
        arguments = function.get("arguments", {})
        if isinstance(arguments, str):
            try:
                arguments = json.loads(arguments)
            except json.JSONDecodeError:
                arguments = {"malformed": True, "raw": arguments}
        call = {"name": function.get("name"), "arguments": arguments}
        return f"<tool_call>\n{json.dumps(call, ensure_ascii=False)}\n</tool_call>"
    return message.get("content") or ""


def request_completion(base_url, api_key, payload, timeout):
    headers = {"Content-Type": "application/json"}
    if api_key:
        headers["Authorization"] = f"Bearer {api_key}"
    request = urllib.request.Request(
        f"{base_url.rstrip('/')}/chat/completions",
        data=json.dumps(payload, ensure_ascii=False).encode("utf-8"),
        headers=headers,
        method="POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            return json.load(response)
    except urllib.error.HTTPError as error:
        detail = error.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"endpoint returned HTTP {error.code}: {detail}") from error


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--base-url", default="http://127.0.0.1:8090/v1")
    parser.add_argument("--api-key")
    parser.add_argument("--model", default="qodo-ai-qwen3-1.7b")
    parser.add_argument("--cases", type=Path, default=ROOT / "data" / "golden.jsonl")
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--limit", type=int)
    parser.add_argument("--timeout", type=float, default=60)
    args = parser.parse_args()

    tools = json.loads((ROOT / "data" / "tools.json").read_text(encoding="utf-8"))
    workspace_system = (ROOT / "prompts" / "system.txt").read_text(encoding="utf-8").strip() + "\n\nToday's date: 2026-08-13."
    cases = read_jsonl(args.cases)[: args.limit]
    results = []

    for index, case in enumerate(cases, 1):
        payload = {
            "model": args.model,
            "messages": [
                {"role": "system", "content": case.get("system", workspace_system)},
                {"role": "user", "content": case["input"]},
            ],
            "max_tokens": case.get("max_tokens", 160),
            "temperature": 0,
            "chat_template_kwargs": {"enable_thinking": False},
        }
        if case.get("profile", "workspace") == "workspace":
            payload["tools"] = tools

        started = time.perf_counter()
        response = request_completion(args.base_url, args.api_key, payload, args.timeout)
        duration = time.perf_counter() - started
        message = response["choices"][0]["message"]
        output = completion_text(message)
        passed, reason = score(case, output)
        results.append(
            {
                "id": case["id"],
                "passed": passed,
                "reason": reason,
                "durationSeconds": round(duration, 3),
                "output": output,
            }
        )
        print(f"[{index:02d}/{len(cases):02d}] {'PASS' if passed else 'FAIL'} {case['id']} {duration:.2f}s {reason}")

    passed = sum(row["passed"] for row in results)
    durations = sorted(row["durationSeconds"] for row in results)
    p95_index = max(0, min(len(durations) - 1, int(len(durations) * 0.95) - 1))
    report = {
        "endpoint": args.base_url,
        "model": args.model,
        "cases": len(results),
        "passed": passed,
        "score": round(passed / len(results), 4) if results else 0,
        "p95Seconds": durations[p95_index] if durations else None,
        "results": results,
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"score={passed}/{len(results)} ({report['score']:.1%}) p95={report['p95Seconds']}s")


if __name__ == "__main__":
    main()
