import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ARWEAVE_GATEWAY, IPFS_GATEWAY, imageCandidates, mediaKind, resolveMediaUrl } from '../../src/nft/media.ts';

test('resolveMediaUrl handles protocol and gateway variants', () => {
  assert.equal(resolveMediaUrl('ipfs://QmHash/1.png'), `${IPFS_GATEWAY}QmHash/1.png`);
  assert.equal(resolveMediaUrl('ipfs://ipfs/QmHash/1.png'), `${IPFS_GATEWAY}QmHash/1.png`);
  assert.equal(resolveMediaUrl('ar://abc123'), `${ARWEAVE_GATEWAY}abc123`);
  assert.equal(resolveMediaUrl('https://example.com/a.png'), 'https://example.com/a.png');
  assert.equal(resolveMediaUrl('data:image/svg+xml;base64,PHN2Zz4='), 'data:image/svg+xml;base64,PHN2Zz4=');
  const cid = 'QmYwAPJzv5CZsnA625s3Xf2nemtYgPpHdWEz79ojWnPbdG';
  assert.equal(resolveMediaUrl(cid), IPFS_GATEWAY + cid);
});

test('resolveMediaUrl rejects empty and unsafe values', () => {
  assert.equal(resolveMediaUrl(''), null);
  assert.equal(resolveMediaUrl('   '), null);
  assert.equal(resolveMediaUrl(null), null);
  assert.equal(resolveMediaUrl('javascript:alert(1)'), null);
  assert.equal(resolveMediaUrl('/relative/path.png'), null);
});

test('imageCandidates resolves, de-duplicates and keeps priority order', () => {
  assert.deepEqual(
    imageCandidates('https://cdn/a.png', null, 'ipfs://QmX', 'https://cdn/a.png', undefined),
    ['https://cdn/a.png', `${IPFS_GATEWAY}QmX`],
  );
});

test('mediaKind classifies by MIME, data URI and extension', () => {
  assert.equal(mediaKind('https://x/y', 'video/mp4'), 'video');
  assert.equal(mediaKind('data:image/svg+xml;base64,AAA'), 'image');
  assert.equal(mediaKind('https://x/model.glb?v=1'), 'model');
  assert.equal(mediaKind('https://x/page.html'), 'html');
  assert.equal(mediaKind('https://gateway.irys.xyz/GVUxRmAo'), 'unknown');
});
