import type { SyncConnectionController } from "@cryptex-industries/vault-core/synchronization";
import { vaultLog } from "@/utils/logging";

const activeControllers = new Set<SyncConnectionController>();
const tornDownControllers = new WeakSet<SyncConnectionController>();

function teardownController(controller: SyncConnectionController) {
    if (tornDownControllers.has(controller)) return;
    try {
        controller.teardown();
        tornDownControllers.add(controller);
    } catch (error) {
        vaultLog.error("Failed to close a sync connection during lock", {
            error,
        });
    }
}

/** Track the unlocked shell's controller even when another route covers it. */
export function registerActiveSyncController(controller: SyncConnectionController) {
    tornDownControllers.delete(controller);
    activeControllers.add(controller);
    return () => {
        activeControllers.delete(controller);
        teardownController(controller);
    };
}

/** Closing a vault must close peers even when lock UI has no sync context. */
export function teardownActiveSyncControllers(
    additionalController?: SyncConnectionController,
) {
    const controllers = new Set(activeControllers);
    if (additionalController) controllers.add(additionalController);
    activeControllers.clear();
    for (const controller of controllers) {
        teardownController(controller);
    }
}
