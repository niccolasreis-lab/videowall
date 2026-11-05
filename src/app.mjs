import {createOperations,pointSettings,playerTelemetry,dayKey} from './operations.mjs';
import {createPlaylistGraph} from './playlist-graph.mjs';
import {resolveCatalogContent} from './catalog-content.mjs';
import { createCatalog } from './catalog.mjs';
import { createServer } from 'node:http';
import { createHash, randomBytes, randomInt, randomUUID, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { unlink } from 'node:fs/promises';
import { openDatabase, transaction } from './database.mjs';
import { HttpError, receiveMedia, sendFile } from './media.mjs';
import { validateContent,validateValidity } from './content.mjs';
import {offlineTelemetry,ingestEvents} from './offline.mjs';
import {validateSchedule} from '../public/playlist-schedule.js';
import {createPosterThemes} from './poster-themes.mjs';
import {builtInImages,referencedMediaIds,findTableTemplate} from '../public/table-templates.js';
import {createImageBank} from './image-bank.mjs';
import {createCampaigns} from './campaigns.mjs';
import {createErpInbox} from './erp-inbox.mjs';

function scheduleInput(value){try{return validateSchedule(value);}catch(error){throw new HttpError(400,error.message);}}

const deriveKey = promisify(scrypt);
const publicDir = fileURLToPath(new URL('../public/', import.meta.url));
const hash = value => createHash('sha256').update(value).digest('hex');
const json = (res, status, value) => {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(value));
};
function text(value, field, max = 120, optional = false) {
  if (optional && (value === undefined || value === null)) return '';
  if (typeof value !== 'string' || (!optional && !value.trim()) || value.length > max) {
    throw new HttpError(400, `${field}: informe um texto de até ${max} caracteres.`);
  }
  return value.trim();
}
async function readJson(req,maximum=1024*1024) {
  if (!(req.headers['content-type'] || '').startsWith('application/json')) throw new HttpError(415, 'Envie os dados em JSON.');
  const chunks = []; let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > maximum) throw new HttpError(413, 'A solicitação é muito grande.');
    chunks.push(chunk);
  }
  try {
    const result = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (result === null || Array.isArray(result) || typeof result !== 'object') throw new Error();
    return result;
  } catch { throw new HttpError(400, 'Dados JSON inválidos.'); }
}
function cookies(req) {
  const result = {};
  for (const part of (req.headers.cookie || '').split(';')) {
    const separator = part.indexOf('=');
    if (separator > 0) result[part.slice(0, separator).trim()] = part.slice(separator + 1).trim();
  }
  return result;
}
function makeCode() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  return Array.from({ length: 6 }, () => alphabet[randomInt(alphabet.length)]).join('');
}

export function createApplication({ dataDir, secureCookies = false, maxUploadBytes = 250 * 1024 * 1024, clock = Date.now, imageBankFetch = globalThis.fetch }) {
  const db = openDatabase(dataDir);
  const catalog = createCatalog(db, clock);
  const operations=createOperations(db,clock);
  const posterThemes = createPosterThemes(db);
  const campaigns = createCampaigns({db,clock,catalog,posterThemes});
  const erp = createErpInbox(db,catalog,campaigns.refreshPrices);
  const imageBank=createImageBank({db,dataDir,clock,fetcher:imageBankFetch,maxBytes:maxUploadBytes,isOwnerActive:owner=>{
    const session=db.prepare('SELECT expires_at FROM sessions WHERE token_hash=?').get(owner);return !!session&&session.expires_at>clock();
  }});
  const q = (sql, ...args) => db.prepare(sql).get(...args);
  const all = (sql, ...args) => db.prepare(sql).all(...args);
  const run = (sql, ...args) => db.prepare(sql).run(...args);
  const graph=createPlaylistGraph(db,contentDto,mustContent,clock);
  const limiters = new Map();
  const activeUploads = new Set();
  function limit(req, key, maximum, windowMs) {
    const id = `${req.socket.remoteAddress}:${key}`;
    const old = limiters.get(id);
    const entry = old && old.until > clock() ? old : { count: 0, until: clock() + windowMs };
    entry.count++;
    limiters.set(id, entry);
    if (limiters.size > 1000) for (const [k, v] of limiters) if (v.until < clock()) limiters.delete(k);
    if (entry.count > maximum) throw new HttpError(429, 'Muitas tentativas. Aguarde alguns minutos.');
  }
  function setCookie(res, name, value, seconds) {
    res.setHeader('Set-Cookie', `${name}=${value}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${seconds}${secureCookies ? '; Secure' : ''}`);
  }
  function admin(req) {
    const token = cookies(req).vw_session;
    if (!token || token.length !== 64) return undefined;
    return q('SELECT a.username, a.workspace FROM admins a, sessions s WHERE s.token_hash = ? AND s.expires_at > ?', hash(token), clock());
  }
  function device(req) {
    const token = cookies(req).vw_device;
    if (!token || token.length !== 64) return undefined;
    return q('SELECT * FROM devices WHERE token_hash = ?', hash(token));
  }
  function mustFind(table, id, name) {
    const row = q(`SELECT * FROM ${table} WHERE id = ?`, id);
    if (!row || table==='playlists' && campaigns.internal(id)) throw new HttpError(404, `${name} não encontrado.`);
    return row;
  }
  function mediaDto(row) {
    return { id: row.id, name: row.name, filename: row.filename, mime: row.mime, kind: row.kind, size: row.size, config:JSON.parse(row.validity_json||'{}'), hasPrices:!!row.has_prices, createdAt: row.created_at, url: `/media/${row.id}` };
  }
  function contentDto(row) {
    if (!row.config_json) return mediaDto(row);
    const config = JSON.parse(row.config_json);
    const assetMediaIds=referencedMediaIds({kind:row.kind,config});
    return { id: row.id, name: row.name, kind: row.kind, config, createdAt: row.created_at, size: 0, ...(assetMediaIds.length?{assetMediaIds}:{}), hasPrices:row.kind==='product_image'?!!q('SELECT has_prices FROM media WHERE id=?',config.mediaId)?.has_prices:undefined, url: row.kind === 'product_image' ? `/media/${config.mediaId}` : null, sourceMediaId: row.kind === 'product_image' ? config.mediaId : null };
  }
  function mustContent(id) {
    const row = q('SELECT * FROM media WHERE id = ?', id) || q('SELECT * FROM virtual_content WHERE id = ?', id);
    if (!row) throw new HttpError(404, 'Conteúdo não encontrado.');
    return row;
  }
  function playlistDto(row) {
    const publication = row.current_publication_id ? q('SELECT version, draft_revision, created_at, snapshot_json FROM publications WHERE id = ?', row.current_publication_id) : null;
    const items = JSON.parse(row.items_json).map(item => ({ ...item, media:item.playlistId?null:contentDto(mustContent(item.mediaId)),...(item.playlistId?{playlistName:mustFind('playlists',item.playlistId,'Playlist').name}:{}) }));
    return {
      id: row.id, name: row.name, revision: row.revision, items, schedule:JSON.parse(row.schedule_json||'{"enabled":false}'),
      publishedItems: publication ? JSON.parse(publication.snapshot_json).items.map(item => ({ mediaId: item.mediaId })) : [],
      publishedVersion: publication?.version || 0,
      publishedAt: publication?.created_at || null,
      dirty: !publication || publication.draft_revision !== row.revision,
      pointCount: q('SELECT COUNT(*) AS n FROM points WHERE playlist_id = ?', row.id).n,
      createdAt: row.created_at, updatedAt: row.updated_at,
    };
  }
  function pointDto(row) {
    const d = q('SELECT * FROM devices WHERE point_id = ?', row.id);
    const p = row.playlist_id ? q('SELECT name, current_publication_id FROM playlists WHERE id = ?', row.playlist_id) : null;
    const publication = getPublication(row);
    const online = !!d?.last_seen && clock() - d.last_seen < 25000;
    const current = d?.current_media_id ? q('SELECT * FROM media WHERE id = ?', d.current_media_id) || q('SELECT * FROM virtual_content WHERE id = ?', d.current_media_id) : null;
    const reported=d?.active_publication_id?q('SELECT version,snapshot_json FROM publications WHERE id=?',d.active_publication_id):null;
    const currentSnapshot=reported&&JSON.parse(reported.snapshot_json).items.find(item=>item.mediaId===d.current_media_id);
    return {
      id: row.id, name: row.name, location: row.location, fit: row.fit,
      playlistId: row.playlist_id, playlistName: p?.name || null,
      publishedVersion: publication?.version || 0,
      paired: !!d, online, lastSeen: d?.last_seen || null,
      playbackState: d?.playback_state || 'waiting',
      offline: d ? JSON.parse(d.offline_json||'{}') : {},
      activePublicationId:d?.active_publication_id||null,
      activePublishedVersion:reported?.version||0,
      currentMedia: currentSnapshot?{...currentSnapshot,id:currentSnapshot.mediaId}:current ? contentDto(current) : null,
      settings:JSON.parse(row.settings_json||'{}'),telemetry:JSON.parse(d?.telemetry_json||'{}'),lastCatalogApplied:catalog.lastApplied()?.applied_at||null,
      createdAt: row.created_at,
    };
  }
  function getPublication(point) {
    if (!point) return null;
    const row = point.publication_id && q('SELECT * FROM publications WHERE id = ?', point.publication_id);
    const base = row ? { id: row.id, version: row.version, ...JSON.parse(row.snapshot_json) } : null;
    return campaigns.publication(point,base);
  }
  function validateItems(items) {
    if (!Array.isArray(items) || items.length > 500) throw new HttpError(400, 'A playlist aceita até 500 itens.');
    const ids = new Set();
    return items.map(item => {
      if (!item || typeof item !== 'object' || (typeof item.mediaId !== 'string'&&typeof item.playlistId!=='string') || (item.mediaId&&item.playlistId)) throw new HttpError(400, 'Item de playlist inválido.');
      if(item.playlistId){mustFind('playlists',item.playlistId,'Subplaylist');const id=typeof item.id==='string'&&/^[a-z0-9-]{36}$/.test(item.id)?item.id:randomUUID();if(ids.has(id))throw new HttpError(400,'Identificador repetido.');ids.add(id);return {id,playlistId:item.playlistId};}
      const media = mustContent(item.mediaId);
      const seconds = media.kind === 'video' ? 0 : Number(item.seconds ?? 10);
      if (!Number.isInteger(seconds) || (media.kind !== 'video' && (seconds < 1 || seconds > 3600))) throw new HttpError(400, 'A duração deve ser de 1 a 3.600 segundos.');
      const id = typeof item.id === 'string' && /^[a-z0-9-]{36}$/.test(item.id) ? item.id : randomUUID();
      if (ids.has(id)) throw new HttpError(400, 'Os itens da sequência precisam ter identificadores distintos.');
      ids.add(id);
      return { id, mediaId: media.id, seconds };
    });
  }
  function validatePoint(body) {
    const playlistId = body.playlistId || null;
    let publicationId = null;
    if (playlistId) publicationId = mustFind('playlists', playlistId, 'Playlist').current_publication_id;
    const fit = body.fit || 'contain';
    if (!['contain', 'cover'].includes(fit)) throw new HttpError(400, 'Ajuste de tela inválido.');
    return { name: text(body.name, 'Nome do ponto'), location: text(body.location, 'Local', 160, true), fit, playlistId, publicationId,settings:body.settings===undefined?undefined:pointSettings(body.settings) };
  }
  function pairedState(d) {
    if (!d.point_id) return { state: 'pairing', deviceId:d.id, code: d.code, expiresAt: d.code_expires_at, expired: !d.code_expires_at || d.code_expires_at < clock(), serverTime: clock() };
    const point = mustFind('points', d.point_id, 'Ponto');
    const publication = getPublication(point);
    if(publication)run('INSERT OR IGNORE INTO device_publications (device_id,point_id,publication_id) VALUES (?,?,?)',d.id,point.id,publication.id);
    return {
      state: 'paired', deviceId:d.id, point: { id: point.id, name: point.name, location: point.location, fit: point.fit,settings:JSON.parse(point.settings_json||'{}') },
      publication, commandVersion: point.command_version, serverTime: clock(),
    };
  }
  function publishContent(contentId) {
        const content = mustFind('virtual_content', contentId, 'Conteúdo');
        const affected = all('SELECT p.*, pub.snapshot_json, pub.draft_revision AS published_revision FROM playlists p JOIN publications pub ON p.current_publication_id = pub.id').filter(playlist => JSON.parse(playlist.snapshot_json).items.some(item => item.mediaId === content.id));
        transaction(db, () => {
          for (const playlist of affected) {
            const base = JSON.parse(playlist.snapshot_json);
            const items = base.items.map(item => item.mediaId === content.id ? { ...contentDto(content), id: item.id, mediaId: item.mediaId, seconds: item.seconds } : item);
            const currentDraft = graph.expand(playlist.id).items;
            const comparable = rows => rows.map(item => [item.id, item.mediaId, item.seconds, item.name, item.kind, item.url, item.sourceMediaId || null, item.config || null]);
            const matchesDraft = playlist.name === base.playlistName && JSON.stringify(comparable(currentDraft)) === JSON.stringify(comparable(items)) && JSON.stringify(JSON.parse(playlist.schedule_json||'{"enabled":false}'))===JSON.stringify(base.schedule||{enabled:false});
            const id = randomUUID(), version = q('SELECT COALESCE(MAX(version), 0) + 1 AS n FROM publications WHERE playlist_id = ?', playlist.id).n;
            run('INSERT INTO publications VALUES (?, ?, ?, ?, ?, ?)', id, playlist.id, version, matchesDraft ? playlist.revision : playlist.published_revision, JSON.stringify({ ...base, playlistName: base.playlistName, items, schedule:base.schedule||{enabled:false} }), clock());
            run('UPDATE playlists SET current_publication_id = ? WHERE id = ?', id, playlist.id);
            run('UPDATE points SET publication_id = ? WHERE playlist_id = ?', id, playlist.id);operations.record('publish',playlist.id);
          }
        });
        return { ok: true, playlistsUpdated: affected.length };

  }
  async function authenticate(req, res, setup) {
    limit(req, 'auth', 30, 15 * 60000);
    const body = await readJson(req);
    const username = text(body.username, 'Usuário', 80);
    if (!/^[\w.-]{3,80}$/.test(username)) throw new HttpError(400, 'Use de 3 a 80 letras, números, pontos ou traços no usuário.');
    const password = typeof body.password === 'string' ? body.password : '';
    if (password.length > 256) throw new HttpError(400, 'Senha muito longa.');
    if (setup) {
      if (password.length < 10) throw new HttpError(400, 'Escolha uma senha com pelo menos 10 caracteres.');
      if (q('SELECT id FROM admins')) throw new HttpError(409, 'O administrador já foi configurado.');
      const salt = randomBytes(16).toString('hex');
      const derived = await deriveKey(password, salt, 64);
      transaction(db, () => {
        if (q('SELECT id FROM admins')) throw new HttpError(409, 'O administrador já foi configurado.');
        run('INSERT INTO admins VALUES (1, ?, ?, ?, ?)', username, `${salt}:${derived.toString('hex')}`, text(body.workspace || 'Minha rede', 'Nome da rede', 80), clock());
      });
    } else {
      const row = q('SELECT * FROM admins WHERE username = ?', username);
      const [salt, saved] = row ? row.password_hash.split(':') : ['not-a-real-salt', '00'.repeat(64)];
      const derived = await deriveKey(password, salt, 64);
      if (!row || !timingSafeEqual(Buffer.from(saved, 'hex'), derived)) throw new HttpError(401, 'Usuário ou senha incorretos.');
    }
    const token = randomBytes(32).toString('hex');
    run('DELETE FROM sessions WHERE expires_at < ?', clock());
    run('INSERT INTO sessions VALUES (?, ?)', hash(token), clock() + 8 * 3600000);
    setCookie(res, 'vw_session', token, 8 * 3600);
    json(res, 200, { ok: true });
  }

  async function handle(req, res) {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'same-origin');
    res.setHeader('X-Frame-Options', 'SAMEORIGIN');
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' blob: data:; media-src 'self' blob:; connect-src 'self' https://api.open-meteo.com; frame-src 'self' https:; font-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'self'");
    const url = new URL(req.url, 'http://local');
    const pathname = url.pathname;
    const method = req.method;
    if (!['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) throw new HttpError(405, 'Método não permitido.');
    if (!['GET', 'HEAD'].includes(method) && req.headers.origin) {
      let origin;
      try { origin = new URL(req.headers.origin); } catch { throw new HttpError(403, 'Origem inválida.'); }
      if (origin.host !== req.headers.host) throw new HttpError(403, 'Solicitação de outra origem bloqueada.');
    }
    if (pathname === '/api/health' && method === 'GET') return json(res, 200, { ok: true, version: '0.1.0' });
    if (pathname === '/api/session' && method === 'GET') return json(res, 200, { setupRequired: !q('SELECT id FROM admins'), user: admin(req) || null, maxUploadBytes });
    if (pathname === '/api/auth/setup' && method === 'POST') return authenticate(req, res, true);
    if (pathname === '/api/auth/login' && method === 'POST') return authenticate(req, res, false);
    if (pathname === '/api/auth/logout' && method === 'POST') {
      const token = cookies(req).vw_session;
      if(token)await imageBank.disconnect(hash(token));
      if (token) run('DELETE FROM sessions WHERE token_hash = ?', hash(token));
      setCookie(res, 'vw_session', '', 0);
      return json(res, 200, { ok: true });
    }

    if (pathname === '/api/player/register' && method === 'POST') {
      let d = device(req);
      if (!d) {
        limit(req, 'register', 60, 3600000);
        const token = randomBytes(32).toString('hex');
        const id = randomUUID();
        run('INSERT INTO devices (id, token_hash, created_at) VALUES (?, ?, ?)', id, hash(token), clock());
        setCookie(res, 'vw_device', token, 365 * 86400);
        d = q('SELECT * FROM devices WHERE id = ?', id);
      }
      if (!d.point_id && (!d.code || d.code_expires_at < clock())) {
        let code;
        do { code = makeCode(); } while (q('SELECT id FROM devices WHERE code = ?', code));
        run('UPDATE devices SET code = ?, code_expires_at = ? WHERE id = ?', code, clock() + 30 * 60000, d.id);
        d = q('SELECT * FROM devices WHERE id = ?', d.id);
      }
      return json(res, 200, pairedState(d));
    }
    if (pathname === '/api/player/sync' && method === 'POST') {
      const d = device(req);
      if (!d) throw new HttpError(401, 'Este player precisa ser vinculado novamente.');
      const body = await readJson(req);
      const state = pairedState(d);
      if(body.events!==undefined && (!Array.isArray(body.events)||body.events.length>200))throw new HttpError(400,'Envie até 200 eventos por sincronização.');
      const activePublication=typeof body.activePublicationId==='string'&&q('SELECT p.id,p.snapshot_json FROM device_publications d JOIN publications p ON p.id=d.publication_id WHERE d.device_id=? AND d.point_id=? AND d.publication_id=?',d.id,d.point_id,body.activePublicationId);
      const playbackPublication=activePublication?JSON.parse(activePublication.snapshot_json):state.publication;
      const current = playbackPublication?.items.find(item => item.mediaId === body.currentMediaId);
      const playbackState = ['playing', 'loading', 'error', 'waiting', 'scheduled'].includes(body.playbackState) ? body.playbackState : 'waiting';
      run('UPDATE devices SET last_seen = ?, current_media_id = ?, playback_state = ? WHERE id = ?', clock(), current?.mediaId || null, playbackState, d.id);
      const reportedId = Object.hasOwn(body,'activePublicationId') ? activePublication?.id : state.publication?.id;
      run('UPDATE devices SET offline_json=?,active_publication_id=? WHERE id=?',JSON.stringify(offlineTelemetry(body.offlineStatus)),reportedId||null,d.id);
      if(body.telemetry!==undefined)run('UPDATE devices SET telemetry_json=? WHERE id=?',JSON.stringify(playerTelemetry(body.telemetry)),d.id);
      const acknowledgements=transaction(db,()=>ingestEvents(db,d,body.events||[],clock()));
      if (d.point_id && body.event) {
        const eventMedia = state.publication?.items.find(item => item.mediaId === body.event.mediaId);
        if (eventMedia && ['started', 'ended', 'error'].includes(body.event.type)) {
          run('INSERT INTO playback_events (point_id, media_id, media_name, type, detail, created_at, publication_id) VALUES (?, ?, ?, ?, ?, ?, ?)', d.point_id, eventMedia.mediaId, eventMedia.name, body.event.type, text(body.event.detail || '', 'Detalhe', 300, true), clock(),state.publication.id);
        }
      }
      return json(res, 200, {...state,...acknowledgements});
    }
    if (pathname.startsWith('/media/') && ['GET', 'HEAD'].includes(method)) {
      const id = pathname.slice(7);
      if (!admin(req)) {
        const d = device(req);
        const point = d?.point_id ? q('SELECT * FROM points WHERE id = ?', d.point_id) : null;
        if (!getPublication(point)?.items.some(item => item.mediaId === id || item.sourceMediaId === id || referencedMediaIds(item).includes(id))) throw new HttpError(401, 'Acesso ao conteúdo não autorizado.');
      }
      const media = mustFind('media', id, 'Conteúdo');
      return sendFile(req, res, join(dataDir, 'uploads', media.stored_name), media.mime, { private: true });
    }

    if (pathname==='/api/erp/imports' && method==='POST') {
      const authorization = req.headers.authorization;
      erp.authorize(authorization);
      limit(req,'erp-import',30,60000);
      const result = erp.receive(authorization,await readJson(req,12*1024*1024));
      if (result.applied) imageBank.notifyProductsChanged();
      return json(res,201,result);
    }
    const localCampaign = /^\/api\/filial\/campanhas\/([\w-]+)$/.exec(pathname);
    if (pathname==='/api/filial' && method==='GET') {
      const scope = campaigns.authorize(req.headers.authorization);
      return json(res,200,{store:scope,campaigns:campaigns.list(scope)});
    }
    if (localCampaign && method==='PUT') {
      campaigns.authorize(req.headers.authorization);
      const body = await readJson(req);
      const scope = campaigns.authorize(req.headers.authorization);
      return json(res,200,campaigns.editLocal(localCampaign[1],scope,body));
    }
    if (pathname.startsWith('/api/')) {
      if (!admin(req)) throw new HttpError(401, 'Entre no painel para continuar.');
      if (pathname==='/api/campaigns' && method==='GET') return json(res,200,campaigns.overview());
      if (pathname==='/api/campaigns' && method==='POST') return json(res,201,campaigns.launch(await readJson(req)));
      if (pathname==='/api/campaigns/preview' && method==='POST') return json(res,200,campaigns.preview(await readJson(req)));
      if (pathname==='/api/campaigns/price-limit' && method==='PUT') return json(res,200,campaigns.configurePriceLimit((await readJson(req)).limit));
      if (pathname==='/api/campaigns/refresh-prices' && method==='POST') return json(res,200,{updated:transaction(db,campaigns.refreshPrices)});
      if (pathname==='/api/campaigns/stores' && method==='POST') return json(res,201,campaigns.saveStore(null,await readJson(req)));
      const storeMatch = /^\/api\/campaigns\/stores\/([\w-]+)(\/access)?$/.exec(pathname);
      if (storeMatch && method==='PUT') {
        const body = await readJson(req);
        return json(res,200,storeMatch[2]?campaigns.access(storeMatch[1],body.mode):campaigns.saveStore(storeMatch[1],body));
      }
      const assignment = /^\/api\/campaigns\/points\/([\w-]+)$/.exec(pathname);
      if (assignment && method==='PUT') return json(res,200,campaigns.assign(assignment[1],await readJson(req)));
      const campaignMatch = /^\/api\/campaigns\/([\w-]+)(\/report)?$/.exec(pathname);
      if (campaignMatch?.[2] && method==='GET') return json(res,200,campaigns.report(campaignMatch[1],url.searchParams));
      if (campaignMatch && !campaignMatch[2] && method==='DELETE') return json(res,200,campaigns.cancel(campaignMatch[1]));
      if (pathname==='/api/campaign-alerts' && method==='GET') {
        campaigns.alertScan(getPublication);
        return json(res,200,campaigns.alerts());
      }
      if (pathname==='/api/campaign-alerts/count' && method==='GET') return json(res,200,{count:campaigns.alertCount()});
      const alertMatch = /^\/api\/campaign-alerts\/(\d+)\/ack$/.exec(pathname);
      if (alertMatch && method==='PUT') return json(res,200,campaigns.acknowledge(Number(alertMatch[1])));
      if (pathname==='/api/erp' && method==='GET') return json(res,200,erp.status());
      if (pathname==='/api/erp' && method==='PUT') {
        const body=await readJson(req);
        return json(res,200,erp.configure(body.mode,body.rotate));
      }
      if(pathname==='/api/image-bank'&&method==='GET')return json(res,200,imageBank.status(hash(cookies(req).vw_session)));
      if(pathname==='/api/image-bank/items'&&method==='GET')return json(res,200,imageBank.items(url.searchParams));
      const bankImage=/^\/api\/image-bank\/items\/([a-f0-9]{64})\/(image|select)$/.exec(pathname);
      if(bankImage&&bankImage[2]==='image'&&['GET','HEAD'].includes(method)){const file=imageBank.image(bankImage[1]);return sendFile(req,res,file.path,file.mime,{private:true});}
      if(bankImage&&bankImage[2]==='select'&&method==='POST')return json(res,200,mediaDto(await imageBank.select(bankImage[1])));
      if(pathname.startsWith('/api/image-bank/')&&method==='POST'){
        const owner=hash(cookies(req).vw_session);
        const input=await readJson(req,pathname==='/api/image-bank/import'?32*1024*1024:pathname==='/api/image-bank/product-list'?4*1024*1024:1024*1024);
        if(pathname==='/api/image-bank/connect'){limit(req,'image-bank-login',10,15*60000);return json(res,200,await imageBank.connect(owner,input.login,input.password));}
        if(pathname==='/api/image-bank/disconnect')return json(res,200,await imageBank.disconnect(owner));
        if(pathname==='/api/image-bank/sync')return json(res,202,imageBank.sync(owner));
        if(pathname==='/api/image-bank/search'){limit(req,'image-bank-search',30,60000);return json(res,202,imageBank.searchCopy(owner,input));}
        if(pathname==='/api/image-bank/automatic')return json(res,200,await imageBank.configureAutomatic(owner,input));
        if(pathname==='/api/image-bank/product-list')return json(res,202,await imageBank.queueProductList(owner,input));
        if(pathname==='/api/image-bank/automatic/retry')return json(res,200,imageBank.retryAutomatic(owner));
        if(pathname==='/api/image-bank/resume')return json(res,202,imageBank.resume(owner));
        if(pathname==='/api/image-bank/pause'){await imageBank.pause({manual:true});return json(res,200,imageBank.status(owner));}
        if(pathname==='/api/image-bank/import')return json(res,202,imageBank.importExport(owner,input.text,input.filename));
      }

      if(pathname === '/api/catalog' && method === 'GET') return json(res,200,catalog.status());
      const catalogEdit=/^\/api\/catalog\/products\/(\d{2}:\d{6})$/.exec(decodeURIComponent(pathname));
      if(catalogEdit&&method==='PUT'){const result=catalog.edit(catalogEdit[1],await readJson(req));imageBank.notifyProductsChanged();return json(res,200,result);}
      if(pathname==='/api/catalog/resolve'&&method==='POST'){const body=await readJson(req);return json(res,200,resolveCatalogContent(body.kind,body.config||{},catalog));}
      if(pathname === '/api/catalog/products' && method === 'GET') return json(res,200,catalog.search(url.searchParams));
      if(pathname === '/api/catalog/imports' && method === 'POST') {const body=await readJson(req);return json(res,201,catalog.stage(body.text,body.filename));}
      const importAction = /^\/api\/catalog\/imports\/([\w-]+)\/apply$/.exec(pathname);
      if(importAction && method === 'POST') {const result=catalog.apply(importAction[1]);imageBank.notifyProductsChanged();return json(res,200,result);}
      if(pathname === '/api/catalog/watch' && method === 'PUT') {const value=catalog.configure(await readJson(req));void catalog.check();return json(res,200,value);}
      if(pathname === '/api/catalog/check' && method === 'POST') {await catalog.check();return json(res,200,catalog.status());}
      if(pathname === '/api/catalog/refresh-content' && method === 'POST') {
        const changed=[];
        transaction(db,()=>{
          for(const content of all("SELECT * FROM virtual_content WHERE kind IN ('poster','price_table','offer')")){
            const original=JSON.parse(content.config_json),before=JSON.stringify(original),config=resolveCatalogContent(content.kind,original,catalog);
            if(JSON.stringify(config)===before)continue;
            run('UPDATE virtual_content SET config_json=? WHERE id=?',JSON.stringify(config),content.id);
            graph.touchContent(content.id);
            changed.push({id:content.id,name:content.name});
          }
        });
        const previous=JSON.parse(q('SELECT value_json FROM settings WHERE key=?','catalog-pending-content')?.value_json || '[]');
        run('INSERT INTO settings VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value_json=excluded.value_json','catalog-pending-content',JSON.stringify([...new Set([...previous,...changed.map(c=>c.id)])]));
        return json(res,200,{changed});
      }
      if(pathname === '/api/catalog/publish' && method === 'POST') {
        const body=await readJson(req);
        if(!Array.isArray(body.ids)||body.ids.length>200||body.ids.some(id=>typeof id!=='string'))throw new HttpError(400,'Selecione os conteúdos a publicar.');
        for(const id of body.ids)mustFind('virtual_content',id,'Conteúdo');
        let count=0;for(const id of new Set(body.ids))count+=publishContent(id).playlistsUpdated;
        const previous=JSON.parse(q('SELECT value_json FROM settings WHERE key=?','catalog-pending-content')?.value_json || '[]');
        run('INSERT INTO settings VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value_json=excluded.value_json','catalog-pending-content',JSON.stringify(previous.filter(id=>!body.ids.includes(id))));
        return json(res,200,{publications:count});
      }

      if (pathname === '/api/dashboard' && method === 'GET') {
        const points = all('SELECT * FROM points ORDER BY created_at DESC').map(pointDto);
        const recentEvents = all('SELECT e.*, p.name AS point_name FROM playback_events e JOIN points p ON p.id = e.point_id ORDER BY e.created_at DESC,e.id DESC LIMIT 8');
        const startHour = Math.floor(clock() / 3600000) * 3600000;
        const hours = Array.from({ length: 12 }, (_, i) => ({ at: startHour - (11 - i) * 3600000, count: 0 }));
        for (const row of all("SELECT CAST(created_at / 3600000 AS INTEGER) * 3600000 AS hour, COUNT(*) AS n FROM playback_events WHERE type = 'started' AND created_at >= ? GROUP BY hour", hours[0].at)) {
          const bucket = hours.find(h => h.at === row.hour); if (bucket) bucket.count = row.n;
        }
        const mediaCount = q('SELECT COUNT(*) AS n FROM media').n;
        return json(res, 200, {
          points, recentEvents, hours, serverTime: clock(),
          counts: {
            points: points.length, online: points.filter(p => p.online).length, paired: points.filter(p => p.paired).length,
            media: mediaCount + q('SELECT COUNT(*) AS n FROM virtual_content').n,
            playlists: q('SELECT COUNT(*) AS n FROM playlists').n,
            playsToday: q("SELECT COUNT(*) AS n FROM playback_events WHERE type = 'started' AND created_at >= ?", Date.parse(dayKey(clock())+'T00:00:00-03:00')).n,
          },
        });
      }
      if (pathname === '/api/media' && method === 'GET') return json(res, 200, [...all('SELECT * FROM media'), ...all('SELECT * FROM virtual_content')].sort((a, b) => b.created_at - a.created_at).map(contentDto));
      if (pathname === '/api/poster-themes' && method === 'GET') return json(res,200,posterThemes.list());
      if (pathname === '/api/poster-themes' && method === 'POST') return json(res,201,posterThemes.save(await readJson(req)));
      if (pathname === '/api/poster-themes/default' && method === 'PUT') return json(res,200,posterThemes.setDefault((await readJson(req)).id));
      const themeMatch = /^\/api\/poster-themes\/([\w:-]+)$/.exec(pathname);
      if (themeMatch && method === 'PUT') return json(res,200,posterThemes.save(await readJson(req),themeMatch[1]));
      if (themeMatch && method === 'DELETE') return json(res,200,posterThemes.remove(themeMatch[1]));
      const contentMatch = /^\/api\/content\/([\w-]+)$/.exec(pathname);
      const contentPublish = /^\/api\/content\/([\w-]+)\/publish$/.exec(pathname);
      if (contentPublish && method === 'POST') return json(res,200,publishContent(contentPublish[1]));
      if ((pathname === '/api/content' && method === 'POST') || (contentMatch && method === 'PUT')) {
        const existing = contentMatch ? mustFind('virtual_content', contentMatch[1], 'Conteúdo') : null;
        const input = validateContent(await readJson(req));input.config=resolveCatalogContent(input.kind,input.config,catalog);
        if (input.kind === 'product_image' && mustFind('media', input.config.mediaId, 'Imagem').kind !== 'image') throw new HttpError(400, 'Escolha uma imagem para o produto.');
        for(const imageId of referencedMediaIds(input))if(mustFind('media',imageId,'Imagem').kind!=='image')throw new HttpError(400,'Escolha um arquivo de imagem para o template.');
        const id = existing?.id || randomUUID();
        transaction(db, () => {
          if (existing) {
            run('UPDATE virtual_content SET name = ?, kind = ?, config_json = ? WHERE id = ?', input.name, input.kind, JSON.stringify(input.config), id);
            graph.touchContent(id);
          } else run('INSERT INTO virtual_content VALUES (?, ?, ?, ?, ?)', id, input.name, input.kind, JSON.stringify(input.config), clock());
        });
        imageBank.notifyProductsChanged();
        return json(res, existing ? 200 : 201, contentDto(q('SELECT * FROM virtual_content WHERE id = ?', id)));
      }
      if (pathname === '/api/media' && method === 'POST') {
        const uploadKey = req.headers['idempotency-key'] ?? null;
        if (uploadKey !== null && (typeof uploadKey !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(uploadKey))) {
          req.resume();
          throw new HttpError(400, 'Chave de envio inválida.');
        }
        if (uploadKey !== null) {
          const existing = q('SELECT * FROM media WHERE upload_key = ?', uploadKey);
          if (existing) { req.resume(); return json(res, 200, mediaDto(existing)); }
          if (activeUploads.has(uploadKey)) { req.resume(); throw new HttpError(409, 'Este arquivo ainda está sendo enviado. Aguarde e tente novamente.'); }
        }
        const name = text(url.searchParams.get('name'), 'Nome do conteúdo');
        const filename = text(url.searchParams.get('filename') || name, 'Nome do arquivo', 240);
        const validity=validateValidity(Object.fromEntries(['validFrom','validUntil'].map(key=>[key,url.searchParams.get(key)])));
        if (uploadKey !== null) activeUploads.add(uploadKey);
        try {
          const received = await receiveMedia(req, dataDir, maxUploadBytes);
          try {
            transaction(db, () => {
              run('INSERT INTO media (id,name,filename,stored_name,mime,kind,size,created_at,has_prices,validity_json,upload_key) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', received.id, name, filename, received.storedName, received.mime, received.kind, received.size, clock(),url.searchParams.get('hasPrices')==='false'?0:1,JSON.stringify(validity),uploadKey);
              operations.record('upload',received.id);
            });
          } catch (error) { await unlink(join(dataDir, 'uploads', received.storedName)).catch(() => {}); throw error; }
          return json(res, 201, mediaDto(q('SELECT * FROM media WHERE id = ?', received.id)));
        } finally { if (uploadKey !== null) activeUploads.delete(uploadKey); }
      }
      const mediaMatch = /^\/api\/media\/([\w-]+)$/.exec(pathname);
      if(mediaMatch && method==='PUT'){
        const media=mustFind('media',mediaMatch[1],'Mídia'),body=await readJson(req);
        if(body.hasPrices!==undefined && typeof body.hasPrices!=='boolean')throw new HttpError(400,'Informe se o arquivo contém preços.');
        const validity=validateValidity({...JSON.parse(media.validity_json||'{}'),...body});
        transaction(db,()=>{
          run('UPDATE media SET has_prices=?,validity_json=? WHERE id=?',body.hasPrices===undefined?media.has_prices:body.hasPrices?1:0,JSON.stringify(validity),media.id);
          const productIds=all('SELECT id,kind,config_json FROM virtual_content').filter(row=>referencedMediaIds({kind:row.kind,config:JSON.parse(row.config_json)}).includes(media.id)).map(row=>row.id);
          graph.touchContent(media.id);for(const id of productIds)graph.touchContent(id);
        });
        return json(res,200,mediaDto(q('SELECT * FROM media WHERE id=?',media.id)));
      }
      if (mediaMatch && method === 'DELETE') {
        const media = mustContent(mediaMatch[1]);
        if (!media.config_json && (campaigns.usesAsset(media.id)||posterThemes.usesAsset(media.id))) throw new HttpError(409,'Esta imagem está vinculada a uma campanha ou identidade visual.');
        if (!media.config_json && all('SELECT kind,config_json FROM virtual_content').some(row => referencedMediaIds({kind:row.kind,config:JSON.parse(row.config_json)}).includes(media.id))) throw new HttpError(409, 'Esta imagem está vinculada a um produto ou template. Remova a associação antes de excluir.');
        const inDraft = all('SELECT items_json FROM playlists').some(p => JSON.parse(p.items_json).some(item => item.mediaId === media.id));
        const inPublication = all('SELECT DISTINCT pub.snapshot_json FROM publications pub JOIN points p ON p.publication_id = pub.id UNION SELECT pub.snapshot_json FROM publications pub JOIN playlists p ON p.current_publication_id = pub.id').some(p => JSON.parse(p.snapshot_json).items.some(item => item.mediaId === media.id || item.sourceMediaId === media.id || referencedMediaIds(item).includes(media.id)));
        if (inDraft || inPublication) throw new HttpError(409, 'Este conteúdo está em uma playlist. Remova-o da sequência e publique a alteração antes de excluir.');
        if (media.config_json) run('DELETE FROM virtual_content WHERE id = ?', media.id);
        else {
          await unlink(join(dataDir, 'uploads', media.stored_name)).catch(error => { if (error.code !== 'ENOENT') throw error; });
          run('DELETE FROM media WHERE id = ?', media.id);
        }
        return json(res, 200, { ok: true });
      }
      if(pathname==='/api/playlists/preview'&&method==='POST'){const body=await readJson(req),id=body.id||'preview';const result=graph.expand(id,{items_json:JSON.stringify(validateItems(body.items||[])),schedule_json:JSON.stringify(scheduleInput(body.schedule))});return json(res,200,{name:body.name||'Prévia',items:result.items});}
      if (pathname === '/api/playlists' && method === 'GET') return json(res, 200, all('SELECT * FROM playlists WHERE id NOT IN (SELECT playlist_id FROM campaign_streams) ORDER BY updated_at DESC').map(playlistDto));
      const attachMatch=/^\/api\/content\/([\w-]+)\/playlists$/.exec(pathname);
      if(attachMatch && method==='POST'){
        const content=mustContent(attachMatch[1]),body=await readJson(req);
        if(!Array.isArray(body.targets)||!body.targets.length||body.targets.length>200||body.targets.some(target=>!target||typeof target.id!=='string'||!Number.isSafeInteger(target.revision))||new Set(body.targets.map(target=>target.id)).size!==body.targets.length)throw new HttpError(400,'Selecione de 1 a 200 playlists distintas.');
        const result=transaction(db,()=>{
          const added=[],skipped=[];
          for(const target of body.targets){
            const playlist=mustFind('playlists',target.id,'Playlist');
            if(playlist.revision!==target.revision)throw new HttpError(409,'Uma playlist foi alterada em outra janela. Reabra a seleção e tente novamente.');
            const items=JSON.parse(playlist.items_json);
            if(items.some(item=>item.mediaId===content.id)){skipped.push({id:playlist.id,name:playlist.name});continue;}
            const updated=validateItems([...items,{mediaId:content.id,seconds:body.seconds}]);
            run('UPDATE playlists SET items_json=?,revision=revision+1,updated_at=? WHERE id=?',JSON.stringify(updated),clock(),playlist.id);
            graph.syncDependencies();graph.touch([playlist.id],false);added.push({id:playlist.id,name:playlist.name});
          }
          return {added,skipped};
        });
        return json(res,200,result);
      }
      if (pathname === '/api/playlists' && method === 'POST') {
        const body = await readJson(req); const id = randomUUID();
        const items = validateItems(body.items || []);
        transaction(db,()=>{run('INSERT INTO playlists (id, name, items_json, created_at, updated_at,schedule_json) VALUES (?, ?, ?, ?, ?, ?)', id, text(body.name, 'Nome da playlist'), JSON.stringify(items), clock(), clock(),JSON.stringify(scheduleInput(body.schedule)));graph.syncDependencies();});
        return json(res, 201, playlistDto(q('SELECT * FROM playlists WHERE id = ?', id)));
      }
      const playlistMatch = /^\/api\/playlists\/([\w-]+)(?:\/(publish))?$/.exec(pathname);
      if (playlistMatch) {
        const row = mustFind('playlists', playlistMatch[1], 'Playlist');
        if (!playlistMatch[2] && method === 'PUT') {
          const body = await readJson(req);
          if (body.revision !== row.revision) throw new HttpError(409, 'A playlist foi alterada em outra janela. Reabra a sequência para atualizar.');
          const items = validateItems(body.items);
          const schedule=body.schedule===undefined?JSON.parse(row.schedule_json||'{"enabled":false}'):scheduleInput(body.schedule);
          transaction(db,()=>{run('UPDATE playlists SET name = ?, items_json = ?, schedule_json=?,revision = revision + 1, updated_at = ? WHERE id = ?', text(body.name, 'Nome da playlist'), JSON.stringify(items),JSON.stringify(schedule), clock(), row.id);graph.syncDependencies();graph.touch([row.id],false);});
          return json(res, 200, playlistDto(q('SELECT * FROM playlists WHERE id = ?', row.id)));
        }
        if (playlistMatch[2] === 'publish' && method === 'POST') {
          const body = await readJson(req);
          if (body.revision !== row.revision) throw new HttpError(409, 'A sequência mudou. Reabra a playlist antes de publicar.');
          if (!JSON.parse(row.items_json).length) throw new HttpError(400, 'Adicione pelo menos um conteúdo à playlist.');
          const publicationId = randomUUID();
          const expanded=graph.expand(row.id),items=expanded.items;
          const version = q('SELECT COALESCE(MAX(version), 0) + 1 AS n FROM publications WHERE playlist_id = ?', row.id).n;
          transaction(db, () => {
            run('INSERT INTO publications VALUES (?, ?, ?, ?, ?, ?)', publicationId, row.id, version, row.revision, JSON.stringify({ playlistName: row.name, items,revisions:expanded.revisions, schedule:JSON.parse(row.schedule_json||'{"enabled":false}') }), clock());
            run('UPDATE playlists SET current_publication_id = ? WHERE id = ?', publicationId, row.id);
            run('UPDATE points SET publication_id = ? WHERE playlist_id = ?', publicationId, row.id);operations.record('publish',row.id);
          });
          return json(res, 200, playlistDto(q('SELECT * FROM playlists WHERE id = ?', row.id)));
        }
        if (!playlistMatch[2] && method === 'DELETE') {
          if(all('SELECT items_json FROM playlists').some(p=>JSON.parse(p.items_json).some(item=>item.playlistId===row.id)))throw new HttpError(409,'Subplaylist utilizada por outra playlist.');
          if (q('SELECT id FROM points WHERE playlist_id = ?', row.id)) throw new HttpError(409, 'Troque a playlist dos pontos antes de excluir.');
          if(all('SELECT playlist_id,snapshot_json FROM publications').some(p=>p.playlist_id!==row.id&&Object.hasOwn(JSON.parse(p.snapshot_json).revisions||{},row.id)))throw new HttpError(409,'Subplaylist utilizada em publicação.');
          run('DELETE FROM playlists WHERE id = ?', row.id);
          return json(res, 200, { ok: true });
        }
      }
      if(pathname==='/api/points/refresh'&&method==='POST'){const body=await readJson(req);if(!Array.isArray(body.ids)||!body.ids.length||body.ids.length>200||body.ids.some(id=>typeof id!=='string'))throw new HttpError(400,'Selecione de 1 a 200 pontos.');const results=transaction(db,()=>[...new Set(body.ids)].map(id=>{const row=q('SELECT id FROM points WHERE id=?',id);if(!row)return {id,ok:false,error:'Ponto não encontrado'};run('UPDATE points SET command_version=command_version+1 WHERE id=?',id);operations.record('refresh',id);return {id,ok:true};}));return json(res,200,{results});}
      if (pathname === '/api/points' && method === 'GET') return json(res, 200, all('SELECT * FROM points ORDER BY created_at DESC').map(pointDto));
      if (pathname === '/api/points' && method === 'POST') {
        const input = validatePoint(await readJson(req)); const id = randomUUID();
        run('INSERT INTO points (id, name, location, fit, playlist_id, publication_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)', id, input.name, input.location, input.fit, input.playlistId, input.publicationId, clock());
        if(input.settings)run('UPDATE points SET settings_json=? WHERE id=?',JSON.stringify(input.settings),id);
        return json(res, 201, pointDto(q('SELECT * FROM points WHERE id = ?', id)));
      }
      const pointMatch = /^\/api\/points\/([\w-]+)(?:\/(pair|unpair|refresh))?$/.exec(pathname);
      const monitorMatch = /^\/api\/points\/([\w-]+)\/monitor$/.exec(pathname);
      if(monitorMatch && method==='GET') {
        const point=mustFind('points',monitorMatch[1],'Ponto');
        const since=clock()-30*60000;
        const events=all('SELECT * FROM playback_events WHERE point_id=? AND created_at>=? ORDER BY created_at DESC,id DESC LIMIT 200',point.id,since);
        const total=q('SELECT COUNT(*) AS n FROM playback_events WHERE point_id=? AND created_at>=?',point.id,since).n;
        const publication=getPublication(point),dto=pointDto(point);
        return json(res,200,{point:dto,publication,events,eventsTruncated:total>events.length,since,serverTime:clock()});
      }
      if (pointMatch) {
        const row = mustFind('points', pointMatch[1], 'Ponto');
        const action = pointMatch[2];
        if (!action && method === 'PUT') {
          const input = validatePoint(await readJson(req));
          run('UPDATE points SET name = ?, location = ?, fit = ?, playlist_id = ?, publication_id = ? WHERE id = ?', input.name, input.location, input.fit, input.playlistId, input.publicationId, row.id);
          if(input.settings)run('UPDATE points SET settings_json=?,command_version=command_version+1 WHERE id=?',JSON.stringify(input.settings),row.id);
          return json(res, 200, pointDto(q('SELECT * FROM points WHERE id = ?', row.id)));
        }
        if (action === 'pair' && method === 'POST') {
          limit(req, 'pair', 40, 15 * 60000);
          const body = await readJson(req);
          const code = text(body.code, 'Código', 12).toUpperCase().replace(/\s/g, '');
          transaction(db, () => {
            if (q('SELECT id FROM devices WHERE point_id = ?', row.id)) throw new HttpError(409, 'Este ponto já possui um player. Desvincule-o primeiro.');
            const d = q('SELECT * FROM devices WHERE code = ? AND point_id IS NULL AND code_expires_at > ?', code, clock());
            if (!d) throw new HttpError(400, 'Código inválido ou expirado. Confira a tela do player.');
            run('UPDATE devices SET point_id = ?, code = NULL, code_expires_at = NULL WHERE id = ?', row.id, d.id);
          });
          return json(res, 200, pointDto(q('SELECT * FROM points WHERE id = ?', row.id)));
        }
        if (action === 'unpair' && method === 'POST') {
          run('DELETE FROM devices WHERE point_id = ?', row.id);
          return json(res, 200, { ok: true });
        }
        if (action === 'refresh' && method === 'POST') {
          run('UPDATE points SET command_version = command_version + 1 WHERE id = ?', row.id);operations.record('refresh',row.id);
          return json(res, 200, { ok: true });
        }
        if (!action && method === 'DELETE') {
          transaction(db, () => { run('DELETE FROM devices WHERE point_id = ?', row.id); run('DELETE FROM points WHERE id = ?', row.id); });
          return json(res, 200, { ok: true });
        }
      }
      if (pathname === '/api/reports' && method === 'GET') {
        return json(res,200,operations.report(url.searchParams));
      }
      if(pathname==='/api/usage'&&method==='GET')return json(res,200,operations.report(url.searchParams));
      if (pathname === '/api/logs' && method === 'GET') {
        const id = url.searchParams.get('pointId');
        const rows = id ? all('SELECT e.*, p.name AS point_name FROM playback_events e JOIN points p ON p.id = e.point_id WHERE e.point_id = ? ORDER BY e.created_at DESC,e.id DESC LIMIT 200', id) : all('SELECT e.*, p.name AS point_name FROM playback_events e JOIN points p ON p.id = e.point_id ORDER BY e.created_at DESC,e.id DESC LIMIT 200');
        return json(res, 200, rows);
      }
      throw new HttpError(404, 'Operação não encontrada.');
    }
    if (!['GET', 'HEAD'].includes(method)) throw new HttpError(405, 'Método não permitido.');
    const staticFiles = {
      '/': ['index.html', 'text/html; charset=utf-8'],
      '/filial': ['branch.html', 'text/html; charset=utf-8'],
      '/player': ['player.html', 'text/html; charset=utf-8'],
      '/player/': ['player.html', 'text/html; charset=utf-8'],
      '/app.js': ['app.js', 'text/javascript; charset=utf-8'],
      '/catalog-ui.js': ['catalog-ui.js', 'text/javascript; charset=utf-8'],
      '/poster-themes-ui.js': ['poster-themes-ui.js', 'text/javascript; charset=utf-8'],
      '/poster-theme-model.js': ['poster-theme-model.js', 'text/javascript; charset=utf-8'],
      '/poster-themes.css': ['poster-themes.css', 'text/css; charset=utf-8'],
      '/library-actions.js': ['library-actions.js', 'text/javascript; charset=utf-8'],
      '/playlist-schedule.js': ['playlist-schedule.js', 'text/javascript; charset=utf-8'],
      '/schedule-ui.js': ['schedule-ui.js', 'text/javascript; charset=utf-8'],
      '/monitor-ui.js': ['monitor-ui.js', 'text/javascript; charset=utf-8'],
      '/monitor-utils.js': ['monitor-utils.js', 'text/javascript; charset=utf-8'],
      '/content-utils.js': ['content-utils.js', 'text/javascript; charset=utf-8'],
      '/toledo.js': ['toledo.js', 'text/javascript; charset=utf-8'],
      '/player.js': ['player.js', 'text/javascript; charset=utf-8'],
      '/content-renderer.js': ['content-renderer.js', 'text/javascript; charset=utf-8'],
      '/editor-utils.js': ['editor-utils.js', 'text/javascript; charset=utf-8'],
      '/playlist-editor.js': ['playlist-editor.js', 'text/javascript; charset=utf-8'],
      '/preview': ['preview.html', 'text/html; charset=utf-8'],
      '/preview.js': ['preview.js', 'text/javascript; charset=utf-8'],
      '/preview.css': ['preview.css', 'text/css; charset=utf-8'],
      '/video-health.js': ['video-health.js', 'text/javascript; charset=utf-8'],
      '/player-sw.js': ['player-sw.js', 'text/javascript; charset=utf-8'],
      '/offline-policy.js': ['offline-policy.js', 'text/javascript; charset=utf-8'],
      '/offline-player.js': ['offline-player.js', 'text/javascript; charset=utf-8'],
      '/offline-store.js': ['offline-store.js', 'text/javascript; charset=utf-8'],
      '/offline-range.js': ['offline-range.js', 'text/javascript; charset=utf-8'],
      '/styles.css': ['styles.css', 'text/css; charset=utf-8'],
      '/retail.css': ['retail.css', 'text/css; charset=utf-8'],
      '/player.css': ['player.css', 'text/css; charset=utf-8'],
      '/icon.svg': ['icon.svg', 'image/svg+xml'],
    };
    for(const asset of builtInImages)staticFiles[asset.url]=['template-assets/'+asset.url.split('/').at(-1),'image/jpeg'];
    for(const name of ['table-templates.js','table-renderer.js','table-editor.js','template-backgrounds.js','image-bank-ui.js','upload-queue.js','upload-ui.js','campaign-ui.js','campaign-video.js','branch.js'])staticFiles['/'+name]=[name,'text/javascript; charset=utf-8'];
    staticFiles['/campaigns.css']=['campaigns.css','text/css; charset=utf-8'];
    staticFiles['/table-templates.css']=['table-templates.css','text/css; charset=utf-8'];
    staticFiles['/image-bank.css']=['image-bank.css','text/css; charset=utf-8'];
    const file = staticFiles[pathname];
    if (!file) throw new HttpError(404, 'Página não encontrada.');
    return sendFile(req, res, join(publicDir, file[0]), file[1]);
  }

  const server = createServer((req, res) => {
    handle(req, res).catch(error => {
      if (res.headersSent) return res.destroy();
      const status = error.status || 500;
      if (status === 500) console.error('Falha na solicitação:', error.message);
      json(res, status, { error: status === 500 ? 'Não foi possível concluir a operação.' : error.message });
    });
  });
  server.requestTimeout = 300000;
  const alertTimer = setInterval(() => {
    try { campaigns.alertScan(getPublication); }
    catch (error) { console.error('Falha no monitoramento de campanhas:',error.message); }
  },30000);
  alertTimer.unref();
  return { server, db, catalog, imageBank, close: () => { clearInterval(alertTimer);catalog.close();const closing=imageBank.close();if(closing)return closing.finally(()=>db.close());db.close(); } };
}
