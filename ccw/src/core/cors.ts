export function validateCorsOrigin(origin: string, port: number): boolean {
  return origin === `http://localhost:${port}` || origin === `http://127.0.0.1:${port}`;
}

export function getCorsOrigin(origin: string | undefined, port: number): string {
  const fallback = `http://localhost:${port}`;
  if (!origin) return fallback;
  return validateCorsOrigin(origin, port) ? origin : fallback;
}

