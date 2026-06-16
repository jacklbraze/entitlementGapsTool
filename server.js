import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import snowflake from "snowflake-sdk";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SNOW_ACCOUNT = "BRAZE-XJ24206_AWS_US_EAST_1";
const AUTH_KEYS_FILE = path.join(__dirname, "snowflake-auth-keys.json");

function authKey(email) {
  return `${SNOW_ACCOUNT}::${email}`;
}

async function loadEstablishedAuthKeys() {
  try {
    const raw = await readFile(AUTH_KEYS_FILE, "utf8");
    const data = JSON.parse(raw);
    return new Set(Array.isArray(data.keys) ? data.keys : []);
  } catch {
    return new Set();
  }
}

async function persistAuthKeys(keys) {
  await writeFile(
    AUTH_KEYS_FILE,
    JSON.stringify({ keys: [...keys] }, null, 2),
    "utf8"
  );
}

function escapeSqlString(value) {
  return String(value).replace(/'/g, "''");
}

function buildQuery(customerName) {
  const safeName = escapeSqlString(customerName);
  return `SELECT ACCOUNT_ID, ACCOUNT_NAME, PRODUCT, IS_PURCHASED ,IS_USING FROM growth_braze_foundations.consumption.account_fusion_mart_product_detail
WHERE ACCOUNT_NAME = '${safeName}';`;
}

const DEFAULT_COLUMNS = [
  "ACCOUNT_ID",
  "ACCOUNT_NAME",
  "PRODUCT",
  "IS_PURCHASED",
  "IS_USING",
];

function formatCell(value) {
  if (value === null || value === undefined) return "";
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "boolean") return value ? "TRUE" : "FALSE";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

/** One live Snowflake connection per server process (per email). Avoids spawning snowsql, which re-runs Okta every time. */
let activeEmail = null;
let activeConnection = null;

function destroyConnection(conn) {
  return new Promise((resolve) => {
    if (!conn) {
      resolve();
      return;
    }
    try {
      conn.destroy(() => resolve());
    } catch {
      resolve();
    }
  });
}

async function ensureSnowflakeConnection(email) {
  if (activeEmail !== email) {
    await destroyConnection(activeConnection);
    activeConnection = null;
    activeEmail = email;
  }

  if (activeConnection?.isUp()) {
    try {
      if (await activeConnection.isValidAsync()) {
        return activeConnection;
      }
    } catch {
      /* reconnect */
    }
    await destroyConnection(activeConnection);
    activeConnection = null;
  }

  const conn = snowflake.createConnection({
    account: SNOW_ACCOUNT,
    username: email,
    authenticator: "EXTERNALBROWSER",
    warehouse: "DATALAKE_USER_PROFILE_RESYNC_PRODUCTION",
    clientSessionKeepAlive: true,
    clientStoreTemporaryCredential: true,
  });

  await conn.connectAsync();
  activeConnection = conn;
  return conn;
}

let opQueue = Promise.resolve();

function runSerialized(fn) {
  const result = opQueue.then(() => fn());
  opQueue = result.catch(() => {});
  return result;
}

function executeSql(conn, sqlText) {
  return new Promise((resolve, reject) => {
    conn.execute({
      sqlText: sqlText,
      complete: (err, stmt, rows) => {
        if (err) {
          reject(err);
          return;
        }
        const rowList = rows ?? [];
        const colsFromStmt = stmt.getColumns()?.map((c) => c.getName());
        const columns =
          colsFromStmt?.length > 0
            ? colsFromStmt
            : rowList.length > 0
              ? Object.keys(rowList[0])
              : [...DEFAULT_COLUMNS];

        const normalized = rowList.map((row) => {
          const obj = {};
          for (const col of columns) {
            obj[col] = formatCell(row[col]);
          }
          return obj;
        });

        resolve({ columns, rows: normalized });
      },
    });
  });
}

async function runSnowflakeQuery(email, sqlText) {
  const conn = await ensureSnowflakeConnection(email);
  try {
    return await executeSql(conn, sqlText);
  } catch (err) {
    const msg = err && typeof err === "object" && "message" in err ? String(err.message) : String(err);
    const sessionLikelyDead =
      /390114|390100|session expired|JWT token is invalid|Connection already terminated|not connected/i.test(
        msg
      );
    if (sessionLikelyDead) {
      await destroyConnection(activeConnection);
      activeConnection = null;
      const conn2 = await ensureSnowflakeConnection(email);
      return executeSql(conn2, sqlText);
    }
    throw err;
  }
}

const establishedAuthKeys = await loadEstablishedAuthKeys();

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

app.get("/api/session", (req, res) => {
  const email = typeof req.query.email === "string" ? req.query.email.trim() : "";
  if (!email) {
    return res.status(400).json({ error: "Query parameter email is required." });
  }
  const key = authKey(email);
  const hasFileRecord = establishedAuthKeys.has(key);
  const liveForEmail = activeEmail === email && activeConnection?.isUp();
  res.json({
    snowflakeSessionReused: hasFileRecord || Boolean(liveForEmail),
  });
});

app.post("/api/query", async (req, res) => {
  const email = typeof req.body?.email === "string" ? req.body.email.trim() : "";
  const customerName =
    typeof req.body?.customerName === "string"
      ? req.body.customerName.trim()
      : "";

  if (!email) {
    return res.status(400).json({ error: "Email Address is required." });
  }
  if (!customerName) {
    return res.status(400).json({ error: "Customer Name is required." });
  }

  const query = buildQuery(customerName);
  const key = authKey(email);
  const snowflakeSessionReused =
    establishedAuthKeys.has(key) || (activeEmail === email && activeConnection?.isUp());

  try {
    const { columns, rows } = await runSerialized(() => runSnowflakeQuery(email, query));
    if (!establishedAuthKeys.has(key)) {
      establishedAuthKeys.add(key);
      await persistAuthKeys(establishedAuthKeys);
    }
    res.json({ columns, rows, snowflakeSessionReused });
  } catch (err) {
    const message =
      err && typeof err === "object" && "message" in err
        ? String(err.message)
        : "Snowflake query failed.";
    res.status(500).json({ error: message });
  }
});

const port = Number(process.env.PORT) || 3000;
app.listen(port, () => {
  console.log(`Open http://localhost:${port}`);
  console.log(
    "Using Snowflake Node.js driver with a persistent connection (Okta opens once per email until the server restarts or the session ends)."
  );
});
