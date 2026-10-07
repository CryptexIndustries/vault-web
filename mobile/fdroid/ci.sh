#!/usr/bin/env bash
set -euo pipefail

# Run in the disposable official F-Droid container, never in the live checkout.
# shellcheck source=/dev/null
. /etc/profile.d/bsenv.sh
fdroid_tools=/home/vagrant/fdroidserver
git clone --quiet --depth 1 --branch 2.4.5 \
  https://gitlab.com/fdroid/fdroidserver.git "$fdroid_tools"
test "$(git -C "$fdroid_tools" rev-parse HEAD)" = 92229a9152a31d005503bac64d773551f0655494
export PATH="$fdroid_tools:$PATH" PYTHONPATH="$fdroid_tools:$fdroid_tools/examples"
export CRYPTEX_BUILD_JOBS="${CRYPTEX_BUILD_JOBS:-2}"

mkdir -p /build/submission/{metadata,srclibs} /build/fdroid/{metadata,srclibs} /build/artifacts
curl -fL 'https://gitlab.com/fdroid/fdroiddata/-/archive/60211383fefd7e2891a1205a61a041896b149514/fdroiddata-60211383fefd7e2891a1205a61a041896b149514.tar.gz?path=config' \
  -o /tmp/fdroiddata-config.tar.gz
echo 'a4c7ce6b6baca8965eabcb16be6db866118759dd122752dff63dc18b14aa80bd  /tmp/fdroiddata-config.tar.gz' | sha256sum --check --strict
tar -xzf /tmp/fdroiddata-config.tar.gz --strip-components=1 -C /build/submission
python3 - <<'PY'
import json
import hashlib
import os
import re
import shutil
from pathlib import Path
from ruamel.yaml import YAML

source = Path('/app')
submission = Path('/build/submission')
commit = os.environ['SOURCE_COMMIT']
assert re.fullmatch(r'[0-9a-f]{40}', commit), 'Expected the full source commit'
app = json.loads((source / 'mobile/app.json').read_text())['expo']
version, code = app['version'], app['android']['versionCode']
ref = os.environ['RELEASE_REF'].removeprefix('refs/tags/')
if ref.startswith('mobile-v'):
    assert ref == f'mobile-v{version}', 'Release tag and application version differ'
yaml = YAML()
metadata = yaml.load(source / 'mobile/fdroid/metadata/com.cryptexindustries.vault.yml')
assert len(metadata['Builds']) == 1, 'Review CI selection before adding another build'
build = metadata['Builds'][0]
build.update({'commit': commit, 'versionName': version, 'versionCode': code})
build.pop('disable', None)
config = Path('/inputs/release-config.json').read_bytes()
config_hash = hashlib.sha256(config).hexdigest()
assert sum('PUBLISH_RELEASE_CONFIG_SHA256' in command for command in build['prebuild']) == 1
build['prebuild'] = [command.replace('PUBLISH_RELEASE_CONFIG_SHA256', config_hash) for command in build['prebuild']]
Path('/build/release-config.json').write_bytes(config)
Path('/build/release-config.json').chmod(0o644)
Path('/build/artifacts/release-config.json').write_bytes(config)
metadata.update({'CurrentVersion': version, 'CurrentVersionCode': code})
yaml.dump(metadata, submission / 'metadata/com.cryptexindustries.vault.yml')
for srclib in build['srclibs']:
    name, revision = srclib.split('@')
    assert re.fullmatch(r'[0-9a-f]{40}', revision), 'Source library needs a full commit'
    shutil.copyfile(source / f'mobile/fdroid/srclibs/{name}.yml', submission / f'srclibs/{name}.yml')
PY

cd /build/submission
fdroid readmeta
fdroid rewritemeta com.cryptexindustries.vault
python3 - <<'PY'
from pathlib import Path
path = Path('metadata/com.cryptexindustries.vault.yml')
path.write_text('\n'.join(line.rstrip() for line in path.read_text().splitlines()) + '\n')
PY
fdroid lint com.cryptexindustries.vault
cp metadata/*.yml /build/fdroid/metadata/
cp srclibs/*.yml /build/fdroid/srclibs/
mv config /build/fdroid/

# The reference APK is published after local signing. Keep its URL in the
# submission; omit it only from this unsigned bootstrap build's temporary copy.
python3 - <<'PY'
from pathlib import Path
from ruamel.yaml import YAML
path = Path('/build/fdroid/metadata/com.cryptexindustries.vault.yml')
yaml = YAML()
metadata = yaml.load(path)
metadata.pop('Binaries')
# The public configuration asset is published with the signed APK after this
# build. Bootstrap from the identical CI snapshot and retain its checksum check.
commands = metadata['Builds'][0]['prebuild']
fetch = [index for index, command in enumerate(commands) if command.startswith('curl -fL ') and '/release-config.json' in command]
assert len(fetch) == 1, 'Expected one release configuration download'
commands[fetch[0]] = 'cp /build/release-config.json /tmp/cryptex-release-config.json'
yaml.dump(metadata, path)
PY

# The container provides sdkmanager; the recipe installs the remaining pinned
# toolchains through its sudo phase. --on-server executes that phase, then
# removes sudo before preparing, scanning and compiling the application.
sdkmanager --sdk_root="$ANDROID_HOME" 'cmdline-tools;latest' 'ndk;27.1.12297006'
cd /build/fdroid
fdroid fetchsrclibs com.cryptexindustries.vault
chown -R vagrant:vagrant /build "$fdroid_tools" "$ANDROID_HOME"
sudo -H --user vagrant --preserve-env=PATH,PYTHONPATH,ANDROID_HOME,CRYPTEX_BUILD_JOBS \
  "$fdroid_tools/fdroid" build --on-server --verbose --scan-binary --no-tarball \
  com.cryptexindustries.vault 2>&1 | tee build.log

cp build/com.cryptexindustries.vault/mobile/dist/cryptex-vault-fdroid-unsigned.apk{,.json} /build/artifacts/
cp build/com.cryptexindustries.vault/mobile/dist/fdroid-build/skia/skia-source-build.json /build/artifacts/
python3 - <<'PY'
import json
import os
from pathlib import Path
metadata = json.loads(Path('/build/artifacts/cryptex-vault-fdroid-unsigned.apk.json').read_text())
assert metadata['sourceRevision'] == {'commit': os.environ['SOURCE_COMMIT'], 'dirty': False}, 'Build must identify the complete clean release source'
PY
cd /build/artifacts
sha256sum -- *.apk > SHA256SUMS
sha256sum -- release-config.json >> SHA256SUMS
