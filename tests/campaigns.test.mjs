import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createApplication} from '../src/app.mjs';
import {canPlay,mediaUrls,nextPlaybackBoundary} from '../public/offline-policy.js';

const initial = Date.parse('2026-11-05T15:00:00Z');
const csv = (normal,offer=8.5) => 'codigo;departamento;nome;preco_normal;preco_oferta;unidade\n1;01;Manga;'+normal+';'+offer+';kg\n2;02;Alcatra;42;39;kg';

async function fixture(t) {
  const dataDir = await mkdtemp(join(tmpdir(),'campaign-test-'));
  let now = initial;
  const app = createApplication({dataDir,clock:()=>now});
  await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));
  const origin='http://127.0.0.1:'+app.server.address().port;
  t.after(async()=>{
    await new Promise(resolve=>app.server.close(resolve));await app.close();await rm(dataDir,{recursive:true,force:true,maxRetries:5,retryDelay:100});
  });
  async function request(path,{method='GET',body,cookie,token,mime,raw,status=200}={}) {
    const response=await fetch(origin+path,{method,headers:{...(cookie?{Cookie:cookie}:{}),...(token?{Authorization:'Bearer '+token}:{}),
      ...(body!==undefined?{'Content-Type':mime||'application/json'}:{})},body:body===undefined?undefined:mime?body:JSON.stringify(body)});
    const value=raw ? await response.arrayBuffer() : await response.json();
    assert.equal(response.status,status,path+': '+JSON.stringify(value));
    return {value,cookie:response.headers.get('set-cookie')?.split(';')[0]};
  }
  const admin=(await request('/api/auth/setup',{method:'POST',body:{username:'admin',password:'long-test-password',workspace:'Test'}})).cookie;
  const call=async(path,method='GET',body,status=200)=>(await request(path,{method,body,status,cookie:admin})).value;
  const load=async(text=csv(10))=>{
    const staged=await call('/api/catalog/imports','POST',{text,filename:'erp.csv'},201);
    return call('/api/catalog/imports/'+staged.id+'/apply','POST',{});
  };
  const store= name=>call('/api/campaigns/stores','POST',{name},201);
  async function point(name,store,sector='produce',playlistId) {
    const target=await call('/api/points','POST',{name,playlistId},201);
    await call('/api/campaigns/points/'+target.id,'PUT',{storeId:store.id,sector});
    const player=await request('/api/player/register',{method:'POST',body:{}});
    await call('/api/points/'+target.id+'/pair','POST',{code:player.value.code});
    return {target,cookie:player.cookie,sync:async(body={})=>(await request('/api/player/sync',{cookie:player.cookie,method:'POST',body})).value};
  }
  return {app,call,request,admin,load,store,point,advance:ms=>{now+=ms;return now;},clock:()=>now};
}

function campaignInput(clock,points,extra={}) {
  return {requestId:randomUUID(),name:'Semana de ofertas',validFrom:new Date(clock).toISOString(),
    validUntil:new Date(clock+3600000).toISOString(),pieces:[{sector:'produce',products:['01:000001']}],
    pointIds:points.map(point=>point.target.id),...extra};
}

test('campanha agendada preserva playlist, atende filial/setor, usa marca offline e atribui eventos reais por TV',async t=>{
  const {call,request,load,store,point,admin,clock,advance}=await fixture(t);
  await load();
  const a=await store('Loja A'),b=await store('Loja B');
  const base=await call('/api/content','POST',{kind:'poster',name:'Institucional',config:{title:'Bem-vindos'}},201);
  const schedule={enabled:true,timeZone:'UTC',windows:[{days:[4],start:'16:00',end:'17:00'}]};
  const playlist=await call('/api/playlists','POST',{name:'Rotina',items:[{mediaId:base.id,seconds:5}],schedule},201);
  await call('/api/playlists/'+playlist.id+'/publish','POST',{revision:playlist.revision});
  const tv=await point('TV Hortifruti',a,'produce',playlist.id), other=await point('TV Açougue',b,'butcher');
  const previous=(await tv.sync()).publication;
  const jpeg=await readFile(new URL('../public/template-assets/mango-v1.jpg',import.meta.url));
  const photo=(await request('/api/media?name=Logo&filename=logo.jpg',{cookie:admin,method:'POST',mime:'image/jpeg',body:jpeg,status:201})).value;
  const ref={source:'media',id:photo.id};
  const brand=await call('/api/poster-themes','POST',{name:'Marca A',appearance:{logoImage:ref,backgroundImage:ref,font:'serif'}},201);
  const start=clock()+30000;
  const input=campaignInput(start,[tv,other],{pieces:[
    {sector:'produce',products:['01:000001'],themeId:brand.id},
    {sector:'butcher',products:['02:000002']},
  ]});
  const result=await call('/api/campaigns','POST',input,201);
  assert.equal((await call('/api/campaigns','POST',input,201)).id,result.id);
  const [delivery,otherDelivery]=await Promise.all([tv.sync(),other.sync()]);
  const [item,baseline]=delivery.publication.items;
  assert.equal(item.config.rows[0].name,'Manga');assert.equal(otherDelivery.publication.items[0].config.rows[0].name,'Alcatra');
  assert.equal(item.config.font,'serif');assert.deepEqual(item.assetMediaIds,[photo.id]);assert.deepEqual(mediaUrls(delivery),['/media/'+photo.id]);
  await call('/api/poster-themes/'+brand.id,'PUT',{name:'Marca A atualizada',appearance:{font:'mono'}});
  assert.equal((await tv.sync()).publication.id,delivery.publication.id);
  assert.deepEqual(baseline.playbackSchedule,schedule);
  const context={now:clock(),connected:false,confirmedAt:clock(),schedule:delivery.publication.schedule};
  assert.equal(canPlay(item,context),false);assert.equal(canPlay(baseline,context),false);
  assert.equal(nextPlaybackBoundary(delivery.publication.items,context),start);
  assert.equal(canPlay(item,{...context,now:advance(30000)}),true);
  assert.equal(canPlay(item,{...context,now:Date.parse(result.validUntil)}),false);
  assert.equal(canPlay(baseline,{...context,now:initial+3600000}),true);
  await request('/media/'+photo.id,{cookie:tv.cookie,raw:true});
  await request('/media/'+photo.id,{cookie:other.cookie,status:401});
  await call('/api/media/'+photo.id,'DELETE',undefined,409);
  assert.deepEqual((await call('/api/playlists')).map(row=>row.id),[playlist.id]);
  const event={id:randomUUID(),pointId:tv.target.id,publicationId:delivery.publication.id,mediaId:item.mediaId,createdAt:clock(),type:'started',offline:true};
  const update={events:[event,{...event,id:randomUUID(),type:'ended'},{...event,id:randomUUID(),type:'error'}],activePublicationId:delivery.publication.id};
  assert.equal((await tv.sync(update)).acceptedEventIds.length,3);
  await tv.sync(update);
  const report=await call('/api/campaigns/'+result.id+'/report');
  assert.deepEqual(report.map(row=>[row.storeName,row.started,row.ended,row.errors]),[['Loja A',1,1,1],['Loja B',0,0,0]]);
  assert.equal((await call('/api/campaigns/'+result.id+'/report?storeId='+b.id)).length,1);
  assert.equal((await call('/api/campaigns/'+result.id+'/report?from=errado','GET',undefined,400)).error,'Período de relatório inválido.');
  await call('/api/campaigns/'+result.id,'DELETE');
  assert.equal((await tv.sync()).publication.id,previous.id);
  assert.equal((await other.sync()).publication,null);
  assert.equal((await call('/api/campaigns/'+result.id+'/report'))[0].started,1);
});

test('portal isola filiais e alterações locais; ERP revisa divergências e republica preços com reenvio seguro',async t=>{
  const {call,request,load,store,point,clock}=await fixture(t);
  await load();
  const a=await store('Filial A'),b=await store('Filial B'),c=await store('Filial C');
  const tv=await point('A',a),tvB=await point('B',b);
  const input=campaignInput(clock(),[tv,tvB],{priceType:'offer'});
  const launched=await call('/api/campaigns','POST',input,201);
  const keyA=(await call('/api/campaigns/stores/'+a.id+'/access','PUT',{mode:'edit'})).token;
  const keyB=(await call('/api/campaigns/stores/'+b.id+'/access','PUT',{mode:'view'})).token;
  const keyC=(await call('/api/campaigns/stores/'+c.id+'/access','PUT',{mode:'edit'})).token;
  const local='/api/filial/campanhas/'+launched.id;
  const settings={validFrom:input.validFrom,validUntil:new Date(clock()+1800000).toISOString(),prices:{'01:000001':7.25}};
  assert.deepEqual((await request('/api/filial',{token:keyA})).value.campaigns[0].targets.map(row=>row.name),['A']);
  await request('/api/campaigns',{token:keyA,status:401});
  await request(local,{token:keyC,method:'PUT',body:settings,status:404});
  await request(local,{token:keyB,method:'PUT',body:settings,status:403});
  await request(local,{token:keyA,method:'PUT',body:{...settings,validUntil:new Date(clock()+7200000).toISOString()},status:400});
  await request(local,{token:keyA,method:'PUT',body:settings});
  const price=async point=>(await point.sync()).publication.items[0].config.rows[0].price;
  assert.equal(await price(tv),7.25);assert.equal(await price(tvB),8.5);
  const keyErp=(await call('/api/erp','PUT',{mode:'review'})).token;
  const receive=async(text,status=201,token=keyErp)=>(await request('/api/erp/imports',{method:'POST',token,status,body:{text,filename:'snapshot.csv'}})).value;
  await receive(csv(10,9.5),401,'abc');
  const pending=await receive(csv(10,9.5));
  assert.equal(pending.import.status,'pending');
  assert.deepEqual(pending.import.changes[0].beforePrices,{normal:10,offer:8.5,club:null});
  assert.deepEqual(pending.import.changes[0].afterPrices,{normal:10,offer:9.5,club:null});
  assert.equal(await price(tvB),8.5);
  await call('/api/catalog/imports/'+pending.import.id+'/apply','POST',{});
  assert.equal(await price(tvB),8.5);
  assert.equal((await call('/api/campaigns/refresh-prices','POST',{})).updated,1);
  assert.equal(await price(tvB),9.5);
  await call('/api/erp','PUT',{mode:'automatic'});
  const automatic=await receive(csv(10,8.5));
  assert.equal(automatic.applied,true);
  assert.equal(await price(tvB),8.5);assert.equal(await price(tv),7.25);
  const retry=await receive(csv(10,8.5));
  assert.equal(retry.applied,false);assert.equal(retry.import.id,automatic.import.id);
  assert.equal((await call('/api/erp')).lastImport.id,automatic.import.id);
  await call('/api/campaigns/points/'+tv.target.id,'PUT',{storeId:c.id,sector:'produce'});
  assert.deepEqual((await request('/api/filial',{token:keyA})).value.campaigns,[]);
  assert.equal((await tv.sync()).publication,null);
  await call('/api/campaigns/stores/'+a.id+'/access','PUT',{mode:'revoke'});
  await request('/api/filial',{token:keyA,status:401});
});

test('alertas registram atraso, falhas recorrentes, desconexão, recuperação e reconhecimento',async t=>{
  const {call,load,store,point,clock,advance}=await fixture(t);
  await load();
  const a=await store('Loja'),tv=await point('TV',a);
  await call('/api/campaigns','POST',campaignInput(clock(),[tv]),201);
  const delivery=await tv.sync({activePublicationId:null});
  const alerts=()=>call('/api/campaign-alerts');
  assert.deepEqual(await alerts(),[]);
  advance(61000);await tv.sync({activePublicationId:null});
  let rows=await alerts();
  const delayed=rows.find(row=>row.kind==='outdated');
  assert.ok(delayed);assert.equal(delayed.resolvedAt,null);
  await call('/api/campaign-alerts/'+delayed.id+'/ack','PUT');
  assert.equal((await call('/api/campaign-alerts/count')).count,0);
  const event=(type)=>({id:randomUUID(),type,pointId:tv.target.id,publicationId:delivery.publication.id,
    mediaId:delivery.publication.items[0].mediaId,createdAt:clock()});
  await tv.sync({activePublicationId:delivery.publication.id,events:[event('error'),event('error'),event('error')]});
  rows=await alerts();
  assert.equal(rows.filter(row=>row.kind==='outdated').length,1);
  assert.equal(rows.find(row=>row.kind==='outdated').resolvedAt,clock());
  assert.equal(rows.find(row=>row.kind==='playback').resolvedAt,null);
  advance(26000);rows=await alerts();assert.equal(rows.find(row=>row.kind==='offline').resolvedAt,null);
  await tv.sync({activePublicationId:delivery.publication.id,events:[event('ended')]});
  rows=await alerts();
  assert.ok(rows.every(row=>row.resolvedAt));
  assert.equal((await call('/api/campaign-alerts/count')).count,0);
});

test('prévia compara preço local e catálogo, bloqueia indisponíveis e revalida limite e dados ao publicar',async t=>{
  const {call,request,load,store,point,clock}=await fixture(t);
  await load();
  const a=await store('A'),b=await store('B');
  const first=await point('TV A',a),second=await point('TV B',b);
  const original=await call('/api/campaigns','POST',campaignInput(clock(),[first]),201);
  const token=(await call('/api/campaigns/stores/'+a.id+'/access','PUT',{mode:'edit'})).token;
  await request('/api/filial/campanhas/'+original.id,{token,method:'PUT',body:{
    validFrom:original.validFrom,validUntil:original.validUntil,prices:{'01:000001':8},
  }});
  const input=campaignInput(clock(),[first,second],{priceType:'offer'});
  await request('/api/campaigns/preview',{method:'POST',body:input,status:401});
  await call('/api/campaigns/price-limit','PUT',{limit:-1},400);
  await call('/api/campaigns/price-limit','PUT',{limit:10});
  const preview=await call('/api/campaigns/preview','POST',input);
  assert.deepEqual(preview.televisions.map(tv=>{
    const row=tv.products[0];return [tv.storeName,row.before,row.after,row.variation,row.source,row.exceedsLimit];
  }),[['A',8,8.5,6.25,'campaign',false],['B',10,8.5,-15,'catalog',true]]);
  assert.equal(preview.requiresReview,true);
  assert.equal((await call('/api/campaigns')).campaigns.length,1);
  await call('/api/campaigns','POST',input,409);
  await call('/api/campaigns','POST',{...input,impactVersion:preview.version},409);
  await load(csv(10,7.5));
  await call('/api/campaigns','POST',{...input,impactVersion:preview.version,acknowledgePriceLimit:true},409);
  const latest=await call('/api/campaigns/preview','POST',input);
  assert.notEqual(latest.version,preview.version);
  await call('/api/campaigns','POST',{...input,impactVersion:latest.version,acknowledgePriceLimit:true},201);
  const unavailable=await call('/api/campaigns/preview','POST',{...input,priceType:'club'});
  assert.deepEqual(unavailable.emptySectors,['produce']);
  assert.deepEqual(unavailable.unavailable.map(row=>row.key),['01:000001']);
  await call('/api/campaigns','POST',{...input,requestId:randomUUID(),priceType:'club'},400);
  await call('/api/campaigns/price-limit','PUT',{limit:null});
  assert.equal((await call('/api/campaigns')).priceLimit,null);
});
