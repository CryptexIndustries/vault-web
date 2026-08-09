#!/usr/bin/env node
/** Generate API-contract routers without copying server implementations. */
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { format } from "oxfmt";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const requireFromApiContract = createRequire(
    path.join(root, "packages/api-contract/package.json"),
);
const ts = requireFromApiContract("typescript");
const printer = ts.createPrinter({ newLine: ts.NewLineKind.LineFeed, removeComments: true});
const factory = ts.factory;

const cloudRoot = path.resolve(
    process.env.CRYPTEX_CLOUD_ROOT,
);
const sourceTrpcDir = path.join(cloudRoot, "web/src/server/trpc");
const sourceRoutesDir = path.join(sourceTrpcDir, "routes");
const sourceTrpcPath = path.join(sourceTrpcDir, "trpc.ts");
const sourcePaymentPath = path.join(
    cloudRoot,
    "web/src/schemes/payment_router.ts",
);

const targetSourceDir = path.join(root, "packages/api-contract/src");
const targetRoutesDir = path.join(targetSourceDir, "routes");
const targetTrpcPath = path.join(targetSourceDir, "trpc.ts");
const targetPaymentPath = path.join(targetSourceDir, "payment.ts");

const procedureMethods = new Set(["query", "mutation"]);
const sourceToTarget = new Map([
    [normalize(sourceTrpcPath), targetTrpcPath],
    [normalize(sourcePaymentPath), targetPaymentPath],
]);
const fileCache = new Map();

function normalize(filePath) {
    return path.normalize(path.resolve(filePath));
}

function importPath(fromFile, toFile) {
    let result = path
        .relative(path.dirname(fromFile), toFile)
        .replaceAll(path.sep, "/")
        .replace(/\.(?:[cm]?tsx?|jsx?)$/, "");
    return result.startsWith(".") ? result : `./${result}`;
}

function parseFile(filePath) {
    const normalizedPath = normalize(filePath);
    if (fileCache.has(normalizedPath)) return fileCache.get(normalizedPath);

    const source = fs.readFileSync(normalizedPath, "utf8");
    const ast = ts.createSourceFile(
        normalizedPath,
        source,
        ts.ScriptTarget.Latest,
        true,
        ts.ScriptKind.TS,
    );
    const info = {
        path: normalizedPath,
        ast,
        imports: new Map(),
        variables: new Map(),
        exports: new Map(),
        functions: new Set(),
        procedures: [],
    };
    fileCache.set(normalizedPath, info);

    for (const statement of ast.statements) {
        if (ts.isImportDeclaration(statement)) {
            registerImports(info, statement);
            continue;
        }
        if (ts.isFunctionDeclaration(statement) && statement.name) {
            info.functions.add(statement.name.text);
            continue;
        }
        if (!ts.isVariableStatement(statement)) continue;

        for (const declaration of statement.declarationList.declarations) {
            if (!ts.isIdentifier(declaration.name)) continue;
            const record = {
                info,
                declaration,
                name: declaration.name.text,
                isConst:
                    (statement.declarationList.flags & ts.NodeFlags.Const) !==
                    0,
                procedure: declaration.initializer
                    ? findProcedure(declaration.initializer)
                    : null,
            };

            if (record.procedure && isExported(statement)) {
                info.procedures.push(record);
            } else {
                info.variables.set(record.name, record);
                if (isExported(statement))
                    info.exports.set(record.name, record);
            }
        }
    }
    return info;
}

function registerImports(info, declaration) {
    const clause = declaration.importClause;
    if (!clause) return;

    const add = (localName, importedName) =>
        info.imports.set(localName, {
            declaration,
            file: info,
            localName,
            importedName,
        });

    if (clause.name) add(clause.name.text, "default");
    if (clause.namedBindings && ts.isNamespaceImport(clause.namedBindings)) {
        add(clause.namedBindings.name.text, "*");
    }
    if (clause.namedBindings && ts.isNamedImports(clause.namedBindings)) {
        for (const element of clause.namedBindings.elements) {
            add(
                element.name.text,
                element.propertyName?.text ?? element.name.text,
            );
        }
    }
}

function isExported(node) {
    return (
        node.modifiers?.some(
            (modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword,
        ) ?? false
    );
}

function isProcedure(node) {
    return (
        ts.isCallExpression(node) &&
        ts.isPropertyAccessExpression(node.expression) &&
        procedureMethods.has(node.expression.name.text)
    );
}

function findProcedure(expression) {
    if (!ts.isCallExpression(expression)) return null;
    return isProcedure(expression)
        ? expression
        : findProcedure(expression.expression);
}

function hasChainMethod(expression, method) {
    if (ts.isCallExpression(expression)) {
        if (
            ts.isPropertyAccessExpression(expression.expression) &&
            expression.expression.name.text === method
        ) {
            return true;
        }
        return hasChainMethod(expression.expression, method);
    }
    return ts.isPropertyAccessExpression(expression)
        ? hasChainMethod(expression.expression, method)
        : false;
}

function isBindingName(node) {
    const parent = node.parent;
    return (
        (ts.isParameter(parent) && parent.name === node) ||
        (ts.isVariableDeclaration(parent) && parent.name === node) ||
        (ts.isBindingElement(parent) && parent.name === node)
    );
}

function isPropertyName(node) {
    const parent = node.parent;
    return (
        isBindingName(node) ||
        (ts.isPropertyAccessExpression(parent) && parent.name === node) ||
        (ts.isPropertyAssignment(parent) &&
            parent.name === node &&
            parent.initializer !== node)
    );
}

function resolveModule(importingFile, specifier) {
    if (!specifier.startsWith(".")) return null;

    const base = path.resolve(path.dirname(importingFile), specifier);
    const candidates = [
        base,
        `${base}.ts`,
        `${base}.tsx`,
        `${base}.mts`,
        `${base}.js`,
        `${base}.mjs`,
        path.join(base, "index.ts"),
        path.join(base, "index.tsx"),
        path.join(base, "index.mts"),
        path.join(base, "index.js"),
        path.join(base, "index.mjs"),
    ];
    return candidates.find((candidate) => fs.existsSync(candidate)) ?? null;
}

function mappedImport(binding, targetFile) {
    const specifier = binding.declaration.moduleSpecifier.text;
    if (specifier === "zod") return "zod";

    const sourceFile = resolveModule(binding.file.path, specifier);
    const target = sourceFile && sourceToTarget.get(normalize(sourceFile));
    return target ? importPath(targetFile, target) : null;
}

function staticImport(binding) {
    if (binding.importedName === "*" || binding.importedName === "default") {
        return null;
    }
    const sourceFile = resolveModule(
        binding.file.path,
        binding.declaration.moduleSpecifier.text,
    );
    if (!sourceFile) return null;

    const record = parseFile(sourceFile).exports.get(binding.importedName);
    if (
        !record ||
        !record.declaration.initializer ||
        !record.isConst ||
        isFunctionInitializer(record)
    ) {
        return null;
    }
    return record;
}

function isFunctionInitializer(record) {
    const initializer = record.declaration.initializer;
    return Boolean(
        initializer &&
        (ts.isArrowFunction(initializer) ||
            ts.isFunctionExpression(initializer)),
    );
}

function staticRecord(name, file) {
    const local = file.variables.get(name);
    if (local?.isConst) return local;

    const binding = file.imports.get(name);
    return binding ? staticImport(binding) : null;
}

function literalExpression(node) {
    if (ts.isStringLiteralLike(node)) {
        return factory.createStringLiteral(node.text);
    }
    if (ts.isNumericLiteral(node)) {
        return factory.createNumericLiteral(node.text);
    }
    if (node.kind === ts.SyntaxKind.TrueKeyword) {
        return factory.createTrue();
    }
    if (node.kind === ts.SyntaxKind.FalseKeyword) {
        return factory.createFalse();
    }
    if (node.kind === ts.SyntaxKind.NullKeyword) {
        return factory.createNull();
    }
    if (ts.isParenthesizedExpression(node) || ts.isAsExpression(node)) {
        return literalExpression(node.expression);
    }
    return null;
}

function propertyName(node) {
    if (!node.name) return null;
    return ts.isIdentifier(node.name) || ts.isStringLiteralLike(node.name)
        ? node.name.text
        : null;
}

function staticProperty(node, file) {
    const object = ts.isIdentifier(node.expression)
        ? staticRecord(node.expression.text, file)
        : null;
    if (!object?.declaration.initializer) return null;

    let initializer = object.declaration.initializer;
    while (
        ts.isParenthesizedExpression(initializer) ||
        ts.isAsExpression(initializer)
    ) {
        initializer = initializer.expression;
    }
    if (!ts.isObjectLiteralExpression(initializer)) return null;

    const property = initializer.properties.find(
        (candidate) =>
            ts.isPropertyAssignment(candidate) &&
            propertyName(candidate) === node.name.text,
    );
    return property && ts.isPropertyAssignment(property)
        ? literalExpression(property.initializer)
        : null;
}

function inlineRecord(record, state, stack) {
    if (!record.declaration.initializer || isFunctionInitializer(record)) {
        throw new Error(`Shape references function ${record.name}`);
    }

    const key = `${record.info.path}\0${record.name}`;
    if (stack.has(key)) {
        throw new Error(`Cyclic shape declaration ${record.name}`);
    }

    const nextStack = new Set(stack).add(key);
    let expression = transformExpression(
        record.declaration.initializer,
        record.info,
        state,
        nextStack,
    );
    return record.info.path === state.route.path
        ? expression
        : detachSourceRanges(expression);
}

function detachSourceRanges(node) {
    const transformer = (context) => {
        const visit = (child) =>
            ts.setTextRange(ts.visitEachChild(child, visit, context), {
                pos: -1,
                end: -1,
            });
        return (rootNode) => ts.visitNode(rootNode, visit);
    };
    const transformed = ts.transform(node, [transformer]);
    const result = transformed.transformed[0];
    transformed.dispose();
    return result;
}

function stubResolver() {
    return factory.createArrowFunction(
        undefined,
        undefined,
        [],
        undefined,
        factory.createToken(ts.SyntaxKind.EqualsGreaterThanToken),
        factory.createBlock(
            [
                factory.createThrowStatement(
                    factory.createNewExpression(
                        factory.createIdentifier("Error"),
                        undefined,
                        [factory.createStringLiteral("api-contract stub")],
                    ),
                ),
            ],
            true,
        ),
    );
}

function transformNode(
    node,
    file,
    state,
    { stack = new Set(), replaceProcedure = false, addVoidOutput = false } = {},
) {
    const transformer = (context) => {
        const visit = (child) => {
            if (
                replaceProcedure &&
                ts.isCallExpression(child) &&
                isProcedure(child)
            ) {
                let target = ts.visitNode(child.expression.expression, visit);
                if (addVoidOutput) {
                    target = factory.createCallExpression(
                        factory.createPropertyAccessExpression(
                            target,
                            "output",
                        ),
                        undefined,
                        [
                            factory.createCallExpression(
                                factory.createPropertyAccessExpression(
                                    factory.createIdentifier(state.zodName),
                                    "void",
                                ),
                                undefined,
                                [],
                            ),
                        ],
                    );
                }
                return factory.updateCallExpression(
                    child,
                    factory.createPropertyAccessExpression(
                        target,
                        child.expression.name,
                    ),
                    child.typeArguments,
                    [stubResolver()],
                );
            }

            if (ts.isPropertyAccessExpression(child)) {
                const literal = staticProperty(child, file);
                if (literal) return literal;
            }

            if (ts.isIdentifier(child) && !isPropertyName(child)) {
                const local = file.variables.get(child.text);
                if (local?.isConst && !isFunctionInitializer(local)) {
                    return inlineRecord(local, state, stack);
                }
                if (local) {
                    throw new Error(
                        `${replaceProcedure ? "Procedure" : "Shape"} references ${local.isConst ? "function" : "non-const"} ${child.text}`,
                    );
                }

                const binding = file.imports.get(child.text);
                if (binding) {
                    if (mappedImport(binding, state.targetPath)) {
                        state.markImport(binding);
                        return child;
                    }
                    const imported = staticImport(binding);
                    if (imported) return inlineRecord(imported, state, stack);
                    throw new Error(
                        `Shape import ${child.text} from ${binding.declaration.moduleSpecifier.text} is not available in the contract`,
                    );
                }
                if (file.functions.has(child.text)) {
                    throw new Error(
                        `${replaceProcedure ? "Procedure" : "Shape"} references function ${child.text}`,
                    );
                }
            }
            return ts.visitEachChild(child, visit, context);
        };
        return (rootNode) => ts.visitNode(rootNode, visit);
    };

    const transformed = ts.transform(node, [transformer]);
    const result = transformed.transformed[0];
    transformed.dispose();
    return result;
}

function transformExpression(node, file, state, stack) {
    return transformNode(node, file, state, { stack });
}

function transformProcedure(initializer, file, state, addVoidOutput) {
    return transformNode(initializer, file, state, {
        replaceProcedure: true,
        addVoidOutput,
    });
}

function formatImport(declaration, used, file, targetFile) {
    const clause = declaration.importClause;
    const target = mappedImport({ declaration, file }, targetFile);
    if (!clause || !target) {
        throw new Error(
            `Cannot copy shape import ${declaration.moduleSpecifier.text} from ${file.path}`,
        );
    }

    const parts = [];
    if (clause.name && used.has(clause.name.text)) {
        parts.push(clause.name.text);
    }
    if (
        clause.namedBindings &&
        ts.isNamespaceImport(clause.namedBindings) &&
        used.has(clause.namedBindings.name.text)
    ) {
        parts.push(`* as ${clause.namedBindings.name.text}`);
    }
    if (clause.namedBindings && ts.isNamedImports(clause.namedBindings)) {
        const names = clause.namedBindings.elements
            .filter((element) => used.has(element.name.text))
            .map((element) => element.getText(file.ast));
        if (names.length) parts.push(`{ ${names.join(", ")} }`);
    }

    return parts.length
        ? `import ${clause.isTypeOnly ? "type " : ""}${parts.join(", ")} from "${target}";`
        : null;
}

function extractRoute(sourcePath, targetPath) {
    const route = parseFile(sourcePath);
    const usedImports = new Map();
    const state = {
        route,
        targetPath,
        zodName: "z",
        markImport(binding) {
            const current = usedImports.get(binding.declaration) ?? {
                file: binding.file,
                used: new Set(),
            };
            current.used.add(binding.localName);
            usedImports.set(binding.declaration, current);
        },
    };

    const needsVoidOutput = route.procedures.some(
        (procedure) =>
            !hasChainMethod(procedure.declaration.initializer, "output"),
    );
    const zodBinding = [...route.imports.values()].find(
        (binding) =>
            binding.declaration.moduleSpecifier.text === "zod" &&
            binding.importedName === "z",
    );
    state.zodName = zodBinding?.localName ?? "z";
    if (needsVoidOutput && zodBinding) state.markImport(zodBinding);

    const procedures = route.procedures.map((procedure) =>
        renderProcedure(
            procedure,
            state,
            !hasChainMethod(procedure.declaration.initializer, "output"),
        ),
    );

    const imports = [];
    if (needsVoidOutput && !zodBinding)
        imports.push('import { z } from "zod";');
    for (const [declaration, { file, used }] of usedImports) {
        const rendered = formatImport(declaration, used, file, targetPath);
        if (rendered && !imports.includes(rendered)) imports.push(rendered);
    }

    const result = [imports.filter(Boolean).join("\n"), procedures.join("\n\n")]
        .filter(Boolean)
        .join("\n\n")
        .concat("\n");
    assertSafe(result, targetPath);
    return result;
}

function renderProcedure(procedure, state, addVoidOutput) {
    const { declaration, info } = procedure;
    const transformed = transformProcedure(
        declaration.initializer,
        info,
        state,
        addVoidOutput,
    );
    return `export const ${procedure.name} = ${printer.printNode(
        ts.EmitHint.Expression,
        transformed,
        info.ast,
    )};`;
}

function assertSafe(source, targetPath) {
    const rel = path.relative(targetSourceDir, targetPath);
    const ast = ts.createSourceFile(
        rel,
        source,
        ts.ScriptTarget.Latest,
        true,
        ts.ScriptKind.TS,
    );
    const allowedImports = new Set([
        "zod",
        importPath(targetPath, targetTrpcPath),
        importPath(targetPath, targetPaymentPath),
    ]);
    for (const statement of ast.statements) {
        if (ts.isImportDeclaration(statement)) {
            const name = statement.moduleSpecifier.text;
            if (!allowedImports.has(name)) {
                throw new Error(`Forbidden generated import ${name} in ${rel}`);
            }
        }
        if (
            ts.isFunctionDeclaration(statement) ||
            ts.isClassDeclaration(statement) ||
            (ts.isVariableStatement(statement) && !isExported(statement))
        ) {
            throw new Error(`Implementation declaration copied to ${rel}`);
        }
        if (!ts.isVariableStatement(statement) || !isExported(statement)) {
            continue;
        }
        for (const declaration of statement.declarationList.declarations) {
            const procedure = declaration.initializer
                ? findProcedure(declaration.initializer)
                : null;
            const resolver = procedure?.arguments[0];
            if (
                !procedure ||
                !hasChainMethod(declaration.initializer, "output") ||
                !resolver ||
                !ts.isArrowFunction(resolver) ||
                resolver.parameters.length ||
                !resolver.body
                    .getText(ast)
                    .includes('throw new Error("api-contract stub")')
            ) {
                throw new Error(`Invalid generated procedure in ${rel}`);
            }
        }
    }
}

async function formatSource(filePath, source) {
    const result = await format(filePath, source, {
        printWidth: 80,
        tabWidth: 4,
    });
    if (result.errors.length) {
        throw new Error(
            `Could not format ${filePath}: ${result.errors[0].message}`,
        );
    }
    return result.code;
}

async function copyRoutes() {
    fs.rmSync(targetRoutesDir, { recursive: true, force: true });
    for (const rel of fs.globSync("**/*.ts", { cwd: sourceRoutesDir })) {
        const sourcePath = path.join(sourceRoutesDir, rel);
        const targetPath = path.join(targetRoutesDir, rel);
        fs.mkdirSync(path.dirname(targetPath), { recursive: true });
        const source = extractRoute(sourcePath, targetPath);
        fs.writeFileSync(targetPath, await formatSource(targetPath, source));
    }
}

function writeFiles() {
    fs.mkdirSync(targetSourceDir, { recursive: true });
    fs.writeFileSync(
        targetTrpcPath,
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
    fs.writeFileSync(
        path.join(targetSourceDir, "router.ts"),
        fs.readFileSync(path.join(sourceTrpcDir, "index.ts"), "utf8"),
    );
    fs.copyFileSync(sourcePaymentPath, targetPaymentPath);
    fs.writeFileSync(
        path.join(targetSourceDir, "index.ts"),
        `export type { VersionedRouter } from "./router";
export {
    getSubscriptionOutputSchema,
    type GetSubscriptionOutputSchemaType,
} from "./payment";
export { buildTrpcUrl } from "./urls";
`,
    );
}

await copyRoutes();
writeFiles();
console.log("api-contract stubs generated");
