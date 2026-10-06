"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { Expand, Minimize, MoreHorizontal, Minus, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
    DropdownMenu,
    DropdownMenuTrigger,
    DropdownMenuContent,
    DropdownMenuCheckboxItem,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { layoutDevices, type Position } from "./device-layout";
import type { DeviceRelationshipMap } from "./account-dialog/device-topology";
import type { DeviceSelection } from "./device-tab";

type Camera = { x: number; y: number; width: number; height: number };
export function DeviceMap({
    map,
    focusRequest,
    selection,
    onSelect,
    connectedLinkIds,
    unknownLinkIds,
    expanded,
    onExpand,
}: {
    focusRequest?: { nodeId: string; token: number };
    map: DeviceRelationshipMap;
    selection: DeviceSelection;
    onSelect: (selection: DeviceSelection) => void;
    connectedLinkIds: Set<string>;
    unknownLinkIds: Set<string>;
    expanded: boolean;
    onExpand: () => void;
}) {
    // Graph structure alone controls layout. Dates, names, connection events and selection do not move nodes.
    const structureKey = JSON.stringify({
        nodes: map.nodes.map((n) => n.id).sort(),
        edges: map.relationships
            .map((r) => [r.id, r.fromDeviceId, r.toDeviceId])
            .sort((a, b) => a[0]!.localeCompare(b[0]!)),
    });
    const layout = useMemo(() => layoutDevices(map), [structureKey]); // eslint-disable-line react-hooks/exhaustive-deps
    const svgRef = useRef<SVGSVGElement>(null);
    const [camera, setCamera] = useState<Camera>({
        x: 0,
        y: 0,
        width: layout.width,
        height: layout.height,
    });
    const [focus, setFocus] = useState(false);
    const [motion, setMotion] = useState(true);
    const drag = useRef<{
        origin: Position;
        moved: boolean;
        clientX: number;
        clientY: number;
    } | null>(null);
    const suppressClick = useRef(false);
    useEffect(() => {
        setCamera({ x: 0, y: 0, width: layout.width, height: layout.height });
    }, [layout]);
    const selectedEdge =
        selection.kind === "edge"
            ? map.relationships.find((r) => r.id === selection.id)
            : undefined;
    const neighborIds = new Set(
        selection.kind === "node"
            ? [selection.id]
            : selectedEdge
              ? [selectedEdge.fromDeviceId, selectedEdge.toDeviceId]
              : [],
    );
    if (selection.kind === "node")
        for (const edge of map.relationships) {
            if (
                edge.fromDeviceId === selection.id ||
                edge.toDeviceId === selection.id
            ) {
                neighborIds.add(edge.fromDeviceId);
                neighborIds.add(edge.toDeviceId);
            }
        }
    const fit = (ids?: Set<string>) => {
        const points = [...layout.positions]
            .filter(([id]) => !ids || ids.has(id))
            .map(([, p]) => p);
        if (!points.length) return;
        const x = Math.min(...points.map((p) => p.x)) - 65,
            y = Math.min(...points.map((p) => p.y)) - 65;
        setCamera({
            x,
            y,
            width: Math.max(200, Math.max(...points.map((p) => p.x)) - x + 65),
            height: Math.max(200, Math.max(...points.map((p) => p.y)) - y + 65),
        });
    };
    useEffect(() => {
        if (!focusRequest) return;
        const ids = new Set([focusRequest.nodeId]);
        for (const edge of map.relationships) {
            if (
                edge.fromDeviceId === focusRequest.nodeId ||
                edge.toDeviceId === focusRequest.nodeId
            ) {
                ids.add(edge.fromDeviceId);
                ids.add(edge.toDeviceId);
            }
        }
        fit(ids);
        setFocus(true);
    }, [focusRequest, layout]); // eslint-disable-line react-hooks/exhaustive-deps
    const zoom = (factor: number, point?: Position) =>
        setCamera((c) => {
            const scale =
                Math.max(100, Math.min(layout.width * 4, c.width * factor)) /
                c.width;
            const center = point ?? {
                x: c.x + c.width / 2,
                y: c.y + c.height / 2,
            };
            return {
                x: center.x + (c.x - center.x) * scale,
                y: center.y + (c.y - center.y) * scale,
                width: c.width * scale,
                height: c.height * scale,
            };
        });
    const worldPoint = (clientX: number, clientY: number) => {
        const svg = svgRef.current,
            matrix = svg?.getScreenCTM();
        if (!svg || !matrix) return { x: 0, y: 0 };
        const point = svg.createSVGPoint();
        point.x = clientX;
        point.y = clientY;
        return point.matrixTransform(matrix.inverse());
    };
    useEffect(() => {
        const svg = svgRef.current;
        if (!svg) return;
        const wheel = (e: WheelEvent) => {
            e.preventDefault();
            zoom(Math.exp(e.deltaY * 0.0015), worldPoint(e.clientX, e.clientY));
        };
        svg.addEventListener("wheel", wheel, { passive: false });
        return () => svg.removeEventListener("wheel", wheel);
    }, [layout.width]); // eslint-disable-line react-hooks/exhaustive-deps
    const activate = (selection: DeviceSelection) => {
        if (!suppressClick.current) onSelect(selection);
    };
    return (
        <div className="flex h-full min-h-0 flex-col">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b p-3">
                <span className="text-xs text-muted-foreground">
                    {map.nodes.length} devices / {map.relationships.length}{" "}
                    recorded links
                </span>
                <Button variant="ghost" size="sm" onClick={onExpand}>
                    {expanded ? (
                        <Minimize className="mr-2 h-4 w-4" />
                    ) : (
                        <Expand className="mr-2 h-4 w-4" />
                    )}
                    {expanded ? "Collapse" : "Expand map"}
                </Button>
            </div>
            <div className="flex flex-wrap items-center gap-1 p-2">
                <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                        setFocus(false);
                        fit();
                    }}
                >
                    Fit all
                </Button>
                <Button
                    variant="outline"
                    size="sm"
                    onClick={() => fit(neighborIds)}
                >
                    Fit connections
                </Button>
                <Button
                    variant={focus ? "secondary" : "ghost"}
                    size="sm"
                    aria-pressed={focus}
                    onClick={() => setFocus(!focus)}
                >
                    Focus selection
                </Button>
                <Button
                    variant="ghost"
                    size="icon"
                    aria-label="Zoom in"
                    onClick={() => zoom(0.8)}
                >
                    <Plus className="h-4 w-4" />
                </Button>
                <Button
                    variant="ghost"
                    size="icon"
                    aria-label="Zoom out"
                    onClick={() => zoom(1.25)}
                >
                    <Minus className="h-4 w-4" />
                </Button>
                <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                        <Button
                            variant="ghost"
                            size="icon"
                            aria-label="Map options"
                        >
                            <MoreHorizontal className="h-4 w-4" />
                        </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent>
                        <DropdownMenuCheckboxItem
                            checked={motion}
                            onCheckedChange={setMotion}
                        >
                            Animate active connections
                        </DropdownMenuCheckboxItem>
                    </DropdownMenuContent>
                </DropdownMenu>
            </div>
            <svg
                ref={svgRef}
                className="device-network min-h-0 w-full flex-1 touch-none bg-muted/10 outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary"
                viewBox={`${camera.x} ${camera.y} ${camera.width} ${camera.height}`}
                tabIndex={0}
                aria-label="Known device relationships. Drag to pan, scroll to zoom. Arrow keys pan; plus and minus zoom."
                onPointerDown={(e) => {
                    if (e.button !== 0) return;
                    suppressClick.current = false;
                    drag.current = {
                        origin: worldPoint(e.clientX, e.clientY),
                        moved: false,
                        clientX: e.clientX,
                        clientY: e.clientY,
                    };
                }}
                onPointerMove={(e) => {
                    const d = drag.current;
                    if (!d) return;
                    if (
                        !d.moved &&
                        Math.hypot(
                            e.clientX - d.clientX,
                            e.clientY - d.clientY,
                        ) < 4
                    )
                        return;
                    d.moved = true;
                    suppressClick.current = true;
                    e.currentTarget.setPointerCapture(e.pointerId);
                    const point = worldPoint(e.clientX, e.clientY);
                    setCamera((c) => ({
                        ...c,
                        x: c.x + d.origin.x - point.x,
                        y: c.y + d.origin.y - point.y,
                    }));
                }}
                onPointerUp={() => {
                    drag.current = null;
                }}
                onPointerCancel={() => {
                    drag.current = null;
                    suppressClick.current = false;
                }}
                onKeyDown={(e) => {
                    if (e.target !== e.currentTarget) return;
                    if (e.key === "+" || e.key === "=") {
                        e.preventDefault();
                        zoom(0.8);
                    } else if (e.key === "-") {
                        e.preventDefault();
                        zoom(1.25);
                    } else if (
                        [
                            "ArrowUp",
                            "ArrowDown",
                            "ArrowLeft",
                            "ArrowRight",
                        ].includes(e.key)
                    ) {
                        e.preventDefault();
                        setCamera((c) => ({
                            ...c,
                            x:
                                c.x +
                                (e.key === "ArrowRight"
                                    ? c.width / 10
                                    : e.key === "ArrowLeft"
                                      ? -c.width / 10
                                      : 0),
                            y:
                                c.y +
                                (e.key === "ArrowDown"
                                    ? c.height / 10
                                    : e.key === "ArrowUp"
                                      ? -c.height / 10
                                      : 0),
                        }));
                    }
                }}
            >
                {layout.isolated.length > 0 && (
                    <g>
                        <rect
                            x={10}
                            y={layout.isolatedY}
                            width={layout.width - 20}
                            height={layout.height - layout.isolatedY - 5}
                            rx={12}
                            className="fill-black/[0.035] stroke-muted-foreground/40 dark:fill-black/10"
                            strokeDasharray="4 6"
                        />
                        <text
                            x={25}
                            y={layout.isolatedY + 25}
                            className="fill-muted-foreground text-[12px]"
                        >
                            No recorded links ({layout.isolated.length})
                        </text>
                    </g>
                )}
                {map.relationships.map((edge) => {
                    const a = layout.positions.get(edge.fromDeviceId),
                        b = layout.positions.get(edge.toDeviceId);
                    if (!a || !b) return null;
                    const active = connectedLinkIds.has(edge.id);
                    const unknown = unknownLinkIds.has(edge.id);
                    const selected =
                        selection.kind === "edge"
                            ? selection.id === edge.id
                            : edge.fromDeviceId === selection.id ||
                              edge.toDeviceId === selection.id;
                    const name = `${map.nodes.find((n) => n.id === edge.fromDeviceId)?.displayName} to ${map.nodes.find((n) => n.id === edge.toDeviceId)?.displayName}`;
                    return (
                        <g
                            key={edge.id}
                            role="button"
                            tabIndex={0}
                            aria-label={`${name}. ${edge.custom ? "Custom signaling" : "Online Services"}. ${active ? "Connected" : unknown ? "Live status unknown" : "Not connected"}`}
                            className={cn(
                                "device-network-edge cursor-pointer outline-none",
                                focus && !selected && "opacity-20",
                            )}
                            onClick={() =>
                                activate({ kind: "edge", id: edge.id })
                            }
                            onKeyDown={(e) => {
                                if (e.key === "Enter" || e.key === " ") {
                                    e.preventDefault();
                                    e.stopPropagation();
                                    onSelect({ kind: "edge", id: edge.id });
                                }
                            }}
                        >
                            <title>{name}</title>
                            <line
                                x1={a.x}
                                y1={a.y}
                                x2={b.x}
                                y2={b.y}
                                stroke="transparent"
                                strokeWidth={16}
                                vectorEffect="non-scaling-stroke"
                            />
                            <line
                                className={cn(
                                    "device-network-line",
                                    active
                                        ? "stroke-emerald-500"
                                        : "stroke-muted-foreground",
                                )}
                                x1={a.x}
                                y1={a.y}
                                x2={b.x}
                                y2={b.y}
                                strokeWidth={selected ? 2 : 1}
                                opacity={selected ? 1 : 0.55}
                                strokeDasharray={unknown ? "4 5" : undefined}
                                vectorEffect="non-scaling-stroke"
                            />
                            {active && (
                                <line
                                    className="device-network-flow stroke-emerald-300"
                                    style={{
                                        animationPlayState: motion
                                            ? "running"
                                            : "paused",
                                    }}
                                    x1={a.x}
                                    y1={a.y}
                                    x2={b.x}
                                    y2={b.y}
                                    strokeWidth={2.5}
                                    strokeDasharray="5 19"
                                    vectorEffect="non-scaling-stroke"
                                />
                            )}
                        </g>
                    );
                })}
                {map.nodes.map((node) => {
                    const p = layout.positions.get(node.id)!;
                    const selected =
                        selection.kind === "node" && selection.id === node.id;
                    const custom = node.localDevices.some((d) =>
                        map.relationships.some(
                            (r) => r.localDevice?.ID === d.ID && r.custom,
                        ),
                    );
                    const label =
                        selected ||
                        node.current ||
                        node.localDevices.length > 0 ||
                        camera.width < 650;
                    return (
                        <g
                            key={node.id}
                            transform={`translate(${p.x} ${p.y})`}
                            role="button"
                            tabIndex={0}
                            aria-label={`${node.displayName}${custom ? ", custom signaling" : ""}`}
                            className={cn(
                                "device-network-node cursor-pointer outline-none",
                                focus &&
                                    !neighborIds.has(node.id) &&
                                    "opacity-20",
                            )}
                            onClick={() =>
                                activate({ kind: "node", id: node.id })
                            }
                            onKeyDown={(e) => {
                                if (e.key === "Enter" || e.key === " ") {
                                    e.preventDefault();
                                    e.stopPropagation();
                                    onSelect({ kind: "node", id: node.id });
                                }
                            }}
                        >
                            <title>
                                {node.displayName}
                                {node.serverId ? ` (${node.serverId})` : ""}
                            </title>
                            <circle r={23} fill="transparent" />
                            {selected && (
                                <circle
                                    r={20}
                                    className="device-network-selection fill-blue-500/10 stroke-blue-500/60 dark:fill-blue-400/10 dark:stroke-blue-400/70"
                                    strokeWidth={1.5}
                                    pointerEvents="none"
                                />
                            )}
                            {custom ? (
                                <rect
                                    className="device-network-dot fill-card stroke-violet-500 dark:stroke-violet-400"
                                    x={-10}
                                    y={-10}
                                    width={20}
                                    height={20}
                                    rx={2}
                                    transform="rotate(45)"
                                    strokeWidth={selected ? 3 : 2}
                                />
                            ) : (
                                <circle
                                    className={cn(
                                        "device-network-dot fill-card",
                                        selected
                                            ? "stroke-blue-600 dark:stroke-blue-400"
                                            : "stroke-muted-foreground",
                                    )}
                                    r={node.current ? 13 : 10}
                                    strokeWidth={selected ? 3 : 2}
                                />
                            )}
                            <text
                                y={30}
                                textAnchor="middle"
                                className={cn(
                                    "device-network-label fill-foreground font-mono text-[11px]",
                                    !label && "opacity-0",
                                )}
                            >
                                {node.displayName.length > 22
                                    ? `${node.displayName.slice(0, 20)}…`
                                    : node.displayName}
                            </text>
                        </g>
                    );
                })}
            </svg>
            <div className="space-y-2 border-t p-3 text-[11px] text-muted-foreground">
                <div className="flex flex-wrap gap-3">
                    <span className="text-emerald-600 dark:text-emerald-400">
                        ━ Connected
                    </span>
                    <span>━ Disconnected</span>
                    <span>┄ Status unknown</span>
                    <span className="text-violet-600 dark:text-violet-400">
                        ◇ Custom signaling device
                    </span>
                </div>
                <p>
                    All recorded relationships remain on the canvas. Motion
                    indicates an active direct connection, not a transfer.
                </p>
            </div>
        </div>
    );
}
