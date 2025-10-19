import { OffscreenInboundMessage, OffscreenOutboundMessage } from "./types/offscreen-messaging";
import { EncryptedEnvelope, PlaintextEnvelope } from "./types/sw-messaging";
import { createEncryptedEnvelope, createPlaintextEnvelope, decryptEnvelope } from "./utils/session-utils";

chrome.runtime.onMessage.addListener(async (message: OffscreenInboundMessage | EncryptedEnvelope | PlaintextEnvelope, _sender, sendResponse) => {
    // Handle legacy ping/pong for basic connectivity testing
    if ((message as any).type === "PING") {
        const response: OffscreenOutboundMessage = { type: "PONG" };
        sendResponse(response);
        return false;
    }

    // Handle envelope-based messages
    if (isEncryptedEnvelope(message) || isPlaintextEnvelope(message)) {
        try {
            const response = await processOffscreenEnvelope(message);
            sendResponse(response);
        } catch (error) {
            console.error("Offscreen envelope processing error:", error);
            sendResponse(createPlaintextEnvelope((message as any).type, { ok: false, error: "INTERNAL_ERROR" }, "offscreen"));
        }
        return false;
    }

    return false;
});

/**
 * Type guard to check if a message is an encrypted envelope.
 */
function isEncryptedEnvelope(message: any): message is EncryptedEnvelope {
    return message &&
           typeof message.type === 'number' &&
           typeof message.requestId === 'string' &&
           typeof message.origin === 'string' &&
           typeof message.keyId === 'string' &&
           typeof message.timestamp === 'string' &&
           message.payload &&
           typeof message.payload.wrappedKey === 'string' &&
           message.payload.ephemeralPub &&
           typeof message.payload.salt === 'string' &&
           typeof message.payload.ciphertext === 'string' &&
           typeof message.payload.iv === 'string';
}

/**
 * Type guard to check if a message is a plaintext envelope.
 */
function isPlaintextEnvelope(message: any): message is PlaintextEnvelope {
    return message &&
           typeof message.type === 'number' &&
           typeof message.requestId === 'string' &&
           typeof message.origin === 'string' &&
           typeof message.timestamp === 'string' &&
           !message.payload?.ciphertext; // Plaintext doesn't have ciphertext
}

/**
 * Processes envelope messages in the offscreen document.
 * For now, this is a placeholder - actual sync logic would be implemented here.
 */
async function processOffscreenEnvelope(
    envelope: EncryptedEnvelope | PlaintextEnvelope
): Promise<EncryptedEnvelope | PlaintextEnvelope> {
    // TODO: Implement actual offscreen document logic for sync operations
    // For now, just echo back success for any message
    console.log("Offscreen received envelope:", envelope.type, envelope.origin);

    // For encrypted envelopes, we would need the server's public key to respond
    // For now, return a plaintext success response
    return createPlaintextEnvelope(envelope.type, { ok: true }, "offscreen");
}

