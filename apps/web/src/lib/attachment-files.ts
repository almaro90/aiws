export const allowedAttachmentExtensions = new Set([
  "png",
  "jpg",
  "jpeg",
  "webp",
  "gif",
  "pdf",
  "txt",
  "log",
  "md",
  "markdown",
  "json",
  "jsonl",
  "csv",
  "tsv",
  "xml",
  "yaml",
  "yml",
]);

export const attachmentAccept = Array.from(allowedAttachmentExtensions)
  .map((extension) => `.${extension}`)
  .join(",");

export function validateAttachmentFiles(files: readonly File[], existingCount = 0): string | null {
  if (existingCount + files.length > 10) {
    return `Solo pueden añadirse 10 attachments por Task; quedan ${Math.max(0, 10 - existingCount)}.`;
  }
  for (const file of files) {
    if (file.size === 0) return `${file.name}: el fichero está vacío.`;
    if (file.size > 26_214_400) return `${file.name}: supera 25 MiB.`;
    const extension = file.name.split(".").at(-1)?.toLowerCase() ?? "";
    if (!allowedAttachmentExtensions.has(extension)) {
      return `${file.name}: extensión no permitida.`;
    }
  }
  return null;
}

export function formatFileSize(value: number): string {
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KiB`;
  return `${(value / (1024 * 1024)).toFixed(1)} MiB`;
}
