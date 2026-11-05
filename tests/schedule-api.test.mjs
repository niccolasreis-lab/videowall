import test from 'node:test';import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';import {tmpdir} from 'node:os';import {join} from 'node:path';import {createApplication} from '../src/app.mjs';
test('agenda só muda na publicação e atualização de conteúdo preserva agenda publicada e rascunho pendente',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'schedule-')),app=createApplication({dataDir:dir});await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));const origin='http://127.0.0.1:'+app.server.address().port;let cookie;
 const call=async(path,method='GET',body)=>{const response=await fetch(origin+path,{method,headers:{'Content-Type':'application/json',...(cookie?{Cookie:cookie}:{})},...(body?{body:JSON.stringify(body)}:{})});return {status:response.status,body:await response.json(),cookie:response.headers.get('set-cookie')?.split(';')[0]};};
 try{
  cookie=(await call('/api/auth/setup','POST',{username:'admin',password:'long-password-123',workspace:'Test'})).cookie;
  const content=(await call('/api/content','POST',{name:'Cartaz',kind:'poster',config:{title:'Olá'}})).body;
  const schedule={enabled:true,timeZone:'America/Sao_Paulo',windows:[{days:[1,2,3,4,5],start:'08:00',end:'18:00'}]};
  let playlist=(await call('/api/playlists','POST',{name:'Agenda',items:[{mediaId:content.id,seconds:10}],schedule})).body;
  await call('/api/playlists/'+playlist.id+'/publish','POST',{revision:playlist.revision});
  const published=()=>JSON.parse(app.db.prepare('SELECT snapshot_json FROM publications WHERE id=(SELECT current_publication_id FROM playlists WHERE id=?)').get(playlist.id).snapshot_json);
  assert.deepEqual(published().schedule,schedule);
  playlist=(await call('/api/playlists/'+playlist.id,'PUT',{name:playlist.name,items:playlist.items,revision:playlist.revision})).body;assert.deepEqual(playlist.schedule,schedule,'cliente antigo preserva agenda quando omite o campo');
  playlist=(await call('/api/playlists/'+playlist.id,'PUT',{name:playlist.name,items:playlist.items,revision:playlist.revision,schedule:{enabled:false}})).body;
  assert.deepEqual(published().schedule,schedule);
  await call('/api/content/'+content.id,'PUT',{name:'Cartaz novo',kind:'poster',config:{title:'Novo'}});
  await call('/api/content/'+content.id+'/publish','POST',{});
  assert.deepEqual(published().schedule,schedule);assert.equal((await call('/api/playlists')).body[0].dirty,true,'o horário pendente não é marcado como publicado');
  assert.equal((await call('/api/playlists/'+playlist.id,'PUT',{name:playlist.name,items:playlist.items,revision:(await call('/api/playlists')).body[0].revision,schedule:{enabled:true,timeZone:'Invalido',windows:[]}})).status,400);
 }finally{await new Promise(resolve=>app.server.close(resolve));await app.close();await rm(dir,{recursive:true,force:true});}
});
