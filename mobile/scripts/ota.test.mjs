import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { parseOtaOptions, createOtaPlan, provisionProfileSigning, assertRemoteGroup, assertRemoteEnvironment, assertRemoteChannel, parseRemoteVariables, resolveExportRuntime, assertExportRuntimeUnchanged } from './ota.mjs';
const require = createRequire(import.meta.url);
const { getOtaConfig } = require('../config/ota.cjs');
const base = JSON.parse(readFileSync(new URL('../eas-project.json', import.meta.url)));
const config = {EXPO_PUBLIC_CLOUD_ENABLED:'true', EXPO_PUBLIC_APP_URL:'https://vault.example.test', EXPO_PUBLIC_ONLINE_SERVICES_API_URL:'https://api.example.test', EXPO_PUBLIC_PUSHER_APP_HOST:'signal.example.test'};
function fixture(callback) {
 const dir=mkdtempSync(join(tmpdir(),'cryptex-ota-test-'));const project=join(dir,'eas-project.json');const publicConfig=join(dir,'release.json');writeFileSync(project,JSON.stringify(base));writeFileSync(publicConfig,JSON.stringify(config));
 try{return callback({dir,project,publicConfig});}finally{rmSync(dir,{recursive:true,force:true});}
}
test('both unsigned channels use real EAS identity and fingerprint runtime without certificates',()=>fixture(({project})=>{
 for(const profile of ['production','preprod']){
  const result=getOtaConfig({profile,required:true,projectFile:project});assert.equal(result.updates.enabled,true);assert.equal(result.updates.requestHeaders['expo-channel-name'],profile);assert.equal(result.updates.url,`https://u.expo.dev/${base.projectId}`);assert.deepEqual(result.runtimeVersion,{policy:'fingerprint'});assert.equal(result.updates.codeSigningCertificate,undefined);
 }
}));
test('standard development/test channels are isolated and invalid distribution choices fail',()=>fixture(({project})=>{
 assert.equal(getOtaConfig({profile:'preprod',mode:'e2e',projectFile:project}).updates.requestHeaders['expo-channel-name'],'preprod-e2e');
 assert.equal(getOtaConfig({profile:'production',mode:'development',projectFile:project}).updates.requestHeaders['expo-channel-name'],'production-dev');
 assert.throws(()=>getOtaConfig({profile:'preprod',distribution:'fdroid',projectFile:project}),/production/);
 assert.throws(()=>getOtaConfig({profile:'production',signingEnabled:'0',projectFile:project}),/true or false/);
}));
test('F-Droid disables OTA without a remote URL, channel or signing certificate in every mode',()=>fixture(({project})=>{
 for(const mode of ['release','development','e2e']){
  for(const signingEnabled of [false,true,'false','true']){
   const result=getOtaConfig({profile:'production',distribution:'fdroid',mode,signingEnabled,projectFile:project});
   assert.deepEqual(result.updates,{enabled:false,checkAutomatically:'NEVER',fallbackToCacheTimeout:0});
   assert.deepEqual(result.runtimeVersion,{policy:'fingerprint'});
   assert.equal(result.extra.buildDetails.otaSigning,'disabled');
  }
 }
}));
test('installed Expo Android plugin removes stale OTA targets when F-Droid is selected',async()=>{
 const sdk=createRequire(require.resolve('../node_modules/expo-updates/package.json'));
 const {AndroidConfig}=sdk('expo/config-plugins');
 const config=getOtaConfig({profile:'production',distribution:'fdroid',signingEnabled:true});
 const stale={ENABLED:'true',EXPO_UPDATE_URL:'https://u.expo.dev/stale',UPDATES_CONFIGURATION_REQUEST_HEADERS_KEY:'{"expo-channel-name":"production"}',CODE_SIGNING_CERTIFICATE:'old certificate',CODE_SIGNING_METADATA:'{"keyid":"old"}'};
 const manifest={manifest:{$:{'xmlns:android':'http://schemas.android.com/apk/res/android'},application:[{$:{'android:name':'.MainApplication'},'meta-data':Object.entries(stale).map(([name,value])=>({$:{'android:name':`expo.modules.updates.${name}`,'android:value':value}}))}]}};
 const result=await AndroidConfig.Updates.setUpdatesConfigAsync(new URL('../',import.meta.url).pathname,config,manifest,'57.0.18');
 const metadata=Object.fromEntries(result.manifest.application[0]['meta-data'].map(item=>[item.$['android:name'],item.$['android:value']]));
 assert.equal(metadata['expo.modules.updates.ENABLED'],'false');
 assert.equal(metadata['expo.modules.updates.EXPO_UPDATES_CHECK_ON_LAUNCH'],'NEVER');
 assert.equal(metadata['expo.modules.updates.EXPO_RUNTIME_VERSION'],'@string/expo_runtime_version');
 for(const name of Object.keys(stale).filter(name=>name!=='ENABLED'))assert.equal(metadata[`expo.modules.updates.${name}`],undefined);
});
test('missing EAS project fails with an explicit configuration error in every mode',()=>fixture(({dir})=>{
 const missing=join(dir,'absent.json');assert.throws(()=>getOtaConfig({profile:'production',projectFile:missing}),/Missing EAS/);
}));
test('profile/config canonical values survive hostile ambient E2E variables',()=>fixture(({project,publicConfig})=>{
 const options=parseOtaOptions(['publish','--profile','preprod','--config',publicConfig,'--message','reviewed','--dry-run']);const plan=createOtaPlan(options,{projectPath:project,inherited:{PATH:process.env.PATH, EXPO_PUBLIC_CRYPTEX_E2E:'1',EXPO_PUBLIC_APP_URL:'http://localhost:3000',CRYPTEX_APP_PROFILE:'production', EXPO_PUBLIC_OTHER:'bad', CRYPTEX_KEYSTORE:'/private/apk.keystore',CRYPTEX_KEYSTORE_PASSWORD:'private',CRYPTEX_KEY_ALIAS:'apk',CRYPTEX_KEY_PASSWORD:'private',CRYPTEX_EMBEDDED_UPDATE_COMMIT_TIME:'1',CRYPTEX_EMBEDDED_UPDATE_ID:'12345678-1234-4123-8123-123456789abc',CRYPTEX_EMBEDDED_UPDATE_UNKNOWN:'poison'}});
 assert.equal(plan.env.EXPO_PUBLIC_APP_URL,config.EXPO_PUBLIC_APP_URL);assert.equal(plan.env.EXPO_PUBLIC_CRYPTEX_E2E,'0');assert.equal(plan.env.EXPO_PUBLIC_OTHER,undefined);assert.equal(plan.env.CRYPTEX_APP_PROFILE,'preprod');assert.equal(plan.env.EXPO_NO_DOTENV,'1');assert.equal(plan.environment,'preview');assert.ok(plan.command.includes('--environment'));assert.ok(plan.command.includes('--skip-bundler'));assert.ok(!plan.command.includes('--private-key-path'));
 for(const name of ['CRYPTEX_KEYSTORE','CRYPTEX_KEYSTORE_PASSWORD','CRYPTEX_KEY_ALIAS','CRYPTEX_KEY_PASSWORD'])assert.equal(plan.env[name],undefined);
 assert.ok(!Object.keys(plan.env).some(name=>name.startsWith('CRYPTEX_EMBEDDED_UPDATE_')));
}));
test('publish defaults production rollout10 and preprod100; percentage/group inputs reject unsafe forms',()=>{
 for(const value of ['0','101','2.5','10x','NaN'])assert.throws(()=>parseOtaOptions(['publish','--message','test','--percentage',value]));
 assert.throws(()=>parseOtaOptions(['rollout','--group','oops','--percentage','50']),/UUID/);
 assert.throws(()=>parseOtaOptions(['publish','--message','test','--profile','staging']),/Unknown/);
 assert.throws(()=>parseOtaOptions(['setup','--unknown']),/Unknown/);
});
test('rollout and rollback target selected branch and refuse foreign groups',()=>fixture(({project,publicConfig})=>{
 const group='4e081b7f-bf19-4c6f-a931-821b804e2530';const options=parseOtaOptions(['rollout','--profile','preprod','--config',publicConfig,'--group',group,'--percentage','50']);const plan=createOtaPlan(options,{projectPath:project});assert.deepEqual(plan.command.slice(0,6),['update:edit',group,'--branch','preprod','--rollout-percentage','50']);
 assertRemoteGroup([{group,branch:'preprod',platform:'android'}],plan,group);assert.throws(()=>assertRemoteGroup([{group,branch:'production',platform:'android'}],plan,group),/selected/);
 const rollback=createOtaPlan(parseOtaOptions(['rollback','--config',publicConfig,'--runtime','abc123','--message','revert']),{projectPath:project});assert.equal(rollback.command[0],'update:roll-back-to-embedded');assert.ok(rollback.command.includes('abc123'));
 assert.throws(()=>parseOtaOptions(['rollback','--group',group,'--runtime','abc123','--message','revert']),/exactly one/);
 assert.throws(()=>parseOtaOptions(['publish','--group',group,'--message','fix']),/only accepted/);
 assert.throws(()=>parseOtaOptions(['publish','--runtime','abc123','--message','fix']),/only accepted/);
 assert.throws(()=>parseOtaOptions(['rollback','--group',group,'--message','revert','--percentage','25']),/only accepted/);
}));
test('remote reserved configuration mismatch fails without including values in error',()=>{
 assertRemoteEnvironment([{name:'EXPO_PUBLIC_APP_URL',value:'https://good.test'}],{EXPO_PUBLIC_APP_URL:'https://good.test'});
 assert.throws(()=>assertRemoteEnvironment([{name:'EXPO_PUBLIC_APP_URL',value:'secret-value'}],{EXPO_PUBLIC_APP_URL:'https://good.test'}),e=>!e.message.includes('secret-value')&&/conflicts/.test(e.message));
});
test('optional signed mode requires a valid pinned certificate; provisioning preserves keys',()=>fixture(({dir,project})=>{
 const identity=JSON.parse(readFileSync(project));identity.profiles.production.certificate='production.pem';writeFileSync(project,JSON.stringify(identity));assert.throws(()=>getOtaConfig({profile:'production',signingEnabled:true,projectFile:project}),/certificate/);
 const result=provisionProfileSigning('production',{projectPath:project,keysPath:join(dir,'private')});assert.ok(result.privateKey.startsWith(join(dir,'private')));const signed=getOtaConfig({profile:'production',signingEnabled:true,projectFile:project});assert.equal(signed.updates.codeSigningMetadata.alg,'rsa-v1_5-sha256');
 const signedConfig=join(dir,'signed.json');writeFileSync(signedConfig,JSON.stringify({...config,EXPO_PUBLIC_OTA_SIGNING_ENABLED:'true'}));
 const signedPlan=createOtaPlan(parseOtaOptions(['publish','--config',signedConfig,'--message','signed','--dry-run']),{projectPath:project,inherited:{CRYPTEX_KEYSTORE_PASSWORD:'private'}});
 assert.equal(signedPlan.env.CRYPTEX_KEYSTORE_PASSWORD,undefined);assert.equal(signedPlan.env.EXPO_PUBLIC_OTA_SIGNING_ENABLED,'true');assert.equal(signedPlan.ota.updates.codeSigningCertificate,signed.updates.codeSigningCertificate);assert.ok(signedPlan.command.includes('--private-key-path'));
 assert.throws(()=>provisionProfileSigning('production',{projectPath:project,keysPath:join(dir,'private')}),/already exists/);
 const altered=JSON.parse(readFileSync(project));altered.profiles.production.sha256='0'.repeat(64);writeFileSync(project,JSON.stringify(altered));assert.throws(()=>getOtaConfig({profile:'production',signingEnabled:true,projectFile:project}),/pinned/);
}));
test('actual SDK fingerprint stays compatible for JS/revision changes and rejects changed native inputs',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'cryptex-ota-fingerprint-'));const root=join(dir,'mobile');mkdirSync(root);
 const req=createRequire(require.resolve('../node_modules/expo-updates/package.json'));const {createFingerprintAsync}=req('expo/fingerprint');
 const {symlinkSync}=await import('node:fs');
 try{
  symlinkSync(new URL('../node_modules',import.meta.url).pathname,join(root,'node_modules'),'dir');
  writeFileSync(join(root,'package.json'),JSON.stringify({name:'ota-native-regression',version:'1.0.0',dependencies:{expo:'57.0.17'}}));
  const app=revision=>JSON.stringify({expo:{name:'Fixture',slug:'fixture',version:'1.0.0',android:{package:'test.ota.fixture'},extra:{revision,configHash:revision}}});
  writeFileSync(join(root,'app.json'),app('first'));writeFileSync(join(root,'App.js'),'export default "first";');
  for(const name of ['plugins','modules/cryptex-android-credentials/android','config','fdroid','android/app/src/main/assets'])mkdirSync(join(root,name),{recursive:true});mkdirSync(join(dir,'patches'));
  writeFileSync(join(root,'fdroid/toolchain.json'),'{"compileSdk":"36"}');
  writeFileSync(join(root,'fdroid/dependencies.gradle'),'native-version-1');
  writeFileSync(join(root,'fdroid/verification-metadata.xml'),'<verification-metadata>first</verification-metadata>');
  const kotlin=join(root,'modules/cryptex-android-credentials/android/Fixture.kt');const plugin=join(root,'plugins/fixture.js');const patch=join(dir,'patches/fixture.patch');const asset=join(root,'android/app/src/main/assets/cryptex-release.json');
  writeFileSync(kotlin,'class Fixture {}');writeFileSync(plugin,'module.exports = {}');writeFileSync(patch,'native-first');writeFileSync(asset,'{"revision":"first"}');
  writeFileSync(join(root,'config/ota.cjs'),'module.exports = {}');writeFileSync(join(root,'eas-project.json'),JSON.stringify(base));writeFileSync(join(root,'fingerprint.config.js'),readFileSync(new URL('../fingerprint.config.js',import.meta.url)));
  const fp=()=>createFingerprintAsync(root,{platforms:['android'],silent:true});
  const a=await fp();
  for(const cache of ['build/intermediates','.cxx/Release','.gradle']){
   const generated=join(root,'modules/cryptex-android-credentials/android',cache);mkdirSync(generated,{recursive:true});writeFileSync(join(generated,'generated.bin'),'generated compile output');
  }
  assert.equal((await fp()).hash,a.hash,'Generated build/CMake/Gradle outputs inside custom native sources must not alter runtime');
  writeFileSync(join(root,'App.js'),'export default "changed JS";');writeFileSync(join(root,'app.json'),app('second'));writeFileSync(asset,'{"revision":"second"}');const b=await fp();assert.equal(a.hash,b.hash,'JS/update revision must not require a new native binary');
  writeFileSync(kotlin,'class Fixture {fun changed() = true}');const c=await fp();assert.notEqual(c.hash,b.hash,'Kotlin must change runtime');
  writeFileSync(plugin,'module.exports = {newNativeFlag:true}');const d=await fp();assert.notEqual(d.hash,c.hash,'Plugin must change runtime');
  writeFileSync(patch,'native-second');const e=await fp();assert.notEqual(e.hash,d.hash,'Native dependency patch must change runtime');
  writeFileSync(join(root,'fdroid/toolchain.json'),'{"compileSdk":"37"}');const f=await fp();assert.notEqual(f.hash,e.hash,'Native toolchain must change runtime');
  writeFileSync(join(root,'fdroid/dependencies.gradle'),'native-version-2');const g=await fp();assert.notEqual(g.hash,f.hash,'Native dependency policy must change runtime');
  writeFileSync(join(root,'fdroid/verification-metadata.xml'),'<verification-metadata>reviewed-second</verification-metadata>');const h=await fp();assert.notEqual(h.hash,g.hash,'Approved native dependency checksums must change runtime');
 }finally{rmSync(dir,{recursive:true,force:true});}
});

test('remapped or partial channels cannot publish into the other profile',()=>{
 const data={currentPage:{name:'production',branchMapping:JSON.stringify({version:0,data:[{branchId:'prod',branchMappingLogic:'true'}]}),updateBranches:[{id:'prod',name:'production'}]}};
 assertRemoteChannel(data,'production');data.currentPage.updateBranches[0].name='preprod';assert.throws(()=>assertRemoteChannel(data,'production'),/different/);
});
test('reserved environment inspection fails closed on unrecognized CLI output',()=>{
 assert.deepEqual(parseRemoteVariables('Environment: production\nNo variables found for this environment.\n'),[]);
 assert.deepEqual(parseRemoteVariables('Environment: preview\nEXPO_PUBLIC_APP_URL=https://example.test\n'),[{name:'EXPO_PUBLIC_APP_URL',value:'https://example.test'}]);
 assert.throws(()=>parseRemoteVariables('Unexpected output with secret value'),e=>/Unrecognized/.test(e.message)&&!e.message.includes('secret value'));
});

test('validated public configuration is snapshotted before any remote or staging step',()=>fixture(({project,publicConfig})=>{
 const options=parseOtaOptions(['publish','--config',publicConfig,'--message','snapshot','--dry-run']);const plan=createOtaPlan(options,{projectPath:project});
 writeFileSync(publicConfig,JSON.stringify({...config,EXPO_PUBLIC_APP_URL:'https://changed.test'}));
 assert.equal(plan.config.EXPO_PUBLIC_APP_URL,config.EXPO_PUBLIC_APP_URL);assert.equal(plan.env.EXPO_PUBLIC_APP_URL,plan.config.EXPO_PUBLIC_APP_URL);
}));

test('export resolves the installed SDK runtime and rejects malformed or changed fingerprints',()=>{
 const runtime={runtimeVersion:'a'.repeat(40),workflow:'managed'};
 const run=(binary,args,options)=>{assert.equal(binary,process.execPath);assert.deepEqual(args,['node_modules/expo-updates/cli/build/cli.js','runtimeversion:resolve','--platform','android']);assert.equal(options.cwd,'/reviewed-stage/mobile');return {status:0,stdout:JSON.stringify({...runtime,fingerprintSources:[]})};};
 assert.deepEqual(resolveExportRuntime('/reviewed-stage/mobile',{},run),runtime);
 assert.throws(()=>resolveExportRuntime('/stage',{},()=>({status:0,stdout:JSON.stringify({...runtime,runtimeVersion:'file:fingerprint'})})),/Missing native/);
 assert.throws(()=>resolveExportRuntime('/stage',{},()=>({status:1,stdout:''})),/resolution failed/);
 assertExportRuntimeUnchanged(runtime,{...runtime});
 assert.throws(()=>assertExportRuntimeUnchanged(runtime,{...runtime,runtimeVersion:'b'.repeat(40)}),/changed during export/);
 assert.throws(()=>assertExportRuntimeUnchanged(runtime,{...runtime,workflow:'generic'}),/changed during export/);
});

test('approved public OTA certificates enter source staging while private PEM files remain ignored',()=>{
 const dir=mkdtempSync(join(tmpdir(),'cryptex-ota-public-certificate-'));
 try{
  mkdirSync(join(dir,'mobile/config/ota-certificates'),{recursive:true});
  writeFileSync(join(dir,'.gitignore'),readFileSync(new URL('../../.gitignore',import.meta.url)));
  writeFileSync(join(dir,'mobile/.gitignore'),readFileSync(new URL('../.gitignore',import.meta.url)));
  for(const name of ['production.pem','preprod.pem','private-key.pem'])writeFileSync(join(dir,'mobile/config/ota-certificates',name),'fixture');
  writeFileSync(join(dir,'private-key.pem'),'fixture');
  execFileSync('git',['init','-q'],{cwd:dir});
  const staged=execFileSync('git',['ls-files','--others','--exclude-standard'],{cwd:dir,encoding:'utf8'}).split('\n');
  assert.ok(staged.includes('mobile/config/ota-certificates/production.pem'));
  assert.ok(staged.includes('mobile/config/ota-certificates/preprod.pem'));
  assert.ok(!staged.includes('mobile/config/ota-certificates/private-key.pem'));
  assert.ok(!staged.includes('private-key.pem'));
 }finally{rmSync(dir,{recursive:true,force:true});}
});
