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
QODO_MODEL_SHA256=a6bbcb6e385818d647ffe0b2a737dd04ce4e18886e11c5ec173bec57c41943e4
QODO_MODEL_ID=qodo-ai-qwen3-1.7b
QODO_SERVER_API_KEY=generate-a-long-random-secret
QODO_CTX_SIZE=4096
QODO_THREADS=4
QODO_THREADS_BATCH=4
```

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
