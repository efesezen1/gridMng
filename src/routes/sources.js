const express = require('express');
const router = express.Router();
const { getDb } = require('../db/schema');
const { newId, now } = require('../db/helpers');

// GET /sources
router.get('/', (req, res) => {
  const rows = getDb().prepare(`SELECT * FROM power_sources ORDER BY source_type`).all();
  res.json(rows);
});

// GET /sources/:id
router.get('/:id', (req, res, next) => {
  const row = getDb().prepare(`SELECT * FROM power_sources WHERE id = ?`).get(req.params.id);
  if (!row) return next({ status: 404, message: `Source ${req.params.id} not found` });
  res.json(row);
});

// POST /sources
router.post('/', (req, res, next) => {
  const { source_type, current_output, status } = req.body;
  if (!source_type || current_output == null)
    return next({ status: 400, message: 'source_type and current_output are required' });
  if (!['Solar', 'Wind', 'Grid'].includes(source_type))
    return next({ status: 400, message: 'source_type must be Solar, Wind, or Grid' });
  if (Number(current_output) < 0)
    return next({ status: 400, message: 'current_output must be >= 0' });

  const resolvedStatus = status || 'Active';
  if (!['Active', 'Maintenance'].includes(resolvedStatus))
    return next({ status: 400, message: 'status must be Active or Maintenance' });

  const id = newId();
  const ts = now();
  getDb()
    .prepare(
      `INSERT INTO power_sources (id, source_type, current_output, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)`
    )
    .run(id, source_type, Number(current_output), resolvedStatus, ts, ts);
  res.status(201).json(getDb().prepare(`SELECT * FROM power_sources WHERE id = ?`).get(id));
});

// PUT /sources/:id — supports partial update (good for frequent weather-driven fluctuations)
router.put('/:id', (req, res, next) => {
  const db = getDb();
  const existing = db.prepare(`SELECT * FROM power_sources WHERE id = ?`).get(req.params.id);
  if (!existing) return next({ status: 404, message: `Source ${req.params.id} not found` });

  const source_type = req.body.source_type ?? existing.source_type;
  const current_output = req.body.current_output ?? existing.current_output;
  const status = req.body.status ?? existing.status;

  if (!['Solar', 'Wind', 'Grid'].includes(source_type))
    return next({ status: 400, message: 'source_type must be Solar, Wind, or Grid' });
  if (Number(current_output) < 0)
    return next({ status: 400, message: 'current_output must be >= 0' });
  if (!['Active', 'Maintenance'].includes(status))
    return next({ status: 400, message: 'status must be Active or Maintenance' });

  db.prepare(
    `UPDATE power_sources SET source_type = ?, current_output = ?, status = ?, updated_at = ? WHERE id = ?`
  ).run(source_type, Number(current_output), status, now(), req.params.id);

  res.json(db.prepare(`SELECT * FROM power_sources WHERE id = ?`).get(req.params.id));
});

// DELETE /sources/:id
router.delete('/:id', (req, res, next) => {
  const db = getDb();
  const source = db.prepare(`SELECT * FROM power_sources WHERE id = ?`).get(req.params.id);
  if (!source) return next({ status: 404, message: `Source ${req.params.id} not found` });

  db.prepare(`DELETE FROM power_sources WHERE id = ?`).run(req.params.id);
  res.json({ message: `Source ${req.params.id} (${source.source_type}) deleted successfully` });
});

module.exports = router;
