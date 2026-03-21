const { v4: uuidv4 } = require('uuid');

function newId() {
  return uuidv4();
}

function now() {
  return new Date().toISOString();
}

/**
 * Recalculate total_demand for a node based on active consumers,
 * then write a grid_log entry with the current stability score.
 *
 * stability_score = (total_supply / total_demand) * 100, capped at 100.
 * If total_demand === 0 the grid is perfectly stable → 100.
 */
function syncNodeDemand(db, nodeId) {
  const row = db
    .prepare(`SELECT COALESCE(SUM(current_demand), 0) AS total FROM consumers WHERE node_id = ? AND is_active = 1`)
    .get(nodeId);

  const totalDemand = row.total;
  const ts = now();

  db.prepare(`UPDATE nodes SET total_demand = ?, updated_at = ? WHERE id = ?`).run(totalDemand, ts, nodeId);

  // Aggregate total active supply from all active power sources
  const supplyRow = db
    .prepare(`SELECT COALESCE(SUM(current_output), 0) AS total FROM power_sources WHERE status = 'Active'`)
    .get();
  const totalSupply = supplyRow.total;

  const stabilityScore =
    totalDemand === 0 ? 100 : Math.min(100, (totalSupply / totalDemand) * 100);

  db.prepare(
    `INSERT INTO grid_logs (id, node_id, total_demand, total_supply, stability_score, timestamp)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(newId(), nodeId, totalDemand, totalSupply, Math.round(stabilityScore * 100) / 100, ts);
}

module.exports = { newId, now, syncNodeDemand };
