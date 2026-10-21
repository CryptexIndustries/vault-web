import {
    createContext,
    useContext,
    useEffect,
    useMemo,
    useState,
    useSyncExternalStore,
    type ReactNode,
} from "react";
import Head from "next/head";
import { useAtomValue } from "jotai";
import type { ConnectedAgent } from "@cryptex-industries/vault-core/proto";
import { visibleConnectedAgents } from "@cryptex-industries/vault-core/vault-utils/connected-agents";
import { createBrowserAgentHost } from "@/app_lib/agent/browser-agent-host";
import {
    approvedInThisBrowser,
    type WebAgentHost,
} from "@/app_lib/agent/web-agent-host";
import {
    onlineServicesDataAtom,
    onlineServicesStore,
    unlockedVaultAtom,
} from "@/utils/atoms";
import { addVaultLockListener } from "@/utils/vault-lock-listeners";
import { AgentRequestDialog } from "./agent-request-dialog";

const AgentHostContext = createContext<WebAgentHost | null>(null);

const noopSubscribe = () => () => undefined;

/** The dashboard's agent approver host, null for the first render. */
export function useAgentHost(): WebAgentHost | null {
    const host = useContext(AgentHostContext);
    // Re-render when the host's requests, leadership or identity change.
    useSyncExternalStore(
        host ? (listener) => host.subscribe(listener) : noopSubscribe,
        () => host?.getVersion() ?? 0,
        () => 0,
    );
    return host;
}

/** The vault's connected agents, newest first, and which this device approves. */
export function useConnectedAgents() {
    const vault = useAtomValue(unlockedVaultAtom);
    const host = useAgentHost();
    const identity = host?.approverIdentity ?? null;
    const agents = useMemo(
        () => visibleConnectedAgents(vault.ConnectedAgents ?? []),
        [vault.ConnectedAgents],
    );
    const approvedHere = useMemo(
        () => (agent: ConnectedAgent) =>
            approvedInThisBrowser(vault, agent, identity),
        [vault, identity],
    );
    return { agents, approvedHere, host };
}

/**
 * Mounted inside the unlocked dashboard: the approver runs (in one tab) while
 * the vault is unlocked and stops when the dashboard unmounts on lock.
 */
export function AgentHostProvider({ children }: { children: ReactNode }) {
    const [host, setHost] = useState<WebAgentHost | null>(null);
    const vault = useAtomValue(unlockedVaultAtom);
    const sessionToken = useAtomValue(onlineServicesDataAtom, {
        store: onlineServicesStore,
    })?.sessionToken;

    useEffect(() => {
        const created = createBrowserAgentHost();
        setHost(created);
        const onVisibility = () => {
            if (document.visibilityState === "visible") created.onVisible();
        };
        const onOnline = () => created.refreshRelays();
        const stopLockListener = addVaultLockListener({
            lockStarted: () => created.beginLock(),
        });
        document.addEventListener("visibilitychange", onVisibility);
        window.addEventListener("online", onOnline);
        return () => {
            document.removeEventListener("visibilitychange", onVisibility);
            window.removeEventListener("online", onOnline);
            stopLockListener();
            created.dispose();
        };
    }, []);

    // The agents and relay settings follow the vault.
    useEffect(() => {
        host?.sync();
    }, [host, vault]);

    // Online Services signs in after unlock; a relay pass can be renewed then.
    useEffect(() => {
        if (sessionToken) host?.refreshRelays();
    }, [host, sessionToken]);

    return (
        <AgentHostContext.Provider value={host}>
            {children}
            <AgentHostChrome />
        </AgentHostContext.Provider>
    );
}

/** The waiting count in the tab title and the approval dialog. */
function AgentHostChrome() {
    const host = useAgentHost();
    if (!host) return null;
    const waiting = host.pendingRequests().length;
    return (
        <>
            {waiting > 0 ? (
                <Head>
                    <title>{`(${waiting}) Cryptex Vault`}</title>
                </Head>
            ) : null}
            {host.dialogRequestId ? (
                <AgentRequestDialog
                    host={host}
                    requestId={host.dialogRequestId}
                />
            ) : null}
        </>
    );
}
