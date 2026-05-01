const dotenv = require("dotenv");
dotenv.config({ override: true });
const path = require("path");
const fsSync = require("fs");
const fs = require("fs/promises");
const crypto = require("crypto");
const express = require("express");
const helmet = require("helmet");
const cors = require("cors");
const morgan = require("morgan");
const rateLimit = require("express-rate-limit");
const { z } = require("zod");
const {
  initDb,
  insertLead,
  updateLeadAiProfile,
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
let dbReady = false;
let dbInitErrorMessage = "";

process.on("uncaughtException", (err) => {
  console.error("uncaughtException", err);
});
process.on("unhandledRejection", (reason) => {
  console.error("unhandledRejection", reason);
});
const PUBLIC_DIR = path.join(__dirname, "public");
const GOOGLE_SCRIPT_URL = process.env.GOOGLE_SCRIPT_URL || "";
const ADMIN_API_KEY = getEnvValue("ADMIN_API_KEY", "");
const ADMIN_USERNAME = getEnvValue("ADMIN_USERNAME", "admin");
const ADMIN_PASSWORD = getEnvValue("ADMIN_PASSWORD", "");
const ADMIN_COOKIE_NAME = "mrok_admin_session";
const ADMIN_SESSION_SECRET = String(getEnvValue("ADMIN_SESSION_SECRET", "") || "").trim();
const ADMIN_SESSION_TTL_MS = 12 * 60 * 60 * 1000;
const IS_PRODUCTION = process.env.NODE_ENV === "production";
const TRUST_PROXY = String(process.env.TRUST_PROXY || "false").trim();
const PUBLIC_SITE_URL = String(process.env.PUBLIC_SITE_URL || "").trim().replace(/\/$/, "");

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
  html = injectThemeToggle(html);
  res.type("html").send(html);
}

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
    crossOriginOpenerPolicy: false,
    originAgentCluster: false,
    crossOriginEmbedderPolicy: false,
    crossOriginResourcePolicy: { policy: "cross-origin" },
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", "'unsafe-inline'", "https://cdn.tailwindcss.com"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", "data:", "blob:"],
        connectSrc: ["'self'"],
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

app.use(express.json({ limit: "100kb" }));
app.use(express.urlencoded({ extended: false, limit: "100kb" }));

const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 50,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    message: "Too many requests. Please try again later.",
  },
});

app.use("/api", apiLimiter);

app.get("/health", (_req, res) => {
  res.json({
    success: true,
    status: "ok",
    dbReady,
    dbInitError: dbInitErrorMessage,
  });
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

function toCsv(rows) {
  const headers = [
    "id",
    "name",
    "loan_type",
    "loan_amount",
    "city",
    "mobile",
    "email",
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

    return res.status(201).json({
      success: true,
      message: "Lead submitted successfully",
      leadId: result.id,
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

console.log("[startup]", {
  cwd: process.cwd(),
  envPort: process.env.PORT || "",
  resolvedPort: PORT,
  node: process.version,
});

const server = app.listen(PORT, "0.0.0.0", () => {
  console.log(`Server running on http://0.0.0.0:${PORT}`);
});

server.on("error", (err) => {
  console.error("HTTP server listen error", err);
  process.exit(1);
});

initDb()
  .then(() => {
    dbReady = true;
    dbInitErrorMessage = "";
    console.log("Database initialized successfully");
  })
  .catch((error) => {
    dbReady = false;
    dbInitErrorMessage = String(error && error.message ? error.message : error || "Unknown error");
    console.error("Database initialization failed (app still running):", error);
  });
