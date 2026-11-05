import {moveSequence,sequenceDuration,durationLabel,matchesLibrary} from './editor-utils.js';
export function playlistEditor({api,modal,state,escapeHtml:e,mediaPreview,contentLabel,icon}){
 const durations=new Map();let generation=0,cleanups=[],dragId=null,previewItems='';
 function invalidatePreview(){const stage=modal.querySelector('#editor-preview');if(stage?.querySelector('iframe')&&previewItems!==JSON.stringify(state.editingItems)){stage.replaceChildren();stage.textContent='Sequência alterada. Abra a prévia novamente para conferir.';}}
 function summary(){const seen=new Set();const flatten=items=>items.flatMap(item=>{if(!item.playlistId)return [item];if(seen.has(item.playlistId))throw new Error('Referência circular');seen.add(item.playlistId);const child=state.playlists.find(p=>p.id===item.playlistId);const result=flatten(child?.items||[]);seen.delete(item.playlistId);return result;});try{const rows=flatten(state.editingItems),total=sequenceDuration(rows,state.media,durations);modal.querySelector('#sequence-summary').textContent=state.editingItems.length+' entradas · '+rows.length+' itens expandidos · '+durationLabel(total.seconds)+(total.unknown?' conhecidos · '+total.unknown+' sem duração confirmada':' no total');}catch(error){modal.querySelector('#sequence-summary').textContent=error.message;}}
 function bind(){
  const own=++generation;dragId=null;
  modal.querySelector('#editor-search').oninput=render;
  modal.querySelector('#preview-sequence').onclick=async()=>{
   const stage=modal.querySelector('#editor-preview'),old=stage.querySelector('iframe');old?.remove();
   if(!state.editingItems.length){stage.textContent='Adicione conteúdos para visualizar a sequência.';return;}
   if(state.editingItems.some(item=>!item.playlistId&&state.media.find(m=>m.id===item.mediaId)?.kind!=='video'&&(!Number.isInteger(Number(item.seconds))||Number(item.seconds)<1||Number(item.seconds)>3600))){stage.textContent='Informe durações de 1 a 3.600 segundos antes de visualizar.';return;}
   stage.replaceChildren();const frame=document.createElement('iframe');frame.title='Prévia da sequência';frame.src='/preview';
   previewItems=JSON.stringify(state.editingItems);
   let snapshot;try{snapshot=await api('/api/playlists/preview',{method:'POST',body:JSON.stringify({id:state.editingPlaylistId||undefined,name:modal.querySelector('[name=name]').value,items:state.editingItems})});}catch(error){stage.textContent=error.message;return;}if(!stage.isConnected)return;
   frame.onload=()=>{if(frame.isConnected)frame.contentWindow.postMessage({type:'videowall-preview',snapshot},location.origin);};stage.append(frame);
  };
  const dispose=()=>{generation++;for(const fn of cleanups.splice(0))fn();modal.querySelector('#editor-preview')?.replaceChildren();};
  modal.addEventListener('close',dispose,{once:true});
  const library=modal.querySelector('#library-list');const chooser=document.createElement('div');chooser.className='subplaylist-picker';chooser.innerHTML=`<label class="field">Inserir subplaylist<select aria-label="Subplaylist"><option value="">Escolha uma playlist</option>${state.playlists.filter(p=>p.id!==state.editingPlaylistId).map(p=>`<option value="${e(p.id)}" ${p.schedule?.enabled?'disabled':''}>${e(p.name)}${p.schedule?.enabled?' · agenda própria':''}</option>`).join('')}</select></label><button type="button" class="btn small">Adicionar subplaylist</button><small>Executa a sequência inteira. A agenda da playlist principal prevalece; desative a agenda da filha antes de inserir.</small>`;library.before(chooser);chooser.querySelector('button').onclick=()=>{const id=chooser.querySelector('select').value;if(id){state.editingItems.push({id:crypto.randomUUID(),playlistId:id});render();}};
  const queue=state.media.filter(item=>item.kind==='video'&&!durations.has(item.id));let next=0;
  async function worker(){
   while(own===generation&&next<queue.length){const item=queue[next++];await new Promise(resolve=>{
    const video=document.createElement('video');let done=false,timeout;
    const finish=value=>{if(done)return;done=true;clearTimeout(timeout);video.onloadedmetadata=video.onerror=null;video.removeAttribute('src');video.load();cleanups=cleanups.filter(fn=>fn!==cancel);if(Number.isFinite(value)&&value>0)durations.set(item.id,value);if(own===generation&&modal.open)summary();resolve();};
    const cancel=()=>finish(null);cleanups.push(cancel);video.preload='metadata';video.muted=true;video.onloadedmetadata=()=>finish(video.duration);video.onerror=cancel;timeout=setTimeout(cancel,15000);video.src=item.url;
   });}
  }
  for(let index=0;index<3;index++)void worker();
 }
 function render(){
  invalidatePreview();
  const selected=new Set(state.editingItems.map(item=>item.mediaId)),query=modal.querySelector('#editor-search').value,rows=state.media.filter(item=>matchesLibrary(item,query));
  modal.querySelector('#library-list').innerHTML=rows.length?rows.map(media=>`<div class="library-row">${mediaPreview(media)}<div class="library-row-text"><strong>${e(media.name)}</strong><small>${media.kind==='video'?'Vídeo · duração do arquivo':e(contentLabel(media.kind))+' · duração configurável'}</small></div><button class="icon-button" type="button" data-add-item="${media.id}" title="${selected.has(media.id)?'Adicionar novamente':'Adicionar'}">${icon('plus')}</button></div>`).join(''):'<p class="empty compact">Nenhum conteúdo encontrado.</p>';
  modal.querySelector('#sequence-list').innerHTML=state.editingItems.length?state.editingItems.map((item,index)=>{
   const media=item.playlistId?{id:item.playlistId,name:state.playlists.find(p=>p.id===item.playlistId)?.name||'Subplaylist removida',kind:'subplaylist'}:state.media.find(m=>m.id===item.mediaId);
   return `<div class="sequence-row" data-sequence-id="${item.id}"><button type="button" class="drag-handle" draggable="true" data-drag-item="${item.id}" aria-label="Arrastar ${e(media?.name||'conteúdo')}" title="Arraste para mudar a ordem">⠿</button><span class="sequence-number">${index+1}</span>${item.playlistId?'<span class="subplaylist-icon">'+icon('list')+'</span>':mediaPreview(media)}<div class="sequence-text"><strong>${e(media?.name||'Conteúdo removido')}</strong>${item.playlistId?'<small>Subplaylist · sequência completa</small>':media?.kind!=='video'?`<label class="duration-wrap">exibir <input type="number" data-duration="${item.id}" min="1" max="3600" value="${item.seconds}"> s</label>`:'<small>Vídeo completo</small>'}</div><span class="reorder"><button type="button" class="icon-button" data-move-item="${item.id}" data-direction="-1" ${index?'':'disabled'} title="Subir">↑</button><button type="button" class="icon-button" data-move-item="${item.id}" data-direction="1" ${index<state.editingItems.length-1?'':'disabled'} title="Descer">↓</button><button type="button" class="icon-button danger" data-remove-item="${item.id}" title="Remover">${icon('trash')}</button></span></div>`;
  }).join(''):'<p class="empty compact">Adicione conteúdos pela biblioteca.</p>';
  modal.querySelector('#sequence-count').textContent=state.editingItems.length;summary();
  for(const button of modal.querySelectorAll('[data-add-item]'))button.onclick=()=>{const media=state.media.find(m=>m.id===button.dataset.addItem);state.editingItems.push({id:crypto.randomUUID(),mediaId:media.id,seconds:media.kind==='video'?0:10});render();};
  for(const button of modal.querySelectorAll('[data-remove-item]'))button.onclick=()=>{state.editingItems=state.editingItems.filter(item=>item.id!==button.dataset.removeItem);render();};
  for(const button of modal.querySelectorAll('[data-move-item]'))button.onclick=()=>{const index=state.editingItems.findIndex(item=>item.id===button.dataset.moveItem),target=index+Number(button.dataset.direction);if(target<0||target>=state.editingItems.length)return;state.editingItems=moveSequence(state.editingItems,state.editingItems[index].id,state.editingItems[target].id,target>index);render();};
  for(const input of modal.querySelectorAll('[data-duration]'))input.oninput=()=>{state.editingItems.find(item=>item.id===input.dataset.duration).seconds=Number(input.value);summary();invalidatePreview();};
  for(const handle of modal.querySelectorAll('[data-drag-item]')){handle.ondragstart=event=>{dragId=handle.dataset.dragItem;event.dataTransfer.effectAllowed='move';event.dataTransfer.setData('text/plain',dragId);};handle.ondragend=()=>{dragId=null;for(const row of modal.querySelectorAll('.drop-target'))row.classList.remove('drop-target');};}
  for(const row of modal.querySelectorAll('[data-sequence-id]')){
   row.ondragover=event=>{if(!dragId)return;event.preventDefault();row.classList.add('drop-target');};row.ondragleave=()=>row.classList.remove('drop-target');
   row.ondrop=event=>{if(!dragId)return;event.preventDefault();state.editingItems=moveSequence(state.editingItems,dragId,row.dataset.sequenceId,event.clientY>row.getBoundingClientRect().top+row.getBoundingClientRect().height/2);dragId=null;render();};
  }
 }
 return {bind,render};
}
