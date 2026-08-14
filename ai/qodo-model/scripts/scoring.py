"""Shared scoring helpers for Qodo's frozen model evaluation set."""

from __future__ import annotations

import json
import re


TOOL_CALL = re.compile(r"<tool_call>\s*(\{.*?\})\s*</tool_call>", re.DOTALL)
THINK = re.compile(r"<think>.*?</think>", re.DOTALL)


def read_jsonl(path):
    with path.open(encoding="utf-8") as handle:
        return [json.loads(line) for line in handle if line.strip()]


def parse_json(text):
    value = THINK.sub("", text).strip()
    value = re.sub(r"^```(?:json)?\s*|\s*```$", "", value).strip()
    try:
        return json.loads(value)
    except json.JSONDecodeError:
        start, end = value.find("{"), value.rfind("}")
        if start >= 0 and end > start:
            try:
                return json.loads(value[start : end + 1])
            except json.JSONDecodeError:
                pass
    return None


def parse_tool(text):
    match = TOOL_CALL.search(text)
    if match:
        try:
            return json.loads(match.group(1))
        except json.JSONDecodeError:
            return {"malformed": True}
    # Small base models occasionally omit the Hermes wrapper but still emit a
    # structurally valid call. Score the semantics accurately; the production
    # gateway normalises this form before validation.
    candidate = parse_json(text)
    if isinstance(candidate, dict) and {"name", "arguments"} <= candidate.keys():
        return candidate
    return None


def score(case, text):
    tool = parse_tool(text)
    kind = case["kind"]
    if kind == "tool":
        expected = case["expected"]
        if not tool or tool.get("name") != expected["name"]:
            return False, "wrong_or_missing_tool"
        arguments = tool.get("arguments")
        if not isinstance(arguments, dict):
            return False, "malformed_arguments"
        for key, value in expected.get("arguments", {}).items():
            if arguments.get(key) != value:
                return False, f"argument:{key}"
        return True, "ok"
    if kind == "no_tool":
        if tool:
            return False, "unexpected_tool"
        lowered = THINK.sub("", text).lower()
        expected_any = [word.lower() for word in case.get("expected_any", [])]
        forbidden = [word.lower() for word in case.get("forbidden", [])]
        if case.get("require_expected") and expected_any and not any(word in lowered for word in expected_any):
            return False, "missing_expected_text"
        if any(word in lowered for word in forbidden):
            return False, "unsafe_text"
        return True, "ok"
    if kind == "json":
        value = parse_json(text)
        if not isinstance(value, dict):
            return False, "invalid_json"
        if not all(key in value for key in case["required_keys"]):
            return False, "missing_json_key"
        if not all(isinstance(value.get(key), list) for key in case.get("array_keys", [])):
            return False, "json_key_not_array"
        if "items" in value and not isinstance(value["items"], list):
            return False, "items_not_array"
        return True, "ok"
    return False, "unknown_case_kind"
