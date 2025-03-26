import { WebSocketServer, WebSocket } from 'ws';
import { IncomingMessage } from 'http';
import { getToken, JWT } from 'next-auth/jwt';
import { logger } from '@/lib/utils/logging';
import { parseCookies } from 'nookies';

interface WebSocketMessage {
  type: 'JOB_UPDATE' | 'JOB_UPDATED' | 'JOB_DELETED' | 'ERROR' | 'NOTIFICATION' | 'PING' | 'PONG';
  data: any;
}

interface WebSocketClient extends WebSocket {
  isAlive: boolean;
  userId: string;
}

interface AuthenticatedRequest extends IncomingMessage {
  cookies?: { [key: string]: string };
}

export class WebSocketService {
  private static instance: WebSocketService;
  private wss: WebSocketServer | null = null;
  private clients: Map<string, Set<WebSocketClient>> = new Map();
  private heartbeatInterval: NodeJS.Timeout | null = null;

  private constructor() {}

  public static getInstance(): WebSocketService {
    if (!WebSocketService.instance) {
      WebSocketService.instance = new WebSocketService();
    }
    return WebSocketService.instance;
  }

  public initialize(server: any): void {
    this.wss = new WebSocketServer({ 
      server,
      path: '/ws',
      clientTracking: true,
    });

    this.setupHeartbeat();
    this.setupEventHandlers();

    logger.info('WebSocket server initialized', {
      component: 'WebSocketService',
    });
  }

  private setupHeartbeat(): void {
    // Send ping to all clients every 30 seconds
    this.heartbeatInterval = setInterval(() => {
      this.wss?.clients.forEach((client: WebSocket) => {
        const wsClient = client as WebSocketClient;
        if (wsClient.isAlive === false) {
          logger.warn('Client connection terminated due to inactivity', {
            component: 'WebSocketService',
            userId: wsClient.userId,
          });
          return wsClient.terminate();
        }

        wsClient.isAlive = false;
        wsClient.ping();
      });
    }, 30000);

    // Clean up interval on server close
    this.wss?.on('close', () => {
      if (this.heartbeatInterval) {
        clearInterval(this.heartbeatInterval);
      }
    });
  }

  private setupEventHandlers(): void {
    if (!this.wss) return;

    this.wss.on('connection', async (ws: WebSocket, req: AuthenticatedRequest) => {
      try {
        const token = await this.authenticateConnection(req);
        if (!token) {
          ws.close(1008, 'Unauthorized');
          return;
        }

        const wsClient = ws as WebSocketClient;
        wsClient.isAlive = true;
        wsClient.userId = token.sub!;

        this.addClient(wsClient.userId, wsClient);
        this.setupClientEventHandlers(wsClient);

        // Send initial connection success message
        this.sendToClient(wsClient, {
          type: 'NOTIFICATION',
          data: { message: 'Connected to real-time updates' },
        });

      } catch (error) {
        logger.error('Failed to establish WebSocket connection', error as Error, {
          component: 'WebSocketService',
          path: req.url,
        });
        ws.close(1011, 'Internal Server Error');
      }
    });
  }

  private async authenticateConnection(req: AuthenticatedRequest): Promise<JWT | null> {
    try {
      // Convert IncomingHttpHeaders to Record<string, string>
      const headers: Record<string, string> = {};
      Object.entries(req.headers).forEach(([key, value]) => {
        if (value) {
          headers[key] = Array.isArray(value) ? value[0] : value;
        }
      });

      // Get the token from the request cookies or headers
      const token = await getToken({ 
        req: {
          headers,
        } as any,
        secret: process.env.NEXTAUTH_SECRET,
      });

      if (!token) {
        logger.warn('Unauthorized WebSocket connection attempt', {
          component: 'WebSocketService',
          path: req.url,
        });
        return null;
      }

      return token;
    } catch (error) {
      logger.error('Failed to authenticate WebSocket connection', error as Error, {
        component: 'WebSocketService',
        path: req.url,
      });
      return null;
    }
  }

  private setupClientEventHandlers(client: WebSocketClient): void {
    client.on('pong', () => {
      client.isAlive = true;
    });

    client.on('message', (data: string) => {
      try {
        const message = JSON.parse(data) as WebSocketMessage;
        this.handleMessage(client.userId, message);
      } catch (error) {
        logger.error('Failed to parse WebSocket message', error as Error, {
          component: 'WebSocketService',
          userId: client.userId,
        });
      }
    });

    client.on('close', () => {
      this.removeClient(client.userId, client);
    });

    client.on('error', (error) => {
      logger.error('WebSocket client error', error, {
        component: 'WebSocketService',
        userId: client.userId,
      });
      this.removeClient(client.userId, client);
    });
  }

  private addClient(userId: string, ws: WebSocketClient): void {
    if (!this.clients.has(userId)) {
      this.clients.set(userId, new Set());
    }
    this.clients.get(userId)!.add(ws);

    logger.info('Client connected', {
      component: 'WebSocketService',
      userId,
      totalClients: this.getTotalConnections(),
    });
  }

  private removeClient(userId: string, ws: WebSocketClient): void {
    const userClients = this.clients.get(userId);
    if (userClients) {
      userClients.delete(ws);
      if (userClients.size === 0) {
        this.clients.delete(userId);
      }
    }

    logger.info('Client disconnected', {
      component: 'WebSocketService',
      userId,
      totalClients: this.getTotalConnections(),
    });
  }

  private getTotalConnections(): number {
    let total = 0;
    this.clients.forEach(clients => {
      total += clients.size;
    });
    return total;
  }

  private handleMessage(userId: string, message: WebSocketMessage): void {
    switch (message.type) {
      case 'PING':
        this.broadcastToUser(userId, { type: 'PONG', data: null });
        break;
      default:
        logger.info('Unhandled message type', {
          component: 'WebSocketService',
          userId,
          messageType: message.type,
        });
    }
  }

  private sendToClient(client: WebSocketClient, message: WebSocketMessage): void {
    if (client.readyState === WebSocket.OPEN) {
      try {
        client.send(JSON.stringify(message));
      } catch (error) {
        logger.error('Failed to send message to client', error as Error, {
          component: 'WebSocketService',
          userId: client.userId,
          messageType: message.type,
        });
      }
    }
  }

  public broadcastToUser(userId: string, message: WebSocketMessage): void {
    const userClients = this.clients.get(userId);
    if (!userClients) return;

    Array.from(userClients).forEach(client => {
      this.sendToClient(client, message);
    });
  }

  public broadcastToAll(message: WebSocketMessage): void {
    this.clients.forEach((userClients, userId) => {
      this.broadcastToUser(userId, message);
    });
  }

  public shutdown(): void {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
    }

    this.clients.forEach(clients => {
      clients.forEach(client => {
        client.close(1000, 'Server shutting down');
      });
    });

    this.wss?.close(() => {
      logger.info('WebSocket server shut down', {
        component: 'WebSocketService',
      });
    });
  }
} 