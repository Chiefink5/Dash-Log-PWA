import {supabase} from "./auth.js";
import {listAllSessions,listZones,updateSession,addSession,ensureZoneIdByName} from "./db.js";
const userId=()=>window.__dashlogUserId;
const uuid=()=>crypto.randomUUID();
export async function syncDriverData(db,{pull=true}={}){
 if(!navigator.onLine||!userId())return {offline:true};
 const local=await listAllSessions(db);
 const zones=await listZones(db,{activeOnly:false});
 const zoneName=id=>zones.find(z=>z.id===id)?.name||"Unknown";
 for(const session of local){
  if(!session.client_id){session.client_id=uuid();await updateSession(db,session)}
 }
 // Push local entries first; cloud entries are never erased by this merge.
 for(let i=0;i<local.length;i+=50){
  const rows=local.slice(i,i+50).map(s=>({driver_id:userId(),client_id:s.client_id,zone_name:zoneName(s.zone_id),time_block:s.time_block||"",start_time:s.start_time,end_time:s.end_time,profit:s.profit||0,start_miles:s.start_miles||0,end_miles:s.end_miles||0,orders:s.orders||0,dash_minutes:s.dash_minutes||0,active_minutes:s.active_minutes||0,week_start:s.week_start||0}));
  const {error}=await supabase.from("driver_sessions").upsert(rows,{onConflict:"driver_id,client_id"});
  if(error)throw error;
 }
 if(pull){
  let offset=0;
  for(;;){
   const {data,error}=await supabase.from("driver_sessions").select("*").eq("driver_id",userId()).order("start_time",{ascending:true}).range(offset,offset+499);
   if(error)throw error;
   const current=await listAllSessions(db),known=new Set(current.map(s=>s.client_id));
   for(const s of data||[]){
    if(known.has(s.client_id))continue;
    const zone_id=await ensureZoneIdByName(db,s.zone_name||"Unknown");
    await addSession(db,{client_id:s.client_id,zone_id,time_block:s.time_block,start_time:Number(s.start_time),end_time:Number(s.end_time),profit:Number(s.profit),start_miles:Number(s.start_miles),end_miles:Number(s.end_miles),orders:s.orders,dash_minutes:s.dash_minutes,active_minutes:s.active_minutes,week_start:Number(s.week_start)});
    known.add(s.client_id);
   }
   if((data||[]).length<500)break;offset+=500;
  }
 }
 return {synced:true};
}
export async function removeCloudSession(clientId){
 if(!navigator.onLine)throw Error("Connect to the internet before deleting a synced session.");
 const {error}=await supabase.from("driver_sessions").delete().eq("driver_id",userId()).eq("client_id",clientId);
 if(error)throw error;
}
