import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { v4 as uuidv4 } from 'uuid';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3001;

// Middleware
app.use(cors());
app.use(express.json());

// Store for connected controllers
const controllers = new Map();

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Get all connected controllers
app.get('/api/controllers', (req, res) => {
  const controllerList = Array.from(controllers.values()).map(ctrl => ({
    id: ctrl.id,
    name: ctrl.name,
    host: ctrl.host,
    port: ctrl.port,
    connected: ctrl.connected,
    strips: ctrl.strips,
    lastSeen: ctrl.lastSeen
  }));
  res.json(controllerList);
});

// Register a new controller
app.post('/api/controllers', (req, res) => {
  const { name, host, port } = req.body;

  if (!name || !host || !port) {
    return res.status(400).json({ error: 'Missing required fields: name, host, port' });
  }

  const id = uuidv4();
  const controller = {
    id,
    name,
    host,
    port,
    connected: false,
    strips: 4,
    lastSeen: new Date().toISOString()
  };

  controllers.set(id, controller);
  res.status(201).json(controller);
});

// Get controller details
app.get('/api/controllers/:id', (req, res) => {
  const controller = controllers.get(req.params.id);

  if (!controller) {
    return res.status(404).json({ error: 'Controller not found' });
  }

  res.json(controller);
});

// Delete a controller
app.delete('/api/controllers/:id', (req, res) => {
  const deleted = controllers.delete(req.params.id);

  if (!deleted) {
    return res.status(404).json({ error: 'Controller not found' });
  }

  res.json({ success: true });
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ error: 'Internal server error' });
});

// Start server
app.listen(PORT, () => {
  console.log(`LED-Central backend server running on port ${PORT}`);
  console.log(`API available at http://localhost:${PORT}/api`);
});

export default app;
