import type { FetchedFile } from "@/lib/types";

/** Apply an adapter's UTF-8 byte cap without splitting a character; retain the original byte size. */
export function boundedFetchedFile(path: string, content: string, maxBytes: number): FetchedFile {
  const encoded = Buffer.from(content, "utf8");
  let end = Math.min(encoded.length, maxBytes);
  // A continuation byte at the cut means its character started before the cut.
  while (end > 0 && end < encoded.length && (encoded[end]! & 0xc0) === 0x80) end--;
  return {
    path,
    content: end === encoded.length ? content : encoded.subarray(0, end).toString("utf8"),
    bytes: encoded.length,
  };
}
