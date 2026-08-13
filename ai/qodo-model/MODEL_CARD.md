# Qodo AI Qwen3 1.7B

Qodo AI is a small internal-workspace assistant tuned from the Apache-2.0
Qwen3-1.7B family. Its job is to understand Arabic, Egyptian Arabic and common
Arabic/English code-switching, select Qodo tools, summarize conversations and
extract explicit action items.

## Intended use

- Qodo assistant routing and short answers.
- Qodo Mail summaries, reply drafts and action extraction.
- Drafting a task only when the user explicitly asks for one.

The model is not a database and must not be treated as one. Current employees,
tasks, messages, permissions and business metrics are supplied at request time
through server-side tools.

## Training

- Base: `mlx-community/Qwen3-1.7B-4bit`
- Method: LoRA with prompt masking, rank 16, 16 adapted layers.
- Data: 666 synthetic training examples, 74 validation examples and 74 held-out
  synthetic test examples.
- Private company conversations, employee data, credentials and customer data
  were not used.

## Evaluation

The frozen golden set has 27 Arabic, Egyptian Arabic, English, tool-routing,
mail-JSON and safety cases. It was written before fine-tuning and was never
included in training.

| Candidate | Passed | Score | p95 |
| --- | ---: | ---: | ---: |
| Base MLX 4-bit | 17/27 | 63.0% | 0.679s |
| Final LoRA on MLX | 26/27 | 96.3% | 0.691s |
| GGUF Q4_K_M | 22/27 | 81.5% | 0.322s |
| GGUF Q5_K_M | 23/27 | 85.2% | 0.309s |
| **GGUF Q6_K** | **24/27** | **88.9%** | **0.416s** |
| **GGUF Q6_K, CPU-only** | **23/27** | **85.2%** | **1.099s** |

The p95 figures are local measurements on an Apple M5 Pro, not a promise about
Railway hardware. The CPU-only cold request took 5.87 seconds and the process
settled at roughly 2.7GB RSS with a 4096-token context. Re-run the frozen suite
on the deployed Railway service before sending production traffic.

Full machine-readable results are in `results/metrics.json`. The selected
artifact is:

```text
qodo-ai-qwen3-1.7b-Q6_K.gguf
SHA-256 a6bbcb6e385818d647ffe0b2a737dd04ce4e18886e11c5ec173bec57c41943e4
```

Q4 was rejected for missing the 85% gate. Q5 reached the numeric gate but was
rejected because an ambiguous task request regressed into a task proposal.

## Safety boundary

Model output is untrusted. Qodo validates permissions and organisation scope on
the server. Read tools run through those checks. `create_task` is held as a
short-lived draft and requires an explicit click from the same signed-in user;
the confirmation token is consumed before execution to prevent replay.

The model may still choose the wrong read tool, paraphrase a title imperfectly
or omit a relative date. Keep the confirmation UI, tool validation and audit
logging enabled. Do not give the inference process database credentials.

## Licence

The base Qwen3 model family is Apache-2.0. Preserve its upstream licence and
notices when distributing the fused or quantized checkpoint. Qodo-specific
application code follows this repository's licence.
