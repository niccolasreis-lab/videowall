export function pointState(point) {
 if(!point.paired)return {key:'unpaired',label:'Não vinculado'};
 if(!point.online)return {key:'offline',label:'Offline'};
 if(!point.publishedVersion)return {key:'no_playlist',label:'Sem publicação'};
 if(point.playbackState==='scheduled')return {key:'scheduled',label:'Fora do horário'};
 if(point.playbackState==='error')return {key:'error',label:'Falha na reprodução'};
 if(point.playbackState==='playing' && point.currentMedia)return {key:'playing',label:'Reproduzindo'};
 return {key:'waiting',label:'Online sem exibir'};
}
export function matchesPointFilter(point,filter,now=Date.now()) {
 if(Array.isArray(filter))return !filter.length||filter.some(value=>matchesPointFilter(point,value,now));
 if(filter==='all')return true;
 if(filter==='online')return point.online;
 if(filter==='offline')return !point.online;
 if(filter==='offline5'||filter==='offline30')return !!point.paired&&!point.online&&Number.isFinite(point.lastSeen)&&now-point.lastSeen>=(filter==='offline5'?5:30)*86400000;
 if(filter==='no_playlist')return !point.publishedVersion;
 return pointState(point).key===filter;
}

export function offlineLabel(point){
 const s=point.offline||{};
 if(s.state==='ready')return 'Salvo no aparelho: v'+s.version+' · '+s.files+' arquivo(s)';
 if(s.state==='downloading')return 'Baixando: '+s.files+'/'+s.total+' arquivo(s)';
 if(s.state==='error')return 'Download pendente: '+s.error;
 if(s.state==='unsupported')return 'Offline indisponível: '+s.error;
 return 'Offline sem confirmação';
}
