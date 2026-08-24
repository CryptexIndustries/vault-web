import http from "node:http";

const upstream = new URL(process.env.E2E_UPSTREAM_URL ?? "http://web:3000");
const port = Number(process.env.E2E_PROXY_PORT ?? "4174");

const server = http.createServer((request, response) => {
    const target = new URL(request.url ?? "/", upstream);
    const upstreamRequest = http.request(
        target,
        {
            method: request.method,
            headers: {
                ...request.headers,
                host: upstream.host,
            },
        },
        (upstreamResponse) => {
            response.writeHead(
                upstreamResponse.statusCode ?? 502,
                upstreamResponse.headers,
            );
            upstreamResponse.pipe(response);
        },
    );

    upstreamRequest.on("error", (error) => {
        response.writeHead(502, { "content-type": "text/plain" });
        response.end(`E2E upstream unavailable: ${error.message}`);
    });
    request.pipe(upstreamRequest);
});

server.listen(port, "127.0.0.1");

const shutdown = () => server.close(() => process.exit(0));
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
