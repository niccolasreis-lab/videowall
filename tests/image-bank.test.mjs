import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdtemp,mkdir,readFile,readdir,rm,rmdir,writeFile,unlink} from 'node:fs/promises';
import {basename,dirname,join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {openDatabase} from '../src/database.mjs';
import {createImageBank} from '../src/image-bank.mjs';
import {identifyImage} from '../src/media.mjs';
import {MUSARDOS_API,sourceId} from '../src/musardos-images.mjs';

const owner='test-admin-owner';
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a8WQAAAAASUVORK5CYII=','base64');
const nextPng=Buffer.concat([png,Buffer.from('image-version-two')]);
const photoUrl=name=>'https://bucket.musardos.com/produto/'+name+'.png';
const photo=(name,extra={})=>({url:photoUrl(name),name,...extra});
const json=(value,status=200)=>new Response(JSON.stringify(value),{status,headers:{'Content-Type':'application/json'}});
const photoResponse=(bytes=png,etag='test-image-v1')=>new Response(bytes,{headers:{'Content-Type':'image/png','Content-Length':String(bytes.length),ETag:etag}});
const loginUser=(extra={})=>({Id:12,Login:'operator-test',Token:'secret-token-not-to-persist',ClienteId:'7',ClienteKey:'client-key-not-to-persist',GrupoUsuarioId:2,...extra});
const params=value=>new URLSearchParams(value);
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};};

test('automação pesquisa somente nomes novos do catálogo e dos rascunhos, sem escolher fotos ou repetir histórico',async()=>{
  const queries=[];
  const fetcher=async url=>{
    if(url.endsWith('/Usuarios/Login'))return json(loginUser());
    if(url.startsWith(MUSARDOS_API)){const term=new URL(url).searchParams.get('nome');queries.push(term);return json([photo(term==='Tomate'?'tomate':term==='Presunto'?'presunto':'queijo')]);}
    return photoResponse();
  };
  await fixture(fetcher,async context=>{
    const {bank,db}=context;
    db.prepare('INSERT INTO catalog_products VALUES (?,?,?,?,?,?,?,?)').run('a','01','000001','QUEIJO SÁDIA',10,'KG',1,Date.now());
    db.prepare('INSERT INTO catalog_products VALUES (?,?,?,?,?,?,?,?)').run('b','02','000001','queijo sadia',10,'KG',1,Date.now());
    const config={title:'Frios',rows:[{name:'Presunto',price:20,unit:'100G',image:{source:'builtin',id:'roast-beef'},featured:true}]};
    db.prepare('INSERT INTO virtual_content VALUES (?,?,?,?,?)').run('content-auto','Tabela','price_table',JSON.stringify(config),Date.now());
    assert.equal(bank.status(owner).automatic.enabled,false);
    await bank.configureAutomatic(owner,{enabled:true});await bank.checkAutomatic();assert.equal(queries.length,0);
    assert.equal(bank.status(owner).automatic.state,'waiting-connection');
    await bank.connect(owner,'operator-test','test-password');
    bank.searchCopy(owner,{q:'queijo sadia'});await bank.wait();
    // Simulate an older workspace whose previous searches predate the ledger.
    db.prepare('DELETE FROM image_bank_queries').run();await context.restart();
    await context.bank.connect(owner,'operator-test','test-password');await context.bank.checkAutomatic();await context.bank.wait();
    assert.deepEqual(queries,['queijo sadia','Presunto']);assert.equal(context.bank.status(owner).run.automatic,true);
    assert.equal(context.bank.status(owner).automatic.pending,0);assert.equal(context.bank.status(owner).counts.ready,2);
    assert.equal(context.db.prepare('SELECT COUNT(*) AS n FROM media').get().n,0);
    assert.deepEqual(JSON.parse(context.db.prepare('SELECT config_json FROM virtual_content').get().config_json),config);
    await context.bank.checkAutomatic();assert.equal(queries.length,2);
    context.db.prepare('INSERT INTO catalog_products VALUES (?,?,?,?,?,?,?,?)').run('c','01','000002','Tomate',2,'KG',1,Date.now());
    await context.bank.checkAutomatic();await context.bank.wait();assert.deepEqual(queries,['queijo sadia','Presunto','Tomate']);
    const stored=JSON.stringify(context.db.prepare('SELECT * FROM image_bank_queries').all());
    assert.equal(stored.includes('secret-token-not-to-persist'),false);assert.equal(stored.includes('test-password'),false);
  },{automaticIntervalMs:0,automaticDelayMs:60000});
});

test('buscas vazias e falhas são lembradas sem repetição automática, permitindo retomar uma falha',async()=>{
  let failed=true;const queries=[];
  const fetcher=async url=>{
    if(url.endsWith('/Usuarios/Login'))return json(loginUser());
    if(!url.startsWith(MUSARDOS_API))return photoResponse();
    const term=new URL(url).searchParams.get('nome');queries.push(term);
    return term==='Sem foto'?json([]):failed?json({},500):json([photo('recovered')]);
  };
  await fixture(fetcher,async({bank,db})=>{
    for(const [index,name]of['Sem foto','Falha'].entries())db.prepare('INSERT INTO catalog_products VALUES (?,?,?,?,?,?,?,?)').run(String(index),'01',String(index),name,1,'KG',1,Date.now());
    await bank.connect(owner,'operator-test','test-password');await bank.configureAutomatic(owner,{enabled:true});
    await bank.checkAutomatic();await bank.wait();assert.equal(queries.length,2);assert.equal(bank.status(owner).automatic.failed,1);
    await bank.checkAutomatic();await bank.checkAutomatic();assert.equal(queries.length,2);
    failed=false;assert.equal(bank.retryAutomatic(owner).retryQueued,1);await bank.checkAutomatic();await bank.wait();assert.equal(queries.length,3);assert.equal(bank.status(owner).automatic.failed,0);
    assert.equal(bank.status(owner).counts.ready,1);
  },{automaticIntervalMs:0,automaticDelayMs:60000});
});

test('lista de fotos persiste sem importar preços e é processada em lotes de até 25 nomes novos',async()=>{
  const queries=[];
  await fixture(async url=>{
    if(url.endsWith('/Usuarios/Login'))return json(loginUser());
    if(!url.startsWith(MUSARDOS_API))return photoResponse();
    const name=new URL(url).searchParams.get('nome');queries.push(name);return json([photo(name)]);
  },async context=>{
    const text=Array.from({length:52},(_,index)=>`${1000+index};Produto${index};10;999,99;`).join('\n')+'\n9999;Produto0;50;1,00;';
    await assert.rejects(()=>context.bank.queueProductList(owner,{text:'1001;;1;2;'}),/Nome/);
    assert.equal(context.db.prepare('SELECT COUNT(*) AS n FROM image_bank_requested_terms').get().n,0);
    const queued=await context.bank.queueProductList(owner,{text,filename:'ListaPreco.txt'});
    assert.equal(queued.list.records,53);assert.equal(queued.list.distinct,52);assert.equal(queued.list.duplicates,1);
    assert.equal(queued.automatic.state,'waiting-connection');assert.equal(context.db.prepare('SELECT COUNT(*) AS n FROM catalog_products').get().n,0);
    await context.restart();await context.bank.connect(owner,'operator-test','test-password');
    await context.bank.checkAutomatic();await context.bank.wait();assert.equal(queries.length,25);assert.equal(context.bank.status(owner).automatic.pending,27);
    await context.bank.checkAutomatic();await context.bank.wait();assert.equal(queries.length,50);
    await context.bank.checkAutomatic();await context.bank.wait();assert.equal(queries.length,52);assert.equal(new Set(queries).size,52);
    const repeated=await context.bank.queueProductList(owner,{text,filename:'ListaPreco.txt'});
    assert.equal(repeated.list.added,0);assert.equal(repeated.list.alreadySearched,52);await context.bank.checkAutomatic();assert.equal(queries.length,52);
    assert.equal(context.db.prepare('SELECT COUNT(*) AS n FROM catalog_products').get().n,0);assert.equal(context.db.prepare('SELECT COUNT(*) AS n FROM media').get().n,0);
  },{automaticIntervalMs:0,automaticDelayMs:60000});
});

test('sessão expirada suspende automação e reconectar retoma a cópia sem guardar a senha',async()=>{
  let expired=true;
  await fixture(async url=>url.endsWith('/Usuarios/Login')?json(loginUser()):url.startsWith(MUSARDOS_API)?expired?json({},401):json([photo('connected-again')]):photoResponse(),async({bank,db})=>{
    db.prepare('INSERT INTO catalog_products VALUES (?,?,?,?,?,?,?,?)').run('a','01','1','Produto',1,'KG',1,Date.now());
    await bank.connect(owner,'operator-test','test-password');await bank.configureAutomatic(owner,{enabled:true});await bank.checkAutomatic();await bank.wait();
    assert.equal(bank.status(owner).automatic.enabled,true);assert.equal(bank.status(owner).automatic.state,'waiting-connection');assert.equal(bank.status(owner).run.status,'paused');
    expired=false;await bank.connect(owner,'operator-test','test-password');await bank.wait();
    assert.equal(bank.status(owner).counts.ready,1);assert.equal(bank.status(owner).automatic.state,'idle');
    assert.equal(JSON.stringify(db.prepare('SELECT * FROM settings').all()).includes('test-password'),false);
  },{automaticIntervalMs:0,automaticDelayMs:60000});
});

test('pausar a busca automática conserva arquivos e a preferência desligada após reinício', {timeout:5000},async()=>{
  let interrupted=true;
  const fetcher=async(url,options)=>{
    if(url.endsWith('/Usuarios/Login'))return json(loginUser());
    if(!url.startsWith(MUSARDOS_API))return photoResponse();
    if(interrupted)await new Promise((resolve,reject)=>options.signal.addEventListener('abort',()=>reject(options.signal.reason),{once:true}));
    return json([photo('after-resume')]);
  };
  await fixture(fetcher,async context=>{
    context.db.prepare('INSERT INTO catalog_products VALUES (?,?,?,?,?,?,?,?)').run('a','01','1','Produto',10,'KG',1,Date.now());
    await context.bank.connect(owner,'operator-test','test-password');await context.bank.configureAutomatic(owner,{enabled:true});await context.bank.checkAutomatic();
    await context.bank.pause({manual:true});assert.equal(context.bank.status(owner).automatic.enabled,false);assert.equal(context.bank.status(owner).run.status,'paused');
    await context.restart();assert.equal(context.bank.status(owner).automatic.enabled,false);assert.equal(context.bank.status(owner).connection.connected,false);
    interrupted=false;await context.bank.connect(owner,'operator-test','test-password');await context.bank.checkAutomatic();assert.equal(context.bank.status(owner).counts.ready,0);
    await context.bank.configureAutomatic(owner,{enabled:true});await context.bank.wait();assert.equal(context.bank.status(owner).counts.ready,1);
  },{automaticIntervalMs:0,automaticDelayMs:60000});
});

test('retoma downloads públicos sem nova sessão depois de concluir as consultas e reconhece AVIF com URL png',async()=>{
  const avif=Buffer.from('0000001c6674797061766966000000006d696631617669666d69616600000170','hex');
  assert.equal(identifyImage(Buffer.from('00000018667479706d7034320000000069736f6d6d703432','hex')),null);
  let available=false,queries=0;
  const fetcher=async url=>{
    if(url.endsWith('/Usuarios/Login'))return json(loginUser());
    if(url.startsWith(MUSARDOS_API)){queries++;return json([photo('avif-disguised')]);}
    return available?new Response(avif):new Response('<html>invalid source</html>');
  };
  await fixture(fetcher,async context=>{
    await context.bank.connect(owner,'operator-test','test-password');context.bank.searchCopy(owner,{q:'estepe'});await context.bank.wait();
    assert.equal(context.bank.status(owner).run.failed,1);assert.equal(context.bank.status(owner).run.scopes[0].status,'completed');
    await context.restart();available=true;context.bank.resume(owner);await context.bank.wait();
    assert.equal(queries,1);assert.equal(context.bank.status(owner).run.failed,0);
    const image=context.bank.items(params({})).items[0];assert.equal(image.mime,'image/avif');
    const media=await context.bank.select(image.id);assert.equal(media.mime,'image/avif');assert.ok(media.stored_name.endsWith('.avif'));
    assert.deepEqual(await readFile(join(context.directory,'uploads',media.stored_name)),avif);
  });
});

test('varredura consulta até três nomes em paralelo e não duplica downloads compartilhados',async()=>{
  let active=0,peak=0,downloads=0;const terms=[];
  const fetcher=async url=>{
    if(url.endsWith('/Usuarios/Login'))return json(loginUser());
    if(url.startsWith(MUSARDOS_API)){
      const term=new URL(url).searchParams.get('nome');terms.push(term);active++;peak=Math.max(peak,active);
      await new Promise(done=>setTimeout(done,20));active--;
      return json([photo('shared'),photo(term)]);
    }
    downloads++;await new Promise(done=>setTimeout(done,5));return photoResponse();
  };
  await fixture(fetcher,async({bank,db})=>{
    for(let i=0;i<7;i++)db.prepare('INSERT INTO catalog_products VALUES (?,?,?,?,?,?,?,?)').run('k'+i,'1',String(i),'item'+i,10,'KG',1,Date.now());
    await bank.connect(owner,'operator-test','test-password');bank.searchCopy(owner,{catalog:true});await bank.wait();
    assert.equal(peak,3);assert.equal(terms.length,7);assert.equal(new Set(terms).size,7);assert.equal(downloads,8);
    const result=bank.status(owner);assert.equal(result.run.scopes.filter(scope=>scope.status==='completed').length,7);
    assert.equal(result.run.downloaded,8);assert.equal(result.run.failed,0);assert.equal(result.run.enumerationComplete,false);
  });
});

test('pausa e reinício da varredura simultânea preservam consultas e fotos concluídas', {timeout:5000},async()=>{
  let restarted=false;const calls=[];
  const fetcher=async(url,options)=>{
    if(url.endsWith('/Usuarios/Login'))return json(loginUser());
    if(!url.startsWith(MUSARDOS_API))return photoResponse();
    const term=new URL(url).searchParams.get('nome');calls.push(term);
    if(!restarted&&term!=='item0')await new Promise((resolve,reject)=>{
      if(options.signal.aborted)return reject(options.signal.reason);
      options.signal.addEventListener('abort',()=>reject(options.signal.reason),{once:true});
    });
    return json([photo(term)]);
  };
  await fixture(fetcher,async context=>{
    for(let i=0;i<4;i++)context.db.prepare('INSERT INTO catalog_products VALUES (?,?,?,?,?,?,?,?)').run('key'+i,'1',String(i),'item'+i,10,'KG',1,Date.now());
    await context.bank.connect(owner,'operator-test','test-password');context.bank.searchCopy(owner,{catalog:true});
    while(!context.bank.status(owner).run.scopes.some(scope=>scope.status==='completed'))await new Promise(done=>setTimeout(done,5));
    await context.bank.pause();assert.equal(context.bank.status(owner).counts.ready,1);
    await context.restart();restarted=true;await context.bank.connect(owner,'operator-test','test-password');context.bank.resume(owner);await context.bank.wait();
    assert.equal(context.bank.status(owner).run.scopes.filter(scope=>scope.status==='completed').length,4);
    assert.equal(context.bank.status(owner).counts.ready,4);assert.equal(calls.filter(term=>term==='item0').length,1);
  });
});

test('busca autorizada copia variantes localmente sem consultar listagem restrita ou afirmar cobertura total',async()=>{
  const searches=[];
  const fetcher=async(url,options)=>{
    if(url.endsWith('/Usuarios/Login'))return json(loginUser());
    if(url.startsWith(MUSARDOS_API)){
      const parsed=new URL(url);assert.ok(parsed.pathname.endsWith('/Search'));
      assert.equal(parsed.searchParams.get('clienteId'),'7');assert.equal(options.headers.Authorization,'Bearer secret-token-not-to-persist');
      searches.push(parsed.searchParams.get('nome'));
      return json([photo('ricota-1',{name:'Ricota fresca'}),photo('ricota-2',{name:'Ricota fresca variante'})]);
    }
    return photoResponse();
  };
  await fixture(fetcher,async({bank,db})=>{
    await bank.connect(owner,'operator-test','test-password');
    assert.throws(()=>bank.searchCopy(owner,{q:''}),error=>error.status===400);
    bank.searchCopy(owner,{q:'ricota'});await bank.wait();
    assert.equal(bank.status(owner).counts.ready,2);assert.equal(bank.status(owner).run.enumerationComplete,false);
    assert.equal(bank.status(owner).run.scopes[0].status,'completed');assert.equal(bank.status(owner).run.downloaded,2);
    const media=await bank.select(sourceId(photoUrl('ricota-1')));await bank.disconnect(owner);
    assert.equal(bank.items(params({q:'ricota'})).total,2);assert.equal((await bank.select(sourceId(photoUrl('ricota-1')))).id,media.id);
    await bank.connect(owner,'operator-test','test-password');
    db.prepare('INSERT INTO catalog_products VALUES (?,?,?,?,?,?,?,?)').run('r','1','1','Ricota',10,'KG',1,Date.now());
    bank.searchCopy(owner,{catalog:true});await bank.wait();assert.deepEqual(searches,['ricota','Ricota']);
    assert.equal(bank.status(owner).counts.items,2);
  });
});

test('busca com sessão expirada exige reconectar e uma falha de busca não indica resultados copiados',async()=>{
  let expired=false;
  await fixture(async url=>url.endsWith('/Usuarios/Login')?json(loginUser()):json({},expired?401:403),async({bank})=>{
    await bank.connect(owner,'operator-test','test-password');bank.searchCopy(owner,{q:'ricota'});await bank.wait();
    assert.equal(bank.status(owner).run.scopes[0].status,'blocked');assert.match(bank.status(owner).run.error,/buscas falharam/);
    expired=true;bank.searchCopy(owner,{q:'ricota'});await bank.wait();
    assert.equal(bank.status(owner).connection.connected,false);assert.equal(bank.status(owner).run.status,'paused');
  });
});

async function fixture(fetcher,action,options={}){
  const directory=await mkdtemp(join(tmpdir(),'videowall-image-bank-'));
  let db=openDatabase(directory),bank=createImageBank({db,dataDir:directory,fetcher,...options});
  const context={directory,get db(){return db;},get bank(){return bank;},async restart(){await bank.close();db.close();db=openDatabase(directory);bank=createImageBank({db,dataDir:directory,fetcher,...options});}};
  try{await action(context);}finally{
    await bank.close();db.close();
    assert.equal(dirname(resolve(directory)),resolve(tmpdir()));assert.ok(basename(directory).startsWith('videowall-image-bank-'));
    await rm(directory,{recursive:true,force:true,maxRetries:3,retryDelay:50});
  }
}

test('cópia completa deduplica conteúdo e aliases; seleção concorrente é idempotente sem salvar credenciais',async()=>{
  const calls=[],shared=photo('queijo-a',{name:'Queijo branco Sádia',brand:'Sádia'}),other=photo('presunto-b',{name:'Presunto Auróra',brand:'Auróra'});
  const fetcher=async(url,options)=>{calls.push({url,options});if(url.endsWith('/Usuarios/Login'))return json(loginUser());if(url.startsWith(MUSARDOS_API)){const parsed=new URL(url);return parsed.pathname.endsWith('/SharedLibrary')?json({items:[shared,other],hasMore:false}):json({items:[{...shared,name:'Ricota artesanal'}],hasMore:false});}assert.equal(options.headers.Authorization,undefined,'credencial da API não deve acompanhar download público');return photoResponse();};
  await fixture(fetcher,async({bank,db,directory})=>{
    await bank.connect(owner,'operator-test','password-not-to-persist');bank.sync(owner);await bank.wait();
    const status=bank.status(owner);assert.equal(status.run.status,'completed');assert.equal(status.run.enumerationComplete,true);assert.equal(status.counts.items,2);assert.equal(status.counts.blobs,1);assert.equal(status.run.downloaded,2);assert.equal(status.run.duplicates,1);
    const alias=bank.items(params({q:'sadia queijo'}));assert.equal(alias.total,1);assert.ok(alias.items[0].aliases.includes('Queijo branco Sádia'));
    assert.equal(bank.items(params({q:'aurora presunto'})).total,1);
    const [a,b,c]=await Promise.all([bank.select(sourceId(shared.url)),bank.select(sourceId(other.url)),bank.select(sourceId(shared.url))]);assert.equal(a.id,b.id);assert.equal(b.id,c.id);assert.equal(db.prepare('SELECT COUNT(*) AS n FROM media').get().n,1);assert.equal(a.has_prices,0);
    assert.deepEqual(await readFile(join(directory,'uploads',a.stored_name)),png);assert.deepEqual(await readdir(join(directory,'image-bank','parts')),[]);
    const retained=JSON.stringify(['image_bank_items','image_bank_files','image_bank_runs','image_bank_run_items','settings'].map(table=>db.prepare('SELECT * FROM '+table).all()))+JSON.stringify(status);
    for(const secret of ['password-not-to-persist','secret-token-not-to-persist','client-key-not-to-persist'])assert.equal(retained.includes(secret),false);
    assert.equal(bank.status('another-owner').connection.connected,false);
  });
});

test('biblioteca bloqueada e paginação cíclica não produzem falsa conclusão de cópia completa',async()=>{
  let sharedCalls=0;
  const fetcher=async(url)=>{
    if(url.endsWith('/Usuarios/Login'))return json(loginUser({ClienteId:'7,9'}));
    if(!url.startsWith(MUSARDOS_API))return photoResponse();
    const parsed=new URL(url),client=parsed.searchParams.get('clienteId');
    if(parsed.pathname.endsWith('/SharedLibrary')){sharedCalls++;const cursor=parsed.searchParams.get('continuationToken');return json({items:[photo('shared-'+sharedCalls)],hasMore:true,continuationToken:cursor==='cycle-a'?'cycle-b':'cycle-a'});}
    return client==='7'?json({},403):json({items:[photo('client-nine')],hasMore:false});
  };
  await fixture(fetcher,async({bank})=>{
    await bank.connect(owner,'operator-test','test-password');bank.sync(owner);await bank.wait();const status=bank.status(owner);
    assert.equal(status.run.status,'incomplete');assert.equal(status.run.enumerationComplete,false);assert.equal(sharedCalls,3);assert.equal(status.run.scopes.find(scope=>scope.id==='shared').status,'error');assert.equal(status.run.scopes.find(scope=>scope.id==='client:7').status,'blocked');assert.equal(status.run.scopes.find(scope=>scope.id==='client:9').status,'completed');assert.ok(status.counts.ready>0);
  });
});

test('sessão expirada pausa a cópia e limpa a conexão sem remover fotos já copiadas',async()=>{
  let expired=false;
  const fetcher=async url=>url.endsWith('/Usuarios/Login')?json(loginUser()):url.startsWith(MUSARDOS_API)?expired?json({},401):json({items:[photo('existing')],hasMore:false}):photoResponse();
  await fixture(fetcher,async({bank,directory})=>{
    await bank.connect(owner,'operator-test','test-password');bank.sync(owner);await bank.wait();const existing=bank.items(params({})).items[0],before=await readFile(bank.image(existing.id).path);
    expired=true;bank.sync(owner);await bank.wait();const status=bank.status(owner);assert.equal(status.connection.connected,false);assert.equal(status.run.status,'paused');assert.equal(status.run.enumerationComplete,false);assert.equal(status.counts.ready,1);assert.deepEqual(await readFile(bank.image(existing.id).path),before);assert.throws(()=>bank.resume(owner),error=>error.status===409);
    assert.deepEqual(await readdir(join(directory,'image-bank','parts')),[]);
  });
});

test('pausa e reinício retomam o cursor confirmado e exigem reconexão à mesma conta', {timeout:8000},async()=>{
  const reached=deferred();let blocked=true,account=12;const cursors=[];
  const fetcher=async(url,options)=>{
    if(url.endsWith('/Usuarios/Login'))return json(loginUser({Id:account}));
    if(!url.startsWith(MUSARDOS_API))return photoResponse();
    const parsed=new URL(url);if(parsed.pathname.endsWith('/ClienteLibrary'))return json({items:[],hasMore:false});
    const cursor=parsed.searchParams.get('continuationToken');cursors.push(cursor);
    if(cursor==='resume-here'&&blocked){reached.resolve();return new Promise((resolve,reject)=>{if(options.signal.aborted)reject(options.signal.reason);else options.signal.addEventListener('abort',()=>reject(options.signal.reason),{once:true});});}
    return cursor?json({items:[photo('second')],hasMore:false}):json({items:[photo('first')],hasMore:true,continuationToken:'resume-here'});
  };
  await fixture(fetcher,async context=>{
    await context.bank.connect(owner,'operator-test','test-password');context.bank.sync(owner);await reached.promise;await context.bank.pause();assert.equal(context.bank.status(owner).run.status,'paused');
    await context.restart();assert.equal(context.bank.status(owner).connection.connected,false);assert.throws(()=>context.bank.resume(owner),error=>error.status===409);
    account=99;await context.bank.connect(owner,'different-account','different-password');assert.throws(()=>context.bank.resume(owner),error=>error.status===409);
    account=12;blocked=false;await context.bank.connect(owner,'operator-test','test-password');context.bank.resume(owner);await context.bank.wait();
    const status=context.bank.status(owner);assert.equal(status.run.status,'completed');assert.equal(status.run.discovered,2);assert.deepEqual(cursors,[null,'resume-here','resume-here']);assert.equal(status.run.scopes[0].pages,2);
  });
});

test('exportação pagina e pesquisa nomes e marcas sem afirmar completude remota',async()=>{
  await fixture(async()=>photoResponse(),async({bank})=>{
    const rows=Array.from({length:50},(_,index)=>photo('item-'+index,{name:'Produto '+String(index).padStart(2,'0'),brand:index%2?'Auróra':'Sádia'}));
    bank.importExport(owner,JSON.stringify({items:rows,complete:true}),'exportacao.json');await bank.wait();const status=bank.status(owner);
    assert.equal(status.run.source,'export');assert.equal(status.run.status,'incomplete');assert.equal(status.run.enumerationComplete,false);assert.equal(status.run.downloaded,50);assert.equal(status.counts.blobs,1);
    assert.equal(bank.items(params({})).items.length,24);assert.equal(bank.items(params({page:'2'})).items.length,24);assert.equal(bank.items(params({page:'3'})).items.length,2);assert.equal(bank.items(params({q:'sadia produto'})).total,25);
    const before=status.run.id;assert.throws(()=>bank.importExport(owner,JSON.stringify([rows[0],{url:'https://example.com/not-allowed.png'}])),error=>error.status===400);assert.equal(bank.status(owner).run.id,before);assert.equal(bank.status(owner).counts.items,50);
  });
});

test('falha de gravação conserva a versão anterior e a retomada não altera mídia já selecionada',async()=>{
  let changed=false;
  await fixture(async()=>photoResponse(changed?nextPng:png,changed?'test-image-v2':'test-image-v1'),async({bank,db,directory})=>{
    const record=photo('versioned');bank.importExport(owner,JSON.stringify([record]));await bank.wait();const item=bank.items(params({})).items[0],selected=await bank.select(item.id),oldPath=join(directory,'uploads',selected.stored_name),parts=join(directory,'image-bank','parts');
    assert.deepEqual(await readFile(oldPath),png);changed=true;
    await rmdir(parts);await writeFile(parts,'A file deliberately blocks the parts directory.');
    bank.importExport(owner,JSON.stringify([record]));await bank.wait();assert.equal(bank.status(owner).run.failed,1);assert.equal(bank.items(params({})).items[0].hash,digest(png));assert.deepEqual(await readFile(bank.image(item.id).path),png);
    await unlink(parts);await mkdir(parts);bank.resume(owner);await bank.wait();assert.equal(bank.items(params({})).items[0].hash,digest(nextPng));assert.deepEqual(await readFile(oldPath),png);
    const replacement=await bank.select(item.id);assert.notEqual(replacement.id,selected.id);assert.deepEqual(await readFile(join(directory,'uploads',replacement.stored_name)),nextPng);assert.equal(db.prepare('SELECT COUNT(*) AS n FROM image_bank_versions').get().n,2);assert.deepEqual(await readdir(parts),[]);
  });
});

test('downloads inválidos, excessivos e incompletos deixam erros visíveis e não substituem arquivos válidos',async()=>{
  let mode='valid';const attempts=new Map();
  const fetcher=async url=>{attempts.set(url,(attempts.get(url)||0)+1);if(mode==='invalid')return new Response('<svg>not a supported image</svg>',{headers:{'Content-Type':'image/png'}});if(mode==='incomplete')return new Response(png,{headers:{'Content-Length':String(png.length+10)}});if(mode==='large')return photoResponse(Buffer.alloc(1000));return photoResponse();};
  await fixture(fetcher,async({bank,directory})=>{
    const good=photo('kept');bank.importExport(owner,JSON.stringify([good]));await bank.wait();const hash=bank.items(params({})).items[0].hash;
    for(const failure of ['invalid','incomplete','large']){mode=failure;const bad=photo('bad-'+failure);bank.importExport(owner,JSON.stringify([good,bad]));await bank.wait();const status=bank.status(owner);assert.equal(status.run.status,'incomplete');assert.ok(status.run.failed>=1);assert.equal(bank.items(params({q:'kept'})).items[0].hash,hash);assert.ok(bank.items(params({status:'failed'})).items.some(item=>item.id===sourceId(bad.url)));assert.deepEqual(await readdir(join(directory,'image-bank','parts')),[]);}
    assert.deepEqual(await readFile(bank.image(sourceId(good.url)).path),png);
  },{maxBytes:256});
});

test('resposta sem hasMore mantém a execução incompleta e erro 5xx transitório de foto tem repetição limitada',async()=>{
  let malformed=false,photoCalls=0;
  const fetcher=async url=>{if(url.endsWith('/Usuarios/Login'))return json(loginUser());if(url.startsWith(MUSARDOS_API))return json(malformed?{items:[photo('a')]}:{items:[photo('a')],hasMore:false});return ++photoCalls===1?new Response('temporary',{status:503}):photoResponse();};
  await fixture(fetcher,async({bank})=>{
    await bank.connect(owner,'operator-test','test-password');bank.sync(owner);await bank.wait();assert.equal(bank.status(owner).run.status,'completed');assert.equal(photoCalls,2);
    malformed=true;bank.sync(owner);await bank.wait();assert.equal(bank.status(owner).run.enumerationComplete,false);assert.equal(bank.status(owner).run.status,'incomplete');assert.equal(bank.status(owner).counts.ready,1);
  });
});
