# RTMP relay reliability

The destination supervisor previously treated a live process as successful sending.
A blocked RTMP socket could therefore stay green indefinitely. Output diagnostics
were intentionally discarded to avoid exposing stream keys.

Relays now use a 15-second read/write network timeout on both input and output,
with an independent supervisor watchdog. FFmpeg progress is drained through a
pipe and whitelisted by the existing ProgressTracker. Missing startup progress
(after 25 seconds) or stale reports (over 20 seconds) stop only the affected
relay. The supervisor waits at least 3 seconds before reconnecting. Existing
failed-start retry pacing remains 10 seconds. Main-channel encoding is preserved.

The API includes sanitized `transport` progress. The green indicator requires
reported video frames, rather than only a live PID. This proves local muxer
progress, not remote publication or viewer playback. Diagnostic stderr and
secret-bearing command lines remain private. No schema/config migration is needed.

## OBS comparison

References:
- https://github.com/obsproject/obs-studio/blob/master/plugins/obs-outputs/rtmp-stream.c
- https://github.com/obsproject/obs-studio/blob/master/docs/sphinx/reference-outputs.rst

OBS separates connection state, actual output statistics, congestion handling
and reconnect behavior. This patch independently applies progress-aware output
supervision. It does not copy OBS code or implement its dynamic bitrate/frame
queue policies. Stream-copy relays cannot change the source encoder bitrate.

## Investigation limits and rollout

Provided VPS screenshots show a 1920x1080 H.264 / AAC internal feed with nominal
25 fps, moderate CPU utilization and some CPU steal. They do not establish the
actual encoder throughput or the reason for Telegram buffering. Repeated FLV
header warnings alone are not proof of a fatal encoder failure. Full-HD software
composition and network congestion remain hypotheses requiring live measurements.

Deploy the full dashboard image during a maintenance window; rebuilding it
interrupts running publishers. Verify internal preview and Telegram separately,
including a destination outage/recovery. This patch has not been deployed or
validated on the user's VPS. Saving a scene still restarts its encoder.
