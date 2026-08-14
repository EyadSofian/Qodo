#!/bin/sh
set -eu

model_dir="${QODO_MODEL_DIR:-/models}"
model_file="${QODO_MODEL_FILE:-qodo-ai-qwen3-1.7b-Q6_K.gguf}"
model_path="${model_dir}/${model_file}"

if [ -s "$model_path" ] && [ -n "${QODO_MODEL_SHA256:-}" ]; then
  if ! echo "${QODO_MODEL_SHA256}  ${model_path}" | sha256sum --check --status; then
    echo "Cached Qodo model checksum changed; downloading the requested version..."
    rm -f "$model_path"
  fi
fi

if [ ! -s "$model_path" ]; then
  if [ -z "${QODO_MODEL_URL:-}" ] && [ -z "${QODO_MODEL_PART_URL_PREFIX:-}" ]; then
    echo "QODO_MODEL_URL or QODO_MODEL_PART_URL_PREFIX is required the first time the model service starts." >&2
    exit 1
  fi
  mkdir -p "$model_dir"
  temporary_path="${model_path}.download"

  download_file() {
    download_url="$1"
    download_target="$2"
    if [ -n "${HF_TOKEN:-}" ]; then
      curl --fail --location --silent --show-error --retry 8 --retry-all-errors --continue-at - \
        -H "Authorization: Bearer ${HF_TOKEN}" \
        --output "$download_target" "$download_url"
    else
      curl --fail --location --silent --show-error --retry 8 --retry-all-errors --continue-at - \
        --output "$download_target" "$download_url"
    fi
  }

  if [ -n "${QODO_MODEL_PART_URL_PREFIX:-}" ]; then
    part_count="${QODO_MODEL_PART_COUNT:-0}"
    if [ "$part_count" -le 0 ]; then
      echo "QODO_MODEL_PART_COUNT must be greater than zero for a multipart model." >&2
      exit 1
    fi
    echo "Downloading Qodo model artifact in ${part_count} resumable parallel parts..."
    download_pids=""
    part_number=0
    while [ "$part_number" -lt "$part_count" ]; do
      part_suffix="$(printf '%02d' "$part_number")"
      part_path="${temporary_path}.part-${part_suffix}"
      download_file "${QODO_MODEL_PART_URL_PREFIX}${part_suffix}" "$part_path" &
      download_pids="${download_pids} $!"
      part_number=$((part_number + 1))
    done

    download_failed=0
    for download_pid in $download_pids; do
      if ! wait "$download_pid"; then
        download_failed=1
      fi
    done
    if [ "$download_failed" -ne 0 ]; then
      echo "One or more model parts failed to download; partial files were kept for the next retry." >&2
      exit 1
    fi

    : > "$temporary_path"
    part_number=0
    while [ "$part_number" -lt "$part_count" ]; do
      part_suffix="$(printf '%02d' "$part_number")"
      cat "${temporary_path}.part-${part_suffix}" >> "$temporary_path"
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
    rm -f "$model_path"
    exit 1
  }
fi

if [ -n "${QODO_MODEL_PART_URL_PREFIX:-}" ]; then
  rm -f "${model_path}.download.part-"??
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
