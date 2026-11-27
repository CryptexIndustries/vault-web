// Uploads an extension ZIP to a Chrome Web Store item and submits it for
// review. The item publishes once it passes.
//
// Usage: node chrome-web-store.mjs <package.zip> <item id>
// Needs CHROME_WEB_STORE_PUBLISHER, the publisher ID, and
// CHROME_WEB_STORE_TOKEN, an access token with the
// https://www.googleapis.com/auth/chromewebstore scope.
import { openAsBlob } from "node:fs";
import { setTimeout as sleep } from "node:timers/promises";

const [packagePath, itemId] = process.argv.slice(2);
const { CHROME_WEB_STORE_PUBLISHER: publisher, CHROME_WEB_STORE_TOKEN: token } =
    process.env;
const item = `publishers/${publisher}/items/${itemId}`;

async function call(url, init) {
    const response = await fetch(url, {
        ...init,
        headers: { Authorization: `Bearer ${token}` },
    });
    const text = await response.text();
    if (!response.ok) {
        throw new Error(`${url}: ${response.status} ${text}`);
    }
    return JSON.parse(text);
}

let { uploadState } = await call(
    `https://chromewebstore.googleapis.com/upload/v2/${item}:upload`,
    {
        method: "POST",
        body: await openAsBlob(packagePath),
    },
);
for (let i = 0; uploadState === "IN_PROGRESS" && i < 60; i++) {
    await sleep(5000);
    ({ lastAsyncUploadState: uploadState } = await call(
        `https://chromewebstore.googleapis.com/v2/${item}:fetchStatus`,
    ));
}
if (uploadState !== "SUCCEEDED") {
    throw new Error(
        `Upload of ${packagePath} to ${itemId} ended as ${uploadState}`,
    );
}

const { state } = await call(
    `https://chromewebstore.googleapis.com/v2/${item}:publish`,
    { method: "POST" },
);
if (state !== "PENDING_REVIEW") {
    throw new Error(
        `Submitting ${itemId} left it ${state}, not PENDING_REVIEW`,
    );
}
console.log(`Submitted ${packagePath} to ${itemId} for review`);
