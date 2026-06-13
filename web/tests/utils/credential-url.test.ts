import { describe, expect, it } from "@jest/globals";

import { normalizeCredentialUrl } from "../../src/utils/credential-url";

describe("normalizeCredentialUrl", () => {
    it("normalizes bare domains to https URLs", () => {
        expect(normalizeCredentialUrl("example.com/login")).toBe(
            "https://example.com/login",
        );
    });

    it("normalizes bare host and port values to https URLs", () => {
        expect(normalizeCredentialUrl("example.com:8443/login")).toBe(
            "https://example.com:8443/login",
        );
        expect(normalizeCredentialUrl("localhost:3000")).toBe(
            "https://localhost:3000/",
        );
    });

    it("keeps explicit https URLs", () => {
        expect(normalizeCredentialUrl("https://example.com/login?next=%2F")).toBe(
            "https://example.com/login?next=%2F",
        );
    });

    it("allows explicit http URLs", () => {
        expect(normalizeCredentialUrl("http://example.com")).toBe(
            "http://example.com/",
        );
    });

    it("allows embedded URL credentials for user-owned URLs", () => {
        expect(normalizeCredentialUrl("https://user:pass@example.com/login")).toBe(
            "https://user:pass@example.com/login",
        );
    });

    it("rejects javascript URLs", () => {
        expect(normalizeCredentialUrl("javascript:alert(1)")).toBeNull();
    });

    it("rejects data URLs", () => {
        expect(normalizeCredentialUrl("data:text/html,<script>alert(1)</script>"))
            .toBeNull();
    });

    it("rejects unsupported explicit schemes", () => {
        expect(normalizeCredentialUrl("ftp://example.com/file")).toBeNull();
        expect(normalizeCredentialUrl("mailto:user@example.com")).toBeNull();
    });

    it("rejects empty and invalid values", () => {
        expect(normalizeCredentialUrl("   ")).toBeNull();
        expect(normalizeCredentialUrl("https://")).toBeNull();
    });
});
