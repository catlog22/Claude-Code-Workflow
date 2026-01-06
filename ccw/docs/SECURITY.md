# CCW Dashboard Server Security

This document describes the CCW dashboard server security model, authentication, and recommended deployment practices.

## Summary

- **Authentication**: API endpoints require a JWT token (header or cookie).
- **Default binding**: Server binds to `127.0.0.1` by default to avoid network exposure.
- **CORS**: Only localhost origins are allowed; wildcard CORS is not used.

## Authentication Model

### Token Types

CCW uses **JWT (HS256)** tokens for API authentication:

- **Header-based**: `Authorization: Bearer <token>`
- **Cookie-based**: `auth_token=<token>` (set automatically for local browser access)

### Token Generation & Storage

On server start, CCW generates or reuses:

- **Secret key** (random 256-bit minimum): stored at `~/.ccw/auth/secret.key` (or under `CCW_DATA_DIR`)
- **Current token**: stored at `~/.ccw/auth/token.jwt` (or under `CCW_DATA_DIR`)

Tokens have a **24-hour expiry**. CCW rotates tokens when re-generated near expiry.

> **Note**: On Windows, POSIX-style `0600` permissions are best-effort; CCW still writes files with restrictive modes where supported.

### Retrieving a Token

To retrieve the current token from the local machine:

```bash
curl -s http://127.0.0.1:3456/api/auth/token
```

This endpoint is **localhost-only** (loopback). It also sets a `HttpOnly` cookie for browser clients.

### Using a Token

Example (header-based):

```bash
curl -H "Authorization: Bearer <token>" http://127.0.0.1:3456/api/health
```

Browser clients typically use cookie auth automatically when the dashboard is opened from `http://127.0.0.1:<port>` or `http://localhost:<port>`.

## Network Binding (Localhost by Default)

By default, CCW binds to `127.0.0.1`:

```bash
ccw serve --host 127.0.0.1 --port 3456
```

To bind to all interfaces (advanced / higher risk):

```bash
ccw serve --host 0.0.0.0 --port 3456
```

Binding to non-localhost addresses exposes the dashboard API to the network. Only do this if you understand the risk and have controls in place.

### Recommendations if Using `--host`

- Use a host firewall to restrict inbound access to trusted IPs.
- Prefer VPN access over opening ports publicly.
- Treat the JWT token as a password; never share it.

## CORS Policy

CCW no longer uses `Access-Control-Allow-Origin: *`.

- Allowed origins are restricted to:
  - `http://localhost:<port>`
  - `http://127.0.0.1:<port>`
- `Access-Control-Allow-Credentials: true` is set to support cookie auth.

## Threat Model (What This Protects)

Designed to mitigate:

- Accidental exposure of dashboard APIs on a LAN/Wi‑Fi network.
- Cross-origin attacks from untrusted web pages attempting to call local APIs.

Not designed to protect against:

- A fully compromised local machine/user account.
- Deliberately exposing the server to the internet without additional perimeter security.

## Troubleshooting

### `401 Unauthorized`

- Visit the dashboard page again (cookie is re-issued for localhost access), or
- Call `GET /api/auth/token` and use the returned token in the `Authorization` header.

### Token Expired

- Call `GET /api/auth/token` to refresh/rotate the token.

