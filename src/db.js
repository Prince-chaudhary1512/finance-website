const fs = require("fs");
const path = require("path");
const os = require("os");

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

/** Lazy open so `require("sqlite3")` runs after HTTP listen (avoids 503 if native addon load fails at process start). */
let db = null;
function getDb() {
  if (db) return db;
  const sqlite3 = require("sqlite3");
  db = new sqlite3.Database(dbPath);
  return db;
}

function run(sql, params = []) {
  return new Promise((resolve, reject) => {
    let connection;
    try {
      connection = getDb();
    } catch (err) {
      return reject(err);
    }
    connection.run(sql, params, function onRun(err) {
      if (err) return reject(err);
      return resolve({ id: this.lastID, changes: this.changes });
    });
  });
}

function get(sql, params = []) {
  return new Promise((resolve, reject) => {
    let connection;
    try {
      connection = getDb();
    } catch (err) {
      return reject(err);
    }
    connection.get(sql, params, (err, row) => {
      if (err) return reject(err);
      return resolve(row);
    });
  });
}

function all(sql, params = []) {
  return new Promise((resolve, reject) => {
    let connection;
    try {
      connection = getDb();
    } catch (err) {
      return reject(err);
    }
    connection.all(sql, params, (err, rows) => {
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
      created_at TEXT NOT NULL
    );
  `;
  await run(sql);

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

  const aiLeadCols = [
    "ALTER TABLE leads ADD COLUMN lead_state TEXT NOT NULL DEFAULT ''",
    "ALTER TABLE leads ADD COLUMN income_range TEXT NOT NULL DEFAULT ''",
    "ALTER TABLE leads ADD COLUMN preferred_callback_time TEXT NOT NULL DEFAULT ''",
    "ALTER TABLE leads ADD COLUMN consent_status INTEGER NOT NULL DEFAULT 0",
    "ALTER TABLE leads ADD COLUMN consent_timestamp TEXT NOT NULL DEFAULT ''",
    "ALTER TABLE leads ADD COLUMN lead_source TEXT NOT NULL DEFAULT 'website'",
  ];
  for (const colSql of aiLeadCols) {
    try {
      await run(colSql);
    } catch (error) {
      if (!String(error.message).includes("duplicate column name")) {
        throw error;
      }
    }
  }
}

function insertLead(payload) {
  const sql = `
    INSERT INTO leads (name, loan_type, loan_amount, city, mobile, email, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `;
  return run(sql, [
    payload.name,
    payload.loanType,
    payload.loanAmount,
    payload.city,
    payload.mobile,
    payload.email,
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

module.exports = {
  initDb,
  insertLead,
  updateLeadAiProfile,
};
