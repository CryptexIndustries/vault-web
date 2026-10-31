import { describe, expect, it } from "@jest/globals";

import { iceServerURL } from "../synchronization-utils";

describe("iceServerURL", () => {
    it("adds the scheme to a host and port", () => {
        expect(iceServerURL("stun", " stun.example.com:3478 ")).toBe(
            "stun:stun.example.com:3478",
        );
        expect(iceServerURL("turn", "[fd00::1]:3478")).toBe(
            "turn:[fd00::1]:3478",
        );
    });

    it("keeps a URL's scheme, in lowercase", () => {
        expect(iceServerURL("stun", "stun:stun.example.com")).toBe(
            "stun:stun.example.com",
        );
        expect(iceServerURL("stun", "STUNS:stun.example.com:5349")).toBe(
            "stuns:stun.example.com:5349",
        );
        expect(
            iceServerURL("turn", "TURNS:turn.example.com:5349?transport=tcp"),
        ).toBe("turns:turn.example.com:5349?transport=tcp");
    });

    it("reads a host named like a scheme, followed by a port, as a host", () => {
        expect(iceServerURL("turn", "turn:3478")).toBe("turn:turn:3478");
        expect(iceServerURL("stun", "stun:3478")).toBe("stun:stun:3478");
    });
});
