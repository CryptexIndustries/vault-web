/**
 * @jest-environment jsdom
 */
import { afterEach, describe, expect, it, jest } from "@jest/globals";

import {
    detectGroups,
    getInlineFieldMode,
    selectGeneratedPasswordFields,
    selectInlineMenuField,
    selectOtpField,
} from "../src/content/field-detector";

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
    delete (
        globalThis as typeof globalThis & {
            __CRYTEX_FIELD_DIAGNOSTICS__?: boolean;
        }
    ).__CRYTEX_FIELD_DIAGNOSTICS__;
    jest.restoreAllMocks();
});

describe("detectGroups", () => {
    it("ignores standalone email fields without login context", () => {
        mount('<input type="email" placeholder="Newsletter email" />');
        expect(detectGroups()).toHaveLength(0);
    });

    it("detects rendered login fields below the current viewport", () => {
        mount(`
            <form>
                <input type="text" name="username" />
                <input type="password" name="password" />
            </form>
        `);
        for (const input of document.querySelectorAll("input")) {
            input.getBoundingClientRect = () =>
                ({
                    width: 200,
                    height: 24,
                    top: 2_000,
                    left: 0,
                    right: 200,
                    bottom: 2_024,
                    x: 0,
                    y: 2_000,
                    toJSON: () => ({}),
                }) as DOMRect;
        }

        expect(detectGroups()).toHaveLength(1);
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

    it("detects an explicit username-only multi-step login", () => {
        mount(`
            <form>
                <input type="text" autocomplete="username" />
            </form>
        `);
        const groups = detectGroups();
        expect(groups).toHaveLength(1);
        expect(groups[0]?.anchor.kind).toBe("username");
    });

    it("detects an explicit email-only multi-step login", () => {
        mount(`
            <form>
                <input type="email" autocomplete="email" />
            </form>
        `);
        const groups = detectGroups();
        expect(groups).toHaveLength(1);
        expect(groups[0]?.anchor.kind).toBe("username");
    });

    it("detects a password-only multi-step login", () => {
        mount(`
            <form>
                <input type="password" autocomplete="current-password" />
            </form>
        `);
        const groups = detectGroups();
        expect(groups).toHaveLength(1);
        expect(groups[0]?.anchor.kind).toBe("password");
    });

    it("honors current-password autocomplete over exclusion keywords", () => {
        mount(`
            <form>
                <input
                    type="password"
                    name="access_token"
                    autocomplete="current-password"
                />
            </form>
        `);
        const groups = detectGroups();
        expect(groups).toHaveLength(1);
        expect(groups[0]?.anchor.kind).toBe("password");
    });

    it("honors new-password autocomplete over exclusion keywords", () => {
        mount(`
            <form>
                <input
                    type="password"
                    name="api_key"
                    autocomplete="new-password"
                />
            </form>
        `);
        const groups = detectGroups();
        expect(groups).toHaveLength(1);
        expect(groups[0]?.anchor.kind).toBe("newPassword");
        expect(groups[0]?.isSignup).toBe(true);
    });

    it("detects a password-only form with clear login context", () => {
        mount(`
            <form action="/login">
                <input type="password" />
            </form>
        `);
        expect(detectGroups()).toHaveLength(1);
    });

    it("ignores an unrelated password-only dialog", () => {
        mount(`
            <form aria-label="Unlock encrypted document">
                <input type="password" name="document_password" />
            </form>
        `);
        expect(detectGroups()).toHaveLength(0);
    });

    it("uses associated label text to identify username fields", () => {
        mount(`
            <form aria-label="Sign in">
                <label for="identity">Username</label>
                <input id="identity" type="text" />
            </form>
        `);
        expect(detectGroups()).toHaveLength(1);
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

describe("inline field actions", () => {
    it("keeps a picker on current-password and generators on new-password fields", () => {
        mount(`
            <form aria-label="Change password">
                <input
                    name="current"
                    type="password"
                    autocomplete="current-password"
                />
                <input
                    name="next"
                    type="password"
                    autocomplete="new-password"
                />
                <input
                    name="confirm"
                    type="password"
                    autocomplete="new-password"
                />
            </form>
        `);

        const group = detectGroups()[0]!;
        const current = group.fields.find(
            (field) => field.el.name === "current",
        )!;
        const next = group.fields.find((field) => field.el.name === "next")!;
        const confirm = group.fields.find(
            (field) => field.el.name === "confirm",
        )!;

        expect(group.isSignup).toBe(true);
        expect(getInlineFieldMode(group, current)).toBe("autofill");
        expect(getInlineFieldMode(group, next)).toBe("generator");
        expect(getInlineFieldMode(group, confirm)).toBe("generator");
        expect(selectGeneratedPasswordFields(group.fields)).toEqual([
            next,
            confirm,
        ]);
    });

    it("targets the exact clicked OTP field in a combined group", () => {
        mount(`
            <form>
                <input name="username" type="text" />
                <input name="password" type="password" />
                <input name="primary_otp" maxlength="6" type="text" />
                <input name="backup_otp" maxlength="6" type="text" />
            </form>
        `);

        const group = detectGroups()[0]!;
        const password = group.fields.find(
            (field) => field.el.name === "password",
        )!;
        const backupOtp = group.fields.find(
            (field) => field.el.name === "backup_otp",
        )!;

        expect(selectInlineMenuField(group.fields, password.el)).toBe(password);
        expect(selectInlineMenuField(group.fields, backupOtp.el)).toBe(
            backupOtp,
        );
        expect(selectOtpField(group.fields, backupOtp.el)).toBe(backupOtp);
    });

    it("retains generator fallback when no new-password field is identifiable", () => {
        mount(`
            <form>
                <input name="first_secret" type="password" />
                <input name="second_secret" type="password" />
            </form>
        `);

        const group = detectGroups()[0]!;
        expect(group.isSignup).toBe(true);
        expect(
            group.fields.map((field) => getInlineFieldMode(group, field)),
        ).toEqual(["generator", "generator"]);
        expect(selectGeneratedPasswordFields(group.fields)).toEqual(
            group.fields,
        );
    });
});

describe("development field diagnostics", () => {
    it("logs accepted and rejected decisions without input values", () => {
        mount(`
            <form id="login">
                <input name="username" type="text" />
                <input name="password" type="password" value="do-not-log" />
            </form>
            <input name="site_search" type="search" value="private query" />
        `);
        (
            globalThis as typeof globalThis & {
                __CRYTEX_FIELD_DIAGNOSTICS__?: boolean;
            }
        ).__CRYTEX_FIELD_DIAGNOSTICS__ = true;

        const groupSpy = jest
            .spyOn(console, "groupCollapsed")
            .mockImplementation(() => undefined);
        const infoSpy = jest
            .spyOn(console, "info")
            .mockImplementation(() => undefined);
        const tableSpy = jest
            .spyOn(console, "table")
            .mockImplementation(() => undefined);
        jest.spyOn(console, "groupEnd").mockImplementation(() => undefined);

        detectGroups();

        expect(groupSpy).toHaveBeenCalledTimes(1);
        expect(infoSpy).toHaveBeenCalledTimes(2);
        expect(tableSpy).toHaveBeenCalledTimes(2);

        const logged = JSON.stringify(tableSpy.mock.calls);
        expect(logged).toContain("icon:autofill");
        expect(logged).toContain("search input");
        expect(logged).not.toContain("do-not-log");
        expect(logged).not.toContain("private query");
        expect(logged).not.toContain('"value"');
    });
});
