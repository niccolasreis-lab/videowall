import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApplication } from './src/app.mjs';

const root = fileURLToPath(new URL('.', import.meta.url));
// Dentro de um container o loopback não é alcançável pelo proxy reverso.
const container = existsSync('/.dockerenv') || existsSync('/run/.containerenv');
const port = Number(process.env.PORT || 3210);
const host = process.env.HOST || (container ? '0.0.0.0' : '127.0.0.1');
const dataDir = resolve(process.env.APP_DATA_DIR || resolve(root, 'data'));
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT inválida.');
const app = createApplication({
  dataDir,
  secureCookies: process.env.SECURE_COOKIES === 'true' || process.env.COOKIE_SECURE === 'true',
});
app.server.listen(port, host, () => {
  console.log(`VideoWall pronto: http://${host}:${port}`);
  console.log(`Player: http://${host}:${port}/player`);
  console.log(`Dados: ${dataDir}`);
});
let closing = false;
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => {
  if (closing) return;
  closing = true;
  app.server.close(() => { Promise.resolve(app.close()).finally(()=>process.exit(0)); });
  app.server.closeIdleConnections();
});
