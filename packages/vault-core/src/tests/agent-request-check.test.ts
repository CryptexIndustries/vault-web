/**
 * @jest-environment node
 */
import { describe, expect, it } from "@jest/globals";
import { readFileSync } from "fs";
import { join } from "path";

import { base64ToUint8 } from "../encoding";
import { SignRequest } from "../proto/agent";
import {
    checkSignRequest,
    hasHiddenCharacters,
    InvalidRequestError,
    sanitizeDisplayText,
} from "../agent/request-check";
import { httpURL, normalizeOrigin, webSocketURL } from "../agent/relay-client";
import { requestHasHiddenCharacters } from "../agent/agent-format";
import { RememberedApprovals } from "../agent/remember";
import { SSHWriter } from "../internal/ssh/wire";

// Written by TestRequestVectors in services/internal/agent/approvertest:
// what the Go reference approver decides for each request. Regenerate with
//   go test ./internal/agent/approvertest -run TestRequestVectors -update-vectors
const VECTORS = join(
    __dirname,
    "../../../../services/internal/agent/approvertest/testdata/request-vectors.json",
);

type Host = { fingerprint: string; names: string[] };
type Vector = {
    name: string;
    request: string;
    invalid: boolean;
    kind?: string;
    namespace?: string;
    user?: string;
    destinationUnknown: boolean;
    verifiedHost?: Host;
    forwardedVia: Host[];
};

const vectors = (
    JSON.parse(readFileSync(VECTORS, "utf8")) as { cases: Vector[] }
).cases;

describe("request checks match the Go approver", () => {
    it.each(vectors.map((v) => [v.name, v] as const))("%s", (_, v) => {
        const request = SignRequest.decode(base64ToUint8(v.request));
        if (v.invalid) {
            expect(() => checkSignRequest(request)).toThrow(
                InvalidRequestError,
            );
            return;
        }
        const check = checkSignRequest(request);
        const { hostKey, ...verifiedHost } = check.verifiedHost ?? {
            hostKey: undefined,
        };
        expect({
            kind: check.kind,
            namespace: check.namespace,
            user: check.user,
            destinationUnknown: check.destinationUnknown,
            verifiedHost: check.verifiedHost ? verifiedHost : undefined,
            forwardedVia: check.forwardedVia,
        }).toEqual({
            kind: v.kind,
            namespace: v.namespace,
            user: v.user,
            destinationUnknown: v.destinationUnknown,
            verifiedHost: v.verifiedHost,
            forwardedVia: v.forwardedVia,
        });
        if (hostKey) {
            const last = request.sessionBinds[request.sessionBinds.length - 1]!;
            expect(hostKey).toEqual(last.hostKey);
        }
    });
});

describe("SSHSIG namespaces", () => {
    const signRequest = (namespace: Uint8Array) =>
        SignRequest.fromPartial({
            publicKey: new Uint8Array([1, 2, 3]),
            data: new SSHWriter()
                .raw(new TextEncoder().encode("SSHSIG"))
                .string(namespace)
                .string(new Uint8Array(0))
                .string(new TextEncoder().encode("sha256"))
                .string(new Uint8Array(32))
                .toBytes(),
            processes: [
                {
                    pid: 10,
                    uid: 1000,
                    exe: "/usr/bin/git",
                    args: ["git", "commit", "-S"],
                    cwd: "/src",
                },
            ],
        });
    const incoming = (id: string, namespace: Uint8Array) => {
        const sign = signRequest(namespace);
        return {
            id,
            agentId: "a",
            receivedAt: 0,
            expiresAt: 90_000,
            sign,
            check: checkSignRequest(sign),
        };
    };

    it("keeps a leading byte order mark, so it isn't read as git", () => {
        const git = incoming("git", new TextEncoder().encode("git"));
        const bom = incoming(
            "bom",
            new Uint8Array([
                0xef,
                0xbb,
                0xbf,
                ...new TextEncoder().encode("git"),
            ]),
        );
        expect(git.check.namespace).toBe("git");
        expect(bom.check.namespace).toBe("\uFFFDgit");
        expect(requestHasHiddenCharacters(bom)).toBe(true);
        const rules = new RememberedApprovals();
        expect(rules.add(git, "cred", "process")).toBe(true);
        expect(rules.matches(bom, "cred")).toBe(false);
    });
});

describe("sanitizeDisplayText", () => {
    // Same cases as services/internal/agent/termsafe.
    it.each([
        ["Pixel 8", "Pixel 8"],
        ["Téléphone de Zoë 📱", "Téléphone de Zoë 📱"],
        [
            "Pixel\x1b]52;c;ZWNobyBwd25lZA==\x07 8",
            "Pixel�]52;c;ZWNobyBwd25lZA==� 8",
        ],
        ["a\u009b31mb", "a�31mb"],
        ["line1\nline2\tx\r", "line1�line2�x�"],
        ["a\x7fb", "a�b"],
        ["Pixel ‮gnp.exe", "Pixel �gnp.exe"],
        ["⁦a⁧b⁨c⁩", "�a�b�c�"],
        ["‎a‏b؜c", "�a�b�c"],
        ["a b c", "a�b�c"],
        ["a\ud800b", "a�b"],
    ])("%j", (input, want) => {
        expect(sanitizeDisplayText(input, 100)).toBe(want);
    });

    // Invisible in a GUI, so the apps replace them too (termsafe keeps them).
    it.each([
        ["github.com\u200b", "github.com\uFFFD"],
        ["git\u2060hub\ufeff.com", "git\uFFFDhub\uFFFD.com"],
        ["a\u{E0041}b", "a\uFFFDb"],
        ["soft\u00adhyphen", "soft\uFFFDhyphen"],
        ["m\u180en", "m\uFFFDn"],
        ["x\ufff9y\ufffbz", "x\uFFFDy\uFFFDz"],
        ["vs\ufe0f\u{E0100}", "vs\uFFFD\uFFFD"],
    ])("hides %j", (input, want) => {
        expect(sanitizeDisplayText(input, 100)).toBe(want);
        expect(hasHiddenCharacters(input)).toBe(true);
        expect(hasHiddenCharacters(want)).toBe(true);
    });

    it("doesn't flag plain text", () => {
        expect(hasHiddenCharacters("Téléphone de Zoë 📱 github.com")).toBe(
            false,
        );
    });

    it("cuts long text", () => {
        const out = sanitizeDisplayText("é".repeat(300), 64);
        expect([...out]).toHaveLength(64);
        expect(out.endsWith("...")).toBe(true);
        expect(sanitizeDisplayText("x".repeat(64), 64)).toBe("x".repeat(64));
        expect(sanitizeDisplayText("abcdef", 2)).toBe("...");
    });
});

describe("relay URLs", () => {
    // Same cases as services/internal/serverkit/origin_test.go.
    it.each([
        ["https://vault.example.com", "https://vault.example.com"],
        ["https://vault.example.com/", "https://vault.example.com"],
        ["https://Vault.Example.com/app/", "https://vault.example.com"],
        ["https://vault.example.com:443/x?y=1", "https://vault.example.com"],
        ["http://localhost:3000/", "http://localhost:3000"],
        ["HTTP://LOCALHOST:80", "http://localhost"],
        [" https://[::1]:8443 ", "https://[::1]:8443"],
        ["https://xn--bcher-kva.example/", "https://xn--bcher-kva.example"],
        ["http://127.0.0.1:3000", "http://127.0.0.1:3000"],
        ["https://[2001:db8::1]", "https://[2001:db8::1]"],
        ["https://[::ffff:1.2.3.4]", "https://[::ffff:1.2.3.4]"],
        ["https://[2001:DB8::1]", "https://[2001:db8::1]"],
    ])("normalizes %j", (raw, want) => {
        expect(normalizeOrigin(raw)).toBe(want);
    });

    it.each([
        "",
        "vault.example.com",
        "ftp://vault.example.com",
        "https://",
        "https://user:pw@vault.example.com",
        "https:vault",
        "https://bücher.example",
        "https://[0:0:0:0:0:0:0:1]",
        "https://vault.example.com:0443",
        "https://vault.example.com:99999",
        "http://127.000.0.1",
        "https://[2001:db8:0:0:1::1]",
    ])("refuses %j", (raw) => {
        expect(() => normalizeOrigin(raw)).toThrow(JSON.stringify(raw));
    });

    it("builds endpoint URLs below a base path", () => {
        expect(webSocketURL("https://relay.example.com", "/v1/connect")).toBe(
            "wss://relay.example.com/v1/connect",
        );
        expect(
            webSocketURL("http://127.0.0.1:8080/relay/?x=1#y", "/v1/connect"),
        ).toBe("ws://127.0.0.1:8080/relay/v1/connect");
        expect(httpURL("https://Relay.example.com/", "/v1/revoke")).toBe(
            "https://Relay.example.com/v1/revoke",
        );
    });
});
