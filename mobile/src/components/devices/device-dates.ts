type DeviceDate = Date | string | number | null | undefined;

function validDate(value: DeviceDate) {
    if (value == null || value === "") return null;
    const date = new Date(value);
    return Number.isFinite(date.getTime()) ? date : null;
}

export function formatDeviceDateTime(value: DeviceDate, compact = false) {
    const date = validDate(value);
    if (!date) return "Not available";
    return date.toLocaleString(undefined, {
        day: "2-digit",
        month: "short",
        year:
            compact && date.getFullYear() === new Date().getFullYear()
                ? undefined
                : compact
                  ? "2-digit"
                  : "numeric",
        hour: "2-digit",
        minute: "2-digit",
        hourCycle: "h23",
    });
}

export function formatDeviceActivity(value: DeviceDate) {
    const date = validDate(value);
    if (!date) return "Not available";
    const age = Math.max(0, Date.now() - date.getTime());
    if (age >= 86_400_000) return formatDeviceDateTime(date, true);
    const minutes = Math.floor(age / 60_000);
    if (minutes < 1) return "Just now";
    return minutes < 60
        ? `${minutes}m ago`
        : `${Math.floor(minutes / 60)}h ago`;
}
