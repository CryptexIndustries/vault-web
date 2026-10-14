// The security worker bundle isn't tracked. Build it before tests import it.
module.exports = () =>
    require("../scripts/build-security-worker.cjs").buildSecurityWorker();
