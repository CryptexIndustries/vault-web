// src/server/router/index.ts
import { createRouter } from "./context";
import superjson from "superjson";

// import { protectedExampleRouter } from "./routes/protected-example-router";
// import { credentialsRouter } from "./routes/credentials.router";
import { notifyMeRouter } from "./routes/notifyme.router";
export const appRouter = createRouter()
    .transformer(superjson)
    .merge("notifyme.", notifyMeRouter);
// .merge("credentials.", credentialsRouter)
// .merge("auth.", protectedExampleRouter);

// export type definition of API
export type AppRouter = typeof appRouter;
