import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, rm, readdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {request} from 'node:http';
import {DatabaseSync} from 'node:sqlite';
import {createApplication} from '../src/app.mjs';
import {openDatabase} from '../src/database.mjs';
import {UploadQueue, uploadItem, uploadUrl, validateUploadItem, sendUpload} from '../public/upload-queue.js';

const png = Buffer.from([137,80,78,71,13,10,26,10,0,0,0,0]);
const mp4 = Buffer.from([0,0,0,12,102,116,121,112,0,0,0,0]);
const settings = {targets:[], hasPrices:true, validFrom:null, validUntil:null};
const fileItem = (name = 'Foto.png', type = 'image/png', bytes = png) => uploadItem(new File([bytes], name, {type}), randomUUID());

async function fixture(action) {
  const dataDir = await mkdtemp(join(tmpdir(), 'upload-batch-'));
  const app = createApplication({dataDir, maxUploadBytes:100});
  await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve));
  const origin = 'http://127.0.0.1:' + app.server.address().port;
  let cookie;
  const raw = (path, options = {}) => fetch(origin + path, {...options, headers:{Cookie:cookie, ...options.headers}});
  const api = async (path, options = {}) => {
    const response = await raw(path, {...options, headers:{'Content-Type':'application/json', ...options.headers}});
    const body = await response.json();
    if (!response.ok) throw new Error(body.error);
    return body;
  };
  let uploads = 0;
  const upload = async (item, options, progress) => {
    uploads++;
    const response = await raw(uploadUrl(item, options), {method:'POST', body:item.file, headers:{'Content-Type':item.mime, 'Idempotency-Key':item.key}});
    const body = await response.json();
    if (!response.ok) throw new Error(body.error);
    progress(item.file.size); return body;
  };
  const queue = (overrides = {}) => new UploadQueue({api, upload, maxBytes:100, ...overrides});
  try {
    const auth = await fetch(origin + '/api/auth/setup', {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({username:'admin', password:'long-password-123', workspace:'Test'})});
    assert.equal(auth.status, 200);
    cookie = auth.headers.get('set-cookie').split(';')[0];
    await action({app, api, raw, queue, upload, origin, cookie, dataDir, getUploads:() => uploads});
  }
  finally { await new Promise(resolve => app.server.close(resolve)); await app.close(); await rm(dataDir, {recursive:true, force:true}); }
}

test('lote misto mantém ordem, revisões, agendamento e publicações em duas playlists', () => fixture(async ({app, api, queue, getUploads}) => {
  const seed = await api('/api/content', {method:'POST', body:JSON.stringify({name:'Cartaz existente', kind:'poster', config:{title:'Bem-vindo'}})});
  const a = await api('/api/playlists', {method:'POST', body:JSON.stringify({name:'A', items:[{mediaId:seed.id, seconds:7}]})});
  const b = await api('/api/playlists', {method:'POST', body:JSON.stringify({name:'B', items:[{mediaId:seed.id, seconds:8}]})});
  await api('/api/playlists/' + a.id + '/publish', {method:'POST', body:JSON.stringify({revision:a.revision})});
  const before = app.db.prepare('SELECT snapshot_json FROM publications WHERE playlist_id=?').get(a.id).snapshot_json;
  const batch = queue(); batch.items = [fileItem(), fileItem('Vídeo.mp4', 'video/mp4', mp4)];
  await batch.run({...settings, targets:[a.id, b.id], validFrom:'2026-11-03T12:00:00Z', validUntil:'2026-11-04T12:00:00Z'});
  assert.deepEqual(batch.items.map(item => item.status), ['done', 'done']); assert.equal(getUploads(), 2);
  for (const playlist of await api('/api/playlists')) {
    assert.deepEqual(playlist.items.map(item => item.mediaId), [seed.id, ...batch.items.map(item => item.media.id)]);
    assert.deepEqual(playlist.items.map(item => item.seconds), [playlist.id === a.id ? 7 : 8, 10, 0]); assert.equal(playlist.dirty, true);
    assert.deepEqual(playlist.schedule, a.schedule);
  }
  assert.equal(app.db.prepare('SELECT snapshot_json FROM publications WHERE playlist_id=?').get(a.id).snapshot_json, before);
  assert.equal((await api('/api/media')).find(item => item.id === batch.items[0].media.id).config.validUntil, '2026-11-04T12:00:00.000Z');
  await batch.run(settings); assert.equal(getUploads(), 2);
}));

test('envio sem playlist e recuperação do vínculo não reenviam a mídia', () => fixture(async ({api, queue, getUploads}) => {
  const plain = queue(); plain.items = [fileItem()]; await plain.run({...settings, hasPrices:false});
  assert.equal(plain.items[0].status, 'done'); assert.equal(plain.items[0].media.hasPrices, false);
  const playlist = await api('/api/playlists', {method:'POST', body:JSON.stringify({name:'A', items:[]})});
  let fail = true;
  const batch = queue({api:async (path, options) => {
    if (fail && path.endsWith('/playlists') && options?.method === 'POST') { fail = false; throw new Error('Falha temporária no vínculo'); }
    return api(path, options);
  }});
  batch.items = [fileItem('Nova.png')]; await batch.run({...settings, targets:[playlist.id]});
  assert.equal(batch.items[0].status, 'link-error'); const id = batch.items[0].media.id;
  await batch.run(settings); assert.equal(batch.items[0].status, 'done'); assert.equal(batch.items[0].media.id, id); assert.equal(getUploads(), 2);
  assert.equal((await api('/api/playlists'))[0].items.length, 1);
}));

test('validação bloqueia o lote antes do upload e aceita correção', async () => {
  let calls = 0;
  const batch = new UploadQueue({api:async () => [], maxBytes:100, upload:async () => { calls++; return {id:'ok', kind:'image'}; }});
  batch.items = [fileItem(), fileItem('ruim.txt', 'text/plain')];
  await assert.rejects(batch.run(settings), /Corrija/); assert.equal(calls, 0); assert.equal(batch.settings, null);
  assert.equal(batch.items[1].status, 'invalid');
  assert.match(validateUploadItem(fileItem('grande.png', 'image/png', Buffer.alloc(101)), 100), /limite/);
  assert.match(validateUploadItem(fileItem('vazio.png', 'image/png', Buffer.alloc(0)), 100), /vazio/);
  batch.items[0].name = ' '; assert.match(validateUploadItem(batch.items[0], 100), /nome/);
  assert.equal(uploadItem(new File([png], 'foto.PNG'), randomUUID()).mime, 'image/png');
  batch.items = [fileItem()];
  await assert.rejects(batch.run({...settings, validFrom:'2026-11-04', validUntil:'2026-11-03'}), /posterior/);
  await assert.rejects(batch.run({...settings, validFrom:'inválido'}), /datas/);
  await assert.rejects(batch.run({...settings, targets:Array.from({length:201}, (_, index) => String(index))}), /200/);
  await batch.run(settings); assert.equal(calls, 1);
});

test('falha de arquivo não bloqueia os seguintes; parar conclui o atual e permite retomar', () => fixture(async ({queue, upload, api, getUploads}) => {
  const mixed = queue(); mixed.items = [fileItem('falso.png', 'image/png', mp4), fileItem()];
  await mixed.run(settings); assert.deepEqual(mixed.items.map(item => item.status), ['upload-error', 'done']);
  const batch = queue({upload:async (...args) => { const result = await upload(...args); batch.stop(); return result; }});
  batch.items = [fileItem('Primeira.png'), fileItem('Segunda.png')];
  await batch.run(settings); assert.deepEqual(batch.items.map(item => item.status), ['done', 'waiting']);
  batch.upload = upload; await batch.run(settings); assert.deepEqual(batch.items.map(item => item.status), ['done', 'done']);
  assert.equal((await api('/api/media')).length, 3); assert.equal(getUploads(), 4);
}));

test('conflito de revisão conserva o arquivo e retry reconcilia vínculo já confirmado no servidor', () => fixture(async ({api, queue, getUploads}) => {
  const playlist = await api('/api/playlists', {method:'POST', body:JSON.stringify({name:'A', items:[]})});
  let mode = 'conflict';
  const batch = queue({api:async (path, options) => {
    if (path.startsWith('/api/content/') && mode === 'conflict') {
      mode = 'lost'; await api('/api/playlists/' + playlist.id, {method:'PUT', body:JSON.stringify({name:'A editada', revision:playlist.revision, items:[]})});
    } else if (path.startsWith('/api/content/') && mode === 'lost') {
      mode = 'ok'; await api(path, options); throw new Error('Resposta perdida');
    }
    return api(path, options);
  }});
  batch.items = [fileItem()]; await batch.run({...settings, targets:[playlist.id]});
  assert.equal(batch.items[0].status, 'link-error'); assert.match(batch.items[0].error, /outra janela/);
  await batch.run(settings); assert.equal(batch.items[0].status, 'link-error');
  await batch.run(settings); assert.equal(batch.items[0].status, 'done'); assert.equal(getUploads(), 1);
  const current = (await api('/api/playlists'))[0]; assert.equal(current.name, 'A editada'); assert.equal(current.items.length, 1);
}));

test('playlist cheia ou removida deixa vínculo pendente e mantém inclusão atômica', () => fixture(async ({api, queue}) => {
  const first = queue(); first.items = [fileItem()]; await first.run(settings);
  const full = await api('/api/playlists', {method:'POST', body:JSON.stringify({name:'Cheia', items:Array.from({length:500}, () => ({mediaId:first.items[0].media.id, seconds:5}))})});
  const empty = await api('/api/playlists', {method:'POST', body:JSON.stringify({name:'Vazia', items:[]})});
  const batch = queue(); batch.items = [fileItem('Outra.png')]; await batch.run({...settings, targets:[empty.id, full.id]});
  assert.equal(batch.items[0].status, 'link-error'); assert.match(batch.items[0].error, /500/);
  assert.equal((await api('/api/playlists')).find(p => p.id === empty.id).items.length, 0);
  await api('/api/playlists/' + empty.id, {method:'DELETE'}); await batch.run(settings);
  assert.match(batch.items[0].error, /removida/); assert.ok(batch.items[0].media.id);
}));

test('chave estável recupera resposta perdida, falhas liberam a chave e clientes antigos funcionam', () => fixture(async ({api, raw, queue, upload, app}) => {
  let lose = true;
  const batch = queue({upload:async (...args) => { const result = await upload(...args); if (lose) { lose = false; throw new Error('Resposta perdida'); } return result; }});
  batch.items = [fileItem()]; await batch.run(settings); assert.equal(batch.items[0].status, 'upload-error');
  await batch.run(settings); assert.equal(batch.items[0].status, 'done'); assert.equal((await api('/api/media')).length, 1);
  assert.equal(app.db.prepare("SELECT COUNT(*) AS n FROM operation_events WHERE kind='upload'").get().n, 1);
  const send = (key, body, query = 'name=Foto&filename=foto.png') => raw('/api/media?' + query, {method:'POST', body, headers:{'Content-Type':'image/png', ...(key ? {'Idempotency-Key':key} : {})}});
  const key = randomUUID(); assert.equal((await send(key, mp4)).status, 415); assert.equal((await send(key, png)).status, 201);
  assert.equal((await send(null, png)).status, 201); assert.equal((await send(null, png)).status, 201);
  assert.equal((await send('invalida,duplicada', png)).status, 400);
  assert.equal((await send(randomUUID(), Buffer.alloc(101))).status, 413);
  assert.equal((await send(randomUUID(), png, 'name=Foto&validFrom=ruim')).status, 400);
}));

test('requisição concorrente da mesma chave retorna conflito sem criar outro arquivo', () => fixture(async ({raw, origin, cookie, dataDir, api}) => {
  const key = randomUUID();
  let first;
  const response = new Promise((resolve, reject) => {
    first = request(origin + '/api/media?name=Lento&filename=lento.png', {method:'POST', headers:{Cookie:cookie, 'Content-Type':'image/png', 'Idempotency-Key':key, 'Content-Length':png.length}}, res => {
      res.resume(); res.on('end', () => resolve(res.statusCode));
    }); first.on('error', reject); first.write(png.subarray(0, 8));
  });
  try {
    for (let attempt = 0; ; attempt++) {
      if ((await readdir(join(dataDir, 'uploads'))).some(name => name.endsWith('.part'))) break;
      if (attempt > 100) throw new Error('O primeiro envio não iniciou');
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    const duplicate = await raw('/api/media?name=Duplicado', {method:'POST', body:png, headers:{'Content-Type':'image/png', 'Idempotency-Key':key}});
    assert.equal(duplicate.status, 409); await duplicate.text();
    first.end(png.subarray(8)); assert.equal(await response, 201);
    assert.equal((await api('/api/media')).length, 1); assert.equal((await readdir(join(dataDir, 'uploads'))).length, 1);
  } finally { first.destroy(); await response.catch(() => {}); }
}));

test('migração aditiva preserva mídias antigas e a chave permanece após reabrir o banco', async () => {
  const dataDir = await mkdtemp(join(tmpdir(), 'upload-migration-'));
  let db;
  try {
    db = new DatabaseSync(join(dataDir, 'videowall.sqlite'));
    db.exec("CREATE TABLE media(id TEXT PRIMARY KEY,name TEXT NOT NULL,filename TEXT NOT NULL,stored_name TEXT UNIQUE NOT NULL,mime TEXT NOT NULL,kind TEXT NOT NULL,size INTEGER NOT NULL,created_at INTEGER NOT NULL); INSERT INTO media VALUES ('old','Antiga','antiga.png','old.png','image/png','image',12,1)"); db.close();
    db = openDatabase(dataDir); assert.equal(db.prepare('SELECT upload_key FROM media WHERE id=?').get('old').upload_key, null);
    db.prepare('UPDATE media SET upload_key=? WHERE id=?').run('stable-key', 'old'); db.close();
    db = openDatabase(dataDir); assert.equal(db.prepare('SELECT id FROM media WHERE upload_key=?').get('stable-key').id, 'old');
    assert.throws(() => db.exec("INSERT INTO media(id,name,filename,stored_name,mime,kind,size,created_at,upload_key) VALUES('new','Nova','nova.png','new.png','image/png','image',12,1,'stable-key')"), /UNIQUE/);
  } finally { db?.close(); await rm(dataDir, {recursive:true, force:true}); }
});

test('transporte usa progresso real e conserva a chave em falha ou resposta não reconhecida', async () => {
  const item = fileItem(), progress = [], requests = [];
  const makeRequest = () => {
    const xhr = {upload:{}, headers:{}, open(method, url) { this.method = method; this.url = url; }, setRequestHeader(name, value) { this.headers[name] = value; }, send(file) { this.file = file; }};
    requests.push(xhr); return xhr;
  };
  const sent = sendUpload(item, settings, value => progress.push(value), makeRequest);
  requests[0].upload.onprogress({lengthComputable:true, loaded:6});
  assert.deepEqual(progress, [6]); assert.equal(requests[0].headers['Idempotency-Key'], item.key);
  requests[0].status = 201; requests[0].responseText = JSON.stringify({id:'saved'}); requests[0].onload(); assert.equal((await sent).id, 'saved');
  const retry = sendUpload(item, settings, () => {}, makeRequest);
  requests[1].status = 502; requests[1].responseText = '<html>proxy</html>'; requests[1].onload();
  await assert.rejects(retry, /confirmar/); assert.equal(requests[1].headers['Idempotency-Key'], item.key);
});
