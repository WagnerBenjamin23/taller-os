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
