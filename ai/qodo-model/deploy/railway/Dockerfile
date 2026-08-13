FROM ghcr.io/ggml-org/llama.cpp:server

COPY start.sh /app/qodo-start.sh
RUN chmod 755 /app/qodo-start.sh

ENTRYPOINT ["/app/qodo-start.sh"]
