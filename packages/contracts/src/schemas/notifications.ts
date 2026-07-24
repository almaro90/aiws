import { z } from "zod";

const baseUrlSchema = z
  .string()
  .url()
  .superRefine((value, context) => {
    const url = new URL(value);
    if (!["http:", "https:"].includes(url.protocol)) {
      context.addIssue({ code: "custom", message: "Must use HTTP or HTTPS." });
    }
    if (url.username || url.password || url.search || url.hash) {
      context.addIssue({
        code: "custom",
        message: "Must not contain credentials, query parameters or a fragment.",
      });
    }
  });

const topicSchema = z.string().regex(/^[-_A-Za-z0-9]{0,64}$/u);

export const updateNotificationSettingsSchema = z
  .strictObject({
    enabled: z.boolean().optional(),
    baseUrl: baseUrlSchema.optional(),
    topic: topicSchema.optional(),
    accessToken: z.string().trim().min(1).max(4096).nullable().optional(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: "At least one field is required.",
    path: ["changes"],
  });
