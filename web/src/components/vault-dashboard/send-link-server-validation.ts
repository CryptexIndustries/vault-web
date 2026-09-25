import { ONLINE_SERVICES_SELECTION_ID } from "@/utils/consts";

/**
 * Validates the send-link dialog server selections.
 *
 * Per the WebRTC ICE spec (RFC 8445) and TURN spec (RFC 8656), a TURN server
 * also fulfills the STUN role: it yields a server-reflexive candidate via its
 * STUN binding and a relay candidate. A configuration with only a TURN server
 * and no STUN server is therefore spec-valid. STUN is optional in both modes.
 *
 * In non-cloud mode a custom TURN server is required because the runtime
 * (`initWebRTC`) falls back to Online Services for relay credentials
 * when no custom TURN server is configured, which is unavailable when Online
 * Services is not bound.
 */
export const hasValidServerSelections = (
    cloudEnabled: boolean,
    signalingServerID: string,
    stunServerIDs: string[],
    turnServerIDs: string[],
    signalingServers: { ID: string }[],
    stunServers: { ID: string }[],
    turnServers: { ID: string }[],
): boolean => {
    const signalingValid = cloudEnabled
        ? signalingServerID === ONLINE_SERVICES_SELECTION_ID ||
          signalingServers.some((s) => s.ID === signalingServerID)
        : signalingServerID !== "" &&
          signalingServers.some((s) => s.ID === signalingServerID);

    const stunValid = cloudEnabled
        ? stunServerIDs.includes(ONLINE_SERVICES_SELECTION_ID) ||
          stunServers.some((s) => stunServerIDs.includes(s.ID))
        : stunServerIDs.length > 0 &&
          stunServers.some((s) => stunServerIDs.includes(s.ID));

    const turnValid = cloudEnabled
        ? turnServerIDs.includes(ONLINE_SERVICES_SELECTION_ID) ||
          turnServers.some((s) => turnServerIDs.includes(s.ID))
        : turnServerIDs.length > 0 &&
          turnServers.some((s) => turnServerIDs.includes(s.ID));

    // ICE needs at least one reachable server. STUN is optional because a TURN
    // server also serves the STUN role. Non-cloud mode requires a custom TURN
    // server (no Online Services relay fallback is available there).
    const iceValid = cloudEnabled ? stunValid || turnValid : turnValid;

    return signalingValid && iceValid;
};
