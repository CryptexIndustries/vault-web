/**
 * DOM heuristics that turn an arbitrary web page into a structured list
 * of "autofillable groups". A group is the smallest set of inputs the
 * user thinks of as a single login form (username + password, with an
 * optional OTP field tacked on).
 *
 * Design notes:
 *   - We never read field *values* during detection so that this module
 *     can be invoked freely on every mutation without leaking secrets
 *     to extension scope.
 *   - Detection is intentionally conservative: it's far better to miss
 *     a non-standard form than to inject icons all over a page that
 *     doesn't actually accept a login.
 *   - Open shadow roots are traversed because modern SPAs frequently
 *     stuff inputs inside web components. Closed shadow roots are out
 *     of reach; that's a documented limitation.
 */

export type FieldKind = "username" | "password" | "newPassword" | "otp";

export interface DetectedField {
    el: HTMLInputElement;
    kind: FieldKind;
    /**
     * Stable identifier within a single page session. Used by the
     * content script to look up the matching DOM node from messages
     * that cross postMessage boundaries (where DOM refs can't travel).
     */
    fieldId: string;
}

export interface FieldGroup {
    /** Stable per-page identifier. */
    groupId: string;
    fields: DetectedField[];
    /**
     * Preferred representative for consumers that need one field from a
     * group. Inline controls are field-level and do not rely on this anchor.
     * Preference order is username > current password > new password > OTP.
     */
    anchor: DetectedField;
    /**
     * `true` if any field carries `autocomplete="new-password"`. These
     * groups show password generators on new-password fields and are eligible
     * for save-on-submit. A current-password field in the same group can still
     * show the existing-credential picker.
     */
    isSignup: boolean;
}

export type InlineFieldMode = "autofill" | "generator";

interface ClassificationResult {
    kind: FieldKind | null;
    reason: string;
}

interface FieldDetectionDiagnostic {
    element: string;
    result: string;
    kind: FieldKind | "-";
    reason: string;
    group: string;
    type: string;
    name: string;
    id: string;
    autocomplete: string;
}

const USERNAME_HINT =
    /\b(?:username|user[_-]?name|e[-_]?mail|login|sign[-_]?in|account|identifi(?:er|cation)?)\b/i;
const OTP_HINT =
    /otp|totp|one[-_ ]?time|verification[-_ ]?code|2fa|mfa|auth[-_ ]?code/i;
const SIGNUP_PASSWORD_HINT =
    /confirm|new[-_ ]?pass|signup|register|create[-_ ]?pass|repeat|re[-_ ]?enter/i;
const PAGE_SIGNUP_HINT =
    /sign.?up|register|create.?account|join|enroll|new.?user|get.?started/i;
const CONTAINER_SIGNUP_HINT =
    /sign\s*up|create\s+(an?\s+)?account|register|join\s+now|get\s+started/i;
const LOGIN_CONTEXT_HINT =
    /log\s*in|login|sign\s*in|signin|authenticate|account\s*access/i;
const NEWSLETTER_HINT = /newsletter|subscribe|mailing\s*list|marketing/i;
const PASSWORD_EXCLUDE_HINT =
    /api[-_ ]?(?:key|secret)|access[-_ ]?token|client[-_ ]?secret|encryption[-_ ]?key|private[-_ ]?key|pin[-_ ]?(?:code|number)/i;

let fieldIdCounter = 0;
let groupIdCounter = 0;
const nextFieldId = () => `cxf-${++fieldIdCounter}`;
const nextGroupId = () => `cxg-${++groupIdCounter}`;

/** Cache mapping detected DOM element → assigned field id so we can return stable ids across re-scans. */
const elementIdCache = new WeakMap<HTMLInputElement, string>();

/**
 * Cache mapping form container → group id. Stable group ids let the content
 * script reconcile dynamic forms without closing an active panel on every scan.
 */
const containerGroupIdCache = new WeakMap<Element, string>();

function getGroupId(container: Element): string {
    const cached = containerGroupIdCache.get(container);
    if (cached) return cached;
    const fresh = nextGroupId();
    containerGroupIdCache.set(container, fresh);
    return fresh;
}

function getFieldId(el: HTMLInputElement): string {
    const cached = elementIdCache.get(el);
    if (cached) return cached;
    const fresh = nextFieldId();
    elementIdCache.set(el, fresh);
    return fresh;
}

/**
 * Reads the autocomplete attribute as a normalised token set. Browsers
 * accept space-separated tokens (`"shipping email"`) so we tokenise on
 * whitespace.
 */
function autocompleteTokens(el: HTMLInputElement): Set<string> {
    const raw = el.getAttribute("autocomplete") ?? "";
    return new Set(raw.toLowerCase().split(/\s+/).filter(Boolean));
}

function nameSignal(el: HTMLInputElement): string {
    const labels = Array.from(el.labels ?? [])
        .map((label) => label.textContent ?? "")
        .filter(Boolean);

    return [
        el.name,
        el.id,
        el.getAttribute("placeholder") ?? "",
        el.getAttribute("aria-label") ?? "",
        el.getAttribute("data-testid") ?? "",
        ...labels,
    ]
        .filter(Boolean)
        .join(" ");
}

/**
 * Checks the visibility of an element.
 * @param el - The element to check the visibility of.
 * @returns A string describing the reason the element is not visible, or `null` if it is visible.
 */
function visibilityRejectionReason(el: HTMLElement): string | null {
    if (el.hidden) return "hidden attribute";

    // Check for various visibility properties
    if (
        typeof el.checkVisibility === "function" &&
        !el.checkVisibility({ visibilityProperty: true })
    ) {
        return "field CSS visibility check failed";
    }

    if (el.getAttribute("aria-hidden") === "true") return "aria-hidden=true";
    if ((el as HTMLInputElement).disabled) return "disabled";
    // offsetParent is null for `display: none` and detached nodes (but
    // also for `position: fixed`; we accept that small false-negative).
    if (!el.offsetParent && el.offsetWidth === 0 && el.offsetHeight === 0) {
        return "not rendered (no offset parent or dimensions)";
    }
    const rect = el.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return "zero-size client rect";
    return null;
}

/**
 * Returns `true` when the element is visible to the user. We rely on
 * `offsetParent` rather than `getComputedStyle` for performance — the
 * latter forces layout on every input on every mutation pass.
 */
export function isVisible(el: HTMLElement): boolean {
    return visibilityRejectionReason(el) === null;
}

function classifyInput(el: HTMLInputElement): ClassificationResult {
    if (el.readOnly) return { kind: null, reason: "readonly" };
    if (el.disabled) return { kind: null, reason: "disabled" };

    const tokens = autocompleteTokens(el);
    const type = (el.type || "").toLowerCase();

    if (type === "search" || tokens.has("shipping") || tokens.has("billing")) {
        return {
            kind: null,
            reason:
                type === "search"
                    ? "search input"
                    : "shipping/billing autocomplete scope",
        };
    }

    if (type === "password") {
        if (tokens.has("new-password")) {
            return {
                kind: "newPassword",
                reason: "autocomplete=new-password",
            };
        }
        if (tokens.has("current-password")) {
            return {
                kind: "password",
                reason: "autocomplete=current-password",
            };
        }
        if (PASSWORD_EXCLUDE_HINT.test(nameSignal(el))) {
            return {
                kind: null,
                reason: "name/label matched API key, token, secret, or PIN exclusion",
            };
        }
        if (SIGNUP_PASSWORD_HINT.test(nameSignal(el))) {
            return {
                kind: "newPassword",
                reason: "name/label matched new-password heuristic",
            };
        }
        return { kind: "password", reason: "generic password input" };
    }

    if (tokens.has("one-time-code")) {
        return { kind: "otp", reason: "autocomplete=one-time-code" };
    }

    if (tokens.has("username")) {
        return { kind: "username", reason: "autocomplete=username" };
    }
    if (tokens.has("email")) {
        return { kind: "username", reason: "autocomplete=email" };
    }

    if (type === "tel" || type === "text" || type === "email") {
        const hint = nameSignal(el);
        if (OTP_HINT.test(hint)) {
            const maxLen = el.maxLength > 0 ? el.maxLength : Infinity;
            if (maxLen <= 10) {
                return {
                    kind: "otp",
                    reason: `OTP name/label heuristic with maxlength=${maxLen}`,
                };
            }
        }
        if (USERNAME_HINT.test(hint)) {
            return {
                kind: "username",
                reason: "username/email name or label heuristic",
            };
        }
    }

    return { kind: null, reason: "no credential-field signal matched" };
}

function containerSignal(container: Element): string {
    const form = container instanceof HTMLFormElement ? container : null;
    return [
        container.id,
        container.getAttribute("name") ?? "",
        container.getAttribute("aria-label") ?? "",
        form?.action ?? "",
        container.textContent?.slice(0, 4000) ?? "",
    ]
        .filter(Boolean)
        .join(" ");
}

/**
 * Treat a username field as a possible multi-step login even when
 * the password input has not been rendered yet and require an
 * explicit browser hint or login context so ordinary email and
 * newsletter fields do not receive credential buttons.
 */
function isUsernameOnlyLogin(
    container: Element,
    fields: DetectedField[],
): boolean {
    const usernames = fields.filter((field) => field.kind === "username");
    if (usernames.length === 0) return false;

    const context = containerSignal(container);
    if (NEWSLETTER_HINT.test(context)) return false;
    if (LOGIN_CONTEXT_HINT.test(context)) return true;

    return usernames.some((field) => {
        const tokens = autocompleteTokens(field.el);
        return (
            tokens.has("username") ||
            tokens.has("email") ||
            tokens.has("webauthn")
        );
    });
}

/**
 * A lone password input is ambiguous: it may be a login step, but it may also
 * unlock an encrypted document or confirm an account-setting change. Only
 * accept it when the page author marks it as the current login password or the
 * containing form provides clear login context.
 */
function isPasswordOnlyLogin(
    container: Element,
    fields: DetectedField[],
): boolean {
    const passwords = fields.filter((field) => field.kind === "password");
    if (passwords.length === 0) return false;

    if (
        passwords.some((field) =>
            autocompleteTokens(field.el).has("current-password"),
        )
    ) {
        return true;
    }

    return LOGIN_CONTEXT_HINT.test(containerSignal(container));
}

/**
 * Depth-first walk that yields every `<input>` in the document
 * *including* those nested inside open shadow roots. We deliberately
 * skip `<iframe>` contents — those are addressed by per-frame content
 * script injection (currently top-frame only).
 */
function* walkInputs(
    root: ParentNode = document,
): IterableIterator<HTMLInputElement> {
    const stack: ParentNode[] = [root];
    while (stack.length) {
        const node = stack.pop()!;
        const inputs = (node as Element).querySelectorAll
            ? (node as Element).querySelectorAll("input")
            : ([] as unknown as NodeListOf<HTMLInputElement>);
        for (let i = 0; i < inputs.length; i++) {
            yield inputs[i] as HTMLInputElement;
        }

        const all = (node as Element).querySelectorAll
            ? (node as Element).querySelectorAll("*")
            : ([] as unknown as NodeListOf<Element>);
        for (let i = 0; i < all.length; i++) {
            const sr = (all[i] as Element).shadowRoot;
            if (sr) stack.push(sr);
        }
    }
}

/**
 * Picks the most specific common ancestor we should use to bucket a
 * cluster of fields into a "form". Real `<form>` wins; otherwise we
 * fall back to a small ancestor walk capped at 8 levels to avoid
 * accidentally clustering unrelated forms on the same page.
 */
function containerLooksLikeSignup(container: Element): boolean {
    const path = `${window.location.pathname}${window.location.search}`;
    if (PAGE_SIGNUP_HINT.test(path)) return true;

    const text = container.textContent?.slice(0, 4000) ?? "";
    return CONTAINER_SIGNUP_HINT.test(text);
}

function groupContainer(el: HTMLInputElement): Element {
    const form = el.form;
    if (form) return form;
    let walker: HTMLElement | null = el.parentElement;
    let hops = 0;
    while (walker && hops < 8) {
        if (
            walker.tagName === "SECTION" ||
            walker.tagName === "FIELDSET" ||
            (walker.tagName === "DIV" && walker.getAttribute("role") === "form")
        ) {
            return walker;
        }
        walker = walker.parentElement;
        hops++;
    }
    return el.parentElement ?? document.body;
}

/**
 * Login forms often use `type="email"` without autocomplete hints. Once
 * we know the container has a password field, treat co-located email
 * inputs as the username anchor.
 */
function promoteCoLocatedEmailUsernames(
    container: Element,
    fields: DetectedField[],
): void {
    const hasPasswordLike = fields.some(
        (f) => f.kind === "password" || f.kind === "newPassword",
    );
    if (!hasPasswordLike) return;

    const seen = new Set(fields.map((f) => f.el));
    for (const input of walkInputs(container)) {
        if ((input.type || "").toLowerCase() !== "email") continue;
        if (input.readOnly || input.disabled || !isVisible(input)) continue;
        if (seen.has(input)) continue;
        fields.push({
            el: input,
            kind: "username",
            fieldId: getFieldId(input),
        });
        seen.add(input);
    }
}

function fieldDiagnosticsEnabled(): boolean {
    return (
        (
            globalThis as typeof globalThis & {
                __CRYTEX_FIELD_DIAGNOSTICS__?: boolean;
            }
        ).__CRYTEX_FIELD_DIAGNOSTICS__ === true
    );
}

function describeContainer(container: Element): string {
    const id = container.id ? `#${container.id}` : "";
    const name = container.getAttribute("name");
    const named = name ? `[name=${JSON.stringify(name)}]` : "";
    return `${container.tagName.toLowerCase()}${id}${named}`;
}

function createDiagnostic(
    element: HTMLInputElement,
    result: string,
    kind: FieldKind | "-",
    reason: string,
): FieldDetectionDiagnostic {
    const elementId = element.id ? `#${element.id}` : "";
    const elementName = element.name
        ? `[name=${JSON.stringify(element.name)}]`
        : "";
    return {
        element: `input${elementId}${elementName}`,
        result,
        kind,
        reason,
        group: "-",
        type: (element.type || "text").toLowerCase(),
        name: element.name,
        id: element.id,
        autocomplete: element.getAttribute("autocomplete") ?? "",
    };
}

function emitFieldDetectionDiagnostics(
    diagnostics: FieldDetectionDiagnostic[],
): void {
    const accepted = diagnostics.filter((entry) => entry.result !== "rejected");
    const rejected = diagnostics.filter((entry) => entry.result === "rejected");
    const iconCount = accepted.filter((entry) =>
        entry.result.startsWith("icon:"),
    ).length;

    console.groupCollapsed(
        `[Cryptex autofill] field scan: ${iconCount} icon(s), ` +
            `${accepted.length - iconCount} accepted without icon, ` +
            `${rejected.length} rejected`,
    );
    if (accepted.length > 0) {
        console.info(
            "Accepted fields and icon decisions (input values omitted)",
        );
        console.table(accepted);
    }
    if (rejected.length > 0) {
        console.info("Rejected fields (input values omitted)");
        console.table(rejected);
    }
    console.groupEnd();
}

/**
 * Scans the document for autofillable fields and clusters them into
 * groups. Each call returns a fresh array but reuses field ids across
 * calls (via the WeakMap) so the content script can reconcile groups
 * between scans.
 */
export function detectGroups(): FieldGroup[] {
    if (typeof document === "undefined") return [];

    const fieldsByContainer = new Map<Element, DetectedField[]>();
    const diagnostics = fieldDiagnosticsEnabled()
        ? new Map<HTMLInputElement, FieldDetectionDiagnostic>()
        : null;

    for (const input of walkInputs(document)) {
        const visibilityReason = visibilityRejectionReason(input);
        if (visibilityReason) {
            diagnostics?.set(
                input,
                createDiagnostic(input, "rejected", "-", visibilityReason),
            );
            continue;
        }
        const classification = classifyInput(input);
        diagnostics?.set(
            input,
            createDiagnostic(
                input,
                classification.kind ? "classified" : "rejected",
                classification.kind ?? "-",
                classification.reason,
            ),
        );
        if (!classification.kind) continue;
        const detected: DetectedField = {
            el: input,
            kind: classification.kind,
            fieldId: getFieldId(input),
        };
        const container = groupContainer(input);
        const bucket = fieldsByContainer.get(container);
        if (bucket) {
            bucket.push(detected);
        } else {
            fieldsByContainer.set(container, [detected]);
        }
    }

    const groups: FieldGroup[] = [];
    for (const [container, fields] of fieldsByContainer) {
        promoteCoLocatedEmailUsernames(container, fields);
        for (const field of fields) {
            if (!diagnostics) continue;
            const existingDiagnostic = diagnostics.get(field.el);
            if (existingDiagnostic?.kind !== "-") continue;
            const promotedDiagnostic = createDiagnostic(
                field.el,
                "classified",
                field.kind,
                "promoted type=email because its container has a password",
            );
            diagnostics.set(field.el, promotedDiagnostic);
        }

        const passwordLike = fields.filter(
            (f) => f.kind === "password" || f.kind === "newPassword",
        );
        const hasUsername = fields.some((f) => f.kind === "username");
        const otpFields = fields.filter((f) => f.kind === "otp");
        const isSignup =
            fields.some((f) => f.kind === "newPassword") ||
            passwordLike.length >= 2 ||
            (passwordLike.length >= 1 &&
                hasUsername &&
                containerLooksLikeSignup(container));

        const isOtpOnly =
            otpFields.length > 0 && passwordLike.length === 0 && !hasUsername;

        let accepted = true;
        let groupReason: string;
        if (isSignup) {
            accepted = passwordLike.length > 0;
            groupReason = fields.some((field) => field.kind === "newPassword")
                ? "signup/change-password: newPassword field present"
                : passwordLike.length >= 2
                  ? "signup/change-password: multiple password fields"
                  : "signup/change-password: signup context with username and password";
        } else if (isOtpOnly) {
            groupReason = "strict OTP-only step";
        } else if (!hasUsername && passwordLike.length > 0) {
            accepted = isPasswordOnlyLogin(container, fields);
            groupReason = accepted
                ? "password-only login with current-password metadata or login context"
                : "password-only group lacks current-password metadata or login context";
        } else if (passwordLike.length === 0) {
            accepted = hasUsername && isUsernameOnlyLogin(container, fields);
            groupReason = accepted
                ? "username/email-only login with explicit metadata or login context"
                : "username/email-only group lacks login evidence or matched newsletter context";
        } else {
            groupReason = "username and password are co-located";
        }

        const containerDescription = describeContainer(container);
        if (!accepted) {
            for (const field of fields) {
                const diagnostic = diagnostics?.get(field.el);
                if (!diagnostic) continue;
                diagnostic.result = "rejected";
                diagnostic.group = containerDescription;
                diagnostic.reason += `; group rejected: ${groupReason}`;
            }
            continue;
        }

        const anchor =
            fields.find((f) => f.kind === "username") ??
            fields.find((f) => f.kind === "password") ??
            fields.find((f) => f.kind === "newPassword") ??
            otpFields[0]!;

        const group: FieldGroup = {
            groupId: getGroupId(container),
            fields,
            anchor,
            isSignup,
        };
        groups.push(group);

        for (const field of fields) {
            const diagnostic = diagnostics?.get(field.el);
            if (!diagnostic) continue;
            const mode = getInlineFieldMode(group, field);
            diagnostic.result = mode ? `icon:${mode}` : "accepted:no-icon";
            diagnostic.group = `${group.groupId} (${containerDescription})`;
            diagnostic.reason += `; group accepted: ${groupReason}; `;
            diagnostic.reason += mode
                ? `inline control=${mode}`
                : "group field has no inline control under current policy";
        }
    }

    if (diagnostics) {
        emitFieldDetectionDiagnostics([...diagnostics.values()]);
    }
    return groups;
}

/**
 * Chooses the inline control for a qualified field. Change-password forms are
 * deliberately split: the current password can pick an existing credential,
 * while only new-password fields offer generation.
 */
export function getInlineFieldMode(
    group: FieldGroup,
    field: DetectedField,
): InlineFieldMode | null {
    if (!group.isSignup) return "autofill";
    if (field.kind === "newPassword") return "generator";
    if (
        field.kind === "password" &&
        autocompleteTokens(field.el).has("current-password")
    ) {
        return "autofill";
    }
    const hasClassifiedNewPassword = group.fields.some(
        (candidate) => candidate.kind === "newPassword",
    );
    if (!hasClassifiedNewPassword && field.kind === "password") {
        return "generator";
    }
    return null;
}

/** Resolves menu state from the exact inline control the user clicked. */
export function selectInlineMenuField(
    fields: DetectedField[],
    targetField: HTMLInputElement,
): DetectedField | undefined {
    return fields.find((field) => field.el === targetField);
}

/** Selects fields that should receive one generated value. */
export function selectGeneratedPasswordFields(
    fields: DetectedField[],
): DetectedField[] {
    const newPasswordFields = fields.filter(
        (field) => field.kind === "newPassword",
    );
    if (newPasswordFields.length > 0) return newPasswordFields;
    return fields.filter((field) => field.kind === "password");
}

/** Selects the clicked OTP input, falling back only for legacy callers. */
export function selectOtpField(
    fields: DetectedField[],
    targetField?: HTMLInputElement,
): DetectedField | undefined {
    return (
        fields.find(
            (field) => field.kind === "otp" && field.el === targetField,
        ) ?? fields.find((field) => field.kind === "otp")
    );
}

/**
 * Programmatically sets an `<input>`'s value in a way that React,
 * Vue, and Svelte all pick up. The naive `el.value = x` skips React's
 * internal value tracker, so React reverts the change on the next
 * render. We use the `HTMLInputElement` prototype setter as recommended
 * by the React team.
 */
export function setInputValue(el: HTMLInputElement, value: string): void {
    const proto = Object.getPrototypeOf(el);
    const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
    if (setter) {
        setter.call(el, value);
    } else {
        el.value = value;
    }
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
}
