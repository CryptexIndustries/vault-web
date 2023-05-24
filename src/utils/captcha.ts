export default async function validateCaptcha(token: string) {
    if (!process.env.TURNSTILE_SECRET) {
        throw new Error("TURNSTILE_SECRET is not defined");
    }

    return await fetch(
        "https://challenges.cloudflare.com/turnstile/v0/siteverify",
        {
            method: "POST",
            headers: {
                "Content-Type": "application/x-www-form-urlencoded",
            },
            body: new URLSearchParams({
                secret: process.env.TURNSTILE_SECRET,
                response: token,
            }),
        }
    ).then((res) => res.json());
}
