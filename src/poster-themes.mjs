import { randomUUID } from 'node:crypto';
import { validateContent } from './content.mjs';
import { HttpError } from './media.mjs';
import { posterAppearance, builtInPosterThemes } from '../public/poster-theme-model.js';
import { referencedMediaIds } from '../public/table-templates.js';

export function createPosterThemes(db) {
 const prefix = 'poster-theme:', defaultKey = 'poster-theme-default';
 const find = id => builtInPosterThemes.find(theme => theme.id === id) || (() => {
  const row = db.prepare('SELECT value_json FROM settings WHERE key=?').get(prefix+id);
  return row ? JSON.parse(row.value_json) : null;
 })();
 const put = (key,value) => db.prepare('INSERT INTO settings(key,value_json) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value_json=excluded.value_json').run(key,JSON.stringify(value));
 return {
  find,
  usesAsset(id) {
   return this.list().items.some(theme=>referencedMediaIds({kind:'poster',config:theme.appearance}).includes(id));
  },
  list() {
   const custom = db.prepare("SELECT value_json FROM settings WHERE key LIKE 'poster-theme:%' ORDER BY key").all().map(row => JSON.parse(row.value_json));
   const defaultId = JSON.parse(db.prepare('SELECT value_json FROM settings WHERE key=?').get(defaultKey)?.value_json || 'null');
   return {items:[...builtInPosterThemes,...custom],defaultId};
  },
  save(body,id=null) {
   if (typeof body.name !== 'string' || !body.name.trim() || body.name.length > 80) throw new HttpError(400,'Informe um nome de tema de até 80 caracteres.');
   if (!body.appearance || typeof body.appearance !== 'object' || Array.isArray(body.appearance)) throw new HttpError(400,'Aparência do tema inválida.');
   if (id) {
    if (builtInPosterThemes.some(theme=>theme.id===id)) throw new HttpError(400,'Duplique um tema de fábrica para personalizá-lo.');
    if (!find(id)) throw new HttpError(404,'Tema não encontrado.');
   } else if (db.prepare("SELECT COUNT(*) AS n FROM settings WHERE key LIKE 'poster-theme:%'").get().n>=100) {
    throw new HttpError(400,'Limite de 100 temas personalizados atingido.');
   }
   const validated = validateContent({name:'Tema',kind:'poster',config:{...posterAppearance(body.appearance),title:'Tema'}});
   for (const id of referencedMediaIds(validated)) {
    if (db.prepare('SELECT kind FROM media WHERE id=?').get(id)?.kind!=='image') throw new HttpError(400,'Use uma imagem da biblioteca na identidade visual.');
   }
   const theme = {id:id||randomUUID(),name:body.name.trim(),appearance:posterAppearance(validated.config)};
   put(prefix+theme.id,theme);
   return theme;
  },
  setDefault(id) {
   if (id !== null && (typeof id !== 'string' || !find(id))) throw new HttpError(404,'Tema não encontrado.');
   put(defaultKey,id); return {defaultId:id};
  },
  remove(id) {
   if (builtInPosterThemes.some(theme => theme.id === id)) throw new HttpError(400,'Temas de fábrica não podem ser excluídos.');
   if (!find(id)) throw new HttpError(404,'Tema não encontrado.');
   db.prepare('DELETE FROM settings WHERE key=?').run(prefix+id);
   const current = JSON.parse(db.prepare('SELECT value_json FROM settings WHERE key=?').get(defaultKey)?.value_json || 'null');
   if (current === id) put(defaultKey,null);
   return {ok:true};
  },
 };
}
