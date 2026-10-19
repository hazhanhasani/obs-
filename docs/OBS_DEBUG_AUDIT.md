# StreamCore: OBS-informed debug audit

Date: 2026-10-19
Scope: current checkout of StreamCore, Python API and supervisors, FFmpeg scene
construction, telemetry, browser player/editor, Docker routing, release updater.
This is a source and local regression audit, not a production certification or
an exhaustive audit of the entire native OBS codebase.

## Reference model

OBS separates rendering, audio processing, encoding and output. Its output
layer distinguishes connection state, output statistics, congestion and retry
behavior. StreamCore uses CPU FFmpeg composition and separate stream-copy
relays; it does not embed libobs. Native OBS performance cannot be inferred for
this pipeline, particularly on shared-vCPU VPS plans.

Official references examined:
- https://docs.obsproject.com/backend-design
- https://github.com/obsproject/obs-studio/blob/master/plugins/obs-outputs/rtmp-stream.c
- https://github.com/obsproject/obs-studio/blob/master/libobs/obs-output.c
- https://github.com/obsproject/obs-studio/blob/master/docs/sphinx/reference-outputs.rst
- https://obsproject.com/kb/encoding-performance-troubleshooting
- https://obsproject.com/kb/stream-connection-troubleshooting/

## Confirmed defects and corrections

| Priority | Location | Defect | Correction / evidence |
| --- | --- | --- | --- |
| High | dashboard/destinations.py | Live PID alone marked output as sending; no explicit read/write deadlines | Bounded network waits, sanitized progress pipe, missing/stale-progress relay watchdog; destination regressions |
| High | dashboard/telemetry.py | Fresh reports with an unchanged frame counter remained healthy | Track last forward frame movement independently of report freshness; frozen-frame regression |
| High | dashboard/app.py Controller | A living but frozen encoder was never recovered | Restart stalled/no-data publisher after bounded retry delay; slow but advancing encoders are not restarted; controller regression |
| High | scripts/update-release.sh | Rollback checked out the already-advanced main branch without restoring its original commit | Reset clean deployment checkout to recorded original SHA; test executes actual rollback function in disposable Git repo |
| Medium | dashboard/static/app.js | Every fatal HLS error used network reload, including decoder failures | Distinct network/media recovery; recreate player on other fatal errors; resumed playback clears warning; three JS regressions |

Progress is local FFmpeg muxer activity. It is not proof of successful Telegram
publication. No stream key or raw FFmpeg diagnostics are added to public APIs.
Startup grace is 25 seconds; stale/frozen detection is over 20 seconds; the
supervisor polls every three seconds. Recovery is bounded, not interruption-free.

## Remaining architecture and operational findings

| Area | Finding / impact | Status |
| --- | --- | --- |
| Scene application | Saving a scene stops/recreates the publisher, disconnecting HLS and downstream relays | Confirmed architecture limitation; requires persistent Program pipeline for seamless switching |
| Rendering | Full-frame RGBA composition, repeated image inputs at 25 fps and multiple video decoders cost CPU; decoder thread use is not bounded by encoder thread settings | Confirmed code characteristics; no proof they caused the reported VPS issue; benchmark before optimization |
| Audio | Base video's audio is selected; additional videos are muted; no mixer, per-source gain or limiter | Product limitation, not claimed as an OBS-equivalent mixer |
| Congestion | Relays copy encoded packets; no OBS-style adaptive bitrate or network frame-drop policy | Reconnect recovery only; encoder bitrate policy needs a separate design |
| Security | Session authentication, CSRF, path checks, encrypted destination keys and private RTMP ports exist | Reviewed safeguards, not a penetration test |
| Destination URLs | DNS names can resolve to private addresses despite literal-IP validation | Trusted-admin configuration only; restrict egress for hostile/multi-tenant use |
| Playback access | Caddy exposes /live/* publicly | Existing behavior; private/paywalled playback is not implemented |
| Dependencies | MediaMTX/Caddy major tags and broad Python dependency ranges are mutable | Reproducibility gap; pin tested digests/lockfiles in a release workflow |
| Telemetry | Encoder speed is cumulative; no per-interval output bitrate, restart counter or remote-acceptance probe | Additional observability still needed |
| Logs | Publisher FFmpeg log is append-only | Add bounded rotation before long-term unattended operation |
| Updater | Database snapshot is retained but rollback does not restore schema/data automatically | Existing limitation; automatic DB restore could lose post-upgrade changes |
| Mobile editor | Geometry tests cover touch emulation; physical Android/WebView behavior is not verified here | Explicit remaining validation |

## Validation

Regression tests cover relay deadlines/status/recovery/redaction, frozen frame
counters, publisher recovery, HLS recovery and real Git rollback. Existing Python
suite includes authenticated API, geometry and real FFmpeg rendering tests.
JavaScript logic tests cover scene transforms, touch interaction and monitoring.
Check the execution report for exact totals. Browser/WebView device testing,
Docker image build, sustained live throughput, external Telegram acceptance and
production network outage tests remain outside this local run.

## Controlled rollout and diagnosis

No live VPS or destination credentials are available in this environment. No
production service was restarted. Earlier screenshots establish accessible
1080p H.264/AAC stream metadata, not continuous realtime throughput. Buffering
may still involve rendering speed, source timestamps, network throughput,
Telegram session credentials or client buffering. Do not label it fixed until
internal playback and actual destination playback are observed together.

After a maintenance-window deployment, observe both channel `encoder` and
per-destination `transport` progress. Test a deliberate destination outage and
confirm only that relay restarts. Verify a long scene loop and compare audio /
video timestamps. Keep the previous image, commit and database snapshot available.
