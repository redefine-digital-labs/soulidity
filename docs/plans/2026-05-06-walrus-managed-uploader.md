# Walrus Managed Uploader: Production Endpoint

## Spec
- Browser keeps plaintext custody: `soul.md`, `memory.md`, and other source files are read and Seal-encrypted locally before any network upload.
- Browser no longer sends Walrus encoded slivers through Vercel by default. The default transport is `managed`; `browser` remains the emergency rollback and `server` remains legacy test-only.
- Production Web always points managed uploads at `https://uploader.soulidity.ai`.
- The managed uploader accepts encrypted payload bytes, stages encoded Walrus data in GCS, validates the user-paid register transaction, writes storage nodes, returns certificates, and deletes staging after mint success.
- Token auth is wallet-scoped, network-scoped, short-lived, and budgeted by file count and encrypted byte limit. The uploader token secret is server-only and exists only in Vercel server env plus Cloud Run env.
- Google Cloud staging runs on Cloud Run with the existing Node/Docker uploader image and `STAGING_BACKEND=gcs`. Cloud Run local disk is not used as persistent staging.
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

## Google Cloud Deployment Shape
The uploader can still be deployed with the Cloud Run/GCS shape below, but the Web production env must use the managed domain, not a raw `run.app` URL.

1. Create or choose:
   - Google Cloud project: `<project-id>`
   - Region: `<region>`, for example `us-central1`
   - Cloud Run service: `walrus-uploader`
   - Artifact Registry repository: `clawnews`
   - GCS bucket: `<your bucket>`
   - Cloud Run service account: `walrus-uploader@<project-id>.iam.gserviceaccount.com`
2. Grant the service account bucket-level object access only on the staging bucket:
   ```sh
   gcloud storage buckets add-iam-policy-binding gs://<your bucket> \
     --member=serviceAccount:walrus-uploader@<project-id>.iam.gserviceaccount.com \
     --role=roles/storage.objectUser
   ```
   Required capability is object create/read/list/delete on this bucket. Use a custom bucket-level role with those object permissions if the project cannot grant `roles/storage.objectUser`.

## Cloud Run Deployment
1. Build and push the uploader image from repo root:
   ```sh
   gcloud builds submit \
     --config services/walrus-uploader/cloudbuild.yaml \
     --substitutions=_IMAGE=<region>-docker.pkg.dev/<project-id>/clawnews/walrus-uploader:staging \
     .
   ```
2. Copy `services/walrus-uploader/cloud-run.env.example` to a private local env file, fill the bucket and shared secret, then deploy:
   ```sh
   gcloud run deploy walrus-uploader \
     --image <region>-docker.pkg.dev/<project-id>/clawnews/walrus-uploader:staging \
     --region <region> \
     --service-account walrus-uploader@<project-id>.iam.gserviceaccount.com \
     --allow-unauthenticated \
     --timeout 20m \
     --env-vars-file <private-cloud-run-env.yaml>
   ```
3. Cloud Run env:
   - `NEXT_PUBLIC_SUI_NETWORK=mainnet`
   - `WALRUS_UPLOADER_TOKEN_SECRET=<same secret as Vercel>`
   - `STAGING_BACKEND=gcs`
   - `GCS_BUCKET=<your bucket>`
   - `GCS_PREFIX=walrus-uploader`
   - `UPLOAD_STAGE_TTL_MS=86400000`
   - `CORS_ORIGIN=https://www.soulidity.ai`
   - `SUI_FULLNODE_URL=<optional dedicated mainnet fullnode>`
4. Verify the raw Cloud Run service before wiring the managed domain:
   ```sh
   curl -fsS https://<cloud-run-service>.run.app/health
   ```
   Expected response: `{"ok":true}`.

## Vercel Web Env
- `NEXT_PUBLIC_SUI_NETWORK=mainnet`
- `NEXT_PUBLIC_WALRUS_UPLOAD_TRANSPORT=managed`
- `NEXT_PUBLIC_WALRUS_UPLOADER_URL=https://uploader.soulidity.ai`
- `WALRUS_UPLOADER_TOKEN_SECRET=<same secret as Cloud Run>`
- Optional token budgets:
  - `WALRUS_UPLOADER_TOKEN_TTL_MS=300000`
  - `WALRUS_UPLOADER_TOKEN_MAX_FILES=64`
  - `WALRUS_UPLOADER_TOKEN_MAX_BYTES=536870912`

`WALRUS_UPLOADER_TOKEN_SECRET` must never be exposed through `NEXT_PUBLIC_*`.

## Smoke Test
1. Run local verification before deploy:
   ```sh
   npm test
   npm --prefix web run build
   npm --prefix services/walrus-uploader run build
   npm --prefix services/walrus-uploader audit --json
   ```
2. Deploy Cloud Run and confirm `/health` is OK.
3. Deploy Vercel with the managed uploader env:
   - `NEXT_PUBLIC_WALRUS_UPLOAD_TRANSPORT=managed`
   - `NEXT_PUBLIC_WALRUS_UPLOADER_URL=https://uploader.soulidity.ai`
   - `WALRUS_UPLOADER_TOKEN_SECRET=<same secret>`
4. In a browser, create a Soul with three files under 10KB.
5. Network acceptance:
   - Browser shows `POST /api/walrus/upload-token`.
   - Browser sends multipart payloads to the Cloud Run uploader.
   - Browser sends small uploader `complete` requests with `registerTxDigest` and `blobObjectId`.
   - Browser does not send a large `/api/walrus/batch/complete` body.
6. Mint acceptance:
   - Register transaction happens once for the upload batch.
   - Final mint/certify succeeds.
   - Browser calls uploader `/finalize` after mint success.
   - The matching `gs://<your bucket>/walrus-uploader/<uploadId>.json` staging objects are deleted.
7. Retry acceptance:
   - Refresh/retry resumes from the existing register digest.
   - Retry does not register again and does not charge another Walrus storage fee for the same staged upload.

## Rollback
- Fast rollback: set `NEXT_PUBLIC_WALRUS_UPLOAD_TRANSPORT=browser` and redeploy Web.
- Legacy diagnostic path: set `NEXT_PUBLIC_WALRUS_UPLOAD_TRANSPORT=server`, but do not use it for Vercel production uploads that may exceed request-body limits.
- When switching transport away from `managed`, remove both `NEXT_PUBLIC_WALRUS_UPLOADER_URL` and `WALRUS_UPLOADER_TOKEN_SECRET` from Vercel Production before syncing env.

## References
- Cloud Run deploy from source or image: https://cloud.google.com/run/docs/deploying
- Cloud Run service env vars: https://cloud.google.com/run/docs/configuring/services/environment-variables
- Cloud Run request timeout: https://cloud.google.com/run/docs/configuring/request-timeout
- Cloud Run quotas and request/response limits: https://cloud.google.com/run/quotas
- Cloud Storage IAM roles: https://cloud.google.com/storage/docs/access-control/iam-roles
