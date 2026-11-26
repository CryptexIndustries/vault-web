// Submits a listed version of the Firefox add-on to addons.mozilla.org, with
// its source archive and notes for the reviewers.
//
// Usage: node addons-mozilla-org.mjs <package.zip> <source.zip> <reviewer notes>
// Needs AMO_JWT_ISSUER and AMO_JWT_SECRET, the API key from
// https://addons.mozilla.org/developers/addon/api/key/.
import { execFileSync } from "node:child_process";
import { createHmac, randomUUID } from "node:crypto";
import { openAsBlob, readFileSync } from "node:fs";
import { basename } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";

const [packagePath, sourcePath, notesPath] = process.argv.slice(2);
const { AMO_JWT_ISSUER: issuer, AMO_JWT_SECRET: secret } = process.env;
const manifest = JSON.parse(
    execFileSync("unzip", ["-p", packagePath, "manifest.json"], {
        encoding: "utf8",
    }),
);
const addonId = manifest.browser_specific_settings.gecko.id;

// The API wants a new HS256 token on every request, valid for at most five
// minutes.
function authorization() {
    const iat = Math.floor(Date.now() / 1000);
    const encode = (value) =>
        Buffer.from(JSON.stringify(value)).toString("base64url");
    const unsigned = `${encode({ alg: "HS256", typ: "JWT" })}.${encode({ iss: issuer, jti: randomUUID(), iat, exp: iat + 60 })}`;
    return `JWT ${unsigned}.${createHmac("sha256", secret).update(unsigned).digest("base64url")}`;
}

async function call(path, init) {
    const response = await fetch(`https://addons.mozilla.org/api/v5${path}`, {
        ...init,
        headers: { Authorization: authorization() },
    });
    const text = await response.text();
    if (!response.ok) {
        throw new Error(`${path}: ${response.status} ${text}`);
    }
    return JSON.parse(text);
}

const uploadForm = new FormData();
uploadForm.append("channel", "listed");
uploadForm.append(
    "upload",
    await openAsBlob(packagePath),
    basename(packagePath),
);
let upload = await call("/addons/upload/", {
    method: "POST",
    body: uploadForm,
});
for (let i = 0; !upload.processed && i < 60; i++) {
    await sleep(10_000);
    upload = await call(`/addons/upload/${upload.uuid}/`);
}
if (!upload.valid) {
    const errors = upload.validation?.messages.filter(
        (message) => message.type === "error",
    );
    throw new Error(
        `addons.mozilla.org rejected ${packagePath}: ${JSON.stringify(errors ?? upload)}`,
    );
}

const versionForm = new FormData();
versionForm.append("upload", upload.uuid);
versionForm.append("approval_notes", readFileSync(notesPath, "utf8"));
versionForm.append(
    "source",
    await openAsBlob(sourcePath),
    basename(sourcePath),
);
const version = await call(
    `/addons/addon/${encodeURIComponent(addonId)}/versions/`,
    {
        method: "POST",
        body: versionForm,
    },
);
console.log(
    `Submitted ${addonId} ${version.version} for review with ${upload.validation.warnings} validation warnings`,
);
