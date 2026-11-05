import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtemp,readFile,readdir,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import {createApplication} from '../src/app.mjs';

const browserPath=process.argv[2]||process.env.CHROME_PATH||
  (process.platform==='win32'?'C:/Program Files/Google/Chrome/Application/chrome.exe':'google-chrome');
const root=await mkdtemp(join(tmpdir(),'vw-browser-'));
const app=createApplication({dataDir:join(root,'data')});
await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));
const origin='http://127.0.0.1:'+app.server.address().port;
const profile=join(root,'profile');
const chrome=spawn(browserPath,[
  '--headless=new','--no-first-run','--no-default-browser-check','--disable-background-networking','--disable-component-update',
  '--remote-debugging-port=0','--user-data-dir='+profile,'about:blank',
],{windowsHide:true,stdio:'ignore'});
let launchError;
chrome.on('error',error=>{launchError=error;});
let ws;
const wait=async(callback,timeout=12000)=>{
  const until=Date.now()+timeout;
  let error;
  do{if(launchError)throw launchError;try{const result=await callback();if(result)return result;}catch(err){error=err;}await delay(100);}while(Date.now()<until);
  throw error||new Error('Timeout');
};
try{
  const [port,path]=(await wait(()=>readFile(join(profile,'DevToolsActivePort'),'utf8'))).split(/\r?\n/);
  ws=new WebSocket('ws://127.0.0.1:'+port+path);
  await new Promise((resolve,reject)=>{ws.addEventListener('open',resolve,{once:true});ws.addEventListener('error',reject,{once:true});});
  let seq=0;
  const messages=new Map(),errors=[];
  ws.onmessage=event=>{
    const packet=JSON.parse(event.data);
    if(packet.method==='Runtime.exceptionThrown')errors.push(packet.params.exceptionDetails.text+': '+packet.params.exceptionDetails.exception?.description);
    const request=messages.get(packet.id);
    if(!request)return;
    messages.delete(packet.id);
    if(packet.error)request.reject(Error(packet.error.message));else request.resolve(packet.result);
  };
  function send(method,params={},sessionId){
    const id=++seq;
    return new Promise((resolve,reject)=>{messages.set(id,{resolve,reject});ws.send(JSON.stringify({id,method,params,sessionId}));});
  }
  async function tab(isolated=false){
    const {browserContextId}=isolated ? await send('Target.createBrowserContext') : {};
    const {targetId}=await send('Target.createTarget',{url:'about:blank',browserContextId});
    const {sessionId}=await send('Target.attachToTarget',{targetId,flatten:true});
    const run=(method,params)=>send(method,params,sessionId);
    await run('Runtime.enable');
    return {run,eval:async expression=>{
      const response=await run('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true,userGesture:true});
      if(response.exceptionDetails)throw Error(response.exceptionDetails.exception?.description||response.exceptionDetails.text);
      return response.result.value;
    }};
  }
  const admin=await tab();
  await send('Browser.setDownloadBehavior',{behavior:'allow',downloadPath:root});
  await admin.run('Page.navigate',{url:origin});
  const evalAdmin=admin.eval;
  await wait(()=>evalAdmin("!!document.querySelector('#auth-form')"));
  const setup=await evalAdmin(`(async()=>{
    const call=async (p,method,body)=>{const r=await fetch(p,{method,headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});if(!r.ok)throw Error(await r.text());return r.json()};
    await call('/api/auth/setup','POST',{username:'admin',password:'browser-test-password',workspace:'Browser'});
    const store=await call('/api/campaigns/stores','POST',{name:'Filial Teste'});
    const access=await call('/api/campaigns/stores/'+store.id+'/access','PUT',{mode:'edit'});
    const point=await call('/api/points','POST',{name:'TV 01'});
    await call('/api/campaigns/points/'+point.id,'PUT',{storeId:store.id,sector:'produce'});
    const payload='codigo;departamento;nome;preco_normal;unidade\\n1;01;Manga;10;kg\\n2;01;Maçã;6;kg';
    const staged=await call('/api/catalog/imports','POST',{text:payload,filename:'produtos.csv'});
    await call('/api/catalog/imports/'+staged.id+'/apply','POST',{});
    const photo=await fetch('/template-assets/mango-v1.jpg').then(r=>r.blob());
    await fetch('/api/media?name=Logo&filename=logo.jpg',{method:'POST',headers:{'Content-Type':'image/jpeg'},body:photo});
    return {point,token:access.token};
  })()`);
  await admin.run('Page.navigate',{url:origin+'/?browser-test=1#campaigns'});
  await wait(()=>evalAdmin("!!document.querySelector('#launch')"));
  await evalAdmin("document.querySelectorAll('.campaign-tabs button')[2].click()");
  await wait(()=>evalAdmin("!!document.querySelector('#identity')"));
  await evalAdmin(`(()=>{const f=document.querySelector('#identity');f.elements.name.value='Marca teste';f.elements.logoImage.selectedIndex=1;f.elements.backgroundImage.selectedIndex=1;document.querySelector('#identity-preview').click();f.requestSubmit()})()`);
  await wait(()=>evalAdmin("[...document.querySelectorAll('#campaign-body li')].some(x=>x.textContent==='Marca teste')"));
  await evalAdmin("document.querySelectorAll('.campaign-tabs button')[0].click()");
  await wait(()=>evalAdmin("[...document.querySelectorAll('#piece-theme option')].some(x=>x.textContent==='Marca teste')"));
  await evalAdmin(`(()=>{const f=document.querySelector('#launch');f.elements.name.value='Ofertas Browser';f.elements.secondsPerItem.value='2';f.querySelector('#piece-sector').value='produce';f.querySelector('#piece-sector').dispatchEvent(new Event('change'));const theme=f.querySelector('#piece-theme');theme.value=[...theme.options].find(x=>x.text==='Marca teste').value;theme.dispatchEvent(new Event('change'));f.querySelector('[name=point]').checked=true;f.querySelector('#search-products').click()})()`);
  await wait(()=>evalAdmin("document.querySelectorAll('#product-results button').length===2"));
  await evalAdmin("(()=>{for(const b of document.querySelectorAll('#product-results button'))b.click();document.querySelector('#launch').requestSubmit()})()");
  await wait(()=>evalAdmin("!!document.querySelector('#confirm-campaign')"));
  assert.equal(await evalAdmin("document.querySelectorAll('#campaign-impact tbody tr').length"),2);
  assert.equal(await evalAdmin("document.querySelectorAll('[data-campaign]').length"),0);
  await evalAdmin("document.querySelector('#confirm-campaign').requestSubmit()");
  await wait(()=>evalAdmin("!!document.querySelector('[data-campaign]')"));
  const player=await tab(true);
  await player.run('Page.navigate',{url:origin+'/player'});
  const code=await wait(()=>player.eval("document.querySelector('.pair h1')?.textContent?.match(/^[A-Z0-9]{6}$/)?.[0]"));
  await evalAdmin(`fetch('/api/points/${setup.point.id}/pair',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({code:${JSON.stringify(code)}})}).then(r=>r.ok)`);
  await wait(()=>player.eval("document.querySelector('.poster-brand-logo')?.naturalWidth>0"),25000);
  assert.equal(await player.eval("document.querySelector('.content-card h1')?.textContent"),'Ofertas Browser');
  await player.run('Page.bringToFront');
  await wait(()=>player.eval("document.querySelector('#player-status')?.textContent.includes('Offline pronto')"),15000);
  await player.run('Network.enable');
  const network = offline=>({offline,latency:0,downloadThroughput:-1,uploadThroughput:-1});
  await player.run('Network.emulateNetworkConditions',network(true));
  await player.run('Page.reload');
  await wait(()=>player.eval("document.querySelector('#player-status')?.textContent.includes('Sem conexão') && document.querySelector('.poster-brand-logo')?.naturalWidth>0"),15000);
  await player.run('Network.emulateNetworkConditions',network(false));
  const branch=await tab(true);
  await branch.run('Page.navigate',{url:origin+'/filial'});
  await wait(()=>branch.eval("typeof document.querySelector('#branch-login')?.onsubmit==='function'"));
  await branch.eval(`(()=>{const f=document.querySelector('#branch-login');f.elements.token.value=${JSON.stringify(setup.token)};f.requestSubmit()})()`);
  await wait(()=>branch.eval("!!document.querySelector('#branch-content input[type=number]')"));
  await branch.eval("(()=>{const f=document.querySelector('#branch-content form');f.querySelector('input[type=number]').value='8.25';f.requestSubmit()})()");
  await wait(()=>branch.eval("document.querySelector('#branch-content [role=status]').textContent.includes('publicados')"));
  await admin.run('Page.bringToFront');
  await evalAdmin("document.querySelector('[data-action=export]').click()");
  await evalAdmin("(()=>{const f=document.querySelector('.campaign-detail form');f.elements.seconds.value='1';f.requestSubmit()})()");
  const file=await wait(async()=>{const files=await readdir(root);return files.find(name=>name.endsWith('.mp4'));},15000);
  const bytes=await readFile(join(root,file));
  assert.equal(bytes.toString('ascii',4,8),'ftyp');
  assert.ok(bytes.includes(Buffer.from('avc1')));
  const decoded=await evalAdmin(`(async()=>{
    async function decode(blob) {
      const url=URL.createObjectURL(blob),video=document.createElement('video');
      try {
        const info=await new Promise((resolve,reject)=>{
          video.onloadedmetadata=()=>resolve({width:video.videoWidth,height:video.videoHeight});
          video.onerror=()=>reject(Error('Decode MP4'));video.src=url;
        });
        video.muted=true;await video.play();return {...info,started:!video.paused};
      } finally {video.pause();URL.revokeObjectURL(url);}
    }
    const horizontal=new Blob([Uint8Array.fromBase64(${JSON.stringify(bytes.toString('base64'))})],{type:'video/mp4'});
    const {recordCampaign}=await import('/campaign-video.js');
    const {campaigns}=await fetch('/api/campaigns').then(r=>r.json());
    const vertical=await recordCampaign(campaigns[0],{seconds:1,vertical:true});
    return [await decode(horizontal),await decode(vertical)];
  })()`);
  assert.deepEqual(decoded,[{width:1280,height:720,started:true},{width:720,height:1280,started:true}]);
  await evalAdmin("document.querySelector('[data-action=report]').click()");
  await wait(()=>evalAdmin("!!document.querySelector('.campaign-report tbody tr')"));
  assert.match(await evalAdmin("document.querySelector('.campaign-report tbody tr').innerText"),/Filial Teste.*TV 01/s);
  await evalAdmin("document.querySelectorAll('.campaign-tabs button')[3].click()");
  await wait(()=>evalAdmin("!!document.querySelector('#reload-alerts')"));
  await evalAdmin("document.querySelectorAll('.campaign-tabs button')[4].click()");
  await wait(()=>evalAdmin("!!document.querySelector('#erp-config')"));
  assert.deepEqual(errors,[]);
  console.log('Browser OK: campanha, identidade, player e cache, filial, relatório, alertas, ERP, MP4 H.264 horizontal e reprodução vertical.');
  await send('Browser.close').catch(()=>{});
}finally{
  ws?.close();chrome.kill();
  await new Promise(resolve=>app.server.close(resolve));await app.close();
  await rm(root,{recursive:true,force:true,maxRetries:10,retryDelay:150}).catch(()=>{});
}
