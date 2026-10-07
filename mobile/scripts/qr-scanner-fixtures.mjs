// Synthetic, non-secret camera frames using the production chunker and QR encoder.
import { createRequire } from "node:module";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { createChunkedQRCodeFrames, DEFAULT_CHUNKED_QR_CYCLE_MS } from "../../packages/shared-ui/src/lib/chunked-qr.ts";

const require = createRequire(import.meta.url);
const encoderRequire = createRequire(require.resolve("react-native-qrcode-svg/package.json"));
const QRCode = encoderRequire("qrcode");
const output = resolve(dirname(fileURLToPath(import.meta.url)), "../android/build/qr-scanner-fixtures.bin");
const payload = Buffer.concat(Array.from({ length: 96 }, (_, i) =>
    createHash("sha256").update(`cryptex-qr-test-${i}`).digest(),
)).toString("base64");
const frames = await createChunkedQRCodeFrames(payload);
const texts = [
    "otpauth://totp/Cryptex:test?secret=JBSWY3DPEHPK3PXP&issuer=Cryptex",
    "otpauth://totp/Test:%E6%B5%8B%E8%AF%95?secret=JBSWY3DPEHPK3PXP&issuer=Test",
    "QR Unicode: čćžšđ 日本語 🔐",
    ...frames,
];
const int = value => { const buffer = Buffer.alloc(4); buffer.writeInt32BE(value); return buffer; };
const parts = [int(DEFAULT_CHUNKED_QR_CYCLE_MS), int(texts.length)];
for (const text of texts) {
    const encoded = Buffer.from(text);
    const { modules } = QRCode.create(text, { errorCorrectionLevel: "M" });
    // Camera sample size, not a change to the sender's 200 CSS px / dp display size.
    // At 400 camera pixels even the full 750-character chunks have >3 pixels/module.
    const renderedSize = 400;
    const size = renderedSize + 32;
    const pixels = Buffer.alloc(size * size, 255);
    for (let y = 0; y < renderedSize; y++) {
        for (let x = 0; x < renderedSize; x++) {
            const row = Math.floor(y * modules.size / renderedSize);
            const col = Math.floor(x * modules.size / renderedSize);
            pixels[(y + 16) * size + x + 16] = modules.data[row * modules.size + col] ? 0 : 255;
        }
    }
    parts.push(int(encoded.length), encoded, int(size), pixels);
}
await mkdir(dirname(output), { recursive: true });
await writeFile(output, Buffer.concat(parts));
console.log(`Generated ${texts.length} fixtures, including ${frames.length} production-sized link chunks at ${DEFAULT_CHUNKED_QR_CYCLE_MS} ms.\n${output}`);
