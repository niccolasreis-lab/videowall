import {createHash} from 'node:crypto';
import {HttpError} from './media.mjs';

export const MUSARDOS_API='https://videowallmusardos.com/ms/api';
export const normalizePhotoSearch=value=>String(value||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[\s_-]+/g,' ').trim();
export const sourceId=url=>createHash('sha256').update(url).digest('hex');

export function allowedPhotoUrl(value) {
  if(typeof value!=='string'||value.length>2048)throw new HttpError(400,'URL de imagem inválida.');
  let url;try{url=new URL(value);}catch{throw new HttpError(400,'URL de imagem inválida.');}
  let pathname;try{pathname=decodeURIComponent(url.pathname);}catch{throw new HttpError(400,'URL de imagem inválida.');}
  if(url.protocol!=='https:'||url.hostname!=='bucket.musardos.com'||url.port||url.username||url.password||url.search||url.hash||/%(?:2f|5c)/i.test(url.pathname)||!/^\/produto\/[^/\\%\x00-\x1f?#]+\.(?:png|jpe?g|webp|gif|avif)$/i.test(pathname))throw new HttpError(400,'Escolha uma imagem pública de bucket.musardos.com/produto/.');
  return url.href;
}

export function normalizePhoto(value) {
  const record=typeof value==='string'?{url:value}:value;
  if(!record||typeof record!=='object'||Array.isArray(record))throw new HttpError(400,'Registro de imagem inválido.');
  const url=allowedPhotoUrl(record.url??record.sourceUrl??record.Url);
  let basename;try{basename=decodeURIComponent(new URL(url).pathname.split('/').at(-1));}catch{throw new HttpError(400,'Nome de arquivo inválido.');}
  const filename=String(record.filename??record.Filename??basename).slice(0,240);
  const name=String(record.name??record.nome??record.Nome??filename.replace(/\.[^.]+$/,'').replace(/[-_]+/g,' ')).trim().slice(0,240)||filename;
  const brand=String(record.brand??record.marca??'').trim().slice(0,120);
  return {id:sourceId(url),url,name,filename,brand};
}

function delimitedRows(text) {
  const source=text.replace(/^\uFEFF/,'').replace(/\r\n?/g,'\n');
  const separator=source.split('\n')[0].includes(';')?';':',';
  const rows=[];let row=[],field='',quoted=false;
  for(let i=0;i<=source.length;i++){
    const c=source[i];
    if(c==='"'){if(quoted&&source[i+1]==='"'){field+='"';i++;}else quoted=!quoted;}
    else if(!quoted&&(c===separator||c==='\n'||c===undefined)){row.push(field.trim());field='';if(c!==separator){if(row.some(Boolean))rows.push(row);row=[];}}
    else if(c!==undefined)field+=c;
  }
  if(quoted)throw new HttpError(400,'CSV com aspas não fechadas.');
  return rows;
}
function csvRows(text) {
  const rows=delimitedRows(text);
  const header=(rows.shift()||[]).map(normalizePhotoSearch);
  const urlColumn=header.findIndex(key=>['url','sourceurl','source url','url da imagem'].includes(key));
  if(urlColumn<0)throw new HttpError(400,'A exportação CSV precisa da coluna url ou sourceUrl.');
  const nameColumn=header.findIndex(key=>['nome','name','produto'].includes(key));
  const brandColumn=header.findIndex(key=>['marca','brand'].includes(key));
  const fileColumn=header.findIndex(key=>['filename','arquivo'].includes(key));
  return rows.map(row=>({url:row[urlColumn],...(nameColumn>=0?{name:row[nameColumn]}:{}),...(brandColumn>=0?{brand:row[brandColumn]}:{}),...(fileColumn>=0?{filename:row[fileColumn]}:{})}));
}

export function parseProductSearchList(text){
  if(typeof text!=='string'||!text.trim())throw new HttpError(400,'Informe uma lista de produtos.');
  if(Buffer.byteLength(text)>2*1024*1024)throw new HttpError(413,'A lista aceita até 2 MB.');
  const rows=delimitedRows(text),header=(rows[0]||[]).map(normalizePhotoSearch);
  let column=header.findIndex(value=>['nome','name','produto'].includes(value));
  if(column>=0)rows.shift();else{
    if(!rows.length||rows[0].length<4||!/^\d+$/.test(rows[0][0]))throw new HttpError(400,'Use ListaPreco.txt (código;nome;quantidade;preço) ou CSV com a coluna nome.');
    column=1;
  }
  if(!rows.length||rows.length>10000)throw new HttpError(400,'A lista aceita de 1 a 10.000 produtos.');
  const names=new Map();for(const [index,row]of rows.entries()){
    const name=String(row[column]||'').trim();
    if(name.length<2||name.length>160)throw new HttpError(400,'Nome de produto inválido na linha '+(index+1)+'. Use de 2 a 160 caracteres.');
    names.set(normalizePhotoSearch(name),name);
  }
  return {records:rows.length,names:[...names.values()],duplicates:rows.length-names.size};
}

export function parsePhotoExport(text) {
  if(typeof text!=='string'||!text.trim())throw new HttpError(400,'Informe uma exportação JSON ou CSV.');
  if(Buffer.byteLength(text)>16*1024*1024)throw new HttpError(413,'A exportação aceita até 16 MB.');
  const trimmed=text.replace(/^\uFEFF/,'').trim();let records;
  if(/^[\[{]/.test(trimmed)){
    let data;try{data=JSON.parse(trimmed);}catch{throw new HttpError(400,'Exportação JSON inválida.');}
    records=Array.isArray(data)?data:data?.items;
    if(!Array.isArray(records))throw new HttpError(400,'O JSON precisa conter uma lista de imagens ou items.');
  }else records=csvRows(trimmed);
  if(!records.length)throw new HttpError(400,'A exportação não contém imagens.');
  return records.map(normalizePhoto);
}

export class MusardosImages {
  constructor({fetcher=globalThis.fetch,timeoutMs=30000}={}){this.fetcher=fetcher;this.timeoutMs=timeoutMs;}
  async request(path,{user,body,signal}={}) {
    const headers={Accept:'application/json'};
    if(body)headers['Content-Type']='application/json';
    if(user){headers.Authorization='Bearer '+user.token;headers.ClienteId=user.staff?'0':user.clientId;if(user.clientKey&&!user.staff)headers.ClienteKey=user.clientKey;}
    let response;
    try{response=await this.fetcher(MUSARDOS_API+path,{method:body?'POST':'GET',headers,...body?{body:JSON.stringify(body)}:{},redirect:'error',signal:signal?AbortSignal.any([signal,AbortSignal.timeout(this.timeoutMs)]):AbortSignal.timeout(this.timeoutMs)});}
    catch(error){if(signal?.aborted)throw signal.reason;throw new HttpError(502,'Não foi possível consultar o Musardos. Confira a conexão e tente novamente.');}
    if(response.status===401)throw new HttpError(401,user?'A sessão Musardos expirou. Conecte novamente.':'Login ou senha Musardos inválidos.');
    if(response.status===403)throw new HttpError(403,'Sua conta não permite listar esta biblioteca. Use uma exportação autorizada.');
    if(response.status===429)throw new HttpError(429,'O Musardos limitou as consultas. Aguarde e retome a importação.');
    if(!response.ok)throw new HttpError(502,'O catálogo Musardos está indisponível (HTTP '+response.status+').');
    let size=0,text='';const decoder=new TextDecoder();
    for await(const chunk of response.body){size+=chunk.length;if(size>16*1024*1024)throw new HttpError(502,'A resposta do catálogo ultrapassou o limite permitido.');text+=decoder.decode(chunk,{stream:true});}
    text+=decoder.decode();try{return JSON.parse(text);}catch{throw new HttpError(502,'O Musardos retornou um catálogo em formato inesperado.');}
  }
  async login(login,password) {
    if(typeof login!=='string'||!login.trim()||login.length>320||typeof password!=='string'||!password.trim()||password.length>256)throw new HttpError(400,'Informe login e senha Musardos.');
    const value=await this.request('/Usuarios/Login',{body:{Login:login.trim(),Senha:password.trim()}});
    if(!value||!value.Id||typeof value.Token!=='string'||!value.Token||value.Token.length>16384)throw new HttpError(502,'A resposta de login Musardos não contém uma sessão válida.');
    const clientId=String(value.ClienteId??'');const clientKey=String(value.ClienteKey??'');
    if(clientId.length>4096||clientKey.length>8192||/[\r\n]/.test(clientId+clientKey+value.Token))throw new HttpError(502,'A sessão Musardos retornou dados inválidos.');
    return {id:String(value.Id),login:String(value.Login||login.trim()).slice(0,320),token:value.Token,clientId,clientKey,staff:[1,5].includes(Number(value.GrupoUsuarioId))};
  }
  scopes(user) {
    const clients=[...new Set(user.clientId.split(',').map(id=>id.trim()).filter(id=>/^\d+$/.test(id)&&Number(id)>0))];
    return [{id:'shared',label:'Biblioteca compartilhada',status:'pending',count:0,cursor:null,pages:0},...clients.map(id=>({id:'client:'+id,label:'Biblioteca do cliente '+id,status:'pending',count:0,cursor:null,pages:0})),...!clients.length?[{id:'client:unknown',label:'Bibliotecas de clientes',status:'blocked',count:0,error:'O login não informou os clientes que podem ser enumerados. Importe uma exportação autorizada.'}]:[]];
  }
  async search(user,term,signal) {
    const query=new URLSearchParams({nome:term});
    if(user.clientId)query.set('clienteId',user.clientId);
    const data=await this.request('/ProdutoImagens/Search?'+query,{user,signal});
    if(!Array.isArray(data))throw new HttpError(502,'A busca Musardos retornou um formato inesperado.');
    return data.map(normalizePhoto);
  }
  async page(user,scope,signal) {
    const query=new URLSearchParams({pageSize:'48'});const client=scope.id.startsWith('client:');
    if(client)query.set('clienteId',scope.id.slice(7));if(scope.cursor)query.set('continuationToken',scope.cursor);
    const data=await this.request('/ProdutoImagens/'+(client?'ClienteLibrary':'SharedLibrary')+'?'+query,{user,signal});
    if(!data||!Array.isArray(data.items)||typeof data.hasMore!=='boolean')throw new HttpError(502,'A listagem não confirmou sua paginação. A cópia não pode ser considerada completa.');
    const cursor=data.continuationToken;
    if(data.hasMore&&(!data.items.length||typeof cursor!=='string'||!cursor||cursor.length>16384||cursor===scope.cursor))throw new HttpError(502,'A paginação do catálogo não avançou. Retome a cópia quando o serviço normalizar.');
    return {items:data.items.map(normalizePhoto),hasMore:data.hasMore,cursor:data.hasMore?cursor:null};
  }
}
