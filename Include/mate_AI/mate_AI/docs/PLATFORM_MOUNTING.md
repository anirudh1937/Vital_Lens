# Mate AI Platform Mounting (v1)

Mate AI can now be mounted into another product through versioned platform APIs.

## 1) Discover capabilities

- `GET /api/platform/v1/capabilities`

Returns available platform endpoints and enabled features.

## 2) Create a mount session

- `POST /api/platform/v1/sessions`
- Body example:

```json
{
  "productId": "my-product",
  "userId": "user_123",
  "workspaceId": "workspace_alpha",
  "scopes": ["chat.read", "chat.write"],
  "metadata": {
    "screen": "dashboard",
    "tenant": "acme"
  }
}
```

Response includes:
- `token` (send as `Authorization: Bearer <token>` or `x-mate-session-token`)
- `sessionId`
- `expiresAt`
- mount endpoints

## 3) Validate a session

- `GET /api/platform/v1/sessions/validate`
- Headers:
  - `Authorization: Bearer <token>`

## 4) Send chat through platform adapter

- `POST /api/platform/v1/chat`
- Headers:
  - `Authorization: Bearer <token>`
  - `Content-Type: application/json`
- Body:

```json
{
  "message": "Summarize my last discussion",
  "chatId": "",
  "responseMode": "default",
  "attachments": []
}
```

This forwards to existing Mate chat logic while preserving `userId` from the mount session.

## Notes

- Session tokens are in-memory and expire automatically.
- Default TTL is 12 hours (override with `PLATFORM_SESSION_TTL_MS`).
- Current implementation is a safe first step for embedding and will support persistent platform keys next.
