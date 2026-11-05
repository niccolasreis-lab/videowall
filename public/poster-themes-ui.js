import {posterThemeKeys,posterAppearance} from './poster-theme-model.js';

export function mountPosterThemes({host,form,api,escapeHtml,isNew}) {
 host.innerHTML = `<fieldset class="field poster-themes"><legend>Temas do cartaz</legend><label class="field"><span>Tema salvo</span><select aria-label="Tema salvo"><option value="">Carregando temas…</option></select></label><div class="theme-actions"><button type="button" class="btn small" data-theme="apply">Aplicar tema</button><button type="button" class="btn small" data-theme="default">Definir como padrão</button><button type="button" class="btn small" data-theme="clear">Remover padrão</button><button type="button" class="btn small" data-theme="delete">Excluir tema</button></div><label class="field"><span>Nome do novo tema</span><input maxlength="80" placeholder="Ex.: Ofertas da loja" aria-label="Nome do novo tema"></label><button type="button" class="btn small" data-theme="save">Salvar aparência como tema</button><p role="status" class="theme-status"></p><small>O tema guarda cores, fonte, tamanhos e opções de aparência. Produtos, títulos, layout, duração e validade permanecem no cartaz. O padrão é usado somente em novos cartazes.</small></fieldset>`;
 const select=host.querySelector('select'),name=host.querySelector('input'),status=host.querySelector('[role=status]');
 let data={items:[],defaultId:null},busy=false,changed=false;
 const touched=()=>{changed=true;};
 form.addEventListener('input',touched); form.addEventListener('change',touched);
 const alive=()=>host.isConnected && form.contains(host);
 function controls(){
  const selected=data.items.find(theme=>theme.id===select.value);
  for(const button of host.querySelectorAll('button')) button.disabled=busy || (['apply','default','delete'].includes(button.dataset.theme) && !selected) || (button.dataset.theme==='delete' && selected?.id.startsWith('builtin:'));
  select.disabled=busy;name.disabled=busy;
 }
 function apply(theme){
  for(const key of posterThemeKeys){
   const field=form.elements[key]; if(!field)continue;
   if(field.type==='checkbox') field.checked=!!theme.appearance[key];
   else if (['logoImage','backgroundImage'].includes(key)) {
    const ref=theme.appearance[key],value=ref?JSON.stringify(ref):'';
    if(value&&![...field.options].some(option=>option.value===value)) field.add(new Option('Imagem do tema',value));
    field.value=value;
   } else field.value=theme.appearance[key] ?? '';
  }
  form.elements.hideHeader?.dispatchEvent(new Event('change',{bubbles:true}));
  form.dispatchEvent(new Event('input',{bubbles:true}));
 }
 async function refresh(preferred){
  const result=await api('/api/poster-themes'); if(!alive())return;
  data=result;
  select.innerHTML='<option value="">Selecione um tema</option>'+data.items.map(theme=>`<option value="${escapeHtml(theme.id)}">${escapeHtml(theme.name)}${theme.id===data.defaultId?' — padrão':''}</option>`).join('');
  select.value=preferred || data.defaultId || '';controls();
 }
 select.addEventListener('change',controls);
 host.addEventListener('click',async event=>{
  const button=event.target.closest('button[data-theme]');if(!button || busy)return;
  busy=true;controls();status.textContent='';
  try{
   const selected=data.items.find(theme=>theme.id===select.value);
   switch(button.dataset.theme){
    case 'apply': if(selected){apply(selected);status.textContent='Tema aplicado à prévia. Salve o conteúdo para conservar a aparência.';}break;
    case 'default': await api('/api/poster-themes/default',{method:'PUT',body:JSON.stringify({id:selected.id})});await refresh(selected.id);status.textContent='Padrão definido para novos cartazes.';break;
    case 'clear': await api('/api/poster-themes/default',{method:'PUT',body:JSON.stringify({id:null})});await refresh(select.value);status.textContent='Novos cartazes usarão a aparência inicial.';break;
    case 'save': {
     const appearance={};
     for(const key of posterThemeKeys){const field=form.elements[key];if(!field)continue;appearance[key]=field.type==='checkbox'?field.checked:['logoImage','backgroundImage'].includes(key)?field.value?JSON.parse(field.value):null:field.value;}
     const saved=await api('/api/poster-themes',{method:'POST',body:JSON.stringify({name:name.value,appearance:posterAppearance(appearance)})});
     await refresh(saved.id);name.value='';status.textContent='Tema salvo. Você já pode reutilizá-lo em outro cartaz.';break;
    }
    case 'delete': await api('/api/poster-themes/'+selected.id,{method:'DELETE'});await refresh();status.textContent='Tema excluído. Cartazes que já o usavam mantêm a aparência.';break;
   }
  }catch(error){if(alive())status.textContent=error.message;}
  finally{busy=false;if(alive())controls();}
 });
 name.addEventListener('keydown',event=>{if(event.key==='Enter'){event.preventDefault();host.querySelector('[data-theme=save]').click();}});
 controls();
 void refresh().then(()=>{
  if(!alive())return;
  if(isNew && !changed && data.defaultId){const theme=data.items.find(item=>item.id===data.defaultId);if(theme){apply(theme);status.textContent='Tema padrão aplicado ao novo cartaz.';}}
 }).catch(error=>{if(alive())status.textContent='Não foi possível carregar os temas: '+error.message;});
}
