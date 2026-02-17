// import {
//     OffscreenInboundMessage,
//     OffscreenOutboundMessage,
// } from "./types/offscreen-messaging";
// import {
//     EncryptedEnvelope,
//     MessageType,
//     PlaintextEnvelope,
// } from "./types/sw-messaging";
// import { validateEnvelope } from "./utils/security-utils";
// import {
//     createEncryptedEnvelope,
//     createEncryptedResponseEnvelope,
//     createPlaintextEnvelope,
//     decryptEnvelope,
//     isEncryptedEnvelope,
//     isPlaintextEnvelope,
// } from "./utils/session-utils";

// const requestServerPublicKey = async (): Promise<
//     | {
//           ok: true;
//           keyId: string;
//           curve: string;
//           publicKeyJwk: JsonWebKey;
//           createdAt: string;
//       }
//     | { ok: false; error: string }
// > => {
//     const envelope = createPlaintextEnvelope(
//         MessageType.GetPublicKey,
//         null,
//         "offscreen",
//     );
//     const resp: PlaintextEnvelope = await chrome.runtime.sendMessage(envelope);

//     if (!resp.payload.ok) {
//         return { ok: false, error: resp.payload.error };
//     }

//     return {
//         ok: true,
//         keyId: resp.payload.keyId,
//         curve: resp.payload.curve,
//         publicKeyJwk: resp.payload.publicKeyJwk,
//         createdAt: resp.payload.createdAt,
//     };
// };

// const swPublicKey = await requestServerPublicKey();
// if (!swPublicKey.ok) {
//     console.error(
//         "[offscreen] Failed to request server public key:",
//         swPublicKey.error,
//     );

//     // Intentionally halt execution of the offscreen document by throwing an error
//     throw new Error(swPublicKey.error);
// }

// chrome.runtime.onMessage.addListener(
//     async (
//         message: EncryptedEnvelope | PlaintextEnvelope,
//         _sender,
//         sendResponse: (response: EncryptedEnvelope) => void
//     ) => {
//         // if (isPlaintextEnvelope(message)) {
//         //     return false;
//         // }

//         if (!isEncryptedEnvelope(message)) {
//             console.error("[offscreen] Received a non-encrypted envelope:", message);
//             return false;
//         }

//         try {
//             // const response = await processEnvelope(_sender, message);

//             // if (response) {
//             //     sendResponse(response);
//             // } else {
//             //     console.error("[offscreen] Failed to process envelope. No reponse will be sent:", message);
//             // }

//             return true;
//         } catch (error) {
//             console.error("[offscreen] Error processing envelope:", error);
//         }

//         return false;
//     }
// );

/**
 * Processes and validates an envelope before processing any commands within it.
 * @param sender - The sender of the message
 * @param envelope - The envelope to process
 * @returns The response envelope in encrypted form
 */
// const processEnvelope = async (
//     sender: chrome.runtime.MessageSender,
//     envelope: EncryptedEnvelope | PlaintextEnvelope
// ): Promise<EncryptedEnvelope | null> => {
//     // Validate the envelope
//     const validation = validateEnvelope(envelope, sender);

//     if (!validation.valid) {
//         console.error("[processEnvelope] Validation error:", validation.error);
//         return null;
//     }

//     let decryptedPayload: any = null;
//     let sessionKey: CryptoKey | null = null;

//     const result = await executeCommand(envelope);

//     return createEncryptedResponseEnvelope(envelope, result, sessionKey);
// }

/**
 * Processes envelope messages in the offscreen document.
 */
// const executeCommand = async (
//     envelope: EncryptedEnvelope | PlaintextEnvelope
// ): Promise<EncryptedEnvelope> => {
//     // TODO: Implement actual offscreen document logic for sync operations
//     // For now, just echo back success for any message
//     // console.log("Offscreen received envelope:", envelope.type, envelope.origin);

//     // For encrypted envelopes, we would need the server's public key to respond
//     // For now, return a plaintext success response
//     // return createPlaintextEnvelope(envelope.type, { ok: true }, "offscreen");
//     return createEncryptedEnvelope(envelope.type, { ok: true }, "offscreen");
// }
