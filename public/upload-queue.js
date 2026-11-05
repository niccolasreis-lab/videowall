export const uploadTypes = ['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'video/mp4', 'video/webm'];
const extensionTypes = {png:'image/png', jpg:'image/jpeg', jpeg:'image/jpeg', webp:'image/webp', gif:'image/gif', mp4:'video/mp4', webm:'video/webm'};

const newUploadKey = () => crypto.randomUUID?.() || Array.from(crypto.getRandomValues(new Uint8Array(16)), byte => byte.toString(16).padStart(2, '0')).join('');
export function uploadItem(file, key = newUploadKey()) {
  return {file, key, name:(file.name.replace(/\.[^.]+$/, '') || file.name).slice(0, 120), mime:file.type || extensionTypes[file.name.split('.').at(-1).toLowerCase()] || '', status:'waiting', bytes:0, error:'', media:null};
}

export function validateUploadItem(item, maxBytes) {
  if (!item.name.trim() || item.name.length > 120) return 'Informe um nome de até 120 caracteres.';
  if (item.file.name.length > 240) return 'O nome do arquivo aceita até 240 caracteres.';
  if (!item.file.size) return 'O arquivo está vazio.';
  if (item.file.size > maxBytes) return `O arquivo ultrapassa o limite de ${Math.floor(maxBytes / 1024 / 1024)} MB.`;
  if (!uploadTypes.includes(item.mime)) return 'Use PNG, JPEG, WebP, GIF, MP4 ou WebM.';
  return '';
}

export function validateUploadSettings(settings) {
  if (settings.targets.length > 200 || new Set(settings.targets).size !== settings.targets.length) throw new Error('Selecione até 200 playlists distintas.');
  for (const key of ['validFrom', 'validUntil']) if (settings[key] && !Number.isFinite(Date.parse(settings[key]))) throw new Error('Informe datas válidas.');
  if (settings.validFrom && settings.validUntil && Date.parse(settings.validUntil) <= Date.parse(settings.validFrom)) throw new Error('O fim da validade deve ser posterior ao início.');
}

export function uploadUrl(item, settings) {
  const params = new URLSearchParams({name:item.name.trim(), filename:item.file.name, hasPrices:String(settings.hasPrices)});
  for (const key of ['validFrom', 'validUntil']) if (settings[key]) params.set(key, settings[key]);
  return '/api/media?' + params;
}

export function sendUpload(item, settings, onProgress, makeRequest = () => new XMLHttpRequest()) {
  return new Promise((resolve, reject) => {
    const xhr = makeRequest();
    xhr.open('POST', uploadUrl(item, settings));
    xhr.withCredentials = true;
    xhr.timeout = 310000;
    xhr.setRequestHeader('Content-Type', item.mime);
    xhr.setRequestHeader('Idempotency-Key', item.key);
    xhr.upload.onprogress = event => { if (event.lengthComputable) onProgress(Math.min(event.loaded, item.file.size)); };
    xhr.onload = () => {
      let result; try { result = JSON.parse(xhr.responseText); } catch { /* A stable key permits retry after an unrecognized response. */ }
      if (xhr.status >= 200 && xhr.status < 300 && result?.id) resolve(result);
      else reject(new Error(result?.error || 'Não foi possível confirmar o envio. Tente novamente.'));
    };
    xhr.onerror = () => reject(new Error('Falha de conexão no envio. Tente novamente.'));
    xhr.ontimeout = () => reject(new Error('O envio excedeu o tempo de espera. Tente novamente.'));
    xhr.onabort = () => reject(new Error('O envio foi interrompido. Tente novamente.'));
    xhr.send(item.file);
  });
}

export class UploadQueue {
  constructor({api, maxBytes, upload = sendUpload, onChange = () => {}}) {
    Object.assign(this, {api, maxBytes, upload, onChange, items:[], settings:null, running:false, stopRequested:false});
  }
  stop() { this.stopRequested = true; this.onChange(); }
  async run(settings) {
    if (this.running) return;
    const selected = this.settings || settings;
    validateUploadSettings(selected);
    if (!this.items.length) throw new Error('Escolha pelo menos um arquivo.');
    let invalid = false;
    for (const item of this.items) {
      item.error = validateUploadItem(item, this.maxBytes);
      if (item.error) { item.status = 'invalid'; invalid = true; }
      else if (item.status === 'invalid') item.status = 'waiting';
    }
    if (invalid) { this.onChange(); throw new Error('Corrija ou remova os arquivos indicados antes de enviar.'); }
    this.settings ||= structuredClone(selected);
    this.running = true; this.stopRequested = false; this.onChange();
    try {
      for (const item of this.items) {
        if (this.stopRequested) break;
        if (item.status === 'done') continue;
        item.error = '';
        try {
          if (!item.media) {
            item.status = 'uploading'; item.bytes = 0; this.onChange();
            item.media = await this.upload(item, this.settings, bytes => { item.bytes = bytes; this.onChange(); });
            item.bytes = item.file.size;
          }
          if (this.settings.targets.length) {
            item.status = 'linking'; this.onChange();
            const lists = await this.api('/api/playlists');
            const targets = this.settings.targets.map(id => {
              const playlist = lists.find(list => list.id === id);
              if (!playlist) throw new Error('Uma playlist selecionada foi removida. O arquivo está salvo na biblioteca; use “Adicionar às playlists” para escolher outro destino.');
              return {id, revision:playlist.revision};
            });
            await this.api('/api/content/' + item.media.id + '/playlists', {method:'POST', body:JSON.stringify({targets, seconds:item.media.kind === 'video' ? 0 : 10})});
          }
          item.status = 'done';
        } catch (error) {
          item.status = item.media ? 'link-error' : 'upload-error';
          item.error = error.message;
        }
        this.onChange();
      }
    } finally { this.running = false; this.onChange(); }
  }
}
