import { spawn } from "node:child_process";
import { unlink } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import express from "express";
import { parse } from "csv-parse/sync";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SNOW_ACCOUNT = "BRAZE-XJ24206_AWS_US_EAST_1";
const OUTPUT_DIR = path.join(__dirname, "query-output");
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
WHERE ACCOUNT_NAME = '${safeName}' AND IS_PURCHASED = TRUE AND IS_USING = FALSE;`;
}

const DEFAULT_COLUMNS = [
  "ACCOUNT_ID",
  "ACCOUNT_NAME",
  "PRODUCT",
  "IS_PURCHASED",
  "IS_USING",
];

async function parseCsvFile(filePath) {
  const content = await readFile(filePath, "utf8");
  const matrix = parse(content, {
    skip_empty_lines: true,
    trim: true,
    relax_column_count: true,
  });
  if (matrix.length === 0) {
    return { columns: [...DEFAULT_COLUMNS], rows: [] };
  }
  const headers = matrix[0].map((h) => String(h).trim());
  const rows = matrix.slice(1).map((cells) => {
    const row = {};
    for (let i = 0; i < headers.length; i++) {
      const key = headers[i] || `column_${i}`;
      row[key] = cells[i] ?? "";
    }
    return row;
  });
  return { columns: headers, rows };
}

function runSnowsql(email, query, outputPath) {
  return new Promise((resolve, reject) => {
    const args = [
      "-a",
      SNOW_ACCOUNT,
      "-u",
      email,
      "--authenticator",
      "externalbrowser",
      "-o",
      "client_store_temporary_credential=true",
      "-o",
      "output_format=csv",
      "-o",
      "header=true",
      "-o",
      "timing=false",
      "-o",
      "friendly=false",
      "-o",
      `output_file=${outputPath}`,
      "-q",
      query,
    ];
    const child = spawn("snowsql", args, {
      stdio: ["ignore", "pipe", "pipe"],
      env: process.env,
    });
    let stderr = "";
    child.stderr?.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", (err) => {
      if (err.code === "ENOENT") {
        reject(
          new Error(
            "snowsql was not found. Install SnowSQL and ensure it is on your PATH."
          )
        );
      } else {
        reject(err);
      }
    });
    child.on("close", (code) => {
      if (code === 0) resolve();
      else
        reject(
          new Error(
            stderr.trim() || `snowsql exited with code ${code ?? "unknown"}`
          )
        );
    });
  });
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
  res.json({
    snowflakeSessionReused: establishedAuthKeys.has(authKey(email)),
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

  await mkdir(OUTPUT_DIR, { recursive: true });
  const outputFile = `account_output_${randomUUID()}.csv`;
  const outputPath = path.join(OUTPUT_DIR, outputFile);
  const query = buildQuery(customerName);
  const key = authKey(email);
  const snowflakeSessionReused = establishedAuthKeys.has(key);

  try {
    await runSnowsql(email, query, outputPath);
    const { columns, rows } = await parseCsvFile(outputPath);
    unlink(outputPath, () => {});
    if (!establishedAuthKeys.has(key)) {
      establishedAuthKeys.add(key);
      await persistAuthKeys(establishedAuthKeys);
    }
    res.json({ columns, rows, snowflakeSessionReused });
  } catch (err) {
    unlink(outputPath, () => {});
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: message });
  }
});

const port = Number(process.env.PORT) || 3000;
app.listen(port, () => {
  console.log(`Open http://localhost:${port}`);
});
