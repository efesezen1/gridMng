const express = require('express');
const { errorHandler, notFound } = require('./middleware/errorHandler');

const nodesRouter = require('./routes/nodes');
const sourcesRouter = require('./routes/sources');
const consumersRouter = require('./routes/consumers');
const logsRouter = require('./routes/logs');
const adminRouter = require('./routes/admin');

const app = express();

app.use(express.json());

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', service: 'Smart Grid Load Balancer', timestamp: new Date().toISOString() });
});

app.use('/nodes', nodesRouter);
app.use('/sources', sourcesRouter);
app.use('/consumers', consumersRouter);
app.use('/logs', logsRouter);
app.use('/admin', adminRouter);

app.use(notFound);
app.use(errorHandler);

module.exports = app;
