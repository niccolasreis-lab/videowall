import {createHash,randomUUID} from 'node:crypto';
import {mkdirSync,existsSync,constants} from 'node:fs';
import {open,copyFile,unlink,stat} from 'node:fs/promises';
import {join} from 'node:path';
import {HttpError,identifyImage} from './media.mjs';
import {transaction} from './database.mjs';
import {MusardosImages,normalizePhotoSearch,parsePhotoExport,parseProductSearchList,allowedPhotoUrl} from './musardos-images.mjs';

const fileExists=async path=>{try{return (await stat(path)).isFile();}catch{return false;}};
const safeError=error=>error.code==='ENOSPC'?'Sem espaço em disco. Libere espaço e retome a cópia.':error.code==='EACCES'||error.code==='EPERM'?'Sem permissão para gravar os arquivos. Confira a pasta de dados.':error instanceof HttpError?error.message:'Não foi possível copiar o arquivo. Tente novamente.';

export function createImageBank({db,dataDir,clock=Date.now,fetcher=globalThis.fetch,maxBytes=250*1024*1024,isOwnerActive=()=>true,automaticIntervalMs=30000,automaticDelayMs=1000}) {
  const directory=join(dataDir,'image-bank'),filesDirectory=join(directory,'files'),partsDirectory=join(directory,'parts');
  mkdirSync(filesDirectory,{recursive:true});mkdirSync(partsDirectory,{recursive:true});
  const provider=new MusardosImages({fetcher});
  const one=(sql,...args)=>db.prepare(sql).get(...args),all=(sql,...args)=>db.prepare(sql).all(...args),exec=(sql,...args)=>db.prepare(sql).run(...args);
  let connection=null,worker=null,controller=null,closed=false,automaticTimer=null,activeAutomatic=false,automaticError='',lastAutomaticCheck=null;
  const automaticKey='image-bank-automatic';
  const selections=new Map();
  exec("UPDATE image_bank_runs SET status='paused',error='O servidor foi reiniciado. Conecte e retome a cópia.',updated_at=? WHERE status='running'",clock());
  // Seed prior searches so automation does not repeat the existing collection.
  for(const previous of all("SELECT account_id,scopes_json,updated_at FROM image_bank_runs WHERE source='search' AND account_id IS NOT NULL ORDER BY updated_at DESC,rowid DESC")){
    for(const scope of JSON.parse(previous.scopes_json)){
      if(!['completed','error','blocked'].includes(scope.status))continue;
      for(const term of new Set([scope.term,scope.originalTerm].filter(Boolean)))exec('INSERT OR IGNORE INTO image_bank_queries VALUES (?,?,?,?,?,?,?)',previous.account_id,normalizePhotoSearch(term),term,scope.status==='completed'?'completed':'error',scope.count||0,scope.error||'',previous.updated_at);
    }
  }
  const automaticInterval=automaticIntervalMs>0?setInterval(()=>{void checkAutomatic().catch(()=>{});},automaticIntervalMs):null;
  automaticInterval?.unref?.();
  function automaticEnabled(){return JSON.parse(one('SELECT value_json FROM settings WHERE key=?',automaticKey)?.value_json||'{}').enabled===true;}
  function saveAutomatic(enabled){exec('INSERT INTO settings VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value_json=excluded.value_json',automaticKey,JSON.stringify({enabled}));}
  function productTerms(){
    const terms=all("SELECT COALESCE(NULLIF(o.name,''),p.name) name FROM catalog_products p LEFT JOIN catalog_overrides o ON o.product_key=p.product_key").map(row=>row.name);
    for(const content of all("SELECT kind,config_json FROM virtual_content WHERE kind IN ('price_table','poster','offer','product_image')")){
      const config=JSON.parse(content.config_json);
      if(['price_table','poster'].includes(content.kind))terms.push(...(config.rows||[]).map(row=>row.name));else terms.push(config.title);
    }
    terms.push(...all('SELECT term FROM image_bank_requested_terms').map(row=>row.term));
    const unique=new Map();for(const value of terms){const term=String(value||'').trim();if(term.length>=2&&term.length<=160)unique.set(normalizePhotoSearch(term),term);}return unique;
  }
  function automaticState(owner){
    const enabled=automaticEnabled(),valid=connection&&connection.owner===owner&&isOwnerActive(owner);
    const accountId=valid?connection.user.id:one('SELECT account_id FROM image_bank_runs WHERE account_id IS NOT NULL ORDER BY created_at DESC,rowid DESC LIMIT 1')?.account_id;
    const terms=productTerms(),known=new Map(accountId?all('SELECT term_key,status FROM image_bank_queries WHERE account_id=?',accountId).map(row=>[row.term_key,row.status]):[]);
    const pending=[...terms.keys()].filter(key=>!known.has(key)||known.get(key)==='retry').length,failed=[...terms.keys()].filter(key=>known.get(key)==='error').length;
    const run=latest(),paused=run?.status==='paused';
    return {enabled,state:!enabled?'disabled':!valid?'waiting-connection':worker?activeAutomatic?'running':'busy':paused?'paused':pending?'queued':'idle',pending,failed,lastError:automaticError,lastCheckedAt:lastAutomaticCheck};
  }
  function notifyProductsChanged(){
    if(closed||!automaticEnabled())return;
    clearTimeout(automaticTimer);automaticTimer=setTimeout(()=>{automaticTimer=null;void checkAutomatic().catch(()=>{});},automaticDelayMs);automaticTimer.unref?.();
  }
  function recordQuery(user,scope,status){
    if(!user)return;const term=scope.originalTerm||scope.term;
    exec('INSERT INTO image_bank_queries VALUES (?,?,?,?,?,?,?) ON CONFLICT(account_id,term_key) DO UPDATE SET term=excluded.term,status=excluded.status,result_count=excluded.result_count,last_error=excluded.last_error,attempted_at=excluded.attempted_at',user.id,normalizePhotoSearch(term),term,status,scope.count||0,scope.error||'',clock());
  }
  async function configureAutomatic(owner,input){
    if(typeof input?.enabled!=='boolean')throw new HttpError(400,'Informe se a busca automática está ativada.');
    saveAutomatic(input.enabled);automaticError='';
    if(!input.enabled&&activeAutomatic)await pause();
    if(input.enabled){if(!resumeAutomatic(owner))notifyProductsChanged();}else{clearTimeout(automaticTimer);automaticTimer=null;}
    return status(owner);
  }
  function resumeAutomatic(owner){
    if(worker||!connection||connection.owner!==owner||!isOwnerActive(owner))return false;
    const run=latest();if(run?.status!=='paused'||run.accountId!==connection.user.id||!run.scopes.some(scope=>scope.automatic))return false;
    resume(owner);return true;
  }
  async function checkAutomatic(){
    if(closed||!automaticEnabled()||worker||!connection||!isOwnerActive(connection.owner))return;
    lastAutomaticCheck=clock();const {owner,user}=connection;const run=latest();
    if(run?.status==='paused')return;
    try{
      const known=new Map(all('SELECT term_key,status FROM image_bank_queries WHERE account_id=?',user.id).map(row=>[row.term_key,row.status]));
      const terms=[...productTerms()].filter(([key])=>!known.has(key)||known.get(key)==='retry').sort((a,b)=>Number(known.get(b[0])==='retry')-Number(known.get(a[0])==='retry')).slice(0,25).map(([,term])=>term);
      if(!terms.length)return;startSearch(owner,user,terms,true);automaticError='';
    }catch(error){automaticError=safeError(error);}
  }
  async function queueProductList(owner,{text,filename='Lista de produtos'}={}){
    const parsed=parseProductSearchList(text),source=String(filename).slice(0,240);let added=0;
    const accountId=connection?.owner===owner?connection.user.id:one('SELECT account_id FROM image_bank_runs WHERE account_id IS NOT NULL ORDER BY created_at DESC,rowid DESC LIMIT 1')?.account_id;
    const known=new Set(accountId?all('SELECT term_key FROM image_bank_queries WHERE account_id=?',accountId).map(row=>row.term_key):[]);
    transaction(db,()=>{for(const term of parsed.names)added+=exec('INSERT OR IGNORE INTO image_bank_requested_terms VALUES (?,?,?,?)',normalizePhotoSearch(term),term,source,clock()).changes;});
    const result=await configureAutomatic(owner,{enabled:true});
    return {...result,list:{filename:source,records:parsed.records,distinct:parsed.names.length,duplicates:parsed.duplicates,added,alreadySearched:parsed.names.filter(term=>known.has(normalizePhotoSearch(term))).length}};
  }
  function retryAutomatic(owner){
    const user=requireConnection(owner);if(!automaticEnabled())throw new HttpError(409,'Ative a busca automática antes de retentar.');
    const terms=productTerms();let queued=0;
    transaction(db,()=>{for(const row of all("SELECT term_key FROM image_bank_queries WHERE account_id=? AND status='error'",user.id))if(terms.has(row.term_key))queued+=exec("UPDATE image_bank_queries SET status='retry' WHERE account_id=? AND term_key=?",user.id,row.term_key).changes;});
    if(!resumeAutomatic(owner))notifyProductsChanged();return {...status(owner),retryQueued:queued};
  }

  function latest(){const row=one('SELECT * FROM image_bank_runs ORDER BY created_at DESC,rowid DESC LIMIT 1');return row&&{id:row.id,source:row.source,status:row.status,enumerationComplete:!!row.enumeration_complete,accountId:row.account_id,scopes:JSON.parse(row.scopes_json),error:row.error,createdAt:row.created_at,updatedAt:row.updated_at};}
  function save(run){run.updatedAt=clock();exec('UPDATE image_bank_runs SET status=?,enumeration_complete=?,scopes_json=?,error=?,updated_at=? WHERE id=?',run.status,run.enumerationComplete?1:0,JSON.stringify(run.scopes),run.error||'',run.updatedAt,run.id);}
  function progress(run){
    if(!run)return null;
    const result=one("SELECT COUNT(*) AS discovered,COALESCE(SUM(status IN ('copied','reused')),0) AS downloaded,COALESCE(SUM(status='reused'),0) AS duplicates,COALESCE(SUM(status='error'),0) AS failed,COALESCE(SUM(bytes),0) AS bytes FROM image_bank_run_items WHERE run_id=?",run.id);
    const {accountId,...publicRun}=run;return {...publicRun,automatic:run.scopes.some(scope=>scope.automatic===true),...result};
  }
  function status(owner){
    const valid=connection&&connection.owner===owner&&isOwnerActive(owner);
    return {connection:{connected:!!valid,...valid?{login:connection.user.login}:{}},automatic:automaticState(owner),counts:{...one("SELECT COUNT(*) AS items,COALESCE(SUM(status='ready'),0) AS ready,COALESCE(SUM(status='pending'),0) AS pending,COALESCE(SUM(status='error'),0) AS failed FROM image_bank_items"),...one('SELECT COUNT(*) AS blobs,COALESCE(SUM(size),0) AS bytes FROM image_bank_files')},run:progress(latest())};
  }
  function idle(){if(closed)throw new HttpError(503,'O banco de imagens está encerrando.');if(worker)throw new HttpError(409,'Já existe uma cópia em andamento. Pause antes de iniciar outra.');}
  function requireConnection(owner){if(!connection||connection.owner!==owner||!isOwnerActive(owner))throw new HttpError(409,'Conecte sua conta Musardos para iniciar ou retomar a cópia.');return connection.user;}
  function requireActive(owner,signal){signal.throwIfAborted();if(!isOwnerActive(owner))throw new HttpError(401,'Sua sessão do painel expirou. Entre novamente para retomar.');}
  function newRun(source,scopes,accountId=null){
    const run={id:randomUUID(),source,status:'running',enumerationComplete:false,accountId,scopes,error:'',createdAt:clock(),updatedAt:clock()};
    exec('INSERT INTO image_bank_runs (id,source,status,enumeration_complete,scopes_json,account_id,error,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?)',run.id,source,run.status,0,JSON.stringify(scopes),accountId,'',run.createdAt,run.updatedAt);return run;
  }
  function retain(records,scope,run){
    transaction(db,()=>{for(const record of records){
      const previous=one('SELECT * FROM image_bank_items WHERE id=?',record.id);
      const scopes=[...new Set([...(previous?JSON.parse(previous.scopes_json):[]),scope])];
      const aliases=[...new Set([...(previous?JSON.parse(previous.aliases_json):[]),record.name,record.filename])];
      const searchText=normalizePhotoSearch([record.name,record.filename,record.brand,...aliases].join(' '));
      exec('INSERT INTO image_bank_items (id,source_url,name,filename,brand,search_text,scopes_json,aliases_json,status,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,filename=excluded.filename,brand=excluded.brand,search_text=excluded.search_text,scopes_json=excluded.scopes_json,aliases_json=excluded.aliases_json,updated_at=excluded.updated_at',record.id,record.url,record.name,record.filename,record.brand,searchText,JSON.stringify(scopes),JSON.stringify(aliases),'pending',clock(),clock());
      exec("INSERT OR IGNORE INTO image_bank_run_items (run_id,item_id,status) VALUES (?,?,'pending')",run.id,record.id);
    }});
  }
  async function enumerate(run,user,owner,signal){
    if(run.source==='search')return enumerateSearch(run,user,owner,signal);
    for(const scope of run.scopes){
      if(scope.status==='completed'||scope.id==='client:unknown')continue;
      scope.status='running';scope.error='';save(run);const seen=new Set();
      try{
        while(true){
          requireActive(owner,signal);
          if(seen.has(scope.cursor))throw new HttpError(502,'O catálogo repetiu uma página. A enumeração está incompleta.');seen.add(scope.cursor);
          const page=await provider.page(user,scope,signal);requireActive(owner,signal);
          retain(page.items,scope.id,run);scope.count+=page.items.length;scope.pages=(scope.pages||0)+1;scope.cursor=page.cursor;
          if(!page.hasMore){scope.status='completed';save(run);break;}save(run);
        }
      }catch(error){
        if(signal.aborted)throw error;
        scope.status=error.status===403?'blocked':'error';scope.error=safeError(error);save(run);
        if(error.status===401){connection=null;throw error;}if(error.status===429||['ENOSPC','EACCES','EPERM'].includes(error.code))throw error;
      }
    }
    run.enumerationComplete=run.source!=='search'&&run.scopes.length>0&&run.scopes.every(scope=>scope.status==='completed');save(run);
  }
  async function enumerateSearch(run,user,owner,signal){
    const pending=run.scopes.filter(scope=>scope.status!=='completed'),claimed=new Set();let position=0,fatal;
    await Promise.allSettled(Array.from({length:Math.min(3,pending.length)},async()=>{
      while(position<pending.length&&!signal.aborted&&!fatal){
        const scope=pending[position++];scope.status='running';scope.error='';save(run);
        try{
          requireActive(owner,signal);
          recordQuery(user,scope,'running');
          const records=await provider.search(user,scope.term,signal);requireActive(owner,signal);
          retain(records,scope.id,run);scope.count=records.length;scope.pages=1;save(run);
          for(const record of records){
            requireActive(owner,signal);
            if(claimed.has(record.id))continue;claimed.add(record.id);
            const item=one("SELECT i.* FROM image_bank_items i JOIN image_bank_run_items r ON r.item_id=i.id WHERE r.run_id=? AND i.id=? AND r.status='pending'",run.id,record.id);
            if(item)await download(item,run,owner,signal);
          }
          scope.status='completed';save(run);recordQuery(user,scope,'completed');
        }catch(error){
          if(signal.aborted)break;
          scope.status=error.status===403?'blocked':'error';scope.error=safeError(error);save(run);
          recordQuery(user,scope,'error');
          if([401,429].includes(error.status)||scope.automatic&&error.status===403||['ENOSPC','EACCES','EPERM'].includes(error.code)){
            if(error.status===401)connection=null;fatal=error;controller?.abort(error);
          }
        }
      }
    }));
    if(fatal)throw fatal;signal.throwIfAborted();run.enumerationComplete=false;save(run);
  }
  async function fetchPhoto(item,signal){
    const old=item.current_hash&&one('SELECT * FROM image_bank_files WHERE hash=?',item.current_hash);
    const oldValid=old&&await fileExists(join(filesDirectory,old.stored_name));
    let response;
    for(let attempt=0;attempt<2;attempt++){
      signal.throwIfAborted();
      try{
        response=await fetcher(allowedPhotoUrl(item.source_url),{redirect:'error',headers:oldValid&&item.etag?{'If-None-Match':item.etag}:{},signal:AbortSignal.any([signal,AbortSignal.timeout(60000)])});
        if(response.status<500||attempt===1)break;await response.body?.cancel();
      }catch(error){if(signal.aborted)throw error;if(attempt===1)throw new HttpError(502,'O download da imagem falhou ou excedeu o tempo.');}
    }
    if(response.status===304&&oldValid)return {...old,bytes:0,reused:true,etag:item.etag};
    if(response.status===429)throw new HttpError(429,'O servidor de imagens limitou os downloads. Aguarde e retome.');
    if(response.status!==200)throw new HttpError(502,'A imagem não foi baixada (HTTP '+response.status+').');
    const expected=Number(response.headers.get('content-length'));
    if(expected>maxBytes){await response.body?.cancel();throw new HttpError(413,'A imagem ultrapassa o limite de arquivo da aplicação.');}
    const temp=join(partsDirectory,randomUUID()+'.part');let handle;
    try{
      handle=await open(temp,'wx');let size=0,header=Buffer.alloc(0);const digest=createHash('sha256');
      for await(const value of response.body){
        signal.throwIfAborted();const chunk=Buffer.from(value);size+=chunk.length;
        if(size>maxBytes)throw new HttpError(413,'A imagem ultrapassa o limite de arquivo da aplicação.');
        if(header.length<64)header=Buffer.concat([header,chunk.subarray(0,64-header.length)]);
        digest.update(chunk);let offset=0;while(offset<chunk.length){const result=await handle.write(chunk,offset,chunk.length-offset);if(!result.bytesWritten)throw new Error('Write failed');offset+=result.bytesWritten;}
      }
      if(!size||expected&&size!==expected)throw new HttpError(502,'O download da imagem ficou incompleto.');
      const format=identifyImage(header);if(!format)throw new HttpError(415,'O arquivo recebido não é uma imagem PNG, JPEG, WebP, GIF ou AVIF válida.');
      const hash=digest.digest('hex'),stored_name=hash+'.'+format.ext;
      await handle.close();handle=null;let reused=false;
      try{await copyFile(temp,join(filesDirectory,stored_name),constants.COPYFILE_EXCL);}catch(error){if(error.code!=='EEXIST')throw error;reused=true;}
      const etag=response.headers.get('etag');
      return {hash,stored_name,mime:format.mime,size,bytes:size,reused,etag:etag&&etag.length<1024?etag:null};
    }finally{if(handle)await handle.close().catch(()=>{});await unlink(temp).catch(()=>{});}
  }
  async function download(item,run,owner,signal){
    try{
      requireActive(owner,signal);const photo=await fetchPhoto(item,signal);requireActive(owner,signal);
      transaction(db,()=>{
        exec('INSERT OR IGNORE INTO image_bank_files VALUES (?,?,?,?,?)',photo.hash,photo.stored_name,photo.mime,photo.size,clock());
        exec('UPDATE image_bank_items SET current_hash=?,etag=?,status=?,last_error=?,updated_at=? WHERE id=?',photo.hash,photo.etag,'ready','',clock(),item.id);
        exec('INSERT OR IGNORE INTO image_bank_versions VALUES (?,?,?)',item.id,photo.hash,clock());
        exec('UPDATE image_bank_run_items SET status=?,bytes=?,error=? WHERE run_id=? AND item_id=?',photo.reused?'reused':'copied',photo.bytes,'',run.id,item.id);
      });
    }catch(error){
      if(signal.aborted)throw error;
      const message=safeError(error);exec("UPDATE image_bank_run_items SET status='error',error=? WHERE run_id=? AND item_id=?",message,run.id,item.id);
      exec("UPDATE image_bank_items SET status=CASE WHEN current_hash IS NULL THEN 'error' ELSE status END,last_error=?,updated_at=? WHERE id=?",message,clock(),item.id);
      if(['ENOSPC','EACCES','EPERM'].includes(error.code)||[401,429].includes(error.status))throw error;
    }
  }
  function launch(run,user,owner){
    activeAutomatic=run.scopes.some(scope=>scope.automatic===true);
    const control=new AbortController();controller=control;run.status='running';run.error='';save(run);
    worker=Promise.resolve().then(async()=>{
      try{
        if(['remote','search'].includes(run.source))await enumerate(run,user,owner,control.signal);
        const queue=all("SELECT i.* FROM image_bank_items i JOIN image_bank_run_items r ON r.item_id=i.id WHERE r.run_id=? AND r.status IN ('pending','error') ORDER BY i.id",run.id);
        let position=0,fatal;
        await Promise.all(Array.from({length:Math.min(4,queue.length)},async()=>{while(position<queue.length&&!control.signal.aborted){const item=queue[position++];try{await download(item,run,owner,control.signal);}catch(error){fatal??=error;control.abort(error);}}}));
        if(fatal)throw fatal;control.signal.throwIfAborted();
        const remaining=one("SELECT COUNT(*) AS n FROM image_bank_run_items WHERE run_id=? AND status IN ('pending','error')",run.id).n;
        run.status=run.enumerationComplete&&!remaining?'completed':'incomplete';
        run.error=run.status==='completed'?'':remaining?'Há imagens pendentes ou com falha. Retome a cópia para tentar novamente.':run.source==='search'?'Resultados das buscas copiados. Buscas por nome não comprovam a cobertura de toda a biblioteca Musardos.':run.source==='export'?'Arquivos da exportação copiados. A abrangência total do catálogo remoto não foi verificada.':'Uma ou mais bibliotecas não puderam ser enumeradas. A cópia está incompleta.';
        if(run.source==='search'&&run.scopes.some(scope=>scope.status!=='completed'))run.error='Uma ou mais buscas falharam. Retome para tentar novamente. A cobertura total da biblioteca não foi verificada.';
      }catch(error){
        if(error.status===401)connection=null;
        run.status='paused';run.error=control.signal.aborted&&error.name==='AbortError'?'Importação pausada.':safeError(error);
      }finally{save(run);}
    }).finally(()=>{worker=null;controller=null;activeAutomatic=false;notifyProductsChanged();});
    // A caller may disconnect without waiting for progress polling; always retain the job result.
    void worker.catch(()=>{});
  }
  async function pause({manual=false}={}){if(manual&&activeAutomatic)saveAutomatic(false);if(controller)controller.abort(new DOMException('Importação pausada.','AbortError'));if(worker)await worker;}
  async function connect(owner,login,password){
    const user=await provider.login(login,password);if(closed)throw new HttpError(503,'O servidor está encerrando.');
    await pause();connection={owner,user};if(!automaticEnabled()||!resumeAutomatic(owner))notifyProductsChanged();return status(owner);
  }
  async function disconnect(owner){if(connection?.owner===owner){await pause();connection=null;}return status(owner);}
  function sync(owner){idle();const user=requireConnection(owner);const run=newRun('remote',provider.scopes(user),user.id);launch(run,user,owner);return status(owner);}
  function searchCopy(owner,{q,catalog=false}={}){
    idle();const user=requireConnection(owner);
    if(typeof catalog!=='boolean')throw new HttpError(400,'Opção de catálogo inválida.');
    if(!catalog&&(typeof q!=='string'||q.trim().length<2||q.trim().length>160))throw new HttpError(400,'Informe um produto ou marca com 2 a 160 caracteres.');
    const terms=[...new Set((catalog?all('SELECT DISTINCT name FROM catalog_products ORDER BY name').map(row=>row.name):[q]).map(term=>term.trim()).filter(term=>term.length>=2&&term.length<=160))];
    if(!terms.length)throw new HttpError(400,'O catálogo local não contém nomes de produtos para pesquisar.');
    return startSearch(owner,user,terms);
  }
  function startSearch(owner,user,terms,automatic=false){
    const scopes=terms.map((term,index)=>({id:'search:'+index,kind:'search',term,label:'Busca: '+term,status:'pending',count:0,pages:0,...automatic?{automatic:true}:{}}));
    let run;transaction(db,()=>{run=newRun('search',scopes,user.id);for(const scope of scopes)recordQuery(user,scope,'pending');});
    launch(run,user,owner);return status(owner);
  }
  function resume(owner){
    idle();const run=latest();if(!run)throw new HttpError(404,'Nenhuma cópia para retomar.');if(run.status==='completed')throw new HttpError(409,'A cópia já terminou. Use Atualizar biblioteca para consultar novidades.');
    const needsRemote=['remote','search'].includes(run.source)&&run.scopes.some(scope=>scope.status!=='completed');
    const user=needsRemote?requireConnection(owner):null;if(user&&run.accountId!==user.id)throw new HttpError(409,'Conecte a mesma conta Musardos que iniciou esta cópia.');
    for(const scope of run.scopes)if(scope.status==='running')scope.status='pending';launch(run,user,owner);return status(owner);
  }
  function importExport(owner,text,filename='exportacao'){
    idle();const records=parsePhotoExport(text);const run=newRun('export',[{id:'export',label:String(filename).slice(0,240),status:'imported',count:records.length,error:'A exportação não comprova a enumeração integral do serviço.'}]);
    retain(records,'export',run);launch(run,null,owner);return status(owner);
  }
  function items(params){
    const page=Math.max(1,Math.min(1000000,Math.floor(Number(params.get('page')))||1)),pageSize=24;
    const term=normalizePhotoSearch(String(params.get('q')||'').slice(0,160));
    const tokens=term.split(' ').filter(Boolean),states=['ready','pending','error'];const state=params.get('status')||'ready';
    if(![...states,'all','failed'].includes(state))throw new HttpError(400,'Filtro de imagens inválido.');
    const clauses=[],args=[];if(state!=='all'){clauses.push('i.status=?');args.push(state==='failed'?'error':state);}
    for(const token of tokens){clauses.push("i.search_text LIKE ? ESCAPE '\\'");args.push('%'+token.replace(/[\\%_]/g,'\\$&')+'%');}
    const where=clauses.length?' WHERE '+clauses.join(' AND '):'';
    const total=one('SELECT COUNT(*) AS n FROM image_bank_items i'+where,...args).n;
    const rows=all('SELECT i.*,f.mime,f.size FROM image_bank_items i LEFT JOIN image_bank_files f ON f.hash=i.current_hash'+where+' ORDER BY i.name COLLATE NOCASE,i.id LIMIT ? OFFSET ?',...args,pageSize,(page-1)*pageSize);
    return {page,pageSize,total,items:rows.map(row=>({id:row.id,name:row.name,filename:row.filename,brand:row.brand,sourceUrl:row.source_url,hash:row.current_hash,mime:row.mime,size:row.size||0,status:row.status,error:row.last_error,scopes:JSON.parse(row.scopes_json),aliases:JSON.parse(row.aliases_json),thumbnailUrl:row.current_hash?'/api/image-bank/items/'+row.id+'/image':null}))};
  }
  function image(id){
    const row=one('SELECT f.* FROM image_bank_items i JOIN image_bank_files f ON f.hash=i.current_hash WHERE i.id=?',id);
    if(!row)throw new HttpError(404,'Imagem ainda não disponível no banco local.');return {path:join(filesDirectory,row.stored_name),mime:row.mime};
  }
  async function importMedia(id){
    const row=one('SELECT i.*,f.stored_name,f.mime,f.size FROM image_bank_items i JOIN image_bank_files f ON f.hash=i.current_hash WHERE i.id=?',id);
    if(!row)throw new HttpError(404,'Imagem ainda não disponível no banco local.');
    const current=one('SELECT m.* FROM image_bank_media b JOIN media m ON m.id=b.media_id WHERE b.hash=?',row.current_hash);
    if(current&&await fileExists(join(dataDir,'uploads',current.stored_name)))return current;
    const mediaId=randomUUID(),storedName=mediaId+'.'+row.stored_name.split('.').at(-1),destination=join(dataDir,'uploads',storedName);
    try{
      await copyFile(join(filesDirectory,row.stored_name),destination,constants.COPYFILE_EXCL);
      transaction(db,()=>{
        exec('INSERT INTO media (id,name,filename,stored_name,mime,kind,size,created_at,has_prices,validity_json) VALUES (?,?,?,?,?,?,?,?,?,?)',mediaId,row.name,row.filename,storedName,row.mime,'image',row.size,clock(),0,'{}');
        exec('INSERT INTO image_bank_media VALUES (?,?) ON CONFLICT(hash) DO UPDATE SET media_id=excluded.media_id',row.current_hash,mediaId);
      });return one('SELECT * FROM media WHERE id=?',mediaId);
    }catch(error){await unlink(destination).catch(()=>{});throw error.code==='ENOENT'?new HttpError(404,'O arquivo local está ausente. Atualize a biblioteca para recuperá-lo.'):error;}
  }
  function select(id){
    const item=one('SELECT current_hash FROM image_bank_items WHERE id=?',id);if(!item?.current_hash)throw new HttpError(404,'Imagem ainda não disponível no banco local.');
    if(selections.has(item.current_hash))return selections.get(item.current_hash);
    const promise=importMedia(id).finally(()=>selections.delete(item.current_hash));selections.set(item.current_hash,promise);return promise;
  }
  function close(){closed=true;clearTimeout(automaticTimer);clearInterval(automaticInterval);connection=null;controller?.abort(new DOMException('Importação pausada.','AbortError'));return worker;}
  return {status,connect,disconnect,sync,searchCopy,resume,pause,configureAutomatic,checkAutomatic,notifyProductsChanged,queueProductList,retryAutomatic,importExport,items,image,select,close,wait:()=>worker||Promise.resolve()};
}
