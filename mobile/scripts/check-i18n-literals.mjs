// Fails on user-facing English left outside Lingui macros in app/ and src/.
// --all also lists other capitalized string literals with spaces for review.
// Mark a deliberate English string with an `i18n-ignore` comment on its line
// or the line above.
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import babel from "@babel/core";

const mobile = fileURLToPath(new URL("../", import.meta.url));
const skipped = /(^|\/)(node_modules|locales|workers|shims)(\/|$)/;
const userFacingName =
    /^(title|subtitle|label|placeholder|description|message|text|hint|headerTitle|headerBackTitle|tabBarLabel|accessibilityLabel|accessibilityHint|\w+(Label|Title|Text|Hint|Description|Message|Placeholder))$/;
const macroCallees = new Set([
    "t",
    "msg",
    "defineMessage",
    "plural",
    "select",
    "selectOrdinal",
]);
const macroComponents = new Set(["Trans", "Plural", "Select", "SelectOrdinal"]);
const ignoredCallees =
    /^(console\.\w+|log(ger)?\.\w+|\w*[lL]og\w*|require|describe|it|test|expect)$/;

function files(directory) {
    return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
        const path = join(directory, entry.name);
        if (skipped.test(relative(mobile, path))) return [];
        if (entry.isDirectory()) return files(path);
        return /\.tsx?$/.test(entry.name) && !entry.name.endsWith(".d.ts")
            ? [path]
            : [];
    });
}

function hasWords(value) {
    return /[A-Za-z]{2,}/.test(value);
}

function literalText(node) {
    if (!node) return null;
    if (node.type === "StringLiteral") return node.value;
    if (node.type === "TemplateLiteral")
        return node.quasis.map((quasi) => quasi.value.cooked).join("{}");
    if (node.type === "JSXExpressionContainer")
        return literalText(node.expression);
    return null;
}

function calleeName(node) {
    if (node.type === "Identifier") return node.name;
    if (node.type === "MemberExpression" && !node.computed)
        return `${calleeName(node.object)}.${node.property.name}`;
    return "";
}

function insideMacro(path) {
    return Boolean(
        path.findParent((parent) => {
            if (parent.isTaggedTemplateExpression())
                return macroCallees.has(calleeName(parent.node.tag));
            if (parent.isCallExpression()) {
                const name = calleeName(parent.node.callee);
                return macroCallees.has(name) || ignoredCallees.test(name);
            }
            if (parent.isJSXElement())
                return macroComponents.has(
                    parent.node.openingElement.name.name,
                );
            return false;
        }),
    );
}

export function findLiterals(source, filename, { all = false } = {}) {
    const ast = babel.parseSync(source, {
        filename,
        babelrc: false,
        configFile: false,
        parserOpts: { plugins: ["jsx", "typescript"] },
    });
    const lines = source.split("\n");
    const ignored = (line) =>
        lines[line - 1]?.includes("i18n-ignore") ||
        lines[line - 2]?.includes("i18n-ignore");
    const found = [];
    const report = (node, value, kind) => {
        const line = node.loc.start.line;
        if (!ignored(line)) found.push({ line, kind, value: value.trim() });
    };

    babel.traverse(ast, {
        JSXText(path) {
            if (hasWords(path.node.value) && !insideMacro(path))
                report(path.node, path.node.value, "jsx text");
        },
        JSXAttribute(path) {
            const value = literalText(path.node.value);
            if (
                value &&
                hasWords(value) &&
                userFacingName.test(path.node.name.name) &&
                !insideMacro(path)
            )
                report(path.node, value, `prop ${path.node.name.name}`);
        },
        ObjectProperty(path) {
            const key = path.node.key.name ?? path.node.key.value;
            const value = literalText(path.node.value);
            if (
                value &&
                hasWords(value) &&
                // Tailwind classes such as text: "text-muted-foreground".
                !/^[a-z]+-\S*$/.test(value) &&
                userFacingName.test(key) &&
                !insideMacro(path)
            )
                report(path.node, value, `property ${key}`);
        },
        "StringLiteral|TemplateLiteral"(path) {
            if (!all || path.parentPath.isJSXAttribute()) return;
            if (path.parentPath.isObjectProperty() && path.key === "value")
                return;
            if (
                path.parentPath.isImportDeclaration() ||
                path.parentPath.isExportDeclaration()
            )
                return;
            if (path.parentPath.isTSLiteralType()) return;
            const value = literalText(path.node);
            if (
                value &&
                /^[A-Z][a-z]+[^\w]*\s\S/.test(value) &&
                !insideMacro(path)
            )
                report(path.node, value, "literal");
        },
    });
    return found;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
    const args = process.argv.slice(2);
    const all = args.includes("--all");
    const targets = args.filter((arg) => arg !== "--all");
    const paths = targets.length
        ? targets.map((target) => join(process.cwd(), target))
        : [...files(join(mobile, "app")), ...files(join(mobile, "src"))];
    let count = 0;
    for (const path of paths) {
        for (const { line, kind, value } of findLiterals(
            readFileSync(path, "utf8"),
            path,
            { all },
        )) {
            count += 1;
            console.log(`${relative(mobile, path)}:${line} ${kind}: ${value}`);
        }
    }
    if (count) {
        console.error(`${count} untranslated strings`);
        process.exitCode = 1;
    }
}
