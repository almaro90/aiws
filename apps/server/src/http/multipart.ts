import { HttpError } from "./errors.ts";

export interface MultipartFile {
  readonly fileName: string;
  readonly declaredMimeType: string;
  readonly content: ReadableStream<Uint8Array>;
}

const encoder = new TextEncoder();
const decoder = new TextDecoder("utf-8", { fatal: true });

export async function parseSingleFileMultipart(request: Request): Promise<MultipartFile> {
  const contentType = request.headers.get("Content-Type") ?? "";
  const boundaryMatch = contentType.match(
    /^multipart\/form-data\s*;\s*boundary=(?:"([^"]+)"|([^;\s]+))\s*$/iu,
  );
  const boundary = boundaryMatch?.[1] ?? boundaryMatch?.[2];
  if (
    boundary === undefined ||
    boundary.length < 1 ||
    boundary.length > 200 ||
    request.body === null
  ) {
    throw badMultipart();
  }

  const reader = request.body.getReader();
  const opening = encoder.encode(`--${boundary}\r\n`);
  const headerEnd = encoder.encode("\r\n\r\n");
  let buffered: Uint8Array<ArrayBufferLike> = new Uint8Array();
  let headerIndex = -1;
  while (headerIndex < 0) {
    const next = await reader.read();
    if (next.done) throw badMultipart();
    buffered = concatenate(buffered, next.value);
    headerIndex = indexOf(buffered, headerEnd);
    if (headerIndex < 0 && buffered.byteLength > 65_536) throw badMultipart();
  }
  if (!startsWith(buffered, opening)) throw badMultipart();

  let headerText: string;
  try {
    headerText = decoder.decode(buffered.subarray(opening.byteLength, headerIndex));
  } catch {
    throw badMultipart();
  }
  const headers = parsePartHeaders(headerText);
  const disposition = headers.get("content-disposition") ?? "";
  const name = disposition.match(/(?:^|;)\s*name="([^"]*)"/iu)?.[1];
  const fileName = disposition.match(/(?:^|;)\s*filename="([^"]*)"/iu)?.[1];
  if (!/^form-data(?:;|$)/iu.test(disposition) || name !== "file" || fileName === undefined) {
    throw badMultipart();
  }

  buffered = buffered.subarray(headerIndex + headerEnd.byteLength);
  const marker = encoder.encode(`\r\n--${boundary}`);
  let ended = false;
  const content = new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        while (!ended) {
          const markerIndex = indexOf(buffered, marker);
          if (markerIndex >= 0) {
            while (buffered.byteLength < markerIndex + marker.byteLength + 2) {
              const next = await reader.read();
              if (next.done) throw badMultipart();
              buffered = concatenate(buffered, next.value);
            }
            if (markerIndex > 0) controller.enqueue(buffered.subarray(0, markerIndex));
            const suffix = buffered.subarray(markerIndex + marker.byteLength);
            if (suffix[0] !== 0x2d || suffix[1] !== 0x2d) {
              throw new HttpError(400, "bad_request", "Exactly one multipart file is required.");
            }
            ended = true;
            controller.close();
            await reader.cancel();
            return;
          }

          const safeLength = buffered.byteLength - marker.byteLength + 1;
          if (safeLength > 0) {
            controller.enqueue(buffered.subarray(0, safeLength));
            buffered = buffered.subarray(safeLength);
            return;
          }
          const next = await reader.read();
          if (next.done) throw badMultipart();
          buffered = concatenate(buffered, next.value);
        }
      } catch (error) {
        ended = true;
        controller.error(error);
        await reader.cancel().catch(() => {});
      }
    },
    async cancel() {
      ended = true;
      await reader.cancel().catch(() => {});
    },
  });

  return {
    fileName,
    declaredMimeType: headers.get("content-type") ?? "application/octet-stream",
    content,
  };
}

function parsePartHeaders(value: string): Map<string, string> {
  const headers = new Map<string, string>();
  for (const line of value.split("\r\n")) {
    const separator = line.indexOf(":");
    if (separator < 1) throw badMultipart();
    const name = line.slice(0, separator).trim().toLowerCase();
    const headerValue = line.slice(separator + 1).trim();
    if (headers.has(name)) throw badMultipart();
    headers.set(name, headerValue);
  }
  return headers;
}

function indexOf(haystack: Uint8Array, needle: Uint8Array): number {
  outer: for (let index = 0; index <= haystack.byteLength - needle.byteLength; index += 1) {
    for (let offset = 0; offset < needle.byteLength; offset += 1) {
      if (haystack[index + offset] !== needle[offset]) continue outer;
    }
    return index;
  }
  return -1;
}

function startsWith(value: Uint8Array, prefix: Uint8Array): boolean {
  return prefix.every((byte, index) => value[index] === byte);
}

function concatenate(left: Uint8Array, right: Uint8Array): Uint8Array {
  const result = new Uint8Array(left.byteLength + right.byteLength);
  result.set(left);
  result.set(right, left.byteLength);
  return result;
}

function badMultipart(): HttpError {
  return new HttpError(400, "bad_request", "Malformed multipart request body.");
}
