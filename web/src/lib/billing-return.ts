type ReturnQuery = Record<string, string | string[] | undefined>;

/** Return parameters select a fixed destination, don't prove payment. */
export function billingReturnDestination(query: ReturnQuery): string | null {
    if (
        Object.keys(query).some((key) => key !== "target" && key !== "outcome")
    ) {
        return null;
    }
    const { target, outcome } = query;
    if (outcome !== "success" && outcome !== "cancel" && outcome !== "return") {
        return null;
    }
    if (target === "web") return "/app";
    if (target === "mobile-production") {
        return `cryptex:///billing-return?outcome=${outcome}`;
    }
    if (target === "mobile-preprod") {
        return `cryptex-preprod:///billing-return?outcome=${outcome}`;
    }
    return null;
}
