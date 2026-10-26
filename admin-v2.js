import {initAdminSupport} from "./admin-support.js";
import {createClient} from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm";
const supabase=createClient("https://khcniybqzaaklmyrjolg.supabase.co","sb_publishable_xbP_mXXRNTNsCc8qqrGNQg_p6r-FZIa");
const $=id=>document.getElementById(id);
const fmt=n=>Number(n||0).toLocaleString("en-US",{style:"currency",currency:"USD"});
const date=d=>d?new Date(d).toLocaleDateString("en-US"):"—";
$("year").textContent=new Date().getFullYear();
let drivers=[],sessions=[],flags=[];let supportView=null;

function notice(message,type="good"){$("adminStatus").textContent=message;$("adminStatus").className="notice "+type}
const el=(tag,cls,txt)=>{const e=document.createElement(tag);if(cls)e.className=cls;if(txt!==undefined)e.textContent=txt;return e};
function access(p){return p.is_owner||p.access_status==="complimentary"||(p.access_status==="trial"&&Date.parse(p.trial_ends_at)>Date.now())||(p.access_status==="active"&&Date.parse(p.subscription_expires_at)>Date.now())}
function render(){
 $("metricDrivers").textContent=drivers.length;$("metricSessions").textContent=sessions.length;
 $("metricRevenue").textContent="—";
 $("flagCount").textContent="/ "+flags.length;
 const flagList=$("flagList");flagList.replaceChildren();
 if(!flags.length)flagList.append(el("div","empty","No cross-account imports detected."));
 for(const f of flags){const item=el("article","driver");item.append(el("h3","","Cross-account import detected"),el("div","subtext","Source: "+(f.claimed_source_email||f.claimed_source_id||"Unknown")+" → Importer: "+(drivers.find(p=>p.id===f.importer_id)?.email||f.importer_id)+" · "+f.session_count+" sessions · "+date(f.created_at)));flagList.append(item)}
 $("metricActive").textContent=drivers.filter(access).length;
 const q=$("searchDriver").value.toLowerCase().trim(),filter=$("filterStatus").value;
 const visible=drivers.filter(p=>(!filter||p.access_status===filter)&&((p.email||"")+" "+(p.display_name||"")).toLowerCase().includes(q));
 $("rosterCount").textContent="/ "+visible.length;
 const list=$("driverList");list.replaceChildren();
 if(!visible.length){list.append(el("div","empty","No matching drivers found."));return}
 for(const p of visible){
  const logs=sessions.filter(s=>s.driver_id===p.id),total=logs.reduce((n,s)=>n+Number(s.profit||0),0),hours=logs.reduce((n,s)=>n+Math.max(0,(Number(s.end_time)-Number(s.start_time))/3600000),0);
  const card=el("article","driver"),top=el("div","driver-top"),identity=el("div","driver-identity"),avatar=el("div","avatar",(p.display_name||p.email||"?").slice(0,1).toUpperCase()),name=el("div"),title=el("h3","",p.display_name||p.email),subtitle=el("div","subtext",(p.display_name?p.email+" · ":"")+"Joined "+date(p.created_at)+(p.is_owner?" · OWNER":""));
  name.append(title,subtitle);identity.append(avatar,name);
  const badge=el("span","badge "+p.access_status,p.is_owner?"OWNER":p.access_status);top.append(identity,badge);card.append(top);
  card.classList.add("collapsed-driver");card.setAttribute("tabindex","0");card.setAttribute("role","button");card.setAttribute("aria-expanded","false");card.setAttribute("aria-label","View details for "+(p.email||"driver"));
  const details=el("div","driver-details");details.hidden=true;
  const toggle=()=>{details.hidden=!details.hidden;card.classList.toggle("expanded-driver",!details.hidden);card.setAttribute("aria-expanded",String(!details.hidden))};
  top.addEventListener("click",toggle);card.addEventListener("keydown",e=>{if(e.target===card&&(e.key==="Enter"||e.key===" ")){e.preventDefault();toggle()}});
  const hint=el("span","driver-hint","VIEW DETAILS +");top.append(hint);
  const stats=el("div","driver-stats");
  for(const [label,value] of [["SESSIONS",logs.length],["EARNINGS",fmt(total)],["HOURS",hours.toFixed(1)],["AVG / HOUR",hours?fmt(total/hours):"—"]]){const item=el("div");item.append(el("span","",label),el("strong","",String(value)));stats.append(item)}
  details.append(stats);
  const info=el("div","subtext","Trial ends: "+date(p.trial_ends_at)+" · Last active: "+date(p.last_seen_at));info.style.marginTop="13px";details.append(info);
  if(!p.is_owner){
   const actions=el("div","driver-actions");
   for(const [label,status,days] of [["✓ Complimentary","complimentary",0],["+ 14 days","trial",14],["⛔ Suspend","suspended",0]]){
    const btn=el("button","action"+(status==="suspended"?" danger":""),label);
    btn.onclick=async()=>{if(!confirm(label+" for "+p.email+"?"))return;btn.disabled=true;const end=days?new Date(Math.max(Date.now(),Date.parse(p.trial_ends_at)||0)+days*86400000).toISOString():null;
     const {error}=await supabase.rpc("dashlog_manage_driver",{target_id:p.id,new_status:status,new_trial_ends_at:end});
     btn.disabled=false;if(error){alert(error.message);return}p.access_status=status;if(end)p.trial_ends_at=end;render();notice("Access updated for "+p.email)};
    actions.append(btn)
   }details.append(actions)
  }card.append(details);list.append(card)
 }
}
async function load(){
 try{
  notice("Verifying owner access…","");
  const {data:{user},error:authError}=await supabase.auth.getUser();if(authError)throw authError;
  if(!user){notice("Sign in to Dash Log first, then return to this page.","bad");const link=el("a","","Go to sign in");link.href="/";$("adminStatus").append(" ",link);return}
  const {data:profile,error:profileError}=await supabase.from("driver_profiles").select("is_owner").eq("id",user.id).single();if(profileError)throw profileError;
  if(!profile?.is_owner){notice("Access denied. Owner permissions required.","bad");return}
  const [{data:people,error:pe},{data:logs,error:le}]=await Promise.all([supabase.from("driver_profiles").select("*").order("created_at",{ascending:false}),supabase.from("driver_sessions").select("driver_id,profit,start_time,end_time,orders")]);
  if(pe||le)throw pe||le;drivers=people||[];sessions=logs||[];
  if(!supportView)supportView=initAdminSupport(supabase,$,el,drivers);await supportView.refresh();
  const {data:audits,error:auditError}=await supabase.from("import_audit_events").select("*").eq("account_mismatch",true).order("created_at",{ascending:false}).limit(100);
  if(auditError)throw auditError;flags=audits||[];
  $("metrics").hidden=false;$("roster").hidden=false;notice("● SYSTEM ONLINE  /  Last refreshed "+new Date().toLocaleTimeString("en-US",{hour:"numeric",minute:"2-digit"}));render();
 }catch(e){console.error(e);notice("Dashboard error: "+(e.message||e),"bad")}
}
$("searchDriver").addEventListener("input",render);$("filterStatus").addEventListener("change",render);$("refresh").addEventListener("click",load);load();
