import {createHash, randomBytes, randomUUID} from 'node:crypto';
import {transaction} from './database.mjs';
import {HttpError} from './media.mjs';
import {validateContent, validateValidity} from './content.mjs';
import {referencedMediaIds} from '../public/table-templates.js';

const digest = token => createHash('sha256').update(token).digest('hex');
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const productKey = /^\d{2}:\d{6}$/;
const sectors = {butcher:'Açougue', produce:'Hortifruti', deli:'Frios', bakery:'Padaria', market:'Mercado'};
const reject = (message, status = 400) => { throw new HttpError(status, message); };

function label(value, field, max = 80) {
  if (typeof value !== 'string' || !value.trim() || value.length > max) reject('Informe '+field+' com até '+max+' caracteres.');
  return value.trim();
}

function period(input, parent) {
  const dates = validateValidity(input);
  if (!dates.validFrom || !dates.validUntil) reject('Informe início e fim da campanha.');
  if (parent && (dates.validFrom < parent.validFrom || dates.validUntil > parent.validUntil)) reject('O período local deve estar dentro do período da matriz.');
  return dates;
}

export function createCampaigns({db, clock, catalog, posterThemes}) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS campaign_stores (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, access_hash TEXT UNIQUE, access_mode TEXT NOT NULL DEFAULT 'view'
    );
    CREATE TABLE IF NOT EXISTS campaign_points (
      point_id TEXT PRIMARY KEY REFERENCES points(id) ON DELETE CASCADE,
      store_id TEXT NOT NULL REFERENCES campaign_stores(id), sector TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS campaigns (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, document TEXT NOT NULL, until_at INTEGER NOT NULL,
      cancelled INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS campaign_targets (
      campaign_id TEXT NOT NULL REFERENCES campaigns(id), point_id TEXT NOT NULL REFERENCES points(id) ON DELETE CASCADE,
      store_id TEXT NOT NULL REFERENCES campaign_stores(id), sector TEXT NOT NULL, PRIMARY KEY(campaign_id,point_id)
    );
    CREATE INDEX IF NOT EXISTS campaign_targets_point ON campaign_targets(point_id);
    CREATE TABLE IF NOT EXISTS campaign_overrides (
      campaign_id TEXT NOT NULL REFERENCES campaigns(id), store_id TEXT NOT NULL REFERENCES campaign_stores(id),
      document TEXT NOT NULL, PRIMARY KEY(campaign_id,store_id)
    );
    CREATE TABLE IF NOT EXISTS campaign_streams (
      point_id TEXT PRIMARY KEY, playlist_id TEXT UNIQUE NOT NULL REFERENCES playlists(id),
      fingerprint TEXT NOT NULL, publication_id TEXT NOT NULL REFERENCES publications(id)
    );
    CREATE TABLE IF NOT EXISTS campaign_delivery_items (
      publication_id TEXT NOT NULL REFERENCES publications(id), media_id TEXT NOT NULL,
      campaign_id TEXT NOT NULL REFERENCES campaigns(id), store_id TEXT NOT NULL, store_name TEXT NOT NULL,
      point_id TEXT NOT NULL, point_name TEXT NOT NULL, PRIMARY KEY(publication_id,media_id)
    );
    CREATE INDEX IF NOT EXISTS campaign_delivery_report ON campaign_delivery_items(campaign_id);
    CREATE TABLE IF NOT EXISTS campaign_alerts (
      id INTEGER PRIMARY KEY, point_id TEXT NOT NULL REFERENCES points(id) ON DELETE CASCADE,
      kind TEXT NOT NULL, opened_at INTEGER NOT NULL, resolved_at INTEGER, acknowledged_at INTEGER
    );
    CREATE TABLE IF NOT EXISTS campaign_alert_expectations (
      point_id TEXT PRIMARY KEY REFERENCES points(id) ON DELETE CASCADE,
      publication_id TEXT, changed_at INTEGER NOT NULL
    );
    CREATE UNIQUE INDEX IF NOT EXISTS campaign_alerts_active ON campaign_alerts(point_id,kind) WHERE resolved_at IS NULL;
  `);
  const q = (sql,...args) => db.prepare(sql).get(...args);
  const all = (sql,...args) => db.prepare(sql).all(...args);
  const run = (sql,...args) => db.prepare(sql).run(...args);
  const store = id => q('SELECT id,name,access_mode AS accessMode FROM campaign_stores WHERE id=?',String(id)) || reject('Filial não encontrada.',404);
  const campaign = id => q('SELECT * FROM campaigns WHERE id=?',String(id)) || reject('Campanha não encontrada.',404);
  const config = row => JSON.parse(row.document);

  function saveStore(id, input) {
    const name = label(input.name,'o nome da filial');
    if (id) {
      store(id);
      run('UPDATE campaign_stores SET name=? WHERE id=?',name,id);
    } else {
      id = randomUUID();
      run('INSERT INTO campaign_stores(id,name) VALUES (?,?)',id,name);
    }
    return store(id);
  }
  function assign(pointId, input) {
    if (!q('SELECT id FROM points WHERE id=?',pointId)) reject('Ponto não encontrado.',404);
    if (input.storeId === null) {
      run('DELETE FROM campaign_points WHERE point_id=?',pointId);
      return {ok:true};
    }
    store(input.storeId);
    if (typeof input.sector!=='string'||!Object.hasOwn(sectors,input.sector)) reject('Selecione um setor válido.');
    run('INSERT INTO campaign_points VALUES (?,?,?) ON CONFLICT(point_id) DO UPDATE SET store_id=excluded.store_id,sector=excluded.sector',pointId,input.storeId,input.sector);
    return {ok:true};
  }
  function access(id, mode) {
    store(id);
    if (!['view','edit','revoke'].includes(mode)) reject('Permissão de filial inválida.');
    const token = mode === 'revoke' ? null : randomBytes(32).toString('hex');
    run('UPDATE campaign_stores SET access_hash=?,access_mode=? WHERE id=?',token ? digest(token) : null,mode === 'edit' ? mode : 'view',id);
    return {token};
  }
  function authorize(header) {
    const token = /^Bearer ([0-9a-f]{64})$/.exec(header || '')?.[1];
    const scope = token && q('SELECT id,name,access_mode AS accessMode FROM campaign_stores WHERE access_hash=?',digest(token));
    if (!scope) reject('Informe uma chave de filial válida.',401);
    return scope;
  }
  function productRows(keys, type) {
    return keys.map(key => {
      const p = catalog.product(key);
      if (!p) reject('Produto do catálogo não encontrado.',404);
      const price = p.prices[type] || 0;
      return {key,name:p.name,price,unit:p.unit,code:p.code,department:p.department,active:!!p.available && price>0};
    });
  }
  function plan(input) {
      const name = label(input.name,'o nome da campanha',120);
      const dates = period(input);
      if (Date.parse(dates.validUntil) <= clock()) reject('O fim da campanha deve estar no futuro.');
      const priceType = input.priceType || 'normal';
      if (!['normal','offer','club'].includes(priceType)) reject('Tipo de preço inválido.');
      const layout = input.layout || 'campaign', secondsPerItem = input.secondsPerItem ?? 5;
      if (!['campaign','grid','spotlight','list-spotlight'].includes(layout) || !Number.isInteger(secondsPerItem) || secondsPerItem<1 || secondsPerItem>30) reject('Escolha um layout e duração entre 1 e 30 segundos.');
      if (!Array.isArray(input.pieces) || !input.pieces.length || input.pieces.length>5) reject('Configure de um a cinco setores.');
      const pieces = input.pieces.map(piece => {
        if (!piece || typeof piece.sector!=='string' || !Object.hasOwn(sectors,piece.sector) || !Array.isArray(piece.products) || !piece.products.length || piece.products.length>6 ||
            piece.products.some(key=>typeof key!=='string'||!productKey.test(key)) || new Set(piece.products).size!==piece.products.length) reject('Escolha de um a seis produtos distintos por setor.');
        const theme = piece.themeId ? posterThemes.find(piece.themeId) : null;
        if (piece.themeId && !theme) reject('Identidade visual não encontrada.',404);
        const rows = productRows(piece.products,priceType);
        return {sector:piece.sector,products:piece.products,rows,appearance:theme?.appearance||{}};
      });
      if (new Set(pieces.map(piece=>piece.sector)).size!==pieces.length) reject('Crie somente uma peça por setor.');
      if (!Array.isArray(input.pointIds) || !input.pointIds.length || input.pointIds.length>200 || input.pointIds.some(value=>typeof value!=='string')) reject('Selecione de 1 a 200 TVs.');
      const targets = [...new Set(input.pointIds)].map(pointId => {
        const target = q(`SELECT cp.*,p.name AS point_name,p.settings_json,s.name AS store_name
          FROM campaign_points cp JOIN points p ON p.id=cp.point_id
          JOIN campaign_stores s ON s.id=cp.store_id WHERE cp.point_id=?`,pointId);
        if (!target || !pieces.some(piece=>piece.sector===target.sector)) reject('Associe cada TV a uma filial e a um dos setores da campanha.');
        return target;
      });
      const document = {...dates,priceType,layout,secondsPerItem,pieces};
      return {name,document,targets};
  }
  const limitKey = 'campaign-price-limit';
  const priceLimit = () => JSON.parse(q('SELECT value_json FROM settings WHERE key=?',limitKey)?.value_json||'null');
  function configurePriceLimit(value) {
    if (value!==null && (typeof value!=='number'||!Number.isFinite(value)||value<0||value>1000)) reject('Informe um limite de 0 a 1.000%.');
    run('INSERT INTO settings VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value_json=excluded.value_json',limitKey,JSON.stringify(value));
    return {limit:value};
  }
  function impact({name,document,targets}) {
    const limit = priceLimit(), start = Math.max(Date.parse(document.validFrom),clock());
    const unavailable = document.pieces.flatMap(piece=>piece.rows.filter(row=>!row.active)
      .map(row=>({sector:piece.sector,key:row.key,name:row.name})));
    const emptySectors = document.pieces.filter(piece=>piece.rows.every(row=>!row.active)).map(piece=>piece.sector);
    const keys = new Set(document.pieces.flatMap(piece=>piece.products));
    const normalPrices = new Map([...keys].map(key=>{
      const product=catalog.product(key);
      return [key,product?.available && product.prices.normal>0 ? product.prices.normal : null];
    }));
    const televisions = targets.map(target=>{
      const current = itemsFor({id:target.point_id,settings_json:target.settings_json},start)
        .filter(item=>Date.parse(item.config.validFrom)<=start).reverse().flatMap(item=>item.config.rows);
      const piece = document.pieces.find(piece=>piece.sector===target.sector);
      const products = piece.rows.map(row=>{
        const displayed = current.find(product=>product.department===row.department&&product.code===row.code);
        const before = displayed?.price??normalPrices.get(row.key), after = row.active?row.price:null;
        const variation = before>0 && after!==null ? Math.round((after-before)/before*10000)/100 : null;
        return {key:row.key,name:row.name,unit:row.unit,before,after,variation,
          source:displayed?'campaign':before===null?null:'catalog',
          exceedsLimit:limit!==null&&variation!==null&&Math.abs(variation)>limit};
      });
      return {id:target.point_id,name:target.point_name,storeId:target.store_id,storeName:target.store_name,sector:target.sector,products};
    });
    const requiresReview = televisions.some(tv=>tv.products.some(product=>product.exceedsLimit));
    const version = digest(JSON.stringify([name,document,televisions,limit]));
    return {version,name,validFrom:document.validFrom,validUntil:document.validUntil,televisions,unavailable,emptySectors,requiresReview,limit};
  }
  function launch(input) {
    return transaction(db,() => {
      const id = input.requestId ?? randomUUID();
      if (typeof id !== 'string' || !uuid.test(id)) reject('Identificador da campanha inválido.');
      const previous = q('SELECT * FROM campaigns WHERE id=?',id);
      if (previous) return describe(previous);
      const planned = plan(input);
      const {name,document,targets} = planned;
      if (document.pieces.some(piece=>piece.rows.some(row=>!row.active))) reject('Todos os produtos da campanha precisam estar disponíveis com o preço selecionado.');
      if (input.impactVersion!==undefined || priceLimit()!==null) {
        const checked = impact(planned);
        if ((input.impactVersion!==undefined || checked.requiresReview) && input.impactVersion!==checked.version)
          reject('O impacto precisa ser revisado. Gere uma nova prévia para publicar.',409);
        if (checked.requiresReview && input.acknowledgePriceLimit!==true) reject('Confirme a revisão dos preços acima do limite.',409);
      }
      document.pieces = document.pieces.map(piece=>({id:randomUUID(),...piece}));
      run('INSERT INTO campaigns VALUES (?,?,?,?,0,?)',id,name,JSON.stringify(document),Date.parse(document.validUntil),clock());
      for (const target of targets) run('INSERT INTO campaign_targets VALUES (?,?,?,?)',id,target.point_id,target.store_id,target.sector);
      return describe(campaign(id));
    });
  }
  function describe(row, scope) {
    const document = config(row);
    const targets = all(`SELECT t.point_id AS pointId,t.store_id AS storeId,t.sector,p.name,s.name AS storeName
      FROM campaign_targets t JOIN points p ON p.id=t.point_id JOIN campaign_stores s ON s.id=t.store_id
      WHERE t.campaign_id=? AND (? IS NULL OR (t.store_id=? AND EXISTS(
        SELECT 1 FROM campaign_points cp WHERE cp.point_id=t.point_id AND cp.store_id=t.store_id AND cp.sector=t.sector)))
      ORDER BY s.name,p.name`,row.id,scope?.id||null,scope?.id||null);
    const overrides = all('SELECT store_id,document FROM campaign_overrides WHERE campaign_id=? AND (? IS NULL OR store_id=?)',row.id,scope?.id||null,scope?.id||null)
      .map(value=>({storeId:value.store_id,...config(value)}));
    const pieces = scope ? document.pieces.filter(piece=>targets.some(target=>target.sector===piece.sector)) : document.pieces;
    return {id:row.id,name:row.name,...document,pieces,targets,overrides,cancelled:!!row.cancelled,createdAt:row.created_at};
  }
  function list(scope) {
    return all(`SELECT * FROM campaigns c WHERE (? IS NULL OR EXISTS(SELECT 1 FROM campaign_targets t
      JOIN campaign_points cp ON cp.point_id=t.point_id AND cp.store_id=t.store_id AND cp.sector=t.sector WHERE t.campaign_id=c.id AND t.store_id=?))
      ORDER BY created_at DESC,rowid DESC LIMIT 200`,scope?.id||null,scope?.id||null).map(row=>describe(row,scope));
  }
  function editLocal(id, scope, input) {
    return transaction(db,() => {
      if (scope.accessMode!=='edit') reject('A chave desta filial permite somente consulta.',403);
      if (!q('SELECT 1 AS found FROM campaign_targets WHERE campaign_id=? AND store_id=?',id,scope.id)) reject('Campanha não encontrada.',404);
      const row = campaign(id), current = describe(row,scope);
      if (!current.targets.length) reject('Campanha não encontrada.',404);
      if (row.cancelled || row.until_at <= clock()) reject('Esta campanha está encerrada.',409);
      const prices = input.prices ?? {};
      const allowed = new Set(current.pieces.flatMap(piece=>piece.products));
      if (!prices || typeof prices!=='object' || Array.isArray(prices) || Object.entries(prices).some(([key,value])=>!allowed.has(key)||typeof value!=='number'||!Number.isFinite(value)||value<0.01||value>999999))
        reject('Informe preços positivos apenas para os produtos da filial.');
      const override = {...period(input,current),prices:Object.fromEntries(Object.entries(prices).map(([key,value])=>[key,Math.round(value*100)/100]))};
      run('INSERT INTO campaign_overrides VALUES (?,?,?) ON CONFLICT(campaign_id,store_id) DO UPDATE SET document=excluded.document',id,scope.id,JSON.stringify(override));
      return describe(row,scope);
    });
  }
  function refreshPrices() {
    let updated = 0;
    for (const row of all('SELECT * FROM campaigns WHERE cancelled=0 AND until_at>?',clock())) {
      const document = config(row);
      const pieces = document.pieces.map(piece=>({...piece,rows:productRows(piece.products,document.priceType)}));
      if (JSON.stringify(pieces)===JSON.stringify(document.pieces)) continue;
      run('UPDATE campaigns SET document=? WHERE id=?',JSON.stringify({...document,pieces}),row.id);
      updated++;
    }
    return updated;
  }
  function itemsFor(point, now) {
    return all(`SELECT c.*,t.store_id,t.sector,s.name AS store_name,o.document AS local_document
      FROM campaign_targets t JOIN campaign_points p ON p.point_id=t.point_id AND p.store_id=t.store_id AND p.sector=t.sector
      JOIN campaigns c ON c.id=t.campaign_id JOIN campaign_stores s ON s.id=t.store_id
      LEFT JOIN campaign_overrides o ON o.campaign_id=c.id AND o.store_id=s.id
      WHERE t.point_id=? AND c.cancelled=0 AND c.until_at>? ORDER BY c.created_at,c.id`,point.id,now).flatMap(row => {
      const document = config(row), local = row.local_document ? JSON.parse(row.local_document) : null;
      const piece = document.pieces.find(piece=>piece.sector===row.sector);
      const rows = piece.rows.filter(product=>product.active).map(product=>({...product,price:local?.prices[product.key]??product.price}));
      const validUntil = local?.validUntil||document.validUntil;
      if (!rows.length || Date.parse(validUntil)<=now) return [];
      const input = validateContent({name:row.name,kind:'poster',config:{
        ...piece.appearance,title:row.name,rows,layout:document.layout,priceType:document.priceType,
        secondsPerItem:document.secondsPerItem,validFrom:local?.validFrom||document.validFrom,validUntil,
        orientation:JSON.parse(point.settings_json||'{}').orientation?.startsWith('vertical')?'vertical':'horizontal',
      }});
      return [{...input,id:piece.id,mediaId:piece.id,seconds:rows.length*document.secondsPerItem,
        campaign:{id:row.id,storeId:row.store_id,storeName:row.store_name},assetMediaIds:referencedMediaIds(input)}];
    });
  }
  function publication(point, base) {
    const now = clock();
    const campaignItems = itemsFor(point,now);
    if (!campaignItems.length) return base;
    const snapshot = {playlistName:base?.playlistName||'Campanhas',schedule:{enabled:false},
      items:[...campaignItems,...(base?.items||[]).map(item=>({...item,playbackSchedule:base.schedule||{enabled:false}}))]};
    const fingerprint = digest(JSON.stringify([base?.id,point.name,snapshot]));
    const existing = q('SELECT s.fingerprint,p.id,p.version FROM campaign_streams s JOIN publications p ON p.id=s.publication_id WHERE s.point_id=?',point.id);
    if (existing?.fingerprint===fingerprint) return {id:existing.id,version:existing.version,...snapshot};
    return transaction(db,() => {
      const current = q('SELECT * FROM campaign_streams WHERE point_id=?',point.id);
      if (current?.fingerprint===fingerprint) {
        const {id,version} = q('SELECT id,version FROM publications WHERE id=?',current.publication_id);
        return {id,version,...snapshot};
      }
      const playlistId = current?.playlist_id||randomUUID(), id = randomUUID();
      if (!current) run('INSERT INTO playlists(id,name,created_at,updated_at) VALUES (?,?,?,?)',playlistId,'Programação de campanha',now,now);
      const version = Math.max(base?.version||0,q('SELECT COALESCE(MAX(version),0) AS version FROM publications WHERE playlist_id=?',playlistId).version)+1;
      run('INSERT INTO publications VALUES (?,?,?,?,?,?)',id,playlistId,version,1,JSON.stringify(snapshot),now);
      run('INSERT INTO campaign_streams VALUES (?,?,?,?) ON CONFLICT(point_id) DO UPDATE SET fingerprint=excluded.fingerprint,publication_id=excluded.publication_id',point.id,playlistId,fingerprint,id);
      for (const item of campaignItems) run('INSERT INTO campaign_delivery_items VALUES (?,?,?,?,?,?,?)',id,item.mediaId,item.campaign.id,item.campaign.storeId,item.campaign.storeName,point.id,point.name);
      return {id,version,...snapshot};
    });
  }
  function report(id, params) {
    const row = campaign(id);
    const from = params.get('from') ? Date.parse(params.get('from')) : Date.parse(config(row).validFrom);
    const until = params.get('until') ? Date.parse(params.get('until')) : row.until_at;
    if (!Number.isFinite(from) || !Number.isFinite(until) || from>=until) reject('Período de relatório inválido.');
    return all(`WITH destinations AS (
      SELECT t.store_id,s.name AS store_name,t.point_id,p.name AS point_name FROM campaign_targets t
        JOIN points p ON p.id=t.point_id JOIN campaign_stores s ON s.id=t.store_id WHERE t.campaign_id=?
      UNION ALL SELECT store_id,store_name,point_id,point_name FROM campaign_delivery_items WHERE campaign_id=?
    ), totals AS (
      SELECT i.store_id,i.point_id,SUM(e.type='started') AS started,SUM(e.type='ended') AS ended,SUM(e.type='error') AS errors,MAX(e.created_at) AS lastAt
      FROM campaign_delivery_items i JOIN playback_events e ON e.publication_id=i.publication_id AND e.media_id=i.media_id AND e.point_id=i.point_id
      WHERE i.campaign_id=? AND e.created_at>=? AND e.created_at<? GROUP BY i.store_id,i.point_id
    )
    SELECT d.store_id AS storeId,MAX(d.store_name) AS storeName,d.point_id AS pointId,MAX(d.point_name) AS pointName,
      COALESCE(t.started,0) AS started,COALESCE(t.ended,0) AS ended,COALESCE(t.errors,0) AS errors,t.lastAt
    FROM destinations d LEFT JOIN totals t ON t.store_id=d.store_id AND t.point_id=d.point_id
    WHERE (? IS NULL OR d.store_id=?) GROUP BY d.store_id,d.point_id ORDER BY storeName,pointName`,id,id,id,from,until,params.get('storeId'),params.get('storeId'));
  }
  function alertScan(expected) {
    const now = clock();
    const points = all(`SELECT p.*,d.last_seen,d.active_publication_id,d.created_at AS paired_at FROM points p
      JOIN devices d ON d.point_id=p.id`);
    const incidentStates = points.map(point => {
      const online = now-(point.last_seen??point.paired_at)<25000;
      const target = online ? expected(point) : null;
      const recent = all('SELECT type,media_id FROM playback_events WHERE point_id=? AND created_at>=? ORDER BY created_at DESC,id DESC LIMIT 60',point.id,now-5*60000);
      const failed = new Map(), recovered = new Set();
      for (const event of recent) {
        if (event.type==='ended') recovered.add(event.media_id);
        if (event.type==='error' && !recovered.has(event.media_id)) failed.set(event.media_id,(failed.get(event.media_id)||0)+1);
      }
      return {id:point.id,online,targetId:target?.id||null,activeId:point.active_publication_id,
        playback:[...failed.values()].some(count=>count>=3)};
    });
    transaction(db,() => {
      run('UPDATE campaign_alerts SET resolved_at=? WHERE resolved_at IS NULL AND NOT EXISTS(SELECT 1 FROM devices d WHERE d.point_id=campaign_alerts.point_id)',now);
      run('DELETE FROM campaign_alert_expectations WHERE NOT EXISTS(SELECT 1 FROM devices d WHERE d.point_id=campaign_alert_expectations.point_id)');
      for (const point of incidentStates) {
        const expected = q('SELECT * FROM campaign_alert_expectations WHERE point_id=?',point.id);
        if (point.online && (!expected || expected.publication_id!==point.targetId))
          run('INSERT INTO campaign_alert_expectations VALUES (?,?,?) ON CONFLICT(point_id) DO UPDATE SET publication_id=excluded.publication_id,changed_at=excluded.changed_at',point.id,point.targetId,now);
        const outdated = point.online && expected?.publication_id===point.targetId && point.targetId!==point.activeId && now-expected.changed_at>=60000;
        for (const [kind,active] of Object.entries({offline:!point.online,outdated,playback:point.playback})) {
          if (active) run('INSERT OR IGNORE INTO campaign_alerts(point_id,kind,opened_at) VALUES (?,?,?)',point.id,kind,now);
          else run('UPDATE campaign_alerts SET resolved_at=? WHERE point_id=? AND kind=? AND resolved_at IS NULL',now,point.id,kind);
        }
      }
    });
  }
  function alerts() {
    return all(`SELECT a.id,a.kind,a.opened_at AS openedAt,a.resolved_at AS resolvedAt,a.acknowledged_at AS acknowledgedAt,
      a.point_id AS pointId,p.name AS pointName,s.name AS storeName FROM campaign_alerts a JOIN points p ON p.id=a.point_id
      LEFT JOIN campaign_points cp ON cp.point_id=p.id LEFT JOIN campaign_stores s ON s.id=cp.store_id
      ORDER BY (a.resolved_at IS NULL) DESC,a.opened_at DESC,a.id DESC LIMIT 200`);
  }

  return {saveStore,assign,access,authorize,launch,list,editLocal,publication,refreshPrices,report,alerts,alertScan,configurePriceLimit,
    preview(input) { return impact(plan(input)); },
    alertCount() {return q('SELECT COUNT(*) AS count FROM campaign_alerts WHERE resolved_at IS NULL AND acknowledged_at IS NULL').count;},
    cancel(id) { campaign(id);run('UPDATE campaigns SET cancelled=1 WHERE id=?',id);return {ok:true}; },
    acknowledge(id) {
      if (!run('UPDATE campaign_alerts SET acknowledged_at=COALESCE(acknowledged_at,?) WHERE id=?',clock(),id).changes) reject('Alerta não encontrado.',404);
      return {ok:true};
    },
    internal(id) { return !!q('SELECT 1 AS found FROM campaign_streams WHERE playlist_id=?',id); },
    usesAsset(id) {
      return all('SELECT document FROM campaigns WHERE cancelled=0 AND until_at>?',clock())
        .some(row=>config(row).pieces.some(piece=>referencedMediaIds({kind:'poster',config:piece.appearance}).includes(id)));
    },
    overview() {
      return {stores:all('SELECT id,name,access_mode AS accessMode,(access_hash IS NOT NULL) AS hasAccess FROM campaign_stores ORDER BY name'),
        assignments:all('SELECT point_id AS pointId,store_id AS storeId,sector FROM campaign_points'),
        campaigns:list(),sectors,priceLimit:priceLimit()};
    },
  };
}
