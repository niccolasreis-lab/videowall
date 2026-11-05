export function resolveCatalogContent(kind,config,catalog){
 const type=config.priceType||'normal';
 const resolve=(row,key)=>{const p=key?catalog.product(key):null;if(!p)return key?{...row,catalogUnavailable:true}:row;
 const price=p.prices[type];return {...row,name:p.name,title:p.name,price:price??0,unit:p.unit,department:p.department,catalogUnavailable:!p.available||!(price>0)};};
 if(kind==='offer'&&config.productKey){const p=resolve({name:config.title,...config},config.productKey);delete p.name;return p;}
 if(config.rows){const cache=new Map();const rows=config.rows.map(row=>{let key=row.department&&row.code?row.department+':'+row.code:null;
 if(!key&&row.code){if(!cache.has(row.code)){const found=catalog.search(new URLSearchParams({q:row.code})).items.filter(p=>p.code===row.code);cache.set(row.code,found.length===1?found[0].product_key:null);}key=cache.get(row.code);}
 const result=resolve(row,key);delete result.title;return result;});return {...config,rows};}
 return config;
}
