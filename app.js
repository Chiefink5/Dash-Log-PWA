import {
  initDB,
  listZones,
  addSession,
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
function parseDateTimeLocal(str) {
  if (!str) return null;
  const d = new Date(str);
  return isNaN(d.getTime()) ? null : d;
}
function toDateTimeLocalValue(d) {
  const pad = (x) => String(x).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/**
 * Week start = MONDAY 00:00 local time
 */
function weekStartMs(date) {
  const d = new Date(date);
  const day = d.getDay(); // Sun=0, Mon=1...
  const diff = (day === 0 ? -6 : 1 - day); // shift back to Monday
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
let zones = [];
let activeWeekStart = weekStartMs(new Date());

/* ---------- UI ---------- */
const weekRangeEl = $("weekRange");
const wkEarnings = $("wkEarnings");
const wkDph = $("wkDph");
const wkSessions = $("wkSessions");
const sessionsListEl = $("sessionsList");

const zoneSelect = $("zoneSelect");
const timeBlock = $("timeBlock");
const startTime = $("startTime");
const endTime = $("endTime");
const profit = $("profit");
const orders = $("orders");
const startMiles = $("startMiles");
const endMiles = $("endMiles");
const dashMinutes = $("dashMinutes");
const activeMinutes = $("activeMinutes");

const calcMilesEl = $("calcMiles");
const calcTimeEl = $("calcTime");
const calcWaitEl = $("calcWait");
const calcDphEl = $("calcDph");
const calcDpmEl = $("calcDpm");
const warningBox = $("warningBox");

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

/* ---------- Read form + live calcs ---------- */
function readFormSession() {
  const st = parseDateTimeLocal(startTime.value) || new Date();
  const et = parseDateTimeLocal(endTime.value) || new Date(st.getTime() + 2*60*60*1000);

  return {
    zone_id: Number(zoneSelect.value),
    time_block: timeBlock.value,
    start_time: st.getTime(),
    end_time: et.getTime(),
    profit: Number(profit.value || 0),
    start_miles: Number(startMiles.value || 0),
    end_miles: Number(endMiles.value || 0),
    orders: Number(orders.value || 0),
    dash_minutes: Number(dashMinutes.value || 0),
    active_minutes: Number(activeMinutes.value || 0),
    week_start: weekStartMs(st)
  };
}

function validateSession(session) {
  const warnings = [];
  if (session.end_time < session.start_time) warnings.push("End time earlier than start time (treated as crossing midnight).");
  const d = calcDerived(session);
  if (d.totalMinutes <= 0) warnings.push("Total time is 0/negative → $/hour will be blank.");
  if (d.totalMiles <= 0) warnings.push("Miles is 0/negative → $/mile will be blank.");
  if (session.active_minutes > session.dash_minutes) warnings.push("Active minutes > dash minutes → wait forced to 0.");
  if (session.end_miles < session.start_miles) warnings.push("End miles < start miles → negative miles.");
  return warnings;
}

function updateLiveCalcs() {
  const s = readFormSession();
  const d = calcDerived(s);

  calcMilesEl.textContent = (d.totalMiles || 0).toFixed(1);
  calcTimeEl.textContent = fmtHm(d.totalMinutes);
  calcWaitEl.textContent = `${d.waitMinutes}m`;

  calcDphEl.textContent = (d.dph == null || !isFinite(d.dph)) ? "—" : `${money2(d.dph)}`;
  calcDpmEl.textContent = (d.dpm == null || !isFinite(d.dpm)) ? "—" : `${money2(d.dpm)}`;

  const warns = validateSession(s);
  if (warns.length) {
    warningBox.textContent = "Warnings: " + warns.join(" ");
    warningBox.classList.remove("hidden");
  } else {
    warningBox.classList.add("hidden");
    warningBox.textContent = "";
  }
}

/* ---------- Weekly + list rendering ---------- */
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

    <div style="display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap;margin-top:12px;">
      <div style="font-weight:800;color:var(--green);">${dph}</div>
      <div style="font-weight:800;color:var(--blue);">${dpm}</div>
      <div style="font-weight:700;color:var(--muted);">${d.waitMinutes}m wait</div>
    </div>
  `;
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

async function render() {
  await refreshZonesDropdown();
  await renderWeekHeader();
  await renderSessionsList();
}

/* ---------- Actions ---------- */
function resetForm() {
  const now = new Date();
  startTime.value = toDateTimeLocalValue(now);
  const end = new Date(now); end.setHours(end.getHours() + 2);
  endTime.value = toDateTimeLocalValue(end);

  profit.value = "";
  orders.value = "";
  startMiles.value = "";
  endMiles.value = "";
  dashMinutes.value = "";
  activeMinutes.value = "";

  const lastBlock = localStorage.getItem("dashlog_lastTimeBlock");
  if (lastBlock) timeBlock.value = lastBlock;

  updateLiveCalcs();
}

async function submitSession() {
  const s = readFormSession();
  const warnings = validateSession(s);
  if (warnings.length) {
    const ok = confirm("Warnings:\n\n- " + warnings.join("\n- ") + "\n\nSave anyway?");
    if (!ok) return;
  }

  localStorage.setItem("dashlog_lastZoneId", String(s.zone_id));
  localStorage.setItem("dashlog_lastTimeBlock", s.time_block);

  await addSession(db, s);

  // keep week header locked to "current week"
  activeWeekStart = weekStartMs(new Date());
  resetForm();
  await renderWeekHeader();
  await renderSessionsList();
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

/* ---------- Boot ---------- */
async function main() {
  db = await initDB();

  // defaults
  await refreshZonesDropdown();

  const lastBlock = localStorage.getItem("dashlog_lastTimeBlock");
  if (lastBlock) timeBlock.value = lastBlock;

  resetForm();
  await render();

  // live calcs
  [zoneSelect, timeBlock, startTime, endTime, profit, orders, startMiles, endMiles, dashMinutes, activeMinutes]
    .forEach(el => el.addEventListener("input", updateLiveCalcs));

  $("btnReset").addEventListener("click", resetForm);
  $("btnSubmit").addEventListener("click", submitSession);
  $("btnExport").addEventListener("click", exportCsv);
}

main();

// Register service worker (PWA)
if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("./sw.js").catch(console.warn);
}