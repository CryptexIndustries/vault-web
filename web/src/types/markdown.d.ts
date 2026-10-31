// next.config.mjs loads CHANGELOG.md files as plain text.
declare module "*.md" {
    const content: string;
    export default content;
}
