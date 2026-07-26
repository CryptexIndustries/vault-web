import { WebRTCStatus } from "@cryptex-industries/vault-core/synchronization-utils";

/**
 * A clean disconnect can be retried automatically. A failed setup must wait
 * for a new user/lifecycle attempt; retrying it here creates an unbounded loop
 * when TURN credentials or signaling authorization are unavailable.
 */
export function shouldAutoReconnectAfterWebRTCStatus(
    connectionState: WebRTCStatus,
): boolean {
    return connectionState === WebRTCStatus.Disconnected;
}
