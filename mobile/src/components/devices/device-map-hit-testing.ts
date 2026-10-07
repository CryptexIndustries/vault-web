import type { DeviceSelection } from "./device-browser";
import type { MapTransform } from "./device-map-camera";
import type { MapPoint } from "./device-map-layout";

export type MapHitNode = MapPoint & {
    id: string;
    labelWidth?: number;
    root?: boolean;
    custom?: boolean;
};
export type MapHitEdge = { id: string; points: MapPoint[] };

export function sampleMapCurve(points: MapPoint[]) {
    const samples: MapPoint[] = [];
    for (let step = 0; step <= 48; step++) {
        const t = step / 48;
        const u = 1 - t;
        const weights =
            points.length === 3
                ? [u * u, 2 * u * t, t * t]
                : [u * u * u, 3 * u * u * t, 3 * u * t * t, t * t * t];
        samples.push({
            x: points.reduce(
                (sum, point, index) => sum + point.x * weights[index]!,
                0,
            ),
            y: points.reduce(
                (sum, point, index) => sum + point.y * weights[index]!,
                0,
            ),
        });
    }
    return samples;
}

function segmentDistance(point: MapPoint, from: MapPoint, to: MapPoint) {
    "worklet";
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const length = dx * dx + dy * dy;
    const t = length
        ? Math.max(
              0,
              Math.min(
                  1,
                  ((point.x - from.x) * dx + (point.y - from.y) * dy) / length,
              ),
          )
        : 0;
    return Math.hypot(point.x - from.x - t * dx, point.y - from.y - t * dy);
}

export function hitTestDeviceMap(
    screen: MapPoint,
    camera: MapTransform,
    nodes: MapHitNode[],
    edges: MapHitEdge[],
    selection: DeviceSelection | null,
): DeviceSelection | null {
    "worklet";
    let nodeId: string | null = null;
    let nodeDistance = Infinity;
    const half = Math.max(22, 30 * camera.scale);
    for (const node of nodes) {
        const dx = screen.x - node.x * camera.scale - camera.x;
        const dy = screen.y - node.y * camera.scale - camera.y;
        const glyphHit = Math.abs(dx) <= half && Math.abs(dy) <= half;
        const labelHit =
            camera.scale >= 0.4 &&
            node.labelWidth !== undefined &&
            Math.abs(dx) <= (node.labelWidth * camera.scale) / 2 &&
            dy >= 39 * camera.scale &&
            dy <= 72 * camera.scale;
        const badgeHit =
            node.root &&
            camera.scale >= 0.4 &&
            Math.abs(dx) <= 22 * camera.scale &&
            dy >= -44 * camera.scale &&
            dy <= -27 * camera.scale;
        const customHit =
            node.custom &&
            dx >= -32 * camera.scale &&
            dx <= -18 * camera.scale &&
            dy >= -36 * camera.scale &&
            dy <= -22 * camera.scale;
        if (!glyphHit && !labelHit && !badgeHit && !customHit) continue;
        const distance = Math.hypot(dx, dy);
        if (distance < nodeDistance) {
            nodeDistance = distance;
            nodeId = node.id;
        }
    }
    if (nodeId) return { kind: "node", id: nodeId };
    const world = {
        x: (screen.x - camera.x) / camera.scale,
        y: (screen.y - camera.y) / camera.scale,
    };
    let edgeId: string | null = null;
    let edgeDistance = 22;
    for (const edge of edges) {
        let distance = Infinity;
        for (let index = 1; index < edge.points.length; index++) {
            distance = Math.min(
                distance,
                segmentDistance(
                    world,
                    edge.points[index - 1]!,
                    edge.points[index]!,
                ) * camera.scale,
            );
        }
        const selected = selection?.kind === "edge" && selection.id === edge.id;
        const selectedBest =
            selection?.kind === "edge" && selection.id === edgeId;
        const tie = Math.abs(distance - edgeDistance) <= 0.1;
        if (
            distance <= 22 &&
            (!edgeId ||
                (tie && selected && !selectedBest) ||
                (distance < edgeDistance && !(tie && selectedBest)))
        ) {
            edgeDistance = distance;
            edgeId = edge.id;
        }
    }
    return edgeId ? { kind: "edge", id: edgeId } : null;
}
