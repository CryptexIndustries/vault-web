/** Playwright's locator assertions, for FirefoxLocator. */
import {
    callSiteError,
    expectTimeout,
    retry,
    type ElementState,
    type FirefoxLocator,
    type Inspection,
} from "./browser";

const ZERO_WIDTH_SPACE = String.fromCharCode(0x200b);
const normalize = (text: string) =>
    text.replaceAll(ZERO_WIDTH_SPACE, "").trim().replace(/\s+/g, " ");

const textMatches = (
    expected: string | RegExp,
    actual: string,
    whole: boolean,
) => {
    const text = normalize(actual);
    if (expected instanceof RegExp) return expected.test(text);
    return whole
        ? text === normalize(expected)
        : text.includes(normalize(expected));
};

const valueMatches = (expected: string | RegExp, actual: string | null) =>
    actual !== null &&
    (expected instanceof RegExp ? expected.test(actual) : actual === expected);

type Options = { timeout?: number };

// Each returns null when the element it needs is missing: then neither the
// assertion nor its negation passes, as in Playwright.
type Check = (inspection: Inspection) => boolean | null;

const single =
    (predicate: (state: ElementState) => boolean | null): Check =>
    ({ state }) =>
        state === null ? null : predicate(state);

export function expectFirefoxLocator(locator: FirefoxLocator) {
    const assertions = (negated: boolean) => {
        const check = async (
            name: string,
            expected: unknown,
            options: Options | undefined,
            pass: Check,
            {
                strict = true,
                cssProperty,
                viewport,
            }: {
                strict?: boolean;
                cssProperty?: string;
                viewport?: boolean;
            } = {},
        ) => {
            const failure = callSiteError();
            const timeout = options?.timeout ?? expectTimeout;
            let last: Inspection = { count: 0, state: null };
            await retry(timeout, `expect(${locator.description})`, async () => {
                last = await locator.inspect({ cssProperty, viewport });
                if (strict && last.count > 1) {
                    return { reason: `${last.count} elements match` };
                }
                const verdict = pass(last);
                return verdict !== null && verdict !== negated
                    ? { value: undefined }
                    : { reason: "condition not met" };
            }).catch(() => {
                const received =
                    last.count > 1
                        ? `strict mode violation: ${last.count} elements`
                        : last.state
                          ? JSON.stringify({
                                ...last.state,
                                text: normalize(last.state.text).slice(0, 200),
                            })
                          : `${last.count} elements`;
                failure.message = [
                    `expect(locator).${negated ? "not." : ""}${name} failed`,
                    `Locator: ${locator.description}`,
                    ...(expected === undefined
                        ? []
                        : [`Expected: ${String(expected)}`]),
                    `Received: ${received}`,
                    `Timeout: ${timeout}ms`,
                ].join("\n");
                throw failure;
            });
        };

        const states: Record<string, (state: ElementState) => boolean | null> =
            {
                toBeChecked: (state) => state.checked,
                toBeDisabled: (state) => !state.enabled,
                toBeEnabled: (state) => state.enabled,
                toBeEmpty: (state) =>
                    state.value !== null
                        ? state.value === ""
                        : normalize(state.text) === "",
                toBeInViewport: (state) => state.inViewport,
            };
        const stateAssertions = Object.fromEntries(
            Object.entries(states).map(([name, predicate]) => [
                name,
                (options?: Options) =>
                    check(`${name}()`, undefined, options, single(predicate), {
                        viewport: name === "toBeInViewport",
                    }),
            ]),
        );

        return {
            ...stateAssertions,
            get not() {
                return assertions(!negated);
            },
            // A missing element counts as not visible.
            toBeVisible: (options?: Options) =>
                check(
                    "toBeVisible()",
                    undefined,
                    options,
                    ({ count, state }) => count === 1 && !!state?.visible,
                ),
            toBeHidden: (options?: Options) =>
                check(
                    "toBeHidden()",
                    undefined,
                    options,
                    ({ count, state }) => count === 0 || !state?.visible,
                ),
            toHaveCount: (expected: number, options?: Options) =>
                check(
                    "toHaveCount()",
                    expected,
                    options,
                    ({ count }) => count === expected,
                    {
                        strict: false,
                    },
                ),
            toContainText: (expected: string | RegExp, options?: Options) =>
                check(
                    "toContainText()",
                    expected,
                    options,
                    single((state) => textMatches(expected, state.text, false)),
                ),
            toHaveText: (expected: string | RegExp, options?: Options) =>
                check(
                    "toHaveText()",
                    expected,
                    options,
                    single((state) => textMatches(expected, state.text, true)),
                ),
            toHaveValue: (expected: string | RegExp, options?: Options) =>
                check(
                    "toHaveValue()",
                    expected,
                    options,
                    single((state) => valueMatches(expected, state.value)),
                ),
            toHaveAttribute: (
                name: string,
                expected: string | RegExp,
                options?: Options,
            ) =>
                check(
                    `toHaveAttribute(${JSON.stringify(name)})`,
                    expected,
                    options,
                    single((state) =>
                        valueMatches(expected, state.attributes[name] ?? null),
                    ),
                ),
            toHaveCSS: (
                name: string,
                expected: string | RegExp,
                options?: Options,
            ) =>
                check(
                    `toHaveCSS(${JSON.stringify(name)})`,
                    expected,
                    options,
                    single((state) => valueMatches(expected, state.css)),
                    { cssProperty: name },
                ),
        };
    };
    return assertions(false);
}
