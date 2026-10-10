export function authOrigin(value: string | undefined): string {
  if (!value) return '';
  const url = new URL(value);
  const local = ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname);
  if (
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname !== '/' ||
    (url.protocol !== 'https:' && !(url.protocol === 'http:' && local))
  )
    throw new Error('VITE_SUPABASE_URL debe ser un origen HTTPS o loopback local.');
  return url.origin;
}
export function securityHeaders(template: string, value: string | undefined): string {
  const origin = authOrigin(value);
  return template.replace(
    "connect-src 'self';",
    `connect-src 'self'${origin ? ` ${origin}` : ''};`,
  );
}
