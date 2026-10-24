# Telegram Serverless control plane for StreamCore

Telegram Serverless uses V8 isolates for bot handlers, database-backed logic,
outbound HTTP and Mini App hosting. It **cannot** run continuous FFmpeg, Docker,
OBS or MediaMTX. StreamCore must still run on a separate media-capable VPS.

## Architecture

- Telegram Mini App and owner-only bot commands -> Telegram Serverless endpoints.
- Serverless private database stores the StreamCore URL and a scoped Bridge token.
- Serverless backend sends HTTPS requests to StreamCore's opt-in /api/cloud/*.
- StreamCore supervises FFmpeg + MediaMTX and publishes to Telegram RTMP.

Neither Stream Keys nor StreamCore administrator credentials are transferred to
Telegram. Bridge endpoints offer only redacted status and channel start/stop.

## Enable bridge on the StreamCore VPS

Generate a unique secret locally (NEVER paste into chats, screenshots or GitHub):

```bash
openssl rand -hex 32
```

Set the resulting value privately in /opt/streamcore/.env:

```dotenv
STREAMCORE_CLOUD_API_TOKEN=<64_hex_characters>
```

After this branch is reviewed and merged, during a maintenance window:

```bash
cd /opt/streamcore
git pull --ff-only
docker compose up -d --build dashboard
```

The bridge defaults to disabled if no valid 64-hex value is configured. An
unauthenticated GET https://YOUR_DOMAIN/api/cloud/overview must return HTTP 401
when enabled, or 404 when disabled. A valid token in the Authorization header
unlocks only this small API. StreamCore must serve HTTPS via its normal Caddy.

## Deploy Telegram Serverless (CLI v0.2 or newer)

**DO NOT blindly deploy over an existing BlueVPN Deploy bot.** The CLI's push
synchronizes *all* handlers, endpoints and libraries; missing cloud modules can
be deleted. Back up and merge with your existing bot code first:

```bash
cd telegram-serverless
npm install
npm test
npx tgcloud login
npx tgcloud fetch
npx tgcloud diff
# Inspect/migrate existing modules locally before pushing anything.
npx tgcloud push
npx tgcloud migrate
```

Use the CLI Access token from BotFather > bot > Serverless > CLI Access. It is
not the ordinary Bot API token; keep it off GitHub. Store local CLI state only
inside ignored .tgcloud/.

Before deploying, edit tgcloud/lib/config.js and replace OWNER_USER_ID=0 with
your own Telegram numeric account ID. Until set, privileged actions are locked.
You can obtain the ID by sending /id when the test handler is safely deployed.

After deploying the frontend, Telegram prints a Mini App URL like
https://app<app_id>.tgcloud.ai/. Register that exact URL in @BotFather for your
bot's Mini App. Open it using the owner account and paste your StreamCore HTTPS
URL and private Bridge token into the configuration form. The secret is retained
in Telegram Serverless's private database, **not in browser local storage**.

The initial saved status may be disconnected until the migration has run.
Test Refresh, Start/Stop, and verify actual video playback in Telegram:
a successful control command does not prove the platform received frames.

## Hardening and limitations

- Owner checks use verified Telegram Mini App init data or Bot API update sender.
- No direct frontend-to-VPS API credential access is allowed.
- Keep the Telegram Serverless database and deployment privileges private.
- Token rotation requires changing both the StreamCore env and Mini App settings.
- Serverless SDK import syntax uses only sdk and relative .js modules.
- Review provider bandwidth and CPU limits for always-on encoding.
- This integration does not change the existing separate low-resource VPS PR.

References:
- https://core.telegram.org/bots/serverless
- https://core.telegram.org/bots/webapps
