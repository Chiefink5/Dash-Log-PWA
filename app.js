import {
  initDB,
  listZones,
  addZone,
  updateZone,
  addSession,
  updateSession,
  deleteSession,
  getSession,
  listSessions,
  listAllSessions
} from "./db.js";

const $ = (id) => document.getElementById(id);

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

function todayStr() {
  const d = new Date();
  const pad = (x) => String(x).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
}
function timeNowStr() {
  const d = new Date();
  const pad = (x) => String(x).padStart(2, "0");
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
function addHoursToTimeStr(timeHHMM, hours) {
  const [h, m] = timeHHMM.split(":").map(Number);
  const d = new Date(2000, 0, 1, h, m);
  d.setHours(d.getHours() + hours);
  const pad = (x) => String(x).padStart(2, "0");
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
function makeLocalDateTime(dateStr, timeStr) {
  const d = new Date(`${dateStr}T${timeStr}`);
  return isNaN(d.getTime()) ? null : d;
}

/** Week start = Monday */
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
  const fmt = (d) => d.toLocaleDateString(undefined, { month:"short", day:"numeric" });
  return `${fmt(s)} – ${fmt(e)}`;
}
function sessionDateLabel(startMs) {
  const d = new Date(startMs);
  return d.toLocaleDateString(undefined, { weekday:"short", month:"short", day:"numeric" });
}

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

/* ---------- App State ---------- */
let db;
let zonesAll = [];
let zonesActive = [];
let activeWeekStart = weekStartMs(new Date());
let editingId = null;

/* ---------- UI ---------- */
const weekRangeEl = $("weekRange");
const wkEarnings = $("wkEarnings");
const wkDph = $("wkDph");
const wkSessions = $("wkSessions");
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
const btnReset = $("btnReset");
const btnSubmit = $("btnSubmit");
const btnCancelEdit = $("btnCancelEdit");
const btnExport = $("btnExport");

/* ---------- Zones ---------- */
function zoneNameById(id) {
  return zonesAll.find(z => z.id === id)?.name || "Unknown";
}

async function refreshZones() {
  zonesAll = await listZones(db, { activeOnly: false });
  zonesActive = zonesAll.filter(z => z.active === 1).sort((a,b)=>a.name.localeCompare(b.name));

  // dropdown
  zoneSelect.innerHTML = "";
  for (const z of zonesActive) {
    const opt = document.createElement("option");
    opt.value = String(z.id);
    opt.textContent = z.name;
    zoneSelect.appendChild(opt);
  }

  // default select
  const lastZone = localStorage.getItem("dashlog_lastZoneId");
  if (lastZone && zonesActive.some(z => String(z.id) === String(lastZone))) {
    zoneSelect.value = String(lastZone);
  } else if (zonesActive.length) {
    zoneSelect.value = String(zonesActive[0].id);
  }

  // chips
  zonesListEl.innerHTML = "";
  for (const z of zonesActive) {
    const chip = document.createElement("div");
    chip.className = "zone-chip";
    chip.innerHTML = `<span>${z.name}</span><button class="zone-x" aria-label="Remove zone">✕</button>`;
    chip.querySelector("button").addEventListener("click", async () => {
      const ok = confirm(`Remove "${z.name}" from dropdown? (Old sessions keep their zone name)`);
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

  // case-insensitive reuse
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

  // select newly added
  const added = zonesAll.find(z => String(z.name).toLowerCase() === name.toLowerCase() && z.active === 1);
  if (added) zoneSelect.value = String(added.id);
}

/* ---------- Form ---------- */
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
  if (session.active_minutes > session.dash_minutes) warnings.push("Active time > dash time (wait forced to 0).");
  if (session.end_miles < session.start_miles) warnings.push("End miles < start miles (negative miles).");
  if (d.totalMinutes <= 0) warnings.push("Total time is 0/negative (check start/end).");
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

function resetForm() {
  editingId = null;
  formTitle.textContent = "New Session";
  formHint.textContent = "Fill it out → Log";
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
  const pad = (x) => String(x).padStart(2, "0");

  sessionDate.value = `${st.getFullYear()}-${pad(st.getMonth()+1)}-${pad(st.getDate())}`;
  startTime.value = `${pad(st.getHours())}:${pad(st.getMinutes())}`;
  endTime.value = `${pad(et.getHours())}:${pad(et.getMinutes())}`;

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

  localStorage.setItem("dashlog_lastZoneId", String(s.zone_id));
  localStorage.setItem("dashlog_lastTimeBlock", s.time_block);

  if (editingId) await updateSession(db, s);
  else await addSession(db, s);

  activeWeekStart = weekStartMs(new Date());
  resetForm();
  await render();
}

async function removeSession(id) {
  const ok = confirm("Delete this session?");
  if (!ok) return;
  await deleteSession(db, id);
  await render();
}

/* ---------- Weekly + list ---------- */
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

    <div style="display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap;margin-top:12px;">
      <div style="font-weight:800;color:var(--green);">${dph}</div>
      <div style="font-weight:800;color:var(--blue);">${dpm}</div>
      <div style="font-weight:700;color:var(--muted);">${d.waitMinutes}m wait</div>
    </div>
  `;

  card.querySelector("[data-edit]").addEventListener("click", () => beginEdit(s.id));
  card.querySelector("[data-del]").addEventListener("click", () => removeSession(s.id));
  return card;
}

async function renderWeekHeader() {
  weekRangeEl.textContent = weekRangeLabel(activeWeekStart);
  const totals = await computeWeekTotals(activeWeekStart);
  wkEarnings.textContent = money(totals.profit);
  wkDph.textContent = totals.dph == null ? "—" : money(totals.dph);
  wkSessions.textContent = String(totals.sessions);
}

async function renderSessionsList() {
  const items = await listSessions(db, { limit: 25 });
  sessionsListEl.innerHTML = "";

  if (!items.length) {
    const empty = document.createElement("div");
    empty.style.color = "var(--muted)";
    empty.style.padding = "10px 4px";
    empty.textContent = "No sessions yet. Log your first session above.";
    sessionsListEl.appendChild(empty);
    return;
  }
  for (const s of items) sessionsListEl.appendChild(makeSessionCard(s));
}

async function render() {
  await refreshZones();
  await renderWeekHeader();
  await renderSessionsList();
}

/* ---------- Export ---------- */
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

  downloadBlob(`dash-log-sessions-${new Date().toISOString().slice(0,10)}.csv`,
    new Blob([rows.join("\n")], { type:"text/csv" })
  );
}

/* ---------- Boot ---------- */
async function main() {
  db = await initDB();
  await render();

  btnAddZone.addEventListener("click", handleAddZone);
  zoneNew.addEventListener("keydown", (e) => { if (e.key === "Enter") handleAddZone(); });

  btnReset.addEventListener("click", resetForm);
  btnSubmit.addEventListener("click", submitSession);
  btnCancelEdit.addEventListener("click", resetForm);
  btnExport.addEventListener("click", exportCsv);

  [
    sessionDate, startTime, endTime,
    profit, orders, startMiles, endMiles,
    dashH, dashM, activeH, activeM
  ].forEach(el => el.addEventListener("input", () => showWarnings(validateSession(readFormSession()))));

  resetForm();
}

main();

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("./sw.js").catch(console.warn);
}