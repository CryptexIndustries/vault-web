/**
 * Drives release Firefox over WebDriver BiDi with the part of Playwright's
 * BrowserContext, Page and Locator API the extension specs use, so the same
 * specs run on Chromium through Playwright and on Firefox through this.
 *
 * Playwright can't do it itself: Firefox sends no load events for
 * moz-extension pages and often reports no script realm for them, and
 * Playwright waits for both.
 */
import { EventEmitter } from "node:events";
import fs from "node:fs/promises";
import http from "node:http";
import type { AddressInfo } from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";

import config from "../playwright.config";
import { Bidi, channelArgument, deserialize, type BidiEvent } from "./bidi";
import { pageScript, type Matcher, type Step } from "./page-script";

export type ElementState = {
    visible: boolean;
    enabled: boolean;
    checked: boolean;
    text: string;
    textContent: string;
    value: string | null;
    attributes: Record<string, string>;
    css: string | null;
    inViewport: boolean | null;
    box: { x: number; y: number; width: number; height: number };
};

export type Inspection = { count: number; state: ElementState | null };

const PAGE_CALL = `function (operation, ...args) {
    const helpers = (globalThis.__cryptexE2E ??= (${pageScript.toString()})());
    return helpers[operation](...args);
}`;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const actionTimeout = config.use?.actionTimeout || 15_000;
const navigationTimeout = config.use?.navigationTimeout || 30_000;
export const expectTimeout = config.expect?.timeout ?? 5000;

const DRIVER_DIRECTORY = path.dirname(fileURLToPath(import.meta.url));

/**
 * An Error made where a spec called the driver, without the driver's frames,
 * so a failure found later still points at the spec line.
 */
export function callSiteError() {
    const error = new Error();
    error.stack = error.stack
        ?.split("\n")
        .filter((line) => !line.includes(DRIVER_DIRECTORY))
        .join("\n");
    return error;
}

class StrictModeError extends Error {}

/** Retries until `attempt` returns a value, or fails with its last reason. */
export async function retry<T>(
    timeout: number,
    description: string,
    attempt: () => Promise<{ value: T } | { reason: string }>,
    callSite = callSiteError(),
): Promise<T> {
    const deadline = Date.now() + timeout;
    let reason = "not tried";
    for (;;) {
        try {
            const result = await attempt();
            if ("value" in result) return result.value;
            reason = result.reason;
        } catch (error) {
            if (error instanceof StrictModeError) throw error;
            // The page may be navigating or have closed a frame.
            reason = error instanceof Error ? error.message : String(error);
        }
        if (Date.now() > deadline) {
            callSite.message = `${description}: timed out after ${timeout} ms (${reason})`;
            throw callSite;
        }
        await sleep(100);
    }
}

// WebDriver's codes for the keys the specs press.
const KEYS: Record<string, string> = {
    Enter: String.fromCharCode(0xe007),
    Escape: String.fromCharCode(0xe00c),
};

const pressActions = (key: string) => [
    {
        type: "key",
        id: "keyboard",
        actions: [
            { type: "keyDown", value: KEYS[key] ?? key },
            { type: "keyUp", value: KEYS[key] ?? key },
        ],
    },
];

function toMatcher(value: string | RegExp, exact?: boolean): Matcher {
    return typeof value === "string"
        ? { kind: "string", value, exact }
        : { kind: "regex", source: value.source, flags: value.flags };
}

const describe = (value: unknown) =>
    value instanceof RegExp ? String(value) : JSON.stringify(value);

export class FirefoxLocator {
    constructor(
        readonly page: FirefoxPage,
        private readonly frames: Step[][],
        private readonly steps: Step[],
        readonly description: string,
    ) {}

    private with(step: Step, description: string) {
        return new FirefoxLocator(
            this.page,
            this.frames,
            [...this.steps, step],
            `${this.description}.${description}`,
        );
    }

    getByRole(
        role: string,
        options: { name?: string | RegExp; exact?: boolean } = {},
    ) {
        const name =
            options.name === undefined
                ? undefined
                : toMatcher(options.name, options.exact);
        return this.with(
            { kind: "role", role, name },
            `getByRole(${describe(role)}, ${describe(options.name)})`,
        );
    }

    getByText(text: string | RegExp, options: { exact?: boolean } = {}) {
        return this.with(
            { kind: "text", text: toMatcher(text, options.exact) },
            `getByText(${describe(text)})`,
        );
    }

    getByLabel(text: string | RegExp, options: { exact?: boolean } = {}) {
        return this.with(
            { kind: "label", text: toMatcher(text, options.exact) },
            `getByLabel(${describe(text)})`,
        );
    }

    getByTitle(text: string | RegExp, options: { exact?: boolean } = {}) {
        return this.with(
            { kind: "title", text: toMatcher(text, options.exact) },
            `getByTitle(${describe(text)})`,
        );
    }

    getByTestId(id: string) {
        return this.with({ kind: "testid", id }, `getByTestId("${id}")`);
    }

    locator(selector: string) {
        return this.with(
            { kind: "css", selector },
            `locator(${describe(selector)})`,
        );
    }

    filter({ hasText }: { hasText: string | RegExp }) {
        return this.with(
            { kind: "hasText", text: toMatcher(hasText) },
            `filter(${describe(hasText)})`,
        );
    }

    first() {
        return this.with({ kind: "nth", index: 0 }, "first()");
    }

    last() {
        return this.with({ kind: "nth", index: -1 }, "last()");
    }

    /** The browsing context of the innermost frame, or null until it exists. */
    private async frameContext(): Promise<string | null> {
        let context = this.page.id;
        for (const steps of this.frames) {
            const frame = await this.page.bidi.callRaw(context, PAGE_CALL, [
                "frameWindow",
                steps,
            ]);
            if (frame.type !== "window") return null;
            context = frame.value.context;
        }
        return context;
    }

    async inspect(
        options: { cssProperty?: string; viewport?: boolean } = {},
    ): Promise<Inspection> {
        const context = await this.frameContext();
        if (!context) return { count: 0, state: null };
        return this.page.bidi.call(context, PAGE_CALL, [
            "inspect",
            this.steps,
            options,
        ]);
    }

    private strictModeError(count: number) {
        return new StrictModeError(
            `strict mode violation: ${this.description} resolved to ${count} elements`,
        );
    }

    /** Runs `action` on the one matching element until it reports no blocker. */
    private async act<T>(
        description: string,
        action: (
            context: string,
            element: { sharedId: string },
        ) => Promise<{ value: T } | { reason: string }>,
    ): Promise<T> {
        const callSite = callSiteError();
        await this.page.hooked;
        return retry(
            actionTimeout,
            `${description} ${this.description}`,
            async () => {
                const context = await this.frameContext();
                if (!context) return { reason: "waiting for the frame" };
                const found = await this.page.bidi.callRaw(context, PAGE_CALL, [
                    "elements",
                    this.steps,
                ]);
                const elements = found.value as { sharedId: string }[];
                if (elements.length > 1) {
                    throw this.strictModeError(elements.length);
                }
                if (!elements[0]) return { reason: "waiting for the element" };
                return action(context, { sharedId: elements[0].sharedId });
            },
            callSite,
        );
    }

    async click() {
        await this.act("click", async (context, element) => {
            const blocker = await this.page.bidi.call(context, PAGE_CALL, [
                "clickBlocker",
                element,
            ]);
            if (blocker) return { reason: blocker };
            await this.page.bidi.send("input.performActions", {
                context,
                actions: [
                    {
                        type: "pointer",
                        id: "mouse",
                        actions: [
                            {
                                type: "pointerMove",
                                x: 0,
                                y: 0,
                                origin: { type: "element", element },
                            },
                            { type: "pointerDown", button: 0 },
                            { type: "pointerUp", button: 0 },
                        ],
                    },
                ],
            });
            return { value: undefined };
        });
    }

    async check() {
        if ((await this.single("check")).checked) return;
        await this.click();
        await retry(1000, `check ${this.description}`, async () =>
            (await this.inspect()).state?.checked
                ? { value: undefined }
                : { reason: "clicking did not check it" },
        );
    }

    async fill(value: string) {
        await this.act("fill", async (context, element) => {
            const blocker = await this.page.bidi.call(context, PAGE_CALL, [
                "fill",
                element,
                value,
            ]);
            return blocker ? { reason: blocker } : { value: undefined };
        });
    }

    async press(key: string) {
        await this.act("press", async (context, element) => {
            await this.page.bidi.call(context, "(element) => element.focus()", [
                element,
            ]);
            await this.page.bidi.send("input.performActions", {
                context,
                actions: pressActions(key),
            });
            return { value: undefined };
        });
    }

    async evaluate<R>(fn: (element: any) => R): Promise<R> {
        return this.act("evaluate", async (context, element) => ({
            value: await this.page.bidi.call(context, fn.toString(), [element]),
        }));
    }

    private single(description: string) {
        return retry(
            actionTimeout,
            `${description} ${this.description}`,
            async () => {
                const { count, state } = await this.inspect();
                if (count > 1) throw this.strictModeError(count);
                return state
                    ? { value: state }
                    : { reason: "waiting for the element" };
            },
        );
    }

    async textContent() {
        return (await this.single("textContent")).textContent;
    }

    async boundingBox() {
        const state = await this.single("boundingBox");
        return state.visible ? state.box : null;
    }

    async isVisible() {
        const { count, state } = await this.inspect();
        if (count > 1) throw this.strictModeError(count);
        return state?.visible ?? false;
    }

    async count() {
        return (await this.inspect()).count;
    }
}

/**
 * Lets the driver see file pickers: Firefox's BiDi reports none for extension
 * pages, so the page's file inputs report to a channel instead of opening one.
 */
function hookFileChooser(report: (multiple: boolean) => void) {
    type Chooser = { input?: HTMLInputElement; report: typeof report };
    const scope = window as unknown as { __cryptexE2EChooser?: Chooser };
    if (scope.__cryptexE2EChooser) {
        scope.__cryptexE2EChooser.report = report;
        return;
    }
    const chooser: Chooser = { report };
    scope.__cryptexE2EChooser = chooser;
    const { click, showPicker } = HTMLInputElement.prototype;
    HTMLInputElement.prototype.click = function () {
        if (this.type !== "file") return click.call(this);
        chooser.input = this;
        chooser.report(this.multiple);
    };
    HTMLInputElement.prototype.showPicker = function () {
        if (this.type !== "file") return showPicker.call(this);
        chooser.input = this;
        chooser.report(this.multiple);
    };
}

/** Puts files on the input the page last opened a picker for. */
function setChooserFiles(files: { name: string; base64: string }[]) {
    const { input } = (
        window as unknown as {
            __cryptexE2EChooser: { input: HTMLInputElement };
        }
    ).__cryptexE2EChooser;
    const transfer = new DataTransfer();
    for (const { name, base64 } of files) {
        const bytes = Uint8Array.from(atob(base64), (char) =>
            char.charCodeAt(0),
        );
        transfer.items.add(new File([bytes], name));
    }
    input.files = transfer.files;
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
}

function waitForEvent<T>(
    emitter: EventEmitter,
    event: string,
    predicate?: (value: T) => boolean,
): Promise<T> {
    const callSite = callSiteError();
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
            emitter.off(event, listener);
            callSite.message = `Timed out after ${navigationTimeout} ms waiting for "${event}"`;
            reject(callSite);
        }, navigationTimeout);
        const listener = (value: T) => {
            if (predicate && !predicate(value)) return;
            clearTimeout(timer);
            emitter.off(event, listener);
            resolve(value);
        };
        emitter.on(event, listener);
    });
}

export class FirefoxPage {
    readonly events = new EventEmitter();
    currentUrl = "about:blank";
    /** Settles once the page hooks waitForEvent and on added are in. */
    hooked: Promise<unknown> = Promise.resolve();
    private readonly root = new FirefoxLocator(this, [], [], "page");
    readonly getByRole = this.root.getByRole.bind(this.root);
    readonly getByText = this.root.getByText.bind(this.root);
    readonly getByLabel = this.root.getByLabel.bind(this.root);
    readonly getByTestId = this.root.getByTestId.bind(this.root);
    readonly locator = this.root.locator.bind(this.root);
    readonly keyboard = {
        press: (key: string) =>
            this.bidi.send("input.performActions", {
                context: this.id,
                actions: pressActions(key),
            }),
    };

    constructor(
        private readonly browserContext: FirefoxContext,
        readonly id: string,
    ) {}

    get bidi() {
        return this.browserContext.bidi;
    }

    context() {
        return this.browserContext;
    }

    url() {
        return this.currentUrl;
    }

    /** The specs only query inside frames, which a root locator can do. */
    frameLocator(selector: string) {
        return new FirefoxLocator(
            this,
            [[{ kind: "css", selector }]],
            [],
            `frameLocator(${describe(selector)})`,
        );
    }

    /** Waits for the next document, which Firefox sends no load event for. */
    private async navigate(command: string, params: object) {
        const callSite = callSiteError();
        await this.bidi
            .call(this.id, "() => { globalThis.__cryptexE2EOld = true; }")
            .catch(() => {});
        await this.bidi.send(command, {
            context: this.id,
            wait: "none",
            ...params,
        });
        await this.waitForLoadState(callSite);
        return null;
    }

    goto(url: string) {
        // The extensionId fixture is the moz-extension UUID on Firefox.
        return this.navigate("browsingContext.navigate", {
            url: url.replace(/^chrome-extension:/, "moz-extension:"),
        });
    }

    reload() {
        return this.navigate("browsingContext.reload", {});
    }

    async waitForLoadState(callSite = callSiteError()) {
        await retry(
            navigationTimeout,
            "waiting for the page to load",
            async () => {
                const [href, readyState, old] = await this.bidi.call(
                    this.id,
                    "() => [location.href, document.readyState, globalThis.__cryptexE2EOld === true]",
                );
                if (
                    old ||
                    readyState !== "complete" ||
                    href === "about:blank"
                ) {
                    return {
                        reason: `${href} is ${old ? "still loading" : readyState}`,
                    };
                }
                this.currentUrl = href;
                return { value: undefined };
            },
            callSite,
        );
    }

    evaluate<R, A>(fn: (arg: A) => R, arg?: A): Promise<R> {
        return this.bidi.call(
            this.id,
            fn.toString(),
            arg === undefined ? [] : [arg],
        );
    }

    waitForTimeout(ms: number) {
        return sleep(ms);
    }

    waitForEvent(event: string) {
        this.prepare(event);
        return waitForEvent(this.events, event);
    }

    on(event: string, listener: (...args: any[]) => void) {
        this.prepare(event);
        this.events.on(event, listener);
        return this;
    }

    // Playwright's waitForEvent and on don't return a promise for the hook,
    // so actions wait for `hooked` before they run.
    private prepare(event: string) {
        if (event === "filechooser") {
            this.hooked = this.bidi.call(this.id, hookFileChooser.toString(), [
                channelArgument("cryptex-filechooser"),
            ]);
        }
        if (event === "close") this.browserContext.watchForClosedPages();
    }

    async setViewportSize({
        width,
        height,
    }: {
        width: number;
        height: number;
    }) {
        // Firefox sizes whole windows, so the page measures the browser's own
        // toolbars and borders first.
        const [extraWidth, extraHeight] = await this.bidi.call(
            this.id,
            "() => [outerWidth - innerWidth, outerHeight - innerHeight]",
        );
        const { contexts } = await this.bidi.send("browsingContext.getTree", {
            root: this.id,
            maxDepth: 0,
        });
        await this.bidi.send("browser.setClientWindowState", {
            clientWindow: contexts[0].clientWindow,
            state: "normal",
            width: width + extraWidth,
            height: height + extraHeight,
        });
    }
}

type Route = {
    request(): Request;
    fulfill(response: {
        status?: number;
        contentType?: string;
        body?: string | Buffer;
    }): Promise<void>;
    abort(): Promise<void>;
};

type Request = {
    url(): string;
    method(): string;
    postData(): string | null;
    postDataBuffer(): Buffer | null;
};

/** A glob in Playwright's syntax, as a regular expression source. */
const globSource = (glob: string) =>
    `^${glob
        .split("**")
        .map((part) =>
            part
                .split("*")
                .map((text) => text.replace(/[.+?^${}()|[\]\\]/g, "\\$&"))
                .join("[^/]*"),
        )
        .join(".*")}$`;

/**
 * Watches every HTTP request in Firefox's parent process, where requests of
 * the extension's background script show up too. BiDi's network module never
 * sees those. Requests a route matches are redirected to the driver's server.
 */
function watchNetwork(state: {
    routes: { id: string; source: string }[];
    server: string;
    logging: boolean;
    requests: { method: string; url: string }[];
}) {
    const scope = globalThis as unknown as {
        __cryptexE2ENetwork?: typeof state;
        Services: any;
        Ci: any;
    };
    if (scope.__cryptexE2ENetwork) {
        Object.assign(scope.__cryptexE2ENetwork, state);
        return;
    }
    const network = (scope.__cryptexE2ENetwork = state);
    scope.Services.obs.addObserver((subject: any) => {
        const channel = subject.QueryInterface(scope.Ci.nsIHttpChannel);
        const url: string = channel.URI.spec;
        if (network.server && url.startsWith(network.server)) return;
        if (network.logging) {
            network.requests.push({ method: channel.requestMethod, url });
        }
        const route = network.routes.find(({ source }) =>
            new RegExp(source).test(url),
        );
        if (route) {
            channel.redirectTo(
                scope.Services.io.newURI(
                    `${network.server}/${route.id}?url=${encodeURIComponent(url)}`,
                ),
            );
        }
    }, "http-on-modify-request");
}

/**
 * Firefox stops tabs that aren't selected: no animation frames, a hidden
 * document and throttled timers. Playwright's Chromium keeps every tab
 * running, and the specs rely on that.
 */
function keepTabsActive() {
    const { Services } = globalThis as unknown as { Services: any };
    setInterval(() => {
        for (const win of Services.wm.getEnumerator("navigator:browser")) {
            for (const browser of win.gBrowser.browsers) {
                const context = browser.browsingContext;
                if (context && !context.isActive) context.isActive = true;
            }
        }
    }, 50);
}

/** Resolves once every browser window has finished starting up. */
const windowsStarted = () =>
    Promise.all(
        [
            ...(
                globalThis as unknown as { Services: any }
            ).Services.wm.getEnumerator("navigator:browser"),
        ].map((win) => win.delayedStartupPromise),
    );

export class FirefoxContext {
    private readonly events = new EventEmitter();
    private readonly pages = new Map<string, FirefoxPage>();
    private readonly downloads = new Map<
        string,
        { resolve(path: string): void; reject(error: Error): void }
    >();
    private creating = 0;
    private queued: BidiEvent[] = [];
    private routes: {
        id: string;
        glob: string;
        handler: (route: Route, request: Request) => unknown;
    }[] = [];
    private nextRoute = 1;
    private server?: http.Server;
    private serverOrigin = "";
    private requestPoll?: NodeJS.Timeout;
    private closePoll?: NodeJS.Timeout;

    private constructor(
        readonly bidi: Bidi,
        private readonly chromeContext: string,
        private readonly addonId: string,
    ) {}

    static async launch(options: {
        executablePath: string;
        userDataDir: string;
        headless: boolean;
        extensionPath: string;
        extensionUuid: string;
        prefs: Record<string, string | number | boolean>;
    }) {
        const manifest = JSON.parse(
            await fs.readFile(
                path.join(options.extensionPath, "manifest.json"),
                "utf8",
            ),
        );
        const addonId: string = manifest.browser_specific_settings.gecko.id;
        const bidi = await Bidi.launch({
            ...options,
            prefs: {
                "browser.startup.page": 0,
                // Firefox picks a random UUID per install unless this fixes it.
                "extensions.webextensions.uuids": JSON.stringify({
                    [addonId]: options.extensionUuid,
                }),
                "browser.download.folderList": 2,
                "browser.download.dir": path.join(
                    options.userDataDir,
                    "downloads",
                ),
                "browser.download.start_downloads_in_tmp_dir": false,
                "browser.download.always_ask_before_handling_new_types": false,
                // The specs open popup.html in a tab to stand in for the
                // toolbar popup, which window.close() can always close.
                "dom.allow_scripts_to_close_windows": true,
                // Lets pages use navigator.clipboard as Chromium's granted
                // clipboard permissions do.
                "dom.events.testing.asyncClipboard": true,
                // Console output goes to the log a failed test attaches.
                "devtools.console.stdout.content": true,
                "devtools.console.stdout.chrome": true,
                ...options.prefs,
            },
        });
        try {
            const { contexts } = await bidi.send("browsingContext.getTree", {
                "moz:scope": "chrome",
            });
            const context = new FirefoxContext(
                bidi,
                contexts[0].context,
                addonId,
            );
            await context.start(options.extensionPath);
            return context;
        } catch (error) {
            await bidi.close();
            throw error;
        }
    }

    private async start(extensionPath: string) {
        this.bidi.on((event) => this.onEvent(event));
        await this.bidi.send("session.subscribe", {
            events: [
                "browsingContext.contextCreated",
                "browsingContext.contextDestroyed",
                "browsingContext.navigationCommitted",
                "browsingContext.downloadWillBegin",
                "browsingContext.downloadEnd",
                "script.realmCreated",
                "script.message",
            ],
        });
        await this.bidi.send("webExtension.install", {
            extensionData: { type: "path", path: extensionPath },
        });
        await this.chrome(watchNetwork.toString(), [
            { routes: [], server: "", logging: false, requests: [] },
        ]);
        await this.chrome(keepTabsActive.toString());
        // A tab created before its window finishes starting up can wait
        // forever for BiDi's answer.
        await this.chrome(windowsStarted.toString());
    }

    private chrome(functionDeclaration: string, args: unknown[] = []) {
        return this.bidi.call(this.chromeContext, functionDeclaration, args);
    }

    private onEvent(event: BidiEvent) {
        const { method, params } = event;
        const page = this.pages.get(params.context);
        if (method === "browsingContext.contextCreated") {
            // newPage adds its own pages, so only the others count as new.
            if (this.creating > 0) this.queued.push(event);
            else if (!params.parent && !page) {
                const created = new FirefoxPage(this, params.context);
                this.pages.set(params.context, created);
                this.events.emit("page", created);
            }
        } else if (method === "browsingContext.contextDestroyed") {
            if (page) this.closed(page);
        } else if (method === "browsingContext.navigationCommitted") {
            if (page) page.currentUrl = params.url;
        } else if (method === "browsingContext.downloadWillBegin") {
            const { promise, resolve, reject } =
                Promise.withResolvers<string>();
            this.downloads.set(params.download ?? params.navigation, {
                resolve,
                reject,
            });
            page?.events.emit("download", {
                suggestedFilename: () => params.suggestedFilename,
                path: () => promise,
            });
        } else if (method === "browsingContext.downloadEnd") {
            const download = this.downloads.get(
                params.download ?? params.navigation,
            );
            if (params.status === "complete")
                download?.resolve(params.filepath);
            else download?.reject(new Error(`Download ${params.status}`));
        } else if (method === "script.realmCreated") {
            if (params.type !== "dedicated-worker") return;
            // The specs only check that some page started the worker.
            for (const owner of this.pages.values()) {
                owner.events.emit("worker", { url: () => params.origin });
            }
        } else if (
            method === "script.message" &&
            params.channel === "cryptex-filechooser"
        ) {
            const context: string = params.source.context;
            const multiple: boolean = deserialize(params.data);
            this.pages.get(context)?.events.emit("filechooser", {
                isMultiple: () => multiple,
                setFiles: async (file: string) =>
                    this.bidi.call(context, setChooserFiles.toString(), [
                        [
                            {
                                name: path.basename(file),
                                base64: (await fs.readFile(file)).toString(
                                    "base64",
                                ),
                            },
                        ],
                    ]),
            });
        }
    }

    private closed(page: FirefoxPage) {
        this.pages.delete(page.id);
        page.events.emit("close", page);
    }

    /**
     * Firefox sends no contextDestroyed when a moz-extension page closes
     * itself, so while anything waits for a close, this looks for pages that
     * are gone.
     */
    watchForClosedPages() {
        this.closePoll ??= setInterval(async () => {
            const tree = await this.bidi
                .send("browsingContext.getTree", { maxDepth: 0 })
                .catch(() => null);
            if (!tree || this.creating) return;
            const open = new Set(
                tree.contexts.map(
                    ({ context }: { context: string }) => context,
                ),
            );
            for (const page of this.pages.values()) {
                if (!open.has(page.id)) this.closed(page);
            }
        }, 250);
    }

    async newPage() {
        this.creating++;
        let id = "";
        try {
            // Tabs in one window, as Playwright's Chromium has them. The
            // extension reads the active tab of the current window.
            ({ context: id } = await this.bidi.send("browsingContext.create", {
                type: "tab",
            }));
            this.pages.set(id, new FirefoxPage(this, id));
        } finally {
            this.creating--;
            if (this.creating === 0) {
                const queued = this.queued.filter(
                    (event) => event.params.context !== id,
                );
                this.queued = [];
                for (const event of queued) this.onEvent(event);
            }
        }
        const page = this.pages.get(id)!;
        // Playwright's default viewport.
        await page.setViewportSize({ width: 1280, height: 720 });
        return page;
    }

    waitForEvent(event: string) {
        return waitForEvent(this.events, event);
    }

    on(event: string, listener: (...args: any[]) => void) {
        this.events.on(event, listener);
        if (event === "request") void this.logRequests();
        return this;
    }

    /**
     * Stops the extension's background script, as Firefox does when it's
     * idle. restartedAt resolves to the time it next runs.
     */
    async stopBackground() {
        const extension = `(globalThis.WebExtensionPolicy.getByID(${JSON.stringify(this.addonId)}).extension)`;
        await this.chrome(
            `() => ${extension}.terminateBackground({ ignoreDevToolsAttached: true })`,
        );
        const restartedAt = (async () => {
            while (
                (await this.chrome(`() => ${extension}.backgroundState`)) !==
                "running"
            ) {
                await sleep(250);
            }
            return Date.now();
        })();
        return { restartedAt };
    }

    private async logRequests() {
        if (this.requestPoll) return;
        await this.chrome(watchNetwork.toString(), [{ logging: true }]);
        this.requestPoll = setInterval(async () => {
            const requests: { method: string; url: string }[] =
                await this.chrome(
                    "() => globalThis.__cryptexE2ENetwork.requests.splice(0)",
                ).catch(() => []);
            for (const { method, url } of requests) {
                this.events.emit("request", {
                    url: () => url,
                    method: () => method,
                });
            }
        }, 100);
    }

    private async startServer() {
        if (this.server) return;
        this.server = http.createServer((incoming, response) => {
            const chunks: Buffer[] = [];
            incoming.on("data", (chunk) => chunks.push(chunk));
            incoming.on("end", async () => {
                const url = new URL(incoming.url!, this.serverOrigin);
                const route = this.routes.find(
                    ({ id }) => `/${id}` === url.pathname,
                );
                if (incoming.method === "OPTIONS" || !route) {
                    response.writeHead(204, {
                        "access-control-allow-origin": "*",
                        "access-control-allow-methods": "*",
                        "access-control-allow-headers": "*",
                    });
                    response.end();
                    return;
                }
                const body = Buffer.concat(chunks);
                const request: Request = {
                    url: () => url.searchParams.get("url")!,
                    method: () => incoming.method!,
                    postData: () => (body.length ? body.toString() : null),
                    postDataBuffer: () => (body.length ? body : null),
                };
                try {
                    await route.handler(
                        {
                            request: () => request,
                            async fulfill({
                                status = 200,
                                contentType,
                                body = "",
                            }) {
                                response.writeHead(status, {
                                    "access-control-allow-origin": "*",
                                    ...(contentType
                                        ? { "content-type": contentType }
                                        : {}),
                                });
                                response.end(body);
                            },
                            // Firefox reports a dropped connection as a network
                            // error, as Chromium does an aborted route.
                            async abort() {
                                incoming.socket.destroy();
                            },
                        },
                        request,
                    );
                } catch (error) {
                    response.writeHead(500);
                    response.end(String(error));
                }
            });
        });
        await new Promise<void>((resolve) =>
            this.server!.listen(0, "127.0.0.1", resolve),
        );
        const { port } = this.server.address() as AddressInfo;
        this.serverOrigin = `http://127.0.0.1:${port}`;
    }

    private async syncRoutes() {
        await this.chrome(watchNetwork.toString(), [
            {
                server: this.serverOrigin,
                // Playwright tries the newest route first.
                routes: [...this.routes]
                    .reverse()
                    .map(({ id, glob }) => ({ id, source: globSource(glob) })),
            },
        ]);
    }

    async route(
        glob: string,
        handler: (route: Route, request: Request) => unknown,
    ) {
        await this.startServer();
        this.routes.push({ id: `route-${this.nextRoute++}`, glob, handler });
        await this.syncRoutes();
    }

    async unroute(glob: string) {
        this.routes = this.routes.filter((route) => route.glob !== glob);
        await this.syncRoutes();
    }

    /** The clipboard pref above already lets pages use it. */
    async grantPermissions() {}

    async close() {
        clearInterval(this.requestPoll);
        clearInterval(this.closePoll);
        this.server?.close();
        await this.bidi.close();
    }
}
