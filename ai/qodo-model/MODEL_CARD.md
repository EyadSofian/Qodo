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
- Data: 719 synthetic training examples, 80 validation examples and 80 held-out
  synthetic test examples.
- Private company conversations, employee data, credentials and customer data
  were not used.

## Evaluation

The expanded frozen golden set has 31 Arabic, Egyptian Arabic, English,
tool-routing, structured mail-JSON and safety cases. It was never included in
training.

| Candidate | Passed | Score | p95 |
| --- | ---: | ---: | ---: |
| Pre-analysis LoRA | 25/31 | 80.7% | 0.571s |
| Analysis LoRA on MLX | 29/31 | 93.5% | 0.650s |
| GGUF Q6_K, CPU-only | 27/31 | 87.1% | 1.161s |
| **GGUF Q6_K, CPU-only + production JSON schema** | **28/31** | **90.3%** | **1.206s** |

The p95 figures are local measurements on an Apple M5 Pro, not a promise about
Railway hardware. Re-run the frozen suite on the deployed Railway service
before sending production traffic.

Full machine-readable results are in `results/metrics.json`. The selected
artifact is:

```text
qodo-ai-qwen3-1.7b-Q6_K.gguf
SHA-256 697c94d83ee107c211802c4cd2c68335c0bf80507fd89739c96b67e73c8c6730
```

Q8 matched the structured score but used materially more memory, so Q6_K was
selected for the current Railway CPU service.

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
