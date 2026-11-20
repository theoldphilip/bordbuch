import path from 'node:path';

export type DocKind = 'pdf' | 'image' | 'text';
export type ImageType = 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp';

const IMAGE_BY_EXT: Record<string, ImageType> = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
};
const IMAGE_MIMES = new Set<string>(['image/jpeg', 'image/png', 'image/gif', 'image/webp']);
const TEXT_EXTS = new Set(['.eml', '.txt', '.html', '.htm', '.ics', '.csv']);

/** Which kinds of files the analysis can read. null = stored as a plain document only. */
export function classifyFile(mime: string, filename: string): DocKind | null {
  const m = mime.toLowerCase();
  const ext = path.extname(filename).toLowerCase();
  if (m === 'application/pdf' || ext === '.pdf') return 'pdf';
  if (IMAGE_MIMES.has(m) || ext in IMAGE_BY_EXT) return 'image';
  if (m.startsWith('text/') || m === 'message/rfc822' || TEXT_EXTS.has(ext)) return 'text';
  return null;
}

export function imageMediaType(mime: string, filename: string): ImageType {
  const m = mime.toLowerCase();
  if (IMAGE_MIMES.has(m)) return m as ImageType;
  return IMAGE_BY_EXT[path.extname(filename).toLowerCase()] ?? 'image/jpeg';
}

/** Limits of the API: images 5 MB, whole request 32 MB (base64 adds a third). */
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
export const MAX_PDF_BYTES = 20 * 1024 * 1024;
export const MAX_TEXT_CHARS = 500_000;
