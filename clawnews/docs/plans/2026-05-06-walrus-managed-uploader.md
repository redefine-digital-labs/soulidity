# Walrus Managed Uploader: DigitalOcean Production Endpoint

## Spec
- Browser keeps plaintext custody: `soul.md`, `memory.md`, and other source files are read and Seal-encrypted locally before upload.
- Browser no longer sends Walrus encoded slivers through Vercel by default. The default transport is `managed`; `browser` remains the emergency rollback and `server` remains legacy test-only.
- Production Web points managed uploads at `https://uploader.soulidity.ai`.
- The only supported managed uploader deployment is a DigitalOcean Node/Docker service using filesystem staging at `/data/walrus-uploader`.
- Token auth is wallet-scoped, network-scoped, short-lived, and budgeted by file count and encrypted byte limit. The uploader token secret is server-only and exists only in Vercel server env plus DigitalOcean uploader env.
- The wallet flow stays at about two confirmations for multi-file create-soul: one Walrus register transaction, then the final mint/certify PTB. Each logical content file keeps its own `blobId` and `blobObjectId`.

## Runtime Contract
- Web route: `POST /api/walrus/upload-token`
  - Requires the current Soulidity wallet identity.
  - Body: `walletAddress`, `fileCount`, `byteLimit`.
  - Returns a bearer token for the external uploader.
- Uploader route: `POST /v1/uploads`
  - Multipart fields: `walletAddress`, `network`, `payload`.
  - Returns `uploadId`, `blobId`, `rootHash`, and encrypted payload size.
- Uploader route: `POST /v1/uploads/:id/complete`
  - JSON body: `walletAddress`, `network`, `registerTxDigest`, `blobObjectId`.
  - Validates register sender/object/blobId, writes Walrus storage nodes, and returns a serialized certificate.
- Uploader route: `POST /v1/uploads/:id/finalize`
  - Called after mint/certify succeeds. Deletes staged encoded data and cached certificate.

## DigitalOcean Shape
- Owner: Soulidity infrastructure operator.
- Hostname: `uploader.soulidity.ai`.
- Host: DigitalOcean droplet.
- Process: Docker container or systemd-managed Node process built from `services/walrus-uploader`.
- Persistent data: bind mount `/data/walrus-uploader` into the container and set `UPLOAD_DATA_DIR=/data/walrus-uploader`.
- Edge: Caddy terminates TLS for `uploader.soulidity.ai` and proxies to `127.0.0.1:8080`.
- Production CORS must allow the current production aliases:
  - `https://www.soulidity.ai`
  - `https://soulidity.ai`
  - `https://clawnews-chi.vercel.app`
  - `https://clawnews-soulidity-ai.vercel.app`
  - `https://clawnews-git-master-soulidity-ai.vercel.app`
  - `https://clawnews-mu.vercel.app`

## Uploader Env
Use `services/walrus-uploader/digitalocean.env.example` as the template:

```sh
NEXT_PUBLIC_SUI_NETWORK=mainnet
PORT=8080
WALRUS_UPLOADER_TOKEN_SECRET=<same secret as Vercel>
UPLOAD_DATA_DIR=/data/walrus-uploader
UPLOAD_STAGE_TTL_MS=86400000
CORS_ORIGIN=https://www.soulidity.ai,https://soulidity.ai,https://clawnews-chi.vercel.app,https://clawnews-soulidity-ai.vercel.app,https://clawnews-git-master-soulidity-ai.vercel.app,https://clawnews-mu.vercel.app
SUI_FULLNODE_URL=<optional dedicated mainnet fullnode>
```

Do not set `STAGING_BACKEND` unless it is `filesystem`; non-filesystem staging is rejected at startup.

## Vercel Web Env
- `NEXT_PUBLIC_SUI_NETWORK=mainnet`
- `NEXT_PUBLIC_WALRUS_UPLOAD_TRANSPORT=managed`
- `NEXT_PUBLIC_WALRUS_UPLOADER_URL=https://uploader.soulidity.ai`
- `WALRUS_UPLOADER_TOKEN_SECRET=<same secret as DigitalOcean uploader>`
- Optional token budgets:
  - `WALRUS_UPLOADER_TOKEN_TTL_MS=600000`
  - `WALRUS_UPLOADER_TOKEN_MAX_FILES=64`
  - `WALRUS_UPLOADER_TOKEN_MAX_BYTES=536870912`

`WALRUS_UPLOADER_TOKEN_SECRET` must never be exposed through `NEXT_PUBLIC_*`.

## DigitalOcean Deploy
1. Build the uploader image from repo root:
   ```sh
   docker build -f services/walrus-uploader/Dockerfile -t soulidity/walrus-uploader:latest .
   ```
2. Ensure the persistent directory exists on the droplet:
   ```sh
   sudo mkdir -p /data/walrus-uploader
   sudo chown -R 1000:1000 /data/walrus-uploader
   ```
3. Run the container on the droplet:
   ```sh
   docker run -d --name walrus-uploader --restart unless-stopped \
     --env-file /etc/soulidity/walrus-uploader.env \
     -v /data/walrus-uploader:/data/walrus-uploader \
     -p 127.0.0.1:8080:8080 \
     soulidity/walrus-uploader:latest
   ```
4. Caddy routes `uploader.soulidity.ai` to `127.0.0.1:8080`.
5. Verify before using it from Web:
   ```sh
   curl -fsS https://uploader.soulidity.ai/health
   curl -fsSI -X OPTIONS https://uploader.soulidity.ai/v1/uploads/test \
     -H 'Origin: https://www.soulidity.ai' \
     -H 'Access-Control-Request-Method: POST' \
     -H 'Access-Control-Request-Headers: authorization,x-walrus-payload-bytes'
   ```

Expected health response: `{"ok":true}`. The preflight response must include the matching `Access-Control-Allow-Origin` for the request origin.

## Smoke Test
1. Run local verification before deploy:
   ```sh
   npm test
   npm --prefix web run build
   npm --prefix services/walrus-uploader run build
   ```
2. Deploy the DigitalOcean uploader and confirm `/health` plus CORS preflight are OK.
3. Deploy Vercel with the managed uploader env.
4. In a browser, create a Soul or collection with small files.
5. Network acceptance:
   - Browser shows `POST /api/walrus/upload-token`.
   - Browser sends multipart payloads to `https://uploader.soulidity.ai/v1/uploads`.
   - Browser sends small uploader `complete` requests with `registerTxDigest` and `blobObjectId`.
   - Browser does not send a large `/api/walrus/batch/complete` body.
6. Mint acceptance:
   - Register transaction happens once for the upload batch.
   - Final mint/certify succeeds.
   - Browser calls uploader `/finalize` after mint success.
   - The matching `/data/walrus-uploader/<uploadId>.json` staging files are deleted.
7. Retry acceptance:
   - Refresh/retry resumes from the existing register digest.
   - Retry does not register again and does not charge another Walrus storage fee for the same staged upload.

## Rollback
- Fast Web rollback: set `NEXT_PUBLIC_WALRUS_UPLOAD_TRANSPORT=browser` and redeploy Web.
- Uploader rollback: restart the previous Docker image on the DigitalOcean droplet with the same `/data/walrus-uploader` volume and env.
- Legacy diagnostic path: set `NEXT_PUBLIC_WALRUS_UPLOAD_TRANSPORT=server`, but do not use it for Vercel production uploads that may exceed request-body limits.
- When switching transport away from `managed`, remove both `NEXT_PUBLIC_WALRUS_UPLOADER_URL` and `WALRUS_UPLOADER_TOKEN_SECRET` from Vercel Production before syncing env.
