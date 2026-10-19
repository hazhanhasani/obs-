FROM debian:bookworm-slim

RUN apt-get update \
    && apt-get install -y --no-install-recommends ffmpeg ca-certificates \
    && rm -rf /var/lib/apt/lists/*

COPY start-stream.sh /usr/local/bin/start-stream
RUN chmod +x /usr/local/bin/start-stream

USER nobody
ENTRYPOINT ["/usr/local/bin/start-stream"]
