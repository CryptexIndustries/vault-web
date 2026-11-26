import assert from "node:assert/strict";
import { generateKeyPairSync, verify } from "node:crypto";
import { test } from "node:test";
import { parseIosOptions, waitForBuild } from "./build-ios.mjs";

const { privateKey, publicKey } = generateKeyPairSync("ec", {
    namedCurve: "P-256",
});
const key = {
    id: "KEY123",
    issuer: "issuer",
    pem: privateKey.export({ type: "pkcs8", format: "pem" }),
};
const build = { appId: "1", version: "0.7.0", buildNumber: "42.1" };

function serve(...states) {
    const requests = [];
    globalThis.fetch = async (url, init) => {
        requests.push({ url: new URL(url), init });
        const attributes = states.shift();
        if (typeof attributes === "number")
            return new Response("", { status: attributes });
        return Response.json({ data: attributes ? [{ attributes }] : [] });
    };
    return requests;
}

test("waitForBuild signs an ES256 token and waits for an App Store eligible build", async () => {
    const requests = serve(
        undefined,
        429,
        { processingState: "PROCESSING" },
        { processingState: "VALID", buildAudienceType: "APP_STORE_ELIGIBLE" },
    );
    await waitForBuild(key, build, { delay: 0 });
    assert.equal(requests.length, 4);
    const { url, init } = requests[0];
    assert.equal(url.searchParams.get("filter[version]"), "42.1");
    assert.equal(
        url.searchParams.get("filter[preReleaseVersion.version]"),
        "0.7.0",
    );
    assert.equal(
        url.searchParams.get("filter[preReleaseVersion.platform]"),
        "IOS",
    );
    const [header, payload, signature] =
        init.headers.Authorization.slice(7).split(".");
    assert.equal(JSON.parse(Buffer.from(header, "base64url")).kid, "KEY123");
    assert.equal(
        JSON.parse(Buffer.from(payload, "base64url")).aud,
        "appstoreconnect-v1",
    );
    assert.ok(
        verify(
            "sha256",
            Buffer.from(`${header}.${payload}`),
            { key: publicKey, dsaEncoding: "ieee-p1363" },
            Buffer.from(signature, "base64url"),
        ),
    );
});

test("waitForBuild fails on rejected, internal-only or unfinished builds", async () => {
    serve(401);
    await assert.rejects(waitForBuild(key, build, { delay: 0 }), /401/);
    serve({ processingState: "INVALID" });
    await assert.rejects(waitForBuild(key, build, { delay: 0 }), /INVALID/);
    serve({ processingState: "VALID", buildAudienceType: "INTERNAL_ONLY" });
    await assert.rejects(
        waitForBuild(key, build, { delay: 0 }),
        /App Store version/,
    );
    serve({ processingState: "PROCESSING" });
    await assert.rejects(
        waitForBuild(key, build, { attempts: 1, delay: 0 }),
        /in time/,
    );
});

test("iOS release options take one valid build number and --upload", () => {
    assert.deepEqual(parseIosOptions(["--build-number", "42.1", "--upload"]), {
        upload: true,
        buildNumber: "42.1",
    });
    for (const args of [
        ["--build-number"],
        ["--build-number", "1.2.3.4"],
        ["--profile", "preprod"],
    ])
        assert.throws(() => parseIosOptions(args));
});
