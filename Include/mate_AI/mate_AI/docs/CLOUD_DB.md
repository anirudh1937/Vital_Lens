# Cloud Push + Multi-DB Execute

Mate AI now supports:
- Pushing app data to AWS S3
- Executing SQL across Postgres, MySQL, and SQLite
- Multi-user quotas (free-tier limits by user)

## 1) Install new dependencies

```bat
cd /d f:\mate_AI
npm install
```

## 2) Configure AWS S3

Edit `data/aws_s3.json`:

```json
{
  "region": "us-east-1",
  "bucket": "YOUR_BUCKET_NAME",
  "prefix": "mate-ai",
  "accessKeyId": "YOUR_AWS_ACCESS_KEY_ID",
  "secretAccessKey": "YOUR_AWS_SECRET_ACCESS_KEY"
}
```

Push default data files:

```bat
npm run cloud:push
```

Push custom files:

```bat
npm run cloud:push -- data/chats.json data/rag_store.json
```

Quota data file is also included by default:
- `data/user_quota.json`

## 3) Configure DB connections

Edit `data/db_connections.json` and keep only the engines you need.

## 4) Run SQL from CMD

Read-only query example:

```bat
npm run db:exec -- postgres main "SELECT NOW();"
```

Other engines:

```bat
npm run db:exec -- mysql main "SELECT NOW();"
npm run db:exec -- sqlite local "SELECT name FROM sqlite_master;"
```

## 5) API endpoints (server mode)

- `GET /api/cloud/status`
- `POST /api/cloud/push`
- `GET /api/db/engines`
- `POST /api/db/execute`
- `GET /api/admin/users`
- `POST /api/admin/users/upsert`
- `GET /api/admin/quota/summary?userId=...`
- `POST /api/admin/quota/reset`

`/api/db/execute` is read-only by default. Send `allowWrite: true` only when needed.

## 6) Multi-user quota behavior

User identity is derived from request data (priority order):
1. `x-user-id` header
2. `x-user-email` header
3. `userId` in body/query
4. fallback: `guest`

Chat and chat history routes are now user-scoped by this identity.
`POST /api/chat` enforces monthly limits from `data/user_quota.json`.

Default free limits:
- `monthlyTokenLimit`: `100000`
- `monthlyMessageLimit`: `300`
