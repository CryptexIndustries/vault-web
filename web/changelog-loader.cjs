// Turns a CHANGELOG.md into `export default "<file contents>"`, for the
// changelog page. Turbopack's built-in raw module type comes back empty.
module.exports = function changelogLoader(source) {
    return `export default ${JSON.stringify(source)};`;
};
