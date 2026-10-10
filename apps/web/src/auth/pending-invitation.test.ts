import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  capturePendingInvitation,
  readPendingInvitation,
  bindPendingInvitation,
  clearPendingInvitation,
} from './pending-invitation';
beforeEach(() => {
  localStorage.clear();
  window.history.replaceState({}, '', '/');
  vi.useRealTimers();
});
describe('continuación privada de invitación', () => {
  it('persiste entre registro, nueva pestaña del mismo origen y callback sin token en URL', () => {
    window.history.replaceState({}, '', '/#invite=' + 'a'.repeat(64));
    const first = capturePendingInvitation();
    expect(first?.token).toBe('a'.repeat(64));
    expect(window.location.hash).toBe('');
    bindPendingInvitation('USER@example.test');
    window.history.replaceState({}, '', '/auth/callback?code=pkce-code');
    expect(capturePendingInvitation()).toEqual({ ...first, email: 'user@example.test' });
    expect(window.location.search).not.toContain('a'.repeat(64));
    clearPendingInvitation();
    expect(readPendingInvitation()).toBeNull();
  });
  it('expira y elimina el registro local', () => {
    window.history.replaceState({}, '', '/#invite=' + 'b'.repeat(64));
    capturePendingInvitation();
    vi.useFakeTimers();
    vi.setSystemTime(Date.now() + 8 * 86400000);
    expect(readPendingInvitation()).toBeNull();
    expect(localStorage.length).toBe(0);
    vi.useRealTimers();
  });
  it('no guarda fragmentos inválidos ni renueva una key al recargar el mismo enlace', () => {
    window.history.replaceState({}, '', '/#invite=invalid');
    expect(capturePendingInvitation()).toBeNull();
    window.history.replaceState({}, '', '/#invite=' + 'c'.repeat(64));
    const first = capturePendingInvitation();
    window.history.replaceState({}, '', '/#invite=' + 'c'.repeat(64));
    expect(capturePendingInvitation()).toEqual(first);
  });
});
