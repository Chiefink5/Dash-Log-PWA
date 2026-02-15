import {
  initDB,
  listZones,
  addZone,
  addSession,
  updateSession,
  deleteSession,
  listSessions,
  listAllSessions
} from "./db.js";

const $ = (id) => document.getElementById(id);

/* ---------- Formatting helpers ---------- */
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
function sessionDateLabel(startMs) {
  const d = new Date(startMs);
  return d.toLocaleDateString(undefined, { weekday:"short", month:"short", day:"numeric" });
}

/* ---------- Week start = Monday ---------- */
function weekStartMs(date) {
  const d = new Date(date);
  const day = d.getDay(); // Sun=0, Mon=1...
  const diff = (day === 0 ? -6 : 1 - day);
  d.setHours(0,0,0,0);
  d.setDate(d.getDate() + diff);
  return d.getTime();
}
function weekRangeLabel(ws) {
  const s = new Date(ws);
  const e = new Date(ws);
  e.setDate(e.getDate() + 6);
  const fmt = (d) => d.toLocaleDateString(undefined, { month:"short", day:"numeric" });
  return `${fmt(s)} – ${fmt(e)}`;
}

/* ---------- Derived metrics ---------- */
function calcDerived(session) {
  const start = session.start_time;
  const endRaw = session.end_time;

  // Midnight rollover for calculations only
  let endAdj = endRaw;
  if (endAdj < start) endAdj = endAdj + 24*60*60*1000;

  const totalMiles = Number(session.end_miles) - Number(session.start_miles);
  const totalMinutes = Math.round((endAdj - start) / 60000);
  const waitMinutes = Math.max(Number(session.dash_minutes) - Number(session.active_minutes), 0);

  const profit = Number(session.profit || 0);
  const dph = totalMinutes > 0 ? profit / (totalMinutes / 60) : null;
  const dpm = totalMiles > 0 ? profit / totalMiles : null;

  return { totalMiles, totalMinutes, waitMinutes, dph, dpm };
}

/* ---------- CSV Export ---------- */
function downloadBlob(filename, blob) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

async function exportCsv() {
  const all = (await listAllSessions(db)).sort((a,b)=>b.start_time - a.start_time);

  const headers = [
    "id","zone","time_block",
    "start_time","end_time",
    "profit","start_miles","end_miles",
    "orders","dash_minutes","active_minutes",
    "week_start",
    "total_miles","total_minutes","wait_minutes",
    "dollars_per_hour","dollars_per_mile"
  ];

  const rows = [headers.join(",")];

  for (const s of all) {
    const d = calcDerived(s);
    const zoneName = zoneNameById(s.zone_id);

    rows.push([
      s.id,
      JSON.stringify(zoneName),
      JSON.stringify(s.time_block),
      new Date(s.start_time).toISOString(),
      new Date(s.end_time).toISOString(),
      Number(s.profit || 0).toFixed(2),
      Number(s.start_miles || 0).toFixed(1),
      Number(s.end_miles || 0).toFixed(1),
      Number(s.orders || 0),
      Number(s.dash_minutes || 0),
      Number(s.active_minutes || 0),
      new Date(s.week_start).toISOString(),
      (d.totalMiles ?? 0).toFixed(1),
      Math.round(d.totalMinutes || 0),
      Math.round(d.waitMinutes || 0),
      d.dph == null ? "" : d.dph.toFixed(2),
      d.dpm == null ? "" : d.dpm.toFixed(2),
    ].join(","));
  }

  downloadBlob(`dash-log-sessions-${new Date().toISOString().slice(0,10)}.csv`, new Blob([rows.join("\n")], { type:"text/csv" }));
}

/* ---------- App State ---------- */
let db;
let zones = [];
let activeWeekStart = weekStartMs(new Date());
let editingId = null; // null = creating, number = editing

/* ---------- UI ---------- */
const weekRangeEl = $("weekRange");
const wkEarnings = $("wkEarnings");
const wkDph = $("wkDph");
const wkSessions = $("wkSessions");
const sessionsListEl = $("sessionsList");

const modeLabel = $("modeLabel");
const warningBox = $("warningBox");

const sessionDate = $("sessionDate");
const zoneSelect = $("zoneSelect");
const zoneNewName = $("zoneNewName");
const timeBlock = $("timeBlock");
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

const btnSubmit = $("btnSubmit");
const btnCancelEdit = $("btnCancelEdit");

/* ---------- Zones ---------- */
function zoneNameById(id) {
  return zones.find(z => z.id === id)?.name || "Unknown";
}

async function refreshZonesDropdown() {
  zones = await listZones(db, { activeOnly: false });
  const activeZones = zones.filter(z => z.active === 1).sort((a,b)=>a.name.localeCompare(b.name));

  zoneSelect.innerHTML = "";
  for (const z of activeZones) {
    const opt = document.createElement("option");
    opt.value = String(z.id);
    opt.textContent = z.name;
    zoneSelect.appendChild(opt);
  }

  const lastZone = localStorage.getItem("dashlog_lastZoneId");
  if (lastZone && activeZones.some(z => String(z.id) === String(lastZone))) {
    zoneSelect.value = String(lastZone);
  } else if (activeZones.length) {
    zoneSelect.value = String(activeZones[0].id);
  }
}

async function handleAddZone() {
  const name = (zoneNewName.value || "").trim();
  if (!name) return;

  try {
    await addZone(db, name);
  } catch {
    // probably duplicate name; ignore
  }

  zoneNewName.value = "";
  await refreshZonesDropdown();

  // select the newly-added zone if found
  const z = zones.find(x => x.active === 1 && x.name.toLowerCase() === name.toLowerCase());
  if (z) zoneSelect.value = String(z.id);
}

/* ---------- Date + time helpers ---------- */
function todayISO() {
  const d = new Date();
  const pad = (x) => String(x).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
}

function timeNowHHMM() {
  const d = new Date();
  const pad = (x) => String(x).padStart(2, "0");
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function parseDateAndTime(dateISO, timeHHMM) {
  // local time
  const [y,m,da] = dateISO.split("-").map(Number);
  const [hh,mm] = timeHHMM.split(":").map(Number);
  const d = new Date(y, (m-1), da, hh, mm, 0, 0);
  return d;
}

function clampMinutes(v) {
  const n = Number(v || 0);
  if (!isFinite(n)) return 0;
  return Math.max(0, Math.min(59, Math.floor(n)));
}
function clampHours(v) {
  const n = Number(v || 0);
  if (!isFinite(n)) return 0;
  return Math.max(0, Math.floor(n));
}

function toTotalMinutes(h, m) {
  return clampHours(h) * 60 + clampMinutes(m);
}

/* ---------- Session form read/validate ---------- */
function readFormSession() {
  const dateISO = sessionDate.value || todayISO();
  const stTime = startTime.value || "00:00";
  const enTime = endTime.value || "00:00";

  const st = parseDateAndTime(dateISO, stTime);
  const en = parseDateAndTime(dateISO, enTime);

  return {
    id: editingId ?? undefined,
    zone_id: Number(zoneSelect.value),
    time_block: timeBlock.value,
    start_time: st.getTime(),
    end_time: en.getTime(),
    profit: Number(profit.value || 0),
    start_miles: Number(startMiles.value || 0),
    end_miles: Number(endMiles.value || 0),
    orders: Number(orders.value || 0),
    dash_minutes: toTotalMinutes(dashH.value, dashM.value),
    active_minutes: toTotalMinutes(activeH.value, activeM.value),
    week_start: weekStartMs(st)
  };
}

function validateSession(s) {
  const warnings = [];
  if (!s.zone_id) warnings.push("Pick a zone.");
  if (!sessionDate.value) warnings.push("Pick a date.");
  if (!startTime.value || !endTime.value) warnings.push("Start & End time required.");

  if (s.end_time < s.start_time) warnings.push("End time earlier than start time (treated as crossing midnight).");

  const d = calcDerived(s);
  if (d.totalMinutes <= 0) warnings.push("Total time is 0/negative → $/hour blank.");
  if (d.totalMiles <= 0) warnings.push("Miles is 0/negative → $/mile blank.");
  if (s.active_minutes > s.dash_minutes) warnings.push("Active > Dash → wait forced to 0.");
  if (s.end_miles < s.start_miles) warnings.push("End miles < start miles → negative miles.");

  return warnings;
}

function showWarnings(warnings) {
  if (!warnings.length) {
    warningBox.classList.add("hidden");
    warningBox.textContent = "";
    return;
  }
  warningBox.classList.remove("hidden");
  warningBox.textContent = "Warnings: " + warnings.join(" ");
}

/* ---------- Rendering ---------- */
async function computeWeekTotals(weekStartVal) {
  const all = await listAllSessions(db);
  const weekSessions = all.filter(s => s.week_start === weekStartVal);

  let profitSum = 0;
  let totalMinutesSum = 0;

  for (const s of weekSessions) {
    const d = calcDerived(s);
    profitSum += Number(s.profit || 0);
    totalMinutesSum += Math.max(0, Number(d.totalMinutes || 0));
  }

  const dph = totalMinutesSum > 0 ? profitSum / (totalMinutesSum/60) : null;
  return { sessions: weekSessions.length, profit: profitSum, totalMinutes: totalMinutesSum, dph };
}

async function renderWeekHeader() {
  weekRangeEl.textContent = weekRangeLabel(activeWeekStart);
  const totals = await computeWeekTotals(activeWeekStart);

  wkEarnings.textContent = money(totals.profit);
  wkDph.textContent = totals.dph == null ? "—" : money(totals.dph);
  wkSessions.textContent = String(totals.sessions);
}

function makeSessionCard(s) {
  const d = calcDerived(s);
  const dph = (d.dph == null || !isFinite(d.dph)) ? "—/hr" : `${money2(d.dph)}/hr`;
  const dpm = (d.dpm == null || !isFinite(d.dpm)) ? "—/mi" : `${money2(d.dpm)}/mi`;

  const card = document.createElement("div");
  card.className = "session-card";

  card.innerHTML = `
    <div style="display:flex;justify-content:space-between;gap:10px;align-items:flex-start;">
      <div>
        <div style="font-weight:900;font-size:18px;">${sessionDateLabel(s.start_time)}</div>
        <div style="color:var(--muted);margin-top:4px;">📍 ${zoneNameById(s.zone_id)} • ${s.time_block}</div>
      </div>
      <div style="font-weight:900;color:var(--green);font-size:18px;">${money(s.profit || 0)}</div>
    </div>

    <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin-top:12px;">
      <div style="text-align:center;padding:10px;border:1px solid var(--stroke);border-radius:14px;background:rgba(12,20,36,.35);">
        <div style="font-weight:900;color:var(--blue);">${fmtMiles(d.totalMiles || 0)}</div>
        <div style="color:var(--muted);font-size:12px;margin-top:4px;">Miles</div>
      </div>
      <div style="text-align:center;padding:10px;border:1px solid var(--stroke);border-radius:14px;background:rgba(12,20,36,.35);">
        <div style="font-weight:900;">${fmtHm(d.totalMinutes)}</div>
        <div style="color:var(--muted);font-size:12px;margin-top:4px;">Time</div>
      </div>
      <div style="text-align:center;padding:10px;border:1px solid var(--stroke);border-radius:14px;background:rgba(12,20,36,.35);">
        <div style="font-weight:900;">${s.orders || 0}</div>
        <div style="color:var(--muted);font-size:12px;margin-top:4px;">Orders</div>
      </div>
    </div>

    <div style="display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap;margin-top:12px;align-items:center;">
      <div style="font-weight:800;color:var(--green);">${dph}</div>
      <div style="font-weight:800;color:var(--blue);">${dpm}</div>
      <div style="font-weight:700;color:var(--muted);">${d.waitMinutes}m wait</div>
    </div>

    <div class="row" style="margin-top:12px;">
      <button class="btn smallbtn" data-action="edit" data-id="${s.id}">Edit</button>
      <button class="btn smallbtn danger" data-action="delete" data-id="${s.id}">Delete</button>
    </div>
  `;

  return card;
}

async function renderSessionsList() {
  const items = await listSessions(db, { limit: 25 });
  sessionsListEl.innerHTML = "";

  if (items.length === 0) {
    const empty = document.createElement("div");
    empty.style.color = "var(--muted)";
    empty.style.padding = "10px 4px";
    empty.textContent = "No sessions yet. Log your first session above.";
    sessionsListEl.appendChild(empty);
    return;
  }

  for (const s of items) sessionsListEl.appendChild(makeSessionCard(s));
}

async function renderAll() {
  await refreshZonesDropdown();
  await renderWeekHeader();
  await renderSessionsList();
}

/* ---------- Form Modes ---------- */
function setModeCreating() {
  editingId = null;
  modeLabel.textContent = "Creating";
  btnSubmit.textContent = "Log Session";
  btnCancelEdit.style.display = "none";
}

function setModeEditing() {
  modeLabel.textContent = "Editing";
  btnSubmit.textContent = "Save Changes";
  btnCancelEdit.style.display = "";
}

function resetForm() {
  setModeCreating();

  sessionDate.value = todayISO();

  const nowT = timeNowHHMM();
  startTime.value = nowT;

  // default end time = +2 hours
  const now = new Date();
  const end = new Date(now); end.setHours(end.getHours() + 2);
  const pad = (x) => String(x).padStart(2,"0");
  endTime.value = `${pad(end.getHours())}:${pad(end.getMinutes())}`;

  profit.value = "";
  orders.value = "";
  startMiles.value = "";
  endMiles.value = "";

  dashH.value = "";
  dashM.value = "";
  activeH.value = "";
  activeM.value = "";

  const lastBlock = localStorage.getItem("dashlog_lastTimeBlock");
  if (lastBlock) timeBlock.value = lastBlock;

  showWarnings([]);
}

async function loadSessionIntoForm(id) {
  const all = await listAllSessions(db);
  const s = all.find(x => x.id === Number(id));
  if (!s) return;

  editingId = s.id;
  setModeEditing();

  // populate form fields
  const dStart = new Date(s.start_time);
  const dEnd = new Date(s.end_time);

  const pad = (x) => String(x).padStart(2,"0");
  sessionDate.value = `${dStart.getFullYear()}-${pad(dStart.getMonth()+1)}-${pad(dStart.getDate())}`;
  startTime.value = `${pad(dStart.getHours())}:${pad(dStart.getMinutes())}`;
  endTime.value = `${pad(dEnd.getHours())}:${pad(dEnd.getMinutes())}`;

  zoneSelect.value = String(s.zone_id);
  timeBlock.value = s.time_block;

  profit.value = String(Number(s.profit || 0));
  orders.value = String(Number(s.orders || 0));
  startMiles.value = String(Number(s.start_miles || 0));
  endMiles.value = String(Number(s.end_miles || 0));

  const dash = Number(s.dash_minutes || 0);
  dashH.value = String(Math.floor(dash / 60));
  dashM.value = String(dash % 60);

  const active = Number(s.active_minutes || 0);
  activeH.value = String(Math.floor(active / 60));
  activeM.value = String(active % 60);

  showWarnings(validateSession(readFormSession()));
}

async function submitSession() {
  const s = readFormSession();
  const warnings = validateSession(s);
  showWarnings(warnings);

  if (warnings.length) {
    const ok = confirm("Warnings:\n\n- " + warnings.join("\n- ") + "\n\nSave anyway?");
    if (!ok) return;
  }

  localStorage.setItem("dashlog_lastZoneId", String(s.zone_id));
  localStorage.setItem("dashlog_lastTimeBlock", s.time_block);

  if (editingId == null) {
    await addSession(db, s);
  } else {
    await updateSession(db, s);
  }

  activeWeekStart = weekStartMs(new Date());
  resetForm();
  await renderWeekHeader();
  await renderSessionsList();
}

async function handleDelete(id) {
  const ok = confirm("Delete this session? This cannot be undone.");
  if (!ok) return;

  await deleteSession(db, Number(id));

  // if you were editing this same session, cancel edit
  if (editingId === Number(id)) resetForm();

  await renderWeekHeader();
  await renderSessionsList();
}

/* ---------- Events ---------- */
function attachListHandlers() {
  sessionsListEl.addEventListener("click", async (e) => {
    const btn = e.target?.closest("button[data-action]");
    if (!btn) return;

    const action = btn.dataset.action;
    const id = btn.dataset.id;

    if (action === "edit") {
      await loadSessionIntoForm(id);
      window.scrollTo({ top: 0, behavior: "smooth" });
    }

    if (action === "delete") {
      await handleDelete(id);
    }
  });
}

/* ---------- Boot ---------- */
async function main() {
  db = await initDB();

  await refreshZonesDropdown();
  resetForm();
  await renderAll();

  $("btnAddZone").addEventListener("click", handleAddZone);
  $("btnReset").addEventListener("click", resetForm);
  $("btnCancelEdit").addEventListener("click", resetForm);
  $("btnSubmit").addEventListener("click", submitSession);
  $("btnExport").addEventListener("click", exportCsv);

  // show warnings live (no calc strip)
  [sessionDate, zoneSelect, timeBlock, startTime, endTime, profit, orders, startMiles, endMiles, dashH, dashM, activeH, activeM]
    .forEach(el => el.addEventListener("input", () => showWarnings(validateSession(readFormSession()))));

  attachListHandlers();
}

main();

// Register service worker (PWA)
if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("./sw.js").catch(console.warn);
}