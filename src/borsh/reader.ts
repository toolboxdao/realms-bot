/**
 * Minimal, dependency-free borsh reader for the spl-governance account layouts
 * that ToolboxDAO uses (RealmV2 / GovernanceV2 / ProposalV2). Runs in the
 * Cloudflare Workers runtime (largely stdlib: DataView + TextDecoder).
 */
const textDecoder = new TextDecoder();

export class BorshReader {
  private readonly buf: Uint8Array;
  private readonly view: DataView;
  offset = 0;

  constructor(buf: Uint8Array) {
    this.buf = buf;
    this.view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  }

  get remaining(): number {
    return this.buf.byteLength - this.offset;
  }

  u8(): number {
    const v = this.view.getUint8(this.offset);
    this.offset += 1;
    return v;
  }

  u16(): number {
    const v = this.view.getUint16(this.offset, true);
    this.offset += 2;
    return v;
  }

  u32(): number {
    const v = this.view.getUint32(this.offset, true);
    this.offset += 4;
    return v;
  }

  u64(): bigint {
    const v = this.view.getBigUint64(this.offset, true);
    this.offset += 8;
    return v;
  }

  bytes(n: number): Uint8Array {
    const v = this.buf.subarray(this.offset, this.offset + n);
    this.offset += n;
    return v;
  }

  /** 32-byte pubkey. */
  pubkey(): Uint8Array {
    return this.bytes(32);
  }

  /** borsh `string`: u32 length + utf8 bytes. */
  string(): string {
    const len = this.u32();
    const bytes = this.bytes(len);
    return textDecoder.decode(bytes);
  }

  /**
   * borsh `Option<T>`: a 1-byte tag (0 = None, 1 = Some) followed by T when
   * present. `read` is called only in the Some branch.
   */
  option<T>(read: () => T): T | null {
    const tag = this.u8();
    if (tag === 0) return null;
    if (tag === 1) return read();
    throw new Error(`Invalid borsh Option tag: ${tag}`);
  }

  u64Option(): bigint | null {
    return this.option(() => this.u64());
  }

  u32Option(): number | null {
    return this.option(() => this.u32());
  }

  pubkeyOption(): Uint8Array | null {
    return this.option(() => this.pubkey());
  }

  /** borsh `Vec<T>`: u32 count then `count` elements. */
  vec<T>(read: () => T): T[] {
    const n = this.u32();
    const out: T[] = [];
    for (let i = 0; i < n; i++) out.push(read());
    return out;
  }
}

export function b64decode(b64: string): Uint8Array {
  // Workaround for environments without `atob` of binary-safe semantics:
  // this is a workers-compatible chunked decode.
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
