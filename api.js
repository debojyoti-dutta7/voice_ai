// REST API behind the dashboard.
import ExcelJS from "exceljs";
import * as store from "./store.js";
import { startCampaign, stopCampaign, campaignState, dialLead } from "./campaign.js";

const json = (res, code, body) => {
  res.writeHead(code, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
};

// Collected as Buffers, not a string: an .xlsx is binary and string concatenation
// would corrupt it.
const readBody = (req) =>
  new Promise((resolve) => {
    const chunks = [];
    req.on("data", (d) => chunks.push(d));
    req.on("end", () => resolve(Buffer.concat(chunks)));
  });

// .xlsx is a zip; every one starts with "PK\x03\x04".
const isXlsx = (buf) =>
  buf.length > 4 && buf[0] === 0x50 && buf[1] === 0x4b && buf[2] === 0x03 && buf[3] === 0x04;

async function rowsFromWorkbook(buf) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf);
  const sheet = wb.worksheets[0];
  if (!sheet) return { rows: [], sheetName: null, sheetCount: 0 };

  const rows = [];
  sheet.eachRow({ includeEmpty: false }, (row) => {
    // row.values is 1-indexed with a leading hole; cells may be rich text or formulas.
    const cells = (row.values || []).slice(1).map((v) => {
      if (v == null) return "";
      if (typeof v === "object") {
        if (v.text) return v.text;
        if (v.result != null) return String(v.result);
        if (v.richText) return v.richText.map((t) => t.text).join("");
        return "";
      }
      return v;
    });
    rows.push(cells);
  });
  return { rows, sheetName: sheet.name, sheetCount: wb.worksheets.length };
}

/** Returns true if it handled the request. */
export async function handleApi(req, res, url) {
  if (!url.pathname.startsWith("/api/")) return false;
  const p = url.pathname;

  try {
    if (p === "/api/stats" && req.method === "GET") {
      json(res, 200, { ...store.stats(), campaign: campaignState(), store: store.storeStatus() });
      return true;
    }

    if (p === "/api/leads" && req.method === "GET") {
      json(res, 200, store.listLeads());
      return true;
    }

    if (p === "/api/leads" && req.method === "POST") {
      const body = await readBody(req);
      const ct = req.headers["content-type"] || "";
      let rows, source = null;

      if (isXlsx(body)) {
        const { rows: grid, sheetName, sheetCount } = await rowsFromWorkbook(body);
        rows = store.rowsToLeads(grid);
        source = { type: "xlsx", sheet: sheetName, sheetCount, rowsRead: grid.length };
      } else if (ct.includes("application/json")) {
        const parsed = JSON.parse(body.toString("utf8") || "[]");
        rows = Array.isArray(parsed) ? parsed : [parsed];
      } else {
        rows = store.parseCsv(body.toString("utf8"));
      }

      json(res, 200, { ...store.addLeads(rows), source });
      return true;
    }

    if (p.startsWith("/api/leads/") && req.method === "DELETE") {
      store.deleteLead(p.split("/")[3]);
      json(res, 200, { ok: true });
      return true;
    }

    if (p.startsWith("/api/leads/") && p.endsWith("/call") && req.method === "POST") {
      json(res, 200, await dialLead(p.split("/")[3]));
      return true;
    }

    if (p === "/api/calls" && req.method === "GET") {
      // Newest first, transcripts trimmed — the detail view fetches the full record.
      const calls = [...store.listCalls()].reverse().map(({ transcript, toolCalls, candidate, ...c }) => {
        const f = candidate?.fields || {};
        const val = (k) => (f[k]?.status === "answered" ? f[k].value : null);
        const answered = Object.values(f).filter((x) => x.status === "answered").length;
        return {
          ...c,
          turns: transcript.length,
          summary: {
            name: val("name"),
            openToChange: val("open_to_change"),
            totalExperience: val("total_experience"),
            designation: val("designation"),
            currentSalary: val("current_salary"),
            noticePeriod: val("notice_period"),
            answered,
            operators: candidate?.operators?.length || 0,
            locations: candidate?.locations?.length || 0,
          },
        };
      });
      json(res, 200, calls);
      return true;
    }

    if (p.startsWith("/api/calls/") && req.method === "GET") {
      const call = store.getCall(p.split("/")[3]);
      if (!call) return json(res, 404, { error: "not found" }), true;
      const lead = call.leadId ? store.getLead(call.leadId) : null;
      json(res, 200, { ...call, lead });
      return true;
    }

    if (p === "/api/campaign/start" && req.method === "POST") {
      const body = await readBody(req);
      let leadIds;
      try { leadIds = JSON.parse(body || "{}").leadIds; } catch { leadIds = undefined; }
      json(res, 200, await startCampaign(leadIds));
      return true;
    }

    if (p === "/api/campaign/stop" && req.method === "POST") {
      json(res, 200, stopCampaign());
      return true;
    }

    json(res, 404, { error: "unknown endpoint" });
    return true;
  } catch (err) {
    console.error("[api]", err);
    json(res, 500, { error: err.message });
    return true;
  }
}
