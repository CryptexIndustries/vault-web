import { ONLINE_SERVICES_SELECTION_ID } from "@cryptex-industries/vault-core/consts";

/**
 * Validates send-link server selections.
 * A direct connection may use STUN; TURN remains an optional relay path.
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

    const iceValid = stunValid || turnValid;

    return signalingValid && iceValid;
};
