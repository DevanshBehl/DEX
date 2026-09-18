import type { NFTMediaKind } from './types.ts';

// ---- Media URL resolution (nft.md — Phase 1.4) -----------------------------------

/** Public IPFS gateway used when an indexer hasn't already cached the asset. */
export const IPFS_GATEWAY = 'https://dweb.link/ipfs/';
export const ARWEAVE_GATEWAY = 'https://arweave.net/';

/**
 * Turns protocol URLs into fetchable HTTP(S) URLs.
 * Returns null for empty or unsupported values (e.g. `javascript:`).
 */
export function resolveMediaUrl(raw: string | null | undefined): string | null {
  if (!raw || typeof raw !== 'string') return null;
  const url = raw.trim();
  if (!url) return null;

  if (url.startsWith('data:')) return url;

  if (url.startsWith('ipfs://')) {
    // Handles both ipfs://<cid>/path and the non-standard ipfs://ipfs/<cid>/path
    return IPFS_GATEWAY + url.slice('ipfs://'.length).replace(/^ipfs\//, '');
  }
  if (url.startsWith('ar://')) {
    return ARWEAVE_GATEWAY + url.slice('ar://'.length);
  }
  // Bare CIDv0 / CIDv1 values occasionally appear in metadata
  if (/^(Qm[1-9A-HJ-NP-Za-km-z]{44}|bafy[a-z2-7]{50,})(\/.*)?$/.test(url)) {
    return IPFS_GATEWAY + url;
  }
  if (/^https?:\/\//i.test(url)) return url;

  return null;
}

/** De-duplicates and resolves a list of candidate image URLs, preserving priority order. */
export function imageCandidates(...urls: (string | null | undefined)[]): string[] {
  const out: string[] = [];
  for (const u of urls) {
    const resolved = resolveMediaUrl(u);
    if (resolved && !out.includes(resolved)) out.push(resolved);
  }
  return out;
}

const EXT_KIND: Record<string, NFTMediaKind> = {
  png: 'image', jpg: 'image', jpeg: 'image', gif: 'image', webp: 'image', svg: 'image', avif: 'image',
  mp4: 'video', webm: 'video', mov: 'video', m4v: 'video',
  mp3: 'audio', wav: 'audio', ogg: 'audio', flac: 'audio',
  glb: 'model', gltf: 'model',
  html: 'html', htm: 'html',
};

/** Best-effort media classification from MIME type, data URI prefix, or file extension. */
export function mediaKind(url: string | null | undefined, contentType?: string | null): NFTMediaKind {
  const mime = (contentType || '').toLowerCase();
  const fromMime = (m: string): NFTMediaKind | null => {
    if (m.startsWith('image/')) return 'image';
    if (m.startsWith('video/')) return 'video';
    if (m.startsWith('audio/')) return 'audio';
    if (m.startsWith('model/')) return 'model';
    if (m === 'text/html') return 'html';
    return null;
  };

  const byMime = fromMime(mime);
  if (byMime) return byMime;
  if (!url) return 'unknown';

  if (url.startsWith('data:')) {
    return fromMime(url.slice(5, url.indexOf(';') > 0 ? url.indexOf(';') : undefined)) || 'unknown';
  }

  const path = url.split(/[?#]/)[0];
  const ext = path.includes('.') ? path.slice(path.lastIndexOf('.') + 1).toLowerCase() : '';
  return EXT_KIND[ext] || 'unknown';
}
