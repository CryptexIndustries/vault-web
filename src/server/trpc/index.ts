// src/server/router/index.ts
import { createRouter } from "./context";
import superjson from "superjson";

import { exampleRouter } from "./routes/example.router";
import { protectedExampleRouter } from "./routes/protected-example-router";
import { credentialsRouter } from "./routes/credentials.router";

export const appRouter = createRouter()
    .transformer(superjson)
    // .merge("example.", exampleRouter)
    .merge("credentials.", credentialsRouter)
    .merge("auth.", protectedExampleRouter);

// export type definition of API
export type AppRouter = typeof appRouter;
