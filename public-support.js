const $=id=>document.getElementById(id);
const form=$("loginSupport"),status=$("helpStatus");
const SITE_KEY=window.DASHLOG_TURNSTILE_SITE_KEY||"";
let captchaToken="";
if(SITE_KEY){
 const script=document.createElement("script");script.src="https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";script.async=true;script.onload=()=>window.turnstile.render("#turnstileSlot",{sitekey:SITE_KEY,callback:token=>captchaToken=token,"expired-callback":()=>captchaToken=""});document.head.append(script)
}else{status.textContent="Secure online submission is being configured. For now, this form opens an email to support."}
form.onsubmit=async e=>{
 e.preventDefault();const email=$("helpEmail").value.trim(),category=$("helpCategory").value,subject=$("helpSubject").value.trim(),description=$("helpDescription").value.trim();
 if(!SITE_KEY){
  const body="From: "+email+"\nCategory: "+category+"\n\n"+description;
  location.href="mailto:chief.inktattoos@yahoo.com?subject="+encodeURIComponent("Dash Log Support: "+subject)+"&body="+encodeURIComponent(body);return
 }
 if(!captchaToken){status.textContent="Complete the security check first.";return}
 const button=form.querySelector("button");button.disabled=true;status.textContent="Sending…";
 try{const response=await fetch("https://khcniybqzaaklmyrjolg.supabase.co/functions/v1/dashlog-public-support",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({email,category,subject,description,token:captchaToken})});const data=await response.json();if(!response.ok)throw Error(data.error||"Unable to submit");form.reset();status.textContent="Your request has been sent. We'll contact you by email."}catch(err){status.textContent=err.message+" You can also email chief.inktattoos@yahoo.com."}finally{button.disabled=false;captchaToken="";window.turnstile?.reset()}
};