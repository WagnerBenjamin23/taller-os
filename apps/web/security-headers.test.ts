import { describe, expect, it } from 'vitest';
import { securityHeaders } from './security-headers';
const template = "connect-src 'self'; script-src 'self';";
describe('CSP para Auth', () => {
  it('habilita únicamente el origen configurado, sin wildcard', () => {
    expect(securityHeaders(template, 'https://project.supabase.co')).toBe(
      "connect-src 'self' https://project.supabase.co; script-src 'self';",
    );
    expect(securityHeaders(template, undefined)).toBe(template);
    expect(securityHeaders(template, 'http://127.0.0.1:54321')).toContain('127.0.0.1:54321');
  });
  it.each([
    'http://remote.test',
    'https://u:p@remote.test',
    'https://remote.test/path',
    'https://remote.test/?x=1',
    'https://remote.test/#*',
  ])('rechaza orígenes inseguros o ambiguos: %s', (url) => {
    expect(() => securityHeaders(template, url)).toThrow();
  });
});
