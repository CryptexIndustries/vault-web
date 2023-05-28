// src/utils/trpc.ts
import type { AppRouter } from "../server/trpc";
import { createTRPCReact } from "@trpc/react-query";

export const trpc = createTRPCReact<AppRouter>();
