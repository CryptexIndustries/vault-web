import { redirectExternalPath } from "@/agent/approval-screen";

/**
 * Links from other apps and web pages. The SSH approval screen opens only
 * from inside the app (notifications go through ACTION_REVIEW, not a link),
 * so an external cryptex://agent-request lands on the vault home instead.
 */
export function redirectSystemPath({
    path,
}: {
    path: string;
    initial: boolean;
}) {
    return redirectExternalPath(path);
}
