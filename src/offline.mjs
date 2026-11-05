const EVENT_AGE=7*86400000;
const uuid=/^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i;
export function offlineTelemetry(value){
 if(!value||typeof value!=='object')return {};
 const state=['starting','waiting','downloading','ready','error','unsupported'].includes(value.state)?value.state:'waiting';
 const count=x=>Number.isSafeInteger(x)&&x>=0?x:0;
 return {state,publicationId:typeof value.publicationId==='string'&&uuid.test(value.publicationId)?value.publicationId:null,version:count(value.version),files:count(value.files),total:count(value.total),bytes:count(value.bytes),pendingVersion:count(value.pendingVersion),error:typeof value.error==='string'?value.error.slice(0,300):''};
}
export function ingestEvents(db,device,events,now){
 const accepted=[],rejected=[];
 for(const event of events){
  const id=event&&typeof event.id==='string'?event.id:'';
  if(!uuid.test(id)){if(id.length<=100)rejected.push(id);continue;}
  if(event.pointId!==device.point_id||typeof event.publicationId!=='string'||!uuid.test(event.publicationId)||!Number.isSafeInteger(event.createdAt)||event.createdAt<now-EVENT_AGE||event.createdAt>now+120000||!['started','ended','error','segment'].includes(event.type)) {rejected.push(id);continue;}
  const delivered=db.prepare('SELECT p.snapshot_json FROM device_publications d JOIN publications p ON p.id=d.publication_id WHERE d.device_id=? AND d.point_id=? AND d.publication_id=?').get(device.id,device.point_id,event.publicationId||'');
  const media=delivered&&JSON.parse(delivered.snapshot_json).items.find(item=>item.mediaId===event.mediaId);
  if(!media){rejected.push(id);continue;}
  if(event.type==='segment'){if(!Number.isSafeInteger(event.durationMs)||event.durationMs<1||event.durationMs>15000||!Number.isSafeInteger(event.startedAt)||event.startedAt>=event.createdAt||event.createdAt-event.startedAt>15000||event.durationMs>event.createdAt-event.startedAt+100){rejected.push(id);continue;}db.prepare('INSERT OR IGNORE INTO playback_segments VALUES (?,?,?,?,?,?,?,?)').run(device.id,id,device.point_id,media.mediaId,event.publicationId,event.startedAt,event.createdAt,event.durationMs);accepted.push(id);continue;}
  const detail=typeof event.detail==='string'?event.detail.slice(0,300):'';
  db.prepare('INSERT OR IGNORE INTO playback_events (point_id,media_id,media_name,type,detail,created_at,client_event_id,device_id,publication_id,received_at,offline) VALUES (?,?,?,?,?,?,?,?,?,?,?)').run(device.point_id,media.mediaId,media.name,event.type,detail,event.createdAt,id,device.id,event.publicationId,now,event.offline===true?1:0);
  accepted.push(id);
 }
 return {acceptedEventIds:accepted,rejectedEventIds:rejected};
}
