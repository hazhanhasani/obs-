# StreamCore Encoder Health Monitoring — v0.6.0-alpha

Monitor the *local FFmpeg encoder* for every running channel without opening OBS,
keeping a browser tab connected or writing periodic statistics into SQLite.

## Dashboard

The Persian RTL Dashboard now includes **سلامت پردازش پخش**, with a compact
summary for the currently selected channel. **وضعیت سیستم** includes a table
of every configured channel. Updates use the existing authenticated
`GET /api/overview` polling (every five seconds), not a new public endpoint.

| Metric | Meaning |
| --- | --- |
| FPS | Video frames per second reported by FFmpeg's progress output |
| Speed | Encoder media-time progress / wall-clock, e.g. `0.75x` is slower than real-time |
| CPU | Encoder process CPU usage; 100% roughly equals one logical core, so values can exceed 100% |
| RAM | Encoder process resident memory (RSS), in MiB |
| Latest report | Seconds since a complete FFmpeg progress record was received |

States:
- **متوقف / stopped** — the controller sees no living encoder process.
- **در حال آغاز / starting** — process launched less than 25 seconds ago and has not reported metrics.
- **سالم / healthy** — the FFmpeg progress feed is recent; this describes the **local encoder only**.
- **کند / slow** — two consecutive samples report speed below 0.85x; likely underpowered hardware or overloaded effects.
- **بدون آمار / no-data** — no complete records after the 25-second startup grace period.
- **گزارش متوقف شده / stalled** — last complete encoder progress record is older than 20 seconds.

FFmpeg is configured with `-nostats -stats_period 5 -progress pipe:1`.
Each child publishes bounded machine-readable data to its stdout; a dedicated
daemon thread drains it to prevent pipe backpressure. Only the latest sample
per channel is held in RAM. Restarted processes get fresh tracking identities;
late records from an older process are rejected.

## What this DOES NOT measure

- **Remote platform availability:** FFmpeg successfully encoding does not
  mean Telegram, Instagram, Aparat or YouTube has accepted/published a live.
- **Viewer count:** that requires analytics from a delivery service or
  separate playback-server logs.
- **FPS at the viewer:** the reported FPS is from the encoder, not Android HLS playback.
- **Guaranteed quality of service:** a 0.99x speed is helpful but cannot alone
  demonstrate that viewers are free from buffering.
- **Whole-server CPU:** the process CPU percentage is separate from the
  overall system CPU/RAM already displayed.

Progress reports contain no stream key, destination URL or credentials.
The monitoring JSON is only returned by the authenticated dashboard
endpoint. FFmpeg stderr errors continue to use the existing process log.

## Quick investigation on a VPS

When one channel is marked as slow or stalled, check real resource usage
and application logs during a convenient maintenance window:

```bash
cd /opt/streamcore
docker compose ps
docker compose logs --tail=100 dashboard mediamtx
docker stats --no-stream
```

For a shared 4-vCPU server, limit concurrently decoded video layers, then
consider `SCENE_ENCODER_PRESET=ultrafast` with
`SCENE_ENCODER_THREADS=2` as described in
[Performance guide](PERFORMANCE.md).

## Installation and validation

**Code is available on GitHub but has not been deployed to the VPS.**
After a backup and when a brief interruption to ongoing broadcasts is safe:

```bash
cd /opt/streamcore
git pull --ff-only
docker compose up -d --build
docker compose ps
```

Afterwards check: when a channel starts, status transitions from `starting`
to `healthy` once progress arrives. The FPS and speed should update after
about five seconds. Confirm CPU/RAM values and ensure it returns to `stopped`
when stopped. Compare these readings with the actual HLS player and each
target platform separately.

Unit tests cover invalid/malicious samples, stale progress, low-speed
debouncing and process PID isolation. API tests validate authentication
and schema; UI tests validate rendering/escaping. These tests do not replace
a production VPS endurance test.
