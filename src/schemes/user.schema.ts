import z from "zod";

export const createUserSchema = z.object({
    email: z.string().email().trim(),
    secret: z.string().trim().max(100, "Secret is too long"),
    token: z.string().trim().max(100, "Token is too long"),
});

export type CreateUserSchema = z.TypeOf<typeof createUserSchema>;
