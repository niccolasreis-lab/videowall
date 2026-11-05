import {createHash, randomBytes, timingSafeEqual} from 'node:crypto';
import {HttpError} from './media.mjs';

const key = 'erp-inbox';
const hash = value => createHash('sha256').update(value).digest('hex');

export function createErpInbox(db,catalog,onApply) {
  const get = () => JSON.parse(db.prepare('SELECT value_json FROM settings WHERE key=?').get(key)?.value_json||'{}');
  const save = value => db.prepare('INSERT INTO settings VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value_json=excluded.value_json').run(key,JSON.stringify(value));
  return {
    status() {
      const {mode,lastId} = get();
      return {mode:mode||'disabled',lastImport:lastId?catalog.inspect(lastId):null};
    },
    configure(mode, rotate) {
      if (!['disabled','review','automatic'].includes(mode)) throw new HttpError(400,'Modo de integração inválido.');
      const current = get();
      const token = mode!=='disabled' && (!current.digest || rotate===true) ? randomBytes(32).toString('hex') : null;
      save({...current,mode,digest:mode==='disabled'?null:token?hash(token):current.digest});
      return {mode,token};
    },
    authorize(header) {
      const token = /^Bearer ([0-9a-f]{64})$/.exec(header||'')?.[1], config = get();
      if (!token || !config.digest || config.mode==='disabled' || !timingSafeEqual(Buffer.from(config.digest),Buffer.from(hash(token))))
        throw new HttpError(401,'Chave do ERP inválida ou integração desativada.');
      return config;
    },
    receive(header,body) {
      const config = this.authorize(header);
      if (typeof body.filename!=='string' || !/^[^/\\]{1,180}\.(csv|txt|mgv)$/i.test(body.filename))
        throw new HttpError(400,'Informe o nome do arquivo CSV ou ITENSMGV.');
      const staged = catalog.stage(body.text,body.filename,{fullSnapshot:true});
      const applied = config.mode==='automatic' && staged.status==='pending';
      const result = applied ? catalog.apply(staged.id,onApply) : staged;
      save({...config,lastId:result.id});
      return {import:result,applied};
    },
  };
}
