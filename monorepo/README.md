# AWS 11 - Rekognition Tagging

This version builds on the microfrontend architecture from version 10 and adds image tagging powered by Amazon Rekognition.

## What changed in this version

- `services/photos-service` adds an `image_tags` table and tag persistence endpoints.
- The photos service can request label suggestions from Amazon Rekognition.
- The gallery route app adds an image tag editing route.
- Gallery search includes saved tags.
- Shared frontend API types include photo tags and tag suggestion responses.

The service ownership, CDK placement, one-stack-per-service layout, realtime likes service, and microfrontend architecture are already present in earlier versions.

## Deployable units

- `apps/shell`
- `apps/gallery`
- `apps/analytics`
- `services/cognito-service`
- `services/photos-service`
- `services/historic-likes-service`
- `services/realtime-likes-service`

Deploy the full version:

```bash
pnpm run deploy-everything
pnpm run generate-env
```

Run the local frontend:

```bash
pnpm install
pnpm run type-check
pnpm run dev
```

## Tagging flow

1. A user opens a gallery image tag route.
2. The gallery app loads the photo through `@frontend/api-client`.
3. The photos service persists manual tags in RDS.
4. The photos service can call Rekognition `DetectLabels` to suggest tags for an image.
5. Saved tags are returned with photo data and become searchable in the gallery.

## Structure

```text
apps/shell/cdk
apps/gallery
apps/analytics
packages/frontend/api-client
packages/frontend/auth
packages/frontend/ui
packages/frontend/tailwind-config
packages/frontend/tokens
packages/backend/events
services/cognito-service/cdk
services/photos-service/cdk
services/historic-likes-service/cdk
services/realtime-likes-service/cdk
scripts
```

