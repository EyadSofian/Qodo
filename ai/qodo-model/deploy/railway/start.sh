#!/bin/sh
set -eu

model_dir="${QODO_MODEL_DIR:-/models}"
model_file="${QODO_MODEL_FILE:-qodo-ai-qwen3-1.7b-Q6_K.gguf}"
model_path="${model_dir}/${model_file}"

if [ ! -s "$model_path" ]; then
  if [ -z "${QODO_MODEL_URL:-}" ] && [ -z "${QODO_MODEL_PART_URL_PREFIX:-}" ]; then
    echo "QODO_MODEL_URL or QODO_MODEL_PART_URL_PREFIX is required the first time the model service starts." >&2
    exit 1
  fi
  mkdir -p "$model_dir"
  temporary_path="${model_path}.download"
  rm -f "$temporary_path"

  download_file() {
    download_url="$1"
    download_target="$2"
    if [ -n "${HF_TOKEN:-}" ]; then
      curl --fail --location --retry 5 --retry-all-errors \
        -H "Authorization: Bearer ${HF_TOKEN}" \
        --output "$download_target" "$download_url"
    else
      curl --fail --location --retry 5 --retry-all-errors \
        --output "$download_target" "$download_url"
    fi
  }

  if [ -n "${QODO_MODEL_PART_URL_PREFIX:-}" ]; then
    part_count="${QODO_MODEL_PART_COUNT:-0}"
    if [ "$part_count" -le 0 ]; then
      echo "QODO_MODEL_PART_COUNT must be greater than zero for a multipart model." >&2
      exit 1
    fi
    echo "Downloading Qodo model artifact in ${part_count} parts..."
    : > "$temporary_path"
    part_number=0
    while [ "$part_number" -lt "$part_count" ]; do
      part_suffix="$(printf '%02d' "$part_number")"
      part_path="${temporary_path}.part-${part_suffix}"
      download_file "${QODO_MODEL_PART_URL_PREFIX}${part_suffix}" "$part_path"
      cat "$part_path" >> "$temporary_path"
      rm -f "$part_path"
      part_number=$((part_number + 1))
    done
  else
    echo "Downloading Qodo model artifact..."
    download_file "$QODO_MODEL_URL" "$temporary_path"
  fi
  mv "$temporary_path" "$model_path"
fi

if [ -n "${QODO_MODEL_SHA256:-}" ]; then
  echo "${QODO_MODEL_SHA256}  ${model_path}" | sha256sum --check --status || {
    echo "Qodo model checksum validation failed." >&2
    exit 1
  }
fi

set -- \
  --model "$model_path" \
  --alias "${QODO_MODEL_ID:-qodo-ai-qwen3-1.7b}" \
  --host 0.0.0.0 \
  --port "${PORT:-8080}" \
  --ctx-size "${QODO_CTX_SIZE:-4096}" \
  --parallel 1 \
  --threads "${QODO_THREADS:-4}" \
  --threads-batch "${QODO_THREADS_BATCH:-4}" \
  --jinja \
  --reasoning-format deepseek

if [ -n "${QODO_SERVER_API_KEY:-}" ]; then
  set -- "$@" --api-key "$QODO_SERVER_API_KEY"
fi

exec /app/llama-server "$@"
