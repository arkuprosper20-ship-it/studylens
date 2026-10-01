const C='studylens-v4',SHELL_URL=new URL('./',self.registration.scope).href,A=[SHELL_URL,'styles.css','app.js'];
self.addEventListener('install',e=>e.waitUntil(Promise.all(A.map(async url=>{
const request=new Request(new URL(url,self.registration.scope),{cache:'reload'});
const response=await fetch(request);
if(!response.ok)throw new Error(`Failed to cache app shell: ${response.status}`);
await(await caches.open(C)).put(request,response);
})).then(()=>self.skipWaiting())));
self.addEventListener('activate',e=>e.waitUntil(caches.keys().then(k=>Promise.all(k.filter(x=>x.startsWith('studylens-')&&x!==C).map(x=>caches.delete(x)))).then(()=>clients.claim())));
self.addEventListener('fetch',e=>{if(e.request.method!=='GET'||new URL(e.request.url).origin!==location.origin)return;
e.respondWith(fetch(e.request).then(r=>{const c=r.clone();caches.open(C).then(x=>x.put(e.request,c));return r}).catch(()=>caches.match(e.request).then(r=>r||caches.match(SHELL_URL))))});
