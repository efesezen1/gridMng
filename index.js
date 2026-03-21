const app = require('./src/app');

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`Smart Grid Load Balancer running on http://localhost:${PORT}`);
  console.log(`Database: grid.db (SQLite)`);
});
