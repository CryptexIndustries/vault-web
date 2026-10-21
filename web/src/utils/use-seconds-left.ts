import { useEffect, useState } from "react";

/** Whole seconds until deadline (epoch ms), updated every second. */
export function useSecondsLeft(deadline: number | null): number | null {
    const [now, setNow] = useState(() => Date.now());
    useEffect(() => {
        if (deadline === null) return;
        setNow(Date.now());
        const timer = window.setInterval(() => setNow(Date.now()), 1000);
        return () => window.clearInterval(timer);
    }, [deadline]);
    if (deadline === null) return null;
    return Math.max(0, Math.ceil((deadline - now) / 1000));
}

/** "0:42 left" */
export const formatSecondsLeft = (seconds: number) =>
    `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")} left`;
