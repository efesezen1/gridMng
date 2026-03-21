const Database = require('better-sqlite3');
const path = require('path');

const DB_PATH = path.join(__dirname, '../../grid.db');

let db;

function getDb() {
  if (!db) {
    db = new Database(DB_PATH);
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
    initSchema();
  }
  return db;
}

function initSchema() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS nodes (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      priority_level INTEGER NOT NULL CHECK (priority_level BETWEEN 1 AND 4),
      max_load_capacity REAL NOT NULL CHECK (max_load_capacity > 0),
      total_demand REAL NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS power_sources (
      id TEXT PRIMARY KEY,
      source_type TEXT NOT NULL CHECK (source_type IN ('Solar', 'Wind', 'Grid')),
      current_output REAL NOT NULL CHECK (current_output >= 0),
      status TEXT NOT NULL DEFAULT 'Active' CHECK (status IN ('Active', 'Maintenance')),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS consumers (
      id TEXT PRIMARY KEY,
      node_id TEXT NOT NULL REFERENCES nodes(id),
      type TEXT NOT NULL CHECK (type IN ('EV_Charger', 'Streetlight', 'Building')),
      current_demand REAL NOT NULL CHECK (current_demand >= 0),
      is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS grid_logs (
      id TEXT PRIMARY KEY,
      node_id TEXT NOT NULL REFERENCES nodes(id),
      total_demand REAL NOT NULL,
      total_supply REAL NOT NULL,
      stability_score REAL NOT NULL,
      timestamp TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_consumers_node_id ON consumers(node_id);
    CREATE INDEX IF NOT EXISTS idx_grid_logs_node_id ON grid_logs(node_id);
    CREATE INDEX IF NOT EXISTS idx_grid_logs_timestamp ON grid_logs(timestamp);
  `);
}

module.exports = { getDb };
