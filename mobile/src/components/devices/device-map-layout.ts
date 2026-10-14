import type {
    DeviceRelationship,
    DeviceRelationshipMap,
} from "@/components/account/device-topology";

export type MapPoint = { x: number; y: number };

/** Keep positions stable when search and filters hide a part of the account. */
export function buildDeviceMapLayout(map: DeviceRelationshipMap) {
    const neighbors = new Map(
        map.nodes.map((node) => [node.id, new Set<string>()]),
    );
    for (const edge of map.relationships) {
        neighbors.get(edge.fromDeviceId)?.add(edge.toDeviceId);
        neighbors.get(edge.toDeviceId)?.add(edge.fromDeviceId);
    }
    const isolatedIds = new Set(
        map.nodes
            .filter((node) => !neighbors.get(node.id)?.size)
            .map((node) => node.id),
    );
    const positions = new Map<string, MapPoint>();
    const remaining = new Set(
        map.nodes
            .filter((node) => !isolatedIds.has(node.id))
            .map((node) => node.id),
    );
    const components: string[][] = [];
    while (remaining.size) {
        const first = remaining.has(map.currentDeviceId)
            ? map.currentDeviceId
            : remaining.values().next().value!;
        const queue = [first];
        const component: string[] = [];
        remaining.delete(first);
        for (let index = 0; index < queue.length; index++) {
            const id = queue[index];
            component.push(id);
            for (const neighbor of neighbors.get(id) ?? []) {
                if (remaining.delete(neighbor)) queue.push(neighbor);
            }
        }
        components.push(component);
    }
    let componentX = 180;
    let maxY = 180;
    for (const component of components) {
        const center = component.includes(map.currentDeviceId)
            ? map.currentDeviceId
            : [...component].sort(
                  (a, b) =>
                      (neighbors.get(b)?.size ?? 0) -
                      (neighbors.get(a)?.size ?? 0),
              )[0];
        const peers = component.filter((id) => id !== center);
        const radius = Math.max(130, Math.min(peers.length, 16) * 25);
        const centerY = peers.length <= 3 ? 180 : radius + 85;
        positions.set(center, { x: componentX, y: centerY });
        maxY = Math.max(maxY, centerY);
        for (let index = 0; index < peers.length; index++) {
            if (peers.length <= 3) {
                const offsets =
                    peers.length === 1
                        ? [{ x: 0, y: -130 }]
                        : peers.length === 2
                          ? [
                                { x: -95, y: -115 },
                                { x: 100, y: -100 },
                            ]
                          : [
                                { x: -95, y: -115 },
                                { x: 100, y: -100 },
                                { x: 25, y: 135 },
                            ];
                positions.set(peers[index], {
                    x: componentX + offsets[index].x,
                    y: centerY + offsets[index].y,
                });
                maxY = Math.max(maxY, centerY + offsets[index].y);
                continue;
            }
            const ring = Math.floor(index / 16);
            const ringCount = Math.min(16, peers.length - ring * 16);
            const angle =
                ((index % 16) * Math.PI * 2) / ringCount - Math.PI / 2;
            const distance = radius + ring * 145;
            positions.set(peers[index], {
                x: componentX + Math.cos(angle) * distance,
                y: centerY + Math.sin(angle) * distance,
            });
            maxY = Math.max(maxY, centerY + distance);
        }
        componentX += (radius + Math.floor(peers.length / 16) * 145) * 2 + 230;
    }
    const isolated = map.nodes.filter((node) => isolatedIds.has(node.id));
    const columns = Math.min(
        10,
        Math.max(1, Math.ceil(Math.sqrt(isolated.length))),
    );
    const bottom = components.length ? maxY + 200 : 180;
    isolated.forEach((node, index) =>
        positions.set(node.id, {
            x: 120 + (index % columns) * 150,
            y: bottom + Math.floor(index / columns) * 145,
        }),
    );
    return { positions, isolatedIds };
}

export function relationshipCurve(
    edge: DeviceRelationship,
    relationships: DeviceRelationship[],
    positions: Map<string, MapPoint>,
) {
    const from = positions.get(edge.fromDeviceId);
    const to = positions.get(edge.toDeviceId);
    if (!from || !to) return null;
    const siblings = relationships.filter(
        (candidate) =>
            (candidate.fromDeviceId === edge.fromDeviceId &&
                candidate.toDeviceId === edge.toDeviceId) ||
            (candidate.fromDeviceId === edge.toDeviceId &&
                candidate.toDeviceId === edge.fromDeviceId),
    );
    const index = siblings.findIndex((candidate) => candidate.id === edge.id);
    const offset = (index - (siblings.length - 1) / 2) * 60;
    if (edge.fromDeviceId === edge.toDeviceId) {
        const radius = 70 + index * 35;
        return {
            points: [
                from,
                { x: from.x - radius, y: from.y - radius - 15 },
                { x: from.x + radius, y: from.y - radius - 15 },
                from,
            ],
            path: `M ${from.x} ${from.y} C ${from.x - radius} ${from.y - radius - 15}, ${from.x + radius} ${from.y - radius - 15}, ${from.x} ${from.y}`,
        };
    }
    const direction =
        edge.fromDeviceId.localeCompare(edge.toDeviceId) <= 0 ? 1 : -1;
    const dx = (to.x - from.x) * direction;
    const dy = (to.y - from.y) * direction;
    const length = Math.hypot(dx, dy) || 1;
    const control = {
        x: (from.x + to.x) / 2 - (dy / length) * offset,
        y: (from.y + to.y) / 2 + (dx / length) * offset,
    };
    return {
        points: [from, control, to],
        path: `M ${from.x} ${from.y} Q ${control.x} ${control.y} ${to.x} ${to.y}`,
    };
}

export function relationshipPath(
    edge: DeviceRelationship,
    relationships: DeviceRelationship[],
    positions: Map<string, MapPoint>,
) {
    return relationshipCurve(edge, relationships, positions)?.path ?? null;
}
