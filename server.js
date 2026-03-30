require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { errorHandler } = require('./src/middleware/errorHandler');
const { ensureSchema } = require('./src/config/ensureSchema');
const authRoutes = require('./src/routes/auth.routes');
const adminRoutes = require('./src/routes/admin.routes');
const publicRoutes = require('./src/routes/public.routes');

const app = express();
const PORT = process.env.PORT || 5000;

// Middleware
app.use(cors());
app.use(express.json());

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api', publicRoutes);

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Error handler
app.use(errorHandler);

async function start() {
  try {
    await ensureSchema();
    app.listen(PORT, '0.0.0.0', () => {
      console.log(`🚀 AnVy Backend running on port ${PORT}`);
    });
  } catch (err) {
    console.error('❌ Failed to ensure database schema:', err.message);
    process.exit(1);
  }
}

start();
