const fs = require("fs");
const path = require("path");
const os = require("os");
const sqlite3 = require("sqlite3");

let dataDir = path.join(__dirname, "..", "data");

try {
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }
} catch (_error) {
  // Some managed hosts don't allow writes in app directory; fallback to OS tmp.
  dataDir = path.join(os.tmpdir(), "mrok_financial_services");
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }
}

const dbPath = path.join(dataDir, "leads.db");
const db = new sqlite3.Database(dbPath);

function run(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function onRun(err) {
      if (err) return reject(err);
      return resolve({ id: this.lastID, changes: this.changes });
    });
  });
}

function get(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => {
      if (err) return reject(err);
      return resolve(row);
    });
  });
}

function all(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) return reject(err);
      return resolve(rows);
    });
  });
}

async function initDb() {
  const sql = `
    CREATE TABLE IF NOT EXISTS leads (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL DEFAULT '',
      loan_type TEXT NOT NULL,
      loan_amount TEXT NOT NULL,
      city TEXT NOT NULL,
      mobile TEXT NOT NULL,
      email TEXT NOT NULL DEFAULT '',
      email_status TEXT NOT NULL DEFAULT 'pending',
      email_status_message TEXT NOT NULL DEFAULT '',
      dsasathi_status TEXT NOT NULL DEFAULT 'pending',
      dsasathi_message TEXT NOT NULL DEFAULT '',
      dsasathi_lead_id TEXT NOT NULL DEFAULT '',
      dsasathi_webhook_event TEXT NOT NULL DEFAULT '',
      dsasathi_webhook_at TEXT NOT NULL DEFAULT '',
      dsasathi_webhook_summary TEXT NOT NULL DEFAULT '',
      dsasathi_crm_loan_id TEXT NOT NULL DEFAULT '',
      dsasathi_crm_loan_status TEXT NOT NULL DEFAULT '',
      dsasathi_crm_assigned_to TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL
    );
  `;
  await run(sql);

  await run(`
    CREATE TABLE IF NOT EXISTS dsasathi_webhook_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      received_at TEXT NOT NULL,
      event TEXT NOT NULL DEFAULT '',
      remote_lead_id TEXT NOT NULL DEFAULT '',
      local_lead_id INTEGER,
      payload_json TEXT NOT NULL DEFAULT ''
    );
  `);

  await run(`
    CREATE TABLE IF NOT EXISTS ai_call_jobs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      lead_id INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'queued',
      reason TEXT NOT NULL DEFAULT '',
      score INTEGER NOT NULL DEFAULT 0,
      provider_call_id TEXT NOT NULL DEFAULT '',
      transcript TEXT NOT NULL DEFAULT '',
      result_json TEXT NOT NULL DEFAULT '',
      queued_at TEXT NOT NULL,
      started_at TEXT NOT NULL DEFAULT '',
      completed_at TEXT NOT NULL DEFAULT ''
    );
  `);

  // Backward-compatible migration for existing databases without email column.
  try {
    await run("ALTER TABLE leads ADD COLUMN name TEXT NOT NULL DEFAULT ''");
  } catch (error) {
    if (!String(error.message).includes("duplicate column name")) {
      throw error;
    }
  }

  try {
    await run("ALTER TABLE leads ADD COLUMN email TEXT NOT NULL DEFAULT ''");
  } catch (error) {
    if (!String(error.message).includes("duplicate column name")) {
      throw error;
    }
  }

  try {
    await run("ALTER TABLE leads ADD COLUMN email_status TEXT NOT NULL DEFAULT 'pending'");
  } catch (error) {
    if (!String(error.message).includes("duplicate column name")) {
      throw error;
    }
  }

  try {
    await run("ALTER TABLE leads ADD COLUMN email_status_message TEXT NOT NULL DEFAULT ''");
  } catch (error) {
    if (!String(error.message).includes("duplicate column name")) {
      throw error;
    }
  }

  try {
    await run("ALTER TABLE leads ADD COLUMN dsasathi_status TEXT NOT NULL DEFAULT 'pending'");
  } catch (error) {
    if (!String(error.message).includes("duplicate column name")) {
      throw error;
    }
  }

  try {
    await run("ALTER TABLE leads ADD COLUMN dsasathi_message TEXT NOT NULL DEFAULT ''");
  } catch (error) {
    if (!String(error.message).includes("duplicate column name")) {
      throw error;
    }
  }

  try {
    await run("ALTER TABLE leads ADD COLUMN dsasathi_lead_id TEXT NOT NULL DEFAULT ''");
  } catch (error) {
    if (!String(error.message).includes("duplicate column name")) {
      throw error;
    }
  }

  const webhookCols = [
    "ALTER TABLE leads ADD COLUMN dsasathi_webhook_event TEXT NOT NULL DEFAULT ''",
    "ALTER TABLE leads ADD COLUMN dsasathi_webhook_at TEXT NOT NULL DEFAULT ''",
    "ALTER TABLE leads ADD COLUMN dsasathi_webhook_summary TEXT NOT NULL DEFAULT ''",
    "ALTER TABLE leads ADD COLUMN dsasathi_crm_loan_id TEXT NOT NULL DEFAULT ''",
    "ALTER TABLE leads ADD COLUMN dsasathi_crm_loan_status TEXT NOT NULL DEFAULT ''",
    "ALTER TABLE leads ADD COLUMN dsasathi_crm_assigned_to TEXT NOT NULL DEFAULT ''",
  ];
  for (const sql of webhookCols) {
    try {
      await run(sql);
    } catch (error) {
      if (!String(error.message).includes("duplicate column name")) {
        throw error;
      }
    }
  }

  const aiLeadCols = [
    "ALTER TABLE leads ADD COLUMN lead_state TEXT NOT NULL DEFAULT ''",
    "ALTER TABLE leads ADD COLUMN income_range TEXT NOT NULL DEFAULT ''",
    "ALTER TABLE leads ADD COLUMN preferred_callback_time TEXT NOT NULL DEFAULT ''",
    "ALTER TABLE leads ADD COLUMN consent_status INTEGER NOT NULL DEFAULT 0",
    "ALTER TABLE leads ADD COLUMN consent_timestamp TEXT NOT NULL DEFAULT ''",
    "ALTER TABLE leads ADD COLUMN lead_source TEXT NOT NULL DEFAULT 'website'",
    "ALTER TABLE leads ADD COLUMN ai_lead_score INTEGER NOT NULL DEFAULT 0",
    "ALTER TABLE leads ADD COLUMN call_status TEXT NOT NULL DEFAULT 'not_queued'",
    "ALTER TABLE leads ADD COLUMN last_call_attempt_at TEXT NOT NULL DEFAULT ''",
    "ALTER TABLE leads ADD COLUMN appointment_status TEXT NOT NULL DEFAULT 'not_booked'",
    "ALTER TABLE leads ADD COLUMN appointment_time TEXT NOT NULL DEFAULT ''",
    "ALTER TABLE leads ADD COLUMN call_notes TEXT NOT NULL DEFAULT ''",
    "ALTER TABLE leads ADD COLUMN call_transcript TEXT NOT NULL DEFAULT ''",
  ];
  for (const sql of aiLeadCols) {
    try {
      await run(sql);
    } catch (error) {
      if (!String(error.message).includes("duplicate column name")) {
        throw error;
      }
    }
  }
}

function insertLead(payload) {
  const sql = `
    INSERT INTO leads (name, loan_type, loan_amount, city, mobile, email, email_status, email_status_message, dsasathi_status, dsasathi_message, dsasathi_lead_id, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `;
  return run(sql, [
    payload.name,
    payload.loanType,
    payload.loanAmount,
    payload.city,
    payload.mobile,
    payload.email,
    "pending",
    "",
    "pending",
    "",
    "",
    new Date().toISOString(),
  ]);
}

function updateLeadAiProfile(leadId, payload = {}) {
  const sql = `
    UPDATE leads SET
      lead_state = ?,
      income_range = ?,
      preferred_callback_time = ?,
      consent_status = ?,
      consent_timestamp = ?,
      lead_source = ?
    WHERE id = ?
  `;
  return run(sql, [
    String(payload.state || "").slice(0, 80),
    String(payload.incomeRange || "").slice(0, 80),
    String(payload.preferredCallbackTime || "").slice(0, 80),
    payload.consent === true ? 1 : 0,
    String(payload.consentTime || "").slice(0, 80),
    String(payload.source || "website").slice(0, 80),
    leadId,
  ]);
}

function updateLeadAiDecision(leadId, { score = 0, status = "not_queued", notes = "" } = {}) {
  const sql = `
    UPDATE leads
    SET ai_lead_score = ?, call_status = ?, call_notes = ?
    WHERE id = ?
  `;
  return run(sql, [Number(score) || 0, String(status || "not_queued"), String(notes || "").slice(0, 500), leadId]);
}

function createAiCallJob({ leadId, score = 0, reason = "" }) {
  const sql = `
    INSERT INTO ai_call_jobs (lead_id, status, reason, score, queued_at)
    VALUES (?, 'queued', ?, ?, ?)
  `;
  return run(sql, [leadId, String(reason || "").slice(0, 500), Number(score) || 0, new Date().toISOString()]);
}

function getPendingAiCallJob() {
  return get(
    `
      SELECT j.id, j.lead_id, j.status, j.reason, j.score, l.name, l.mobile, l.loan_type, l.loan_amount, l.city, l.lead_state, l.preferred_callback_time, l.lead_source, l.consent_status
      FROM ai_call_jobs j
      JOIN leads l ON l.id = j.lead_id
      WHERE j.status = 'queued'
      ORDER BY j.score DESC, j.id ASC
      LIMIT 1
    `
  );
}

function markAiCallJobInProgress(jobId) {
  return run(
    `
      UPDATE ai_call_jobs
      SET status = 'in_progress', started_at = ?
      WHERE id = ? AND status = 'queued'
    `,
    [new Date().toISOString(), jobId]
  );
}

function completeAiCallJob(jobId, details = {}) {
  const sql = `
    UPDATE ai_call_jobs
    SET status = ?, provider_call_id = ?, transcript = ?, result_json = ?, completed_at = ?
    WHERE id = ?
  `;
  return run(sql, [
    String(details.status || "completed"),
    String(details.providerCallId || "").slice(0, 200),
    String(details.transcript || "").slice(0, 12000),
    String(details.resultJson || "").slice(0, 12000),
    new Date().toISOString(),
    jobId,
  ]);
}

function getAiCallJobByProviderCallId(providerCallId) {
  return get("SELECT * FROM ai_call_jobs WHERE provider_call_id = ? LIMIT 1", [
    String(providerCallId || "").slice(0, 200),
  ]);
}

function getLatestAiCallJobByLeadId(leadId) {
  return get("SELECT * FROM ai_call_jobs WHERE lead_id = ? ORDER BY id DESC LIMIT 1", [leadId]);
}

function setAiCallJobProviderCallId(jobId, providerCallId) {
  return run("UPDATE ai_call_jobs SET provider_call_id = ? WHERE id = ?", [
    String(providerCallId || "").slice(0, 200),
    jobId,
  ]);
}

function updateLeadCallOutcome(
  leadId,
  { callStatus = "queued", callNotes = "", callTranscript = "", appointmentStatus = "not_booked", appointmentTime = "" } = {}
) {
  const sql = `
    UPDATE leads
    SET call_status = ?,
        call_notes = ?,
        call_transcript = ?,
        appointment_status = ?,
        appointment_time = ?,
        last_call_attempt_at = ?
    WHERE id = ?
  `;
  return run(sql, [
    String(callStatus || "queued").slice(0, 80),
    String(callNotes || "").slice(0, 500),
    String(callTranscript || "").slice(0, 12000),
    String(appointmentStatus || "not_booked").slice(0, 80),
    String(appointmentTime || "").slice(0, 80),
    new Date().toISOString(),
    leadId,
  ]);
}

function listAiCallJobs({ status = "", limit = 50 } = {}) {
  const safeLimit = Math.min(200, Math.max(1, Number(limit) || 50));
  const hasStatus = String(status || "").trim();
  if (hasStatus) {
    return all(
      `
        SELECT j.*, l.name, l.mobile, l.loan_type, l.city
        FROM ai_call_jobs j
        JOIN leads l ON l.id = j.lead_id
        WHERE j.status = ?
        ORDER BY j.id DESC
        LIMIT ?
      `,
      [hasStatus, safeLimit]
    );
  }
  return all(
    `
      SELECT j.*, l.name, l.mobile, l.loan_type, l.city
      FROM ai_call_jobs j
      JOIN leads l ON l.id = j.lead_id
      ORDER BY j.id DESC
      LIMIT ?
    `,
    [safeLimit]
  );
}

function getLeadById(leadId) {
  return get("SELECT * FROM leads WHERE id = ? LIMIT 1", [leadId]);
}

function updateLeadEmailStatus(leadId, status, message = "") {
  const sql = `
    UPDATE leads
    SET email_status = ?, email_status_message = ?
    WHERE id = ?
  `;
  return run(sql, [status, String(message || "").slice(0, 500), leadId]);
}

function updateLeadDsasathiSync(leadId, status, message = "", externalLeadId = "") {
  const sql = `
    UPDATE leads
    SET dsasathi_status = ?, dsasathi_message = ?, dsasathi_lead_id = ?
    WHERE id = ?
  `;
  return run(sql, [
    status,
    String(message || "").slice(0, 500),
    String(externalLeadId || "").slice(0, 120),
    leadId,
  ]);
}

function insertDsasathiWebhookLog({ event, remoteLeadId, localLeadId, payloadJson }) {
  const sql = `
    INSERT INTO dsasathi_webhook_log (received_at, event, remote_lead_id, local_lead_id, payload_json)
    VALUES (?, ?, ?, ?, ?)
  `;
  const payload = String(payloadJson || "").slice(0, 12000);
  return run(sql, [
    new Date().toISOString(),
    String(event || "").slice(0, 120),
    String(remoteLeadId || "").slice(0, 120),
    localLeadId == null || !Number.isFinite(Number(localLeadId)) ? null : Number(localLeadId),
    payload,
  ]);
}

async function findLocalLeadIdsForDsasathiWebhook(data) {
  const remoteLeadId = String(data.lead_id || data.leadId || "").trim();
  const loanId = String(data.loan_id || data.loanId || "").trim();
  const ids = [];

  if (remoteLeadId) {
    const rows = await all("SELECT id FROM leads WHERE dsasathi_lead_id = ?", [remoteLeadId]);
    for (const r of rows) ids.push(r.id);
  }

  if (!ids.length && loanId) {
    const row = await get("SELECT id FROM leads WHERE dsasathi_crm_loan_id = ? LIMIT 1", [loanId]);
    if (row) ids.push(row.id);
  }

  return { remoteLeadId: remoteLeadId || "", loanId, localLeadIds: ids };
}

function applyDsasathiWebhookToLocalLead(
  localLeadId,
  { event, at, summary, loanId, loanStatus, assignedTo }
) {
  const sql = `
    UPDATE leads SET
      dsasathi_webhook_event = ?,
      dsasathi_webhook_at = ?,
      dsasathi_webhook_summary = ?,
      dsasathi_crm_loan_id = CASE WHEN ? != '' THEN ? ELSE dsasathi_crm_loan_id END,
      dsasathi_crm_loan_status = CASE WHEN ? != '' THEN ? ELSE dsasathi_crm_loan_status END,
      dsasathi_crm_assigned_to = CASE WHEN ? != '' THEN ? ELSE dsasathi_crm_assigned_to END
    WHERE id = ?
  `;
  const lid = String(loanId || "").slice(0, 120);
  const lst = String(loanStatus || "").slice(0, 120);
  const asn = String(assignedTo || "").slice(0, 120);
  return run(sql, [
    String(event || "").slice(0, 120),
    String(at || "").slice(0, 80),
    String(summary || "").slice(0, 500),
    lid,
    lid,
    lst,
    lst,
    asn,
    asn,
    localLeadId,
  ]);
}

function buildLeadFilters({ query = "", from = "", to = "" }) {
  const conditions = [];
  const params = [];

  const trimmedQuery = query.trim();
  if (trimmedQuery) {
    const search = `%${trimmedQuery}%`;
    conditions.push(
      "(name LIKE ? OR loan_type LIKE ? OR loan_amount LIKE ? OR city LIKE ? OR mobile LIKE ? OR email LIKE ? OR dsasathi_lead_id LIKE ? OR dsasathi_webhook_summary LIKE ? OR dsasathi_crm_loan_id LIKE ? OR dsasathi_crm_loan_status LIKE ? OR dsasathi_crm_assigned_to LIKE ?)"
    );
    params.push(search, search, search, search, search, search, search, search, search, search, search);
  }

  if (from) {
    conditions.push("created_at >= ?");
    params.push(from);
  }

  if (to) {
    conditions.push("created_at <= ?");
    params.push(to);
  }

  return {
    whereSql: conditions.length ? `WHERE ${conditions.join(" AND ")}` : "",
    whereParams: params,
  };
}

async function listLeads({ page = 1, limit = 10, query = "", from = "", to = "" }) {
  const safePage = Math.max(1, Number(page) || 1);
  const safeLimit = Math.min(100, Math.max(1, Number(limit) || 10));
  const offset = (safePage - 1) * safeLimit;
  const { whereSql, whereParams } = buildLeadFilters({ query, from, to });

  const rows = await all(
    `
      SELECT id, name, loan_type, loan_amount, city, mobile, email, email_status, email_status_message, dsasathi_status, dsasathi_message, dsasathi_lead_id, dsasathi_webhook_event, dsasathi_webhook_at, dsasathi_webhook_summary, dsasathi_crm_loan_id, dsasathi_crm_loan_status, dsasathi_crm_assigned_to, created_at
      FROM leads
      ${whereSql}
      ORDER BY id DESC
      LIMIT ? OFFSET ?
    `,
    [...whereParams, safeLimit, offset]
  );

  const countRow = await get(
    `
      SELECT COUNT(*) AS total
      FROM leads
      ${whereSql}
    `,
    whereParams
  );

  return {
    page: safePage,
    limit: safeLimit,
    total: countRow ? countRow.total : 0,
    totalPages: Math.max(1, Math.ceil((countRow ? countRow.total : 0) / safeLimit)),
    items: rows,
  };
}

async function exportLeads({ query = "", from = "", to = "", maxRows = 10000 }) {
  const safeMax = Math.min(10000, Math.max(1, Number(maxRows) || 10000));
  const { whereSql, whereParams } = buildLeadFilters({ query, from, to });

  return all(
    `
      SELECT id, name, loan_type, loan_amount, city, mobile, email, email_status, email_status_message, dsasathi_status, dsasathi_message, dsasathi_lead_id, dsasathi_webhook_event, dsasathi_webhook_at, dsasathi_webhook_summary, dsasathi_crm_loan_id, dsasathi_crm_loan_status, dsasathi_crm_assigned_to, created_at
      FROM leads
      ${whereSql}
      ORDER BY id DESC
      LIMIT ?
    `,
    [...whereParams, safeMax]
  );
}

module.exports = {
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
};
