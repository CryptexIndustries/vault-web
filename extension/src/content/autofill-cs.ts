/**
 * Cryptex Vault autofill content script.
 *
 * Runs in the isolated world of every top-level http(s) frame and is
 * responsible for:
 *   - detecting login, signup, and OTP fields in the host page
 *   - tracking qualified fields and showing one control on the active field
 *   - opening the matching inline panel beside that field
 *   - filling selected credentials and wiping local references
 *   - prompting the user to save new credentials on form submit
 *
 * Security choices (mirrors `extension/docs/autofill/README.md`):
 *   - Top-frame only. Sub-frames cannot run autofill UI; the SW also
 *     enforces this via `sender.frameId === 0`.
 *   - All sensitive traffic with the SW uses the same envelope-encrypted
 *     transport as the popup. The shared client is configured with
 *     `setEnvelopeOriginOverride("autofill-cs")` so the SW recognises us.
 *   - Sensitive iframe contents are loaded from the extension origin and
 *     isolated from the host page. Communication uses `MessageChannel` ports;
 *     each iframe first claims a SW-backed nonce before accepting `init`.
 *   - Credential secrets only live in local variables for the duration
 *     of a single fill, then references are cleared so GC can collect
 *     them. (JS strings are immutable; "wipe" amounts to dropping refs
 *     promptly and never keeping module-scoped copies.)
 */

import {
    ACTIVE_PAGE_ORIGIN_QUERY,
    MessageType,
    type GenerateTOTPResponse,
    type GetCredentialsForOriginResponse,
    type GetCredentialSecretResponse,
    type PendingSavePrompt,
} from "../types/sw-messaging";
import {
    sendEncryptedEnvelopeToSW,
    setEnvelopeOriginOverride,
} from "../utils/sw-envelope-client";
import {
    createAutofillFrameBootstrap,
    withAutofillFrameMount,
    type AutofillFrameBootstrap,
} from "../utils/autofill-frame-bootstrap";
import {
    detectGroups,
    getInlineFieldMode,
    selectGeneratedPasswordFields,
    selectInlineMenuField,
    selectOtpField,
    setInputValue,
    type FieldGroup,
    type FieldKind,
} from "./field-detector";
import {
    createInlineIcon,
    type InlineIconController,
    type InlineIconMode,
} from "./inline-icon";
import { getEffectiveOrigin, isTopFrame } from "./origin-utils";

setEnvelopeOriginOverride("autofill-cs");

chrome.runtime.onMessage.addListener(
    (message: unknown, sender: chrome.runtime.MessageSender, sendResponse) => {
        const request = message as { kind?: unknown } | null;
        if (
            request?.kind !== ACTIVE_PAGE_ORIGIN_QUERY ||
            sender.id !== chrome.runtime.id
        ) {
            return;
        }

        sendResponse(getEffectiveOrigin());
    },
);

const MENU_WIDTH_PX = 280;
const MENU_HEIGHT_PX = 320;
const GENERATOR_WIDTH_PX = 280;
const GENERATOR_HEIGHT_PX = 360;
const SAVE_WIDTH_PX = 360;
const SAVE_INITIAL_HEIGHT_PX = 200;
const SAVE_MIN_HEIGHT_PX = 120;
const SAVE_VIEWPORT_PADDING_PX = 32;
const SAVE_SHOW_DEFER_MS = 150;
const SAVE_SHOW_RETRY_MS = [0, 150, 400] as const;
const MUTATION_DEBOUNCE_MS = 150;
const UNLOCK_POLL_INTERVAL_MS = 750;
const UNLOCK_POLL_TIMEOUT_MS = 90_000;

const MENU_URL = chrome.runtime.getURL("/autofill-menu.html");
const GENERATOR_URL = chrome.runtime.getURL("/autofill-generator.html");
const SAVE_URL = chrome.runtime.getURL("/autofill-save.html");
const EXTENSION_ORIGIN = new URL(chrome.runtime.getURL("/")).origin;

interface IconHandle extends InlineIconController {
    fieldKind: FieldKind;
    groupId: string;
    mode: InlineIconMode;
}

interface TrackedInlineField {
    fieldKind: FieldKind;
    groupId: string;
    mode: InlineIconMode;
}

const trackedFields = new Map<HTMLInputElement, TrackedInlineField>();
const fieldListenerControllers = new Map<HTMLInputElement, AbortController>();
const trackedGroups = new Map<string, FieldGroup>();
let activeIcon: IconHandle | null = null;

function postBootstrapInit(
    iframe: HTMLIFrameElement,
    bootstrap: AutofillFrameBootstrap,
    port: MessagePort,
): void {
    iframe.contentWindow?.postMessage(
        {
            kind: "init",
            mountId: bootstrap.mountId,
            nonce: bootstrap.nonce,
        },
        EXTENSION_ORIGIN,
        [port],
    );
}

/**
 * Tracks credentials that were autofilled into a given field set so we
 * can suppress the save-prompt when the user submits an unchanged form
 * (otherwise we'd nag for every successful login).
 */
const lastFilledByGroup = new Map<
    string,
    { username: string; password: string }
>();

let menuIframe: HTMLIFrameElement | null = null;
let menuPort: MessagePort | null = null;
let menuActiveGroup: FieldGroup | null = null;
let menuActiveIcon: IconHandle | null = null;
let generatorIframe: HTMLIFrameElement | null = null;
let generatorPort: MessagePort | null = null;
let generatorActiveIcon: IconHandle | null = null;
let menuHandshakeListener: ((event: MessageEvent) => void) | null = null;
let generatorHandshakeListener: ((event: MessageEvent) => void) | null = null;
let saveHandshakeListener: ((event: MessageEvent) => void) | null = null;
let menuMountToken = 0;
let generatorMountToken = 0;
let menuLockPollTimer: number | null = null;
let menuLockPollStartedAt = 0;
let saveIframe: HTMLIFrameElement | null = null;
let savePort: MessagePort | null = null;
let saveMountToken = 0;
let initialised = false;

function shouldRun(): boolean {
    if (!isTopFrame()) return false;
    if (
        window.location.protocol !== "http:" &&
        window.location.protocol !== "https:"
    ) {
        return false;
    }
    return true;
}

/* -------------------------------------------------------------------------- */
/* Inline control                                                              */
/* -------------------------------------------------------------------------- */

function fieldHasOpenPanel(field: HTMLInputElement): boolean {
    return (
        menuActiveIcon?.field === field || generatorActiveIcon?.field === field
    );
}

function detachActiveIcon(field?: HTMLInputElement): void {
    if (!activeIcon || (field && activeIcon.field !== field)) return;
    activeIcon.destroy();
    activeIcon = null;
}

function detachIconWhenInactive(field: HTMLInputElement): void {
    window.setTimeout(() => {
        if (document.activeElement !== field && !fieldHasOpenPanel(field)) {
            detachActiveIcon(field);
        }
    }, 0);
}

function attachIconForField(field: HTMLInputElement): IconHandle | null {
    const tracked = trackedFields.get(field);
    if (!tracked || !field.isConnected) return null;

    if (
        activeIcon?.field === field &&
        activeIcon.mode === tracked.mode &&
        activeIcon.fieldKind === tracked.fieldKind &&
        activeIcon.groupId === tracked.groupId
    ) {
        activeIcon.reposition();
        return activeIcon;
    }

    if (activeIcon?.field !== field) {
        closeMenu();
        closeGenerator();
    }
    detachActiveIcon();

    let handle: IconHandle;
    const controller = createInlineIcon({
        field,
        mode: tracked.mode,
        onClick: () => void handleIconClick(handle),
    });
    handle = {
        ...controller,
        fieldKind: tracked.fieldKind,
        groupId: tracked.groupId,
        mode: tracked.mode,
    };
    activeIcon = handle;
    return handle;
}

function trackInlineField(
    group: FieldGroup,
    field: HTMLInputElement,
    fieldKind: FieldKind,
    mode: InlineIconMode,
): void {
    trackedFields.set(field, {
        fieldKind,
        groupId: group.groupId,
        mode,
    });

    if (fieldListenerControllers.has(field)) {
        if (activeIcon?.field === field) attachIconForField(field);
        return;
    }

    const controller = new AbortController();
    const options = { signal: controller.signal };
    field.addEventListener("focus", () => attachIconForField(field), options);
    field.addEventListener(
        "mousedown",
        () => attachIconForField(field),
        options,
    );
    field.addEventListener(
        "blur",
        () => detachIconWhenInactive(field),
        options,
    );
    fieldListenerControllers.set(field, controller);

    if (document.activeElement === field) attachIconForField(field);
}

function untrackInlineField(field: HTMLInputElement): void {
    trackedFields.delete(field);
    fieldListenerControllers.get(field)?.abort();
    fieldListenerControllers.delete(field);
    if (activeIcon?.field === field) {
        closeMenu();
        closeGenerator();
        detachActiveIcon(field);
    }
}

/* -------------------------------------------------------------------------- */
/* Menu mounting                                                               */
/* -------------------------------------------------------------------------- */

function closeMenu(): void {
    const field = menuActiveIcon?.field;
    menuMountToken += 1;
    if (menuHandshakeListener) {
        window.removeEventListener("message", menuHandshakeListener);
        menuHandshakeListener = null;
    }
    if (menuLockPollTimer != null) {
        window.clearTimeout(menuLockPollTimer);
        menuLockPollTimer = null;
    }
    if (menuPort) {
        menuPort.close();
        menuPort = null;
    }
    if (menuIframe) {
        menuIframe.remove();
        menuIframe = null;
    }
    menuActiveGroup = null;
    menuActiveIcon = null;
    document.removeEventListener("mousedown", onDocumentMouseDown, true);
    document.removeEventListener("keydown", onDocumentKeyDown, true);
    if (field) detachIconWhenInactive(field);
}

function closeGenerator(): void {
    const field = generatorActiveIcon?.field;
    generatorMountToken += 1;
    if (generatorHandshakeListener) {
        window.removeEventListener("message", generatorHandshakeListener);
        generatorHandshakeListener = null;
    }
    if (generatorPort) {
        generatorPort.close();
        generatorPort = null;
    }
    if (generatorIframe) {
        generatorIframe.remove();
        generatorIframe = null;
    }
    generatorActiveIcon = null;
    document.removeEventListener(
        "mousedown",
        onGeneratorDocumentMouseDown,
        true,
    );
    document.removeEventListener("keydown", onGeneratorDocumentKeyDown, true);
    if (field) detachIconWhenInactive(field);
}

function positionPanelNearField(
    iframe: HTMLIFrameElement,
    field: HTMLInputElement,
    widthPx: number,
    heightPx: number,
): void {
    const rect = field.getBoundingClientRect();
    const viewportHeight =
        window.innerHeight || document.documentElement.clientHeight;
    const viewportWidth =
        window.innerWidth || document.documentElement.clientWidth;
    const spaceBelow = viewportHeight - rect.bottom;
    const placeAbove = spaceBelow < heightPx && rect.top > heightPx;

    const top = placeAbove
        ? rect.top + window.scrollY - heightPx - 4
        : rect.bottom + window.scrollY + 4;
    const left = Math.min(
        rect.left + window.scrollX,
        viewportWidth + window.scrollX - widthPx - 8,
    );

    iframe.style.top = `${Math.max(top, window.scrollY)}px`;
    iframe.style.left = `${Math.max(left, window.scrollX)}px`;
    iframe.style.width = `${widthPx}px`;
    iframe.style.height = `${heightPx}px`;
}

function positionMenuNearField(
    iframe: HTMLIFrameElement,
    field: HTMLInputElement,
): void {
    positionPanelNearField(iframe, field, MENU_WIDTH_PX, MENU_HEIGHT_PX);
}

function positionGeneratorNearField(
    iframe: HTMLIFrameElement,
    field: HTMLInputElement,
): void {
    positionPanelNearField(
        iframe,
        field,
        GENERATOR_WIDTH_PX,
        GENERATOR_HEIGHT_PX,
    );
}

function onGeneratorDocumentMouseDown(event: MouseEvent): void {
    if (!generatorIframe) return;
    const target = event.target as Node | null;
    if (target instanceof Node && generatorIframe.contains(target)) return;
    const path = event.composedPath?.() ?? [];
    if (
        path.some(
            (n) =>
                n instanceof Element &&
                n.getAttribute?.("data-cryptex-autofill") === "icon",
        )
    ) {
        return;
    }
    closeGenerator();
}

function onGeneratorDocumentKeyDown(event: KeyboardEvent): void {
    if (event.key === "Escape" && generatorIframe) {
        closeGenerator();
    }
}

async function openGeneratorForField(icon: IconHandle): Promise<void> {
    closeMenu();
    if (generatorIframe && generatorActiveIcon?.field === icon.field) {
        closeGenerator();
        return;
    }
    closeGenerator();
    const token = generatorMountToken;

    const group = trackedGroups.get(icon.groupId);
    if (!group) return;

    const bootstrap = await createAutofillFrameBootstrap("autofill-generator");
    if (
        !bootstrap ||
        token !== generatorMountToken ||
        activeIcon !== icon ||
        !icon.field.isConnected
    ) {
        return;
    }

    const iframe = document.createElement("iframe");
    iframe.src = withAutofillFrameMount(GENERATOR_URL, bootstrap.mountId);
    iframe.setAttribute("data-cryptex-autofill", "generator");
    iframe.style.cssText = [
        "position: absolute",
        "border: 0",
        "background: transparent",
        "color-scheme: dark",
        "z-index: 2147483647",
        "pointer-events: auto",
        "border-radius: 6px",
        "box-shadow: 0 12px 32px rgba(0,0,0,0.4)",
    ].join(";");
    document.documentElement.appendChild(iframe);
    positionGeneratorNearField(iframe, icon.field);
    generatorIframe = iframe;
    generatorActiveIcon = icon;

    generatorHandshakeListener = (event: MessageEvent) => {
        if (event.source !== iframe.contentWindow) return;
        const data = event.data as { kind?: string } | undefined;
        if (data?.kind !== "ready") return;
        if (event.origin !== EXTENSION_ORIGIN) return;
        if (generatorHandshakeListener) {
            window.removeEventListener("message", generatorHandshakeListener);
            generatorHandshakeListener = null;
        }
        const channel = new MessageChannel();
        generatorPort = channel.port1;
        channel.port1.onmessage = (ev) => {
            void handleGeneratorMessage(ev.data, icon, group);
        };
        channel.port1.start();
        postBootstrapInit(iframe, bootstrap, channel.port2);
        try {
            generatorPort.postMessage({ kind: "init" });
        } catch (err) {
            console.debug("[autofill-cs] generator init failed", err);
        }
    };
    window.addEventListener("message", generatorHandshakeListener);

    document.addEventListener("mousedown", onGeneratorDocumentMouseDown, true);
    document.addEventListener("keydown", onGeneratorDocumentKeyDown, true);
}

async function handleGeneratorMessage(
    raw: unknown,
    icon: IconHandle,
    group: FieldGroup,
): Promise<void> {
    const data = raw as
        | { kind: "use"; password: string }
        | { kind: "close" }
        | undefined;
    if (!data || typeof data !== "object") return;

    if (data.kind === "close") {
        closeGenerator();
        return;
    }

    if (data.kind === "use" && typeof data.password === "string") {
        fillGeneratedPassword(group, icon.field, data.password);
        closeGenerator();
    }
}

function fillGeneratedPassword(
    group: FieldGroup,
    anchorField: HTMLInputElement,
    password: string,
): void {
    const liveFields = group.fields.filter((f) => f.el.isConnected);
    const passwordFields = selectGeneratedPasswordFields(liveFields);

    for (const field of passwordFields) {
        setInputValue(field.el, password);
    }

    anchorField.focus();
}

async function openMenuForIcon(
    icon: IconHandle,
    group: FieldGroup,
): Promise<void> {
    closeMenu();
    closeGenerator();
    const token = menuMountToken;

    const origin = getEffectiveOrigin();
    if (!origin) return;

    const menuField = selectInlineMenuField(group.fields, icon.field);
    if (!menuField) return;

    const lockedRes = await fetchVaultLocked();
    if (lockedRes === null) return;

    const bootstrap = await createAutofillFrameBootstrap("autofill-menu");
    if (
        !bootstrap ||
        token !== menuMountToken ||
        activeIcon !== icon ||
        !icon.field.isConnected
    ) {
        return;
    }

    const iframe = document.createElement("iframe");
    iframe.src = withAutofillFrameMount(MENU_URL, bootstrap.mountId);
    iframe.setAttribute("data-cryptex-autofill", "menu");
    iframe.style.cssText = [
        "position: absolute",
        "border: 0",
        "background: transparent",
        "color-scheme: dark",
        "z-index: 2147483647",
        "pointer-events: auto",
        "border-radius: 6px",
        "box-shadow: 0 12px 32px rgba(0,0,0,0.4)",
    ].join(";");
    document.documentElement.appendChild(iframe);
    positionMenuNearField(iframe, menuField.el);
    menuIframe = iframe;
    menuActiveGroup = group;
    menuActiveIcon = icon;

    const init = {
        host: origin.host,
        fieldKind: menuField.kind,
        locked: lockedRes,
    } as const;

    menuHandshakeListener = (event: MessageEvent) => {
        if (event.source !== iframe.contentWindow) return;
        const data = event.data as { kind?: string } | undefined;
        if (data?.kind !== "ready") return;
        if (event.origin !== EXTENSION_ORIGIN) return;
        if (menuHandshakeListener) {
            window.removeEventListener("message", menuHandshakeListener);
            menuHandshakeListener = null;
        }
        const channel = new MessageChannel();
        menuPort = channel.port1;
        channel.port1.onmessage = (ev) => {
            void handleMenuMessage(ev.data, group, menuField.el);
        };
        channel.port1.start();
        postBootstrapInit(iframe, bootstrap, channel.port2);
        try {
            menuPort.postMessage({ kind: "init", payload: init });
        } catch (err) {
            console.debug("[autofill-cs] menu init failed", err);
        }
    };
    window.addEventListener("message", menuHandshakeListener);

    document.addEventListener("mousedown", onDocumentMouseDown, true);
    document.addEventListener("keydown", onDocumentKeyDown, true);
}

function onDocumentMouseDown(event: MouseEvent): void {
    if (!menuIframe) return;
    const target = event.target as Node | null;
    if (target instanceof Node && menuIframe.contains(target)) return;
    // Clicks on icons should not dismiss the menu either (the icon handler will toggle).
    const path = event.composedPath?.() ?? [];
    if (
        path.some(
            (n) =>
                n instanceof Element &&
                n.getAttribute?.("data-cryptex-autofill") === "icon",
        )
    ) {
        return;
    }
    closeMenu();
}

function onDocumentKeyDown(event: KeyboardEvent): void {
    if (event.key === "Escape" && menuIframe) {
        closeMenu();
    }
}

/* -------------------------------------------------------------------------- */
/* Save prompt mounting                                                        */
/* -------------------------------------------------------------------------- */

function closeSavePrompt(): void {
    saveMountToken += 1;
    if (saveHandshakeListener) {
        window.removeEventListener("message", saveHandshakeListener);
        saveHandshakeListener = null;
    }
    if (savePort) {
        savePort.close();
        savePort = null;
    }
    if (saveIframe) {
        saveIframe.remove();
        saveIframe = null;
    }
}

function clampSaveIframeHeight(contentHeight: number): number {
    const maxHeight = Math.max(
        SAVE_MIN_HEIGHT_PX,
        window.innerHeight - SAVE_VIEWPORT_PADDING_PX,
    );
    return Math.min(Math.max(contentHeight, SAVE_MIN_HEIGHT_PX), maxHeight);
}

function mountSavePrompt(payload: {
    host: string;
    url: string;
    username: string;
    password: string;
}): void {
    closeSavePrompt();
    const token = saveMountToken;

    void mountSavePromptWithBootstrap(payload, token);
}

async function mountSavePromptWithBootstrap(
    payload: {
        host: string;
        url: string;
        username: string;
        password: string;
    },
    token: number,
): Promise<void> {
    const bootstrap = await createAutofillFrameBootstrap("autofill-save");
    if (!bootstrap || saveIframe || token !== saveMountToken) return;

    const iframe = document.createElement("iframe");
    iframe.src = withAutofillFrameMount(SAVE_URL, bootstrap.mountId);
    iframe.setAttribute("data-cryptex-autofill", "save");
    iframe.style.cssText = [
        "position: fixed",
        "top: 16px",
        "right: 16px",
        "border: 0",
        "background: transparent",
        "color-scheme: dark",
        "z-index: 2147483647",
        "pointer-events: auto",
        "border-radius: 6px",
        "box-shadow: 0 12px 32px rgba(0,0,0,0.4)",
    ].join(";");
    iframe.style.width = `${SAVE_WIDTH_PX}px`;
    iframe.style.height = `${SAVE_INITIAL_HEIGHT_PX}px`;
    document.documentElement.appendChild(iframe);
    saveIframe = iframe;

    saveHandshakeListener = (event: MessageEvent) => {
        if (event.source !== iframe.contentWindow) return;
        const data = event.data as { kind?: string } | undefined;
        if (data?.kind !== "ready") return;
        if (event.origin !== EXTENSION_ORIGIN) return;
        if (saveHandshakeListener) {
            window.removeEventListener("message", saveHandshakeListener);
            saveHandshakeListener = null;
        }
        const channel = new MessageChannel();
        savePort = channel.port1;
        channel.port1.onmessage = (ev) => {
            const msg = ev.data as
                | { kind?: string; height?: number }
                | undefined;
            if (msg?.kind === "close") {
                closeSavePrompt();
                return;
            }
            if (
                msg?.kind === "resize" &&
                typeof msg.height === "number" &&
                saveIframe
            ) {
                saveIframe.style.height = `${clampSaveIframeHeight(msg.height)}px`;
            }
        };
        channel.port1.start();
        postBootstrapInit(iframe, bootstrap, channel.port2);
        try {
            savePort.postMessage({ kind: "init", payload });
        } catch (err) {
            console.debug("[autofill-cs] save init failed", err);
        }
    };
    window.addEventListener("message", saveHandshakeListener);
}

function pendingPromptToPayload(prompt: PendingSavePrompt): {
    host: string;
    url: string;
    username: string;
    password: string;
} {
    return {
        host: prompt.host,
        url: prompt.url,
        username: prompt.username,
        password: prompt.password,
    };
}

async function maybeShowPendingSavePrompt(): Promise<boolean> {
    if (saveIframe) return true;

    const pendingRes = await sendEncryptedEnvelopeToSW<{
        ok: true;
        prompt: PendingSavePrompt | null;
    }>(MessageType.GetPendingSavePrompt, null);
    if (!pendingRes.ok || !pendingRes.payload?.prompt) return false;

    const stateRes = await sendEncryptedEnvelopeToSW<{
        unlocked: boolean;
    }>(MessageType.GetState, null);
    if (!stateRes.ok || !stateRes.payload?.unlocked) return false;

    mountSavePrompt(pendingPromptToPayload(pendingRes.payload.prompt));
    return true;
}

function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => {
        window.setTimeout(resolve, ms);
    });
}

/**
 * Poll briefly after navigation so we still mount even when the SW
 * stash from the previous document finishes slightly after load.
 */
async function showPendingSavePromptWhenReady(): Promise<void> {
    for (const delayMs of SAVE_SHOW_RETRY_MS) {
        if (delayMs > 0) await sleep(delayMs);
        if (saveIframe) return;
        if (await maybeShowPendingSavePrompt()) return;
    }
}

/**
 * For same-document submits (SPA / fetch login), show after a short
 * defer. Skip when the tab is navigating away so we don't flash on
 * the dying page — the next document's bootstrap will mount instead.
 */
function scheduleSavePromptOnSamePage(): void {
    let pageHiding = false;
    const onPageHide = () => {
        pageHiding = true;
    };
    window.addEventListener("pagehide", onPageHide, { once: true });

    window.setTimeout(() => {
        window.removeEventListener("pagehide", onPageHide);
        if (pageHiding || document.visibilityState === "hidden") return;
        void maybeShowPendingSavePrompt();
    }, SAVE_SHOW_DEFER_MS);
}

function promptSaveCredential(payload: {
    host: string;
    url: string;
    username: string;
    password: string;
}): void {
    void sendEncryptedEnvelopeToSW(MessageType.SaveCredentialPrompt, payload);
    scheduleSavePromptOnSamePage();
}

/* -------------------------------------------------------------------------- */
/* Click + SW interaction                                                      */
/* -------------------------------------------------------------------------- */

async function handleIconClick(icon: IconHandle): Promise<void> {
    if (icon.mode === "generator") {
        await openGeneratorForField(icon);
        return;
    }
    if (menuIframe && menuActiveIcon?.field === icon.field) {
        closeMenu();
        return;
    }
    const group = trackedGroups.get(icon.groupId);
    if (!group) return;
    closeGenerator();
    await openMenuForIcon(icon, group);
}

async function fetchVaultLocked(): Promise<boolean | null> {
    const res = await sendEncryptedEnvelopeToSW<{
        unlocked: boolean;
        metadata: { id?: number; name: string } | null;
    }>(MessageType.GetState, null);
    if (!res.ok) {
        console.debug("[autofill-cs] GetState failed", res.error);
        return null;
    }
    return !res.payload.unlocked;
}

async function handleMenuMessage(
    raw: unknown,
    group: FieldGroup,
    targetField: HTMLInputElement,
): Promise<void> {
    const data = raw as
        | { kind: "credentials-request"; otpOnly: boolean }
        | { kind: "unlock-request" }
        | { kind: "pick"; credentialId: string; useTotpOnly: boolean }
        | { kind: "close" }
        | undefined;
    if (!data || typeof data !== "object") return;

    if (data.kind === "credentials-request") {
        const result =
            await sendEncryptedEnvelopeToSW<GetCredentialsForOriginResponse>(
                MessageType.GetCredentialsForOrigin,
                null,
            );
        const response: GetCredentialsForOriginResponse =
            result.ok && result.payload
                ? result.payload
                : {
                      ok: false,
                      matches: [],
                      error: result.ok ? "EMPTY_RESPONSE" : result.error,
                  };
        const payload = data.otpOnly
            ? {
                  ...response,
                  matches: response.matches.filter((item) => item.hasTOTP),
              }
            : response;

        if (menuActiveIcon?.field === targetField && menuPort) {
            menuPort.postMessage({ kind: "credentials", payload });
        }
        return;
    }

    if (data.kind === "close") {
        closeMenu();
        return;
    }

    if (data.kind === "unlock-request") {
        await sendEncryptedEnvelopeToSW(MessageType.OpenPopup, null);
        startUnlockPolling();
        return;
    }

    if (data.kind === "pick") {
        await fillFromCredential(
            data.credentialId,
            data.useTotpOnly,
            group,
            targetField,
        );
        closeMenu();
    }
}

function startUnlockPolling(): void {
    if (menuLockPollTimer != null) return;
    menuLockPollStartedAt = Date.now();
    const tick = async () => {
        menuLockPollTimer = null;
        if (!menuIframe || !menuPort || !menuActiveGroup) return;
        const stillLocked = await fetchVaultLocked();
        if (stillLocked === false) {
            try {
                menuPort.postMessage({ kind: "state-changed", locked: false });
            } catch (err) {
                console.debug("[autofill-cs] state-changed post failed", err);
            }
            return;
        }
        if (Date.now() - menuLockPollStartedAt > UNLOCK_POLL_TIMEOUT_MS) return;
        menuLockPollTimer = window.setTimeout(
            () => void tick(),
            UNLOCK_POLL_INTERVAL_MS,
        );
    };
    menuLockPollTimer = window.setTimeout(
        () => void tick(),
        UNLOCK_POLL_INTERVAL_MS,
    );
}

async function fillFromCredential(
    credentialId: string,
    useTotpOnly: boolean,
    group: FieldGroup,
    targetField?: HTMLInputElement,
): Promise<void> {
    // Re-check the page origin to make sure the user hasn't navigated.
    const originAtFill = getEffectiveOrigin();
    if (!originAtFill) return;

    // The fields might have been removed from the DOM by an SPA. Bail
    // gracefully so we don't write into stale references.
    const liveFields = group.fields.filter((f) => f.el.isConnected);
    if (!liveFields.length) return;

    if (useTotpOnly) {
        const res = await sendEncryptedEnvelopeToSW<GenerateTOTPResponse>(
            MessageType.GenerateTOTP,
            { id: credentialId },
        );
        if (!res.ok || !res.payload?.ok || !res.payload.code) return;
        let code: string | null = res.payload.code;
        const otpField = selectOtpField(liveFields, targetField);
        if (otpField) setInputValue(otpField.el, code);
        code = null;
        return;
    }

    const secretRes =
        await sendEncryptedEnvelopeToSW<GetCredentialSecretResponse>(
            MessageType.GetCredentialSecret,
            { id: credentialId },
        );
    if (!secretRes.ok || !secretRes.payload?.ok) return;

    let username: string | null = secretRes.payload.username ?? "";
    let password: string | null = secretRes.payload.password ?? "";

    const usernameField = liveFields.find((f) => f.kind === "username");
    const passwordField =
        liveFields.find((f) => f.kind === "password") ??
        liveFields.find((f) => f.kind === "newPassword");

    if (usernameField && username) setInputValue(usernameField.el, username);
    if (passwordField && password) setInputValue(passwordField.el, password);

    // Track what we just filled so save-on-submit can suppress nags
    // when the user submits the unchanged form.
    if (username !== null && password !== null) {
        lastFilledByGroup.set(group.groupId, { username, password });
    }

    // Drop secret refs. JS strings are immutable so we cannot zero the
    // backing storage; the best we can do is drop the references and
    // never park them in module-scope state.
    username = null;
    password = null;
}

/* -------------------------------------------------------------------------- */
/* Scan + reconcile                                                            */
/* -------------------------------------------------------------------------- */

function reconcile(): void {
    const groups = detectGroups();
    const seenGroupIds = new Set<string>();
    const seenFields = new Set<HTMLInputElement>();

    for (const group of groups) {
        seenGroupIds.add(group.groupId);
        trackedGroups.set(group.groupId, group);

        // Detection tracks every eligible field. The control itself is only
        // attached to the field the user is interacting with.
        for (const field of group.fields) {
            const mode = getInlineFieldMode(group, field);
            if (!mode) continue;
            trackInlineField(group, field.el, field.kind, mode);
            seenFields.add(field.el);
        }
    }

    for (const field of trackedFields.keys()) {
        if (!seenFields.has(field) || !field.isConnected) {
            untrackInlineField(field);
        }
    }

    for (const [groupId] of trackedGroups) {
        if (!seenGroupIds.has(groupId)) {
            if (menuActiveGroup?.groupId === groupId) {
                closeMenu();
            }
            trackedGroups.delete(groupId);
            lastFilledByGroup.delete(groupId);
        }
    }
}

function repositionInlineUi(): void {
    activeIcon?.reposition();
    if (menuIframe && menuActiveIcon?.field.isConnected) {
        positionMenuNearField(menuIframe, menuActiveIcon.field);
    }
    if (generatorIframe && generatorActiveIcon?.field.isConnected) {
        positionGeneratorNearField(generatorIframe, generatorActiveIcon.field);
    }
}

/* -------------------------------------------------------------------------- */
/* Save-on-submit                                                              */
/* -------------------------------------------------------------------------- */

function shouldPromptSave(group: FieldGroup): {
    host: string;
    url: string;
    username: string;
    password: string;
} | null {
    const passwordField =
        group.fields.find((f) => f.kind === "password") ??
        group.fields.find((f) => f.kind === "newPassword");
    if (!passwordField) return null;
    const password = passwordField.el.value;
    if (!password) return null;

    const usernameField = group.fields.find((f) => f.kind === "username");
    const username = usernameField?.el.value ?? "";

    const lastFilled = lastFilledByGroup.get(group.groupId);
    if (
        lastFilled &&
        lastFilled.username === username &&
        lastFilled.password === password
    ) {
        return null;
    }

    const origin = getEffectiveOrigin();
    if (!origin) return null;

    return {
        host: origin.host,
        url: window.location.href,
        username,
        password,
    };
}

function attachSubmitListener(): void {
    document.addEventListener(
        "submit",
        (event) => {
            const form = event.target;
            if (!(form instanceof HTMLFormElement)) return;
            for (const [, group] of trackedGroups) {
                const passwordField =
                    group.fields.find((f) => f.kind === "password") ??
                    group.fields.find((f) => f.kind === "newPassword");
                if (!passwordField) continue;
                if (!form.contains(passwordField.el)) continue;
                const payload = shouldPromptSave(group);
                if (!payload) continue;
                promptSaveCredential(payload);
            }
        },
        true,
    );
}

/* -------------------------------------------------------------------------- */
/* Bootstrap                                                                   */
/* -------------------------------------------------------------------------- */

function bootstrap(): void {
    if (initialised) return;
    if (!shouldRun()) return;
    initialised = true;

    // Keep a sender-verified origin context in the service worker. The popup
    // can then identify this tab even when chrome.action.openPopup() did not
    // grant activeTab access to Tab.url.
    void sendEncryptedEnvelopeToSW(MessageType.ReportPageOrigin, null);

    reconcile();

    const refresh = debounce(() => {
        reconcile();
        repositionInlineUi();
    }, MUTATION_DEBOUNCE_MS);
    const observer = new MutationObserver(refresh);
    observer.observe(document.documentElement, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: [
            "type",
            "autocomplete",
            "name",
            "id",
            "readonly",
            "disabled",
            "hidden",
            "class",
        ],
    });

    const onLayoutChange = throttleRaf(repositionInlineUi);
    window.addEventListener("scroll", onLayoutChange, true);
    window.addEventListener("resize", onLayoutChange);
    document.addEventListener("transitionend", onLayoutChange, true);
    document.addEventListener("animationend", onLayoutChange, true);

    attachSubmitListener();
    void showPendingSavePromptWhenReady();
}

function debounce<T extends (...args: never[]) => void>(
    fn: T,
    waitMs: number,
): T {
    let handle: number | null = null;
    return ((...args: never[]) => {
        if (handle != null) window.clearTimeout(handle);
        handle = window.setTimeout(() => fn(...args), waitMs);
    }) as T;
}

function throttleRaf<T extends (...args: never[]) => void>(fn: T): T {
    let scheduled = false;
    return ((...args: never[]) => {
        if (scheduled) return;
        scheduled = true;
        requestAnimationFrame(() => {
            scheduled = false;
            fn(...args);
        });
    }) as T;
}

if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", bootstrap, { once: true });
} else {
    bootstrap();
}
