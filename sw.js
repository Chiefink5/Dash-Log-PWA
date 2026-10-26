const CACHE_NAME="giglog-cache-v13";
const ASSETS=["/","/index.html","/styles.css","/app.js","/db.js","/auth.js","/dashboardadmin.js","/manifest.json"];
self.addEventListener("install",event=>{event.waitUntil(caches.open(CACHE_NAME).then(cache=>cache.addAll(ASSETS)));self.skipWaiting()});
self.addEventListener("activate",event=>{event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==CACHE_NAME).map(k=>caches.delete(k)))));self.clients.claim()});
self.addEventListener("fetch",event=>{const req=event.request;if(req.method!=="GET"||new URL(req.url).origin!==self.location.origin)return;
if(req.mode==="navigate"){event.respondWith(fetch(req).catch(()=>caches.match("/index.html")));return}
event.respondWith(fetch(req).then(res=>{if(res.ok){const copy=res.clone();caches.open(CACHE_NAME).then(c=>c.put(req,copy))}return res}).catch(()=>caches.match(req)))});
