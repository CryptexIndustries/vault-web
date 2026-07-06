/**
 * Pure URL construction utility - no environment access.
 * Use this to construct tRPC URLs from a base URL.
 */

export function buildTrpcUrl(baseUrl: string): string {
    return `${baseUrl.replace(/\/+$/, "")}/api/trpc`;
}
