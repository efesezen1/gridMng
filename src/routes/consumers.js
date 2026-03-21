const express = require('express');
const router = express.Router();
const { getDb } = require('../db/schema');
const { newId, now, syncNodeDemand } = require('../db/helpers');

// GET /consumers
router.get('/', (req, res) => {
  const { node_id, is_active } = req.query;
  let query = `SELECT * FROM consumers WHERE 1=1`;
  const params = [];
  if (node_id) { query += ` AND node_id = ?`; params.push(node_id); }
  if (is_active != null) { query += ` AND is_active = ?`; params.push(Number(is_active)); }
  query += ` ORDER BY node_id, type`;
  res.json(getDb().prepare(query).all(...params));
});

// GET /consumers/:id
router.get('/:id', (req, res, next) => {
  const row = getDb().prepare(`SELECT * FROM consumers WHERE id = ?`).get(req.params.id);
  if (!row) return next({ status: 404, message: `Consumer ${req.params.id} not found` });
  res.json(row);
});

// POST /consumers
router.post('/', (req, res, next) => {
  const { node_id, type, current_demand, is_active } = req.body;
  if (!node_id || !type || current_demand == null)
    return next({ status: 400, message: 'node_id, type, and current_demand are required' });

  const db = getDb();
  const node = db.prepare(`SELECT * FROM nodes WHERE id = ?`).get(node_id);
  if (!node) return next({ status: 404, message: `Node ${node_id} not found` });

  if (!['EV_Charger', 'Streetlight', 'Building'].includes(type))
    return next({ status: 400, message: 'type must be EV_Charger, Streetlight, or Building' });
  if (Number(current_demand) < 0)
    return next({ status: 400, message: 'current_demand must be >= 0' });

  const id = newId();
  const ts = now();
  const active = is_active === false || is_active === 0 ? 0 : 1;

  db.prepare(
    `INSERT INTO consumers (id, node_id, type, current_demand, is_active, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(id, node_id, type, Number(current_demand), active, ts, ts);

  syncNodeDemand(db, node_id);

  res.status(201).json(db.prepare(`SELECT * FROM consumers WHERE id = ?`).get(id));
});

// PUT /consumers/:id — triggers immediate node demand recalculation
router.put('/:id', (req, res, next) => {
  const db = getDb();
  const existing = db.prepare(`SELECT * FROM consumers WHERE id = ?`).get(req.params.id);
  if (!existing) return next({ status: 404, message: `Consumer ${req.params.id} not found` });

  const node_id = req.body.node_id ?? existing.node_id;
  const type = req.body.type ?? existing.type;
  const current_demand = req.body.current_demand ?? existing.current_demand;
  const is_active = req.body.is_active ?? existing.is_active;

  // Validate destination node if node_id is changing
  if (node_id !== existing.node_id) {
    const destNode = db.prepare(`SELECT * FROM nodes WHERE id = ?`).get(node_id);
    if (!destNode) return next({ status: 404, message: `Destination node ${node_id} not found` });
  }

  if (!['EV_Charger', 'Streetlight', 'Building'].includes(type))
    return next({ status: 400, message: 'type must be EV_Charger, Streetlight, or Building' });
  if (Number(current_demand) < 0)
    return next({ status: 400, message: 'current_demand must be >= 0' });

  db.prepare(
    `UPDATE consumers SET node_id = ?, type = ?, current_demand = ?, is_active = ?, updated_at = ? WHERE id = ?`
  ).run(node_id, type, Number(current_demand), Number(is_active), now(), req.params.id);

  // Re-sync affected node(s)
  syncNodeDemand(db, node_id);
  if (node_id !== existing.node_id) {
    syncNodeDemand(db, existing.node_id); // also update old node if consumer moved
  }

  res.json(db.prepare(`SELECT * FROM consumers WHERE id = ?`).get(req.params.id));
});

// DELETE /consumers/:id
router.delete('/:id', (req, res, next) => {
  const db = getDb();
  const consumer = db.prepare(`SELECT * FROM consumers WHERE id = ?`).get(req.params.id);
  if (!consumer) return next({ status: 404, message: `Consumer ${req.params.id} not found` });

  db.prepare(`DELETE FROM consumers WHERE id = ?`).run(req.params.id);
  syncNodeDemand(db, consumer.node_id);

  res.json({ message: `Consumer ${req.params.id} deleted and node demand recalculated` });
});

module.exports = router;
