import { describe, expect, it, jest } from "@jest/globals";
import {
    invitationAccessError,
    removePendingInvitationDevice,
} from "@/utils/invitation-access";

const allowed = { root: true, canLink: true, canPromoteDevices: true };

describe("invitation account access", () => {
    it("allows custom connections without account or root access", () => {
        expect(
            invitationAccessError({
                usesOnlineServices: false,
                hasSession: false,
                makeRoot: false,
            }),
        ).toBeNull();
    });

    it.each([
        { hasSession: false, permissions: allowed },
        { hasSession: true, permissions: undefined },
        { hasSession: true, permissions: { ...allowed, root: false } },
        { hasSession: true, permissions: { ...allowed, canLink: false } },
    ])("rejects an unverified or ineligible account: %j", (access) => {
        expect(
            invitationAccessError({
                usesOnlineServices: true,
                makeRoot: false,
                ...access,
            }),
        ).not.toBeNull();
    });

    it("requires promotion access only when granting root", () => {
        const access = {
            usesOnlineServices: true,
            hasSession: true,
            permissions: { ...allowed, canPromoteDevices: false },
        };
        expect(
            invitationAccessError({ ...access, makeRoot: false }),
        ).toBeNull();
        expect(
            invitationAccessError({ ...access, makeRoot: true }),
        ).not.toBeNull();
        expect(
            invitationAccessError({
                ...access,
                permissions: allowed,
                makeRoot: true,
            }),
        ).toBeNull();
    });
});

describe("cancelled invitation cleanup", () => {
    it("removes root access before deleting a promoted registration", async () => {
        const calls: unknown[] = [];
        await removePendingInvitationDevice(
            "peer",
            true,
            async (input) => {
                calls.push(["root", input]);
            },
            async (input) => {
                calls.push(["remove", input]);
            },
        );
        expect(calls).toEqual([
            ["root", { id: "peer", root: false }],
            ["remove", { id: "peer" }],
        ]);
    });

    it("leaves ordinary invitations independent of root promotion permission", async () => {
        const setRoot = jest.fn<() => Promise<void>>();
        const remove = jest.fn<() => Promise<void>>().mockResolvedValue();
        await removePendingInvitationDevice("peer", false, setRoot, remove);
        expect(setRoot).not.toHaveBeenCalled();
        expect(remove).toHaveBeenCalledWith({ id: "peer" });
    });

    it("reports failed demotion without attempting prohibited root removal", async () => {
        const remove = jest.fn<() => Promise<void>>();
        await expect(
            removePendingInvitationDevice(
                "peer",
                true,
                async () => {
                    throw new Error("offline");
                },
                remove,
            ),
        ).rejects.toThrow("offline");
        expect(remove).not.toHaveBeenCalled();
    });
});
