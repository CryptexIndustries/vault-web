"use client";

import {
    useCallback,
    useEffect,
    useLayoutEffect,
    useMemo,
    useRef,
    useState,
} from "react";
import {
    Crown,
    Expand,
    Globe,
    HelpCircle,
    Link2,
    Maximize2,
    Minimize,
    Minus,
    Monitor,
    Plus,
    Shield,
    Smartphone,
    Tablet,
    Trash2,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import {
    Tooltip,
    TooltipContent,
    TooltipProvider,
    TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

import {
    buildDeviceRelationshipMap,
    formatRelativeAccountDate,
    formatSyncId,
} from "./account-dialog/device-topology";

type RelationshipMap = ReturnType<typeof buildDeviceRelationshipMap>;
type DeviceNode = RelationshipMap["nodes"][number];
type OrphanGhost = RelationshipMap["orphanGhosts"][number];
type Relationship = RelationshipMap["relationships"][number];

type LaidOutPosition = { x: number; y: number };
type RingGuide = { cx: number; cy: number; radius: number };
type ConstellationLayout = {
    positions: Map<string, LaidOutPosition>;
    width: number;
    height: number;
    rings: RingGuide[];
    center: { x: number; y: number } | null;
};

const ORPHAN_TOOLTIP =
    "Online Services link present locally but not found on the server - probably deleted by another device.";

const NODE_WIDTH = 92;
const LAYOUT_MARGIN = 32;

const RING_BASE_CAPACITY = 8;
const RING_BASE_RADIUS = 180;

const MIN_SCALE = 0.15;
const MAX_SCALE = 2.5;
const FOCUS_SCALE = 1.2;
const FIT_PADDING = 32;

export interface DevicesPanelProps {
    map: RelationshipMap;
    canPromote: boolean;
    removing: boolean;
    promoting: boolean;
    onRemove: (id: string) => void;
    onToggleRoot: (id: string, root: boolean) => void;
}

function getDeviceIcon(kind: string) {
    switch (kind) {
        case "Mobile":
            return Smartphone;
        case "Tablet":
            return Tablet;
        case "Browser":
            return Globe;
        default:
            return Monitor;
    }
}

function deviceDisplay(node: DeviceNode) {
    if (node.localDevice?.Name) return node.localDevice.Name;
    if (node.current) return "Current device";
    return "Untitled device";
}

function canRemoveDevice(node: DeviceNode) {
    return !node.current && !node.root;
}

function canTogglePromote(
    node: DeviceNode,
    map: RelationshipMap,
    canPromote: boolean,
) {
    if (!canPromote) return false;
    if (node.root && map.rootCount <= 1) return false;
    return true;
}

function computeLayout(map: RelationshipMap): ConstellationLayout {
    const positions = new Map<string, LaidOutPosition>();
    const center =
        map.nodes.find((n) => n.current) ??
        map.nodes.find((n) => n.root) ??
        map.nodes[0];

    if (!center) {
        const fallback = NODE_WIDTH + LAYOUT_MARGIN * 2;
        return {
            positions,
            width: fallback,
            height: fallback,
            rings: [],
            center: null,
        };
    }

    const peers = map.nodes.filter((n) => n.id !== center.id);
    const orbiters: { id: string }[] = [...peers, ...map.orphanGhosts];

    let ringCount = 0;
    let placed = 0;
    while (placed < orbiters.length) {
        ringCount++;
        placed += Math.min(
            RING_BASE_CAPACITY * ringCount,
            orbiters.length - placed,
        );
    }
    const maxRadius = ringCount * RING_BASE_RADIUS;

    const half = maxRadius + LAYOUT_MARGIN + NODE_WIDTH;
    const cx = half;
    const cy = half;
    positions.set(center.id, { x: cx, y: cy });

    const rings: RingGuide[] = [];
    placed = 0;
    for (let ring = 1; ring <= ringCount; ring++) {
        const capacity = RING_BASE_CAPACITY * ring;
        const onThisRing = Math.min(capacity, orbiters.length - placed);
        const radius = RING_BASE_RADIUS * ring;
        rings.push({ cx, cy, radius });
        const startAngle = -Math.PI / 2 + (ring - 1) * 0.18;
        for (let i = 0; i < onThisRing; i++) {
            const angle = startAngle + (i * 2 * Math.PI) / onThisRing;
            const item = orbiters[placed + i];
            if (!item) continue;
            positions.set(item.id, {
                x: cx + Math.cos(angle) * radius,
                y: cy + Math.sin(angle) * radius,
            });
        }
        placed += onThisRing;
    }

    const size = 2 * half;
    return {
        positions,
        width: size,
        height: size,
        rings,
        center: { x: cx, y: cy },
    };
}

type Selection =
    | { kind: "node"; id: string }
    | { kind: "edge"; syncId: string };

export function DevicesConstellation({
    map,
    canPromote,
    removing,
    promoting,
    onRemove,
    onToggleRoot,
}: DevicesPanelProps) {
    const layout = useMemo(() => computeLayout(map), [map]);

    const [selection, setSelection] = useState<Selection | null>(() => {
        const current = map.nodes.find((n) => n.current);
        if (current) return { kind: "node", id: current.id };
        if (map.nodes[0]) return { kind: "node", id: map.nodes[0].id };
        return null;
    });

    const selectedNode =
        selection?.kind === "node"
            ? (map.nodes.find((n) => n.id === selection.id) ?? null)
            : null;
    const selectedEdge =
        selection?.kind === "edge"
            ? (map.relationships.find((r) => r.syncId === selection.syncId) ??
              null)
            : null;

    const selectedNodeRels = useMemo(
        () =>
            selectedNode
                ? map.relationships.filter(
                      (r) =>
                          r.fromDeviceId === selectedNode.id ||
                          r.toDeviceId === selectedNode.id,
                  )
                : [],
        [map.relationships, selectedNode],
    );

    const incidentNodeIds = useMemo(() => {
        if (selection?.kind === "edge" && selectedEdge) {
            return new Set([
                selectedEdge.fromDeviceId,
                selectedEdge.toDeviceId,
            ]);
        }
        if (selection?.kind === "node" && selectedNode) {
            const ids = new Set<string>([selectedNode.id]);
            for (const r of selectedNodeRels) {
                ids.add(r.fromDeviceId);
                ids.add(r.toDeviceId);
            }
            return ids;
        }
        return new Set<string>();
    }, [selection, selectedEdge, selectedNode, selectedNodeRels]);

    const currentNode = useMemo(
        () => map.nodes.find((n) => n.current) ?? null,
        [map.nodes],
    );

    const totalCount = map.nodes.length + map.orphanGhosts.length;
    const viewportRef = useRef<HTMLDivElement | null>(null);
    const containerRef = useRef<HTMLDivElement | null>(null);
    const [isFullscreen, setIsFullscreen] = useState(false);

    useEffect(() => {
        const onChange = () => {
            setIsFullscreen(
                document.fullscreenElement === containerRef.current,
            );
        };
        document.addEventListener("fullscreenchange", onChange);
        return () => document.removeEventListener("fullscreenchange", onChange);
    }, []);

    const toggleFullscreen = useCallback(() => {
        const el = containerRef.current;
        if (!el) return;
        if (document.fullscreenElement) {
            void document.exitFullscreen();
        } else {
            void el.requestFullscreen?.();
        }
    }, []);

    const [view, setView] = useState<{
        scale: number;
        tx: number;
        ty: number;
    }>({ scale: 1, tx: 0, ty: 0 });
    const [animate, setAnimate] = useState(true);
    const [isPanning, setIsPanning] = useState(false);
    const panStartRef = useRef<{
        x: number;
        y: number;
        tx: number;
        ty: number;
    } | null>(null);
    const mountedRef = useRef(false);
    const prevSelectionRef = useRef<Selection | null>(null);

    const clampScale = useCallback(
        (s: number) => Math.max(MIN_SCALE, Math.min(MAX_SCALE, s)),
        [],
    );

    const fitAll = useCallback(() => {
        const vp = viewportRef.current;
        if (!vp) return;
        const w = vp.clientWidth;
        const h = vp.clientHeight;
        if (!w || !h) return;
        const scale = clampScale(
            Math.min(
                (w - FIT_PADDING * 2) / Math.max(layout.width, 1),
                (h - FIT_PADDING * 2) / Math.max(layout.height, 1),
                1,
            ),
        );
        setAnimate(true);
        setView({
            scale,
            tx: (w - layout.width * scale) / 2,
            ty: (h - layout.height * scale) / 2,
        });
    }, [layout, clampScale]);

    const focusOnPoint = useCallback(
        (point: LaidOutPosition, targetScale = FOCUS_SCALE) => {
            const vp = viewportRef.current;
            if (!vp) return;
            const w = vp.clientWidth;
            const h = vp.clientHeight;
            const scale = clampScale(targetScale);
            setAnimate(true);
            setView({
                scale,
                tx: w / 2 - point.x * scale,
                ty: h / 2 - point.y * scale,
            });
        },
        [clampScale],
    );

    const zoomBy = useCallback(
        (factor: number) => {
            const vp = viewportRef.current;
            if (!vp) return;
            const cx = vp.clientWidth / 2;
            const cy = vp.clientHeight / 2;
            setAnimate(true);
            setView((v) => {
                const next = clampScale(v.scale * factor);
                const realFactor = next / v.scale;
                return {
                    scale: next,
                    tx: cx - (cx - v.tx) * realFactor,
                    ty: cy - (cy - v.ty) * realFactor,
                };
            });
        },
        [clampScale],
    );

    useLayoutEffect(() => {
        fitAll();
    }, [fitAll]);

    useLayoutEffect(() => {
        const vp = viewportRef.current;
        if (!vp || typeof ResizeObserver === "undefined") return;
        const ro = new ResizeObserver(() => fitAll());
        ro.observe(vp);
        return () => ro.disconnect();
    }, [fitAll]);

    useEffect(() => {
        if (!mountedRef.current) {
            mountedRef.current = true;
            prevSelectionRef.current = selection;
            return;
        }
        if (prevSelectionRef.current === selection) return;
        prevSelectionRef.current = selection;
        if (!selection) return;
        if (selection.kind === "node") {
            const pos = layout.positions.get(selection.id);
            if (pos) focusOnPoint(pos);
            return;
        }
        const edge = map.relationships.find(
            (r) => r.syncId === selection.syncId,
        );
        if (!edge) return;
        const from = layout.positions.get(edge.fromDeviceId);
        const to = layout.positions.get(edge.toDeviceId);
        if (!from || !to) return;
        focusOnPoint({
            x: (from.x + to.x) / 2,
            y: (from.y + to.y) / 2,
        });
    }, [selection, layout, focusOnPoint, map.relationships]);

    useEffect(() => {
        const vp = viewportRef.current;
        if (!vp) return;
        const handler = (event: WheelEvent) => {
            event.preventDefault();
            const rect = vp.getBoundingClientRect();
            const cx = event.clientX - rect.left;
            const cy = event.clientY - rect.top;
            const factor = event.deltaY < 0 ? 1.12 : 1 / 1.12;
            setAnimate(false);
            setView((v) => {
                const next = clampScale(v.scale * factor);
                const realFactor = next / v.scale;
                return {
                    scale: next,
                    tx: cx - (cx - v.tx) * realFactor,
                    ty: cy - (cy - v.ty) * realFactor,
                };
            });
        };
        vp.addEventListener("wheel", handler, { passive: false });
        return () => vp.removeEventListener("wheel", handler);
    }, [clampScale]);

    const isInteractiveTarget = (target: EventTarget | null) => {
        if (!(target instanceof Element)) return false;
        return !!target.closest(
            "button, [role='button'], [data-interactive='true']",
        );
    };

    const onPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
        if (event.button !== 0) return;
        if (isInteractiveTarget(event.target)) return;
        panStartRef.current = {
            x: event.clientX,
            y: event.clientY,
            tx: view.tx,
            ty: view.ty,
        };
        setIsPanning(true);
        setAnimate(false);
        event.currentTarget.setPointerCapture(event.pointerId);
    };

    const onPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
        const start = panStartRef.current;
        if (!start) return;
        const dx = event.clientX - start.x;
        const dy = event.clientY - start.y;
        setView((v) => ({ ...v, tx: start.tx + dx, ty: start.ty + dy }));
    };

    const onPointerUp = (event: React.PointerEvent<HTMLDivElement>) => {
        if (!panStartRef.current) return;
        panStartRef.current = null;
        setIsPanning(false);
        try {
            event.currentTarget.releasePointerCapture(event.pointerId);
        } catch {
            // ignore release errors on already-released captures
        }
    };

    const minViewportHeight = Math.min(
        Math.max(26 * 16, totalCount * 28 + 18 * 16),
        72 * 16,
    );

    const scalePct = Math.round(view.scale * 100);

    return (
        <TooltipProvider delayDuration={150}>
            <div
                ref={containerRef}
                className={cn(
                    "grid gap-4 lg:grid-cols-[minmax(0,1.5fr)_minmax(20rem,1fr)]",
                    isFullscreen &&
                        "h-screen w-screen overflow-auto bg-background p-4",
                )}
            >
                <div
                    ref={viewportRef}
                    onPointerDown={onPointerDown}
                    onPointerMove={onPointerMove}
                    onPointerUp={onPointerUp}
                    onPointerCancel={onPointerUp}
                    className={cn(
                        "relative touch-none select-none overflow-hidden rounded-xl border bg-gradient-to-br from-primary/10 via-background to-background",
                        isPanning ? "cursor-grabbing" : "cursor-grab",
                    )}
                    style={{
                        height: isFullscreen
                            ? "calc(100vh - 2rem)"
                            : minViewportHeight,
                    }}
                >
                    <div
                        className="absolute left-0 top-0 origin-top-left will-change-transform"
                        style={{
                            width: layout.width,
                            height: layout.height,
                            transform: `translate3d(${view.tx}px, ${view.ty}px, 0) scale(${view.scale})`,
                            transition: animate
                                ? "transform 220ms cubic-bezier(0.22, 1, 0.36, 1)"
                                : "none",
                        }}
                    >
                        <svg
                            className="pointer-events-none absolute inset-0"
                            width={layout.width}
                            height={layout.height}
                            aria-hidden="true"
                        >
                            {layout.rings.map((r, i) => (
                                <circle
                                    key={`ring-${i}`}
                                    cx={r.cx}
                                    cy={r.cy}
                                    r={r.radius}
                                    fill="none"
                                    className="stroke-primary/15"
                                    strokeWidth={1}
                                    strokeDasharray="4 8"
                                    vectorEffect="non-scaling-stroke"
                                />
                            ))}
                            <g className="pointer-events-auto">
                                {map.relationships.map((rel) => {
                                    const from = layout.positions.get(
                                        rel.fromDeviceId,
                                    );
                                    const to = layout.positions.get(
                                        rel.toDeviceId,
                                    );
                                    if (!from || !to) return null;
                                    const isSelectedEdge =
                                        selection?.kind === "edge" &&
                                        selection.syncId === rel.syncId;
                                    const isIncident =
                                        selection?.kind === "node" &&
                                        (rel.fromDeviceId === selection.id ||
                                            rel.toDeviceId === selection.id);
                                    const highlighted =
                                        isSelectedEdge || isIncident;
                                    return (
                                        <EdgeLine
                                            key={rel.syncId}
                                            from={from}
                                            to={to}
                                            highlighted={highlighted}
                                            dimmed={!!selection && !highlighted}
                                            dashed={!rel.localDevice}
                                            onClick={() =>
                                                setSelection({
                                                    kind: "edge",
                                                    syncId: rel.syncId,
                                                })
                                            }
                                            label={
                                                isSelectedEdge
                                                    ? formatSyncId(rel.syncId)
                                                    : undefined
                                            }
                                        />
                                    );
                                })}
                                {currentNode
                                    ? map.orphanGhosts.map((ghost) => {
                                          const from = layout.positions.get(
                                              currentNode.id,
                                          );
                                          const to = layout.positions.get(
                                              ghost.id,
                                          );
                                          if (!from || !to) return null;
                                          return (
                                              <line
                                                  key={`ghost-line-${ghost.id}`}
                                                  x1={from.x}
                                                  y1={from.y}
                                                  x2={to.x}
                                                  y2={to.y}
                                                  className="pointer-events-none stroke-primary/50"
                                                  strokeWidth={1.5}
                                                  strokeDasharray="4 6"
                                                  vectorEffect="non-scaling-stroke"
                                              />
                                          );
                                      })
                                    : null}
                            </g>
                        </svg>

                        {map.nodes.map((node) => {
                            const pos = layout.positions.get(node.id);
                            if (!pos) return null;
                            const isSelected =
                                selection?.kind === "node" &&
                                selection.id === node.id;
                            const isIncident = incidentNodeIds.has(node.id);
                            const dimmed = !!selection && !isIncident;
                            return (
                                <DeviceTileButton
                                    key={node.id}
                                    node={node}
                                    x={pos.x}
                                    y={pos.y}
                                    selected={isSelected}
                                    dimmed={dimmed}
                                    onSelect={() =>
                                        setSelection({
                                            kind: "node",
                                            id: node.id,
                                        })
                                    }
                                />
                            );
                        })}

                        {map.orphanGhosts.map((ghost) => {
                            const pos = layout.positions.get(ghost.id);
                            if (!pos) return null;
                            const ghostDimmed =
                                !!selection &&
                                !(
                                    selection.kind === "node" &&
                                    currentNode?.id === selection.id
                                );
                            return (
                                <OrphanGhostTile
                                    key={ghost.id}
                                    ghost={ghost}
                                    x={pos.x}
                                    y={pos.y}
                                    dimmed={ghostDimmed}
                                />
                            );
                        })}
                    </div>

                    <div className="pointer-events-none absolute left-3 top-3 flex flex-wrap gap-1.5 text-[0.7rem]">
                        <span className="pointer-events-auto rounded-full bg-card/80 px-2 py-0.5 backdrop-blur">
                            {map.nodes.length} devices
                        </span>
                        <span className="pointer-events-auto rounded-full bg-primary/15 px-2 py-0.5 font-medium text-primary backdrop-blur">
                            {map.rootCount} root
                        </span>
                        <span className="pointer-events-auto rounded-full bg-card/80 px-2 py-0.5 backdrop-blur">
                            {map.relationships.length} links
                        </span>
                        {map.orphanGhosts.length ? (
                            <Tooltip>
                                <TooltipTrigger asChild>
                                    <span className="pointer-events-auto cursor-help rounded-full border border-dashed border-primary/50 bg-card/80 px-2 py-0.5 backdrop-blur">
                                        {map.orphanGhosts.length} unmatched
                                    </span>
                                </TooltipTrigger>
                                <TooltipContent className="max-w-xs">
                                    {ORPHAN_TOOLTIP}
                                </TooltipContent>
                            </Tooltip>
                        ) : null}
                    </div>

                    <div
                        data-interactive="true"
                        className="absolute right-3 top-3 flex flex-col gap-1 rounded-md border bg-card/80 p-1 shadow-sm backdrop-blur"
                    >
                        <Tooltip>
                            <TooltipTrigger asChild>
                                <Button
                                    type="button"
                                    size="icon"
                                    variant="ghost"
                                    className="h-7 w-7"
                                    onClick={fitAll}
                                    aria-label="Fit all devices"
                                >
                                    <Maximize2 className="h-3.5 w-3.5" />
                                </Button>
                            </TooltipTrigger>
                            <TooltipContent>Fit all</TooltipContent>
                        </Tooltip>
                        <Tooltip>
                            <TooltipTrigger asChild>
                                <Button
                                    type="button"
                                    size="icon"
                                    variant="ghost"
                                    className="h-7 w-7"
                                    onClick={() => zoomBy(1.25)}
                                    aria-label="Zoom in"
                                >
                                    <Plus className="h-3.5 w-3.5" />
                                </Button>
                            </TooltipTrigger>
                            <TooltipContent>Zoom in</TooltipContent>
                        </Tooltip>
                        <Tooltip>
                            <TooltipTrigger asChild>
                                <Button
                                    type="button"
                                    size="icon"
                                    variant="ghost"
                                    className="h-7 w-7"
                                    onClick={() => zoomBy(1 / 1.25)}
                                    aria-label="Zoom out"
                                >
                                    <Minus className="h-3.5 w-3.5" />
                                </Button>
                            </TooltipTrigger>
                            <TooltipContent>Zoom out</TooltipContent>
                        </Tooltip>
                        <Tooltip>
                            <TooltipTrigger asChild>
                                <Button
                                    type="button"
                                    size="icon"
                                    variant="ghost"
                                    className="h-7 w-7"
                                    onClick={toggleFullscreen}
                                    aria-label={
                                        isFullscreen
                                            ? "Exit fullscreen"
                                            : "Enter fullscreen"
                                    }
                                >
                                    {isFullscreen ? (
                                        <Minimize className="h-3.5 w-3.5" />
                                    ) : (
                                        <Expand className="h-3.5 w-3.5" />
                                    )}
                                </Button>
                            </TooltipTrigger>
                            <TooltipContent>
                                {isFullscreen
                                    ? "Exit fullscreen"
                                    : "Fullscreen"}
                            </TooltipContent>
                        </Tooltip>
                        <span className="px-1 text-center font-mono text-[0.6rem] text-muted-foreground">
                            {scalePct}%
                        </span>
                    </div>
                </div>

                <Card>
                    {selection === null ? (
                        <CardContent className="p-6 text-sm text-muted-foreground">
                            Tap a device or trust link on the map.
                        </CardContent>
                    ) : selection.kind === "edge" && selectedEdge ? (
                        <EdgeDetailPanel
                            edge={selectedEdge}
                            onSelectNode={(id) =>
                                setSelection({ kind: "node", id })
                            }
                        />
                    ) : selectedNode ? (
                        <NodeDetailPanel
                            node={selectedNode}
                            relationships={selectedNodeRels}
                            map={map}
                            canPromote={canPromote}
                            removing={removing}
                            promoting={promoting}
                            onRemove={onRemove}
                            onToggleRoot={onToggleRoot}
                            onSelectEdge={(syncId) =>
                                setSelection({ kind: "edge", syncId })
                            }
                            onSelectNode={(id) =>
                                setSelection({ kind: "node", id })
                            }
                            showOrphans={map.orphanGhosts}
                        />
                    ) : (
                        <CardContent className="p-6 text-sm text-muted-foreground">
                            Selection no longer exists.
                        </CardContent>
                    )}
                </Card>
            </div>
        </TooltipProvider>
    );
}

function EdgeLine({
    from,
    to,
    highlighted,
    dimmed,
    dashed,
    onClick,
    label,
}: {
    from: LaidOutPosition;
    to: LaidOutPosition;
    highlighted: boolean;
    dimmed: boolean;
    dashed: boolean;
    onClick: () => void;
    label?: string;
}) {
    const midX = (from.x + to.x) / 2;
    const midY = (from.y + to.y) / 2;
    return (
        <g
            onClick={onClick}
            className="cursor-pointer"
            role="button"
            tabIndex={0}
            onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    onClick();
                }
            }}
        >
            <line
                x1={from.x}
                y1={from.y}
                x2={to.x}
                y2={to.y}
                stroke="transparent"
                strokeWidth={14}
                vectorEffect="non-scaling-stroke"
            />
            <line
                x1={from.x}
                y1={from.y}
                x2={to.x}
                y2={to.y}
                className={cn(
                    highlighted
                        ? "stroke-primary"
                        : dimmed
                          ? "stroke-primary/5"
                          : "stroke-primary/40",
                )}
                strokeWidth={highlighted ? 2.2 : 1.4}
                strokeDasharray={dashed ? "5 5" : undefined}
                vectorEffect="non-scaling-stroke"
            />
            {label ? (
                <g transform={`translate(${midX} ${midY})`}>
                    <rect
                        x={-32}
                        y={-9}
                        width={64}
                        height={18}
                        rx={4}
                        className="fill-card stroke-primary/40"
                    />
                    <text
                        x={0}
                        y={3}
                        textAnchor="middle"
                        className="fill-foreground"
                        style={{ font: "500 10px ui-monospace, monospace" }}
                    >
                        {label}
                    </text>
                </g>
            ) : null}
        </g>
    );
}

function DeviceTileButton({
    node,
    x,
    y,
    selected,
    dimmed,
    onSelect,
}: {
    node: DeviceNode;
    x: number;
    y: number;
    selected: boolean;
    dimmed: boolean;
    onSelect: () => void;
}) {
    const Icon = getDeviceIcon(node.deviceKind);
    return (
        <button
            type="button"
            onClick={onSelect}
            className={cn(
                "absolute flex h-20 w-20 -translate-x-1/2 -translate-y-1/2 flex-col items-center justify-center gap-1 rounded-2xl border bg-card text-xs shadow-sm transition focus:outline-none focus-visible:ring-2 focus-visible:ring-primary",
                selected && "scale-105 shadow-lg ring-2 ring-primary",
                node.current && !selected && "ring-1 ring-primary/60",
                node.root && "border-primary/50 bg-primary/10",
                dimmed && "opacity-15",
            )}
            style={{ left: x, top: y }}
        >
            {node.root ? (
                <Crown className="absolute -right-2 -top-2 h-4 w-4 text-primary" />
            ) : null}
            <Icon
                className={cn(
                    "h-6 w-6",
                    node.current ? "text-primary" : "text-foreground",
                )}
            />
            <span className="line-clamp-1 px-1 text-center text-[0.65rem] font-medium">
                {deviceDisplay(node)}
            </span>
        </button>
    );
}

function OrphanGhostTile({
    ghost,
    x,
    y,
    dimmed = false,
}: {
    ghost: OrphanGhost;
    x: number;
    y: number;
    dimmed?: boolean;
}) {
    const Icon = getDeviceIcon(ghost.deviceKind);
    return (
        <Tooltip>
            <TooltipTrigger asChild>
                <div
                    role="img"
                    aria-label={`Unmatched Online Services link: ${ghost.displayName}`}
                    className={cn(
                        "absolute flex h-20 w-20 -translate-x-1/2 -translate-y-1/2 cursor-help flex-col items-center justify-center gap-1 rounded-2xl border border-dashed border-primary/50 bg-card/40 text-xs text-muted-foreground shadow-sm transition-opacity",
                        dimmed && "opacity-15",
                    )}
                    style={{ left: x, top: y }}
                >
                    <HelpCircle className="absolute -right-2 -top-2 h-4 w-4 text-primary" />
                    <Icon className="h-6 w-6 opacity-70" />
                    <span className="line-clamp-1 px-1 text-center text-[0.65rem] font-medium italic">
                        {ghost.displayName}
                    </span>
                </div>
            </TooltipTrigger>
            <TooltipContent className="max-w-xs">
                {ORPHAN_TOOLTIP}
            </TooltipContent>
        </Tooltip>
    );
}

function NodeDetailPanel({
    node,
    relationships,
    map,
    canPromote,
    removing,
    promoting,
    onRemove,
    onToggleRoot,
    onSelectEdge,
    onSelectNode,
    showOrphans,
}: {
    node: DeviceNode;
    relationships: Relationship[];
    map: RelationshipMap;
    canPromote: boolean;
    removing: boolean;
    promoting: boolean;
    onRemove: (id: string) => void;
    onToggleRoot: (id: string, root: boolean) => void;
    onSelectEdge: (syncId: string) => void;
    onSelectNode: (id: string) => void;
    showOrphans: OrphanGhost[];
}) {
    return (
        <>
            <CardHeader className="border-b">
                <div className="flex items-center justify-between gap-2">
                    <div className="flex min-w-0 items-center gap-3">
                        <DeviceTile node={node} />
                        <div className="min-w-0">
                            <CardTitle className="truncate text-base">
                                {deviceDisplay(node)}
                            </CardTitle>
                            <p className="text-xs text-muted-foreground">
                                {node.deviceKind}
                                {node.current ? " · this device" : ""} ·{" "}
                                {formatRelativeAccountDate(node.lastActivity)}
                            </p>
                        </div>
                    </div>
                    {node.root ? (
                        <Badge className="gap-1">
                            <Crown className="h-3 w-3" />
                            Root
                        </Badge>
                    ) : (
                        <Badge variant="secondary">Member</Badge>
                    )}
                </div>
            </CardHeader>
            <CardContent className="space-y-4 p-4">
                <div className="space-y-2">
                    <div className="flex items-center justify-between gap-2 text-sm">
                        <span className="flex items-center gap-2">
                            <Shield
                                className={cn(
                                    "h-4 w-4",
                                    node.root
                                        ? "text-primary"
                                        : "text-muted-foreground",
                                )}
                            />
                            Root device
                        </span>
                        <Switch
                            checked={node.root}
                            disabled={
                                !canTogglePromote(node, map, canPromote) ||
                                promoting
                            }
                            onCheckedChange={(c) => onToggleRoot(node.id, c)}
                        />
                    </div>
                    <p className="text-xs text-muted-foreground">
                        Root devices manage recovery, linking and account
                        deletion.
                    </p>
                </div>

                <div className="space-y-2">
                    <div className="flex items-center gap-2 text-sm">
                        <Link2 className="h-4 w-4 text-primary" />
                        Trust links ({relationships.length})
                    </div>
                    <div className="space-y-1.5">
                        {relationships.length ? (
                            relationships.map((rel) => {
                                const other =
                                    rel.fromDeviceId === node.id
                                        ? rel.to
                                        : rel.from;
                                return (
                                    <div
                                        key={rel.syncId}
                                        className="flex items-center gap-1.5 rounded-md border px-2 py-1.5 text-xs"
                                    >
                                        <button
                                            type="button"
                                            onClick={() =>
                                                other && onSelectNode(other.id)
                                            }
                                            className="flex min-w-0 flex-1 items-center gap-2 truncate hover:text-primary"
                                        >
                                            <span
                                                className={cn(
                                                    "h-1.5 w-1.5 rounded-full",
                                                    rel.localDevice
                                                        ? "bg-primary"
                                                        : "bg-muted-foreground",
                                                )}
                                            />
                                            <span className="truncate">
                                                {other
                                                    ? deviceDisplay(other)
                                                    : "Unknown"}
                                            </span>
                                        </button>
                                        <button
                                            type="button"
                                            onClick={() =>
                                                onSelectEdge(rel.syncId)
                                            }
                                            className="font-mono text-[0.65rem] text-muted-foreground hover:text-primary"
                                        >
                                            {formatSyncId(rel.syncId)}
                                        </button>
                                    </div>
                                );
                            })
                        ) : (
                            <p className="text-xs text-muted-foreground">
                                No relationships.
                            </p>
                        )}
                    </div>
                </div>

                {node.current && showOrphans.length ? (
                    <OrphanGhostList ghosts={showOrphans} />
                ) : null}

                <Button
                    size="sm"
                    variant="destructive"
                    className="w-full gap-2"
                    disabled={!canRemoveDevice(node) || removing}
                    onClick={() => onRemove(node.id)}
                >
                    <Trash2 className="h-4 w-4" /> Remove device
                </Button>
            </CardContent>
        </>
    );
}

function EdgeDetailPanel({
    edge,
    onSelectNode,
}: {
    edge: Relationship;
    onSelectNode: (id: string) => void;
}) {
    const localName = edge.localDevice?.Name ?? null;
    return (
        <>
            <CardHeader className="border-b">
                <div className="flex items-center gap-3">
                    <span
                        className={cn(
                            "grid h-10 w-10 shrink-0 place-items-center rounded-lg",
                            edge.localDevice
                                ? "bg-primary/15 text-primary"
                                : "bg-muted text-muted-foreground",
                        )}
                    >
                        <Link2 className="h-5 w-5" />
                    </span>
                    <div className="min-w-0">
                        <CardTitle className="truncate text-base">
                            Trust link
                        </CardTitle>
                        <p className="font-mono text-xs text-muted-foreground">
                            {formatSyncId(edge.syncId)}
                        </p>
                    </div>
                    <Badge
                        variant={edge.localDevice ? "default" : "secondary"}
                        className="ml-auto"
                    >
                        {edge.localDevice ? "Matched" : "Unmatched"}
                    </Badge>
                </div>
            </CardHeader>
            <CardContent className="space-y-4 p-4 text-sm">
                <div className="grid gap-2">
                    <EdgeEndpointRow
                        label="From"
                        node={edge.from}
                        onSelect={onSelectNode}
                    />
                    <EdgeEndpointRow
                        label="To"
                        node={edge.to}
                        onSelect={onSelectNode}
                    />
                </div>

                <div className="grid grid-cols-2 gap-3 rounded-md border p-3 text-xs">
                    <div>
                        <p className="text-muted-foreground">Established</p>
                        <p className="font-medium">
                            {formatRelativeAccountDate(edge.createdAt)}
                        </p>
                    </div>
                    <div>
                        <p className="text-muted-foreground">Local mirror</p>
                        <p className="font-medium">{localName ?? "—"}</p>
                    </div>
                </div>

                {!edge.localDevice ? (
                    <p className="text-xs text-muted-foreground">
                        No local linked-device record matches this sync ID.
                        Audit candidate.
                    </p>
                ) : null}
            </CardContent>
        </>
    );
}

function EdgeEndpointRow({
    label,
    node,
    onSelect,
}: {
    label: string;
    node: DeviceNode | undefined;
    onSelect: (id: string) => void;
}) {
    return (
        <div className="flex items-center gap-2">
            <span className="w-12 shrink-0 text-xs uppercase tracking-wide text-muted-foreground">
                {label}
            </span>
            {node ? (
                <button
                    type="button"
                    onClick={() => onSelect(node.id)}
                    className="flex min-w-0 flex-1 items-center gap-2 rounded-md border px-2 py-1.5 text-xs transition hover:border-primary/40 hover:bg-primary/5"
                >
                    <DeviceTile node={node} small />
                    <span className="min-w-0 truncate">
                        {deviceDisplay(node)}
                    </span>
                    {node.root ? (
                        <Crown className="ml-auto h-3 w-3 text-primary" />
                    ) : null}
                </button>
            ) : (
                <span className="flex-1 rounded-md border px-2 py-1.5 text-xs italic text-muted-foreground">
                    Unknown device
                </span>
            )}
        </div>
    );
}

function DeviceTile({
    node,
    small = false,
}: {
    node: DeviceNode;
    small?: boolean;
}) {
    const Icon = getDeviceIcon(node.deviceKind);
    return (
        <span
            className={cn(
                "grid shrink-0 place-items-center rounded-lg",
                small ? "h-7 w-7" : "h-10 w-10",
                node.root ? "bg-primary/15 text-primary" : "bg-muted",
            )}
        >
            <Icon className={small ? "h-4 w-4" : "h-5 w-5"} />
        </span>
    );
}

function OrphanGhostList({ ghosts }: { ghosts: OrphanGhost[] }) {
    return (
        <div className="space-y-2 rounded-md border border-dashed border-primary/40 bg-primary/5 p-3">
            <div className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-primary">
                <HelpCircle className="h-3.5 w-3.5" />
                Unmatched OS links ({ghosts.length})
            </div>
            <p className="text-[0.7rem] text-muted-foreground">
                {ORPHAN_TOOLTIP}
            </p>
            <div className="flex flex-wrap gap-1.5">
                {ghosts.map((ghost) => {
                    const Icon = getDeviceIcon(ghost.deviceKind);
                    return (
                        <Tooltip key={ghost.id}>
                            <TooltipTrigger asChild>
                                <span className="inline-flex cursor-help items-center gap-1.5 rounded-full border border-dashed border-primary/50 bg-card px-2 py-0.5 text-[0.7rem] italic text-muted-foreground">
                                    <Icon className="h-3 w-3" />
                                    {ghost.displayName}
                                </span>
                            </TooltipTrigger>
                            <TooltipContent className="max-w-xs">
                                {ORPHAN_TOOLTIP}
                            </TooltipContent>
                        </Tooltip>
                    );
                })}
            </div>
        </div>
    );
}
