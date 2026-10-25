/** A pending SSH login request as the agent runtime holds it. */
export function sshLoginRequest(
    id: string,
    receivedAt = 0,
    names: string[] = [],
) {
    return {
        id,
        agentId: "agent",
        receivedAt,
        expiresAt: Date.now() + 90_000,
        sign: {
            publicKey: new Uint8Array(1),
            data: new Uint8Array(1),
            flags: 0,
            processes: [
                {
                    pid: 1,
                    uid: 1,
                    exe: "/usr/bin/ssh",
                    args: ["ssh"],
                    cwd: "/",
                },
            ],
            sessionBinds: [],
            hostname: "box",
        },
        check: {
            kind: "login" as const,
            verifiedHost: {
                hostKey: new Uint8Array(1),
                fingerprint: "SHA256:abc",
                names,
            },
            forwardedVia: [],
            destinationUnknown: false,
        },
    };
}
