"use client";
import { useEffect, useRef } from "react";
import type { PointerEvent } from "react";

/** Scrolling and cancelled touches must never open a device menu. */
export function useDeviceLongPress(onOpen: () => void) {
    const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
    const start = useRef<{ x: number; y: number } | null>(null);
    const fired = useRef(false);
    const cancel = () => {
        if (timer.current) clearTimeout(timer.current);
        timer.current = null;
        start.current = null;
    };
    useEffect(() => cancel, []);
    return {
        onPointerDown: (e: PointerEvent<HTMLElement>) => {
            if (!e.currentTarget.contains(e.target as Node)) return;
            cancel();
            fired.current = false;
            if (
                !e.isPrimary ||
                e.pointerType === "mouse" ||
                (e.target as HTMLElement).closest("[data-device-menu-trigger]")
            )
                return;
            start.current = { x: e.clientX, y: e.clientY };
            timer.current = setTimeout(() => {
                fired.current = true;
                cancel();
                onOpen();
            }, 500);
        },
        onPointerMove: (e: PointerEvent<HTMLElement>) => {
            if (
                start.current &&
                Math.hypot(
                    e.clientX - start.current.x,
                    e.clientY - start.current.y,
                ) > 10
            )
                cancel();
        },
        onPointerUp: cancel,
        onPointerCancel: cancel,
        onPointerLeave: cancel,
        onClickCapture: (e: React.MouseEvent<HTMLElement>) => {
            if (fired.current && e.currentTarget.contains(e.target as Node)) {
                e.preventDefault();
                e.stopPropagation();
                fired.current = false;
            }
        },
    };
}
