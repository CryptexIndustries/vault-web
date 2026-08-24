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
    </main>
    <script>
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
          status.value = credential ? "Registered " + credential.id : "No credential";
        } catch (error) {
          status.value = "Registration failed: " + error.name;
        }
      });
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

const close = () => server.close(() => process.exit(0));
process.on("SIGINT", close);
process.on("SIGTERM", close);
