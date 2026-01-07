import { createHash } from 'crypto';
import type { IncomingMessage } from 'http';
import type { Duplex } from 'stream';

// WebSocket clients for real-time notifications
export const wsClients = new Set<Duplex>();

export function handleWebSocketUpgrade(req: IncomingMessage, socket: Duplex, _head: Buffer): void {
  const header = req.headers['sec-websocket-key'];
  const key = Array.isArray(header) ? header[0] : header;
  if (!key) {
    socket.end();
    return;
  }
  const acceptKey = createHash('sha1')
    .update(key + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11')
    .digest('base64');

  const responseHeaders = [
    'HTTP/1.1 101 Switching Protocols',
    'Upgrade: websocket',
    'Connection: Upgrade',
    `Sec-WebSocket-Accept: ${acceptKey}`,
    '',
    ''
  ].join('\r\n');

  socket.write(responseHeaders);

  // Add to clients set
  wsClients.add(socket);
  console.log(`[WS] Client connected (${wsClients.size} total)`);

  // Handle incoming messages
  socket.on('data', (buffer: Buffer) => {
    try {
      const frame = parseWebSocketFrame(buffer);
      if (!frame) return;

      const { opcode, payload } = frame;

      switch (opcode) {
        case 0x1: // Text frame
          if (payload) {
            console.log('[WS] Received:', payload);
          }
          break;
        case 0x8: // Close frame
          socket.end();
          break;
        case 0x9: // Ping frame - respond with Pong
          const pongFrame = Buffer.alloc(2);
          pongFrame[0] = 0x8A; // Pong opcode with FIN bit
          pongFrame[1] = 0x00; // No payload
          socket.write(pongFrame);
          break;
        case 0xA: // Pong frame - ignore
          break;
        default:
          // Ignore other frame types (binary, continuation)
          break;
      }
    } catch (e) {
      // Ignore parse errors
    }
  });

  // Handle disconnect
  socket.on('close', () => {
    wsClients.delete(socket);
    console.log(`[WS] Client disconnected (${wsClients.size} remaining)`);
  });

  socket.on('error', () => {
    wsClients.delete(socket);
  });
}

/**
 * Parse WebSocket frame (simplified)
 * Returns { opcode, payload } or null
 */
export function parseWebSocketFrame(buffer: Buffer): { opcode: number; payload: string } | null {
  if (buffer.length < 2) return null;

  const firstByte = buffer[0];
  const opcode = firstByte & 0x0f; // Extract opcode (bits 0-3)

  // Opcode types:
  // 0x0 = continuation, 0x1 = text, 0x2 = binary
  // 0x8 = close, 0x9 = ping, 0xA = pong

  const secondByte = buffer[1];
  const isMasked = (secondByte & 0x80) !== 0;
  let payloadLength = secondByte & 0x7f;

  let offset = 2;
  if (payloadLength === 126) {
    payloadLength = buffer.readUInt16BE(2);
    offset = 4;
  } else if (payloadLength === 127) {
    payloadLength = Number(buffer.readBigUInt64BE(2));
    offset = 10;
  }

  let mask: Buffer | null = null;
  if (isMasked) {
    mask = buffer.slice(offset, offset + 4);
    offset += 4;
  }

  const payload = buffer.slice(offset, offset + payloadLength);

  if (isMasked && mask) {
    for (let i = 0; i < payload.length; i++) {
      payload[i] ^= mask[i % 4];
    }
  }

  return { opcode, payload: payload.toString('utf8') };
}

/**
 * Create WebSocket frame
 */
export function createWebSocketFrame(data: unknown): Buffer {
  const payload = Buffer.from(JSON.stringify(data), 'utf8');
  const length = payload.length;

  let frame;
  if (length <= 125) {
    frame = Buffer.alloc(2 + length);
    frame[0] = 0x81; // Text frame, FIN
    frame[1] = length;
    payload.copy(frame, 2);
  } else if (length <= 65535) {
    frame = Buffer.alloc(4 + length);
    frame[0] = 0x81;
    frame[1] = 126;
    frame.writeUInt16BE(length, 2);
    payload.copy(frame, 4);
  } else {
    frame = Buffer.alloc(10 + length);
    frame[0] = 0x81;
    frame[1] = 127;
    frame.writeBigUInt64BE(BigInt(length), 2);
    payload.copy(frame, 10);
  }

  return frame;
}

/**
 * Broadcast message to all connected WebSocket clients
 */
export function broadcastToClients(data: unknown): void {
  const frame = createWebSocketFrame(data);

  for (const client of wsClients) {
    try {
      client.write(frame);
    } catch (e) {
      wsClients.delete(client);
    }
  }

  const eventType =
    typeof data === 'object' && data !== null && 'type' in data ? (data as { type?: unknown }).type : undefined;
  console.log(`[WS] Broadcast to ${wsClients.size} clients:`, eventType);
}

/**
 * Extract session ID from file path
 */
export function extractSessionIdFromPath(filePath: string): string | null {
  // Normalize path
  const normalized = filePath.replace(/\\/g, '/');

  // Look for session pattern: WFS-xxx, WRS-xxx, etc.
  const sessionMatch = normalized.match(/\/(W[A-Z]S-[^/]+)\//);
  if (sessionMatch) {
    return sessionMatch[1];
  }

  // Look for .workflow/.sessions/xxx pattern
  const sessionsMatch = normalized.match(/\.workflow\/\.sessions\/([^/]+)/);
  if (sessionsMatch) {
    return sessionsMatch[1];
  }

  // Look for lite-plan/lite-fix pattern
  const liteMatch = normalized.match(/\.(lite-plan|lite-fix)\/([^/]+)/);
  if (liteMatch) {
    return liteMatch[2];
  }

  return null;
}
