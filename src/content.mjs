import { HttpError } from './media.mjs';
import {findTableTemplate,validImageRef,tablePriceFormats} from '../public/table-templates.js';

function imageRef(value) {
  if(value==null || value==='')return null;
  if(!validImageRef(value))throw new HttpError(400,'Referência de imagem inválida. Escolha uma imagem da biblioteca ou de fábrica.');
  return {source:value.source,id:value.id};
}

function text(value, label, max = 500, required = false) {
  if (value === undefined && !required) return '';
  if (typeof value !== 'string' || value.length > max || (required && !value.trim())) throw new HttpError(400, `${label}: informe um texto de até ${max} caracteres.`);
  return value.trim();
}
function https(value) {
  let url;
  try { url = new URL(value); } catch { throw new HttpError(400, 'Informe uma URL HTTPS válida.'); }
  if (url.protocol !== 'https:' || url.username || url.password) throw new HttpError(400, 'Informe uma URL HTTPS sem credenciais.');
  return url;
}
function price(value) {
  const normalized = typeof value === 'string' ? value.replace(',', '.') : value;
  const amount = Number(normalized);
  if (normalized === '' || normalized == null || !Number.isFinite(amount) || amount < 0 || amount > 99999999) throw new HttpError(400, 'Preço inválido. Use um número positivo.');
  return Math.round(amount * 100) / 100;
}
function boolean(value, label, fallback) {
  if (value === undefined || value === null) return fallback;
  if (typeof value !== 'boolean') throw new HttpError(400, `${label}: use verdadeiro ou falso.`);
  return value;
}
function fontSize(value, label) {
  if (value === undefined || value === null || value === '') return null;
  const size = Number(value);
  if (!Number.isInteger(size) || size < 8 || size > 200) throw new HttpError(400, `${label}: use um número inteiro entre 8 e 200.`);
  return size;
}
export function validateContent(body) {
  const name = text(body.name, 'Nome', 120, true);
  const kind = body.kind;
  const c = body.config;
  if (!c || typeof c !== 'object' || Array.isArray(c)) throw new HttpError(400, 'Configuração de conteúdo inválida.');
  let config;
  const theme = () => {
    const background = c.background || '#102d39', color = c.color || '#ffffff';
    if (![background, color].every(value => /^#[0-9a-f]{6}$/i.test(value))) throw new HttpError(400, 'Use cores no formato #RRGGBB.');
    return { background, color };
  };
  const rows = (max) => {
    if (!Array.isArray(c.rows) || !c.rows.length || c.rows.length > max) throw new HttpError(400, `Informe de 1 a ${max} produtos.`);
    return c.rows.map(row => ({ name: text(row?.name, 'Produto', 160, true), price: price(row?.price), active: row.active !== false, code: text(row?.code, 'Código', 80), unit: text(row?.unit, 'Unidade', 30), department:text(row?.department,'Departamento',2) }));
  };
  if (kind === 'product_image') config = { mediaId: text(c.mediaId, 'Imagem do produto', 36, true), title: text(c.title || name, 'Produto', 160, true) };
  else if (kind === 'web') config = { url: https(c.url).href };
  else if (kind === 'youtube') {
    const url = https(c.url);
    const host = url.hostname.toLowerCase().replace(/^www\./, '');
    let videoId = host === 'youtu.be' ? url.pathname.slice(1) : ['youtube.com', 'm.youtube.com'].includes(host) ? (url.searchParams.get('v') || /^\/(?:shorts|embed)\/([\w-]+)/.exec(url.pathname)?.[1]) : null;
    if (!/^[\w-]{11}$/.test(videoId || '')) throw new HttpError(400, 'Informe o link de um vídeo ou Short do YouTube.');
    config = { url: url.href, videoId };
  } else if (kind === 'poster') {
    const layout = c.layout || 'grid';
    if (!['list-spotlight','spotlight','campaign','grid'].includes(layout)) throw new HttpError(400, 'Layout de cartaz inválido.');
    const hideHeader = boolean(c.hideHeader, 'Ocultar cabeçalho', false);
    const sizes = {};
    for (const [key, label] of [['itemSize','Tamanho do item'],['priceSize','Tamanho do preço'],['featuredItemSize','Tamanho do item em destaque'],['featuredPriceSize','Tamanho do preço em destaque']]) {
      const value = fontSize(c[key], label);
      if (value !== null) sizes[key] = value;
    }
    config = {
      ...theme(), title: text(c.title, 'Título', 160, !hideHeader), body: text(c.body, 'Texto', 3000), layout,
      rows: c.rows?.length ? rows(6) : [], hideHeader,
      rounded: boolean(c.rounded, 'Cantos arredondados', false),
      gradient: boolean(c.gradient, 'Fundo degradê', false),
      showUnit: boolean(c.showUnit, 'Mostrar unidade', true),
      ...(c.logoImage ? {logoImage:imageRef(c.logoImage)} : {}),
      ...(c.backgroundImage ? {backgroundImage:imageRef(c.backgroundImage)} : {}),
      ...sizes,
    };
  }
  else if (kind === 'offer') config = { ...theme(), title: text(c.title, 'Produto', 160, true), price: price(c.price), oldPrice: c.oldPrice === '' || c.oldPrice == null ? null : price(c.oldPrice), body: text(c.body, 'Detalhes', 1000) };
  else if (kind === 'price_table') {
    if (!Array.isArray(c.rows) || !c.rows.length || c.rows.length > 50) throw new HttpError(400, 'A tabela aceita de 1 a 50 produtos.');
    const tableTheme = c.tableTheme || 'custom';
    const priceFormat=c.priceFormat??'standard';
    if(!tablePriceFormats.some(format=>format.id===priceFormat))throw new HttpError(400,'Formato de preço inválido.');
    if (!['custom','market'].includes(tableTheme) && !findTableTemplate(tableTheme)) throw new HttpError(400, 'Tema de tabela inválido.');
    const tableRows=rows(50).map((row,index)=>({...row,featured:boolean(c.rows[index].featured,'Produto em destaque',false),image:imageRef(c.rows[index].image),catalogUnavailable:boolean(c.rows[index].catalogUnavailable,'Disponibilidade do produto',false)}));
    if(tableRows.filter(row=>row.featured).length>1)throw new HttpError(400,'Selecione somente um produto em destaque.');
    config = { ...theme(), title: text(c.title, 'Título', 160, true), rows: tableRows, tableTheme,priceFormat,sectorImage:imageRef(c.sectorImage),backgroundImage:imageRef(c.backgroundImage) };
  } else if (kind === 'weather') {
    const latitude = Number(c.latitude), longitude = Number(c.longitude);
    if (c.latitude === '' || c.longitude === '' || !Number.isFinite(latitude) || !Number.isFinite(longitude) || Math.abs(latitude) > 90 || Math.abs(longitude) > 180) throw new HttpError(400, 'Latitude ou longitude inválida.');
    config = { ...theme(), city: text(c.city, 'Cidade', 160, true), latitude, longitude };
  } else throw new HttpError(400, 'Tipo de conteúdo inválido.');
  if (c.orientation && !['horizontal','vertical'].includes(c.orientation)) throw new HttpError(400, 'Orientação inválida.');
  if (c.font && !['sans','serif','mono'].includes(c.font)) throw new HttpError(400, 'Fonte inválida.');
  config.orientation = c.orientation || 'horizontal'; config.font = c.font || 'sans';
  if(c.priceType!==undefined){if(!['normal','offer','club'].includes(c.priceType))throw new HttpError(400,'Tipo de preço inválido.');config.priceType=c.priceType;}
  if(c.catalogUnavailable === true)config.catalogUnavailable=true;
  if(c.productKey){if(typeof c.productKey!=='string'||!/^\d{2}:\d{6}$/.test(c.productKey))throw new HttpError(400,'Produto do catálogo inválido.');config.productKey=c.productKey;}
  if (c.secondsPerItem != null) { const seconds = Number(c.secondsPerItem); if (!Number.isInteger(seconds) || seconds < 1 || seconds > 3600) throw new HttpError(400, 'Tempo por produto inválido.'); config.secondsPerItem = seconds; }
  Object.assign(config,validateValidity(c));
  return { name, kind, config };
}

export function validateValidity(c) {
  const config={};
  for (const key of ['validFrom', 'validUntil']) {
    const value = c[key];
    if (value == null || value === '') config[key] = null;
    else {
      if (typeof value !== 'string' || !/(Z|[+-]\d{2}:\d{2})$/.test(value) || !Number.isFinite(Date.parse(value))) throw new HttpError(400, 'Informe uma data de validade válida com fuso horário.');
      config[key] = new Date(value).toISOString();
    }
  }
  if (config.validFrom && config.validUntil && Date.parse(config.validFrom) >= Date.parse(config.validUntil)) throw new HttpError(400, 'O fim da validade deve ser posterior ao início.');
  return config;
}
