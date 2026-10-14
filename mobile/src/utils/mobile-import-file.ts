import { DOMParser as XMLDOMParser } from "@xmldom/xmldom";

import {
    parseImportFile,
    type ImportResult,
    type ImportSource,
} from "@cryptex-industries/vault-core/vault-utils/import-export";

type SelectableNode = Document | Element;

const elementChildren = (node: Node): Element[] => {
    const children: Element[] = [];
    for (let index = 0; index < node.childNodes.length; index += 1) {
        const child = node.childNodes.item(index);
        if (child?.nodeType === 1) children.push(child as Element);
    }
    return children;
};

const descendantElements = (node: Node): Element[] =>
    elementChildren(node).flatMap((child) => [
        child,
        ...descendantElements(child),
    ]);

const matchesTag = (element: Element, tag: string) => element.tagName === tag;

/** Supports the tag and direct-child selectors used by the shared KeePass parser. */
const selectElements = (scope: SelectableNode, selector: string): Element[] => {
    const trimmed = selector.trim();
    if (trimmed.startsWith(":scope > ")) {
        const tag = trimmed.slice(9).trim();
        return elementChildren(scope).filter((child) => matchesTag(child, tag));
    }

    const path = trimmed.split(">", 8).map((part) => part.trim());
    if (path.length > 1) {
        let matches = descendantElements(scope).filter((element) =>
            matchesTag(element, path[0]!),
        );
        for (const tag of path.slice(1)) {
            matches = matches.flatMap((element) =>
                elementChildren(element).filter((child) =>
                    matchesTag(child, tag),
                ),
            );
        }
        return matches;
    }

    return descendantElements(scope).filter((element) =>
        matchesTag(element, trimmed),
    );
};

const installSelectorSurface = (document: Document, malformed: boolean) => {
    const install = (node: SelectableNode) => {
        Object.defineProperties(node, {
            querySelector: {
                configurable: true,
                value: (selector: string) => {
                    if (selector === "parsererror" && malformed) {
                        return document.documentElement;
                    }
                    return selectElements(node, selector)[0] ?? null;
                },
            },
            querySelectorAll: {
                configurable: true,
                value: (selector: string) => selectElements(node, selector),
            },
        });

        if (node.nodeType === 1) {
            Object.defineProperty(node, "children", {
                configurable: true,
                get: () => elementChildren(node),
            });
        }

        for (const child of elementChildren(node)) install(child);
    };

    install(document);
};

class MobileXMLDOMParser {
    parseFromString(
        source: string,
        mimeType?: DOMParserSupportedType,
    ): Document {
        let malformed = false;
        const markMalformed = () => {
            malformed = true;
        };
        const document = new XMLDOMParser({
            errorHandler: {
                warning: markMalformed,
                error: markMalformed,
                fatalError: markMalformed,
            },
        }).parseFromString(source, mimeType);
        installSelectorSurface(document, malformed);
        return document;
    }
}

/**
 * React Native has no browser DOMParser. Install the mobile fallback once so
 * overlapping async work cannot replace or restore another import's parser.
 */
export const parseMobileImportFile = async (
    source: ImportSource,
    file: File,
): Promise<ImportResult> => {
    if (source !== "keepass-xml") return parseImportFile(source, file);

    const runtime = globalThis as typeof globalThis & {
        DOMParser?: typeof DOMParser;
    };
    if (!runtime.DOMParser) {
        runtime.DOMParser = MobileXMLDOMParser as unknown as typeof DOMParser;
    }
    return parseImportFile(source, file);
};
