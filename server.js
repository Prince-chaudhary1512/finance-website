const dotenv = require("dotenv");
dotenv.config({ override: true });
const path = require("path");
const fsSync = require("fs");
const fs = require("fs/promises");
const crypto = require("crypto");
const express = require("express");
const nodemailer = require("nodemailer");
const twilio = require("twilio");
const helmet = require("helmet");
const cors = require("cors");
const morgan = require("morgan");
const rateLimit = require("express-rate-limit");
const { google } = require("googleapis");
const { z } = require("zod");
const {
  initDb,
  insertLead,
  getLeadById,
  updateLeadAiProfile,
  updateLeadAiDecision,
  createAiCallJob,
  getPendingAiCallJob,
  markAiCallJobInProgress,
  completeAiCallJob,
  getAiCallJobByProviderCallId,
  getLatestAiCallJobByLeadId,
  setAiCallJobProviderCallId,
  updateLeadCallOutcome,
  listAiCallJobs,
  updateLeadEmailStatus,
  updateLeadDsasathiSync,
  insertDsasathiWebhookLog,
  findLocalLeadIdsForDsasathiWebhook,
  applyDsasathiWebhookToLocalLead,
  listLeads,
  exportLeads,
} = require("./src/db");

let envFileValues = {};
try {
  const rawEnvFile = fsSync.readFileSync(path.join(__dirname, ".env"), "utf8");
  envFileValues = dotenv.parse(rawEnvFile);
} catch {
  envFileValues = {};
}

function getEnvValue(key, fallback = "") {
  if (Object.prototype.hasOwnProperty.call(envFileValues, key)) return envFileValues[key];
  if (Object.prototype.hasOwnProperty.call(process.env, key)) return process.env[key];
  return fallback;
}

const app = express();
const PORT = Number(process.env.PORT || 3000);
const PUBLIC_DIR = path.join(__dirname, "public");
const GOOGLE_SCRIPT_URL = process.env.GOOGLE_SCRIPT_URL || "";
const ADMIN_API_KEY = getEnvValue("ADMIN_API_KEY", "");
const ADMIN_USERNAME = getEnvValue("ADMIN_USERNAME", "admin");
const ADMIN_PASSWORD = getEnvValue("ADMIN_PASSWORD", "");
const ADMIN_COOKIE_NAME = "mrok_admin_session";
const ADMIN_SESSION_SECRET = String(getEnvValue("ADMIN_SESSION_SECRET", "") || "").trim();
const ADMIN_SESSION_TTL_MS = 12 * 60 * 60 * 1000;
const MAIL_HOST = process.env.MAIL_HOST || "";
const MAIL_PORT = Number(process.env.MAIL_PORT || 587);
const MAIL_SECURE = String(process.env.MAIL_SECURE || "false") === "true";
const MAIL_USER = process.env.MAIL_USER || "";
const MAIL_PASS = process.env.MAIL_PASS || "";
const MAIL_FROM = process.env.MAIL_FROM || MAIL_USER;
const LEAD_NOTIFICATION_TO = process.env.LEAD_NOTIFICATION_TO || "mrokfinance@gmail.com";
const IS_PRODUCTION = process.env.NODE_ENV === "production";
const TRUST_PROXY = String(process.env.TRUST_PROXY || "false").trim();
const PUBLIC_SITE_URL = String(process.env.PUBLIC_SITE_URL || "").trim().replace(/\/$/, "");
const DSASATHI_API_KEY = String(process.env.DSASATHI_API_KEY || "").trim();
const DSASATHI_API_BASE_URL = String(process.env.DSASATHI_API_BASE_URL || "").trim();
const DSASATHI_ASSIGNED_TO = String(process.env.DSASATHI_ASSIGNED_TO || "").trim();
const DSASATHI_SOURCE = String(process.env.DSASATHI_SOURCE || "website").trim() || "website";
const DSASATHI_WEBHOOK_ALLOW_IPS = String(process.env.DSASATHI_WEBHOOK_ALLOW_IPS || "").trim();
const USE_DSA_PUBLIC_FORM = String(process.env.USE_DSA_PUBLIC_FORM || "false").trim().toLowerCase() === "true";
const AI_CALL_ENABLED = String(process.env.AI_CALL_ENABLED || "true").trim().toLowerCase() === "true";
const AI_CALL_PROVIDER = String(process.env.AI_CALL_PROVIDER || "mock").trim().toLowerCase();
const AI_CALL_COOLDOWN_HOURS = Number(process.env.AI_CALL_COOLDOWN_HOURS || 12);
const AI_CALL_ELIGIBLE_STATES = String(
  process.env.AI_CALL_ELIGIBLE_STATES || "haryana,delhi,uttar pradesh"
)
  .split(",")
  .map((s) => s.trim().toLowerCase())
  .filter(Boolean);
const AI_CALL_WORKER_INTERVAL_MS = Math.max(5000, Number(process.env.AI_CALL_WORKER_INTERVAL_MS || 15000));
const TWILIO_ACCOUNT_SID = String(process.env.TWILIO_ACCOUNT_SID || "").trim();
const TWILIO_AUTH_TOKEN = String(process.env.TWILIO_AUTH_TOKEN || "").trim();
const TWILIO_FROM_NUMBER = String(process.env.TWILIO_FROM_NUMBER || "").trim();
const TWILIO_CALLBACK_BASE_URL = String(process.env.TWILIO_CALLBACK_BASE_URL || PUBLIC_SITE_URL || "").trim().replace(/\/$/, "");
const TWILIO_VALIDATE_SIGNATURE =
  String(process.env.TWILIO_VALIDATE_SIGNATURE || "true").trim().toLowerCase() === "true";
const GOOGLE_CALENDAR_ENABLED =
  String(process.env.GOOGLE_CALENDAR_ENABLED || "false").trim().toLowerCase() === "true";
const GOOGLE_CALENDAR_ID = String(process.env.GOOGLE_CALENDAR_ID || "").trim();
const GOOGLE_SERVICE_ACCOUNT_EMAIL = String(process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL || "").trim();
const GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY = String(process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY || "")
  .replace(/\\n/g, "\n")
  .trim();
const GOOGLE_CALENDAR_TIMEZONE = String(process.env.GOOGLE_CALENDAR_TIMEZONE || "Asia/Kolkata").trim();

const OG_HTML_FILES = new Set([
  "index.html",
  "about.html",
  "admin.html",
  "personal-loan.html",
  "home-loan.html",
  "lap-loan.html",
  "business-loan.html",
  "vehicle-loan.html",
  "project-loan.html",
  "builder-funding-micro-cf.html",
  "faq.html",
  "privacy.html",
  "terms.html",
  "grievance.html",
  "portal.html",
  "insurance.html",
]);

/** Prefer clean URLs in og:url when both .html and extensionless routes exist */
const OG_CANONICAL_PATH_BY_FILE = {
  "index.html": "/",
  "about.html": "/about",
  "admin.html": "/admin",
  "personal-loan.html": "/personal-loan",
  "home-loan.html": "/home-loan",
  "lap-loan.html": "/lap-loan",
  "business-loan.html": "/business-loan",
  "vehicle-loan.html": "/vehicle-loan",
  "project-loan.html": "/project-loan",
  "builder-funding-micro-cf.html": "/builder-funding-micro-cf",
};

function getPublicOrigin(req) {
  if (PUBLIC_SITE_URL) return PUBLIC_SITE_URL;
  const host = req.get("x-forwarded-host") || req.get("host") || "localhost";
  const xfProto = req.get("x-forwarded-proto");
  const proto = xfProto ? String(xfProto).split(",")[0].trim() : req.protocol || "http";
  return `${proto}://${host}`;
}

function buildAbsoluteUrl(origin, pathname) {
  const base = String(origin).replace(/\/$/, "");
  const p = pathname.startsWith("/") ? pathname : `/${pathname}`;
  if (p === "/") return `${base}/`;
  return `${base}${p}`;
}

const LOGO_CANDIDATES = ["/mroklogo.jpeg", "/mroklogo.jpg", "/mroklogo.png", "/mroklogo.webp", "/mroklogo.svg"];

async function resolveLogoPath() {
  for (const candidate of LOGO_CANDIDATES) {
    try {
      await fs.access(path.join(PUBLIC_DIR, candidate.slice(1)));
      return candidate;
    } catch {
      // continue
    }
  }
  return "/mroklogo.svg";
}

function logoMimeType(urlPath) {
  if (urlPath.endsWith(".svg")) return "image/svg+xml";
  if (urlPath.endsWith(".png")) return "image/png";
  if (urlPath.endsWith(".webp")) return "image/webp";
  return "image/jpeg";
}

function injectThemeToggle(html) {
  if (!html || !html.includes("</body>") || html.includes("data-theme-toggle")) {
    return html;
  }

  const snippet = `
<script data-theme-toggle>
(function () {
  var storageKey = "mrok_theme";
  var root = document.documentElement;

  var style = document.createElement("style");
  style.textContent = \`
html[data-theme="light"] body { background: #f4f7fb !important; color: #0f172a !important; }
html[data-theme="light"] .bg-slate-950, html[data-theme="light"] .bg-slate-950\\/90, html[data-theme="light"] .bg-slate-950\\/95 { background-color: #f4f7fb !important; }
html[data-theme="light"] .bg-slate-900, html[data-theme="light"] .bg-slate-900\\/40, html[data-theme="light"] .bg-slate-900\\/50, html[data-theme="light"] .bg-slate-900\\/70, html[data-theme="light"] .bg-slate-900\\/80 { background-color: #ffffff !important; }
html[data-theme="light"] .bg-slate-800, html[data-theme="light"] .bg-slate-800\\/80 { background-color: #e7edf5 !important; }
html[data-theme="light"] .border-slate-800, html[data-theme="light"] .border-slate-800\\/80, html[data-theme="light"] .border-slate-700 { border-color: #c7d4e5 !important; }
html[data-theme="light"] .text-slate-100, html[data-theme="light"] .text-slate-200 { color: #0f172a !important; }
html[data-theme="light"] .text-slate-300, html[data-theme="light"] .text-slate-400 { color: #334155 !important; }
html[data-theme="light"] .text-slate-500 { color: #64748b !important; }
html[data-theme="light"] .text-brand, html[data-theme="light"] .text-sky-300 { color: #0369a1 !important; }
html[data-theme="light"] .hover\\:text-sky-300:hover, html[data-theme="light"] .hover\\:text-sky-200:hover { color: #075985 !important; }
html[data-theme="light"] .hover\\:text-white:hover { color: #0f172a !important; }
html[data-theme="light"] .bg-brand { background-color: #0284c7 !important; }
html[data-theme="light"] .bg-emerald-500 { background-color: #059669 !important; }
html[data-theme="light"] .text-white { color: #ffffff !important; }
html[data-theme="light"] a, html[data-theme="light"] summary { color: #0f172a; }
html[data-theme="light"] a:hover, html[data-theme="light"] summary:hover { color: #075985; }
html[data-theme="light"] .rounded-2xl.border, html[data-theme="light"] .rounded-xl.border, html[data-theme="light"] .lift-card { box-shadow: 0 8px 24px rgba(15, 23, 42, 0.06) !important; }
html[data-theme="light"] input, html[data-theme="light"] select, html[data-theme="light"] textarea { background-color: #ffffff !important; color: #0f172a !important; border-color: #c7d4e5 !important; }
html[data-theme="light"] input::placeholder, html[data-theme="light"] textarea::placeholder { color: #64748b !important; }
html[data-theme="light"] .placeholder\\:text-slate-500::placeholder { color: #64748b !important; }
html[data-theme="light"] th { color: #0f172a !important; background-color: #dde7f3 !important; }
html[data-theme="light"] td { color: #1e293b !important; }
html[data-theme="light"] tr.border-t { border-color: #d8e2ef !important; }
html[data-theme="light"] .bg-slate-900\\/70 .text-slate-400,
html[data-theme="light"] .bg-slate-900 .text-slate-400,
html[data-theme="light"] .bg-slate-950 .text-slate-400 { color: #475569 !important; }
html[data-theme="light"] #news .lift-card { background-color: #ffffff !important; border-color: #bfd0e6 !important; }
html[data-theme="light"] #news h2 { color: #0b1220 !important; }
html[data-theme="light"] #news .lift-card p { color: #475569 !important; }
html[data-theme="light"] #news .lift-card h3 { color: #0f172a !important; }
html[data-theme="light"] .hover\\:bg-slate-800:hover { background-color: #e2ebf7 !important; }
html[data-theme="light"] .text-red-300 { color: #b91c1c !important; }
html[data-theme="light"] .text-emerald-300 { color: #047857 !important; }
html[data-theme="light"] .from-sky-600\\/20 { --tw-gradient-from: rgba(2, 132, 199, 0.16) var(--tw-gradient-from-position) !important; }
html[data-theme="light"] .to-emerald-500\\/10 { --tw-gradient-to: rgba(16, 185, 129, 0.08) var(--tw-gradient-to-position) !important; }
html[data-theme="light"] .shadow-sky-900\\/20, html[data-theme="light"] .shadow-slate-950\\/70 { --tw-shadow-color: rgba(2, 132, 199, 0.12) !important; }
html[data-theme="light"] a.rounded-lg.bg-brand,
html[data-theme="light"] button.rounded-lg.bg-brand,
html[data-theme="light"] button.bg-brand {
  background: linear-gradient(135deg, #0284c7, #0ea5e9) !important;
  box-shadow: 0 8px 18px rgba(2, 132, 199, 0.25) !important;
}
html[data-theme="light"] a.rounded-lg.bg-brand:hover,
html[data-theme="light"] button.rounded-lg.bg-brand:hover,
html[data-theme="light"] button.bg-brand:hover {
  background: linear-gradient(135deg, #0369a1, #0284c7) !important;
  transform: translateY(-1px);
}
html[data-theme="light"] a.rounded-lg.border,
html[data-theme="light"] button.rounded-lg.border {
  background-color: #f8fbff !important;
  color: #0f172a !important;
  border-color: #b9cbe2 !important;
}
html[data-theme="light"] a.rounded-lg.border:hover,
html[data-theme="light"] button.rounded-lg.border:hover {
  background-color: #eef4fb !important;
}
html[data-theme="light"] header.sticky, html[data-theme="light"] .backdrop-blur { background-color: rgba(255, 255, 255, 0.95) !important; }
html[data-theme="light"] .inline-flex.rounded-full.border,
html[data-theme="light"] .inline-block.rounded-full.border {
  background-color: rgba(2, 132, 199, 0.08) !important;
  border-color: rgba(2, 132, 199, 0.25) !important;
  color: #075985 !important;
}
html[data-theme="light"] iframe { filter: grayscale(10%); }
@media (max-width: 640px) {
  html[data-theme="light"] body { font-size: 16px; }
  html[data-theme="light"] p, html[data-theme="light"] li, html[data-theme="light"] a, html[data-theme="light"] label, html[data-theme="light"] td { color: #0f172a !important; }
  html[data-theme="light"] .text-sm { font-size: 0.95rem !important; line-height: 1.55 !important; }
  html[data-theme="light"] .text-xs { font-size: 0.84rem !important; line-height: 1.45 !important; }
  html[data-theme="light"] h1, html[data-theme="light"] h2 { color: #0b1220 !important; }
  html[data-theme="light"] .rounded-lg.bg-brand,
  html[data-theme="light"] button.rounded-lg.bg-brand,
  html[data-theme="light"] button.bg-brand { box-shadow: 0 10px 20px rgba(2, 132, 199, 0.28) !important; }
  html[data-theme="light"] input,
  html[data-theme="light"] select,
  html[data-theme="light"] textarea { font-size: 16px !important; }
  html[data-theme="light"] .bg-slate-900,
  html[data-theme="light"] .bg-slate-900\\/40,
  html[data-theme="light"] .bg-slate-900\\/50,
  html[data-theme="light"] .bg-slate-900\\/70 { border-color: #bfcee2 !important; }
}
#theme-toggle-btn { position: fixed; right: 16px; bottom: 16px; z-index: 9999; border: 1px solid rgba(148,163,184,.4); background: rgba(15,23,42,.9); color: #e2e8f0; border-radius: 999px; padding: 8px 12px; font-size: 12px; font-weight: 600; cursor: pointer; backdrop-filter: blur(4px); }
html[data-theme="light"] #theme-toggle-btn { background: rgba(255,255,255,.95); color: #0f172a; border-color: rgba(100,116,139,.4); }
\`;
  document.head.appendChild(style);

  function savedTheme() {
    try { return localStorage.getItem(storageKey); } catch (e) { return null; }
  }
  function setTheme(theme) {
    root.setAttribute("data-theme", theme);
    try { localStorage.setItem(storageKey, theme); } catch (e) {}
    var btn = document.getElementById("theme-toggle-btn");
    if (btn) btn.textContent = theme === "light" ? "Dark Mode" : "Light Mode";
  }

  var initial = savedTheme();
  if (initial !== "light" && initial !== "dark") {
    initial = window.matchMedia && window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
  }
  setTheme(initial);

  var btn = document.createElement("button");
  btn.id = "theme-toggle-btn";
  btn.type = "button";
  btn.setAttribute("aria-label", "Toggle dark and light mode");
  btn.textContent = initial === "light" ? "Dark Mode" : "Light Mode";
  btn.addEventListener("click", function () {
    var next = root.getAttribute("data-theme") === "light" ? "dark" : "light";
    setTheme(next);
  });
  document.body.appendChild(btn);
})();
</script>`;

  return html.replace("</body>", `${snippet}\n</body>`);
}

async function sendHtmlWithOg(req, res, fileName, canonicalPath) {
  const absPath = path.join(__dirname, fileName);
  let html = await fs.readFile(absPath, "utf8");
  const logoPath = await resolveLogoPath();
  const logoMime = logoMimeType(logoPath);
  if (logoPath !== "/mroklogo.jpeg") {
    html = html.replaceAll("/mroklogo.jpeg", logoPath);
  }
  html = html.replaceAll('type="image/jpeg"', `type="${logoMime}"`);
  if (html.includes("__OG_CANONICAL_URL__") && html.includes("__OG_IMAGE_URL__")) {
    const origin = getPublicOrigin(req);
    const canonicalUrl = buildAbsoluteUrl(origin, canonicalPath);
    const imageUrl = buildAbsoluteUrl(origin, logoPath);
    html = html.split("__OG_CANONICAL_URL__").join(canonicalUrl).split("__OG_IMAGE_URL__").join(imageUrl);
  }
  if (html.includes("__USE_DSA_PUBLIC_FORM__")) {
    html = html.split("__USE_DSA_PUBLIC_FORM__").join(String(USE_DSA_PUBLIC_FORM));
  }
  html = injectThemeToggle(html);
  res.type("html").send(html);
}

const mailTransporter =
  MAIL_HOST && MAIL_USER && MAIL_PASS
    ? nodemailer.createTransport({
        host: MAIL_HOST,
        port: MAIL_PORT,
        secure: MAIL_SECURE,
        auth: {
          user: MAIL_USER,
          pass: MAIL_PASS,
        },
      })
    : null;

const twilioClient =
  TWILIO_ACCOUNT_SID && TWILIO_AUTH_TOKEN ? twilio(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN) : null;

const googleJwtClient =
  GOOGLE_SERVICE_ACCOUNT_EMAIL && GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY
    ? new google.auth.JWT({
        email: GOOGLE_SERVICE_ACCOUNT_EMAIL,
        key: GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY,
        scopes: ["https://www.googleapis.com/auth/calendar"],
      })
    : null;

function resolveTrustProxyValue(raw) {
  const val = String(raw || "").trim().toLowerCase();
  if (!val || val === "false" || val === "0" || val === "off" || val === "no") return false;
  if (val === "true" || val === "1" || val === "on" || val === "yes") return 1;
  if (/^\d+$/.test(val)) return Number(val);
  return val;
}

const trustProxyValue = resolveTrustProxyValue(TRUST_PROXY);
if (trustProxyValue !== false) {
  app.set("trust proxy", trustProxyValue);
}

const leadSchema = z.object({
  name: z.string().min(2).max(120),
  loanType: z.string().min(2).max(100),
  loanAmount: z.string().min(1).max(100),
  city: z.string().min(2).max(100),
  mobile: z
    .string()
    .regex(/^\+?\d{10,15}$/, "Mobile number must be 10-15 digits"),
  email: z.string().email("Please provide a valid email address"),
  state: z.string().min(2).max(80).optional().default(""),
  incomeRange: z.string().max(80).optional().default(""),
  preferredCallbackTime: z.string().max(80).optional().default(""),
  source: z.string().max(80).optional().default("website"),
  consent: z.boolean().optional().default(false),
  consentTime: z.string().max(80).optional().default(""),
});

app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", "'unsafe-inline'", "https://cdn.tailwindcss.com"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", "data:", "blob:"],
        connectSrc: ["'self'", "https://api.dsasathi.com"],
        fontSrc: ["'self'", "data:"],
        frameSrc: ["'self'", "https://www.google.com", "https://maps.google.com"],
        objectSrc: ["'none'"],
        baseUri: ["'self'"],
        frameAncestors: ["'none'"],
      },
    },
  })
);
app.use(
  cors({
    origin: true,
    methods: ["GET", "POST"],
  })
);
app.use(morgan("combined"));

const dsasathiWebhookRaw = express.raw({
  type: (req) => {
    const t = String(req.headers["content-type"] || "").toLowerCase();
    return !t || t.includes("application/json");
  },
  limit: "256kb",
});

function verifyDsasathiWebhookSignature(rawBuffer, signatureHeader) {
  const secret = String(process.env.DSASATHI_WEBHOOK_SECRET || "").trim();
  if (!secret) return true;
  const headerVal = String(signatureHeader || "").trim();
  if (!headerVal) return false;
  const expected = crypto.createHmac("sha256", secret).update(rawBuffer).digest("hex");
  let received = headerVal.toLowerCase();
  if (received.startsWith("sha256=")) received = received.slice(7).trim();
  if (received.length !== 64 || !/^[0-9a-f]+$/i.test(received)) return false;
  try {
    return crypto.timingSafeEqual(Buffer.from(expected, "hex"), Buffer.from(received, "hex"));
  } catch {
    return false;
  }
}

function isDsasathiWebhookIpAllowed(req) {
  if (!DSASATHI_WEBHOOK_ALLOW_IPS) return true;
  const allowed = DSASATHI_WEBHOOK_ALLOW_IPS
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (!allowed.length) return true;
  const clientIp = String(req.ip || "").trim();
  const xff = req.get("x-forwarded-for");
  const firstForwarded = xff ? String(xff).split(",")[0].trim() : "";
  const candidates = [clientIp, firstForwarded].filter(Boolean);
  return candidates.some((ip) => allowed.includes(ip));
}

function buildDsasathiWebhookSummary(event, data) {
  const d = data || {};
  switch (event) {
    case "loan_status_updated":
      return [d.status, d.bank, d.loan_id, d.amount != null ? String(d.amount) : ""]
        .filter(Boolean)
        .join(" · ")
        .slice(0, 500);
    case "lead_assigned":
      return `Assigned: ${d.assigned_to || d.assignedTo || ""}`.trim().slice(0, 500);
    case "payout_processed":
      return [d.payout_id || d.payoutId, d.amount != null ? String(d.amount) : "", d.agent_id || d.agentId]
        .filter(Boolean)
        .join(" · ")
        .slice(0, 500);
    case "document_uploaded":
      return [d.doc_type || d.docType, d.status, d.loan_id || d.loanId].filter(Boolean).join(" · ").slice(0, 500);
    default:
      return String(event || "unknown").slice(0, 500);
  }
}

async function processDsasathiWebhookAsync(payload, rawText) {
  const event = String(payload.event || "").trim();
  const data =
    payload.data && typeof payload.data === "object" && !Array.isArray(payload.data) ? payload.data : {};
  const at = String(payload.timestamp || new Date().toISOString()).slice(0, 80);
  const summary = buildDsasathiWebhookSummary(event, data);

  let loanId = "";
  let loanStatus = "";
  let assignedTo = "";

  if (event === "loan_status_updated") {
    loanId = String(data.loan_id || data.loanId || "").trim();
    loanStatus = String(data.status || "").trim();
  } else if (event === "document_uploaded") {
    loanId = String(data.loan_id || data.loanId || "").trim();
    loanStatus = String(data.status || "").trim();
  } else if (event === "lead_assigned") {
    assignedTo = String(data.assigned_to || data.assignedTo || "").trim();
  }

  const { remoteLeadId, localLeadIds } = await findLocalLeadIdsForDsasathiWebhook(data);
  const uniqueLocalIds = [...new Set(localLeadIds)];
  const logLocalId = uniqueLocalIds[0] || null;

  await insertDsasathiWebhookLog({
    event,
    remoteLeadId,
    localLeadId: logLocalId,
    payloadJson: rawText,
  });

  for (const id of uniqueLocalIds) {
    await applyDsasathiWebhookToLocalLead(id, {
      event,
      at,
      summary,
      loanId,
      loanStatus,
      assignedTo,
    });
  }
}

function handleDsasathiWebhook(req, res) {
  if (!isDsasathiWebhookIpAllowed(req)) {
    console.warn("DSA Sathi webhook rejected: IP not in allowlist", req.ip, req.get("x-forwarded-for"));
    return res.status(403).json({ success: false, message: "Forbidden" });
  }

  if (!Buffer.isBuffer(req.body)) {
    return res.status(400).json({ success: false, message: "Invalid body" });
  }

  const sig = req.get("x-dsa-signature");
  if (!verifyDsasathiWebhookSignature(req.body, sig)) {
    return res.status(401).json({ success: false, message: "Unauthorized" });
  }

  let payload;
  try {
    const text = req.body.toString("utf8");
    if (!text.trim()) {
      return res.status(400).json({ success: false, message: "Empty body" });
    }
    payload = JSON.parse(text);
  } catch {
    return res.status(400).json({ success: false, message: "Invalid JSON" });
  }

  res.status(200).json({ status: "received" });

  const rawCopy = req.body.toString("utf8");
  setImmediate(() => {
    processDsasathiWebhookAsync(payload, rawCopy).catch((err) => {
      console.error("DSA Sathi webhook async error:", err.message || err);
    });
  });
}

app.post("/api/webhooks/dsasathi", dsasathiWebhookRaw, handleDsasathiWebhook);
app.post("/dsa-webhook", dsasathiWebhookRaw, handleDsasathiWebhook);

app.use(express.json({ limit: "100kb" }));
app.use(express.urlencoded({ extended: false, limit: "100kb" }));

app.post("/api/webhooks/twilio/voice", (req, res) => {
  if (!verifyTwilioWebhookSignature(req)) {
    return res.status(403).type("text/plain").send("Forbidden");
  }
  const vr = new twilio.twiml.VoiceResponse();
  vr.say(
    { voice: "alice" },
    "Hello. This is an automated assistant calling only because you requested information or submitted your details to M R O K Financial Services."
  );
  const gather = vr.gather({
    input: "speech dtmf",
    numDigits: 1,
    timeout: 4,
    action: "/api/webhooks/twilio/transcript",
    method: "POST",
  });
  gather.say(
    { voice: "alice" },
    "Press 1 to speak with our advisor and book a callback. Press 2 if you are not interested."
  );
  vr.pause({ length: 1 });
  vr.say({ voice: "alice" }, "Thank you. We will follow up shortly.");
  vr.hangup();
  return res.type("text/xml").send(vr.toString());
});

app.post("/api/webhooks/twilio/status", async (req, res) => {
  if (!verifyTwilioWebhookSignature(req)) {
    return res.status(403).json({ success: false, message: "Forbidden" });
  }
  const callSid = String(req.body.CallSid || "");
  const status = parseTwilioCallStatus(req.body.CallStatus || "");
  const recordingUrl = String(req.body.RecordingUrl || "");
  const transcriptText = String(req.body.TranscriptionText || "");
  if (!callSid) {
    return res.status(400).json({ success: false, message: "Missing CallSid" });
  }
  const job = await getAiCallJobByProviderCallId(callSid);
  if (!job) {
    return res.json({ success: true, message: "No matching job" });
  }

  if (status === "in_progress") {
    await updateLeadCallOutcome(job.lead_id, {
      callStatus: "in_progress",
      callNotes: `Twilio status: ${String(req.body.CallStatus || "in-progress")}`.slice(0, 500),
      callTranscript: transcriptText || "",
      appointmentStatus: "not_booked",
      appointmentTime: "",
    });
    return res.json({ success: true, message: "Progress status updated" });
  }

  const appendedTranscript = [transcriptText, recordingUrl ? `Recording: ${recordingUrl}` : ""].filter(Boolean).join("\n");
  await completeAiCallJob(job.id, {
    status: status === "failed" ? "failed" : "completed",
    providerCallId: callSid,
    transcript: appendedTranscript,
    resultJson: JSON.stringify(req.body || {}),
  });
  await updateLeadCallOutcome(job.lead_id, {
    callStatus: status,
    callNotes: `Twilio call ${status}`.slice(0, 500),
    callTranscript: appendedTranscript,
    appointmentStatus: "not_booked",
    appointmentTime: "",
  });
  return res.json({ success: true });
});

app.post("/api/webhooks/twilio/transcript", async (req, res) => {
  if (!verifyTwilioWebhookSignature(req)) {
    return res.status(403).json({ success: false, message: "Forbidden" });
  }
  const callSid = String(req.body.CallSid || "");
  const speech = String(req.body.SpeechResult || req.body.TranscriptionText || "").trim();
  const digit = String(req.body.Digits || "").trim();
  const leadAction = digit === "1" ? "interested" : digit === "2" ? "not_interested" : "";
  if (!callSid) {
    return res.status(400).json({ success: false, message: "Missing CallSid" });
  }
  const job = await getAiCallJobByProviderCallId(callSid);
  if (job) {
    const transcript = [speech ? `Speech: ${speech}` : "", leadAction ? `Action: ${leadAction}` : ""]
      .filter(Boolean)
      .join("\n");
    await updateLeadCallOutcome(job.lead_id, {
      callStatus: "in_progress",
      callNotes: leadAction ? `Lead action: ${leadAction}` : "Transcript captured",
      callTranscript: transcript,
      appointmentStatus: "not_booked",
      appointmentTime: "",
    });
  }
  const vr = new twilio.twiml.VoiceResponse();
  vr.say({ voice: "alice" }, "Thank you. Our advisor will contact you soon.");
  vr.hangup();
  return res.type("text/xml").send(vr.toString());
});

const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 50,
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => {
    if (req.method !== "POST") return false;
    const pathOnly = String(req.originalUrl || req.url || "").split("?")[0];
    return pathOnly === "/api/webhooks/dsasathi";
  },
  message: {
    success: false,
    message: "Too many requests. Please try again later.",
  },
});

app.use("/api", apiLimiter);

app.get("/health", (_req, res) => {
  res.json({ success: true, status: "ok" });
});

function parseCookieHeader(cookieHeader = "") {
  return cookieHeader
    .split(";")
    .map((part) => part.trim())
    .filter(Boolean)
    .reduce((acc, part) => {
      const idx = part.indexOf("=");
      if (idx === -1) return acc;
      const key = part.slice(0, idx);
      const value = decodeURIComponent(part.slice(idx + 1));
      acc[key] = value;
      return acc;
    }, {});
}

function parseLoanAmountNumber(raw) {
  const normalized = String(raw || "").toLowerCase().replace(/,/g, "");
  const lakh = normalized.match(/([\d.]+)\s*(lakh|lac|lakhs|lacs)\b/);
  if (lakh) return Math.round(Number(lakh[1]) * 100000);
  const crore = normalized.match(/([\d.]+)\s*(crore|cr|cr\.|crs)\b/);
  if (crore) return Math.round(Number(crore[1]) * 10000000);
  const digits = Number(normalized.replace(/[^0-9.]/g, ""));
  return Number.isFinite(digits) ? digits : 0;
}

function scoreLeadForAiCall(payload) {
  let score = 0;
  const loanType = String(payload.loanType || "").toLowerCase();
  if (loanType.includes("home")) score += 25;
  else if (loanType.includes("business")) score += 22;
  else if (loanType.includes("lap") || loanType.includes("property")) score += 20;
  else if (loanType.includes("personal")) score += 16;
  else score += 12;

  const amount = parseLoanAmountNumber(payload.loanAmount);
  if (amount >= 5000000) score += 25;
  else if (amount >= 2000000) score += 18;
  else if (amount >= 500000) score += 10;
  else score += 4;

  if (String(payload.preferredCallbackTime || "").trim()) score += 10;
  if (String(payload.incomeRange || "").trim()) score += 6;

  const source = String(payload.source || "website").toLowerCase();
  if (source.includes("whatsapp") || source.includes("referral")) score += 8;
  if (source.includes("ad")) score += 4;

  return Math.min(100, Math.max(0, score));
}

async function shouldQueueAiCall(leadId, payload) {
  if (!AI_CALL_ENABLED) {
    return { allowed: false, reason: "AI calling disabled" };
  }
  if (payload.consent !== true) {
    return { allowed: false, reason: "Consent not granted" };
  }
  const state = String(payload.state || "").trim().toLowerCase();
  if (!state || !AI_CALL_ELIGIBLE_STATES.includes(state)) {
    return { allowed: false, reason: "State outside service coverage" };
  }
  if (!/^\+?\d{10,15}$/.test(String(payload.mobile || ""))) {
    return { allowed: false, reason: "Invalid phone number" };
  }

  const lead = await getLeadById(leadId);
  const lastAttempt = String((lead && lead.last_call_attempt_at) || "").trim();
  if (lastAttempt) {
    const hours = (Date.now() - new Date(lastAttempt).getTime()) / (1000 * 60 * 60);
    if (Number.isFinite(hours) && hours >= 0 && hours < AI_CALL_COOLDOWN_HOURS) {
      return { allowed: false, reason: `Called recently (${Math.floor(hours)}h ago)` };
    }
  }

  return { allowed: true, reason: "Eligible for AI call queue" };
}

async function evaluateAndQueueLeadForAiCall(leadId, payload) {
  const score = scoreLeadForAiCall(payload);
  const decision = await shouldQueueAiCall(leadId, payload);
  if (!decision.allowed) {
    await updateLeadAiDecision(leadId, {
      score,
      status: "not_queued",
      notes: decision.reason,
    });
    return { queued: false, score, reason: decision.reason };
  }

  await createAiCallJob({ leadId, score, reason: "Auto-queued from lead submission" });
  await updateLeadAiDecision(leadId, {
    score,
    status: "queued",
    notes: "Queued for AI call",
  });
  return { queued: true, score, reason: "Queued successfully" };
}

function buildAiCallPrompt(lead) {
  return [
    `You are an automated loan assistant from MR OK Financial Services.`,
    `Lead name: ${lead.name || "Customer"}`,
    `Phone: ${lead.mobile || ""}`,
    `Consent: ${Number(lead.consent_status) === 1 ? "explicit opt-in received" : "not confirmed"}`,
    `Ask for: loan type, city, required amount, and callback preference.`,
    `Confirm this line early: "This is an automated assistant calling only because you requested information or submitted your details."`,
    `If lead is interested, offer advisor slot options and capture final appointment time.`,
    `If lead is not interested, mark status as do_not_call.`,
  ].join("\n");
}

function normalizeIndianNumber(raw) {
  const digits = String(raw || "").replace(/\D/g, "");
  if (!digits) return "";
  if (digits.length === 10) return `+91${digits}`;
  if (digits.length > 10) return `+${digits}`;
  return String(raw || "").trim();
}

function parseTwilioCallStatus(status) {
  const s = String(status || "").toLowerCase();
  if (["completed"].includes(s)) return "completed";
  if (["busy", "failed", "canceled", "cancelled"].includes(s)) return "failed";
  if (["no-answer"].includes(s)) return "no_answer";
  return "in_progress";
}

function twilioWebhookUrl(pathname) {
  if (!TWILIO_CALLBACK_BASE_URL) return "";
  const p = pathname.startsWith("/") ? pathname : `/${pathname}`;
  return `${TWILIO_CALLBACK_BASE_URL}${p}`;
}

function isValidAbsoluteHttpsUrl(raw) {
  try {
    const u = new URL(String(raw || "").trim());
    return u.protocol === "https:" && !!u.hostname;
  } catch {
    return false;
  }
}

function isLocalHostName(hostname = "") {
  const h = String(hostname || "").toLowerCase();
  return h === "localhost" || h === "127.0.0.1" || h === "::1";
}

function verifyTwilioWebhookSignature(req) {
  if (!TWILIO_VALIDATE_SIGNATURE) return true;
  if (!TWILIO_AUTH_TOKEN) return false;
  const signature = req.get("x-twilio-signature");
  if (!signature) return false;
  const url = twilioWebhookUrl(req.path);
  if (!url) return false;
  const params = req.body && typeof req.body === "object" ? req.body : {};
  return twilio.validateRequest(TWILIO_AUTH_TOKEN, signature, url, params);
}

async function maybeBookGoogleCalendarEvent(lead, appointmentTime) {
  if (!GOOGLE_CALENDAR_ENABLED) {
    return { status: "skipped", message: "Google Calendar disabled" };
  }
  if (!appointmentTime) {
    return { status: "skipped", message: "Missing appointment time" };
  }
  if (!googleJwtClient || !GOOGLE_CALENDAR_ID) {
    return { status: "skipped", message: "Google Calendar credentials not configured" };
  }

  const startAt = new Date(appointmentTime);
  if (!Number.isFinite(startAt.getTime())) {
    return { status: "failed", message: "Invalid appointment datetime format" };
  }
  const endAt = new Date(startAt.getTime() + 30 * 60 * 1000);
  const calendar = google.calendar({ version: "v3", auth: googleJwtClient });
  const event = {
    summary: `Loan advisory call: ${lead.name || "Lead"} (#${lead.id})`,
    description: [
      `Lead ID: ${lead.id}`,
      `Name: ${lead.name || ""}`,
      `Mobile: ${lead.mobile || ""}`,
      `Email: ${lead.email || ""}`,
      `Loan Type: ${lead.loan_type || ""}`,
      `City: ${lead.city || ""}`,
      `State: ${lead.lead_state || ""}`,
    ].join("\n"),
    start: { dateTime: startAt.toISOString(), timeZone: GOOGLE_CALENDAR_TIMEZONE },
    end: { dateTime: endAt.toISOString(), timeZone: GOOGLE_CALENDAR_TIMEZONE },
  };
  try {
    const created = await calendar.events.insert({
      calendarId: GOOGLE_CALENDAR_ID,
      requestBody: event,
    });
    return {
      status: "booked",
      message: `Calendar event created (${created.data.id || "ok"})`,
    };
  } catch (err) {
    return {
      status: "failed",
      message: `Calendar booking failed: ${String(err && err.message ? err.message : err).slice(0, 300)}`,
    };
  }
}

async function buildAiAgentHealthReport(req) {
  const issues = [];
  const warnings = [];
  const checks = {
    domain: {
      publicSiteUrl: PUBLIC_SITE_URL || "",
      twilioCallbackBaseUrl: TWILIO_CALLBACK_BASE_URL || "",
      recommendedDomain: PUBLIC_SITE_URL || `${req.protocol}://${req.get("host")}`,
      ok: true,
      notes: [],
    },
    twilio: {
      providerSelected: AI_CALL_PROVIDER === "twilio",
      configured: false,
      credentialsValid: null,
      webhookUrls: {
        voice: twilioWebhookUrl("/api/webhooks/twilio/voice"),
        status: twilioWebhookUrl("/api/webhooks/twilio/status"),
        transcript: twilioWebhookUrl("/api/webhooks/twilio/transcript"),
      },
      missing: [],
      ok: true,
    },
    calendar: {
      enabled: GOOGLE_CALENDAR_ENABLED,
      configured: false,
      credentialsValid: null,
      missing: [],
      ok: true,
    },
  };

  if (!PUBLIC_SITE_URL) {
    checks.domain.ok = false;
    checks.domain.notes.push("Set PUBLIC_SITE_URL=https://your-domain.com");
    issues.push("PUBLIC_SITE_URL is missing");
  } else if (!isValidAbsoluteHttpsUrl(PUBLIC_SITE_URL)) {
    checks.domain.ok = false;
    checks.domain.notes.push("PUBLIC_SITE_URL must be an absolute HTTPS URL");
    issues.push("PUBLIC_SITE_URL is not valid HTTPS");
  } else {
    try {
      const pu = new URL(PUBLIC_SITE_URL);
      if (isLocalHostName(pu.hostname)) {
        checks.domain.ok = false;
        checks.domain.notes.push("PUBLIC_SITE_URL cannot be localhost in production");
        issues.push("PUBLIC_SITE_URL points to localhost");
      }
    } catch {
      // handled above
    }
  }

  const twilioRequired = [
    ["TWILIO_ACCOUNT_SID", TWILIO_ACCOUNT_SID],
    ["TWILIO_AUTH_TOKEN", TWILIO_AUTH_TOKEN],
    ["TWILIO_FROM_NUMBER", TWILIO_FROM_NUMBER],
    ["TWILIO_CALLBACK_BASE_URL", TWILIO_CALLBACK_BASE_URL],
  ];
  for (const [key, val] of twilioRequired) {
    if (!String(val || "").trim()) checks.twilio.missing.push(key);
  }
  if (checks.twilio.missing.length === 0) {
    checks.twilio.configured = true;
  } else {
    checks.twilio.ok = false;
    issues.push(`Twilio missing: ${checks.twilio.missing.join(", ")}`);
  }
  if (TWILIO_CALLBACK_BASE_URL) {
    if (!isValidAbsoluteHttpsUrl(TWILIO_CALLBACK_BASE_URL)) {
      checks.twilio.ok = false;
      issues.push("TWILIO_CALLBACK_BASE_URL must be an absolute HTTPS URL");
    } else {
      const tu = new URL(TWILIO_CALLBACK_BASE_URL);
      if (isLocalHostName(tu.hostname)) {
        checks.twilio.ok = false;
        issues.push("TWILIO_CALLBACK_BASE_URL cannot use localhost");
      }
    }
  }
  if (!TWILIO_VALIDATE_SIGNATURE) {
    warnings.push("TWILIO_VALIDATE_SIGNATURE=false (not recommended for production)");
  }
  if (checks.twilio.configured && twilioClient) {
    try {
      await twilioClient.api.accounts(TWILIO_ACCOUNT_SID).fetch();
      checks.twilio.credentialsValid = true;
    } catch (err) {
      checks.twilio.credentialsValid = false;
      checks.twilio.ok = false;
      issues.push(`Twilio credential check failed: ${String(err && err.message ? err.message : err).slice(0, 200)}`);
    }
  }

  const calendarRequired = [
    ["GOOGLE_CALENDAR_ID", GOOGLE_CALENDAR_ID],
    ["GOOGLE_SERVICE_ACCOUNT_EMAIL", GOOGLE_SERVICE_ACCOUNT_EMAIL],
    ["GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY", GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY],
  ];
  for (const [key, val] of calendarRequired) {
    if (!String(val || "").trim()) checks.calendar.missing.push(key);
  }
  checks.calendar.configured = checks.calendar.missing.length === 0;
  if (GOOGLE_CALENDAR_ENABLED && !checks.calendar.configured) {
    checks.calendar.ok = false;
    issues.push(`Google Calendar missing: ${checks.calendar.missing.join(", ")}`);
  }
  if (GOOGLE_CALENDAR_ENABLED && checks.calendar.configured && googleJwtClient) {
    try {
      const calendarApi = google.calendar({ version: "v3", auth: googleJwtClient });
      await calendarApi.calendars.get({ calendarId: GOOGLE_CALENDAR_ID });
      checks.calendar.credentialsValid = true;
    } catch (err) {
      checks.calendar.credentialsValid = false;
      checks.calendar.ok = false;
      issues.push(
        `Google Calendar credential check failed: ${String(err && err.message ? err.message : err).slice(0, 200)}`
      );
    }
  }

  return {
    ready: checks.domain.ok && checks.twilio.ok && checks.calendar.ok,
    provider: AI_CALL_PROVIDER,
    checks,
    issues,
    warnings,
    nextSteps: [
      "Set PUBLIC_SITE_URL and TWILIO_CALLBACK_BASE_URL to your live HTTPS domain",
      "In Twilio console, configure Voice URL: https://your-domain.com/api/webhooks/twilio/voice",
      "If calendar booking is enabled, share the target calendar with service account email",
    ],
  };
}

async function runAiCallProvider(job) {
  const lead = await getLeadById(job.lead_id);
  if (!lead) {
    return {
      status: "failed",
      providerCallId: "",
      notes: "Lead not found",
      transcript: "",
      appointmentStatus: "not_booked",
      appointmentTime: "",
      resultJson: JSON.stringify({ error: "lead_not_found" }),
    };
  }

  const prompt = buildAiCallPrompt(lead);
  if (AI_CALL_PROVIDER === "twilio") {
    if (!twilioClient || !TWILIO_FROM_NUMBER || !TWILIO_CALLBACK_BASE_URL) {
      return {
        status: "failed",
        providerCallId: "",
        notes: "Twilio config missing. Set TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_FROM_NUMBER, TWILIO_CALLBACK_BASE_URL",
        transcript: "",
        appointmentStatus: "not_booked",
        appointmentTime: "",
        resultJson: JSON.stringify({ provider: "twilio", error: "missing_configuration" }),
      };
    }

    const toNumber = normalizeIndianNumber(lead.mobile);
    const call = await twilioClient.calls.create({
      to: toNumber,
      from: TWILIO_FROM_NUMBER,
      url: twilioWebhookUrl("/api/webhooks/twilio/voice"),
      statusCallback: twilioWebhookUrl("/api/webhooks/twilio/status"),
      statusCallbackMethod: "POST",
      statusCallbackEvent: ["initiated", "ringing", "answered", "completed"],
      machineDetection: "Enable",
    });
    return {
      status: "in_progress",
      deferCompletion: true,
      providerCallId: call.sid,
      notes: "Twilio call initiated",
      transcript: "",
      appointmentStatus: "not_booked",
      appointmentTime: "",
      resultJson: JSON.stringify({ provider: "twilio", sid: call.sid, prompt }),
    };
  }

  if (AI_CALL_PROVIDER !== "mock") {
    return {
      status: "completed",
      providerCallId: "",
      notes: `Provider ${AI_CALL_PROVIDER} configured but integration not yet wired. Use /api/ai-agent/call-result to finalize call outcome.`,
      transcript: "",
      appointmentStatus: "not_booked",
      appointmentTime: "",
      resultJson: JSON.stringify({ provider: AI_CALL_PROVIDER, mode: "pending_integration", prompt }),
    };
  }

  const callbackPref = String(lead.preferred_callback_time || "").trim();
  const fallbackTime = new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString();
  const appointmentTime = callbackPref || fallbackTime;
  const transcript =
    `AI: Hi ${lead.name || "there"}, this is an automated assistant calling only because you requested information.\n` +
    `Lead: Yes, I can talk.\n` +
    `AI: Captured loan requirement for ${lead.loan_type}, city ${lead.city}, amount ${lead.loan_amount}.\n` +
    `AI: Appointment confirmed for ${appointmentTime}.`;

  return {
    status: "completed",
    providerCallId: `mock-${job.id}-${Date.now()}`,
    notes: "Mock AI call completed and appointment proposed",
    transcript,
    appointmentStatus: "booked",
    appointmentTime,
    resultJson: JSON.stringify({ provider: "mock", prompt, outcome: "booked", appointmentTime }),
  };
}

let aiWorkerBusy = false;
async function processNextAiCallJob() {
  if (aiWorkerBusy) return;
  aiWorkerBusy = true;
  try {
    const job = await getPendingAiCallJob();
    if (!job) return;

    const lock = await markAiCallJobInProgress(job.id);
    if (!lock || lock.changes !== 1) return;

    await updateLeadCallOutcome(job.lead_id, {
      callStatus: "in_progress",
      callNotes: "AI call started",
      appointmentStatus: "not_booked",
      appointmentTime: "",
    });

    const result = await runAiCallProvider(job);
    if (result.providerCallId) {
      await setAiCallJobProviderCallId(job.id, result.providerCallId);
    }
    if (!result.deferCompletion) {
      await completeAiCallJob(job.id, {
        status: result.status === "failed" ? "failed" : "completed",
        providerCallId: result.providerCallId,
        transcript: result.transcript,
        resultJson: result.resultJson,
      });
    }

    await updateLeadCallOutcome(job.lead_id, {
      callStatus: result.deferCompletion ? "in_progress" : result.status === "failed" ? "failed" : "completed",
      callNotes: result.notes,
      callTranscript: result.transcript,
      appointmentStatus: result.appointmentStatus,
      appointmentTime: result.appointmentTime,
    });

    if (!result.deferCompletion && result.appointmentStatus === "booked" && result.appointmentTime) {
      const leadAfterCall = await getLeadById(job.lead_id);
      const booking = await maybeBookGoogleCalendarEvent(leadAfterCall || { id: job.lead_id }, result.appointmentTime);
      if (booking.status !== "skipped") {
        await updateLeadCallOutcome(job.lead_id, {
          callStatus: result.status === "failed" ? "failed" : "completed",
          callNotes: `${result.notes} | ${booking.message}`.slice(0, 500),
          callTranscript: result.transcript,
          appointmentStatus: result.appointmentStatus,
          appointmentTime: result.appointmentTime,
        });
      }
    }
  } catch (err) {
    console.error("AI call worker error:", err && err.message ? err.message : err);
  } finally {
    aiWorkerBusy = false;
  }
}

function hasAdminSessionSecret() {
  return ADMIN_SESSION_SECRET.length >= 32;
}

function toBase64Url(input) {
  return Buffer.from(input)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function fromBase64Url(input) {
  const normalized = String(input || "").replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized + "=".repeat((4 - (normalized.length % 4 || 4)) % 4);
  return Buffer.from(padded, "base64").toString("utf8");
}

function createAdminSessionToken() {
  if (!hasAdminSessionSecret()) return "";
  const payload = {
    sub: ADMIN_USERNAME,
    iat: Date.now(),
    exp: Date.now() + ADMIN_SESSION_TTL_MS,
    nonce: crypto.randomBytes(16).toString("hex"),
  };
  const payloadB64 = toBase64Url(JSON.stringify(payload));
  const sig = crypto.createHmac("sha256", ADMIN_SESSION_SECRET).update(payloadB64).digest("base64url");
  return `${payloadB64}.${sig}`;
}

function validateAdminSessionToken(token = "") {
  if (!token || !hasAdminSessionSecret()) return false;
  const [payloadB64, sig] = String(token).split(".");
  if (!payloadB64 || !sig) return false;
  const expectedSig = crypto.createHmac("sha256", ADMIN_SESSION_SECRET).update(payloadB64).digest("base64url");
  try {
    if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expectedSig))) {
      return false;
    }
  } catch {
    return false;
  }

  try {
    const payload = JSON.parse(fromBase64Url(payloadB64));
    if (!payload || typeof payload !== "object") return false;
    if (payload.sub !== ADMIN_USERNAME) return false;
    if (!Number.isFinite(payload.exp) || Date.now() > payload.exp) return false;
    return true;
  } catch {
    return false;
  }
}

function setAdminCookie(res, token) {
  res.cookie(ADMIN_COOKIE_NAME, encodeURIComponent(token), {
    httpOnly: true,
    sameSite: "lax",
    secure: IS_PRODUCTION,
    maxAge: ADMIN_SESSION_TTL_MS,
    path: "/",
  });
}

function clearAdminCookie(res) {
  res.cookie(ADMIN_COOKIE_NAME, "", {
    httpOnly: true,
    sameSite: "lax",
    secure: IS_PRODUCTION,
    maxAge: 0,
    path: "/",
  });
}

function requireAdminAuth(req, res, next) {
  const suppliedKey = req.get("x-admin-key");
  if (ADMIN_API_KEY && suppliedKey && suppliedKey === ADMIN_API_KEY) {
    return next();
  }

  const cookies = parseCookieHeader(req.headers.cookie || "");
  const token = cookies[ADMIN_COOKIE_NAME];
  if (validateAdminSessionToken(token)) {
    return next();
  }

  if (!ADMIN_API_KEY && !ADMIN_PASSWORD) {
    return res.status(503).json({
      success: false,
      message: "Admin auth is not configured. Set ADMIN_PASSWORD or ADMIN_API_KEY.",
    });
  }

  return res.status(401).json({
    success: false,
    message: "Unauthorized",
  });
}

function normalizeDsaBaseUrl(raw) {
  const fallback = "https://api.dsasathi.com/v1";
  const u = String(raw || "").trim() || fallback;
  return u.replace(/\/+$/, "");
}

function loanTypeToDsasathiSlug(displayType) {
  const map = {
    "Home Loan": "home_loan",
    "Loan Against Property (LAP)": "lap",
    "Project Loan": "project_loan",
    "Builder Funding - Micro CF": "builder_funding_micro_cf",
    "Business Loan": "business_loan",
    "Personal Loan": "personal_loan",
    "Vehicle Loan (New)": "vehicle_loan",
    "Vehicle Loan (Old)": "vehicle_loan_used",
  };
  if (map[displayType]) return map[displayType];
  return String(displayType || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "") || "personal_loan";
}

function parseLoanAmountForDsa(raw) {
  const rawStr = String(raw || "").trim();
  if (!rawStr) return null;
  const lower = rawStr.toLowerCase().replace(/,/g, "");
  const lac = lower.match(/([\d.]+)\s*(lac|lakh|lacs?|lakhs?)\b/);
  if (lac) {
    const n = Number(lac[1]);
    if (Number.isFinite(n) && n > 0) return Math.round(n * 100000);
  }
  const cr = lower.match(/([\d.]+)\s*(crore|crs?|cr\.?)\b/);
  if (cr) {
    const n = Number(cr[1]);
    if (Number.isFinite(n) && n > 0) return Math.round(n * 10000000);
  }
  const digits = lower.replace(/[^0-9.]/g, "");
  const n = Number(digits);
  if (Number.isFinite(n) && n > 0) return Math.round(n);
  return rawStr;
}

function normalizeMobileForDsa(mobile) {
  const d = String(mobile || "").replace(/\D/g, "");
  if (d.length > 10) return d.slice(-10);
  return d;
}

async function pushLeadToDsasathi(localLeadId, leadPayload) {
  try {
    if (!DSASATHI_API_KEY) {
      await updateLeadDsasathiSync(localLeadId, "skipped", "DSA Sathi API key not set");
      return;
    }

    const base = normalizeDsaBaseUrl(DSASATHI_API_BASE_URL);
    const url = `${base}/leads`;
    const loanAmount = parseLoanAmountForDsa(leadPayload.loanAmount);
    const body = {
      name: leadPayload.name,
      mobile: normalizeMobileForDsa(leadPayload.mobile),
      loan_type: loanTypeToDsasathiSlug(leadPayload.loanType),
      city: leadPayload.city,
      source: DSASATHI_SOURCE,
    };
    if (loanAmount != null) {
      body.loan_amount = loanAmount;
    }
    if (DSASATHI_ASSIGNED_TO) {
      body.assigned_to = DSASATHI_ASSIGNED_TO;
    }

    const controller = new AbortController();
    const timeoutMs = 15000;
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let response;
    try {
      response = await fetch(url, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${DSASATHI_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }

    const text = await response.text();
    let data = {};
    if (text) {
      try {
        data = JSON.parse(text);
      } catch {
        data = {};
      }
    }

    const okHttp = response.status === 200 || response.status === 201;
    const leadIdRemote =
      data.lead_id ||
      data.leadId ||
      (data.data && (data.data.lead_id || data.data.leadId)) ||
      (typeof data.id === "string" ? data.id : "") ||
      "";
    const statusLower = String(data.status || "").toLowerCase();
    const statusOk =
      statusLower === "success" ||
      (okHttp && (!!leadIdRemote || String(data.message || "").toLowerCase().includes("success")));

    if (okHttp && statusOk) {
      await updateLeadDsasathiSync(
        localLeadId,
        "sent",
        String(data.message || "Lead synced to DSA Sathi").slice(0, 500),
        leadIdRemote
      );
      return;
    }

    const errMsg =
      data.message ||
      data.error ||
      (text ? text.slice(0, 400) : "") ||
      `${response.status} ${response.statusText || ""}`.trim() ||
      "DSA Sathi request failed";
    const errCode = data.code ? ` [${data.code}]` : "";
    await updateLeadDsasathiSync(localLeadId, "failed", `${errMsg}${errCode}`.slice(0, 500), "");
  } catch (err) {
    const msg =
      err && err.name === "AbortError"
        ? "DSA Sathi request timed out"
        : String(err && err.message ? err.message : err || "Unexpected error");
    await updateLeadDsasathiSync(localLeadId, "failed", msg.slice(0, 500), "");
    console.error("DSA Sathi push failed:", msg);
  }
}

function toCsv(rows) {
  const headers = [
    "id",
    "name",
    "loan_type",
    "loan_amount",
    "city",
    "mobile",
    "email",
    "dsasathi_status",
    "dsasathi_lead_id",
    "dsasathi_message",
    "dsasathi_webhook_event",
    "dsasathi_webhook_at",
    "dsasathi_webhook_summary",
    "dsasathi_crm_loan_id",
    "dsasathi_crm_loan_status",
    "dsasathi_crm_assigned_to",
    "created_at",
  ];
  const escapeCell = (value) => {
    const raw = value == null ? "" : String(value);
    return `"${raw.replace(/"/g, '""')}"`;
  };

  const lines = [
    headers.join(","),
    ...rows.map((row) => headers.map((key) => escapeCell(row[key])).join(",")),
  ];
  return lines.join("\n");
}

function toDsaSathiCsv(rows) {
  const headers = [
    "name",
    "phone",
    "email",
    "city",
    "loan_type",
    "loan_amount",
    "source",
    "created_at",
  ];
  const escapeCell = (value) => {
    const raw = value == null ? "" : String(value);
    return `"${raw.replace(/"/g, '""')}"`;
  };
  const lines = [
    headers.join(","),
    ...rows.map((row) =>
      [
        row.name || "",
        row.mobile || "",
        row.email || "",
        row.city || "",
        row.loan_type || "",
        row.loan_amount || "",
        "MR OK Website",
        row.created_at || "",
      ]
        .map((cell) => escapeCell(cell))
        .join(",")
    ),
  ];
  return lines.join("\n");
}

async function sendLeadNotification(leadPayload, leadId) {
  if (!mailTransporter || !MAIL_FROM || !LEAD_NOTIFICATION_TO) {
    return { status: "skipped", message: "Email not configured" };
  }

  const submittedAt = new Date().toLocaleString("en-IN");
  const html = `
    <h2>New Loan Application Received</h2>
    <p>A new lead was submitted from the MR OK Financial Services website.</p>
    <table border="1" cellpadding="8" cellspacing="0" style="border-collapse: collapse;">
      <tr><td><strong>Lead ID</strong></td><td>${leadId}</td></tr>
      <tr><td><strong>Name</strong></td><td>${leadPayload.name}</td></tr>
      <tr><td><strong>Loan Type</strong></td><td>${leadPayload.loanType}</td></tr>
      <tr><td><strong>Loan Amount</strong></td><td>${leadPayload.loanAmount}</td></tr>
      <tr><td><strong>City</strong></td><td>${leadPayload.city}</td></tr>
      <tr><td><strong>Mobile</strong></td><td>${leadPayload.mobile}</td></tr>
      <tr><td><strong>Email</strong></td><td>${leadPayload.email}</td></tr>
      <tr><td><strong>Submitted At</strong></td><td>${submittedAt}</td></tr>
    </table>
  `;

  await mailTransporter.sendMail({
    from: MAIL_FROM,
    to: LEAD_NOTIFICATION_TO,
    subject: `New Loan Application #${leadId} - ${leadPayload.loanType}`,
    html,
    text: `New Loan Application
Lead ID: ${leadId}
Name: ${leadPayload.name}
Loan Type: ${leadPayload.loanType}
Loan Amount: ${leadPayload.loanAmount}
City: ${leadPayload.city}
Mobile: ${leadPayload.mobile}
Email: ${leadPayload.email}
Submitted At: ${submittedAt}`,
  });
  return { status: "sent", message: "Email delivered" };
}

app.post("/api/admin/login", (req, res) => {
  const { username = "", password = "" } = req.body || {};
  const inputUsername = String(username || "").trim().toLowerCase();
  const inputPassword = String(password || "").trim();
  const expectedUsername = String(ADMIN_USERNAME || "").trim().toLowerCase();
  const expectedPassword = String(ADMIN_PASSWORD || "").trim();
  if (!ADMIN_PASSWORD) {
    return res.status(401).json({
      success: false,
      message: "Admin login is disabled. Set ADMIN_PASSWORD in .env",
    });
  }

  if (inputUsername !== expectedUsername || inputPassword !== expectedPassword) {
    return res.status(401).json({
      success: false,
      message: "Invalid credentials",
    });
  }

  if (!hasAdminSessionSecret()) {
    return res.status(503).json({
      success: false,
      message: "Admin session secret is missing. Set ADMIN_SESSION_SECRET (min 32 chars).",
    });
  }

  const token = createAdminSessionToken();
  setAdminCookie(res, token);
  return res.json({ success: true, message: "Logged in successfully" });
});

app.post("/api/admin/logout", (_req, res) => {
  clearAdminCookie(res);
  return res.json({ success: true });
});

app.get("/api/admin/me", (req, res) => {
  const cookies = parseCookieHeader(req.headers.cookie || "");
  const token = cookies[ADMIN_COOKIE_NAME];
  const authenticated = validateAdminSessionToken(token);
  return res.json({ success: true, authenticated });
});

app.get("/api/admin/ai-call-jobs", requireAdminAuth, async (req, res) => {
  const status = String(req.query.status || "");
  const limit = Number(req.query.limit || 50);
  try {
    const items = await listAiCallJobs({ status, limit });
    return res.json({ success: true, items });
  } catch (error) {
    return res.status(500).json({ success: false, message: "Failed to fetch AI call jobs" });
  }
});

app.get("/api/admin/ai-agent/health", requireAdminAuth, async (req, res) => {
  try {
    const report = await buildAiAgentHealthReport(req);
    const status = report.ready ? 200 : 503;
    return res.status(status).json({
      success: report.ready,
      ...report,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: "Failed to build AI agent health report",
    });
  }
});

app.post("/api/ai-agent/call-result", requireAdminAuth, async (req, res) => {
  const schema = z.object({
    leadId: z.number().int().positive(),
    callStatus: z.enum(["completed", "failed", "do_not_call", "no_answer"]),
    notes: z.string().max(500).optional().default(""),
    transcript: z.string().max(12000).optional().default(""),
    appointmentStatus: z.enum(["booked", "not_booked"]).optional().default("not_booked"),
    appointmentTime: z.string().max(80).optional().default(""),
  });

  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({
      success: false,
      message: "Validation failed",
      errors: parsed.error.flatten(),
    });
  }

  try {
    await updateLeadCallOutcome(parsed.data.leadId, {
      callStatus: parsed.data.callStatus,
      callNotes: parsed.data.notes,
      callTranscript: parsed.data.transcript,
      appointmentStatus: parsed.data.appointmentStatus,
      appointmentTime: parsed.data.appointmentTime,
    });
    const latestJob = await getLatestAiCallJobByLeadId(parsed.data.leadId);
    if (latestJob && latestJob.status === "in_progress") {
      await completeAiCallJob(latestJob.id, {
        status: parsed.data.callStatus === "failed" ? "failed" : "completed",
        providerCallId: latestJob.provider_call_id || "",
        transcript: parsed.data.transcript,
        resultJson: JSON.stringify(parsed.data),
      });
    }
    if (parsed.data.appointmentStatus === "booked" && parsed.data.appointmentTime) {
      const lead = await getLeadById(parsed.data.leadId);
      const booking = await maybeBookGoogleCalendarEvent(lead || { id: parsed.data.leadId }, parsed.data.appointmentTime);
      if (booking.status !== "skipped") {
        await updateLeadCallOutcome(parsed.data.leadId, {
          callStatus: parsed.data.callStatus,
          callNotes: `${parsed.data.notes} | ${booking.message}`.slice(0, 500),
          callTranscript: parsed.data.transcript,
          appointmentStatus: parsed.data.appointmentStatus,
          appointmentTime: parsed.data.appointmentTime,
        });
      }
    }
    return res.json({ success: true, message: "Call outcome updated" });
  } catch (error) {
    return res.status(500).json({ success: false, message: "Failed to update call outcome" });
  }
});

app.post("/api/leads", async (req, res) => {
  const parsed = leadSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({
      success: false,
      message: "Validation failed",
      errors: parsed.error.flatten(),
    });
  }

  const payload = parsed.data;

  try {
    const result = await insertLead(payload);
    await updateLeadAiProfile(result.id, {
      state: payload.state,
      incomeRange: payload.incomeRange,
      preferredCallbackTime: payload.preferredCallbackTime,
      consent: payload.consent,
      consentTime: payload.consentTime || new Date().toISOString(),
      source: payload.source || "website",
    });
    const aiDecision = await evaluateAndQueueLeadForAiCall(result.id, payload);

    if (GOOGLE_SCRIPT_URL) {
      fetch(GOOGLE_SCRIPT_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...payload,
          submittedAt: new Date().toISOString(),
        }),
      }).catch(() => {
        // Non-blocking relay: local persistence succeeds even if Sheets fails.
      });
    }

    sendLeadNotification(payload, result.id)
      .then((emailResult) => {
        return updateLeadEmailStatus(result.id, emailResult.status, emailResult.message);
      })
      .catch((err) => {
        updateLeadEmailStatus(result.id, "failed", err.message).catch(() => {
          // ignore secondary update errors
        });
        console.error("Lead notification email failed:", err.message);
      });

    pushLeadToDsasathi(result.id, payload).catch(() => {
      // pushLeadToDsasathi already updates DB and logs; guard against unexpected throws
    });

    return res.status(201).json({
      success: true,
      message: "Lead submitted successfully",
      leadId: result.id,
      aiCall: aiDecision,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: "Internal server error",
    });
  }
});

app.get("/api/admin/leads", requireAdminAuth, async (req, res) => {
  const page = Number(req.query.page || 1);
  const limit = Number(req.query.limit || 10);
  const query = String(req.query.q || "");
  const from = String(req.query.from || "");
  const to = String(req.query.to || "");

  try {
    const result = await listLeads({ page, limit, query, from, to });
    return res.json({
      success: true,
      ...result,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: "Failed to fetch leads",
    });
  }
});

app.get("/api/admin/leads/export.csv", requireAdminAuth, async (req, res) => {
  const query = String(req.query.q || "");
  const from = String(req.query.from || "");
  const to = String(req.query.to || "");

  try {
    const rows = await exportLeads({ query, from, to });
    const csv = toCsv(rows);
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");

    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="mrok-leads-${timestamp}.csv"`
    );
    return res.status(200).send(csv);
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: "Failed to export leads",
    });
  }
});

app.get("/api/admin/leads/export-dsasathi.csv", requireAdminAuth, async (req, res) => {
  const query = String(req.query.q || "");
  const from = String(req.query.from || "");
  const to = String(req.query.to || "");

  try {
    const rows = await exportLeads({ query, from, to });
    const csv = toDsaSathiCsv(rows);
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="mrok-dsasathi-leads-${timestamp}.csv"`
    );
    return res.status(200).send(csv);
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: "Failed to export DSA Sathi CSV",
    });
  }
});

app.use("/api", (_req, res) => {
  return res.status(404).json({
    success: false,
    message: "API route not found",
  });
});

app.use((err, req, res, next) => {
  if (!req.path.startsWith("/api")) return next(err);
  if (res.headersSent) return next(err);

  if (err && err.type === "entity.parse.failed") {
    return res.status(400).json({
      success: false,
      message: "Invalid JSON payload",
    });
  }

  const status = Number(err && err.status) || 500;
  const message = status >= 500 ? "Internal server error" : String(err && err.message) || "Request failed";
  if (status >= 500) {
    console.error("API error:", err && err.message ? err.message : err);
  }
  return res.status(status).json({
    success: false,
    message,
  });
});

app.use(async (req, res, next) => {
  if (req.method !== "GET" || req.path.startsWith("/api")) return next();

  let fileName;
  if (req.path === "/" || req.path === "/index.html") {
    fileName = "index.html";
  } else if (req.path.endsWith(".html")) {
    fileName = path.basename(req.path);
  } else {
    return next();
  }

  if (!OG_HTML_FILES.has(fileName)) return next();

  const canonicalPath =
    OG_CANONICAL_PATH_BY_FILE[fileName] ||
    (req.path === "/index.html" || req.path === "/" ? "/" : req.path);

  try {
    await sendHtmlWithOg(req, res, fileName, canonicalPath);
  } catch (error) {
    next(error);
  }
});

function isSensitiveStaticPath(urlPath) {
  const raw = String(urlPath || "").split("?")[0];
  const p = path.posix.normalize(raw.replace(/\\/g, "/"));
  if (p.includes("\0")) return true;
  if (/(?:^|\/)\.\.(?:\/|$)/.test(p)) return true;
  const blockedExact = new Set([
    "/server.js",
    "/package.json",
    "/package-lock.json",
    "/.env",
    "/.env.example",
    "/.env.local",
  ]);
  if (blockedExact.has(p)) return true;
  const blockedPrefixes = ["/src/", "/node_modules/", "/data/", "/.git/"];
  return blockedPrefixes.some((prefix) => p === prefix.slice(0, -1) || p.startsWith(prefix));
}

function looksLikeStaticAssetPath(urlPath) {
  const p = String(urlPath || "").split("?")[0];
  return /\.[a-z0-9]{2,8}$/i.test(p);
}

app.use((req, res, next) => {
  if (req.method !== "GET" && req.method !== "HEAD") return next();
  if (isSensitiveStaticPath(req.path)) {
    return res.status(404).type("txt").send("Not found");
  }
  return next();
});

app.use(express.static(PUBLIC_DIR));

app.get("/admin", (req, res, next) => {
  sendHtmlWithOg(req, res, "admin.html", "/admin").catch(next);
});

app.get("/about", (req, res, next) => {
  sendHtmlWithOg(req, res, "about.html", "/about").catch(next);
});

app.get("/personal-loan", (req, res, next) => {
  sendHtmlWithOg(req, res, "personal-loan.html", "/personal-loan").catch(next);
});

app.get("/home-loan", (req, res, next) => {
  sendHtmlWithOg(req, res, "home-loan.html", "/home-loan").catch(next);
});

app.get("/lap-loan", (req, res, next) => {
  sendHtmlWithOg(req, res, "lap-loan.html", "/lap-loan").catch(next);
});

app.get("/business-loan", (req, res, next) => {
  sendHtmlWithOg(req, res, "business-loan.html", "/business-loan").catch(next);
});

app.get("/vehicle-loan", (req, res, next) => {
  sendHtmlWithOg(req, res, "vehicle-loan.html", "/vehicle-loan").catch(next);
});

app.get("/project-loan", (req, res, next) => {
  sendHtmlWithOg(req, res, "project-loan.html", "/project-loan").catch(next);
});

app.get("/builder-funding-micro-cf", (req, res, next) => {
  sendHtmlWithOg(req, res, "builder-funding-micro-cf.html", "/builder-funding-micro-cf").catch(next);
});

app.get(/.*/, (req, res, next) => {
  if (looksLikeStaticAssetPath(req.path)) {
    return res.status(404).type("txt").send("Not found");
  }
  sendHtmlWithOg(req, res, "index.html", req.path).catch(next);
});

initDb()
  .then(() => {
    setInterval(processNextAiCallJob, AI_CALL_WORKER_INTERVAL_MS);
    setTimeout(processNextAiCallJob, 1000);
    app.listen(PORT, "0.0.0.0", () => {
      console.log(`Server running on http://0.0.0.0:${PORT}`);
    });
  })
  .catch((error) => {
    console.error("Failed to initialize database", error);
    process.exit(1);
  });
