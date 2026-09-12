/**
 * Read a bundled asset's bytes.
 *
 * Vite inlines assets under `build.assetsInlineLimit` as `data:` URIs so the
 * single-file playable page works, and hosts with a strict content-security
 * policy refuse `fetch()` on `data:` URLs — so decode those here rather than
 * fetching them. This bit cost a debugging session once; do not replace it
 * with a plain fetch.
 */
export async function loadBytes(url) {
  if (url.startsWith('data:')) {
    const comma = url.indexOf(',');
    const meta = url.slice(0, comma);
    const payload = url.slice(comma + 1);
    if (/;base64/i.test(meta)) {
      const bin = atob(payload);
      const out = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
      return out.buffer;
    }
    return new TextEncoder().encode(decodeURIComponent(payload)).buffer;
  }
  const res = await fetch(url);
  if (!res.ok) throw new Error(`asset ${url}: HTTP ${res.status}`);
  return res.arrayBuffer();
}
