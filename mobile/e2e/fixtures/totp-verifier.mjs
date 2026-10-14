import { createHmac } from "node:crypto";

// Base32 JBSWY3DPEHPK3PXP, shared with setup-autofill-vault.yaml.
const fixtureSecret = Buffer.from("48656c6c6f21deadbeef", "hex");

export function totpCode(step, secret = fixtureSecret) {
    const counter = Buffer.alloc(8);
    counter.writeBigUInt64BE(BigInt(step));
    const hash = createHmac("sha1", secret).update(counter).digest();
    const offset = hash.at(-1) & 15;
    return String((hash.readUInt32BE(offset) & 0x7fffffff) % 1000000).padStart(6, "0");
}

export function fixtureTotpAccepted(code, now = Date.now()) {
    if (!/^\d{6}$/.test(code)) return false;
    const step = Math.floor(now / 30000);
    return [-1, 0, 1].some(offset => step + offset >= 0 && totpCode(step + offset) === code);
}
