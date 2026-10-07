import { createHash, randomBytes, X509Certificate } from "node:crypto";
import { spawnSync } from "node:child_process";
import { existsSync, lstatSync, mkdirSync, chmodSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { getProfile } from "./release-config.mjs";
import { defaultSigningDirectory } from "./signing.mjs";

export function signingSetupOptions(args, home = homedir()) {
  let profile = "production";
  let directory;
  let writePublic = false;
  const seen = new Set();
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (arg === "--profile") {
      if (seen.has(arg) || !args[index + 1] || args[index + 1].startsWith("--")) throw new Error("Specify --profile production or preprod once.");
      seen.add(arg);
      profile = getProfile(args[++index]).name;
    } else if (arg === "--write-public" && !writePublic) writePublic = true;
    else if (!arg.startsWith("--") && !directory) directory = arg;
    else throw new Error("Usage: create-signing-identity.mjs [directory] [--profile production|preprod] [--write-public]");
  }
  return { profile, directory: resolve(directory ?? defaultSigningDirectory(profile, home)), writePublic };
}

export function createSigningIdentity(args = process.argv.slice(2)) {
const options = signingSetupOptions(args);

// Private signing material is generated locally, never under the source checkout.
const repository = fileURLToPath(new URL("../../", import.meta.url));
const directory = options.directory;
const publicIdentity = resolve(repository, "mobile", getProfile(options.profile).signingIdentityFile);
if (options.writePublic && existsSync(publicIdentity)) throw new Error("A public signing identity already exists; never replace it implicitly.");
const insideRepository = relative(repository, directory);
if (!isAbsolute(directory) || (!insideRepository.startsWith(`..${sep}`) && !isAbsolute(insideRepository))) {
  throw new Error("Signing material must be outside the repository");
}
mkdirSync(dirname(directory), { recursive: true, mode: 0o700 });
const parent = lstatSync(dirname(directory));
if (!parent.isDirectory() || parent.isSymbolicLink() || parent.uid !== process.getuid()) {
  throw new Error("Signing directory must have a locally owned directory parent");
}
// Fail if an identity already exists. Never rotate or overwrite a signing key implicitly.
mkdirSync(directory, { mode: 0o700 });
const keystore = resolve(directory, "release.p12");
const environmentFile = resolve(directory, "signing.env");
const alias = options.profile === "production" ? "cryptex-vault-release" : "cryptex-vault-preprod-release";
const password = randomBytes(32).toString("base64url");
const environment = {
  ...process.env,
  CRYPTEX_KEYSTORE: keystore,
  CRYPTEX_KEYSTORE_PASSWORD: password,
  CRYPTEX_KEY_ALIAS: alias,
  CRYPTEX_KEY_PASSWORD: password,
};
const shellQuote = (value) => `'${value.replaceAll("'", "'\\''")}'`;
const previousUmask = process.umask(0o077);
try {
  writeFileSync(environmentFile, [
    "# Private release signing credentials. Keep offline backups; never commit this file.",
    ...["CRYPTEX_KEYSTORE", "CRYPTEX_KEYSTORE_PASSWORD", "CRYPTEX_KEY_ALIAS", "CRYPTEX_KEY_PASSWORD"]
      .map((name) => `export ${name}=${shellQuote(environment[name])}`),
    "",
  ].join("\n"), { mode: 0o600, flag: "wx" });
  const generate = spawnSync("keytool", [
    "-genkeypair", "-keystore", keystore, "-storetype", "PKCS12",
    "-storepass:env", "CRYPTEX_KEYSTORE_PASSWORD", "-keypass:env", "CRYPTEX_KEY_PASSWORD",
    "-alias", alias, "-keyalg", "RSA", "-keysize", "4096", "-sigalg", "SHA256withRSA",
    "-validity", "10000", "-dname", `CN=${getProfile(options.profile).displayName}, OU=Android release, O=Cryptex Vault`,
    "-noprompt",
  ], { env: environment, encoding: "utf8" });
  if (generate.error || generate.status !== 0) {
    throw new Error(`Key generation failed. Private credentials remain at ${environmentFile}. ${generate.error?.message ?? generate.stderr}`);
  }
  chmodSync(keystore, 0o600);
  const exported = spawnSync("keytool", [
    "-exportcert", "-keystore", keystore, "-storepass:env", "CRYPTEX_KEYSTORE_PASSWORD", "-alias", alias,
  ], { env: environment });
  if (exported.error || exported.status !== 0) throw new Error("Cannot export public signing certificate");
  const certificate = new X509Certificate(exported.stdout);
  if (certificate.publicKey.asymmetricKeyType !== "rsa" || certificate.publicKey.asymmetricKeyDetails.modulusLength !== 4096) {
    throw new Error("Unexpected release signing algorithm");
  }
  // This output is public certificate data and file paths only. No passwords or private key bytes.
  const result = {
    directory, keystore, environmentFile,
    identity: {
      alias,
      certificateSha256: createHash("sha256").update(certificate.raw).digest("hex"),
      certificateDerBase64: certificate.raw.toString("base64"),
    },
  };
  if (options.writePublic) writeFileSync(publicIdentity, JSON.stringify(result.identity, null, 2) + "\n", { flag: "wx", mode: 0o644 });
  process.stdout.write(JSON.stringify(result, null, 2) + "\n");
} finally {
  process.umask(previousUmask);
}
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { createSigningIdentity(); } catch (error) { console.error(error.message); process.exitCode = 1; }
}
