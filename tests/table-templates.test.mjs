import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile,stat} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {tableTemplates,builtInImages,templateBackgrounds,tableExample,tablePages,eligibleTableRows,tableAssetUrls,referencedMediaIds} from '../public/table-templates.js';
import {validateContent} from '../src/content.mjs';
import {mediaUrls} from '../public/offline-policy.js';
import {OfflinePlayer} from '../public/offline-player.js';
import {createApplication} from '../src/app.mjs';

test('formato produto = valor / unidade é opcional e preserva preços, unidades e fotos',()=>{
  for(const theme of ['custom','market',...tableTemplates.map(t=>t.id)]){
    const example=tableExample('deli');example.config.tableTheme=theme;
    assert.equal(validateContent(example).config.priceFormat,'standard');
    const formatted=validateContent({...example,config:{...example.config,priceFormat:'inline'}});
    assert.equal(formatted.config.priceFormat,'inline');
    assert.deepEqual(formatted.config.rows.map(({name,price,unit,active,featured,image})=>({name,price,unit,active,featured,image})),validateContent(example).config.rows.map(({name,price,unit,active,featured,image})=>({name,price,unit,active,featured,image})));
    assert.equal(formatted.config.rows[15].unit,'100G');assert.equal(formatted.config.rows[0].unit,'');
    assert.throws(()=>validateContent({...example,config:{...example.config,priceFormat:'unknown'}}),/Formato/);
  }
});

test('seis templates paginam 5, 6 ou 18 produtos, preservando ordem e estilos anteriores',()=>{
  for(const template of tableTemplates){
    for(const count of [1,5,6,18,19,50]){
      const rows=Array.from({length:count},(_,index)=>({name:`Produto ${index}`,price:index+1,active:true}));
      const pages=tablePages({tableTheme:template.id,rows});assert.equal(pages.length,Math.ceil(count/template.size));assert.deepEqual(pages.flat(),rows);
    }
    const example=tableExample(template.id);const validated=validateContent(example);assert.equal(validated.config.tableTheme,template.id);
  }
  const example=tableExample('deli');assert.equal(example.config.rows.length,18);assert.equal(eligibleTableRows(example.config).length,15);
  const featured=eligibleTableRows(example.config).find(row=>row.featured);assert.equal(featured.name,'ROSBIFE CERATTI');assert.equal(featured.price,37.5);assert.equal(featured.unit,'100G');
  const rows=[{name:'Zero',price:0},{name:'Pausado',price:5,active:false},{name:'Ausente',price:6,catalogUnavailable:true}];
  assert.deepEqual(eligibleTableRows({tableTheme:'deli',rows}),[]);
  assert.deepEqual(eligibleTableRows({tableTheme:'market',rows}),[rows[0],rows[2]]);
  assert.equal(validateContent({name:'Antiga',kind:'price_table',config:{title:'Preços',rows:[rows[0]]}}).config.tableTheme,'custom');
});

test('valida imagens e destaque único sem aceitar URLs ou identificadores externos',()=>{
  const example=tableExample('produce-grid');
  for(const ref of [{source:'builtin',id:'../../etc/passwd'},{source:'url',id:'https://example.com/a.png'},{source:'media',id:'invalid'}]){
    assert.throws(()=>validateContent({...example,config:{...example.config,sectorImage:ref}}),/imagem/);
  }
  assert.throws(()=>validateContent({...example,config:{...example.config,rows:example.config.rows.map(row=>({...row,featured:true}))}}),/somente um/);
  assert.throws(()=>validateContent({...example,config:{...example.config,tableTheme:'unknown'}}),/Tema/);
  assert.equal(templateBackgrounds.length,110);assert.equal(new Set(templateBackgrounds.map(image=>image.url)).size,110);
  for(const background of templateBackgrounds){assert.ok(background.width<=1920);assert.ok(background.height<=1080);}
});

test('todas as fotos e fundos do manifesto existem e são arquivos locais otimizados',async()=>{
  for(const image of builtInImages){const info=await stat(new URL('../public'+image.url,import.meta.url));assert.ok(info.size>100);assert.ok(info.size<2*1024*1024);}
});

test('download de foto ou fundo incompleto conserva a programação anterior',async()=>{
  const image={source:'media',id:'11111111-1111-4111-8111-111111111111'};
  const item=tableExample('produce-grid');item.config.rows[0].image=image;item.config.backgroundImage={source:'builtin',id:templateBackgrounds[0].id};
  const data={point:{id:'p'},publication:{id:'new',version:2,items:[item]},serverTime:Date.now()};
  assert.ok(mediaUrls(data).includes('/media/'+image.id));assert.ok(mediaUrls(data).includes(templateBackgrounds[0].url));assert.deepEqual(referencedMediaIds(item),[image.id]);
  assert.equal(mediaUrls(data).length,new Set(mediaUrls(data)).size);
  const entries=new Map();const caches={open:async name=>{if(!entries.has(name))entries.set(name,new Map());const cache=entries.get(name);return {match:async key=>cache.get(key)?.clone(),put:async(key,response)=>cache.set(key,response.clone())};},keys:async()=>[...entries.keys()],delete:async name=>entries.delete(name)};
  const previous={cacheName:'videowall-media-v1-previous'};let saved=false,calls=0;
  const player=new OfflinePlayer({cacheStorage:caches,storage:{putState:async()=>{saved=true;}},fetcher:async()=>{if(++calls===2)return new Response('missing',{status:404});return new Response('file',{headers:{'Content-Length':'4'}});}});
  player.available=true;player.snapshot=previous;
  await assert.rejects(player.prepare(data,new AbortController().signal),/baixar/);assert.equal(player.snapshot,previous);assert.equal(saved,false);assert.equal(entries.has('videowall-media-v1-p-new'),false);
});

test('publicação inclui imagens, exige vínculo e protege fotos de rascunhos e publicações',async()=>{
  const directory=await mkdtemp(join(tmpdir(),'table-api-')),app=createApplication({dataDir:directory});await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));
  const origin='http://127.0.0.1:'+app.server.address().port;let admin;
  const call=async(path,method='GET',body,cookie=admin)=>{const response=await fetch(origin+path,{method,headers:{...(cookie?{Cookie:cookie}:{}),...(body?{'Content-Type':Buffer.isBuffer(body)?'image/jpeg':'application/json'}:{})},...(body?{body:Buffer.isBuffer(body)?body:JSON.stringify(body)}:{})});return {status:response.status,body:response.headers.get('content-type')?.includes('json')?await response.json():await response.arrayBuffer(),cookie:response.headers.get('set-cookie')?.split(';')[0]};};
  try{
    admin=(await call('/api/auth/setup','POST',{username:'admin',password:'long-password-123',workspace:'Test'},null)).cookie;
    const bytes=await readFile(new URL('../public/template-assets/mango-v1.jpg',import.meta.url));
    const photo=(await call('/api/media?name=Foto&filename=fruit.jpg','POST',bytes)).body;
    const unrelated=(await call('/api/media?name=Outra&filename=other.jpg','POST',bytes)).body;
    const item=tableExample('deli');item.config.priceFormat='inline';item.config.sectorImage={source:'media',id:photo.id};item.config.backgroundImage={source:'builtin',id:templateBackgrounds[0].id};
    const created=await call('/api/content','POST',item);assert.equal(created.status,201);assert.deepEqual(created.body.assetMediaIds,[photo.id]);
    const missing=await call('/api/content','POST',{...item,config:{...item.config,sectorImage:{source:'media',id:'11111111-1111-4111-8111-111111111111'}}});assert.equal(missing.status,404);
    assert.equal((await call('/api/media/'+photo.id,'DELETE')).status,409);
    const playlist=(await call('/api/playlists','POST',{name:'TV',items:[{mediaId:created.body.id,seconds:15}]})).body;
    await call('/api/playlists/'+playlist.id+'/publish','POST',{revision:playlist.revision});
    const point=(await call('/api/points','POST',{name:'Tela',playlistId:playlist.id})).body;
    const device=await call('/api/player/register','POST',{},null);await call('/api/points/'+point.id+'/pair','POST',{code:device.body.code});
    const sync=(await call('/api/player/sync','POST',{},device.cookie)).body;
    assert.ok(tableAssetUrls(sync.publication.items[0]).includes(photo.url));
    assert.equal((await call(photo.url,'GET',null,device.cookie)).status,200);assert.equal((await call(unrelated.url,'GET',null,device.cookie)).status,401);assert.equal((await call(photo.url,'GET',null,null)).status,401);
    const original=sync.publication.items[0].config;
    assert.equal(original.priceFormat,'inline');
    const changed={...item,config:{...item.config,priceFormat:'standard',tableTheme:'produce-grid',sectorImage:null}};
    assert.equal((await call('/api/content/'+created.body.id,'PUT',changed)).status,200);
    assert.deepEqual((await call('/api/player/sync','POST',{},device.cookie)).body.publication.items[0].config,original);
    assert.equal((await call('/api/media/'+photo.id,'DELETE')).status,409,'foto removida do rascunho ainda está publicada');
    await call('/api/content/'+created.body.id+'/publish','POST',{});
    assert.equal((await call('/api/player/sync','POST',{},device.cookie)).body.publication.items[0].config.priceFormat,'standard');
    assert.equal((await call('/api/media/'+photo.id,'DELETE')).status,200);
    for(const url of ['/table-templates.js','/table-templates.css',templateBackgrounds[0].url])assert.equal((await call(url,'GET',null,null)).status,200);
    assert.equal((await call('/template-assets/not-in-manifest.jpg','GET',null,null)).status,404);
  }finally{await new Promise(resolve=>app.server.close(resolve));await app.close();await rm(directory,{recursive:true,force:true});}
});

test('catálogo reativa disponibilidade dos novos modelos sem apagar ativação manual, fotos ou destaque',async()=>{
  const directory=await mkdtemp(join(tmpdir(),'table-catalog-')),app=createApplication({dataDir:directory});await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));
  const origin='http://127.0.0.1:'+app.server.address().port;let cookie;
  const call=async(path,body)=>{const response=await fetch(origin+path,{method:'POST',headers:{'Content-Type':'application/json',...(cookie?{Cookie:cookie}:{})},body:JSON.stringify(body)});return {status:response.status,body:await response.json(),cookie:response.headers.get('set-cookie')?.split(';')[0]};};
  try{
    cookie=(await call('/api/auth/setup',{username:'admin',password:'long-password-123',workspace:'Test'})).cookie;
    app.db.prepare('INSERT INTO catalog_products VALUES (?,?,?,?,?,?,?,?)').run('01:000001','01','000001','Queijo',20,'KG',1,Date.now());
    const item=tableExample('deli');item.config.rows=[{name:'Queijo',price:20,department:'01',code:'000001',unit:'KG',active:true,featured:true,image:{source:'builtin',id:'roast-beef'}},{name:'Pausado',price:20,department:'01',code:'000001',active:false}];
    const created=(await call('/api/content',item)).body;
    const load=()=>JSON.parse(app.db.prepare('SELECT config_json FROM virtual_content WHERE id=?').get(created.id).config_json);
    app.db.prepare('UPDATE catalog_products SET price=0').run();await call('/api/catalog/refresh-content',{});
    assert.equal(load().rows[0].active,true);assert.equal(eligibleTableRows(load()).length,0);
    app.db.prepare('UPDATE catalog_products SET price=25').run();await call('/api/catalog/refresh-content',{});
    assert.equal(eligibleTableRows(load()).length,1);assert.equal(load().rows[1].active,false);assert.equal(load().rows[0].featured,true);assert.equal(load().rows[0].image.id,'roast-beef');assert.equal(load().rows[0].price,25);
    app.db.prepare('UPDATE catalog_products SET available=0').run();await call('/api/catalog/refresh-content',{});assert.equal(eligibleTableRows(load()).length,0);
  }finally{await new Promise(resolve=>app.server.close(resolve));await app.close();await rm(directory,{recursive:true,force:true});}
});
