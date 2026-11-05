import {tablePriceFormats,tableTemplates,builtInPhotos,builtInImages,templateBackgrounds,findTableTemplate,tableExample,tablePages,imageUrl} from './table-templates.js';
import {renderTable} from './table-renderer.js';

export const encodeImage=ref=>ref?`${ref.source}:${ref.id}`:'';
export function decodeImage(value){if(!value)return null;const colon=value.indexOf(':');return {source:value.slice(0,colon),id:value.slice(colon+1)};}
export function imageOptions(images,selected,escapeHtml,{background=false,sector=false}={}){
  const builtins=[...(background?templateBackgrounds:builtInPhotos.filter(photo=>!sector||photo.type==='sector'))];
  const current=builtInImages.find(image=>selected===`builtin:${image.id}`);if(current&&!builtins.includes(current))builtins.push(current);
  return `<option value="">${background?'Sem fundo adicional':sector?'Foto padrão do setor':'Sem foto'}</option><optgroup label="Imagens de fábrica">${builtins.map(photo=>`<option value="builtin:${escapeHtml(photo.id)}" ${selected===`builtin:${photo.id}`?'selected':''}>${escapeHtml(photo.name)}</option>`).join('')}</optgroup><optgroup label="Biblioteca">${images.filter(image=>image.kind==='image').map(image=>`<option value="media:${escapeHtml(image.id)}" ${selected===`media:${image.id}`?'selected':''}>${escapeHtml(image.name)}</option>`).join('')}</optgroup>`;
}
export function mountTableRow(row,source,{images,escapeHtml,onSearchPhoto}){
  row.tableMetadata={catalogUnavailable:source.catalogUnavailable===true};
  const controls=document.createElement('div');controls.className='table-row-media';
  controls.innerHTML=`<label class="row-featured-label"><input class="row-featured" type="checkbox" ${source.featured?'checked':''}> Destaque</label><select class="row-image" aria-label="Foto de ${escapeHtml(source.name||'produto')}">${imageOptions(images,encodeImage(source.image),escapeHtml)}</select><img alt="Foto selecionada" hidden>`;
  row.append(controls);
  const selector=controls.querySelector('select'),thumb=controls.querySelector('img');
  if(onSearchPhoto){const search=document.createElement('button');search.type='button';search.className='btn small image-bank-row-search';search.textContent='Buscar foto real';search.addEventListener('click',()=>onSearchPhoto(row));controls.insertBefore(search,thumb);}
  const update=()=>{const url=imageUrl(decodeImage(selector.value));thumb.hidden=!url;if(url)thumb.src=url;else thumb.removeAttribute('src');};update();selector.addEventListener('change',update);
  controls.querySelector('input').addEventListener('change',event=>{if(event.target.checked)for(const other of row.parentElement.querySelectorAll('.row-featured'))if(other!==event.target)other.checked=false;});
  row.querySelector('.row-code').addEventListener('input',()=>{row.dataset.department='';row.tableMetadata.catalogUnavailable=false;});
}
export function readTableRow(row){return {image:decodeImage(row.querySelector('.row-image')?.value||''),featured:!!row.querySelector('.row-featured')?.checked,catalogUnavailable:row.tableMetadata?.catalogUnavailable===true};}

export function mountTableEditor({host,form,modal,config={},isNew,images,readRows,escapeHtml}){
  const controller=new AbortController(),signal=controller.signal;
  host.className='table-template-block';
  const selected=config.tableTheme || (isNew?'supermarket':'custom');
  host.innerHTML=`<fieldset class="field"><legend>Templates para a TV</legend><div class="table-template-gallery" aria-label="Templates de tabela">${tableTemplates.map(template=>`<button type="button" class="table-template-choice" data-template="${template.id}" aria-pressed="false"><span class="table-template-thumb"></span><span class="table-template-caption">${escapeHtml(template.name)}<small>${template.size} produtos por página · 16:9</small></span></button>`).join('')}</div><label class="field"><span>Modelo selecionado</span><select name="tableTheme"><optgroup label="Templates com fotos">${tableTemplates.map(template=>`<option value="${template.id}">${escapeHtml(template.name)}</option>`).join('')}</optgroup><optgroup label="Estilos anteriores"><option value="custom">Cores personalizadas</option><option value="market">Supermercado clássico</option></optgroup></select></label><label class="field"><span>Formato do preço</span><select name="priceFormat">${tablePriceFormats.map(format=>`<option value="${format.id}" ${format.id===(config.priceFormat||'standard')?'selected':''}>${escapeHtml(format.name)}</option>`).join('')}</select><small>Exemplo: QUEIJO = R$ 38,90 / KG. Informe KG, UN ou 100G no campo Unidade de cada produto. Não há conversão de valores.</small></label><p class="table-template-summary" role="status"></p><div class="table-image-fields"><label class="field"><span>Foto do setor</span><select data-sector-image>${imageOptions(images,encodeImage(config.sectorImage),escapeHtml,{sector:true})}</select></label><label class="field"><span>Fundo adicional</span><select data-background-image>${imageOptions(images,encodeImage(config.backgroundImage),escapeHtml,{background:true})}</select></label></div><details class="table-backgrounds"><summary>Fundos do arquivo · ${templateBackgrounds.length} opções</summary><div class="table-background-gallery">${templateBackgrounds.map(background=>`<button type="button" class="table-background-choice" data-background="${background.id}" aria-pressed="false"><img src="${background.url}" alt="${escapeHtml(background.name)}" loading="lazy"><span>${escapeHtml(background.name)}</span></button>`).join('')}</div><small>Os fundos são adaptados para 16:9 com painéis de contraste. Escolha “Sem fundo adicional” para voltar ao visual original do template.</small></details></fieldset>`;
  for(const button of host.querySelectorAll('[data-template]'))renderTable(tableExample(button.dataset.template),button.querySelector('.table-template-thumb'),{staticPreview:true});
  const selector=host.querySelector('[name=tableTheme]');selector.value=selected;
  const stage=document.createElement('div');stage.className='field table-live-field';stage.innerHTML='<span>Prévia ao vivo · TV horizontal</span><div class="table-preview-stage"><iframe title="Prévia da tabela" src="/preview?embed=1"></iframe></div><small>Troca ilustrativa a cada 5 segundos por página. A duração real é definida na playlist. A prévia não publica nem registra exibições.</small>';
  host.after(stage);
  const iframe=stage.querySelector('iframe');let ready=false,timer;
  const readConfig=()=>({priceType:form.elements.priceType?.value||'normal',tableTheme:selector.value,priceFormat:host.querySelector('[name=priceFormat]').value,sectorImage:decodeImage(host.querySelector('[data-sector-image]').value),backgroundImage:decodeImage(host.querySelector('[data-background-image]').value)});
  const snapshot=()=>{const value={...config,...readConfig(),title:form.elements.title?.value||'Prévia da tabela',background:form.elements.background?.value||'#153b39',color:form.elements.color?.value||'#ffffff',rows:readRows().filter(row=>row.name&&Number.isFinite(row.price))};return {kind:'price_table',name:value.title,seconds:Math.max(1,tablePages(value).length)*5,config:value};};
  const post=()=>{if(ready&&host.isConnected)iframe.contentWindow?.postMessage({type:'videowall-preview',snapshot:{items:[snapshot()]}},location.origin);};
  function update(){
    if(!host.isConnected)return;
    const template=findTableTemplate(selector.value),rows=readRows(),eligible=snapshot().config;
    for(const button of host.querySelectorAll('[data-template]'))button.setAttribute('aria-pressed',String(button.dataset.template===selector.value));
    for(const button of host.querySelectorAll('[data-background]'))button.setAttribute('aria-pressed',String(host.querySelector('[data-background-image]').value===`builtin:${button.dataset.background}`));
    host.querySelector('.table-template-summary').textContent=template?`${template.name}: ${template.size} produtos por página. ${tablePages(eligible).flat().length} produto(s) disponível(is). ${template.id==='deli'?'Marque um produto como destaque; a promoção acompanha seu nome, preço, unidade e foto.':'Escolher um modelo preserva os produtos e preços.'}`:'Estilo anterior preservado. Selecione um template acima para usar os novos layouts com fotos.';
    host.querySelector('.table-image-fields').hidden=!template;host.querySelector('.table-backgrounds').hidden=!template;
    for(const label of form.querySelectorAll('.row-featured-label'))label.hidden=template?.id!=='deli';
    for(const control of form.querySelectorAll('.table-row-media'))control.hidden=!template;
    form.querySelector('[name=background]')?.closest('.color-fields')?.classList.toggle('table-colors-locked',!!template);
    if(rows.filter(row=>row.featured).length>1)host.querySelector('.table-template-summary').textContent+=' Selecione somente um destaque.';
    clearTimeout(timer);timer=setTimeout(post,180);
  }
  host.addEventListener('click',event=>{const choice=event.target.closest('[data-template]'),background=event.target.closest('[data-background]');if(choice)selector.value=choice.dataset.template;else if(background)host.querySelector('[data-background-image]').value=`builtin:${background.dataset.background}`;else return;selector.dispatchEvent(new Event('change',{bubbles:true}));},{signal});
  const fit=()=>{iframe.style.transform=`scale(${iframe.parentElement.clientWidth/1920})`;};
  const observer=new ResizeObserver(fit);observer.observe(iframe.parentElement);fit();
  iframe.addEventListener('load',()=>{ready=true;fit();post();},{signal});
  form.addEventListener('input',update,{signal});form.addEventListener('change',update,{signal});
  const dispose=()=>{clearTimeout(timer);observer.disconnect();controller.abort();modal.removeEventListener('close',dispose);};
  modal.addEventListener('close',dispose,{once:true});update();
  return {readConfig,dispose};
}
