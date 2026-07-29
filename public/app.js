const form = document.getElementById("query-form");
const statusEl = document.getElementById("status");
const resultsSection = document.getElementById("results-section");
const companySummaryEl = document.getElementById("company-summary");
const resultsFiltersEl = document.getElementById("results-filters");
const resultsHead = document.getElementById("results-head");
const resultsBody = document.getElementById("results-body");
const submitBtn = document.getElementById("submit-btn");

const agentConsoleUsageHead = document.getElementById("agent-console-usage-head");
const agentConsoleUsageBody = document.getElementById("agent-console-usage-body");
const agentConsoleUsageCount = document.getElementById("agent-console-usage-count");
const agentConsoleUsageNote = document.getElementById("agent-console-usage-note");
const agentConsoleUsageBlock = document.getElementById("agent-console-usage-block");

const operatorUsageHead = document.getElementById("operator-usage-head");
const operatorUsageBody = document.getElementById("operator-usage-body");
const operatorUsageCount = document.getElementById("operator-usage-count");
const operatorUsageNote = document.getElementById("operator-usage-note");
const operatorUsageBlock = document.getElementById("operator-usage-block");

const appGroupsHead = document.getElementById("app-groups-head");
const appGroupsBody = document.getElementById("app-groups-body");
const appGroupsCount = document.getElementById("app-groups-count");
const appGroupsBlock = document.getElementById("app-groups-block");

const appGroupsDsHead = document.getElementById("app-groups-ds-head");
const appGroupsDsBody = document.getElementById("app-groups-ds-body");
const appGroupsDsCount = document.getElementById("app-groups-ds-count");
const appGroupsDsBlock = document.getElementById("app-groups-ds-block");

const partnerIntegrationsHead = document.getElementById("partner-integrations-head");
const partnerIntegrationsBody = document.getElementById("partner-integrations-body");
const partnerIntegrationsCount = document.getElementById("partner-integrations-count");

const billableElementsHead = document.getElementById("billable-elements-head");
const billableElementsBody = document.getElementById("billable-elements-body");
const billableElementsCount = document.getElementById("billable-elements-count");

const featureFlipperHead = document.getElementById("feature-flipper-head");
const featureFlipperBody = document.getElementById("feature-flipper-body");
const featureFlipperCount = document.getElementById("feature-flipper-count");
const featureFlipperSearchEl = document.getElementById("feature-flipper-search");
const featureFlipperBlock = document.getElementById("feature-flipper-block");

/** Preferred left-to-right column order for the primary product_detail table; anything else found in the data is appended after. */
const PRODUCT_DETAIL_PREFERRED_COLUMNS = [
  "PRODUCT",
  "ALLOTMENT",
  "INCLUDED",
  "IS_PURCHASED",
  "IS_USING",
  "CHANNEL_USAGE",
];

/** Columns present in the product_detail rows but intentionally not shown in the table. */
const PRODUCT_DETAIL_HIDDEN_COLUMNS = ["ACCOUNT_ID", "ACCOUNT_NAME"];

/**
 * Static entitlement reference, transcribed from the "Braze Platform
 * Entitlements FY27" CSV. Each entry maps a feature to its availability in the
 * four platform editions, in this order: [Braze Go, Braze Select, Braze Pro,
 * Braze Enterprise]. A cell of Included / Limited / Pro Only means the feature
 * comes with that edition (Included = TRUE); Add-on / Not Included means it is
 * not part of the edition and must be purchased separately (Included = FALSE).
 */
const EDITION_ORDER = ["go", "select", "pro", "enterprise"];
const INCLUDED_CELL_VALUES = new Set(["included", "limited", "pro only"]);
const ENTITLEMENT_REFERENCE = [
  ["Cloud Data Ingestion", ["Included", "Included", "Included", "Included"]],
  ["Data Transformation", ["Limited", "Limited", "Limited", "Limited"]],
  ["Automated ID Resolution", ["Included", "Included", "Included", "Included"]],
  ["Segment Extensions", ["Limited", "Limited", "Limited", "Limited"]],
  ["SQL Segment Extensions", ["Limited", "Limited", "Limited", "Limited"]],
  ["CDI Segments (Zero-Copy)", ["Included", "Included", "Included", "Included"]],
  ["Catalogs", ["Limited", "Limited", "Limited", "Limited"]],
  ["Data Management", ["Included", "Included", "Included", "Included"]],
  ["Reporting and Analytics", ["Included", "Included", "Included", "Included"]],
  ["Query Builder", ["Limited", "Limited", "Limited", "Limited"]],
  ["Data Distribution", ["Add-on", "Add-on", "Add-on", "Add-on"]],
  ["Technology Alloys Partner Network (180+)", ["Included", "Included", "Included", "Included"]],
  ["Automated User Provisioning (SCIM)", ["Not Included", "Included", "Included", "Included"]],
  ["Automated Security Events", ["Not Included", "Included", "Included", "Included"]],
  ["Identifier Field-Level Encryption", ["Not Included", "Included", "Included", "Included"]],
  ["Teams", ["Not Included", "Not Included", "Included", "Included"]],
  ["HIPAA", ["Limited", "Limited", "Limited", "Limited"]],
  ["Local Data Centers", ["Limited", "Limited", "Limited", "Limited"]],
  ["Two-Factor Authorization / SSO", ["Limited", "Limited", "Limited", "Limited"]],
  ["Active Campaigns (up to 100/250/1000/10000)", ["Included", "Included", "Included", "Included"]],
  ["Active Canvases (up to 50/125/500/5000)", ["Included", "Included", "Included", "Included"]],
  ["Suppression Lists", ["Included", "Included", "Included", "Included"]],
  ["Global Control Group", ["Included", "Included", "Included", "Included"]],
  ["Frequency Capping", ["Included", "Included", "Included", "Included"]],
  ["Copywriting (Tone Control & Brand Guidelines)", ["Included", "Included", "Included", "Included"]],
  ["Image Generator", ["Included", "Included", "Included", "Included"]],
  ["AI Content QA", ["Included", "Included", "Included", "Included"]],
  ["AI SQL Segment Extensions", ["Included", "Included", "Included", "Included"]],
  ["AI Query Builder", ["Included", "Included", "Included", "Included"]],
  ["Winning Variant", ["Included", "Included", "Included", "Included"]],
  ["Winning Path", ["Included", "Included", "Included", "Included"]],
  ["Intelligence Suite", ["Included", "Included", "Included", "Included"]],
  ["Liquid Assistant", ["Included", "Included", "Included", "Included"]],
  ["Personalized Path", ["Included", "Included", "Included", "Included"]],
  ["Personalized Variant", ["Included", "Included", "Included", "Included"]],
  ["Predictive Suite", ["Not Included", "Not Included", "Pro Only", "Pro Only"]],
  ["AI Item Recommendations", ["Not Included", "Not Included", "Pro Only", "Pro Only"]],
  ["BrazeAI Agent Console", ["Included", "Included", "Included", "Included"]],
  ["BrazeAI Operator", ["Included", "Included", "Included", "Included"]],
  ["Push (Mobile & Web)", ["Included", "Included", "Included", "Included"]],
  ["In-App Messaging (Mobile & Web)", ["Included", "Included", "Included", "Included"]],
  ["Email", ["Add-on", "Add-on", "Add-on", "Add-on"]],
  ["SMS / MMS / RCS", ["Add-on", "Add-on", "Add-on", "Add-on"]],
  ["WhatsApp", ["Add-on", "Add-on", "Add-on", "Add-on"]],
  ["LINE", ["Add-on", "Add-on", "Add-on", "Add-on"]],
  ["Content Cards", ["Add-on", "Add-on", "Add-on", "Add-on"]],
  ["Banners", ["Add-on", "Add-on", "Add-on", "Add-on"]],
  ["Audience Sync", ["Add-on", "Add-on", "Add-on", "Add-on"]],
  ["Webhooks", ["Add-on", "Add-on", "Add-on", "Add-on"]],
  ["Message Archiving", ["Add-on", "Add-on", "Add-on", "Add-on"]],
  ["AI Agent Console", ["Add-on", "Add-on", "Add-on", "Add-on"]],
  ["Landing Pages", ["Limited", "Limited", "Limited", "Limited"]],
  ["Feature Flags", ["Limited", "Limited", "Limited", "Limited"]],
  ["Braze SDKs", ["Included", "Included", "Included", "Included"]],
  ["REST API", ["Included", "Included", "Included", "Included"]],
  ["Multivariate & A/B Testing", ["Included", "Included", "Included", "Included"]],
  ["Campaign Analytics", ["Included", "Included", "Included", "Included"]],
  ["Canvas Analytics", ["Included", "Included", "Included", "Included"]],
  ["Funnel Reports", ["Included", "Included", "Included", "Included"]],
  ["Retention Reports", ["Included", "Included", "Included", "Included"]],
  ["Report Builder", ["Included", "Included", "Included", "Included"]],
  ["Location Tracking", ["Included", "Included", "Included", "Included"]],
  ["Geofences", ["Included", "Included", "Included", "Included"]],
  ["Location Targeting", ["Included", "Included", "Included", "Included"]],
];

/** Normalizes a feature/product name for matching: drops parenthetical
 * qualifiers, lowercases, and collapses any non-alphanumeric runs to a single
 * space (so "SMS / MMS / RCS" and "Push (Mobile & Web)" match sensibly). */
function normalizeFeatureName(value) {
  return String(value ?? "")
    .toLowerCase()
    .replace(/\([^)]*\)/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

const ENTITLEMENT_BY_FEATURE = new Map(
  ENTITLEMENT_REFERENCE.map(([feature, editions]) => [normalizeFeatureName(feature), editions])
);

/** Maps a Salesforce SUCCESS_SUPPORT_LEVEL string to a 0-3 edition index, or -1 if unrecognized. */
function editionIndexFromLevel(level) {
  const s = String(level ?? "").toLowerCase();
  // Check enterprise before pro/go so multi-word levels resolve correctly.
  if (s.includes("enterprise")) return EDITION_ORDER.indexOf("enterprise");
  if (s.includes("pro")) return EDITION_ORDER.indexOf("pro");
  if (s.includes("select")) return EDITION_ORDER.indexOf("select");
  if (s.includes("go")) return EDITION_ORDER.indexOf("go");
  return -1;
}

/**
 * Whether a product is included in the given platform edition per the FY27
 * entitlements reference. Returns true/false when the edition is known, or
 * undefined when we can't determine the edition (so the cell renders blank).
 * Products not present in the reference default to false (not part of the
 * standard edition entitlements).
 */
function computeIncluded(productName, editionIndex) {
  if (editionIndex < 0) return undefined;
  const editions = ENTITLEMENT_BY_FEATURE.get(normalizeFeatureName(productName));
  if (!editions) return false;
  return INCLUDED_CELL_VALUES.has(String(editions[editionIndex] ?? "").toLowerCase());
}

/** Returns a copy of the product rows with an "Included" column derived from the platform edition. */
function augmentProductRowsWithIncluded(rows, platformEdition) {
  const editionIndex = editionIndexFromLevel(platformEdition);
  const productKey = findColumnKey(collectColumns(rows), "PRODUCT");
  return rows.map((row) => ({
    ...row,
    INCLUDED: computeIncluded(productKey ? row[productKey] : row.PRODUCT, editionIndex),
  }));
}

let featureFlipperRows = [];

/** @type {{ columns: string[], rows: Record<string, unknown>[], sortColumn: string | null, sortDir: 'asc' | 'desc' }} */
const resultsState = {
  columns: [],
  rows: [],
  sortColumn: null,
  sortDir: "asc",
};

function showStatus(message, kind) {
  statusEl.hidden = false;
  statusEl.textContent = message;
  statusEl.className = `status ${kind}`;
}

function clearStatus() {
  statusEl.hidden = true;
  statusEl.textContent = "";
  statusEl.className = "status";
}

function escapeHtml(value) {
  return String(value).replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]
  );
}

/** Renders any JS value (boolean/number/string/null/object) as display text, consistently across every table in the app. */
function formatCellValue(v) {
  // A real SQL NULL (present in the row, value null) is shown as the literal
  // text "NULL" so it reads distinctly from FALSE/0. A key that's simply
  // absent from this particular row (undefined - e.g. a column that only
  // some rows in this section have) still renders as a blank cell.
  if (v === null) return "NULL";
  if (v === undefined) return "";
  if (typeof v === "boolean") return v ? "TRUE" : "FALSE";
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}

/** Union of every key seen across a list of row objects, in first-seen order. */
function collectColumns(rows) {
  const seen = new Set();
  const columns = [];
  for (const row of rows) {
    for (const key of Object.keys(row ?? {})) {
      if (!seen.has(key)) {
        seen.add(key);
        columns.push(key);
      }
    }
  }
  return columns;
}

function orderedColumns(rows, preferred) {
  const union = collectColumns(rows);
  const ordered = preferred.filter((c) => union.includes(c));
  const extras = union.filter((c) => !preferred.includes(c));
  return [...ordered, ...extras];
}

function findColumnKey(columns, name) {
  const u = name.toUpperCase();
  const hit = columns.find((c) => String(c).trim().toUpperCase() === u);
  return hit ?? null;
}

function parseBoolCell(val) {
  const s = String(val ?? "")
    .trim()
    .toUpperCase();
  if (s === "TRUE" || s === "T" || s === "1" || s === "YES") return "TRUE";
  if (s === "FALSE" || s === "F" || s === "0" || s === "NO") return "FALSE";
  return s || "";
}

/** True when the cell should be treated as “no / false” for filtering (null, blank, or CSV NULL). */
function isEmptyOrNullishBoolCell(cellValue) {
  if (cellValue === null || cellValue === undefined) return true;
  const s = String(cellValue).trim();
  if (s === "") return true;
  if (s.toUpperCase() === "NULL") return true;
  return false;
}

/**
 * Row passes the checkbox filter when its value is in `allowed`, or when FALSE is selected and the cell is empty/null.
 */
function cellMatchesAllowedBools(cellValue, allowed) {
  if (!allowed || allowed.length === 0) return true;
  const v = parseBoolCell(cellValue);
  if (allowed.includes(v)) return true;
  if (allowed.includes("FALSE") && isEmptyOrNullishBoolCell(cellValue)) return true;
  return false;
}

function getAllowedFilterValues(fieldLogicalName) {
  const boxes = resultsFiltersEl.querySelectorAll(
    `input[type="checkbox"][data-filter-field="${fieldLogicalName}"]`
  );
  const checked = [...boxes].filter((b) => b.checked).map((b) => b.dataset.filterValue);
  if (checked.length === 0) return null;
  return checked;
}

function applyRowFilters(rows) {
  const colIncluded = findColumnKey(resultsState.columns, "INCLUDED");
  const colPurchased = findColumnKey(resultsState.columns, "IS_PURCHASED");
  const colUsing = findColumnKey(resultsState.columns, "IS_USING");

  return rows.filter((row) => {
    if (colIncluded) {
      const allowed = getAllowedFilterValues("INCLUDED");
      if (allowed && allowed.length > 0) {
        if (!cellMatchesAllowedBools(row[colIncluded], allowed)) return false;
      }
    }
    if (colPurchased) {
      const allowed = getAllowedFilterValues("IS_PURCHASED");
      if (allowed && allowed.length > 0) {
        if (!cellMatchesAllowedBools(row[colPurchased], allowed)) return false;
      }
    }
    if (colUsing) {
      const allowed = getAllowedFilterValues("IS_USING");
      if (allowed && allowed.length > 0) {
        if (!cellMatchesAllowedBools(row[colUsing], allowed)) return false;
      }
    }
    return true;
  });
}

function compareCells(a, b, col) {
  const va = a[col];
  const vb = b[col];
  const sa = String(va ?? "").trim();
  const sb = String(vb ?? "").trim();
  const na = Number(sa);
  const nb = Number(sb);
  if (sa !== "" && sb !== "" && !Number.isNaN(na) && !Number.isNaN(nb)) {
    return na - nb;
  }
  return sa.toLowerCase().localeCompare(sb.toLowerCase(), undefined, {
    numeric: true,
    sensitivity: "base",
  });
}

/**
 * A row is an "entitlement gap" - the rows to focus on first - when the feature
 * is either purchased separately or included in the customer's edition
 * (IS_PURCHASED or INCLUDED = TRUE) but isn't actually being used (IS_USING is
 * FALSE or NULL). These rows are floated to the top by default and visually
 * highlighted in the table.
 */
function isEntitlementGapRow(row) {
  const colIncluded = findColumnKey(resultsState.columns, "INCLUDED");
  const colPurchased = findColumnKey(resultsState.columns, "IS_PURCHASED");
  const colUsing = findColumnKey(resultsState.columns, "IS_USING");
  const entitled =
    (colPurchased && parseBoolCell(row[colPurchased]) === "TRUE") ||
    (colIncluded && parseBoolCell(row[colIncluded]) === "TRUE");
  const usingActive = Boolean(colUsing) && parseBoolCell(row[colUsing]) === "TRUE";
  return Boolean(entitled) && !usingActive;
}

/**
 * Default ordering (used until the user clicks a column to sort): entitlement
 * gap rows float to the top. Original row order is preserved within each group.
 */
function applyDefaultOrder(rows) {
  return rows
    .map((row, i) => ({ row, i }))
    .sort((a, b) => {
      const rankA = isEntitlementGapRow(a.row) ? 0 : 1;
      const rankB = isEntitlementGapRow(b.row) ? 0 : 1;
      return rankA - rankB || a.i - b.i;
    })
    .map((entry) => entry.row);
}

function applySort(rows) {
  const col = resultsState.sortColumn;
  if (!col || !resultsState.columns.includes(col)) return applyDefaultOrder(rows);
  const dir = resultsState.sortDir === "desc" ? -1 : 1;
  return [...rows].sort((a, b) => dir * compareCells(a, b, col));
}

function renderTableBody(columns, rows) {
  resultsBody.innerHTML = "";

  if (!columns.length) {
    resultsBody.innerHTML =
      '<tr><td colspan="1"><p class="empty-hint">No columns returned.</p></td></tr>';
    return;
  }

  if (!rows.length) {
    const tr = document.createElement("tr");
    const td = document.createElement("td");
    td.colSpan = columns.length;
    if (resultsState.rows.length === 0) {
      td.innerHTML =
        '<p class="empty-hint">No products returned for this account.</p>';
    } else {
      td.innerHTML =
        '<p class="empty-hint">No rows match the current filters. Try changing the checkboxes above.</p>';
    }
    tr.appendChild(td);
    resultsBody.appendChild(tr);
    return;
  }

  for (const row of rows) {
    const tr = document.createElement("tr");
    if (isEntitlementGapRow(row)) {
      tr.classList.add("gap-row");
      tr.title = "Entitled (purchased or included) but not being used — review first";
    }
    for (const col of columns) {
      const td = document.createElement("td");
      td.textContent = formatCellValue(row[col]);
      tr.appendChild(td);
    }
    resultsBody.appendChild(tr);
  }
}

function renderSortableHeader() {
  resultsHead.innerHTML = "";
  const columns = resultsState.columns;
  if (!columns.length) return;

  const headerRow = document.createElement("tr");
  for (const col of columns) {
    const th = document.createElement("th");
    th.className = "th-sort";
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "th-sort-btn";
    btn.dataset.sortColumn = col;

    let ariaSort = "none";
    if (resultsState.sortColumn === col) {
      ariaSort = resultsState.sortDir === "asc" ? "ascending" : "descending";
    }
    btn.setAttribute("aria-sort", ariaSort);

    const label = document.createElement("span");
    label.className = "sort-label";
    label.textContent = col;

    const indicators = document.createElement("span");
    indicators.className = "sort-indicators";
    indicators.setAttribute("aria-hidden", "true");
    indicators.innerHTML =
      '<span class="sort-up" title="Ascending">▲</span><span class="sort-down" title="Descending">▼</span>';

    btn.appendChild(label);
    btn.appendChild(indicators);
    btn.setAttribute("aria-label", `Sort by ${col}, ${ariaSort === "none" ? "not sorted" : ariaSort}`);
    th.appendChild(btn);
    headerRow.appendChild(th);
  }
  resultsHead.appendChild(headerRow);
}

function updateFilterBarVisibility() {
  const cols = resultsState.columns;
  const hasIncluded = Boolean(findColumnKey(cols, "INCLUDED"));
  const hasPurchased = Boolean(findColumnKey(cols, "IS_PURCHASED"));
  const hasUsing = Boolean(findColumnKey(cols, "IS_USING"));
  const show = cols.length > 0 && hasPurchased && hasUsing;
  resultsFiltersEl.hidden = !show;
  if (show) {
    for (const group of resultsFiltersEl.querySelectorAll(".results-filters-group")) {
      const forName = group.dataset.filterFor;
      const colExists =
        (forName === "INCLUDED" && hasIncluded) ||
        (forName === "IS_PURCHASED" && hasPurchased) ||
        (forName === "IS_USING" && hasUsing);
      group.hidden = !colExists;
    }
  }
}

function clearFilterCheckboxes() {
  for (const cb of resultsFiltersEl.querySelectorAll('input[type="checkbox"]')) {
    cb.checked = false;
  }
}

function refreshResultsView() {
  updateFilterBarVisibility();
  renderSortableHeader();
  const filtered = applyRowFilters(resultsState.rows);
  const sorted = applySort(filtered);
  renderTableBody(resultsState.columns, sorted);
}

function renderProductDetailTable(rows) {
  const hidden = new Set(PRODUCT_DETAIL_HIDDEN_COLUMNS);
  resultsState.columns = orderedColumns(rows, PRODUCT_DETAIL_PREFERRED_COLUMNS).filter(
    (col) => !hidden.has(col)
  );
  resultsState.rows = rows;
  resultsState.sortColumn = null;
  resultsState.sortDir = "asc";
  clearFilterCheckboxes();
  refreshResultsView();
}

resultsHead.addEventListener("click", (e) => {
  const btn = e.target.closest(".th-sort-btn");
  if (!btn || !resultsHead.contains(btn)) return;
  const col = btn.dataset.sortColumn;
  if (!col) return;

  if (resultsState.sortColumn === col) {
    resultsState.sortDir = resultsState.sortDir === "asc" ? "desc" : "asc";
  } else {
    resultsState.sortColumn = col;
    resultsState.sortDir = "asc";
  }
  refreshResultsView();
});

resultsFiltersEl.addEventListener("change", (e) => {
  if (e.target.matches('input[type="checkbox"][data-filter-field]')) {
    refreshResultsView();
  }
});

/**
 * Generic, read-only table renderer used for every non-primary section (app groups, feature flags, etc).
 * `totalCount`, when provided, is used for the badge instead of rows.length - some sections (e.g. Agent
 * Console Usage) cap the detail rows for size reasons but still know the true total via a separate COUNT(*).
 * `noteEl`, when provided, gets a "showing most recent N of TOTAL" caption whenever rows are capped.
 */
function renderGenericTable(
  headEl,
  bodyEl,
  countEl,
  rows,
  preferredColumns = [],
  totalCount = null,
  noteEl = null,
  noteFormatter = (shown, total) => `Showing ${shown} unique agents, with a total of ${total} executions across all agents`
) {
  const columns = orderedColumns(rows, preferredColumns);
  const effectiveTotal = typeof totalCount === "number" ? totalCount : rows.length;
  headEl.innerHTML = "";
  bodyEl.innerHTML = "";
  if (countEl) countEl.textContent = String(effectiveTotal);
  if (noteEl) {
    if (effectiveTotal > rows.length) {
      noteEl.textContent = noteFormatter(rows.length, effectiveTotal);
      noteEl.hidden = false;
    } else {
      noteEl.textContent = "";
      noteEl.hidden = true;
    }
  }

  if (!columns.length) {
    bodyEl.innerHTML = '<tr><td><p class="empty-hint">No data returned for this section.</p></td></tr>';
    return;
  }

  const headerRow = document.createElement("tr");
  for (const col of columns) {
    const th = document.createElement("th");
    th.textContent = col;
    headerRow.appendChild(th);
  }
  headEl.appendChild(headerRow);

  if (!rows.length) {
    const tr = document.createElement("tr");
    const td = document.createElement("td");
    td.colSpan = columns.length;
    td.innerHTML = '<p class="empty-hint">No rows returned for this section.</p>';
    tr.appendChild(td);
    bodyEl.appendChild(tr);
    return;
  }

  for (const row of rows) {
    const tr = document.createElement("tr");
    for (const col of columns) {
      const td = document.createElement("td");
      td.textContent = formatCellValue(row[col]);
      tr.appendChild(td);
    }
    bodyEl.appendChild(tr);
  }
}

function renderCompanySummary(companyInfoRows) {
  const info = companyInfoRows[0];
  if (!info) {
    companySummaryEl.hidden = true;
    companySummaryEl.innerHTML = "";
    return;
  }

  const fields = [
    ["Company", info.COMPANY_NAME],
    ["Salesforce Account", info.SALESFORCE_ACCOUNT],
    ["Renewal Date", info.RENEWAL_DATE],
    ["Platform Edition", info.PLATFORM_EDITION],
    ["CFID", info.CFID],
    ["SFID", info.SFID],
    ["Cluster", info.CLUSTER],
    ["Territory", info.TERRITORY_V3],
    ["Billing Country", info.BILLINGCOUNTRY],
    ["Success Manager", info.SUCCESS_MANAGER_NAME],
  ];

  companySummaryEl.innerHTML = fields
    .filter(([, value]) => value !== null && value !== undefined && value !== "")
    .map(
      ([label, value]) =>
        `<div class="company-summary-item"><span class="company-summary-label">${escapeHtml(
          label
        )}</span><span class="company-summary-value">${escapeHtml(formatCellValue(value))}</span></div>`
    )
    .join("");
  companySummaryEl.hidden = false;
}

featureFlipperSearchEl.addEventListener("input", () => {
  const q = featureFlipperSearchEl.value.trim().toLowerCase();
  const filtered = q
    ? featureFlipperRows.filter((row) => String(row.NAME ?? "").toLowerCase().includes(q))
    : featureFlipperRows;
  renderGenericTable(featureFlipperHead, featureFlipperBody, featureFlipperCount, filtered, [
    "NAME",
    "STATUS",
    "DATE",
    "DS_ID",
    "D_ID",
    "REFRESHED_AT",
  ]);
});

const SECONDARY_RESULT_BLOCKS = [agentConsoleUsageBlock, operatorUsageBlock, appGroupsBlock, appGroupsDsBlock, featureFlipperBlock];

function renderUsage(usage) {
  const accountFound = (usage.company_info ?? []).length > 0;

  if (!accountFound) {
    // Don't show the Results section at all when the account can't be resolved;
    // surface the message below the Run query button (in the status area).
    resultsSection.hidden = true;
    showStatus(
      "No account was found, please check that the account name or Salesforce account ID you entered matches the value in Salesforce",
      "error"
    );
    return;
  }

  const platformEdition = (usage.company_info ?? [])[0]?.PLATFORM_EDITION ?? null;

  renderCompanySummary(usage.company_info ?? []);
  renderProductDetailTable(
    augmentProductRowsWithIncluded(usage.product_detail ?? [], platformEdition)
  );

  for (const block of SECONDARY_RESULT_BLOCKS) {
    if (block) block.hidden = false;
  }

  renderGenericTable(
    agentConsoleUsageHead,
    agentConsoleUsageBody,
    agentConsoleUsageCount,
    usage.agent_console_usage ?? [],
    ["AGENT_NAME", "LLM_OWNED_BY_CUSTOMER", "MODEL_PROVIDER", "MODEL_NAME", "INVOCATION_SOURCE"],
    usage.agent_console_usage_total_count,
    agentConsoleUsageNote
  );

  renderGenericTable(
    operatorUsageHead,
    operatorUsageBody,
    operatorUsageCount,
    usage.operator_usage ?? [],
    ["SF_CREATED_AT", "CHAT_SEGMENT_AS_MARKDOWN"],
    usage.operator_usage_total_count,
    operatorUsageNote,
    (shown, total) => `Showing the ${shown} most recent of ${total} operator messages`
  );

  renderGenericTable(appGroupsHead, appGroupsBody, appGroupsCount, usage.app_groups ?? [], [
    "APP_GROUP_NAME",
    "AG_ID",
    "EID",
    "SDK_CONFIGURATION_LAST_UPDATED",
    "CURRENTS_INTEGRATIONS_ENTITLEMENTS",
    "CURRENTS_INTEGRATIONS_USER_BEHAVIOR_ENTITLEMENTS",
    "DATASHARE_INTEGRATIONS_ENTITLEMENTS",
    "DATASHARE_INTEGRATIONS_CRR_ENTITLEMENTS",
    "REFRESHED_AT",
  ]);

  renderGenericTable(appGroupsDsHead, appGroupsDsBody, appGroupsDsCount, usage.app_groups_ds ?? [], [
    "APP_GROUP_NAME",
    "AG_ID",
    "DATE",
    "TOTAL_USERS",
    "MESSAGED_USERS",
    "DAU",
    "MAU",
    "W_MAU",
    "M_MAU",
    "BILLABLE_USERS",
    "REFRESHED_AT",
  ]);

  renderGenericTable(
    partnerIntegrationsHead,
    partnerIntegrationsBody,
    partnerIntegrationsCount,
    usage.partner_integrations ?? [],
    [
      "APP_GROUP_NAME",
      "AG_ID",
      "PARTNER",
      "PARTNER_CLASS",
      "IS_ACTIVE",
      "CONNECTION_COUNT",
      "FIRST_CONNECTION",
      "MOST_RECENT_CONNECTION",
    ]
  );

  renderGenericTable(
    billableElementsHead,
    billableElementsBody,
    billableElementsCount,
    usage.billable_elements ?? [],
    ["APP_GROUP_NAME", "AG_ID", "ACTIVE_CURRENTS_INTEGRATIONS", "PARTNER_INTEGRATION_LIST"]
  );

  featureFlipperRows = usage.feature_flipper ?? [];
  featureFlipperSearchEl.value = "";
  renderGenericTable(featureFlipperHead, featureFlipperBody, featureFlipperCount, featureFlipperRows, [
    "NAME",
    "STATUS",
    "DATE",
    "DS_ID",
    "D_ID",
    "REFRESHED_AT",
  ]);
  // Always collapse Feature Flips on a fresh result set, even if the user
  // had it expanded from a previous query in this session.
  featureFlipperBlock.open = false;

  resultsSection.hidden = false;
}

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  closeSuggestions();
  clearStatus();
  resultsSection.hidden = true;

  const fd = new FormData(form);
  const email = String(fd.get("email") || "").trim();
  const customerName = String(fd.get("customerName") || "").trim();

  submitBtn.disabled = true;

  let waitMessage =
    "Running query, please wait a few seconds... If a new tab opens, complete Okta sign-in";
  try {
    const sessionRes = await fetch(
      `/api/session?email=${encodeURIComponent(email)}`
    );
    if (sessionRes.ok) {
      const session = await sessionRes.json();
      if (session.snowflakeSessionReused) {
        waitMessage = "Running query, please wait a few seconds...";
      }
    }
  } catch {
    /* ignore session probe */
  }
  showStatus(waitMessage, "info");

  try {
    const res = await fetch("/api/query", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, customerName }),
    });
    const data = await res.json().catch(() => ({}));

    if (!res.ok) {
      showStatus(data.error || `Request failed (${res.status}).`, "error");
      return;
    }

    clearStatus();
    renderUsage(data.usage || {});
  } catch (err) {
    showStatus(
      err instanceof Error ? err.message : "Network error.",
      "error"
    );
  } finally {
    submitBtn.disabled = false;
  }
});

/* ---------- Customer-name type-ahead ---------- */
const customerInput = document.getElementById("customer-name-input");
const emailInput = form.querySelector('input[name="email"]');
const suggestionsEl = document.getElementById("customer-suggestions");

const suggestState = { items: [], activeIndex: -1, seq: 0, open: false };
let suggestDebounce = null;

function closeSuggestions() {
  suggestState.open = false;
  suggestState.items = [];
  suggestState.activeIndex = -1;
  suggestionsEl.hidden = true;
  suggestionsEl.innerHTML = "";
  customerInput.setAttribute("aria-expanded", "false");
  customerInput.removeAttribute("aria-activedescendant");
}

/** Wraps the matched portion of a name in <mark> for display (input is HTML-escaped first). */
function highlightMatch(name, query) {
  const idx = name.toLowerCase().indexOf(query.toLowerCase());
  if (idx === -1) return escapeHtml(name);
  return (
    escapeHtml(name.slice(0, idx)) +
    `<mark>${escapeHtml(name.slice(idx, idx + query.length))}</mark>` +
    escapeHtml(name.slice(idx + query.length))
  );
}

function renderSuggestions(items, query) {
  suggestState.items = items;
  suggestState.activeIndex = -1;
  if (!items.length) {
    closeSuggestions();
    return;
  }
  suggestionsEl.innerHTML = items
    .map(
      (name, i) =>
        `<li class="suggestion-item" role="option" id="suggestion-${i}" data-index="${i}">${highlightMatch(
          name,
          query
        )}</li>`
    )
    .join("");
  suggestionsEl.hidden = false;
  suggestState.open = true;
  customerInput.setAttribute("aria-expanded", "true");
}

function setActiveSuggestion(index) {
  const options = suggestionsEl.querySelectorAll(".suggestion-item");
  if (!options.length) return;
  const clamped = (index + options.length) % options.length;
  suggestState.activeIndex = clamped;
  options.forEach((el, i) => {
    el.classList.toggle("active", i === clamped);
    if (i === clamped) {
      el.scrollIntoView({ block: "nearest" });
      customerInput.setAttribute("aria-activedescendant", el.id);
    }
  });
}

function chooseSuggestion(index) {
  const name = suggestState.items[index];
  if (typeof name !== "string") return;
  customerInput.value = name;
  closeSuggestions();
}

async function fetchSuggestions(query) {
  const email = String(emailInput?.value || "").trim();
  if (!email || query.length < 2) {
    closeSuggestions();
    return;
  }
  const seq = ++suggestState.seq;
  try {
    const res = await fetch(
      `/api/suggest?email=${encodeURIComponent(email)}&q=${encodeURIComponent(query)}`
    );
    if (!res.ok) return;
    const data = await res.json().catch(() => ({}));
    // Drop stale responses (a newer keystroke has since fired) or ones whose
    // query no longer matches what's in the box.
    if (seq !== suggestState.seq || customerInput.value.trim() !== query) return;
    renderSuggestions(Array.isArray(data.suggestions) ? data.suggestions : [], query);
  } catch {
    /* suggestions are best-effort; ignore errors */
  }
}

customerInput.addEventListener("input", () => {
  const query = customerInput.value.trim();
  if (suggestDebounce) clearTimeout(suggestDebounce);
  if (query.length < 2) {
    closeSuggestions();
    return;
  }
  suggestDebounce = setTimeout(() => fetchSuggestions(query), 180);
});

customerInput.addEventListener("keydown", (e) => {
  if (!suggestState.open) return;
  switch (e.key) {
    case "ArrowDown":
      e.preventDefault();
      setActiveSuggestion(suggestState.activeIndex + 1);
      break;
    case "ArrowUp":
      e.preventDefault();
      setActiveSuggestion(suggestState.activeIndex - 1);
      break;
    case "Enter":
      // Only intercept Enter when a suggestion is highlighted; otherwise let
      // the form submit as normal.
      if (suggestState.activeIndex >= 0) {
        e.preventDefault();
        chooseSuggestion(suggestState.activeIndex);
      }
      break;
    case "Escape":
      closeSuggestions();
      break;
    default:
      break;
  }
});

// mousedown (not click) so selection runs before the input's blur handler fires.
suggestionsEl.addEventListener("mousedown", (e) => {
  const item = e.target.closest(".suggestion-item");
  if (!item) return;
  e.preventDefault();
  chooseSuggestion(Number(item.dataset.index));
});

customerInput.addEventListener("blur", () => {
  // Small delay lets a suggestion mousedown complete before we close.
  setTimeout(closeSuggestions, 120);
});

/* ---------- Two-step flow: authenticate, then reveal the search field ---------- */
const authBtn = document.getElementById("auth-btn");
const authRow = document.getElementById("auth-row");
const searchSection = document.getElementById("search-section");

let authenticatedEmail = null;

function setSearchVisible(visible) {
  searchSection.hidden = !visible;
  authRow.hidden = visible;
}

authBtn.addEventListener("click", async () => {
  const email = String(emailInput.value || "").trim();
  if (!email) {
    showStatus("Email Address is required.", "error");
    emailInput.focus();
    return;
  }
  authBtn.disabled = true;
  showStatus(
    "Authenticating with Snowflake... If a new tab opens, complete Okta sign-in",
    "info"
  );
  try {
    const res = await fetch("/api/authenticate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      showStatus(data.error || `Authentication failed (${res.status}).`, "error");
      return;
    }
    authenticatedEmail = email;
    setSearchVisible(true);
    clearStatus();
    customerInput.focus();
  } catch (err) {
    showStatus(err instanceof Error ? err.message : "Network error.", "error");
  } finally {
    authBtn.disabled = false;
  }
});

// Changing the email after connecting invalidates the session, so drop back to
// the authenticate step (the server would need a fresh connection anyway).
emailInput.addEventListener("input", () => {
  if (authenticatedEmail !== null && String(emailInput.value || "").trim() !== authenticatedEmail) {
    authenticatedEmail = null;
    setSearchVisible(false);
    resultsSection.hidden = true;
    customerInput.value = "";
    closeSuggestions();
  }
});

// Pre-auth the email field is the only visible control, so make Enter trigger
// Authenticate rather than submitting the (still-hidden, incomplete) form.
emailInput.addEventListener("keydown", (e) => {
  if (e.key !== "Enter") return;
  e.preventDefault();
  if (authenticatedEmail && String(emailInput.value || "").trim() === authenticatedEmail) {
    customerInput.focus();
  } else {
    authBtn.click();
  }
});
