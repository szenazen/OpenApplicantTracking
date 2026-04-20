import { Logger, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { OnGatewayConnection, OnGatewayDisconnect, WebSocketGateway, WebSocketServer } from '@nestjs/websockets';
import type { Server, Socket } from 'socket.io';
import { GlobalPrismaService } from '../../infrastructure/prisma/global-prisma.service';

/**
 * Realtime gateway — emits Kanban updates on account-scoped rooms.
 *
 * Room naming: `account:<accountId>:job:<jobId>` — clients join once they
 * open a Kanban board. The API emits to this room on application changes.
 *
 * Auth: the client passes the access token via `auth.token` on socket handshake.
 * Membership in the account is re-validated before joining a room.
 */
@WebSocketGateway({
  path: process.env.SOCKETIO_PATH ?? '/realtime',
  cors: { origin: true, credentials: true },
})
export class RealtimeGateway implements OnGatewayConnection, OnGatewayDisconnect {
  private readonly logger = new Logger(RealtimeGateway.name);
  @WebSocketServer() server!: Server;

  constructor(
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    private readonly db: GlobalPrismaService,
  ) {}

  async handleConnection(client: Socket) {
    try {
      const token =
        (client.handshake.auth?.token as string | undefined) ??
        (client.handshake.headers.authorization as string | undefined)?.replace(/^Bearer\s+/i, '');
      if (!token) throw new UnauthorizedException();
      const payload = await this.jwt.verifyAsync<{ sub: string }>(token, {
        secret: this.config.getOrThrow<string>('auth.jwtSecret'),
      });
      client.data.userId = payload.sub;
      this.logger.debug(`ws connect user=${payload.sub} sid=${client.id}`);
    } catch (err) {
      this.logger.warn(`ws auth failed: ${(err as Error).message}`);
      client.disconnect(true);
    }

    client.on('subscribe', async ({ accountId, jobId }: { accountId: string; jobId: string }) => {
      if (!client.data.userId) return client.disconnect(true);
      const membership = await this.db.membership.findUnique({
        where: { userId_accountId: { userId: client.data.userId, accountId } },
      });
      if (!membership || membership.status !== 'ACTIVE') {
        client.emit('error', { code: 'FORBIDDEN', accountId });
        return;
      }
      const room = RealtimeGateway.room(accountId, jobId);
      void client.join(room);
      client.emit('subscribed', { room });
    });

    client.on('unsubscribe', ({ accountId, jobId }: { accountId: string; jobId: string }) => {
      void client.leave(RealtimeGateway.room(accountId, jobId));
    });
  }

  handleDisconnect(client: Socket) {
    this.logger.debug(`ws disconnect sid=${client.id}`);
  }

  /** Called by ApplicationsService after a create/move. */
  emitApplicationChange(accountId: string, jobId: string, event: unknown): void {
    this.server.to(RealtimeGateway.room(accountId, jobId)).emit('application.change', event);
  }

  static room(accountId: string, jobId: string): string {
    return `account:${accountId}:job:${jobId}`;
  }
}
