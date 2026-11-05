import {HttpError} from './media.mjs';

export const priceTypes=['normal','offer','club'];
export function effectiveProduct(product,source={},override={}){
 const edits=JSON.parse(override.prices_json||'{}');
 const prices={normal:product.price,offer:source.offer??null,club:source.club??null,...edits};
 return {...product,sourceName:product.name,name:override.name||product.name,prices,price:prices.normal,
  originalPrices:{normal:product.price,offer:source.offer??null,club:source.club??null},overrides:edits,
  edited:!!override.name||Object.keys(edits).length>0,active:!!product.available&&prices.normal>0};
}
export function parseCatalogCsv(text){
 const rows=[];let row=[],field='',quoted=false;
 const separator=text.split(/\r?\n/)[0].includes(';')?';':',';
 const input=text.replace(/^\uFEFF/,'').replace(/\r\n?/g,'\n');
 for(let i=0;i<=input.length;i++){const c=input[i];if(c==='"'){if(quoted&&input[i+1]==='"'){field+='"';i++;}else quoted=!quoted;}
 else if(!quoted&&(c===separator||c==='\n'||c===undefined)){row.push(field.trim());field='';if(c!==separator){if(row.some(Boolean))rows.push(row);row=[];}}else if(c!==undefined)field+=c;}
 if(quoted)throw new HttpError(400,'CSV com aspas não fechadas.');
 const headers=rows.shift()||[];if(new Set(headers).size!==headers.length)throw new HttpError(400,'CSV com cabeçalhos repetidos.');for(const key of ['codigo','nome','preco_normal'])if(!headers.includes(key))throw new HttpError(400,'CSV exige codigo, nome e preco_normal.');
 const get=(r,k)=>r[headers.indexOf(k)]||'';
 const price=(value,optional=false)=>{if(optional&&!value)return null;const n=Number(value.replace(',','.'));if(!value||!Number.isFinite(n)||n<0||n>999999)throw new HttpError(400,'Preço CSV inválido.');return Math.round(n*100)/100;};
 const keys=new Set();const products=rows.map(r=>{const code=get(r,'codigo').padStart(6,'0'),department=(get(r,'departamento')||'00').padStart(2,'0'),name=get(r,'nome'),unit=get(r,'unidade');
 if(!/^\d{6}$/.test(code)||!/^\d{2}$/.test(department)||!name||name.length>160||unit.length>30)throw new HttpError(400,'Código, departamento, nome ou unidade inválidos no CSV.');
 const key=department+':'+code;if(keys.has(key))throw new HttpError(400,'Produto duplicado no CSV: '+key);keys.add(key);
 return {code,department,name,unit,price:price(get(r,'preco_normal')),offer:price(get(r,'preco_oferta'),true),club:price(get(r,'preco_clube'),true)};});
 if(!products.length)throw new HttpError(400,'CSV sem produtos.');
 return {products,zeroPrices:products.filter(p=>p.price===0).length};
}
