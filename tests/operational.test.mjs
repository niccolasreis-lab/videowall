import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {createApplication} from '../src/app.mjs';
import {openDatabase} from '../src/database.mjs';
import {createCatalog} from '../src/catalog.mjs';
import {parseCatalogCsv} from '../src/catalog-prices.mjs';
import {reportRange,createOperations} from '../src/operations.mjs';
import {matchesPointFilter} from '../public/monitor-utils.js';

async function fixture(fn){const dir=await mkdtemp(join(tmpdir(),'operations-')),now=Date.parse('2026-11-03T12:00:00-03:00'),app=createApplication({dataDir:dir,clock:()=>now});await new Promise(r=>app.server.listen(0,'127.0.0.1',r));const origin='http://127.0.0.1:'+app.server.address().port;let admin='',player='';
 const call=async(path,method='GET',body,role='admin')=>{const res=await fetch(origin+path,{method,headers:{'Content-Type':'application/json',Cookie:role==='admin'?admin:role==='player'?player:''},...(body?{body:JSON.stringify(body)}:{})});const result={status:res.status,body:await res.json()};const cookie=res.headers.get('set-cookie')?.split(';')[0];if(cookie){if(role==='player')player=cookie;else admin=cookie;}return result;};
 try{await call('/api/auth/setup','POST',{username:'admin',password:'operations-test-123',workspace:'Test'});await fn({app,call,dir,now});}finally{await new Promise(r=>app.server.close(r));await app.close();await rm(dir,{recursive:true,force:true});}}
const content=title=>({name:title,kind:'price_table',config:{title,tableTheme:'deli',rows:[{name:'Manual',price:10,unit:'100G',active:true}]}});

test('CSV e substituições preservam origem, unidades, preços alternativos e ativação manual',()=>fixture(async({app,call})=>{
 const csv='codigo;nome;preco_normal;preco_oferta;preco_clube;departamento;unidade\n123;Queijo original;38,90;30,50;29,90;01;100G';
 let batch=await call('/api/catalog/imports','POST',{filename:'precos.csv',text:csv});assert.equal(batch.status,201);assert.equal((await call('/api/catalog/products')).body.total,0);await call('/api/catalog/imports/'+batch.body.id+'/apply','POST',{});
 let p=(await call('/api/catalog/products')).body.items[0];assert.deepEqual(p.prices,{normal:38.9,offer:30.5,club:29.9});
 assert.equal((await call('/api/catalog/products/01%3A000123','PUT',{name:'Queijo comercial',prices:{offer:0,club:27}})).status,200);
 const piece=await call('/api/content','POST',{name:'Com clube',kind:'price_table',config:{title:'Com clube',priceType:'club',tableTheme:'deli',rows:[{name:'Anterior',code:'000123',department:'01',price:99,unit:'100G',active:true,featured:true,image:{source:'builtin',id:'roast-beef'}}]}});
 assert.equal(piece.status,201);assert.equal(piece.body.config.rows[0].price,27);assert.equal(piece.body.config.rows[0].name,'Queijo comercial');assert.equal(piece.body.config.rows[0].featured,true);
 batch=await call('/api/catalog/imports','POST',{filename:'precos.csv',text:csv.replace('38,90;30,50;29,90','40,00;;')});await call('/api/catalog/imports/'+batch.body.id+'/apply','POST',{});p=(await call('/api/catalog/products')).body.items[0];assert.equal(p.price,40);assert.equal(p.prices.offer,0);assert.equal(p.prices.club,27);assert.equal(p.name,'Queijo comercial');
 await call('/api/catalog/products/01%3A000123','PUT',{name:'',prices:{}});p=(await call('/api/catalog/products')).body.items[0];assert.equal(p.name,'Queijo original');assert.equal(p.prices.club,null);
 await call('/api/catalog/refresh-content','POST',{});const row=JSON.parse(app.db.prepare('SELECT config_json FROM virtual_content WHERE id=?').get(piece.body.id).config_json).rows[0];assert.equal(row.active,true);assert.equal(row.catalogUnavailable,true);assert.equal(row.price,0);assert.equal(row.unit,'100G');assert.equal(row.featured,true);assert.deepEqual(row.image,{source:'builtin',id:'roast-beef'});
 assert.equal((await call('/api/catalog/products/01%3A000123','PUT',{prices:{club:-1}})).status,400);
}));

test('subplaylists expandem repetições, congelam snapshots, propagam revisão e atualizam Tabela Online',()=>fixture(async({app,call})=>{
 const c=(await call('/api/content','POST',content('Produto'))).body;
 const child=(await call('/api/playlists','POST',{name:'Filha',items:[{mediaId:c.id,seconds:7}]})).body;
 const parent=(await call('/api/playlists','POST',{name:'Pai',items:[{playlistId:child.id},{playlistId:child.id}]})).body;
 const published=await call('/api/playlists/'+parent.id+'/publish','POST',{revision:parent.revision});assert.equal(published.status,200);
 let snap=JSON.parse(app.db.prepare('SELECT snapshot_json FROM publications WHERE playlist_id=?').get(parent.id).snapshot_json);assert.equal(snap.items.length,2);assert.notEqual(snap.items[0].id,snap.items[1].id);assert.equal(snap.revisions[child.id],child.revision);
 const oldSnapshot=JSON.stringify(snap);
 const cycle=await call('/api/playlists/'+child.id,'PUT',{name:child.name,revision:child.revision,items:[{playlistId:parent.id}]});assert.equal(cycle.status,400);
 const scheduled=await call('/api/playlists/'+child.id,'PUT',{name:child.name,revision:child.revision,items:child.items,schedule:{enabled:true,timeZone:'America/Sao_Paulo',windows:[{days:[1],start:'08:00',end:'18:00'}]}});assert.equal(scheduled.status,400);assert.match(scheduled.body.error,/agenda própria/);
 const updated=await call('/api/playlists/'+child.id,'PUT',{name:'Filha nova',revision:child.revision,items:[{mediaId:c.id,seconds:9}]});assert.equal(updated.status,200);
 const parentNow=(await call('/api/playlists')).body.find(p=>p.id===parent.id);assert.equal(parentNow.dirty,true);assert.ok(parentNow.revision>parent.revision);assert.equal(JSON.stringify(JSON.parse(app.db.prepare('SELECT snapshot_json FROM publications WHERE playlist_id=?').get(parent.id).snapshot_json)),oldSnapshot);
 await call('/api/content/'+c.id,'PUT',{...content('Produto alterado'),name:'Produto alterado'});await call('/api/content/'+c.id+'/publish','POST',{});
 snap=JSON.parse(app.db.prepare('SELECT snapshot_json FROM publications WHERE playlist_id=? ORDER BY version DESC').get(parent.id).snapshot_json);assert.equal(snap.items[0].name,'Produto alterado');assert.equal(snap.items[0].seconds,7);assert.equal((await call('/api/playlists')).body.find(p=>p.id===parent.id).dirty,true);
 assert.equal((await call('/api/playlists/'+child.id,'DELETE')).status,409);
 assert.equal((await call('/api/playlists/preview','POST',{items:[{playlistId:child.id}]})).body.items[0].seconds,9);
 const many=(await call('/api/playlists','POST',{name:'250 itens',items:Array.from({length:250},()=>({mediaId:c.id,seconds:1}))})).body;
 assert.equal((await call('/api/playlists','POST',{name:'500 itens',items:[{playlistId:many.id},{playlistId:many.id}]})).status,201);
 assert.equal((await call('/api/playlists','POST',{name:'501 itens',items:[{playlistId:many.id},{playlistId:many.id},{mediaId:c.id,seconds:1}]})).status,400);
}));

test('pontos sincronizam configurações e telemetria, comando coletivo não publica',()=>fixture(async({app,call})=>{
 const p=(await call('/api/points','POST',{name:'TV',settings:{orientation:'vertical-inverted',kiosk:true,progress:true}})).body;assert.equal(p.settings.orientation,'vertical-inverted');
 const device=(await call('/api/player/register','POST',{},'player')).body;await call('/api/points/'+p.id+'/pair','POST',{code:device.code});
 const sync=await call('/api/player/sync','POST',{telemetry:{version:'web-test',platform:'Windows',capabilities:{segments:true,memory:true}}},'player');assert.equal(sync.body.point.settings.kiosk,true);
 const detail=(await call('/api/points/'+p.id+'/monitor')).body;assert.equal(detail.point.telemetry.version,'web-test');assert.equal(detail.point.telemetry.capabilities.memory,false);
 const refresh=await call('/api/points/refresh','POST',{ids:[p.id,randomUUID()]});assert.deepEqual(refresh.body.results.map(r=>r.ok),[true,false]);assert.equal(app.db.prepare('SELECT COUNT(*) n FROM publications').get().n,0);
 assert.equal((await call('/api/usage','GET',null,'anonymous')).status,401);assert.equal((await call('/api/points/refresh','POST',{ids:[p.id]},'anonymous')).status,401);
 assert.equal((await call('/api/points/'+p.id,'PUT',{name:'TV',settings:{orientation:'diagonal'}})).status,400);
}));

test('segmentos offline são idempotentes, autenticados por publicação e divididos na meia-noite local',()=>fixture(async({app,call,now})=>{
 const c=(await call('/api/content','POST',content('Frios'))).body,pl=(await call('/api/playlists','POST',{name:'Programa',items:[{mediaId:c.id,seconds:10}]})).body;
 await call('/api/playlists/'+pl.id+'/publish','POST',{revision:pl.revision});const p=(await call('/api/points','POST',{name:'TV',playlistId:pl.id})).body,d=(await call('/api/player/register','POST',{},'player')).body;await call('/api/points/'+p.id+'/pair','POST',{code:d.code});const initial=(await call('/api/player/sync','POST',{},'player')).body;
 const end=Date.parse('2026-11-03T00:00:05-03:00'),segment={id:randomUUID(),pointId:p.id,mediaId:c.id,publicationId:initial.publication.id,type:'segment',createdAt:end,startedAt:end-10000,durationMs:10000,offline:true};
 const rejected={...segment,id:randomUUID(),durationMs:30000};const result=await call('/api/player/sync','POST',{events:[segment,segment,rejected]},'player');assert.equal(result.body.acceptedEventIds.length,2);assert.deepEqual(result.body.rejectedEventIds,[rejected.id]);assert.equal(app.db.prepare('SELECT COUNT(*) n FROM playback_segments').get().n,1);
 const report=(await call('/api/reports?from=2026-11-02&to=2026-11-03&pointId='+p.id)).body;assert.equal(report.totals.durationMs,10000);assert.deepEqual(report.byDay.map(d=>d.durationMs),[5000,5000]);assert.equal(report.totals.starts,0);
 assert.equal((await call('/api/reports?from=2026-11-04&to=2026-11-03')).status,400);assert.equal((await call('/api/reports?from=2026-99-99')).status,400);
 assert.equal((await call('/api/reports?from=2026-11-02&to=2026-11-03&mediaId='+randomUUID())).body.totals.durationMs,null);
 assert.equal(report.collectionStartedAt,now);
}));

test('migração aditiva conserva produtos e snapshots e nomes comerciais voltam à origem',async()=>{const dir=await mkdtemp(join(tmpdir(),'migration-'));let db=openDatabase(dir);let cat=createCatalog(db);const batch=cat.stage('codigo;nome;preco_normal\n1;Original;10','precos.csv');cat.apply(batch.id);cat.edit('00:000001',{name:'Comercial',prices:{club:9}});cat.close();db.exec('DROP TABLE playback_segments;DROP TABLE operation_events;DROP TABLE playlist_dependencies');db.close();db=openDatabase(dir);cat=createCatalog(db);assert.equal(cat.product('00:000001').name,'Comercial');assert.equal(cat.product('00:000001').prices.club,9);cat.close();db.close();await rm(dir,{recursive:true,force:true});});

test('filtros usam união, não classificam nunca conectado como offline antigo e validam CSV',()=>{const now=Date.now(),offline={paired:true,online:false,lastSeen:now-5*86400000,publishedVersion:1};assert.equal(matchesPointFilter(offline,'offline5',now),true);assert.equal(matchesPointFilter(offline,'offline30',now),false);assert.equal(matchesPointFilter({...offline,lastSeen:null},'offline5',now),false);assert.equal(matchesPointFilter(offline,['online','offline5'],now),true);assert.equal(matchesPointFilter(offline,[],now),true);assert.throws(()=>parseCatalogCsv('codigo;nome;preco_normal\n1;A;1\n1;B;2'));assert.throws(()=>parseCatalogCsv('codigo;nome;preco_normal\n1;A;-1'));const r=reportRange(new URLSearchParams({from:'2026-11-03',to:'2026-11-03'}),now);assert.equal(r.since,Date.parse('2026-11-03T03:00:00Z'));assert.equal(r.until-r.since,86400000);});

test('períodos diários seguem dias de 23 e 25 horas no horário de verão histórico',()=>{const day=d=>reportRange(new URLSearchParams({from:d,to:d}),Date.now());assert.equal((day('2018-11-04').until-day('2018-11-04').since)/3600000,23);assert.equal((day('2019-02-16').until-day('2019-02-16').since)/3600000,25);});
