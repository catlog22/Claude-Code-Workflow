import type { IncomingMessage, ServerResponse } from 'http';

export type PostRequestHandler = (body: unknown) => Promise<unknown>;

export interface RouteContext {
  /** URL pathname (e.g. `/api/status`). */
  pathname: string;
  /** Parsed request URL. */
  url: URL;
  /** Incoming HTTP request. */
  req: IncomingMessage;
  /** HTTP response to write to. */
  res: ServerResponse;
  /** Initial path configured for the server (used for dashboard routes). */
  initialPath: string;
  /** Helper that parses JSON body and passes it to `handler`. */
  handlePostRequest: (
    req: IncomingMessage,
    res: ServerResponse,
    handler: PostRequestHandler
  ) => void;
  /** Broadcast payload to connected dashboard clients. */
  broadcastToClients: (data: unknown) => void;
}

