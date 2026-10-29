import { t } from "@lingui/core/macro";
import type { LinkingProcessStatus } from "@cryptex-industries/vault-core/vault-utils/linking";

type LinkingLogMessage = NonNullable<LinkingProcessStatus["LogMessage"]>;

/** The text for a linking status message. */
export function linkingLogText(log: LinkingLogMessage): string {
    switch (log.code) {
        case "ONLINE_SERVICES_CONNECTING":
            return t`Connecting to Cryptex Vault Online Services...`;
        case "SIGNALING_CONNECTING":
            return t`Connecting to the Signaling Server...`;
        case "ONLINE_SERVICES_CONNECTED":
            return t`Connected to Cryptex Vault Online Services.`;
        case "SIGNALING_CONNECTED":
            return t`Connected to the Signaling Server.`;
        case "PRIVATE_CONNECTION_SETUP_FAILED":
            return t`An error occurred while setting up a private connection.`;
        case "SIGNALING_DROPPED":
            return t`Dropped Signaling Server connection.`;
        case "SIGNALING_AUTHORIZATION_FAILED":
            return t`Failed to authorize the signaling channel.`;
        case "SENDER_DID_NOT_RESPOND":
            return t`The sending device didn't respond.`;
        case "WAITING_FOR_SENDER":
            return t`Waiting for other device to notice us...`;
        case "OFFER_RECEIVED":
            return t`Received WebRTC offer from other device`;
        case "SENDER_CONNECT_FAILED":
            return t`Couldn't connect to the sending device.`;
        case "FINISHING_PRIVATE_CONNECTION":
            return t`Finishing establishing private connection...`;
        case "SENDER_STOPPED_RESPONDING":
            return t`The sending device stopped responding.`;
        case "CLEANUP_COMPLETED":
            return t`Cleanup completed`;
        case "PRIVATE_CONNECTION_ESTABLISHED":
            return t`Private connection established.`;
        case "PRIVATE_CONNECTION_FAILED":
            return t`Failed to establish private connection`;
        case "PRIVATE_CONNECTION_TERMINATED":
            return t`Private connection has been terminated.`;
        case "PRIVATE_CHANNEL_OPEN":
            return t`Private channel open. Waiting for sender authentication...`;
        case "SENDER_AUTHENTICATED":
            return t`Sender authenticated. Sharing this device's post-quantum sync key...`;
        case "RECEIVER_KEY_ACCEPTED":
            return t`Receiver key accepted. Waiting for encrypted vault transfer...`;
        case "KEY_EXCHANGE_FAILED":
            return t`Failed to authenticate link key exchange.`;
        case "RECEIVING_VAULT_TRANSFER":
            return t`Receiving encrypted vault transfer and checking authenticity...`;
        case "VAULT_TRANSFER_DECRYPTED":
            return t`Vault authenticity confirmed. Transfer decrypted successfully.`;
        case "VAULT_READY":
            return t`Vault is ready to merge or save on this device.`;
        case "VAULT_TRANSFER_SIGNATURE_INVALID":
            return t`Vault transfer could not be authenticated. Update the sending device and try again.`;
        case "VAULT_TRANSFER_DECRYPT_FAILED":
            return t`Failed to decrypt vault transfer.`;
        case "CLEANUP_STARTED":
            return t`Starting cleanup of private connection...`;
        case "SECURE_CHANNEL_ERROR":
            return t`Secure channel error`;
        case "ICE_CANDIDATES_FAILED":
            return t`Failed to generate ICE candidates. WebRTC failure.`;
        case "ICE_CANDIDATE_SENT":
            return t`Sending WebRTC ice candidate`;
        case "WAITING_ABORTED":
            return t`Linking aborted while waiting for the other device.`;
    }
}
