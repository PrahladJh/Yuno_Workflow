import { io } from 'socket.io-client';

let socket = null;

export function getSocket() {
  if (!socket) {
    socket = io('/', { transports: ['websocket', 'polling'] });
    socket.on('connect', () => console.log('WS connected'));
    socket.on('disconnect', () => console.log('WS disconnected'));
  }
  return socket;
}

export function subscribeToRun(runId) {
  getSocket().emit('subscribe:run', runId);
}

export function unsubscribeFromRun(runId) {
  getSocket().emit('unsubscribe:run', runId);
}
