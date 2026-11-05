import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApplication } from '../src/app.mjs';

let app, origin, dataDir;
const call = async (path, options = {}) => {
  const response = await fetch(`${origin}${path}`, options);
  const body = await response.json().catch(() => ({}));
  return { response, body, cookie: response.headers.get('set-cookie')?.split(';')[0] };
};

test.before(async () => {
  dataDir = await mkdtemp(join(tmpdir(), 'videowall-test-'));
  app = createApplication({ dataDir, maxUploadBytes: 1024 * 1024 });
  await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve));
  origin = `http://127.0.0.1:${app.server.address().port}`;
});
test.after(async () => {
  await new Promise(resolve => app.server.close(resolve));
  await app.close();
  await rm(dataDir, { recursive: true, force: true });
});

test('publica uma playlist e a entrega para um player vinculado', async () => {
  const setup = await call('/api/auth/setup', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ workspace: 'Rede de teste', username: 'admin', password: 'senha-com-dez-caracteres' }) });
  assert.equal(setup.response.status, 200);
  const adminCookie = setup.cookie;
  assert.ok(adminCookie?.startsWith('vw_session='));

  const player = await call('/api/player/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
  assert.equal(player.body.state, 'pairing');
  assert.match(player.body.code, /^[A-Z0-9]{6}$/);
  const deviceCookie = player.cookie;

  const point = await call('/api/points', { method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: adminCookie }, body: JSON.stringify({ name: 'Recepção', location: 'Loja centro', fit: 'contain' }) });
  assert.equal(point.response.status, 201);

  const paired = await call(`/api/points/${point.body.id}/pair`, { method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: adminCookie }, body: JSON.stringify({ code: player.body.code }) });
  assert.equal(paired.body.paired, true);

  const png = Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), Buffer.from([0, 0, 0, 0])]);
  const uploaded = await call('/api/media?name=Oferta%20da%20semana&filename=oferta.png', { method: 'POST', headers: { 'Content-Type': 'image/png', Cookie: adminCookie }, body: png });
  assert.equal(uploaded.response.status, 201);
  assert.equal(uploaded.body.kind, 'image');

  const playlist = await call('/api/playlists', { method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: adminCookie }, body: JSON.stringify({ name: 'Recepção manhã', items: [{ mediaId: uploaded.body.id, seconds: 3 }] }) });
  assert.equal(playlist.response.status, 201);

  const editedPoint = await call(`/api/points/${point.body.id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json', Cookie: adminCookie }, body: JSON.stringify({ name: 'Recepção', location: 'Loja centro', fit: 'contain', playlistId: playlist.body.id }) });
  assert.equal(editedPoint.response.status, 200);

  const published = await call(`/api/playlists/${playlist.body.id}/publish`, { method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: adminCookie }, body: JSON.stringify({ revision: playlist.body.revision }) });
  assert.equal(published.body.publishedVersion, 1);
  assert.equal(published.body.dirty, false);

  const synced = await call('/api/player/sync', { method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: deviceCookie }, body: JSON.stringify({ playbackState: 'playing', currentMediaId: uploaded.body.id, event: { type: 'started', mediaId: uploaded.body.id } }) });
  assert.equal(synced.body.state, 'paired');
  assert.equal(synced.body.publication.version, 1);
  assert.equal(synced.body.publication.items[0].mediaId, uploaded.body.id);

  const dashboard = await call('/api/dashboard', { headers: { Cookie: adminCookie } });
  assert.equal(dashboard.body.counts.points, 1);
  assert.equal(dashboard.body.counts.online, 1);
  assert.equal(dashboard.body.counts.playsToday, 1);

  const unauthorized = await call(`/api/points/${point.body.id}/monitor`);
  assert.equal(unauthorized.response.status,401);
  app.db.prepare('INSERT INTO playback_events (point_id,media_id,media_name,type,detail,created_at) VALUES (?,?,?,?,?,?)').run(point.body.id,uploaded.body.id,'Evento antigo','started','',Date.now()-31*60000);
  const monitor = await call(`/api/points/${point.body.id}/monitor`,{headers:{Cookie:adminCookie}});
  assert.equal(monitor.response.status,200);
  assert.equal(monitor.body.point.currentMedia.name,'Oferta da semana');
  assert.equal(monitor.body.publication.items[0].name,'Oferta da semana');
  assert.equal(monitor.body.events.length,1,'exclui eventos anteriores a 30 minutos');
  assert.equal(monitor.body.events[0].point_id,point.body.id);
  assert.equal(monitor.body.eventsTruncated,false);
  assert.ok(monitor.body.since<monitor.body.serverTime);
  app.db.prepare('DELETE FROM playback_events WHERE media_name=?').run('Evento antigo');

  const reports = await call('/api/reports?days=7', { headers: { Cookie: adminCookie } });
  assert.equal(reports.response.status, 200);
  assert.equal(reports.body.totals.starts, 1);
  assert.equal(reports.body.byContent[0].name, 'Oferta da semana');
  assert.equal(reports.body.byPoint[0].name, 'Recepção');

  const policy=await call(`/api/media/${uploaded.body.id}`,{method:'PUT',headers:{'Content-Type':'application/json',Cookie:adminCookie},body:JSON.stringify({hasPrices:false})});
  assert.equal(policy.body.hasPrices,false);
  const afterPolicy=await call(`/api/points/${point.body.id}/monitor`,{headers:{Cookie:adminCookie}});
  assert.equal(afterPolicy.body.publication.items[0].hasPrices,true,'a política só muda na TV depois de republicar');
  const draft=await call('/api/playlists',{headers:{Cookie:adminCookie}});
  assert.equal(draft.body[0].dirty,true);
});

test('impede que mídia publicada seja excluída', async () => {
  const login = await call('/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'admin', password: 'senha-com-dez-caracteres' }) });
  const media = await call('/api/media', { headers: { Cookie: login.cookie } });
  const deletion = await call(`/api/media/${media.body[0].id}`, { method: 'DELETE', headers: { Cookie: login.cookie } });
  assert.equal(deletion.response.status, 409);
  assert.match(deletion.body.error, /playlist/i);
});
