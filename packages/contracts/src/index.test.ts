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

import {
  can,
  roleSchema,
  memberUpdateSchema,
  workshopInputSchema,
  acceptInvitationSchema,
} from './index';
describe('permisos y límites de identidad', () => {
  it('centraliza permisos del rol', () => {
    expect(can('OWNER', 'members.update')).toBe(true);
    expect(can('RECEPTION', 'members.update')).toBe(false);
    expect(can('MECHANIC', 'members.update')).toBe(false);
    expect(roleSchema.safeParse('ADMIN').success).toBe(false);
  });
  it('no permite enviar workshop_id al modificar miembros', () => {
    expect(
      memberUpdateSchema.safeParse({ role: 'OWNER', is_active: true, workshop_id: 'other' })
        .success,
    ).toBe(false);
    expect(workshopInputSchema.safeParse({ name: 'Taller', user_id: 'forged' }).success).toBe(
      false,
    );
  });
  it('token de invitación debe ser de 256 bits codificado hex', () => {
    expect(acceptInvitationSchema.safeParse({ token: 'a'.repeat(64) }).success).toBe(true);
    expect(acceptInvitationSchema.safeParse({ token: 'short' }).success).toBe(false);
  });
});
