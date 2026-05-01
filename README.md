# MR OK Financial Services Website

## Run locally

1. Install dependencies:
   - `npm install`
2. Create env file:
   - Copy `.env.example` to `.env`
3. Start server:
   - `npm start`
4. Open:
   - `http://localhost:3000` (or your configured `PORT`)

## Backend features

- Express API with security middleware (`helmet`, `cors`)
- Rate limiting on `/api/*`
- Lead input validation using `zod`
- SQLite persistence at `data/leads.db`
- Optional forwarding to Google Sheets via `GOOGLE_SCRIPT_URL` in `.env`
- Optional SMTP email notifications for each new lead
- Optional **DSA Sathi** push: after each lead is saved locally, the server calls `POST /v1/leads` when `DSASATHI_API_KEY` is set (non-blocking; sync status is stored on the lead row)
- Consent-aware AI calling queue with lead scoring and appointment capture
- Admin leads dashboard with search, date filters, and CSV exports

## Production hardening checklist

- Do not commit `.env` to source control
- Use strong secrets for:
  - `ADMIN_PASSWORD`
  - `ADMIN_API_KEY`
  - `ADMIN_SESSION_SECRET` (minimum 32 characters)
  - `MAIL_PASS` (use Gmail app password if using Gmail SMTP)
- Set `NODE_ENV=production` in production
- Enable HTTPS and set `TRUST_PROXY=true` (or a hop count like `1`) if running behind a reverse proxy/load balancer
- Confirm email workflow:
  - submit a lead
  - check server logs for send success/failure

## Deployment readiness (recommended order)

1. Use a Node-capable host (Render, Railway, Fly, Azure App Service, VPS, etc.)
2. Keep `server.js` as entrypoint and run with `npm start`
3. Set production env values in host settings (not in Git):
   - `NODE_ENV=production`
   - `TRUST_PROXY=true`
   - `PUBLIC_SITE_URL=https://YOUR_DOMAIN`
   - `ADMIN_PASSWORD`, `ADMIN_API_KEY`, `ADMIN_SESSION_SECRET`
4. Ensure SQLite persistence:
   - small deployments: keep SQLite and attach a persistent volume/disk
   - scaling deployments: migrate to PostgreSQL/MySQL
5. Build CSS before release (`npm run build:css`) so `public/styles.css` is current
6. Enable HTTPS and custom domain, then verify:
   - `/health` returns success
   - lead form saves data
   - admin login and CSV exports work
7. Add uptime monitoring and periodic backups for `data/leads.db`

## API

### `POST /api/leads`

Request body:

```json
{
  "name": "Ramesh Singh",
  "loanType": "Home Loan",
  "loanAmount": "25 lacs",
  "city": "Gurugram",
  "state": "Delhi",
  "mobile": "+919217001304",
  "email": "user@example.com",
  "incomeRange": "10-15 LPA",
  "preferredCallbackTime": "2026-04-26T16:00:00+05:30",
  "source": "website",
  "consent": true,
  "consentTime": "2026-04-26T10:15:00+05:30"
}
```

Response includes `aiCall` decision:

- `queued: true` means lead entered AI call queue
- `queued: false` includes reason (e.g., no consent, out-of-state, cooldown)

### AI calling architecture (implemented)

Flow:

1. Lead submitted with consent metadata
2. Rules check: consent, state allowlist, valid phone, cooldown window
3. Scoring model assigns priority
4. Lead queued in `ai_call_jobs`
5. Background worker processes queued jobs and writes transcript/outcome
6. Appointment status/time stored on lead

Current provider modes:

- `AI_CALL_PROVIDER=mock` → built-in simulated call flow (for production-safe dry run)
- `AI_CALL_PROVIDER=twilio` → real outbound calls via Twilio Programmable Voice

### Admin AI endpoints

- `GET /api/admin/ai-call-jobs?status=queued&limit=50`
  - Requires admin auth (`x-admin-key` or admin session cookie)
  - Returns recent AI call jobs and lead summary

- `GET /api/admin/ai-agent/health`
  - Requires admin auth
  - Validates go-live readiness for:
    - domain config (`PUBLIC_SITE_URL`, `TWILIO_CALLBACK_BASE_URL`)
    - Twilio credentials + callback URL format + account reachability
    - Google Calendar credentials (when enabled)
  - Returns `503` when configuration is incomplete, with exact missing fields

- `POST /api/ai-agent/call-result`
  - Requires admin auth
  - Upserts call outcome for a lead (manual/provider callback bridge)
  - Body:
    ```json
    {
      "leadId": 123,
      "callStatus": "completed",
      "notes": "Lead qualified",
      "transcript": "Call transcript text...",
      "appointmentStatus": "booked",
      "appointmentTime": "2026-04-26T16:00:00+05:30"
    }
    ```

### Twilio webhooks (implemented)

Set `AI_CALL_PROVIDER=twilio` and configure:

- `TWILIO_ACCOUNT_SID`
- `TWILIO_AUTH_TOKEN`
- `TWILIO_FROM_NUMBER`
- `TWILIO_CALLBACK_BASE_URL` (public HTTPS origin)

Use your real domain in both:

- `PUBLIC_SITE_URL=https://your-domain.com`
- `TWILIO_CALLBACK_BASE_URL=https://your-domain.com`

Webhook routes:

- `POST /api/webhooks/twilio/voice` (TwiML call flow)
- `POST /api/webhooks/twilio/status` (call status updates and call completion)
- `POST /api/webhooks/twilio/transcript` (speech/DTMF capture)

### Google Calendar booking (implemented)

When a lead call outcome is set to `appointment_status=booked`, the server can create an event via `events.insert` if enabled.

Set:

- `GOOGLE_CALENDAR_ENABLED=true`
- `GOOGLE_CALENDAR_ID`
- `GOOGLE_SERVICE_ACCOUNT_EMAIL`
- `GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY`
- `GOOGLE_CALENDAR_TIMEZONE` (default `Asia/Kolkata`)

### DSA Sathi (optional)

In `.env`, set:

- `DSASATHI_API_KEY` — bearer token from DSA Sathi **Settings → API Integration → Generate Token**
- `DSASATHI_API_BASE_URL` — default `https://api.dsasathi.com/v1`; use `https://sandbox.dsasathi.com/v1` for sandbox after you enable it in DSA settings
- `DSASATHI_SOURCE` — optional (default `website`)
- `DSASATHI_ASSIGNED_TO` — optional DSA agent id

The admin table shows **DSA** status (`pending` → `sent` / `failed` / `skipped`) and the remote `lead_id` when returned. CSV export includes the same fields for auditing.

### DSA Sathi inbound webhooks

Configure **Settings → Webhooks** in DSA Sathi to POST JSON to either:

- `https://YOUR_HOST/api/webhooks/dsasathi`
- `https://YOUR_HOST/dsa-webhook`

Environment:

- **`DSASATHI_WEBHOOK_SECRET`** — if set, requests must include header **`X-DSA-Signature`**: HMAC-SHA256 of the **raw request body** (hex digest, same as the Python example in DSA docs). If unset, signatures are not checked (convenient for local testing only).
- **`DSASATHI_WEBHOOK_ALLOW_IPS`** — optional comma-separated IPs; when set, the handler returns **403** unless `req.ip` or the first `X-Forwarded-For` hop matches (use with **`TRUST_PROXY=true`** behind a reverse proxy).

The handler responds immediately with **`{"status":"received"}`** (HTTP 200). It appends a row to **`dsasathi_webhook_log`** and, when `data.lead_id` matches a local lead’s **`dsasathi_lead_id`** (or `data.loan_id` matches **`dsasathi_crm_loan_id`**), updates CRM fields on that lead (`loan_status`, `loan_id`, assignment, last event summary). Admin and CSV include those columns.
