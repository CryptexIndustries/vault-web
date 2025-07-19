import { TRPCError } from "@trpc/server";

// Type that gets returned when the "success" property is true
/*
{
  "success": true,
  "challenge_ts": "2022-02-28T15:14:30.096Z",
  "hostname": "example.com",
  "error-codes": [],
  "action": "login",
  "cdata": "sessionid-123456789"
}
*/

// Type that gets returned when the "success" property is false
/*
{
  "success": false,
  "error-codes": [
    "invalid-input-response"
  ]
}
*/

type CaptchaResponse = {
    success: boolean;

    // These properties are only present when success is true
    challenge_ts?: string;
    hostname?: string;
    action?: string;
    cdata?: string;

    // These properties are only present when success is false
    "error-codes"?: string[];
};

/**
 * Validate a captcha token
 * @param token Captcha token
 * @returns Captcha response
 * @throws Error if TURNSTILE_SECRET is not defined
 * @throws Error if the call to the captcha API fails
 * @throws TRPCError if the captcha token is invalid
 */
export default async function validateCaptcha(token: string) {
    if (!process.env.TURNSTILE_SECRET) {
        throw new Error("TURNSTILE_SECRET is not defined");
    }

    const res: CaptchaResponse = await fetch(
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
        },
    ).then((res) => res.json());

    if (!res?.success) {
        throw trpcCaptchaError;
    }
}

const trpcCaptchaError = new TRPCError({
    code: "BAD_REQUEST",
    message: "Failed to validate captcha.",
});
