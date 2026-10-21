import {afterEach,beforeEach,describe,expect,it,jest} from '@jest/globals';
import {createElement,type ReactNode} from 'react';
import {act,create,type ReactTestRenderer} from 'react-test-renderer';
import {Provider} from 'jotai';
import {ok} from 'neverthrow';
import {Vault,VaultCredential} from '@cryptex-industries/vault-core/vault-utils/vault';
import {ImportExportScreen} from '../app/(app)/settings/import-export/index';
import {RecoveryKitDialog} from '@/components/account/recovery-kit-dialog';
import {vaultStore,unlockedVaultAtom,unlockedVaultMetadataAtom} from '@/utils/atoms';
import {clearVaultDEKFromSession,getVaultDEKFromSession,setVaultDEKInSession} from '@/utils/vault-session';
import {lockUnlockedVault,vaultLockStateAtom} from '@/utils/vault-lock';

const mockFiles=new Map<string,string>();
const mockShared:Array<{contents:string|undefined,locking:string,hasDEK:boolean}>=[];
const mockNative={available:async()=>true, mkdir:async()=>{}};
jest.mock('react-native',()=>({View:'View'}));
jest.mock('expo-router',()=>({router:{back:jest.fn(),push:jest.fn()},useLocalSearchParams:()=>({})}));
jest.mock('lucide-react-native',()=>({Archive:'Archive',Download:'Download',FileJson:'FileJson'}));
jest.mock('expo-document-picker',()=>({getDocumentAsync:jest.fn()}));
jest.mock('expo-file-system/legacy',()=>({cacheDirectory:'file:///cache/',EncodingType:{UTF8:'utf8',Base64:'base64'},
 makeDirectoryAsync:()=>mockNative.mkdir(),writeAsStringAsync:async(path:string,text:string)=>{mockFiles.set(path,text);},
 deleteAsync:async(path:string)=>{for(const file of mockFiles.keys())if(file.startsWith(path))mockFiles.delete(file);}}));
jest.mock('expo-sharing',()=>({isAvailableAsync:()=>mockNative.available(),shareAsync:async(path:string)=>{
 const {vaultStore}=require('@/utils/atoms');const {vaultLockStateAtom}=require('@/utils/vault-lock');
 const {getVaultDEKFromSession}=require('@/utils/vault-session');
 mockShared.push({contents:mockFiles.get(path),locking:vaultStore.get(vaultLockStateAtom),hasDEK:getVaultDEKFromSession().isOk()});
}}));
jest.mock('@/components/unlocked/unlocked-ui',()=>({UnlockedDialogTitle:'DialogTitle',UnlockedMenuRow:'MenuRow',UnlockedButton:'Button',UnlockedCheckbox:'Checkbox',UnlockedInput:'Input',UnlockedLabel:'Label',UnlockedTaskScreen:'TaskScreen',UnlockedText:'Text'}));
jest.mock('@/components/ui/dialog',()=>({Dialog:({open,children}:{open:boolean,children:ReactNode})=>open?createElement('Dialog',{},children):null,DialogFooter:'DialogFooter',DialogHeader:'DialogHeader'}));
jest.mock('@/components/inline-notice',()=>({InlineNotice:'Notice'}));
jest.mock('@/components/vault-import/import-wizard',()=>({ImportWizard:'ImportWizard'}));
jest.mock('@/components/vault-security/additional-key-protection-options',()=>({isProtectionPhraseKind:()=>false}));
jest.mock('@/app_lib/vault-utils/storage',()=>({serializeVault:jest.fn()}));
jest.mock('@/utils/mobile-import-picker',()=>({readPickedImportFile:jest.fn()}));
jest.mock('@/utils/android-credentials',()=>({androidCredentials:{available:false,clearProviderCredentials:jest.fn()}}));
jest.mock('@/utils/auto-lock-settings',()=>({getCachedAutoLockMinutes:()=>0}));
jest.mock('@/app_lib/auth-session',()=>({logoutOnlineServicesSession:async()=>{}}));
jest.mock('@/app_lib/managed-backup-hooks',()=>({flushManagedBackupBeforeLock:async()=>{},stopManagedBackup:()=>{}}));
jest.mock('@/utils/active-sync-controllers',()=>({teardownActiveSyncControllers:()=>{}}));
jest.mock('@/utils/logging',()=>({vaultLog:{error:jest.fn()},vaultLogger:{clearAll:jest.fn()}}));
let renderer:ReactTestRenderer|undefined;
let metadata:any;
const settle=async()=>{await act(async()=>{await new Promise(r=>setTimeout(r,5));});};
function held<T>(){let resolve!:(v:T)=>void;const promise=new Promise<T>(r=>resolve=r);return {promise,resolve};}
async function render(element:any){await act(async()=>{renderer=create(createElement(Provider,{store:vaultStore},element));});}
const button=(text:string)=>renderer!.root.findAllByType('Button' as never).find(n=>n.props.children===text)!;
function lock(){return lockUnlockedVault({unlockedVaultMetadata:metadata,setUnlockedVault:(v:any)=>{if(typeof v!=='function')vaultStore.set(unlockedVaultAtom,v);},setUnlockedVaultMetadata:(m:any)=>vaultStore.set(unlockedVaultMetadataAtom,m)});}
beforeEach(()=>{
 (globalThis as any).IS_REACT_ACT_ENVIRONMENT=true;mockFiles.clear();mockShared.length=0;mockNative.available=async()=>true;mockNative.mkdir=async()=>{};
 clearVaultDEKFromSession();setVaultDEKInSession({type:'secret'} as CryptoKey);vaultStore.set(vaultLockStateAtom,'idle');
 const vault=new Vault();vault.Credentials=[Object.assign(new VaultCredential(),{ID:'test',Name:'sentinel',Password:'test-login-password'})];
 metadata={Blob:{},save:async()=>{},decryptVault:async()=>ok(vault)};vaultStore.set(unlockedVaultAtom,vault);vaultStore.set(unlockedVaultMetadataAtom,metadata);
});
afterEach(async()=>{await act(async()=>renderer?.unmount());renderer=undefined;clearVaultDEKFromSession();});

async function exportPlainJson(){
 await render(createElement(ImportExportScreen,{view:'plain'}));
 await act(async()=>renderer!.root.findByType('Input' as never).props.onChangeText('master-password'));
 await act(async()=>renderer!.root.findByType('Checkbox' as never).props.onCheckedChange(true));
 await act(async()=>button('Review export').props.onPress());
 await act(async()=>button('Export JSON').props.onPress());await settle();
}
const phrase='abandon ability able about above absent absorb abstract absurd abuse access accident account accuse achieve acid acoustic acquire across act action actor actress actual';

describe('secret exports stop when a lock starts', () => {
it('cleartext JSON export never reaches sharing once a manual lock starts, even while its save is pending',async()=>{
 const availability=held<boolean>();let entered=false;mockNative.available=()=>{entered=true;return availability.promise;};
 await exportPlainJson();expect(entered).toBe(true);
 const save=held<void>();metadata.save=()=>save.promise;
 let locking!:ReturnType<typeof lock>;await act(async()=>{locking=lock();});await settle();
 expect(vaultStore.get(vaultLockStateAtom)).toBe('locking');
 await act(async()=>availability.resolve(true));await settle();
 expect(mockShared).toEqual([]);expect(mockFiles.size).toBe(0);
 save.resolve();await act(async()=>{await locking;});
});
it('encrypted export never reaches sharing once a manual lock starts',async()=>{
 const {serializeVault}=jest.requireMock('@/app_lib/vault-utils/storage') as {serializeVault:jest.Mock};
 const serialized=held<Uint8Array>();serializeVault.mockImplementation(()=>serialized.promise);
 await render(createElement(ImportExportScreen,{view:'root'}));
 await act(async()=>renderer!.root.findAllByType('MenuRow' as never).find(n=>/ncrypted/.test(String(n.props.title??n.props.label??'')))?.props.onPress?.());
 const exportButton=button('Export encrypted vault');
 await act(async()=>exportButton.props.onPress());await settle();
 expect(serializeVault).toHaveBeenCalled();
 const save=held<void>();metadata.save=()=>save.promise;
 let locking!:ReturnType<typeof lock>;await act(async()=>{locking=lock();});await settle();
 await act(async()=>serialized.resolve(new Uint8Array([1,2,3])));await settle();
 expect(mockShared).toEqual([]);expect(mockFiles.size).toBe(0);
 save.resolve();await act(async()=>{await locking;});
});
it('cleartext JSON export still shares while the session lasts',async()=>{
 await exportPlainJson();
 expect(mockShared).toEqual([{contents:expect.stringContaining('test-login-password'),locking:'idle',hasDEK:true}]);
 expect(mockFiles.size).toBe(0);
});
it('Recovery Kit is neither written nor shared after the screen unmounts and the vault locks',async()=>{
 const directory=held<void>();let entered=false;mockNative.mkdir=()=>{entered=true;return directory.promise;};
 await render(createElement(RecoveryKitDialog,{open:true,kit:{userId:'user-id',recoveryPhrase:phrase},onComplete:()=>{}}));
 await act(async()=>button('Save printable kit').props.onPress());await settle();expect(entered).toBe(true);
 await act(async()=>renderer!.unmount());renderer=undefined;
 await lock();expect(getVaultDEKFromSession().isErr()).toBe(true);
 await act(async()=>directory.resolve());await settle();
 expect(mockShared).toEqual([]);expect(mockFiles.size).toBe(0);
});
it('Recovery Kit is not shared when a lock starts while sharing is checked, even if the vault unlocks again',async()=>{
 const availability=held<boolean>();mockNative.available=()=>availability.promise;
 await render(createElement(RecoveryKitDialog,{open:true,kit:{userId:'user-id',recoveryPhrase:phrase},onComplete:()=>{}}));
 await act(async()=>button('Save printable kit').props.onPress());await settle();
 await lock();setVaultDEKInSession({type:'secret'} as CryptoKey);
 await act(async()=>availability.resolve(true));await settle();
 expect(mockShared).toEqual([]);expect(mockFiles.size).toBe(0);
});
});
