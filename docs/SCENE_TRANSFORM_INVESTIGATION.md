# Scene transform investigation — 2026-10-19

## Confirmed causes

| Cause | Evidence and effect | Resolution |
| --- | --- | --- |
| HTTP CSP rejected inline styles | Authenticated production HTML emitted `Refused to apply inline style` console errors. `preview()` generated layer rectangles with `innerHTML` style attributes, while pointermove wrote CSSOM properties. Thus the initial/saved rectangle could be rejected, temporarily move via CSSOM, and lose its styling on pointerup's HTML rebuild. The old Chrome fixture omitted production HTTP headers. | Allow **style attributes only** with `style-src-attr`; retain restricted stylesheet/script sources. Keep DOM stable on release. |
| CSP rejected Blob images | The real-render UI uses `URL.createObjectURL()`; `img-src` lacked `blob:`. | Permit Blob images and decode the actual UI preview in browser tests. |
| Canvas clipped controls | `overflow:hidden` removed the off-frame portions of media and controls from hit testing. A browser-input test at X=-2% failed with no handle under its center. | An outlined video frame inside a padded editing workspace, with visible overflow. Only FFmpeg clips published pixels. |
| Tiny source targets overlapped | A 5% mobile box was smaller than its 42px centered hitboxes. `elementFromPoint()` on NW returned SE. It could therefore resize the wrong corner. | Four 44px outward-quadrant targets on an independent control plane; non-intersecting even at 0.1% bounds. |
| Controls belonged to media stacking contexts | A source's opacity/effect can create a stacking context below a later overlapping source. Raising a child's z-index cannot escape it. Raising the selected source itself would incorrectly change visual composition. | Separate control plane above all sources without changing their order or opacity. Browser test includes a 50%-opaque selected lower source. |
| Different coordinate rectangles | Gesture math used the bordered canvas's outer rectangle; percentages resolve against its inner layer container. Selected borders also changed the content available to object-fit. | Read `scene-items.getBoundingClientRect()`, use outlines rather than geometric borders. Assert actual DOM rectangles, not only input values. |
| Missing landscape Full HD and minimum 5% | Only 1280×720, 720×1280 and 1080×1920 existed. The 5% minimum prevented small logos and forced crossing-edge resizes to stop too soon. | Add 1920×1080 and accept 0.1..200% dimensions in UI, Python and API. |

## Interaction defects addressed defensively

The old editor registered Pointer, Touch and Mouse handlers simultaneously.
That created avoidable compatibility-event paths, although a duplicate-event
failure was not independently established as the primary production cause.
Now Pointer Events are exclusive when available; legacy touch/mouse handlers
are installed only otherwise. Root capture and window listeners cover pointer
movement outside the frame and unexpected capture loss. Blur/hidden-page
cleanup finalizes the last valid geometry, as does pointer cancellation.

Percentage deltas accumulate using current displayed content dimensions.
Resizing the viewport without moving the pointer adds zero displacement.
A render scheduled during a gesture is deferred; visual geometry uses rAF,
and numeric/model updates are synchronous. Release flushes the last frame
without reconstructing layers. State is observable as `idle`, `selected`,
`dragging`/`resizing`, `committed`, then `selected`.

An in-flight save uses a snapshot. Edits made while the response is pending
remain dirty; they are not incorrectly declared persisted.

## Verification and reproduction

```sh
pip install -r dashboard/requirements.txt pytest httpx
npm ci
npx playwright install --with-deps chromium
npm run test:browser
PYTHONPATH=dashboard python -m pytest -q tests
node --test tests/test_scene_editor.cjs tests/test_telemetry_ui.cjs
CHROME_BIN=/path/to/chrome node --test tests/test_scene_handle_browser.cjs
bash tests/test_installer.sh
```

The interaction suite starts a temporary real HTTP API and SQLite database.
Only external publisher supervisors are disabled; login/CSRF, scene
validation, saves, reads and FFmpeg run normally. Tests load the complete
production HTML/CSS/JS and CSP, then use Playwright mouse and Chromium CDP
Touch/Pen input. They never call gesture handlers directly. Test media and
databases live in temporary directories; no live installation is contacted.

The matrix covers 360, 390, 430 and 1080 CSS-pixel viewports, every output
preset and every corner, plus negative positioning, tiny boxes, overlapping
sources, text, cancellation, capture loss, save/reload and property controls.
Decoded JPEG red-box extents are compared to editor geometry in all four
output resolutions. Allow up to two output pixels for even raster sizes,
4:2:0 positioning and JPEG edge compression.

This is **desktop Chromium with mobile/touch emulation**, not a physical
Android phone, Android emulator, or Android WebView. Those environments and
live Telegram ingestion still require validation on their actual targets.
Browser text glyph metrics/effect timing remain an editing approximation;
the actual FFmpeg preview is authoritative for those pixels.

## Deployment boundary

A push to main runs validation; it does not publish a stable Release.
The updater checks published stable Releases, not main. GitHub Releases/latest
returned 404 during investigation: there was no stable release to install.
The timer defaults to deferring while any channel has `desired=1`; an operator
can explicitly override this with `AUTO_UPDATE_ALLOW_LIVE=true`.

No production SSH connection or working desktop tunnel was available. No
server deployment, updater timer state, or live destination is represented
as verified. Do not publish an unattended rollout until the installed live
policy is known or a maintenance window is authorized.

## Recorded browser evidence

[390px touch resize recording](screenshots/scene-resize-390.webm) was captured
from Playwright's actual Chromium video recorder while the mobile demo test
resized all four corners, saved through the real API and reloaded the scene.
It is an emulated viewport recording, not a physical Android recording.

Independent review also found reused pointer-ID recovery and resolution
changes during a pending save. Regression tests now cover both, mouse/pen
hover cleanup after a missed release, and a real viewport resize mid-gesture.
CI installs the pinned Playwright Chromium build for reproducibility.

## Local verification results

- 81 browser interaction tests passed, including 64 viewport/preset/corner
  combinations, 4 decoded FFmpeg comparisons, text and recovery cases.
- 41 Node model/UI tests and 2 standalone Chromium hitbox tests passed.
- Python: 64 tests plus 27 unittest subtests passed. One upstream
  Starlette/httpx deprecation warning remains; there were no test failures.
- Installer preservation tests, JavaScript syntax, Python compilation, shell
  syntax and `git diff --check` passed.
- No local Docker CLI was available; container build is delegated to the
  required GitHub Actions validation job and must be checked there.

## Physical-phone report follow-up: Chromium touch adjustment (0.8.1)

The operator installed 0.8.0 and reported that Chrome on their Android phone
still could not resize. This was not contradicted by CI: its point-size CDP
contacts were aimed at the center of an invisible 44px hitbox, not the visible
15px orange grip near the hitbox's inner edge.

A new test dispatched a 14px-radius finger contact exactly on each orange
grip. All four failed on the old code: the actual `pointerdown.target` was the
media DIV (`role=button`), not the decorative span grip. Chromium's mobile
touch adjustment preferred the nearby interactive source. This started a
move gesture instead of a resize even though point hit-testing found a grip.

Replacing the span with a native `button type=button` made the same four
tests pass without changing CSS, geometry, capture or viewport constraints.
The controls retain `tabindex=-1` and `aria-hidden=true`; numeric geometry
fields remain the accessible keyboard path, avoiding inert keyboard buttons.

Regression cases now touch the visible grip with 1, 8, 14 and 22px contact
radii at device scale factors 1, 2.75 and 3. They inspect the actual browser
pointer target and verify dimensions, opposite anchors, save and reload.
These tests use Chromium mobile emulation. Actual Android confirmation is
still required after installing this follow-up; no physical-device success
is claimed.

### Apply the frontend-only 0.8.1 fix without restarting streams

For the existing Compose installation, build the updated image for future
container recreations, then copy its unchanged-path frontend files into the
running dashboard. Neither command recreates a running container:

```sh
cd /opt/streamcore &&
git pull --ff-only origin main &&
docker compose build dashboard &&
docker compose cp dashboard/static/. dashboard:/app/static/
```

Reload the browser page to request the 0.8.1 versioned assets. Do not add
`up`, `restart` or `down` to this frontend-only procedure during a live stream.
This does not apply backend changes in future releases; those require the
normal maintenance/update procedure.

## 0.9.0 OBS-inspired interaction follow-up

The native OBS source review is documented in `OBS_EDITOR_PARITY.md`. It led to
an original geometry-first hit engine, eight handles, local transform history,
optional aspect/snapping and a shared persisted source stack. It does not change
the previously confirmed CSP and Chromium finite-contact root causes above.

Additional defects confirmed while implementing the new controls:

- Numeric aspect preservation independently clamped the paired dimension at
  200%, distorting the ratio. Both dimensions now use the same bounded scale.
- Reconstructing a history snapshot dropped keyboard focus. Pointerdown also
  prevented normal source focus. Canvas focus is explicitly restored, including
  click-then-arrow interaction tested with real browser input.
- A very tall off-frame selection could place an orange handle over the toolbar
  and intercept its clicks. The padded, scrollable editing viewport clips UI
  overflow at its own boundary while leaving video-frame overflow and persisted
  geometry unrestricted. This is independent of canvas clipping.

All new tests use an isolated server; no live publisher is contacted. This is a
backend update (metadata schema and composition), so the 0.8.1 frontend hot-copy
procedure must not be used for 0.9.0. Deploy a complete image during idle time.


## 0.9.1 — closing navigation intercepted an editor handle

Actions attempt 2 passed 119/120 cases but failed the 430px portrait east handle
because elementFromPoint did not return the grip. A controlled 2-second drawer
transition reproduced it locally and identified `<aside class="sidebar">` at
that exact point. The drawer had lost `menu-open`, but still occupied part of
the viewport while its `right` transition completed and retained pointer events.

The dismissed mobile drawer now immediately uses pointer-events:none. Opening
it restores normal pointer behavior; its animation and desktop navigation stay
intact. The new browser regression performs a real touch drag while the closing
animation is still visible, so a timing delay cannot hide the regression.
The earlier Actions attempt 1 failed separately on a cold Chrome process launch
timeout; no handle-position assertion failed in that attempt.
