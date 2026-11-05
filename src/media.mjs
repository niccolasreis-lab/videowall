import { open, rename, unlink, stat } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';

export class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

const formats = {
  'image/png': { ext: 'png', kind: 'image', check: b => b.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10])) },
  'image/jpeg': { ext: 'jpg', kind: 'image', check: b => b[0] === 255 && b[1] === 216 && b[2] === 255 },
  'image/webp': { ext: 'webp', kind: 'image', check: b => b.toString('ascii', 0, 4) === 'RIFF' && b.toString('ascii', 8, 12) === 'WEBP' },
  'image/gif': { ext: 'gif', kind: 'image', check: b => /^GIF8[79]a$/.test(b.toString('ascii', 0, 6)) },
  'video/mp4': { ext: 'mp4', kind: 'video', check: b => b.toString('ascii', 4, 8) === 'ftyp' },
  'video/webm': { ext: 'webm', kind: 'video', check: b => b.subarray(0, 4).equals(Buffer.from([26,69,223,163])) },
};

export function identifyImage(header) {
  // Some catalog assets use .png in their URL while containing AVIF bytes.
  if(header.length>=24&&header.toString('ascii',4,8)==='ftyp'){
    const size=header.readUInt32BE(0);
    if(size>=20&&size<=header.length){
      const brands=[header.toString('ascii',8,12)];
      for(let offset=16;offset+4<=size;offset+=4)brands.push(header.toString('ascii',offset,offset+4));
      if(brands.some(brand=>brand==='avif'||brand==='avis'))return {mime:'image/avif',ext:'avif'};
    }
  }
  const match=Object.entries(formats).find(([,format])=>format.kind==='image'&&format.check(header));
  return match ? {mime:match[0],ext:match[1].ext} : null;
}

export async function receiveMedia(req, dataDir, maxBytes) {
  const mime = (req.headers['content-type'] || '').split(';')[0];
  const format = formats[mime];
  if (!format) throw new HttpError(415, 'Use PNG, JPEG, WebP, GIF, MP4 ou WebM.');
  if (Number(req.headers['content-length']) > maxBytes) throw new HttpError(413, 'O arquivo ultrapassa o limite de upload.');
  const id = randomUUID();
  const storedName = `${id}.${format.ext}`;
  const temp = join(dataDir, 'uploads', `${id}.part`);
  const finalPath = join(dataDir, 'uploads', storedName);
  const file = await open(temp, 'wx');
  let size = 0;
  let header = Buffer.alloc(0);
  try {
    for await (const chunk of req) {
      size += chunk.length;
      if (size > maxBytes) throw new HttpError(413, 'O arquivo ultrapassa o limite de upload.');
      if (header.length < 64) header = Buffer.concat([header, chunk.subarray(0, 64 - header.length)]);
      await file.writeFile(chunk);
    }
    if (size < 12 || !format.check(header)) throw new HttpError(415, 'O conteúdo do arquivo não corresponde ao formato informado.');
    await file.close();
    await rename(temp, finalPath);
    return { id, storedName, mime, kind: format.kind, size };
  } catch (error) {
    await file.close().catch(() => {});
    await unlink(temp).catch(() => {});
    throw error;
  }
}

export async function sendFile(req, res, filePath, mime, options = {}) {
  let info;
  try { info = await stat(filePath); } catch { throw new HttpError(404, 'Arquivo não encontrado.'); }
  if (!info.isFile()) throw new HttpError(404, 'Arquivo não encontrado.');
  let start = 0, end = info.size - 1;
  const headers = {
    'Content-Type': mime,
    'X-Content-Type-Options': 'nosniff',
    'Cache-Control': options.private ? 'private, max-age=3600' : 'no-cache',
    'Accept-Ranges': 'bytes',
  };
  if (req.headers.range) {
    const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range);
    if (!range || (!range[1] && !range[2])) {
      res.writeHead(416, { 'Content-Range': `bytes */${info.size}` }); return res.end();
    }
    if (!range[1]) start = Math.max(0, info.size - Number(range[2]));
    else { start = Number(range[1]); if (range[2]) end = Math.min(end, Number(range[2])); }
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start > end || start >= info.size) {
      res.writeHead(416, { 'Content-Range': `bytes */${info.size}` }); return res.end();
    }
    headers['Content-Range'] = `bytes ${start}-${end}/${info.size}`;
  }
  headers['Content-Length'] = Math.max(0, end - start + 1);
  res.writeHead(req.headers.range ? 206 : 200, headers);
  if (req.method === 'HEAD' || info.size === 0) return res.end();
  const stream = createReadStream(filePath, { start, end });
  stream.on('error', () => res.destroy());
  res.on('close', () => stream.destroy());
  stream.pipe(res);
}
