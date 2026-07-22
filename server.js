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

/**
 * Unified entitlement gaps query (see "UNIFIED QUERY.sql" in the project
 * root for the fully-commented, standalone version of this query).
 *
 * Returns a single row with a single VARIANT column (ACCOUNT_USAGE_JSON)
 * containing:
 *   { company_info, app_groups, app_groups_ds, product_detail,
 *     feature_flipper, partner_integrations, billable_elements }
 *
 * product_detail merges the account-name-matched product table (the old
 * "existing query", authoritative on ties) with a CFID-resolved path to the
 * same table, replaces the old banner/landing-page feature-flag signals with
 * real usage checks against the message impression tables, and drops a
 * fixed list of products that aren't useful for this tool.
 */
function buildUnifiedQuery(customerName) {
  const safeName = escapeSqlString(customerName);
  return `WITH vars AS (
    SELECT '${safeName}' AS target_account_name
),

COMPANY_LOOKUP AS (
    SELECT
        CFID,
        SFID,
        COMPANY_NAME,
        CLUSTER,
        SUCCESS_MANAGER,
        SUCCESS_MANAGER_NAME,
        TERRITORY_V3,
        BILLINGCOUNTRY,
        SALESFORCE_ACCOUNT
    FROM GROWTH_BRAZE_FOUNDATIONS.MONGO_PLATFORM.COMPANIES
    WHERE UPPER(TRIM(COMPANY_NAME)) = UPPER(TRIM((SELECT target_account_name FROM vars)))
    LIMIT 1
),

COMPANY_INFO AS (
    SELECT
        COMPANY_NAME,
        CFID,
        SFID,
        CLUSTER,
        SUCCESS_MANAGER,
        SUCCESS_MANAGER_NAME,
        TERRITORY_V3,
        BILLINGCOUNTRY,
        SALESFORCE_ACCOUNT
    FROM COMPANY_LOOKUP
),

APP_GROUPS AS (
    SELECT
        AG_ID,
        APP_GROUP_NAME,
        EID,
        SDK_CONFIGURATION_LAST_UPDATED,
        CURRENTS_INTEGRATIONS_ENTITLEMENTS,
        CURRENTS_INTEGRATIONS_USER_BEHAVIOR_ENTITLEMENTS,
        DATASHARE_INTEGRATIONS_ENTITLEMENTS,
        DATASHARE_INTEGRATIONS_CRR_ENTITLEMENTS,
        PARTNERS_LAST_CONNECTED_DATE,
        PARNTERS_FIRST_CONNECTED_DATE,
        PARTNERS_CONNECTION_TOTAL_COUNTS,
        REFRESHED_AT
    FROM GROWTH_BRAZE_FOUNDATIONS.MONGO_PLATFORM.APP_GROUPS_VIEW
    WHERE C_ID = (SELECT CFID FROM COMPANY_LOOKUP)
),

APP_GROUPS_DS AS (
    SELECT
        ads.AG_ID,
        IFNULL(agv.APP_GROUP_NAME, '') AS APP_GROUP_NAME,
        ads.DATE,
        ads.MAU,
        ads.W_MAU,
        ads.M_MAU,
        ads.BILLABLE_USERS,
        ads.TOTAL_USERS,
        ads.MESSAGED_USERS,
        ads.DAU,
        ads.REFRESHED_AT
    FROM GROWTH_BRAZE_FOUNDATIONS.MONGO_PLATFORM.APP_GROUP_DS ads
    LEFT JOIN GROWTH_BRAZE_FOUNDATIONS.MONGO_PLATFORM.APP_GROUPS_VIEW agv
        ON (ads.ag_id = agv.ag_id)
    WHERE ads.c_id = (SELECT CFID FROM COMPANY_LOOKUP)
      AND ads.RANK = 1
),

PRODUCT_DETAIL_EXISTING AS (
    SELECT
        ACCOUNT_ID,
        ACCOUNT_NAME,
        PRODUCT,
        ALLOTMENT,
        IS_PURCHASED,
        IS_USING,
        CHANNEL_USAGE,
        1 AS SOURCE_PRIORITY
    FROM growth_braze_foundations.consumption.account_fusion_mart_product_detail
    WHERE ACCOUNT_NAME = (SELECT target_account_name FROM vars)
),

PRODUCT_DETAIL_NEW AS (
    SELECT
        pd.ACCOUNT_ID,
        cl.COMPANY_NAME AS ACCOUNT_NAME,
        pd.PRODUCT,
        pd.ALLOTMENT,
        pd.IS_PURCHASED,
        pd.IS_USING,
        pd.CHANNEL_USAGE,
        2 AS SOURCE_PRIORITY
    FROM COMPANY_LOOKUP cl
    JOIN growth_braze_foundations.consumption.account_fusion_mart_product_detail pd
        ON pd.ACCOUNT_ID = cl.SALESFORCE_ACCOUNT
),

EXCLUDED_PRODUCTS AS (
    SELECT column1 AS PRODUCT_NAME FROM VALUES
        ('Technical Account Manager'),
        ('Email Deliverability'),
        ('Email Deliverability Deluxe'),
        ('Data Points'),
        ('Action Credits'),
        ('Enterprise Support Engagement Lead'),
        ('Email Deliverability Standard'),
        ('TAM Activate'),
        ('Deliverability Monitoring'),
        ('Braze Absolute'),
        ('Global Coverage Support Engagement Lead'),
        ('IPs')
),

PRODUCT_DETAIL_MERGED AS (
    SELECT
        ACCOUNT_ID,
        ACCOUNT_NAME,
        PRODUCT,
        IFNULL(ALLOTMENT, 0) AS ALLOTMENT,
        IFNULL(IS_PURCHASED, FALSE) AS IS_PURCHASED,
        IFNULL(IS_USING, FALSE) AS IS_USING,
        CHANNEL_USAGE
    FROM (
        SELECT * FROM PRODUCT_DETAIL_EXISTING
        UNION ALL
        SELECT * FROM PRODUCT_DETAIL_NEW
    )
    WHERE PRODUCT NOT IN (SELECT PRODUCT_NAME FROM EXCLUDED_PRODUCTS)
    QUALIFY ROW_NUMBER() OVER (
        PARTITION BY PRODUCT
        ORDER BY SOURCE_PRIORITY ASC
    ) = 1
),

BANNER_USAGE AS (
    SELECT IFNULL((
        SELECT COUNT(*)
        FROM DI_PRODUCTION.DATALAKE.USERS_MESSAGES_BANNER_IMPRESSION
        WHERE APP_GROUP_ID IN (SELECT AG_ID FROM APP_GROUPS)
    ), 0) > 0 AS HAS_USAGE
),

LANDING_PAGE_USAGE AS (
    SELECT IFNULL((
        SELECT COUNT(*)
        FROM DI_PRODUCTION.DATALAKE.USERS_MESSAGES_LANDINGPAGE_IMPRESSION
        WHERE APP_GROUP_ID IN (SELECT AG_ID FROM APP_GROUPS)
    ), 0) > 0 AS HAS_USAGE
),

BANNER_PURCHASED_FLAG AS (
    SELECT (
        SELECT STATUS
        FROM GROWTH_BRAZE_FOUNDATIONS.MONGO_PLATFORM.FEATURE_FLIPPER_AUDIT_LOGS_VIEW
        WHERE c_id = (SELECT CFID FROM COMPANY_LOOKUP)
          AND NAME = 'banners'
        LIMIT 1
    ) AS STATUS
),

PRODUCT_DETAIL AS (
    SELECT
        ACCOUNT_ID,
        ACCOUNT_NAME,
        PRODUCT,
        ALLOTMENT,
        IS_PURCHASED,
        CASE
            WHEN PRODUCT ILIKE '%Landing Page%' THEN (SELECT HAS_USAGE FROM LANDING_PAGE_USAGE)
            ELSE IS_USING
        END AS IS_USING,
        CHANNEL_USAGE
    FROM PRODUCT_DETAIL_MERGED

    UNION ALL

    SELECT
        (SELECT SALESFORCE_ACCOUNT FROM COMPANY_LOOKUP) AS ACCOUNT_ID,
        (SELECT COMPANY_NAME FROM COMPANY_LOOKUP) AS ACCOUNT_NAME,
        'Banners' AS PRODUCT,
        NULL AS ALLOTMENT,
        IFNULL((SELECT STATUS FROM BANNER_PURCHASED_FLAG), FALSE) AS IS_PURCHASED,
        (SELECT HAS_USAGE FROM BANNER_USAGE) AS IS_USING,
        NULL AS CHANNEL_USAGE
),

FEATURE_FLIPPER AS (
    SELECT
        DS_ID,
        D_ID,
        NAME,
        STATUS,
        DATE,
        REFRESHED_AT
    FROM GROWTH_BRAZE_FOUNDATIONS.MONGO_PLATFORM.FEATURE_FLIPPER_AUDIT_LOGS_VIEW
    WHERE c_id = (SELECT CFID FROM COMPANY_LOOKUP)
      AND NAME NOT IN ('banners', 'landing_pages')
),

PARTNER_INTEGRATIONS AS (
    SELECT
        piv.AG_ID,
        IFNULL(agv.APP_GROUP_NAME, '') AS APP_GROUP_NAME,
        IS_ACTIVE,
        PARTNER,
        PARTNER_CLASS,
        FIRST_CONNECTION,
        MOST_RECENT_CONNECTION,
        CONNECTION_COUNT
    FROM GROWTH_BRAZE_FOUNDATIONS.MONGO_PLATFORM.PARTNER_INTEGRATIONS_VIEW piv
    LEFT JOIN GROWTH_BRAZE_FOUNDATIONS.MONGO_PLATFORM.APP_GROUPS_VIEW agv
        ON (agv.ag_id = piv.ag_id)
    WHERE piv.C_ID = (SELECT CFID FROM COMPANY_LOOKUP)
      AND piv.MOST_RECENT_CONNECTION >= DATEADD('day', -2, CURRENT_TIMESTAMP())
),

BILLABLE_ELEMENTS AS (
    SELECT
        be.AG_ID,
        IFNULL(agv.APP_GROUP_NAME, '') AS APP_GROUP_NAME,
        IFNULL(be.ACTIVE_CURRENTS_INTEGRATIONS, 0) AS ACTIVE_CURRENTS_INTEGRATIONS,
        IFNULL(be.PARTNER_INTEGRATION_LIST, '') AS PARTNER_INTEGRATION_LIST
    FROM GROWTH_BRAZE_FOUNDATIONS.MONGO_PLATFORM.BILLABLE_ELEMENTS be
    LEFT JOIN GROWTH_BRAZE_FOUNDATIONS.MONGO_PLATFORM.APP_GROUPS_VIEW agv
        ON (be.ag_id = agv.ag_id)
    WHERE be.C_ID = (SELECT CFID FROM COMPANY_LOOKUP)
      AND be.MONTH = DATE_TRUNC('month', CURRENT_DATE())::DATE
      AND (be.ACTIVE_CURRENTS_INTEGRATIONS IS NOT NULL OR be.PARTNER_INTEGRATION_LIST IS NOT NULL)
)

SELECT OBJECT_CONSTRUCT(
    'company_info',        (SELECT ARRAY_AGG(OBJECT_CONSTRUCT(*)) FROM COMPANY_INFO),
    'app_groups',          (SELECT ARRAY_AGG(OBJECT_CONSTRUCT(*)) FROM APP_GROUPS),
    'app_groups_ds',       (SELECT ARRAY_AGG(OBJECT_CONSTRUCT(*)) FROM APP_GROUPS_DS),
    'product_detail',      (SELECT ARRAY_AGG(OBJECT_CONSTRUCT(*)) FROM PRODUCT_DETAIL),
    'feature_flipper',     (SELECT ARRAY_AGG(OBJECT_CONSTRUCT(*)) FROM FEATURE_FLIPPER),
    'partner_integrations',(SELECT ARRAY_AGG(OBJECT_CONSTRUCT(*)) FROM PARTNER_INTEGRATIONS),
    'billable_elements',   (SELECT ARRAY_AGG(OBJECT_CONSTRUCT(*)) FROM BILLABLE_ELEMENTS)
) AS ACCOUNT_USAGE_JSON;`;
}

const USAGE_SECTION_KEYS = [
  "company_info",
  "app_groups",
  "app_groups_ds",
  "product_detail",
  "feature_flipper",
  "partner_integrations",
  "billable_elements",
];

/** Fills in any missing top-level section with an empty array so the front end never has to guard for undefined. */
function normalizeUsagePayload(raw) {
  const usage = raw && typeof raw === "object" ? raw : {};
  const normalized = {};
  for (const key of USAGE_SECTION_KEYS) {
    normalized[key] = Array.isArray(usage[key]) ? usage[key] : [];
  }
  return normalized;
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

/** Runs the unified query and extracts+parses its single JSON column into a plain object. */
function executeUnifiedQuery(conn, sqlText) {
  return new Promise((resolve, reject) => {
    conn.execute({
      sqlText,
      complete: (err, stmt, rows) => {
        if (err) {
          reject(err);
          return;
        }
        const row = Array.isArray(rows) && rows.length > 0 ? rows[0] : null;
        if (!row) {
          resolve(normalizeUsagePayload({}));
          return;
        }
        const colName = stmt.getColumns()?.[0]?.getName() ?? Object.keys(row)[0];
        let value = row[colName];
        if (typeof value === "string") {
          try {
            value = JSON.parse(value);
          } catch {
            value = {};
          }
        }
        resolve(normalizeUsagePayload(value));
      },
    });
  });
}

async function runSnowflakeQuery(email, sqlText) {
  const conn = await ensureSnowflakeConnection(email);
  try {
    return await executeUnifiedQuery(conn, sqlText);
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
      return executeUnifiedQuery(conn2, sqlText);
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

  const query = buildUnifiedQuery(customerName);
  const key = authKey(email);
  const snowflakeSessionReused =
    establishedAuthKeys.has(key) || (activeEmail === email && activeConnection?.isUp());

  try {
    const usage = await runSerialized(() => runSnowflakeQuery(email, query));
    if (!establishedAuthKeys.has(key)) {
      establishedAuthKeys.add(key);
      await persistAuthKeys(establishedAuthKeys);
    }
    res.json({ usage, snowflakeSessionReused });
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
