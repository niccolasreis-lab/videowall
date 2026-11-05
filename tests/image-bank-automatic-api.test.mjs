import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {join,dirname,resolve,basename} from 'node:path';
import {tmpdir} from 'node:os';
import {createApplication} from '../src/app.mjs';

test('API automática exige login e salva fotos após cadastro e importação confirmada, sem alterar a peça', {timeout:10000},async()=>{
  const directory=await mkdtemp(join(tmpdir(),'image-auto-api-')),queries=[];
  const json=value=>new Response(JSON.stringify(value),{headers:{'Content-Type':'application/json'}});
  const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a8WQAAAAASUVORK5CYII=','base64');
  const fetcher=async url=>{
    if(url.endsWith('/Usuarios/Login'))return json({Id:12,Login:'test-account',Token:'test-token',ClienteId:7});
    if(url.includes('/ProdutoImagens/Search')){const term=new URL(url).searchParams.get('nome');queries.push(term);return json([{name:term,url:'https://bucket.musardos.com/produto/'+(term==='Presunto'?'presunto':'tomate')+'.png'}]);}
    return new Response(png);
  };
  const app=createApplication({dataDir:directory,imageBankFetch:fetcher});let cookie;
  await new Promise(done=>app.server.listen(0,'127.0.0.1',done));const origin='http://127.0.0.1:'+app.server.address().port;
  const call=async(path,method='GET',body,session=cookie)=>{
    const response=await fetch(origin+path,{method,headers:{...(session?{Cookie:session}:{}),...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});
    return {status:response.status,body:await response.json(),cookie:response.headers.get('set-cookie')?.split(';')[0]};
  };
  const until=async check=>{const deadline=Date.now()+4000;while(!check()){if(Date.now()>deadline)throw new Error('A automação não concluiu o download.');await new Promise(done=>setTimeout(done,20));}};
  try{
    assert.equal((await call('/api/image-bank/automatic','POST',{enabled:true},null)).status,401);
    cookie=(await call('/api/auth/setup','POST',{username:'admin',password:'test-password-123',workspace:'Test'})).cookie;
    assert.equal((await call('/api/image-bank/automatic','POST',{enabled:'yes'})).status,400);
    assert.equal((await call('/api/image-bank/automatic','POST',{enabled:true})).body.automatic.state,'waiting-connection');
    assert.equal((await call('/api/image-bank/connect','POST',{login:'test-account',password:'not-persisted'})).status,200);
    const content=await call('/api/content','POST',{name:'Frios',kind:'price_table',config:{title:'Frios',tableTheme:'deli',rows:[{name:'Presunto',price:12,unit:'100G',image:{source:'builtin',id:'roast-beef'},featured:true}]}});
    assert.equal(content.status,201);const saved=app.db.prepare('SELECT config_json FROM virtual_content WHERE id=?').get(content.body.id).config_json;
    await until(()=>app.imageBank.status('').counts.ready===1);await app.imageBank.wait();assert.deepEqual(queries,['Presunto']);
    const staged=await call('/api/catalog/imports','POST',{filename:'itensmgv.txt',text:'010000001000200000'+'TOMATE'.padEnd(50)+'0'.repeat(208)});
    assert.equal(staged.status,201);await app.imageBank.checkAutomatic();assert.deepEqual(queries,['Presunto']);
    assert.equal((await call('/api/catalog/imports/'+staged.body.id+'/apply','POST',{})).status,200);
    await until(()=>app.imageBank.status('').counts.ready===2);await app.imageBank.wait();assert.deepEqual(queries,['Presunto','TOMATE']);
    assert.equal(app.db.prepare('SELECT config_json FROM virtual_content WHERE id=?').get(content.body.id).config_json,saved);
    assert.equal(app.db.prepare('SELECT COUNT(*) AS n FROM media').get().n,0);assert.equal(app.db.prepare('SELECT COUNT(*) AS n FROM publications').get().n,0);
    assert.equal((await call('/api/image-bank/automatic','POST',{enabled:false})).body.automatic.enabled,false);
    await call('/api/image-bank/disconnect','POST',{});assert.equal((await call('/api/image-bank/items?q=presunto')).body.total,1);
    const queued=await call('/api/image-bank/product-list','POST',{filename:'ListaPreco.txt',text:'1001;Presunto;10;1,00;\n1002;Laranja;20;2,00;'});
    assert.equal(queued.status,202);assert.equal(queued.body.list.distinct,2);assert.equal(queued.body.automatic.state,'waiting-connection');
    assert.equal(app.db.prepare('SELECT COUNT(*) AS n FROM catalog_products').get().n,1);
    assert.equal((await call('/api/image-bank/automatic/retry','POST',{})).status,409);
  }finally{
    await new Promise(done=>app.server.close(done));await app.close();
    assert.equal(dirname(resolve(directory)),resolve(tmpdir()));assert.ok(basename(directory).startsWith('image-auto-api-'));
    await rm(directory,{recursive:true,force:true,maxRetries:3,retryDelay:50});
  }
});
