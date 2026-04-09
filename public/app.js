const form = document.getElementById("query-form");
const statusEl = document.getElementById("status");
const resultsSection = document.getElementById("results-section");
const resultsFiltersEl = document.getElementById("results-filters");
const resultsHead = document.getElementById("results-head");
const resultsBody = document.getElementById("results-body");
const submitBtn = document.getElementById("submit-btn");

/** @type {{ columns: string[], rows: Record<string, string>[], sortColumn: string | null, sortDir: 'asc' | 'desc' }} */
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

function getAllowedFilterValues(fieldLogicalName) {
  const boxes = resultsFiltersEl.querySelectorAll(
    `input[type="checkbox"][data-filter-field="${fieldLogicalName}"]`
  );
  const checked = [...boxes].filter((b) => b.checked).map((b) => b.dataset.filterValue);
  if (checked.length === 0) return null;
  return checked;
}

function applyRowFilters(rows) {
  const colPurchased = findColumnKey(resultsState.columns, "IS_PURCHASED");
  const colUsing = findColumnKey(resultsState.columns, "IS_USING");

  return rows.filter((row) => {
    if (colPurchased) {
      const allowed = getAllowedFilterValues("IS_PURCHASED");
      if (allowed && allowed.length > 0) {
        const v = parseBoolCell(row[colPurchased]);
        if (!allowed.includes(v)) return false;
      }
    }
    if (colUsing) {
      const allowed = getAllowedFilterValues("IS_USING");
      if (allowed && allowed.length > 0) {
        const v = parseBoolCell(row[colUsing]);
        if (!allowed.includes(v)) return false;
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

function applySort(rows) {
  const col = resultsState.sortColumn;
  if (!col || !resultsState.columns.includes(col)) return rows;
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
        '<p class="empty-hint">No customer matched your search. Please use the EXACT account name as it appears in Salesforce.</p>';
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
    for (const col of columns) {
      const td = document.createElement("td");
      const v = row[col];
      td.textContent = v === null || v === undefined ? "" : String(v);
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
  const hasPurchased = Boolean(findColumnKey(cols, "IS_PURCHASED"));
  const hasUsing = Boolean(findColumnKey(cols, "IS_USING"));
  const show = cols.length > 0 && hasPurchased && hasUsing;
  resultsFiltersEl.hidden = !show;
  if (show) {
    for (const group of resultsFiltersEl.querySelectorAll(".results-filters-group")) {
      const forName = group.dataset.filterFor;
      const colExists =
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

function renderTable(columns, rows) {
  resultsState.columns = columns;
  resultsState.rows = rows;
  resultsState.sortColumn = null;
  resultsState.sortDir = "asc";
  clearFilterCheckboxes();
  refreshResultsView();
  resultsSection.hidden = false;
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

form.addEventListener("submit", async (e) => {
  e.preventDefault();
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
    renderTable(data.columns || [], data.rows || []);
  } catch (err) {
    showStatus(
      err instanceof Error ? err.message : "Network error.",
      "error"
    );
  } finally {
    submitBtn.disabled = false;
  }
});
