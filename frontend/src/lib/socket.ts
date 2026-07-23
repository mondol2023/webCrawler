import { io, type Socket } from 'socket.io-client';

/**
 * Single shared Socket.io connection. In dev, Vite proxies `/socket.io` to the
 * backend; in production the app is served from the same origin as the API.
 */
let socket: Socket | null = null;

export function getSocket(): Socket {
  if (!socket) {
    socket = io({
      path: '/socket.io',
      withCredentials: true,
      autoConnect: true,
      transports: ['websocket', 'polling'],
    });
  }
  return socket;
}
