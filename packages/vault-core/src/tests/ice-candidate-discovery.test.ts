import {
    afterEach,
    beforeEach,
    describe,
    expect,
    it,
    jest,
} from "@jest/globals";
import {
    createIceCandidateDiscovery,
    ICE_CANDIDATE_DISCOVERY_GRACE_MS,
} from "../vault-utils/ice-candidate-discovery";

describe("bounded ICE candidate discovery", () => {
    beforeEach(() => {
        jest.useFakeTimers();
    });
    afterEach(() => {
        jest.useRealTimers();
    });

    it("accepts native candidates after an empty completion without failing the transfer", () => {
        const fail = jest.fn();
        const discovery = createIceCandidateDiscovery(fail);
        discovery.gatheringCompleted();
        jest.advanceTimersByTime(8);
        discovery.candidateReceived();
        discovery.gatheringCompleted();
        jest.advanceTimersByTime(ICE_CANDIDATE_DISCOVERY_GRACE_MS);
        expect(fail).not.toHaveBeenCalled();
        expect(jest.getTimerCount()).toBe(0);
    });

    it("reports a genuine empty gather once at the five-second deadline", () => {
        const fail = jest.fn();
        const discovery = createIceCandidateDiscovery(fail);
        discovery.gatheringCompleted();
        jest.advanceTimersByTime(ICE_CANDIDATE_DISCOVERY_GRACE_MS - 1);
        expect(fail).not.toHaveBeenCalled();
        jest.advanceTimersByTime(1);
        expect(fail).toHaveBeenCalledTimes(1);
        discovery.gatheringCompleted();
        jest.advanceTimersByTime(ICE_CANDIDATE_DISCOVERY_GRACE_MS);
        expect(fail).toHaveBeenCalledTimes(1);
    });

    it("does not extend the deadline when completion notifications repeat", () => {
        const fail = jest.fn();
        const discovery = createIceCandidateDiscovery(fail);
        discovery.gatheringCompleted();
        jest.advanceTimersByTime(1_000);
        discovery.gatheringCompleted();
        jest.advanceTimersByTime(4_000);
        expect(fail).toHaveBeenCalledTimes(1);
    });

    it("never arms an empty-gather deadline when a candidate already exists", () => {
        const fail = jest.fn();
        const discovery = createIceCandidateDiscovery(fail);
        discovery.candidateReceived();
        discovery.gatheringCompleted();
        expect(jest.getTimerCount()).toBe(0);
        jest.advanceTimersByTime(ICE_CANDIDATE_DISCOVERY_GRACE_MS);
        expect(fail).not.toHaveBeenCalled();
    });

    it("cancels pending failure when a transfer ends or its session is replaced", () => {
        const oldFail = jest.fn();
        const currentFail = jest.fn();
        const old = createIceCandidateDiscovery(oldFail);
        old.gatheringCompleted();
        old.cancel();
        old.gatheringCompleted();
        const current = createIceCandidateDiscovery(currentFail);
        current.gatheringCompleted();
        jest.advanceTimersByTime(ICE_CANDIDATE_DISCOVERY_GRACE_MS);
        expect(oldFail).not.toHaveBeenCalled();
        expect(currentFail).toHaveBeenCalledTimes(1);
    });

    it("ignores stale candidate and completion callbacks after teardown", () => {
        const fail = jest.fn();
        const discovery = createIceCandidateDiscovery(fail);
        discovery.cancel();
        discovery.candidateReceived();
        discovery.gatheringCompleted();
        expect(jest.getTimerCount()).toBe(0);
        jest.advanceTimersByTime(ICE_CANDIDATE_DISCOVERY_GRACE_MS);
        expect(fail).not.toHaveBeenCalled();
    });
});
