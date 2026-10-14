const profiles = Object.freeze({
    production: Object.freeze({
        name: "production",
        applicationId: "com.cryptexindustries.vault",
        displayName: "Cryptex Vault",
        scheme: "cryptex",
        configFile: "release-config.json",
        artifactBase: "cryptex-vault",
        signingIdentityFile: "release-signing.json",
    }),
    preprod: Object.freeze({
        name: "preprod",
        applicationId: "com.cryptexindustries.vault.preprod",
        displayName: "Cryptex Vault Preprod",
        scheme: "cryptex-preprod",
        configFile: "prerelease-config.json",
        artifactBase: "cryptex-vault-preprod",
        signingIdentityFile: "release-signing-preprod.json",
    }),
});

function getProfile(name = "production") {
    if (!Object.hasOwn(profiles, name)) throw new Error(`Unknown application profile: ${name}. Choose production or preprod.`);
    return profiles[name];
}

module.exports = { profiles, getProfile };
