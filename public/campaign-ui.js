import {recordCampaign} from './campaign-video.js';
import {renderVirtual} from './content-renderer.js';

const day = 86400000;
export const localTime = value => {
  const date=new Date(value);
  return new Date(+date-date.getTimezoneOffset()*60000).toISOString().slice(0,16);
};
const alertLabels = {offline:'TV sem conexão',outdated:'Programação desatualizada',playback:'Falhas repetidas de reprodução'};
const stamp = date => new Date(date).toLocaleString('pt-BR');

export function campaignUi({api,e,heading,state}) {
  const send = (path,method,value) => api(path,{method,...(value===undefined?{}:{body:JSON.stringify(value)})});
  const options = (entries,selected) => entries.map(([id,name])=>'<option value="'+e(id)+'" '+(id===selected?'selected':'')+'>'+e(name)+'</option>').join('');
  const field = (label,control) => '<label class="field"><span>'+label+'</span>'+control+'</label>';
  const button = (label,primary=false) => '<button class="btn '+(primary?'primary':'')+'">'+label+'</button>';
  const card = (title,content) => '<section class="card campaign-card"><h2>'+title+'</h2>'+content+'</section>';
  let view = location.hash==='#campaigns/alerts'?'alerts':'campaigns', mount = 0, exportController;
  function dispose() { mount++;exportController?.abort(); }
  async function render(host) {
    const revision = ++mount;
    if (location.hash==='#campaigns/alerts') view='alerts';
    host.innerHTML = heading('Campanhas','Gerencie ofertas, filiais, identidade visual e veiculação nas TVs.')+
      '<div class="campaign-tabs" aria-label="Áreas de campanhas"></div><div id="campaign-body" aria-live="polite">Carregando…</div>';
    const tabs = host.querySelector('.campaign-tabs'), body = host.querySelector('#campaign-body');
    for (const [id,name] of [['campaigns','Campanhas'],['stores','Filiais'],['themes','Identidade visual'],['alerts','Alertas'],['erp','ERP']]) {
      const tab = document.createElement('button');
      tab.className='btn'+(id===view?' primary':'');tab.textContent=name;
      tab.setAttribute('aria-pressed',String(id===view));
      tab.onclick=()=>{exportController?.abort();view=id;history.replaceState(null,'',id==='alerts'?'#campaigns/alerts':'#campaigns');void render(host);};
      tabs.append(tab);
    }
    try {
      const [data,themes] = await Promise.all([api('/api/campaigns'),api('/api/poster-themes')]);
      if (revision!==mount || !body.isConnected) return;
      if (view==='stores') stores(body,data);
      else if (view==='themes') identity(body,themes);
      else if (view==='alerts') await alerts(body);
      else if (view==='erp') await erp(body);
      else await campaigns(body,data,themes);
    } catch (error) { if (body.isConnected) body.textContent=error.message; }
  }

  function action(form,callback) {
    form.onsubmit=async event=>{
      event.preventDefault();
      const submit=event.submitter||form.querySelector('button:not([type=button])');
      if (submit) submit.disabled=true;
      const status=form.querySelector('[role=status]');
      status.textContent='';
      try { await callback(new FormData(form),status,submit); }
      catch (error) { status.textContent=error.message; }
      finally { if(submit)submit.disabled=false; }
    };
  }
  const status = '<p role="status" class="campaign-status"></p>';
  const refresh = body => { if (body.isConnected) return render(body.parentElement); };
  function stores(body,data) {
    const storeOptions = data.stores.map(s=>[s.id,s.name]);
    body.innerHTML=card('Filiais','<form class="campaign-form" id="new-store">'+field('Nome da filial','<input required maxlength="80" name="name">')+button('Cadastrar filial',true)+status+'</form>'+
      '<p>Compartilhe o endereço <a href="/filial" target="_blank" rel="noopener">Portal da filial</a> e entregue a chave por um canal seguro. A chave aparece no painel ao ser gerada.</p>'+
      data.stores.map(s=>'<form class="campaign-form store-form" data-id="'+e(s.id)+'">'+field('Nome da filial','<input name="name" maxlength="80" required value="'+e(s.name)+'">')+
        field('Acesso ao portal','<select name="mode">'+options([['view','Consulta'],['edit','Ajustar preços e período']],s.accessMode)+'</select>')+
        '<div class="campaign-actions"><button class="btn" value="rename">Salvar nome</button><button class="btn" value="issue">'+(s.hasAccess?'Trocar chave':'Gerar chave')+'</button>'+
        (s.hasAccess?'<button class="btn" value="revoke">Revogar chave</button>':'')+'</div>'+status+'</form>').join(''))+
      card('Filial e setor por TV',state.points.map(point=>{
        const current=data.assignments.find(row=>row.pointId===point.id);
        return '<form class="campaign-form point-assignment" data-id="'+e(point.id)+'"><strong>'+e(point.name)+'</strong>'+
          field('Filial','<select name="storeId">'+options([['','Sem filial'],...storeOptions],current?.storeId)+'</select>')+
          field('Setor','<select name="sector">'+options(Object.entries(data.sectors),current?.sector)+'</select>')+button('Salvar TV')+status+'</form>';
      }).join('')||'<p>Cadastre uma TV em Pontos para associá-la a uma filial.</p>');
    action(body.querySelector('#new-store'),async data=>{
      await send('/api/campaigns/stores','POST',Object.fromEntries(data));await refresh(body);
    });
    for (const form of body.querySelectorAll('.store-form')) action(form,async (data,status,submit)=>{
      const path='/api/campaigns/stores/'+form.dataset.id;
      if (submit.value==='rename') {await send(path,'PUT',{name:data.get('name')});await refresh(body);return;}
      if (submit.value==='revoke'&&!confirm('Revogar a chave ativa desta filial?')) return;
      if (submit.value==='issue'&&submit.textContent==='Trocar chave'&&!confirm('Trocar a chave desativa o acesso com a chave anterior. Continuar?')) return;
      const result=await send(path+'/access','PUT',{mode:submit.value==='revoke'?'revoke':data.get('mode')});
      if (!result.token) {await refresh(body);return;}
      status.textContent='Chave da filial: ';
      const output=document.createElement('input');output.value=result.token;output.readOnly=true;output.setAttribute('aria-label','Chave da filial');
      status.append(output);output.select();submit.textContent='Trocar chave';
      if (!form.querySelector('[value=revoke]')) {
        const revoke=document.createElement('button');revoke.className='btn';revoke.value='revoke';revoke.textContent='Revogar chave';
        form.querySelector('.campaign-actions').append(revoke);
      }
    });
    for (const form of body.querySelectorAll('.point-assignment')) action(form,async (data,status)=>{
      await send('/api/campaigns/points/'+form.dataset.id,'PUT',{storeId:data.get('storeId')||null,sector:data.get('sector')});
      status.textContent='Associação salva.';
    });
  }
  function identity(body,themes) {
    const assets=state.media.filter(item=>item.kind==='image').map(item=>[JSON.stringify({source:'media',id:item.id}),item.name]);
    const asset = name => '<select name="'+name+'">'+options([['','Nenhuma'],...assets])+'</select>';
    body.innerHTML=card('Editor de identidade visual','<form class="campaign-form" id="identity">'+
      field('Identidade para editar','<select name="themeId">'+options([['','Criar identidade'],...themes.items.filter(theme=>!theme.id.startsWith('builtin:')).map(theme=>[theme.id,theme.name])])+'</select>')+
      field('Nome','<input required maxlength="80" name="name">')+
      field('Cor de fundo','<input type="color" name="background" value="#153b39">')+
      field('Cor do texto','<input type="color" name="color" value="#ffffff">')+
      field('Fonte','<select name="font">'+options([['sans','Sem serifa'],['serif','Com serifa'],['mono','Monoespaçada']])+'</select>')+
      field('Logo da biblioteca',asset('logoImage'))+field('Fundo da biblioteca',asset('backgroundImage'))+
      '<label><input type="checkbox" name="gradient"> Fundo degradê</label><label><input type="checkbox" name="rounded"> Cantos arredondados</label>'+
      '<label><input type="checkbox" name="showUnit" checked> Mostrar unidade</label><label><input type="checkbox" name="hideHeader"> Ocultar título</label>'+
      field('Orientação da prévia','<select name="orientation">'+options([['horizontal','Horizontal'],['vertical','Vertical']])+'</select>')+
      '<div class="campaign-actions"><button class="btn" type="button" id="identity-preview">Visualizar</button>'+button('Salvar identidade',true)+'</div>'+status+'</form><div class="campaign-preview" hidden></div>')+
      card('Identidades disponíveis','<ul>'+themes.items.map(theme=>'<li>'+e(theme.name)+(theme.id===themes.defaultId?' · padrão':'')+'</li>').join('')+'</ul>');
    const appearance = data => {
      const image = key=>data.get(key)?JSON.parse(data.get(key)):null;
      return {background:data.get('background'),color:data.get('color'),font:data.get('font'),logoImage:image('logoImage'),backgroundImage:image('backgroundImage'),
        gradient:data.has('gradient'),rounded:data.has('rounded'),showUnit:data.has('showUnit'),hideHeader:data.has('hideHeader')};
    };
    const form = body.querySelector('#identity');
    const setPreviewTheme = () => {
      const selected=themes.items.find(theme=>theme.id===form.elements.themeId.value);
      const choice=form.elements.themeId.value;
      form.reset();form.elements.themeId.value=choice;
      if (selected) {
        const a=selected.appearance;
        form.elements.name.value=selected.name;
        for (const key of ['background','color','font']) form.elements[key].value=a[key];
        for (const key of ['gradient','rounded','showUnit','hideHeader']) form.elements[key].checked=!!a[key];
        for (const key of ['logoImage','backgroundImage']) {
          const value=a[key]?JSON.stringify(a[key]):'';
          if (value && ![...form.elements[key].options].some(option=>option.value===value)) form.elements[key].add(new Option('Imagem atual',value));
          form.elements[key].value=value;
        }
      }
      body.querySelector('.campaign-preview').hidden=true;
    };
    form.elements.themeId.onchange=setPreviewTheme;
    body.querySelector('#identity-preview').onclick=()=>{
      const data=new FormData(form), preview=body.querySelector('.campaign-preview');
      preview.hidden=false;preview.dataset.orientation=data.get('orientation');preview.replaceChildren();
      renderVirtual({kind:'poster',name:data.get('name'),config:{...appearance(data),title:data.get('name')||'Ofertas da semana',
        orientation:data.get('orientation'),rows:[{name:'Produto de exemplo',price:9.99,unit:'kg'}]}},preview);
    };
    action(form,async (data)=>{
      const selected=themes.items.find(theme=>theme.id===data.get('themeId'));
      const updated={...selected?.appearance,...appearance(data)};
      await send('/api/poster-themes'+(selected?'/'+selected.id:''),selected?'PUT':'POST',{name:data.get('name'),appearance:updated});
      await refresh(body);
    });
  }
  async function alerts(body) {
    const draw = async () => {
      const rows=await api('/api/campaign-alerts');
      if(!body.isConnected)return;
      body.innerHTML=card('Alertas das TVs','<p>Uma TV fica offline após 25 segundos sem resposta. O painel alerta sobre versões pendentes após 1 minuto e sobre três falhas do mesmo conteúdo em 5 minutos.</p>'+
        '<button type="button" class="btn" id="reload-alerts">Atualizar alertas</button>'+
        (rows.length?'<ul class="campaign-records">'+rows.map(row=>'<li><strong>'+e(alertLabels[row.kind])+'</strong> · '+e(row.pointName)+(row.storeName?' · '+e(row.storeName):'')+
        '<small>'+e(stamp(row.openedAt))+' · '+(row.resolvedAt?'Resolvido '+e(stamp(row.resolvedAt)):row.acknowledgedAt?'Reconhecido':'Aberto')+'</small>'+
        (!row.resolvedAt&&!row.acknowledgedAt?'<form data-id="'+row.id+'">'+button('Reconhecer')+status+'</form>':'')+'</li>').join('')+'</ul>':'<p>Sem incidentes registrados.</p>')+status);
      body.querySelector('#reload-alerts').onclick=()=>void draw().catch(error=>{body.querySelector('.campaign-card > [role=status]').textContent=error.message;});
      for (const form of body.querySelectorAll('form[data-id]')) action(form,async()=>{await send('/api/campaign-alerts/'+form.dataset.id+'/ack','PUT');await draw();});
    };
    await draw();
  }
  async function erp(body) {
    const data=await api('/api/erp');
    if (!body.isConnected) return;
    const result=data.lastImport;
    body.innerHTML=card('Recebimento de cargas do ERP','<p>O ERP envia um arquivo completo em JSON para <code>POST /api/erp/imports</code> com a chave no cabeçalho <code>Authorization: Bearer …</code>.</p>'+
      '<form class="campaign-form" id="erp-config">'+field('Modo de recebimento','<select name="mode">'+options([['disabled','Desativado'],['review','Revisão no painel Produtos e cargas'],['automatic','Aplicar catálogo e atualizar campanhas']],data.mode)+'</select>')+
      '<label><input type="checkbox" name="rotate"> Gerar nova chave</label>'+button('Salvar integração',true)+status+'</form>')+
      card('Última carga recebida',result?'<p>'+e(result.filename)+' · '+(result.status==='applied'?'Aplicada':'Pendente')+'</p><p>'+result.summary.added+' novos · '+result.summary.changed+' alterados · '+result.summary.removed+' removidos · '+result.summary.zeroPrices+' com preço zero</p>'+
        '<ul class="campaign-records">'+result.changes.slice(0,20).map(row=>'<li>'+e(row.key)+' · '+e(row.name)+' · '+e({changed:'Alterado',added:'Novo',removed:'Removido'}[row.type])+' · '+e(row.before??'—')+' → '+e(row.after??'—')+'</li>').join('')+'</ul><a href="#products">Abrir Produtos e cargas</a>':'<p>Nenhuma carga recebida.</p>');
    action(body.querySelector('#erp-config'),async (data,status)=>{
      if (data.get('mode')==='automatic'&&!confirm('Aplicar automaticamente as próximas cargas e atualizar preços das campanhas?')) return;
      const result=await send('/api/erp','PUT',{mode:data.get('mode'),rotate:data.has('rotate')});
      status.textContent=result.token?'Chave do ERP: ':'Configuração salva.';
      if(result.token){
        const output=document.createElement('input');output.value=result.token;output.readOnly=true;output.setAttribute('aria-label','Chave do ERP');
        status.append(output);output.select();
      }
    });
  }

  async function campaigns(body,data,themes) {
    const assignments = new Map(data.assignments.map(row=>[row.pointId,row]));
    const tvs = state.points.filter(point=>assignments.has(point.id));
    const themeChoices = [['','Padrão do VideoWall'],...themes.items.map(theme=>[theme.id,theme.name])];
    const products = new Map(Object.keys(data.sectors).map(sector=>[sector,new Map()]));
    const selectedThemes = new Map(Object.keys(data.sectors).map(sector=>[sector,themes.defaultId||'']));
    const requestId=crypto.randomUUID?.();
    body.innerHTML=card('Publicar campanha',!tvs.length?'<p>Associe ao menos uma TV a uma filial e setor para publicar uma campanha.</p>':
      '<form class="campaign-form" id="launch">'+field('Nome da campanha','<input required maxlength="120" name="name">')+
      field('Início no horário deste computador','<input required type="datetime-local" name="validFrom" value="'+localTime(Date.now())+'">')+
      field('Fim no horário deste computador','<input required type="datetime-local" name="validUntil" value="'+localTime(Date.now()+day)+'">')+
      field('Tipo de preço','<select name="priceType">'+options([['normal','Normal'],['offer','Oferta'],['club','Clube']])+'</select>')+
      field('Layout','<select name="layout">'+options([['campaign','Alternância'],['grid','Grade'],['list-spotlight','Lista com destaque']])+'</select>')+
      field('Segundos por produto','<input required type="number" name="secondsPerItem" min="1" max="30" value="5">')+
      '<fieldset class="campaign-wide"><legend>Cartazes por setor</legend><div class="campaign-form">'+
      field('Setor da peça','<select id="piece-sector">'+options(Object.entries(data.sectors))+'</select>')+
      field('Identidade visual','<select id="piece-theme">'+options(themeChoices,themes.defaultId)+'</select>')+
      field('Pesquisar produto do catálogo','<input type="search" id="product-query" placeholder="Nome ou código">')+
      '<div class="campaign-actions"><button class="btn" type="button" id="search-products">Buscar</button></div></div>'+
      '<div class="campaign-actions" id="product-results"></div><div id="selected-products"></div></fieldset>'+
      '<fieldset class="campaign-wide"><legend>TVs de destino</legend><div class="campaign-actions">'+tvs.map(point=>{
        const current=assignments.get(point.id), store=data.stores.find(store=>store.id===current.storeId);
        return '<label><input type="checkbox" name="point" value="'+e(point.id)+'"> '+e(store?.name)+' · '+e(data.sectors[current.sector])+' · '+e(point.name)+'</label>';
      }).join('')+'</div></fieldset>'+button('Conferir impacto',true)+status+'</form><div id="campaign-impact"></div>')+
      card('Limite de variação de preço','<form id="campaign-price-limit" class="campaign-form">'+
        field('Variação máxima em % (em branco desativa)','<input name="limit" type="number" min="0" max="1000" step=".01" value="'+e(data.priceLimit)+'">')+
        button('Salvar limite')+status+'</form><p>Campanhas novas com variação acima do limite exigem confirmação na prévia.</p>')+
      card('Campanhas publicadas','<form id="refresh-campaigns">'+button('Atualizar preços pelo catálogo')+status+'</form>'+
        (data.campaigns.length?'<div class="campaign-records">'+data.campaigns.map(campaign=>{
          const closed=campaign.cancelled||Date.parse(campaign.validUntil)<=Date.now();
          return '<article data-campaign="'+e(campaign.id)+'"><h3>'+e(campaign.name)+'</h3><p>'+e(stamp(campaign.validFrom))+' a '+e(stamp(campaign.validUntil))+
            ' · '+campaign.targets.length+' TV(s) · '+(campaign.cancelled?'Cancelada':closed?'Encerrada':Date.parse(campaign.validFrom)>Date.now()?'Agendada':'Em veiculação')+'</p>'+
            '<div class="campaign-actions"><button type="button" class="btn" data-action="report">Ver relatório</button><button type="button" class="btn" data-action="export">Exportar MP4</button>'+
            (!closed?'<button type="button" class="btn" data-action="cancel">Cancelar campanha</button>':'')+'</div><div class="campaign-detail"></div></article>';
        }).join('')+'</div>':'<p>As campanhas publicadas aparecem aqui.</p>'));
    const form=body.querySelector('#launch');
    if (form) {
      const sector=form.querySelector('#piece-sector'), theme=form.querySelector('#piece-theme');
      const results=form.querySelector('#product-results'), chosen=form.querySelector('#selected-products'), query=form.querySelector('#product-query');
      const preview=body.querySelector('#campaign-impact');
      const drawChosen=()=>{
        preview.replaceChildren();
        chosen.innerHTML=[...products].filter(([,list])=>list.size).map(([id,list])=>'<p><strong>'+e(data.sectors[id])+'</strong> '+[...list.values()].map(product=>
          '<button type="button" class="btn small" data-sector="'+e(id)+'" data-product="'+e(product.product_key)+'" aria-label="Remover '+e(product.name)+'">'+e(product.name)+' ×</button>').join(' ')+'</p>').join('');
        for(const button of chosen.querySelectorAll('button'))button.onclick=()=>{products.get(button.dataset.sector).delete(button.dataset.product);drawChosen();};
      };
      sector.onchange=()=>{theme.value=selectedThemes.get(sector.value);};
      theme.onchange=()=>selectedThemes.set(sector.value,theme.value);
      form.addEventListener('input',()=>preview.replaceChildren());
      form.addEventListener('change',()=>preview.replaceChildren());
      let searchVersion=0;
      async function search(page=1) {
        const version=++searchVersion;
        results.textContent='Buscando…';
        try {
          const result=await api('/api/catalog/products?'+new URLSearchParams({q:query.value,page}));
          if (version!==searchVersion) return;
          results.replaceChildren();
          for (const product of result.items) {
            if(!product.available)continue;
            const add=document.createElement('button');add.className='btn small';add.type='button';add.textContent=product.name+' · '+product.product_key;
            add.onclick=()=>{
              const list=products.get(sector.value);
              if (list.size>=6 && !list.has(product.product_key)) {form.querySelector('[role=status]').textContent='Cada cartaz aceita até seis produtos.';return;}
              list.set(product.product_key,product);form.querySelector('[role=status]').textContent='';drawChosen();
            };
            results.append(add);
          }
          if (!results.children.length) results.textContent='Nenhum produto disponível nesta página.';
          for(const [target,label] of [[page-1,'Anterior'],[page+1,'Próxima']]){
            if(target<1||(target-1)*50>=result.total)continue;
            const more=document.createElement('button');more.type='button';more.className='btn';more.textContent=label;more.onclick=()=>void search(target);results.append(more);
          }
        } catch(error) {if(version===searchVersion)results.textContent=error.message;}
      }
      form.querySelector('#search-products').onclick=()=>void search();
      query.onkeydown=event=>{if(event.key==='Enter'){event.preventDefault();void search();}};
      const payload = values => ({requestId,name:values.get('name'),priceType:values.get('priceType'),layout:values.get('layout'),
        secondsPerItem:Number(values.get('secondsPerItem')),validFrom:new Date(values.get('validFrom')).toISOString(),validUntil:new Date(values.get('validUntil')).toISOString(),
        pointIds:values.getAll('point'),pieces:[...products].filter(([,list])=>list.size).map(([sector,list])=>({sector,products:[...list.keys()],themeId:selectedThemes.get(sector)}))});
      action(form,async values=>{
        const input=payload(values), serialized=JSON.stringify(input);
        preview.replaceChildren();
        const result=await send('/api/campaigns/preview','POST',input);
        if (!form.isConnected || !form.checkValidity() || JSON.stringify(payload(new FormData(form)))!==serialized) return;
        const money=new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'});
        const number=new Intl.NumberFormat('pt-BR',{maximumFractionDigits:2});
        const formatted=value=>value===null?'—':money.format(value);
        preview.innerHTML='<h3>Prévia de impacto</h3><p>'+e(result.name)+' · '+result.televisions.length+' TV(s) · '+e(stamp(result.validFrom))+' a '+e(stamp(result.validUntil))+'</p>'+
          (result.emptySectors.length?'<p>Cartazes sem produto disponível em '+e(result.emptySectors.map(id=>data.sectors[id]).join(', '))+'.</p>':'')+
          (result.unavailable.length?'<p>Remova ou corrija os produtos sem preço disponível para publicar.</p><ul>'+
            result.unavailable.map(row=>'<li>'+e(row.name)+' · '+e(data.sectors[row.sector])+'</li>').join('')+'</ul>':'')+
          result.televisions.map(tv=>'<h4>'+e(tv.storeName)+' · '+e(data.sectors[tv.sector])+' · '+e(tv.name)+'</h4>'+
            '<div class="table-wrap"><table class="data-table"><thead><tr><th>Produto</th><th>Referência anterior</th><th>Novo preço</th><th>Variação</th></tr></thead><tbody>'+
            tv.products.map(row=>'<tr><td>'+e(row.name)+'</td><td>'+e(formatted(row.before))+
              (row.source==='campaign'?' · campanha na TV':row.source==='catalog'?' · catálogo normal':'')+
              '</td><td>'+e(formatted(row.after))+'</td><td>'+e(row.variation===null?'—':number.format(row.variation)+'%')+
              (row.exceedsLimit?' · Acima do limite':'')+'</td></tr>').join('')+'</tbody></table></div>').join('')+
          (result.unavailable.length?'':'<form id="confirm-campaign" class="campaign-form">'+
            (result.requiresReview?'<label><input type="checkbox" name="ack" required> Revisei as variações acima de '+e(number.format(result.limit))+'%.</label>':'')+
            button('Confirmar publicação',true)+status+'</form>');
        const confirmation=preview.querySelector('#confirm-campaign');
        if (confirmation) action(confirmation,async confirmationData=>{
          await send('/api/campaigns','POST',{...input,impactVersion:result.version,acknowledgePriceLimit:confirmationData.has('ack')});
          await refresh(body);
        });
      });
    }
    action(body.querySelector('#campaign-price-limit'),async (values,message)=>{
      const limit=values.get('limit');
      await send('/api/campaigns/price-limit','PUT',{limit:limit===''?null:Number(limit)});
      body.querySelector('#campaign-impact')?.replaceChildren();
      message.textContent='Limite salvo.';
    });
    action(body.querySelector('#refresh-campaigns'),async (_,status)=>{
      const result=await send('/api/campaigns/refresh-prices','POST',{});
      status.textContent=result.updated+' campanha(s) atualizada(s).';
      if(result.updated) {
        const reload=document.createElement('button');reload.type='button';reload.className='btn';reload.textContent='Recarregar preços nesta página';
        reload.onclick=()=>void refresh(body);status.append(' ',reload);
      }
    });
    for(const article of body.querySelectorAll('[data-campaign]')) {
      const item=data.campaigns.find(campaign=>campaign.id===article.dataset.campaign);
      for(const control of article.querySelectorAll('[data-action]')) control.onclick=async()=>{
        const detail=article.querySelector('.campaign-detail');
        if(detail.querySelector('[data-export-active]'))return;
        try {
          if(control.dataset.action==='cancel') {
            if (!confirm('Cancelar a campanha nas TVs conectadas?')) return;
            await send('/api/campaigns/'+item.id,'DELETE');await refresh(body);
          } else if(control.dataset.action==='report') report(detail,item);
          else video(detail,item);
        } catch(error) {detail.textContent=error.message;}
      };
    }
  }

  function report(host,item) {
    host.innerHTML='<form class="campaign-form">'+field('De','<input type="datetime-local" name="from" required value="'+localTime(item.validFrom)+'">')+
      field('Até','<input type="datetime-local" name="until" required value="'+localTime(item.validUntil)+'">')+
      field('Filial','<select name="storeId">'+options([['','Todas'],...new Map(item.targets.map(row=>[row.storeId,row.storeName]))])+'</select>')+
      button('Consultar')+status+'</form><div class="campaign-report"></div>';
    const form=host.querySelector('form'), report=host.querySelector('.campaign-report');
    action(form,async data=>{
      const params=new URLSearchParams({from:new Date(data.get('from')).toISOString(),until:new Date(data.get('until')).toISOString()});
      if(data.get('storeId'))params.set('storeId',data.get('storeId'));
      const rows=await api('/api/campaigns/'+item.id+'/report?'+params);
      report.innerHTML=rows.length?'<div class="table-wrap"><table class="data-table"><thead><tr><th>Filial</th><th>TV</th><th>Inícios</th><th>Conclusões</th><th>Falhas</th><th>Último evento</th></tr></thead><tbody>'+
        rows.map(row=>'<tr><td>'+e(row.storeName)+'</td><td>'+e(row.pointName)+'</td><td>'+row.started+'</td><td>'+row.ended+'</td><td>'+row.errors+'</td><td>'+e(row.lastAt?stamp(row.lastAt):'—')+'</td></tr>').join('')+'</tbody></table></div>':'<p>Nenhuma TV encontrada para esse filtro.</p>';
    });
    form.requestSubmit();
  }
  function video(host,item) {
    host.innerHTML='<form class="campaign-form">'+field('Formato do vídeo','<select name="format">'+options([['horizontal','Horizontal · 1280 × 720'],['vertical','Vertical · 720 × 1280']])+'</select>')+
      field('Segundos por produto','<input required type="number" name="seconds" min="1" max="6" value="2">')+button('Gerar vídeo',true)+
      '<button type="button" class="btn" hidden id="stop-export">Parar exportação</button>'+status+'</form>';
    const form=host.querySelector('form'), stop=host.querySelector('#stop-export');
    action(form,async (data,status)=>{
      if(exportController)throw new Error('Já há uma exportação em andamento.');
      const controller=new AbortController();
      exportController=controller;form.dataset.exportActive='true';stop.hidden=false;stop.onclick=()=>controller.abort();
      try {
        const blob=await recordCampaign(item,{vertical:data.get('format')==='vertical',seconds:Number(data.get('seconds')),signal:controller.signal,
          onProgress:progress=>{status.textContent='Gerando MP4 · '+Math.round(progress*100)+'%. Mantenha esta aba visível.';}});
        const url=URL.createObjectURL(blob), download=document.createElement('a');
        download.href=url;download.download=(item.name.replace(/[^\p{L}\p{N} -]+/gu,'').trim()||'campanha')+'.mp4';
        download.click();setTimeout(()=>URL.revokeObjectURL(url),60000);status.textContent='MP4 gerado.';
      } catch(error) {if(controller.signal.aborted)status.textContent='Exportação interrompida.';else throw error;}
      finally {exportController=null;delete form.dataset.exportActive;stop.hidden=true;}
    });
  }
  return {render,dispose};
}
