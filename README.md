# email-postmark-worker

A small, reusable [Cloudflare Worker](https://developers.cloudflare.com/workers/) that
receives a contact-form `POST` and sends the message as an email through
[Postmark](https://postmarkapp.com/). Everything project-specific (sender,
recipient, allowed origins) is configured via environment variables, so the same
code can back the contact form of any static site — just deploy another Worker
with different values.

## Endpoint

`POST /` with a JSON body:

```json
{
  "name": "Jane Doe",
  "email": "jane@example.com",
  "subject": "Hello",
  "message": "Nice site!",
  "website": ""
}
```

- `name`, `email`, `message` are required. `subject` is optional.
- `website` is a **honeypot** — leave it empty. Bots that fill it get a fake `200`.
- Responds `{ "ok": true }` on success, or `{ "ok": false, "error": "..." }`.

CORS is restricted to the origins in `ALLOWED_ORIGINS`.

## Configuration

| Variable          | Type   | Example                        | Notes                                   |
| ----------------- | ------ | ------------------------------ | --------------------------------------- |
| `POSTMARK_TOKEN`  | secret | —                              | Postmark **Server** API token           |
| `FROM_EMAIL`      | var    | `contact@finx.dev`             | Must be a verified Postmark sender       |
| `TO_EMAIL`        | var    | `you@gmail.com`                | Where messages land                      |
| `ALLOWED_ORIGINS` | var    | `https://finx.dev`             | Comma-separated allowlist for CORS       |
| `MESSAGE_STREAM`  | var    | `outbound`                     | Optional, defaults to `outbound`         |
| `SUBJECT_PREFIX`  | var    | `[finx.dev] `                  | Optional prefix added to the subject     |

The Postmark token is a **secret** and must never be committed or exposed to the
browser — that is the whole reason this Worker exists.

## Local development

```bash
npm install
cp .dev.vars.example .dev.vars   # fill in your values (git-ignored)
npm run dev
```

Then send a test request:

```bash
curl -X POST http://localhost:8787 \
  -H "Content-Type: application/json" \
  -H "Origin: http://localhost:3000" \
  -d '{"name":"Test","email":"test@example.com","subject":"Hi","message":"Hello"}'
```

## Deploy

### Option A — Cloudflare Git integration (no GitHub Actions)

1. Push this repo to GitHub.
2. Cloudflare dashboard → **Workers & Pages** → **Create** → **Connect to Git**,
   pick this repo. Build command `npm run deploy` (or leave default for Wrangler).
3. In the Worker's **Settings → Variables**, add the vars from the table above and
   add `POSTMARK_TOKEN` as an **encrypted** secret.
4. Every push to `main` redeploys automatically.

### Option B — CLI

```bash
npx wrangler secret put POSTMARK_TOKEN
npm run deploy
```

## Postmark setup

1. Verify a **Sender Signature** or your **domain** (`finx.dev`) in Postmark so
   `FROM_EMAIL` is allowed. Domain verification (DKIM + Return-Path) gives the best
   deliverability.
2. New Postmark accounts are in **pending/approval** mode and can initially only
   send to addresses on your verified domain — fine for testing.
