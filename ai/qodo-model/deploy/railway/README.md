# Railway model service

Deploy this directory as a **separate Railway service** from the Qodo web app.
Set its Railway root directory to `ai/qodo-model/deploy/railway` and attach a
persistent volume mounted at `/models` so the 1.3GB checkpoint is downloaded
only once.

The checkpoint itself is intentionally not stored in Git. Upload
`artifacts/qodo-ai-qwen3-1.7b-Q6_K.gguf` to a private or public model repository
or object store, then configure the model service:

```dotenv
PORT=8080
QODO_MODEL_URL=https://your-model-host/qodo-ai-qwen3-1.7b-Q6_K.gguf
QODO_MODEL_SHA256=697c94d83ee107c211802c4cd2c68335c0bf80507fd89739c96b67e73c8c6730
QODO_MODEL_ID=qodo-ai-qwen3-1.7b
QODO_SERVER_API_KEY=generate-a-long-random-secret
QODO_CTX_SIZE=4096
QODO_THREADS=4
QODO_THREADS_BATCH=4
```

For hosts that are more reliable with smaller files, split the GGUF into
numbered parts and use these variables instead of relying on the single URL:

```dotenv
QODO_MODEL_PART_URL_PREFIX=https://your-model-host/qodo-ai-qwen3-1.7b-Q6_K.gguf.part-
QODO_MODEL_PART_COUNT=7
```

Parts must use zero-padded suffixes (`00`, `01`, ...). The startup script
downloads and concatenates them in order, then validates the same full-model
SHA-256 before starting inference. `QODO_MODEL_URL` can remain configured as a
fallback; the multipart variables take precedence when present.

If the model host is a private Hugging Face repository, also set `HF_TOKEN` on
the model service. Never put the token in Git.

Use at least 4GB RAM for the pilot. The measured local resident set was about
2.7GB, leaving the rest for context, HTTP buffers and runtime variation.

Then configure the existing Qodo web service. With Railway private networking,
replace `QodoAI` below with the exact model-service name:

```dotenv
QODO_AI_BASE_URL=http://${{QodoAI.RAILWAY_PRIVATE_DOMAIN}}:8080/v1
QODO_AI_API_KEY=the-same-random-secret
QODO_AI_MODEL=qodo-ai-qwen3-1.7b
MAIL_AI_MODEL=qodo-ai-qwen3-1.7b
```

After deployment, run the frozen set against the public or tunnelled endpoint:

```bash
python3 scripts/evaluate_endpoint.py \
  --base-url https://MODEL-DOMAIN/v1 \
  --api-key "$QODO_AI_API_KEY" \
  --model qodo-ai-qwen3-1.7b \
  --output artifacts/railway.json
```

Do not promote the service if it falls below 85%, any write-safety case
regresses, or p95 exceeds 12 seconds. Railway is CPU-only for this deployment;
if it misses the latency gate, keep the same OpenAI-compatible contract and
move only the inference service to a GPU host.
