import {localTime} from './campaign-ui.js';

const entry = document.querySelector('#branch-entry'), content = document.querySelector('#branch-content');
const login = document.querySelector('#branch-login');
let token = '';
async function api(path,body) {
  const headers={Authorization:'Bearer '+token};
  if(body)headers['Content-Type']='application/json';
  const response=await fetch(path,{headers,credentials:'omit',method:body?'PUT':'GET',body:body?JSON.stringify(body):undefined});
  const result=await response.json();
  if(!response.ok)throw new Error(result.error);
  return result;
}
function add(parent,tag,text) {
  const element=document.createElement(tag);
  element.textContent=text||'';parent.append(element);return element;
}
function field(form,label,attrs) {
  const wrapper=add(form,'label');wrapper.className='field';add(wrapper,'span',label);
  const input=add(wrapper,'input');Object.assign(input,attrs);return input;
}
function draw(data) {
  content.replaceChildren();entry.hidden=true;
  add(content,'h2',data.store.name);
  const logout=add(content,'button','Sair');logout.className='btn';
  logout.onclick=()=>{token='';content.replaceChildren();entry.hidden=false;login.elements.token.focus();};
  if(!data.campaigns.length)add(content,'p','Nenhuma campanha destinada a esta filial.');
  const money=new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'});
  for(const campaign of data.campaigns){
    const card=add(content,'article');card.className='card campaign-card';
    add(card,'h3',campaign.name);
    const local=campaign.overrides[0]||{};
    const from=local.validFrom||campaign.validFrom, until=local.validUntil||campaign.validUntil;
    add(card,'p',new Date(from).toLocaleString('pt-BR')+' a '+new Date(until).toLocaleString('pt-BR')+' · '+campaign.targets.map(target=>target.name).join(', '));
    const products=new Map(campaign.pieces.flatMap(piece=>piece.rows.map(row=>[row.key,row])));
    if(data.store.accessMode!=='edit'||campaign.cancelled||Date.parse(campaign.validUntil)<=Date.now()){
      const list=add(card,'ul');
      for(const row of products.values()) add(list,'li',row.name+' · '+(row.active?money.format(local.prices?.[row.key]??row.price):'Indisponível'));
      continue;
    }
    const form=add(card,'form');form.className='campaign-form';
    const dates={type:'datetime-local',required:true,min:localTime(campaign.validFrom),max:localTime(campaign.validUntil)};
    const start=field(form,'Início local',{...dates,value:localTime(from)});
    const end=field(form,'Fim local',{...dates,value:localTime(until)});
    const prices=[];
    for(const [key,row] of products){
      const label=row.name+(row.active?' · Matriz '+money.format(row.price):' · Indisponível na matriz');
      prices.push([key,field(form,label,{type:'number',min:'.01',max:'999999',step:'.01',value:local.prices?.[key]??'',placeholder:'Usar preço da matriz'})]);
    }
    const submit=add(form,'button','Salvar ajustes da filial');submit.className='btn primary';
    const status=add(form,'p');status.setAttribute('role','status');status.className='campaign-status';
    form.onsubmit=async event=>{
      event.preventDefault();submit.disabled=true;status.textContent='';
      try {
        const dateValue=(input,original)=>input.value===localTime(original)?original:new Date(input.value).toISOString();
        await api('/api/filial/campanhas/'+campaign.id,{validFrom:dateValue(start,from),validUntil:dateValue(end,until),
          prices:Object.fromEntries(prices.filter(([,input])=>input.value!=='').map(([key,input])=>[key,input.valueAsNumber]))});
        status.textContent='Ajustes locais publicados para as TVs desta filial.';
      }catch(error){status.textContent=error.message;}
      finally{submit.disabled=false;}
    };
  }
}
login.onsubmit=async event=>{
  event.preventDefault();
  const submit=event.submitter||login.querySelector('button'), status=login.querySelector('[role=status]');
  token=login.elements.token.value.trim();submit.disabled=true;status.textContent='';
  try{draw(await api('/api/filial'));login.reset();}
  catch(error){token='';status.textContent=error.message;}
  finally{submit.disabled=false;}
};
