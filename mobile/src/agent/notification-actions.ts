import { vaultLog } from "@/utils/logging";
import { agentRuntime } from "./agent-app";
import { agentService, type AgentNotificationAction } from "./agent-service";
import { deniedRequests } from "./denied-requests";

/**
 * Review and Deny taps from request notifications. One listener for the JS
 * runtime, started by the headless task (all that runs after a reboot or a
 * swipe-away) and by the UI, so Deny works without any screen. Review needs
 * the UI: it waits until the root bridge registers its handler.
 */

let listening = false;
let reviewHandler: ((requestId: string) => void) | null = null;
let queuedReview: string | null = null;

function deny(requestId: string) {
    deniedRequests.add(requestId);
    void agentRuntime
        .deny(requestId)
        .catch((error: unknown) =>
            vaultLog.warn("Couldn't deny the SSH request", { error }),
        );
}

function handle({ action, requestId }: AgentNotificationAction) {
    if (action === "deny") deny(requestId);
    else if (reviewHandler) reviewHandler(requestId);
    else queuedReview = requestId;
}

/** Handles actions stored while no JS listener was there (cold starts). */
function drain() {
    for (const item of agentService.takePendingActions()) handle(item);
}

export const notificationActions = {
    /** Starts listening once per JS runtime and takes stored actions. */
    listen() {
        if (!listening) {
            listening = true;
            agentService.addActionListener(handle);
            // Requests resent after a Deny that came first are refused here.
            agentRuntime.subscribe(() => {
                for (const request of agentRuntime.pendingRequests())
                    if (deniedRequests.has(request.id))
                        void Promise.resolve().then(() => deny(request.id));
            });
        }
        drain();
    },
    drain,
    /** The UI's Review handling; a Review that came before it runs now. */
    setReviewHandler(handler: (requestId: string) => void): () => void {
        reviewHandler = handler;
        const queued = queuedReview;
        queuedReview = null;
        if (queued) handler(queued);
        return () => {
            if (reviewHandler === handler) reviewHandler = null;
        };
    },
};
