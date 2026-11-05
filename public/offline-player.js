import {getState,putState,removeState,listEvents,putEvent,deleteEvents,clearEvents,markEventsOffline} from './offline-store.js';
import {EVENT_TTL,mediaUrls} from './offline-policy.js';
import {templateAssetUrls} from './table-templates.js';

const PREFIX='videowall-media-v1-';
export class OfflinePlayer{
 snapshot=null;available=false;status={state:'starting'};writes=Promise.resolve();
 constructor({storage={getState,putState,removeState,listEvents,putEvent,deleteEvents,clearEvents,markEventsOffline},cacheStorage=globalThis.caches,fetcher=globalThis.fetch}={}){this.storage=storage;this.caches=cacheStorage;this.fetch=(...args)=>fetcher.apply(globalThis,args);}
 async initialize(){
  try{
   if(!isSecureContext||!('serviceWorker' in navigator)||!('caches' in globalThis)||!('indexedDB' in globalThis))throw new Error('Use HTTPS ou localhost para habilitar o modo offline.');
   const registration=await navigator.serviceWorker.getRegistration('/player');
   if(!registration?.active)await navigator.serviceWorker.register('/player-sw.js',{type:'module',scope:'/'});
   else void registration.update().catch(()=>{});
   await Promise.race([navigator.serviceWorker.ready,new Promise((_,reject)=>setTimeout(()=>reject(new Error('O modo offline ainda não está pronto. Reabra o player.')),15000))]);
   if(!navigator.serviceWorker.controller)await new Promise((resolve,reject)=>{const timeout=setTimeout(()=>reject(new Error('Reabra o player para concluir o modo offline.')),10000);navigator.serviceWorker.addEventListener('controllerchange',()=>{clearTimeout(timeout);resolve();},{once:true});});
   this.snapshot=await this.storage.getState('active');
   if(this.snapshot){const cache=await this.caches.open(this.snapshot.cacheName);for(const url of mediaUrls(this.snapshot.data)){if(!await cache.match(url)){this.snapshot=null;await this.storage.removeState('active');break;}}}
   this.available=true;this.status={state:this.snapshot?'ready':'waiting'};
  }catch(error){this.status={state:'unsupported',error:error.message};}
  return this.snapshot;
 }
 async invalidate(){
  this.snapshot=null;await this.writes.catch(()=>{});await this.storage.removeState('active');await this.storage.clearEvents();
  for(const key of await this.caches.keys())if(key.startsWith(PREFIX))await this.caches.delete(key);
  this.status={state:'waiting'};
 }
 async prepare(data,signal,onProgress=()=>{}){
  if(!this.available)throw new Error(this.status.error||'Armazenamento offline indisponível.');
  const urls=mediaUrls(data),cacheName=PREFIX+data.point.id+'-'+(data.publication?.id||'empty');
  const cache=await this.caches.open(cacheName);let files=0,bytes=0;
  this.status={state:'downloading',files:0,total:urls.length,bytes:0,pendingVersion:data.publication?.version||0};onProgress();
  try{
   for(const url of urls){
    signal.throwIfAborted();
    if(!/^\/media\/[\w-]+$/.test(url) && !templateAssetUrls.has(url))throw new Error('Endereço de mídia inválido para download.');
    let stored=await cache.match(url);
    if(!stored){
     const old=this.snapshot?.cacheName && await (await this.caches.open(this.snapshot.cacheName)).match(url);
     if(old)await cache.put(url,old);
     else{
      const response=await this.fetch(url,{credentials:'same-origin',cache:'no-store',headers:{'X-VW-Download':'1'},signal:AbortSignal.any([signal,AbortSignal.timeout(300000)])});
      if(response.status!==200)throw new Error('Não foi possível baixar um arquivo completo ('+response.status+').');
      await cache.put(url,response);
     }
     stored=await cache.match(url);
    }
    const size=(await stored.blob()).size,expected=Number(stored.headers.get('Content-Length'));
    if(!size || expected && size!==expected)throw new Error('O download de um arquivo ficou incompleto.');
    files++;bytes+=size;this.status={...this.status,files,bytes};onProgress();
   }
   signal.throwIfAborted();
   return {data,cacheName,files,bytes,confirmedAt:data.serverTime,serverOffset:data.serverTime-Date.now(),wallSavedAt:Date.now(),clockFloor:data.serverTime};
  }catch(error){
   if(cacheName!==this.snapshot?.cacheName)await this.caches.delete(cacheName);
   if(!signal.aborted)this.status={state:'error',error:error.name==='QuotaExceededError'?'Sem espaço para baixar a nova programação. A anterior foi mantida.':error.message};
   onProgress();throw error;
  }
 }
 async commit(snapshot){
  try{await this.save(snapshot);}catch(error){if(snapshot.cacheName!==this.snapshot?.cacheName)await this.caches.delete(snapshot.cacheName).catch(()=>{});this.status={state:'error',error:'Não foi possível salvar a nova programação. A anterior foi mantida.'};throw error;}
  this.status={state:'ready'};
  for(const key of await this.caches.keys())if(key.startsWith(PREFIX)&&key!==snapshot.cacheName)await this.caches.delete(key).catch(()=>{});
 }
 save(snapshot){
  const previous=this.snapshot;this.snapshot=snapshot;
  this.writes=this.writes.catch(()=>{}).then(()=>this.storage.putState('active',snapshot)).catch(error=>{if(this.snapshot===snapshot)this.snapshot=previous;throw error;});return this.writes;
 }
 async pending(now){const events=await this.storage.listEvents();const expired=events.filter(event=>event.createdAt<now-EVENT_TTL);if(expired.length)await this.storage.deleteEvents(expired.map(event=>event.id));return events.filter(event=>event.createdAt>=now-EVENT_TTL).slice(0,200);}
 record(event){return this.storage.putEvent(event);}
 acknowledge(ids){return this.storage.deleteEvents(ids);}
 markOffline(){return this.storage.markEventsOffline();}
 telemetry(){return {...this.status,publicationId:this.snapshot?.data.publication?.id||null,version:this.snapshot?.data.publication?.version||0,files:this.status.files??this.snapshot?.files??0,total:this.status.total??this.snapshot?.files??0,bytes:this.status.bytes??this.snapshot?.bytes??0};}
}
