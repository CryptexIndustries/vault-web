// The worker bundles aren't tracked. Build them before tests import them.
module.exports = () => require("../scripts/build-workers.cjs").buildWorkers();
