export type InlineIconMode = "autofill" | "generator";

export interface InlineIconController {
    readonly element: HTMLElement;
    readonly field: HTMLInputElement;
    destroy(): void;
    reposition(): void;
}

interface CreateInlineIconOptions {
    field: HTMLInputElement;
    mode: InlineIconMode;
    onClick: () => void;
}

const ICON_MIN_SIZE_PX = 16;
const ICON_MAX_SIZE_PX = 28;
const ICON_PADDING_PX = 8;
const MIN_FIELD_WIDTH_PX = 100;
const MAX_COLLISION_WIDTH_RATIO = 0.5;

const SHIELD_PATH = '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />';
const KEY_PATH =
    '<circle cx="7.5" cy="15.5" r="5.5" /><path d="m11.5 11.5 9-9M15 8l3 3M18 5l3 3" />';

function restoreInlineStyle(
    element: HTMLElement,
    property: string,
    value: string,
    priority: string,
): void {
    if (value) element.style.setProperty(property, value, priority);
    else element.style.removeProperty(property);
}

function collisionShift(
    field: HTMLInputElement,
    host: HTMLElement,
    left: number,
    top: number,
    size: number,
    rtl: boolean,
): number {
    const parent = field.parentElement;
    if (!parent || typeof document.elementsFromPoint !== "function") return 0;

    const points = [left + size * 0.25, left + size / 2, left + size * 0.75];
    const candidates = new Set<Element>();
    for (const x of points) {
        for (const element of document.elementsFromPoint(x, top + size / 2)) {
            candidates.add(element);
        }
    }

    const fieldRect = field.getBoundingClientRect();
    const maxShift = Math.max(
        0,
        fieldRect.width * MAX_COLLISION_WIDTH_RATIO - size,
    );
    let shift = 0;

    for (const element of candidates) {
        if (element === field || element === host) continue;
        if (element.closest("[data-cryptex-autofill]")) continue;
        if (!parent.contains(element)) continue;

        const control =
            element.closest("button, [role='button'], [role='img']") ?? element;
        const rect = control.getBoundingClientRect();
        if (rect.width <= 0 || rect.height <= 0) continue;
        if (rect.width >= fieldRect.width * MAX_COLLISION_WIDTH_RATIO) continue;
        if (rect.bottom <= top || rect.top >= top + size) continue;

        const overlap = rtl ? rect.right - left : left + size - rect.left;
        if (overlap > shift) shift = overlap + Math.max(6, size / 5);
    }

    return Math.min(Math.max(shift, 0), maxShift);
}

export function createInlineIcon({
    field,
    mode,
    onClick,
}: CreateInlineIconOptions): InlineIconController {
    const host = document.createElement("span");
    host.setAttribute("data-cryptex-autofill", "icon");
    host.setAttribute("aria-hidden", "true");
    host.style.cssText = [
        "position: fixed",
        "display: none",
        "visibility: hidden",
        "pointer-events: none",
        "margin: 0",
        "padding: 0",
        "border: 0",
        "z-index: 2147483646",
    ].join(";");

    const shadow = host.attachShadow({ mode: "closed" });
    const style = document.createElement("style");
    style.textContent = `
        :host { all: initial; }
        button {
            box-sizing: border-box;
            width: 100%;
            height: 100%;
            display: flex;
            align-items: center;
            justify-content: center;
            margin: 0;
            padding: 3px;
            border: 0;
            border-radius: 5px;
            background: transparent;
            color: hsl(353.61 100% 66.86%);
            cursor: pointer;
            pointer-events: auto;
            outline: none;
        }
        button:hover, button:focus-visible {
            background: hsl(224.21 28.36% 13.14% / 0.92);
        }
        button:active { transform: translateY(1px); }
        svg { display: block; width: 100%; height: 100%; fill: none; stroke: currentColor; }
        @media (prefers-reduced-motion: no-preference) {
            button { animation: cryptex-icon-in 125ms ease-out both; }
            @keyframes cryptex-icon-in { from { opacity: 0; } to { opacity: 0.92; } }
        }
    `;

    const button = document.createElement("button");
    button.type = "button";
    button.tabIndex = -1;
    button.setAttribute(
        "aria-label",
        mode === "generator" ? "Generate password" : "Open Cryptex Vault",
    );
    button.innerHTML = `<svg viewBox="0 0 24 24" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${mode === "generator" ? KEY_PATH : SHIELD_PATH}</svg>`;
    shadow.append(style, button);
    document.documentElement.appendChild(host);

    const direction =
        getComputedStyle(field).direction === "rtl" ? "rtl" : "ltr";
    const rtl = direction === "rtl";
    const paddingProperty = rtl ? "padding-left" : "padding-right";
    const originalPadding = field.style.getPropertyValue(paddingProperty);
    const originalPaddingPriority =
        field.style.getPropertyPriority(paddingProperty);
    const computedPadding = Number.parseFloat(
        getComputedStyle(field).getPropertyValue(paddingProperty),
    );
    const basePadding = Number.isFinite(computedPadding) ? computedPadding : 0;

    let destroyed = false;
    let paddingAdjusted = false;
    let appliedPadding = -1;
    let repositionFrame = -1;

    const restorePadding = () => {
        if (!paddingAdjusted) return;
        restoreInlineStyle(
            field,
            paddingProperty,
            originalPadding,
            originalPaddingPriority,
        );
        paddingAdjusted = false;
        appliedPadding = -1;
    };

    const reserveTextSpace = (padding: number) => {
        if (basePadding >= padding) {
            restorePadding();
            return;
        }
        if (paddingAdjusted && Math.abs(appliedPadding - padding) < 0.5) return;

        const widthBefore = field.getBoundingClientRect().width;
        field.style.setProperty(paddingProperty, `${padding}px`, "important");
        const widthAfter = field.getBoundingClientRect().width;

        if (Math.abs(widthAfter - widthBefore) > 0.5) {
            restoreInlineStyle(
                field,
                paddingProperty,
                originalPadding,
                originalPaddingPriority,
            );
            paddingAdjusted = false;
            appliedPadding = -1;
            return;
        }

        paddingAdjusted = true;
        appliedPadding = padding;
    };

    const reposition = () => {
        if (destroyed) return;
        cancelAnimationFrame(repositionFrame);
        repositionFrame = requestAnimationFrame(() => {
            if (destroyed || !field.isConnected) return;

            const rect = field.getBoundingClientRect();
            const viewportWidth =
                window.innerWidth || document.documentElement.clientWidth;
            const viewportHeight =
                window.innerHeight || document.documentElement.clientHeight;
            const fieldStyle = getComputedStyle(field);
            const visible =
                rect.width >= MIN_FIELD_WIDTH_PX &&
                rect.height >= ICON_MIN_SIZE_PX &&
                rect.bottom > 0 &&
                rect.right > 0 &&
                rect.top < viewportHeight &&
                rect.left < viewportWidth &&
                fieldStyle.display !== "none" &&
                fieldStyle.visibility !== "hidden";

            if (!visible) {
                host.style.display = "none";
                restorePadding();
                return;
            }

            const size = Math.max(
                ICON_MIN_SIZE_PX,
                Math.min(rect.height - ICON_PADDING_PX, ICON_MAX_SIZE_PX),
            );
            const gap = Math.max(6, size / 5);
            const initialLeft = rtl ? rect.left + gap : rect.right - size - gap;
            const top = rect.top + (rect.height - size) / 2;

            host.style.display = "block";
            host.style.visibility = "hidden";
            host.style.width = `${size}px`;
            host.style.height = `${size}px`;

            const shift = collisionShift(
                field,
                host,
                initialLeft,
                top,
                size,
                rtl,
            );
            const shiftedLeft = rtl ? initialLeft + shift : initialLeft - shift;
            const left = Math.min(
                Math.max(shiftedLeft, rect.left + 2),
                rect.right - size - 2,
            );

            reserveTextSpace(size + gap * 2 + shift);
            host.style.left = `${left}px`;
            host.style.top = `${top}px`;
            host.style.visibility = "visible";
        });
    };

    const onPointerDown = (event: PointerEvent) => {
        event.preventDefault();
        event.stopPropagation();
        onClick();
    };
    const stopClick = (event: MouseEvent) => {
        event.preventDefault();
        event.stopPropagation();
    };
    button.addEventListener("pointerdown", onPointerDown);
    button.addEventListener("click", stopClick);

    const resizeObserver =
        typeof ResizeObserver === "function"
            ? new ResizeObserver(reposition)
            : null;
    resizeObserver?.observe(field);
    if (field.parentElement) resizeObserver?.observe(field.parentElement);

    const destroy = () => {
        if (destroyed) return;
        destroyed = true;
        cancelAnimationFrame(repositionFrame);
        resizeObserver?.disconnect();
        button.removeEventListener("pointerdown", onPointerDown);
        button.removeEventListener("click", stopClick);
        restorePadding();
        host.remove();
    };

    const controller = { element: host, field, destroy, reposition };
    reposition();
    return controller;
}
