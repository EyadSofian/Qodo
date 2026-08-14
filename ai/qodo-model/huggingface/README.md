---
license: apache-2.0
base_model: Qwen/Qwen3-1.7B
language:
  - ar
  - en
pipeline_tag: text-generation
tags:
  - gguf
  - qodo
  - arabic
  - egyptian-arabic
  - function-calling
---

# Qodo AI Qwen3 1.7B · GGUF

Qodo AI is Engosoft's compact workspace assistant, tuned for Arabic, Egyptian
Arabic, English and common Arabic/English code-switching. It supports Qodo Mail
summaries, reply drafts, action extraction and safe workspace tool routing.

## Artifact

| File | Quantization | SHA-256 |
| --- | --- | --- |
| `qodo-ai-qwen3-1.7b-Q6_K.gguf` | Q6_K | `697c94d83ee107c211802c4cd2c68335c0bf80507fd89739c96b67e73c8c6730` |

The analysis-tuned Q6_K artifact was selected after expanded frozen-set
evaluation. It scored 27/31 (87.1%) in an unconstrained CPU-only run and 28/31
(90.3%) with Qodo's production JSON schemas; both 20-message summary cases
passed. Every explicit write remains server-confirmed. Local latency is
hardware-specific; re-run the included endpoint evaluation before production
traffic is enabled.

## Intended use

- Qodo assistant routing and concise workspace answers.
- Qodo Mail conversation summaries and reply drafts.
- Extracting explicit action items.
- Proposing a task only when the user clearly asks for one.

The model receives current workspace context from server-side tools. It is not
the source of truth for employees, permissions, messages, tasks or metrics.

## Runtime

Serve the GGUF with an OpenAI-compatible `llama.cpp` server. Recommended
starting configuration: 4096-token context, one parallel slot, Jinja chat
templates and server-side API authentication.

## Evaluation and safety

Model output is treated as untrusted. Qodo validates organisation scope and
permissions on the application server. Write tools remain drafts until the
signed-in user explicitly confirms them; confirmation tokens are short-lived
and single-use.

The training set contains synthetic workspace examples. Private company
conversations, credentials, employee records and customer data were not used.

## Licence

Apache-2.0, following the upstream Qwen3 model family.
