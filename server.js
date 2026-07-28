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
    -- Accept either the company name or the Salesforce account ID as the
    -- search term (e.g. "King.com Limited" or "001d000001g62lWAAQ").
    WHERE UPPER(TRIM(COMPANY_NAME)) = UPPER(TRIM((SELECT target_account_name FROM vars)))
       OR UPPER(TRIM(SALESFORCE_ACCOUNT)) = UPPER(TRIM((SELECT target_account_name FROM vars)))
    LIMIT 1
),

-- Renewal date (current contract end date) and platform edition
-- (success support level) both come from the Salesforce account, matched on
-- the resolved company name (works whether the user searched by name or by
-- Salesforce account ID).
SALESFORCE_ACCOUNT_INFO AS (
    SELECT
        CURRENT_CONTRACT_END_DATE AS RENEWAL_DATE,
        SUCCESS_SUPPORT_LEVEL AS PLATFORM_EDITION
    FROM GROWTH_BRAZE_FOUNDATIONS.SALESFORCE.ACCOUNT
    WHERE NAME = (SELECT COMPANY_NAME FROM COMPANY_LOOKUP)
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
        SALESFORCE_ACCOUNT,
        (SELECT RENEWAL_DATE FROM SALESFORCE_ACCOUNT_INFO) AS RENEWAL_DATE,
        (SELECT PLATFORM_EDITION FROM SALESFORCE_ACCOUNT_INFO) AS PLATFORM_EDITION
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
        agv.APP_GROUP_NAME,
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
    -- No IFNULL defaults here on purpose: a real SQL NULL for ALLOTMENT /
    -- IS_PURCHASED / IS_USING should reach the UI as NULL, not be coerced
    -- into 0 / FALSE (which would misrepresent "unknown" as "confirmed no").
    SELECT
        ACCOUNT_ID,
        ACCOUNT_NAME,
        PRODUCT,
        ALLOTMENT,
        IS_PURCHASED,
        IS_USING,
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
    -- COUNT(*) never returns NULL (0 over an empty set), so no IFNULL needed.
    -- Exposes the raw impression count: IS_USING is derived as count > 0 and
    -- the same count populates the Banners CHANNEL_USAGE cell.
    SELECT (
        SELECT COUNT(*)
        FROM DI_PRODUCTION.DATALAKE.USERS_MESSAGES_BANNER_IMPRESSION
        WHERE APP_GROUP_ID IN (SELECT AG_ID FROM APP_GROUPS)
    ) AS IMPRESSION_COUNT
),

CONTENT_CARD_USAGE AS (
    -- Content Card impression count; drives IS_USING (count > 0) and the
    -- Content Cards CHANNEL_USAGE cell.
    SELECT (
        SELECT COUNT(*)
        FROM DI_PRODUCTION.DATALAKE.USERS_MESSAGES_CONTENTCARD_IMPRESSION
        WHERE APP_GROUP_ID IN (SELECT AG_ID FROM APP_GROUPS)
    ) AS IMPRESSION_COUNT
),

LANDING_PAGE_USAGE AS (
    SELECT (
        SELECT COUNT(*)
        FROM DI_PRODUCTION.DATALAKE.USERS_MESSAGES_LANDINGPAGE_IMPRESSION
        WHERE APP_GROUP_ID IN (SELECT AG_ID FROM APP_GROUPS)
    ) > 0 AS HAS_USAGE
),

-- Snowflake Credits usage isn't tracked in the product_detail table, so the
-- IS_USING signal is sourced here from the query-builder usage billings,
-- keyed on the company's app group ids (AG_ID).
SNOWFLAKE_CREDITS_USAGE AS (
    SELECT IFNULL((
        SELECT COUNT(*)
        FROM GROWTH_BRAZE_FOUNDATIONS.MONGO_PLATFORM.APPBOY_ANALYTICS_QUERY_BUILDER_USAGE_BILLINGS
        WHERE AG_ID IN (SELECT AG_ID FROM APP_GROUPS)
    ), 0) > 0 AS HAS_USAGE
),

-- Table-based purchase signal for Content Cards: whether the product_detail
-- table lists Content Cards as purchased. Older contracts state Content Cards
-- as an individual line item here; newer contracts often don't, so this is
-- combined (OR) with impression usage below to decide IS_PURCHASED for both
-- Content Cards and Banners (Banners are bundled with Content Cards).
CONTENT_CARDS_PURCHASED_IN_TABLE AS (
    SELECT COUNT_IF(IS_PURCHASED) > 0 AS IS_PURCHASED
    FROM PRODUCT_DETAIL_MERGED
    WHERE PRODUCT ILIKE '%Content Card%'
),

-- Combined Content Cards purchase signal: purchased if the table lists it
-- (older contracts) OR content card impressions exist (newer contracts). This
-- is the single source of truth for whether the customer has Content Cards,
-- and — because Banners are bundled with Content Cards — it also grants Banners.
CONTENT_CARDS_PURCHASED AS (
    SELECT (
        (SELECT IS_PURCHASED FROM CONTENT_CARDS_PURCHASED_IN_TABLE)
        OR (SELECT IMPRESSION_COUNT FROM CONTENT_CARD_USAGE) > 0
    ) AS IS_PURCHASED
),

-- The "Landing Pages Pro" SKU means the customer purchased additional landing
-- pages; its ALLOTMENT is how many extra. Drives the single consolidated
-- Landing Pages line item's IS_PURCHASED / ALLOTMENT.
LANDING_PAGES_PRO AS (
    SELECT
        COUNT(*) > 0 AS IS_PURCHASED,
        MAX(ALLOTMENT) AS ALLOTMENT
    FROM PRODUCT_DETAIL_MERGED
    WHERE PRODUCT ILIKE '%Landing Page%Pro%'
),

PRODUCT_DETAIL AS (
    SELECT
        ACCOUNT_ID,
        ACCOUNT_NAME,
        PRODUCT,
        ALLOTMENT,
        IS_PURCHASED,
        CASE
            WHEN PRODUCT ILIKE '%Snowflake Credit%' THEN (SELECT HAS_USAGE FROM SNOWFLAKE_CREDITS_USAGE)
            ELSE IS_USING
        END AS IS_USING,
        CHANNEL_USAGE
    FROM PRODUCT_DETAIL_MERGED
    -- Landing Pages and Content Cards are each surfaced as a single dedicated
    -- row below (Content Cards / Banners built from impression usage), so drop
    -- their raw product rows here to avoid duplicating those line items.
    WHERE PRODUCT NOT ILIKE '%Landing Page%'
      AND PRODUCT NOT ILIKE '%Content Card%'

    UNION ALL

    -- Content Cards: an add-on channel. IS_PURCHASED is TRUE when the table
    -- lists it as purchased (older contracts) OR impressions exist (proof of
    -- use, hence purchase, on newer contracts). IS_USING and the CHANNEL_USAGE
    -- count come from content card impressions keyed on the app group ids.
    SELECT
        (SELECT SALESFORCE_ACCOUNT FROM COMPANY_LOOKUP) AS ACCOUNT_ID,
        (SELECT COMPANY_NAME FROM COMPANY_LOOKUP) AS ACCOUNT_NAME,
        'Content Cards' AS PRODUCT,
        NULL AS ALLOTMENT,
        (SELECT IS_PURCHASED FROM CONTENT_CARDS_PURCHASED) AS IS_PURCHASED,
        (SELECT IMPRESSION_COUNT FROM CONTENT_CARD_USAGE) > 0 AS IS_USING,
        (SELECT IMPRESSION_COUNT FROM CONTENT_CARD_USAGE) AS CHANNEL_USAGE

    UNION ALL

    -- Banners: bundled with Content Cards, so purchasing Content Cards
    -- automatically grants Banners. IS_PURCHASED is therefore TRUE whenever
    -- Content Cards is purchased (its full table-OR-impressions signal) OR
    -- banner impressions exist. IS_USING and the CHANNEL_USAGE count come from
    -- banner impressions only (a customer can own Banners without sending any).
    SELECT
        (SELECT SALESFORCE_ACCOUNT FROM COMPANY_LOOKUP) AS ACCOUNT_ID,
        (SELECT COMPANY_NAME FROM COMPANY_LOOKUP) AS ACCOUNT_NAME,
        'Banners' AS PRODUCT,
        NULL AS ALLOTMENT,
        (SELECT IS_PURCHASED FROM CONTENT_CARDS_PURCHASED)
            OR (SELECT IMPRESSION_COUNT FROM BANNER_USAGE) > 0 AS IS_PURCHASED,
        (SELECT IMPRESSION_COUNT FROM BANNER_USAGE) > 0 AS IS_USING,
        (SELECT IMPRESSION_COUNT FROM BANNER_USAGE) AS CHANNEL_USAGE

    UNION ALL

    -- Landing Pages: always shown. A "Landing Pages Pro" SKU means the customer
    -- purchased additional landing pages, so its presence drives IS_PURCHASED
    -- and its ALLOTMENT carries the extra count. Usage comes from landing page
    -- impressions keyed on the app group ids.
    SELECT
        (SELECT SALESFORCE_ACCOUNT FROM COMPANY_LOOKUP) AS ACCOUNT_ID,
        (SELECT COMPANY_NAME FROM COMPANY_LOOKUP) AS ACCOUNT_NAME,
        'Landing Pages' AS PRODUCT,
        (SELECT ALLOTMENT FROM LANDING_PAGES_PRO) AS ALLOTMENT,
        (SELECT IS_PURCHASED FROM LANDING_PAGES_PRO) AS IS_PURCHASED,
        (SELECT HAS_USAGE FROM LANDING_PAGE_USAGE) AS IS_USING,
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
        agv.APP_GROUP_NAME,
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
        agv.APP_GROUP_NAME,
        be.ACTIVE_CURRENTS_INTEGRATIONS,
        be.PARTNER_INTEGRATION_LIST
    FROM GROWTH_BRAZE_FOUNDATIONS.MONGO_PLATFORM.BILLABLE_ELEMENTS be
    LEFT JOIN GROWTH_BRAZE_FOUNDATIONS.MONGO_PLATFORM.APP_GROUPS_VIEW agv
        ON (be.ag_id = agv.ag_id)
    WHERE be.C_ID = (SELECT CFID FROM COMPANY_LOOKUP)
      AND be.MONTH = DATE_TRUNC('month', CURRENT_DATE())::DATE
      AND (be.ACTIVE_CURRENTS_INTEGRATIONS IS NOT NULL OR be.PARTNER_INTEGRATION_LIST IS NOT NULL)
),

-- AGENTCONSOLE_AGENTEXECUTED is a raw per-invocation event log with no
-- natural cap, so a busy account can exceed Snowflake's ARRAY_AGG size
-- limit ("Result array of ARRAY_AGG is too large"). The true execution
-- count comes from a plain COUNT(*) over every invocation (a scalar has no
-- size limit), while the detail table is deduped to one row per AGENT_ID
-- (its most recent invocation) and capped to the 500 most recent agents.
AGENT_CONSOLE_USAGE_RAW AS (
    SELECT
        AGENT_ID,
        AGENT_NAME,
        LLM_OWNED_BY_CUSTOMER,
        MODEL_PROVIDER,
        MODEL_NAME,
        INVOCATION_SOURCE,
        SF_CREATED_AT
    FROM DI_PRODUCTION.DATALAKE.AGENTCONSOLE_AGENTEXECUTED
    WHERE COMPANY_ID = (SELECT CFID FROM COMPANY_LOOKUP)
),

AGENT_CONSOLE_USAGE_TOTAL AS (
    SELECT COUNT(*) AS TOTAL_EXECUTIONS FROM AGENT_CONSOLE_USAGE_RAW
),

AGENT_CONSOLE_USAGE_DEDUPED AS (
    SELECT
        AGENT_NAME,
        LLM_OWNED_BY_CUSTOMER,
        MODEL_PROVIDER,
        MODEL_NAME,
        INVOCATION_SOURCE,
        SF_CREATED_AT
    FROM AGENT_CONSOLE_USAGE_RAW
    QUALIFY ROW_NUMBER() OVER (
        PARTITION BY AGENT_ID
        ORDER BY SF_CREATED_AT DESC
    ) = 1
),

AGENT_CONSOLE_USAGE AS (
    SELECT
        AGENT_NAME,
        LLM_OWNED_BY_CUSTOMER,
        MODEL_PROVIDER,
        MODEL_NAME,
        INVOCATION_SOURCE
    FROM AGENT_CONSOLE_USAGE_DEDUPED
    ORDER BY SF_CREATED_AT DESC
    LIMIT 500
),

-- DIAGNOSTICS_OPERATOR_CHATHISTORY is a raw per-segment event log for the
-- dashboard operator. CHAT_SEGMENT_AS_MARKDOWN holds a large JSON blob; we
-- only care about the end-user's typed question, which lives at
-- input[0].content of the request segments where input[0].role = 'user'
-- (assistant replies, reasoning, and tool-call follow-ups are skipped).
-- Non-impersonation rows only, scoped to the resolved company (CFID).
OPERATOR_USAGE_RAW AS (
    SELECT
        SF_CREATED_AT,
        SEGMENT_GROUP_ID,
        TRY_PARSE_JSON(CHAT_SEGMENT_AS_MARKDOWN) AS PARSED
    FROM DI_PRODUCTION.DATALAKE.DIAGNOSTICS_OPERATOR_CHATHISTORY
    WHERE COMPANY_ID = (SELECT CFID FROM COMPANY_LOOKUP)
      AND IS_IMPERSONATION = FALSE
),

-- Keep only segments carrying a user message, surfacing just that text as
-- CHAT_SEGMENT_AS_MARKDOWN. Deduped to one row per request (SEGMENT_GROUP_ID)
-- so a message split across multiple segments doesn't appear more than once.
OPERATOR_USAGE_MESSAGES AS (
    SELECT
        SF_CREATED_AT,
        PARSED:input[0]:content::string AS CHAT_SEGMENT_AS_MARKDOWN
    FROM OPERATOR_USAGE_RAW
    WHERE PARSED:input[0]:role::string = 'user'
    QUALIFY ROW_NUMBER() OVER (
        PARTITION BY SEGMENT_GROUP_ID
        ORDER BY SF_CREATED_AT ASC
    ) = 1
),

OPERATOR_USAGE_TOTAL AS (
    SELECT COUNT(*) AS TOTAL_MESSAGES FROM OPERATOR_USAGE_MESSAGES
),

OPERATOR_USAGE AS (
    SELECT
        SF_CREATED_AT,
        CHAT_SEGMENT_AS_MARKDOWN
    FROM OPERATOR_USAGE_MESSAGES
    ORDER BY SF_CREATED_AT DESC
    LIMIT 500
)

-- Note: OBJECT_CONSTRUCT_KEEP_NULL (not plain OBJECT_CONSTRUCT) is used here
-- so a real NULL column value survives into the JSON as an explicit null,
-- instead of plain OBJECT_CONSTRUCT's default behaviour of silently
-- dropping NULL-valued keys entirely.
SELECT OBJECT_CONSTRUCT(
    'company_info',        (SELECT ARRAY_AGG(OBJECT_CONSTRUCT_KEEP_NULL(*)) FROM COMPANY_INFO),
    'app_groups',          (SELECT ARRAY_AGG(OBJECT_CONSTRUCT_KEEP_NULL(*)) FROM APP_GROUPS),
    'app_groups_ds',       (SELECT ARRAY_AGG(OBJECT_CONSTRUCT_KEEP_NULL(*)) FROM APP_GROUPS_DS),
    'product_detail',      (SELECT ARRAY_AGG(OBJECT_CONSTRUCT_KEEP_NULL(*)) FROM PRODUCT_DETAIL),
    'feature_flipper',     (SELECT ARRAY_AGG(OBJECT_CONSTRUCT_KEEP_NULL(*)) FROM FEATURE_FLIPPER),
    'partner_integrations',(SELECT ARRAY_AGG(OBJECT_CONSTRUCT_KEEP_NULL(*)) FROM PARTNER_INTEGRATIONS),
    'billable_elements',   (SELECT ARRAY_AGG(OBJECT_CONSTRUCT_KEEP_NULL(*)) FROM BILLABLE_ELEMENTS),
    'agent_console_usage', (SELECT ARRAY_AGG(OBJECT_CONSTRUCT_KEEP_NULL(*)) FROM AGENT_CONSOLE_USAGE),
    'agent_console_usage_total_count', (SELECT TOTAL_EXECUTIONS FROM AGENT_CONSOLE_USAGE_TOTAL),
    'operator_usage', (SELECT ARRAY_AGG(OBJECT_CONSTRUCT_KEEP_NULL(*)) FROM OPERATOR_USAGE),
    'operator_usage_total_count', (SELECT TOTAL_MESSAGES FROM OPERATOR_USAGE_TOTAL)
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
  "agent_console_usage",
  "operator_usage",
];

/** Fills in any missing top-level section with an empty array (or 0 for count fields) so the front end never has to guard for undefined. */
function normalizeUsagePayload(raw) {
  const usage = raw && typeof raw === "object" ? raw : {};
  const normalized = {};
  for (const key of USAGE_SECTION_KEYS) {
    normalized[key] = Array.isArray(usage[key]) ? usage[key] : [];
  }
  normalized.agent_console_usage_total_count =
    typeof usage.agent_console_usage_total_count === "number"
      ? usage.agent_console_usage_total_count
      : normalized.agent_console_usage.length;
  normalized.operator_usage_total_count =
    typeof usage.operator_usage_total_count === "number"
      ? usage.operator_usage_total_count
      : normalized.operator_usage.length;
  return normalized;
}

/** One live Snowflake connection per server process (per email). Avoids spawning snowsql, which re-runs Okta every time. */
let activeEmail = null;
let activeConnection = null;

/**
 * In-memory cache backing the customer-name type-ahead. Holds the full list of
 * company names (each with a pre-lowercased copy for cheap matching) for the
 * currently-connected email, loaded once per connection. Suggestions are then
 * served from memory with no per-keystroke Snowflake round-trip.
 */
let companyNamesCache = null; // Array<{ name: string, lower: string }> | null
let companyNamesCacheEmail = null;
let companyNamesLoading = null; // Promise while the one-time load is in flight

function loadCompanyNames(conn) {
  return new Promise((resolve, reject) => {
    conn.execute({
      sqlText:
        "SELECT DISTINCT COMPANY_NAME FROM GROWTH_BRAZE_FOUNDATIONS.MONGO_PLATFORM.COMPANIES WHERE COMPANY_NAME IS NOT NULL",
      complete: (err, stmt, rows) => {
        if (err) {
          reject(err);
          return;
        }
        const entries = [];
        for (const row of rows || []) {
          const name = row?.COMPANY_NAME;
          if (typeof name === "string" && name.trim() !== "") {
            entries.push({ name, lower: name.toLowerCase() });
          }
        }
        resolve(entries);
      },
    });
  });
}

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
    // The type-ahead cache is keyed to a single connection/email, so drop it
    // whenever we switch users.
    companyNamesCache = null;
    companyNamesCacheEmail = null;
    companyNamesLoading = null;
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

app.post("/api/authenticate", async (req, res) => {
  const email = typeof req.body?.email === "string" ? req.body.email.trim() : "";
  if (!email) {
    return res.status(400).json({ error: "Email Address is required." });
  }
  try {
    // Establishes (or reuses) the persistent Snowflake connection, opening the
    // Okta browser flow if needed. Serialized so concurrent clicks can't race
    // two connection attempts.
    await runSerialized(() => ensureSnowflakeConnection(email));
    const key = authKey(email);
    if (!establishedAuthKeys.has(key)) {
      establishedAuthKeys.add(key);
      await persistAuthKeys(establishedAuthKeys);
    }
    res.json({ ok: true });
  } catch (err) {
    const message =
      err && typeof err === "object" && "message" in err
        ? String(err.message)
        : "Snowflake authentication failed.";
    res.status(500).json({ error: message });
  }
});

app.get("/api/suggest", async (req, res) => {
  const email = typeof req.query.email === "string" ? req.query.email.trim() : "";
  const q = typeof req.query.q === "string" ? req.query.q.trim() : "";
  if (!email || q.length < 2) {
    return res.json({ suggestions: [] });
  }

  // Only serve suggestions off an already-live connection. We deliberately
  // never open a new connection here, so typing can't trigger an Okta prompt -
  // suggestions simply switch on once a session exists (i.e. after the first
  // query has authenticated this email).
  const connectionUp = activeEmail === email && Boolean(activeConnection?.isUp());
  if (!connectionUp) {
    return res.json({ suggestions: [], needsConnection: true });
  }

  try {
    if (companyNamesCache === null || companyNamesCacheEmail !== email) {
      if (!companyNamesLoading) {
        companyNamesCacheEmail = email;
        const conn = activeConnection;
        companyNamesLoading = runSerialized(() => loadCompanyNames(conn))
          .then((entries) => {
            companyNamesCache = entries;
            return entries;
          })
          .finally(() => {
            companyNamesLoading = null;
          });
      }
      await companyNamesLoading;
    }

    const needle = q.toLowerCase();
    const entries = companyNamesCache || [];
    const startsWith = [];
    const contains = [];
    for (const entry of entries) {
      if (entry.lower.startsWith(needle)) {
        startsWith.push(entry.name);
      } else if (entry.lower.includes(needle)) {
        contains.push(entry.name);
      }
    }
    // Prefix matches first (most relevant), then substring matches, capped.
    const suggestions = [...startsWith, ...contains].slice(0, 10);
    res.json({ suggestions });
  } catch {
    res.json({ suggestions: [] });
  }
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
