#!/usr/bin/env python3
"""Run the frozen Qodo golden set against a base model or LoRA adapter."""

from __future__ import annotations

import argparse
import json
import time
from pathlib import Path

from mlx_lm import generate, load
from scoring import read_jsonl, score


ROOT = Path(__file__).resolve().parents[1]


def format_prompt(tokenizer, messages, tools):
    kwargs = {
        "tools": tools,
        "add_generation_prompt": True,
        "tokenize": False,
    }
    try:
        return tokenizer.apply_chat_template(messages, enable_thinking=False, **kwargs)
    except TypeError:
        return tokenizer.apply_chat_template(messages, **kwargs)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--model", required=True)
    parser.add_argument("--adapter-path")
    parser.add_argument("--cases", type=Path, default=ROOT / "data" / "golden.jsonl")
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--limit", type=int)
    args = parser.parse_args()

    tools = json.loads((ROOT / "data" / "tools.json").read_text(encoding="utf-8"))
    workspace_system = (ROOT / "prompts" / "system.txt").read_text(encoding="utf-8").strip() + "\n\nToday's date: 2026-08-13."
    cases = read_jsonl(args.cases)[: args.limit]
    model, tokenizer = load(args.model, adapter_path=args.adapter_path)
    results = []

    for index, case in enumerate(cases, 1):
        system = case.get("system", workspace_system)
        selected_tools = tools if case.get("profile", "workspace") == "workspace" else None
        messages = [
            {"role": "system", "content": system},
            {"role": "user", "content": case["input"]},
        ]
        prompt = format_prompt(tokenizer, messages, selected_tools)
        started = time.perf_counter()
        output = generate(model, tokenizer, prompt=prompt, max_tokens=case.get("max_tokens", 160), verbose=False)
        duration = time.perf_counter() - started
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
        "model": args.model,
        "adapterPath": args.adapter_path,
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
