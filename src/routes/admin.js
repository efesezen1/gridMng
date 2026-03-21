const express = require('express');
const router = express.Router();
const { getDb } = require('../db/schema');

// POST /admin/reset — wipe all data (for testing/dev only)
router.post('/reset', (req, res) => {
  const db = getDb();
  db.exec(`
    DELETE FROM grid_logs;
    DELETE FROM consumers;
    DELETE FROM power_sources;
    DELETE FROM nodes;
  `);
  res.json({ message: 'Database reset: all records deleted' });
});

module.exports = router;
