import {
  initDB,
  listZones,
  addZone,
  updateZone,
  addSession,
  listSessions,
  listAllSessions
} from "./db.js";

/* ---------- Helpers ---------- */
const $ = (id) => document.getElementById(id);

const TIME_BLOCKS = ["Breakfast","Brunch","Lunch","Dinner","Late Night"];

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
  // expects "YYYY-MM-DDTHH:mm"
  if (!str) return null;
  const d = new Date(str);
  return isNaN(d.getTime()) ? null : d;
}
function toDateTimeLocalValue(d) {
  const pad = (x) => String(x).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
function sundayWeekStartMs(date) {
  const d = new Date(date);
  const day = d.getDay(); // Sun=0
  d.setHours(0,0,0,0);
  d.setDate(d.getDate() - day);
  return d.getTime();
}
function weekRangeLabel(weekStartMs) {
  const s = new Date(weekStartMs);
  const e = new Date(weekStartMs);
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

/* ---------- App State ---------- */
let db;
let zones = [];
let activeWeekStartMs = sundayWeekStartMs(new Date());

/* ---------- UI Elements ---------- */
const weekRangeEl = $("weekRange");
const wkEarnings = $("wkEarnings");
const wkDph = $("wkDph");
const wkSessions = $("wkSessions");
const sessionsListEl = $("sessionsList");

/* ---------- Rendering ---------- */
function zoneNameById(id) {
  return zones.find(z => z.id === id)?.name || "Unknown";
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

async function computeWeekTotals(weekStartMs) {
  const all = await listAllSessions(db);
  const weekSessions = all.filter(s => s.week_start === weekStartMs);

  let profit = 0;
  let totalMinutes = 0;

  for (const s of weekSessions) {
    const d = calcDerived(s);
    profit += Number(s.profit || 0);
    totalMinutes += Math.max(0, Number(d.totalMinutes || 0));
  }

  const dph = totalMinutes > 0 ? profit / (totalMinutes/60) : null;

  return { sessions: weekSessions.length, profit, totalMinutes, dph };
}

async function renderWeekHeader() {
  weekRangeEl.textContent = weekRangeLabel(activeWeekStartMs);
  const totals = await computeWeekTotals(activeWeekStartMs);

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
    empty.textContent = "No sessions yet. Tap + to log your first one.";
    sessionsListEl.appendChild(empty);
    return;
  }

  for (const s of items) {
    sessionsListEl.appendChild(makeSessionCard(s));
  }
}

async function render() {
  zones = await listZones(db, { activeOnly: false });
  await renderWeekHeader();
  await renderSessionsList();
}

/* ---------- Add Session (simple MVP flow) ---------- */
/*
  To keep this PWA working from just 6 files and no UI frameworks,
  we do a fast “prompt-based” logger first.
  In Part 2 we add Export and a better zone/time-block flow.
*/
async function quickLogSession() {
  const activeZones = (await listZones(db, { activeOnly: true }))
    .sort((a,b)=>a.name.localeCompare(b.name));

  const zoneName = prompt(
    `Zone name?\n(Existing: ${activeZones.map(z=>z.name).join(", ")})`,
    activeZones[0]?.name || "Allen"
  );
  if (!zoneName) return;

  // ensure zone exists
  let zone = zones.find(z => z.name.toLowerCase() === zoneName.trim().toLowerCase());
  if (!zone) {
    try { await addZone(db, zoneName.trim()); }
    catch {}
    zones = await listZones(db, { activeOnly: false });
    zone = zones.find(z => z.name.toLowerCase() === zoneName.trim().toLowerCase());
  }
  if (!zone) return;

  const timeBlock = prompt(`Time block? (${TIME_BLOCKS.join(", ")})`, "Lunch") || "Lunch";

  const now = new Date();
  const startStr = prompt("Start time (YYYY-MM-DDTHH:mm)", toDateTimeLocalValue(now));
  const endDefault = new Date(now); endDefault.setHours(endDefault.getHours() + 2);
  const endStr = prompt("End time (YYYY-MM-DDTHH:mm)", toDateTimeLocalValue(endDefault));

  const st = parseDateTimeLocal(startStr) || now;
  const et = parseDateTimeLocal(endStr) || endDefault;

  const profit = Number(prompt("Total profit ($)", "0.00") || "0");
  const startMiles = Number(prompt("Start miles", "0.0") || "0");
  const endMiles = Number(prompt("End miles", "0.0") || "0");
  const orders = Number(prompt("Orders", "0") || "0");
  const dashMinutes = Number(prompt("Dash time minutes", "0") || "0");
  const activeMinutes = Number(prompt("Active time minutes", "0") || "0");

  const session = {
    zone_id: zone.id,
    time_block: TIME_BLOCKS.includes(timeBlock) ? timeBlock : "Lunch",
    start_time: st.getTime(),
    end_time: et.getTime(),
    profit: profit,
    start_miles: startMiles,
    end_miles: endMiles,
    orders,
    dash_minutes: dashMinutes,
    active_minutes: activeMinutes,
    week_start: sundayWeekStartMs(st)
  };

  await addSession(db, session);
}

/* ---------- Boot Part 1 ---------- */
async function main() {
  db = await initDB();
  await render();

  $("btnAdd").addEventListener("click", async () => {
    await quickLogSession();
    await render();
  });
}

main();

/* ---------- EXPORT CSV ---------- */
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

    const row = [
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
    ].join(",");

    rows.push(row);
  }

  const csv = rows.join("\n");
  const filename = `dash-log-sessions-${new Date().toISOString().slice(0,10)}.csv`;
  downloadBlob(filename, new Blob([csv], { type: "text/csv" }));
}

/* ---------- SIMPLE GUARDRAILS ---------- */
function validateSession(session) {
  const warnings = [];
  if (session.end_time < session.start_time) {
    warnings.push("End time is earlier than start time. (Counts as crossing midnight for calculations.)");
  }
  const d = calcDerived(session);
  if (d.totalMinutes <= 0) warnings.push("Total time is 0 or negative. $/hour will be blank.");
  if (d.totalMiles <= 0) warnings.push("Miles is 0 or negative. $/mile will be blank.");
  if (session.active_minutes > session.dash_minutes) warnings.push("Active minutes > dash minutes. Wait forced to 0.");
  if (session.end_miles < session.start_miles) warnings.push("End miles < start miles. Miles will be negative.");
  return warnings;
}

/* ---------- WIRE EXPORT BUTTON ---------- */
(function hookExportButton(){
  const btn = $("btnExport");
  if (!btn) return;
  btn.addEventListener("click", async () => {
    // quick sanity: if you have no sessions, still export headers
    await exportCsv();
  });
})();

/* ---------- PATCH QUICK LOGGER TO SHOW WARNINGS ---------- */
// Override quickLogSession from Part 1 with a warning step.
// This keeps your Part 1 structure but adds “are you sure” if data is odd.
const _quickLogSessionOriginal = quickLogSession;
quickLogSession = async function() {
  // run original prompt-driven flow by temporarily capturing the last added session
  // Easier: just re-run the prompt flow but validate before saving.
  const activeZones = (await listZones(db, { activeOnly: true }))
    .sort((a,b)=>a.name.localeCompare(b.name));

  const zoneName = prompt(
    `Zone name?\n(Existing: ${activeZones.map(z=>z.name).join(", ")})`,
    activeZones[0]?.name || "Allen"
  );
  if (!zoneName) return;

  let zone = zones.find(z => z.name.toLowerCase() === zoneName.trim().toLowerCase());
  if (!zone) {
    try { await addZone(db, zoneName.trim()); } catch {}
    zones = await listZones(db, { activeOnly: false });
    zone = zones.find(z => z.name.toLowerCase() === zoneName.trim().toLowerCase());
  }
  if (!zone) return;

  const timeBlock = prompt(`Time block? (${TIME_BLOCKS.join(", ")})`, "Lunch") || "Lunch";

  const now = new Date();
  const startStr = prompt("Start time (YYYY-MM-DDTHH:mm)", toDateTimeLocalValue(now));
  const endDefault = new Date(now); endDefault.setHours(endDefault.getHours() + 2);
  const endStr = prompt("End time (YYYY-MM-DDTHH:mm)", toDateTimeLocalValue(endDefault));

  const st = parseDateTimeLocal(startStr) || now;
  const et = parseDateTimeLocal(endStr) || endDefault;

  const profit = Number(prompt("Total profit ($)", "0.00") || "0");
  const startMiles = Number(prompt("Start miles", "0.0") || "0");
  const endMiles = Number(prompt("End miles", "0.0") || "0");
  const orders = Number(prompt("Orders", "0") || "0");
  const dashMinutes = Number(prompt("Dash time minutes", "0") || "0");
  const activeMinutes = Number(prompt("Active time minutes", "0") || "0");

  const session = {
    zone_id: zone.id,
    time_block: TIME_BLOCKS.includes(timeBlock) ? timeBlock : "Lunch",
    start_time: st.getTime(),
    end_time: et.getTime(),
    profit: profit,
    start_miles: startMiles,
    end_miles: endMiles,
    orders,
    dash_minutes: dashMinutes,
    active_minutes: activeMinutes,
    week_start: sundayWeekStartMs(st)
  };

  const warnings = validateSession(session);
  if (warnings.length) {
    const ok = confirm("Warnings:\n\n- " + warnings.join("\n- ") + "\n\nSave anyway?");
    if (!ok) return;
  }

  await addSession(db, session);
};

// Register service worker (PWA)
if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("./sw.js").catch(console.warn);
}