import {supabase} from "./auth.js";
const $=id=>document.getElementById(id);
const fmt=d=>new Date(d).toLocaleDateString("en-US",{month:"2-digit",day:"2-digit",year:"numeric"});
const node=(tag,cls,text)=>{const n=document.createElement(tag);if(cls)n.className=cls;if(text!==undefined)n.textContent=text;return n};
let currentUser=null;
const status=message=>$("supportStatus").textContent=message;
async function user(){if(currentUser)return currentUser;const {data:{user},error}=await supabase.auth.getUser();if(error||!user)throw Error("Sign in to send a report.");return currentUser=user}
async function listTickets(){
 const u=await user(),{data,error}=await supabase.from("support_tickets").select("id,ticket_number,subject,category,status,created_at").eq("user_id",u.id).order("created_at",{ascending:false}).limit(100);
 if(error)throw error;
 const box=$("supportTickets");box.replaceChildren();
 if(!data.length)box.append(node("p","muted","No support tickets yet."));
 for(const t of data){const b=node("button","support-ticket-item");b.type="button";b.append(node("strong","", "#"+t.ticket_number+" · "+t.subject),node("small","",t.status.replaceAll("_"," ")+" · "+fmt(t.created_at)));b.onclick=()=>thread(t);box.append(b)}
}
async function thread(t){
 $("supportThread").classList.remove("hidden");$("supportTickets").classList.add("hidden");
 const box=$("supportThread");box.replaceChildren();
 const back=node("button","btn","Back to Tickets");back.onclick=()=>{box.classList.add("hidden");$("supportTickets").classList.remove("hidden");listTickets().catch(e=>status(e.message))};
 box.append(back,node("h3","", "#"+t.ticket_number+" · "+t.subject),node("p","muted","Status: "+t.status.replaceAll("_"," ")));
 const {data:msgs,error}=await supabase.from("support_messages").select("author_id,body,created_at").eq("ticket_id",t.id).order("created_at");if(error)throw error;
 for(const m of msgs){const n=node("div","support-message",m.body);n.prepend(node("small","",m.author_id===currentUser.id?"You · "+fmt(m.created_at):"Support · "+fmt(m.created_at)));box.append(n)}
 const {data:attachments}=await supabase.from("support_attachments").select("object_path").eq("ticket_id",t.id);
 for(const a of attachments||[]){const btn=node("button","btn","View screenshot");btn.onclick=async()=>{const {data,error}=await supabase.storage.from("dashlog-support").createSignedUrl(a.object_path,60);if(error)status(error.message);else window.open(data.signedUrl,"_blank","noopener")};box.append(btn)}
 if(t.status!=="closed"){const form=node("form","support-reply"),input=node("textarea");input.required=true;input.maxLength=5000;input.placeholder="Reply to support…";const send=node("button","btn goldbtn","Send Reply");send.type="submit";form.append(input,send);form.onsubmit=async e=>{e.preventDefault();send.disabled=true;const {error}=await supabase.from("support_messages").insert({ticket_id:t.id,author_id:currentUser.id,body:input.value.trim()});send.disabled=false;if(error)status(error.message);else thread(t)};box.append(form)}
}
export function initSupport(){
 $("openSupport").onclick=()=>{$("settingsModal").classList.add("hidden");$("supportModal").classList.remove("hidden");showNew()};
 $("supportClose").onclick=()=>$("supportModal").classList.add("hidden");
 $("supportModal").addEventListener("click",e=>{if(e.target===$("supportModal"))$("supportModal").classList.add("hidden")});
 function showNew(){$("supportForm").classList.remove("hidden");$("supportTickets").classList.add("hidden");$("supportThread").classList.add("hidden");status("")}
 $("supportNewTab").onclick=showNew;
 $("supportListTab").onclick=async()=>{$("supportForm").classList.add("hidden");$("supportThread").classList.add("hidden");$("supportTickets").classList.remove("hidden");try{await listTickets();status("")}catch(e){status(e.message)}};
 $("supportForm").onsubmit=async e=>{
  e.preventDefault();const button=$("supportForm").querySelector('[type="submit"]');button.disabled=true;
  try{
   const u=await user(),file=$("supportScreenshot").files[0];
   if(file&&(file.size>5242880||!["image/png","image/jpeg","image/webp"].includes(file.type)))throw Error("Screenshot must be PNG, JPG or WebP under 5 MB.");
   const {data:t,error}=await supabase.from("support_tickets").insert({user_id:u.id,category:$("supportCategory").value,subject:$("supportSubject").value.trim(),description:$("supportDescription").value.trim(),app_version:"dashlog-pwa-support-v1"}).select("id,ticket_number").single();if(error)throw error;
   if(file){const path=u.id+"/"+t.id+"/"+crypto.randomUUID()+"."+({ "image/png":"png","image/jpeg":"jpg","image/webp":"webp"}[file.type]);const upload=await supabase.storage.from("dashlog-support").upload(path,file,{contentType:file.type});if(upload.error)status("Ticket created, but screenshot upload failed: "+upload.error.message);else{const link=await supabase.from("support_attachments").insert({ticket_id:t.id,uploader_id:u.id,object_path:path});if(link.error)status("Ticket created, but screenshot linking failed: "+link.error.message)}}
   $("supportForm").reset();status("Ticket #"+t.ticket_number+" submitted. You can track it under My Tickets.");$("supportListTab").click();
  }catch(err){status("Unable to submit: "+err.message)}finally{button.disabled=false}
 };
}
