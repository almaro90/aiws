import { z } from "zod";

export const attachmentIdSchema = z
  .string()
  .regex(/^att_[0-9A-HJKMNP-TV-Z]{26}$/, "Invalid Attachment ID.");
