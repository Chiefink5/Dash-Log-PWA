import {
  initDB,
  listZones,
  addZone,
  updateZone,
  addSession,
  updateSession,
  deleteSession,
  getSession,
  listAllSessions,
  ensureZoneIdByName,
  wipeAll
} from "./db.js";

const $ = (id) => document.getElementById(id);

/* -------------------- Preferences -------------------- */
const LS_WEBHOOK = "giglog_webhook_url";
const LS_DRAFT = "giglog_draft_v1";

function setStatus(el, msg) {
  el.textContent = msg;
  el.classList.remove("hidden");
}
function clearStatus(el) {
  el.textContent = "";
  el.classList.add("hidden");
}

/* -------------------- Formatting -------------------- */
function money(n) {
  const v = Number(n || 0);
  return v.toLocaleString(undefined, { style: "currency", currency: "USD" });
}
function money2(n) {
  const v = Number(n || 0);
  return v.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function fmtMiles(n) {
  const v = Number(n || 0);
  return `${v.toFixed(1)} mi`;
}
function fmtHm(totalMinutes) {
  const m = Math.max(0, Math.round(Number(totalMinutes || 0)));
  const h = Math.floor(m / 60);
  const mm = m % 60;
  return `${h}h ${mm}m`;
}
function pad2(x) { return String(x).padStart(2, "0"); }
function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${pad2(d.getMonth()+1)}-${pad2(d.getDate())}`;
}
function timeNowStr() {
  const d = new Date();
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}
function addHoursToTimeStr(timeHHMM, hours) {
  const [h, m] = String(timeHHMM).split(":").map(Number);
  const d = new Date(2000, 0, 1, h || 0, m || 0);
  d.setHours(d.getHours() + hours);
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}
function makeLocalDateTime(dateStr, timeStr) {
  const d = new Date(`${dateStr}T${timeStr}`);
  return isNaN(d.getTime()) ? null : d;
}
function sessionDateLabel(startMs) {
  const d = new Date(startMs);
  return d.toLocaleDateString(undefined, { weekday:"short", month:"short", day:"numeric" });
}

/* -------------------- Week logic (Monday start) -------------------- */
function weekStartMs(date) {
  const d = new Date(date);
  const day = d.getDay(); // Sun=0, Mon=1...
  const diff = (day === 0 ? -6 : 1 - day);
  d.setHours(0,0,0,0);
  d.setDate(d.getDate() + diff);
  return d.getTime();
}
function weekRangeLabel(weekStartMsVal) {
  const s = new Date(weekStartMsVal);
  const e = new Date(weekStartMsVal);
  e.setDate(e.getDate() + 6);
  const fmt = (d) => d.toLocaleDateString(undefined, { month:"2-digit", day:"2-digit", year:"2-digit" });
  return `${fmt(s)} - ${fmt(e)}`;
}
// ISO week number
function isoWeekNumber(date) {
  const d = new Date(date);
  d.setHours(0,0,0,0);
  // Thursday in current week decides the year
  d.setDate(d.getDate() + 3 - ((d.getDay() + 6) % 7));
  const week1 = new Date(d.getFullYear(), 0, 4);
  return 1 + Math.round(((d.getTime() - week1.getTime()) / 86400000 - 3 + ((week1.getDay() + 6) % 7)) / 7);
}
function weekLabel(weekStartMsVal) {
  const s = new Date(weekStartMsVal);
  const wk = isoWeekNumber(s);
  return `${weekRangeLabel(weekStartMsVal)} | Week ${wk}`;
}

/* -------------------- Derived metrics -------------------- */
function calcDerived(session) {
  const start = session.start_time;
  let endAdj = session.end_time;
  if (endAdj < start) endAdj += 24*60*60*1000;

  const totalMiles = Number(session.end_miles) - Number(session.start_miles);
  const totalMinutes = Math.round((endAdj - start) / 60000);
  const waitMinutes = Math.max(Number(session.dash_minutes) - Number(session.active_minutes), 0);

  const profit = Number(session.profit || 0);
  const dph = totalMinutes > 0 ? profit / (totalMinutes / 60) : null;
  const dpm = totalMiles > 0 ? profit / totalMiles : null;

  return { totalMiles, totalMinutes, waitMinutes, dph, dpm };
}

/* -------------------- CSV/JSON helpers -------------------- */
function csvEscape(v) {
  const s = String(v ?? "");
  if (s.includes(",") || s.includes("\n") || s.includes('"')) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

function buildExportObject(zonesAll, sessionsAll) {
  return {
    app: "giglog",
    version: 1,
    exported_at: new Date().toISOString(),
    zones: zonesAll.map(z => ({ name: z.name, active: z.active ?? 1 })),
    sessions: sessionsAll.map(s => ({
      // store as durable values (zone_name instead of zone_id)
      zone_name: zoneNameById(s.zone_id),
      time_block: s.time_block,
      start_time: s.start_time,
      end_time: s.end_time,
      profit: s.profit,
      start_miles: s.start_miles,
      end_miles: s.end_miles,
      orders: s.orders,
      dash_minutes: s.dash_minutes,
      active_minutes: s.active_minutes
    }))
  };
}

function exportCsvString(sessionsAll) {
  const headers = [
    "zone","time_block",
    "start_time","end_time",
    "profit","start_miles","end_miles",
    "orders","dash_minutes","active_minutes"
  ];
  const rows = [headers.join(",")];

  for (const s of sessionsAll.sort((a,b)=>a.start_time-b.start_time)) {
    rows.push([
      csvEscape(zoneNameById(s.zone_id)),
      csvEscape(s.time_block),
      csvEscape(new Date(s.start_time).toISOString()),
      csvEscape(new Date(s.end_time).toISOString()),
      csvEscape(Number(s.profit || 0).toFixed(2)),
      csvEscape(Number(s.start_miles || 0).toFixed(1)),
      csvEscape(Number(s.end_miles || 0).toFixed(1)),
      csvEscape(Number(s.orders || 0)),
      csvEscape(Number(s.dash_minutes || 0)),
      csvEscape(Number(s.active_minutes || 0))
    ].join(","));
  }

  return rows.join("\n");
}

function downloadText(filename, text, mime="text/plain") {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

async function shareTextFile(filename, text, mime="text/plain") {
  const blob = new Blob([text], { type: mime });
  const file = new File([blob], filename, { type: mime });

  // Prefer file share (works on many iPhones)
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    await navigator.share({ files: [file], title: filename });
    return true;
  }

  // Fallback: share text
  if (navigator.share) {
    await navigator.share({ title: filename, text });
    return true;
  }

  return false;
}

async function copyToClipboard(text) {
  await navigator.clipboard.writeText(text);
}

/* -------------------- Webhook send -------------------- */
async function sendToWebhook(url, payload, contentType) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": contentType },
    body: payload
  });
  const txt = await res.text().catch(()=> "");
  if (!res.ok) throw new Error(`Webhook HTTP ${res.status}: ${txt || "No response body"}`);
  return txt || "OK";
}

/* -------------------- Draft persistence -------------------- */
function loadDraft() {
  try {
    const raw = localStorage.getItem(LS_DRAFT);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch { return null; }
}
function saveDraft(obj) {
  localStorage.setItem(LS_DRAFT, JSON.stringify(obj));
}
function clearDraft() {
  localStorage.removeItem(LS_DRAFT);
}

/* -------------------- App State -------------------- */
let db;
let zonesAll = [];
let zonesActive = [];
let sessionsAll = [];
let activeWeekStart = weekStartMs(new Date());
let editingId = null;

/* -------------------- UI -------------------- */
const weekChip = $("weekChip");
const weekRangeEl = $("weekRange");
const wkEarnings = $("wkEarnings");
const wkDph = $("wkDph");
const wkSessions = $("wkSessions");

const weekPicker = $("weekPicker");
const weekOptions = $("weekOptions");
const weekPickerClose = $("weekPickerClose");

const sessionsListEl = $("sessionsList");

const zoneNew = $("zoneNew");
const btnAddZone = $("btnAddZone");
const zonesListEl = $("zonesList");

const formTitle = $("formTitle");
const formHint = $("formHint");

const zoneSelect = $("zoneSelect");
const timeBlock = $("timeBlock");
const sessionDate = $("sessionDate");
const startTime = $("startTime");
const endTime = $("endTime");
const profit = $("profit");
const orders = $("orders");
const startMiles = $("startMiles");
const endMiles = $("endMiles");
const dashH = $("dashH");
const dashM = $("dashM");
const activeH = $("activeH");
const activeM = $("activeM");
const warningBox = $("warningBox");

const btnStartDash = $("btnStartDash");
const btnClearDraft = $("btnClearDraft");
const btnReset = $("btnReset");
const btnCancelEdit = $("btnCancelEdit");
const btnSubmit = $("btnSubmit");

const btnExport = $("btnExport");
const btnImport = $("btnImport");
const btnSettings = $("btnSettings");

const fileImport = $("fileImport");

const exportModal = $("exportModal");
const exportClose = $("exportClose");
const btnExportCsv = $("btnExportCsv");
const btnShareCsv = $("btnShareCsv");
const btnCopyCsv = $("btnCopyCsv");
const btnExportJson = $("btnExportJson");
const btnShareJson = $("btnShareJson");
const btnCopyJson = $("btnCopyJson");
const btnSendWebhookCsv = $("btnSendWebhookCsv");
const btnSendWebhookJson = $("btnSendWebhookJson");
const webhookUrl = $("webhookUrl");
const exportStatus = $("exportStatus");

const settingsModal = $("settingsModal");
const settingsClose = $("settingsClose");
const btnImportNow = $("btnImportNow");
const btnWipeAll = $("btnWipeAll");
const settingsStatus = $("settingsStatus");

/* -------------------- Zones -------------------- */
function zoneNameById(id) {
  return zonesAll.find(z => z.id === id)?.name || "Unknown";
}

async function refreshZones() {
  zonesAll = await listZones(db, { activeOnly: false });
  zonesActive = zonesAll.filter(z => z.active === 1).sort((a,b)=>a.name.localeCompare(b.name));

  // Dropdown
  zoneSelect.innerHTML = "";
  for (const z of zonesActive) {
    const opt = document.createElement("option");
    opt.value = String(z.id);
    opt.textContent = z.name;
    zoneSelect.appendChild(opt);
  }

  const lastZone = localStorage.getItem("giglog_lastZoneId");
  if (lastZone && zonesActive.some(z => String(z.id) === String(lastZone))) {
    zoneSelect.value = String(lastZone);
  } else if (zonesActive.length) {
    zoneSelect.value = String(zonesActive[0].id);
  }

  // Chips list
  zonesListEl.innerHTML = "";
  for (const z of zonesActive) {
    const chip = document.createElement("div");
    chip.className = "zone-chip";
    chip.innerHTML = `<span>${z.name}</span><button class="zone-x" title="Remove zone" aria-label="Remove zone">✕</button>`;
    chip.querySelector("button").addEventListener("click", async () => {
      const ok = confirm(`Remove "${z.name}" from dropdown? (Old sessions keep name)`);
      if (!ok) return;
      z.active = 0;
      await updateZone(db, z);
      await refreshZones();
    });
    zonesListEl.appendChild(chip);
  }
}

async function handleAddZone() {
  const name = (zoneNew.value || "").trim();
  if (!name) return;

  const existing = zonesAll.find(z => String(z.name).toLowerCase() === name.toLowerCase());
  if (existing) {
    if (existing.active !== 1) {
      existing.active = 1;
      await updateZone(db, existing);
    }
  } else {
    await addZone(db, name);
  }

  zoneNew.value = "";
  await refreshZones();

  const added = zonesAll.find(z => String(z.name).toLowerCase() === name.toLowerCase() && z.active === 1);
  if (added) zoneSelect.value = String(added.id);
}

/* -------------------- Form helpers -------------------- */
function toInt(v) {
  const n = Number(v);
  return Number.isFinite(n) ? Math.max(0, Math.floor(n)) : 0;
}
function readTimeTotalMinutes(hEl, mEl) {
  const h = toInt(hEl.value);
  const m = toInt(mEl.value);
  return h * 60 + m;
}
function setTimeTotalMinutes(hEl, mEl, total) {
  const t = Math.max(0, toInt(total));
  hEl.value = String(Math.floor(t / 60));
  mEl.value = String(t % 60);
}

function readFormSession() {
  const dateStr = sessionDate.value || todayStr();
  const st = makeLocalDateTime(dateStr, startTime.value || "00:00") || new Date();
  let et = makeLocalDateTime(dateStr, endTime.value || "00:00") || new Date(st.getTime());
  if (et.getTime() < st.getTime()) et = new Date(et.getTime() + 24*60*60*1000);

  return {
    id: editingId ?? undefined,
    zone_id: Number(zoneSelect.value),
    time_block: timeBlock.value,
    start_time: st.getTime(),
    end_time: et.getTime(),
    profit: Number(profit.value || 0),
    start_miles: Number(startMiles.value || 0),
    end_miles: Number(endMiles.value || 0),
    orders: Number(orders.value || 0),
    dash_minutes: readTimeTotalMinutes(dashH, dashM),
    active_minutes: readTimeTotalMinutes(activeH, activeM),
    week_start: weekStartMs(st)
  };
}

function validateSession(session) {
  const warnings = [];
  const d = calcDerived(session);
  if (!sessionDate.value) warnings.push("Set a date (supports backlogs).");
  if (!startTime.value) warnings.push("Start time missing.");
  if (!endTime.value) warnings.push("End time missing.");
  if (session.active_minutes > session.dash_minutes) warnings.push("Active > Dash (wait forced to 0).");
  if (session.end_miles < session.start_miles) warnings.push("End miles < start miles (negative miles).");
  if (d.totalMinutes <= 0) warnings.push("Total time 0/negative (check start/end).");
  return warnings;
}

function showWarnings(w) {
  if (!w.length) {
    warningBox.classList.add("hidden");
    warningBox.textContent = "";
    return;
  }
  warningBox.classList.remove("hidden");
  warningBox.textContent = "Warnings: " + w.join(" ");
}

/* -------------------- Draft: Start Dash -------------------- */
function draftFromForm() {
  return {
    zone_id: Number(zoneSelect.value || 0),
    time_block: timeBlock.value,
    sessionDate: sessionDate.value || "",
    startTime: startTime.value || "",
    startMiles: startMiles.value || ""
  };
}
function applyDraft(d) {
  if (!d) return;
  if (d.sessionDate) sessionDate.value = d.sessionDate;
  if (d.startTime) startTime.value = d.startTime;
  if (d.startMiles !== undefined) startMiles.value = d.startMiles;
  if (d.time_block) timeBlock.value = d.time_block;
  if (d.zone_id && zonesActive.some(z => z.id === d.zone_id)) zoneSelect.value = String(d.zone_id);
}

function persistDraftLive() {
  // Only persist when NOT editing a prior session
  if (editingId) return;
  saveDraft(draftFromForm());
}

function startDash() {
  if (editingId) return; // don't conflict with editing
  sessionDate.value = sessionDate.value || todayStr();
  startTime.value = startTime.value || timeNowStr();
  // startMiles is user-entered; we don’t auto-set it.
  saveDraft(draftFromForm());
  showWarnings([]);
  alert("Dash started. Start time/miles will persist until you Log Session or Clear Draft.");
}
function clearDashDraftOnly() {
  clearDraft();
  // keep form values, but user wanted ability to clear; we’ll also clear the 3 key fields.
  startTime.value = "";
  startMiles.value = "";
  showWarnings([]);
}

/* -------------------- Reset/Edit/Submit -------------------- */
function resetForm() {
  editingId = null;
  formTitle.textContent = "New Session";
  formHint.textContent = "Use Start Dash → finish later → Log";
  btnSubmit.textContent = "Log Session";
  btnCancelEdit.style.display = "none";

  sessionDate.value = todayStr();
  startTime.value = timeNowStr();
  endTime.value = addHoursToTimeStr(startTime.value, 2);

  profit.value = "";
  orders.value = "";
  startMiles.value = "";
  endMiles.value = "";

  setTimeTotalMinutes(dashH, dashM, 0);
  setTimeTotalMinutes(activeH, activeM, 0);

  showWarnings([]);

  // if there is a draft, re-apply it (this is the persistence behavior)
  applyDraft(loadDraft());
}

async function beginEdit(id) {
  const s = await getSession(db, id);
  if (!s) return;

  editingId = s.id;

  formTitle.textContent = "Edit Session";
  formHint.textContent = "Make changes → Update";
  btnSubmit.textContent = "Update Session";
  btnCancelEdit.style.display = "inline-block";

  await refreshZones();
  zoneSelect.value = String(s.zone_id);
  timeBlock.value = s.time_block || "Lunch";

  const st = new Date(s.start_time);
  const et = new Date(s.end_time);

  sessionDate.value = `${st.getFullYear()}-${pad2(st.getMonth()+1)}-${pad2(st.getDate())}`;
  startTime.value = `${pad2(st.getHours())}:${pad2(st.getMinutes())}`;
  endTime.value = `${pad2(et.getHours())}:${pad2(et.getMinutes())}`;

  profit.value = String(Number(s.profit || 0));
  orders.value = String(Number(s.orders || 0));
  startMiles.value = String(Number(s.start_miles || 0));
  endMiles.value = String(Number(s.end_miles || 0));

  setTimeTotalMinutes(dashH, dashM, Number(s.dash_minutes || 0));
  setTimeTotalMinutes(activeH, activeM, Number(s.active_minutes || 0));

  showWarnings(validateSession(readFormSession()));
  window.scrollTo({ top: 0, behavior: "smooth" });
}

async function submitSession() {
  const s = readFormSession();
  const w = validateSession(s);
  showWarnings(w);

  if (w.length) {
    const ok = confirm("Warnings:\n\n- " + w.join("\n- ") + "\n\nSave anyway?");
    if (!ok) return;
  }

  localStorage.setItem("giglog_lastZoneId", String(s.zone_id));
  localStorage.setItem("giglog_lastTimeBlock", s.time_block);

  if (editingId) {
    await updateSession(db, s);
  } else {
    await addSession(db, s);
  }

  // On successful log: clear draft (user request)
  clearDraft();

  // refresh state
  await loadSessions();
  // keep viewing week as currently selected
  resetForm();
  await render();
}

async function removeSession(id) {
  const ok = confirm("Delete this session?");
  if (!ok) return;
  await deleteSession(db, id);
  await loadSessions();
  await render();
}

/* -------------------- Sessions + Week View -------------------- */
async function loadSessions() {
  sessionsAll = await listAllSessions(db);
}

function getWeeksAvailable() {
  const set = new Set(sessionsAll.map(s => s.week_start));
  // Always include current week even if empty
  set.add(weekStartMs(new Date()));
  return Array.from(set).sort((a,b)=>b-a);
}

function computeWeekTotals(weekStartVal) {
  const weekSessions = sessionsAll.filter(s => s.week_start === weekStartVal);

  let profitSum = 0;
  let totalMinutesSum = 0;

  for (const s of weekSessions) {
    const d = calcDerived(s);
    profitSum += Number(s.profit || 0);
    totalMinutesSum += Math.max(0, Number(d.totalMinutes || 0));
  }

  const dph = totalMinutesSum > 0 ? profitSum / (totalMinutesSum/60) : null;
  return { sessions: weekSessions.length, profit: profitSum, dph };
}

function makeSessionCard(s) {
  const d = calcDerived(s);

  const dph = (d.dph == null || !isFinite(d.dph)) ? "—/hr" : `${money2(d.dph)}/hr`;
  const dpm = (d.dpm == null || !isFinite(d.dpm)) ? "—/mi" : `${money2(d.dpm)}/mi`;

  const card = document.createElement("div");
  card.className = "session-card";

  card.innerHTML = `
    <div style="display:flex;justify-content:space-between;gap:12px;align-items:flex-start;">
      <div>
        <div style="font-weight:900;font-size:18px;">${sessionDateLabel(s.start_time)}</div>
        <div style="color:var(--muted);margin-top:4px;">📍 ${zoneNameById(s.zone_id)} • ${s.time_block}</div>
      </div>
      <div style="display:flex;flex-direction:column;align-items:flex-end;gap:8px;">
        <div style="font-weight:900;color:var(--green);font-size:18px;">${money(s.profit || 0)}</div>
        <div class="card-actions">
          <button class="small-btn" data-edit>Edit</button>
          <button class="small-btn danger" data-del>Delete</button>
        </div>
      </div>
    </div>

    <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin-top:12px;">
      <div style="text-align:center;padding:10px;border:1px solid rgba(34,48,34,.9);border-radius:14px;background:rgba(0,0,0,.14);">
        <div style="font-weight:900;color:var(--gold);">${fmtMiles(d.totalMiles || 0)}</div>
        <div style="color:var(--muted);font-size:12px;margin-top:4px;">Miles</div>
      </div>
      <div style="text-align:center;padding:10px;border:1px solid rgba(34,48,34,.9);border-radius:14px;background:rgba(0,0,0,.14);">
        <div style="font-weight:900;">${fmtHm(d.totalMinutes)}</div>
        <div style="color:var(--muted);font-size:12px;margin-top:4px;">Time</div>
      </div>
      <div style="text-align:center;padding:10px;border:1px solid rgba(34,48,34,.9);border-radius:14px;background:rgba(0,0,0,.14);">
        <div style="font-weight:900;">${s.orders || 0}</div>
        <div style="color:var(--muted);font-size:12px;margin-top:4px;">Orders</div>
      </div>
    </div>

    <div style="display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap;margin-top:12px;">
      <div style="font-weight:900;color:var(--green);">${dph}</div>
      <div style="font-weight:900;color:var(--gold);">${dpm}</div>
      <div style="font-weight:800;color:var(--muted);">${d.waitMinutes}m wait</div>
    </div>
  `;

  card.querySelector("[data-edit]").addEventListener("click", () => beginEdit(s.id));
  card.querySelector("[data-del]").addEventListener("click", () => removeSession(s.id));
  return card;
}

function renderWeekPicker() {
  weekOptions.innerHTML = "";
  const weeks = getWeeksAvailable();

  for (const ws of weeks) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "week-opt";
    const label = weekLabel(ws);

    btn.innerHTML = `
      <div class="wklabel">${ws === weekStartMs(new Date()) ? "This Week" : "Week"}</div>
      <div class="wkrange">${label}</div>
    `;

    btn.addEventListener("click", () => {
      activeWeekStart = ws;
      weekPicker.classList.add("hidden");
      // Set chip label to match selection
      weekChip.textContent = (ws === weekStartMs(new Date())) ? "↗ This Week" : "↗ Selected Week";
      render();
    });

    weekOptions.appendChild(btn);
  }
}

function renderWeekHeader() {
  weekRangeEl.textContent = weekLabel(activeWeekStart);

  const totals = computeWeekTotals(activeWeekStart);
  wkEarnings.textContent = money(totals.profit);
  wkDph.textContent = totals.dph == null ? "—" : money(totals.dph);
  wkSessions.textContent = String(totals.sessions);
}

function renderSessionsList() {
  sessionsListEl.innerHTML = "";

  const weekItems = sessionsAll
    .filter(s => s.week_start === activeWeekStart)
    .sort((a,b)=>b.start_time - a.start_time);

  if (weekItems.length === 0) {
    const empty = document.createElement("div");
    empty.style.color = "var(--muted)";
    empty.style.padding = "10px 4px";
    empty.textContent = "No sessions in this week.";
    sessionsListEl.appendChild(empty);
    return;
  }

  for (const s of weekItems) {
    sessionsListEl.appendChild(makeSessionCard(s));
  }
}

async function render() {
  await refreshZones();
  renderWeekPicker();
  renderWeekHeader();
  renderSessionsList();
}

/* -------------------- Export UI -------------------- */
function openExportModal() {
  webhookUrl.value = localStorage.getItem(LS_WEBHOOK) || "";
  clearStatus(exportStatus);
  exportModal.classList.remove("hidden");
}
function closeExportModal() {
  exportModal.classList.add("hidden");
  clearStatus(exportStatus);
}

async function doExport(kind) {
  // kind: "csv"|"json"
  await loadSessions();
  const payloadObj = buildExportObject(zonesAll, sessionsAll);
  const jsonText = JSON.stringify(payloadObj, null, 2);
  const csvText = exportCsvString(sessionsAll);

  const dateTag = new Date().toISOString().slice(0,10);
  if (kind === "csv") {
    return {
      filename: `giglog-${dateTag}.csv`,
      text: csvText,
      mime: "text/csv"
    };
  }
  return {
    filename: `giglog-${dateTag}.json`,
    text: jsonText,
    mime: "application/json"
  };
}

/* -------------------- Import -------------------- */
function parseCsvLine(line) {
  // minimal CSV parser for our export
  const out = [];
  let cur = "";
  let inQ = false;

  for (let i=0; i<line.length; i++) {
    const ch = line[i];
    if (inQ) {
      if (ch === '"' && line[i+1] === '"') { cur += '"'; i++; }
      else if (ch === '"') inQ = false;
      else cur += ch;
    } else {
      if (ch === '"') inQ = true;
      else if (ch === ",") { out.push(cur); cur = ""; }
      else cur += ch;
    }
  }
  out.push(cur);
  return out;
}

async function importJsonText(text) {
  const data = JSON.parse(text);
  if (!data || data.app !== "giglog" || !Array.isArray(data.sessions)) {
    throw new Error("Invalid JSON export format.");
  }

  // Ensure zones exist
  if (Array.isArray(data.zones)) {
    for (const z of data.zones) {
      if (z?.name) await ensureZoneIdByName(db, z.name);
    }
  }

  // Import sessions
  for (const s of data.sessions) {
    const zoneId = await ensureZoneIdByName(db, s.zone_name || "Unknown");

    const startMs = Number(s.start_time);
    const endMs = Number(s.end_time);

    const session = {
      zone_id: zoneId || Number(zoneSelect.value) || 0,
      time_block: s.time_block || "Lunch",
      start_time: startMs,
      end_time: endMs,
      profit: Number(s.profit || 0),
      start_miles: Number(s.start_miles || 0),
      end_miles: Number(s.end_miles || 0),
      orders: Number(s.orders || 0),
      dash_minutes: Number(s.dash_minutes || 0),
      active_minutes: Number(s.active_minutes || 0),
      week_start: weekStartMs(new Date(startMs))
    };

    await addSession(db, session);
  }
}

async function importCsvText(text) {
  const lines = text.split(/\r?\n/).filter(Boolean);
  if (lines.length < 2) throw new Error("CSV looks empty.");

  const headers = parseCsvLine(lines[0]).map(h => h.trim().toLowerCase());
  const idx = (name) => headers.indexOf(name);

  const iZone = idx("zone");
  const iBlock = idx("time_block");
  const iStart = idx("start_time");
  const iEnd = idx("end_time");
  const iProfit = idx("profit");
  const iSM = idx("start_miles");
  const iEM = idx("end_miles");
  const iOrders = idx("orders");
  const iDash = idx("dash_minutes");
  const iActive = idx("active_minutes");

  if ([iZone,iBlock,iStart,iEnd,iProfit,iSM,iEM,iOrders,iDash,iActive].some(i=>i<0)) {
    throw new Error("CSV headers don’t match expected export format.");
  }

  for (let r=1; r<lines.length; r++) {
    const cols = parseCsvLine(lines[r]);
    const zoneName = cols[iZone] || "Unknown";
    const zoneId = await ensureZoneIdByName(db, zoneName);

    const startMs = Date.parse(cols[iStart]);
    const endMs = Date.parse(cols[iEnd]);

    const session = {
      zone_id: zoneId || 0,
      time_block: cols[iBlock] || "Lunch",
      start_time: startMs,
      end_time: endMs,
      profit: Number(cols[iProfit] || 0),
      start_miles: Number(cols[iSM] || 0),
      end_miles: Number(cols[iEM] || 0),
      orders: Number(cols[iOrders] || 0),
      dash_minutes: Number(cols[iDash] || 0),
      active_minutes: Number(cols[iActive] || 0),
      week_start: weekStartMs(new Date(startMs))
    };

    await addSession(db, session);
  }
}

async function handleImportFile(file) {
  const text = await file.text();
  const name = file.name.toLowerCase();

  if (name.endsWith(".json")) await importJsonText(text);
  else if (name.endsWith(".csv")) await importCsvText(text);
  else throw new Error("Unsupported file type. Use .json or .csv");

  await refreshZones();
  await loadSessions();

  // Keep current selected week; just rerender
  await render();
}

function openImportPicker() {
  fileImport.value = "";
  fileImport.click();
}

/* -------------------- Boot -------------------- */
async function main() {
  db = await initDB();

  // settings
  webhookUrl.value = localStorage.getItem(LS_WEBHOOK) || "";

  await refreshZones();
  await loadSessions();

  // default to current week unless user has selection
  activeWeekStart = weekStartMs(new Date());

  // load draft if present
  resetForm();

  // Wire Zones
  btnAddZone.addEventListener("click", handleAddZone);
  zoneNew.addEventListener("keydown", (e) => { if (e.key === "Enter") handleAddZone(); });

  // Week picker
  weekChip.addEventListener("click", () => weekPicker.classList.toggle("hidden"));
  weekPickerClose.addEventListener("click", () => weekPicker.classList.add("hidden"));

  // Draft buttons
  btnStartDash.addEventListener("click", startDash);
  btnClearDraft.addEventListener("click", clearDashDraftOnly);

  // Form buttons
  btnReset.addEventListener("click", resetForm);
  btnCancelEdit.addEventListener("click", resetForm);
  btnSubmit.addEventListener("click", submitSession);

  // Live draft persistence on relevant fields
  [zoneSelect, timeBlock, sessionDate, startTime, startMiles].forEach(el =>
    el.addEventListener("input", persistDraftLive)
  );

  // Warnings live
  [
    sessionDate, startTime, endTime, profit, orders, startMiles, endMiles, dashH, dashM, activeH, activeM
  ].forEach(el => el.addEventListener("input", () => showWarnings(validateSession(readFormSession()))));

  // Export modal wiring
  btnExport.addEventListener("click", openExportModal);
  exportClose.addEventListener("click", closeExportModal);
  exportModal.addEventListener("click", (e) => { if (e.target === exportModal) closeExportModal(); });

  btnExportCsv.addEventListener("click", async () => {
    try {
      clearStatus(exportStatus);
      const ex = await doExport("csv");
      downloadText(ex.filename, ex.text, ex.mime);
      setStatus(exportStatus, "CSV download triggered.");
    } catch (err) {
      setStatus(exportStatus, `Export failed: ${err.message}`);
    }
  });

  btnExportJson.addEventListener("click", async () => {
    try {
      clearStatus(exportStatus);
      const ex = await doExport("json");
      downloadText(ex.filename, ex.text, ex.mime);
      setStatus(exportStatus, "JSON download triggered.");
    } catch (err) {
      setStatus(exportStatus, `Export failed: ${err.message}`);
    }
  });

  btnShareCsv.addEventListener("click", async () => {
    try {
      clearStatus(exportStatus);
      const ex = await doExport("csv");
      const ok = await shareTextFile(ex.filename, ex.text, ex.mime);
      setStatus(exportStatus, ok ? "Share opened." : "Share not supported on this device/browser.");
    } catch (err) {
      setStatus(exportStatus, `Share failed: ${err.message}`);
    }
  });

  btnShareJson.addEventListener("click", async () => {
    try {
      clearStatus(exportStatus);
      const ex = await doExport("json");
      const ok = await shareTextFile(ex.filename, ex.text, ex.mime);
      setStatus(exportStatus, ok ? "Share opened." : "Share not supported on this device/browser.");
    } catch (err) {
      setStatus(exportStatus, `Share failed: ${err.message}`);
    }
  });

  btnCopyCsv.addEventListener("click", async () => {
    try {
      clearStatus(exportStatus);
      const ex = await doExport("csv");
      await copyToClipboard(ex.text);
      setStatus(exportStatus, "CSV copied to clipboard.");
    } catch (err) {
      setStatus(exportStatus, `Copy failed: ${err.message}`);
    }
  });

  btnCopyJson.addEventListener("click", async () => {
    try {
      clearStatus(exportStatus);
      const ex = await doExport("json");
      await copyToClipboard(ex.text);
      setStatus(exportStatus, "JSON copied to clipboard.");
    } catch (err) {
      setStatus(exportStatus, `Copy failed: ${err.message}`);
    }
  });

  // Webhook send
  function saveWebhookSetting() {
    localStorage.setItem(LS_WEBHOOK, webhookUrl.value.trim());
  }
  webhookUrl.addEventListener("input", saveWebhookSetting);

  btnSendWebhookCsv.addEventListener("click", async () => {
    try {
      clearStatus(exportStatus);
      const url = webhookUrl.value.trim();
      if (!url) return setStatus(exportStatus, "Set a webhook URL first.");
      const ex = await doExport("csv");
      const resp = await sendToWebhook(url, ex.text, "text/csv");
      setStatus(exportStatus, `Webhook sent (CSV). Response: ${resp.slice(0,160)}`);
    } catch (err) {
      setStatus(exportStatus, `Webhook failed: ${err.message}`);
    }
  });

  btnSendWebhookJson.addEventListener("click", async () => {
    try {
      clearStatus(exportStatus);
      const url = webhookUrl.value.trim();
      if (!url) return setStatus(exportStatus, "Set a webhook URL first.");
      const ex = await doExport("json");
      const resp = await sendToWebhook(url, ex.text, "application/json");
      setStatus(exportStatus, `Webhook sent (JSON). Response: ${resp.slice(0,160)}`);
    } catch (err) {
      setStatus(exportStatus, `Webhook failed: ${err.message}`);
    }
  });

  // Import
  btnImport.addEventListener("click", openImportPicker);

  fileImport.addEventListener("change", async () => {
    const file = fileImport.files?.[0];
    if (!file) return;
    try {
      await handleImportFile(file);
      alert("Import complete. Weeks/order updated automatically.");
    } catch (err) {
      alert(`Import failed: ${err.message}`);
    }
  });

  // Settings modal
  function openSettings() {
    clearStatus(settingsStatus);
    settingsModal.classList.remove("hidden");
  }
  function closeSettings() {
    settingsModal.classList.add("hidden");
    clearStatus(settingsStatus);
  }

  btnSettings.addEventListener("click", openSettings);
  settingsClose.addEventListener("click", closeSettings);
  settingsModal.addEventListener("click", (e) => { if (e.target === settingsModal) closeSettings(); });

  btnImportNow.addEventListener("click", () => {
    closeSettings();
    openImportPicker();
  });

  btnWipeAll.addEventListener("click", async () => {
    const ok = confirm("Wipe ALL data on this device? (zones + sessions)");
    if (!ok) return;
    await wipeAll(db);
    clearDraft();
    await refreshZones();
    await loadSessions();
    activeWeekStart = weekStartMs(new Date());
    resetForm();
    await render();
    setStatus(settingsStatus, "Wiped. Fresh start.");
  });

  // Initial render
  await render();
}

main();

// Register service worker
if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("./sw.js").catch(console.warn);
}