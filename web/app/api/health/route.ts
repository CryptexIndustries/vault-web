export const runtime = "edge"; // 'nodejs' is the default

export async function GET() {
    return new Response("ok", {
        status: 200,
        headers: {
            "Access-Control-Allow-Origin":
                process.env.NEXT_PUBLIC_APP_URL ?? "",
            "Access-Control-Allow-Methods": "GET",
            "Cache-Control": "no-store, max-age=0",
        },
    });
}
