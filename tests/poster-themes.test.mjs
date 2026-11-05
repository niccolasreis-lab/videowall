import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createApplication} from '../src/app.mjs';

test('temas persistem só aparência, exigem login e não alteram cartazes ou publicações',async()=>{
 const dataDir=await mkdtemp(join(tmpdir(),'poster-themes-'));
 let app=createApplication({dataDir}),cookie;
 const start=()=>new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));
 const stop=async()=>{await new Promise(resolve=>app.server.close(resolve));await app.close();};
 const call=async(path,method='GET',body)=>{
  const response=await fetch(`http://127.0.0.1:${app.server.address().port}`+path,{method,headers:{'Content-Type':'application/json',...(cookie?{Cookie:cookie}:{})},...(body!==undefined?{body:JSON.stringify(body)}:{})});
  return {status:response.status,body:await response.json(),cookie:response.headers.get('set-cookie')?.split(';')[0]};
 };
 await start();
 try{
  assert.equal((await call('/api/poster-themes')).status,401);
  assert.equal((await call('/api/poster-themes','POST',{})).status,401);
  cookie=(await call('/api/auth/setup','POST',{username:'admin',password:'long-test-password',workspace:'Test'})).cookie;
  const poster=(await call('/api/content','POST',{name:'Cartaz',kind:'poster',config:{title:'Ofertas',rows:[{name:'Arroz',price:5}]}})).body;
  const playlist=(await call('/api/playlists','POST',{name:'TV',items:[{mediaId:poster.id,seconds:10}]})).body;
  await call(`/api/playlists/${playlist.id}/publish`,'POST',{revision:playlist.revision});
  const before=app.db.prepare('SELECT snapshot_json FROM publications').get().snapshot_json;
  const created=await call('/api/poster-themes','POST',{name:'Minha loja',appearance:{background:'#123456',color:'#ffffff',font:'serif',itemSize:42,rounded:true,rows:[{name:'Não copiar',price:1}],title:'Não copiar',validUntil:'2026-01-01T00:00:00Z',secondsPerItem:5,layout:'spotlight'}});
  assert.equal(created.status,201,JSON.stringify(created.body));
  const theme=created.body;
  assert.equal(theme.appearance.itemSize,42);assert.equal(theme.appearance.rounded,true);
  for(const key of ['title','rows','validUntil','secondsPerItem','layout'])assert.equal(key in theme.appearance,false);
  assert.equal((await call('/api/poster-themes/default','PUT',{id:theme.id})).status,200);
  assert.equal((await call('/api/poster-themes/default','PUT',{id:'missing'})).status,404);
  for(const appearance of [{background:'red'},{font:'unknown'},{rounded:'yes'},{priceSize:201}]){
   assert.equal((await call('/api/poster-themes','POST',{name:'Inválido',appearance})).status,400);
  }
  assert.equal((await call('/api/poster-themes','POST',{name:' ',appearance:{}})).status,400);
  assert.equal((await call('/api/poster-themes/builtin:market','DELETE')).status,400);
  assert.equal(app.db.prepare('SELECT snapshot_json FROM publications').get().snapshot_json,before);
  assert.equal((await call('/api/playlists')).body[0].dirty,false);
  assert.deepEqual((await call('/api/media')).body[0],poster);
  await stop();app=createApplication({dataDir});await start();
  const loaded=(await call('/api/poster-themes')).body;
  assert.equal(loaded.defaultId,theme.id);assert.deepEqual(loaded.items.find(item=>item.id===theme.id),theme);
  assert.equal((await call('/api/poster-themes/'+theme.id,'DELETE')).status,200);
  assert.equal((await call('/api/poster-themes')).body.defaultId,null);
  assert.equal((await call('/api/poster-themes/default','PUT',{id:'builtin:produce'})).status,200);
  assert.equal((await call('/api/poster-themes/default','PUT',{id:null})).status,200);
 }finally{await stop();await rm(dataDir,{recursive:true,force:true});}
});
