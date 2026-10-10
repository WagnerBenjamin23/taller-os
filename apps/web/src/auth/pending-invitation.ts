// Local browser continuation only. Never send this record to Auth, URLs or logs.
// PostgreSQL remains authoritative for recipient, expiration and permissions.
const storageKey = 'talleros.pending-invitation.v1';
const ttl = 7 * 24 * 60 * 60 * 1000;
export interface PendingInvitation {
  token: string;
  key: string;
  expiresAt: number;
  email?: string;
}
function storage(): Storage {
  return window.localStorage;
}
export function clearPendingInvitation(): void {
  try {
    storage().removeItem(storageKey);
  } catch {
    /* Unavailable browser storage. */
  }
}
export function readPendingInvitation(): PendingInvitation | null {
  try {
    const raw = storage().getItem(storageKey);
    if (!raw) return null;
    const value: unknown = JSON.parse(raw);
    if (typeof value !== 'object' || value === null) throw new Error();
    const v = value as Partial<PendingInvitation>;
    if (
      typeof v.token !== 'string' ||
      !/^[a-f0-9]{64}$/.test(v.token) ||
      typeof v.key !== 'string' ||
      !/^[a-f0-9-]{36}$/.test(v.key) ||
      typeof v.expiresAt !== 'number' ||
      v.expiresAt <= Date.now() ||
      v.expiresAt > Date.now() + ttl ||
      (v.email !== undefined && (typeof v.email !== 'string' || v.email.length > 254))
    )
      throw new Error();
    return v as PendingInvitation;
  } catch {
    clearPendingInvitation();
    return null;
  }
}
export function capturePendingInvitation(): PendingInvitation | null {
  const token = new URLSearchParams(window.location.hash.slice(1)).get('invite');
  if (token === null) return readPendingInvitation();
  // Fragments are not transmitted to the server. Remove before SDK/callback navigation.
  window.history.replaceState({}, '', window.location.pathname + window.location.search);
  if (!/^[a-f0-9]{64}$/.test(token)) return readPendingInvitation();
  const existing = readPendingInvitation();
  const value =
    existing?.token === token
      ? existing
      : {
          token,
          key: crypto.randomUUID(),
          expiresAt: Date.now() + ttl,
        };
  storage().setItem(storageKey, JSON.stringify(value));
  return value;
}
export function bindPendingInvitation(email: string): void {
  const value = readPendingInvitation();
  if (value)
    storage().setItem(storageKey, JSON.stringify({ ...value, email: email.trim().toLowerCase() }));
}
