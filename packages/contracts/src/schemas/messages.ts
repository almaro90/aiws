import { z } from "zod";

export const messageTextSchema = z.string().max(100_000).nullable().optional();
export const listTimelineSchema = z.strictObject({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  cursor: z.string().min(1).optional(),
});
