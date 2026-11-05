import {UploadQueue, uploadItem, uploadTypes} from './upload-queue.js';
import {validityFields, readValidity} from './library-actions.js';

const sizeLabel = bytes => bytes < 1024 * 1024 ? `${Math.ceil(bytes / 1024)} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`;
const labels = {waiting:'Aguardando', invalid:'Revisar arquivo', uploading:'Enviando', linking:'Adicionando às playlists', done:'Concluído', 'upload-error':'Falha no envio', 'link-error':'Vínculo pendente'};

export function batchUploader({api, modal, openModal, closeModal, refresh, escapeHtml:e, getPlaylists, getMaxBytes}) {
  return {
    open() {
      if (modal.dataset.busy === 'true') return;
      const playlists = getPlaylists();
      openModal(`<form id="upload-form" novalidate>
        <div class="modal-head"><div><h2>Enviar arquivos</h2><p class="upload-subtitle">Imagens e vídeos, da biblioteca às playlists.</p></div><button type="button" class="icon-button" data-close aria-label="Fechar">×</button></div>
        <div class="modal-body">
          <fieldset class="upload-configuration" id="upload-files"><legend class="sr-only">Escolher arquivos</legend><label class="file-drop"><strong>Escolha imagens e vídeos</strong><span>PNG, JPEG, WebP, GIF, MP4 ou WebM · até ${Math.floor(getMaxBytes() / 1024 / 1024)} MB por arquivo</span><input aria-label="Escolher arquivos de mídia" type="file" multiple accept="${uploadTypes.join(',')}"></label></fieldset>
          <div class="upload-queue" aria-label="Fila de arquivos"></div>
          <fieldset class="upload-configuration" id="upload-settings"><legend>Configuração do lote</legend>
            <label class="offline-price-option"><input type="checkbox" name="hasPrices" checked> Estes arquivos contêm preços ou ofertas</label>
            <p class="modal-note">Arquivos marcados são ocultados após 24 horas sem confirmação da programação.</p>
            ${validityFields()}
            <fieldset class="field upload-targets"><legend>Adicionar às playlists</legend>
              <p class="modal-note">Opcional. A inclusão fica no rascunho; publique cada playlist para atualizar as telas. Imagens usam 10 segundos e vídeos são exibidos até o final.</p>
              ${playlists.length ? `<label class="offline-price-option"><input type="checkbox" id="upload-all" ${playlists.length > 200 ? 'disabled' : ''}> Selecionar todas</label>${playlists.length > 200 ? '<p class="modal-note">Selecione individualmente até 200 playlists.</p>' : ''}<div class="attach-playlists">${playlists.map(playlist => `<label class="attach-playlist"><input type="checkbox" name="target" value="${e(playlist.id)}"><span><strong>${e(playlist.name)}</strong><small>${playlist.publishedVersion ? 'Publicada · inclusão ficará no rascunho' : 'Ainda não publicada'}</small></span></label>`).join('')}</div>` : '<p class="modal-note">Nenhuma playlist cadastrada. Os arquivos serão salvos na biblioteca.</p>'}
            </fieldset>
          </fieldset>
          <p class="upload-summary" role="status" aria-live="polite"></p><p class="form-error" role="alert"></p>
        </div>
        <div class="modal-footer"><button type="button" class="btn" data-close>Fechar</button><button type="button" class="btn" id="upload-stop" hidden>Parar após o arquivo atual</button><button class="btn primary" type="submit">Enviar arquivos</button></div>
      </form>`, 'upload-dialog');
      const form = modal.querySelector('form');
      const rows = form.querySelector('.upload-queue');
      const errorBox = form.querySelector('.form-error');
      const summary = form.querySelector('.upload-summary');
      const submit = form.querySelector('[type=submit]');
      const stop = form.querySelector('#upload-stop');
      const fileInput = form.querySelector('[type=file]');
      const targets = [...form.querySelectorAll('[name=target]')];
      const all = form.querySelector('#upload-all');
      const queue = new UploadQueue({api, maxBytes:getMaxBytes(), onChange:update});
      const beforeUnload = event => { if (queue.running) { event.preventDefault(); event.returnValue = ''; } };
      window.addEventListener('beforeunload', beforeUnload);
      modal.addEventListener('close', () => { window.removeEventListener('beforeunload', beforeUnload); delete modal.dataset.busy; }, {once:true});

      function update() {
        if (!form.isConnected) return;
        modal.dataset.busy = String(queue.running);
        const frozen = queue.running || !!queue.settings;
        form.querySelector('#upload-files').disabled = frozen;
        form.querySelector('#upload-settings').disabled = frozen;
        for (const button of form.querySelectorAll('[data-close]')) button.disabled = queue.running;
        for (const item of queue.items) {
          const row = rows.querySelector(`[data-key="${item.key}"]`);
          if (!row) continue;
          row.dataset.status = item.status;
          row.querySelector('input').disabled = frozen;
          row.querySelector('input').setAttribute('aria-invalid', String(item.status === 'invalid'));
          row.querySelector('button').disabled = frozen;
          const percent = Math.min(100, Math.floor(item.bytes / item.file.size * 100)) || 0;
          row.querySelector('progress').value = percent;
          row.querySelector('.upload-item-state').textContent = labels[item.status] + (item.status === 'uploading' ? percent === 100 ? ' · aguardando confirmação' : ` · ${percent}%` : '');
          row.querySelector('.upload-item-error').textContent = item.error;
        }
        const done = queue.items.filter(item => item.status === 'done').length;
        const failed = queue.items.filter(item => ['upload-error', 'link-error', 'invalid'].includes(item.status)).length;
        const waiting = queue.items.filter(item => item.status === 'waiting').length;
        summary.textContent = queue.items.length ? `${done} de ${queue.items.length} concluído(s)${failed ? ` · ${failed} com pendência` : ''}${waiting ? ` · ${waiting} aguardando` : ''}.${queue.running ? queue.stopRequested ? ' A fila vai parar após o arquivo atual.' : ' Envio em andamento.' : queue.settings ? ' Arquivos salvos permanecem na biblioteca. Publique as playlists quando estiverem prontas.' : ''}` : 'Escolha os arquivos para montar sua fila.';
        submit.disabled = queue.running || !queue.items.length || done === queue.items.length;
        submit.textContent = queue.settings ? 'Tentar pendências novamente' : 'Enviar arquivos';
        stop.hidden = !queue.running;
        stop.disabled = queue.stopRequested;
      }

      function renderRows() {
        rows.innerHTML = queue.items.map(item => `<article class="upload-item" data-key="${item.key}"><div class="upload-item-heading"><label class="field"><span>Nome na biblioteca</span><input type="text" required maxlength="120" value="${e(item.name)}" aria-label="Nome de ${e(item.file.name)}" aria-describedby="error-${item.key}"></label><button type="button" class="icon-button" aria-label="Remover ${e(item.file.name)}">×</button></div><small class="upload-item-file">${e(item.file.name)} · ${sizeLabel(item.file.size)}</small><progress max="100" value="0" aria-label="Progresso de ${e(item.file.name)}"></progress><span class="upload-item-state"></span><p class="upload-item-error" id="error-${item.key}"></p></article>`).join('');
        for (const item of queue.items) {
          const row = rows.querySelector(`[data-key="${item.key}"]`);
          row.querySelector('input').oninput = event => { item.name = event.target.value; };
          row.querySelector('button').onclick = () => {
            const index = queue.items.indexOf(item);
            queue.items.splice(index, 1); errorBox.textContent = ''; renderRows();
            const focusTarget = rows.querySelectorAll('input')[Math.min(index, queue.items.length - 1)] || fileInput;
            focusTarget.focus();
          };
        }
        update();
      }

      fileInput.onchange = () => {
        for (const file of fileInput.files) queue.items.push(uploadItem(file));
        fileInput.value = ''; errorBox.textContent = ''; renderRows();
      };
      function syncSelection() {
        if (all) { all.checked = targets.length > 0 && targets.every(box => box.checked); all.indeterminate = targets.some(box => box.checked) && !all.checked; }
      }
      for (const box of targets) box.onchange = () => {
        if (targets.filter(target => target.checked).length > 200) { box.checked = false; errorBox.textContent = 'Selecione até 200 playlists.'; }
        else errorBox.textContent = '';
        syncSelection();
      };
      if (all) all.onchange = () => { for (const box of targets) box.checked = all.checked; syncSelection(); };
      for (const button of form.querySelectorAll('[data-close]')) button.onclick = closeModal;
      stop.onclick = () => queue.stop();
      form.onsubmit = async event => {
        event.preventDefault(); errorBox.textContent = '';
        try {
          if (!queue.settings) for (const name of ['validFrom', 'validUntil']) {
            if (!form.elements[name].checkValidity()) { form.elements[name].reportValidity(); throw new Error('Informe datas e horários válidos para a validade do lote.'); }
          }
          const settings = queue.settings || {...readValidity(form), hasPrices:form.elements.hasPrices.checked, targets:targets.filter(box => box.checked).map(box => box.value)};
          await queue.run(settings);
          try { await refresh(); } catch { if (form.isConnected) errorBox.textContent = 'A fila terminou, mas não foi possível atualizar o painel. Os resultados acima foram preservados.'; }
        } catch (error) { if (form.isConnected) errorBox.textContent = error.message; }
        update();
      };
      update();
    }
  };
}
