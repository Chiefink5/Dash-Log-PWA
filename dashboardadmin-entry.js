import {createClient} from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm";
const supabase=createClient("https://khcniybqzaaklmyrjolg.supabase.co","sb_publishable_xbP_mXXRNTNsCc8qqrGNQg_p6r-FZIa");
const status=document.getElementById("adminStatus");
const box=document.getElementById("adminContent");
const fmt=n=>Number(n||0).toLocaleString("en-US",{style:"currency",currency:"USD"});
async function load(){
 try{
  const {data:{user},error:authError}=await supabase.auth.getUser();if(authError)throw authError;
  if(!user){status.textContent="Sign in to your Dash Log account to continue.";const link=document.createElement("a");link.href="/";link.textContent="Go to sign in";box.append(link);return}
  const {data:profile,error:profileError}=await supabase.from("driver_profiles").select("is_owner").eq("id",user.id).single();
  if(profileError)throw profileError;if(!profile?.is_owner){status.textContent="Owner access required.";return}
  const {data:drivers,error:driversError}=await supabase.from("driver_profiles").select("*").order("created_at",{ascending:false});if(driversError)throw driversError;
  const {data:sessions,error:sessionsError}=await supabase.from("driver_sessions").select("driver_id,profit,start_time,end_time,orders");if(sessionsError)throw sessionsError;
  status.textContent=drivers.length+" drivers · "+sessions.length+" sessions · "+fmt(sessions.reduce((t,s)=>t+Number(s.profit||0),0))+" driver-reported earnings";
  const search=document.createElement("input");search.placeholder="Search drivers";search.style="padding:12px;width:100%;margin:14px 0";box.append(search);
  const list=document.createElement("div");box.append(list);
  function render(){list.replaceChildren();for(const p of drivers.filter(p=>(p.email||"").toLowerCase().includes(search.value.toLowerCase()))){
   const logs=sessions.filter(s=>s.driver_id===p.id),total=logs.reduce((t,s)=>t+Number(s.profit||0),0),hours=logs.reduce((t,s)=>t+Math.max(0,(s.end_time-s.start_time)/3600000),0);
   const card=document.createElement("section");card.className="card";card.style="margin:12px 0;padding:16px";const title=document.createElement("h3");title.textContent=p.email;card.append(title);
   const stats=document.createElement("p");stats.textContent=p.access_status+" · "+logs.length+" sessions · "+fmt(total)+" logged · "+hours.toFixed(1)+" hours · "+(hours?fmt(total/hours):"—")+"/hr";card.append(stats);
   if(!p.is_owner)for(const [label,value,extend] of [["Grant complimentary","complimentary",false],["Extend trial 14 days","trial",true],["Suspend","suspended",false]]){
    const btn=document.createElement("button");btn.className="btn";btn.style.margin="4px";btn.textContent=label;
    btn.onclick=async()=>{if(!confirm(label+" for "+p.email+"?"))return;const end=extend?new Date(Math.max(Date.now(),Date.parse(p.trial_ends_at))+14*86400000).toISOString():null;const {error}=await supabase.rpc("dashlog_manage_driver",{target_id:p.id,new_status:value,new_trial_ends_at:end});if(error){alert(error.message);return}p.access_status=value;if(end)p.trial_ends_at=end;render()};card.append(btn)
   }list.append(card)
  }}search.oninput=render;render();
 }catch(e){console.error(e);status.textContent="Admin error: "+(e.message||String(e))}
}load();
