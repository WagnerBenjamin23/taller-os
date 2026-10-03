import { describe, expect, it } from 'vitest';
import { healthResponseSchema } from './index';
describe('contrato público de salud', () => {
  it('rechaza campos adicionales y estados falsos', () => {
    const base = { status: 'ok', service: 'talleros-api', version: '0.1.0', phase: 1 };
    expect(healthResponseSchema.safeParse(base).success).toBe(true);
    expect(healthResponseSchema.safeParse({ ...base, secret: 'invalid' }).success).toBe(false);
    expect(healthResponseSchema.safeParse({ ...base, status: 'database-ready' }).success).toBe(
      false,
    );
  });
});
