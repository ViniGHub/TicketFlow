import { z } from 'zod';

export const healthLiveResponseSchema = z.object({
  status: z.literal('ok'),
});

export type HealthLiveResponse = z.infer<typeof healthLiveResponseSchema>;
