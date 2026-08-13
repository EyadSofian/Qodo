# Qodo AI model

This directory contains the reproducible pilot for a small Qodo-specific model.
It teaches behaviour, not company facts:

- Egyptian Arabic and Arabic/English code-switching
- selecting Qodo's existing read tools
- drafting explicit task requests without inventing owners or dates
- mail summaries, suggested replies, and action extraction
- refusing prompt injection embedded inside mail or chat content

Live tasks, employees, permissions, and metrics remain in Qodo's database and
tools. They must never be memorised in model weights.

## Safety contract

The model is an untrusted planner. Read tools may run after the existing server
permission checks. `create_task` is a write tool and must be shown as a draft and
confirmed by the signed-in user before the server executes it. The model never
writes to the store directly.

Training data is synthetic and contains no employee conversations or secrets.

## Pilot model

- Base: `mlx-community/Qwen3-1.7B-4bit` (Apache-2.0 upstream model family)
- Machine: Apple Silicon via MLX
- Method: LoRA, prompt masked from the loss
- Initial target: tool selection/argument exactness and useful Arabic output
- Promotion gate: no regression on safety cases and at least 85% routing score
- Latency gate: p95 under 12 seconds for the internal pilot

The 1.7B checkpoint is deliberately the first rung. If it cannot pass the
golden set after a clean LoRA run, repeat the exact evaluation with Qwen3-4B.

## Reproduce

```bash
cd ai/qodo-model
uv venv --python 3.12 .venv
uv pip install --python .venv/bin/python mlx-lm

.venv/bin/python scripts/build_dataset.py
.venv/bin/python scripts/validate_data.py data/generated

# Baseline before training
.venv/bin/python scripts/evaluate.py \
  --model mlx-community/Qwen3-1.7B-4bit \
  --cases data/golden.jsonl \
  --output artifacts/baseline.json

# Initial LoRA, then the two targeted safety/routing continuations
.venv/bin/mlx_lm.lora --config config/qwen3-1.7b-lora.yaml
.venv/bin/mlx_lm.lora --config config/qwen3-1.7b-safety.yaml
.venv/bin/mlx_lm.lora --config config/qwen3-1.7b-targeted.yaml

# The same frozen test after training
.venv/bin/python scripts/evaluate.py \
  --model mlx-community/Qwen3-1.7B-4bit \
  --adapter-path artifacts/qwen3-1.7b-targeted \
  --cases data/golden.jsonl \
  --output artifacts/final.json
```

`data/golden.jsonl` is never used for training. Add real examples only after
anonymising them and obtaining permission to use them.

## Result and deployment artifact

The final MLX adapter scored 26/27 (96.3%) on the frozen set. Quantization was
evaluated separately rather than assumed safe: Q4_K_M scored 81.5% and was
rejected, Q5_K_M scored 85.2% but regressed on an ambiguous write request, and
Q6_K was selected. CPU-only Q6_K scored 23/27 (85.2%) with all explicit
write-safety cases passing.

See [MODEL_CARD.md](MODEL_CARD.md) and [results/metrics.json](results/metrics.json)
for the full handoff. The Railway CPU pilot is packaged in
[deploy/railway](deploy/railway/README.md).

Any hosted OpenAI-compatible endpoint can be tested with the same cases:

```bash
python3 scripts/evaluate_endpoint.py \
  --base-url http://127.0.0.1:8080/v1 \
  --model qodo-ai-qwen3-1.7b \
  --output artifacts/endpoint.json
```
