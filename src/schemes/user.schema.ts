import z from "zod";

export const createUserSchema = z.object({
    email: z.string().email().trim(),
    secret: z.string().trim(),
    token: z.string().trim(),
});
