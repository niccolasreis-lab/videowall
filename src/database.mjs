import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

export function openDatabase(dataDir) {
  mkdirSync(join(dataDir, 'uploads'), { recursive: true });
  const db = new DatabaseSync(join(dataDir, 'videowall.sqlite'));
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;
    PRAGMA busy_timeout = 5000;
    CREATE TABLE IF NOT EXISTS admins (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      username TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      workspace TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS sessions (
      token_hash TEXT PRIMARY KEY,
      expires_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS media (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      filename TEXT NOT NULL,
      stored_name TEXT NOT NULL UNIQUE,
      mime TEXT NOT NULL,
      kind TEXT NOT NULL CHECK (kind IN ('image', 'video')),
      size INTEGER NOT NULL,
      created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS virtual_content (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      kind TEXT NOT NULL,
      config_json TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS playlists (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      items_json TEXT NOT NULL DEFAULT '[]',
      revision INTEGER NOT NULL DEFAULT 1,
      current_publication_id TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS publications (
      id TEXT PRIMARY KEY,
      playlist_id TEXT NOT NULL REFERENCES playlists(id) ON DELETE CASCADE,
      version INTEGER NOT NULL,
      draft_revision INTEGER NOT NULL,
      snapshot_json TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      UNIQUE (playlist_id, version)
    );
    CREATE TABLE IF NOT EXISTS points (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      location TEXT NOT NULL DEFAULT '',
      fit TEXT NOT NULL DEFAULT 'contain' CHECK (fit IN ('contain', 'cover')),
      playlist_id TEXT REFERENCES playlists(id) ON DELETE SET NULL,
      publication_id TEXT REFERENCES publications(id) ON DELETE SET NULL,
      command_version INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS devices (
      id TEXT PRIMARY KEY,
      token_hash TEXT NOT NULL UNIQUE,
      code TEXT UNIQUE,
      code_expires_at INTEGER,
      point_id TEXT UNIQUE REFERENCES points(id) ON DELETE SET NULL,
      last_seen INTEGER,
      current_media_id TEXT,
      playback_state TEXT NOT NULL DEFAULT 'waiting',
      created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS playback_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      point_id TEXT REFERENCES points(id) ON DELETE CASCADE,
      media_id TEXT,
      media_name TEXT,
      type TEXT NOT NULL,
      detail TEXT NOT NULL DEFAULT '',
      created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS catalog_products (
      product_key TEXT PRIMARY KEY, department TEXT NOT NULL, code TEXT NOT NULL,
      name TEXT NOT NULL, price REAL NOT NULL, unit TEXT NOT NULL,
      available INTEGER NOT NULL, updated_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS catalog_imports (
      id TEXT PRIMARY KEY, digest TEXT NOT NULL UNIQUE, filename TEXT NOT NULL,
      status TEXT NOT NULL, payload_json TEXT NOT NULL, summary_json TEXT NOT NULL,
      base_id TEXT, created_at INTEGER NOT NULL, applied_at INTEGER
    );
    CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY,value_json TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS image_bank_files (
      hash TEXT PRIMARY KEY, stored_name TEXT NOT NULL UNIQUE, mime TEXT NOT NULL,
      size INTEGER NOT NULL, created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS image_bank_items (
      id TEXT PRIMARY KEY, source_url TEXT NOT NULL UNIQUE, name TEXT NOT NULL,
      filename TEXT NOT NULL, brand TEXT NOT NULL DEFAULT '', search_text TEXT NOT NULL,
      scopes_json TEXT NOT NULL DEFAULT '[]', aliases_json TEXT NOT NULL DEFAULT '[]',
      current_hash TEXT REFERENCES image_bank_files(hash), etag TEXT,
      status TEXT NOT NULL DEFAULT 'pending', last_error TEXT NOT NULL DEFAULT '',
      created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS image_bank_items_state ON image_bank_items(status,name,id);
    CREATE TABLE IF NOT EXISTS image_bank_versions (
      item_id TEXT NOT NULL REFERENCES image_bank_items(id),
      hash TEXT NOT NULL REFERENCES image_bank_files(hash), created_at INTEGER NOT NULL,
      PRIMARY KEY(item_id,hash)
    );
    CREATE TABLE IF NOT EXISTS image_bank_runs (
      id TEXT PRIMARY KEY, source TEXT NOT NULL, status TEXT NOT NULL,
      enumeration_complete INTEGER NOT NULL DEFAULT 0, scopes_json TEXT NOT NULL,
      account_id TEXT, error TEXT NOT NULL DEFAULT '', created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS image_bank_run_items (
      run_id TEXT NOT NULL REFERENCES image_bank_runs(id),
      item_id TEXT NOT NULL REFERENCES image_bank_items(id),
      status TEXT NOT NULL DEFAULT 'pending', bytes INTEGER NOT NULL DEFAULT 0,
      error TEXT NOT NULL DEFAULT '', PRIMARY KEY(run_id,item_id)
    );
    CREATE TABLE IF NOT EXISTS image_bank_media (
      hash TEXT PRIMARY KEY REFERENCES image_bank_files(hash),
      media_id TEXT REFERENCES media(id) ON DELETE SET NULL
    );
      CREATE TABLE IF NOT EXISTS image_bank_queries (
        account_id TEXT NOT NULL, term_key TEXT NOT NULL, term TEXT NOT NULL,
        status TEXT NOT NULL, result_count INTEGER NOT NULL DEFAULT 0,
        last_error TEXT NOT NULL DEFAULT '', attempted_at INTEGER NOT NULL,
        PRIMARY KEY(account_id,term_key)
      );
      CREATE TABLE IF NOT EXISTS image_bank_requested_terms (
        term_key TEXT PRIMARY KEY, term TEXT NOT NULL, source_name TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );
    CREATE INDEX IF NOT EXISTS events_by_point ON playback_events(point_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS events_by_date ON playback_events(created_at DESC);
    PRAGMA user_version = 1;
  `);
  const addColumn=(table,name,type)=>{if(!db.prepare(`PRAGMA table_info(${table})`).all().some(column=>column.name===name))db.exec(`ALTER TABLE ${table} ADD COLUMN ${name} ${type}`);};
  db.exec(`CREATE TABLE IF NOT EXISTS catalog_price_sources(product_key TEXT PRIMARY KEY REFERENCES catalog_products(product_key),offer REAL,club REAL);
    CREATE TABLE IF NOT EXISTS catalog_overrides(product_key TEXT PRIMARY KEY REFERENCES catalog_products(product_key),name TEXT,prices_json TEXT NOT NULL DEFAULT '{}');
    CREATE TABLE IF NOT EXISTS playlist_dependencies(parent_id TEXT NOT NULL REFERENCES playlists(id) ON DELETE CASCADE,child_id TEXT NOT NULL REFERENCES playlists(id),PRIMARY KEY(parent_id,child_id));
    CREATE TABLE IF NOT EXISTS operation_events(id INTEGER PRIMARY KEY,kind TEXT NOT NULL,subject_id TEXT,created_at INTEGER NOT NULL);
    CREATE INDEX IF NOT EXISTS operation_events_date ON operation_events(created_at);
    CREATE TABLE IF NOT EXISTS playback_segments(device_id TEXT NOT NULL,client_id TEXT NOT NULL,point_id TEXT NOT NULL,media_id TEXT NOT NULL,publication_id TEXT NOT NULL,started_at INTEGER NOT NULL,ended_at INTEGER NOT NULL,duration_ms INTEGER NOT NULL,PRIMARY KEY(device_id,client_id));
    CREATE INDEX IF NOT EXISTS playback_segments_date ON playback_segments(ended_at);
  `);
  addColumn('points','settings_json',"TEXT NOT NULL DEFAULT '{}'");
  addColumn('devices','telemetry_json',"TEXT NOT NULL DEFAULT '{}'");
  addColumn('media','has_prices','INTEGER NOT NULL DEFAULT 1');
  addColumn('media','validity_json',"TEXT NOT NULL DEFAULT '{}'");
  addColumn('media','upload_key','TEXT');
  db.exec('CREATE UNIQUE INDEX IF NOT EXISTS media_upload_key ON media(upload_key) WHERE upload_key IS NOT NULL');
  addColumn('playlists','schedule_json',`TEXT NOT NULL DEFAULT '{"enabled":false}'`);
  addColumn('devices','offline_json',"TEXT NOT NULL DEFAULT '{}'");
  addColumn('devices','active_publication_id','TEXT');
  addColumn('playback_events','client_event_id','TEXT');
  addColumn('playback_events','device_id','TEXT');
  addColumn('playback_events','publication_id','TEXT');
  addColumn('playback_events','received_at','INTEGER');
  addColumn('playback_events','offline','INTEGER NOT NULL DEFAULT 0');
  db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS events_client_id ON playback_events(device_id,client_event_id) WHERE client_event_id IS NOT NULL;
    CREATE TABLE IF NOT EXISTS device_publications (
      device_id TEXT NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
      point_id TEXT NOT NULL REFERENCES points(id) ON DELETE CASCADE,
      publication_id TEXT NOT NULL REFERENCES publications(id) ON DELETE CASCADE,
      PRIMARY KEY(device_id,point_id,publication_id)
    );`);
  db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(Date.now());
  db.prepare('DELETE FROM devices WHERE point_id IS NULL AND created_at < ?').run(Date.now() - 86400000);
  db.prepare('DELETE FROM playback_events WHERE created_at < ?').run(Date.now() - 90 * 86400000);
  return db;
}

export function transaction(db, action) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = action();
    db.exec('COMMIT');
    return result;
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}
