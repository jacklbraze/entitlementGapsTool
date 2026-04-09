const form = document.getElementById("query-form");
const statusEl = document.getElementById("status");
const resultsSection = document.getElementById("results-section");
const resultsHead = document.getElementById("results-head");
const resultsBody = document.getElementById("results-body");
const submitBtn = document.getElementById("submit-btn");

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

function renderTable(columns, rows) {
  resultsHead.innerHTML = "";
  resultsBody.innerHTML = "";

  if (!columns.length) {
    resultsSection.hidden = false;
    resultsBody.innerHTML =
      '<tr><td colspan="1"><p class="empty-hint">No columns returned.</p></td></tr>';
    return;
  }

  const headerRow = document.createElement("tr");
  for (const col of columns) {
    const th = document.createElement("th");
    th.textContent = col;
    headerRow.appendChild(th);
  }
  resultsHead.appendChild(headerRow);

  if (!rows.length) {
    const tr = document.createElement("tr");
    const td = document.createElement("td");
    td.colSpan = columns.length;
    td.innerHTML = '<p class="empty-hint">No rows matched your filters.</p>';
    tr.appendChild(td);
    resultsBody.appendChild(tr);
  } else {
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

  resultsSection.hidden = false;
}

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  clearStatus();
  resultsSection.hidden = true;

  const fd = new FormData(form);
  const email = String(fd.get("email") || "").trim();
  const customerName = String(fd.get("customerName") || "").trim();

  submitBtn.disabled = true;

  let waitMessage =
    "Running snowsql… If a browser opens, complete sign-in (first time for this email on this app).";
  try {
    const sessionRes = await fetch(
      `/api/session?email=${encodeURIComponent(email)}`
    );
    if (sessionRes.ok) {
      const session = await sessionRes.json();
      if (session.snowflakeSessionReused) {
        waitMessage =
          "Running snowsql… Using your saved Snowflake session (browser usually stays closed until the session expires).";
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
