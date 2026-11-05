import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createApplication} from '../src/app.mjs';
import {isContentActive} from '../public/content-utils.js';

async function fixture(action){
 const dataDir=await mkdtemp(join(tmpdir(),'library-test-')),app=createApplication({dataDir});await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));
 let cookie;const origin='http://127.0.0.1:'+app.server.address().port;
 const call=async(path,method='GET',body,headers={})=>{const response=await fetch(origin+path,{method,headers:{'Content-Type':'application/json',...(cookie?{Cookie:cookie}:{}),...headers},...(body!==undefined?{body:Buffer.isBuffer(body)?body:JSON.stringify(body)}:{})});return {status:response.status,body:await response.json(),cookie:response.headers.get('set-cookie')?.split(';')[0]};};
 try{cookie=(await call('/api/auth/setup','POST',{username:'admin',password:'long-password-123',workspace:'Test'})).cookie;await action({call,app,dataDir});}
 finally{await new Promise(resolve=>app.server.close(resolve));await app.close();await rm(dataDir,{recursive:true,force:true,maxRetries:5,retryDelay:100});}
}
const png=Buffer.from([137,80,78,71,13,10,26,10,0,0,0,0]);
test('envio direto adiciona a vários rascunhos, não duplica e reverte todo lote em conflito',()=>fixture(async({call,app})=>{
 const media=(await call('/api/media?name=Imagem&filename=a.png','POST',png,{'Content-Type':'image/png'})).body;
 const extra=(await call('/api/content','POST',{name:'Cartaz novo',kind:'poster',config:{title:'Bem-vindo'}})).body;
 const a=(await call('/api/playlists','POST',{name:'A',items:[{mediaId:media.id,seconds:5}]})).body;
 const b=(await call('/api/playlists','POST',{name:'B',items:[]})).body;
 await call('/api/playlists/'+a.id+'/publish','POST',{revision:a.revision});
 const snapshot=app.db.prepare('SELECT snapshot_json FROM publications WHERE playlist_id=?').get(a.id).snapshot_json;
 const targets=[a,b].map(p=>({id:p.id,revision:p.revision}));
 let result=await call('/api/content/'+extra.id+'/playlists','POST',{targets:[targets[0],{...targets[1],revision:999}],seconds:7});
 assert.equal(result.status,409);assert.equal(app.db.prepare('SELECT revision FROM playlists WHERE id=?').get(a.id).revision,a.revision);
 result=await call('/api/content/'+extra.id+'/playlists','POST',{targets,seconds:7});assert.equal(result.status,200);assert.equal(result.body.added.length,2);
 const lists=(await call('/api/playlists')).body;
 for(const p of lists){assert.equal(p.dirty,true);assert.equal(p.items.at(-1).mediaId,extra.id);assert.equal(p.items.at(-1).seconds,7);}
 assert.equal(app.db.prepare('SELECT snapshot_json FROM publications WHERE playlist_id=?').get(a.id).snapshot_json,snapshot);
 result=await call('/api/content/'+extra.id+'/playlists','POST',{targets:lists.map(p=>({id:p.id,revision:p.revision})),seconds:7});assert.equal(result.body.added.length,0);assert.equal(result.body.skipped.length,2);
 assert.equal((await call('/api/content/'+extra.id+'/playlists','POST',{targets:[],seconds:7})).status,400);
 const current=(await call('/api/playlists')).body;
 assert.equal((await call('/api/content/'+media.id+'/playlists','POST',{targets:current.filter(p=>p.id===b.id).map(p=>({id:p.id,revision:p.revision})),seconds:0})).status,400);
}));

test('validade de imagem e vídeo aceita edição parcial, valida antes do upload e preserva publicação',()=>fixture(async({call,app,dataDir})=>{
 const validFrom='2026-10-30T10:00:00-03:00',validUntil='2026-11-01T10:00:00-03:00';
 const uploaded=await call('/api/media?'+new URLSearchParams({name:'Imagem',filename:'a.png',validFrom,validUntil}),'POST',png,{'Content-Type':'image/png'});
 assert.equal(uploaded.status,201);const image=uploaded.body;assert.equal(image.config.validFrom,'2026-10-30T13:00:00.000Z');
 const playlist=(await call('/api/playlists','POST',{name:'A',items:[{mediaId:image.id,seconds:10}]})).body;
 await call('/api/playlists/'+playlist.id+'/publish','POST',{revision:playlist.revision});
 const before=app.db.prepare('SELECT snapshot_json FROM publications WHERE playlist_id=?').get(playlist.id).snapshot_json;
 const policy=await call('/api/media/'+image.id,'PUT',{hasPrices:false});assert.deepEqual(policy.body.config,image.config);
 const edited=await call('/api/media/'+image.id,'PUT',{validUntil:'2026-11-02T00:00:00Z'});assert.equal(edited.body.hasPrices,false);assert.equal(edited.body.config.validFrom,image.config.validFrom);
 assert.equal(app.db.prepare('SELECT snapshot_json FROM publications WHERE playlist_id=?').get(playlist.id).snapshot_json,before);
 const invalid=await call('/api/media/'+image.id,'PUT',{validUntil:'2026-10-01T00:00:00Z'});assert.equal(invalid.status,400);
 assert.equal((await call('/api/media?name=Inválida&validFrom=sem-fuso','POST',png,{'Content-Type':'image/png'})).status,400);
 assert.equal((await readdir(join(dataDir,'uploads'))).length,1);
 const video=Buffer.from([0,0,0,12,102,116,121,112,0,0,0,0]);
 const clip=(await call('/api/media?'+new URLSearchParams({name:'Vídeo',filename:'v.mp4',validFrom,validUntil}),'POST',video,{'Content-Type':'video/mp4'})).body;
 for(const item of [image,clip]){assert.equal(isContentActive(item,Date.parse(validFrom)-1),false);assert.equal(isContentActive(item,Date.parse(validFrom)),true);assert.equal(isContentActive(item,Date.parse(validUntil)),false);}
 const clear=(await call('/api/media/'+image.id,'PUT',{validFrom:null,validUntil:null})).body;assert.equal(clear.config.validFrom,null);assert.equal(clear.hasPrices,false);
}));
