export function setupTimeline({getWeeks,getTotals,formatWeek,weekNumber,onSelect,formatMoney}){
 const page=document.getElementById("timelinePage"),list=document.getElementById("timelineWeeks");
 const prev=document.getElementById("timelinePrev"),next=document.getElementById("timelineNext");
 const main=document.querySelector("main.container");
 let index=0;
 function render(){
  const weeks=getWeeks(),pages=Math.max(1,Math.ceil(weeks.length/10));
  index=Math.max(0,Math.min(index,pages-1));list.replaceChildren();
  for(const start of weeks.slice(index*10,index*10+10)){
   const totals=getTotals(start),button=document.createElement("button");
   button.type="button";button.className="timeline-week";
   const title=document.createElement("strong");title.textContent="Week "+weekNumber(new Date(start));
   const dates=document.createElement("span");dates.textContent=formatWeek(start);
   const details=document.createElement("small");details.textContent=totals.sessions+" sessions · "+formatMoney(totals.profit);
   const action=document.createElement("b");action.textContent="Open Week →";
   button.append(title,dates,details,action);
   button.onclick=()=>{onSelect(start);show(false)};
   list.append(button)
  }
  document.getElementById("timelinePageCount").textContent="Page "+(index+1)+" of "+pages;
  prev.disabled=index===0;next.disabled=index===pages-1;
 }
 function show(open){
  for(const child of main.children)child.classList.toggle("hidden",open?child!==page:child===page);
  if(open){index=0;render()}window.scrollTo(0,0);
 }
 document.getElementById("weekChip").onclick=()=>show(true);
 document.getElementById("timelineBack").onclick=()=>show(false);
 prev.onclick=()=>{index--;render()};
 next.onclick=()=>{index++;render()};
 return {render,show};
}
