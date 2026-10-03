// 重复上传检测：对最终产物求 SHA-1，与上一次上传比对（非安全用途，只是内容指纹）。
// crypto.subtle 在非安全上下文（如 http://局域网 IP 访问）不可用，此时退回纯 TS 实现。

export async function sha1Hex(blob: Blob): Promise<string> {
  const data = new Uint8Array(await blob.arrayBuffer());
  const subtle = globalThis.crypto?.subtle;
  if (subtle) {
    return toHex(new Uint8Array(await subtle.digest("SHA-1", data)));
  }
  return toHex(sha1(data));
}

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

// FIPS 180-1 SHA-1。
function sha1(data: Uint8Array): Uint8Array {
  let h0 = 0x67452301;
  let h1 = 0xefcdab89;
  let h2 = 0x98badcfe;
  let h3 = 0x10325476;
  let h4 = 0xc3d2e1f0;

  const msg = new Uint8Array(Math.ceil((data.length + 9) / 64) * 64);
  msg.set(data);
  msg[data.length] = 0x80;
  const view = new DataView(msg.buffer);
  const bitLen = data.length * 8;
  view.setUint32(msg.length - 8, Math.floor(bitLen / 0x100000000));
  view.setUint32(msg.length - 4, bitLen >>> 0);

  const w = new Int32Array(80);
  for (let offset = 0; offset < msg.length; offset += 64) {
    for (let i = 0; i < 16; i++) w[i] = view.getUint32(offset + i * 4);
    for (let i = 16; i < 80; i++) {
      const v = w[i - 3] ^ w[i - 8] ^ w[i - 14] ^ w[i - 16];
      w[i] = (v << 1) | (v >>> 31);
    }
    let a = h0;
    let b = h1;
    let c = h2;
    let d = h3;
    let e = h4;
    for (let i = 0; i < 80; i++) {
      let f: number;
      let k: number;
      if (i < 20) {
        f = (b & c) | (~b & d);
        k = 0x5a827999;
      } else if (i < 40) {
        f = b ^ c ^ d;
        k = 0x6ed9eba1;
      } else if (i < 60) {
        f = (b & c) | (b & d) | (c & d);
        k = 0x8f1bbcdc;
      } else {
        f = b ^ c ^ d;
        k = 0xca62c1d6;
      }
      const next = (((a << 5) | (a >>> 27)) + f + k + e + w[i]) | 0;
      e = d;
      d = c;
      c = (b << 30) | (b >>> 2);
      b = a;
      a = next;
    }
    h0 = (h0 + a) | 0;
    h1 = (h1 + b) | 0;
    h2 = (h2 + c) | 0;
    h3 = (h3 + d) | 0;
    h4 = (h4 + e) | 0;
  }

  const out = new Uint8Array(20);
  const outView = new DataView(out.buffer);
  outView.setUint32(0, h0 >>> 0);
  outView.setUint32(4, h1 >>> 0);
  outView.setUint32(8, h2 >>> 0);
  outView.setUint32(12, h3 >>> 0);
  outView.setUint32(16, h4 >>> 0);
  return out;
}
