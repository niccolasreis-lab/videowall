import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createApplication} from '../src/app.mjs';

const line=(code,price,name='QUEIJO')=>'010'+code+String(price).padStart(6,'0')+'000'+name.padEnd(50)+'0'.repeat(208);
test('catálogo revisa, aplica, detecta preço zero e publica só o conteúdo escolhido',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'catalog-test-')),app=createApplication({dataDir:dir});
 await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));const origin='http://127.0.0.1:'+app.server.address().port;let cookie;
 const call=async(path,method='GET',body)=>{const response=await fetch(origin+path,{method,headers:{'Content-Type':'application/json',...(cookie?{Cookie:cookie}:{})},...(body?{body:JSON.stringify(body)}:{})});return {status:response.status,body:await response.json(),cookie:response.headers.get('set-cookie')?.split(';')[0]};};
 try{
  assert.equal((await call('/api/catalog')).status,401);
  cookie=(await call('/api/auth/setup','POST',{username:'admin',password:'long-password-123',workspace:'Test'})).cookie;
  const first=await call('/api/catalog/imports','POST',{filename:'itensmgv.txt',text:line('001002',7560)+'\n'+line('021002',0)});
  assert.equal(first.status,201);assert.equal(first.body.summary.total,2);assert.equal(first.body.summary.zeroPrices,1);
  assert.equal((await call('/api/catalog/products')).body.total,0);
  assert.equal((await call('/api/catalog/imports/'+first.body.id+'/apply','POST',{})).status,200);
  assert.equal((await call('/api/catalog/products?q=001002')).body.items[0].price,75.6);
  assert.equal((await call('/api/catalog/imports','POST',{text:line('001002',7560)+'\n'+line('021002',0)})).body.id,first.body.id);
  const content=await call('/api/content','POST',{name:'Tabela teste',kind:'price_table',config:{title:'Tabela',rows:[{name:'QUEIJO',code:'001002',department:'01',price:75.6,unit:'KG'}]}});
  const playlist=await call('/api/playlists','POST',{name:'Publicada',items:[{mediaId:content.body.id,seconds:10}]});
  await call('/api/playlists/'+playlist.body.id+'/publish','POST',{revision:playlist.body.revision});
  await call('/api/playlists/'+playlist.body.id,'PUT',{revision:playlist.body.revision,name:'Nome pendente',items:playlist.body.items});
  const second=await call('/api/catalog/imports','POST',{text:line('001002',8000)});
  assert.equal(second.body.summary.changed,1);assert.equal(second.body.summary.removed,1);
  await call('/api/catalog/imports/'+second.body.id+'/apply','POST',{});
  const refreshed=await call('/api/catalog/refresh-content','POST',{});assert.equal(refreshed.body.changed.length,1);
  assert.deepEqual((await call('/api/catalog')).body.pendingContentIds,[content.body.id]);
  await call('/api/catalog/publish','POST',{ids:[content.body.id]});
  const snapshot=app.db.prepare('SELECT snapshot_json FROM publications ORDER BY rowid DESC LIMIT 1').get();
  assert.equal(JSON.parse(snapshot.snapshot_json).items[0].config.rows[0].price,80);assert.equal(JSON.parse(snapshot.snapshot_json).playlistName,'Publicada');
  assert.equal((await call('/api/playlists')).body[0].dirty,true);
  assert.deepEqual((await call('/api/catalog')).body.pendingContentIds,[]);
  const stale=await call('/api/catalog/imports','POST',{text:line('001002',8500)});
  const newer=await call('/api/catalog/imports','POST',{text:line('001002',8600)});
  await call('/api/catalog/imports/'+newer.body.id+'/apply','POST',{});
  assert.equal((await call('/api/catalog/imports/'+stale.body.id+'/apply','POST',{})).status,409);
  const reviewedAgain=await call('/api/catalog/imports','POST',{text:line('001002',8500)});
  assert.equal(reviewedAgain.body.id,stale.body.id);
  assert.equal((await call('/api/catalog/imports/'+stale.body.id+'/apply','POST',{})).status,200);
  const zero=await call('/api/catalog/imports','POST',{text:line('001002',0)});await call('/api/catalog/imports/'+zero.body.id+'/apply','POST',{});await call('/api/catalog/refresh-content','POST',{});
  assert.equal(JSON.parse(app.db.prepare('SELECT config_json FROM virtual_content WHERE id=?').get(content.body.id).config_json).rows[0].active,true);
  assert.equal(JSON.parse(app.db.prepare('SELECT config_json FROM virtual_content WHERE id=?').get(content.body.id).config_json).rows[0].catalogUnavailable,true);
  await writeFile(join(dir,'itensmgv.txt'),line('001002',9000));app.catalog.configure({path:dir,enabled:true});await app.catalog.check();const count=app.catalog.status().imports.length;await app.catalog.check();assert.equal(app.catalog.status().imports.length,count+1);assert.equal(app.catalog.status().imports[0].status,'pending');
 }finally{await new Promise(resolve=>app.server.close(resolve));await app.close();await rm(dir,{recursive:true,force:true});}
});
