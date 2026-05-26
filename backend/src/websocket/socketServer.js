import { Server } from 'socket.io';

let io;

export function initSocketServer(httpServer) {
  io = new Server(httpServer, {
    cors: {
      origin: process.env.FRONTEND_URL || 'http://localhost:5173',
      methods: ['GET', 'POST']
    }
  });

  io.on('connection', (socket) => {
    console.log('Client connected:', socket.id);

    // Subscribe to a specific run's events
    socket.on('subscribe:run', (runId) => {
      socket.join(`run:${runId}`);
    });

    socket.on('unsubscribe:run', (runId) => {
      socket.leave(`run:${runId}`);
    });

    socket.on('disconnect', () => {
      console.log('Client disconnected:', socket.id);
    });
  });

  return io;
}

export function getIO() {
  if (!io) throw new Error('Socket.io not initialized');
  return io;
}
