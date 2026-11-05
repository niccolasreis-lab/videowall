import {effectiveProduct,parseCatalogCsv,priceTypes} from './catalog-prices.mjs';
import { createHash, randomUUID } from 'node:crypto';
import { readdir, stat, readFile } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';
import { parseToledoMgv, decodeProductText } from '../public/toledo.js';
import { transaction } from './database.mjs';
import { HttpError } from './media.mjs';

export function createCatalog(db, clock=Date.now) {
 const q=(sql,...args)=>db.prepare(sql).get(...args), all=(sql,...args)=>db.prepare(sql).all(...args);
 const latest=()=>q("SELECT id FROM catalog_imports WHERE status='applied' ORDER BY rowid DESC LIMIT 1")?.id || null;
 let running=false, closed=false, candidate=null, lastCheck=null, lastError=null;
 const settings=()=>JSON.parse(q('SELECT value_json FROM settings WHERE key=?','catalog-watch')?.value_json || '{"enabled":false,"path":""}');
 function stage(text,filename='itensmgv.txt',{fullSnapshot=false}={}) {
  if(typeof text!=='string' || text.length>5*1024*1024) throw new HttpError(400,'Carga inválida ou maior que 5 MB.');
  let parsed; try {parsed=/^\s*(?:codigo|nome|departamento|preco_normal)[;,]/.test(text.replace(/^\uFEFF/,''))||/\.csv$/i.test(filename)?parseCatalogCsv(text):parseToledoMgv(text);} catch(error){throw new HttpError(400,error.message);}
  const sourceDigest=createHash('sha256').update(text).digest('hex');
  const baseId=latest();
  let digest=sourceDigest;
  if(fullSnapshot&&baseId){
   const applied=q('SELECT digest,payload_json FROM catalog_imports WHERE id=?',baseId);
   if((JSON.parse(applied.payload_json).sourceDigest||applied.digest)===sourceDigest)return inspect(baseId);
   digest=createHash('sha256').update(baseId+':'+sourceDigest).digest('hex');
  }
  const existing=q('SELECT id,status,base_id FROM catalog_imports WHERE digest=?',digest);
  if(existing && (existing.status==='applied' || existing.base_id===latest())) return inspect(existing.id);
  const before=new Map(all('SELECT * FROM catalog_products').map(p=>[p.product_key,p]));
  const rows=parsed.products.map(p=>({...p,key:p.department+':'+p.code}));
  const incoming=new Set(rows.map(p=>p.key));
  const summary={total:rows.length,added:0,changed:0,unchanged:0,zeroPrices:parsed.zeroPrices,removed:[...before.values()].filter(p=>p.available && !incoming.has(p.product_key)).length};
  const changes=[];
  for(const p of before.values())if(p.available&&!incoming.has(p.product_key))changes.push({key:p.product_key,name:p.name,type:'removed',before:p.price,after:null});
  for(const p of rows){
   const old=before.get(p.key),source=old&&q('SELECT offer,club FROM catalog_price_sources WHERE product_key=?',p.key);
   const beforePrices={normal:old?.price??null,offer:source?.offer??null,club:source?.club??null};
   const afterPrices={normal:p.price,offer:p.offer??null,club:p.club??null};
   const changed=old&&(old.name!==p.name||old.unit!==p.unit||!old.available||priceTypes.some(type=>beforePrices[type]!==afterPrices[type]));
   const type=!old?'added':changed?'changed':'unchanged';
   summary[type]++;
   if(type!=='unchanged') changes.push({key:p.key,name:p.name,type,before:beforePrices.normal,after:afterPrices.normal,beforePrices,afterPrices});
  }
  const id=existing?.id || randomUUID();
  if(existing)db.prepare('UPDATE catalog_imports SET payload_json=?,summary_json=?,base_id=?,created_at=? WHERE id=?').run(JSON.stringify({rows,changes,sourceDigest}),JSON.stringify(summary),baseId,clock(),id);
  else db.prepare('INSERT INTO catalog_imports VALUES (?,?,?,?,?,?,?,?,NULL)').run(id,digest,String(filename).slice(0,240),'pending',JSON.stringify({rows,changes,sourceDigest}),JSON.stringify(summary),baseId,clock());
  return inspect(id);
 }
 function inspect(id){const row=q('SELECT * FROM catalog_imports WHERE id=?',id);if(!row)throw new HttpError(404,'Carga não encontrada.');const data=JSON.parse(row.payload_json);return {id:row.id,filename:row.filename,status:row.status,summary:JSON.parse(row.summary_json),changes:data.changes.slice(0,200),changesTotal:data.changes.length,createdAt:row.created_at,appliedAt:row.applied_at};}
 function apply(id,onApply){return transaction(db,()=>{const row=q('SELECT * FROM catalog_imports WHERE id=?',id);if(!row)throw new HttpError(404,'Carga não encontrada.');if(row.status==='applied')return inspect(id);if(row.base_id!==latest())throw new HttpError(409,'O catálogo mudou após esta análise. Envie a carga novamente para revisar as diferenças.');
  db.prepare('UPDATE catalog_products SET available=0').run();
  const upsert=db.prepare('INSERT INTO catalog_products VALUES (?,?,?,?,?,?,?,?) ON CONFLICT(product_key) DO UPDATE SET name=excluded.name,price=excluded.price,unit=excluded.unit,available=1,updated_at=excluded.updated_at');
  for(const p of JSON.parse(row.payload_json).rows){upsert.run(p.key,p.department,p.code,p.name,p.price,p.unit,1,clock());db.prepare('INSERT INTO catalog_price_sources VALUES (?,?,?) ON CONFLICT(product_key) DO UPDATE SET offer=excluded.offer,club=excluded.club').run(p.key,p.offer??null,p.club??null);}
  db.prepare('INSERT INTO operation_events(kind,subject_id,created_at) VALUES (?,?,?)').run('catalog-applied',id,clock());
  db.prepare("UPDATE catalog_imports SET status='applied',applied_at=? WHERE id=?").run(clock(),id);onApply?.();return inspect(id);});}
 function product(key){const p=q('SELECT * FROM catalog_products WHERE product_key=?',key);return p?effectiveProduct(p,q('SELECT * FROM catalog_price_sources WHERE product_key=?',key),q('SELECT * FROM catalog_overrides WHERE product_key=?',key)):null;}
 function edit(key,input){if(!product(key))throw new HttpError(404,'Produto não encontrado.');const name=input.name==null?'':input.name;if(typeof name!=='string'||name.length>160)throw new HttpError(400,'Nome comercial inválido.');const prices=input.prices||{};if(typeof prices!=='object'||Array.isArray(prices)||Object.entries(prices).some(([k,v])=>!priceTypes.includes(k)||typeof v!=='number'||!Number.isFinite(v)||v<0||v>999999))throw new HttpError(400,'Substituição de preço inválida.');db.prepare('INSERT INTO catalog_overrides VALUES (?,?,?) ON CONFLICT(product_key) DO UPDATE SET name=excluded.name,prices_json=excluded.prices_json').run(key,name.trim()||null,JSON.stringify(prices));return product(key);}
 function search(params){const term=String(params.get('q')||'').slice(0,160).toLocaleLowerCase('pt-BR'),page=Math.max(1,Math.floor(Number(params.get('page'))||1));const items=all('SELECT product_key FROM catalog_products ORDER BY available DESC,name,product_key').map(p=>product(p.product_key)).filter(p=>!term||(p.name+' '+p.sourceName+' '+p.code).toLocaleLowerCase('pt-BR').includes(term));return {page,total:items.length,items:items.slice((page-1)*50,page*50).map(p=>({...p,usedIn:all("SELECT id,name,config_json FROM virtual_content WHERE kind IN ('poster','price_table','offer')").filter(c=>{const cfg=JSON.parse(c.config_json);return cfg.productKey===p.product_key||(cfg.rows||[]).some(r=>r.code===p.code&&(!r.department||r.department===p.department));}).map(c=>({id:c.id,name:c.name}))}))};}
 function configure(input){if(typeof input.path!=='string'||input.path.length>500||(input.enabled&&(!isAbsolute(input.path)||!input.path.trim())))throw new HttpError(400,'Informe uma pasta absoluta válida.');const value={enabled:input.enabled===true,path:input.path.trim()};db.prepare('INSERT INTO settings VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value_json=excluded.value_json').run('catalog-watch',JSON.stringify(value));candidate=null;return value;}
 async function check(){if(running||closed)return;const config=settings();if(!config.enabled)return;running=true;lastCheck=clock();try{
  const entries=await readdir(config.path,{withFileTypes:true});const files=[];
  for(const entry of entries){if(!entry.isFile()||!/^itensmgv.*\.(txt|mgv)$/i.test(entry.name))continue;const path=join(config.path,entry.name),info=await stat(path);if(info.size>0&&info.size<=5*1024*1024)files.push({path,name:entry.name,size:info.size,mtime:info.mtimeMs});}
  files.sort((a,b)=>b.mtime-a.mtime||a.name.localeCompare(b.name));const file=files[0];if(!file)throw new Error('Nenhum arquivo ITENSMGV válido nesta pasta.');
  const identity=JSON.stringify(file);if(candidate!==identity){candidate=identity;lastError=null;return;}
  const bytes=await readFile(file.path);const after=await stat(file.path);if(after.size!==file.size||after.mtimeMs!==file.mtime){candidate=null;return;}if(!closed)stage(decodeProductText(bytes).text,file.name);lastError=null;
 }catch(error){lastError=error.message;}finally{running=false;}}
 const interval=setInterval(check,60000);interval.unref();
 function status(){return {lastApplied:latest()?inspect(latest()):null,pendingContentIds:JSON.parse(q('SELECT value_json FROM settings WHERE key=?','catalog-pending-content')?.value_json || '[]'),counts:q('SELECT COUNT(*) AS total,SUM(CASE WHEN available=1 AND price>0 THEN 1 ELSE 0 END) AS priced,SUM(CASE WHEN price=0 THEN 1 ELSE 0 END) AS zeroPrices FROM catalog_products'),imports:all('SELECT id FROM catalog_imports ORDER BY rowid DESC LIMIT 30').map(r=>inspect(r.id)),watch:{...settings(),lastCheck,lastError,running,intervalSeconds:60}};}
 return {stage,inspect,apply,search,product,edit,lastApplied:()=>q("SELECT applied_at,filename FROM catalog_imports WHERE status='applied' ORDER BY rowid DESC LIMIT 1"),configure,check,status,close(){closed=true;clearInterval(interval);}};
}
