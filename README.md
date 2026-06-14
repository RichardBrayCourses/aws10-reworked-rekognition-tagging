# AWS 10 - Rekognition Tagging

## Introduction

With one click, the application can ask AWS AI to analyse a photo, recognise what is in it, and generate searchable tags. Users can save the full set of suggested tags with `Update tags`, or refine the list first so only the most useful labels become part of the gallery.

AWS 10 keeps the professional microfrontend architecture from AWS 09 and adds the first AWS AI service in the application: Amazon Rekognition. The gallery now supports image tags, tag-aware search, a dedicated tag editing page, and an AI-assisted workflow where Rekognition can inspect an uploaded image and suggest useful labels.

The important detail is that this is not "AI writes to the database and everyone hopes for the best". Manual tagging remains the curated source of truth. A signed-in user can add, remove, review, and save tags for each photo. Rekognition is used as a helpful suggestion engine: the user asks for AI tags, the photos service calls Rekognition `DetectLabels`, the UI merges the suggestions into the editable tag list, and nothing is persisted until the user chooses `Update tags`.

Tagging belongs to the photos service because the photos service already owns image metadata, the S3 image bucket, current likes, and the gallery-facing API. This release extends that ownership with a new PostgreSQL `image_tags` table, new authenticated tag endpoints, an AWS SDK integration for Rekognition, and an IAM permission for `rekognition:DetectLabels`. The other backend services continue to do their existing jobs: historic likes stores long-running analytics, the Python realtime likes service keeps short rolling buckets in Valkey (Redis-compatible cache), and Cognito remains responsible for authentication.

On the frontend, the route-based microfrontend model stays intact. The gallery app owns the new `/gallery/images/:imageId/tags` route and the tag editing experience. The shared frontend API client learns about saved tags and AI tag suggestions, while shell and analytics remain independently deployable route apps served through CloudFront path routing.

## Mermaid Diagram

```mermaid
%%{init: {"themeVariables": {"lineColor": "#ff1744", "edgeLabelBackground": "#334155"}, "themeCSS": ".edgeLabel rect { fill: #334155 !important; opacity: 1 !important; } .edgeLabel text, .edgeLabel span { fill: #f8fafc !important; color: #f8fafc !important; }"}}%%
flowchart LR
  browser[Browser UI]

  subgraph Frontend["<b>Frontend route apps</b>"]
    cloudfront[CloudFront distribution<br/>path routing and SPA rewrites]
    shell["Shell app<br/>apps/shell<br/>/, /profile, /auth/callback"]
    gallery["Gallery app<br/>apps/gallery<br/>/gallery, /gallery/upload, /gallery/images/:imageId/tags"]
    analytics["Analytics app<br/>apps/analytics<br/>/analytics, /analytics/images/:imageId"]
    frontendPackages["packages/frontend<br/>api-client, auth, tokens, ui, tailwind-config"]
  end

  subgraph ShellOwner["<b>Shell owner</b><br/>apps/shell"]
    shellCdk[Website CDK]
    shellEnv[env generation]
  end

  subgraph PhotosService["<b>Photos service owner</b><br/>services/photos-service"]
    photosCdk[Photos service CDK]
    photosApi[API Gateway + Express Lambda]
    postgres["PostgreSQL<br/>users, images, current likes, curated tags"]
    imageTags["image_tags<br/>manual curated tag rows"]
    images[S3 image storage + image CloudFront]
    rekognition["Amazon Rekognition<br/>DetectLabels"]
    tagSuggestions["tagSuggestions service<br/>normalise, dedupe, cap labels"]
    signupConsumer[cognitoSignupConsumer]
    simulator[Simulator tick and reset endpoints]
  end

  subgraph PhotosEvents["<b>Photos event delivery</b>"]
    photosBus[PhotosEventBus]
    likesTopic[SNS LikesEventsTopic]
    historicQueue[SQS HistoricLikesQueue]
    realtimeQueue[SQS RealtimeLikesQueue]
  end

  subgraph CognitoService["<b>Cognito service owner</b><br/>services/cognito-service"]
    cognitoCdk[Cognito CDK]
    cognitoTrigger[Post-confirmation Lambda]
    cognitoBus[CognitoEventBus]
    userPool[Cognito user pool]
  end

  subgraph HistoricService["<b>Historic likes owner</b><br/>services/historic-likes-service"]
    historicCdk[Historic likes CDK]
    userProjection[User projection consumer]
    imageProjection[Image projection consumer]
    historicLikesConsumer[Like and reset consumer]
    historicApi[Public REST API + Lambda]
    dynamo[DynamoDB projections and historic like buckets]
  end

  subgraph RealtimeService["<b>Realtime likes owner</b><br/>services/realtime-likes-service"]
    realtimeCdk[Realtime likes CDK]
    realtimeLikesConsumer[Python like and reset consumer]
    realtimePushConsumer[Python push consumer]
    realtimeApi[Public REST API + Lambda]
    websocketConnect[WebSocket connect Lambda]
    websocketDisconnect[WebSocket disconnect Lambda]
    websocketApi[API Gateway WebSocket API]
    websocketConnections[DynamoDB connection IDs]
    valkey["Valkey (Redis-compatible cache)<br/>realtime circular buckets"]
  end

  subgraph BackendPackages["<b>Backend packages</b>"]
    backendEvents["packages/backend/events<br/>event contracts"]
  end

  subgraph Terminal["<b>Terminal-started simulator</b>"]
    terminal[simulator:start]
  end

  browser --> cloudfront
  cloudfront -- / --> shell
  cloudfront -- /gallery --> gallery
  cloudfront -- /analytics --> analytics

  shell --> frontendPackages
  gallery --> frontendPackages
  analytics --> frontendPackages
  shell --> userPool
  gallery --> userPool

  gallery --> photosApi
  gallery -- Get AI tags --> photosApi
  gallery -- Update tags --> photosApi
  analytics --> photosApi
  analytics --> historicApi
  analytics --> realtimeApi
  analytics <-->|WebSocket| websocketApi

  shellCdk -. deploys .-> cloudfront
  shellCdk -. deploys .-> shell
  shellEnv -. writes Vite env .-> shell
  shellEnv -. writes Vite env .-> gallery
  shellEnv -. writes Vite env .-> analytics
  photosCdk -. deploys .-> photosApi
  cognitoCdk -. deploys .-> userPool
  historicCdk -. deploys .-> historicApi
  realtimeCdk -. deploys .-> realtimeApi
  realtimeCdk -. deploys .-> websocketApi

  photosApi --> postgres
  postgres --> imageTags
  photosApi --> images
  photosApi --> tagSuggestions --> rekognition
  rekognition -. reads selected object .-> images
  photosApi -- user and image events --> photosBus
  photosBus --> userProjection --> dynamo
  photosBus --> imageProjection --> dynamo

  cognitoTrigger -- user.created --> cognitoBus
  cognitoBus --> signupConsumer --> postgres

  photosApi -- like.created / like.deleted / likes.deleted.all --> likesTopic
  likesTopic --> historicQueue --> historicLikesConsumer --> dynamo
  likesTopic --> realtimeQueue --> realtimeLikesConsumer --> valkey
  likesTopic --> realtimePushConsumer --> websocketApi

  websocketApi --> websocketConnect --> websocketConnections
  websocketApi --> websocketDisconnect --> websocketConnections
  realtimePushConsumer --> websocketConnections

  historicApi --> dynamo
  realtimeApi --> valkey
  terminal --> simulator --> photosApi

  photosApi -. uses .-> backendEvents
  historicLikesConsumer -. uses .-> backendEvents

  classDef uiClass fill:#e8f3ff,stroke:#2563eb,color:#0f172a
  classDef photosClass fill:#fff4d6,stroke:#d97706,color:#0f172a
  classDef taggingClass fill:#ffedd5,stroke:#ea580c,color:#0f172a
  classDef eventsClass fill:#f3e8ff,stroke:#7c3aed,color:#0f172a
  classDef historicClass fill:#dcfce7,stroke:#16a34a,color:#0f172a
  classDef realtimeClass fill:#fef3c7,stroke:#ca8a04,color:#0f172a
  classDef cognitoClass fill:#e0f2fe,stroke:#0284c7,color:#0f172a
  classDef simClass fill:#ffe4e6,stroke:#e11d48,color:#0f172a
  classDef cdkClass fill:#f8fafc,stroke:#64748b,color:#0f172a
  classDef packageClass fill:#f1f5f9,stroke:#475569,color:#0f172a
  class browser,cloudfront,shell,gallery,analytics,frontendPackages uiClass
  class photosApi,postgres,images,signupConsumer,simulator photosClass
  class imageTags,rekognition,tagSuggestions taggingClass
  class photosBus,likesTopic,historicQueue,realtimeQueue eventsClass
  class userProjection,imageProjection,historicLikesConsumer,historicApi,dynamo historicClass
  class realtimeLikesConsumer,realtimePushConsumer,realtimeApi,websocketConnect,websocketDisconnect,websocketApi,websocketConnections,valkey realtimeClass
  class cognitoTrigger,cognitoBus,userPool cognitoClass
  class terminal simClass
  class shellCdk,shellEnv,photosCdk,cognitoCdk,historicCdk,realtimeCdk cdkClass
  class backendEvents packageClass

  style Frontend fill:#eff6ff,stroke:#2563eb,color:#0f172a
  style ShellOwner fill:#f8fafc,stroke:#64748b,color:#0f172a
  style PhotosService fill:#fff9e8,stroke:#d97706,color:#0f172a
  style PhotosEvents fill:#faf5ff,stroke:#7c3aed,color:#0f172a
  style HistoricService fill:#f0fdf4,stroke:#16a34a,color:#0f172a
  style RealtimeService fill:#fffbeb,stroke:#ca8a04,color:#0f172a
  style CognitoService fill:#f0f9ff,stroke:#0284c7,color:#0f172a
  style BackendPackages fill:#f8fafc,stroke:#475569,color:#0f172a
  style Terminal fill:#fff1f2,stroke:#e11d48,color:#0f172a
```

## Release Notes

- **Amazon Rekognition arrives as the first AWS AI service.** The photos service now uses `@aws-sdk/client-rekognition` and calls Rekognition `DetectLabels` against the image object stored in S3. This gives the project its first real AWS AI integration while keeping the implementation close to the photo data it describes.
- **AI tags are suggestions, not automatic writes.** The `POST /auth/photos/{imageId}/tag-suggestions` endpoint returns suggested tags and a `source` value of either `rekognition` or `fixture`. The browser can add those suggestions to the editable list, but the database is only changed when the user explicitly saves.
- **Manual curated tagging is fully supported.** The gallery app adds `/gallery/images/:imageId/tags`, where signed-in users can add their own tags, remove unwanted tags, review AI suggestions, and save the final curated set.
- **Tags are persisted in PostgreSQL.** The photos service adds the `image_tags` table with one row per image/tag pair, a primary key across `(image_id, tag)`, and a lower-case tag index for search. Tags are normalised, deduplicated, capped at 40 tags per photo, and limited to 40 characters each.
- **Gallery search now understands tags.** Photo listings search across title, description, author nickname, and saved tags. A search for `landscape`, `portrait`, or `city` can now find matching photos even when those words are not in the original title.
- **The photos API grows two authenticated tag routes.** `PUT /auth/photos/{imageId}/tags` replaces the saved curated tag list, while `POST /auth/photos/{imageId}/tag-suggestions` asks Rekognition for AI suggestions without saving them.
- **The gallery app owns the tag editing workflow.** The gallery route app now displays edit-tag actions from the gallery, loads the selected photo, shows existing tags, calls the AI suggestion endpoint, and persists the reviewed tags through the shared API client.
- **Fixture mode keeps demos friendly.** Setting `PHOTOS_TAG_SUGGESTION_MODE=fixture` returns deterministic local suggestions from the photo title, description, and a small vocabulary. That is useful when demonstrating the UI without relying on Rekognition calls.
- **Photos service CDK now grants AI permissions.** The photos Lambda receives `rekognition:DetectLabels` permission and already has S3 read access to the uploaded image bucket, so the AI call can analyse the stored object directly.
- **The AWS 09 microfrontend model stays in place.** Shell, gallery, and analytics are still independently built and deployed route apps behind CloudFront path routing. AWS 10 adds tagging to the gallery without collapsing the frontend back into one large app.

## How To Run

Most day-to-day work starts in the `monorepo` folder. The root scripts are thin wrappers around service-owned scripts, so you can either run the whole stack or step into one owner when you want to inspect something more closely.

**Install and local checks**

```bash
cd monorepo
pnpm install
pnpm run generate-env
pnpm run dev              # shell on :5173, gallery on :5174, analytics on :5175
pnpm run type-check
pnpm run build
```

**Deploy the backend services**

```bash
pnpm run bootstrap-up
pnpm run cognito-service:deploy
pnpm run photos-service:deploy
pnpm run historic-likes-service:deploy
pnpm run realtime-likes-service:deploy
```

**Deploy the UI**

```bash
pnpm run shell:deploy
pnpm run gallery:deploy
pnpm run analytics:deploy
pnpm run ui:url
```

**Deploy everything in the expected order**

```bash
pnpm run deploy-everything
```

**Seed, reset, and simulate activity**

```bash
pnpm run data:seed          # upload starter images and publish image events
pnpm run simulator:start    # create like/unlike traffic from terminal users
pnpm -C services/photos-service run simulator:latest
pnpm run data:reset         # clear photos data, historic projections, and Cognito test users
```

**Useful service tests**

```bash
pnpm -C services/photos-service run test:security
pnpm -C services/historic-likes-service run test:public-api
pnpm -C services/realtime-likes-service run test:public-api
```

**Tear down**

```bash
pnpm run destroy-everything
pnpm run bootstrap-down
```

## Microservices

### Cognito Service

#### Service Overview

The Cognito service owns sign-up, sign-in, hosted UI configuration, and the post-confirmation event that tells the rest of the system a user exists. It keeps authentication separate from the photo database while still letting app users appear in the gallery experience.

#### Commands

```bash
pnpm run cognito-service:deploy
pnpm -C services/cognito-service run data:reset
pnpm run cognito-service:destroy
```

#### Endpoints

Cognito is reached through its hosted UI and OAuth endpoints rather than the application REST APIs. A realistic deployed domain looks like:

```text
http://uptick-auth-a1b2c3d4.auth.eu-west-1.amazoncognito.com/login
http://uptick-auth-a1b2c3d4.auth.eu-west-1.amazoncognito.com/logout
http://uptick-auth-a1b2c3d4.auth.eu-west-1.amazoncognito.com/oauth2/token
```

#### Event Queues

**CognitoEventBus**

Subscribers: `photos-service` through `CognitoSignupQueue`.

Messages:

```text
user.created
```

#### Databases And Caches

Cognito owns the user pool. The photos service stores an app-facing user row after it receives the signup event.

#### SSM Parameters And Secrets

```text
/cognito/domain
/cognito/client-id
/cognito/user-pool-id
/cognito/events/event-bus-name
```

### Photos Service

#### Service Overview

The photos service owns the photo catalogue, image uploads, current like state, simulator endpoints, curated image tags, and Rekognition tag suggestions. It is the main user-facing backend for the gallery app, and in AWS 10 it becomes the natural home for tagging because it already owns both the image metadata and the S3 object keys that Rekognition needs.

The manual tagging flow and the AI tagging flow are deliberately separate. `PUT /auth/photos/{imageId}/tags` saves the reviewed curated tags into PostgreSQL. `POST /auth/photos/{imageId}/tag-suggestions` asks Rekognition for suggested labels and returns them to the browser without changing the saved tag list. That keeps the AI service useful without letting it silently rewrite user-maintained metadata.

#### Commands

```bash
pnpm run photos-service:deploy
pnpm -C services/photos-service run database:migrate
pnpm -C services/photos-service run database:reset
pnpm -C services/photos-service run data:seed
pnpm -C services/photos-service run data:reset
pnpm -C services/photos-service run simulator:start
pnpm -C services/photos-service run test:security
pnpm run photos-service:destroy
```

#### Endpoints

```text
http://photos-api-a1b2c3d4.execute-api.eu-west-1.amazonaws.com/public/health
http://photos-api-a1b2c3d4.execute-api.eu-west-1.amazonaws.com/public/gallery-photos
http://photos-api-a1b2c3d4.execute-api.eu-west-1.amazonaws.com/public/images/{imageId}
http://photos-api-a1b2c3d4.execute-api.eu-west-1.amazonaws.com/auth/photos/gallery
http://photos-api-a1b2c3d4.execute-api.eu-west-1.amazonaws.com/auth/photos/presigned-url
http://photos-api-a1b2c3d4.execute-api.eu-west-1.amazonaws.com/auth/photos/{imageId}/like
http://photos-api-a1b2c3d4.execute-api.eu-west-1.amazonaws.com/auth/photos/{imageId}/tags
http://photos-api-a1b2c3d4.execute-api.eu-west-1.amazonaws.com/auth/photos/{imageId}/tag-suggestions
http://photos-api-a1b2c3d4.execute-api.eu-west-1.amazonaws.com/auth/users/me
http://photos-api-a1b2c3d4.execute-api.eu-west-1.amazonaws.com/auth/users/me/nickname
http://photos-api-a1b2c3d4.execute-api.eu-west-1.amazonaws.com/auth/admin/member
http://photos-api-a1b2c3d4.execute-api.eu-west-1.amazonaws.com/auth/admin/photos
http://photos-api-a1b2c3d4.execute-api.eu-west-1.amazonaws.com/public/simulation/tick
http://photos-api-a1b2c3d4.execute-api.eu-west-1.amazonaws.com/public/simulation/likes
```

The `/auth/...` routes expect a signed-in user. The `/public/simulation/...` routes are for repeatable demos and use the simulator secret rather than a browser session.

#### Event Queues

**PhotosEventBus**

Subscribers: `historic-likes-service` user projection consumer and image projection consumer.

Messages:

```text
user.created
user.updated
user.deleted
image.created
image.updated
image.deleted
```

**LikesEventsTopic**

Subscribers: `historic-likes-service` through `HistoricLikesQueue`, `realtime-likes-service` through `RealtimeLikesQueue`, and the realtime push Lambda.

Messages:

```text
like.created
like.deleted
likes.deleted.all
```

**CognitoSignupQueue**

Owner: photos service. Subscriber: `cognitoSignupConsumer` inside the photos service.

Messages:

```text
user.created
```

#### Databases And Caches

```text
registered_user
images
image_likes
image_tags
```

PostgreSQL is the source of truth for app users, images, current likes, and curated tags. Image files live in S3 and are served through CloudFront. Rekognition reads the S3 object when suggestions are requested, but the AI labels only become saved application data if the user accepts and saves them through the gallery.

#### SSM Parameters And Secrets

```text
/services/photos-service/base-url
/photos/rds/secret-arn
/photos/images/bucket-name
/photos/images/distribution-url
/photos/events/event-bus-name
/photos/events/likes-topic-arn
/photos/cognito-signup/queue-url
/simulator/secret
```

Consumed parameters:

```text
/cognito/user-pool-id
/cognito/events/event-bus-name
```

### Historic Likes Service

#### Service Overview

The historic likes service turns photo, user, and like events into DynamoDB read models for longer-running analytics. The browser reads charts from this service instead of asking the photos database to perform reporting work.

#### Commands

```bash
pnpm run historic-likes-service:deploy
pnpm -C services/historic-likes-service run data:reset
pnpm -C services/historic-likes-service run test:public-api
pnpm run historic-likes-service:destroy
```

#### Endpoints

```text
http://historic-likes-api-e5f6g7h8.execute-api.eu-west-1.amazonaws.com/public/health
http://historic-likes-api-e5f6g7h8.execute-api.eu-west-1.amazonaws.com/public/photo-likes
http://historic-likes-api-e5f6g7h8.execute-api.eu-west-1.amazonaws.com/public/photo-likes?imageId={imageId}
http://historic-likes-api-e5f6g7h8.execute-api.eu-west-1.amazonaws.com/public/author-likes
http://historic-likes-api-e5f6g7h8.execute-api.eu-west-1.amazonaws.com/public/author-likes?authorUserId={userId}
```

#### Event Queues

**HistoricLikesQueue**

Owner: historic likes service. Publisher path: `photos-service` -> `LikesEventsTopic` -> `HistoricLikesQueue`.

Messages:

```text
like.created
like.deleted
likes.deleted.all
```

**Projection Queues**

Owner: historic likes service. Publisher path: `photos-service` -> `PhotosEventBus` -> projection consumers.

Messages:

```text
user.created
user.updated
user.deleted
image.created
image.updated
image.deleted
```

#### Databases And Caches

```text
HistoricLikesUsersTable
HistoricLikesImagesTable
HistoricPhotoBucketLikesTable
HistoricAuthorBucketLikesTable
```

The projection tables keep enough user and image context for analytics screens. The bucket tables hold accumulated like deltas by photo and by author.

#### SSM Parameters And Secrets

```text
/historic-likes/users-table-name
/historic-likes/images-table-name
/historic-likes/photo-bucket-likes-table-name
/historic-likes/author-bucket-likes-table-name
/historic-likes/queue-url
/services/historic-likes-service/base-url
```

Consumed parameters:

```text
/photos/events/event-bus-name
/photos/events/likes-topic-arn
```

### Realtime Likes Service

#### Service Overview

The realtime likes service is a Python Lambda service that keeps short, rolling like buckets in Valkey (Redis-compatible cache). It also stores WebSocket connection IDs so the analytics UI can refresh quickly when like events arrive.

#### Commands

```bash
pnpm run realtime-likes-service:deploy
pnpm -C services/realtime-likes-service run setup
pnpm -C services/realtime-likes-service run test:public-api
pnpm run realtime-likes-service:destroy
```

#### Endpoints

```text
http://realtime-likes-api-i9j0k1l2.execute-api.eu-west-1.amazonaws.com/public/health
http://realtime-likes-api-i9j0k1l2.execute-api.eu-west-1.amazonaws.com/public/realtime-likes?imageId={imageId}&authorUserId={userId}
http://realtime-likes-ws-m3n4o5p6.execute-api.eu-west-1.amazonaws.com/production
```

#### Event Queues

**RealtimeLikesQueue**

Owner: realtime likes service. Publisher path: `photos-service` -> `LikesEventsTopic` -> `RealtimeLikesQueue`.

Messages:

```text
like.created
like.deleted
likes.deleted.all
```

**Realtime Push Subscription**

Owner: realtime likes service. Publisher path: `photos-service` -> `LikesEventsTopic` -> push Lambda -> WebSocket API.

Messages:

```text
like.created
like.deleted
likes.deleted.all
```

#### Databases And Caches

```text
Valkey (Redis-compatible cache) realtime buckets
RealtimeWebSocketConnections DynamoDB table
```

Valkey (Redis-compatible cache) keeps circular 5-second buckets for images and authors. DynamoDB stores active WebSocket connection IDs.

#### SSM Parameters And Secrets

```text
/realtime-likes/queue-url
/services/realtime-likes-service/base-url
/services/realtime-likes-service/websocket-url
```

Consumed parameters:

```text
/photos/events/likes-topic-arn
```

## Microfrontend Apps

### Shell App

#### App Overview

The shell app owns `/`, `/profile`, `/auth/callback`, shared navigation, auth setup, and the CloudFront/S3 website infrastructure.

#### Commands

```bash
pnpm run shell:deploy
pnpm -C apps/shell run deploy:infra
pnpm -C apps/shell run generate-env
pnpm -C apps/shell run url
pnpm run shell:destroy
```

#### SSM Parameters Consumed

```text
/cognito/domain
/cognito/client-id
/cognito/user-pool-id
/services/photos-service/base-url
/services/historic-likes-service/base-url
/services/realtime-likes-service/base-url
/services/realtime-likes-service/websocket-url
```

#### SSM Parameters Stored

```text
/website/bucket-name
/website/distribution-id
/website/distribution-url
```

### Gallery App

#### App Overview

The gallery app owns `/gallery`, `/gallery/upload`, and `/gallery/images/:imageId/tags`. It handles browsing, tag-aware searching, uploading, liking, manual tag editing, AI tag suggestions, and links into analytics when a user wants more detail.

The new image tags page is intentionally hands-on. A signed-in user can type their own tags, remove tags they do not want, ask for AI suggestions from Rekognition, and then save the final curated set. The page treats AI as an assistant to the human workflow rather than a background process that changes photo metadata on its own.

#### Commands

```bash
pnpm run gallery:deploy
pnpm -C apps/gallery run generate-env
pnpm -C apps/gallery run build
pnpm -C apps/gallery run upload
pnpm -C apps/gallery run invalidate-cloudfront
```

#### SSM Parameters Consumed

```text
/website/bucket-name
/website/distribution-id
/services/photos-service/base-url
/cognito/client-id
/cognito/user-pool-id
```

### Analytics App

#### App Overview

The analytics app owns `/analytics` and `/analytics/images/:imageId`. It combines photo details, historic like buckets, realtime like buckets, and WebSocket refresh notifications.

#### Commands

```bash
pnpm run analytics:deploy
pnpm -C apps/analytics run generate-env
pnpm -C apps/analytics run build
pnpm -C apps/analytics run upload
pnpm -C apps/analytics run invalidate-cloudfront
```

#### SSM Parameters Consumed

```text
/website/bucket-name
/website/distribution-id
/services/photos-service/base-url
/services/historic-likes-service/base-url
/services/realtime-likes-service/base-url
/services/realtime-likes-service/websocket-url
```

## Troubleshooting

- If the UI has empty API URLs, run the relevant `generate-env` script after backend deployment.
- If sign-in works but the app cannot find the user profile, run `pnpm run data:seed` or sign up again so the Cognito signup event reaches the photos service.
- If analytics are empty after seeding, wait a few seconds for SQS/Lambda consumers, then run the public API test for the affected service.
- If a reset appears partial, run `pnpm run data:reset` from the root so photos, historic likes, and Cognito are cleared together.
- If CloudFormation says a stack already exists, destroy the owner stack from its package script and redeploy in dependency order.
- If realtime charts stay flat, check the `RealtimeLikesQueue`, the Valkey (Redis-compatible cache) connection settings, and the WebSocket URL written to SSM.
- If a direct refresh under `/gallery` or `/analytics` returns a 404, redeploy the shell infrastructure so the CloudFront function and SPA rewrites are current.
- If tag suggestions fail in Rekognition mode, check that the photos Lambda has `rekognition:DetectLabels`, the image still exists in the S3 bucket, and `IMAGES_BUCKET_NAME` is set.
- If you want to demo tagging without making Rekognition calls, set `PHOTOS_TAG_SUGGESTION_MODE=fixture` for deterministic suggestions based on the photo title and description.

## Interesting Code Snippets New To This Release

### Rekognition Is A Suggestion Source

```ts
const response = await rekognitionClient.send(
  new DetectLabelsCommand({
    Image: {
      S3Object: {
        Bucket: bucketName,
        Name: photo.uuid_filename,
      },
    },
    MaxLabels: 20,
    MinConfidence: 75,
  }),
);
```

The photos service asks Rekognition to inspect the object already stored in S3. The response is normalised into short lower-case tags before it is returned to the browser.

### Manual Tags And AI Suggestions Stay Separate

```ts
photoRoutes.post("/:imageId/tag-suggestions", getPhotoTagSuggestions);
photoRoutes.put("/:imageId/tags", updatePhotoTags);
```

One route gets AI suggestions; the other route saves the curated tag list. That split is small, but it makes the product behavior clear: Rekognition helps, the user decides.

### Tags Are Stored As Photo Metadata

```sql
CREATE TABLE image_tags (
  image_id INTEGER NOT NULL REFERENCES images(id) ON DELETE CASCADE,
  tag TEXT NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  PRIMARY KEY (image_id, tag)
);
```

Tags sit beside the photos service's existing image metadata in PostgreSQL. Deleting an image deletes its tags, and the `(image_id, tag)` key prevents duplicates.

### Gallery Search Includes Tags

```sql
OR EXISTS (
  SELECT 1
    FROM image_tags search_tags
   WHERE search_tags.image_id = i.id
     AND search_tags.tag ILIKE '%' || $1 || '%'
)
```

The gallery search box now finds saved tags as well as titles, descriptions, and author nicknames. That makes tagging immediately useful to the person browsing the gallery.

### The Gallery Keeps Review In The Loop

```ts
const response = await suggestImageTags(imageId);
setTags((currentTags) => {
  const mergedTags = new Set(currentTags);

  for (const tag of response.tags) {
    const normalized = normalizeTag(tag);
    if (normalized) mergedTags.add(normalized);
  }

  return Array.from(mergedTags);
});
```

The UI merges Rekognition suggestions into the editable tag list instead of saving them straight away. Users can remove anything odd, add their own words, and then choose `Update tags`.
