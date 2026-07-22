-- =========================================================================
-- UNIFIED ENTITLEMENT GAPS QUERY (v4 - real usage tables replace feature-flag
-- based signals for banners & landing pages; irrelevant products excluded)
-- =========================================================================
-- v4 change: product_detail excludes a fixed list of products that aren't
-- useful for this tool (see EXCLUDED_PRODUCTS below) - Technical Account
-- Manager, Email Deliverability / Deluxe / Standard, Data Points, Action
-- Credits, Enterprise Support Engagement Lead, TAM Activate, Deliverability
-- Monitoring, Braze Absolute, Global Coverage Support Engagement Lead, IPs.
-- Output: a single JSON object (ACCOUNT_USAGE_JSON), same shape as
-- NEW QUERY.sql's output, with these top-level keys:
--   company_info, app_groups, app_groups_ds, product_detail,
--   feature_flipper, partner_integrations, billable_elements
--
-- Every section from NEW QUERY OUTPUT.json is preserved as-is, EXCEPT
-- product_detail, which is the one section that overlaps with
-- EXISTING QUERY OUTPUT.csv (both read
-- growth_braze_foundations.consumption.account_fusion_mart_product_detail).
--
-- product_detail merge logic:
--   Path A (existing query): matches the product table directly on
--     ACCOUNT_NAME - exactly what the existing query does today.
--   Path B (new query): resolves the account via MONGO_PLATFORM.COMPANIES
--     (matched by company name) to its SALESFORCE_ACCOUNT id, then joins
--     that id back into the product table.
--   When both paths return a row for the same PRODUCT, Path A's row wins
--   (same "existing query data survives the merge" rule as before), so
--   every row in EXISTING QUERY OUTPUT.csv is guaranteed to appear
--   unchanged. Path B only ever fills in products Path A didn't find.
--
-- v3 change - real usage tables for banners & landing pages:
--   feature_flipper previously carried 'banners' and 'landing_pages' as
--   boolean feature flags. Those are now removed from the feature_flipper
--   output (they're no-longer-accurate proxies) and replaced with a real
--   usage check against the new impression tables:
--     - DI_PRODUCTION.DATALAKE.USERS_MESSAGES_BANNER_IMPRESSION
--     - DI_PRODUCTION.DATALAKE.USERS_MESSAGES_LANDINGPAGE_IMPRESSION
--   For each, IS_USING = TRUE if any impression row exists for one of the
--   account's app groups (AG_ID), else FALSE.
--     - Banners has no existing line item in product_detail, so a new
--       'Banners' row is added. IS_PURCHASED is carried over from the old
--       'banners' feature-flipper flag's STATUS (the closest existing
--       signal for whether it was enabled), and IS_USING comes from the
--       new impression check.
--     - Landing Pages already has a line item ('Landing Pages Pro -
--       Commercial' from the product mart, matched via ILIKE '%Landing
--       Page%'). Its IS_PURCHASED is left untouched (real purchase data),
--       but its IS_USING is now fully overridden by the new impression
--       check, since that's a more accurate usage signal per your
--       instruction.
--   NOTE: 12 other tables from "New Tables.csv" (e.g. CANVAS_CAMPAIGN_OBJECTS,
--   MART__FUSION_GTM_ACCOUNTS__ACCOUNT, AUDIENCE_SYNC_STEP_DAILY_STATS, the
--   *_SETTINGS_SNAPSHOT tables, etc.) are NOT yet incorporated - only the two
--   tables you explicitly described (banners, landing pages) are handled here.
--
-- All other sections (app_groups, app_groups_ds, feature_flipper,
-- partner_integrations, billable_elements, company_info) are looked up by
-- CFID exactly as in NEW QUERY.sql - the only change is that the CFID is
-- resolved from target_account_name via COMPANIES instead of being
-- hardcoded, so the whole query still only needs one input value, matching
-- how the app already calls it today.
--
-- To run for a different customer, edit target_account_name below.
-- If COMPANY_NAME in MONGO_PLATFORM.COMPANIES doesn't match this account's
-- Salesforce ACCOUNT_NAME text, the CFID-based sections (app_groups,
-- feature_flipper, partner_integrations, billable_elements, company_info,
-- and the new banner/landing-page usage checks, which rely on the
-- account's AG_IDs) will simply come back empty - product_detail's Path A
-- still works independently, so existing-query data is never at risk.
--
-- PERFORMANCE NOTE: USERS_MESSAGES_BANNER_IMPRESSION and
-- USERS_MESSAGES_LANDINGPAGE_IMPRESSION are raw event-level datalake tables
-- and may be very large. This query checks for ANY impression ever (no
-- time bound). If it runs slowly for high-volume accounts, consider adding
-- an SF_CREATED_AT >= DATEADD(...) filter to both usage-check CTEs below.
-- =========================================================================

WITH vars AS (
    SELECT 'King.com Limited' AS target_account_name
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

-- Path A: existing query, unchanged logic (authoritative)
PRODUCT_DETAIL_EXISTING AS (
    SELECT
        ACCOUNT_ID,
        ACCOUNT_NAME,
        PRODUCT,
        ALLOTMENT,
        IS_PURCHASED,
        IS_USING,
        CHANNEL_USAGE,
        1 AS SOURCE_PRIORITY   -- 1 = existing query wins ties
    FROM growth_braze_foundations.consumption.account_fusion_mart_product_detail
    WHERE ACCOUNT_NAME = (SELECT target_account_name FROM vars)
),

-- Path B: new query's CFID-resolved account, same product table
PRODUCT_DETAIL_NEW AS (
    SELECT
        pd.ACCOUNT_ID,
        cl.COMPANY_NAME AS ACCOUNT_NAME,
        pd.PRODUCT,
        pd.ALLOTMENT,
        pd.IS_PURCHASED,
        pd.IS_USING,
        pd.CHANNEL_USAGE,
        2 AS SOURCE_PRIORITY   -- 2 = only used when Path A has no row for this product
    FROM COMPANY_LOOKUP cl
    JOIN growth_braze_foundations.consumption.account_fusion_mart_product_detail pd
        ON pd.ACCOUNT_ID = cl.SALESFORCE_ACCOUNT
),

-- Products excluded from product_detail entirely (not useful for this tool)
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

-- Real-usage check for banners (replaces the old 'banners' feature flag)
BANNER_USAGE AS (
    SELECT IFNULL((
        SELECT COUNT(*)
        FROM DI_PRODUCTION.DATALAKE.USERS_MESSAGES_BANNER_IMPRESSION
        WHERE APP_GROUP_ID IN (SELECT AG_ID FROM APP_GROUPS)
    ), 0) > 0 AS HAS_USAGE
),

-- Real-usage check for landing pages (replaces the old 'landing_pages' feature flag)
LANDING_PAGE_USAGE AS (
    SELECT IFNULL((
        SELECT COUNT(*)
        FROM DI_PRODUCTION.DATALAKE.USERS_MESSAGES_LANDINGPAGE_IMPRESSION
        WHERE APP_GROUP_ID IN (SELECT AG_ID FROM APP_GROUPS)
    ), 0) > 0 AS HAS_USAGE
),

-- Carries over the old 'banners' feature-flipper flag's STATUS, since that
-- was the closest existing signal for whether banners were enabled/purchased
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
    -- All merged products, with Landing Pages' IS_USING overridden by the
    -- real impression check
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

    -- Synthetic Banners row, since it has no existing product_detail line item
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

-- FINAL JSON OUTPUT
SELECT OBJECT_CONSTRUCT(
    'company_info',        (SELECT ARRAY_AGG(OBJECT_CONSTRUCT(*)) FROM COMPANY_INFO),
    'app_groups',          (SELECT ARRAY_AGG(OBJECT_CONSTRUCT(*)) FROM APP_GROUPS),
    'app_groups_ds',       (SELECT ARRAY_AGG(OBJECT_CONSTRUCT(*)) FROM APP_GROUPS_DS),
    'product_detail',      (SELECT ARRAY_AGG(OBJECT_CONSTRUCT(*)) FROM PRODUCT_DETAIL),
    'feature_flipper',     (SELECT ARRAY_AGG(OBJECT_CONSTRUCT(*)) FROM FEATURE_FLIPPER),
    'partner_integrations',(SELECT ARRAY_AGG(OBJECT_CONSTRUCT(*)) FROM PARTNER_INTEGRATIONS),
    'billable_elements',   (SELECT ARRAY_AGG(OBJECT_CONSTRUCT(*)) FROM BILLABLE_ELEMENTS)
) AS ACCOUNT_USAGE_JSON;
