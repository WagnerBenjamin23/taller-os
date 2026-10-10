import { z } from 'zod';
export const healthResponseSchema = z
  .object({
    status: z.literal('ok'),
    service: z.literal('talleros-api'),
    version: z.literal('0.1.0'),
    phase: z.literal(1),
  })
  .strict();
export type HealthResponse = z.infer<typeof healthResponseSchema>;
export const apiErrorSchema = z
  .object({
    error: z
      .object({ code: z.string(), message: z.string(), request_id: z.string().uuid() })
      .strict(),
  })
  .strict();

export const roleSchema = z.enum(['OWNER', 'RECEPTION', 'MECHANIC']);
export type WorkshopRole = z.infer<typeof roleSchema>;
export const workshopInputSchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    phone: z.string().max(30).default(''),
    whatsapp: z.string().max(30).default(''),
    email: z.union([z.email(), z.literal('')]).default(''),
    address: z.string().max(300).default(''),
    tax_id: z.string().max(20).default(''),
  })
  .strict();
export const invitationInputSchema = z
  .object({
    email: z
      .email()
      .max(254)
      .transform((v) => v.trim().toLowerCase()),
    role: roleSchema,
  })
  .strict();
export const acceptInvitationSchema = z
  .object({ token: z.string().regex(/^[a-f0-9]{64}$/) })
  .strict();
export const memberUpdateSchema = z.object({ role: roleSchema, is_active: z.boolean() }).strict();
export const uuidSchema = z.uuid();
export const workshopSummarySchema = z.object({ id: uuidSchema, name: z.string() }).strict();
export const workshopSchema = workshopInputSchema
  .extend({ id: uuidSchema, timezone: z.string() })
  .strict();
export const membershipSchema = z
  .object({
    id: uuidSchema,
    workshop_id: uuidSchema,
    user_id: uuidSchema,
    role: roleSchema,
    is_active: z.boolean(),
  })
  .strict();
export const invitationCreatedSchema = z
  .object({
    id: uuidSchema,
    workshop_id: uuidSchema,
    email: z.string(),
    role: roleSchema,
    expires_at: z.string(),
    token: z.string().regex(/^[a-f0-9]{64}$/),
  })
  .strict();
export const invitationSummarySchema = z
  .object({
    id: uuidSchema,
    email: z.string(),
    role: roleSchema,
    expires_at: z.string(),
    accepted_at: z.string().nullable(),
    revoked_at: z.string().nullable(),
  })
  .strict();
export const invitationAcceptedSchema = z
  .object({ id: uuidSchema, workshop_id: uuidSchema, role: roleSchema })
  .strict();
export const meSchema = z
  .object({ id: uuidSchema, email: z.string(), display_name: z.string() })
  .strict();
export type Workshop = z.infer<typeof workshopSchema>;
export type Membership = z.infer<typeof membershipSchema>;
export const permissions = {
  OWNER: [
    'workshops.read',
    'workshops.update',
    'members.read',
    'members.update',
    'invitations.manage',
  ],
  RECEPTION: ['workshops.read'],
  MECHANIC: ['workshops.read'],
} as const;
export function can(role: WorkshopRole, permission: string): boolean {
  return (permissions[role] as readonly string[]).includes(permission);
}
