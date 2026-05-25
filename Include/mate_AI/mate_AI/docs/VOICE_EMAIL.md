# Voice Commands + Email (Local Admin)

Mate AI supports voice commands in the browser and server-side email sending through SMTP.

## 1) Configure SMTP once

Edit `data/smtp.json`:

```json
{
  "host": "smtp.gmail.com",
  "port": 587,
  "secure": false,
  "user": "YOUR_SMTP_USER",
  "pass": "YOUR_SMTP_PASS_OR_APP_PASSWORD",
  "from": "Mate AI <your-email@example.com>"
}
```

## 2) Install dependency

```bat
cd /d f:\mate_AI
npm install nodemailer
```

## 3) Run server

```bat
cd /d f:\mate_AI
run-server.cmd
```

## 4) Voice command format for email

Click the mic button and say:

`send email to someone@example.com subject Hello message This is a test mail from Mate AI`

For all other voice speech, Mate AI sends your transcribed text as a normal chat prompt.
