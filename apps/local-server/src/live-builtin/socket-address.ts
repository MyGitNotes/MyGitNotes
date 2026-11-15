import type { IncomingMessage } from 'node:http';

export function socketAddress(request: IncomingMessage): string {
  return request.socket.remoteAddress ?? 'unknown';
}
