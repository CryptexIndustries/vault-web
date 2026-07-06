/**
 * @jest-environment jsdom
 */
import { afterEach, describe, expect, it } from "@jest/globals";

import { detectGroups } from "../src/content/field-detector";

function mount(html: string): void {
    document.body.innerHTML = html;
    for (const input of document.querySelectorAll("input")) {
        Object.defineProperty(input, "offsetParent", {
            configurable: true,
            value: document.body,
        });
        input.getBoundingClientRect = () =>
            ({
                width: 200,
                height: 24,
                top: 0,
                left: 0,
                right: 200,
                bottom: 24,
                x: 0,
                y: 0,
                toJSON: () => ({}),
            }) as DOMRect;
    }
}

afterEach(() => {
    document.body.innerHTML = "";
});

describe("detectGroups", () => {
    it("ignores standalone email fields without login context", () => {
        mount('<input type="email" placeholder="Newsletter email" />');
        expect(detectGroups()).toHaveLength(0);
    });

    it("ignores text fields whose hints only substring-match old user rule", () => {
        mount('<input type="text" name="user_comment" />');
        expect(detectGroups()).toHaveLength(0);
    });

    it("detects login forms with username hint and password", () => {
        mount(`
            <form>
                <input type="text" name="username" />
                <input type="password" name="password" />
            </form>
        `);
        const groups = detectGroups();
        expect(groups).toHaveLength(1);
        expect(groups[0]?.anchor.kind).toBe("username");
        expect(groups[0]?.isSignup).toBe(false);
    });

    it("promotes co-located email inputs when the container has a password", () => {
        mount(`
            <form>
                <input type="email" name="email" />
                <input type="password" name="password" />
            </form>
        `);
        const groups = detectGroups();
        expect(groups).toHaveLength(1);
        expect(groups[0]?.fields.some((f) => f.kind === "username")).toBe(true);
        expect(groups[0]?.fields.some((f) => f.kind === "password")).toBe(true);
    });

    it("detects strict OTP-only groups", () => {
        mount(
            '<form><input type="text" autocomplete="one-time-code" /></form>',
        );
        const groups = detectGroups();
        expect(groups).toHaveLength(1);
        expect(groups[0]?.anchor.kind).toBe("otp");
    });

    it("ignores loose OTP-like text fields without length cap", () => {
        mount(
            '<form><input type="text" name="verification_code" maxlength="20" /></form>',
        );
        expect(detectGroups()).toHaveLength(0);
    });

    it("ignores password fields without a username in non-signup containers", () => {
        mount('<form><input type="password" name="api_secret" /></form>');
        expect(detectGroups()).toHaveLength(0);
    });
});

describe("detectGroups adversarial inputs", () => {
    it("ignores shipping autocomplete email fields that are not login forms", () => {
        mount('<input type="text" autocomplete="shipping email" />');
        expect(detectGroups()).toHaveLength(0);
    });

    it("does not promote newsletter email when a hidden password shares the form", () => {
        mount(`
            <form>
                <input type="email" name="newsletter" />
                <input type="password" name="honeypot" hidden />
            </form>
        `);
        expect(detectGroups()).toHaveLength(0);
    });

    it("does not treat autocomplete=username alone as a login group", () => {
        mount(
            '<input type="search" autocomplete="username" name="site_search" />',
        );
        expect(detectGroups()).toHaveLength(0);
    });

    it("does not classify short discount codes as OTP-only login steps", () => {
        mount(`
            <form>
                <input type="text" name="discount_code" maxlength="6" />
            </form>
        `);
        expect(detectGroups()).toHaveLength(0);
    });

    it("keeps decoy username-like fields separate from a real login form", () => {
        mount(`
            <form id="feedback">
                <input type="text" placeholder="Email us your feedback" />
                <input type="text" name="user_comment" />
            </form>
            <form id="login">
                <input type="text" name="username" />
                <input type="password" name="password" />
            </form>
        `);
        const groups = detectGroups();
        expect(groups).toHaveLength(1);
        expect(
            groups[0]?.fields.map((field) => field.el.getAttribute("name")),
        ).toEqual(["username", "password"]);
    });
});
