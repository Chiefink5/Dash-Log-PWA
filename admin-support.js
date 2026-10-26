export function initAdminSupport(supabase,$,el,getDrivers){
 let tickets=[],messages=[];let poll=null;
 const date=d=>new Date(d).toLocaleDateString("en-US",{month:"2-digit",day:"2-digit",year:"numeric"});
 const stat=$("supportCount"),list=$("adminTicketList"),filter=$("supportFilter");
 async function refresh(){
  const {data,error}=await supabase.from("support_tickets").select("*").order("created_at",{ascending:false}).limit(200);if(error)throw error;tickets=data||[];
  const {data:unread,error:ue}=await supabase.from("support_messages").select("ticket_id,author_id").is("read_at",null);if(ue)throw ue;const owners=new Map(tickets.map(t=>[t.id,t.user_id]));const unreadCount=(unread||[]).filter(m=>owners.get(m.ticket_id)===m.author_id).length;stat.textContent="/ "+tickets.filter(t=>!["resolved","closed"].includes(t.status)).length+" open · "+unreadCount+" unread";
  render();
 }
 function render(){
  list.replaceChildren();const items=tickets.filter(t=>!filter.value||t.status===filter.value);
  if(!items.length){list.append(el("div","empty","No matching support tickets."));return}
  for(const t of items){
   const card=el("article","driver"),heading=el("button","support-admin-ticket","#"+t.ticket_number+" · "+t.subject);
   heading.type="button";heading.onclick=()=>{const details=card.querySelector(".support-admin-details");details.hidden=!details.hidden;if(!details.hidden)loadThread(t,details)};
   card.append(heading,el("div","subtext",(getDrivers().find(d=>d.id===t.user_id)?.email||t.user_id)+" · "+t.status.replaceAll("_"," ")+" · "+date(t.created_at)));
   const details=el("div","support-admin-details");details.hidden=true;card.append(details);list.append(card)
  }
 }
 async function loadThread(t,box){
  box.replaceChildren();box.append(el("p","",t.description));
  const {data:msgs,error}=await supabase.from("support_messages").select("*").eq("ticket_id",t.id).order("created_at");if(error){box.append(el("p","",error.message));return}
  const unread=(msgs||[]).filter(m=>m.author_id===t.user_id&&!m.read_at).map(m=>m.id);if(unread.length){const {error:markError}=await supabase.from("support_messages").update({read_at:new Date().toISOString()}).in("id",unread);if(markError)console.warn(markError.message)}
  for(const m of msgs||[]){const item=el("div","support-message");item.append(el("small","",m.author_id===t.user_id?"Driver · "+date(m.created_at):"Support · "+date(m.created_at)),el("p","",m.body));box.append(item)}
  const {data:attachments}=await supabase.from("support_attachments").select("object_path").eq("ticket_id",t.id);
  for(const a of attachments||[]){const b=el("button","action","View Screenshot");b.onclick=async()=>{const {data,error}=await supabase.storage.from("dashlog-support").createSignedUrl(a.object_path,60);if(error)alert(error.message);else window.open(data.signedUrl,"_blank","noopener")};box.append(b)}
  const row=el("div","driver-actions"),select=el("select");for(const status of ["new","open","awaiting_response","resolved","closed"]){const o=el("option","",status.replaceAll("_"," "));o.value=status;select.append(o)}select.value=t.status;
  select.onchange=async()=>{const {error}=await supabase.from("support_tickets").update({status:select.value,updated_at:new Date().toISOString()}).eq("id",t.id);if(error){alert(error.message);select.value=t.status}else{t.status=select.value;render()}};
  row.append(select);box.append(row);
  if(t.status!=="closed"){const form=el("form","support-reply"),input=el("textarea"),button=el("button","action","Send Reply");input.required=true;input.maxLength=5000;input.placeholder="Reply to driver…";form.append(input,button);form.onsubmit=async e=>{e.preventDefault();button.disabled=true;const {data:{user}}=await supabase.auth.getUser();const {error}=await supabase.from("support_messages").insert({ticket_id:t.id,author_id:user.id,body:input.value.trim()});button.disabled=false;if(error)alert(error.message);else{await supabase.from("support_tickets").update({status:"awaiting_response",updated_at:new Date().toISOString()}).eq("id",t.id);t.status="awaiting_response";await loadThread(t,box)}};box.append(form)}
 }
 filter.addEventListener("change",render);return {refresh};
}
