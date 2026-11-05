import {HttpError} from './media.mjs';
export const timeZone='America/Sao_Paulo';
const dayFormatter=new Intl.DateTimeFormat('en-CA',{timeZone,year:'numeric',month:'2-digit',day:'2-digit'});
export const dayKey=time=>dayFormatter.format(new Date(time));
export function reportRange(params,now){
 const today=dayKey(now),defaultStart=dayKey(now-29*86400000),from=params.get('from')||defaultStart,to=params.get('to')||today;
 const valid=s=>/^\d{4}-\d{2}-\d{2}$/.test(s)&&Number.isFinite(Date.parse(s+'T12:00:00Z'))&&new Date(s+'T12:00:00Z').toISOString().slice(0,10)===s;
 if(!valid(from)||!valid(to)||from>to||Date.parse(to)-Date.parse(from)>365*86400000)throw new HttpError(400,'Informe um período válido de até 366 dias.');
 // Find civil midnight through the IANA zone, including historical DST transitions.
 const boundary=date=>{const midnight=Date.parse(date+'T00:00:00Z');let lo=midnight-36*3600000,hi=midnight+36*3600000;while(hi-lo>1){const mid=Math.floor((lo+hi)/2);if(dayKey(mid)<date)lo=mid;else hi=mid;}return hi;};
 const next=new Date(Date.parse(to+'T12:00:00Z')+86400000).toISOString().slice(0,10);return {from,to,since:boundary(from),until:boundary(next),timeZone};
}
export function pointSettings(value={}){
 if(!value||typeof value!=='object'||Array.isArray(value))throw new HttpError(400,'Configuração de ponto inválida.');
 const orientation=value.orientation||'horizontal';if(!['horizontal','horizontal-inverted','vertical','vertical-inverted'].includes(orientation))throw new HttpError(400,'Orientação inválida.');
 for(const key of ['kiosk','progress'])if(value[key]!==undefined&&typeof value[key]!=='boolean')throw new HttpError(400,'Configuração de ponto inválida.');
 return {orientation,kiosk:value.kiosk===true,progress:value.progress===true};
}
export function playerTelemetry(value){
 if(!value||typeof value!=='object')return {};
 return {version:typeof value.version==='string'?value.version.slice(0,40):'',platform:typeof value.platform==='string'?value.platform.slice(0,120):'',capabilities:{offline:value.capabilities?.offline===true,segments:value.capabilities?.segments===true,screenshot:false,wifi:false,memory:false}};
}
export function createOperations(db,clock){
 db.prepare('INSERT OR IGNORE INTO settings VALUES (?,?)').run('operations-collection-start',JSON.stringify(clock()));
 const all=(sql,...args)=>db.prepare(sql).all(...args);
 const record=(kind,id)=>db.prepare('INSERT INTO operation_events(kind,subject_id,created_at) VALUES (?,?,?)').run(kind,id,clock());
 function report(params){const range=reportRange(params,clock()),pointId=params.get('pointId')||'',mediaId=params.get('mediaId')||'';
  const events=all('SELECT e.*,p.name point_name FROM playback_events e LEFT JOIN points p ON p.id=e.point_id WHERE e.created_at>=? AND e.created_at<? AND (?=\'\' OR e.point_id=?) AND (?=\'\' OR e.media_id=?) ORDER BY e.created_at',range.since,range.until,pointId,pointId,mediaId,mediaId);
  const segments=all('SELECT s.*,p.name point_name FROM playback_segments s LEFT JOIN points p ON p.id=s.point_id WHERE s.ended_at>? AND s.started_at<? AND (?=\'\' OR s.point_id=?) AND (?=\'\' OR s.media_id=?)',range.since,range.until,pointId,pointId,mediaId,mediaId);
  const content=new Map(),points=new Map(),days=new Map(),dayEnds=new Map(),names=new Map(all('SELECT id,name FROM media UNION ALL SELECT id,name FROM virtual_content').map(r=>[r.id,r.name]));
  const base=(map,key,name)=>{if(!map.has(key))map.set(key,{id:key,name,starts:0,ends:0,errors:0,lastAt:null,durationMs:null});return map.get(key);};
  const dayRows=at=>{const key=dayKey(at);return base(days,key,key);};
  for(let t=Date.parse(range.from+'T12:00:00Z');t<=Date.parse(range.to+'T12:00:00Z');t+=86400000)dayRows(t);
  for(const e of events)for(const row of [base(content,e.media_id,e.media_name||'Conteúdo indisponível'),base(points,e.point_id,e.point_name||'Ponto removido'),dayRows(e.created_at)]){if(e.type==='started')row.starts++;if(e.type==='ended')row.ends++;if(e.type==='error')row.errors++;row.lastAt=Math.max(row.lastAt||0,e.created_at);}
  for(const s of segments){const lo=Math.max(s.started_at,range.since),hi=Math.min(s.ended_at,range.until),ratio=s.duration_ms/(s.ended_at-s.started_at);for(const row of [base(content,s.media_id,names.get(s.media_id)||events.find(e=>e.media_id===s.media_id)?.media_name||'Conteúdo indisponível'),base(points,s.point_id,s.point_name||'Ponto removido')])row.durationMs=(row.durationMs||0)+(hi-lo)*ratio;
   // Split at actual local day boundaries, rather than assigning the whole segment to its end date.
   let at=lo;while(at<hi){const key=dayKey(at),end=dayEnds.get(key)||reportRange(new URLSearchParams({from:key,to:key}),at).until,next=Math.min(end,hi),row=dayRows(at);dayEnds.set(key,end);row.durationMs=(row.durationMs||0)+(next-at)*ratio;at=next;}
  }
  const activity=all('SELECT kind,created_at FROM operation_events WHERE created_at>=? AND created_at<?',range.since,range.until);for(const e of activity){const row=dayRows(e.created_at);row[e.kind]=(row[e.kind]||0)+1;}
  const byContent=[...content.values()].map(r=>({...r,mediaId:r.id})),byPoint=[...points.values()],byDay=[...days.values()].sort((a,b)=>a.id.localeCompare(b.id));
  const first=JSON.parse(db.prepare('SELECT value_json FROM settings WHERE key=?').get('operations-collection-start').value_json);
  return {...range,generatedAt:clock(),collectionStartedAt:first||null,days:byDay.length,totals:{events:events.length,starts:events.filter(e=>e.type==='started').length,ends:events.filter(e=>e.type==='ended').length,errors:events.filter(e=>e.type==='error').length,durationMs:segments.length?byContent.reduce((n,r)=>n+(r.durationMs||0),0):null},byContent,byPoint,byDay};
 }
 return {record,report};
}
