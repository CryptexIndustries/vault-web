/**
 * @jest-environment jsdom
 *
 * Pairing in the Connect an agent dialog: success only after the agent
 * confirmed and its record was saved, pairingFailed on any failure, no
 * cancelling once the final save started (a cancel then unregistered the
 * agent and the save still reported Connected), and Cancel on the code
 * unregisters the agent on the relay before the approver stops.
 */
import "../helpers/jsdom-encoding";
import { StrictMode, act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { Provider } from "jotai";
import { afterEach, expect, it, jest } from "@jest/globals";
import {
    Vault,
    VaultCredential,
} from "@cryptex-industries/vault-core/vault-utils/vault";
import { ItemType } from "@cryptex-industries/vault-core/proto";
import { PairingOffer } from "@cryptex-industries/vault-core/proto/agent";
import {
    generateAgentIdentity,
    identityPeer,
} from "@cryptex-industries/vault-core/agent/envelope";
import {
    formatPairingCode,
    offerHash,
} from "@cryptex-industries/vault-core/agent/pairing";
import { Approver } from "@cryptex-industries/vault-core/agent/approver";
import { uint8ToBase64Url } from "@cryptex-industries/vault-core/encoding";
import { unlockedVaultAtom, vaultStore } from "@/utils/atoms";
import { ConnectAgentDialog } from "@/components/agents/connect-agent-dialog";
import { WebAgentHost } from "@/app_lib/agent/web-agent-host";
import { setNativeValue } from "../helpers/dom";
import { FakeLocks } from "../helpers/fake-locks";
import {
    FakeRelay,
    RELAY_URL,
    TOKEN,
} from "../../../packages/vault-core/src/tests/helpers/fake-relay";

const mockHost: { current: unknown } = { current: null };
jest.mock("@/components/agents/agent-host-context", () => ({
    useAgentHost: () => mockHost.current,
}));
jest.mock("@/utils/ssh-key", () => ({
    getSSHKeyInfo: () => ({ label: "Ed25519", fingerprint: "SHA256:test" }),
}));
jest.mock("sonner", () => ({
    toast: { success: jest.fn(), error: jest.fn() },
}));

(
    globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const settle = () =>
    act(async () => {
        for (let i = 0; i < 10; i++)
            await new Promise((resolve) => setTimeout(resolve, 0));
    });

function deferred<T>() {
    let resolve: (value: T) => void = () => undefined;
    let reject: (reason: unknown) => void = () => undefined;
    const promise = new Promise<T>((done, fail) => {
        resolve = done;
        reject = fail;
    });
    return { promise, resolve, reject };
}

let root: Root | null = null;
let container: HTMLDivElement | null = null;

afterEach(async () => {
    await act(async () => root?.unmount());
    root = null;
    container?.remove();
    container = null;
    vaultStore.set(unlockedVaultAtom, new Vault());
});

const button = (text: string) =>
    [...document.querySelectorAll("button")].find(
        (candidate) => candidate.textContent === text,
    );

const click = (testId: string) =>
    act(async () =>
        document
            .querySelector<HTMLButtonElement>(`[data-testid=${testId}]`)!
            .click(),
    );

/** A vault with one SSH key, the one the dialog preselects. */
function sshKeyVault() {
    const vault = new Vault();
    vault.Credentials = [
        Object.assign(new VaultCredential(), {
            ID: "key",
            Name: "GitHub",
            Type: ItemType.SSHKey,
            SSHKey: {
                PrivateKey: "",
                PublicKey: "ssh-ed25519 CQ==",
                Comment: "",
            },
        }),
    ];
    return vault;
}

/** Mounts the dialog, pastes the code and presses Connect. */
async function pairUpToCode(
    code: string,
    dialog: () => React.ReactElement,
    strict = false,
) {
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    const render = () => {
        const tree = <Provider store={vaultStore}>{dialog()}</Provider>;
        // At the root: nested inside the Provider, React skips the extra
        // mount cycle here.
        root!.render(strict ? <StrictMode>{tree}</StrictMode> : tree);
    };
    await act(async () => render());
    await settle();
    const input = document.querySelector<HTMLTextAreaElement>(
        "[data-testid=agent-paste]",
    )!;
    await act(async () => setNativeValue(input, code));
    await click("agent-paste-submit");
    await settle();
    await click("agent-submit");
    await settle();
    return render;
}

/** Pairs with a mocked host up to the confirmation code. */
async function setup({ strict = false } = {}) {
    vaultStore.set(unlockedVaultAtom, sshKeyVault());
    const peer = identityPeer(generateAgentIdentity());
    const confirm = deferred<void>();
    const saving = deferred<boolean>();
    const end = jest.fn();
    const agentId = uint8ToBase64Url(peer.signPublicKey);
    const claim = {
        agentId,
        relay: { kind: "hosted", url: "https://relay.example.com" },
        expiresAt: Date.now() + 90_000,
        offer: {
            hostname: "box",
            os: "linux",
            arch: "amd64",
            agentVersion: "1",
            signPublicKey: peer.signPublicKey,
            kemPublicKey: peer.kemPublicKey,
        },
    };
    const host = {
        customRelays: () => [],
        beginPairing: jest.fn(async () => end),
        claim: jest.fn(async () => claim),
        accept: jest.fn(async () => ({
            confirmationCode: "1234-5678",
            revocationSeed: new Uint8Array(32),
            keysRevision: 1,
        })),
        waitForConfirmation: jest.fn(() => confirm.promise),
        approverIdentity: generateAgentIdentity(),
        deviceName: () => "browser",
        addAgentToVault: jest.fn((_record: { ID: string }) => saving.promise),
        pairingFailed: jest.fn(),
        cancelPairing: jest.fn(async () => undefined),
    };
    mockHost.current = host;
    const connected = jest.fn();
    const openChange = jest.fn();
    let open = true;
    const render = await pairUpToCode(
        "test-code",
        () => (
            <ConnectAgentDialog
                open={open}
                onOpenChange={openChange}
                onConnected={connected}
            />
        ),
        strict,
    );
    expect(host.waitForConfirmation).toHaveBeenCalled();
    const close = () => {
        open = false;
        return act(async () => render());
    };
    return {
        host,
        agentId,
        confirm,
        saving,
        end,
        connected,
        openChange,
        close,
    };
}

it.each([
    [
        "the agent doesn't confirm",
        async (t: Awaited<ReturnType<typeof setup>>) => {
            await act(async () =>
                t.confirm.reject(new Error("no confirmation")),
            );
        },
    ],
    [
        "the agent record can't be saved",
        async (t: Awaited<ReturnType<typeof setup>>) => {
            await act(async () => t.confirm.resolve());
            await settle();
            await act(async () => t.saving.resolve(false));
        },
    ],
])("calls pairingFailed when %s", async (_name, fail) => {
    const t = await setup();
    await fail(t);
    await settle();
    expect(t.host.pairingFailed).toHaveBeenCalledWith(t.agentId);
    expect(t.connected).not.toHaveBeenCalled();
    // Back to a usable dialog.
    expect(document.querySelector("[data-testid=agent-paste]")).not.toBeNull();
});

it("saves the confirmed agent, then reports it connected and closes", async () => {
    const t = await setup();
    expect(t.host.addAgentToVault).not.toHaveBeenCalled();
    await act(async () => t.confirm.resolve());
    await settle();
    await act(async () => t.saving.resolve(true));
    await settle();
    const saved = t.host.addAgentToVault.mock.calls[0]![0];
    expect(t.connected).toHaveBeenCalledWith(saved.ID);
    expect(t.openChange).toHaveBeenCalledWith(false);
    expect(t.host.pairingFailed).not.toHaveBeenCalled();
    await t.close();
    expect(t.host.cancelPairing).not.toHaveBeenCalled();
});

it("cancels a pairing still waiting for the agent", async () => {
    const t = await setup();
    const cancel = button("Cancel")!;
    expect(cancel.disabled).toBe(false);
    await act(async () => cancel.click());
    expect(t.openChange).toHaveBeenCalledWith(false);
    await t.close();
    expect(t.host.cancelPairing).toHaveBeenCalledWith(t.agentId);
    expect(t.end).toHaveBeenCalled();
});

it("can't be cancelled once the final save started", async () => {
    const t = await setup();
    await act(async () => t.confirm.resolve());
    await settle();
    expect(t.host.addAgentToVault).toHaveBeenCalled();
    expect(button("Cancel")).toBeUndefined();
    expect(button("Saving…")!.disabled).toBe(true);
    // Escape and the close button go through onOpenChange: held back.
    await act(async () => {
        document.dispatchEvent(
            new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
        );
    });
    await act(async () =>
        document
            .querySelector<HTMLButtonElement>(
                "[data-testid=agent-connect-dialog] button:not([data-testid])",
            )
            ?.click(),
    );
    expect(t.openChange).not.toHaveBeenCalled();
    await act(async () => t.saving.resolve(true));
    await settle();
    expect(t.host.cancelPairing).not.toHaveBeenCalled();
    expect(t.connected).toHaveBeenCalled();
    expect(t.openChange).toHaveBeenCalledWith(false);
});

it("reports nothing when the dialog went away during the save, and keeps the agent", async () => {
    const t = await setup();
    await act(async () => t.confirm.resolve());
    await settle();
    // The vault locked: the dashboard and its dialog unmount.
    await act(async () => root!.render(null));
    expect(t.host.cancelPairing).not.toHaveBeenCalled();
    await act(async () => t.saving.resolve(true));
    await settle();
    expect(t.connected).not.toHaveBeenCalled();
    expect(t.openChange).not.toHaveBeenCalled();
    expect(t.host.pairingFailed).not.toHaveBeenCalled();
});

it("pairs under React's strict mode (its mount runs the cleanup once)", async () => {
    const t = await setup({ strict: true });
    // The extra mount cycle ran.
    expect(t.host.beginPairing).toHaveBeenCalledTimes(2);
    await act(async () => t.confirm.resolve());
    await settle();
    expect(t.host.addAgentToVault).toHaveBeenCalled();
    await act(async () => t.saving.resolve(true));
    await settle();
    expect(t.connected).toHaveBeenCalled();
    expect(t.host.cancelPairing).not.toHaveBeenCalled();
});

// The real WebAgentHost, AgentRuntime and Approver over the fake relay.
it("unregisters the agent on the relay when Cancel is pressed on the code", async () => {
    let vault = sshKeyVault();
    const identity = generateAgentIdentity();
    vault.AgentApprover = {
        SignSeed: identity.signSeed,
        KEMSeed: identity.kemSeed,
        CustomRelays: [{ Origin: RELAY_URL, Token: TOKEN }],
        RelayPass: "",
        RelayPassExpiresAt: 0,
        ApprovedAgents: [],
    };
    vaultStore.set(unlockedVaultAtom, vault);
    const relay = new FakeRelay();
    const host = new WebAgentHost({
        getVault: () => vault,
        canSign: () => true,
        persist: async (_kind, mutate) => {
            vault = await mutate(vault);
            vaultStore.set(unlockedVaultAtom, vault);
            return true;
        },
        hostedRelayUrl: "https://hosted.example.com",
        deviceName: () => "browser",
        requestPass: async () => null,
        locks: new FakeLocks(),
        notifications: {
            show: () => undefined,
            close: () => undefined,
            closeAll: () => undefined,
        },
        isVisible: () => true,
        focusWindow: () => undefined,
        createApprover: (approverHost) => new Approver(approverHost),
        openWebSocket: relay.open,
        fetch: globalThis.fetch,
        sign: async () => new Uint8Array(),
    });
    mockHost.current = host;
    host.sync();
    const peer = identityPeer(generateAgentIdentity());
    const agentId = uint8ToBase64Url(peer.signPublicKey);
    const slotId = crypto.getRandomValues(new Uint8Array(16));
    const offer = PairingOffer.encode(
        PairingOffer.fromPartial({
            protocolVersion: 1,
            signPublicKey: peer.signPublicKey,
            kemPublicKey: peer.kemPublicKey,
            hostname: "box",
        }),
    ).finish();
    relay.slots.set(uint8ToBase64Url(slotId), {
        offer,
        expiresAt: Date.now() + 180_000,
    });
    const code = formatPairingCode({
        version: 1,
        relayUrl: RELAY_URL,
        slotId,
        secret: new Uint8Array(32).fill(1),
        offerHash: offerHash(offer),
    });
    const connected = jest.fn();
    let open = true;
    try {
        const render: () => void = await pairUpToCode(code, () => (
            <ConnectAgentDialog
                open={open}
                onOpenChange={(next) => {
                    open = next;
                    render();
                }}
                onConnected={connected}
            />
        ));
        expect(relay.registered.has(agentId)).toBe(true);
        const cancel = document.querySelector<HTMLButtonElement>(
            "[data-testid=agent-cancel]",
        )!;
        expect(cancel.disabled).toBe(false);
        await act(async () => cancel.click());
        await settle();
        expect(
            document.querySelector("[data-testid=agent-connect-dialog]"),
        ).toBeNull();
        expect(relay.of("unregisterAgent")).toHaveLength(1);
        expect(relay.registered.has(agentId)).toBe(false);
        // Nothing else keeps the approver up: it stopped afterwards.
        expect(host.isLeader).toBe(false);
        expect(vault.ConnectedAgents ?? []).toHaveLength(0);
        expect(connected).not.toHaveBeenCalled();
    } finally {
        await act(async () => root!.unmount());
        root = null;
        host.dispose();
    }
});
