// Only appearance belongs to a theme: products, dates, titles and timing stay on the poster.
export const posterThemeKeys = ['background','color','font','rounded','gradient','showUnit','hideHeader','itemSize','priceSize','featuredItemSize','featuredPriceSize','logoImage','backgroundImage'];
export function posterAppearance(config = {}) {
 return Object.fromEntries(posterThemeKeys.filter(key => config[key] !== undefined).map(key => [key,config[key]]));
}
export const builtInPosterThemes = [
 {id:'builtin:market',name:'Mercado',appearance:{background:'#153b39',color:'#ffffff',font:'sans',rounded:true,gradient:false,showUnit:true,hideHeader:false}},
 {id:'builtin:produce',name:'Hortifruti',appearance:{background:'#275b29',color:'#fff5cf',font:'sans',rounded:true,gradient:true,showUnit:true,hideHeader:false}},
 {id:'builtin:bakery',name:'Padaria',appearance:{background:'#563421',color:'#fff1d6',font:'serif',rounded:true,gradient:false,showUnit:true,hideHeader:false}},
 {id:'builtin:butcher',name:'Açougue',appearance:{background:'#7e2028',color:'#ffffff',font:'sans',rounded:false,gradient:true,showUnit:true,hideHeader:false}},
];
