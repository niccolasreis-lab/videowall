import { productPages } from './content-utils.js';
import { templateBackgrounds } from './template-backgrounds.js';

export { templateBackgrounds };
export const tablePriceFormats=[
  {id:'standard',name:'Nome e preço separados'},
  {id:'inline',name:'Produto = valor / unidade'},
];
export const tableTemplates = [
  {id:'supermarket',name:'Supermercado',label:'Ofertas da semana',size:5,photo:'supermarket',surface:'#181c20',color:'#ffffff',accent:'#f3d64f'},
  {id:'produce',name:'Hortifruti — lista',label:'Fresquinhos do dia',size:5,photo:'produce',surface:'#123c29',color:'#fffce9',accent:'#f2d74b'},
  {id:'butcher',name:'Açougue',label:'Seleção do açougue',size:5,photo:'butcher',surface:'#521a25',color:'#ffffff',accent:'#ffe2aa'},
  {id:'bakery',name:'Padaria',label:'Feitos com carinho',size:5,photo:'bakery',surface:'#fbf1df',color:'#4c3020',accent:'#a94224'},
  {id:'deli',name:'Frios — lista e promoção',label:'Seleção de frios',size:18,photo:'deli',surface:'#1c2221',color:'#fff9e9',accent:'#f2d174'},
  {id:'produce-grid',name:'Hortifruti — grade',label:'Ofertas do dia',size:6,photo:'produce',surface:'#fff0ae',color:'#17492c',accent:'#14713a'},
];
export const builtInPhotos = [
  ...['supermarket','produce','butcher','bakery','deli'].map(id=>({id,name:tableTemplates.find(t=>t.photo===id).name,url:`/template-assets/${id}-v1.jpg`,type:'sector'})),
  ...[['mango','Manga'],['pineapple','Abacaxi'],['peach','Pêssego'],['apple','Maçã'],['orange','Laranja'],['kiwi','Kiwi'],['roast-beef','Rosbife']].map(([id,name])=>({id,name,url:`/template-assets/${id}-v1.jpg`,type:'product'})),
];
export const builtInImages = [...builtInPhotos,...templateBackgrounds];
const imagesById = new Map(builtInImages.map(image=>[image.id,image]));
export const templateAssetUrls = new Set(builtInImages.map(image=>image.url));
export const findTableTemplate = id => tableTemplates.find(template=>template.id===id);
export function validImageRef(ref) {
  return !!ref && typeof ref==='object' && !Array.isArray(ref) &&
    (ref.source==='builtin' && imagesById.has(ref.id) || ref.source==='media' && typeof ref.id==='string' && /^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i.test(ref.id));
}
export function imageUrl(ref) {
  if(!validImageRef(ref))return null;
  return ref.source==='builtin'?imagesById.get(ref.id).url:`/media/${ref.id}`;
}
export function tableImageRefs(config={}) {
  return [config.sectorImage,config.backgroundImage,...(config.rows||[]).map(row=>row.image)].filter(validImageRef);
}
export function referencedMediaIds(item) {
  const ids=[];
  if(item.kind==='product_image' && item.config?.mediaId)ids.push(item.config.mediaId);
  if(item.kind==='price_table')ids.push(...tableImageRefs(item.config).filter(ref=>ref.source==='media').map(ref=>ref.id));
  if(item.kind==='poster')ids.push(...[item.config?.logoImage,item.config?.backgroundImage].filter(ref=>validImageRef(ref)&&ref.source==='media').map(ref=>ref.id));
  return [...new Set(ids)];
}
export function eligibleTableRows(config={}) {
  return (config.rows||[]).filter(row=>row.active!==false && (!findTableTemplate(config.tableTheme) || Number.isFinite(row.price) && row.price>0 && !row.catalogUnavailable));
}
export function tablePages(config={}) { return productPages(eligibleTableRows(config),findTableTemplate(config.tableTheme)?.size||5); }
export function tableAssetUrls(item) {
  if(item.kind==='poster')return [...new Set([imageUrl(item.config?.logoImage),imageUrl(item.config?.backgroundImage)].filter(Boolean))];
  if(item.kind!=='price_table')return [];
  const config=item.config||{},template=findTableTemplate(config.tableTheme);
  return [...new Set([...tableImageRefs(config).map(imageUrl),...(template&&!config.sectorImage?[imageUrl({source:'builtin',id:template.photo})]:[])].filter(Boolean))];
}
export function tableExample(theme) {
  const ref=id=>({source:'builtin',id});
  const fruits=[['Manga',6.9,'mango'],['Abacaxi',4.9,'pineapple'],['Pêssego',6.9,'peach'],['Maçã',3.9,'apple'],['Laranja',2.9,'orange'],['Kiwi',8.9,'kiwi']].map(([name,price,id])=>({name,price,unit:'KG',active:true,image:ref(id)}));
  const deli=[['PRESUNTO DEFUMADO SADIA',38],['PRESUNTO REZENDE',30],['QUEIJO BRANCO ALMEIDA',0],['QUEIJO BRANCO CORONATA',30.5],['QUEIJO BRANCO DO MILK',0],['QUEIJO BRANCO FAZENDA',0],['QUEIJO CHEDDAR',59.3],['QUEIJO ESTEPE PJ',65.79],['QUEIJO GOUDA PJ',68.9],['QUEIJO ESFÉRICO BOLA PJ',66.9],['QUEIJO GORGONZOLA PJ',47.6],['QUEIJO PRATO PJ',38.9],['QUEIJO PRATO FRIMESA',33.5],['QUEIJO PRATO TIROLÊS',38.9],['QUEIJO PRATO PRESIDENT',33.5],['ROSBIFE CERATTI',37.5],['ROSBIFE CERATTI COM AZEITONAS',37.5],['ROSBIFE EDER / HANS',30]].map(([name,price])=>({name,price,unit:name==='ROSBIFE CERATTI'?'100G':'',active:true,...name==='ROSBIFE CERATTI'?{featured:true,image:ref('roast-beef')}:{}}));
  const samples={supermarket:[['Arroz tipo 1 · 5 kg',24.9],['Feijão carioca · 1 kg',8.5],['Café torrado · 500 g',19.9],['Leite integral · 1 litro',4.79],['Açúcar cristal · 1 kg',4.29]],bakery:[['Pão francês',16.9],['Pão de queijo',29.9],['Croissant artesanal',7.5],['Bolo caseiro',24.9],['Pão de fermentação natural',22.9]],butcher:[['Alcatra bovina',39.9],['Contrafilé',46.9],['Patinho',35.9],['Costela bovina',26.9],['Linguiça artesanal',23.9]]};
  return {kind:'price_table',name:'Demonstração',seconds:10,config:{title:theme==='deli'?'PANIFICADORA ÔNICA HIC · PROMOÇÃO DE FRIOS':theme.startsWith('produce')?'Hortifruti · ofertas do dia':findTableTemplate(theme)?.name||'Ofertas',tableTheme:theme,orientation:'horizontal',rows:theme==='deli'?deli:theme.startsWith('produce')?fruits:(samples[theme]||samples.supermarket).map(([name,price])=>({name,price,unit:theme==='butcher'?'KG':'UN',active:true}))}};
}
