import type { DeviceRelationshipMap } from "./account-dialog/device-topology";
export type Position = { x: number; y: number };
export type GraphLayout = {
    positions: Map<string, Position>;
    isolated: string[];
    width: number;
    height: number;
    isolatedY: number;
};

/** Deterministic, settled layout. Status updates and selection never affect positions. */
export function layoutDevices(
    map: Pick<DeviceRelationshipMap, "nodes" | "relationships">,
): GraphLayout {
    const linkedIds = new Set(
        map.relationships.flatMap((r) => [r.fromDeviceId, r.toDeviceId]),
    );
    const ids = map.nodes
        .filter((n) => linkedIds.has(n.id))
        .map((n) => n.id)
        .sort();
    const isolated = map.nodes
        .filter((n) => !linkedIds.has(n.id))
        .map((n) => n.id)
        .sort();
    const positions = new Map<string, Position>();
    const radius = Math.max(120, Math.sqrt(ids.length) * 65);
    ids.forEach((id, i) =>
        positions.set(id, {
            x: radius * Math.cos((2 * Math.PI * i) / ids.length),
            y: radius * Math.sin((2 * Math.PI * i) / ids.length),
        }),
    );
    // Pairwise repulsion is bounded to settle typical accounts with hundreds of devices.
    // Larger accounts use fewer iterations to avoid blocking interaction for seconds.
    const iterations = ids.length > 500 ? 12 : 120;
    for (let step = 0; step < iterations; step++) {
        const forces = new Map(ids.map((id) => [id, { x: 0, y: 0 }]));
        for (let i = 0; i < ids.length; i++)
            for (let j = i + 1; j < ids.length; j++) {
                const a = positions.get(ids[i]!)!,
                    b = positions.get(ids[j]!)!;
                const dx = a.x - b.x,
                    dy = a.y - b.y,
                    dist = Math.max(1, Math.hypot(dx, dy));
                const magnitude = 12000 / (dist * dist);
                const fa = forces.get(ids[i]!)!,
                    fb = forces.get(ids[j]!)!;
                fa.x += (dx / dist) * magnitude;
                fa.y += (dy / dist) * magnitude;
                fb.x -= (dx / dist) * magnitude;
                fb.y -= (dy / dist) * magnitude;
            }
        for (const edge of map.relationships) {
            const a = positions.get(edge.fromDeviceId),
                b = positions.get(edge.toDeviceId);
            if (!a || !b) continue;
            const dx = b.x - a.x,
                dy = b.y - a.y,
                dist = Math.max(1, Math.hypot(dx, dy));
            const magnitude = (dist - 150) * 0.015;
            const fa = forces.get(edge.fromDeviceId)!,
                fb = forces.get(edge.toDeviceId)!;
            fa.x += (dx / dist) * magnitude;
            fa.y += (dy / dist) * magnitude;
            fb.x -= (dx / dist) * magnitude;
            fb.y -= (dy / dist) * magnitude;
        }
        const temperature = 10 * (1 - step / iterations) + 0.5;
        for (const id of ids) {
            const p = positions.get(id)!,
                f = forces.get(id)!;
            p.x += Math.max(-temperature, Math.min(temperature, f.x));
            p.y += Math.max(-temperature, Math.min(temperature, f.y));
        }
    }
    const values = [...positions.values()];
    const minX = Math.min(0, ...values.map((p) => p.x)),
        minY = Math.min(0, ...values.map((p) => p.y));
    for (const p of positions.values()) {
        p.x += 90 - minX;
        p.y += 70 - minY;
    }
    const width = Math.max(
        550,
        ...[...positions.values()].map((p) => p.x + 90),
    );
    const isolatedY = Math.max(
        90,
        ...[...positions.values()].map((p) => p.y + 100),
    );
    const columns = Math.max(1, Math.floor(width / 120));
    isolated.forEach((id, i) =>
        positions.set(id, {
            x: 65 + (i % columns) * 120,
            y: isolatedY + 65 + Math.floor(i / columns) * 85,
        }),
    );
    return {
        positions,
        isolated,
        width,
        isolatedY,
        height: Math.max(
            300,
            isolatedY +
                (isolated.length
                    ? Math.ceil(isolated.length / columns) * 85 + 45
                    : 0),
        ),
    };
}
