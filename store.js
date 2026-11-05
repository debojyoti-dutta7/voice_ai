// MongoDB-backed store for leads and calls.
//
// Documents live in Mongo, but the process also keeps them in memory: the call bridge and
// the tool handlers run inside Deepgram's function-call path, which is synchronous, so
// reads must not await. Writes go to memory immediately and are mirrored to Mongo. That
// means one writer process — run a single instance until the read paths are made async.
import { MongoClient } from "mongodb";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const DB_NAME = process.env.MONGO_DB || "AI";
const LEADS = "solar_leads"; // namespaced: the AI database is shared
const CALLS = "solar_calls";

let client = null;
let leadsCol = null;
let callsCol = null;
let ready = false;
let lastError = null;
let retryTimer = null;
// Documents changed while Mongo was unreachable, flushed on reconnect.
const pendingLeads = new Set();
const pendingCalls = new Set();

const mem = { leads: [], calls: [] };
const seq = { lead: 1, call: 1 };

const nextId = (prefix, key) => `${prefix}${seq[key]++}`;

/** Mirror a document to Mongo. Failures are logged, never thrown into a live call. */
function mirror(col, doc) {
  const pending = col === leadsCol ? pendingLeads : pendingCalls;
  if (!ready || !col) {
    // Remember it so nothing said on a call is lost when Mongo comes back.
    pending.add(doc.id);
    return;
  }
  col.replaceOne({ id: doc.id }, doc, { upsert: true }).catch((e) => {
    pending.add(doc.id);
    console.error(`[store] write failed for ${doc.id}:`, e.message);
  });
}

async function flushPending() {
  for (const [set, col, list] of [
    [pendingLeads, leadsCol, mem.leads],
    [pendingCalls, callsCol, mem.calls],
  ]) {
    for (const id of [...set]) {
      const doc = list.find((d) => d.id === id);
      if (!doc) { set.delete(id); continue; }
      try {
        await col.replaceOne({ id }, doc, { upsert: true });
        set.delete(id);
      } catch (e) {
        console.error(`[store] flush failed for ${id}:`, e.message);
        return;
      }
    }
  }
}

export const storeStatus = () => ({
  connected: ready,
  error: lastError,
  pendingWrites: pendingLeads.size + pendingCalls.size,
});

/**
 * Connect to Mongo. A failure here is not fatal: the process keeps running on the
 * in-memory mirror and retries in the background, because a database blip must not
 * mean the agent cannot take calls at all. Writes made while disconnected are queued
 * and flushed on reconnect.
 */
export async function init({ required = false } = {}) {
  try {
    await connect();
  } catch (err) {
    lastError = err.message;
    console.error(`[store] MONGO UNAVAILABLE — ${err.message}`);
    console.error("[store] running in memory only; data will be written when Mongo returns");
    if (required) throw err;
    scheduleRetry();
  }
}

function scheduleRetry(ms = 15000) {
  if (retryTimer) return;
  retryTimer = setTimeout(async () => {
    retryTimer = null;
    try {
      await connect();
      console.log(`[store] reconnected; flushing ${pendingLeads.size + pendingCalls.size} pending writes`);
      await flushPending();
    } catch (err) {
      lastError = err.message;
      scheduleRetry(ms);
    }
  }, ms);
  retryTimer.unref?.();
}

async function connect() {
  const uri = process.env.MONGO_URI;
  if (!uri) throw new Error("MONGO_URI is not set");

  client = new MongoClient(uri, { serverSelectionTimeoutMS: 10000 });
  await client.connect();
  const db = client.db(DB_NAME);
  leadsCol = db.collection(LEADS);
  callsCol = db.collection(CALLS);

  await leadsCol.createIndex({ id: 1 }, { unique: true });
  await leadsCol.createIndex({ phone: 1 }, { unique: true });
  await callsCol.createIndex({ id: 1 }, { unique: true });
  await callsCol.createIndex({ callSid: 1 });
  await callsCol.createIndex({ startedAt: -1 });

  // Only adopt Mongo's copy on a cold start. On reconnect the in-memory copy is
  // newer — it has whatever was said while the database was away.
  const coldStart = mem.leads.length === 0 && mem.calls.length === 0;
  if (coldStart) {
    mem.leads = await leadsCol.find({}, { projection: { _id: 0 } }).toArray();
    mem.calls = await callsCol.find({}, { projection: { _id: 0 } }).toArray();
  }
  ready = true;
  lastError = null;

  if (!coldStart) return;

  const maxNum = (arr, p) =>
    arr.reduce((m, x) => Math.max(m, Number(String(x.id).replace(p, "")) || 0), 0);
  seq.lead = maxNum(mem.leads, "L") + 1;
  seq.call = maxNum(mem.calls, "C") + 1;

  await migrateJsonFile();

  // A lead is only "calling" while a process is dialing it. Nothing is in flight at
  // startup, so release anything a crash left stranded rather than stranding it forever.
  const stranded = mem.leads.filter((l) => l.status === "calling");
  stranded.forEach((l) => { l.status = "pending"; mirror(leadsCol, l); });

  console.log(
    `[store] mongo ${DB_NAME}.${LEADS}/${CALLS} — ${mem.leads.length} leads, ${mem.calls.length} calls` +
    (stranded.length ? `, released ${stranded.length} stranded` : "")
  );
}

/** One-time import of the old file store, so nothing from local testing is lost. */
async function migrateJsonFile() {
  if (mem.leads.length || mem.calls.length) return;
  const file = path.join(path.dirname(fileURLToPath(import.meta.url)), "data", "store.json");
  if (!fs.existsSync(file)) return;
  try {
    const old = JSON.parse(fs.readFileSync(file, "utf8"));
    if (old.leads?.length) {
      mem.leads = old.leads;
      await leadsCol.insertMany(old.leads, { ordered: false }).catch(() => {});
    }
    if (old.calls?.length) {
      mem.calls = old.calls;
      await callsCol.insertMany(old.calls, { ordered: false }).catch(() => {});
    }
    if (old.seq) Object.assign(seq, old.seq);
    fs.renameSync(file, file + ".migrated");
    console.log(`[store] migrated ${old.leads?.length || 0} leads / ${old.calls?.length || 0} calls from data/store.json`);
  } catch (e) {
    console.error("[store] migration skipped:", e.message);
  }
}

export async function close() {
  ready = false;
  if (client) await client.close();
}

export const normalizePhone = (raw) => {
  const d = String(raw || "").replace(/\D/g, "");
  const ten = d.length > 10 ? d.slice(-10) : d;
  return /^[6-9]\d{9}$/.test(ten) ? ten : null;
};

// --- leads -----------------------------------------------------------------
export function addLeads(rows) {
  const added = [], skipped = [];
  for (const row of rows) {
    const phone = normalizePhone(row.phone);
    if (!phone) { skipped.push({ ...row, reason: "invalid phone" }); continue; }
    if (mem.leads.some((l) => l.phone === phone)) {
      skipped.push({ ...row, phone, reason: "duplicate" });
      continue;
    }
    const lead = {
      id: nextId("L", "lead"),
      name: row.name || "", phone, city: row.city || "", notes: row.notes || "",
      status: "pending", attempts: 0, lastCallId: null,
      createdAt: new Date().toISOString(),
    };
    mem.leads.push(lead);
    mirror(leadsCol, lead);
    added.push(lead);
  }
  return { added, skipped };
}

export const listLeads = () => mem.leads;
export const getLead = (id) => mem.leads.find((l) => l.id === id);
export const findLeadByPhone = (phone) => mem.leads.find((l) => l.phone === normalizePhone(phone));

export function updateLead(id, patch) {
  const lead = getLead(id);
  if (!lead) return null;
  Object.assign(lead, patch);
  mirror(leadsCol, lead);
  return lead;
}

export function deleteLead(id) {
  const i = mem.leads.findIndex((l) => l.id === id);
  if (i < 0) return;
  mem.leads.splice(i, 1);
  if (ready) leadsCol.deleteOne({ id }).catch((e) => console.error("[store] delete failed:", e.message));
}

export function nextPendingLead(maxAttempts = 2) {
  return mem.leads.find(
    (l) => l.status !== "dnc" && (l.status === "pending" || (l.status === "failed" && l.attempts < maxAttempts))
  );
}

// --- calls -----------------------------------------------------------------
export function createCall({ callSid, leadId, phone, direction = "outbound" }) {
  const call = {
    id: nextId("C", "call"),
    callSid: callSid || null, leadId: leadId || null,
    phone: normalizePhone(phone) || phone || null,
    direction, startedAt: new Date().toISOString(),
    endedAt: null, durationSec: null, exotelStatus: null, connected: false,
    outcome: null, interest: null, reason: null,
    // Questionnaire answers. Each field keeps the structured value, what the candidate
    // actually said, and whether it was answered at all — "not answered" must never
    // collapse into zero.
    candidate: { fields: {}, experience: [], operators: [], locations: [] },
    followUpRequired: false,
    callbackAt: null,
    captured: {}, booking: null, transcript: [], toolCalls: [],
  };
  mem.calls.push(call);
  mirror(callsCol, call);
  return call;
}

export const getCall = (id) => mem.calls.find((c) => c.id === id);
export const getCallBySid = (sid) => mem.calls.find((c) => c.callSid === sid);
export const listCalls = () => mem.calls;

export function updateCall(id, patch) {
  const call = getCall(id);
  if (!call) return null;
  if (patch.captured) {
    call.captured = { ...call.captured, ...patch.captured };
    patch = { ...patch };
    delete patch.captured;
  }
  Object.assign(call, patch);
  mirror(callsCol, call);
  return call;
}

function candidateOf(id) {
  const call = getCall(id);
  if (!call) return null;
  call.candidate ||= { fields: {}, experience: [], operators: [], locations: [] };
  return call;
}

export function recordAnswer(id, { field, value, spoken, status }) {
  const call = candidateOf(id);
  if (!call) return;
  call.candidate.fields[field] = {
    value: status === "answered" ? value : null,
    spoken: spoken || null,
    status: status || "answered",
    at: new Date().toISOString(),
  };
  if (status === "unclear") call.followUpRequired = true;
  mirror(callsCol, call);
}

export function recordExperience(id, { category, item, years, months, status, spoken }) {
  const call = candidateOf(id);
  if (!call) return;
  const answered = status === "answered";
  const existing = call.candidate.experience.find((e) => e.item === item && e.category === category);
  const entry = {
    category, item,
    years: answered ? Number(years) || 0 : null,
    months: answered ? Number(months) || 0 : null,
    status: status || "answered",
    spoken: spoken || null,
  };
  if (existing) Object.assign(existing, entry);
  else call.candidate.experience.push(entry);
  if (status === "unclear") call.followUpRequired = true;
  mirror(callsCol, call);
}

export function recordOperator(id, op) {
  const call = candidateOf(id);
  if (!call) return;
  const existing = call.candidate.operators.find(
    (o) => o.operator?.toLowerCase() === String(op.operator || "").toLowerCase()
  );
  const entry = {
    operator: op.operator,
    years: op.years != null ? Number(op.years) : null,
    months: op.months != null ? Number(op.months) : null,
    employmentType: op.employment_type || null,
    partnerName: op.partner_name || null,
  };
  if (existing) Object.assign(existing, entry);
  else call.candidate.operators.push(entry);
  mirror(callsCol, call);
}

export function recordLocation(id, loc) {
  const call = candidateOf(id);
  if (!call) return;
  const existing = call.candidate.locations.find(
    (l) => l.location?.toLowerCase() === String(loc.location || "").toLowerCase()
  );
  const entry = {
    location: loc.location,
    minSalary: loc.min_salary_inr != null ? Number(loc.min_salary_inr) : null,
    isHome: !!loc.is_home_location,
  };
  if (existing) Object.assign(existing, entry);
  else call.candidate.locations.push(entry);
  mirror(callsCol, call);
}

export function appendTranscript(id, role, text) {
  const call = getCall(id);
  if (!call || !text) return;
  call.transcript.push({ role, text, at: new Date().toISOString() });
  mirror(callsCol, call);
}

export function appendToolCall(id, name, args, result) {
  const call = getCall(id);
  if (!call) return;
  call.toolCalls.push({ name, args, result, at: new Date().toISOString() });
  mirror(callsCol, call);
}

// --- stats -----------------------------------------------------------------
export function stats() {
  const calls = mem.calls;
  const by = (k) => calls.reduce((a, c) => ((a[c[k] || "unknown"] = (a[c[k] || "unknown"] || 0) + 1), a), {});
  const connected = calls.filter((c) => c.connected);
  return {
    leads: mem.leads.length,
    leadsPending: mem.leads.filter((l) => l.status === "pending").length,
    calls: calls.length,
    connected: connected.length,
    connectRate: calls.length ? Math.round((connected.length / calls.length) * 100) : 0,
    completed: calls.filter((c) => c.outcome === "completed").length,
    partial: calls.filter((c) => c.outcome === "partial").length,
    followUp: calls.filter((c) => c.followUpRequired).length,
    callbacks: calls.filter((c) => c.outcome === "callback").length,
    byOutcome: by("outcome"),
    avgDurationSec: connected.length
      ? Math.round(connected.reduce((a, c) => a + (c.durationSec || 0), 0) / connected.length)
      : 0,
  };
}

/** Minimal CSV parser — quoted fields, optional header, phone column found by content. */
export function parseCsv(text) {
  const rows = [];
  let field = "", row = [], inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (ch === '"') inQuotes = false;
      else field += ch;
    } else if (ch === '"') inQuotes = true;
    else if (ch === ",") { row.push(field); field = ""; }
    else if (ch === "\n") { row.push(field); rows.push(row); row = []; field = ""; }
    else if (ch !== "\r") field += ch;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  if (!rows.length) return [];

  const header = rows[0].map((h) => h.trim().toLowerCase());
  const has = (h, ...words) => words.some((w) => h.replace(/[\s_-]/g, "").includes(w));
  const idx = (...words) => header.findIndex((h) => has(h, ...words));

  let iPhone = idx("phone", "mobile", "number", "contact", "cell", "whatsapp", "msisdn");
  const iName = idx("name", "customer", "lead", "client");
  const iCity = idx("city", "location", "town", "area");
  const iNotes = idx("note", "remark", "comment");

  const looksHeaderless = rows[0].some((c) => normalizePhone(c));
  const body = looksHeaderless ? rows : rows.slice(1);

  if (iPhone === -1) {
    const width = Math.max(...rows.map((r) => r.length));
    let best = -1, bestHits = 0;
    for (let col = 0; col < width; col++) {
      const hits = body.filter((r) => normalizePhone(r[col])).length;
      if (hits > bestHits) { bestHits = hits; best = col; }
    }
    if (best >= 0 && bestHits >= Math.max(1, Math.floor(body.length / 2))) iPhone = best;
  }
  if (iPhone === -1) return [];

  const pick = (r, i) => (i >= 0 && i !== iPhone ? (r[i] || "").trim() : "");
  return body.filter((r) => r.some((c) => c.trim())).map((r) => ({
    phone: r[iPhone],
    name: pick(r, iName),
    city: pick(r, iCity),
    notes: pick(r, iNotes),
  }));
}
