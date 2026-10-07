import sodium from "../src/shims/libsodium-wrappers-sumo";

const bytes = (hex: string) =>
    Uint8Array.from(hex.match(/../g) ?? [], (h) => parseInt(h, 16));
const hex = (value: Uint8Array) =>
    Array.from(value, (b) => b.toString(16).padStart(2, "0")).join("");
const utf8 = (s: string) => new TextEncoder().encode(s);
function check(value: unknown, message: string): asserts value {
    if (!value) throw new Error(message);
}
function rejects(operation: () => unknown) {
    try {
        operation();
    } catch {
        return;
    }
    throw new Error("Invalid Argon2id parameters accepted");
}

// Public known answers generated with libsodium-wrappers-sumo 0.7.15.
// Shared by Jest/Node and the Hermes/native test entry point.
export async function testSodiumCompatibility() {
    await sodium.ready;
    const salt = Uint8Array.from({ length: 16 }, (_, i) => i);
    const fixtures = [
        {
            password: utf8(""),
            memory: 8192,
            passes: 1,
            length: 16,
            expected: "35858230a16f87fed2b29838c1fe2df6",
        },
        {
            password: utf8("päss🔐\0word"),
            memory: 19 * 1048576,
            passes: 2,
            length: 32,
            expected:
                "64c379cc8ab812554bff9e5bfeb8d5a22dde9fe437b8f6195385b1b1815f3204",
        },
        {
            password: new Uint8Array([99, 0, 255, 128, 1, 0, 254, 99]).subarray(
                1,
                7,
            ),
            memory: 32 * 1024 + 1023,
            passes: 4,
            length: 64,
            expected:
                "05399544ece52b31273f3580f86d57683011e732a282b73e024def3f4a50a865614987cdfcdb586d285081438ac3ea5b0345460834f85412cf2f8db800d78250",
        },
        {
            password: utf8("default parameters"),
            memory: 256 * 1048576,
            passes: 3,
            length: 32,
            expected:
                "22374ace437c520c18663e0462a51a0677feefd4e6eaa14c7c4ce2751061ea40",
        },
    ];
    for (const fixture of fixtures) {
        const before = hex(fixture.password);
        const actual = sodium.crypto_pwhash(
            fixture.length,
            fixture.password,
            salt,
            fixture.passes,
            fixture.memory,
            sodium.crypto_pwhash_ALG_ARGON2ID13,
        );
        check(
            hex(actual) === fixture.expected,
            "Argon2id compatibility failed",
        );
        actual.slice().fill(0);
        check(
            hex(actual) === fixture.expected,
            "KDF output has Buffer slice semantics",
        );
        check(hex(fixture.password) === before, "Password input was mutated");
        check(
            hex(salt) === "000102030405060708090a0b0c0d0e0f",
            "Salt was mutated",
        );
    }
    for (const [length, saltLength, passes, memory, algorithm] of [
        [32, 16, 1, 8192, 1],
        [32, 15, 1, 8192, 2],
        [15, 16, 1, 8192, 2],
        [32, 16, 0, 8192, 2],
        [32, 16, 1.5, 8192, 2],
        [32, 16, 1, 8191, 2],
        [32, 16, 1, NaN, 2],
        [32, 16, 1, Infinity, 2],
        [32, 16, 1, 8192.5, 2],
    ]) {
        rejects(() =>
            sodium.crypto_pwhash(
                length,
                utf8("password"),
                new Uint8Array(saltLength),
                passes,
                memory,
                algorithm,
            ),
        );
    }
    const random = sodium.randombytes_buf(32);
    check(random.length === 32, "Random byte length changed");
    check(
        hex(random) !== hex(sodium.randombytes_buf(32)),
        "Random output repeated",
    );

    // Preserve the existing linking-package format, independently of the KDF.
    const key = new Uint8Array(32).fill(7);
    const plaintext = utf8("Public linking package ✓");
    const header = bytes("1aaae98a5a30ad28065432878aee6f2324a99d70136adbd2");
    const ciphertext = bytes(
        "67ab92c8581b30000d2f6e9c7b45690b4af6d18f3eb810381f674b157e4f34e8f1ea44fb3febd749b16b72",
    );
    const opened = sodium.crypto_secretstream_xchacha20poly1305_pull(
        sodium.crypto_secretstream_xchacha20poly1305_init_pull(header, key),
        ciphertext,
    );
    check(
        opened && hex(opened.message) === hex(plaintext),
        "Existing secretstream rejected",
    );
    check(
        opened.tag === sodium.crypto_secretstream_xchacha20poly1305_TAG_MESSAGE,
        "Secretstream tag changed",
    );
    ciphertext[0] ^= 1;
    check(
        sodium.crypto_secretstream_xchacha20poly1305_pull(
            sodium.crypto_secretstream_xchacha20poly1305_init_pull(header, key),
            ciphertext,
        ) === false,
        "Tampered secretstream accepted",
    );

    const sender = sodium.crypto_secretstream_xchacha20poly1305_init_push(key);
    const encrypted = sodium.crypto_secretstream_xchacha20poly1305_push(
        sender.state,
        plaintext,
        null,
        sodium.crypto_secretstream_xchacha20poly1305_TAG_MESSAGE,
    );
    const roundtrip = sodium.crypto_secretstream_xchacha20poly1305_pull(
        sodium.crypto_secretstream_xchacha20poly1305_init_pull(
            sender.header,
            key,
        ),
        encrypted,
    );
    check(
        roundtrip && hex(roundtrip.message) === hex(plaintext),
        "Secretstream round trip failed",
    );
}
