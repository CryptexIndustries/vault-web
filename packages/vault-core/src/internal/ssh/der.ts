/** The small subset of DER needed to read PKCS#1, SEC1 and PKCS#8 keys. */

export class DERError extends Error {}

export const DERTag = {
    Integer: 0x02,
    BitString: 0x03,
    OctetString: 0x04,
    Null: 0x05,
    ObjectIdentifier: 0x06,
    Sequence: 0x30,
} as const;

export type DERNode = {
    tag: number;
    content: Uint8Array;
};

export const readDER = (
    data: Uint8Array,
    offset = 0,
): { node: DERNode; next: number } => {
    const tag = data[offset];
    let lengthByte = data[offset + 1];
    if (tag === undefined || lengthByte === undefined) {
        throw new DERError("Unexpected end of DER data");
    }
    let cursor = offset + 2;
    let length = lengthByte;
    if (lengthByte & 0x80) {
        const count = lengthByte & 0x7f;
        if (count === 0 || count > 4) throw new DERError("Bad DER length");
        length = 0;
        for (let i = 0; i < count; i++) {
            lengthByte = data[cursor++];
            if (lengthByte === undefined) {
                throw new DERError("Unexpected end of DER data");
            }
            length = length * 256 + lengthByte;
        }
    }
    if (cursor + length > data.length) {
        throw new DERError("Unexpected end of DER data");
    }
    return {
        node: { tag, content: data.subarray(cursor, cursor + length) },
        next: cursor + length,
    };
};

/** Reads one complete DER value and rejects trailing bytes. */
export const parseDER = (data: Uint8Array): DERNode => {
    const { node, next } = readDER(data);
    if (next !== data.length) throw new DERError("Trailing DER data");
    return node;
};

export const children = (node: DERNode): DERNode[] => {
    const out: DERNode[] = [];
    let offset = 0;
    while (offset < node.content.length) {
        const { node: child, next } = readDER(node.content, offset);
        out.push(child);
        offset = next;
    }
    return out;
};

export const expectTag = (node: DERNode | undefined, tag: number): DERNode => {
    if (!node || node.tag !== tag) throw new DERError("Unexpected DER value");
    return node;
};

export const sequence = (node: DERNode | undefined): DERNode[] =>
    children(expectTag(node, DERTag.Sequence));

export const integer = (node: DERNode | undefined): bigint => {
    const content = expectTag(node, DERTag.Integer).content;
    if (content.length === 0 || content[0]! & 0x80) {
        throw new DERError("Expected a non-negative DER integer");
    }
    let value = 0n;
    for (const byte of content) value = (value << 8n) | BigInt(byte);
    return value;
};

export const octetString = (node: DERNode | undefined): Uint8Array =>
    expectTag(node, DERTag.OctetString).content;

export const bitString = (node: DERNode | undefined): Uint8Array => {
    const content = expectTag(node, DERTag.BitString).content;
    if (content[0] !== 0) throw new DERError("Unsupported DER bit string");
    return content.subarray(1);
};

export const objectIdentifier = (node: DERNode | undefined): string => {
    const content = expectTag(node, DERTag.ObjectIdentifier).content;
    if (content.length === 0) throw new DERError("Empty object identifier");
    const first = content[0]!;
    const parts = [Math.min(2, Math.floor(first / 40)), 0];
    parts[1] = first - parts[0]! * 40;
    let value = 0;
    for (let i = 1; i < content.length; i++) {
        value = value * 128 + (content[i]! & 0x7f);
        if (!(content[i]! & 0x80)) {
            parts.push(value);
            value = 0;
        }
    }
    return parts.join(".");
};

/** Context-specific constructed tag [n], as used for optional fields. */
export const contextTag = (n: number): number => 0xa0 | n;
