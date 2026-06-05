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
     * The anchor field is the one the autofill icon attaches to. We
     * prefer username > password > otp because the username field is
     * the most prominent visually.
     */
    anchor: DetectedField;
    /**
     * `true` if any field carries `autocomplete="new-password"`. These
     * groups show a password generator on new-password fields and are
     * eligible for save-on-submit, but not for suggesting existing
     * credentials.
     */
    isSignup: boolean;
}

const USERNAME_HINT = /user|email|login|account|identifi|signin|usern/i;
const OTP_HINT = /otp|totp|one[-_ ]?time|verification[-_ ]?code|2fa|mfa|auth[-_ ]?code/i;
const SIGNUP_PASSWORD_HINT =
    /confirm|new[-_ ]?pass|signup|register|create[-_ ]?pass|repeat|re[-_ ]?enter/i;
const PAGE_SIGNUP_HINT =
    /sign.?up|register|create.?account|join|enroll|new.?user|get.?started/i;
const CONTAINER_SIGNUP_HINT =
    /sign\s*up|create\s+(an?\s+)?account|register|join\s+now|get\s+started/i;

let fieldIdCounter = 0;
let groupIdCounter = 0;
const nextFieldId = () => `cxf-${++fieldIdCounter}`;
const nextGroupId = () => `cxg-${++groupIdCounter}`;

/** Cache mapping detected DOM element → assigned field id so we can return stable ids across re-scans. */
const elementIdCache = new WeakMap<HTMLInputElement, string>();

/**
 * Cache mapping form container → group id. Without this, every rescan
 * mints a fresh groupId and the content script's reconcile loop treats
 * the previous group as gone, tears down the icon iframe, mounts a new
 * one, and the MutationObserver fires again — endless fetches of
 * autofill-icon.html.
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
    return new Set(
        raw
            .toLowerCase()
            .split(/\s+/)
            .filter(Boolean),
    );
}

function nameSignal(el: HTMLInputElement): string {
    return [
        el.name,
        el.id,
        el.getAttribute("placeholder") ?? "",
        el.getAttribute("aria-label") ?? "",
        el.getAttribute("data-testid") ?? "",
    ]
        .filter(Boolean)
        .join(" ");
}

/**
 * Returns `true` when the element is visible to the user. We rely on
 * `offsetParent` rather than `getComputedStyle` for performance — the
 * latter forces layout on every input on every mutation pass.
 */
export function isVisible(el: HTMLElement): boolean {
    if (el.hidden) return false;
    if (el.getAttribute("aria-hidden") === "true") return false;
    if ((el as HTMLInputElement).disabled) return false;
    // offsetParent is null for `display: none` and detached nodes (but
    // also for `position: fixed`; we accept that small false-negative).
    if (!el.offsetParent && el.offsetWidth === 0 && el.offsetHeight === 0) {
        return false;
    }
    const rect = el.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
}

function classifyInput(el: HTMLInputElement): FieldKind | null {
    if (el.readOnly || el.disabled) return null;

    const tokens = autocompleteTokens(el);
    const type = (el.type || "").toLowerCase();

    if (type === "password") {
        if (tokens.has("new-password")) return "newPassword";
        if (SIGNUP_PASSWORD_HINT.test(nameSignal(el))) return "newPassword";
        return "password";
    }

    if (tokens.has("one-time-code")) return "otp";

    if (type === "email" || tokens.has("email")) return "username";
    if (tokens.has("username")) return "username";

    if (type === "tel" || type === "text") {
        const hint = nameSignal(el);
        if (OTP_HINT.test(hint)) {
            const maxLen = el.maxLength > 0 ? el.maxLength : Infinity;
            if (maxLen <= 10) return "otp";
        }
        if (USERNAME_HINT.test(hint)) return "username";
    }

    return null;
}

/**
 * Depth-first walk that yields every `<input>` in the document
 * *including* those nested inside open shadow roots. We deliberately
 * skip `<iframe>` contents — those are addressed by per-frame content
 * script injection (currently top-frame only).
 */
function* walkInputs(root: ParentNode): IterableIterator<HTMLInputElement> {
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
            walker.tagName === "DIV" && walker.getAttribute("role") === "form"
        ) {
            return walker;
        }
        walker = walker.parentElement;
        hops++;
    }
    return el.parentElement ?? document.body;
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

    for (const input of walkInputs(document)) {
        if (!isVisible(input)) continue;
        const kind = classifyInput(input);
        if (!kind) continue;
        const detected: DetectedField = {
            el: input,
            kind,
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
        const hasCredField = fields.some(
            (f) =>
                f.kind === "username" ||
                f.kind === "password" ||
                f.kind === "newPassword" ||
                f.kind === "otp",
        );
        if (!hasCredField) continue;

        const passwordLike = fields.filter(
            (f) => f.kind === "password" || f.kind === "newPassword",
        );
        const hasUsername = fields.some((f) => f.kind === "username");
        const isSignup =
            fields.some((f) => f.kind === "newPassword") ||
            passwordLike.length >= 2 ||
            (passwordLike.length >= 1 &&
                hasUsername &&
                containerLooksLikeSignup(container));
        const anchor =
            fields.find((f) => f.kind === "username") ??
            fields.find((f) => f.kind === "password") ??
            fields.find((f) => f.kind === "newPassword") ??
            fields.find((f) => f.kind === "otp")!;

        groups.push({
            groupId: getGroupId(container),
            fields,
            anchor,
            isSignup,
        });
    }

    return groups;
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
