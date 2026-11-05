const ROOT='/api/image-bank';
const MAX_IMPORT_BYTES=16*1024*1024;
const referenceBanks=[
  ['Designi','https://www.designi.com.br/busca/supermercado'],
  ['Pngtree','https://pt.pngtree.com/free-png-vectors/supermercado'],
  ['Vecteezy','https://pt.vecteezy.com/png-gratis/supermercado'],
  ['PNGWing','https://www.pngwing.com/pt/search?q=supermercado'],
  ['Shutterstock','https://www.shutterstock.com/pt/search/shopping-bucket']
];
const runLabels={running:'Sincronizando',paused:'Pausado',incomplete:'Incompleto',completed:'Concluído'};
const itemLabels={ready:'Disponível',pending:'Aguardando download',failed:'Falha no download',error:'Falha',blocked:'Sem permissão',imported:'Importada'};
const formatBytes=value=>{const size=Number(value)||0;return size<1024*1024?`${Math.ceil(size/1024)} KB`:`${(size/(1024*1024)).toFixed(1)} MB`;};
const count=value=>new Intl.NumberFormat('pt-BR').format(Number(value)||0);
const aborted=error=>error?.name==='AbortError';
const scopedCopyDone=run=>run?.source==='search'&&run.status==='incomplete'&&run.scopes?.every(scope=>scope.status==='completed')&&Number(run.downloaded)===Number(run.discovered)&&!Number(run.failed);

export function imageBankUi({api,escapeHtml:e,toast=()=>{},onMediaImported=()=>{}}){
  let panel=null;
  const post=(path,body={},options={})=>api(ROOT+path,{method:'POST',body:JSON.stringify(body),...options});
  const statusValue=value=>value?.counts?value:value?.status?.counts?value.status:null;
  const revision=value=>JSON.stringify([value?.counts,value?.run]);

  function dialogWindow(title,{parentDialog,className='',onClose=()=>{}}={}){
    const dialog=document.createElement('dialog');dialog.className=`image-bank-dialog ${className}`;
    dialog.setAttribute('aria-label',title);
    dialog.innerHTML=`<div class="modal-head"><h2>${e(title)}</h2><button type="button" class="icon-button" data-bank-close aria-label="Fechar ${e(title)}">×</button></div><div class="image-bank-dialog-body"></div>`;
    const controller=new AbortController(),cleanups=[];let disposed=false;
    const finish=()=>{if(disposed)return;disposed=true;controller.abort();for(const cleanup of cleanups)cleanup();parentDialog?.removeEventListener('close',close);dialog.remove();onClose();};
    const close=()=>{if(dialog.open)dialog.close();finish();};
    dialog.addEventListener('close',finish,{once:true});
    dialog.addEventListener('keydown',event=>{if(event.key==='Escape')event.stopPropagation();});
    dialog.addEventListener('click',event=>{if(event.target===dialog||event.target.closest('[data-bank-close]'))close();});
    parentDialog?.addEventListener('close',close,{once:true});
    document.body.append(dialog);dialog.showModal();
    return {dialog,body:dialog.querySelector('.image-bank-dialog-body'),signal:controller.signal,alive:()=>!disposed&&dialog.isConnected,close,cleanup:fn=>cleanups.push(fn)};
  }

  function paintStatus(host,status,loading=false){
    if(!status){host.innerHTML=`<p class="image-bank-note">${loading?'Carregando conexão e progresso…':'Não foi possível carregar o banco de imagens.'}</p>`;return;}
    const connection=status.connection||{},stats=status.counts||{},run=status.run;const scopes=run?.scopes||[],finished=scopes.filter(scope=>scope.status==='completed').length;const visibleScopes=[...scopes.filter(scope=>!['pending','completed'].includes(scope.status)),...scopes.filter(scope=>scope.status==='completed').slice(-5),...scopes.filter(scope=>scope.status==='pending').slice(0,3)].slice(0,12);
    host.innerHTML=`<div class="image-bank-status-head"><div><span class="image-bank-connection ${connection.connected?'is-connected':''}">${connection.connected?'Conectado':'Desconectado'}</span>${connection.connected&&connection.login?`<span class="image-bank-login">${e(connection.login)}</span>`:''}</div><span class="image-bank-run-state ${run?.status==='running'?'is-running':''}">${run?e(scopedCopyDone(run)?'Resultados copiados':runLabels[run.status]||run.status):'Nenhuma sincronização iniciada'}</span></div><div class="image-bank-metrics">${[['Imagens no catálogo',stats.items],['Disponíveis',stats.ready],['Pendentes',stats.pending],['Com falha',stats.failed],['Arquivos únicos',stats.blobs]].map(([label,value])=>`<div><strong>${count(value)}</strong><span>${label}</span></div>`).join('')}<div><strong>${formatBytes(stats.bytes)}</strong><span>Armazenados localmente</span></div></div>${run?`<div class="image-bank-progress"><div><strong>${e(run.source==='search'?(run.automatic?'Busca automática de produtos':'Cópia por busca de produtos'):run.source==='export'?'Importação de arquivo':'Sincronização do banco')}</strong><span>${count(run.downloaded)} baixadas · ${count(run.discovered)} descobertas · ${count(run.duplicates)} duplicatas · ${count(run.failed)} falhas</span></div><progress max="${Math.max(1,Number(run.discovered)||0,Number(run.downloaded)||0)}" value="${Number(run.downloaded)||0}" aria-label="Progresso dos downloads"></progress><p>${run.enumerationComplete?'Listagem da origem concluída.':scopedCopyDone(run)?'Todas as consultas deste lote foram concluídas. A cobertura total do acervo remoto não foi verificada.':'A listagem da origem ainda não foi concluída.'} ${formatBytes(run.bytes)} processados.</p>${run.error?`<p class="${scopedCopyDone(run)?'image-bank-note':'form-error'}">${e(run.error)}</p>`:''}${run.scopes?.length?`<p>${count(finished)} de ${count(scopes.length)} consultas concluídas.</p><ul class="image-bank-scopes">${visibleScopes.map(scope=>`<li><strong>${e(scope.label||scope.id)}</strong><span>${e(runLabels[scope.status]||itemLabels[scope.status]||scope.status||'Aguardando')} · ${count(scope.count)} imagens</span>${scope.error?`<small>${e(scope.error)}</small>`:''}</li>`).join('')}</ul>`:''}</div>`:''}`;
  }

  function connectDialog({parentDialog,onDone=()=>{}}={}){
    const window=dialogWindow('Conectar banco de imagens',{parentDialog,className:'image-bank-connect-dialog'});
    window.body.innerHTML='<form class="image-bank-connect-form" autocomplete="off"><p class="image-bank-note">Entre com o acesso autorizado ao banco de imagens. A senha não fica gravada neste formulário.</p><label class="field"><span>Login</span><input name="login" required maxlength="320" autocomplete="off" autocapitalize="none" spellcheck="false"></label><label class="field"><span>Senha</span><input name="password" type="password" required maxlength="256" autocomplete="off"></label><p class="form-error" role="alert"></p><div class="image-bank-dialog-actions"><button type="button" class="btn" data-bank-close>Cancelar</button><button type="submit" class="btn primary">Conectar</button></div></form>';
    const form=window.body.querySelector('form'),button=form.querySelector('[type=submit]'),error=form.querySelector('.form-error');
    form.addEventListener('submit',async event=>{
      event.preventDefault();event.stopPropagation();if(button.disabled)return;
      const login=form.elements.login.value.trim(),password=form.elements.password.value;
      button.disabled=true;error.textContent='';
      try{await post('/connect',{login,password},{signal:window.signal});form.elements.password.value='';if(!window.alive())return;window.close();await onDone();toast('Banco de imagens conectado.');}
      catch(failure){if(window.alive()&&!aborted(failure))error.textContent=failure.message;}
      finally{form.elements.password.value='';if(window.alive())button.disabled=false;}
    });
    window.cleanup(()=>{form.elements.login.value='';form.elements.password.value='';});
    form.elements.login.focus();return window;
  }

  function importDialog({parentDialog,onDone=()=>{}}={}){
    const window=dialogWindow('Importar lista de imagens',{parentDialog,className:'image-bank-import-dialog'});
    window.body.innerHTML='<form class="image-bank-import-form"><p class="image-bank-note">Escolha uma exportação JSON ou CSV, ou cole o conteúdo. O arquivo pode ter até 16 MB. As imagens serão preparadas localmente pelo banco.</p><label class="field"><span>Arquivo JSON ou CSV</span><input type="file" accept=".json,.csv,application/json,text/csv" data-bank-import-file></label><label class="field"><span>Ou cole o JSON / CSV</span><textarea rows="9" maxlength="16777216" data-bank-import-text spellcheck="false" placeholder="nome;url&#10;Produto;https://bucket.musardos.com/..."></textarea></label><p class="image-bank-note" data-bank-import-filename></p><p class="form-error" role="alert"></p><div class="image-bank-dialog-actions"><button type="button" class="btn" data-bank-close>Cancelar</button><button type="submit" class="btn primary">Importar e preparar imagens</button></div></form>';
    const form=window.body.querySelector('form'),fileInput=form.querySelector('input'),text=form.querySelector('textarea'),error=form.querySelector('.form-error'),button=form.querySelector('[type=submit]');let filename='imagens.json',reading=false,fileRead=0;
    fileInput.addEventListener('change',async()=>{
      const file=fileInput.files?.[0],own=++fileRead;reading=false;button.disabled=false;if(!file)return;error.textContent='';
      if(file.size>MAX_IMPORT_BYTES){error.textContent='Escolha um arquivo de até 16 MB.';fileInput.value='';text.value='';filename='imagens.json';form.querySelector('[data-bank-import-filename]').textContent='';return;}
      reading=true;button.disabled=true;
      try{const contents=await file.text();if(!window.alive()||own!==fileRead)return;text.value=contents;filename=file.name;form.querySelector('[data-bank-import-filename]').textContent=`${file.name} · ${formatBytes(file.size)}`;}
      catch(failure){if(window.alive())error.textContent='Não foi possível ler o arquivo selecionado.';}
      finally{if(window.alive()&&own===fileRead){reading=false;button.disabled=false;}}
    });
    form.addEventListener('submit',async event=>{
      event.preventDefault();event.stopPropagation();if(reading||button.disabled)return;error.textContent='';
      if(!text.value.trim()){error.textContent='Escolha um arquivo ou cole a lista de imagens.';return;}
      if(new TextEncoder().encode(text.value).byteLength>MAX_IMPORT_BYTES){error.textContent='A lista aceita no máximo 16 MB.';return;}
      if(!fileInput.files?.length)filename=/^\s*[\[{]/.test(text.value)?'imagens.json':'imagens.csv';
      button.disabled=true;fileInput.disabled=true;text.disabled=true;
      try{await post('/import',{filename,text:text.value},{signal:window.signal});if(!window.alive())return;window.close();await onDone();toast('Importação iniciada. Acompanhe o progresso no banco de imagens.');}
      catch(failure){if(window.alive()&&!aborted(failure))error.textContent=failure.message;}
      finally{if(window.alive()){button.disabled=false;fileInput.disabled=false;text.disabled=false;}}
    });
    return window;
  }

  function productListDialog({onDone=async()=>{}}={}){
    const window=dialogWindow('Buscar fotos de uma lista de produtos',{className:'image-bank-import-dialog'});
    window.body.innerHTML='<form><p class="image-bank-note">Importe ListaPreco.txt ou CSV com a coluna nome. Somente os nomes entram na fila de fotos; preços, quantidades e produtos cadastrados não serão alterados. Arquivo de até 2 MB.</p><label class="field"><span>Lista de produtos TXT / CSV</span><input type="file" accept=".txt,.csv,text/plain,text/csv" data-products-file></label><label class="field"><span>Ou cole a lista de produtos</span><textarea rows="8" data-products-text spellcheck="false"></textarea></label><p class="form-error" role="alert"></p><div class="image-bank-dialog-actions"><button type="button" class="btn" data-bank-close>Cancelar</button><button class="btn primary" type="submit">Importar lista e buscar fotos</button></div></form>';
    const form=window.body.querySelector('form'),input=form.querySelector('input'),text=form.querySelector('textarea'),error=form.querySelector('.form-error'),button=form.querySelector('[type=submit]');let filename='Lista de produtos',reading=false,generation=0;
    input.addEventListener('change',async()=>{
      const own=++generation,file=input.files?.[0];if(!file){reading=false;button.disabled=false;return;}text.value='';filename='Lista de produtos';
      error.textContent='';if(file.size>2*1024*1024){input.value='';text.value='';reading=false;button.disabled=false;error.textContent='Use um arquivo de até 2 MB.';return;}
      reading=true;button.disabled=true;
      try{const bytes=await file.arrayBuffer();let contents;try{contents=new TextDecoder('utf-8',{fatal:true}).decode(bytes);}catch{contents=new TextDecoder('windows-1252').decode(bytes);}if(!window.alive()||own!==generation)return;text.value=contents;filename=file.name;}
      catch(failure){if(window.alive()&&own===generation)error.textContent='Não foi possível ler o arquivo.';}
      finally{if(window.alive()&&own===generation){reading=false;button.disabled=false;}}
    },{signal:window.signal});
    form.addEventListener('submit',async event=>{
      event.preventDefault();if(reading)return;button.disabled=true;error.textContent='';
      try{const result=await post('/product-list',{filename,text:text.value},{signal:window.signal});if(!window.alive())return;window.close();await onDone();toast(count(result.list.records)+' linhas importadas: '+count(result.list.distinct)+' nomes distintos; '+count(result.list.alreadySearched)+' já constam no histórico. A fila está salva.');}
      catch(failure){if(window.alive()&&!aborted(failure))error.textContent=failure.message;}
      finally{if(window.alive())button.disabled=false;}
    },{signal:window.signal});return window;
  }

  function referenceLinks(){
    return `<details class="image-bank-references"><summary>Outros bancos de imagens</summary><p class="image-bank-note">Abra uma referência em nova aba para escolher imagens. Confira a licença de uso do arquivo; após baixar, use Conteúdos → Enviar arquivo para guardá-lo no projeto e selecioná-lo no editor.</p><nav class="image-bank-actions" aria-label="Referências de bancos de imagens">${referenceBanks.map(([name,url])=>`<a class="btn small" href="${e(url)}" target="_blank" rel="noopener noreferrer">${e(name)} ↗</a>`).join('')}</nav><p class="image-bank-note">Estes atalhos abrem sites externos. A busca e a cópia automáticas deste painel usam o Musardos conectado.</p></details>`;
  }

  function gallery(host,{signal,isAlive=()=>host.isConnected,selectLabel='Adicionar à biblioteca',onSelect=()=>{},initialQuery='',compact=false}={}){
    let page=1,term=initialQuery,filter='ready',request=0,controller=null,selecting=false,lastResult={items:[],total:0,page:1,pageSize:24};
    host.innerHTML=`<form class="image-bank-search"><label class="field"><span>Pesquisar por produto ou marca</span><input type="search" maxlength="160" placeholder="Ex.: queijo, linguiça Aurora" value="${e(term)}" autocomplete="off" data-bank-search></label>${compact?'':`<label class="field image-bank-filter"><span>Estado</span><select aria-label="Estado das imagens"><option value="ready">Disponíveis</option><option value="all">Todas</option><option value="pending">Pendentes</option><option value="failed">Com falha</option></select></label>`}<button class="btn" type="submit">Pesquisar local</button><button class="btn" type="button" data-bank-search-remote>Buscar e copiar do Musardos</button></form><p class="image-bank-note">A busca Musardos copia os resultados para uso local. Requer conexão da conta e não garante cobertura do acervo inteiro.</p>${referenceLinks()}<p class="form-error" role="alert"></p><p class="image-bank-gallery-summary" role="status"></p><div class="image-bank-gallery"></div><div class="image-bank-pagination"><button type="button" class="btn" data-bank-prev>Anterior</button><span></span><button type="button" class="btn" data-bank-next>Próxima</button></div>`;
    const form=host.querySelector('form'),grid=host.querySelector('.image-bank-gallery'),error=host.querySelector('.form-error'),summary=host.querySelector('[role=status]'),pagination=host.querySelector('.image-bank-pagination');
    const buttons=()=>{pagination.querySelector('[data-bank-prev]').disabled=page<=1;pagination.querySelector('[data-bank-next]').disabled=page*(lastResult.pageSize||24)>=lastResult.total;pagination.querySelector('span').textContent=`Página ${page} de ${Math.max(1,Math.ceil(lastResult.total/(lastResult.pageSize||24)))}`;};
    function paint(){
      summary.textContent=`${count(lastResult.total)} imagem(ns) ${filter==='ready'?'disponível(is)':'encontrada(s)'}`;
      grid.innerHTML=lastResult.items.length?lastResult.items.map(item=>{
        const ready=item.status==='ready',src=`${ROOT}/items/${encodeURIComponent(String(item.id))}/image`;
        return `<article class="image-bank-photo"><div class="image-bank-photo-preview">${ready?`<img src="${e(src)}" alt="${e(item.name||item.filename||'Imagem do produto')}" loading="lazy">`:`<span>${e(itemLabels[item.status]||item.status||'Aguardando')}</span>`}</div><div class="image-bank-photo-info"><strong title="${e(item.name||item.filename)}">${e(item.name||item.filename||'Imagem sem nome')}</strong>${item.brand?`<small>${e(item.brand)}</small>`:''}<small>${e(item.filename||'')} · ${formatBytes(item.size)}</small><button type="button" class="btn small" data-bank-select="${e(item.id)}" ${ready?'':'disabled'}>${e(selectLabel)}</button></div></article>`;
      }).join(''):'<div class="image-bank-empty"><strong>Nenhuma imagem nesta busca</strong><p>Altere o nome ou a marca. Para disponibilizar fotos, sincronize o banco ou importe uma lista.</p></div>';
      for(const image of grid.querySelectorAll('img'))image.addEventListener('error',()=>{const replacement=document.createElement('span');replacement.textContent='Prévia indisponível';image.replaceWith(replacement);},{once:true});buttons();
    }
    async function load({quiet=false}={}){
      if(!isAlive()||signal?.aborted)return;const own=++request;controller?.abort();controller=new AbortController();error.textContent='';if(!quiet)summary.textContent='Carregando imagens…';
      try{const result=await api(`${ROOT}/items?q=${encodeURIComponent(term)}&page=${page}&status=${filter}`,{signal:controller.signal});if(!isAlive()||own!==request||signal?.aborted)return;lastResult={...result,items:Array.isArray(result.items)?result.items:[]};if(page>1&&!lastResult.items.length&&lastResult.total){page=Math.max(1,Math.ceil(lastResult.total/(lastResult.pageSize||24)));return load();}paint();}
      catch(failure){if(isAlive()&&own===request&&!aborted(failure)){error.textContent=failure.message;summary.textContent='Não foi possível atualizar as imagens.';}}
    }
    form.addEventListener('submit',event=>{event.preventDefault();event.stopPropagation();term=form.querySelector('input').value.trim();filter=form.querySelector('select')?.value||'ready';page=1;void load();},{signal});
    form.querySelector('[data-bank-search-remote]').addEventListener('click',async event=>{
      const button=event.currentTarget;button.disabled=true;error.textContent='';
      try{const q=form.querySelector('input').value.trim();await post('/search',{q},{signal});if(!isAlive())return;term=q;page=1;toast('Busca iniciada. As fotos aparecerão após o download.');await load();}
      catch(failure){if(isAlive()&&!aborted(failure))error.textContent=failure.message;}
      finally{if(isAlive())button.disabled=false;}
    },{signal});
    form.querySelector('select')?.addEventListener('change',()=>{filter=form.querySelector('select').value;page=1;void load();},{signal});
    pagination.querySelector('[data-bank-prev]').addEventListener('click',()=>{if(page>1){page--;void load();}},{signal});
    pagination.querySelector('[data-bank-next]').addEventListener('click',()=>{if(page*(lastResult.pageSize||24)<lastResult.total){page++;void load();}},{signal});
    grid.addEventListener('click',async event=>{
      const button=event.target.closest('[data-bank-select]');if(!button||button.disabled||selecting)return;const item=lastResult.items.find(item=>String(item.id)===button.dataset.bankSelect);if(!item)return;
      selecting=true;for(const choice of grid.querySelectorAll('[data-bank-select]'))choice.disabled=true;error.textContent='';
      try{const media=await post(`/items/${encodeURIComponent(item.id)}/select`,{},{signal});if(!isAlive()||signal?.aborted)return;if(!media?.id||media.kind!=='image')throw new Error('O banco não retornou uma imagem válida.');await onMediaImported(media);await onSelect(media);}
      catch(failure){if(isAlive()&&!aborted(failure))error.textContent=failure.message;}
      finally{selecting=false;if(isAlive())for(const choice of grid.querySelectorAll('[data-bank-select]'))choice.disabled=lastResult.items.find(item=>String(item.id)===choice.dataset.bankSelect)?.status!=='ready';}
    },{signal});
    const dispose=()=>{request++;controller?.abort();};signal?.addEventListener('abort',dispose,{once:true});buttons();void load();return {reload:()=>load({quiet:true}),dispose};
  }

  async function exportCatalog(type,button,error,alive,signal){
    button.disabled=true;error.textContent='';
    try{
      const items=[];let page=1,total=Infinity;
      while(items.length<total){const result=await api(`${ROOT}/items?page=${page}&status=all`,{signal});if(!alive())return;const batch=Array.isArray(result.items)?result.items:[];items.push(...batch);total=Number(result.total)||0;if(!batch.length||items.length>=total)break;page++;}
      const records=items.map(item=>({name:item.name||item.filename||'',url:item.sourceUrl||'',filename:item.filename||'',...(item.brand?{brand:item.brand}:{})}));
      const quote=value=>'"'+String(value??'').replaceAll('"','""')+'"';
      const text=type==='json'?JSON.stringify(records,null,2):'\uFEFFnome;url;arquivo;marca\r\n'+records.map(item=>[item.name,item.url,item.filename,item.brand||''].map(quote).join(';')).join('\r\n');
      const blob=new Blob([text],{type:type==='json'?'application/json;charset=utf-8':'text/csv;charset=utf-8'}),url=URL.createObjectURL(blob),link=document.createElement('a');link.href=url;link.download=`banco-de-imagens.${type}`;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
      toast(`${count(records.length)} imagens exportadas em ${type.toUpperCase()}.`);
    }catch(failure){if(alive()&&!aborted(failure))error.textContent=failure.message;}
    finally{if(alive())button.disabled=false;}
  }

  function mountPanel(host,{heading=''}={}){
    disposePanel();const controller=new AbortController(),signal=controller.signal;let timer=null,status=null,lastRevision='',statusBusy=false,disposed=false,automaticBusy=false;
    const ownedDialogs=new Set(),alive=()=>!disposed&&host.isConnected;
    host.innerHTML=`${heading}<section class="card image-bank-card"><div data-bank-status></div><div class="image-bank-actions"><button type="button" class="btn" data-bank-action="connect">Conectar</button><button type="button" class="btn primary" data-bank-action="sync" disabled>Atualizar biblioteca</button><button type="button" class="btn" data-bank-action="search-catalog" disabled>Copiar fotos do catálogo</button><button type="button" class="btn" data-bank-action="pause" disabled>Pausar</button><button type="button" class="btn" data-bank-action="resume" disabled>Retomar</button><button type="button" class="btn" data-bank-action="disconnect" disabled>Desconectar</button></div><div class="image-bank-automation"><div class="image-bank-actions"><button type="button" class="btn" data-bank-products>Buscar fotos de uma lista TXT / CSV</button><button type="button" class="btn" data-bank-retry>Retentar buscas com falha</button></div><label class="image-bank-note"><input type="checkbox" data-bank-automatic> Buscar e salvar fotos automaticamente para produtos novos</label><p class="image-bank-note">Após salvar um produto ou confirmar uma importação, os nomes ainda não pesquisados terão suas fotos copiadas para este projeto. Funciona com a conta Musardos conectada. A escolha da foto usada na peça continua manual.</p><p class="image-bank-note" data-bank-automatic-status role="status"></p></div><p class="form-error" data-bank-operation-error role="alert"></p><p class="image-bank-note">As fotos disponíveis ficam armazenadas neste servidor. Escolha uma foto no editor para vinculá-la ao produto e publique a playlist para enviá-la às TVs.</p></section><section class="card image-bank-card"><div class="image-bank-section-head"><div><h2>Lista de imagens</h2><p>Importe ou exporte o catálogo em JSON ou CSV.</p></div><div class="image-bank-actions"><button type="button" class="btn" data-bank-import>Importar JSON / CSV</button><button type="button" class="btn" data-bank-export="json">Exportar JSON</button><button type="button" class="btn" data-bank-export="csv">Exportar CSV</button></div></div></section><section class="card image-bank-card"><div data-bank-gallery></div></section>`;
    const statusHost=host.querySelector('[data-bank-status]'),error=host.querySelector('[data-bank-operation-error]');
    const photos=gallery(host.querySelector('[data-bank-gallery]'),{signal,isAlive:alive,onSelect:media=>toast(`“${media.name}” disponível na biblioteca.`)});
    paintStatus(statusHost,null,true);
    const controls=()=>{const connected=!!status?.connection?.connected,run=status?.run;const automatic=status?.automatic||{},box=host.querySelector('[data-bank-automatic]');host.querySelector('[data-bank-retry]').disabled=automaticBusy||!connected||!automatic.enabled||!automatic.failed;if(!automaticBusy)box.checked=!!automatic.enabled;box.disabled=automaticBusy;const modes={disabled:'Desativada','waiting-connection':'Aguardando conexão Musardos',paused:'Pausada — use Retomar',busy:'Aguardando a cópia atual',running:'Pesquisando e salvando fotos',queued:'Novos produtos aguardando busca',idle:'Nenhum nome novo para pesquisar'};host.querySelector('[data-bank-automatic-status]').textContent=(modes[automatic.state]||'Carregando automação…')+' · '+count(automatic.pending)+' buscas na fila · '+count(automatic.failed)+' buscas com falha'+(automatic.lastError?' · '+automatic.lastError:'');host.querySelector('[data-bank-action=connect]').textContent=connected?'Trocar conexão':'Conectar';host.querySelector('[data-bank-action=sync]').disabled=!connected||run?.status==='running';host.querySelector('[data-bank-action=search-catalog]').disabled=!connected||run?.status==='running';host.querySelector('[data-bank-action=pause]').disabled=run?.status!=='running';host.querySelector('[data-bank-action=resume]').disabled=!['paused','incomplete'].includes(run?.status);host.querySelector('[data-bank-action=disconnect]').disabled=!connected;};
    async function loadStatus(){
      if(!alive()||statusBusy)return;statusBusy=true;
      try{const value=await api(ROOT,{signal});if(!alive())return;status=statusValue(value);paintStatus(statusHost,status);controls();const next=revision(status);if(lastRevision&&lastRevision!==next)void photos.reload();lastRevision=next;}
      catch(failure){if(alive()&&!aborted(failure))error.textContent=failure.message;}
      finally{statusBusy=false;}
    }
    host.querySelector('[data-bank-automatic]').addEventListener('change',async event=>{
      automaticBusy=true;const enabled=event.target.checked;controls();error.textContent='';
      try{const response=await post('/automatic',{enabled},{signal});if(!alive())return;status=statusValue(response);paintStatus(statusHost,status);toast(enabled?'Busca automática ativada. Conecte a conta Musardos para pesquisar novos nomes.':'Busca automática pausada.');}
      catch(failure){if(alive()&&!aborted(failure))error.textContent=failure.message;}
      finally{automaticBusy=false;if(alive()){controls();await loadStatus();}}
    },{signal});
    function track(window){ownedDialogs.add(window);window.cleanup(()=>ownedDialogs.delete(window));return window;}
    host.addEventListener('click',async event=>{
      const action=event.target.closest('[data-bank-action]'),importButton=event.target.closest('[data-bank-import]'),exportButton=event.target.closest('[data-bank-export]');
      if(event.target.closest('[data-bank-products]')){track(productListDialog({onDone:async()=>{await loadStatus();await photos.reload();}}));return;}
      if(event.target.closest('[data-bank-retry]')){const button=event.target.closest('[data-bank-retry]');if(button.disabled)return;button.disabled=true;try{const result=await post('/automatic/retry',{}, {signal});await loadStatus();toast(count(result.retryQueued)+' buscas agendadas para nova tentativa.');}catch(failure){if(alive()&&!aborted(failure))error.textContent=failure.message;}return;}
      if(importButton){track(importDialog({onDone:async()=>{await loadStatus();await photos.reload();}}));return;}
      if(exportButton){void exportCatalog(exportButton.dataset.bankExport,exportButton,error,alive,signal);return;}
      if(!action||action.disabled)return;
      if(action.dataset.bankAction==='connect'){track(connectDialog({onDone:loadStatus}));return;}
      action.disabled=true;error.textContent='';
      try{const response=await post(action.dataset.bankAction==='search-catalog'?'/search':'/'+action.dataset.bankAction,action.dataset.bankAction==='search-catalog'?{catalog:true}:{}, {signal});if(!alive())return;const value=statusValue(response);if(value){status=value;paintStatus(statusHost,status);}await loadStatus();await photos.reload();}
      catch(failure){if(alive()&&!aborted(failure))error.textContent=failure.message;}
      finally{if(alive())controls();}
    },{signal});
    const poll=async()=>{if(!alive()){dispose();return;}await loadStatus();if(alive())timer=setTimeout(poll,2000);};
    const dispose=()=>{if(disposed)return;disposed=true;clearTimeout(timer);controller.abort();photos.dispose();for(const window of [...ownedDialogs])window.close();};
    panel={dispose};void poll();return panel;
  }

  function disposePanel(){panel?.dispose();panel=null;}

  function pick({query='',parentDialog,isAlive=()=>true,onSelect=()=>{}}={}){
    const window=dialogWindow('Escolher foto real do produto',{parentDialog,className:'image-bank-picker-dialog'});let timer=null,status=null,lastRevision='';
    const alive=()=>window.alive()&&isAlive();
    window.body.innerHTML='<p class="image-bank-note">Pesquise pelo produto e pela marca e escolha a embalagem correta. A foto selecionada será adicionada à biblioteca local.</p><div class="image-bank-picker-toolbar"><span data-bank-picker-status role="status">Carregando banco…</span><div><button type="button" class="btn small" data-bank-picker-connect>Conectar</button><button type="button" class="btn small" data-bank-picker-sync disabled>Sincronizar banco</button><button type="button" class="btn small" data-bank-picker-refresh>Atualizar</button></div></div><p class="form-error" data-bank-picker-error role="alert"></p><div data-bank-picker-gallery></div><div class="image-bank-dialog-actions"><button type="button" class="btn" data-bank-close>Cancelar</button></div>';
    const message=window.body.querySelector('[data-bank-picker-status]'),error=window.body.querySelector('[data-bank-picker-error]'),syncButton=window.body.querySelector('[data-bank-picker-sync]');
    const photos=gallery(window.body.querySelector('[data-bank-picker-gallery]'),{signal:window.signal,isAlive:alive,initialQuery:query,compact:true,selectLabel:'Usar esta foto',onSelect:async media=>{if(!alive())return;await onSelect(media);window.close();}});
    async function refresh(){
      if(!alive()){window.close();return;}
      try{const value=await api(ROOT,{signal:window.signal});if(!alive())return;status=statusValue(value);message.textContent=`${count(status?.counts?.ready)} fotos disponíveis${status?.run?' · '+(runLabels[status.run.status]||status.run.status):''}`;syncButton.disabled=!status?.connection?.connected||status?.run?.status==='running';const next=revision(status);if(lastRevision&&lastRevision!==next)void photos.reload();lastRevision=next;}
      catch(failure){if(alive()&&!aborted(failure))error.textContent=failure.message;}
    }
    window.body.querySelector('[data-bank-picker-connect]').addEventListener('click',()=>connectDialog({parentDialog:window.dialog,onDone:refresh}),{signal:window.signal});
    syncButton.addEventListener('click',async()=>{syncButton.disabled=true;error.textContent='';try{await post('/sync',{}, {signal:window.signal});await refresh();}catch(failure){if(alive()&&!aborted(failure))error.textContent=failure.message;}},{signal:window.signal});
    window.body.querySelector('[data-bank-picker-refresh]').addEventListener('click',()=>{error.textContent='';void refresh();void photos.reload();},{signal:window.signal});
    const poll=async()=>{await refresh();if(alive())timer=setTimeout(poll,2000);};window.cleanup(()=>{clearTimeout(timer);photos.dispose();});void poll();window.body.querySelector('[data-bank-search]').focus();return window;
  }

  return {mountPanel,disposePanel,pick};
}
