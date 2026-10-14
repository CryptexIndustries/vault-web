import type * as VaultUtilTypes from "@cryptex-industries/vault-core/proto";
import type { ShareServiceDeps } from "@cryptex-industries/vault-core/vault-utils/share-service";

/**
 * What the share UI needs from its host. The web dashboard keeps share
 * records in Jotai; the extension asks its service worker.
 */
export type ShareBackend = {
    deps: ShareServiceDeps;
    /** Undefined until the host knows (for example, before sign-in). */
    hasOnlineServicesSharing: boolean | undefined;
    /** Web always uses its own origin; the extension and mobile can point elsewhere. */
    allowCustomServer: boolean;
    saveSettings: (settings: VaultUtilTypes.ShareSettings) => Promise<void>;
    /** Opens sign-in or the plan picker. */
    onOpenAccount?: () => void;
    /**
     * Re-reads records from storage. Hosts whose records don't update
     * reactively (the extension) set this; the list calls it after a refresh.
     */
    reload?: () => Promise<void>;
};

export { describeShareError } from "@cryptex-industries/vault-core/vault-utils/share-messages";
