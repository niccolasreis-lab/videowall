import {settingFields} from '../public/monitor-ui.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
const functions = source.slice(source.indexOf('function bindCommon()'), source.indexOf('async function unpairPoint'));

function harness(rejectSave = false) {
  const button = {}, form = {elements:{kiosk:{checked:false},progress:{checked:false}}}, submit = {}, error = {}, close = {};
  let html = '', request;
  const context = {settingFields,
    document: { querySelectorAll: selector => selector === '[data-new-point]' ? [button] : [] },
    state: { playlists: [] }, modal: {}, icon: () => '', escapeHtml: value => value || '',
    openModal: value => { html = value; }, closeModal() {}, refresh: async () => {}, toast() {},
    $: (selector, parent) => {
      if (selector === '#point-form') return form;
      if (selector === '[data-close]') return close;
      assert.equal(parent, form, 'the submitted form must remain available after await');
      return selector === '.form-error' ? error : submit;
    },
    FormData: class { constructor(element) { assert.equal(element, form); } *[Symbol.iterator]() { yield ['name', 'loja']; yield ['location', 'loja teste 1']; } },
    api: async (path, options) => { request = { path, ...options }; await Promise.resolve(); if (rejectSave) throw new Error('Falha de validação'); },
  };
  vm.runInNewContext(functions + ';bindCommon()', context);
  button.onclick({ type: 'click' });
  return { form, submit, error, get html() { return html; }, get request() { return request; } };
}

test('Adicionar ponto abre criação e envia POST mesmo recebendo um clique', async () => {
  const ui = harness();
  assert.match(ui.html, /<h2>Adicionar ponto<\/h2>/);
  const event = { preventDefault() {}, currentTarget: ui.form };
  const pending = ui.form.onsubmit(event);
  event.currentTarget = null;
  await pending;
  assert.equal(ui.request.method, 'POST');
  assert.equal(ui.request.path, '/api/points');
  assert.equal(JSON.parse(ui.request.body).name, 'loja');
  assert.equal(ui.submit.disabled, false);
});

test('erro após resposta assíncrona aparece no formulário e libera nova tentativa', async () => {
  const ui = harness(true);
  const event = { preventDefault() {}, currentTarget: ui.form };
  const pending = ui.form.onsubmit(event);
  event.currentTarget = null;
  await pending;
  assert.equal(ui.error.textContent, 'Falha de validação');
  assert.equal(ui.submit.disabled, false);
});
