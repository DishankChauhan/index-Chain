import { Server as HttpServer } from 'http';
import { WebSocketService } from './services/websocketService';

export function initializeWebSocketServer(server: HttpServer): void {
  const wsService = WebSocketService.getInstance();
  wsService.initialize(server);
} 