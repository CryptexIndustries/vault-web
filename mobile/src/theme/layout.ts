/** Layout breakpoints and content width primitives (dp). */
export const layout = {
    /** Tablet / left-rail breakpoint based on the shortest viewport side. */
    tabletMinWidth: 600,
    /** Comfortable reading / form column. */
    contentMaxWidth: 480,
    /** Wider panels (vault list on tablet before split-detail). */
    panelMaxWidth: 720,
    /** Shell padding. */
    screenPaddingX: 16,
    screenPaddingY: 12,
    /** Minimum touch target (a11y). */
    minTouchTarget: 44,
    sectionGap: 16,
    cardRadius: 10,
} as const;

export function isTabletViewport(width: number, height: number): boolean {
    return Math.min(width, height) >= layout.tabletMinWidth;
}
