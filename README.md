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

## Production hardening checklist

- Do not commit `.env` to source control
- Set `NODE_ENV=production` in production
- Enable HTTPS and set `TRUST_PROXY=true` (or a hop count like `1`) if running behind a reverse proxy/load balancer

## Deployment readiness (recommended order)

1. Use a Node-capable host (Render, Railway, Fly, Azure App Service, VPS, etc.)
2. Keep `server.js` as entrypoint and run with `npm start`
3. Set production env values in host settings (not in Git):
   - `NODE_ENV=production`
   - `TRUST_PROXY=true`
   - `PUBLIC_SITE_URL=https://YOUR_DOMAIN`
4. Ensure SQLite persistence:
   - small deployments: keep SQLite and attach a persistent volume/disk
   - scaling deployments: migrate to PostgreSQL/MySQL
5. Build CSS before release (`npm run build:css`) so `public/styles.css` is current
6. Enable HTTPS and custom domain, then verify:
   - `/health` returns success
   - lead form saves data
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

Success response (`201`): `{ "success": true, "message": "...", "leadId": <number> }`.
