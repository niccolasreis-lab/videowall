import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {createApplication} from '../src/app.mjs';

test('histórico offline mantém horário original, autoriza publicação entregue e não duplica reenvios',async()=>{
 const dataDir=await mkdtemp(join(tmpdir(),'offline-api-'));let now=Date.UTC(2026,9,30,15);
 const app=createApplication({dataDir,clock:()=>now});await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));
 const origin='http://127.0.0.1:'+app.server.address().port;
 const call=async(path,{cookie,method='GET',body}={})=>{const response=await fetch(origin+path,{method,headers:{'Content-Type':'application/json',...(cookie?{Cookie:cookie}:{})},...(body!==undefined?{body:JSON.stringify(body)}:{})});return {status:response.status,body:await response.json(),cookie:response.headers.get('set-cookie')?.split(';')[0]};};
 try{
  const admin=(await call('/api/auth/setup',{method:'POST',body:{username:'admin',password:'long-password-123',workspace:'Test'}})).cookie;
  const player=await call('/api/player/register',{method:'POST',body:{}}),device=player.cookie;
  const content=(await call('/api/content',{cookie:admin,method:'POST',body:{name:'Cartaz',kind:'poster',config:{title:'Boas-vindas',body:'Teste'}}})).body;
  const playlist=(await call('/api/playlists',{cookie:admin,method:'POST',body:{name:'Primeira',items:[{mediaId:content.id,seconds:10}]}})).body;
  await call('/api/playlists/'+playlist.id+'/publish',{cookie:admin,method:'POST',body:{revision:playlist.revision}});
  const point=(await call('/api/points',{cookie:admin,method:'POST',body:{name:'Ponto',playlistId:playlist.id}})).body;
  await call('/api/points/'+point.id+'/pair',{cookie:admin,method:'POST',body:{code:player.body.code}});
  const delivered=(await call('/api/player/sync',{cookie:device,method:'POST',body:{}})).body;
  const event={id:randomUUID(),pointId:point.id,publicationId:delivered.publication.id,mediaId:content.id,type:'started',createdAt:now-60000,offline:true};
  await call('/api/content/'+content.id,{cookie:admin,method:'PUT',body:{name:'Cartaz novo',kind:'poster',config:{title:'Novo',body:'Nova publicação'}}});
  const updated=(await call('/api/playlists',{cookie:admin})).body[0];
  await call('/api/playlists/'+playlist.id+'/publish',{cookie:admin,method:'POST',body:{revision:updated.revision}});
  now+=3600000;
  const payload={activePublicationId:delivered.publication.id,currentMediaId:content.id,playbackState:'playing',events:[event],offlineStatus:{state:'ready',publicationId:delivered.publication.id,version:1,files:0,bytes:0}};
  const first=await call('/api/player/sync',{cookie:device,method:'POST',body:payload});assert.equal(first.status,200);assert.deepEqual(first.body.acceptedEventIds,[event.id]);
  const retry=await call('/api/player/sync',{cookie:device,method:'POST',body:payload});assert.deepEqual(retry.body.acceptedEventIds,[event.id]);
  const logs=(await call('/api/logs',{cookie:admin})).body;assert.equal(logs.length,1);assert.equal(logs[0].created_at,event.createdAt);assert.equal(logs[0].received_at,now);assert.equal(logs[0].offline,1);assert.equal(logs[0].media_name,'Cartaz');
  const monitor=(await call('/api/points/'+point.id+'/monitor',{cookie:admin})).body;
  assert.equal(monitor.publication.version,2);assert.equal(monitor.point.activePublishedVersion,1);assert.equal(monitor.point.currentMedia.name,'Cartaz');assert.equal(monitor.point.offline.state,'ready');
  const invalid=[{...event,id:randomUUID(),createdAt:now-8*86400000},{...event,id:randomUUID(),createdAt:now+180000},{...event,id:randomUUID(),pointId:randomUUID()},{...event,id:randomUUID(),publicationId:randomUUID()}];
  const refused=await call('/api/player/sync',{cookie:device,method:'POST',body:{events:invalid}});
  assert.deepEqual(refused.body.rejectedEventIds,invalid.map(x=>x.id));assert.equal((await call('/api/logs',{cookie:admin})).body.length,1);
  const malformed={...event,id:randomUUID(),publicationId:{invalid:true}};
  assert.deepEqual((await call('/api/player/sync',{cookie:device,method:'POST',body:{activePublicationId:{invalid:true},events:[malformed]}})).body.rejectedEventIds,[malformed.id]);
  assert.equal((await call('/api/player/sync',{cookie:device,method:'POST',body:{events:Array(201).fill(event)}})).status,400);
  await call('/api/points/'+point.id+'/unpair',{cookie:admin,method:'POST',body:{}});
  assert.equal((await call('/api/player/sync',{cookie:device,method:'POST',body:payload})).status,401);
 }finally{await new Promise(resolve=>app.server.close(resolve));await app.close();await rm(dataDir,{recursive:true,force:true,maxRetries:5,retryDelay:100});}
});
