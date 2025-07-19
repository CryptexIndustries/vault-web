// src/pages/api/trpc/[trpc].ts
import { createNextApiHandler } from "@trpc/server/adapters/next";
import { versionedRouter } from "../../../server/trpc";
import { createContext } from "../../../server/trpc/context";

// export API handler
export default createNextApiHandler({
    router: versionedRouter,
    createContext,
});
