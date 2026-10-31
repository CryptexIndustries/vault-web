import { i18n } from "@lingui/core";
import { t } from "@lingui/core/macro";

type DeviceDate = Date | string | number | null | undefined;

function validDate(value: DeviceDate) {
    if (value == null || value === "") return null;
    const date = new Date(value);
    return Number.isFinite(date.getTime()) ? date : null;
}

export function formatDeviceDateTime(value: DeviceDate, compact = false) {
    const date = validDate(value);
    if (!date) return t`Not available`;
    return date.toLocaleString(i18n.locale, {
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
    if (!date) return t`Not available`;
    const age = Math.max(0, Date.now() - date.getTime());
    if (age >= 86_400_000) return formatDeviceDateTime(date, true);
    const minutes = Math.floor(age / 60_000);
    if (minutes < 1) return t`Just now`;
    if (minutes < 60)
        return t({
            message: `${minutes}m ago`,
            comment: "Short: minutes since a device was last active",
        });
    const hours = Math.floor(minutes / 60);
    return t({
        message: `${hours}h ago`,
        comment: "Short: hours since a device was last active",
    });
}
