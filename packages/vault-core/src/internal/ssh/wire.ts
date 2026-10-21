/** SSH wire encoding (RFC 4251 section 5): uint32, string and mpint. */

export class SSHWireError extends Error {}

export class SSHReader {
    private offset = 0;

    constructor(private readonly data: Uint8Array) {}

    get remaining(): number {
        return this.data.length - this.offset;
    }

    bytes(length: number): Uint8Array {
        if (length < 0 || length > this.remaining) {
            throw new SSHWireError("Unexpected end of SSH data");
        }
        const out = this.data.subarray(this.offset, this.offset + length);
        this.offset += length;
        return out;
    }

    uint32(): number {
        const b = this.bytes(4);
        return ((b[0]! << 24) | (b[1]! << 16) | (b[2]! << 8) | b[3]!) >>> 0;
    }

    string(): Uint8Array {
        return this.bytes(this.uint32());
    }

    text(): string {
        return new TextDecoder().decode(this.string());
    }

    mpint(): bigint {
        return bytesToBigInt(this.string());
    }

    rest(): Uint8Array {
        return this.bytes(this.remaining);
    }
}

export class SSHWriter {
    private chunks: Uint8Array[] = [];
    private length = 0;

    raw(bytes: Uint8Array): this {
        this.chunks.push(bytes);
        this.length += bytes.length;
        return this;
    }

    uint32(value: number): this {
        return this.raw(
            new Uint8Array([
                (value >>> 24) & 0xff,
                (value >>> 16) & 0xff,
                (value >>> 8) & 0xff,
                value & 0xff,
            ]),
        );
    }

    string(value: Uint8Array | string): this {
        const bytes =
            typeof value === "string" ? new TextEncoder().encode(value) : value;
        return this.uint32(bytes.length).raw(bytes);
    }

    mpint(value: bigint): this {
        return this.string(bigIntToMpint(value));
    }

    toBytes(): Uint8Array {
        const out = new Uint8Array(this.length);
        let offset = 0;
        for (const chunk of this.chunks) {
            out.set(chunk, offset);
            offset += chunk.length;
        }
        return out;
    }
}

/** Unsigned big-endian bytes to a bigint. */
export const bytesToBigInt = (bytes: Uint8Array): bigint => {
    let value = 0n;
    for (const byte of bytes) value = (value << 8n) | BigInt(byte);
    return value;
};

/** A non-negative bigint as minimal unsigned big-endian bytes. */
export const bigIntToBytes = (value: bigint, length?: number): Uint8Array => {
    if (value < 0n) throw new SSHWireError("Negative integers are not used");
    const bytes: number[] = [];
    while (value > 0n) {
        bytes.unshift(Number(value & 0xffn));
        value >>= 8n;
    }
    if (length !== undefined) {
        if (bytes.length > length) {
            throw new SSHWireError("Integer is longer than its field");
        }
        while (bytes.length < length) bytes.unshift(0);
    }
    return new Uint8Array(bytes);
};

/** SSH mpint: two's complement, so a set high bit needs a leading zero. */
const bigIntToMpint = (value: bigint): Uint8Array => {
    const bytes = bigIntToBytes(value);
    if (bytes.length > 0 && bytes[0]! & 0x80) {
        const padded = new Uint8Array(bytes.length + 1);
        padded.set(bytes, 1);
        return padded;
    }
    return bytes;
};

export const bitLength = (value: bigint): number => value.toString(2).length;

export const concatBytes = (...parts: Uint8Array[]): Uint8Array => {
    const out = new Uint8Array(parts.reduce((sum, p) => sum + p.length, 0));
    let offset = 0;
    for (const part of parts) {
        out.set(part, offset);
        offset += part.length;
    }
    return out;
};

export const bytesEqual = (a: Uint8Array, b: Uint8Array): boolean =>
    a.length === b.length && a.every((byte, index) => byte === b[index]);
