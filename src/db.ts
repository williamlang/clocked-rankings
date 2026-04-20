import Database from 'better-sqlite3'
import fs from 'fs'
import path from 'path'
import { DB_PATH } from './config.js'

fs.mkdirSync(path.dirname(DB_PATH), { recursive: true })

export const db = new Database(DB_PATH)
db.pragma('journal_mode = WAL')
db.pragma('foreign_keys = ON')

db.exec(`
  CREATE TABLE IF NOT EXISTS zones (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS encounters (
    id INTEGER PRIMARY KEY,
    zone_id INTEGER NOT NULL REFERENCES zones(id),
    name TEXT NOT NULL,
    ordinal INTEGER NOT NULL,
    sub_raid TEXT,
    is_ce_gate INTEGER NOT NULL DEFAULT 0
  );

  CREATE INDEX IF NOT EXISTS idx_encounters_zone ON encounters(zone_id);

  CREATE TABLE IF NOT EXISTS guilds (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    server_slug TEXT NOT NULL,
    server_name TEXT,
    region TEXT NOT NULL,
    faction TEXT,
    ce_achieved_at INTEGER,
    reports_synced_at INTEGER,
    discovered_at INTEGER NOT NULL DEFAULT (unixepoch())
  );

  CREATE INDEX IF NOT EXISTS idx_guilds_ce ON guilds(ce_achieved_at);

  CREATE TABLE IF NOT EXISTS reports (
    code TEXT PRIMARY KEY,
    guild_id INTEGER NOT NULL REFERENCES guilds(id),
    zone_id INTEGER,
    start_time INTEGER NOT NULL,
    end_time INTEGER NOT NULL,
    first_pull INTEGER,
    last_pull INTEGER,
    fetched_at INTEGER NOT NULL DEFAULT (unixepoch())
  );

  CREATE INDEX IF NOT EXISTS idx_reports_guild ON reports(guild_id);

  CREATE TABLE IF NOT EXISTS fights (
    report_code TEXT NOT NULL,
    fight_id INTEGER NOT NULL,
    guild_id INTEGER NOT NULL REFERENCES guilds(id),
    start_time INTEGER NOT NULL,
    end_time INTEGER NOT NULL,
    encounter_id INTEGER,
    difficulty INTEGER,
    PRIMARY KEY (report_code, fight_id)
  );

  CREATE INDEX IF NOT EXISTS idx_fights_guild ON fights(guild_id, start_time);

  CREATE TABLE IF NOT EXISTS mythic_kills (
    guild_id INTEGER NOT NULL REFERENCES guilds(id),
    encounter_id INTEGER NOT NULL,
    report_code TEXT NOT NULL,
    killed_at INTEGER NOT NULL,
    PRIMARY KEY (guild_id, encounter_id)
  );

  CREATE TABLE IF NOT EXISTS sync_state (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at INTEGER NOT NULL DEFAULT (unixepoch())
  );
`)

export function getState(key: string): string | null {
  const row = db.prepare('SELECT value FROM sync_state WHERE key = ?').get(key) as { value: string } | undefined
  return row?.value ?? null
}

export function setState(key: string, value: string): void {
  db.prepare(`
    INSERT INTO sync_state (key, value, updated_at) VALUES (?, ?, unixepoch())
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = unixepoch()
  `).run(key, value)
}

export function clearState(key: string): void {
  db.prepare('DELETE FROM sync_state WHERE key = ?').run(key)
}
