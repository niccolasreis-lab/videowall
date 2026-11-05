import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApplication } from '../src/app.mjs';

test('virtual content validates, publishes an immutable snapshot and keeps media compatible', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'videowall-content-'));
  const app = createApplication({dataDir:directory});
  await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${app.server.address().port}`;
  let cookie;
  const call = async (path, method = 'GET', body) => { const response = await fetch(origin + path, {method, headers:{'Content-Type':'application/json', ...(cookie ? {Cookie:cookie} : {})}, ...(body ? {body:JSON.stringify(body)} : {})}); return {status:response.status, body:await response.json(), cookie:response.headers.get('set-cookie')?.split(';')[0]}; };
  try {
    cookie = (await call('/api/auth/setup','POST',{workspace:'Test',username:'admin',password:'long-test-password'})).cookie;
    const fixtures = [
      {kind:'youtube',config:{url:'https://www.youtube.com/shorts/abcdefghijk'}},
      {kind:'web',config:{url:'https://example.com/'}},
      {kind:'poster',config:{title:'Olá',body:'Texto'}},
      {kind:'offer',config:{title:'Café',price:12.5}},
      {kind:'price_table',config:{title:'Preços',rows:[{name:'Café',price:12.5}]}},
      {kind:'weather',config:{city:'Fortaleza',latitude:-3.73,longitude:-38.52}},
    ];
    const items=[];
    for (const fixture of fixtures) { const created=await call('/api/content','POST',{name:fixture.kind,...fixture}); assert.equal(created.status,201,JSON.stringify(created.body)); items.push({mediaId:created.body.id,seconds:15}); }
    assert.equal((await call('/api/media')).body.length,6);
    const styled = await call('/api/content','POST',{name:'Cartaz avançado',kind:'poster',config:{title:'',hideHeader:true,layout:'list-spotlight',rounded:true,gradient:true,showUnit:false,itemSize:36,priceSize:52,featuredItemSize:48,featuredPriceSize:72,secondsPerItem:10,rows:[{name:'Arroz',price:24.9,unit:'KG'},{name:'Feijão',price:8.5,unit:'UN',active:false}]}});
    assert.equal(styled.status,201,JSON.stringify(styled.body));
    assert.equal(styled.body.config.title,'');
    assert.equal(styled.body.config.hideHeader,true);
    assert.equal(styled.body.config.layout,'list-spotlight');
    assert.equal(styled.body.config.showUnit,false);
    assert.equal(styled.body.config.rounded,true);
    assert.equal(styled.body.config.gradient,true);
    assert.equal(styled.body.config.itemSize,36);
    assert.equal(styled.body.config.featuredPriceSize,72);
    assert.equal(styled.body.config.rows[1].active,false);
    const defaults = await call('/api/content','POST',{name:'Cartaz padrão',kind:'poster',config:{title:'Ofertas',layout:'grid'}});
    assert.equal(defaults.status,201);
    assert.equal(defaults.body.config.showUnit,true);
    assert.equal(defaults.body.config.rounded,false);
    assert.equal(defaults.body.config.gradient,false);
    assert.equal(defaults.body.config.hideHeader,false);
    assert.equal('itemSize' in defaults.body.config,false);
    assert.equal((await call('/api/content','POST',{name:'bad',kind:'poster',config:{title:'X',rounded:'yes'}})).status,400);
    assert.equal((await call('/api/content','POST',{name:'bad',kind:'poster',config:{title:'X',showUnit:'no'}})).status,400);
    assert.equal((await call('/api/content','POST',{name:'bad',kind:'poster',config:{title:'X',itemSize:7}})).status,400);
    assert.equal((await call('/api/content','POST',{name:'bad',kind:'poster',config:{title:'X',priceSize:8.5}})).status,400);
    assert.equal((await call('/api/content','POST',{name:'bad',kind:'poster',config:{title:'',hideHeader:false}})).status,400);
    assert.equal((await call('/api/content','POST',{name:'bad',kind:'web',config:{url:'javascript:alert(1)'}})).status,400);
    assert.equal((await call('/api/content','POST',{name:'bad',kind:'youtube',config:{url:'https://attacker.test/?v=abcdefghijk'}})).status,400);
    assert.equal((await call('/api/content','POST',{name:'bad',kind:'offer',config:{title:'x',price:-1}})).status,400);
    const playlist=await call('/api/playlists','POST',{name:'Mix',items});
    assert.equal(playlist.status,201);
    assert.equal((await call(`/api/playlists/${playlist.body.id}/publish`,'POST',{revision:playlist.body.revision})).status,200);
    const publication=app.db.prepare('SELECT snapshot_json FROM publications').get();
    const snapshot=JSON.parse(publication.snapshot_json);
    assert.equal(snapshot.items[0].config.videoId,'abcdefghijk');
    assert.equal((await call(`/api/content/${items[2].mediaId}`,'PUT',{name:'updated',kind:'poster',config:{title:'Novo'}})).status,200);
    assert.equal((await call('/api/playlists')).body[0].dirty,true);
    assert.equal(JSON.parse(app.db.prepare('SELECT snapshot_json FROM publications').get().snapshot_json).items[2].config.title,'Olá');
    assert.equal((await call(`/api/media/${items[2].mediaId}`,'DELETE')).status,409);
    const point = await call('/api/points','POST',{name:'Tela preços',playlistId:playlist.body.id});
    assert.equal(point.status,201);
    const draftBefore = (await call('/api/playlists')).body[0];
    const reordered = await call(`/api/playlists/${playlist.body.id}`,'PUT',{name:'Nome só no rascunho',revision:draftBefore.revision,items:[...draftBefore.items].reverse()});
    assert.equal(reordered.status,200);
    const updated = await call(`/api/content/${items[4].mediaId}`,'PUT',{name:'Preço online',kind:'price_table',config:{title:'Tabela',rows:[{name:'Café',price:13.5,active:true,unit:'kg',code:'001'},{name:'Pausado',price:2,active:false}]}});
    assert.equal(updated.status,200);
    assert.equal(updated.body.config.rows[1].active,false);
    const online = await call(`/api/content/${items[4].mediaId}/publish`,'POST',{});
    assert.equal(online.status,200);
    assert.equal(online.body.playlistsUpdated,1);
    const current=app.db.prepare('SELECT snapshot_json FROM publications pub JOIN points p ON p.publication_id = pub.id WHERE p.id = ?').get(point.body.id);
    assert.equal(JSON.parse(current.snapshot_json).items[4].config.rows[0].price,13.5);
    assert.equal(JSON.parse(current.snapshot_json).playlistName,'Mix');
    assert.equal(JSON.parse(current.snapshot_json).items[0].mediaId,items[0].mediaId);
    assert.equal((await call('/api/playlists')).body[0].dirty,true);
  } finally { await new Promise(resolve=>app.server.close(resolve)); await app.close(); await rm(directory,{recursive:true,force:true}); }
});
