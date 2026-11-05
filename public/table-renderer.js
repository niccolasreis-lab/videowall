import { findTableTemplate, imageUrl, eligibleTableRows, tablePages } from './table-templates.js';
const money=value=>new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'}).format(value);
function node(tag,parent,className,text=''){const el=document.createElement(tag);el.className=className;el.textContent=text;parent.append(el);return el;}
function photo(parent,ref,className,alt){const src=imageUrl(ref);if(!src)return;const img=node('img',parent,className);img.alt=alt;img.src=src;img.addEventListener('error',()=>img.remove(),{once:true});return img;}
function price(parent,row,inline=false){const formatted=money(row.price);const wrap=node('div',parent,'table-price'+(formatted.length>12?' price-long':'')+(inline?' table-price-inline':''));node('strong',wrap,'',formatted);if(row.unit)node('small',wrap,'table-unit',`/ ${row.unit}`);}
export function renderTable(item,container,{staticPreview=false}={}){
  const config=item.config||{},template=findTableTemplate(config.tableTheme);if(!template)return false;
  const inline=config.priceFormat==='inline';
  const card=node('article',container,`table-design table-${template.id}${inline?' table-format-inline':''}`);
  for(const [key,value] of Object.entries({surface:template.surface,ink:template.color,accent:template.accent}))card.style.setProperty(`--table-${key}`,value);
  const background=imageUrl(config.backgroundImage);
  if(background){photo(card,config.backgroundImage,'table-background','');card.classList.add('has-background');}
  const hero=node('aside',card,'table-hero');photo(hero,config.sectorImage||{source:'builtin',id:template.photo},'table-sector-photo','');
  const heroCaption=node('div',hero,'table-hero-caption');node('span',heroCaption,'',template.label);node('strong',heroCaption,'',template.name.split(' — ')[0]);
  const main=node('section',card,'table-content');
  const header=node('header',main,'table-header');node('span',header,'table-eyebrow',template.label);node('h1',header,'table-title',config.title||item.name||template.name);
  if(config.priceType&&config.priceType!=='normal')node('small',header,'price-type-label',config.priceType==='club'?'Preço de clube':'Preço de oferta');
  const list=node('div',main,'table-products');
  const rows=eligibleTableRows(config),pages=tablePages(config);
  const featured=template.id==='deli'?rows.find(row=>row.featured):null;
  if(featured){const promo=node('section',main,'table-promotion');photo(promo,featured.image,'table-promotion-photo',featured.name);const detail=node('div',promo,'table-promotion-copy');node('small',detail,'','Destaque da promoção');node('strong',detail,'table-product-name',featured.name);if(inline)node('span',promo,'table-equals','=');price(promo,featured,inline);card.classList.add('has-promotion');}
  const counter=node('footer',main,'table-counter');
  const paint=index=>{
    list.replaceChildren();
    if(!rows.length){node('div',list,'table-empty','Nenhum produto disponível');counter.textContent='';return;}
    const selected=pages[index];
    const columns=template.id==='deli'?[node('div',list,'table-column'),node('div',list,'table-column')]:null;
    for(const [position,row] of selected.entries()){
      const line=node('div',columns?columns[Math.floor(position/9)]:list,'table-product');
      if(template.id==='produce-grid')photo(line,row.image,'table-product-photo',row.name);
      const name=node('span',line,'table-product-name',row.name);name.title=row.name;
      if(inline)node('span',line,'table-equals','=');else if(template.id==='deli')node('span',line,'table-dots');
      price(line,row,inline);
    }
    counter.textContent=`${rows.length} produtos · Página ${index+1} de ${pages.length}`;
  };
  paint(0);
  if(!staticPreview && pages.length>1){let index=0;const interval=Math.max(250,(Number(item.seconds)||10)*1000/pages.length);let timer=setTimeout(function advance(){if(!card.isConnected)return;paint(index=(index+1)%pages.length);timer=setTimeout(advance,interval);},interval);card.disposeTable=()=>clearTimeout(timer);}
  return true;
}
