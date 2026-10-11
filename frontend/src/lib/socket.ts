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
    // A handshake the server rejects (e.g. an expired access cookie) is not
    // retried by the client on its own. Try again later, by which time the
    // HTTP layer has usually refreshed the cookie.
    const s = socket;
    s.on('connect_error', () => {
      if (!s.active) setTimeout(() => s.connect(), 5_000);
    });
  }
  return socket;
}
