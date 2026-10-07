// Test-only WebAuthn relying-party verification shared by the browser and tests.
export const encode = value => btoa(String.fromCharCode(...new Uint8Array(value)))
    .replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
export const decode = value => Uint8Array.from(atob(value.replaceAll("-", "+")
    .replaceAll("_", "/").padEnd(Math.ceil(value.length / 4) * 4, "=")), c => c.charCodeAt(0));

const requireValue = (condition, message) => {
    if (!condition) throw new Error(message);
};
const digest = async value => new Uint8Array(await crypto.subtle.digest("SHA-256", value));
const clientData = (response, type, options) => {
    const client = JSON.parse(new TextDecoder().decode(response.clientDataJSON));
    requireValue(client.type === type, "Incorrect WebAuthn ceremony type");
    requireValue(client.challenge === encode(options.challenge), "Incorrect WebAuthn challenge");
    requireValue(client.origin === options.origin && client.crossOrigin !== true,
        "Incorrect WebAuthn origin");
};
const authenticatorData = async (value, rpId) => {
    const data = new Uint8Array(value);
    requireValue(data.length >= 37, "Truncated authenticator data");
    requireValue(encode(data.slice(0, 32)) === encode(await digest(new TextEncoder().encode(rpId))),
        "Incorrect relying-party hash");
    requireValue((data[32] & 0x05) === 0x05, "User presence and verification required");
    return { data, counter: new DataView(data.buffer, data.byteOffset, data.byteLength).getUint32(33) };
};

export function derSignatureToRaw(value) {
    const bytes = new Uint8Array(value);
    requireValue(bytes.length >= 8 && bytes[0] === 0x30 && bytes[1] === bytes.length - 2,
        "Invalid ECDSA signature sequence");
    const raw = new Uint8Array(64);
    let offset = 2;
    for (let part = 0; part < 2; part++) {
        requireValue(bytes[offset++] === 0x02, "Invalid ECDSA signature integer");
        const length = bytes[offset++];
        requireValue(length > 0 && length <= 33 && offset + length <= bytes.length,
            "Invalid ECDSA signature integer length");
        let integer = bytes.slice(offset, offset + length);
        requireValue((integer[0] & 0x80) === 0, "Negative ECDSA signature integer");
        if (integer.length > 1 && integer[0] === 0) {
            requireValue((integer[1] & 0x80) !== 0, "Noncanonical ECDSA signature integer");
            integer = integer.slice(1);
        }
        requireValue(integer.length <= 32, "ECDSA signature integer overflow");
        raw.set(integer, part * 32 + 32 - integer.length);
        offset += length;
    }
    requireValue(offset === bytes.length, "Trailing ECDSA signature data");
    return raw;
}

export async function verifyRegistration(credential, options) {
    requireValue(credential.type === "public-key", "Unexpected credential type");
    clientData(credential.response, "webauthn.create", options);
    const { data, counter } = await authenticatorData(credential.response.getAuthenticatorData(), options.rpId);
    requireValue((data[32] & 0x40) !== 0 && data.length >= 55, "Missing attested credential data");
    const idLength = new DataView(data.buffer, data.byteOffset, data.byteLength).getUint16(53);
    requireValue(idLength > 0 && data.length >= 55 + idLength &&
        encode(data.slice(55, 55 + idLength)) === encode(credential.rawId), "Incorrect attested credential ID");
    requireValue(credential.response.getPublicKeyAlgorithm() === -7, "Expected ES256 credential");
    const publicKey = credential.response.getPublicKey();
    requireValue(publicKey !== null, "Missing credential public key");
    await crypto.subtle.importKey("spki", publicKey, { name: "ECDSA", namedCurve: "P-256" }, false, ["verify"]);
    return { id: encode(credential.rawId), publicKey: encode(publicKey), counter, userHandle: options.userHandle };
}

export async function verifyAssertion(credential, registration, options) {
    requireValue(credential.type === "public-key" && encode(credential.rawId) === registration.id,
        "Unknown assertion credential");
    requireValue(encode(credential.response.userHandle) === registration.userHandle, "Incorrect assertion user handle");
    clientData(credential.response, "webauthn.get", options);
    const { data, counter } = await authenticatorData(credential.response.authenticatorData, options.rpId);
    requireValue((counter === 0 && registration.counter === 0) || counter > registration.counter,
        "Assertion counter did not increase");
    const hash = await digest(credential.response.clientDataJSON);
    const signed = new Uint8Array(data.length + hash.length);
    signed.set(data);
    signed.set(hash, data.length);
    const key = await crypto.subtle.importKey("spki", decode(registration.publicKey),
        { name: "ECDSA", namedCurve: "P-256" }, false, ["verify"]);
    requireValue(await crypto.subtle.verify({ name: "ECDSA", hash: "SHA-256" }, key,
        derSignatureToRaw(credential.response.signature), signed), "Invalid assertion signature");
    return { ...registration, counter };
}
