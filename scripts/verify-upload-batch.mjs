// Instância isolada: node scripts/verify-upload-batch.mjs CAMINHO_PARA_VIDEO_MP4
// Atrasa uploads e simula uma falha de vínculo, sem usar o banco de produção.
import {createServer, request} from 'node:http';
import {mkdir, writeFile, copyFile} from 'node:fs/promises';
import {join, resolve} from 'node:path';
import {createApplication} from '../src/app.mjs';

const dataDir = resolve('.test-data/upload-batch-ui-' + Date.now());
if (!process.argv[2]) throw new Error('Informe o caminho de um vídeo MP4 para a revisão visual.');
await mkdir(dataDir, {recursive:true});
await writeFile(join(dataDir, 'Campanha.png'), Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=', 'base64'));
await copyFile(resolve(process.argv[2]), join(dataDir, 'Video-campanha.mp4'));
await writeFile(join(dataDir, 'Formato-invalido.txt'), 'Este arquivo não é uma mídia.');
const app = createApplication({dataDir});
await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve));
const target = app.server.address().port;
let cookie;
async function api(path, method = 'GET', body) {
  const response = await fetch('http://127.0.0.1:' + target + path, {method, headers:{'Content-Type':'application/json', ...(cookie ? {Cookie:cookie} : {})}, ...(body ? {body:JSON.stringify(body)} : {})});
  if (!response.ok) throw new Error(await response.text());
  cookie ||= response.headers.get('set-cookie')?.split(';')[0];
  return response.json();
}
await api('/api/auth/setup', 'POST', {username:'revisao', password:'revisao-upload-123', workspace:'Revisão isolada'});
const poster = await api('/api/content', 'POST', {name:'Conteúdo anterior', kind:'poster', config:{title:'Publicação preservada'}});
const a = await api('/api/playlists', 'POST', {name:'Campanha — Loja A', items:[{mediaId:poster.id, seconds:7}]});
const b = await api('/api/playlists', 'POST', {name:'Campanha — Loja B', items:[]});
await api('/api/playlists/' + a.id + '/publish', 'POST', {revision:a.revision});
const calls = [];
let failLink = true;
const proxy = createServer((req, res) => {
  if (req.url === '/__verification') {
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({dataDir, calls, media:app.db.prepare('SELECT id,name,kind,upload_key FROM media').all(), playlists:app.db.prepare('SELECT id,name,revision,items_json FROM playlists').all(), publications:app.db.prepare('SELECT playlist_id,version,snapshot_json FROM publications').all()}));
    return;
  }
  if (req.method === 'POST' && /^\/api\/content\/[^/]+\/playlists$/.test(req.url) && failLink) {
    failLink = false; req.resume(); calls.push({method:req.method, url:req.url, status:503});
    res.writeHead(503, {'Content-Type':'application/json'}); res.end(JSON.stringify({error:'Falha temporária simulada. Tente o vínculo novamente.'})); return;
  }
  const forward = () => {
    const upstream = request({hostname:'127.0.0.1', port:target, path:req.url, method:req.method, headers:req.headers}, response => {
      if (req.method === 'POST') calls.push({method:req.method, url:req.url, status:response.statusCode});
      res.writeHead(response.statusCode, response.headers); response.pipe(res);
    });
    upstream.on('error', error => { res.writeHead(502); res.end(error.message); });
    req.pipe(upstream);
  };
  if (req.method === 'POST' && req.url.startsWith('/api/media?')) setTimeout(forward, 10000);
  else forward();
});
await new Promise(resolve => proxy.listen(3217, '127.0.0.1', resolve));
console.log(JSON.stringify({url:'http://127.0.0.1:3217/#media', dataDir, username:'revisao', password:'revisao-upload-123', playlists:[a.id,b.id]}));
async function close() { proxy.closeAllConnections(); app.server.closeAllConnections(); proxy.close(); app.server.close(); await app.close(); }
process.on('SIGINT', () => { void close().then(() => process.exit()); });
process.on('SIGTERM', () => { void close().then(() => process.exit()); });
