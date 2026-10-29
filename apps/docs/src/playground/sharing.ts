const MAX_SOURCE = 32_000;
const MAX_FRAGMENT = 12_000;

export async function encodeShare(source: string): Promise<string> {
  if (source.length > MAX_SOURCE) throw new Error('Source is too large to share.');
  const compressed = await new Response(new Blob([source]).stream().pipeThrough(new CompressionStream('gzip'))).arrayBuffer();
  const encoded = btoa(String.fromCharCode(...new Uint8Array(compressed))).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
  const fragment = `v1=${encoded}`;
  if (fragment.length > MAX_FRAGMENT) throw new Error('This example is too large for a share link.');
  return fragment;
}

export async function decodeShare(fragment: string): Promise<string> {
  if (!fragment.startsWith('#v1=')) throw new Error('Unsupported share link version.');
  if (fragment.length > MAX_FRAGMENT + 1) throw new Error('Share link is too large.');
  const encoded = fragment.slice(4);
  if (!/^[A-Za-z0-9_-]+$/.test(encoded)) throw new Error('Invalid share link.');
  const bytes = Uint8Array.from(atob(encoded.replaceAll('-', '+').replaceAll('_', '/')), c => c.charCodeAt(0));
  const reader = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip')).getReader();
  let total = 0;
  const chunks: Uint8Array[] = [];
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      total += value.length;
      if (total > MAX_SOURCE * 4) throw new Error('Decoded share link is too large.');
      chunks.push(value);
    }
  } finally { await reader.cancel(); }
  const source = await new Blob(chunks).text();
  if (source.length > MAX_SOURCE) throw new Error('Decoded source is too large.');
  return source;
}
