#!/usr/bin/env node
/**
 * Generates packages/api-contract stub routers from cryptex-vault-cloud
 * for client-side VersionedRouter typing without server implementations.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const cloudRoot = process.env.CRYPTEX_CLOUD_ROOT
    ? path.resolve(process.env.CRYPTEX_CLOUD_ROOT)
    : path.resolve(root, "../cryptex-vault-cloud");
const serverTrpcDir = path.join(cloudRoot, "web/src/server/trpc");
const sourceRoutesDir = path.join(serverTrpcDir, "routes");
const targetRoutesDir = path.join(root, "packages/api-contract/src/routes");

const STUB_HANDLER =
    '.query(() => {\n        throw new Error("api-contract stub");\n    })';
const STUB_MUTATION =
    '.mutation(() => {\n        throw new Error("api-contract stub");\n    })';

function ensureZodImport(source) {
    if (/^import \{ z \} from ["']zod["'];/m.test(source)) {
        return source;
    }

    return `import { z } from "zod";\n${source}`;
}

function addVoidOutputsForUnspecifiedProcedures(source) {
    let addedVoidOutput = false;
    const out = source.replace(
        /(export const\s+\w+\s*=\s*[\s\S]*?)(\n    \.(?:query|mutation)\(\(\) => \{)/g,
        (match, chain, resolverStart) => {
            if (chain.includes(".output(")) {
                return match;
            }

            addedVoidOutput = true;
            return `${chain}\n    .output(z.void())${resolverStart}`;
        },
    );

    return addedVoidOutput ? ensureZodImport(out) : out;
}

function assertContractRouteSafe(source, rel) {
    const importPattern = /^import[\s\S]*?from ["']([^"']+)["'];?\n/gm;
    for (const match of source.matchAll(importPattern)) {
        const importSource = match[1];
        const allowed =
            importSource === "zod" ||
            importSource === "../../trpc" ||
            importSource === "../trpc" ||
            importSource === "../../payment";
        if (!allowed) {
            throw new Error(
                `Generated contract route ${rel} kept forbidden import "${importSource}"`,
            );
        }
    }

    const procedurePattern = /export const\s+(\w+)\s*=\s*([\s\S]*?)\n;/g;
    for (const match of source.matchAll(procedurePattern)) {
        const [, name, body] = match;
        if (
            (body.includes(".query(") || body.includes(".mutation(")) &&
            !body.includes(".output(")
        ) {
            throw new Error(
                `Generated contract procedure ${rel}:${name} has no explicit output`,
            );
        }
    }
}

function stripRouterImplementation(source, rel) {
    let out = source;

    out = out.replace(/^import[\s\S]*?from ["'][^"']+["'];?\n/gm, (line) => {
        if (
            line.includes('from "zod"') ||
            line.includes("from 'zod'") ||
            line.includes('from "../../trpc"') ||
            line.includes("from '../../trpc'") ||
            line.includes('from "../trpc"') ||
            line.includes("from '../trpc'")
        ) {
            return line;
        }
        return "";
    });

    out = out.replace(
        /import \{ protectedProcedure, publicProcedure \} from ["']\.\.\/\.\.\/trpc["'];/,
        'import { protectedProcedure, publicProcedure } from "../../trpc";',
    );
    out = out.replace(
        /import \{ publicProcedure \} from ["']\.\.\/\.\.\/trpc["'];/,
        'import { publicProcedure } from "../../trpc";',
    );
    out = out.replace(
        /import \{ protectedProcedure \} from ["']\.\.\/\.\.\/trpc["'];/,
        'import { protectedProcedure } from "../../trpc";',
    );

    out = out.replace(
        /\/\/#region Pusher[\s\S]*?const pusher = new Pusher\([\s\S]*?\}\);\n\n/g,
        "",
    );

    out = out.replace(/const invalidVoteError = \(\) =>[\s\S]*?\}\);\n+/g, "");

    if (out.includes("devicePurpose") && !out.includes("const devicePurpose")) {
        out = out.replace(
            /import \{ protectedProcedure \} from "\.\.\/\.\.\/trpc";\n/,
            'import { protectedProcedure } from "../../trpc";\n\nconst devicePurpose = z.enum(["web", "mobile", "browser", "cli"]);\n',
        );
    }

    if (
        out.includes("PAYMENT_TIERS.premiumMonthly") &&
        !out.includes("const PAYMENT_TIERS")
    ) {
        out = out.replace(
            /import \{ protectedProcedure \} from "\.\.\/\.\.\/trpc";\n/,
            'import { protectedProcedure } from "../../trpc";\nimport { getSubscriptionOutputSchema } from "../../payment";\n\nconst PAYMENT_TIERS = {\n    premiumMonthly: "premiumMonthly",\n    premiumYearly: "premiumYearly",\n} as const;\n',
        );
    }

    out = out.replace(/const userRecoveryArgon2Config[\s\S]*?};\n\n/g, "");

    out = out.replace(
        /from ["']\.\.\/\.\.\/\.\.\/\.\.\/schemes\/payment_router["']/,
        'from "../../payment"',
    );

    out = out.replace(
        /import \{\s*getSubscriptionOutputSchema,\s*\} from ["']\.\.\/\.\.\/payment["'];/,
        'import { getSubscriptionOutputSchema } from "../../payment";\n\nconst PAYMENT_TIERS = {\n    premiumMonthly: "premiumMonthly",\n    premiumYearly: "premiumYearly",\n} as const;',
    );

    if (
        out.includes("PAYMENT_TIERS.premiumMonthly") &&
        !out.includes("const PAYMENT_TIERS")
    ) {
        out = out.replace(
            /import \{ protectedProcedure \} from "\.\.\/trpc";\n/,
            'import { protectedProcedure } from "../trpc";\nimport { getSubscriptionOutputSchema } from "../../payment";\n\nconst PAYMENT_TIERS = {\n    premiumMonthly: "premiumMonthly",\n    premiumYearly: "premiumYearly",\n} as const;\n',
        );
    }

    out = out.replace(/import \* as trpc from "@trpc\/server";\n/g, "");

    out = out.replace(/\.query\(async[\s\S]*?\n    \}\);/g, STUB_HANDLER);
    out = out.replace(/\.mutation\(async[\s\S]*?\n    \}\);/g, STUB_MUTATION);

    out = out.replace(/\.query\(\(\) => \{[\s\S]*?\}\)\n(?!\s*;)/g, (match) =>
        match.endsWith(";") ? match : `${match};`,
    );
    out = out.replace(
        /\.mutation\(\(\) => \{[\s\S]*?\}\)\n(?!\s*;)/g,
        (match) => (match.endsWith(";") ? match : `${match};`),
    );

    out = addVoidOutputsForUnspecifiedProcedures(out);
    assertContractRouteSafe(out, rel);

    return out.trim() + "\n";
}

function copyRoutes() {
    fs.rmSync(targetRoutesDir, { recursive: true, force: true });

    for (const rel of fs.globSync("**/*.ts", { cwd: sourceRoutesDir })) {
        const sourcePath = path.join(sourceRoutesDir, rel);
        const targetPath = path.join(targetRoutesDir, rel);
        fs.mkdirSync(path.dirname(targetPath), { recursive: true });
        const source = fs.readFileSync(sourcePath, "utf8");
        fs.writeFileSync(targetPath, stripRouterImplementation(source, rel));
    }
}

function writeTrpcBase() {
    const trpcPath = path.join(root, "packages/api-contract/src/trpc.ts");
    fs.writeFileSync(
        trpcPath,
        `import { initTRPC } from "@trpc/server";
import superjson from "superjson";

const t = initTRPC.create({
    transformer: superjson,
});

export const router = t.router;
export const publicProcedure = t.procedure;
/** Typed like authenticated procedures; no server middleware in contract stubs. */
export const protectedProcedure = t.procedure;
`,
    );
}

function writeRouterIndex() {
    const indexPath = path.join(root, "packages/api-contract/src/router.ts");
    const sourceIndex = fs.readFileSync(
        path.join(serverTrpcDir, "index.ts"),
        "utf8",
    );
    fs.writeFileSync(indexPath, sourceIndex);
}

function writePaymentSchema() {
    const paymentSrc = path.join(
        cloudRoot,
        "web/src/schemes/payment_router.ts",
    );
    const paymentDst = path.join(root, "packages/api-contract/src/payment.ts");
    fs.mkdirSync(path.dirname(paymentDst), { recursive: true });
    fs.copyFileSync(paymentSrc, paymentDst);
}

function writeIndex() {
    const indexPath = path.join(root, "packages/api-contract/src/index.ts");
    fs.writeFileSync(
        indexPath,
        `export type { VersionedRouter } from "./router";
export {
    getSubscriptionOutputSchema,
    type GetSubscriptionOutputSchemaType,
} from "./payment";
export { buildTrpcUrl } from "./urls";
`,
    );
}

copyRoutes();
writeTrpcBase();
writeRouterIndex();
writePaymentSchema();
writeIndex();
console.log("api-contract stubs generated");
