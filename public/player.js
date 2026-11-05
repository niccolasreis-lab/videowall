import {renderVirtual} from './content-renderer.js';
import {isContentActive} from './content-utils.js';
import {OfflinePlayer} from './offline-player.js';
import {superviseVideo} from './video-health.js';
import {isPlaylistScheduled} from './playlist-schedule.js';
import {canPlay,nextPlaybackBoundary,externalKinds,EVENT_TTL} from './offline-policy.js';
const root = document.querySelector('#player');
const offline=new OfflinePlayer();
let scheduleTimer=null,serverOffset=0,currentData=null,confirmedAt=0,clockUnsafe=false;
let clockBase=Date.now(),clockMono=performance.now(),connected=false,registered=false;
let last={currentMediaId:null,playbackState:'waiting'},active=null,timer=null,retryTimer=null;
let syncing=false,syncAgain=false,desiredKey='',activeKey='',download=null,downloadController=null,generation=0;
let eventWrites=Promise.resolve(),memoryEvents=[],pendingCount=0;
const playbackNow=()=>Math.max(Date.now()+serverOffset,clockBase+performance.now()-clockMono);
const context=()=>({now:playbackNow(),connected,confirmedAt,clockUnsafe,schedule:currentData?.publication?.schedule});
const publicationKey=data=>data.point.id+':'+(data.publication?.id||'empty')+':'+data.commandVersion;
function setClock(time){if(!Number.isFinite(time))return;serverOffset=time-Date.now();clockBase=time;clockMono=performance.now();clockUnsafe=false;}
function updateStatus(){
 const status=document.querySelector('#player-status'),s=offline.status;
 if(!status)return;
 status.dataset.state=!connected?'offline':s.state;
 status.textContent=s.state==='unsupported'?s.error:
 s.state==='error'?'Download pendente: '+s.error:
 s.state==='downloading'?'Baixando programação: '+s.files+'/'+s.total+' arquivo(s). Versão anterior mantida.':
 !connected?'Sem conexão · programação salva'+(pendingCount?' · '+pendingCount+' evento(s) pendente(s)':''):
 offline.snapshot?'Offline pronto · v'+(offline.snapshot.data.publication?.version||0)+' · '+offline.snapshot.files+' arquivo(s) salvo(s)':'Conectado · aguardando programação';
}
let segment=null,playStarted=performance.now();
function saveQueued(event){memoryEvents.push(event);pendingCount++;updateStatus();if(offline.available)eventWrites=eventWrites.catch(()=>{}).then(()=>offline.record(event)).then(()=>{memoryEvents=memoryEvents.filter(x=>x.id!==event.id);}).catch(()=>hud('Não foi possível guardar parte do histórico neste aparelho.'));}
function flushSegment(){if(!segment)return;const mono=performance.now(),duration=Math.floor(mono-segment.mono),end=Math.floor(playbackNow());if(duration>0&&duration<=15000)saveQueued({...segment.event,id:crypto.randomUUID(),type:'segment',startedAt:end-duration,createdAt:end,durationMs:duration,offline:!connected});segment.mono=mono;}
function beginSegment(item){if(segment?.event.mediaId===item.mediaId)return;segment={mono:performance.now(),event:{pointId:currentData.point.id,publicationId:currentData.publication.id,mediaId:item.mediaId}};}
function applyPointSettings(settings={}){const rotation={horizontal:0,'horizontal-inverted':180,vertical:90,'vertical-inverted':270}[settings.orientation]||0;const vertical=rotation===90||rotation===270;Object.assign(root.style,{position:'fixed',inset:'auto',left:'50%',top:'50%',width:vertical?'100vh':'100vw',height:vertical?'100vw':'100vh',transform:'translate(-50%,-50%) rotate('+rotation+'deg)'});document.body.classList.toggle('player-kiosk',settings.kiosk===true);let bar=document.querySelector('#piece-progress');if(!bar){bar=document.createElement('progress');bar.id='piece-progress';bar.max=1;bar.setAttribute('aria-label','Progresso da peça');document.body.append(bar);}bar.hidden=!settings.progress;}
setInterval(()=>{const bar=document.querySelector('#piece-progress');if(!bar||bar.hidden)return;const video=root.querySelector('video'),duration=video?.duration||active?.seconds||0;bar.value=video&&Number.isFinite(video.duration)?video.currentTime/video.duration:duration?Math.min(1,(performance.now()-playStarted)/(duration*1000)):0;},250);
function queueEvent(type,item,detail=''){
 if(type!=='started'){flushSegment();segment=null;}
 if(!currentData?.publication)return;
 const event={id:crypto.randomUUID(),pointId:currentData.point.id,publicationId:currentData.publication.id,mediaId:item.mediaId,type,detail,createdAt:Math.floor(playbackNow()),offline:!connected};
 saveQueued(event);
 void sync();
}
async function pendingEvents(){
 await eventWrites;
 const now=playbackNow();memoryEvents=memoryEvents.filter(event=>event.createdAt>=now-EVENT_TTL);
 const saved=offline.available?await offline.pending(now):[];
 return [...new Map([...saved,...memoryEvents].map(event=>[event.id,event])).values()].sort((a,b)=>a.createdAt-b.createdAt).slice(0,200);
}
function changeConnection(value){
 const changed=connected!==value;connected=value;updateStatus();
 if(changed && currentData && (!active || externalKinds.has(active.kind)))showPublication(currentData);
}
const screenIcon = '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="4" width="18" height="13" rx="2"/><path d="M8 21h8M12 17v4"/></svg>';
async function request(path,body){
 const response=await fetch(path,{method:'POST',credentials:'same-origin',cache:'no-store',headers:{'Content-Type':'application/json'},body:JSON.stringify(body||{}),signal:AbortSignal.timeout(10000)});
 const data=await response.json().catch(()=>({}));
 if(!response.ok){const error=new Error(data.error||'Falha na conexão.');error.status=response.status;throw error;}
 return data;
}
function hud(message) { let el = document.querySelector('.hud'); if (!el) { el = document.createElement('div'); el.className = 'hud'; document.body.append(el); } el.textContent = message; el.classList.add('visible'); setTimeout(() => el.classList.remove('visible'), 2800); }
function pairing(data, error = '') { clearTimeout(scheduleTimer); clearTimeout(timer); root.innerHTML = `<section class="pair"><div class="pair-content"><div class="brand">VideoWall</div><h1>${data?.code || '— — — — — —'}</h1><p>${error || 'Acesse o painel e utilize o código acima para vincular este player a um ponto.'}</p><span class="pair-state">${data?.expired ? 'O código expirou. Um novo código será gerado.' : 'Este código é válido por 30 minutos.'}</span><small>Deixe esta tela aberta enquanto faz o vínculo.</small></div></section>`; }
function empty(point) { clearTimeout(timer); root.innerHTML = `<section class="empty-player"><div>${screenIcon}</div><h1></h1><p>Este player está vinculado, mas ainda não há uma playlist publicada para o ponto.</p></section>`; root.querySelector('h1').textContent = point.name; }

function selectNext(publication){
 const items=(publication.items||[]).filter(item=>canPlay(item,context()));
 if(!items.length)return null;
 const index=active?items.findIndex(item=>item.id===active.id):-1;
 return items[(index+1)%items.length];
}
function scheduleBoundary(){
 clearTimeout(scheduleTimer);
 const items=currentData?.publication?.items||[],before=context();
 const boundary=nextPlaybackBoundary(items,before);
 if(!boundary)return;
 scheduleTimer=setTimeout(()=>{
  const after=context();
  if(items.some(item=>canPlay(item,before)!==canPlay(item,after)))showPublication(currentData);
  else scheduleBoundary();
 },Math.min(2147483647,Math.max(1,boundary-playbackNow())));
}
function showPublication(data){
 flushSegment();segment=null;currentData=data;applyPointSettings(data.point.settings);clearTimeout(scheduleTimer);clearTimeout(timer);
 const publication=data.publication;
 scheduleBoundary();
 const next=publication&&selectNext(publication);
 if(!next){
  active=null;last.currentMediaId=null;last.playbackState='waiting';empty(data.point);
  if(!isPlaylistScheduled(publication?.schedule,playbackNow())){last.playbackState='scheduled';root.querySelector('p').textContent='Fora do horário programado. A reprodução será retomada automaticamente.';}
  else root.querySelector('p').textContent='Conteúdo temporariamente indisponível. Aguardando programação válida ou reconexão.';
  return;
 }
 playItem(next,data.point.fit,publication);
}
function playItem(item,fit,publication){flushSegment();segment=null;
 if(!item||!canPlay(item,context()))return showPublication(currentData);
 clearTimeout(timer);timer=null;active=item;last.currentMediaId=item.mediaId;last.playbackState='loading';
 root.innerHTML='<section class="screen '+(fit==='cover'?'cover':'')+'"></section>';
 const container=root.querySelector('.screen');
 let started=false,finished=false,failing=false,stopVideo=()=>{};
 const advance=()=>{if(!container.isConnected||finished)return;finished=true;queueEvent(last.playbackState==='playing'?'ended':'error',item,last.playbackState==='playing'?'':'O conteúdo não confirmou carregamento.');playItem(selectNext(publication),fit,publication);};
 const ready=()=>{if(!container.isConnected||!canPlay(item,context()))return;last.playbackState='playing';beginSegment(item);if(started)return;playStarted=performance.now();started=true;queueEvent('started',item);};
 const failed=detail=>{if(!container.isConnected||finished||failing)return;failing=true;stopVideo();flushSegment();segment=null;last.playbackState='error';queueEvent('error',item,detail);clearTimeout(timer);timer=setTimeout(()=>{if(!container.isConnected)return;finished=true;playItem(selectNext(publication),fit,publication);},3000);};
 if(!['image','video','product_image'].includes(item.kind)){
  if(renderVirtual(item,container,ready,failed)!=='pending')ready();
  if(!timer)timer=setTimeout(advance,item.seconds*1000);
  return;
 }
 if(item.kind==='video'){
  const video=document.createElement('video');video.src=item.url;video.autoplay=true;video.muted=true;video.playsInline=true;
  video.onended=()=>{stopVideo();advance();};video.onerror=()=>failed('O arquivo de vídeo não pôde ser reproduzido.');
  container.append(video);
  stopVideo=superviseVideo(video,{onPlaying:ready,onWaiting:()=>{flushSegment();segment=null;last.playbackState='loading';},onFailure:failed,isAllowed:()=>container.isConnected&&!finished&&!failing&&canPlay(item,context())});
  timer=setTimeout(()=>{if(!started)failed('O vídeo não confirmou carregamento.');},30000);
 }else{
  const image=document.createElement('img');image.alt='';
  image.onload=()=>{ready();clearTimeout(timer);timer=setTimeout(advance,item.seconds*1000);};
  image.onerror=()=>failed('A imagem não pôde ser carregada.');image.src=item.url;container.append(image);
  timer=setTimeout(()=>failed('A imagem não confirmou carregamento.'),30000);
 }
}
async function clearSaved(){
 generation++;desiredKey='';downloadController?.abort();
 if(download)await download.catch(()=>{});
 download=null;activeKey='';currentData=null;active=null;last={currentMediaId:null,playbackState:'waiting'};
 clearTimeout(timer);clearTimeout(scheduleTimer);memoryEvents=[];await eventWrites.catch(()=>{});pendingCount=0;
 if(offline.available)await offline.invalidate();
}
function startDownload(data){
 desiredKey=publicationKey(data);
 if(download){downloadController.abort();return;}
 const key=desiredKey,ownGeneration=generation;
 downloadController=new AbortController();
 download=(async()=>{
  try{
   const snapshot=await offline.prepare(data,downloadController.signal,updateStatus);
   if(key!==desiredKey||ownGeneration!==generation)return;
   await offline.commit(snapshot);
   if(key!==desiredKey||ownGeneration!==generation)return;
   confirmedAt=snapshot.confirmedAt;activeKey=key;active=null;showPublication(data);updateStatus();
   void sync();
  }catch(error){if(!downloadController.signal.aborted){if(offline.status.state!=='unsupported')offline.status={state:'error',error:error.message};hud(error.message);}}
  finally{download=null;updateStatus();}
 })();
}
async function acceptState(data){
 if(data.state==='pairing'){
  if(currentData||offline.snapshot)await clearSaved();
  pairing(data);if(data.expired)registered=false;updateStatus();return;
 }
 if(currentData && (currentData.deviceId!==data.deviceId||currentData.point.id!==data.point.id))await clearSaved();
 const key=publicationKey(data);
 if(key===activeKey && offline.snapshot){
  confirmedAt=data.serverTime;
  const snapshot={...offline.snapshot,data,confirmedAt,serverOffset,wallSavedAt:Date.now(),clockFloor:playbackNow()};
  await offline.save(snapshot);currentData=data;
  // Reagendar também o limite móvel de 24 h, sem reiniciar a mídia.
  scheduleBoundary();
  if(!active)showPublication(data);
 }else if(download && desiredKey===key){/* O heartbeat continua durante o download. */}
 else startDownload(data);
 updateStatus();
}
async function sync(){
 if(syncing){syncAgain=true;return;}
 flushSegment();
 syncing=true;clearTimeout(retryTimer);
 try{
  const events=await pendingEvents();pendingCount=events.length;
  const data=await request(registered?'/api/player/sync':'/api/player/register',registered?{...last,activePublicationId:currentData?.publication?.id||null,offlineStatus:offline.telemetry(),telemetry:{version:'0.2.0-web',platform:navigator.userAgentData?.platform||navigator.platform||'Web',capabilities:{offline:offline.available,segments:true}},events}:{});
  if(registered){
   const acknowledged=[...(data.acceptedEventIds||[]),...(data.rejectedEventIds||[])];
   if(offline.available)await offline.acknowledge(acknowledged);
   memoryEvents=memoryEvents.filter(event=>!acknowledged.includes(event.id));
   pendingCount=Math.max(0,pendingCount-acknowledged.length);
   if(data.rejectedEventIds?.length)hud('Alguns eventos antigos ou de outro vínculo não puderam ser recuperados.');
  }
  registered=true;setClock(data.serverTime);changeConnection(true);await acceptState(data);
  if(events.length===200)syncAgain=true;
 }catch(error){
  if(error.status===401){registered=false;await clearSaved();pairing(null,'Este player precisa ser vinculado novamente.');}
  changeConnection(false);memoryEvents=memoryEvents.map(event=>({...event,offline:true}));
  if(offline.available){await eventWrites.catch(()=>{});await offline.markOffline().catch(()=>{});}
  retryTimer=setTimeout(sync,5000);
 }finally{
  syncing=false;updateStatus();
  if(syncAgain&&connected){syncAgain=false;queueMicrotask(sync);}else syncAgain=false;
 }
}
async function initialize(){
 const snapshot=await offline.initialize();
 if(snapshot){
  serverOffset=snapshot.serverOffset||0;clockUnsafe=Date.now()<snapshot.wallSavedAt-60000;
  clockBase=Math.max(Date.now()+serverOffset,snapshot.clockFloor||snapshot.confirmedAt);clockMono=performance.now();
  confirmedAt=snapshot.confirmedAt;activeKey=publicationKey(snapshot.data);showPublication(snapshot.data);
 }
 updateStatus();void sync();
 setInterval(()=>{
  if(offline.snapshot && currentData && offline.snapshot.data.publication?.id===currentData.publication?.id)void offline.save({...offline.snapshot,clockFloor:playbackNow(),wallSavedAt:Date.now(),serverOffset}).catch(()=>{});
  void sync();
 },10000);
 navigator.storage?.persist?.().catch(()=>{});
}
document.addEventListener('visibilitychange',()=>{if(!document.hidden)void sync();});
window.addEventListener('online',()=>void sync());
window.addEventListener('offline',()=>changeConnection(false));
initialize().catch(error=>{pairing(null,error.message);updateStatus();});
