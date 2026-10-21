import {afterEach,describe,expect,it,jest} from '@jest/globals';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {createElement,type ReactNode} from 'react';
import {act,create,type ReactTestRenderer} from 'react-test-renderer';
import {Provider} from 'jotai';
import {Vault,VaultCredential} from '@cryptex-industries/vault-core/vault-utils/vault';
import {ItemType} from '@cryptex-industries/vault-core/proto';
import {generateAgentIdentity,identityPeer} from '@cryptex-industries/vault-core/agent/envelope';
import {uint8ToBase64Url} from '@cryptex-industries/vault-core/encoding';
import ConnectAgentScreen from '../app/(app)/devices/connect-agent';
import {agentRuntime,syncAgentCache} from '@/agent/agent-app';
import {vaultStore,unlockedVaultAtom,unlockedVaultMetadataAtom} from '@/utils/atoms';
const mockStorage={cache:[] as any[],local:[] as any[],saveCache:async(_next:any[])=>{},readCache:async()=>{},readLocal:async()=>{},saveVault:async()=>{}};
const mockAccepted=async()=>({confirmationCode:'12345678',revocationSeed:new Uint8Array(32).fill(4),keysRevision:1});
const mockUnregistered:string[]=[];
const mockPort={start(){},stop(){},refresh(){},async claim(){return mockClaim;},accept:mockAccepted,async waitConfirmed(){await mockConfirm.promise;},async answer(){},async sendKeys(){},async unregister(agentId:string){mockUnregistered.push(agentId);},async cancelPairing(agentId:string){await mockPort.unregister(agentId);}};
let mockIdentity:any;let mockClaim:any;
let mockConfirm:{promise:Promise<void>,resolve:()=>void}={promise:Promise.resolve(),resolve:()=>{}};
const mockSnackbar=jest.fn();const mockReplace=jest.fn();
jest.mock('react-native',()=>({ActivityIndicator:'ActivityIndicator',View:'View',Platform:{OS:'android',constants:{}},AppState:{currentState:'active'}}));
jest.mock('expo-router',()=>({router:{replace:(v:any)=>mockReplace(v),back:jest.fn(),push:jest.fn()}}));
jest.mock('expo-router/react-navigation',()=>({useIsFocused:()=>true}));
jest.mock('expo-camera',()=>({CameraView:'CameraView',useCameraPermissions:()=>[{granted:true},jest.fn()]}));
jest.mock('lucide-react-native',()=>({QrCode:'QrCode'}));
jest.mock('@/components/unlocked/unlocked-ui',()=>({UnlockedButton:'Button',UnlockedInput:'Input',UnlockedLabel:'Label',UnlockedTaskScreen:({children,footer}:any)=>createElement('TaskScreen',{},children,footer),UnlockedText:'Text'}));
jest.mock('@/components/unlocked/unlocked-snackbar',()=>({useUnlockedSnackbar:()=>mockSnackbar}));
jest.mock('@/components/invitation-header',()=>({InvitationHeader:'InvitationHeader'}));
jest.mock('@/components/inline-notice',()=>({InlineNotice:'Notice'}));
jest.mock('@/components/agents/agent-rows',()=>({AgentSectionLabel:'AgentSectionLabel',InfoCard:'InfoCard',KeyPicker:'KeyPicker'}));
jest.mock('@/components/ui/dialog',()=>({Dialog:({open,children}:{open:boolean,children:ReactNode})=>open?createElement('Dialog',{},children):null,DialogHeader:'DialogHeader',DialogTitle:'DialogTitle'}));
jest.mock('@/agent/agent-storage',()=>({loadApproverIdentity:async()=>mockIdentity,loadAgentCache:async()=>{await mockStorage.readCache();return mockStorage.cache;},saveAgentCache:async(next:any[])=>{await mockStorage.saveCache(next);mockStorage.cache=next;},loadCustomRelays:async()=>[],saveCustomRelay:async()=>{},loadRelayPass:async()=>null,saveRelayPass:async()=>{},localApprovals:{load:async()=>{await mockStorage.readLocal();return mockStorage.local;},save:async(v:any[])=>{mockStorage.local=v;}}}));
jest.mock('@cryptex-industries/vault-core/agent/runtime',()=>{const actual=jest.requireActual('@cryptex-industries/vault-core/agent/runtime') as any;return {...actual,AgentRuntime:class extends actual.AgentRuntime{constructor(deps:any){super({...deps,createApprover:()=>mockPort});}}};});
jest.mock('@/agent/agent-service',()=>({requestNotificationPermission:async()=>true,agentService:{deviceName:()=> 'Android phone',isRunning:()=>false,start:()=>{},stop:()=>{}}}));
jest.mock('@/utils/vault-lock',()=>({vaultLockStateAtom:require('jotai').atom('idle')}));
jest.mock('@/utils/vault-session',()=>({getVaultSessionGeneration:()=>1,saveVaultWithSessionDEK:async(metadata:any,vault:any)=>{await metadata.save(vault);return require('neverthrow').ok(undefined);}}));
jest.mock('@/utils/session-timeout',()=>({isAutoLockDue:()=>false}));
jest.mock('@/app_lib/managed-backup-hooks',()=>({markManagedBackupDirty:()=>{}}));
jest.mock('@/env',()=>({env:{RELAY_URL:'https://relay.example'}}));
jest.mock('@/utils/trpc',()=>({trpc:{}}));
jest.mock('@/app_lib/share-links',()=>({hasOnlineServicesSession:()=>false}));
jest.mock('@/utils/logging',()=>({vaultLog:{info:jest.fn(),warn:jest.fn(),error:jest.fn()}}));
let renderer:ReactTestRenderer|undefined;
const settle=async()=>{await act(async()=>{await new Promise(r=>setTimeout(r,10));});};
const testId=(id:string)=>renderer!.root.findAll(n=>typeof n.type==='string' && n.props.testID===id)[0];
function held<T>(){let resolve!:(v:T)=>void;const promise=new Promise<T>(r=>resolve=r);return {promise,resolve};}
async function setup(){
 (globalThis as any).IS_REACT_ACT_ENVIRONMENT=true;
 mockSnackbar.mockClear();mockReplace.mockClear();mockPort.accept=mockAccepted;mockUnregistered.length=0;mockConfirm={promise:Promise.resolve(),resolve:()=>{}};mockStorage.cache=[];mockStorage.local=[];mockStorage.saveCache=async()=>{};mockStorage.readCache=async()=>{};mockStorage.readLocal=async()=>{};mockStorage.saveVault=async()=>{};
 mockIdentity=generateAgentIdentity();const peer=identityPeer(generateAgentIdentity());
 mockClaim={agentId:uint8ToBase64Url(peer.signPublicKey),offer:{...peer,hostname:'machine',os:'linux',arch:'amd64',agentVersion:'1.0'},relay:{kind:'hosted',url:'https://relay.example'}};
 const fixture=(name:string)=>readFileSync(resolve(__dirname,'../../packages/vault-core/src/tests/fixtures/ssh',name),'utf8');
 const vault=new Vault();vault.Credentials=[Object.assign(new VaultCredential(),{ID:'ssh',Type:ItemType.SSHKey,Name:'Work key',SSHKey:{PrivateKey:fixture('ed25519.key'),PublicKey:fixture('ed25519.key.pub'),Comment:'test'}})];
 vaultStore.set(unlockedVaultAtom,vault);vaultStore.set(unlockedVaultMetadataAtom,{save:async()=>{await mockStorage.saveVault();}} as any);
 await act(async()=>{renderer=create(createElement(Provider,{store:vaultStore},createElement(ConnectAgentScreen)));});await settle();
 await act(async()=>renderer!.root.findByType('CameraView' as never).props.onBarcodeScanned({data:'cryptex-pair:code'}));await settle();
 await expect(agentRuntime.claim('diagnostic-code')).resolves.toEqual(mockClaim);
 expect(mockSnackbar.mock.calls).toEqual([]);
 expect(testId('agent-submit')).toBeDefined();
}
afterEach(async()=>{await act(async()=>renderer?.unmount());renderer=undefined;});
const button=(text:string)=>renderer!.root.findAllByType('Button' as never).find(n=>n.props.children===text);

describe('pairing finishes only once this phone serves the agent', () => {
it('offers a retry when the agent cache write fails, and finishes once it succeeds',async()=>{
 await setup();mockStorage.saveCache=async()=>{throw new Error('storage write failed');};
 await act(async()=>testId('agent-submit').props.onPress());await settle();
 expect(vaultStore.get(unlockedVaultAtom).ConnectedAgents).toHaveLength(1);
 expect(mockSnackbar).not.toHaveBeenCalledWith('Connected');expect(mockReplace).not.toHaveBeenCalled();
 expect(testId('agent-sync-retry')).toBeDefined();
 mockStorage.saveCache=async()=>{};
 await act(async()=>testId('agent-sync-retry').props.onPress());await settle();
 expect(mockSnackbar).toHaveBeenCalledWith('Connected');
 expect(mockReplace).toHaveBeenCalledWith({pathname:'/(app)/devices/agents/[id]',params:{id:mockClaim.agentId}});
 expect((agentRuntime as any).served()).toHaveLength(1);
});
it('offers a retry when the runtime reload fails after the cache was written',async()=>{
 await setup();
 let failReads=true;mockStorage.readLocal=async()=>{if(failReads)throw new Error('SecureStore temporarily unavailable');};
 // accept() reads the local approvals too; fail only once the vault save starts.
 failReads=false;mockStorage.saveVault=async()=>{failReads=true;};
 await act(async()=>testId('agent-submit').props.onPress());await settle();
 expect(mockStorage.cache).toHaveLength(1);
 expect(mockSnackbar).not.toHaveBeenCalledWith('Connected');expect(testId('agent-sync-retry')).toBeDefined();
 // The cache already matches the vault; the retry must still reload.
 failReads=false;
 await act(async()=>testId('agent-sync-retry').props.onPress());await settle();
 expect(mockSnackbar).toHaveBeenCalledWith('Connected');expect((agentRuntime as any).served()).toHaveLength(1);
});
it('syncAgentCache retries a reload that failed after the cache was written',async()=>{
 await setup();
 const {grantedKeyInputs,sshKeyItems,connectedAgentFromPairing}=await import('@cryptex-industries/vault-core/agent/vault-agents');
 await agentRuntime.accept(mockClaim,{agentName:'machine',keys:grantedKeyInputs(sshKeyItems(vaultStore.get(unlockedVaultAtom)))});
 const record=await connectedAgentFromPairing({claim:mockClaim,result:await mockPort.accept(),agentName:'machine',credentialIds:['ssh'],identity:mockIdentity,approverName:'Android phone'});
 await act(async()=>vaultStore.set(unlockedVaultAtom,Object.assign(new Vault(),vaultStore.get(unlockedVaultAtom),{ConnectedAgents:[record]})));
 mockStorage.readLocal=async()=>{throw new Error('SecureStore temporarily unavailable');};
 await expect(syncAgentCache()).rejects.toThrow('SecureStore temporarily unavailable');expect(mockStorage.cache).toHaveLength(1);
 mockStorage.readLocal=async()=>{};await syncAgentCache();
 expect((agentRuntime as any).served()).toHaveLength(1);
});
it('waits for the agent cache before showing Connected',async()=>{
 await setup();const save=held<void>();let entered=false;mockStorage.saveCache=()=>{entered=true;return save.promise;};
 await act(async()=>testId('agent-submit').props.onPress());await settle();expect(entered).toBe(true);
 expect(mockReplace).not.toHaveBeenCalled();expect(mockSnackbar).not.toHaveBeenCalledWith('Connected');
 save.resolve();await settle();expect(mockReplace).toHaveBeenCalled();expect((agentRuntime as any).served()).toHaveLength(1);
});
it('turns Cancel off once the vault save starts',async()=>{
 await setup();const save=held<void>();let entered=false;mockStorage.saveVault=()=>{entered=true;return save.promise;};
 await act(async()=>testId('agent-submit').props.onPress());await settle();expect(entered).toBe(true);
 const cancel=button('Cancel')!;
 expect(cancel.props.loading).toBe(true);expect(cancel.props.loadingLabel).toBe('Saving…');
 await act(async()=>cancel.props.onPress());await settle();
 save.resolve();await settle();
 expect(vaultStore.get(unlockedVaultAtom).ConnectedAgents).toHaveLength(1);
 expect(mockSnackbar).toHaveBeenCalledWith('Connected');
});
it('saves nothing when Cancel comes before the agent confirms',async()=>{
 await setup();mockConfirm=held<void>() as any;
 await act(async()=>testId('agent-submit').props.onPress());await settle();
 const cancel=button('Cancel')!;expect(cancel.props.loading).toBe(false);
 await act(async()=>cancel.props.onPress());await settle();
 await act(async()=>renderer!.unmount());renderer=undefined;
 mockConfirm.resolve();await settle();
 expect(vaultStore.get(unlockedVaultAtom).ConnectedAgents ?? []).toHaveLength(0);
 expect(mockSnackbar).not.toHaveBeenCalledWith('Connected');
});
});

async function paired(){
 await setup();await act(async()=>testId('agent-submit').props.onPress());await settle();
 expect((agentRuntime as any).served()).toHaveLength(1);
 return vaultStore.get(unlockedVaultAtom).ConnectedAgents[0];
}

describe('agent cache syncs never install an older vault', () => {
it('a sync that started before Pause neither writes nor reloads the unpaused agent',async()=>{
 const record=await paired();
 const {changeAgent}=require('@/agent/agent-vault');
 const {setAgentPaused}=require('@cryptex-industries/vault-core/agent/agent-actions');
 await changeAgent(record.ID,{Name:'renamed'});
 const firstRead=held<void>();const nextRead=held<void>();let reads=0;
 mockStorage.readCache=async()=>{reads++;if(reads===1)await firstRead.promise;if(reads===3)await nextRead.promise;};
 const syncing=syncAgentCache();await settle();expect(reads).toBe(1);
 await setAgentPaused(record.ID,true,{changeAgent,runtime:agentRuntime});
 expect(vaultStore.get(unlockedVaultAtom).ConnectedAgents[0].Paused).toBe(true);
 const pausedSync=syncAgentCache();firstRead.resolve();await syncing;await settle();
 // The older sync wrote the vault as it is now: renamed and paused.
 expect(mockStorage.cache).toEqual([expect.objectContaining({id:record.ID,name:'renamed',paused:true})]);
 expect((agentRuntime as any).agents.find((agent:any)=>agent.id===record.ID)?.paused).toBe(true);
 nextRead.resolve();await pausedSync;
 expect((agentRuntime as any).agents.find((agent:any)=>agent.id===record.ID)?.paused).toBe(true);
});
it('writes again when the vault changes while the cache is being written',async()=>{
 const record=await paired();
 const {changeAgent}=require('@/agent/agent-vault');
 await changeAgent(record.ID,{Name:'first'});
 const write=held<void>();let writes=0;
 mockStorage.saveCache=async()=>{writes++;if(writes===1)await write.promise;};
 const syncing=syncAgentCache();await settle();expect(writes).toBe(1);
 await changeAgent(record.ID,{Paused:true});
 write.resolve();await syncing;
 expect(writes).toBe(2);
 expect(mockStorage.cache).toEqual([expect.objectContaining({id:record.ID,name:'first',paused:true})]);
 expect((agentRuntime as any).agents.find((agent:any)=>agent.id===record.ID)?.paused).toBe(true);
});
});

describe('Back on the offer ends that Connect', () => {
it('saves nothing and removes the late relay registration',async()=>{
 await setup();const accepted=held<void>();let entered=false;
 mockPort.accept=async()=>{entered=true;await accepted.promise;return mockAccepted();};
 await act(async()=>testId('agent-submit').props.onPress());await settle();expect(entered).toBe(true);
 const {UnlockedTaskScreen}=jest.requireMock('@/components/unlocked/unlocked-ui') as any;
 await act(async()=>renderer!.root.findByType(UnlockedTaskScreen).props.onBack());await settle();
 expect(renderer!.root.findAllByType('CameraView' as never)).toHaveLength(1);
 accepted.resolve();await settle();await settle();
 expect(vaultStore.get(unlockedVaultAtom).ConnectedAgents ?? []).toHaveLength(0);
 expect(mockSnackbar).not.toHaveBeenCalledWith('Connected');
 expect(mockReplace).not.toHaveBeenCalled();
 expect(mockUnregistered).toEqual([mockClaim.agentId]);
 // Still on the scanner, ready for the next code.
 expect(renderer!.root.findAllByType('CameraView' as never)).toHaveLength(1);
});
});

it('keeps an agent registered when the screen goes away during a save that succeeds',async()=>{
 await setup();const save=held<void>();let entered=false;
 mockStorage.saveVault=()=>{entered=true;return save.promise};
 await act(async()=>testId('agent-submit').props.onPress());await settle();expect(entered).toBe(true);expect(button('Cancel')!.props.loading).toBe(true);
 await act(async()=>renderer!.unmount());renderer=undefined;await settle();
 save.resolve();await settle();await settle();
 expect(vaultStore.get(unlockedVaultAtom).ConnectedAgents).toHaveLength(1);expect(mockUnregistered).toEqual([]);
});

it('keeps a saved agent registered after Close when the cache write failed',async()=>{
 await setup();mockStorage.saveCache=async()=>{throw new Error('SecureStore cache write failed')};
 await act(async()=>testId('agent-submit').props.onPress());await settle();
 expect(vaultStore.get(unlockedVaultAtom).ConnectedAgents).toHaveLength(1);expect(testId('agent-sync-retry')).toBeDefined();expect(button('Close')).toBeDefined();
 await act(async()=>button('Close')!.props.onPress());
 // router.back removes the screen in the app; the router is mocked here.
 await act(async()=>renderer!.unmount());renderer=undefined;await settle();await settle();
 expect(mockUnregistered).toEqual([]);
});
