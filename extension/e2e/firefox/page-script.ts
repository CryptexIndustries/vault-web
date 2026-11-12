export type Matcher =
    | { kind: "string"; value: string; exact?: boolean }
    | { kind: "regex"; source: string; flags: string };
export type Step =
    | { kind: "css"; selector: string }
    | { kind: "role"; role: string; name?: Matcher }
    | { kind: "text"; text: Matcher }
    | { kind: "label"; text: Matcher }
    | { kind: "title"; text: Matcher }
    | { kind: "testid"; id: string }
    | { kind: "hasText"; text: Matcher }
    | { kind: "nth"; index: number };

/**
 * Runs inside the page. The driver sends this function's source with each
 * call, so it must not reference anything outside its own body.
 *
 * It follows Playwright's rules closely enough for our specs: role and name
 * per ARIA, text matching with normalized whitespace, and the same visibility
 * and actionability checks.
 */
export function pageScript() {
    const ZERO_WIDTH_SPACE = String.fromCharCode(0x200b);
    const normalize = (text: string) =>
        text.replaceAll(ZERO_WIDTH_SPACE, "").trim().replace(/\s+/g, " ");

    function matches(matcher: Matcher, raw: string) {
        const text = normalize(raw);
        if (matcher.kind === "regex") {
            return new RegExp(matcher.source, matcher.flags).test(text);
        }
        const wanted = normalize(matcher.value);
        return matcher.exact
            ? text === wanted
            : text.toLowerCase().includes(wanted.toLowerCase());
    }

    const SKIPPED_TEXT = new Set(["SCRIPT", "STYLE", "NOSCRIPT", "TEMPLATE"]);

    function elementText(element: Element): string {
        if (SKIPPED_TEXT.has(element.nodeName)) return "";
        if (
            element instanceof HTMLInputElement &&
            ["button", "submit", "reset"].includes(element.type)
        ) {
            return element.value;
        }
        let text = "";
        for (const child of element.childNodes) {
            if (child.nodeType === Node.TEXT_NODE) text += child.nodeValue;
            else if (child instanceof Element) text += elementText(child);
        }
        return text;
    }

    function isVisible(element: Element): boolean {
        if (!element.isConnected) return false;
        if (!element.checkVisibility()) return false;
        const style = getComputedStyle(element);
        if (style.display === "contents") {
            return [...element.children].some(isVisible);
        }
        if (style.visibility !== "visible") return false;
        const rect = element.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
    }

    function isHiddenFromAccessibility(element: Element) {
        for (
            let node: Element | null = element;
            node;
            node = node.parentElement
        ) {
            if (node.getAttribute("aria-hidden") === "true") return true;
            if (node.hasAttribute("inert")) return true;
        }
        return !element.checkVisibility({ visibilityProperty: true });
    }

    function implicitRole(element: Element): string | null {
        const tag = element.localName;
        if (/^h[1-6]$/.test(tag)) return "heading";
        if (element instanceof HTMLInputElement) {
            const type = element.type;
            if (["button", "submit", "reset", "image"].includes(type)) {
                return "button";
            }
            if (type === "checkbox") return "checkbox";
            if (type === "radio") return "radio";
            if (type === "hidden" || type === "file") return null;
            if (element.hasAttribute("list")) return "combobox";
            return type === "search" ? "searchbox" : "textbox";
        }
        if (element instanceof HTMLSelectElement) {
            return element.multiple || element.size > 1
                ? "listbox"
                : "combobox";
        }
        if ((tag === "a" || tag === "area") && element.hasAttribute("href")) {
            return "link";
        }
        const roles: Record<string, string> = {
            button: "button",
            dialog: "dialog",
            img: "img",
            li: "listitem",
            main: "main",
            nav: "navigation",
            ol: "list",
            option: "option",
            output: "status",
            textarea: "textbox",
            ul: "list",
        };
        return roles[tag] ?? null;
    }

    function role(element: Element) {
        const explicit = element.getAttribute("role")?.trim().split(/\s+/)[0];
        return explicit || implicitRole(element);
    }

    const NAME_FROM_CONTENT = new Set([
        "button",
        "checkbox",
        "heading",
        "link",
        "menuitem",
        "menuitemcheckbox",
        "menuitemradio",
        "option",
        "radio",
        "switch",
        "tab",
    ]);

    function textFromContent(element: Element): string {
        let text = "";
        for (const child of element.childNodes) {
            if (child.nodeType === Node.TEXT_NODE) {
                text += child.nodeValue;
                continue;
            }
            if (!(child instanceof Element)) continue;
            if (
                child.getAttribute("aria-hidden") === "true" ||
                !child.checkVisibility({ visibilityProperty: true })
            ) {
                continue;
            }
            const label = child.getAttribute("aria-label")?.trim();
            const inline = getComputedStyle(child).display.startsWith("inline");
            const part = label
                ? label
                : child instanceof HTMLImageElement
                  ? child.alt
                  : textFromContent(child);
            text += inline ? part : ` ${part} `;
        }
        return text;
    }

    function labelledByText(element: Element) {
        const ids = element.getAttribute("aria-labelledby")?.trim();
        if (!ids) return null;
        return ids
            .split(/\s+/)
            .map((id) => document.getElementById(id))
            .filter((label): label is HTMLElement => label !== null)
            .map(
                (label) =>
                    label.getAttribute("aria-label") ?? textFromContent(label),
            )
            .join(" ");
    }

    function controlLabels(element: Element): string[] {
        const labels =
            "labels" in element
                ? (element.labels as NodeListOf<HTMLLabelElement> | null)
                : null;
        return [...(labels ?? [])].map((label) => textFromContent(label));
    }

    function accessibleName(element: Element): string {
        const labelledBy = labelledByText(element);
        if (labelledBy?.trim()) return normalize(labelledBy);
        const ariaLabel = element.getAttribute("aria-label");
        if (ariaLabel?.trim()) return normalize(ariaLabel);
        if (
            element instanceof HTMLInputElement &&
            ["button", "submit", "reset"].includes(element.type)
        ) {
            return normalize(element.value);
        }
        if (
            element instanceof HTMLInputElement ||
            element instanceof HTMLTextAreaElement ||
            element instanceof HTMLSelectElement
        ) {
            const labels = controlLabels(element).join(" ");
            if (labels.trim()) return normalize(labels);
            return normalize(
                element.getAttribute("title") ??
                    element.getAttribute("placeholder") ??
                    "",
            );
        }
        if (element instanceof HTMLImageElement) return normalize(element.alt);
        const elementRole = role(element);
        if (elementRole && NAME_FROM_CONTENT.has(elementRole)) {
            const content = normalize(textFromContent(element));
            if (content) return content;
            const labels = controlLabels(element).join(" ");
            if (labels.trim()) return normalize(labels);
        }
        return normalize(element.getAttribute("title") ?? "");
    }

    function labelTexts(element: Element): string[] {
        const texts = controlLabels(element);
        const ariaLabel = element.getAttribute("aria-label");
        if (ariaLabel) texts.push(ariaLabel);
        const labelledBy = labelledByText(element);
        if (labelledBy) texts.push(labelledBy);
        return texts;
    }

    function descendants(roots: Element[]) {
        const found = new Set<Element>();
        for (const root of roots) {
            for (const element of root.querySelectorAll("*")) {
                found.add(element);
            }
        }
        return [...found];
    }

    function applyStep(roots: Element[], step: Step): Element[] {
        switch (step.kind) {
            case "css": {
                const found = new Set<Element>();
                for (const root of roots) {
                    for (const element of root.querySelectorAll(
                        step.selector,
                    )) {
                        found.add(element);
                    }
                }
                return [...found];
            }
            case "role":
                return descendants(roots).filter(
                    (element) =>
                        role(element) === step.role &&
                        !isHiddenFromAccessibility(element) &&
                        (!step.name ||
                            matches(step.name, accessibleName(element))),
                );
            case "text":
                // The smallest elements with the text, as Playwright does.
                return descendants(roots).filter(
                    (element) =>
                        !SKIPPED_TEXT.has(element.nodeName) &&
                        matches(step.text, elementText(element)) &&
                        ![...element.children].some((child) =>
                            matches(step.text, elementText(child)),
                        ),
                );
            case "label":
                return descendants(roots).filter((element) =>
                    labelTexts(element).some((text) =>
                        matches(step.text, text),
                    ),
                );
            case "title":
                return descendants(roots).filter((element) => {
                    const title = element.getAttribute("title");
                    return title !== null && matches(step.text, title);
                });
            case "testid":
                return descendants(roots).filter(
                    (element) =>
                        element.getAttribute("data-testid") === step.id,
                );
            case "hasText":
                return roots.filter((element) =>
                    matches(step.text, elementText(element)),
                );
            case "nth": {
                const element = roots.at(step.index);
                return element ? [element] : [];
            }
        }
    }

    function query(steps: Step[]): Element[] {
        let elements: Element[] = [document.documentElement];
        for (const step of steps) elements = applyStep(elements, step);
        return elements;
    }

    function isDisabled(element: Element) {
        return (
            element.matches(":disabled") ||
            element.closest('[aria-disabled="true"]') !== null
        );
    }

    function isChecked(element: Element) {
        if (
            element instanceof HTMLInputElement &&
            ["checkbox", "radio"].includes(element.type)
        ) {
            return element.checked;
        }
        return element.getAttribute("aria-checked") === "true";
    }

    // A tab that isn't selected may not get animation frames.
    const nextFrame = () =>
        new Promise((resolve) => {
            requestAnimationFrame(resolve);
            setTimeout(resolve, 50);
        });

    /**
     * Firefox ignores preventDefault() on an automated pointerdown, so the
     * mousedown after it still moves focus and a Radix menu closes as soon as
     * it opens. This records the call and drops that mousedown and mouseup,
     * as real input does (Pointer Events, compatibility mouse events).
     */
    function honorCanceledPointerDown() {
        const scope = window as unknown as { __cryptexE2EPointer?: boolean };
        if (scope.__cryptexE2EPointer) return;
        scope.__cryptexE2EPointer = true;
        let canceled = false;
        window.addEventListener(
            "pointerdown",
            (event) => {
                canceled = false;
                const preventDefault = event.preventDefault;
                event.preventDefault = function () {
                    canceled = true;
                    preventDefault.call(this);
                };
            },
            true,
        );
        for (const type of ["mousedown", "mouseup"]) {
            window.addEventListener(
                type,
                (event) => {
                    if (!canceled) return;
                    event.preventDefault();
                    event.stopImmediatePropagation();
                },
                true,
            );
        }
    }

    /** Why a click would miss the element, or null when it would land. */
    async function clickBlocker(element: Element) {
        honorCanceledPointerDown();
        if (!element.isConnected) return "element is not attached";
        if (!isVisible(element)) return "element is not visible";
        if (isDisabled(element)) return "element is disabled";
        // Scrolls every container that clips it, as Playwright does.
        element.scrollIntoView({ block: "nearest", inline: "nearest" });
        const before = element.getBoundingClientRect();
        await nextFrame();
        await nextFrame();
        const after = element.getBoundingClientRect();
        if (
            before.x !== after.x ||
            before.y !== after.y ||
            before.width !== after.width ||
            before.height !== after.height
        ) {
            return "element is not stable";
        }
        const hit = document.elementFromPoint(
            after.x + after.width / 2,
            after.y + after.height / 2,
        );
        if (!hit || !(hit === element || element.contains(hit))) {
            const owner =
                hit instanceof HTMLLabelElement && hit.control === element;
            if (!owner) {
                return `${hit?.outerHTML.slice(0, 120) ?? "nothing"} intercepts pointer events`;
            }
        }
        return null;
    }

    function fill(element: Element, value: string) {
        if (!isVisible(element)) return "element is not visible";
        if (
            !(element instanceof HTMLInputElement) &&
            !(element instanceof HTMLTextAreaElement)
        ) {
            return "element is not a text field";
        }
        if (element.readOnly || isDisabled(element)) {
            return "element is not editable";
        }
        element.focus();
        // The prototype setter goes around React's value tracker, so React
        // sees the change and runs onChange.
        Object.getOwnPropertyDescriptor(
            Object.getPrototypeOf(element),
            "value",
        )!.set!.call(element, value);
        element.dispatchEvent(
            new InputEvent("input", {
                bubbles: true,
                inputType: "insertText",
                data: value,
            }),
        );
        element.dispatchEvent(new Event("change", { bubbles: true }));
        return null;
    }

    /**
     * Whether any of the element shows in the viewport, clipping by scrolling
     * ancestors included, as Playwright checks it. null when the observer
     * gives no answer in time.
     */
    function inViewport(element: Element) {
        return new Promise<boolean | null>((resolve) => {
            const observer = new IntersectionObserver(([entry]) => {
                observer.disconnect();
                resolve(entry!.intersectionRatio > 0);
            });
            observer.observe(element);
            setTimeout(() => {
                observer.disconnect();
                resolve(null);
            }, 1000);
        });
    }

    /** What the matchers and actions read about one element. */
    async function state(
        element: Element,
        { cssProperty, viewport }: { cssProperty?: string; viewport?: boolean },
    ) {
        const rect = element.getBoundingClientRect();
        return {
            visible: isVisible(element),
            enabled: !isDisabled(element),
            checked: isChecked(element),
            text: elementText(element),
            textContent: element.textContent ?? "",
            value:
                element instanceof HTMLInputElement ||
                element instanceof HTMLTextAreaElement ||
                element instanceof HTMLSelectElement
                    ? element.value
                    : null,
            attributes: Object.fromEntries(
                [...element.attributes].map((attribute) => [
                    attribute.name,
                    attribute.value,
                ]),
            ),
            css: cssProperty
                ? getComputedStyle(element).getPropertyValue(cssProperty)
                : null,
            inViewport: viewport ? await inViewport(element) : null,
            box: {
                x: rect.x,
                y: rect.y,
                width: rect.width,
                height: rect.height,
            },
        };
    }

    return {
        elements: query,
        /** The match count, and the state when exactly one element matches. */
        async inspect(
            steps: Step[],
            options: { cssProperty?: string; viewport?: boolean },
        ) {
            const found = query(steps);
            return {
                count: found.length,
                state:
                    found.length === 1 ? await state(found[0]!, options) : null,
            };
        },
        /** The window of the one iframe the steps match. */
        frameWindow(steps: Step[]) {
            const found = query(steps);
            return found.length === 1 && found[0] instanceof HTMLIFrameElement
                ? found[0].contentWindow
                : null;
        },
        clickBlocker,
        fill,
    };
}
