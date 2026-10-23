/**
 * @jest-environment jsdom
 *
 * The SSH approval dialog opens by itself over the dashboard, so it must
 * not take a keystroke or click meant for the page: focus never lands on
 * Approve, and Approve ignores activation for a moment after each request
 * appears.
 */
import "../helpers/jsdom-encoding";
import { afterEach, describe, expect, it, jest } from "@jest/globals";
import { Provider } from "jotai";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { IncomingRequest } from "@cryptex-industries/vault-core/agent/approver-types";
import type { ConnectedAgent } from "@cryptex-industries/vault-core/proto";
import { Vault } from "@cryptex-industries/vault-core/vault-utils/vault";
import { unlockedVaultAtom, vaultStore } from "@/utils/atoms";

jest.mock("@/utils/ssh-key", () => ({
    getSSHKeyInfo: () => ({ label: "Ed25519" }),
}));

import {
    AgentRequestDialog,
    APPROVE_DELAY_MS,
} from "@/components/agents/agent-request-dialog";

(
    globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const request = (id: string, names = ["github.com"]): IncomingRequest => ({
    id,
    agentId: "agent-a",
    receivedAt: Date.now(),
    expiresAt: Date.now() + 90_000,
    sign: {
        publicKey: new Uint8Array(1),
        data: new Uint8Array(1),
        flags: 0,
        processes: [],
        sessionBinds: [],
        hostname: "box",
    },
    check: {
        kind: "login",
        user: "root",
        verifiedHost: {
            hostKey: new Uint8Array(1),
            fingerprint: "SHA256:prod",
            names,
        },
        forwardedVia: [],
        destinationUnknown: false,
    },
});

function fakeHost(requests: Record<string, IncomingRequest>) {
    return {
        getRequest: (id: string) => requests[id],
        setShownRequest: () => undefined,
        showNext: () => undefined,
        keyFor: () => ({ credentialId: "c", name: "GitHub", sshKey: {} }),
        agentName: () => "box",
        waitingCount: () => Object.keys(requests).length,
        approve: jest.fn(async () => undefined),
        deny: jest.fn(async () => undefined),
        setPaused: jest.fn(async () => undefined),
    };
}

let root: Root | null = null;
afterEach(() => {
    act(() => root?.unmount());
    root = null;
    document.body.innerHTML = "";
    jest.useRealTimers();
});

const approveButton = () =>
    document.querySelector<HTMLButtonElement>("[data-testid=agent-approve]")!;

/** Mounts the dialog, or shows another request in the mounted one. */
async function render(
    host: ReturnType<typeof fakeHost>,
    requestId: string,
): Promise<void> {
    if (!root) {
        const div = document.createElement("div");
        document.body.appendChild(div);
        root = createRoot(div);
    }
    await act(async () => {
        root!.render(
            <Provider store={vaultStore}>
                <AgentRequestDialog
                    host={host as never}
                    requestId={requestId}
                />
            </Provider>,
        );
    });
}

describe("the approval dialog", () => {
    it("doesn't take focus to Approve, and ignores Approve until the delay passed", async () => {
        jest.useFakeTimers();
        const host = fakeHost({ r1: request("r1"), r2: request("r2") });
        // The user is typing in a dashboard field when the request arrives.
        const input = document.createElement("input");
        document.body.appendChild(input);
        input.focus();
        await render(host, "r1");
        await act(async () => {
            jest.advanceTimersByTime(50);
        });
        expect(document.activeElement?.getAttribute("data-testid")).not.toBe(
            "agent-approve",
        );
        expect(
            document.querySelector("[data-testid=agent-request-count]")
                ?.textContent,
        ).toBe("1 of 2 waiting");

        // Too early: the click (or Enter, Space) does nothing.
        expect(approveButton().disabled).toBe(true);
        await act(async () => approveButton().click());
        expect(host.approve).not.toHaveBeenCalled();

        await act(async () => {
            jest.advanceTimersByTime(APPROVE_DELAY_MS);
        });
        expect(approveButton().disabled).toBe(false);

        // The next request in the same dialog waits again.
        await render(host, "r2");
        expect(approveButton().disabled).toBe(true);
        await act(async () => {
            jest.advanceTimersByTime(APPROVE_DELAY_MS);
        });
        await act(async () => approveButton().click());
        expect(host.approve).toHaveBeenCalledWith("r2", "once");
    });

    it("warns when a known host key comes under a new name", async () => {
        const vault = new Vault();
        vault.ConnectedAgents = [
            {
                ID: "agent-a",
                Deleted: false,
                KnownHosts: [
                    {
                        Fingerprint: "SHA256:prod",
                        Name: "prod-db",
                        FirstSeenTimestamp: 1,
                    },
                ],
            } as unknown as ConnectedAgent,
        ];
        vaultStore.set(unlockedVaultAtom, vault);
        try {
            await render(fakeHost({ r1: request("r1") }), "r1");
            expect(
                document.querySelector("[data-testid=agent-host-warning]")
                    ?.textContent,
            ).toBe(
                "This machine now calls this server github.com. Before, it was prod-db.",
            );
        } finally {
            vaultStore.set(unlockedVaultAtom, new Vault());
        }
    });
});
