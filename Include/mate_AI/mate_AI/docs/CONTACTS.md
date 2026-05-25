# Google Account + Profile Media

Mate AI now supports:
- Connecting a Google account (Gmail)
- Syncing Google profile data (name/email/photo)
- Uploading your own profile picture from local media

## 1) Configure OAuth Once

Edit `data/google_oauth.json` and set real values:

```json
{
  "client_id": "YOUR_GOOGLE_CLIENT_ID",
  "client_secret": "YOUR_GOOGLE_CLIENT_SECRET",
  "redirect_uri": "http://localhost:3000/api/google/oauth/callback"
}
```

## 2) Google Cloud Setup

1. Go to Google Cloud Console.
2. Enable **People API**.
3. Create OAuth Client ID (`Web application`).
4. Add authorized redirect URI:
   - `http://localhost:3000/api/google/oauth/callback`
5. Copy client ID and secret into `data/google_oauth.json`.

## 3) Run Mate AI

```bat
cd /d f:\mate_AI
run-server.cmd
```

## 4) Use Profile in App

1. Open `http://localhost:3000`
2. Click the user/profile icon in the header.
3. Click **Connect Gmail**.
4. Approve access.
5. Click **Sync Profile** when needed.
6. Use **Upload from Media** to set your own profile image.
