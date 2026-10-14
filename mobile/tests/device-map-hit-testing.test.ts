import { expect, it } from "@jest/globals";
import type { DeviceRelationship } from "@/components/account/device-topology";
import {
    hitTestDeviceMap,
    sampleMapCurve,
    type MapHitEdge,
    type MapHitNode,
} from "@/components/devices/device-map-hit-testing";
import {
    relationshipCurve,
    type MapPoint,
} from "@/components/devices/device-map-layout";
import type { MapTransform } from "@/components/devices/device-map-camera";

const identity: MapTransform = { scale: 1, x: 0, y: 0 };

function relationship(
    id: string,
    fromDeviceId: string,
    toDeviceId: string,
): DeviceRelationship {
    return {
        id,
        syncId: id,
        fromDeviceId,
        toDeviceId,
        recordedOnServer: true,
        custom: false,
        missingOnServer: false,
    };
}

function screenPoint(point: MapPoint, camera: MapTransform): MapPoint {
    return {
        x: point.x * camera.scale + camera.x,
        y: point.y * camera.scale + camera.y,
    };
}

function horizontalEdge(id: string, y: number): MapHitEdge {
    return {
        id,
        points: [
            { x: -100, y },
            { x: 100, y },
        ],
    };
}

it("samples the quadratic curve used for drawing, including its endpoints", () => {
    const points = [
        { x: 0, y: 0 },
        { x: 50, y: 100 },
        { x: 100, y: 0 },
    ];
    const samples = sampleMapCurve(points);
    expect(samples).toHaveLength(49);
    expect(samples[0]).toEqual(points[0]);
    expect(samples[24]).toEqual({ x: 50, y: 50 });
    expect(samples[48]).toEqual(points[2]);
});

it("keeps reversed parallel relationships on opposite sides of their endpoints", () => {
    const forward = relationship("forward", "a", "b");
    const reversed = relationship("reversed", "b", "a");
    const positions = new Map([
        ["a", { x: 0, y: 0 }],
        ["b", { x: 100, y: 0 }],
    ]);
    const first = relationshipCurve(forward, [forward, reversed], positions)!;
    const second = relationshipCurve(reversed, [forward, reversed], positions)!;
    expect(first.points[1]).toEqual({ x: 50, y: -30 });
    expect(second.points[1]).toEqual({ x: 50, y: 30 });

    const edges = [
        { id: forward.id, points: sampleMapCurve(first.points) },
        { id: reversed.id, points: sampleMapCurve(second.points) },
    ];
    expect(
        hitTestDeviceMap({ x: 50, y: -15 }, identity, [], edges, null),
    ).toEqual({ kind: "edge", id: forward.id });
    expect(
        hitTestDeviceMap({ x: 50, y: 15 }, identity, [], edges, null),
    ).toEqual({ kind: "edge", id: reversed.id });
});

it("finds a self-loop's cubic arc away from the node", () => {
    const loop = relationship("loop", "a", "a");
    const node = { id: "a", x: 200, y: 200 };
    const curve = relationshipCurve(loop, [loop], new Map([[node.id, node]]))!;
    expect(curve.path).toContain(" C ");
    const points = sampleMapCurve(curve.points);
    expect(points[0]).toEqual({ x: node.x, y: node.y });
    expect(points[48]).toEqual({ x: node.x, y: node.y });
    expect(points[24]).toEqual({ x: 200, y: 136.25 });

    const camera = { scale: 2, x: -150, y: 50 };
    expect(
        hitTestDeviceMap(
            screenPoint(points[24]!, camera),
            camera,
            [node],
            [{ id: loop.id, points }],
            null,
        ),
    ).toEqual({ kind: "edge", id: loop.id });
});

it.each([0.09, 0.4, 1, 2.5])(
    "selects the correct node after pan and zoom at scale %s",
    (scale) => {
        const camera = { scale, x: 83, y: -47 };
        const node = { id: "peer", x: 100, y: 200 };
        expect(
            hitTestDeviceMap(
                screenPoint(node, camera),
                camera,
                [node],
                [],
                null,
            ),
        ).toEqual({ kind: "node", id: node.id });
    },
);

it("chooses the nearest node before a connection passing through its hit area", () => {
    const nodes = [
        { id: "farther", x: 0, y: 0 },
        { id: "nearer", x: 18, y: 0 },
    ];
    expect(
        hitTestDeviceMap(
            { x: 14, y: 0 },
            identity,
            nodes,
            [horizontalEdge("edge", 0)],
            null,
        ),
    ).toEqual({ kind: "node", id: "nearer" });
});

it("keeps a 44dp node hit area when its drawn square becomes smaller", () => {
    const camera = { scale: 0.1, x: 20, y: 30 };
    const node = { id: "peer", x: 0, y: 0 };
    expect(
        hitTestDeviceMap({ x: 41.9, y: 51.9 }, camera, [node], [], null),
    ).toEqual({ kind: "node", id: node.id });
    expect(
        hitTestDeviceMap({ x: 42.1, y: 30 }, camera, [node], [], null),
    ).toBeNull();
});

it.each([0.1, 0.8, 2.5])(
    "keeps a 44dp connection hit area at scale %s",
    (scale) => {
        const camera = { scale, x: 40, y: 20 };
        const edge = horizontalEdge("edge", 0);
        expect(
            hitTestDeviceMap({ x: 40, y: 41.99 }, camera, [], [edge], null),
        ).toEqual({ kind: "edge", id: edge.id });
        expect(
            hitTestDeviceMap({ x: 40, y: 42.1 }, camera, [], [edge], null),
        ).toBeNull();
    },
);

it.each([false, true])(
    "keeps the selected edge for a near tie, reversed order %s",
    (reverse) => {
        const selected = horizontalEdge("selected", 0.1);
        const nearest = horizontalEdge("nearest", 0.04);
        const edges = reverse ? [nearest, selected] : [selected, nearest];
        expect(
            hitTestDeviceMap({ x: 0, y: 0 }, identity, [], edges, {
                kind: "edge",
                id: selected.id,
            }),
        ).toEqual({ kind: "edge", id: selected.id });
    },
);

it("selects the nearer connection when it is beyond the selection tie tolerance", () => {
    const selected = horizontalEdge("selected", 2);
    const nearest = horizontalEdge("nearest", 0);
    expect(
        hitTestDeviceMap({ x: 0, y: 0 }, identity, [], [selected, nearest], {
            kind: "edge",
            id: selected.id,
        }),
    ).toEqual({ kind: "edge", id: nearest.id });
});

it.each([false, true])(
    "does not extend the selected connection hit area past 44dp, reversed order %s",
    (reverse) => {
        const selected = horizontalEdge("selected", 22.05);
        const nearest = horizontalEdge("nearest", 21.98);
        const edges = reverse ? [nearest, selected] : [selected, nearest];
        expect(
            hitTestDeviceMap({ x: 0, y: 0 }, identity, [], edges, {
                kind: "edge",
                id: selected.id,
            }),
        ).toEqual({ kind: "edge", id: nearest.id });
    },
);

it("selects visible label text below a node using its measured width", () => {
    const node: MapHitNode = { id: "peer", x: 100, y: 100, labelWidth: 160 };
    const camera = { scale: 0.5, x: 12, y: -5 };
    expect(
        hitTestDeviceMap(
            screenPoint({ x: node.x + 65, y: node.y + 60 }, camera),
            camera,
            [node],
            [],
            null,
        ),
    ).toEqual({ kind: "node", id: node.id });
    expect(
        hitTestDeviceMap(
            screenPoint({ x: node.x + 90, y: node.y + 60 }, camera),
            camera,
            [node],
            [],
            null,
        ),
    ).toBeNull();
});

it("does not select hidden label text in account overview", () => {
    const node: MapHitNode = { id: "peer", x: 100, y: 100, labelWidth: 160 };
    const camera = { scale: 0.39, x: 12, y: -5 };
    expect(
        hitTestDeviceMap(
            screenPoint({ x: node.x + 65, y: node.y + 60 }, camera),
            camera,
            [node],
            [],
            null,
        ),
    ).toBeNull();
});

it("selects the visible root badge above the node square", () => {
    const node: MapHitNode = { id: "root", x: 100, y: 100, root: true };
    const camera = { scale: 2, x: -30, y: 50 };
    expect(
        hitTestDeviceMap(
            screenPoint({ x: node.x, y: node.y - 40 }, camera),
            camera,
            [node],
            [],
            null,
        ),
    ).toEqual({ kind: "node", id: node.id });
    expect(
        hitTestDeviceMap(
            screenPoint({ x: node.x, y: node.y - 40 }, camera),
            camera,
            [{ ...node, root: false }],
            [],
            null,
        ),
    ).toBeNull();
});

it("selects the custom signaling diamond beyond the node square", () => {
    const node: MapHitNode = { id: "custom", x: 100, y: 100, custom: true };
    const camera = { scale: 2, x: -30, y: 50 };
    expect(
        hitTestDeviceMap(
            screenPoint({ x: node.x - 31, y: node.y - 29 }, camera),
            camera,
            [node],
            [],
            null,
        ),
    ).toEqual({ kind: "node", id: node.id });
    expect(
        hitTestDeviceMap(
            screenPoint({ x: node.x - 31, y: node.y - 29 }, camera),
            camera,
            [{ ...node, custom: false }],
            [],
            null,
        ),
    ).toBeNull();
});

it("returns no selection for blank space", () => {
    expect(
        hitTestDeviceMap(
            { x: 400, y: 400 },
            identity,
            [{ id: "peer", x: 0, y: 0 }],
            [horizontalEdge("edge", 0)],
            null,
        ),
    ).toBeNull();
});
