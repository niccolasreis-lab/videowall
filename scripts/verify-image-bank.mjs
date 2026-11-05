import {DatabaseSync} from 'node:sqlite';
import {createHash} from 'node:crypto';
import {createReadStream} from 'node:fs';
import {stat,writeFile} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {normalizePhotoSearch} from '../src/musardos-images.mjs';

const dataDir=resolve(process.env.APP_DATA_DIR||'data');
function snapshot(){
  const db=new DatabaseSync(join(dataDir,'videowall.sqlite'),{readOnly:true});
  try{
    const run=db.prepare('SELECT * FROM image_bank_runs ORDER BY created_at DESC,rowid DESC LIMIT 1').get();
    if(!run)throw new Error('Nenhuma execução encontrada.');
    const scopes=JSON.parse(run.scopes_json);
    const names=db.prepare('SELECT name FROM catalog_products').all().map(row=>row.name);
    names.push(...db.prepare('SELECT term FROM image_bank_requested_terms').all().map(row=>row.term));
    for(const row of db.prepare("SELECT kind,config_json FROM virtual_content WHERE kind IN ('price_table','poster','offer','product_image')").all()){
      const config=JSON.parse(row.config_json);if(['price_table','poster'].includes(row.kind))names.push(...(config.rows||[]).map(item=>item.name));else names.push(config.title);
    }
    const keys=new Set(names.filter(name=>typeof name==='string'&&name.trim().length>=2&&name.trim().length<=160).map(normalizePhotoSearch));
    const accountId=run.account_id||db.prepare('SELECT account_id FROM image_bank_runs WHERE account_id IS NOT NULL ORDER BY created_at DESC,rowid DESC LIMIT 1').get()?.account_id;
    const known=new Map(accountId?db.prepare('SELECT term_key,status FROM image_bank_queries WHERE account_id=?').all(accountId).map(row=>[row.term_key,row.status]):[]);
    const automatic={enabled:JSON.parse(db.prepare("SELECT value_json FROM settings WHERE key='image-bank-automatic'").get()?.value_json||'{}').enabled===true,pending:[...keys].filter(key=>!known.has(key)||known.get(key)==='retry').length,failed:[...keys].filter(key=>known.get(key)==='error').length};
    return {runId:run.id,source:run.source,status:run.status,enumerationComplete:!!run.enumeration_complete,
      automatic,
      queries:scopes.length,completedQueries:scopes.filter(s=>s.status==='completed').length,
      queriesWithResults:scopes.filter(s=>s.status==='completed'&&s.count>0).length,
      queriesWithoutResults:scopes.filter(s=>s.status==='completed'&&!s.count).length,
      failedQueries:scopes.filter(s=>['blocked','error'].includes(s.status)).length,
      runItems:db.prepare("SELECT COUNT(*) AS discovered,COALESCE(SUM(status IN ('copied','reused')),0) AS downloaded,COALESCE(SUM(status='reused'),0) AS duplicates,COALESCE(SUM(status IN ('pending','error')),0) AS unresolved FROM image_bank_run_items WHERE run_id=?").get(run.id),
      inventory:db.prepare("SELECT COUNT(*) AS items,COALESCE(SUM(status='ready'),0) AS ready,COALESCE(SUM(status='error'),0) AS failed FROM image_bank_items").get(),
      files:db.prepare('SELECT * FROM image_bank_files ORDER BY hash').all(),error:run.error};
  }finally{db.close();}
}
let last;
do{
  last=snapshot();const {files,...progress}=last;console.log(JSON.stringify({...progress,uniqueFiles:files.length}));
  if(!process.argv.includes('--watch')||last.status!=='running'&&(!last.automatic.enabled||!last.automatic.pending||last.status==='paused'))break;
  await new Promise(done=>setTimeout(done,30000));
}while(true);

if(last.status==='running'||last.automatic.enabled&&last.automatic.pending){process.exitCode=2;}
else{
  const errors=[];
  for(const file of last.files){
    const path=join(dataDir,'image-bank','files',file.stored_name);
    try{
      const metadata=await stat(path);if(metadata.size!==file.size)throw new Error('Tamanho divergente');
      const digest=createHash('sha256');for await(const chunk of createReadStream(path))digest.update(chunk);
      if(digest.digest('hex')!==file.hash)throw new Error('Hash divergente');
    }catch(error){errors.push({hash:file.hash,error:error.code||error.message});}
  }
  const {files,...result}=last;
  const report={...result,verifiedAt:new Date().toISOString(),uniqueFiles:files.length,bytes:files.reduce((n,file)=>n+file.size,0),integrityErrors:errors,
    scopedCopyFinished:last.completedQueries===last.queries&&!last.failedQueries&&!last.runItems.unresolved&&!errors.length&&last.status!=='paused'&&!last.automatic.pending&&!last.automatic.failed&&!last.inventory.failed,
    remoteCoverage:last.enumerationComplete?'enumerated':'not-proven'};
  const reportPath=join(dataDir,'image-bank','verification-'+last.runId+'.json');await writeFile(reportPath,JSON.stringify(report,null,2)+'\n');
  console.log(JSON.stringify({report:reportPath,...report}));if(!report.scopedCopyFinished)process.exitCode=2;
}
