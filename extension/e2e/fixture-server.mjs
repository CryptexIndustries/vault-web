import { createServer } from "node:http";

const port = Number.parseInt(process.env.PORT ?? "4173", 10);

const html = String.raw`<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Passkey relying-party fixture</title>
  </head>
  <body>
    <main>
      <h1>Example account security</h1>
      <p>Signed in as <strong>person@example.test</strong></p>
      <button id="create-passkey" type="button">Create a passkey</button>
      <output id="registration-status" role="status"></output>
      <button id="use-passkey" type="button" disabled>Use saved passkey</button>
      <button id="use-discoverable-passkey" type="button" disabled>Use discoverable passkey</button>
      <output id="authentication-status" role="status"></output>
    </main>
    <script>
      let registered = null;
      const bytes = (value) => new Uint8Array(value);
      const equal = (left, right) => left.length === right.length && left.every((value, index) => value === right[index]);
      const concat = (...parts) => {
        const output = new Uint8Array(parts.reduce((length, part) => length + part.length, 0));
        let offset = 0;
        for (const part of parts) { output.set(part, offset); offset += part.length; }
        return output;
      };
      // Web Crypto verifies ECDSA signatures in the raw r||s format.
      const derToRaw = (der) => {
        let offset = 2;

        if (der[0] !== 0x30 || der[offset++] !== 0x02) throw new Error("Invalid DER sequence");
        const rLength = der[offset++];

        let r = der.slice(offset, offset + rLength);
        offset += rLength;

        if (der[offset++] !== 0x02) throw new Error("Invalid DER integer");

        const sLength = der[offset++];
        let s = der.slice(offset, offset + sLength);
        if (r[0] === 0) r = r.slice(1);
        if (s[0] === 0) s = s.slice(1);

        const raw = new Uint8Array(64);
        raw.set(r, 32 - r.length);
        raw.set(s, 64 - s.length);
        return raw;
      };

      document.querySelector("#create-passkey").addEventListener("click", async () => {
        const status = document.querySelector("#registration-status");
        try {
          const credential = await navigator.credentials.create({
            publicKey: {
              challenge: crypto.getRandomValues(new Uint8Array(32)),
              rp: { id: window.location.hostname, name: "Example E2E" },
              user: {
                id: new TextEncoder().encode("e2e-user-handle"),
                name: "person@example.test",
                displayName: "Example Person"
              },
              pubKeyCredParams: [{ type: "public-key", alg: -7 }],
              authenticatorSelection: {
                residentKey: "required",
                userVerification: "preferred"
              },
              attestation: "none",
              timeout: 60000
            }
          });
          if (!credential) throw new Error("NoCredential");
          registered = {
            id: credential.rawId.slice(0),
            publicKey: credential.response.getPublicKey().slice(0)
          };
          document.querySelector("#use-passkey").disabled = false;
          document.querySelector("#use-discoverable-passkey").disabled = false;
          status.value = "Registered " + credential.id;
        } catch (error) {
          status.value = "Registration failed: " + error.name;
        }
      });

      const authenticate = async (discoverable) => {
        const status = document.querySelector("#authentication-status");
        try {
          if (!registered) throw new Error("NoRegistration");
          const challenge = crypto.getRandomValues(new Uint8Array(32));
          const credential = await navigator.credentials.get({
            mediation: discoverable ? "conditional" : "optional",
            publicKey: {
              challenge,
              rpId: window.location.hostname,
              ...(discoverable ? {} : { allowCredentials: [{ type: "public-key", id: registered.id, transports: ["internal"] }] }),
              userVerification: "required",
              timeout: 60000
            }
          });

          const client = JSON.parse(new TextDecoder().decode(credential.response.clientDataJSON));

          if (client.type !== "webauthn.get" || client.origin !== window.location.origin) throw new Error("InvalidClientData");

          const rpHash = bytes(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(window.location.hostname)));
          const authenticatorData = bytes(credential.response.authenticatorData);

          if (!equal(authenticatorData.slice(0, 32), rpHash)) throw new Error("InvalidRpHash");
          if ((authenticatorData[32] & 0x05) !== 0x05) throw new Error("MissingPresenceOrVerification");

          const clientHash = bytes(await crypto.subtle.digest("SHA-256", credential.response.clientDataJSON));
          const publicKey = await crypto.subtle.importKey("spki", registered.publicKey, { name: "ECDSA", namedCurve: "P-256" }, false, ["verify"]);

          const valid = await crypto.subtle.verify(
            { name: "ECDSA", hash: "SHA-256" },
            publicKey,
            derToRaw(bytes(credential.response.signature)),
            concat(authenticatorData, clientHash)
          );
          if (!valid) throw new Error("InvalidSignature");
          status.value = (discoverable ? "Discoverable authenticated " : "Authenticated ") + credential.id + " with verified ES256 signature";
        } catch (error) {
          status.value = "Authentication failed: " + (error.name || error.message);
        }
      };
      document.querySelector("#use-passkey").addEventListener("click", () => authenticate(false));
      document.querySelector("#use-discoverable-passkey").addEventListener("click", () => authenticate(true));
    </script>
  </body>
</html>`;

const server = createServer((request, response) => {
    if (request.url === "/" || request.url === "/health") {
        response.writeHead(200, {
            "content-type":
                request.url === "/health"
                    ? "text/plain"
                    : "text/html; charset=utf-8",
            "cache-control": "no-store",
        });
        response.end(request.url === "/health" ? "ok" : html);
        return;
    }

    response.writeHead(404, { "content-type": "text/plain" });
    response.end("not found");
});

server.listen(port, "127.0.0.1", () => {
    process.stdout.write(
        `Passkey fixture listening on http://127.0.0.1:${port}\n`,
    );
});

const close = () => {
    server.close(() => process.exit(0));
    server.closeAllConnections();
    setTimeout(() => process.exit(1), 2_000).unref();
};
process.once("SIGINT", close);
process.once("SIGTERM", close);
