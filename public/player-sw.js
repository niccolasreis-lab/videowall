import {getState} from './offline-store.js';
import {cachedMediaResponse} from './offline-range.js';
import {builtInPhotos,templateAssetUrls} from './table-templates.js';

const SHELL='videowall-shell-v10';
const FILES=['/player','/player/','/player.js','/content-renderer.js','/video-health.js','/playlist-schedule.js','/player.css','/retail.css','/table-templates.css','/table-templates.js','/table-renderer.js','/template-backgrounds.js','/content-utils.js','/offline-policy.js','/offline-store.js','/offline-player.js','/offline-range.js','/icon.svg',...builtInPhotos.map(photo=>photo.url)];
self.addEventListener('install',event=>event.waitUntil((async()=>{
 const cache=await caches.open(SHELL);
 await cache.addAll(FILES.map(url=>new Request(url,{cache:'reload'})));
 await self.skipWaiting();
})()));
self.addEventListener('activate',event=>event.waitUntil(self.clients.claim()));
self.addEventListener('fetch',event=>{
 const url=new URL(event.request.url);
 if(url.origin!==self.location.origin || !['GET','HEAD'].includes(event.request.method) || event.request.headers.has('X-VW-Download'))return;
 const navigation=['/player','/player/'].includes(url.pathname)&&event.request.mode==='navigate';
 if(!navigation && !FILES.includes(url.pathname) && !url.pathname.startsWith('/media/') && !templateAssetUrls.has(url.pathname))return;
 event.respondWith((async()=>{
  const client=event.clientId && await self.clients.get(event.clientId);
  if(!navigation && !['/player','/player/'].includes(client && new URL(client.url).pathname))return fetch(event.request);
  if(url.pathname.startsWith('/media/') || templateAssetUrls.has(url.pathname)){
   const active=await getState('active');
   const cached=active?.cacheName && await (await caches.open(active.cacheName)).match(url.origin+url.pathname);
   if(cached)return cachedMediaResponse(cached,event.request.headers.get('Range'),event.request.method==='HEAD');
   if(templateAssetUrls.has(url.pathname)){const shell=await (await caches.open(SHELL)).match(url.origin+url.pathname);if(shell)return shell;}
   return fetch(event.request);
  }
  try{
   const response=await fetch(event.request,{signal:AbortSignal.timeout(4000)});
   if(!response.ok)throw new Error('Sem acesso ao player.');
   return response;
  }catch(error){const cached=await (await caches.open(SHELL)).match(url.origin+url.pathname);if(cached)return cached;throw error;}
 })());
});
