const express = require('express');
const router = express.Router();
const { getDb } = require('../db/schema');

// GET /logs — global log feed with optional filters
router.get('/', (req, res) => {
  const { node_id, from, to } = req.query;
  let query = `SELECT gl.*, n.name AS node_name, n.priority_level
               FROM grid_logs gl
               JOIN nodes n ON n.id = gl.node_id
               WHERE 1=1`;
  const params = [];
  if (node_id) { query += ` AND gl.node_id = ?`; params.push(node_id); }
  if (from)    { query += ` AND gl.timestamp >= ?`; params.push(from); }
  if (to)      { query += ` AND gl.timestamp <= ?`; params.push(to); }
  query += ` ORDER BY gl.timestamp DESC LIMIT 100`;

  res.json(getDb().prepare(query).all(...params));
});

// GET /logs/summary — latest log entry per node with current node state
router.get('/summary', (req, res) => {
  const rows = getDb().prepare(`
    SELECT n.id, n.name, n.priority_level, n.max_load_capacity, n.total_demand,
           gl.total_supply, gl.stability_score, gl.timestamp AS last_logged_at
    FROM nodes n
    LEFT JOIN (
      SELECT node_id, total_supply, stability_score, timestamp,
             ROW_NUMBER() OVER (PARTITION BY node_id ORDER BY timestamp DESC) AS rn
      FROM grid_logs
    ) gl ON gl.node_id = n.id AND gl.rn = 1
    ORDER BY n.priority_level, n.name
  `).all();
  res.json(rows);
});

module.exports = router;
