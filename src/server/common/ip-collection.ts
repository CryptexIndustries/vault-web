import { IncomingHttpHeaders } from "http";

const ipFromHeaders = (headers: IncomingHttpHeaders): string => {
    // Check if the "Cf-Connecting-IP" header is present, and if so, return it. Otherwise, return the "x-forwarded-for" header.
    if (headers?.["cf-connecting-ip"]) {
        return headers["cf-connecting-ip"] as string;
    } else if (headers?.["x-forwarded-for"]) {
        const ip = headers["x-forwarded-for"] as string;

        // NOTE: This is a bit meh, but there should always be at least one element in the array.
        // If there isn't, we return a dummy IP address (127.0.0.2) that is different from the default case (127.0.0.1)
        return ip.split(/, /)[0] ?? "127.0.0.2";
    } else {
        return "127.0.0.1";
    }
};

export default ipFromHeaders;
