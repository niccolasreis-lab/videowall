// Disposable browser fixture. Use only with the isolated verification/test-data server.
import {tableTemplates,tableExample,templateBackgrounds} from '../public/table-templates.js';
import {writeFile,mkdir,readFile} from 'node:fs/promises';
const origin='http://127.0.0.1:'+Number(process.argv[2]||43219);
let cookie;
async function call(path,method='GET',body){const response=await fetch(origin+path,{method,headers:{'Content-Type':'application/json',...(cookie?{Cookie:cookie}:{})},...(body?{body:JSON.stringify(body)}:{})});const data=await response.json();if(!response.ok)throw new Error(JSON.stringify(data));return {data,cookie:response.headers.get('set-cookie')?.split(';')[0]};}
cookie=(await call('/api/auth/login','POST',{username:'template-test',password:'test-only-templates-2026'})).cookie;
if(process.argv[3]==='--library-photo'){
  const media=(await call('/api/media')).data;let image=media.find(value=>value.name==='Verificação · foto da biblioteca');
  if(!image){const response=await fetch(origin+'/api/media?name='+encodeURIComponent('Verificação · foto da biblioteca')+'&filename=manga.jpg',{method:'POST',headers:{Cookie:cookie,'Content-Type':'image/jpeg'},body:await readFile(new URL('../public/template-assets/mango-v1.jpg',import.meta.url))});if(!response.ok)throw new Error('Upload de teste falhou');image=await response.json();}
  const content=media.find(value=>value.name==='Verificação · Hortifruti — grade');
  const config={...content.config,rows:content.config.rows.map((row,index)=>index===0?{...row,image:{source:'media',id:image.id}}:row),backgroundImage:{source:'builtin',id:templateBackgrounds[50].id}};
  await call('/api/content/'+content.id,'PUT',{name:content.name,kind:content.kind,config});await call('/api/content/'+content.id+'/publish','POST',{});console.log('Foto da biblioteca e fundo do ZIP preparados para verificar offline.');
}
else if(process.argv[3]?.startsWith('--focus=')){
  const theme=process.argv[3].slice(8);if(!tableTemplates.some(template=>template.id===theme))throw new Error('Template desconhecido');
  const playlist=(await call('/api/playlists')).data.find(value=>value.name==='Verificação dos seis templates');
  const content=(await call('/api/media')).data.find(value=>value.name==='Verificação · '+tableTemplates.find(template=>template.id===theme).name);
  const updated=(await call('/api/playlists/'+playlist.id,'PUT',{name:playlist.name,revision:playlist.revision,items:[{mediaId:content.id,seconds:120}]})).data;
  await call('/api/playlists/'+playlist.id+'/publish','POST',{revision:updated.revision});console.log('Foco de verificação: '+theme);
}
else if(process.argv[3]){const points=(await call('/api/points')).data;let point=points.find(point=>point.name==='Verificação dos seis templates');if(!point)throw new Error('Fixture não encontrada');if(point.paired)point=(await call('/api/points','POST',{name:'Verificação dos seis templates · '+process.argv[3],playlistId:point.playlistId})).data;console.log((await call('/api/points/'+point.id+'/pair','POST',{code:process.argv[3]})).data);}
else{
  const existing=(await call('/api/media')).data,items=[];
  for(const template of tableTemplates){const example=tableExample(template.id);example.name='Verificação · '+template.name;
    if(template.id==='bakery')example.config.backgroundImage={source:'builtin',id:templateBackgrounds[17].id};
    if(template.id==='butcher')example.config.rows[0].name='ALCATRA BOVINA ESPECIAL SELECIONADA PARA CHURRASCO — NOME EXTENSO PARA VERIFICAR QUEBRA EM DUAS LINHAS';
    if(template.id==='supermarket')example.config.rows[0].price=99999999;
    const found=existing.find(item=>item.name===example.name);const content=(await call(found?'/api/content/'+found.id:'/api/content',found?'PUT':'POST',example)).data;items.push({mediaId:content.id,seconds:12});
  }
  const playlists=(await call('/api/playlists')).data,found=playlists.find(playlist=>playlist.name==='Verificação dos seis templates');
  const playlist=(await call(found?'/api/playlists/'+found.id:'/api/playlists',found?'PUT':'POST',{name:'Verificação dos seis templates',items,...found?{revision:found.revision}:{}})).data;
  await call('/api/playlists/'+playlist.id+'/publish','POST',{revision:playlist.revision});
  const points=(await call('/api/points')).data;let point=points.find(point=>point.name==='Verificação dos seis templates');
  if(!point)point=(await call('/api/points','POST',{name:'Verificação dos seis templates',playlistId:playlist.id})).data;
  await mkdir(new URL('../verification/screenshots/',import.meta.url),{recursive:true});
  await writeFile(new URL('../verification/test-data/browser-fixture.json',import.meta.url),JSON.stringify({origin,pointId:point.id,playlistId:playlist.id,items},null,2));
  console.log(JSON.stringify({origin,pointId:point.id,templates:items.length}));
}
