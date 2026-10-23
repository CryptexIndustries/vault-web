/**
 * bcrypt_pbkdf as used by OpenSSH to derive the key that encrypts
 * `openssh-key-v1` private keys. Port of OpenBSD's bcrypt_pbkdf.c and the
 * Blowfish routines it relies on.
 */
import { sha512 } from "@noble/hashes/sha2.js";

import { BLOWFISH_P, BLOWFISH_S } from "./blowfish-tables";

const BCRYPT_WORDS = 8;
const BCRYPT_HASHSIZE = BCRYPT_WORDS * 4;
const MAGIC = new TextEncoder().encode("OxychromaticBlowfishSwatDynamite");

type BlowfishState = { p: Uint32Array; s: Uint32Array };

const initState = (): BlowfishState => ({
    p: BLOWFISH_P.slice(),
    s: BLOWFISH_S.slice(),
});

const f = (s: Uint32Array, x: number): number =>
    ((((s[x >>> 24]! + s[0x100 + ((x >>> 16) & 0xff)]!) >>> 0) ^
        s[0x200 + ((x >>> 8) & 0xff)]!) +
        s[0x300 + (x & 0xff)]!) >>>
    0;

/** Encrypts one block in place: `block[offset]` is the left half. */
const encipher = (
    state: BlowfishState,
    block: Uint32Array,
    offset: number,
): void => {
    const { p, s } = state;
    let xl = block[offset]!;
    let xr = block[offset + 1]!;
    xl = (xl ^ p[0]!) >>> 0;
    for (let i = 1; i <= 16; i += 2) {
        xr = (xr ^ f(s, xl) ^ p[i]!) >>> 0;
        xl = (xl ^ f(s, xr) ^ p[i + 1]!) >>> 0;
    }
    block[offset] = (xr ^ p[17]!) >>> 0;
    block[offset + 1] = xl;
};

/** Reads a big-endian word from `data`, wrapping around at its end. */
const streamToWord = (data: Uint8Array, cursor: { j: number }): number => {
    let word = 0;
    for (let i = 0; i < 4; i++) {
        if (cursor.j >= data.length) cursor.j = 0;
        word = ((word << 8) | data[cursor.j]!) >>> 0;
        cursor.j++;
    }
    return word;
};

const expandState = (
    state: BlowfishState,
    data: Uint8Array | null,
    key: Uint8Array,
): void => {
    const keyCursor = { j: 0 };
    for (let i = 0; i < 18; i++) {
        state.p[i] = (state.p[i]! ^ streamToWord(key, keyCursor)) >>> 0;
    }
    const dataCursor = { j: 0 };
    const block = new Uint32Array(2);
    const next = (target: Uint32Array, index: number) => {
        if (data) {
            block[0] = (block[0]! ^ streamToWord(data, dataCursor)) >>> 0;
            block[1] = (block[1]! ^ streamToWord(data, dataCursor)) >>> 0;
        }
        encipher(state, block, 0);
        target[index] = block[0]!;
        target[index + 1] = block[1]!;
    };
    for (let i = 0; i < 18; i += 2) next(state.p, i);
    for (let i = 0; i < 1024; i += 2) next(state.s, i);
};

const bcryptHash = (sha2pass: Uint8Array, sha2salt: Uint8Array): Uint8Array => {
    const state = initState();
    expandState(state, sha2salt, sha2pass);
    for (let i = 0; i < 64; i++) {
        expandState(state, null, sha2salt);
        expandState(state, null, sha2pass);
    }
    const cdata = new Uint32Array(BCRYPT_WORDS);
    const cursor = { j: 0 };
    for (let i = 0; i < BCRYPT_WORDS; i++) {
        cdata[i] = streamToWord(MAGIC, cursor);
    }
    for (let i = 0; i < 64; i++) {
        for (let block = 0; block < BCRYPT_WORDS; block += 2) {
            encipher(state, cdata, block);
        }
    }
    const out = new Uint8Array(BCRYPT_HASHSIZE);
    for (let i = 0; i < BCRYPT_WORDS; i++) {
        const word = cdata[i]!;
        out[4 * i] = word & 0xff;
        out[4 * i + 1] = (word >>> 8) & 0xff;
        out[4 * i + 2] = (word >>> 16) & 0xff;
        out[4 * i + 3] = (word >>> 24) & 0xff;
    }
    return out;
};

export const bcryptPbkdf = (
    password: Uint8Array,
    salt: Uint8Array,
    keyLength: number,
    rounds: number,
): Uint8Array => {
    if (rounds < 1 || keyLength < 1 || keyLength > BCRYPT_HASHSIZE ** 2) {
        throw new Error("Invalid bcrypt_pbkdf parameters");
    }
    const stride = Math.ceil(keyLength / BCRYPT_HASHSIZE);
    const amount = Math.ceil(keyLength / stride);
    const key = new Uint8Array(keyLength);
    const sha2pass = sha512(password);
    const countSalt = new Uint8Array(salt.length + 4);
    countSalt.set(salt);

    let remaining = keyLength;
    for (let count = 1; remaining > 0; count++) {
        countSalt[salt.length] = (count >>> 24) & 0xff;
        countSalt[salt.length + 1] = (count >>> 16) & 0xff;
        countSalt[salt.length + 2] = (count >>> 8) & 0xff;
        countSalt[salt.length + 3] = count & 0xff;

        let tmp = bcryptHash(sha2pass, sha512(countSalt));
        const out = tmp.slice();
        for (let round = 1; round < rounds; round++) {
            tmp = bcryptHash(sha2pass, sha512(tmp));
            for (let j = 0; j < out.length; j++) out[j] = out[j]! ^ tmp[j]!;
        }

        let written = 0;
        for (; written < Math.min(amount, remaining); written++) {
            const dest = written * stride + (count - 1);
            if (dest >= keyLength) break;
            key[dest] = out[written]!;
        }
        remaining -= written;
    }
    return key;
};
