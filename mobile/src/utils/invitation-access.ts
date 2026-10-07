type InvitationAccess = {
    usesOnlineServices: boolean;
    hasSession: boolean;
    makeRoot: boolean;
    permissions?: {
        root: boolean;
        canLink: boolean;
        canPromoteDevices?: boolean;
    } | null;
};

export function invitationAccessError({
    usesOnlineServices,
    hasSession,
    makeRoot,
    permissions,
}: InvitationAccess): string | null {
    if (!usesOnlineServices) return null;
    if (!hasSession || !permissions) {
        return "Sign in and refresh your account before creating an Online Services invitation.";
    }
    if (!permissions.root) {
        return "Use a root device to create an Online Services invitation. Custom connections are still available.";
    }
    if (!permissions.canLink) {
        return "Online Services linking is unavailable. Check your plan and linked-device limit in Account.";
    }
    if (makeRoot && !permissions.canPromoteDevices) {
        return "Your account does not allow granting root access to another device.";
    }
    return null;
}

export async function removePendingInvitationDevice(
    deviceId: string,
    promoted: boolean,
    setRoot: (input: { id: string; root: boolean }) => Promise<unknown>,
    remove: (input: { id: string }) => Promise<unknown>,
): Promise<void> {
    if (promoted) await setRoot({ id: deviceId, root: false });
    await remove({ id: deviceId });
}
