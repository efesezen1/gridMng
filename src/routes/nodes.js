const express = require('express');
const router = express.Router();
const { getDb } = require('../db/schema');
const { newId, now, syncNodeDemand } = require('../db/helpers');

// GET /nodes — list all
router.get('/', (req, res) => {
  const rows = getDb().prepare(`SELECT * FROM nodes ORDER BY priority_level, name`).all();
  res.json(rows);
});

// GET /nodes/:id
router.get('/:id', (req, res, next) => {
  const row = getDb().prepare(`SELECT * FROM nodes WHERE id = ?`).get(req.params.id);
  if (!row) return next({ status: 404, message: `Node ${req.params.id} not found` });
  res.json(row);
});

// POST /nodes
router.post('/', (req, res, next) => {
  const { name, priority_level, max_load_capacity } = req.body;
  if (!name || priority_level == null || max_load_capacity == null)
    return next({ status: 400, message: 'name, priority_level, max_load_capacity are required' });
  if (![1, 2, 3, 4].includes(Number(priority_level)))
    return next({ status: 400, message: 'priority_level must be 1-4' });
  if (Number(max_load_capacity) <= 0)
    return next({ status: 400, message: 'max_load_capacity must be > 0' });

  const id = newId();
  const ts = now();
  try {
    getDb()
      .prepare(
        `INSERT INTO nodes (id, name, priority_level, max_load_capacity, total_demand, created_at, updated_at)
         VALUES (?, ?, ?, ?, 0, ?, ?)`
      )
      .run(id, name.trim(), Number(priority_level), Number(max_load_capacity), ts, ts);
    res.status(201).json(getDb().prepare(`SELECT * FROM nodes WHERE id = ?`).get(id));
  } catch (err) {
    if (err.message.includes('UNIQUE')) return next({ status: 409, message: `Node name '${name}' already exists` });
    next(err);
  }
});

// PUT /nodes/:id
router.put('/:id', (req, res, next) => {
  const db = getDb();
  const existing = db.prepare(`SELECT * FROM nodes WHERE id = ?`).get(req.params.id);
  if (!existing) return next({ status: 404, message: `Node ${req.params.id} not found` });

  const name = req.body.name ?? existing.name;
  const priority_level = req.body.priority_level ?? existing.priority_level;
  const max_load_capacity = req.body.max_load_capacity ?? existing.max_load_capacity;

  if (![1, 2, 3, 4].includes(Number(priority_level)))
    return next({ status: 400, message: 'priority_level must be 1-4' });
  if (Number(max_load_capacity) <= 0)
    return next({ status: 400, message: 'max_load_capacity must be > 0' });

  try {
    db.prepare(
      `UPDATE nodes SET name = ?, priority_level = ?, max_load_capacity = ?, updated_at = ? WHERE id = ?`
    ).run(name.trim(), Number(priority_level), Number(max_load_capacity), now(), req.params.id);
    res.json(db.prepare(`SELECT * FROM nodes WHERE id = ?`).get(req.params.id));
  } catch (err) {
    if (err.message.includes('UNIQUE')) return next({ status: 409, message: `Node name '${name}' already exists` });
    next(err);
  }
});

// DELETE /nodes/:id — blocked if active consumers exist
router.delete('/:id', (req, res, next) => {
  const db = getDb();
  const node = db.prepare(`SELECT * FROM nodes WHERE id = ?`).get(req.params.id);
  if (!node) return next({ status: 404, message: `Node ${req.params.id} not found` });

  const activeCount = db
    .prepare(`SELECT COUNT(*) AS cnt FROM consumers WHERE node_id = ? AND is_active = 1`)
    .get(req.params.id).cnt;

  if (activeCount > 0)
    return next({
      status: 409,
      message: `Cannot delete node '${node.name}': ${activeCount} active consumer(s) still attached`,
    });

  // Remove logs and inactive consumers before deleting the node
  db.prepare(`DELETE FROM grid_logs WHERE node_id = ?`).run(req.params.id);
  db.prepare(`DELETE FROM consumers WHERE node_id = ?`).run(req.params.id);
  db.prepare(`DELETE FROM nodes WHERE id = ?`).run(req.params.id);
  res.json({ message: `Node '${node.name}' deleted successfully` });
});

// GET /nodes/:id/logs — retrieve stability log for a node
router.get('/:id/logs', (req, res, next) => {
  const db = getDb();
  const node = db.prepare(`SELECT * FROM nodes WHERE id = ?`).get(req.params.id);
  if (!node) return next({ status: 404, message: `Node ${req.params.id} not found` });

  const limit = Math.min(Number(req.query.limit) || 50, 200);
  const logs = db
    .prepare(`SELECT * FROM grid_logs WHERE node_id = ? ORDER BY timestamp DESC LIMIT ?`)
    .all(req.params.id, limit);
  res.json({ node, logs });
});

module.exports = router;
