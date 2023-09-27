import React, { Fragment, Suspense, useEffect, useRef, useState } from "react";
import { GetStaticProps } from "next";
import { SessionProvider, signOut, useSession } from "next-auth/react";
import { useRouter } from "next/router";

import { toast } from "react-toastify";
import { Controller, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useLiveQuery } from "dexie-react-hooks";
import { Disclosure, Menu, Popover, Transition } from "@headlessui/react";
import clsx from "clsx";
import { atom, useAtom, useAtomValue, useSetAtom } from "jotai";
import { selectAtom } from "jotai/utils";
// import { focusAtom } from "jotai-optics";
import * as OTPAuth from "otpauth";
import { autoPlacement, shift, useFloating } from "@floating-ui/react-dom";
import { z } from "zod";
import type Pusher from "pusher-js";

import dayjs from "dayjs";
import RelativeTime from "dayjs/plugin/relativeTime";

import {
    EllipsisVerticalIcon,
    ChevronDownIcon,
    FunnelIcon,
    Bars3Icon,
    XMarkIcon,
    ClipboardDocumentIcon,
    ArrowTopRightOnSquareIcon,
    LockClosedIcon,
    PlusCircleIcon,
    CheckCircleIcon,
    ArrowUpCircleIcon,
    ExclamationTriangleIcon,
    CameraIcon,
    SpeakerWaveIcon,
    DocumentTextIcon,
    ClockIcon,
    DevicePhoneMobileIcon,
    ArrowPathIcon,
    CloudArrowUpIcon,
    KeyIcon,
    WifiIcon,
    LinkIcon,
    Cog8ToothIcon,
    ShareIcon,
    HandThumbUpIcon,
    ArrowUturnUpIcon,
    CalendarIcon,
    XCircleIcon,
    ChevronUpIcon,
    InformationCircleIcon,
    ExclamationCircleIcon,
    TableCellsIcon,
} from "@heroicons/react/20/solid";

import { Turnstile } from "@marsidev/react-turnstile";

import { trpc } from "../../utils/trpc";
import { TRPCClientError } from "@trpc/client";
import { HTMLHeaderPWA } from "../../components/html_header";
import HTMLMain from "../../components/html_main";
import NotificationContainer from "../../components/general/notificationContainer";
import { Body, Footer, GenericModal } from "../../components/general/modal";
import { ButtonFlat, ButtonType } from "../../components/general/buttons";
import {
    SignUpFormSchemaType,
    constructSyncChannelName,
    cryptexAccountInit,
    cryptexAccountSignIn,
    generateKeyPair,
    navigateToCheckout,
    newWSPusherInstance,
    newWebRTCConnection,
} from "../../app_lib/online_services_utils";
import { signUpFormSchema } from "../../app_lib/online_services_utils";
import {
    Backup,
    Credential,
    type GroupSchemaType,
    LinkedDevice,
    NewVaultFormSchemaType,
    OnlineServicesAccount,
    OnlineServicesAccountInterface,
    Synchronization,
    Vault,
    VaultEncryption,
    VaultMetadata,
    VaultRestoreFormSchema,
    VaultStorage,
    newVaultFormSchema,
    vaultRestoreFormSchema,
    Import,
} from "../../app_lib/vault_utils";
import {
    TOTPAlgorithm,
    EncryptionAlgorithm,
    KeyDerivationFunction,
} from "../../app_lib/proto/vault";
import NavBar from "../../components/navbar";
import {
    WarningDialog,
    WarningDialogShowFn,
} from "../../components/dialog/warning";
import { AccordionItem } from "../../components/general/accordion";
import { GetSubscriptionOutputSchemaType } from "../../schemes/payment_router";
import Spinner from "../../components/general/spinner";
import { env } from "../../env/client.mjs";
import dynamic from "next/dynamic";
import QrReader from "../../components/general/qrScanner";
import { CredentialsGeneratorDialog } from "../../components/dialog/credentialsGenerator";
import {
    FormInputField,
    FormSelectboxField,
    FormNumberInputField,
    FormTextAreaField,
    ClipboardButton,
} from "../../components/general/inputFields";
import {
    DivergenceSolveDialog,
    type DivergenceSolveShowDialogFnPropType,
} from "../../components/dialog/synchronization";
// import isEqual from "react-fast-compare";

dayjs.extend(RelativeTime);

const DIALOG_BLUR_TIME = 200;

const unlockedVaultMetadataAtom = atom<VaultMetadata | null>(null);
const unlockedVaultAtom = atom(new Vault());
const unlockedVaultWriteOnlyAtom = atom(
    null,
    async (get, set, val: (pre: Vault | null) => Promise<Vault | null>) => {
        const vault = await val(get(unlockedVaultAtom));
        set(unlockedVaultAtom, Object.assign(new Vault(), vault));
    }
);
const isVaultUnlockedAtom = selectAtom(
    unlockedVaultMetadataAtom,
    (vault) => vault !== null
);
const onlineServicesAccountAtom = selectAtom(
    unlockedVaultAtom,
    (vault) => vault?.OnlineServices
);
const webRTCConnectionsAtom = atom(new Synchronization.WebRTCConnections());

const unbindAccountFromVault = async (
    vaultMetadata: VaultMetadata,
    vault: Vault
) => {
    // Unbind the account
    vault.OnlineServices.unbindAccount();

    // Save the vault
    vaultMetadata.save(vault);

    signOut({ redirect: false });
};

// Function for opening the browsers file picker
const openFilePicker = async (inputRef: React.RefObject<HTMLInputElement>) => {
    // Clear the input field - this is done so that the user can select the same file again
    if (inputRef.current) inputRef.current.value = "";

    return new Promise<File>((resolve, reject) => {
        if (inputRef.current) {
            inputRef.current.onchange = () => {
                if (
                    inputRef.current?.files &&
                    inputRef.current?.files.length &&
                    inputRef.current?.files[0]
                ) {
                    resolve(inputRef.current.files[0]);
                } else {
                    reject("No file selected.");
                }
            };
            inputRef.current.click();
        } else {
            reject("File input not found.");
        }
    });
};

const readFile = async (file: File): Promise<string> =>
    new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => {
            if (reader.result) {
                resolve(reader.result as string);
            } else {
                reject("Failed to read file.");
            }
        };
        reader.readAsText(file);
    });

enum LinkMethod {
    QRCode = "QR Code",
    Sound = "Sound",
    File = "File",
}

type Options = {
    Name: string;
    onClick: () => void;
};

type VaultListItemProps = {
    vaultMetadata: VaultMetadata;
    onClick: (vaultMetadata: VaultMetadata) => void;
    showWarningDialogCallback: WarningDialogShowFn;
};
const VaultListItem: React.FC<VaultListItemProps> = ({
    vaultMetadata,
    onClick,
    showWarningDialogCallback,
}) => {
    const optionsButtonRef = useRef<HTMLButtonElement>(null);

    const unlockVault = () => {
        onClick(vaultMetadata);
    };

    const removeVault = () => {
        showWarningDialogCallback(
            "You are about to delete this vault, irreversibly. If you haven't made a backup, you will lose all your data from this vault - including access to the account bound inside this vault.",
            async () => {
                toast.info("Removing vault...", {
                    autoClose: false,
                    closeButton: false,
                    updateId: "removing-vault",
                    toastId: "removing-vault",
                });

                try {
                    await vaultMetadata.terminate();

                    toast.success("Vault removed.", {
                        autoClose: 3000,
                        closeButton: true,
                        updateId: "removing-vault",
                        toastId: "removing-vault",
                    });
                } catch (e) {
                    console.error("Error removing vault.", e);
                    toast.error("Error removing vault.", {
                        autoClose: 3000,
                        closeButton: true,
                        updateId: "removing-vault",
                        toastId: "removing-vault",
                    });
                }
            },
            null
        );
    };

    const options: Options[] = [
        {
            Name: "Unlock",
            onClick: unlockVault,
        },
        // {
        //     Name: "Edit",
        //     onClick: () => {
        //         // TODO: Edit vault
        //     },
        // },
        {
            Name: "Terminate",
            onClick: removeVault,
        },
    ];

    const vaultInitials: string = (function (name: string): string {
        if (!name) return "";

        const words = name.trim().split(" ");
        if (words && words.length > 1) {
            if (words[0] && words[0][0] && words[1] && words[1][0])
                return (words[0][0] + words[1][0]).toUpperCase();
        }
        return name.slice(0, 2).toUpperCase();
    })(vaultMetadata.Name);

    // Generate random hex color
    const randomColor: string = (function (): string {
        const letters = "0123456789ABCDEF";
        let color = "#";

        for (let i = 0; i < 6; i++) {
            color += letters[Math.floor(Math.random() * 16)];
        }

        return color;
    })();

    // If the vault item doesn't have a blob, don't render it
    if (!vaultMetadata.Blob) return null;

    // Extract the blob from the vault item
    const vaultBlob: VaultEncryption.EncryptedBlob = vaultMetadata.Blob;

    return (
        <div
            className="my-2 flex items-center justify-between rounded-lg bg-gray-800 p-4"
            onContextMenu={(e) => {
                e.preventDefault();
                optionsButtonRef.current?.click();
            }}
        >
            <div
                className="flex w-full cursor-pointer items-center"
                onClick={unlockVault}
            >
                <div
                    className="rounded-xl bg-gray-600 p-2 sm:rounded-2xl sm:p-4"
                    style={{
                        color: randomColor,
                    }}
                >
                    {/* <img
                        src={"/non-existant-image"}
                        alt={getInitials(item.Name)}
                        className="h-6 w-6"
                    /> */}
                    <p className="text-base">{vaultInitials}</p>
                </div>
                <div className="ml-4">
                    <p
                        className="line-clamp-2 text-sm font-semibold sm:text-lg"
                        title={vaultMetadata.Name}
                    >
                        {vaultMetadata.Name}
                    </p>
                    <p
                        className="line-clamp-3 text-sm text-gray-400"
                        title={vaultMetadata.Description}
                    >
                        {vaultMetadata.Description}
                    </p>
                    {vaultMetadata.LastUsed && (
                        <p className="text-xs text-gray-500">
                            Last change{" "}
                            {dayjs(vaultMetadata.LastUsed).fromNow()}
                        </p>
                    )}
                    {!vaultMetadata.LastUsed && (
                        <p className="text-xs text-gray-500">Never used</p>
                    )}
                </div>
            </div>
            <Menu as="div" className="relative">
                <Menu.Button ref={optionsButtonRef}>
                    <EllipsisVerticalIcon className="h-6 w-6 text-gray-400" />
                </Menu.Button>
                <Transition
                    as={React.Fragment}
                    enter="transition ease-out duration-100"
                    enterFrom="transform opacity-0 scale-95"
                    enterTo="transform opacity-100 scale-100"
                    leave="transition ease-in duration-75"
                    leaveFrom="transform opacity-100 scale-100"
                    leaveTo="transform opacity-0 scale-95"
                >
                    <Menu.Items className="absolute right-0 z-10 mt-2 w-48 origin-top-right divide-y divide-gray-100 rounded-md bg-gray-700 shadow-lg focus:outline-none">
                        <div className="py-1">
                            {options.map((option, index) => (
                                <Menu.Item
                                    key={`vault-${vaultBlob.HeaderIV}-${index}`}
                                >
                                    {({ active }) => {
                                        const hoverClass = clsx({
                                            "bg-gray-800 text-white": active,
                                            "flex px-4 py-2 text-sm font-semibold text-gray-200":
                                                true,
                                        });
                                        return (
                                            <a
                                                href="#"
                                                className={hoverClass}
                                                onClick={option.onClick}
                                            >
                                                {option.Name}
                                            </a>
                                        );
                                    }}
                                </Menu.Item>
                            ))}
                        </div>
                    </Menu.Items>
                </Transition>
            </Menu>
        </div>
    );
};

type ActionButton = {
    Name: string;
    Description: string;
    Icon: React.FC;
    onClick: () => void;
};

type VaultListPopoverProps = {
    actionButtons: ActionButton[];
};
const VaultListPopover: React.FC<VaultListPopoverProps> = ({
    actionButtons,
}) => {
    const { refs, floatingStyles } = useFloating({
        placement: "bottom-end",
        middleware: [shift()],
    });

    return (
        <Popover className="relative">
            {({ open }) => {
                const popoverButtonClasses = clsx({
                    "text-opacity-90": open,
                    "group flex items-center justify-center rounded-md text-base font-medium text-white hover:text-opacity-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-opacity-75":
                        true,
                });
                const chevronDownIconClasses = clsx({
                    "text-opacity-70": !open,
                    "h-5 w-5 transition duration-150 ease-in-out group-hover:text-opacity-80":
                        true,
                });
                return (
                    <>
                        <Popover.Button
                            ref={refs.setReference}
                            className={popoverButtonClasses}
                        >
                            <ChevronDownIcon
                                className={chevronDownIconClasses}
                                aria-hidden="true"
                            />
                        </Popover.Button>
                        <Transition
                            as={Fragment}
                            enter="transition ease-out duration-200"
                            enterFrom="opacity-0 translate-y-1"
                            enterTo="opacity-100 translate-y-0"
                            leave="transition ease-in duration-150"
                            leaveFrom="opacity-100 translate-y-0"
                            leaveTo="opacity-0 translate-y-1"
                        >
                            <Popover.Panel
                                ref={refs.setFloating}
                                style={floatingStyles}
                                className="z-10 mt-3 w-screen max-w-sm px-4 sm:px-0"
                            >
                                <div className="overflow-hidden rounded-lg shadow-lg ring-1 ring-black ring-opacity-5">
                                    <div className="grid gap-8 bg-gray-700 p-7">
                                        {actionButtons.map((item, index) => (
                                            <a
                                                key={`cryptex-welcome-action-${index}`}
                                                onClick={item.onClick}
                                                className="-m-3 flex cursor-pointer items-center rounded-lg p-2 transition duration-150 ease-in-out hover:bg-gray-800 focus:outline-none focus-visible:ring focus-visible:ring-orange-500 focus-visible:ring-opacity-50"
                                            >
                                                {item.Icon && (
                                                    <div className="flex h-10 w-10 shrink-0 items-center justify-center text-white sm:h-12 sm:w-12">
                                                        <item.Icon aria-hidden="true" />
                                                    </div>
                                                )}
                                                <div className="ml-4">
                                                    <p className="text-sm font-medium text-gray-200">
                                                        {item.Name}
                                                    </p>
                                                    <p className="text-sm text-gray-400">
                                                        {item.Description}
                                                    </p>
                                                </div>
                                            </a>
                                        ))}
                                    </div>
                                    {/* <div className="bg-gray-50 p-4">
                                    <a
                                        href="##"
                                        className="flow-root rounded-md px-2 py-2 transition duration-150 ease-in-out hover:bg-gray-100 focus:outline-none focus-visible:ring focus-visible:ring-orange-500 focus-visible:ring-opacity-50"
                                    >
                                        <span className="flex items-center">
                                            <span className="text-sm font-medium text-gray-900">
                                                Documentation
                                            </span>
                                        </span>
                                        <span className="block text-sm text-gray-500">
                                            Start integrating products and tools
                                        </span>
                                    </a>
                                </div> */}
                                </div>
                            </Popover.Panel>
                        </Transition>
                    </>
                );
            }}
        </Popover>
    );
};

const IconCreateVault: React.FC = () => {
    return (
        <svg
            width="48"
            height="48"
            viewBox="0 0 48 48"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
        >
            <rect width="48" height="48" rx="8" fill="#FFEDD5" />
            <path
                d="M24 11L35.2583 17.5V30.5L24 37L12.7417 30.5V17.5L24 11Z"
                stroke="#FB923C"
                strokeWidth="2"
            />
            <path
                fillRule="evenodd"
                clipRule="evenodd"
                d="M16.7417 19.8094V28.1906L24 32.3812L31.2584 28.1906V19.8094L24 15.6188L16.7417 19.8094Z"
                stroke="#FDBA74"
                strokeWidth="2"
            />
            <path
                fillRule="evenodd"
                clipRule="evenodd"
                d="M20.7417 22.1196V25.882L24 27.7632L27.2584 25.882V22.1196L24 20.2384L20.7417 22.1196Z"
                stroke="#FDBA74"
                strokeWidth="2"
            />
        </svg>
    );
};

const IconLinkDevice: React.FC = () => {
    return (
        <svg
            width="48"
            height="48"
            viewBox="0 0 48 48"
            fill="none"
            xmlns="http://www3.org/2000/svg"
        >
            <rect width="48" height="48" rx="8" fill="#D5FFED" />
            <path
                d="M24 11L35.2583 17.5V30.5L24 37L12.7417 30.5V17.5L24 11Z"
                stroke="#3CFB92"
                strokeWidth="2"
            />
            <path
                d="M17 23H20.5M31 23H27.5M20.5 23V25.5C20.5 27.1569 22.3431 28.5 24 28.5C25.6569 28.5 27.5 27.1569 27.5 25.5V23M20.5 23H27.5"
                stroke="#74FDBA"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
            />
        </svg>
    );
};

const IconRestoreVault: React.FC = () => {
    return (
        <svg
            width="48"
            height="48"
            viewBox="0 0 48 48"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
        >
            <rect width="48" height="48" rx="8" fill="#CDE7FF" />
            <path
                d="M24 11L35.2583 17.5V30.5L24 37L12.7417 30.5V17.5L24 11Z"
                stroke="#3984FF"
                strokeWidth="2"
            />
            <circle cx="24" cy="24" r="6.5" stroke="#5DA0FF" strokeWidth="2" />
            <path
                d="M20 30L28 22M20 22L28 30"
                stroke="#5DA0FF"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
            />
        </svg>
    );
};

const EncryptionAlgorithmSelectbox: React.FC<{
    onChange: (event: React.ChangeEvent<HTMLSelectElement>) => void;
    onBlur: () => void;
    value: EncryptionAlgorithm;
}> = ({ onChange, onBlur, value }) => {
    // Only use the numeric values of the enum to create the selectbox
    const encryptionOptions: number[] = Object.values(EncryptionAlgorithm)
        .filter((key) => !isNaN(Number(key)))
        .map((key) => Number(key));
    return (
        <div className="mt-1 rounded-md bg-gray-200 px-3 py-2">
            <select
                className="w-full bg-gray-200 text-gray-900"
                onChange={onChange}
                onBlur={onBlur}
                value={value}
            >
                {encryptionOptions.map((key) => (
                    <option key={key} value={key}>
                        {EncryptionAlgorithm[key]}
                    </option>
                ))}
            </select>
        </div>
    );
};

const KeyDerivationFunctionSelectbox: React.FC<{
    onChange: (event: React.ChangeEvent<HTMLSelectElement>) => void;
    onBlur: () => void;
    value: KeyDerivationFunction;
}> = ({ onChange, onBlur, value }) => {
    // Only use the numeric values of the enum to create the selectbox
    const keyDerivationOptions: number[] = Object.values(KeyDerivationFunction)
        .filter((key) => !isNaN(Number(key)))
        .map((key) => Number(key));
    return (
        <div className="mt-1 rounded-md bg-gray-200 px-3 py-2">
            <select
                className="w-full bg-gray-200 text-gray-900"
                onChange={onChange}
                onBlur={onBlur}
                value={value}
            >
                {keyDerivationOptions.map((key) => (
                    <option key={key} value={key}>
                        {KeyDerivationFunction[key]}
                    </option>
                ))}
            </select>
        </div>
    );
};

const UnlockVaultDialog: React.FC<{
    visibleState: [boolean, React.Dispatch<React.SetStateAction<boolean>>];
    selected: React.MutableRefObject<VaultMetadata | undefined>;
}> = ({ visibleState, selected }) => {
    const formSchema = env.NEXT_PUBLIC_SIGNIN_VALIDATE_CAPTCHA
        ? VaultEncryption.unlockVaultWCaptchaFormSchema
        : VaultEncryption.unlockVaultFormSchema;

    type UnlockVaultFormSchemaType = z.infer<typeof formSchema>;

    const defaultValues: UnlockVaultFormSchemaType = {
        Secret: "",
        Encryption: EncryptionAlgorithm.XChaCha20Poly1305,
        EncryptionKeyDerivationFunction: KeyDerivationFunction.Argon2ID,
        EncryptionConfig: {
            iterations:
                VaultEncryption.KeyDerivationConfig_PBKDF2.DEFAULT_ITERATIONS,
            memLimit:
                VaultEncryption.KeyDerivationConfig_Argon2ID.DEFAULT_MEM_LIMIT,
            opsLimit:
                VaultEncryption.KeyDerivationConfig_Argon2ID.DEFAULT_OPS_LIMIT,
        },
        CaptchaToken: "",
    };
    const {
        handleSubmit,
        control,
        setError: setFormError,
        formState: { errors, isSubmitting, isDirty },
        reset: resetForm,
        watch,
    } = useForm<UnlockVaultFormSchemaType>({
        resolver: zodResolver(formSchema),
        defaultValues: defaultValues,
    });

    const setUnlockedVault = useSetAtom(unlockedVaultAtom);
    const setUnlockedVaultMetadata = useSetAtom(unlockedVaultMetadataAtom);
    const busyRef = useRef(false);

    const onSubmit = async (formData: UnlockVaultFormSchemaType) => {
        if (busyRef.current) {
            return;
        }

        busyRef.current = true;

        if (!selected.current) {
            toast.error("No vault selected!");
            return;
        }

        toast.info("Attempting vault unlock...", {
            autoClose: false,
            closeButton: false,
            toastId: "vault-unlock",
            updateId: "vault-unlock",
        });

        // A little delay to make sure the toast is shown
        await new Promise((resolve) => setTimeout(resolve, 100));

        try {
            const vault = await selected.current.decryptVault(
                formData.Secret,
                formData.Encryption,
                formData.EncryptionKeyDerivationFunction,
                formData.EncryptionConfig
            );

            // Initialize the vault account
            const res = await cryptexAccountInit(
                formData.CaptchaToken,
                vault.OnlineServices.UserID,
                vault.OnlineServices.PrivateKey
            );

            if (!res.success && !res.offline && res.authResponse) {
                toast.error(
                    `Failed to authenticate with CryptexVault services. ${res.authResponse.error}`,
                    {
                        autoClose: false,
                        closeButton: true,
                    }
                );
                console.error(
                    "Failed to authenticate with CryptexVault services.",
                    res.authResponse.error
                );
            }

            // Set the vault metadata and vault atoms
            setUnlockedVaultMetadata(selected.current);
            setUnlockedVault(vault);

            toast.update("vault-unlock", {
                render: "Decryption successful.",
                type: "success",
                autoClose: 3000,
                closeButton: true,
            });

            hideDialog(true);
        } catch (e) {
            console.error("Failed to decrypt vault.", e);
            toast.update("vault-unlock", {
                render: "Failed to decrypt vault",
                type: "error",
                autoClose: 3000,
                pauseOnHover: false,
                closeButton: true,
            });
        }
        busyRef.current = false;
    };

    const hideDialog = async (force = false) => {
        const hide = () => {
            visibleState[1](false);
            // selected.current = undefined; // Reset the selected vault
            resetForm(defaultValues);
        };

        // Check if the form has been modified (only if we are not forcing)
        if (isDirty && !force) {
            // If it has, ask the user if they want to discard the changes
            if (confirm("Are you sure you want to discard your changes?")) {
                hide();
            }
        } else {
            // If not, just hide the modal
            hide();
        }
    };

    useEffect(() => {
        // Set the form fields to the selected vault's encryption algorithm
        if (selected.current && selected.current.Blob) {
            resetForm({
                Secret: "",
                Encryption: selected.current.Blob.Algorithm,
                EncryptionKeyDerivationFunction:
                    selected.current.Blob.KeyDerivationFunc,
                EncryptionConfig: {
                    iterations:
                        selected.current.Blob.KDFConfigPBKDF2?.iterations ??
                        VaultEncryption.KeyDerivationConfig_PBKDF2
                            .DEFAULT_ITERATIONS,
                    memLimit:
                        selected.current.Blob.KDFConfigArgon2ID?.memLimit ??
                        VaultEncryption.KeyDerivationConfig_Argon2ID
                            .DEFAULT_MEM_LIMIT,
                    opsLimit:
                        selected.current.Blob.KDFConfigArgon2ID?.opsLimit ??
                        VaultEncryption.KeyDerivationConfig_Argon2ID
                            .DEFAULT_OPS_LIMIT,
                },
                CaptchaToken: "",
            });
            // If we're in development, automatically unlock the vault
            // if (process.env.NODE_ENV === "development") {
            //     setValue("vaultSecret", "This is insane");
            //     handleSubmit(onSubmit)();
            // }
        }

        return () => {
            if (env.NEXT_PUBLIC_SIGNIN_VALIDATE_CAPTCHA) {
                if (window.turnstile) window.turnstile.remove();
            }
        };
    }, [selected, selected.current, resetForm, visibleState]);

    return (
        <GenericModal
            key="vault-unlock-modal"
            inhibitDismissOnClickOutside={isSubmitting}
            visibleState={[visibleState[0], () => hideDialog()]}
        >
            <Body>
                <div className="flex flex-col items-center text-center">
                    <p className="text-2xl font-bold text-gray-900">
                        Unlock vault
                    </p>

                    <p className="mt-2 text-left text-base text-gray-600">
                        Name: <b>{selected.current?.Name}</b>
                        <br />
                        Saved Encryption:{" "}
                        <b>
                            {EncryptionAlgorithm[
                                selected.current?.Blob?.Algorithm ?? 0
                            ] ?? "Unknown"}
                        </b>
                    </p>
                    <div className="flex w-full flex-col text-left">
                        <div className="mt-2 flex flex-col">
                            <Controller
                                control={control}
                                name="Secret"
                                render={({
                                    field: { onChange, onBlur, value },
                                }) => (
                                    <>
                                        <FormInputField
                                            label="Secret *"
                                            type="password"
                                            autoCapitalize="none"
                                            onKeyDown={(e) => {
                                                if (e.key === "Enter") {
                                                    handleSubmit(onSubmit)();
                                                }
                                            }}
                                            onChange={onChange}
                                            onBlur={onBlur}
                                            value={value}
                                        />
                                    </>
                                )}
                            />
                            {errors.Secret && (
                                <p className="text-red-500">
                                    {errors.Secret.message}
                                </p>
                            )}
                        </div>
                        <div className="mt-4 flex flex-col">
                            <Controller
                                control={control}
                                name="Encryption"
                                render={({
                                    field: { onChange, onBlur, value },
                                }) => (
                                    <>
                                        <label className="text-gray-600">
                                            Encryption Algorithm *
                                        </label>
                                        <EncryptionAlgorithmSelectbox
                                            onChange={onChange}
                                            onBlur={onBlur}
                                            value={value}
                                        />
                                    </>
                                )}
                            />
                            {errors.Encryption && (
                                <p className="text-red-500">
                                    {errors.Encryption.message}
                                </p>
                            )}
                        </div>
                        <div className="mt-4 flex flex-col">
                            <Controller
                                control={control}
                                name="EncryptionKeyDerivationFunction"
                                render={({
                                    field: { onChange, onBlur, value },
                                }) => (
                                    <>
                                        <label className="text-gray-600">
                                            Encryption Key Derivation Function *
                                        </label>
                                        <KeyDerivationFunctionSelectbox
                                            onChange={onChange}
                                            onBlur={onBlur}
                                            value={value}
                                        />
                                    </>
                                )}
                            />
                            {errors.EncryptionKeyDerivationFunction && (
                                <p className="text-red-500">
                                    {
                                        errors.EncryptionKeyDerivationFunction
                                            .message
                                    }
                                </p>
                            )}
                        </div>
                        <div className="mt-4">
                            <AccordionItem
                                title="Advanced"
                                buttonClassName="bg-gray-500"
                                innerClassName={
                                    "bg-slate-100 rounded-b-md px-2 py-5"
                                }
                            >
                                {/* Depending on which encryption method is chosen switch between different options */}
                                {/* Argon2ID options */}
                                <div
                                    className={clsx({
                                        hidden:
                                            watch(
                                                "EncryptionKeyDerivationFunction"
                                            ).toString() !==
                                            KeyDerivationFunction.Argon2ID.toString(),
                                    })}
                                >
                                    <div className="flex flex-col">
                                        <Controller
                                            control={control}
                                            name="EncryptionConfig.memLimit"
                                            render={({
                                                field: {
                                                    onChange,
                                                    onBlur,
                                                    value,
                                                },
                                            }) => (
                                                <FormNumberInputField
                                                    label="Memory Limit"
                                                    valueLabel="MiB"
                                                    min={
                                                        VaultEncryption
                                                            .KeyDerivationConfig_Argon2ID
                                                            .MIN_MEM_LIMIT
                                                    }
                                                    onChange={onChange}
                                                    onBlur={onBlur}
                                                    value={value}
                                                />
                                            )}
                                        />
                                        {errors.EncryptionConfig?.memLimit && (
                                            <p className="text-red-500">
                                                {
                                                    errors.EncryptionConfig
                                                        ?.memLimit.message
                                                }
                                            </p>
                                        )}
                                    </div>
                                    <div className="mt-4 flex flex-col">
                                        <Controller
                                            control={control}
                                            name="EncryptionConfig.opsLimit"
                                            render={({
                                                field: {
                                                    onChange,
                                                    onBlur,
                                                    value,
                                                },
                                            }) => (
                                                <FormNumberInputField
                                                    label="Operations Limit"
                                                    min={
                                                        VaultEncryption
                                                            .KeyDerivationConfig_Argon2ID
                                                            .MIN_OPS_LIMIT
                                                    }
                                                    max={
                                                        VaultEncryption
                                                            .KeyDerivationConfig_Argon2ID
                                                            .MAX_OPS_LIMIT
                                                    }
                                                    onChange={onChange}
                                                    onBlur={onBlur}
                                                    value={value}
                                                />
                                            )}
                                        />
                                        {errors.EncryptionConfig?.opsLimit && (
                                            <p className="text-red-500">
                                                {
                                                    errors.EncryptionConfig
                                                        ?.opsLimit.message
                                                }
                                            </p>
                                        )}
                                    </div>
                                </div>

                                {/* PBKDF2 options */}
                                <div
                                    className={clsx({
                                        hidden:
                                            watch(
                                                "EncryptionKeyDerivationFunction"
                                            ).toString() !==
                                            KeyDerivationFunction.PBKDF2.toString(),
                                    })}
                                >
                                    <div className="flex flex-col">
                                        <Controller
                                            control={control}
                                            name="EncryptionConfig.iterations"
                                            render={({
                                                field: {
                                                    onChange,
                                                    onBlur,
                                                    value,
                                                },
                                            }) => (
                                                <FormNumberInputField
                                                    label="Iterations"
                                                    min={1}
                                                    onChange={onChange}
                                                    onBlur={onBlur}
                                                    value={value}
                                                />
                                            )}
                                        />
                                        {errors.EncryptionConfig
                                            ?.iterations && (
                                            <p className="text-red-500">
                                                {
                                                    errors.EncryptionConfig
                                                        ?.iterations.message
                                                }
                                            </p>
                                        )}
                                    </div>
                                </div>

                                {errors.EncryptionConfig && (
                                    <p className="text-red-500">
                                        {errors.EncryptionConfig.message}
                                    </p>
                                )}
                            </AccordionItem>
                        </div>

                        {env.NEXT_PUBLIC_SIGNIN_VALIDATE_CAPTCHA && (
                            <div className="mt-4 flex flex-col items-center">
                                <Controller
                                    control={control}
                                    name="CaptchaToken"
                                    render={({ field: { onChange } }) => (
                                        <Turnstile
                                            options={{
                                                theme: "light",
                                                size: "normal",
                                                language: "auto",
                                                refreshExpired: "manual",
                                            }}
                                            siteKey={
                                                env.NEXT_PUBLIC_TURNSTILE_SITE_KEY
                                            }
                                            onError={() => {
                                                setFormError("CaptchaToken", {
                                                    message: "Captcha error",
                                                });
                                            }}
                                            onExpire={() => {
                                                onChange("");
                                                setFormError("CaptchaToken", {
                                                    message: "Captch expired",
                                                });
                                            }}
                                            onSuccess={(token) =>
                                                onChange(token)
                                            }
                                        />
                                    )}
                                />
                                {errors.CaptchaToken && (
                                    <p className="text-red-500">
                                        {errors.CaptchaToken.message}
                                    </p>
                                )}
                            </div>
                        )}
                    </div>
                </div>
            </Body>

            <Footer className="space-y-3 sm:space-x-5 sm:space-y-0">
                <ButtonFlat
                    text="Unlock"
                    className="sm:ml-2"
                    onClick={handleSubmit(onSubmit)}
                    disabled={isSubmitting}
                    loading={isSubmitting}
                />
                <ButtonFlat
                    text="Cancel"
                    type={ButtonType.Secondary}
                    onClick={() => hideDialog()}
                    disabled={isSubmitting}
                />
            </Footer>
        </GenericModal>
    );
};

enum CreateVaultDialogMode {
    Blank,
    FromImport,
}
const CreateVaultDialog: React.FC<{
    visibleState: [boolean, React.Dispatch<React.SetStateAction<boolean>>];
    mode: CreateVaultDialogMode;
    vaultInstance: React.MutableRefObject<Vault | undefined>;
    showCredentialsGeneratorDialogFn: React.MutableRefObject<() => void>;
}> = ({ visibleState, showCredentialsGeneratorDialogFn }) => {
    const [dev_seedVault, setdev_seedVault] = useState(false);
    const dev_seedCount = useRef<number>(100);

    const {
        handleSubmit,
        control,
        formState: { errors, isSubmitting, isDirty },
        reset: resetForm,
        watch,
    } = useForm<NewVaultFormSchemaType>({
        resolver: zodResolver(newVaultFormSchema),
        defaultValues: {
            Name: "",
            Description: "",
            Secret: "",
            Encryption: EncryptionAlgorithm.XChaCha20Poly1305,
            EncryptionKeyDerivationFunction: KeyDerivationFunction.Argon2ID,
            EncryptionConfig: {
                iterations:
                    VaultEncryption.KeyDerivationConfig_PBKDF2
                        .DEFAULT_ITERATIONS,
                memLimit:
                    VaultEncryption.KeyDerivationConfig_Argon2ID
                        .DEFAULT_MEM_LIMIT,
                opsLimit:
                    VaultEncryption.KeyDerivationConfig_Argon2ID
                        .DEFAULT_OPS_LIMIT,
            },
        },
    });

    const delay = (ms: number) => new Promise((res) => setTimeout(res, ms));

    const onSubmit = async (data: NewVaultFormSchemaType) => {
        toast.info("Generating vault...", {
            autoClose: false,
            closeButton: false,
            toastId: "create-vault",
            updateId: "create-vault",
        });

        // Leave time for the UI to update
        await delay(100);

        try {
            // console.time("create-vault");
            // Create a new vault
            const vaultMetadata = await VaultMetadata.createNewVault(
                data,
                dev_seedVault,
                dev_seedCount.current
            );
            // console.timeEnd("create-vault");

            toast.warning("Verifying vault...", {
                autoClose: false,
                closeButton: false,
                toastId: "create-vault",
                updateId: "create-vault",
            });

            // Leave time for the UI to update
            await delay(100);

            // Verify that the vault has been properly encrypted - try to decrypt it
            await vaultMetadata.decryptVault(
                data.Secret,
                data.Encryption,
                data.EncryptionKeyDerivationFunction,
                data.EncryptionConfig
            );
            // console.debug("Decrypted vault:", _);

            // Vault encryption/decryption is working, save the vault
            await vaultMetadata.save(null);

            toast.success("Vault created.", {
                autoClose: 3000,
                toastId: "create-vault",
                updateId: "create-vault",
            });

            hideDialog(true);
        } catch (error) {
            console.error("Failed to create a new vault.", error);
            toast.update("create-vault", {
                render: `Failed to create a new vault.`,
                type: toast.TYPE.ERROR,
                progress: 0,
                autoClose: 3000,
            });
        }
    };

    const hideDialog = async (force = false) => {
        const hide = () => {
            visibleState[1](false);

            setTimeout(() => {
                resetForm();
            }, DIALOG_BLUR_TIME);
        };

        // Check if the form has been modified (only if we are not forcing)
        if (isDirty && !force) {
            // If it has, ask the user if they want to discard the changes
            if (confirm("Are you sure you want to discard your changes?")) {
                hide();
            }
        } else {
            // If not, just hide the modal
            hide();
        }
    };

    return (
        <GenericModal
            key="vault-creation-dialog"
            visibleState={[visibleState[0], () => hideDialog()]}
        >
            <Body>
                <div className="flex flex-col items-center text-center">
                    <p className="text-2xl font-bold text-gray-900">
                        Create a new Vault
                    </p>

                    <p className="mt-2 text-base text-gray-600">
                        We recommend you to use a secret in the form of a
                        passphrase which is generally a password composed of a
                        sentence or a combination of words and tend to be longer
                        and more complex than an average password, which
                        increases overall security. It is also a good idea to
                        use a combination of different languages.
                    </p>
                    <div className="mt-4 flex w-full flex-col text-left">
                        <div className="mt-4 flex flex-col">
                            <Controller
                                control={control}
                                name="Name"
                                render={({
                                    field: { onChange, onBlur, value },
                                }) => (
                                    <>
                                        <FormInputField
                                            label="Name *"
                                            type="text"
                                            placeholder="My Vault"
                                            autoCapitalize={"sentences"}
                                            onChange={onChange}
                                            onBlur={onBlur}
                                            value={value}
                                        />
                                    </>
                                )}
                            />
                            {errors.Name && (
                                <p className="text-red-500">
                                    {errors.Name.message}
                                </p>
                            )}
                        </div>
                        <div className="mt-4 flex flex-col">
                            <Controller
                                control={control}
                                name="Description"
                                render={({
                                    field: { onChange, onBlur, value },
                                }) => (
                                    <>
                                        <FormTextAreaField
                                            label="Description"
                                            placeholder="Personal, Work, etc."
                                            autoCapitalize="sentences"
                                            onChange={onChange}
                                            onBlur={onBlur}
                                            value={value}
                                        />
                                    </>
                                )}
                            />
                            {errors.Description && (
                                <p className="text-red-500">
                                    {errors.Description.message}
                                </p>
                            )}
                        </div>
                        <div className="mt-4 flex flex-col">
                            <Controller
                                control={control}
                                name="Secret"
                                render={({
                                    field: { onChange, onBlur, value },
                                }) => (
                                    <>
                                        <FormInputField
                                            label="Secret *"
                                            type="text"
                                            placeholder="E.g. My super secr3t p4ssphrase"
                                            autoCapitalize="none"
                                            credentialsGeneratorFnRef={
                                                showCredentialsGeneratorDialogFn
                                            }
                                            onChange={onChange}
                                            onBlur={onBlur}
                                            value={value}
                                        />
                                    </>
                                )}
                            />
                            {errors.Secret && (
                                <p className="text-red-500">
                                    {errors.Secret.message}
                                </p>
                            )}
                            <p className="mt-2 text-sm text-gray-600">
                                This is the secret that you will use to unlock
                                your vault.
                            </p>
                        </div>

                        {process.env.NODE_ENV === "development" && (
                            <div className="mt-4 rounded-lg bg-gray-100 p-4">
                                <p className="text-lg font-bold text-gray-900">
                                    Development Options
                                </p>
                                <div className="mt-4 flex items-center gap-2">
                                    <label className="text-gray-600">
                                        Seed Vault
                                    </label>
                                    <input
                                        type="checkbox"
                                        onChange={(e) =>
                                            setdev_seedVault(e.target.checked)
                                        }
                                        checked={dev_seedVault}
                                    />
                                </div>
                                <div
                                    className={`mt-2 flex items-center gap-2 ${
                                        !dev_seedVault ? "hidden" : ""
                                    }`}
                                >
                                    <label className="text-gray-600">
                                        Seed Count
                                    </label>
                                    <input
                                        type="number"
                                        onChange={(e) =>
                                            (dev_seedCount.current = parseInt(
                                                e.target.value
                                            ))
                                        }
                                        defaultValue={dev_seedCount.current}
                                    />
                                </div>
                            </div>
                        )}
                        <div className="mt-4 flex flex-col">
                            <Controller
                                control={control}
                                name="Encryption"
                                render={({
                                    field: { onChange, onBlur, value },
                                }) => (
                                    <>
                                        <label className="text-gray-600">
                                            Encryption Algorithm *
                                        </label>
                                        <EncryptionAlgorithmSelectbox
                                            onChange={onChange}
                                            onBlur={onBlur}
                                            value={value}
                                        />

                                        {/* {!errors.vaultEncryption && (
                                            <p className="ml-3 mt-2 text-sm text-gray-600">
                                                {
                                                    VaultEncryption
                                                        .vaultEncryptionDescriptions[
                                                        value
                                                    ]
                                                }
                                            </p>
                                        )} */}
                                    </>
                                )}
                            />
                            {errors.Encryption && (
                                <p className="text-red-500">
                                    {errors.Encryption.message}
                                </p>
                            )}
                        </div>
                        <div className="mt-4 flex flex-col">
                            <Controller
                                control={control}
                                name="EncryptionKeyDerivationFunction"
                                render={({
                                    field: { onChange, onBlur, value },
                                }) => (
                                    <>
                                        <label className="text-gray-600">
                                            Encryption Key Derivation Function *
                                        </label>
                                        <KeyDerivationFunctionSelectbox
                                            onChange={onChange}
                                            onBlur={onBlur}
                                            value={value}
                                        />
                                    </>
                                )}
                            />
                            {errors.EncryptionKeyDerivationFunction && (
                                <p className="text-red-500">
                                    {
                                        errors.EncryptionKeyDerivationFunction
                                            .message
                                    }
                                </p>
                            )}
                        </div>
                        <div className="mt-4">
                            <AccordionItem
                                title="Advanced"
                                buttonClassName="bg-gray-500"
                                innerClassName={
                                    "bg-slate-100 rounded-b-md px-2 py-5"
                                }
                            >
                                {/* Depending on which encryption method is chosen switch between different options */}
                                {/* Argon2ID options */}
                                <div
                                    className={clsx({
                                        hidden:
                                            watch(
                                                "EncryptionKeyDerivationFunction"
                                            ).toString() !==
                                            KeyDerivationFunction.Argon2ID.toString(),
                                    })}
                                >
                                    <div className="flex flex-col">
                                        <Controller
                                            control={control}
                                            name="EncryptionConfig.memLimit"
                                            render={({
                                                field: {
                                                    onChange,
                                                    onBlur,
                                                    value,
                                                },
                                            }) => (
                                                <FormNumberInputField
                                                    label="Memory Limit"
                                                    valueLabel="MiB"
                                                    min={
                                                        VaultEncryption
                                                            .KeyDerivationConfig_Argon2ID
                                                            .MIN_MEM_LIMIT
                                                    }
                                                    onChange={onChange}
                                                    onBlur={onBlur}
                                                    value={value}
                                                />
                                            )}
                                        />
                                        {errors.EncryptionConfig?.memLimit && (
                                            <p className="text-red-500">
                                                {
                                                    errors.EncryptionConfig
                                                        ?.memLimit.message
                                                }
                                            </p>
                                        )}
                                    </div>
                                    <div className="mt-4 flex flex-col">
                                        <Controller
                                            control={control}
                                            name="EncryptionConfig.opsLimit"
                                            render={({
                                                field: {
                                                    onChange,
                                                    onBlur,
                                                    value,
                                                },
                                            }) => (
                                                <FormNumberInputField
                                                    label="Operations Limit"
                                                    min={
                                                        VaultEncryption
                                                            .KeyDerivationConfig_Argon2ID
                                                            .MIN_OPS_LIMIT
                                                    }
                                                    max={
                                                        VaultEncryption
                                                            .KeyDerivationConfig_Argon2ID
                                                            .MAX_OPS_LIMIT
                                                    }
                                                    onChange={onChange}
                                                    onBlur={onBlur}
                                                    value={value}
                                                />
                                            )}
                                        />
                                        {errors.EncryptionConfig?.opsLimit && (
                                            <p className="text-red-500">
                                                {
                                                    errors.EncryptionConfig
                                                        ?.opsLimit.message
                                                }
                                            </p>
                                        )}
                                    </div>
                                </div>

                                {/* PBKDF2 options */}
                                <div
                                    className={clsx({
                                        hidden:
                                            watch(
                                                "EncryptionKeyDerivationFunction"
                                            ).toString() !==
                                            KeyDerivationFunction.PBKDF2.toString(),
                                    })}
                                >
                                    <div className="flex flex-col">
                                        <Controller
                                            control={control}
                                            name="EncryptionConfig.iterations"
                                            render={({
                                                field: {
                                                    onChange,
                                                    onBlur,
                                                    value,
                                                },
                                            }) => (
                                                <FormNumberInputField
                                                    label="Iterations"
                                                    min={1}
                                                    onChange={onChange}
                                                    onBlur={onBlur}
                                                    value={value}
                                                />
                                            )}
                                        />
                                        {errors.EncryptionConfig
                                            ?.iterations && (
                                            <p className="text-red-500">
                                                {
                                                    errors.EncryptionConfig
                                                        ?.iterations.message
                                                }
                                            </p>
                                        )}
                                    </div>
                                </div>

                                {errors.EncryptionConfig && (
                                    <p className="text-red-500">
                                        {errors.EncryptionConfig.message}
                                    </p>
                                )}
                            </AccordionItem>
                        </div>
                    </div>
                </div>
            </Body>

            <Footer className="space-y-3 sm:space-x-5 sm:space-y-0">
                <ButtonFlat
                    text="Create"
                    className="sm:ml-2"
                    onClick={handleSubmit(onSubmit)}
                    disabled={isSubmitting}
                    loading={isSubmitting}
                />
                <ButtonFlat
                    text="Cancel"
                    type={ButtonType.Secondary}
                    onClick={() => hideDialog()}
                    disabled={isSubmitting}
                />
            </Footer>
        </GenericModal>
    );
};

const BlockWideButton: React.FC<{
    icon: React.ReactNode;
    iconCaption: string;
    description: string;
    onClick?: () => void;
    disabled?: boolean;
}> = ({ icon, iconCaption, description, onClick, disabled }) => (
    <div
        className={clsx({
            "mb-2 flex flex-col items-center gap-1 rounded-md bg-gray-200 px-4 py-2 transition-colors":
                true,
            "cursor-pointer hover:bg-gray-300": !disabled,
            "opacity-50": disabled,
        })}
        onClick={() => !disabled && onClick && onClick()}
    >
        <div className="flex flex-row items-center gap-2">
            {icon}
            <p className="text-gray-900">{iconCaption}</p>
        </div>
        <p className="text-xs text-gray-500">{description}</p>
    </div>
);

const LinkDeviceOutsideVaultDialog: React.FC<{
    showDialogFnRef: React.MutableRefObject<(() => void) | null>;
}> = ({ showDialogFnRef }) => {
    const [visible, setVisible] = useState(false);
    showDialogFnRef.current = () => setVisible(true);
    const hideDialog = () => {
        setVisible(false);

        setTimeout(() => {
            resetState();
        }, DIALOG_BLUR_TIME);
    };

    enum State {
        LinkingMethod = "LinkingMethod",
        QRCodeScanning = "QRCodeScanning",
        // SoundListening = "SoundListening",
        DecryptionPassphrase = "DecryptionPassphrase",
        LinkingInProgress = "LinkingInProgress",
        // WaitingForDevice = "WaitingForDevice",
        // ReceivingVaultMetadata = "ReceivingVault",
        // AcceptingVault = "AcceptingVault",
        // SavingVault = "SavingVault",
    }

    const [currentState, setCurrentState] = useState<State>(
        State.LinkingMethod
    );
    const [isOperationInProgress, setOperationInProgress] = useState(false);
    const progressLogRef = useRef<ProgressLogType[]>([]);
    const addToProgressLog = (
        message: string,
        type: "done" | "info" | "warn" | "error" = "done"
    ) => {
        const newProgressLog = [{ message, type }, ...progressLogRef.current];
        progressLogRef.current = newProgressLog;
        setFormValue("progressLog", newProgressLog);
    };

    const fileInputRef = useRef<HTMLInputElement>(null);
    const vaultLinkingFormSchema = z.object({
        encryptedData: z.string().nonempty(),
        decryptionPassphrase: z.string().nonempty(),
        captchaToken: env.NEXT_PUBLIC_SIGNIN_VALIDATE_CAPTCHA
            ? z.string().nonempty("Captcha is required.")
            : z.string(),
        progressLog: z.array(
            z.object({
                message: z.string(),
                type: z.enum(["done", "info", "warn", "error"]),
            })
        ),
    });
    type VaultLinkingFormSchemaType = z.infer<typeof vaultLinkingFormSchema>;
    const {
        control,
        handleSubmit,
        setValue: setFormValue,
        setError: setFormError,
        formState: { errors },
        reset: resetForm,
    } = useForm<VaultLinkingFormSchemaType>({
        resolver: zodResolver(vaultLinkingFormSchema),
        defaultValues: {
            encryptedData: "",
            decryptionPassphrase: "",
            captchaToken: "",
            progressLog: [],
        },
    });

    const resetState = () => {
        resetForm();
        setCurrentState(State.LinkingMethod);
        progressLogRef.current = [];
    };

    /**
     * This is called when the user clicks on the "Using a file" button
     */
    const fileMethod = async () => {
        try {
            // Show the file picker
            const fileData = await openFilePicker(fileInputRef);

            // Load the file
            const encryptedData = await readFile(fileData);
            setFormValue("encryptedData", encryptedData);

            // If we were able to load the file, move to the next step which is decryption
            setCurrentState(State.DecryptionPassphrase);
        } catch (e) {
            console.error("Failed to load the file.", e);
            toast.error("Failed to load the file.");
        }
    };

    /**
     * This is called when the user clicks on the "Using a QR code" button
     */
    const qrCodeMethod = async () => {
        setCurrentState(State.QRCodeScanning);
    };

    const qrCodeMethodCallback = async (data: string) => {
        console.debug("QR code result:", data);

        setFormValue("encryptedData", data);
        setCurrentState(State.DecryptionPassphrase);
    };

    /**
     * This is called after the user enters the decryption passphrase
     */
    const onSubmit = async (formData: VaultLinkingFormSchemaType) => {
        setOperationInProgress(true);

        // Delay a bit for the UI to update
        await new Promise((res) => setTimeout(res, 100));

        // Try to decrypt the data - setError if it fails
        let decryptedData: OnlineServicesAccountInterface;
        try {
            decryptedData = await OnlineServicesAccount.decryptTransferableData(
                formData.encryptedData,
                formData.decryptionPassphrase
            );

            // Validate the decrypted data
            if (
                !decryptedData.UserID?.length ||
                !decryptedData.PublicKey?.length ||
                !decryptedData.PrivateKey?.length
            ) {
                throw new Error("Invalid decrypted data.");
            }
        } catch (e) {
            console.error("Failed to decrypt the data.", e);
            setFormError("decryptionPassphrase", {
                type: "value",
                message: "Failed to decrypt the data.",
            });

            setOperationInProgress(false);
            return;
        }

        // Try to authenticate silently
        try {
            const response = await cryptexAccountSignIn(
                decryptedData.UserID,
                decryptedData.PrivateKey,
                formData.captchaToken
            );

            // Validate the auth data
            if (response.success != true || !response.authResponse) {
                throw new Error("Invalid auth data.");
            }
        } catch (e) {
            console.error("Failed to authenticate.", e);
            setFormError("decryptionPassphrase", {
                type: "value",
                message: "Failed to authenticate to online services.",
            });

            setOperationInProgress(false);
            return;
        }

        setCurrentState(State.LinkingInProgress);

        // Delay a bit for the UI to update
        await new Promise((res) => setTimeout(res, 100));

        await connectToOnlineServices(decryptedData);
    };

    const connectToOnlineServices = async (
        decryptedData: OnlineServicesAccountInterface
    ) => {
        //---
        // Start setting up the WebRTC connection so it is ready when we need it
        const webRTConnection = await newWebRTCConnection();
        webRTConnection.onconnectionstatechange = () => {
            console.debug(
                "WebRTC connection state changed:",
                webRTConnection.connectionState
            );

            if (webRTConnection.connectionState === "connected") {
                // console.debug("WebRTC connection established.");
                addToProgressLog(
                    "Private connection established, disconnecting from CryptexVault Online Services...",
                    "info"
                );

                // We're connected directly to the other device, so disconnect from the online services
                onlineWSServicesEndpoint.disconnect();
                onlineWSServicesEndpoint.unbind();
            } else if (
                webRTConnection.connectionState === "disconnected" ||
                webRTConnection.connectionState === "failed"
            ) {
                // console.debug("WebRTC connection lost.");
                addToProgressLog(
                    "Private connection has been terminated.",
                    "info"
                );

                setOperationInProgress(false);
            }
        };

        webRTConnection.ondatachannel = (event) => {
            console.debug("Received WebRTC data channel:", event);

            const receiveChannel = event.channel;
            receiveChannel.onmessage = async (event) => {
                addToProgressLog("Receiving vault...", "info");
                try {
                    // Get the message and make sure it's a Uint8Array
                    const rawVaultMetadata: Uint8Array = new Uint8Array(
                        event.data
                    );

                    // Parse the vault metadata
                    const newVaultMetadata =
                        VaultMetadata.decodeMetadataBinary(rawVaultMetadata);

                    await newVaultMetadata.save(null);

                    addToProgressLog("Vault received.");

                    toast.success("Vault received.");
                } catch (e) {
                    console.error("Failed to receive the vault.", e);
                    addToProgressLog(
                        "Failed to receive the vault - check the console for details. Please try again or contact support.",
                        "error"
                    );
                }

                receiveChannel.close();

                webRTConnection.close();

                addToProgressLog(
                    "It is safe to close this dialog now.",
                    "info"
                );
            };

            receiveChannel.onerror = (err) => {
                console.error("WebRTC data channel error:", err);

                addToProgressLog("Secure channel error.", "error");

                setOperationInProgress(false);
            };

            receiveChannel.onclose = () => {
                // Close the WebRTC connection
                webRTConnection.close();

                addToProgressLog("Secure data channel closed.", "info");

                setOperationInProgress(false);
            };
        };

        let iceCandidatesGenerated = 0;
        // Send the ice candidates
        // This is called only after we call setLocalDescription
        webRTConnection.onicecandidate = (event) => {
            console.debug("WebRTC ICE candidate:", event);
            if (event.candidate) {
                console.debug("Sending WebRTC ice candidate:", event.candidate);
                wsChannel.trigger("client-link", {
                    type: "ice-candidate",
                    data: event.candidate,
                });

                iceCandidatesGenerated++;
            }

            if (iceCandidatesGenerated === 0 && !event.candidate) {
                addToProgressLog(
                    "Failed to generate any ICE candidates. WEBRTC failure.",
                    "error"
                );

                setOperationInProgress(false);

                webRTConnection.close();
                onlineWSServicesEndpoint.disconnect();
            }
        };

        // Connect to the online services
        // We use this to exchange the WebRTC offer and ice candidates
        const onlineWSServicesEndpoint = newWSPusherInstance();
        onlineWSServicesEndpoint.connection.bind("connecting", () => {
            addToProgressLog(
                "Connecting to CryptexVault Online Services...",
                "info"
            );
        });

        onlineWSServicesEndpoint.connection.bind("connected", () => {
            addToProgressLog(
                "Connected to CryptexVault Online Services.",
                "done"
            );
        });

        onlineWSServicesEndpoint.connection.bind("disconnected", () => {
            addToProgressLog(
                "Dropped connection from CryptexVault Online Services.",
                "info"
            );
        });

        onlineWSServicesEndpoint.connection.bind("error", (err: object) => {
            console.error("WS error:", err);

            addToProgressLog(
                "An error occurred while setting up a private connection.",
                "error"
            );

            setOperationInProgress(false);
        });

        // The predefined channel name is based on the user ID
        const channelName = `presence-link-${decryptedData.UserID}`;
        // Subscribe to own channel
        const wsChannel = onlineWSServicesEndpoint.subscribe(channelName);
        wsChannel.bind("pusher:subscription_succeeded", () => {
            addToProgressLog(
                "Waiting for other device to notice us...",
                "info"
            );
        });

        wsChannel.bind(
            "client-link",
            async (data: {
                type: "offer" | "ice-candidate";
                data: RTCIceCandidateInit | RTCSessionDescriptionInit;
            }) => {
                // console.debug("Received WebRTC offer:", data);

                if (data.type === "offer") {
                    console.debug("Received WebRTC offer:", data.data);
                    await webRTConnection.setRemoteDescription(
                        data.data as RTCSessionDescriptionInit
                    );

                    // Send the answer
                    const answer = await webRTConnection.createAnswer();
                    await webRTConnection.setLocalDescription(answer);
                    console.debug("Sending WebRTC answer:", answer);
                    wsChannel.trigger("client-link", {
                        type: "answer",
                        data: answer,
                    });

                    addToProgressLog(
                        "Finishing establishing private connection...",
                        "info"
                    );
                } else if (data.type === "ice-candidate") {
                    console.debug("Received WebRTC ice candidate:", data.data);
                    await webRTConnection.addIceCandidate(
                        data.data as RTCIceCandidateInit
                    );
                }
            }
        );

        setOperationInProgress(false);
    };

    return (
        <GenericModal
            visibleState={[visible, setVisible]}
            inhibitDismissOnClickOutside
        >
            <Body>
                <div className="flex flex-col items-center text-center">
                    <p className="text-center text-2xl font-bold text-gray-900">
                        Link a Device
                    </p>
                    {currentState === State.LinkingMethod && (
                        <div className="text-left">
                            <p className="mt-2 text-base text-gray-600">
                                To link a device, you need to have the other
                                device with you.
                            </p>
                            <p className="mt-2 text-base text-gray-600">
                                There are two steps to linking a device:
                            </p>
                            <div className="pl-2">
                                <p className="mt-2 text-base text-gray-600">
                                    <b>1.</b> Unlock the vault you want to link
                                    to this device then open the{" "}
                                    <strong>Link a Device</strong> dialog in the
                                    sidebar - then choose a linking method.
                                </p>
                                <p className="mt-2 text-base text-gray-600">
                                    <b>2.</b> Select the same linking method
                                    below and follow the instructions.
                                </p>
                            </div>
                        </div>
                    )}
                    {currentState === State.DecryptionPassphrase && (
                        <p className="mt-2 text-base text-gray-600">
                            Enter the decryption passphrase displayed on the
                            other device and click on <strong>Continue</strong>.
                        </p>
                    )}
                </div>
                <div className="mt-5 flex flex-col">
                    {currentState === State.LinkingMethod && (
                        <>
                            <BlockWideButton
                                icon={
                                    <CameraIcon className="h-5 w-5 text-gray-900" />
                                }
                                iconCaption="QR code"
                                description="Scan a QR code to link the devices"
                                onClick={qrCodeMethod}
                                disabled={isOperationInProgress}
                            />
                            <BlockWideButton
                                icon={
                                    <SpeakerWaveIcon className="h-5 w-5 text-gray-900" />
                                }
                                iconCaption="Transfer with sound"
                                description="Link the devices using sound"
                                // disabled={
                                //     isSubmitting ||
                                //     (validInput !== ValidInput.Sound && validInput !== null)
                                // }
                                disabled={true} // FIXME: Sound transfer is not implemented yet
                                // validInput={validInput === ValidInput.Sound}
                            />
                            <BlockWideButton
                                icon={
                                    <DocumentTextIcon className="h-5 w-5 text-gray-900" />
                                }
                                iconCaption="Using a file"
                                description="Load a file from your device to link the devices"
                                onClick={fileMethod}
                                disabled={isOperationInProgress}
                            />
                        </>
                    )}
                    {currentState === State.QRCodeScanning && (
                        <div className="mb-2 flex justify-center">
                            <p className="text-md text-center text-gray-600">
                                Scan the QR code shown on the other device to
                                continue...
                            </p>
                        </div>
                    )}
                    <QrReader
                        disabled={currentState !== State.QRCodeScanning}
                        onResult={(result) => {
                            if (result) {
                                qrCodeMethodCallback(result.getText());
                            }
                        }}
                    />
                    {currentState === State.DecryptionPassphrase && (
                        <>
                            <Controller
                                control={control}
                                name="decryptionPassphrase"
                                render={({
                                    field: { onChange, onBlur, value },
                                }) => (
                                    <>
                                        <FormInputField
                                            label="Decryption Passphrase"
                                            type="text"
                                            placeholder="The passphrase displayed on the other device"
                                            autoCapitalize="none"
                                            onChange={onChange}
                                            onBlur={onBlur}
                                            value={value}
                                        />
                                    </>
                                )}
                            />
                            {errors.decryptionPassphrase && (
                                <p className="text-red-500">
                                    {errors.decryptionPassphrase.message}
                                </p>
                            )}
                            {env.NEXT_PUBLIC_SIGNIN_VALIDATE_CAPTCHA && (
                                <div className="mt-5 flex flex-col items-center">
                                    <Controller
                                        control={control}
                                        name="captchaToken"
                                        render={({ field: { onChange } }) => (
                                            <Turnstile
                                                options={{
                                                    theme: "light",
                                                    size: "normal",
                                                    language: "auto",
                                                }}
                                                siteKey={
                                                    env.NEXT_PUBLIC_TURNSTILE_SITE_KEY
                                                }
                                                onError={() => {
                                                    setFormError(
                                                        "captchaToken",
                                                        {
                                                            message:
                                                                "Captcha error",
                                                        }
                                                    );
                                                }}
                                                onExpire={() => onChange("")}
                                                onSuccess={(token) =>
                                                    onChange(token)
                                                }
                                            />
                                        )}
                                    />
                                    {errors.captchaToken && (
                                        <p className="text-red-500">
                                            {errors.captchaToken.message}
                                        </p>
                                    )}
                                </div>
                            )}
                        </>
                    )}
                    {currentState === State.LinkingInProgress && (
                        <div className="flex flex-col gap-2">
                            {isOperationInProgress && (
                                <div className="flex justify-center">
                                    <p className="animate-pulse text-gray-900">
                                        Linking device...
                                    </p>
                                </div>
                            )}
                            <Controller
                                control={control}
                                name="progressLog"
                                render={({ field: { value } }) => (
                                    <EventLogDisclosure
                                        title="Event log"
                                        log={value}
                                    />
                                )}
                            />
                        </div>
                    )}
                </div>
                <div className="hidden">
                    <input type="file" ref={fileInputRef} accept=".cryxa" />
                </div>
            </Body>
            <Footer className="space-y-3 sm:space-x-5 sm:space-y-0">
                <ButtonFlat
                    text={"Continue"}
                    className={clsx({
                        "sm:ml-2": true,
                        hidden: currentState !== State.DecryptionPassphrase,
                    })}
                    onClick={handleSubmit(onSubmit)}
                    disabled={
                        isOperationInProgress ||
                        currentState !== State.DecryptionPassphrase
                    }
                    loading={isOperationInProgress}
                />
                <ButtonFlat
                    text="Close"
                    type={ButtonType.Secondary}
                    onClick={hideDialog}
                    disabled={isOperationInProgress}
                />
                {currentState === State.QRCodeScanning ||
                currentState === State.DecryptionPassphrase ? (
                    <ButtonFlat
                        text="Back"
                        type={ButtonType.Secondary}
                        onClick={resetState}
                        disabled={isOperationInProgress}
                    />
                ) : null}
            </Footer>
        </GenericModal>
    );
};

const WelcomeScreen: React.FC = ({}) => {
    const showWarningDialogFnRef = useRef<WarningDialogShowFn | null>(null);
    const showWarningDialog: WarningDialogShowFn = (
        description: string,
        onConfirm: () => void,
        onDismiss: (() => void) | null
    ) => {
        showWarningDialogFnRef.current?.(description, onConfirm, onDismiss);
    };

    const _encryptedVaults = useLiveQuery(() =>
        VaultStorage.db.vaults.toArray()
    );
    const encryptedVaults = _encryptedVaults?.map((metadata) =>
        VaultMetadata.decodeMetadataBinary(metadata.data, metadata.id)
    );

    const createVaultDialogVisible = useState(false);
    const [createVaultDialogMode, setCreateVaultDialogMode] =
        useState<CreateVaultDialogMode>(CreateVaultDialogMode.Blank);
    const createVaultDialogVaultInstance = useRef<Vault | undefined>(undefined);
    const showCreateVaultDialog = (
        mode: CreateVaultDialogMode = CreateVaultDialogMode.Blank,
        vaultInstance?: Vault
    ) => {
        setCreateVaultDialogMode(mode);
        createVaultDialogVaultInstance.current = vaultInstance;
        createVaultDialogVisible[1](true);
    };

    const deviceLinkingDialogShowDialogFnRef = useRef<(() => void) | null>(
        null
    );

    // NOTE: Hardcoded for now, will come from the user's settings in the future
    const shouldShowUnlockDialogWhenAlone = true;
    const showOnFirstRenderTriggered = useRef(false);
    const unlockDialogVisibleOnFirstRender =
        encryptedVaults?.length === 1 &&
        shouldShowUnlockDialogWhenAlone &&
        !showOnFirstRenderTriggered.current;

    const selectedVault = useRef<VaultMetadata | undefined>(undefined);
    const unlockVaultDialogVisible = useState<boolean>(false);
    const showUnlockVaultDialog = (vaultMetadata: VaultMetadata) => {
        // Set the selected vault
        selectedVault.current = vaultMetadata;

        // Show the unlock vault dialog
        unlockVaultDialogVisible[1](true);
    };

    const restoreVaultDialogVisible = useState(false);
    const showRestoreVaultDialog = () => restoreVaultDialogVisible[1](true);

    const showCredentialsGeneratorDialogFnRef = useRef<() => void>(() => {
        // No-op
    });

    const actionButtons: ActionButton[] = [
        {
            Name: "Create Vault",
            Description: "Create a new secure vault",
            onClick: showCreateVaultDialog,
            Icon: IconCreateVault,
        },
        {
            Name: "Link a Device",
            Description: "Copy a vault from another device",
            onClick: () => deviceLinkingDialogShowDialogFnRef.current?.(),
            Icon: IconLinkDevice,
        },
        {
            Name: "Restore Vault",
            Description: "Restore a vault from a backup file",
            onClick: showRestoreVaultDialog,
            Icon: IconRestoreVault,
        },
    ];

    const hasVaults = encryptedVaults && encryptedVaults.length > 0;

    // If there is only one vault, automatically show the unlock dialog
    if (
        unlockDialogVisibleOnFirstRender &&
        !showOnFirstRenderTriggered.current
    ) {
        showOnFirstRenderTriggered.current = true;
        if (hasVaults) selectedVault.current = encryptedVaults[0];
        unlockVaultDialogVisible[1](true);
    }

    // console.log("WWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWW");

    return (
        <>
            <div className="flex grow flex-col items-center justify-center gap-10 overflow-hidden">
                {hasVaults && (
                    <>
                        <div className="mb-4 flex w-full max-w-lg flex-col rounded-lg bg-gray-900 p-6">
                            <div className="mb-4 flex flex-row items-center justify-between">
                                <p className="text-center text-2xl font-bold">
                                    Stored Vaults
                                </p>
                                <VaultListPopover
                                    actionButtons={actionButtons}
                                />
                            </div>

                            {encryptedVaults.map((item, i) => (
                                <VaultListItem
                                    key={`vaultmetadata-${i}`}
                                    vaultMetadata={item}
                                    onClick={showUnlockVaultDialog}
                                    showWarningDialogCallback={
                                        showWarningDialog
                                    }
                                />
                            ))}
                        </div>
                    </>
                )}
                {!hasVaults && (
                    <>
                        <div className="flex flex-col items-center justify-center">
                            <p className="text-center text-4xl font-bold">
                                Welcome to CryptexVault
                            </p>
                            <p className="text-center text-base text-slate-400">
                                CryptexVault is a decentralized password manager
                                that allows <br />
                                you to manage your digital identity and access
                                services <br />
                                without having to trust any third party.
                            </p>
                        </div>
                        <div className="mt-4 flex w-full flex-col items-center justify-center gap-2 sm:flex-row sm:gap-4">
                            <div
                                className="flex h-12 w-3/4 cursor-pointer flex-col items-center justify-center rounded-lg bg-gray-700 p-4 shadow-lg transition-shadow hover:shadow-[#F5F5F5] sm:h-56 sm:w-56"
                                onClick={() => showRestoreVaultDialog()}
                            >
                                <p className="text-md font-bold sm:text-2xl">
                                    Restore
                                </p>
                                <p className="hidden select-none text-center text-sm text-slate-300 sm:block">
                                    Restore your Vault from a backup file.
                                </p>
                            </div>
                            <div
                                className="flex h-12 w-3/4 cursor-pointer flex-col items-center justify-center rounded-lg bg-gray-700 p-4 shadow-lg transition-shadow hover:shadow-[#FF5668] sm:h-56 sm:w-56"
                                onClick={() => showCreateVaultDialog()}
                            >
                                <p className="text-md font-bold sm:text-2xl">
                                    Create
                                </p>
                                <p className="hidden select-none text-center text-sm text-slate-300 sm:block">
                                    Create a new Vault. <br />
                                    Start here!
                                </p>
                            </div>
                            <div
                                className="flex h-12 w-3/4 cursor-pointer flex-col items-center justify-center rounded-lg bg-gray-700 p-4 shadow-lg transition-shadow hover:shadow-[#25C472] sm:h-56 sm:w-56"
                                onClick={() =>
                                    deviceLinkingDialogShowDialogFnRef.current?.()
                                }
                            >
                                <p className="text-md font-bold sm:text-2xl">
                                    Link a Device
                                </p>
                                <p className="hidden select-none text-center text-sm text-slate-300 sm:block">
                                    Copy a vault from another device.
                                </p>
                            </div>
                            {/* <div
                                className="flex h-12 w-3/4 cursor-pointer flex-col items-center justify-center rounded-lg bg-gray-700 p-4 shadow-md transition-colors hover:bg-gray-600 sm:h-56 sm:w-56"
                                onClick={() => toast.info("Import")}
                            >
                                <p className="text-md font-bold sm:text-2xl">
                                    Import
                                </p>
                                <p className="hidden select-none text-center text-sm text-slate-300 sm:block">
                                    Import a Vault from another password
                                    manager.
                                </p>
                            </div> */}
                        </div>
                    </>
                )}
            </div>
            <CreateVaultDialog
                visibleState={createVaultDialogVisible}
                mode={createVaultDialogMode}
                vaultInstance={createVaultDialogVaultInstance}
                showCredentialsGeneratorDialogFn={
                    showCredentialsGeneratorDialogFnRef
                }
            />
            <LinkDeviceOutsideVaultDialog
                showDialogFnRef={deviceLinkingDialogShowDialogFnRef}
            />
            <RestoreVaultDialog visibleState={restoreVaultDialogVisible} />
            <UnlockVaultDialog
                visibleState={unlockVaultDialogVisible}
                selected={selectedVault}
            />
            <CredentialsGeneratorDialog
                showDialogFnRef={showCredentialsGeneratorDialogFnRef}
            />
            <WarningDialog showFnRef={showWarningDialogFnRef} />
        </>
    );
};

type FileUploaderZoneProps = {
    onFileAdded: (file: File) => Promise<void>;
};
const FileUploaderZone: React.FC<FileUploaderZoneProps> = ({ onFileAdded }) => {
    const [isDragActive, setIsDragActive] = useState(false);
    const fileInputRef = useRef<HTMLInputElement>(null);

    const onFileChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files;

        if (file && file.length > 0 && file[0]) {
            await handleFile(file[0]);
        }

        // Reset the file input value so that the same file can be uploaded again
        if (fileInputRef.current) {
            fileInputRef.current.value = "";
        }
    };

    const onDrop = async (event: React.DragEvent<HTMLDivElement>) => {
        event.preventDefault();
        setIsDragActive(false);

        if (
            event.dataTransfer.files &&
            event.dataTransfer.files.length > 0 &&
            event.dataTransfer.files[0]
        ) {
            await handleFile(event.dataTransfer.files[0]);
        }
    };

    const handleFile = async (file: File) => {
        // Call the callback function with the valid files
        if (file.name.endsWith(".cryx")) {
            await onFileAdded(file);
        }
    };

    const onDragOver = (event: React.DragEvent<HTMLDivElement>) => {
        event.preventDefault();
        setIsDragActive(true);
    };

    const onDragLeave = () => {
        setIsDragActive(false);
    };

    // Open the file browser when the div is clicked
    const openFileBrowser = () => {
        if (fileInputRef.current) {
            fileInputRef.current.click();
        }
    };

    return (
        <div
            onClick={openFileBrowser}
            onDragOver={onDragOver}
            onDragLeave={onDragLeave}
            onDrop={onDrop}
            className={`mt-4 flex flex-col items-center justify-center rounded-md p-5 ${
                isDragActive ? "bg-slate-400" : "bg-slate-500"
            } cursor-pointer shadow-md`}
        >
            <input
                ref={fileInputRef}
                type="file"
                accept=".cryx"
                multiple={false}
                onChange={onFileChange}
                className="hidden"
            />
            <p className="h-full w-full cursor-pointer text-center text-base text-slate-200">
                Click or drag and drop a backup file here.
            </p>
            <p className="h-full w-full cursor-pointer text-center text-base text-slate-200">
                The file must be a .cryx file.
            </p>
        </div>
    );
};

const RestoreVaultDialog: React.FC<{
    visibleState: [boolean, React.Dispatch<React.SetStateAction<boolean>>];
}> = ({ visibleState }) => {
    const [isLoading, setIsLoading] = useState(false);

    const [validFile, setValidFile] =
        useState<VaultEncryption.EncryptedBlob | null>(null);

    const {
        handleSubmit,
        control,
        formState: { errors, isSubmitting },
        reset: resetForm,
    } = useForm<VaultRestoreFormSchema>({
        resolver: zodResolver(vaultRestoreFormSchema),
        defaultValues: {
            Name: `Restored Vault ${new Date().toLocaleString()}`,
        },
    });

    const onFileAddedCallback = async (file: File) => {
        setIsLoading(true);
        toast.info("Validating backup file...", {
            autoClose: false,
            closeButton: false,
            updateId: "validating-backup-toast",
            toastId: "validating-backup-toast",
        });

        try {
            const validEncryptedData = VaultEncryption.EncryptedBlob.fromBinary(
                new Uint8Array(await file.arrayBuffer())
            );

            setValidFile(validEncryptedData);

            toast.info("Backup file is valid.", {
                autoClose: 3000,
                closeButton: true,
                updateId: "validating-backup-toast",
                toastId: "validating-backup-toast",
            });
        } catch (error) {
            console.error("Error validating backup file.", error);
            toast.error("Backup file is invalid.", {
                autoClose: 3000,
                closeButton: true,
                updateId: "validating-backup-toast",
                toastId: "validating-backup-toast",
            });

            setValidFile(null);
        }

        setIsLoading(false);
    };

    const onSubmit = async (data: VaultRestoreFormSchema) => {
        if (!validFile) {
            return;
        }

        setIsLoading(true);

        toast.info("Saving vault...", {
            autoClose: false,
            closeButton: false,
            updateId: "saving-vault-toast",
            toastId: "saving-vault-toast",
        });

        const newVaultMetadataInst = new VaultMetadata();
        newVaultMetadataInst.Name = data.Name;
        newVaultMetadataInst.Description = `Vault restored from backup on ${new Date().toLocaleString()}.`;
        newVaultMetadataInst.Blob = validFile;

        try {
            await newVaultMetadataInst.save(null);

            toast.success("Vault saved.", {
                autoClose: 3000,
                closeButton: true,
                updateId: "saving-vault-toast",
                toastId: "saving-vault-toast",
            });

            hideModal();
        } catch (error) {
            console.error("Error saving vault.", error);
            toast.error("Error saving vault.", {
                autoClose: 3000,
                closeButton: true,
                updateId: "saving-vault-toast",
                toastId: "saving-vault-toast",
            });
        }

        setIsLoading(false);
    };

    const hideModal = async () => {
        visibleState[1](false);

        // Clean up the form
        resetForm({});
        setValidFile(null);
    };

    return (
        <GenericModal
            key="vault-settings-modal"
            visibleState={[visibleState[0], hideModal]}
        >
            <Body>
                <div className="flex flex-col items-center text-center">
                    <p className="text-2xl font-bold text-gray-900">
                        Vault Restore
                    </p>

                    <div className="mt-2 flex w-full flex-col items-center text-left">
                        <p
                            className="line-clamp-2 text-left text-base text-gray-600"
                            // title={vaultMetadata.Name}
                        >
                            Restore your vault from a backup file.
                        </p>
                    </div>
                    <div className="flex w-full flex-col text-left">
                        {/* A drag and drop upload section */}
                        {!validFile && (
                            <FileUploaderZone
                                onFileAdded={onFileAddedCallback}
                            />
                        )}
                        {/* Upload success green checkmark */}
                        {validFile && (
                            <div className="mt-4 flex cursor-pointer flex-col items-center justify-center rounded-md bg-slate-500 p-5 shadow-md">
                                <div className="flex w-full flex-col items-end">
                                    {/* Clear field icon */}
                                    <XMarkIcon
                                        className={`h-5 w-5 cursor-pointer`}
                                        title="Clear file"
                                        aria-hidden="true"
                                        onClick={() => setValidFile(null)}
                                    />
                                </div>
                                <div className="mb-5 flex flex-col items-center justify-center">
                                    <CheckCircleIcon
                                        className={`h-12 w-12 text-green-500`}
                                        aria-hidden="true"
                                    />
                                    <p className="h-full w-full cursor-pointer text-center text-base text-slate-200">
                                        Backup file is valid.
                                    </p>
                                </div>
                            </div>
                        )}

                        <div className="flex flex-col">
                            <div className="mt-4 flex flex-col">
                                <Controller
                                    control={control}
                                    name="Name"
                                    render={({
                                        field: { onChange, onBlur, value },
                                    }) => (
                                        <>
                                            <FormInputField
                                                label="New Vault Name *"
                                                type="text"
                                                placeholder="E.g. My personal vault"
                                                autoCapitalize="sentences"
                                                onChange={onChange}
                                                onBlur={onBlur}
                                                value={value}
                                            />
                                        </>
                                    )}
                                />
                                {errors.Name && (
                                    <p className="text-red-500">
                                        {errors.Name.message}
                                    </p>
                                )}
                            </div>
                        </div>
                    </div>
                </div>
            </Body>

            <Footer className="space-y-3 sm:space-x-5 sm:space-y-0">
                <ButtonFlat
                    text="Restore"
                    className="sm:ml-2"
                    type={ButtonType.Primary}
                    onClick={handleSubmit(onSubmit)}
                    disabled={isSubmitting || !validFile || isLoading}
                />
                <ButtonFlat
                    text="Close"
                    type={ButtonType.Secondary}
                    onClick={() => hideModal()}
                    disabled={isSubmitting || isLoading}
                />
            </Footer>
        </GenericModal>
    );
};

const FeatureVotingDialog: React.FC<{
    showDialogFnRef: React.MutableRefObject<(() => void) | null>;
}> = ({ showDialogFnRef }) => {
    const session = useSession();

    const [visibleState, setVisibleState] = useState(false);
    const hideModal = () => setVisibleState(false);
    showDialogFnRef.current = () => setVisibleState(true);

    const hasSession = !!session && !!session.data;

    // Get the featureVoting.getRounds trpc query if the user is logged in
    const {
        data: featureVotingRounds,
        isLoading: isLoadingRounds,
        refetch: refetchRounds,
        remove: removeRoundsData,
    } = trpc.featureVoting.getRounds.useQuery(undefined, {
        retryDelay: 10000,
        enabled: hasSession,
        refetchOnWindowFocus: false,
    });

    const numberOfOpenRounds =
        featureVotingRounds?.rounds.filter((i) => i.active).length ?? 0;

    // A mutation for featureVoting.placeVote
    const { mutate: placeVote, isLoading: isPlacingVoteInProgress } =
        trpc.featureVoting.placeVote.useMutation({
            retryDelay: 10000,
        });

    const placeNewVote = async (roundId: string, itemId: string) => {
        placeVote(
            {
                roundId,
                itemId,
            },
            {
                onSuccess: () => {
                    refetchRounds();
                    toast.success("Vote placed.");
                },
                onError: (error) => {
                    console.error("Error placing vote.", error);
                    toast.error("Error placing vote.");
                },
            }
        );
    };

    useEffect(() => {
        // When the session clears, refetch the rounds
        if (!hasSession) {
            removeRoundsData();
        }
    }, [session]);

    return (
        <GenericModal
            key="feature-voting-modal"
            visibleState={[visibleState, setVisibleState]}
        >
            <Body>
                <div className="flex flex-col items-center text-center">
                    <p className="text-2xl font-bold text-gray-900">
                        Feature Voting
                    </p>

                    <div className="mt-2 flex w-full flex-col items-center text-left">
                        {
                            // If the user is not logged in, tell them to log in
                            !hasSession && (
                                <p className="text-center text-base text-gray-600">
                                    You need to be logged in to online services
                                    in order to view and vote on features.
                                </p>
                            )
                        }

                        {/* Show a call to action message if there are rounds and incorrectTier boolean flag is true */}
                        {hasSession && featureVotingRounds?.incorrectTier && (
                            <>
                                {" "}
                                <p className="text-left text-base text-gray-600">
                                    Your tier does not allow you to vote on
                                    features.{" "}
                                </p>
                                <p className="text-left text-base text-gray-600">
                                    Please upgrade your account to enable
                                    voting.
                                </p>
                            </>
                        )}

                        {
                            // If the user is logged in, but there are no open rounds, tell them there are no open rounds
                            hasSession && numberOfOpenRounds === 0 && (
                                <p className="line-clamp-2 text-left text-base text-gray-600">
                                    There are currently no voting rounds open.
                                </p>
                            )
                        }
                        {
                            // If the user is logged in, and there are open rounds, show the open rounds
                            hasSession && numberOfOpenRounds > 0 && (
                                <p className="line-clamp-2 text-left text-base text-gray-600">
                                    There is currently a voting round open.
                                </p>
                            )
                        }
                    </div>
                    <div className="flex w-full flex-col text-left">
                        {/* Map the feature voting rounds if the loading is done, show a loading indicator otherwise */}
                        {!isLoadingRounds && featureVotingRounds && (
                            <div className="mt-4 flex flex-col">
                                {featureVotingRounds.rounds.map(
                                    (round, index) => (
                                        <Disclosure
                                            key={`feature-voting-disclosure-${index}-${Date.now}`}
                                            defaultOpen={round.active}
                                        >
                                            <Disclosure.Button
                                                key={`${round.id}-button`}
                                                className="mt-4 flex flex-col justify-between rounded-t-lg bg-gray-100 p-4"
                                            >
                                                <div className="mb-2 flex w-full">
                                                    {/* Whether or the round is finished */}
                                                    <div className="flex w-full flex-row items-center justify-between gap-3">
                                                        {round.active ? (
                                                            <p className="text-md uppercase text-green-500">
                                                                Open
                                                            </p>
                                                        ) : (
                                                            <p className="text-md uppercase text-red-500">
                                                                Closed
                                                            </p>
                                                        )}
                                                        <p className="text-base text-gray-500">
                                                            {round.active
                                                                ? "until "
                                                                : "ended on "}
                                                            {round.end.toLocaleDateString()}
                                                        </p>
                                                    </div>
                                                </div>

                                                <div className="flex w-full justify-between">
                                                    <p className="line-clamp-2 text-lg font-bold text-gray-900">
                                                        {round.title}
                                                    </p>
                                                    <ChevronDownIcon className="h-6 w-6 text-gray-500" />
                                                </div>
                                                <p className="mt-2 line-clamp-2 text-base text-gray-600">
                                                    {round.description}
                                                </p>
                                            </Disclosure.Button>
                                            <Disclosure.Panel
                                                key={`${round.id}-panel`}
                                                className="flex flex-col rounded-b-lg bg-gray-100"
                                            >
                                                {/* The round items map */}
                                                {round.items.map((item) => (
                                                    <div
                                                        key={item.id}
                                                        className={clsx({
                                                            "flex flex-col p-4 sm:justify-between":
                                                                true,
                                                            "rounded-sm border border-gray-400 bg-gray-200":
                                                                !round.active &&
                                                                round.votedId ===
                                                                    item.id,
                                                        })}
                                                    >
                                                        {/* Show the items description */}
                                                        <div className="flex flex-col sm:mt-0">
                                                            <p className="text-base text-gray-700">
                                                                {item.title}
                                                            </p>
                                                            <p
                                                                className="line-clamp-2 text-base text-gray-500"
                                                                title={
                                                                    item.description ??
                                                                    ""
                                                                }
                                                            >
                                                                {
                                                                    item.description
                                                                }
                                                            </p>
                                                        </div>
                                                        <div className="mt-2 flex flex-row items-center space-x-2 sm:mt-0">
                                                            {
                                                                // Show the vote count if the round is not active (voting is over)
                                                                !round.active ? (
                                                                    <p className="text-base text-gray-600">
                                                                        {
                                                                            item
                                                                                .votes
                                                                                ?.length
                                                                        }{" "}
                                                                        votes
                                                                    </p>
                                                                ) : (
                                                                    <ButtonFlat
                                                                        text="Vote"
                                                                        type={
                                                                            ButtonType.Secondary
                                                                        }
                                                                        onClick={() =>
                                                                            placeNewVote(
                                                                                round.id,
                                                                                item.id
                                                                            )
                                                                        }
                                                                        loading={
                                                                            isPlacingVoteInProgress
                                                                        }
                                                                        disabled={
                                                                            !round.active ||
                                                                            !round.userCanVote ||
                                                                            isPlacingVoteInProgress ||
                                                                            isLoadingRounds
                                                                        }
                                                                    />
                                                                )
                                                            }
                                                        </div>
                                                    </div>
                                                ))}
                                            </Disclosure.Panel>
                                        </Disclosure>
                                    )
                                )}
                            </div>
                        )}
                    </div>
                </div>
            </Body>

            <Footer className="space-y-3 sm:space-x-5 sm:space-y-0">
                <ButtonFlat
                    text="Close"
                    type={ButtonType.Secondary}
                    onClick={() => hideModal()}
                    disabled={isPlacingVoteInProgress}
                />
            </Footer>
        </GenericModal>
    );
};

const AccountDialog: React.FC<{
    showDialogFnRef: React.MutableRefObject<() => void>;
    showWarningDialogFn: WarningDialogShowFn;
    showRecoveryGenerationDialogFnRef: React.MutableRefObject<
        (() => void) | null
    >;
    subscriptionData?: GetSubscriptionOutputSchemaType;
    dataLoading: boolean;
    hasDataLoadingError: boolean;
}> = ({
    showDialogFnRef,
    showWarningDialogFn,
    showRecoveryGenerationDialogFnRef,
    subscriptionData,
    dataLoading,
    hasDataLoadingError,
}) => {
    const [isVisible, setIsVisible] = useState(false);
    showDialogFnRef.current = () => setIsVisible(true);

    const { data: session, update: refreshSessionData } = useSession();
    const router = useRouter();

    const [ongoingOperation, setOngoingOperation] = useState(false);

    const vaultMetadata = useAtomValue(unlockedVaultMetadataAtom);
    const unlockedVault = useAtomValue(unlockedVaultAtom);

    // Prepare the user deletion trpc call
    const { mutateAsync: deleteUser } = trpc.account.deleteUser.useMutation();

    const deleteUserAccount = async () => {
        if (!vaultMetadata) return;

        showWarningDialogFn(
            "You are about to permanently delete your online services account. This will prevent you from accessing online services until you create a new account. This will not affect your vault data.",
            async () => {
                setOngoingOperation(true);

                try {
                    await deleteUser();
                    await unbindAccountFromVault(vaultMetadata, unlockedVault);

                    toast.success("User account deleted.");

                    router.reload();
                } catch (err) {
                    toast.error(
                        "An error occured while deleting your user account. Please try again later."
                    );
                    console.error(err);
                }

                setOngoingOperation(false);
            },
            null
        );
    };

    const Account: React.FC = () => {
        const {
            mutateAsync: sendVerificationEmail,
            isLoading: isSendingEmail,
        } = trpc.credentials.resendVerificationEmail.useMutation();

        const resendVerificationEmail = async () => {
            if (!session) return;

            setOngoingOperation(true);

            try {
                await sendVerificationEmail();

                toast.success("Verification email sent.");
            } catch (error) {
                if (error instanceof TRPCClientError) {
                    console.error(error.message);
                } else {
                    console.error("Error sending verification email:", error);
                }
                toast.error(
                    "Error sending verification email. Please try again later."
                );
            }

            setOngoingOperation(false);
        };

        const {
            mutateAsync: _clearRecoveryPhrase,
            isLoading: isClearingRecoveryPhrase,
        } = trpc.credentials.clearRecoveryToken.useMutation();

        const clearRecoveryPhrase = async () => {
            showWarningDialogFn(
                "You are about to clear your recovery phrase. This will make it impossible to recover your online services account using the existing recovery phrase, if you lose access to your vault.",
                async () => {
                    setOngoingOperation(true);

                    try {
                        await _clearRecoveryPhrase();

                        toast.success("Recovery phrase cleared.");

                        // Refresh the session data
                        await refreshSessionData();
                    } catch (error) {
                        if (error instanceof TRPCClientError) {
                            console.error(error.message);
                        } else {
                            console.error(
                                "Error clearing recovery phrase:",
                                error
                            );
                        }
                        toast.error(
                            "Error clearing recovery phrase. Please try again later."
                        );
                    }

                    setOngoingOperation(false);
                },
                null
            );
        };

        const generateRecoveryPhrase = async () =>
            showRecoveryGenerationDialogFnRef.current?.();

        return (
            <>
                <div className="mt-2 flex flex-col">
                    <div className="flex items-center gap-1">
                        <p className="text-left text-base text-gray-600">
                            Status:
                        </p>
                        {session?.user?.confirmed_at ? (
                            <p className="text-green-500">Verified</p>
                        ) : (
                            <p className="text-red-500">Not Verified</p>
                        )}
                    </div>
                    {session?.user?.confirmed_at && (
                        <p className="text-left text-base text-gray-600">
                            Last verification:{" "}
                            {new Date(
                                session.user.confirmed_at
                            ).toLocaleDateString()}
                        </p>
                    )}
                    {!session?.user?.confirmed_at &&
                        session?.user?.confirmation_period_expires_at && (
                            <p className="text-left text-base text-gray-600">
                                Verify before:{" "}
                                {new Date(
                                    session.user.confirmation_period_expires_at
                                ).toLocaleDateString()}
                            </p>
                        )}
                </div>
                {!session?.user?.confirmed_at && (
                    <div className="mt-2 flex flex-col">
                        <ButtonFlat
                            type={ButtonType.Secondary}
                            text="Resend Confirmation Email"
                            onClick={resendVerificationEmail}
                            disabled={isSendingEmail}
                            loading={isSendingEmail}
                        />
                    </div>
                )}

                <hr className="my-3" />

                <div className="flex flex-col">
                    <div className="flex items-center gap-1">
                        <p className="text-left text-base text-gray-600">
                            Recovery Phrase:
                        </p>
                        {session?.user?.recovery_token_created ? (
                            <p className="text-green-500">Backed up</p>
                        ) : (
                            <p className="text-red-500">Not Backed up</p>
                        )}
                    </div>
                    {session?.user?.recovery_token_created_at && (
                        <p className="text-left text-base text-gray-600">
                            Date of backup:{" "}
                            {new Date(
                                session.user.recovery_token_created_at
                            ).toLocaleDateString()}
                        </p>
                    )}
                </div>
                {!session?.user?.recovery_token_created && (
                    <div className="flex flex-row items-center gap-1">
                        <div>
                            <InformationCircleIcon className="h-5 w-5 text-gray-500" />
                        </div>
                        <div>
                            <p className="my-1 flex text-left text-base text-gray-600">
                                Generate a recovery phrase to regain access to
                                your online services account in case you lose
                                access to your vault.
                            </p>
                            <p className="my-1 flex text-left text-base text-gray-600">
                                Note: This recovery method is strictly for
                                online services account recovery which is
                                separate from vault backup/recovery.
                            </p>
                        </div>
                    </div>
                )}
                {!session?.user?.isRoot && (
                    <div className="mt-2 flex flex-col">
                        <p className="text-left text-base text-gray-600">
                            Use the root device to generate a recovery phrase.
                        </p>
                    </div>
                )}
                {session?.user?.recovery_token_created &&
                    session?.user?.isRoot && (
                        <div className="mt-2 flex flex-col">
                            <ButtonFlat
                                type={ButtonType.Secondary}
                                text="Clear Recovery Phrase"
                                onClick={clearRecoveryPhrase}
                                disabled={ongoingOperation}
                                loading={isClearingRecoveryPhrase}
                            />
                        </div>
                    )}
                {!session?.user?.recovery_token_created &&
                    session?.user?.isRoot && (
                        <div className="mt-2 flex flex-col">
                            <ButtonFlat
                                type={ButtonType.Secondary}
                                text="Generate Recovery Phrase"
                                onClick={generateRecoveryPhrase}
                                disabled={ongoingOperation}
                            />
                        </div>
                    )}
            </>
        );
    };

    const SubscriptionMenu: React.FC = () => {
        const router = useRouter();

        const { data: customerPortalURL } =
            trpc.payment.getCustomerPortal.useQuery(undefined, {
                refetchOnWindowFocus: false,
                enabled:
                    (subscriptionData && subscriptionData.nonFree) ?? false,
            });

        if (dataLoading) {
            return (
                <>
                    <Spinner />
                </>
            );
        }

        if (!subscriptionData) {
            return (
                <>
                    <div className="p-5">
                        <p className="text-slate-700">
                            You are not subscribed to any plans.
                        </p>
                        <div className="mt-5 flex flex-col space-y-2">
                            <ButtonFlat
                                text="Upgrade"
                                onClick={navigateToCheckout}
                            ></ButtonFlat>
                        </div>
                    </div>
                </>
            );
        }

        return (
            <div className="flex max-w-md flex-col rounded-md border-slate-500 p-5">
                <p className="text-2xl font-medium text-slate-800">
                    {subscriptionData.product_name}
                </p>
                <div className="mt-2 p-2">
                    <div className="flex items-center space-x-2">
                        <CalendarIcon className="mr-2 inline-block h-5 w-5" />
                        <p>Started on</p>
                        <p className="text-slate-700">
                            {subscriptionData.created_at?.toLocaleDateString()}
                        </p>
                    </div>
                    {subscriptionData.expires_at && (
                        <div className="flex items-center space-x-2">
                            <ClockIcon className="mr-2 inline-block h-5 w-5" />
                            <p>
                                {subscriptionData.cancel_at_period_end
                                    ? "Expires on"
                                    : "Next billing"}
                            </p>
                            <p className="text-slate-700">
                                {subscriptionData.expires_at?.toLocaleDateString()}
                            </p>
                        </div>
                    )}
                    {subscriptionData.configuration &&
                        subscriptionData.configuration.linking_allowed && (
                            <div className="flex items-center space-x-2">
                                <DevicePhoneMobileIcon className="mr-2 inline-block h-5 w-5" />
                                <p className="text-slate-700">
                                    {
                                        subscriptionData.configuration
                                            .linked_devices
                                    }{" "}
                                </p>
                                <p>of </p>
                                <p className="text-slate-700">
                                    {
                                        subscriptionData.configuration
                                            .linked_devices_limit
                                    }{" "}
                                </p>
                                <p>linked devices</p>
                            </div>
                        )}
                    <div className="flex items-center space-x-2">
                        <ArrowPathIcon className="mr-2 inline-block h-5 w-5" />
                        <p>Unlimited credentials per vault</p>
                    </div>
                    <div className="flex items-center space-x-2">
                        <KeyIcon className="mr-2 inline-block h-5 w-5" />
                        {subscriptionData.nonFree ? (
                            <p>Unlimited secure vaults</p>
                        ) : (
                            <p>A secure vault</p>
                        )}
                    </div>
                    <div className="flex items-center space-x-2">
                        <CloudArrowUpIcon className="mr-2 inline-block h-5 w-5" />
                        <p>Create encrypted backups</p>
                    </div>
                    {subscriptionData.nonFree &&
                        subscriptionData.configuration?.automated_backups && (
                            <div className="flex items-center space-x-2">
                                <ArrowUturnUpIcon className="mr-2 inline-block h-5 w-5" />
                                <p>Automated encrypted backups</p>
                            </div>
                        )}
                    {subscriptionData.nonFree &&
                        subscriptionData.configuration?.feature_voting && (
                            <div className="flex items-center space-x-2">
                                <HandThumbUpIcon className="mr-2 inline-block h-5 w-5" />
                                <p>Feature voting</p>
                            </div>
                        )}
                    {subscriptionData.nonFree &&
                        subscriptionData.configuration
                            ?.credentials_borrowing && (
                            <div className="flex items-center space-x-2">
                                <ShareIcon className="mr-2 inline-block h-5 w-5" />
                                <p>Credentials borrowing</p>
                            </div>
                        )}
                </div>
                <div className="mt-2 flex flex-col">
                    {subscriptionData.nonFree ? (
                        <ButtonFlat
                            text="Manage Subscription"
                            disabled={!customerPortalURL}
                            onClick={async () => {
                                if (customerPortalURL)
                                    router.push(customerPortalURL);
                            }}
                        ></ButtonFlat>
                    ) : (
                        <ButtonFlat
                            text="Upgrade"
                            className="max-w-full"
                            onClick={navigateToCheckout}
                        ></ButtonFlat>
                    )}
                </div>
            </div>
        );
    };

    const RegisteredDevices: React.FC = () => {
        const { data: registeredDevices, refetch: refetchRegisteredDevices } =
            trpc.account.getRegisteredDevices.useQuery(undefined, {
                refetchOnWindowFocus: false,
                enabled: !!session && session.user?.isRoot,
            });

        const { mutateAsync: removeDevice } =
            trpc.account.removeDevice.useMutation();

        if (!registeredDevices && session?.user?.isRoot) {
            // Something went wrong
            return (
                <div className="mt-2 flex w-full flex-col gap-2 text-left">
                    <p className="line-clamp-2 text-left text-base text-gray-600">
                        There was an error loading your registered devices.
                    </p>
                    <p className="line-clamp-2 text-left text-base text-gray-600">
                        Please try again later.
                    </p>
                </div>
            );
        } else if (!registeredDevices && !session?.user?.isRoot) {
            // Only the root device is allowed to see and manage registered devices
            return (
                <div className="mt-2 flex w-full flex-col gap-2 text-left">
                    <p className="text-left text-base text-gray-600">
                        You are not allowed to manage registered devices.
                    </p>
                    <p className="text-left text-base text-gray-600">
                        Please use the root device (the device that initially
                        created the account) to manage registered devices.
                    </p>
                </div>
            );
        }

        if (!subscriptionData?.configuration?.linking_allowed) {
            return (
                <div className="mt-2 flex w-full flex-col gap-2 text-left">
                    <p className="line-clamp-2 text-left text-base text-gray-600">
                        You are not allowed to register devices.
                    </p>
                    <p className="line-clamp-2 text-left text-base text-gray-600">
                        Please upgrade your subscription to enable this feature.
                    </p>
                </div>
            );
        }

        if (!registeredDevices?.length) {
            // No registered devices found - should not happen
            return (
                <div className="mt-2 flex w-full flex-col gap-2 text-left">
                    <p className="line-clamp-2 text-left text-base text-gray-600">
                        No registered devices found.
                    </p>
                    <p className="line-clamp-2 text-left text-base text-gray-600">
                        Please register a new device by linking it to this vault
                        or for use in a separate vault.
                    </p>
                </div>
            );
        }

        const tempRmFn = async (id: string) => {
            showWarningDialogFn(
                "Do you really want to remove the selected device? This will prevent the device from accessing the online services.",
                async () => {
                    setOngoingOperation(true);

                    try {
                        await removeDevice({
                            deviceId: id,
                        });
                        refetchRegisteredDevices();
                    } catch (error) {
                        console.error("Error unlinking device.", error);
                        toast.error("Error unlinking device.");
                    }

                    setOngoingOperation(false);
                },
                null
            );
        };

        return (
            <div className="overflow-auto">
                <p className="mt-2 text-lg">
                    Currently Registered ({registeredDevices?.length} /{" "}
                    {subscriptionData.configuration.linked_devices_limit})
                </p>
                <div className="mt-2 flex max-h-52 flex-col gap-2 overflow-y-auto overflow-x-clip">
                    {registeredDevices?.map((device) => {
                        const resolvedDeviceName =
                            unlockedVault?.OnlineServices.getLinkedDevice(
                                device.deviceID
                            )?.Name;
                        const isCurrentDevice =
                            device.id === session?.user?.accountID;

                        let deviceDescription = "";
                        const name = (function () {
                            if (isCurrentDevice) {
                                deviceDescription = "This device";
                                return "(This device)";
                            } else if (resolvedDeviceName) {
                                deviceDescription =
                                    "Linked device - known to this vault.";
                                return resolvedDeviceName;
                            } else {
                                deviceDescription =
                                    "Unknown device - might be known to another vault.";
                                return "(Linked device)";
                            }
                        })();
                        return (
                            <div
                                key={device.id}
                                className="flex flex-col rounded-md border-b border-gray-200 bg-slate-300 px-4 py-2"
                            >
                                <div className="flex items-center justify-between">
                                    <div className="flex items-center space-x-2">
                                        <DevicePhoneMobileIcon className="inline-block h-5 w-5" />
                                        <p
                                            className="line-clamp-2 break-all text-sm text-gray-500 sm:max-w-[200px]"
                                            title={deviceDescription}
                                        >
                                            {name}
                                        </p>
                                    </div>
                                    <div className="flex items-center space-x-2">
                                        <p
                                            className="text-sm text-gray-500"
                                            title="Created at"
                                        >
                                            {device.created_at
                                                ? new Date(
                                                      device.created_at
                                                  ).toLocaleString()
                                                : "Unknown"}
                                        </p>
                                        {device.root && (
                                            <div className="flex items-center space-x-2">
                                                <p title="Device that created the account">
                                                    Root
                                                </p>
                                            </div>
                                        )}
                                    </div>
                                </div>
                                <div className="mt-2 flex items-center space-x-2">
                                    {device.userAgent && device.ip ? (
                                        <>
                                            <p
                                                className="line-clamp-2 text-ellipsis text-sm text-gray-500"
                                                title="User agent"
                                            >
                                                {device.userAgent}
                                            </p>
                                            <p
                                                className="text-sm text-gray-500"
                                                title="IP address"
                                            >
                                                {device.ip}
                                            </p>
                                        </>
                                    ) : (
                                        <p className="text-sm text-gray-500">
                                            Device does not have an active
                                            session.
                                        </p>
                                    )}
                                </div>
                                <div
                                    className={clsx({
                                        "mt-2 flex justify-start space-x-2":
                                            true,
                                        hidden:
                                            session?.user?.accountID ===
                                            device.id,
                                    })}
                                >
                                    <ButtonFlat
                                        text="Remove"
                                        onClick={async () =>
                                            await tempRmFn(device.deviceID)
                                        }
                                        disabled={
                                            ongoingOperation ||
                                            session?.user?.accountID ===
                                                device.id
                                        }
                                    ></ButtonFlat>
                                </div>
                            </div>
                        );
                    })}
                </div>
            </div>
        );
    };

    return (
        <GenericModal
            key="account-management-modal"
            visibleState={[isVisible, setIsVisible]}
        >
            <Body>
                <div className="flex flex-col items-center text-center">
                    <p className="text-2xl font-bold text-gray-900">
                        Account Management
                    </p>

                    {hasDataLoadingError && (
                        <div className="mt-2 flex w-full flex-col items-center text-left">
                            <p className="line-clamp-2 text-left text-base text-gray-600">
                                There was an error loading your account
                                information.
                            </p>
                            <p className="line-clamp-2 text-left text-base text-gray-600">
                                Please try again later.
                            </p>
                        </div>
                    )}

                    {!hasDataLoadingError && (
                        <div className="mt-2 flex w-full flex-col text-left">
                            <div className="mt-4 rounded-lg bg-gray-100 p-4">
                                <p className="text-lg font-bold text-slate-800">
                                    Account
                                </p>
                                <Account />
                            </div>

                            <div className="mt-4 rounded-lg bg-gray-100 p-4">
                                <p className="text-lg font-bold text-slate-800">
                                    Subscription
                                </p>
                                <SubscriptionMenu />
                            </div>

                            <div className="mt-4 rounded-lg bg-gray-100 p-4">
                                <p className="text-lg font-bold text-slate-800">
                                    Registered Devices
                                </p>
                                <RegisteredDevices />
                            </div>

                            <div className="mt-4 rounded-lg bg-gray-100 p-4">
                                <p className="text-lg font-bold text-slate-800">
                                    General
                                </p>
                                <div className="mt-2 flex flex-col">
                                    {!session?.user?.isRoot && (
                                        // Only the root device can delete the account
                                        <p className="my-2 text-base text-gray-600">
                                            You can only delete your account
                                            when you are using the root device.
                                        </p>
                                    )}
                                    <ButtonFlat
                                        type={ButtonType.Secondary}
                                        text="Delete User Account"
                                        onClick={deleteUserAccount}
                                        disabled={
                                            ongoingOperation ||
                                            !session?.user?.isRoot
                                        }
                                    ></ButtonFlat>
                                </div>
                            </div>

                            {/* Overlay that is active if the session is null */}
                            <div
                                className={clsx({
                                    "absolute inset-0 items-center justify-center backdrop-blur-sm":
                                        true,
                                    flex: !session,
                                    hidden: session,
                                })}
                            >
                                <div className="flex flex-col items-center justify-center space-y-2 text-center">
                                    <p className="text-lg font-bold text-slate-800">
                                        You are not signed in
                                    </p>
                                    <p className="text-base text-slate-600">
                                        You need to be signed in and online to
                                        manage your account.
                                    </p>
                                </div>
                            </div>
                        </div>
                    )}
                </div>
            </Body>

            <Footer className="flex space-y-3 sm:space-x-5 sm:space-y-0">
                {/* Explicitly added flex to make sure the z-index works on <sm */}
                <ButtonFlat
                    text="Close"
                    className="z-10" // Make sure the button is clickable even if the overlay is active
                    type={ButtonType.Secondary}
                    onClick={() => setIsVisible(false)}
                    disabled={ongoingOperation}
                />
            </Footer>
        </GenericModal>
    );
};

const RecoveryGenerationDialog: React.FC<{
    showDialogFnRef: React.MutableRefObject<(() => void) | null>;
}> = ({ showDialogFnRef }) => {
    const [isVisible, setIsVisible] = useState(false);
    showDialogFnRef.current = () => setIsVisible(true);

    const hideDialog = () => {
        setIsVisible(false);

        setTimeout(() => {
            setShowRecoveryPhrase(false);
            setRecoveryPhrase("");
            setUserId("");
        }, DIALOG_BLUR_TIME);
    };

    const { update: refreshSessionData } = useSession();

    const [showRecoveryPhrase, setShowRecoveryPhrase] = useState(false);
    const [userId, setUserId] = useState<string>("");
    const [recoveryPhrase, setRecoveryPhrase] = useState<string>("");

    const {
        mutateAsync: _generateRecoveryPhrase,
        isLoading: isGeneratingRecoveryPhrase,
    } = trpc.credentials.generateRecoveryToken.useMutation();

    const generateRecoveryPhrase = async () => {
        toast.info("Generating recovery phrase...", {
            toastId: "recovery-generation-toast",
            updateId: "recovery-generation-toast",
            closeButton: false,
            autoClose: false,
        });

        try {
            const payload = await _generateRecoveryPhrase();

            // toast.success("");
            toast.update("recovery-generation-toast", {
                autoClose: 1000,
                closeButton: true,
            });

            // Show the recovery phrase UI
            setRecoveryPhrase(payload.token);
            setUserId(payload.userId);
            setShowRecoveryPhrase(true);

            // Refresh the session data
            await refreshSessionData();
        } catch (error) {
            if (error instanceof TRPCClientError) {
                console.error(error.message);
            } else {
                console.error("Error while generating recovery phrase:", error);
            }
            toast.error(
                "An error occurred while generating the recovery phrase. Please try again later.",
                {
                    toastId: "recovery-generation-toast",
                    updateId: "recovery-generation-toast",
                    closeButton: true,
                    autoClose: 3000,
                }
            );
        }
    };

    return (
        <GenericModal
            key="recovery-generation-modal"
            inhibitDismissOnClickOutside={
                isGeneratingRecoveryPhrase || showRecoveryPhrase
            }
            visibleState={[isVisible, hideDialog]}
        >
            <Body className="flex w-full flex-col items-center gap-3">
                <p className="text-center text-2xl font-bold text-gray-900">
                    Recovery Phrase Generation
                </p>

                {!showRecoveryPhrase ? (
                    <div className="flex flex-col items-center gap-3">
                        <p className="text-base text-gray-600">
                            Generate a recovery phrase to regain access to your
                            account in case you lose access to your vault.
                        </p>
                        <p className="text-base text-gray-600">
                            It is recommended to write down the recovery phrase
                            and the user ID then store it in a safe place.
                        </p>
                    </div>
                ) : (
                    <div className="flex flex-col items-center gap-3">
                        <div className="flex w-full flex-col gap-3">
                            <p className="text-base text-gray-600">
                                Your user ID is:
                            </p>
                            <div className="rounded bg-slate-300 p-3">
                                <p className="font-mono text-base text-gray-600">
                                    {userId}
                                </p>
                            </div>
                        </div>

                        <div className="flex w-full flex-col gap-3">
                            <p className="text-base text-gray-600">
                                Your recovery phrase is:
                            </p>
                            <div className="rounded bg-slate-300 p-3">
                                <p className="font-mono text-base text-gray-600">
                                    {recoveryPhrase}
                                </p>
                            </div>
                        </div>
                        <p className="text-base text-gray-600">
                            By pressing &quot;Done&quot; you confirm that you
                            have written down the shown information and stored
                            it in a safe place. This is the only time the
                            recovery information will be shown.
                        </p>
                    </div>
                )}
            </Body>

            <Footer className="space-y-3 sm:space-x-5 sm:space-y-0">
                <ButtonFlat
                    text={showRecoveryPhrase ? "Done" : "Generate"}
                    className="sm:ml-2"
                    onClick={
                        showRecoveryPhrase ? hideDialog : generateRecoveryPhrase
                    }
                    disabled={isGeneratingRecoveryPhrase}
                    loading={isGeneratingRecoveryPhrase}
                />
                <ButtonFlat
                    text="Close"
                    type={ButtonType.Secondary}
                    onClick={hideDialog}
                    disabled={isGeneratingRecoveryPhrase || showRecoveryPhrase}
                />
            </Footer>
        </GenericModal>
    );
};

const AccountHeaderWidget: React.FC<{
    showAccountSignUpSignInDialog: () => void;
    showWarningDialogFn: WarningDialogShowFn;
    showRecoveryGenerationDialogFnRef: React.MutableRefObject<
        (() => void) | null
    >;
}> = ({
    showAccountSignUpSignInDialog,
    showWarningDialogFn,
    showRecoveryGenerationDialogFnRef,
}) => {
    const { data: session, status: sessionStatus } = useSession();
    const unlockedVaultMetadata = useAtomValue(unlockedVaultMetadataAtom);
    const unlockedVault = useAtomValue(unlockedVaultAtom);

    const showAccountDialogFnRef = useRef<() => void>(() => {
        // Do nothing
    });

    const { refs, floatingStyles } = useFloating({
        placement: "bottom-end",
    });

    const {
        data: subscriptionData,
        isLoading: isSubscriptionDataLoading,
        isError: hasSubscriptionDataError,
    } = trpc.payment.getSubscription.useQuery(undefined, {
        refetchOnWindowFocus: false,
        enabled:
            !!session &&
            !!unlockedVault &&
            unlockedVault.OnlineServices.isBound(),
    });

    const signOutCallback = () => {
        if (!unlockedVaultMetadata || !unlockedVault) return;

        showWarningDialogFn(
            `You are about to sign out and lose access to online services. This will unbind the account from your vault. \
            Make sure you have generated a account recovery phrase in the Account dialog. \
            You can use that recovery phrase to regain access to your account after signing out.`,
            async () =>
                await unbindAccountFromVault(
                    unlockedVaultMetadata,
                    unlockedVault
                ),
            null
        );
    };

    // This should not happed, but if it does, sign out the user
    // if (!session && unlockedVault) {
    //     signOut({ redirect: false });
    // }
    if (!unlockedVault || !unlockedVault.OnlineServices.isBound()) {
        return (
            <button
                className="group flex cursor-pointer items-center justify-center gap-2 rounded-md border border-slate-700 p-1 px-3 text-base font-medium text-white transition-colors hover:bg-slate-800 hover:text-opacity-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-opacity-75"
                onClick={showAccountSignUpSignInDialog}
            >
                <div className="text-center">
                    <p className="text-slate-50">Not Signed In</p>
                    <p className="text-slate-400">Log in to continue</p>
                </div>
            </button>
        );
    }

    return (
        <>
            <Popover className="relative">
                {({ open }) => {
                    const popoverButtonClasses = clsx({
                        "text-opacity-90": open,
                        "group flex items-center justify-center rounded-md text-base font-medium text-white hover:text-opacity-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-opacity-75":
                            true,
                    });
                    return (
                        <>
                            <Popover.Button
                                ref={refs.setReference}
                                className={popoverButtonClasses}
                            >
                                <div className="flex cursor-pointer items-center gap-2 rounded-lg p-1 px-2 transition-colors hover:bg-slate-800">
                                    <div className="flex flex-col text-right">
                                        {session && (
                                            <>
                                                <p
                                                    className="max-w-[200px] truncate capitalize text-slate-50"
                                                    title={
                                                        session.user?.name ?? ""
                                                    }
                                                >
                                                    {session.user?.name}
                                                </p>
                                                <p
                                                    className="max-w-[200px] truncate text-slate-400"
                                                    title={
                                                        session.user?.email ??
                                                        ""
                                                    }
                                                >
                                                    {session.user?.email}
                                                </p>
                                            </>
                                        )}

                                        {!session &&
                                            sessionStatus ===
                                                "unauthenticated" && (
                                                <div className="text-center">
                                                    <p className="max-w-xs truncate capitalize text-slate-50">
                                                        Not Authenticated
                                                    </p>
                                                    <p className="max-w-xs truncate text-slate-400">
                                                        Failed to authenticate
                                                    </p>
                                                </div>
                                            )}

                                        {!session &&
                                            sessionStatus === "loading" && (
                                                <p className="max-w-xs truncate text-slate-400">
                                                    Authenticating...
                                                </p>
                                            )}
                                    </div>
                                    <div
                                        className={clsx({
                                            "flex items-center justify-center rounded-md border border-slate-500 px-3 py-3 text-sm":
                                                true,
                                            "text-yellow-500": [
                                                "loading",
                                            ].includes(sessionStatus),
                                            "text-green-500": [
                                                "authenticated",
                                            ].includes(sessionStatus),
                                            "text-red-500": [
                                                "unauthenticated",
                                            ].includes(sessionStatus),
                                        })}
                                        title={
                                            sessionStatus === "loading"
                                                ? "Authenticating..."
                                                : sessionStatus ===
                                                  "authenticated"
                                                ? "Authenticated"
                                                : sessionStatus ===
                                                  "unauthenticated"
                                                ? "Disconnected"
                                                : ""
                                        }
                                    >
                                        <WifiIcon className="h-5 w-5 text-inherit" />
                                    </div>
                                </div>
                            </Popover.Button>
                            <Transition
                                as={Fragment}
                                enter="transition ease-out duration-200"
                                enterFrom="opacity-0 translate-y-1"
                                enterTo="opacity-100 translate-y-0"
                                leave="transition ease-in duration-150"
                                leaveFrom="opacity-100 translate-y-0"
                                leaveTo="opacity-0 translate-y-1"
                            >
                                <Popover.Panel
                                    ref={refs.setFloating}
                                    style={floatingStyles}
                                    className="z-10 w-[200px] max-w-md px-4 sm:px-0"
                                >
                                    <div className="divide-y divide-slate-800/60 overflow-hidden rounded-lg shadow-lg ring-1 ring-black ring-opacity-5">
                                        <div
                                            className={clsx({
                                                "flex-col gap-4 bg-slate-700 p-4":
                                                    true,
                                                flex: session,
                                                hidden: !session,
                                            })}
                                        >
                                            {/* Display the pill for the users tier */}
                                            <div
                                                className={clsx({
                                                    "flex items-center gap-4 rounded-sm":
                                                        true,
                                                    "opacity-50":
                                                        isSubscriptionDataLoading,
                                                })}
                                            >
                                                <p className="text-sm font-semibold">
                                                    Current Tier
                                                </p>
                                                <p className="rounded-lg border border-slate-500 px-2 py-1 text-xs text-slate-50">
                                                    {
                                                        subscriptionData?.product_name
                                                    }
                                                </p>
                                            </div>
                                            {
                                                // If the user is not subscribed, show a button to upgrade
                                                !subscriptionData?.nonFree && (
                                                    <ButtonFlat
                                                        type={
                                                            ButtonType.Primary
                                                        }
                                                        className="w-full"
                                                        text="Upgrade"
                                                        onClick={
                                                            navigateToCheckout
                                                        }
                                                    />
                                                )
                                            }
                                        </div>
                                        <div className="relative grid gap-8 bg-slate-700 p-4">
                                            <a
                                                href="#"
                                                onClick={
                                                    showAccountDialogFnRef.current
                                                }
                                                className="-m-3 flex items-center rounded-lg p-2 transition duration-150 ease-in-out hover:bg-gray-800 focus:outline-none focus-visible:ring focus-visible:ring-orange-500 focus-visible:ring-opacity-50"
                                            >
                                                <div className="ml-4">
                                                    <p className="text-sm font-medium text-gray-200">
                                                        Account
                                                    </p>
                                                </div>
                                            </a>
                                        </div>
                                        <div className="bg-slate-700 p-4">
                                            <ButtonFlat
                                                className="text-slate-200 sm:w-full"
                                                type={ButtonType.Secondary}
                                                text="Sign Out"
                                                // This is used because we can't get to the warning dialog from here
                                                onClick={signOutCallback}
                                            />
                                        </div>
                                    </div>
                                </Popover.Panel>
                            </Transition>
                        </>
                    );
                }}
            </Popover>
            <AccountDialog
                showDialogFnRef={showAccountDialogFnRef}
                showWarningDialogFn={showWarningDialogFn}
                showRecoveryGenerationDialogFnRef={
                    showRecoveryGenerationDialogFnRef
                }
                subscriptionData={subscriptionData}
                dataLoading={isSubscriptionDataLoading}
                hasDataLoadingError={hasSubscriptionDataError}
            />
        </>
    );
};

const ImportDataDialog: React.FC<{
    showDialogFnRef: React.MutableRefObject<() => void>;
}> = ({ showDialogFnRef }) => {
    const [visible, setVisible] = useState(false);
    showDialogFnRef.current = () => setVisible(true);
    const hideDialog = () => {
        setVisible(false);
        setTimeout(() => {
            resetForm();

            _setImportType(null);
            setIsOperationInProgress(false);

            selectedFileRef.current = null;
            credentialsToImportRef.current = [];

            parsedColumns.current = [];
        }, DIALOG_BLUR_TIME);
    };

    const unlockedVault = useAtomValue(unlockedVaultAtom);
    const setUnlockedVault = useSetAtom(unlockedVaultWriteOnlyAtom);
    const unlockedVaultMetadata = useAtomValue(unlockedVaultMetadataAtom);

    const {
        register,
        reset: resetForm,
        handleSubmit,
        formState: { errors },
    } = useForm<Import.FieldsSchemaType>({
        resolver: zodResolver(Import.FieldsSchema),
        defaultValues: {
            Name: "",
            Username: "",
            Password: "",
            TOTP: "",
            Tags: "",
            URL: "",
            Notes: "",
            DateCreated: "",
            DateModified: "",
            DatePasswordChanged: "",
            TagDelimiter: ",",
        },
    });

    const [importType, _setImportType] = useState<Import.Type | null>(null);
    const [isOperationInProgress, setIsOperationInProgress] = useState(false);

    const selectedFileRef = useRef<File | null>(null);
    const credentialsToImportRef = useRef<
        Credential.CredentialFormSchemaType[]
    >([]);

    // CSV import
    const fileInputRef = useRef<HTMLInputElement>(null);
    const columnMatchingFormRef = useRef<HTMLFormElement>(null);
    const parsedColumns = useRef<string[]>([]);

    const importCredentials = async (
        credentials: Credential.CredentialFormSchemaType[],
        groups: GroupSchemaType[] = []
    ) => {
        // Add the credentials to the vault
        const vault = unlockedVault;

        if (!vault) {
            console.error("No vault to import into.");
            return;
        }

        groups.forEach((group) => {
            vault.upsertGroup(group);
        });
        for (const credential of credentials) {
            await vault.upsertCredential(credential);
        }
        unlockedVaultMetadata?.save(vault);

        setUnlockedVault(async () => vault);

        toast.success(
            `Successfully imported ${credentials.length} credentials.`
        );

        hideDialog();
    };

    /**
     * Prepares the import for the selected type.
     * The functions themselves are responsible for setting the import type at the appropriate time.
     */
    const setImportType = async (type: Import.Type | null) => {
        if (isOperationInProgress) return;

        if (type == Import.Type.GenericCSV) {
            await prepareGenericCSVImport();
        } else if (type == Import.Type.Bitwarden) {
            await parseBitwardenExport();
            // } else if (type == Import.Type.KeePass2) {
        }
    };

    const prepareGenericCSVImport = async () => {
        // Bring up the file picker
        const fileData = await openFilePicker(fileInputRef);

        selectedFileRef.current = fileData;

        // Try to parse the first line to get the column names
        Import.CSVGetColNames(
            fileData,
            (columnNames) => {
                if (columnNames.length) {
                    // Set the column names as the possible fields in the dropdowns
                    // Also add an empty option to the dropdowns
                    columnNames.push("");
                    parsedColumns.current = columnNames;

                    _setImportType(Import.Type.GenericCSV);
                } else {
                    toast.warn("CSV file doesn't contain any data.");
                }
            },
            (error) => {
                console.error("Error parsing CSV file", error);
                toast.error(
                    "Failed to extract column names from CSV file. More details in the console."
                );
            }
        );
    };

    const submitGenericCSVImport = async (
        formData: Import.FieldsSchemaType
    ) => {
        if (isOperationInProgress || !selectedFileRef.current) return;
        setIsOperationInProgress(true);

        console.debug("CSV import form data:", formData);
        try {
            await Import.CSV(
                selectedFileRef.current,
                formData,
                async (credentials) => {
                    console.debug("Import result", credentials);

                    if (credentials.length) {
                        await importCredentials(credentials);
                    } else {
                        toast.warn("CSV file doesn't contain any data.");
                    }

                    setIsOperationInProgress(false);
                },
                (error) => {
                    console.error("Error importing CSV file", error);
                    toast.error(
                        "Failed to import CSV file. More details in the console."
                    );
                    setIsOperationInProgress(false);
                }
            );
        } catch (error) {
            console.error(
                "Fatal error while parsing the provided CSV file",
                error
            );
            toast.error(
                "Failed to parse CSV file. More details in the console."
            );
        }
    };

    const parseBitwardenExport = async () => {
        // Bring up the file picker
        const fileData = await openFilePicker(fileInputRef);

        selectedFileRef.current = fileData;

        setIsOperationInProgress(true);

        try {
            const { credentials, groups } = await Import.BitwardenJSON(
                fileData
            );

            if (credentials.length) {
                await importCredentials(credentials, groups);
            } else {
                toast.warn("Bitwarden export file doesn't contain any data.");
            }
        } catch (error) {
            console.error("Error importing Bitwarden JSON file", error);
            toast.error(
                "Failed to import Bitwarden JSON file. More details in the console."
            );
        }
        setIsOperationInProgress(false);
    };

    return (
        <GenericModal
            visibleState={[
                visible,
                () =>
                    !isOperationInProgress
                        ? hideDialog()
                        : () => {
                              // No-op
                          },
            ]}
        >
            <Body className="flex w-full flex-col items-center gap-3">
                <div className="">
                    <p className="text-2xl font-bold text-gray-900">Import</p>
                </div>
                {
                    // If the import type is not selected, show the selection screen
                    importType == null && (
                        <div className="flex w-full flex-col">
                            <p className="mb-2 text-center text-base text-gray-600">
                                Select the type of data you want to import into
                                this vault.
                            </p>

                            <BlockWideButton
                                icon={
                                    <TableCellsIcon className="h-5 w-5 text-gray-900" />
                                }
                                iconCaption="Generic - CSV"
                                description="Import data from a CSV file"
                                onClick={() =>
                                    setImportType(Import.Type.GenericCSV)
                                }
                                disabled={isOperationInProgress}
                            />

                            <BlockWideButton
                                icon={
                                    <DocumentTextIcon className="h-5 w-5 text-gray-900" />
                                }
                                iconCaption="Bitwarden - JSON"
                                description="Import data from a Bitwarden export file (Unencrypted)"
                                onClick={() =>
                                    setImportType(Import.Type.Bitwarden)
                                }
                                disabled={isOperationInProgress}
                            />
                            {/* 
                            <BlockWideButton
                                icon={
                                    <DocumentTextIcon className="h-5 w-5 text-gray-900" />
                                }
                                iconCaption="KeePass 2"
                                description="Import data from a KeePass 2 export file"
                                onClick={() =>
                                    setImportType(Import.Type.KeePass2)
                                }
                                disabled={isOperationInProgress}
                            /> */}
                        </div>
                    )
                }
                {
                    // If the import type is selected, show the import screen
                    importType == Import.Type.GenericCSV && (
                        <div className="flex w-full flex-col overflow-hidden">
                            <p className="mb-2 text-center text-base text-gray-600">
                                Approximately match the values in the select
                                boxes to the labels above them.
                            </p>
                            <p className="mb-2 text-center text-base text-gray-600">
                                Note: If you leave a select box empty, the
                                corresponding field will not be imported.
                            </p>
                            <form
                                ref={columnMatchingFormRef}
                                onSubmit={handleSubmit(submitGenericCSVImport)}
                                className="flex w-full flex-wrap justify-between gap-2"
                            >
                                {Import.PossibleFields.map(
                                    ({ fieldText, field }, index) => (
                                        <div key={index} className="w-[45%]">
                                            <label className="text-gray-600">
                                                {fieldText}
                                            </label>
                                            <FormSelectboxField
                                                options={parsedColumns.current}
                                                register={register(field)}
                                            />
                                        </div>
                                    )
                                )}

                                <div className="mt-2 flex w-full flex-col rounded border border-gray-200 p-2">
                                    <p className="mb-2 text-2xl text-gray-600">
                                        Additional Configuration
                                    </p>
                                    <label className="text-gray-600">
                                        Tag Delimiter
                                    </label>
                                    <input
                                        type="text"
                                        className="mt-1 rounded-md bg-gray-200 px-4 py-2 text-gray-900"
                                        {...register("TagDelimiter")}
                                    />
                                </div>
                                {errors.root?.message && (
                                    <p>{errors.root?.message}</p>
                                )}
                            </form>
                        </div>
                    )
                }
                {importType != null && importType != Import.Type.GenericCSV && (
                    <div className="flex w-full flex-col"></div>
                )}
                <div className="hidden">
                    <input type="file" ref={fileInputRef} accept=".csv,.json" />
                </div>
            </Body>
            <Footer className="space-y-3 sm:space-x-5 sm:space-y-0">
                {importType === Import.Type.GenericCSV && (
                    <ButtonFlat
                        text="Import"
                        className="sm:ml-2"
                        onClick={() =>
                            columnMatchingFormRef.current?.requestSubmit()
                        }
                        disabled={isOperationInProgress}
                        loading={isOperationInProgress}
                    />
                )}
                <ButtonFlat
                    text="Close"
                    type={ButtonType.Secondary}
                    onClick={hideDialog}
                    disabled={isOperationInProgress}
                />
            </Footer>
        </GenericModal>
    );
};

const VaultSettingsDialog: React.FC<{
    showDialogFnRef: React.MutableRefObject<() => void>;
    showWarningDialog: WarningDialogShowFn;
}> = ({ showDialogFnRef, showWarningDialog }) => {
    const [visibleState, setVisibleState] = useState(false);
    const hideDialog = (force?: boolean) => {
        const hide = () => {
            setVisibleState(false);
        };

        if (force) {
            hide();
        } else {
            // If the form is dirty, show a warning dialog
            // if (isDirty) {
            //     const confirm = window.confirm(
            //         "Are you sure you want to discard your changes?"
            //     );

            //     if (confirm) {
            //         hide();
            //     }
            // } else {
            hide();
            // }
        }
    };
    showDialogFnRef.current = () => {
        setVisibleState(true);
    };

    const [isLoading, setIsLoading] = useState(false);

    const vaultMetadata = useAtomValue(unlockedVaultMetadataAtom);
    const unlockedVault = useAtomValue(unlockedVaultAtom);
    const setUnlockedVault = useSetAtom(unlockedVaultAtom);

    const importDataDialogShowFnRef = useRef<() => void>(() => {
        // No-op
    });

    const clearSyncList = () => {
        // Show a confirmation dialog
        showWarningDialog(
            `You are about to clear the sync list. This has to be done manually on all linked devices while disconnected from one another.`,
            () => {
                // Clear the sync list
                setIsLoading(true);
                setUnlockedVault((prev) => {
                    if (prev != null) {
                        prev.purgeDiffList();
                    }
                    return prev;
                });
                setIsLoading(false);

                toast.success("Synchronization list cleared.");
            },
            null
        );
    };

    const showImportDataDialog = () => importDataDialogShowFnRef.current();

    const manualVaultBackup = async () => {
        setIsLoading(true);

        // Wait for a bit so that we can trigger the loading state
        await new Promise((resolve) => setTimeout(resolve, 100));

        toast.info("Backing up vault...", {
            autoClose: false,
            closeButton: false,
            updateId: "backup-vault",
            toastId: "backup-vault",
        });

        try {
            if (!vaultMetadata || vaultMetadata.Blob == null) {
                throw new Error("Vault metadata or blob cannot be null.");
            }

            await Backup.trigger(
                Backup.Type.Manual,
                unlockedVault,
                vaultMetadata.Blob
            );

            toast.success("Vault backup complete", {
                autoClose: 3000,
                closeButton: true,
                updateId: "backup-vault",
                toastId: "backup-vault",
            });
        } catch (e) {
            console.error("Failed to backup vault", e);
            toast.error("An error occured while backing up the vault", {
                autoClose: 3000,
                closeButton: true,
                updateId: "backup-vault",
                toastId: "backup-vault",
            });
        }

        setIsLoading(false);
    };

    if (!vaultMetadata) {
        return null;
    }

    return (
        <>
            <GenericModal
                key="vault-settings-modal"
                visibleState={[visibleState, () => hideDialog()]}
            >
                <Body>
                    <div className="flex flex-col items-center text-center">
                        <p className="text-2xl font-bold text-gray-900">
                            Vault Settings
                        </p>

                        <div className="mt-2 flex w-full flex-col items-center text-left">
                            <p
                                className="line-clamp-2 text-left text-base text-gray-600"
                                title={vaultMetadata.Name}
                            >
                                Name: <b>{vaultMetadata.Name}</b>
                            </p>
                            <p className="text-left text-base text-gray-600">
                                Created:{" "}
                                <b>
                                    {new Date(
                                        vaultMetadata.CreatedAt
                                    ).toLocaleDateString()}
                                </b>
                            </p>
                        </div>
                        <div className="flex w-full flex-col text-left">
                            <div className="mt-4 rounded-lg bg-gray-100 p-4">
                                <p className="text-lg font-bold text-slate-800">
                                    Synchronization
                                </p>
                                <p className="mt-2 text-base text-gray-600">
                                    Clear the synchronization list to remedy any
                                    synchronization issues or to decrease the
                                    vault size. This has to be done on all
                                    linked devices manually.
                                </p>
                                <div className="mt-4 flex flex-col sm:flex-row sm:items-center sm:justify-between">
                                    <ButtonFlat
                                        text="Clear Synchronization List"
                                        type={ButtonType.Secondary}
                                        onClick={clearSyncList}
                                        disabled={isLoading}
                                    />
                                </div>
                            </div>
                            <div className="mt-4 rounded-lg bg-gray-100 p-4">
                                <p className="text-lg font-bold text-slate-800">
                                    Import
                                </p>
                                <p className="mt-2 text-base text-gray-600">
                                    Import data from third-party applications.
                                </p>
                                <div className="mt-4 flex flex-col sm:flex-row sm:items-center sm:justify-between">
                                    <ButtonFlat
                                        text="Import Data"
                                        type={ButtonType.Secondary}
                                        onClick={showImportDataDialog}
                                        disabled={isLoading}
                                    />
                                </div>
                            </div>
                            <div className="mt-4 rounded-lg bg-gray-100 p-4">
                                <p className="text-lg font-bold text-slate-800">
                                    Backup
                                </p>
                                <p className="mt-2 text-base text-gray-600">
                                    You can backup your vault by exporting it as
                                    an encrypted JSON file. This file can be
                                    imported on another device or browser to
                                    restore your vault there.
                                </p>
                                <div className="mt-4 flex flex-col sm:flex-row sm:items-center sm:justify-between">
                                    <ButtonFlat
                                        text="Manual Backup"
                                        type={ButtonType.Secondary}
                                        onClick={manualVaultBackup}
                                        disabled={isLoading}
                                    />
                                </div>
                            </div>
                            <div className="mt-4 rounded-lg bg-gray-100 p-4 opacity-50">
                                <p className="text-lg font-bold text-slate-800">
                                    Encryption
                                </p>
                                <p className="mt-2 text-base text-gray-600">
                                    You can change the encryption key or the
                                    algorithm used to encrypt your vault. This
                                    will re-encrypt your vault with the new
                                    settings.
                                </p>
                                <div className="mt-4 flex flex-col sm:flex-row sm:items-center sm:justify-between">
                                    <ButtonFlat
                                        text="Change Encryption Key"
                                        type={ButtonType.Secondary}
                                        onClick={() => {
                                            // TODO
                                        }}
                                        // disabled={isLoading}
                                        disabled={true}
                                    />
                                    <ButtonFlat
                                        text="Change Encryption Algorithm"
                                        type={ButtonType.Secondary}
                                        onClick={() => {
                                            // TODO
                                        }}
                                        // disabled={isLoading}
                                        disabled={true}
                                    />
                                </div>
                            </div>
                        </div>
                    </div>
                </Body>

                <Footer className="space-y-3 sm:space-x-5 sm:space-y-0">
                    {/* <ButtonFlat
                        text="Save"
                        className="sm:ml-2"
                        type={ButtonType.Primary}
                        onClick={handleSubmit(onSubmit)}
                        disabled={isSubmitting || isLoading || !isDirty}
                    /> */}
                    <ButtonFlat
                        text="Close"
                        type={ButtonType.Secondary}
                        onClick={() => hideDialog()}
                        // disabled={isSubmitting || isLoading}
                        disabled={isLoading}
                    />
                </Footer>
            </GenericModal>
            <ImportDataDialog showDialogFnRef={importDataDialogShowFnRef} />
        </>
    );
};

const TOTPDialog: React.FC<{
    visibleState: [boolean, React.Dispatch<React.SetStateAction<boolean>>];
    submitCallback: (formData: Credential.TOTPFormSchemaType) => Promise<void>;
}> = ({ visibleState, submitCallback }) => {
    const {
        handleSubmit,
        control,
        formState: { errors, isDirty },
        reset: resetForm,
    } = useForm<Credential.TOTPFormSchemaType>({
        resolver: zodResolver(Credential.totpFormSchema),
        defaultValues: {
            Label: "",
            Issuer: "",
            Secret: "",
            Period: Credential.PERIOD_DEFAULT,
            Digits: Credential.DIGITS_DEFAULT,
            Algorithm: Credential.ALGORITHM_DEFAULT,
        },
    });

    const hideDialog = async (force = false) => {
        const hide = () => {
            visibleState[1](false);

            setTimeout(() => {
                resetForm();
            }, DIALOG_BLUR_TIME);
        };

        // Check if the form has been modified (only if we are not forcing)
        if (isDirty && !force) {
            // If it has, ask the user if they want to discard the changes
            if (confirm("Are you sure you want to discard your changes?")) {
                hide();
            }
        } else {
            // If not, just hide the modal
            hide();
        }
    };

    const onSubmit = async (formData: Credential.TOTPFormSchemaType) => {
        await submitCallback(formData);
        hideDialog(true);
    };

    return (
        <GenericModal
            key="credentials-totp-modal"
            visibleState={[visibleState[0], () => hideDialog()]}
        >
            <Body>
                <div className="flex flex-col items-center text-center">
                    <p className="text-2xl font-bold text-gray-900">
                        TOTP Configuration
                    </p>

                    {/* <p className="mt-2 text-left text-base text-gray-600">
                        Name: <b>{vaultMetadata.Name}</b>
                        <br />
                        Created:{" "}
                        <b>{vaultMetadata.CreatedAt.toLocaleDateString()}</b>
                    </p> */}
                    <div className="flex w-full flex-col text-left">
                        <div className="mt-2 flex flex-col">
                            <Controller
                                control={control}
                                name="Label"
                                render={({
                                    field: { onChange, onBlur, value },
                                }) => (
                                    <>
                                        <label className="text-gray-600">
                                            Label *
                                        </label>
                                        <input
                                            type="text"
                                            autoCapitalize="sentences"
                                            placeholder="e.g. test@test.com, etc."
                                            className="mt-1 flex-grow rounded-md bg-gray-200 px-4 py-2 text-gray-900 placeholder-gray-400"
                                            onChange={onChange}
                                            onBlur={onBlur}
                                            value={value}
                                        />
                                    </>
                                )}
                            />
                            {errors.Label && (
                                <p className="text-red-500">
                                    {errors.Label.message}
                                </p>
                            )}
                        </div>

                        <div className="mt-2 flex flex-col">
                            <Controller
                                control={control}
                                name="Issuer"
                                render={({
                                    field: { onChange, onBlur, value },
                                }) => (
                                    <>
                                        <label className="text-gray-600">
                                            Issuer
                                        </label>
                                        <input
                                            type="text"
                                            autoCapitalize="sentences"
                                            placeholder="e.g. Google, GitHub, etc."
                                            className="mt-1 flex-grow rounded-md bg-gray-200 px-4 py-2 text-gray-900 placeholder-gray-400"
                                            onChange={onChange}
                                            onBlur={onBlur}
                                            value={value}
                                        />
                                    </>
                                )}
                            />
                            {errors.Issuer && (
                                <p className="text-red-500">
                                    {errors.Issuer.message}
                                </p>
                            )}
                        </div>

                        <div className="mt-2 flex flex-col">
                            <Controller
                                control={control}
                                name="Secret"
                                render={({
                                    field: { onChange, onBlur, value },
                                }) => (
                                    <>
                                        <label className="text-gray-600">
                                            Secret *
                                        </label>
                                        <input
                                            type="text"
                                            autoCapitalize="none"
                                            className="mt-1 flex-grow rounded-md bg-gray-200 px-4 py-2 text-gray-900"
                                            onChange={onChange}
                                            onBlur={onBlur}
                                            value={value}
                                        />
                                    </>
                                )}
                            />
                            {errors.Secret && (
                                <p className="text-red-500">
                                    {errors.Secret.message}
                                </p>
                            )}
                        </div>
                        <div className="mt-2 flex flex-col">
                            <Controller
                                control={control}
                                name="Period"
                                render={({
                                    field: { onChange, onBlur, value },
                                }) => (
                                    <>
                                        <label className="text-gray-600">
                                            Period *
                                        </label>
                                        <input
                                            type="number"
                                            className="mt-1 flex-grow rounded-md bg-gray-200 px-4 py-2 text-gray-900"
                                            onChange={onChange}
                                            onBlur={onBlur}
                                            value={value}
                                        />
                                    </>
                                )}
                            />
                            {errors.Period && (
                                <p className="text-red-500">
                                    {errors.Period.message}
                                </p>
                            )}
                        </div>
                        <div className="mt-2 flex flex-col">
                            <Controller
                                control={control}
                                name="Digits"
                                render={({
                                    field: { onChange, onBlur, value },
                                }) => (
                                    <>
                                        <label className="text-gray-600">
                                            Digits *
                                        </label>
                                        <input
                                            type="number"
                                            className="mt-1 flex-grow rounded-md bg-gray-200 px-4 py-2 text-gray-900"
                                            onChange={onChange}
                                            onBlur={onBlur}
                                            value={value}
                                        />
                                    </>
                                )}
                            />
                            {errors.Digits && (
                                <p className="text-red-500">
                                    {errors.Digits.message}
                                </p>
                            )}
                        </div>
                        <div className="mt-2 flex flex-col">
                            <Controller
                                control={control}
                                name="Algorithm"
                                render={({
                                    field: { onChange, onBlur, value },
                                }) => (
                                    <>
                                        <label className="text-gray-600">
                                            Algorithm *
                                        </label>
                                        <select
                                            className="mt-1 flex-grow rounded-md bg-gray-200 px-4 py-2 text-gray-900"
                                            onChange={onChange}
                                            onBlur={onBlur}
                                            value={value}
                                        >
                                            <option value="SHA1">SHA1</option>
                                            <option value="SHA256">
                                                SHA256
                                            </option>
                                            <option value="SHA512">
                                                SHA512
                                            </option>
                                        </select>
                                    </>
                                )}
                            />
                            {errors.Algorithm && (
                                <p className="text-red-500">
                                    {errors.Algorithm.message}
                                </p>
                            )}
                        </div>
                    </div>
                </div>
            </Body>

            <Footer className="space-y-3 sm:space-x-5 sm:space-y-0">
                <ButtonFlat
                    text="Save"
                    className="sm:ml-2"
                    type={ButtonType.Primary}
                    onClick={handleSubmit(onSubmit)}
                />
                <ButtonFlat
                    text="Close"
                    type={ButtonType.Secondary}
                    onClick={() => hideDialog()}
                />
            </Footer>
        </GenericModal>
    );
};

const CredentialDialog: React.FC<{
    showDialogFnRef: React.MutableRefObject<(() => void) | null>;
    selected: React.MutableRefObject<Credential.VaultCredential | undefined>;
    showCredentialsGeneratorDialogFn: React.MutableRefObject<() => void>;
    // requiredAuth?: boolean; // Not used yet, but will be used to require authentication to view credentials
}> = ({ showDialogFnRef, selected, showCredentialsGeneratorDialogFn }) => {
    const setUnlockedVault = useSetAtom(unlockedVaultWriteOnlyAtom);
    const vaultMetadata = useAtomValue(unlockedVaultMetadataAtom);
    const [isDialogVisible, setIsDialogVisible] = useState(false);
    showDialogFnRef.current = () => {
        if (selected.current) {
            const formData: Credential.CredentialFormSchemaType = {
                ID: selected.current.ID, // This means that the form is in "edit" mode
                Name: selected.current.Name,
                Username: selected.current.Username,
                Password: selected.current.Password,
                TOTP: selected.current.TOTP ?? undefined,
                Tags: selected.current.Tags,
                URL: selected.current.URL,
                Notes: selected.current.Notes,
            };

            resetForm(formData);
        }

        setIsDialogVisible(true);
    };
    const hideDialog = async (force = false) => {
        const hide = () => {
            setIsDialogVisible(false);

            // Reset the form with a delay for better UX
            setTimeout(() => {
                selected.current = undefined; // Reset the selected credential
                resetForm(defaultValues);
            }, DIALOG_BLUR_TIME);
        };

        // Check if the form has been modified (only if we are not forcing)
        if (isDirty && !force) {
            // If it has, ask the user if they want to discard the changes
            if (confirm("Are you sure you want to discard your changes?")) {
                hide();
            }
        } else {
            // If not, just hide the modal
            hide();
        }
    };

    const defaultValues: Credential.CredentialFormSchemaType = {
        ID: null, // This is set to null to indicate that this is a new credential
        Name: "",
        Username: "",
        Password: "",
        TOTP: undefined,
        Tags: "",
        URL: "",
        Notes: "",
    };

    const {
        handleSubmit,
        control,
        formState: { errors, isSubmitting, isDirty },
        reset: resetForm,
        setValue,
    } = useForm<Credential.CredentialFormSchemaType>({
        resolver: zodResolver(Credential.credentialFormSchema),
        defaultValues: defaultValues,
    });

    const TOTPDialogVisible = useState(false);
    const showTOTPDialog = () => TOTPDialogVisible[1](true);
    const setTOTPFormValue = async (form: Credential.TOTPFormSchemaType) => {
        setValue("TOTP", form, {
            shouldDirty: true,
        });
    };

    // const setUnlockedVault = useSetAtom(unlockedVaultAtom);

    const TagBox: React.FC<{
        value: string | undefined;
        onChange: (tags: string) => void;
    }> = ({ value, onChange }) => {
        const tagSeparator = Credential.TAG_SEPARATOR;

        const [inputValue, setInputValue] = useState("");
        const [inputFocused, setInputFocused] = useState(false);

        const tagInputRef = useRef<HTMLInputElement>(null);

        const tagArrayValue = value ? value.split(tagSeparator) : [];

        const addTag = (tag: string) => {
            // If the tag is empty, don't add it
            if (!tag?.length) return;

            // Remove all tag separators from the tag
            // Also, trim the tag
            tag = tag.replaceAll(tagSeparator, "").trim();

            // Transform all of the input into an array
            const tags = tagArrayValue;

            if (tags.includes(tag)) return;
            else tags.push(tag);

            onChange(tags.join(tagSeparator));
            setInputValue("");
        };

        const removeTag = (tag: string) => {
            // Remove the tag from the array
            const newTags = tagArrayValue.filter((t) => t !== tag);

            onChange(newTags.join(tagSeparator));

            // If the input is focused, focus it again
            if (inputFocused) {
                const input = tagInputRef.current as HTMLInputElement;
                input.focus();
            }

            // If the input is not focused, blur it
            if (!inputFocused) {
                const input = tagInputRef.current as HTMLInputElement;
                input.blur();
            }
        };

        const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
            if (e.key === "Enter") {
                e.preventDefault();
                addTag(inputValue);
            }
            if (e.key === "Backspace" && inputValue.length === 0) {
                const value = tagArrayValue;
                const valueToBeRemoved = value[value.length - 1];
                if (valueToBeRemoved) removeTag(valueToBeRemoved);
            }
        };

        const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
            setInputValue(e.target.value);
        };

        const handleInputFocus = () => setInputFocused(true);

        const handleInputBlur = () => setInputFocused(false);

        return (
            <div className="flex flex-row flex-wrap items-center">
                {tagArrayValue.map((tag) => (
                    <div
                        key={tag}
                        className="m-1 flex flex-row items-center rounded-full bg-gray-100 px-2 py-2"
                    >
                        <span className="text-xs text-gray-600">{tag}</span>
                        <XMarkIcon
                            className="ml-1 h-5 w-5 cursor-pointer text-gray-600"
                            aria-hidden="true"
                            onClick={() => removeTag(tag)}
                        />
                    </div>
                ))}
                <div className="mt-1 flex flex-row items-center rounded-full bg-gray-200 px-2 py-2">
                    <input
                        ref={tagInputRef}
                        className="bg-transparent text-xs text-gray-600 placeholder-gray-400 outline-none"
                        type="text"
                        value={inputValue}
                        onKeyDown={handleKeyDown}
                        onChange={handleInputChange}
                        onFocus={handleInputFocus}
                        onBlur={handleInputBlur}
                        placeholder="Add tag"
                    />
                    <PlusCircleIcon
                        className="ml-1 h-5 w-5 cursor-pointer text-gray-600"
                        aria-hidden="true"
                        onClick={() => addTag(inputValue)}
                    />
                </div>
            </div>
        );
    };

    /**
     * A component that takes in the TOTP form data and calculates the TOTP code to display with a timer
     */
    const TOTPControl: React.FC<{
        value: Credential.TOTPFormSchemaType;
        onChange: (event: Credential.TOTPFormSchemaType | null) => void;
    }> = ({ value, onChange }) => {
        const codeRef = useRef<string>("");
        const [timeLeft, setTimeLeft] = useState(0);

        // FIXME: Use the code in the TOTP class to calculate the code and time left
        const updateCode = () => {
            const totp = new OTPAuth.TOTP({
                issuer: value.Issuer,
                secret: value.Secret,
                period: value.Period,
                digits: value.Digits,
                algorithm: TOTPAlgorithm[value.Algorithm],
            });
            const code = totp.generate();

            codeRef.current = code;
        };

        const getTOTPTimeLeft = (period: number): number => {
            const now = new Date();
            const seconds = now.getSeconds();
            const timeLeft = period - (seconds % period);
            return timeLeft;
        };

        const updateTimeLeft = () => {
            const timeLeft = getTOTPTimeLeft(value.Period);
            setTimeLeft(timeLeft);
        };

        const clearTOTP = () => {
            onChange(null);
        };

        useEffect(() => {
            updateCode();
            updateTimeLeft();
        }, [value]);

        useEffect(() => {
            const interval = setInterval(() => {
                updateCode();
                updateTimeLeft();
            }, 1000);
            return () => clearInterval(interval);
        }, []);

        return (
            <div className="flex flex-row items-center">
                <div className="flex w-full flex-row items-center justify-between">
                    <div className="flex flex-col items-center">
                        <span className="text-2xl font-bold">
                            {codeRef.current}
                        </span>
                        <span className="text-xs text-gray-500">
                            {timeLeft} seconds left
                        </span>
                    </div>
                    <div className="flex flex-row items-center">
                        <ClipboardButton value={codeRef.current} />
                        <XMarkIcon
                            className="ml-1 h-5 w-5 cursor-pointer text-slate-400 hover:text-slate-500"
                            aria-hidden="true"
                            title="Remove"
                            onClick={clearTOTP}
                        />
                    </div>
                </div>
            </div>
        );
    };

    const OpenInNewTabButton = ({ value }: { value?: string }) => {
        return (
            <ArrowTopRightOnSquareIcon
                className="mx-2 h-5 w-5 flex-grow-0 cursor-pointer text-slate-400 hover:text-slate-500"
                style={{
                    display: value ? "block" : "none",
                }}
                aria-hidden="true"
                onClick={() => window.open(value, "_blank")}
            />
        );
    };

    const onSubmit = async (formData: Credential.CredentialFormSchemaType) => {
        if (!vaultMetadata) return;

        setUnlockedVault(async (prev) => {
            if (!prev) return prev;

            // Upsert the credential in the vault
            await prev?.upsertCredential(formData);
            toast.info("Saving vault data...", {
                autoClose: false,
                closeButton: false,
                toastId: "saving-vault-data",
                updateId: "saving-vault-data",
            });

            // Delay a little bit to allow the toast to update
            await new Promise((resolve) => setTimeout(resolve, 100));

            // Trigger manual vault save (TODO: This will be removed when the auto-save feature is implemented)
            try {
                await vaultMetadata.save(prev);

                toast.success("Vault data saved", {
                    autoClose: 3000,
                    closeButton: false,
                    toastId: "saving-vault-data",
                    updateId: "saving-vault-data",
                });

                // Hide the modal
                hideDialog(true);
            } catch (e) {
                console.error(`Failed to save vault data. ${e}`);
                toast.error(
                    "Failed to save vault. There is a high possibility of data loss!",
                    {
                        autoClose: 3000,
                        closeButton: false,
                        toastId: "saving-vault-data",
                        updateId: "saving-vault-data",
                    }
                );
            }

            return prev;
        });
    };

    return (
        <GenericModal
            key="credentials-modal"
            visibleState={[isDialogVisible, () => hideDialog(false)]}
        >
            <Body className="flex w-full flex-col items-center gap-3">
                <>
                    <p className="text-center text-2xl font-bold text-gray-900">
                        Credentials
                    </p>

                    {
                        // If a credential is selected, show the credential's information
                        selected.current && (
                            <p className="mt-2 break-all text-left text-base text-gray-600">
                                Name: <b>{selected.current.Name}</b>
                                <br />
                                Created at:{" "}
                                <b>
                                    {new Date(
                                        selected.current.DateCreated
                                    ).toLocaleDateString()}
                                </b>
                                {
                                    // If the credential has been modified, show the date it was modified
                                    selected.current.DateModified && (
                                        <>
                                            <br />
                                            Updated at:{" "}
                                            <b>
                                                {new Date(
                                                    selected.current.DateModified
                                                ).toLocaleDateString()}
                                            </b>
                                        </>
                                    )
                                }
                                {
                                    // If the credential has a password, show the date it was last changed
                                    selected.current.DatePasswordChanged && (
                                        <>
                                            <br />
                                            Last password change:{" "}
                                            <b>
                                                {new Date(
                                                    selected.current.DatePasswordChanged
                                                ).toLocaleDateString()}
                                            </b>
                                        </>
                                    )
                                }
                            </p>
                        )
                    }
                    <div className="flex w-full flex-col text-left">
                        <div className="mt-2 flex flex-col">
                            <Controller
                                control={control}
                                name="Name"
                                render={({
                                    field: { onChange, onBlur, value },
                                }) => (
                                    <>
                                        <label className="text-gray-600">
                                            Name *
                                        </label>
                                        <input
                                            type="text"
                                            autoCapitalize="none"
                                            className="mt-1 flex-grow rounded-md bg-gray-200 px-4 py-2 text-gray-900"
                                            onChange={onChange}
                                            onBlur={onBlur}
                                            value={value}
                                        />
                                    </>
                                )}
                            />
                            {errors.Name && (
                                <p className="text-red-500">
                                    {errors.Name.message}
                                </p>
                            )}
                        </div>
                        <div className="mt-4 flex flex-col">
                            <Controller
                                control={control}
                                name="Username"
                                render={({
                                    field: { onChange, onBlur, value, ref },
                                }) => (
                                    <>
                                        <FormInputField
                                            label="Username"
                                            type="text"
                                            autoCapitalize="none"
                                            clipboardButton={true}
                                            onChange={onChange}
                                            onBlur={onBlur}
                                            value={value}
                                        />
                                    </>
                                )}
                            />
                            {errors.Username && (
                                <p className="text-red-500">
                                    {errors.Username.message}
                                </p>
                            )}
                        </div>
                        <div className="mt-4 flex flex-col">
                            <Controller
                                control={control}
                                name="Password"
                                render={({
                                    field: { onChange, onBlur, value },
                                }) => (
                                    <>
                                        {/* <EntropyCalculator value={value} /> */}
                                        <FormInputField
                                            label="Password"
                                            type="password"
                                            autoCapitalize="none"
                                            clipboardButton={true}
                                            credentialsGeneratorFnRef={
                                                showCredentialsGeneratorDialogFn
                                            }
                                            onChange={onChange}
                                            onBlur={onBlur}
                                            value={value}
                                        />
                                    </>
                                )}
                            />
                            {errors.Password && (
                                <p className="text-red-500">
                                    {errors.Password.message}
                                </p>
                            )}
                        </div>
                        <div className="mt-4 flex flex-col">
                            <Controller
                                control={control}
                                name="TOTP"
                                render={({ field: { onChange, value } }) => (
                                    <>
                                        <label className="text-gray-600">
                                            TOTP
                                        </label>
                                        {
                                            // If the credential has a TOTP, show the TOTP
                                            value != null ? (
                                                <div
                                                    key="credentials-totp"
                                                    className="mt-1 flex-grow rounded-md bg-gray-200 px-4 py-2 text-gray-900"
                                                >
                                                    <TOTPControl
                                                        onChange={onChange}
                                                        value={value}
                                                    />
                                                </div>
                                            ) : null
                                        }
                                        {
                                            // If the credential does not have a TOTP, show a button to configure one and a camera icon
                                            value == null ? (
                                                <div className="mt-2 flex flex-row items-center">
                                                    <button
                                                        className="mt-1 flex-grow rounded-md bg-gray-200 px-4 py-2 text-gray-900 hover:bg-gray-300"
                                                        onClick={() => {
                                                            showTOTPDialog();
                                                        }}
                                                    >
                                                        Configure TOTP
                                                    </button>
                                                    {/* <CameraIcon //https://github.com/nimiq/qr-scanner
                                                        className="mx-2 h-5 w-5 cursor-pointer text-gray-400 hover:text-gray-500"
                                                        title="Scan QR code"
                                                        onClick={() => {
                                                            // showQRCodeScanner();
                                                        }}
                                                    /> */}
                                                </div>
                                            ) : null
                                        }
                                    </>
                                )}
                            />
                            {errors.TOTP && (
                                <p className="text-red-500">
                                    {errors.TOTP.message}
                                </p>
                            )}
                        </div>
                        <div className="mt-4 flex flex-col">
                            <Controller
                                control={control}
                                name="Tags"
                                render={({ field: { onChange, value } }) => (
                                    <>
                                        <label className="text-gray-600">
                                            Tags
                                        </label>
                                        <TagBox
                                            onChange={onChange}
                                            value={value}
                                            // value={value?.split(',,') ?? []}
                                        />
                                    </>
                                )}
                            />
                            {errors.Tags && (
                                <p className="text-red-500">
                                    {errors.Tags.message}
                                </p>
                            )}
                        </div>
                        <div className="mt-4 flex flex-col">
                            <Controller
                                control={control}
                                name="URL"
                                render={({
                                    field: { onChange, onBlur, value },
                                }) => (
                                    <>
                                        <FormInputField
                                            label="Website (URL)"
                                            type="url"
                                            autoCapitalize="none"
                                            clipboardButton={true}
                                            additionalButtons={
                                                <OpenInNewTabButton
                                                    value={value}
                                                />
                                            }
                                            onChange={onChange}
                                            onBlur={onBlur}
                                            value={value}
                                        />
                                    </>
                                )}
                            />
                            {errors.URL && (
                                <p className="text-red-500">
                                    {errors.URL.message}
                                </p>
                            )}
                        </div>
                        <div className="mt-4 flex flex-col">
                            <Controller
                                control={control}
                                name="Notes"
                                render={({
                                    field: { onChange, onBlur, value },
                                }) => (
                                    <>
                                        <label className="text-gray-600">
                                            Notes
                                        </label>
                                        <textarea
                                            className="mt-1 min-h-[50px] rounded-md bg-gray-200 px-4 py-2 text-gray-900"
                                            onChange={onChange}
                                            onBlur={onBlur}
                                            value={value}
                                        />
                                    </>
                                )}
                            />
                            {errors.Notes && (
                                <p className="text-red-500">
                                    {errors.Notes.message}
                                </p>
                            )}
                        </div>
                    </div>
                </>
                <TOTPDialog
                    visibleState={TOTPDialogVisible}
                    submitCallback={setTOTPFormValue}
                />
            </Body>

            <Footer className="space-y-3 sm:space-x-5 sm:space-y-0">
                <ButtonFlat
                    text={selected.current ? "Save" : "Create"}
                    className="sm:ml-2"
                    onClick={handleSubmit(onSubmit)}
                    disabled={isSubmitting}
                    loading={isSubmitting}
                />
                <ButtonFlat
                    text="Cancel"
                    type={ButtonType.Secondary}
                    onClick={() => hideDialog()}
                    disabled={isSubmitting}
                />
            </Footer>
        </GenericModal>
    );
};

const VaultTitle: React.FC<{ title: string }> = ({ title }) => {
    return (
        <div className="flex flex-col items-center justify-center overflow-hidden overflow-ellipsis">
            <p className="text-sm font-bold text-slate-400">Current Vault</p>
            <p
                className="line-clamp-2 max-w-xs overflow-ellipsis text-center text-2xl font-bold text-slate-50 md:line-clamp-1"
                title={title}
            >
                {title}
            </p>
        </div>
    );
};

//#region Vault account management
enum AccountDialogMode {
    Recover = "Recover",
    SignUp = "Sign Up",
}
type AccountDialogTabBarProps = {
    currentFormMode: AccountDialogMode;
    changeFormMode: (
        newFormMode: AccountDialogMode.Recover | AccountDialogMode.SignUp
    ) => void;
};

const AccountDialogTabBar: React.FC<AccountDialogTabBarProps> = ({
    currentFormMode,
    changeFormMode,
}) => {
    return (
        <div className="mb-9 flex flex-row justify-center">
            {Object.keys(AccountDialogMode).map((key, index) => {
                const mode =
                    AccountDialogMode[key as keyof typeof AccountDialogMode];
                return (
                    <button
                        type="button"
                        key={`account-dialog-tabbutton-${mode}`}
                        className={clsx({
                            "bg-gray-100 text-gray-900":
                                currentFormMode === mode,
                            "text-gray-500 hover:text-gray-700":
                                currentFormMode !== mode,
                            "rounded-l-md": index === 0,
                            "rounded-r-md": index === 1,
                            "rounded-md":
                                Object.keys(AccountDialogMode).length === 1,
                            "w-auto border border-gray-300 px-4 py-3 text-sm font-medium":
                                true,
                        })}
                        onClick={() => changeFormMode(mode)}
                        autoFocus={currentFormMode === mode}
                    >
                        {mode}
                    </button>
                );
            })}
        </div>
    );
};

const AccountSignUpSignInDialog: React.FC<{
    showDialogFnRef: React.MutableRefObject<(() => void) | null>;
    vaultMetadata: VaultMetadata;
    showRecoveryGenerationDialogFnRef: React.MutableRefObject<
        (() => void) | null
    >;
}> = ({
    showDialogFnRef,
    vaultMetadata,
    showRecoveryGenerationDialogFnRef,
}) => {
    const vault = useAtomValue(onlineServicesAccountAtom);

    // TODO: Show this dialog only if the user is actually online
    const [visible, setVisible] = useState(!vault?.isBound() ?? false);
    showDialogFnRef.current = () => setVisible(true);
    const hideDialog = () => setVisible(false);

    const setUnlockedVault = useSetAtom(unlockedVaultWriteOnlyAtom);

    const [currentFormMode, setCurrentFormMode] = useState(
        AccountDialogMode.SignUp
    );

    const changeFormMode = (
        newFormMode: AccountDialogMode.Recover | AccountDialogMode.SignUp
    ) => {
        // Clear the submit function reference
        // signInSubmitFnRef.current = null;

        setCurrentFormMode(newFormMode);
    };

    const isSubmitting = useState(false);
    const isFormSubmitting = isSubmitting[0];

    const recoverSubmitFnRef = useRef<(() => Promise<void>) | null>(null);
    const signUpSubmitFnRef = useRef<(() => Promise<void>) | null>(null);

    const onConfirm = async () => {
        if (
            currentFormMode === AccountDialogMode.Recover &&
            recoverSubmitFnRef.current
        ) {
            await recoverSubmitFnRef.current();
        } else if (
            currentFormMode === AccountDialogMode.SignUp &&
            signUpSubmitFnRef.current
        ) {
            await signUpSubmitFnRef.current?.();
        }
    };

    const bindAccount = async (
        userID: string,
        privateKey: string,
        publicKey: string
    ) => {
        if (!vault) return;

        // Save the UserID, public/private key to the vault
        setUnlockedVault(async (pre) => {
            if (!pre) return pre;

            pre.OnlineServices.bindAccount(userID, publicKey, privateKey);

            try {
                await vaultMetadata.save(pre);
                toast.success("Account bound successfully.", {
                    autoClose: 3000,
                    closeButton: true,
                });

                // Show the recovery generation dialog - good practice to generate a recovery phrase after binding an account
                showRecoveryGenerationDialogFnRef.current?.();
            } catch (e) {
                console.error("Failed to save vault.", e);
                toast.error("Failed to save vault.", {
                    closeButton: true,
                });
            }
            return pre;
        });
    };

    return (
        <GenericModal
            visibleState={[visible, setVisible]}
            inhibitDismissOnClickOutside
        >
            <Body>
                <div className="mt-2">
                    <AccountDialogTabBar
                        currentFormMode={currentFormMode}
                        changeFormMode={changeFormMode}
                    />
                </div>
                {currentFormMode === AccountDialogMode.Recover ? (
                    <AccountDialogRecoverForm
                        submittingState={isSubmitting}
                        submitFnRef={recoverSubmitFnRef}
                        bindAccountFn={bindAccount}
                        hideDialogFn={hideDialog}
                    />
                ) : (
                    <AccountDialogSignUpForm
                        submittingState={isSubmitting}
                        submitFnRef={signUpSubmitFnRef}
                        vaultMetadata={vaultMetadata}
                        bindAccountFn={bindAccount}
                        hideDialogFn={hideDialog}
                    />
                )}
            </Body>
            <Footer className="space-y-3 sm:space-x-5 sm:space-y-0">
                <ButtonFlat
                    text={currentFormMode}
                    className="sm:ml-2"
                    onClick={onConfirm}
                    disabled={isFormSubmitting}
                    loading={isFormSubmitting}
                />
                <ButtonFlat
                    text="Close"
                    type={ButtonType.Secondary}
                    onClick={hideDialog}
                    disabled={isFormSubmitting}
                />
            </Footer>
        </GenericModal>
    );
};

const AccountDialogRecoverForm: React.FC<{
    submittingState: [boolean, React.Dispatch<React.SetStateAction<boolean>>];
    submitFnRef: React.MutableRefObject<(() => Promise<void>) | null>;
    bindAccountFn: (
        userId: string,
        privateKey: string,
        publicKey: string
    ) => Promise<void>;
    hideDialogFn: () => void;
}> = ({ submittingState, submitFnRef, bindAccountFn, hideDialogFn }) => {
    const [, setIsSubmitting] = submittingState;

    const recoverFormSchema = z.object({
        userId: z.string().nonempty("This field is required").max(100),
        recoveryPhrase: z.string().nonempty("This field is required"),
        captchaToken: z.string().nonempty("Captch is required"),
    });
    type RecoverFormSchemaType = z.infer<typeof recoverFormSchema>;

    const {
        control,
        handleSubmit,
        setError: setFormError,
        formState: { errors },
    } = useForm<RecoverFormSchemaType>({
        resolver: zodResolver(recoverFormSchema),
        defaultValues: {
            userId: "",
            recoveryPhrase: "",
            captchaToken: "",
        },
    });

    const { mutateAsync: recoverUser } =
        trpc.credentials.recoverAccount.useMutation();

    const onSubmit = async (formData: RecoverFormSchemaType) => {
        setIsSubmitting(true);

        toast.info("Generating keys...", {
            autoClose: false,
            closeButton: false,
            toastId: "recovery-generating-keys",
            updateId: "recovery-generating-keys",
        });

        // Generate a public/private key pair
        const keyPair = await generateKeyPair();

        // Send the public key and the email to the server
        toast.info("Contacting the server...", {
            autoClose: false,
            closeButton: false,
            toastId: "recovery-generating-keys",
            updateId: "recovery-generating-keys",
        });

        // Hash the recovery phrase
        const hashRaw = await crypto.subtle.digest(
            "SHA-256",
            new TextEncoder().encode(formData.recoveryPhrase)
        );

        const hash = Buffer.from(hashRaw).toString("hex");

        try {
            const newUserId = await recoverUser({
                userId: formData.userId,
                recoveryPhraseHash: hash,
                publicKey: keyPair.publicKey,
                captchaToken: formData.captchaToken,
            });

            // Save the UserID, public/private key to the vault
            await bindAccountFn(
                newUserId,
                keyPair.privateKey,
                keyPair.publicKey
            );

            toast.update("recovery-generating-keys", {
                autoClose: 1000,
                closeButton: true,
            });

            // Sign in - NOTE: don't await this, we don't want to wait for the server to respond
            cryptexAccountSignIn(
                newUserId,
                keyPair.privateKey,
                formData.captchaToken
            );

            // Hide the dialog
            hideDialogFn();
        } catch (e) {
            console.error("Failed to recover user.", e);

            if (e instanceof TRPCClientError) {
                console.error(e.message);
            }

            toast.error("Recovery failed. Please try again.", {
                autoClose: 3000,
                closeButton: true,
                toastId: "recovery-generating-keys",
                updateId: "recovery-generating-keys",
            });
        }
        setIsSubmitting(false);
    };

    submitFnRef.current = handleSubmit(onSubmit);

    useEffect(() => {
        return () => {
            if (window.turnstile) window.turnstile.remove();
        };
    }, []);

    return (
        <div className="flex w-full flex-col text-left">
            <div className="mb-2 flex flex-col items-center gap-1 rounded-md border-2 border-yellow-400 p-4">
                <ExclamationTriangleIcon
                    className="h-7 w-7 text-slate-800"
                    aria-hidden="true"
                />
                <p className="text-sm text-slate-700">
                    <span className="font-bold">Note:</span> On successful
                    recovery, the account will be bound to this device. You will
                    not be able to recover the account on another device. If
                    there were any other devices linked to the account, they
                    will be unlinked - you will have to link them again.
                </p>
                <p className="text-sm text-slate-700">
                    <span className="font-bold">Note:</span> This device will be
                    marked as a root device. Only the root device will be able
                    to link other devices and remove them.
                </p>
            </div>

            <div className="mt-2 flex flex-col">
                <Controller
                    control={control}
                    name="userId"
                    render={({ field: { onChange, onBlur, value } }) => (
                        <FormInputField
                            label="User ID *"
                            placeholder="Type in your User ID"
                            type="text"
                            autoCapitalize="none"
                            onChange={onChange}
                            onBlur={onBlur}
                            value={value}
                        />
                    )}
                />
                {errors.userId && (
                    <p className="text-red-500">{errors.userId.message}</p>
                )}
            </div>
            <div className="mt-2 flex flex-col">
                <Controller
                    control={control}
                    name="recoveryPhrase"
                    render={({ field: { onChange, onBlur, value } }) => (
                        <FormInputField
                            label="Recovery Phrase *"
                            placeholder="Type in your recovery phrase"
                            type="text"
                            autoCapitalize="none"
                            onChange={onChange}
                            onBlur={onBlur}
                            value={value}
                        />
                    )}
                />
                {errors.recoveryPhrase && (
                    <p className="text-red-500">
                        {errors.recoveryPhrase.message}
                    </p>
                )}
            </div>
            <div className="mt-2 flex flex-col items-center">
                <Controller
                    control={control}
                    name="captchaToken"
                    render={({ field: { onChange } }) => (
                        <Turnstile
                            options={{
                                theme: "light",
                                size: "normal",
                                language: "auto",
                            }}
                            siteKey={env.NEXT_PUBLIC_TURNSTILE_SITE_KEY}
                            onError={() => {
                                setFormError("captchaToken", {
                                    message: "Captcha error",
                                });
                            }}
                            onExpire={() => onChange("")}
                            onSuccess={(token) => onChange(token)}
                        />
                    )}
                />
                {errors.captchaToken && (
                    <p className="text-red-500">
                        {errors.captchaToken.message}
                    </p>
                )}
            </div>
        </div>
    );
};

const AccountDialogSignUpForm: React.FC<{
    submittingState: [boolean, React.Dispatch<React.SetStateAction<boolean>>];
    submitFnRef: React.MutableRefObject<(() => Promise<void>) | null>;
    vaultMetadata: VaultMetadata;
    bindAccountFn: (
        userID: string,
        privateKey: string,
        publicKey: string
    ) => Promise<void>;
    hideDialogFn: () => void;
}> = ({ submittingState, submitFnRef, bindAccountFn, hideDialogFn }) => {
    const [, setIsSubmitting] = submittingState;

    const {
        control,
        handleSubmit,
        setError: setFormError,
        formState: { errors },
    } = useForm<SignUpFormSchemaType>({
        resolver: zodResolver(signUpFormSchema),
        defaultValues: {
            email: "",
            captchaToken: "",
        },
    });

    const { mutateAsync: register_user } =
        trpc.credentials.registerUser.useMutation();

    const onSubmit = async (formData: SignUpFormSchemaType) => {
        setIsSubmitting(true);

        toast.info("Generating keys...", {
            autoClose: false,
            closeButton: false,
            toastId: "signup-generating-keys",
            updateId: "signup-generating-keys",
        });

        // Generate a public/private key pair
        const keyPair = await generateKeyPair();

        // Send the public key and the email to the server
        toast.info("Contacting the server...", {
            autoClose: false,
            closeButton: false,
            toastId: "signup-generating-keys",
            updateId: "signup-generating-keys",
        });

        try {
            const userID = await register_user({
                email: formData.email,
                publicKey: keyPair.publicKey,
                captchaToken: formData.captchaToken,
            });

            // Save the UserID, public/private key to the vault
            await bindAccountFn(userID, keyPair.privateKey, keyPair.publicKey);

            toast.success("Successfully registered user.", {
                autoClose: 3000,
                closeButton: true,
                toastId: "signup-generating-keys",
                updateId: "signup-generating-keys",
            });

            // Sign in - NOTE: don't await this, we don't want to wait for the server to respond
            cryptexAccountSignIn(
                userID,
                keyPair.privateKey,
                formData.captchaToken
            );

            // Hide the dialog
            hideDialogFn();
        } catch (e) {
            console.error("Failed to register user.", e);

            let message = "Failed to register user.";
            if (e instanceof TRPCClientError) {
                message = e.message;
            }

            toast.error(message, {
                autoClose: 3000,
                closeButton: true,
                toastId: "signup-generating-keys",
                updateId: "signup-generating-keys",
            });
        }
        setIsSubmitting(false);
    };

    submitFnRef.current = handleSubmit(onSubmit);

    useEffect(() => {
        return () => {
            if (window.turnstile) window.turnstile.remove();
        };
    }, []);

    return (
        <div className="flex w-full flex-col text-left">
            <div className="mb-2 flex flex-col items-center gap-1 rounded-md border-2 border-yellow-400 p-4">
                <ExclamationTriangleIcon
                    className="h-7 w-7 text-slate-800"
                    aria-hidden="true"
                />
                <p className="text-sm text-slate-700">
                    <span className="font-bold">Note:</span> Once you sign in,
                    make sure to save your vault somewhere safe. If you lose
                    access to the vault, you will not be able to recover your
                    account.
                </p>
                <p className="text-sm text-slate-700">
                    <span className="font-bold">Note:</span> This device will be
                    marked as a root device. Only the root device will be able
                    to link other devices and remove them.
                </p>
            </div>

            <div className="mt-2 flex flex-col">
                <Controller
                    control={control}
                    name="email"
                    render={({ field: { onChange, onBlur, value } }) => (
                        <FormInputField
                            label="Email *"
                            placeholder="Type in your email address"
                            type="email"
                            autoCapitalize="none"
                            onChange={onChange}
                            onBlur={onBlur}
                            value={value}
                        />
                    )}
                />
                {errors.email && (
                    <p className="text-red-500">{errors.email.message}</p>
                )}
                <p className="text-xs text-gray-500">
                    We will send you a confirmation email to verify your email
                    address. Verify your email address to complete the
                    registration. The link will expire after 24 hours.
                </p>
            </div>
            <div className="mt-2 flex flex-col items-center">
                <Controller
                    control={control}
                    name="captchaToken"
                    render={({ field: { onChange } }) => (
                        <Turnstile
                            options={{
                                theme: "light",
                                size: "normal",
                                language: "auto",
                            }}
                            siteKey={env.NEXT_PUBLIC_TURNSTILE_SITE_KEY}
                            onError={() => {
                                setFormError("captchaToken", {
                                    message: "Captcha error",
                                });
                            }}
                            onExpire={() => onChange("")}
                            onSuccess={(token) => onChange(token)}
                        />
                    )}
                />
                {errors.captchaToken && (
                    <p className="text-red-500">
                        {errors.captchaToken.message}
                    </p>
                )}
            </div>
        </div>
    );
};

const EmailNotVerifiedDialog: React.FC = () => {
    const { data: session } = useSession();

    // Check if the verification period has expired
    // The same condition is used in the server to check if the verification period has expired
    const didVerificationPeriodExpire =
        session?.user &&
        session.user.confirmation_period_expires_at &&
        new Date(session.user.confirmation_period_expires_at) < new Date();

    // Show time to expiery if didVerificationPeriodExpire is false using dayjs
    const timeToExpiry = didVerificationPeriodExpire
        ? null
        : dayjs(session?.user?.confirmation_period_expires_at).fromNow();

    // If we have a session and confirmed_at is null and the verification period has not expired, show the dialog
    const [visibleState, setVisibleState] = useState<boolean>(
        session?.user != null &&
            session.user.confirmed_at == null &&
            !didVerificationPeriodExpire
    );
    const hideDialogFn = () => setVisibleState(false);

    return (
        <GenericModal
            key="verify-email-dialog"
            visibleState={[visibleState, setVisibleState]}
        >
            <Body>
                <div className="flex flex-col items-center text-center">
                    <ExclamationTriangleIcon
                        className="h-10 w-10 text-red-500"
                        aria-hidden="true"
                    />
                    <p className="text-2xl font-bold text-gray-900">Warning</p>
                    <br />
                    <p className="mt-2 text-center text-base text-gray-600">
                        Your email address has not been verified.
                    </p>
                    <p className="mt-2 text-center text-base text-gray-600">
                        Please check your email inbox and verify your email
                        address.
                    </p>
                    <p className="mt-2 text-center text-base text-gray-600">
                        The account will be deactivated <b>{timeToExpiry}</b>,
                        if you don&apos;t verify your email address.
                    </p>
                </div>
            </Body>

            <Footer className="space-y-3 sm:space-x-5 sm:space-y-0">
                <ButtonFlat
                    text="Close"
                    type={ButtonType.Secondary}
                    onClick={hideDialogFn}
                />
            </Footer>
        </GenericModal>
    );
};

//#endregion Vault account management

//#region Linking vaults

type ProgressLogType = {
    message: string;
    type: "done" | "info" | "warn" | "error";
};
const EventLogDisclosure: React.FC<{
    title: string;
    log: ProgressLogType[];
}> = ({ title, log }) => {
    return (
        <div className="flex flex-col">
            <Disclosure defaultOpen={true}>
                {({ open }) => (
                    <>
                        <Disclosure.Button className="flex flex-col justify-between rounded-t-lg bg-slate-100 p-4">
                            <div className="flex w-full items-center justify-between">
                                <p className="line-clamp-2 text-lg font-bold text-gray-900">
                                    {title}
                                </p>
                                {
                                    // Rotate the chevron icon if the panel is open
                                    open && (
                                        <ChevronUpIcon className="h-6 w-6 text-gray-500" />
                                    )
                                }
                                {
                                    // Rotate the chevron icon if the panel is closed
                                    !open && (
                                        <ChevronDownIcon className="h-6 w-6 text-gray-500" />
                                    )
                                }
                            </div>
                        </Disclosure.Button>
                        <Disclosure.Panel>
                            <div className="flex max-h-52 flex-col gap-2 overflow-y-auto rounded-b-md bg-slate-50 p-2">
                                {log.map((log, index) => (
                                    <div
                                        key={index}
                                        className="flex flex-row items-center gap-2 rounded-xl bg-slate-200 p-2"
                                    >
                                        <div>
                                            {log.type == "done" && (
                                                <CheckCircleIcon
                                                    className={
                                                        "h-5 w-5 text-green-500"
                                                    }
                                                />
                                            )}
                                            {log.type == "info" && (
                                                <InformationCircleIcon
                                                    className={
                                                        "h-5 w-5 text-blue-500"
                                                    }
                                                />
                                            )}
                                            {log.type == "warn" && (
                                                <ExclamationCircleIcon
                                                    className={
                                                        "h-5 w-5 text-yellow-500"
                                                    }
                                                />
                                            )}
                                            {log.type == "error" && (
                                                <XCircleIcon
                                                    className={
                                                        "h-5 w-5 text-red-500"
                                                    }
                                                />
                                            )}
                                        </div>
                                        <p className="text-gray-900">
                                            {log.message}
                                        </p>
                                    </div>
                                ))}
                            </div>
                        </Disclosure.Panel>
                    </>
                )}
            </Disclosure>
        </div>
    );
};

const QRCode: React.FC<{
    value: string;
    clickCallback?: () => void;
}> = ({ value, clickCallback }) => {
    const DynamicQRCode = dynamic(() => import("react-qr-code"), {
        suspense: true,
    });

    return (
        <Suspense fallback={<Spinner />}>
            <DynamicQRCode value={value} onClick={clickCallback} />
        </Suspense>
    );
};

const LinkDeviceInsideVaultDialog: React.FC<{
    showDialogFnRef: React.MutableRefObject<(() => void) | null>;
}> = ({ showDialogFnRef }) => {
    const [visible, setVisible] = useState(false);
    showDialogFnRef.current = () => setVisible(true);
    const hideDialog = () => {
        setVisible(false);

        setTimeout(() => {
            resetForm();
            setSelectedLinkMethod(null);
            setIsOperationInProgress(false);
            setReadyForOtherDevice(false);
            progressLogRef.current = [];
        }, DIALOG_BLUR_TIME);
    };

    const { data: session } = useSession();
    const hasSession = session != null;

    const unlockedVault = useAtomValue(unlockedVaultAtom);
    const setUnlockedVault = useSetAtom(unlockedVaultWriteOnlyAtom);
    const vaultMetadata = useAtomValue(unlockedVaultMetadataAtom);

    const [selectedLinkMethod, setSelectedLinkMethod] =
        useState<LinkMethod | null>(null);
    const [isOperationInProgress, setIsOperationInProgress] = useState(false);
    const [readyForOtherDevice, setReadyForOtherDevice] = useState(false);
    const progressLogRef = useRef<ProgressLogType[]>([]);
    const addToProgressLog = (
        message: string,
        type: "done" | "info" | "warn" | "error" = "done"
    ) => {
        const newProgressLog = [{ message, type }, ...progressLogRef.current];
        progressLogRef.current = newProgressLog;
        setFormValue("progressLog", newProgressLog);
    };
    const cancelFnRef = useRef<() => void>(() => {
        // No-op
    });

    const linkingDeviceFormSchema = z.object({
        deviceName: z
            .string()
            .min(1, "Device name cannot be empty.")
            .max(150, "Device name cannot be longer than 150 characters.")
            .default("My Device"),
        progressLog: z.array(
            z.object({
                message: z.string(),
                type: z.enum(["done", "info", "warn", "error"]),
            })
        ),
        mnemonic: z.string().default(""),
    });
    type LinkingDeviceFormSchemaType = z.infer<typeof linkingDeviceFormSchema>;
    const {
        control,
        handleSubmit,
        setValue: setFormValue,
        getValues: getFormValues,
        formState: { errors, isValid: isFormValid },
        reset: resetForm,
    } = useForm<LinkingDeviceFormSchemaType>({
        resolver: zodResolver(linkingDeviceFormSchema),
        defaultValues: {
            deviceName: "My Device",
            progressLog: [],
            mnemonic: "",
        },
    });

    const encryptedTransferableDataRef = useRef<string>("");

    const {
        data: linkingAccountConfiguration,
        isError: linkingAccountConfigurationError,
    } = trpc.account.getLinkingConfiguration.useQuery(undefined, {
        refetchOnWindowFocus: false,
        enabled:
            !!session &&
            !!unlockedVault &&
            unlockedVault.OnlineServices.isBound(),
    });

    const { mutateAsync: linkNewDevice } =
        trpc.account.linkDevice.useMutation();
    const removeDevice = trpc.account.removeDevice.useMutation();

    const startLinkingProcess = async (): Promise<{
        userID: string;
        encryptedTransferableData: string;
        generatedKeyPair: {
            publicKey: string;
            privateKey: string;
        };
    }> => {
        if (!unlockedVault) {
            addToProgressLog("No unlocked vault found.", "error");
            throw new Error("No unlocked vault found.");
        }

        // Generate a set of keys for the device
        let keypair;
        try {
            addToProgressLog("Generating keys for the device...", "info");
            keypair = await generateKeyPair();
            addToProgressLog("Generated keys for the device.");
        } catch (e) {
            addToProgressLog(
                "Failed to generate keys for the device.",
                "error"
            );
            throw e;
        }

        // Run the account.linkDevice mutation
        let userID: string;
        try {
            addToProgressLog(
                "Registering credentials with the server...",
                "info"
            );
            userID = await linkNewDevice({
                publicKey: keypair.publicKey,
            });
            addToProgressLog("Registered credentials with the server.");
        } catch (e) {
            if (e instanceof TRPCClientError) {
                addToProgressLog(
                    `Failed to register credentials with the server: ${e.message}`,
                    "error"
                );
            } else {
                addToProgressLog(
                    "Failed to register credentials with the server.",
                    "error"
                );
            }
            throw e;
        }

        // Encrypt the received UserID and PrivateKey with a random mnemonic passphrase
        let encryptedTransferableData;
        try {
            addToProgressLog(
                "Encrypting and serializing credentials...",
                "info"
            );
            encryptedTransferableData =
                await OnlineServicesAccount.encryptTransferableData(
                    userID,
                    keypair.publicKey,
                    keypair.privateKey
                );
            addToProgressLog("Encrypted and serialized credentials.");
        } catch (e) {
            addToProgressLog(
                "Failed to encrypt and serialize credentials.",
                "error"
            );
            throw e;
        }

        // Show the user a note and the mnemonic passphrase to enter on the other device
        setFormValue("mnemonic", encryptedTransferableData.secret);
        // setFormValue("showingMnemonic", true);

        return {
            userID,
            encryptedTransferableData:
                encryptedTransferableData?.encryptedDataB64,
            generatedKeyPair: keypair,
        };
    };

    const finishLinkingProcess = async (
        userID: string,
        generatedKeyPair: {
            publicKey: string;
            privateKey: string;
        }
    ) => {
        // Start setting up the WebRTC connection
        const webRTConnection = await newWebRTCConnection();
        webRTConnection.onconnectionstatechange = () => {
            // console.debug(
            //     "WebRTC connection state changed:",
            //     webRTConnection.connectionState
            // );

            if (webRTConnection.connectionState === "connected") {
                addToProgressLog(
                    "Private connection established, disconnecting from CryptexVault Online Services...",
                    "info"
                );

                // Since we're connected directly to the other device, we can disconnect from the Online Services
                onlineWSServicesEndpoint.disconnect();
                onlineWSServicesEndpoint.unbind();
            } else if (
                webRTConnection.connectionState === "disconnected" ||
                webRTConnection.connectionState === "failed"
            ) {
                // Handle disconnection from the other device
                addToProgressLog(
                    "Private connection has been terminated",
                    "info"
                );

                setIsOperationInProgress(false);
            }
        };

        // Create a data channel
        const webRTCDataChannel = webRTConnection.createDataChannel("linking");
        // Once the data channel is open, start sending the encrypted vault package
        webRTCDataChannel.onopen = async () => {
            // console.log("Data channel opened.", event);
            addToProgressLog(
                "Trying to send data to the other device...",
                "info"
            );

            // Check if we have valid vault data to send
            // In reality, this should never happen, but we'll check anyway to make the typescript compiler happy
            if (
                !vaultMetadata ||
                !unlockedVault ||
                !unlockedVault.OnlineServices.UserID
            ) {
                addToProgressLog(
                    "Cannot find vault metadata or the vault itself.",
                    "error"
                );
                console.error(
                    "Cannot find vault metadata or unlocked vault data."
                );

                // Close the data channel
                webRTCDataChannel.close();

                // Close the WebRTC connection
                webRTConnection.close();

                setIsOperationInProgress(false);

                // Prevent further execution
                return;
            }

            {
                addToProgressLog(
                    "Packaging vault data for transmission...",
                    "info"
                );

                // Prepare the vault data for transmission
                const exportedVault = unlockedVault.packageForLinking({
                    UserID: userID,
                    PublicKey: generatedKeyPair.publicKey,
                    PrivateKey: generatedKeyPair.privateKey,
                });

                addToProgressLog("Vault data packaged. Encrypting...", "info");

                const encryptedBlobObj = await vaultMetadata.exportForLinking(
                    exportedVault
                );

                // Send the encrypted data to the other device
                webRTCDataChannel.send(encryptedBlobObj);
            }

            addToProgressLog("Vault data successfully sent.");

            // Close the data channel
            webRTCDataChannel.close();
            // NOTE: Make sure not to close the WebRTC connection here, as we could still be transmitting data
            // NOTE: The other device will close the connection once it's done receiving data

            // Save the new linked device to this vault
            {
                addToProgressLog(
                    "Saving new linked device to vault...",
                    "info"
                );

                setUnlockedVault(async (prev) => {
                    if (!prev) return null;

                    prev.OnlineServices.addLinkedDevice(
                        userID,
                        getFormValues("deviceName")
                    );
                    await vaultMetadata.save(unlockedVault);

                    return prev;
                });

                addToProgressLog("New linked device saved.");
            }

            toast.success("Successfully linked device.", {
                closeButton: true,
            });

            addToProgressLog("It is safe to close this dialog now.", "info");
        };
        webRTCDataChannel.onerror = () => {
            addToProgressLog(
                "Failed to send vault data. Data channel error.",
                "error"
            );

            // Close the WebRTC connection
            webRTCDataChannel.close();
            webRTConnection.close();

            setIsOperationInProgress(false);
        };
        webRTCDataChannel.onclose = () => {
            // console.debug("Data channel closed.", event);

            // Close the WebRTC connection
            webRTConnection.close();

            setIsOperationInProgress(false);
        };

        let iceCandidatesGenerated = 0;
        // On ICE candidate, send it to the other device
        // This is called after we call setLocalDescription, that's why we have access to the wsChannel object
        webRTConnection.onicecandidate = (event) => {
            console.debug("WebRTC ICE candidate:", event);
            if (event.candidate) {
                wsChannel.trigger("client-link", {
                    type: "ice-candidate",
                    data: event.candidate,
                });

                iceCandidatesGenerated++;
            }

            if (iceCandidatesGenerated === 0 && !event.candidate) {
                addToProgressLog(
                    "Failed to generate any ICE candidates. WebRTC error.",
                    "error"
                );

                // Close the WebRTC connection
                webRTCDataChannel.close();
                webRTConnection.close();

                onlineWSServicesEndpoint.disconnect();

                setIsOperationInProgress(false);
            }
        };

        // Connect to WS and wait for the other device
        const onlineWSServicesEndpoint = newWSPusherInstance();
        onlineWSServicesEndpoint.connection.bind("error", (err: object) => {
            console.error("WS error:", err);
            // NOTE: Should we handle specific errors?
            // if (err.error.data.code === 4004) {
            //     // log('Over limit!');
            // }
            addToProgressLog(
                "An error occurred while setting up a private connection.",
                "error"
            );

            setIsOperationInProgress(false);
        });

        const channelName = `presence-link-${userID}`;
        const wsChannel = onlineWSServicesEndpoint.subscribe(channelName);
        wsChannel.bind("pusher:subscription_succeeded", () => {
            setReadyForOtherDevice(true);
            cancelFnRef.current = async () => {
                // Close the WS connection
                onlineWSServicesEndpoint.disconnect();

                setIsOperationInProgress(false);
                setReadyForOtherDevice(false);

                // Try to remove the device from the account - if it fails, we'll just have to leave it there for the user to remove manually
                try {
                    await removeDevice.mutateAsync({
                        deviceId: userID,
                    });
                } catch (err) {
                    console.error("Failed to remove device:", err);

                    addToProgressLog(
                        "Rollback - Failed to remove device from account.",
                        "error"
                    );
                }

                addToProgressLog("Linking process cancelled.", "error");
                toast.error("Linking process cancelled.");
            };
            addToProgressLog("Waiting for other device to connect...", "info");
        });

        // When the user connects, send the WebRTC offer to the other device
        wsChannel.bind("pusher:member_added", async () => {
            addToProgressLog("Found other device.");

            addToProgressLog("Creating a private connection...", "info");

            // When the device connects, create a WebRTC offer
            const offer = await webRTConnection.createOffer();
            await webRTConnection.setLocalDescription(offer);

            // Send the offer to the other device
            wsChannel.trigger("client-link", {
                type: "offer",
                data: offer,
            });
        });

        // Receive WebRTC events from the other device
        // Used to receive the offer and ICE candidates - establishing the connection
        wsChannel.bind(
            "client-link",
            async (data: {
                type: "ice-candidate" | "answer";
                data: RTCIceCandidateInit | RTCSessionDescriptionInit;
            }) => {
                console.debug("Received data from other device.", data);

                if (data.type === "ice-candidate") {
                    console.debug("Adding ICE candidate.");
                    await webRTConnection.addIceCandidate(
                        data.data as RTCIceCandidateInit
                    );
                } else if (data.type === "answer") {
                    console.debug("Setting remote description.", data.data);
                    await webRTConnection.setRemoteDescription(
                        data.data as RTCSessionDescriptionInit
                    );
                }
            }
        );
    };

    const fileMethod = async (encryptedTransferableData: string) => {
        // Save it to a file with a .cryxa extension
        const blob = new Blob([encryptedTransferableData], {
            type: "text/plain;charset=utf-8",
        });

        // Normalize the device name
        const deviceName = getFormValues("deviceName")
            .replaceAll(" ", "-")
            .toLowerCase();

        // Save the file
        const fileName = `vault-linking-${deviceName}-${Date.now()}.cryxa`;
        const link = document.createElement("a");
        link.href = window.URL.createObjectURL(blob);
        link.download = fileName;
        link.click();
    };

    const qrCodeMethod = async (encryptedTransferableData: string) => {
        // Set the encryptedTransferableDataRef to the encrypted data
        // By the time this method is called, the QR Code component should be mounted
        encryptedTransferableDataRef.current = encryptedTransferableData;
    };

    const onSubmit = async (type: LinkMethod) => {
        // If the form is not valid, submit it to show the errors
        if (!isFormValid) {
            handleSubmit(() => {
                // No-op
            })();
            return;
        }

        setSelectedLinkMethod(type);
        setIsOperationInProgress(true);

        // We exploit this try-catch block to catch any errors that may occur and stop execution in case of an error
        // All expected errors should be handled inside each method that can throw them
        // Meaning only unexpected errors should be caught here
        try {
            // Trigger linking
            const { userID, encryptedTransferableData, generatedKeyPair } =
                await startLinkingProcess();

            if (type === LinkMethod.File) {
                // Generate the file with the encrypted data for the other device
                fileMethod(encryptedTransferableData);
            } else if (type === LinkMethod.QRCode) {
                // Make sure that a QR Code with the encrypted data is generated
                qrCodeMethod(encryptedTransferableData);
            } else if (type === LinkMethod.Sound) {
                throw new Error("Not implemented.");
            } else {
                throw new Error("Unknown linking method.");
            }

            await finishLinkingProcess(userID, generatedKeyPair);
        } catch (e) {
            console.error("Failed to link device.", e);

            toast.error("Failed to link device.", {
                closeButton: true,
            });

            setIsOperationInProgress(false);
        }
    };

    const isWrongTier =
        linkingAccountConfiguration &&
        session &&
        !linkingAccountConfiguration.can_link;

    return (
        <GenericModal
            visibleState={[visible, setVisible]}
            inhibitDismissOnClickOutside
        >
            <Body className="flex w-full flex-col items-center gap-3">
                <div className="">
                    <p className="text-2xl font-bold text-gray-900">
                        Link a Device
                    </p>
                </div>
                <div className="flex w-full flex-col">
                    {
                        // If the user is not logged in, tell them to log in
                        !hasSession && (
                            <p className="text-center text-base text-gray-600">
                                You need to be logged in to online services in
                                order to link devices to your vault.
                            </p>
                        )
                    }
                    {
                        // If there was an error while fetching the linking configuration, tell the user
                        linkingAccountConfigurationError && (
                            <p className="text-center text-base text-gray-600">
                                Failed to fetch linking configuration. Please
                                try again later.
                            </p>
                        )
                    }
                    {isWrongTier && (
                        <>
                            <p className="text-center text-base text-gray-600">
                                Your tier does not allow linking devices.
                            </p>
                            <p className="text-center text-base text-gray-600">
                                Please upgrade your account to link devices.
                            </p>
                        </>
                    )}
                    {!isWrongTier &&
                        hasSession &&
                        selectedLinkMethod == null && (
                            <>
                                <p className="text-center text-base text-gray-600">
                                    Name the device you want to link and select
                                    a method to link it.
                                </p>

                                <div className="my-5 flex flex-col gap-2">
                                    <Controller
                                        control={control}
                                        name="deviceName"
                                        render={({
                                            field: { onChange, onBlur, value },
                                        }) => (
                                            <>
                                                <FormInputField
                                                    label="Device name"
                                                    placeholder="Type in a name for the device"
                                                    onChange={onChange}
                                                    onBlur={onBlur}
                                                    value={value}
                                                />
                                            </>
                                        )}
                                    />
                                    {
                                        // If the device name is invalid, show an error
                                        errors.deviceName &&
                                            errors.deviceName.message && (
                                                <p className="text-red-500">
                                                    {errors.deviceName.message}
                                                </p>
                                            )
                                    }
                                    <div className="w-full text-center">
                                        <p className="mt-1 text-xs text-gray-500">
                                            This name will be used to identify
                                            the device.
                                        </p>{" "}
                                        <p className="text-xs text-gray-500">
                                            This is stored in your vault and is
                                            not sent to the server as it is not
                                            necessary for authentication
                                        </p>
                                    </div>
                                </div>

                                <BlockWideButton
                                    icon={
                                        <CameraIcon className="h-5 w-5 text-gray-900" />
                                    }
                                    iconCaption="QR code"
                                    description="Generate a QR code to scan with the other device"
                                    onClick={() => onSubmit(LinkMethod.QRCode)}
                                    disabled={isOperationInProgress}
                                />

                                <BlockWideButton
                                    icon={
                                        <SpeakerWaveIcon className="h-5 w-5 text-gray-900" />
                                    }
                                    iconCaption="Transfer with sound"
                                    description="Link the devices using sound"
                                    // disabled={
                                    //     isSubmitting ||
                                    //     (validInput !== ValidInput.Sound && validInput !== null)
                                    // }
                                    disabled={true} // FIXME: Sound transfer is not implemented yet
                                    // validInput={validInput === ValidInput.Sound}
                                />

                                <BlockWideButton
                                    icon={
                                        <DocumentTextIcon className="h-5 w-5 text-gray-900" />
                                    }
                                    iconCaption="Using a file"
                                    description="Generate a file to transfer to the other device"
                                    onClick={() => onSubmit(LinkMethod.File)}
                                    disabled={isOperationInProgress}
                                />
                            </>
                        )}

                    {!isWrongTier &&
                        hasSession &&
                        selectedLinkMethod != null && (
                            <div className="flex flex-col gap-2">
                                <div className="mt-2 flex flex-col items-center gap-2">
                                    {/* Show the operation in progress indicator - pulsating text */}
                                    {isOperationInProgress && (
                                        <div className="flex items-center">
                                            <p className="animate-pulse text-gray-900">
                                                Waiting for device...
                                            </p>
                                        </div>
                                    )}

                                    {readyForOtherDevice && (
                                        <div className="flex list-decimal flex-col gap-2 rounded-md bg-slate-200 p-2">
                                            <p className="text-md w-full text-center text-slate-600 underline">
                                                Tips for linking to the other
                                                device
                                            </p>
                                            {/* Show a nicely formatted tip on how to
                                            load the data into the other device */}
                                            {selectedLinkMethod ===
                                                LinkMethod.QRCode &&
                                                readyForOtherDevice && (
                                                    <>
                                                        <p className="text-md text-slate-600">
                                                            1. Scan the QR Code
                                                            with the other
                                                            device by opening
                                                            the{" "}
                                                            <strong>
                                                                Link a Device
                                                            </strong>{" "}
                                                            dialog and then
                                                            selecting{" "}
                                                            <strong>
                                                                QR Code
                                                            </strong>
                                                        </p>
                                                        <p className="text-md text-slate-600">
                                                            2. Once the QR code
                                                            is successfully
                                                            scanned, enter the
                                                            decryption
                                                            passphrase shown
                                                            below.
                                                        </p>
                                                    </>
                                                )}
                                            {selectedLinkMethod ===
                                                LinkMethod.File &&
                                                readyForOtherDevice && (
                                                    <>
                                                        <p className="text-md text-slate-600">
                                                            1. Load the file
                                                            into the other
                                                            device by opening
                                                            the{" "}
                                                            <strong>
                                                                Link a Device
                                                            </strong>{" "}
                                                            dialog and then
                                                            selecting{" "}
                                                            <strong>
                                                                Using a file
                                                            </strong>
                                                        </p>
                                                        <p className="text-md text-slate-600">
                                                            2. Once the file is
                                                            loaded, enter the
                                                            decryption
                                                            passphrase shown
                                                            below.
                                                        </p>
                                                    </>
                                                )}
                                            <p className="text-md text-slate-600">
                                                3. Follow the instructions on
                                                the other device.
                                            </p>
                                        </div>
                                    )}

                                    {selectedLinkMethod === LinkMethod.QRCode &&
                                        readyForOtherDevice && (
                                            <QRCode
                                                value={
                                                    encryptedTransferableDataRef.current
                                                }
                                            />
                                        )}

                                    {/* Show the mnemonic */}
                                    {isOperationInProgress && (
                                        <Controller
                                            control={control}
                                            name="mnemonic"
                                            render={({ field: { value } }) => (
                                                <div
                                                    className={clsx({
                                                        "flex flex-col items-center gap-2":
                                                            true,
                                                        hidden: !value.length,
                                                    })}
                                                >
                                                    <p className="select-all rounded-md bg-gray-200 p-2 text-gray-900">
                                                        {value}
                                                    </p>
                                                    <p className="text-xs text-gray-500">
                                                        Enter this mnemonic on
                                                        the other device when
                                                        prompted.
                                                    </p>
                                                </div>
                                            )}
                                        />
                                    )}
                                </div>
                                <Controller
                                    control={control}
                                    name="progressLog"
                                    render={({ field: { value } }) => (
                                        <EventLogDisclosure
                                            title="Event log"
                                            log={value}
                                        />
                                    )}
                                />
                            </div>
                        )}
                </div>
            </Body>
            <Footer className="space-y-3 sm:space-x-5 sm:space-y-0">
                <ButtonFlat
                    text="Cancel"
                    type={ButtonType.Secondary}
                    className={clsx({
                        "sm:ml-2": true,
                        hidden: !readyForOtherDevice,
                    })}
                    disabled={!isOperationInProgress}
                    onClick={() => cancelFnRef.current()}
                />
                <ButtonFlat
                    text="Close"
                    type={ButtonType.Secondary}
                    className={clsx({
                        hidden: isOperationInProgress,
                    })}
                    onClick={hideDialog}
                    disabled={isOperationInProgress}
                />
            </Footer>
        </GenericModal>
    );
};

const EditLinkedDeviceDialog: React.FC<{
    showDialogFnRef: React.MutableRefObject<(() => void) | null>;
    selectedDevice: React.MutableRefObject<LinkedDevice | null>;
    vaultMetadata: VaultMetadata | null;
}> = ({ showDialogFnRef, selectedDevice, vaultMetadata }) => {
    const [visible, setVisible] = useState(false);
    showDialogFnRef.current = () => {
        if (selectedDevice.current == null) {
            return;
        }

        // Set the initial form values
        resetForm({
            name: selectedDevice.current.Name,
            autoConnect: selectedDevice.current.AutoConnect,
            syncTimeout: selectedDevice.current.SyncTimeout,
            syncTimeoutPeriod: selectedDevice.current.SyncTimeoutPeriod,
        });

        setVisible(true);
    };
    const hideDialog = (force = false) => {
        const hide = () => {
            setVisible(false);

            // Reset the form with a delay for better UX
            setTimeout(() => {
                resetForm();
                selectedDevice.current = null;
            }, DIALOG_BLUR_TIME);
        };

        // Check if the form has been modified (only if we are not forcing)
        if (isDirty && !force) {
            // If it has, ask the user if they want to discard the changes
            if (confirm("Are you sure you want to discard your changes?")) {
                hide();
            }
        } else {
            // If not, just hide the modal
            hide();
        }
    };

    const [syncTimeoutValue, setSyncTimeoutValue] = useState(
        selectedDevice.current?.SyncTimeout ?? false
    );
    const setUnlockedVault = useSetAtom(unlockedVaultWriteOnlyAtom);

    const formSchema = z.object({
        name: z.string().nonempty().max(200),
        autoConnect: z.boolean(),
        syncTimeout: z.boolean(),
        syncTimeoutPeriod: z.coerce.number().int().min(1),
    });
    type FormSchema = z.infer<typeof formSchema>;
    const {
        handleSubmit,
        control,
        formState: { errors, isSubmitting, isDirty },
        reset: resetForm,
    } = useForm<FormSchema>({
        resolver: zodResolver(formSchema),
        defaultValues: {
            name: "",
            autoConnect: false,
            syncTimeout: false,
            syncTimeoutPeriod: 1,
        },
    });

    const onSubmit = async (form: FormSchema) => {
        if (
            selectedDevice.current == null ||
            vaultMetadata == null ||
            !isDirty
        ) {
            hideDialog();
            return;
        }

        setUnlockedVault(async (prev) => {
            if (prev == null) return prev;

            const originalLinkedDevice = prev.OnlineServices.LinkedDevices.find(
                (d) => d.ID === selectedDevice.current?.ID
            );

            if (originalLinkedDevice != null) {
                originalLinkedDevice.setName(form.name);
                originalLinkedDevice.setAutoConnect(form.autoConnect);
                originalLinkedDevice.setSyncTimeout(form.syncTimeout);
                originalLinkedDevice.setSyncTimeoutPeriod(
                    form.syncTimeoutPeriod
                );
            }

            await vaultMetadata?.save(prev);

            return prev;
        });

        hideDialog(true);
    };

    return (
        <GenericModal
            key="edit-linked-device"
            visibleState={[
                visible && selectedDevice.current != null,
                () => hideDialog(),
            ]}
        >
            <Body>
                <div className="flex flex-col text-center">
                    <p className="line-clamp-2 text-2xl font-bold text-gray-900">
                        Linked Device - {selectedDevice.current?.Name}
                    </p>

                    <div className="my-2 flex w-full flex-col items-center text-left">
                        <p
                            className="line-clamp-2 text-left text-base text-gray-600"
                            title={"When the device was linked to this vault"}
                        >
                            <span className="font-bold">Linked on:</span>{" "}
                            {selectedDevice.current?.LinkedAtTimestamp && (
                                <>
                                    {new Date(
                                        selectedDevice.current.LinkedAtTimestamp
                                    ).toLocaleString()}
                                </>
                            )}
                        </p>
                        <p
                            className="line-clamp-2 text-left text-base text-gray-600"
                            title={
                                "When the data was last synchronized with this device"
                            }
                        >
                            <span className="font-bold">
                                Last Synchronized:
                            </span>{" "}
                            {selectedDevice.current?.LastSync ? (
                                <>
                                    {new Date(
                                        selectedDevice.current.LastSync
                                    ).toLocaleString()}
                                </>
                            ) : (
                                "Never synchronized"
                            )}
                        </p>
                        <p
                            className="line-clamp-2 text-left text-base text-gray-600"
                            title={
                                "Whether or not this is the main device for this vault"
                            }
                        >
                            <span className="font-bold">Root Device:</span>{" "}
                            {selectedDevice.current?.IsRoot ? "Yes" : "No"}
                        </p>
                    </div>
                    <div className="flex w-full flex-col space-y-3 text-left">
                        <div className="flex flex-col">
                            <Controller
                                control={control}
                                name="name"
                                render={({
                                    field: { onChange, onBlur, value },
                                }) => (
                                    <FormInputField
                                        label="Name *"
                                        placeholder="Name of the device"
                                        type="text"
                                        autoCapitalize="words"
                                        onChange={onChange}
                                        onBlur={onBlur}
                                        value={value}
                                    />
                                )}
                            />
                            {errors.name && (
                                <p className="text-red-500">
                                    {errors.name.message}
                                </p>
                            )}
                        </div>
                        <div className="flex items-center space-x-2">
                            <Controller
                                control={control}
                                name="autoConnect"
                                render={({
                                    field: { onChange, onBlur, value },
                                }) => (
                                    <>
                                        <div className="flex items-center">
                                            <label className="flex items-center text-gray-600">
                                                Auto Connect
                                            </label>
                                            <InformationCircleIcon
                                                className="h-5 w-5 text-gray-600"
                                                title="Whether or not we should automatically connect to this device when it is available"
                                            />
                                        </div>
                                        <input
                                            type="checkbox"
                                            className="form-checkbox h-5 w-5 text-gray-600"
                                            onChange={onChange}
                                            onBlur={onBlur}
                                            checked={value}
                                        />
                                    </>
                                )}
                            />
                            {errors.name && (
                                <p className="text-red-500">
                                    {errors.name.message}
                                </p>
                            )}
                        </div>
                        <div>
                            <div className="flex items-center space-x-2">
                                <Controller
                                    control={control}
                                    name="syncTimeout"
                                    render={({
                                        field: { onChange, onBlur, value },
                                    }) => {
                                        // Set the value after a delay to prevent render collisions with the controller
                                        setTimeout(() => {
                                            setSyncTimeoutValue(value);
                                        }, 100);
                                        return (
                                            <>
                                                <div className="flex items-center">
                                                    <label className="flex items-center text-gray-600">
                                                        Impose a synchronization
                                                        window
                                                    </label>
                                                    <InformationCircleIcon
                                                        className="h-5 w-5 text-gray-600"
                                                        title="The synchronization will only be possible when manually triggered and will only last for the specified amount of time."
                                                    />
                                                </div>
                                                <input
                                                    type="checkbox"
                                                    className="form-checkbox h-5 w-5 text-gray-600"
                                                    onChange={onChange}
                                                    onBlur={onBlur}
                                                    checked={value}
                                                />
                                            </>
                                        );
                                    }}
                                />
                                {errors.name && (
                                    <p className="text-red-500">
                                        {errors.name.message}
                                    </p>
                                )}
                            </div>
                            <div
                                className="flex flex-col"
                                title="The amount of time to stay connected to the device."
                            >
                                <Controller
                                    control={control}
                                    name="syncTimeoutPeriod"
                                    render={({
                                        field: { onChange, onBlur, value },
                                    }) => (
                                        <div
                                            className={clsx({
                                                hidden: !syncTimeoutValue,
                                                "border-l pl-2":
                                                    syncTimeoutValue,
                                            })}
                                        >
                                            <FormNumberInputField
                                                label="Allowed window"
                                                valueLabel="seconds"
                                                min={1}
                                                onChange={onChange}
                                                onBlur={onBlur}
                                                value={value}
                                            />
                                        </div>
                                    )}
                                />
                                {errors.syncTimeoutPeriod && (
                                    <p className="text-red-500">
                                        {errors.syncTimeoutPeriod.message}
                                    </p>
                                )}
                            </div>
                        </div>
                    </div>
                </div>
            </Body>

            <Footer className="space-y-3 sm:space-x-5 sm:space-y-0">
                <ButtonFlat
                    text="Save"
                    className="sm:ml-2"
                    type={ButtonType.Primary}
                    onClick={handleSubmit(onSubmit)}
                    disabled={isSubmitting}
                />
                <ButtonFlat
                    text="Close"
                    type={ButtonType.Secondary}
                    onClick={() => hideDialog()}
                    disabled={isSubmitting}
                />
            </Footer>
        </GenericModal>
    );
};

let onlineWSServicesEndpoint: Pusher | null = null;

const DashboardSidebarSynchronization: React.FC<{
    showWarningFn: WarningDialogShowFn;
}> = ({ showWarningFn }) => {
    const { data: session } = useSession();

    enum OnlineServicesStatus {
        NoAccount = "No Account",
        NoDevices = "No Devices",
        Connecting = "Preparing...",
        Connected = "Ready",
        Disconnected = "Not Ready",
        Unavailable = "Unavailable",
        Failure = "Failure",
    }
    const [onlineServicesStatus, setOnlineServicesStatus] =
        useState<OnlineServicesStatus>(OnlineServicesStatus.NoAccount);

    const unlockedVaultMetadata = useAtomValue(unlockedVaultMetadataAtom);
    const unlockedVault = useAtomValue(unlockedVaultAtom);
    const setUnlockedVault = useSetAtom(unlockedVaultWriteOnlyAtom);

    const linkedDevicesLen = unlockedVault?.OnlineServices.LinkedDevices.length;
    const linkedDevicesLenRef = useRef<number | null>(null);

    //#region Dialog refs
    const showLinkingDeviceDialogFnRef = useRef<(() => void) | null>(null);
    const showEditLinkedDeviceDialogFnRef = useRef<() => void>(() => {
        // No-op
    });
    const editLinkedDeviceDialogSelectedDeviceRef = useRef<LinkedDevice | null>(
        null
    );
    const showDivergenceSolveDialogRef =
        useRef<DivergenceSolveShowDialogFnPropType | null>(null);
    //#endregion Dialog refs

    const setupOnlineServices = (
        onConnect = () => {
            // NO-OP
        }
    ) => {
        if (!unlockedVault) return;

        if (!unlockedVault.OnlineServices.isBound()) {
            setOnlineServicesStatus(OnlineServicesStatus.NoAccount);
            console.debug("Skipping online services setup - no account");
            return;
        }

        if (
            unlockedVault.OnlineServices.isBound() &&
            unlockedVault.OnlineServices.LinkedDevices.length === 0
        ) {
            setOnlineServicesStatus(OnlineServicesStatus.NoDevices);
            console.debug("Skipping online services setup - no linked devices");
            return;
        }

        console.debug("Setting up online services connection...");

        onlineWSServicesEndpoint = newWSPusherInstance();

        onlineWSServicesEndpoint.connection.bind("connecting", () => {
            console.debug("Changed status to offline - connection connecting");
            setOnlineServicesStatus(OnlineServicesStatus.Connecting);
        });

        onlineWSServicesEndpoint.connection.bind("connected", () => {
            console.debug("Changed status to online - connection established");
            setOnlineServicesStatus(OnlineServicesStatus.Connected);

            // Setup device links
            // setupDeviceLinks(specificDeviceID);
            if (onConnect) {
                onConnect();
                onConnect = () => void 0;
            }
        });

        onlineWSServicesEndpoint.connection.bind("disconnected", () => {
            console.debug(
                "Changed status to offline - connection disconnected"
            );

            // Both statuses mean that we're not connected to the server, but this makes the status more clear to the end user
            if (linkedDevicesLen !== 0) {
                setOnlineServicesStatus(OnlineServicesStatus.Disconnected);
            } else {
                setOnlineServicesStatus(OnlineServicesStatus.NoDevices);
            }
        });

        onlineWSServicesEndpoint.connection.bind("unavailable", () => {
            console.debug("Changed status to offline - connection unavailable");
            setOnlineServicesStatus(OnlineServicesStatus.Unavailable);
        });

        onlineWSServicesEndpoint.connection.bind("failed", () => {
            console.debug("Changed status to offline - connection failed");
            setOnlineServicesStatus(OnlineServicesStatus.Failure);
        });

        // setOnlineServices(onlineServices);
    };

    const cleanupOnlineServices = () => {
        if (onlineWSServicesEndpoint) {
            onlineWSServicesEndpoint.disconnect();
            onlineWSServicesEndpoint.unbind_global();

            onlineWSServicesEndpoint = null;
        }
    };

    // This handler is used when we receive a message over WebRTC
    const onWebRTCMessageHandler = (
        dataChannelInstance: RTCDataChannel,
        device: LinkedDevice
    ): ((event: MessageEvent) => Promise<void>) => {
        return async (event: MessageEvent) => {
            if (unlockedVault == null) {
                return;
            }

            console.debug(
                "[WebRTC Message Handler] Received WebRTC message",
                event
            );

            // Validate the message
            const parsedMessage =
                await Synchronization.messageSchema.safeParseAsync(
                    JSON.parse(event.data)
                );

            if (!parsedMessage.success) {
                console.warn(
                    "[WebRTC Message Handler] Received invalid message over WebRTC",
                    parsedMessage.error
                );
                return;
            }

            const message = Synchronization.Message.fromSchema(
                parsedMessage.data
            );

            if (message.command === Synchronization.Command.SyncRequest) {
                // If we receive a request to sync, we will send a response
                console.debug(
                    "[WebRTC Message Handler] Received request to sync"
                );

                const myHash = await unlockedVault.getLatestHash();

                const responseMessage = Synchronization.Message.prepare(
                    Synchronization.Command.SyncResponse,
                    myHash,
                    null,
                    []
                );

                // If the hashes are the same - we're in sync
                // If the hashes are different - we're out of sync, there are a couple of options:
                // - If our hash is null, we don't have any data (unlike the other device) - we don't need to send any diffs, request a full sync
                // - If our hash is not null, we try to find the diff between the two hashes
                // -- If we cannot create a diff list, we send every hash we have and let the other device decide from which hash to start
                // -- If we can create a diff list, we send the diff list along with our latest hash
                if (message.hash === myHash) {
                    console.debug(
                        "[WebRTC Message Handler] Received request to sync - in sync"
                    );

                    // Update the last sync timestamp
                    unlockedVault.OnlineServices.LinkedDevices.find(
                        (d) => d.ID === device.ID
                    )?.updateLastSync();
                    setUnlockedVault(async (pre) => {
                        if (pre == null) {
                            return pre;
                        } else {
                            pre.OnlineServices.LinkedDevices =
                                unlockedVault.OnlineServices.LinkedDevices;
                            return pre;
                        }
                    });
                } else {
                    console.debug(
                        "[WebRTC Message Handler] Received request to sync - out of sync"
                    );

                    // NOTE: Should we check whether or not the message.hash is null?
                    // that way we wouldn't need to use the else block for the multiple situations

                    // In case our hash is null, we don't have any data (unlike the other device) - we don't need to send any diffs/hashes, request a full sync
                    if (myHash == null) {
                        console.debug(
                            "[WebRTC Message Handler] Received request to sync - out of sync - requesting full sync"
                        );

                        responseMessage.setCommand(
                            Synchronization.Command.SyncRequest
                        );
                    } else {
                        // If we have a hash, we can try to send the diff list, fall back to sending all hashes if we can't find the hash
                        const diffList = await unlockedVault.getDiffsSinceHash(
                            message.hash
                        );

                        // If the diff list is empty, we couldn't find the hash - send every hash we have and let the other device decide from which hash to start
                        // Otherwise, send the diff list we extracted from the vault
                        if (diffList.length > 0) {
                            responseMessage.setDiffList(diffList);

                            console.debug(
                                "[WebRTC Message Handler] Couldn't find the received hash - sending diff list to resolve the conflict. Diff list:",
                                diffList
                            );
                        } else {
                            responseMessage.setCommand(
                                Synchronization.Command.ResponseSyncAllHashes
                            );
                            responseMessage.setHash(
                                unlockedVault.getAllHashes().join(",")
                            );

                            console.debug(
                                "[WebRTC Message Handler] Couldn't find the received hash - sending all hashes to resolve the conflict. Hashes:",
                                responseMessage.hash
                            );
                        }
                    }
                }

                dataChannelInstance.send(responseMessage.serialize());
            } else if (
                message.command ===
                Synchronization.Command.ResponseSyncAllHashes
            ) {
                // If we receive a response with all hashes, we will try to find the first hash that we have in common
                console.debug(
                    "[WebRTC Message Handler] Received response with all hashes"
                );

                // Chech if someone is messing with us
                if (message.hash == null) {
                    console.warn(
                        "[WebRTC Message Handler] Received response with all hashes - but the hash is null"
                    );
                    return;
                }

                const hashes = message.hash.split(",");

                // Find the first hash that we have in common
                const firstHashInCommon = unlockedVault
                    .getAllHashes()
                    .find((h) => hashes.includes(h));

                console.debug(
                    "firstHashInCommon",
                    firstHashInCommon,
                    unlockedVault.getAllHashes(),
                    hashes
                );

                // We found a common hash, calculate the diff and send it to the other device with our latest hash (use the ResponseSync command)
                if (firstHashInCommon) {
                    // Find the index of the common hash in the received hashes array
                    const firstHashInCommonIndex =
                        hashes.indexOf(firstHashInCommon);

                    // If the index of the first hash in common is 0, the other device is out of sync - we have the most recent data
                    // If it's other than 0, we're diverged and we need to request a sync from the other device
                    const divergenceAtHash =
                        firstHashInCommonIndex > 0 ? firstHashInCommon : null;

                    console.debug(
                        "[WebRTC Message Handler] Found a hash in common - sending response to sync... Current vault data:",
                        unlockedVault
                    );

                    const responseMessage = Synchronization.Message.prepare(
                        Synchronization.Command.SyncResponse,
                        await unlockedVault.getLatestHash(),
                        divergenceAtHash,
                        await unlockedVault.getDiffsSinceHash(firstHashInCommon)
                    ).serialize();

                    dataChannelInstance.send(responseMessage);

                    toast.info(
                        "[Synchronization] Found a common history - syncing..."
                    );
                } else {
                    console.warn(
                        "[Synchronization] Couldn't find a common history - requesting divergence solve"
                    );
                    toast.warn(
                        "[Synchronization] Synchronization will require manual intervention, please wait..."
                    );

                    // Send a request to solve the divergence
                    const responseMessage = Synchronization.Message.prepare(
                        Synchronization.Command.DivergenceSolveRequest,
                        null,
                        null,
                        []
                    ).serialize();
                    dataChannelInstance.send(responseMessage);
                }
            } else if (
                message.command === Synchronization.Command.SyncResponse
            ) {
                // Check if we have the same hash - in sync
                if (message.hash === (await unlockedVault.getLatestHash())) {
                    console.debug(
                        "[WebRTC Message Handler] Received response to sync - in sync"
                    );

                    toast.info("[Synchronization] Devices are synchronized");

                    // Update the last sync timestamp
                    unlockedVault.OnlineServices.LinkedDevices.find(
                        (d) => d.ID === device.ID
                    )?.updateLastSync();
                    setUnlockedVault(async (pre) => {
                        if (pre == null) {
                            return pre;
                        } else {
                            pre.OnlineServices.LinkedDevices =
                                unlockedVault.OnlineServices.LinkedDevices;
                            return pre;
                        }
                    });
                } else {
                    // We're out of sync - try to apply the diffs and check if we're in sync
                    console.debug(
                        "[WebRTC Message Handler] Received response to sync - out of sync - applying diffs to a mock vault to validate diff list"
                    );
                    toast.info("[Synchronization] Validating diff list...", {
                        autoClose: false,
                        toastId: "validating-diff-list",
                        updateId: "validating-diff-list",
                    });

                    // Create a mock vault to try a dry run of the diff application
                    const mockUnlockedVault = new Vault();
                    mockUnlockedVault.Credentials = JSON.parse(
                        JSON.stringify(unlockedVault.Credentials)
                    );

                    // Set the online services to the mock vault - we need this to pass the write check for the diffs
                    mockUnlockedVault.OnlineServices =
                        unlockedVault.OnlineServices;

                    await mockUnlockedVault.applyDiffs(message.diffList);
                    const mockVaultHash =
                        await mockUnlockedVault.getLatestHash();

                    const hashMatches = mockVaultHash === message.hash;

                    console.debug(
                        `[WebRTC Message Handler] Applied diffs to mock vault - checking if we're in sync... ${mockVaultHash} === ${message.hash} => ${hashMatches}`
                    );

                    // Check if our new hash is the same as the other device's hash
                    // If we received a divergence hash, we're diverged and can skip this check
                    if (hashMatches || message.divergenceHash) {
                        console.debug(
                            "[WebRTC Message Handler] Received response to sync - out of sync => in sync - applying diffs to the real vault"
                        );
                        toast.update("validating-diff-list", {
                            autoClose: 1,
                        });
                        toast.info(
                            "[Synchronization] Applying differences...",
                            {
                                autoClose: false,
                                toastId: "applying-diff-list",
                                updateId: "applying-diff-list",
                            }
                        );

                        const diffsNotKnownByOtherDevice: Credential.Diff[] =
                            [];
                        if (message.divergenceHash) {
                            // If we received a divergence hash, we're diverged and we need to save the diffs that the other device doesn't know about
                            // So we can send them to the other device after we apply the diffs that we received from the other device
                            (
                                await unlockedVault.getDiffsSinceHash(
                                    message.divergenceHash
                                )
                            ).forEach((diff) => {
                                diffsNotKnownByOtherDevice.push(diff);
                            });
                        }

                        await unlockedVault.applyDiffs(message.diffList);

                        const latestHash = await unlockedVault.getLatestHash();
                        const hashMatches = latestHash === message.hash;

                        // Update the last sync timestamp
                        unlockedVault.OnlineServices.LinkedDevices.find(
                            (d) => d.ID === device.ID
                        )?.updateLastSync();
                        // setUnlockedVault((pre) => {
                        //     if (pre == null) {
                        //         return pre;
                        //     } else {
                        //         pre.OnlineServices.LinkedDevices =
                        //             unlockedVault.OnlineServices.LinkedDevices;
                        //         return pre;
                        //     }
                        // });

                        // Save the vault
                        unlockedVaultMetadata?.save(unlockedVault);

                        setUnlockedVault(async () => unlockedVault);

                        // Check if the last hash is the same as the other device's hash
                        if (hashMatches) {
                            // We're in sync - no diverging between the devices
                            console.debug(
                                "[WebRTC Message Handler] Received response to sync - out of sync => in sync"
                            );
                            toast.success(
                                "[Synchronization] Successfully synced with the other device",
                                {
                                    toastId: "applying-diff-list",
                                    updateId: "applying-diff-list",
                                }
                            );
                        } else if (!hashMatches && message.divergenceHash) {
                            console.debug(
                                "[WebRTC Message Handler] Received response to sync - out of sync => diverged - sending diff list to the other device"
                            );

                            toast.info(
                                "[Synchronization] Devices diverged - sending differences to the other device...",
                                {
                                    toastId: "applying-diff-list",
                                    updateId: "applying-diff-list",
                                }
                            );

                            // If it isn't, we're diverging
                            const syncMessage = Synchronization.Message.prepare(
                                Synchronization.Command.SyncResponse,
                                latestHash,
                                null,
                                diffsNotKnownByOtherDevice
                            ).serialize();

                            dataChannelInstance.send(syncMessage);
                        }
                    } else {
                        toast.error(
                            "Failed to sync - could not apply the received changes",
                            {
                                toastId: "validating-diff-list",
                                updateId: "validating-diff-list",
                            }
                        );
                        console.error(
                            "[WebRTC Message Handler] Received response to sync - out of sync => out of sync - failed to validate resulting data"
                        );
                        console.debug(
                            "[WebRTC Message Handler] Mock vault data:",
                            mockUnlockedVault
                        );
                    }
                }
            } else if (
                message.command ===
                Synchronization.Command.DivergenceSolveRequest
            ) {
                console.warn(
                    "[Synchronization] Received divergence solve request - responding..."
                );
                toast.info(
                    "[Synchronization] Devices diverged - preparing the differences...",
                    {
                        autoClose: false,
                        toastId: "generating-diff-list",
                        updateId: "generating-diff-list",
                    }
                );

                // Wait for a second to make sure the toast is shown
                await new Promise((resolve) => setTimeout(resolve, 100));

                const divergenceSolveResponse = Synchronization.Message.prepare(
                    Synchronization.Command.DivergenceSolve,
                    null,
                    null,
                    await unlockedVault.getDiffsSinceHash(null)
                ).serialize();

                dataChannelInstance.send(divergenceSolveResponse);

                toast.info(
                    "[Synchronization] Devices diverged - Check the other device to select which differences to apply",
                    {
                        toastId: "generating-diff-list",
                        updateId: "generating-diff-list",
                    }
                );
            } else if (
                message.command === Synchronization.Command.DivergenceSolve
            ) {
                // Open a dialog for the user to select which differences to apply
                showDivergenceSolveDialogRef.current?.(
                    unlockedVault.Credentials,
                    message.diffList.map((i) => i.Changes?.Props),
                    async (diffsToApply, diffsToSend) => {
                        toast.info(
                            "[Synchronization] Applying differences...",
                            {
                                autoClose: false,
                                toastId: "applying-diff-list",
                                updateId: "applying-diff-list",
                            }
                        );

                        // Apply the diffsToApply to the vault
                        await unlockedVault.applyDiffs(diffsToApply);

                        // Update the last sync timestamp
                        unlockedVault.OnlineServices.LinkedDevices.find(
                            (d) => d.ID === device.ID
                        )?.updateLastSync();
                        // setUnlockedVault((pre) => {
                        //     if (pre == null) {
                        //         return pre;
                        //     } else {
                        //         pre.OnlineServices.LinkedDevices =
                        //             unlockedVault.OnlineServices.LinkedDevices;
                        //         return pre;
                        //     }
                        // });

                        // Save the vault
                        unlockedVaultMetadata?.save(unlockedVault);
                        setUnlockedVault(async () => unlockedVault);

                        toast.info(
                            "[Synchronization] Changes applied to this vault. Sending differences to the other device...",
                            {
                                toastId: "applying-diff-list",
                                updateId: "applying-diff-list",
                            }
                        );

                        // Send the diffsToSend to the other device
                        const divergenceSolveResponse =
                            Synchronization.Message.prepare(
                                Synchronization.Command.SyncResponse,
                                await unlockedVault.getLatestHash(),
                                null,
                                diffsToSend
                            ).serialize();

                        dataChannelInstance.send(divergenceSolveResponse);
                    },
                    () => {
                        // Warn the user that the vaults are still diverged
                        toast.warn(
                            "[Synchronization] The vaults are still diverged - you can try to solve the differences again by synchronizing the vaults"
                        );
                    }
                );
            } else if (
                message.command === Synchronization.Command.LinkedDevicesList
            ) {
                if (message.linkedDevicesList == null) {
                    console.debug(
                        "[WebRTC Message Handler] Received linked devices list - but the list is null"
                    );
                    return;
                }

                const isDeviceRoot =
                    unlockedVault.OnlineServices.LinkedDevices.find(
                        (d) => d.ID === device.ID
                    )?.IsRoot;

                if (!isDeviceRoot) {
                    console.warn(
                        `[WebRTC Message Handler] Received linked devices list from '${device.Name}' - but the device is not root - ignoring`
                    );
                    return;
                }

                console.debug(
                    "[WebRTC Message Handler] Received linked devices list",
                    message.linkedDevicesList
                );

                let changesOccured = false;

                const devicesInReceivedList = message.linkedDevicesList.map(
                    (d) => d.ID
                );
                const devicesInCurrentList =
                    unlockedVault.OnlineServices.LinkedDevices.map((d) => d.ID);
                const currentDeviceCount = devicesInCurrentList.length;
                const intersection = devicesInReceivedList.filter((d) =>
                    devicesInCurrentList.includes(d)
                );

                // Update the IsRoot property of the devices that are in both lists
                intersection.forEach((d) => {
                    if (message.linkedDevicesList) {
                        const existingLinkedDevice =
                            unlockedVault.OnlineServices.LinkedDevices.find(
                                (ld) => ld.ID === d
                            );
                        const receivedLinkedDevice =
                            message.linkedDevicesList.find((ld) => ld.ID === d);

                        if (
                            existingLinkedDevice != null &&
                            receivedLinkedDevice != null
                        ) {
                            changesOccured ||=
                                existingLinkedDevice.IsRoot !==
                                receivedLinkedDevice.IsRoot;

                            existingLinkedDevice.IsRoot =
                                receivedLinkedDevice.IsRoot;
                        }
                    }
                });

                // Remove devices that are not in the received list
                unlockedVault.OnlineServices.LinkedDevices =
                    unlockedVault.OnlineServices.LinkedDevices.filter(
                        (d) =>
                            devicesInReceivedList.includes(d.ID) ||
                            d.ID === device.ID
                    );
                changesOccured ||=
                    currentDeviceCount !==
                    unlockedVault.OnlineServices.LinkedDevices.length;

                // Add devices that are in the received list but not in the current list
                message.linkedDevicesList.forEach((d) => {
                    if (
                        !unlockedVault.OnlineServices.LinkedDevices.find(
                            (ld) => ld.ID === d.ID
                        )
                    ) {
                        changesOccured = true;
                        unlockedVault.OnlineServices.addLinkedDevice(
                            d.ID,
                            d.Name,
                            d.IsRoot,
                            d.LinkedAtTimestamp,
                            d.AutoConnect,
                            d.SyncTimeout,
                            d.SyncTimeoutPeriod
                        );
                    }
                });

                if (changesOccured) {
                    setUnlockedVault(async () => unlockedVault);

                    // Save the vault
                    await unlockedVaultMetadata?.save(unlockedVault);
                    toast.info(
                        "[Synchronization] Successfully updated the list of linked devices"
                    );
                }
            } else {
                console.warn(
                    "[WebRTC Message Handler] Received invalid command",
                    message.command
                );
            }
        };
    };

    const sendLinkedDevicesList = (
        dataChannel: RTCDataChannel,
        devicesToExclude: string[]
    ) => {
        if (session?.user?.isRoot && unlockedVault) {
            const linkedDevicesPayload = Synchronization.Message.prepare(
                Synchronization.Command.LinkedDevicesList,
                null,
                null,
                [],
                unlockedVault.OnlineServices.getLinkedDevices(devicesToExclude)
            ).serialize();

            // Send the payload
            // Even if the linkedDeviceList is empty, we still need to send it (means we're the only devices linked)
            dataChannel.send(linkedDevicesPayload);
        }
    };

    const showEditLinkedDeviceDialog = (device: LinkedDevice) => {
        editLinkedDeviceDialogSelectedDeviceRef.current = device;
        showEditLinkedDeviceDialogFnRef.current();
    };

    // Make sure we're connected to online services if we have linked devices
    // This prevents us from connecting to online services if we don't need to
    // Check if the unlocked vault has loaded
    if (linkedDevicesLen != null) {
        const currentValue = linkedDevicesLen;
        const previousValue = linkedDevicesLenRef.current;

        // This prevents the comparison from running on the first render (while the previous value is null)
        if (previousValue != null) {
            // If the value has changed, run the comparison
            if (previousValue !== currentValue) {
                console.debug("Linked devices changed", currentValue);

                // If we have linked devices, connect to online services
                if (previousValue === 0 && currentValue > 0) {
                    console.debug(
                        "New linked devices, triggering online services setup"
                    );
                    setupOnlineServices();
                }

                // If we don't have linked devices, disconnect from online services
                if (currentValue === 0 && previousValue > 0) {
                    cleanupOnlineServices();
                }
            }
        }

        linkedDevicesLenRef.current = linkedDevicesLen;
    }

    const DeviceItem: React.FC<{
        device: LinkedDevice;
        onlineServices: OnlineServicesAccount;
        onlineServicesStatus: OnlineServicesStatus;
    }> = ({ device, onlineServices, onlineServicesStatus }) => {
        const optionsButtonRef = useRef<HTMLButtonElement | null>(null);

        const { mutateAsync: removeDevice } =
            trpc.account.removeDevice.useMutation();

        const [webRTCConnections, setWebRTCConnections] = useAtom(
            webRTCConnectionsAtom
        );

        const commonChannelName = React.useMemo(
            () =>
                constructSyncChannelName(
                    onlineServices.CreationTimestamp,
                    onlineServices.UserID ?? "",
                    device.ID,
                    device.LinkedAtTimestamp
                ),
            [onlineServices, device]
        );

        const webRTConnection = webRTCConnections.get(device.ID);
        const linkStatus = webRTConnection.State;

        const setLinkStatus = (state: Synchronization.LinkStatus) => {
            setWebRTCConnections((prev) => {
                prev.setState(device.ID, state);
                return Object.assign(
                    new Synchronization.WebRTCConnections(),
                    prev
                );
            });
        };

        console.debug("DeviceItem render", linkStatus);

        const initLink = (
            peerConnection: RTCPeerConnection,
            dataChannel: RTCDataChannel
        ) => {
            setWebRTCConnections((prev) => {
                prev.upsert(
                    device.ID,
                    peerConnection,
                    dataChannel,
                    Synchronization.LinkStatus.Connected
                );
                return Object.assign(
                    new Synchronization.WebRTCConnections(),
                    prev
                );
            });
        };

        const tearDownLink = (unsubscribe = false) => {
            setWebRTCConnections((prev) => {
                prev.remove(device.ID);
                return Object.assign(
                    new Synchronization.WebRTCConnections(),
                    prev
                );
            });
            if (onlineWSServicesEndpoint && unsubscribe) {
                onlineWSServicesEndpoint.unsubscribe(commonChannelName);
            }
        };

        const synchronizeNow = async (device: LinkedDevice) => {
            if (!unlockedVault) {
                return;
            }

            // Check if we're connected to the device
            if (!webRTConnection) {
                console.warn(
                    "[Manual Sync] Not connected to device",
                    device.ID
                );
                return;
            }

            console.debug("[Manual Sync] Triggered for device", device.ID);

            const currentHash = await unlockedVault.getLatestHash();

            console.debug(
                "[Manual Sync] Sending request to device",
                device.ID,
                currentHash
            );

            // Send a message to the device
            const syncRequestPayload = Synchronization.Message.prepare(
                Synchronization.Command.SyncRequest,
                currentHash,
                null,
                []
            ).serialize();
            webRTConnection.DataChannel?.send(syncRequestPayload);
        };

        const unlinkDevice = async (device: LinkedDevice) => {
            if (!unlockedVault || !unlockedVaultMetadata || !session) {
                return;
            }

            if (!session.user?.isRoot) {
                toast.error("Only the root device can unlink other devices.");
                return;
            }

            showWarningFn(
                "Unlinking a device will prevent it from modifying the vault, effectively cutting it off from the rest of the network.",
                async () => {
                    tearDownLink(true);

                    unlockedVault.OnlineServices.removeLinkedDevice(device.ID);

                    // Update the vault
                    setUnlockedVault(async () => unlockedVault);

                    // Try to remove the device from the online services
                    try {
                        await removeDevice({
                            deviceId: device.ID,
                        });
                    } catch (err) {
                        console.warn(
                            "Tried to remove device from online services but failed",
                            err
                        );
                        toast.warn(
                            "Couldn't remove device from online services. Please remove the device manually in the Account dialog."
                        );
                    }

                    // Save the vault metadata
                    try {
                        await unlockedVaultMetadata.save(unlockedVault);
                    } catch (err) {
                        console.error("Failed to save vault metadata", err);
                        toast.error(
                            "Failed to save vault data. There is a high probability of data loss."
                        );
                    }
                },
                null
            );
        };

        const disconnectReconnectDevice = () => {
            if (
                webRTConnection?.DataChannel?.readyState === "open" ||
                webRTConnection?.DataChannel?.readyState === "connecting" ||
                onlineWSServicesEndpoint
                    ?.allChannels()
                    .some(
                        (c) =>
                            c.name === commonChannelName &&
                            (c.subscribed || c.subscriptionPending)
                    )
            ) {
                setWebRTCConnections((prev) => {
                    prev.setManualDisconnect(device.ID, true);
                    return Object.assign(
                        new Synchronization.WebRTCConnections(),
                        prev
                    );
                });

                tearDownLink(true);
            } else {
                setWebRTCConnections((prev) => {
                    prev.setManualDisconnect(device.ID, false);
                    return Object.assign(
                        new Synchronization.WebRTCConnections(),
                        prev
                    );
                });

                // In case we're not connected to online services, this will set it up and then connect to the device
                setupDeviceLink(true);
            }
        };

        const contextMenuOptions: {
            disabled: boolean;
            visible: boolean;
            name: string;
            onClick: (device: LinkedDevice) => Promise<void>;
        }[] = [
            {
                disabled: linkStatus === Synchronization.LinkStatus.Connecting,
                visible: linkStatus !== Synchronization.LinkStatus.Connecting,
                name:
                    linkStatus === Synchronization.LinkStatus.Connected ||
                    linkStatus === Synchronization.LinkStatus.WaitingForDevice
                        ? "Disconnect"
                        : "Connect",
                onClick: async () => {
                    disconnectReconnectDevice();
                },
            },
            {
                disabled: linkStatus !== Synchronization.LinkStatus.Connected,
                visible: true,
                name: "Synchonize now",
                onClick: async (device) => {
                    await synchronizeNow(device);
                },
            },
            {
                disabled: false,
                visible: true,
                name: "Unlink device",
                onClick: async (device) => {
                    await unlinkDevice(device);
                },
            },
            {
                disabled: false,
                visible: true,
                name: "Edit",
                onClick: async (device) => {
                    showEditLinkedDeviceDialog(device);
                },
            },
        ];

        const setupDeviceLink = (forceConnect = false) => {
            // If we don't have an online services instance, we will try to create one
            if (
                !onlineWSServicesEndpoint ||
                onlineWSServicesEndpoint?.connection.state === "disconnected"
            ) {
                setupOnlineServices(() => setupDeviceLink(forceConnect));
                return;
            }

            // console.debug(
            //     "[setupDeviceLinks] Setting up device links... Specific device:",
            //     deviceID
            // );
            // If we're not connected to the signaling server, return
            if (onlineWSServicesEndpoint?.connection.state !== "connected") {
                return;
            }

            // If we have a user identifier, we can try to subscribe
            const ownIdentifier = onlineServices.UserID;
            if (!ownIdentifier) return;

            // This will be the event name that we will use to communicate over the pusher channel
            const commonEventName = "client-private-connection-setup";

            // Subscribe to a predetermined channel name
            // Set up event handlers for presence and other events
            // If we already have a connection to this device, we don't need to do anything
            if (
                webRTConnection.State ===
                    Synchronization.LinkStatus.Connected ||
                webRTConnection.State ===
                    Synchronization.LinkStatus.Connecting ||
                webRTConnection.State ===
                    Synchronization.LinkStatus.WaitingForDevice
            ) {
                return;
            }

            // Check if we should autoconnect to this device
            // This check is only relevant if we are not trying to connect to a specific device
            // if (device.AutoConnect == false && deviceID == null) {
            if (device.AutoConnect == false && forceConnect == false) {
                return;
            }

            // Check if the user disconnected from this device manually
            // If so, we will not try to connect to it unless the user manually reconnects (deviceID != null)
            if (webRTConnection.ManualDisconnect && forceConnect == false) {
                console.debug(
                    "[setupDeviceLinks] Skipping autoconnect to",
                    device.ID,
                    "because it was manually disconnected"
                );
                return;
            }

            // console.debug(
            //     "[setupDeviceLinks] Current WebRTC connections",
            //     webRTConnectionsRef.current
            // );

            // Initialize a new WebRTC connection - so we can communicate directly with the other device
            let _webRTConnection: RTCPeerConnection | null = null;

            // Check if we're already subscribed to this channel
            if (
                onlineWSServicesEndpoint
                    .allChannels()
                    .some(
                        (c) =>
                            c.name === commonChannelName &&
                            (c.subscribed || c.subscriptionPending)
                    )
            ) {
                console.debug(
                    "[setupDeviceLinks] Already subscribed to channel",
                    commonChannelName
                );

                if (
                    linkStatus !== Synchronization.LinkStatus.WaitingForDevice
                ) {
                    setLinkStatus(Synchronization.LinkStatus.WaitingForDevice);
                }

                return;
            }

            console.debug(
                "[setupDeviceLinks] Trying to connect to device",
                device
            );

            const channel =
                onlineWSServicesEndpoint.subscribe(commonChannelName);

            /**
             * Short explanation of the following code:
             *  - We need to set up a WebRTC connection between the two devices using the Pusher channel as a signaling server.
             *  - If we're the first device to connect, we need to send an offer - the member_added event will be triggered, we set the weAreFirst flag to true.
             *  - If we're not the first device to connect, we need to wait for the offer, and then send an answer.
             *  - Both devices need to be able to exchange the ICE candidates.
             */

            let weAreFirst = false;
            let iceCandidatesWeGenerated = 0;

            type PusherSignalingMessagesType = {
                type: "offer" | "answer" | "ice-candidate";
                data: RTCIceCandidateInit | RTCSessionDescriptionInit | null;
            };

            channel.bind(
                "pusher:subscription_succeeded",
                async (context: { count: number }) => {
                    setLinkStatus(Synchronization.LinkStatus.WaitingForDevice);

                    weAreFirst = context.count === 1;
                    console.debug(
                        "Subscription succeeded",
                        weAreFirst ? "--We're first" : "--We're NOT first"
                    );

                    _webRTConnection = await newWebRTCConnection();
                    _webRTConnection.onconnectionstatechange = () => {
                        console.debug(
                            "Connection state changed",
                            _webRTConnection?.connectionState
                        );
                        if (_webRTConnection?.connectionState === "connected") {
                            console.debug(
                                "Private connection established -",
                                commonChannelName
                            );

                            // Clean up the channel subscription
                            channel.unsubscribe();
                            channel.unbind();

                            if (device.SyncTimeout) {
                                setTimeout(() => {
                                    console.debug(
                                        "Sync timeout reached - disconnecting from the private channel"
                                    );
                                    tearDownLink();
                                }, Math.abs(device.SyncTimeoutPeriod) * 1000);
                            }
                        } else if (
                            _webRTConnection?.connectionState === "connecting"
                        ) {
                            setLinkStatus(
                                Synchronization.LinkStatus.Connecting
                            );
                        } else if (
                            _webRTConnection?.connectionState === "disconnected"
                        ) {
                            console.debug(
                                "Private connection disconnected -",
                                commonChannelName
                            );

                            // Remove the connection from the list
                            // Inhibit reconnecting if the device is not set to auto-connect or if the sync timeout has been reached
                            tearDownLink();
                            if (device.AutoConnect && !device.SyncTimeout) {
                                setupDeviceLink(true);
                            }
                        }
                    };

                    if (weAreFirst) {
                        // Since we're first, we need to create a data channel
                        const dataChannel = _webRTConnection.createDataChannel(
                            `sync-${device.ID}`
                        );
                        dataChannel.onopen = () => {
                            console.debug("[1st] Data channel opened");

                            // Add the webRTC connection to the list
                            if (_webRTConnection)
                                initLink(_webRTConnection, dataChannel);

                            // Send the linked devices list to the other device (only if we're root)
                            sendLinkedDevicesList(dataChannel, [device.ID]);
                        };
                        dataChannel.onmessage = onWebRTCMessageHandler(
                            dataChannel,
                            device
                        );
                        dataChannel.onclose = () => {
                            console.debug("[1st] Data channel closed");

                            // Remove and clean up the WebRTC connection from the list
                            tearDownLink();
                            if (device.AutoConnect && !device.SyncTimeout) {
                                setupDeviceLink(true);
                            }
                        };
                        dataChannel.onerror = (error) => {
                            console.debug("[1st] Data channel error", error);

                            // Clean up the WebRTC connection
                            tearDownLink();
                        };
                    }

                    // When we acquire an ICE candidate, send it to the other device
                    // This is being called only after we call setLocalDescription
                    _webRTConnection.onicecandidate = async (event) => {
                        if (event && event.candidate) {
                            console.debug(
                                "Sending ICE candidate",
                                event.candidate
                            );
                            channel.trigger(commonEventName, {
                                type: "ice-candidate",
                                data: event.candidate,
                            } as PusherSignalingMessagesType);

                            iceCandidatesWeGenerated++;
                        }

                        // When the event.candidate object is null - we're done
                        // NOTE: Might be helpful to send that to the other device and we can show a notification
                        if (event?.candidate == null) {
                            console.debug(
                                "Sending ICE completed event",
                                event.candidate
                            );

                            channel.trigger(commonEventName, {
                                type: "ice-candidate",
                                data: null,
                            } as PusherSignalingMessagesType);
                        }

                        // If we havent generated any ICE candidates, and this event was triggered without a candidate, we're done
                        if (
                            iceCandidatesWeGenerated === 0 &&
                            !event.candidate
                        ) {
                            console.error("Failed to generate ICE candidates.");

                            setLinkStatus(Synchronization.LinkStatus.Failure);
                        }
                    };
                }
            );

            channel.bind(
                commonEventName,
                async (data: PusherSignalingMessagesType) => {
                    console.debug(
                        "ws received",
                        data,
                        `|| Are we first? ${weAreFirst}`
                    );

                    if (data.type === "ice-candidate") {
                        if (data.data) {
                            await _webRTConnection?.addIceCandidate(
                                data.data as RTCIceCandidateInit
                            );
                        } else if (
                            _webRTConnection?.connectionState != "connecting"
                        ) {
                            toast.warn(
                                `[Synchronization] Failed to connect to ${device.Name}`
                            );
                        }
                    }

                    if (weAreFirst) {
                        // If we're first, we sent the offer, so we need to handle the answer
                        if (data.type === "answer") {
                            await _webRTConnection?.setRemoteDescription(
                                data.data as RTCSessionDescriptionInit
                            );
                        }
                    } else {
                        // If we're not first, we received the offer, so we need to handle the answer
                        if (data.type === "offer") {
                            if (!_webRTConnection) {
                                console.error(
                                    "WebRTC connection not initialized"
                                );
                                return;
                            }

                            // This event is triggered when we're not the first device to connect
                            _webRTConnection.ondatachannel = (event) => {
                                console.debug("Data channel received");

                                const dataChannel = event.channel;
                                dataChannel.onopen = () => {
                                    console.debug("[2nd] Data channel opened");

                                    // Add the webRTC connection to the list
                                    if (_webRTConnection)
                                        initLink(_webRTConnection, dataChannel);

                                    // Send the linked devices list to the other device (only if we're root)
                                    sendLinkedDevicesList(dataChannel, [
                                        device.ID,
                                    ]);
                                };

                                dataChannel.onmessage = onWebRTCMessageHandler(
                                    dataChannel,
                                    device
                                );

                                dataChannel.onclose = () => {
                                    console.debug("[2nd] Data channel closed");

                                    // Remove and clean up the WebRTC connection from the list
                                    tearDownLink();
                                    if (
                                        device.AutoConnect &&
                                        !device.SyncTimeout
                                    ) {
                                        setupDeviceLink(true);
                                    }
                                };

                                dataChannel.onerror = (event) => {
                                    console.debug(
                                        "[2nd] Data channel error",
                                        event
                                    );

                                    // Clean up the WebRTC connection
                                    tearDownLink();
                                };
                            };

                            await _webRTConnection.setRemoteDescription(
                                data.data as RTCSessionDescriptionInit
                            );

                            // Create an answer and set it as the local description
                            const answer =
                                await _webRTConnection.createAnswer();
                            await _webRTConnection.setLocalDescription(answer);

                            // Send the answer to the other device
                            channel.trigger(commonEventName, {
                                type: "answer",
                                data: answer,
                            } as PusherSignalingMessagesType);

                            console.debug("Answer sent", answer);
                        }
                    }
                }
            );

            // When the other device connects, send an offer if we are the first to connect
            // This only triggers if we are the first to connect
            channel.bind(
                "pusher:member_added",
                async (osDevice: { id: string }) => {
                    if (!_webRTConnection) {
                        console.error(
                            "[Member] WebRTC connection not initialized"
                        );
                        return;
                    }

                    console.debug("Other device connected", osDevice);

                    // Create an offer and set it as the local description
                    const offer = await _webRTConnection.createOffer();
                    await _webRTConnection.setLocalDescription(offer);

                    const dataToSend = _webRTConnection.localDescription;

                    channel.trigger(commonEventName, {
                        type: "offer",
                        data: offer,
                    } as PusherSignalingMessagesType);

                    console.debug("Offer sent", dataToSend);
                }
            );
        };

        const lastSynced = device.LastSync
            ? dayjs(device.LastSync).fromNow()
            : "Never synced";

        useEffect(() => {
            // If we manage to connect to online services, we can try to trigger the direct connection setup
            if (onlineServicesStatus === OnlineServicesStatus.Connected) {
                setupDeviceLink();
            }
        }, [onlineServicesStatus]);

        return (
            <div
                key={`device-${device.ID}-${webRTConnection.State}`}
                className="mr-2 mt-1 flex flex-col gap-2 rounded-md border border-slate-700"
                onContextMenu={(e) => {
                    e.preventDefault();
                    optionsButtonRef.current?.click();
                }}
            >
                <div className="ml-2 flex cursor-pointer items-center gap-2 text-slate-400 hover:text-slate-500">
                    <div>
                        <DevicePhoneMobileIcon className="h-5 w-5" />
                    </div>
                    <div
                        className="flex flex-grow flex-col overflow-x-hidden py-1"
                        onClick={async () => await synchronizeNow(device)}
                    >
                        <p
                            className="line-clamp-1 overflow-hidden text-base font-medium"
                            title={device.Name}
                        >
                            {device.Name}
                        </p>
                        <div className="flex flex-col items-start">
                            {/* Connection status */}
                            <p
                                className={clsx({
                                    "flex h-full items-center rounded border px-1 text-xs capitalize":
                                        true,
                                    "border-green-500/50 text-green-500":
                                        webRTConnection.State ===
                                        Synchronization.LinkStatus.Connected,
                                    "border-red-500/50 text-red-500":
                                        webRTConnection.State ===
                                            Synchronization.LinkStatus
                                                .Disconnected ||
                                        webRTConnection.State ===
                                            Synchronization.LinkStatus.Failure,
                                    "border-yellow-500/50 text-yellow-500":
                                        webRTConnection.State ===
                                            Synchronization.LinkStatus
                                                .Connecting ||
                                        webRTConnection.State ===
                                            Synchronization.LinkStatus
                                                .WaitingForDevice,
                                })}
                            >
                                {webRTConnection.State ===
                                    Synchronization.LinkStatus.Connected &&
                                    "Connected"}
                                {webRTConnection.State ===
                                    Synchronization.LinkStatus.Connecting && (
                                    <span className="ml-1 animate-pulse">
                                        Connecting...
                                    </span>
                                )}
                                {webRTConnection.State ===
                                    Synchronization.LinkStatus
                                        .WaitingForDevice && (
                                    <span className="ml-1 animate-pulse">
                                        Waiting for device...
                                    </span>
                                )}
                                {webRTConnection.State ===
                                    Synchronization.LinkStatus.Disconnected &&
                                    "Disconnected"}
                                {webRTConnection.State ===
                                    Synchronization.LinkStatus.Failure &&
                                    "Failure"}
                            </p>
                            {/* Last synchronization date */}
                            <p
                                className="ml-1 text-xs normal-case text-slate-300/50"
                                title={
                                    device.LastSync
                                        ? `Last synchronized ${lastSynced}`
                                        : "Never synchronized"
                                }
                            >
                                {lastSynced}
                            </p>
                        </div>
                        {/* <span
                            className={clsx({
                                "relative flex h-3 w-3": true,
                                hidden: false,
                            })}
                        >
                            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[#FF5668] opacity-75"></span>
                            <span className="absolute inline-flex h-3 w-3 rounded-full bg-[#FF5668]"></span>
                        </span> */}
                    </div>
                    <Menu as="div" className="relative">
                        <Menu.Button
                            ref={optionsButtonRef}
                            className="flex h-full items-center"
                        >
                            <EllipsisVerticalIcon className="h-6 w-6 text-gray-400 hover:text-gray-500" />
                        </Menu.Button>
                        <Transition
                            as={React.Fragment}
                            enter="transition ease-out duration-100"
                            enterFrom="transform opacity-0 scale-95"
                            enterTo="transform opacity-100 scale-100"
                            leave="transition ease-in duration-75"
                            leaveFrom="transform opacity-100 scale-100"
                            leaveTo="transform opacity-0 scale-95"
                        >
                            <Menu.Items className="absolute right-0 z-10 mt-2 w-48 origin-top-right rounded-md bg-gray-800 shadow-lg focus:outline-none">
                                <div className="py-1">
                                    {contextMenuOptions.map((option, index) => (
                                        <Menu.Item key={index}>
                                            {({ active }) => {
                                                const hoverClass = clsx({
                                                    "bg-gray-900 text-white select-none":
                                                        active &&
                                                        !option.disabled,
                                                    "flex px-4 py-2 text-sm font-semibold text-gray-200":
                                                        true,
                                                    "pointer-events-none opacity-50":
                                                        option.disabled,
                                                    hidden: !option.visible,
                                                });
                                                return (
                                                    <a
                                                        className={hoverClass}
                                                        onClick={
                                                            option.disabled
                                                                ? () => {
                                                                      // NO-OP
                                                                  }
                                                                : () =>
                                                                      option.onClick(
                                                                          device
                                                                      )
                                                        }
                                                    >
                                                        {option.name}
                                                    </a>
                                                );
                                            }}
                                        </Menu.Item>
                                    ))}
                                </div>
                            </Menu.Items>
                        </Transition>
                    </Menu>
                </div>
            </div>
        );
    };

    console.debug("OnlineServices - render");

    // This is triggered only once, when the component is mounted (and unmounted)
    useEffect(() => {
        console.debug("OnlineServices - useEffect - MOUNT");

        setupOnlineServices();

        // On component unmount - disconnect from the online services and clean up all of the WebRTC connections
        return () => {
            console.debug("OnlineServices - useEffect - UNMOUNT");

            // Disconnect from the online services - if we're connected
            cleanupOnlineServices();
        };
    }, []);

    if (!unlockedVault) {
        return null;
    }

    return (
        <div>
            <DashboardSidebarMenuItem
                Icon={LinkIcon}
                text="Link a Device"
                onClick={() => showLinkingDeviceDialogFnRef.current?.()}
            />
            {/* <DashboardSidebarMenuItem
                Icon={GlobeAltIcon}
                text="Configuration"
                onClick={() => showLinkingDeviceDialogFnRef.current?.()}
            /> */}
            <div className="mt-1 border-l-2 border-slate-500 pl-2">
                <div className="flex items-center gap-1">
                    <p className="text-sm text-slate-500">Online Services</p>
                    <p className="text-sm text-slate-500"> - </p>
                    <p
                        className={clsx({
                            "text-sm capitalize": true,
                            "text-slate-500/50":
                                onlineServicesStatus ===
                                OnlineServicesStatus.NoAccount,
                            "text-slate-500":
                                onlineServicesStatus ===
                                OnlineServicesStatus.NoDevices,
                            "animate-pulse text-slate-500":
                                onlineServicesStatus ===
                                OnlineServicesStatus.Connecting,
                            "text-green-500":
                                onlineServicesStatus ===
                                OnlineServicesStatus.Connected,
                            "text-red-500":
                                onlineServicesStatus ===
                                OnlineServicesStatus.Disconnected,
                            "text-orange-500":
                                onlineServicesStatus ===
                                OnlineServicesStatus.Unavailable,
                            "text-red-500/50":
                                onlineServicesStatus ===
                                OnlineServicesStatus.Failure,
                        })}
                    >
                        {onlineServicesStatus}
                    </p>
                </div>
                {unlockedVault.OnlineServices.LinkedDevices.map((device) => (
                    <DeviceItem
                        key={device.ID}
                        device={device}
                        onlineServices={unlockedVault.OnlineServices}
                        onlineServicesStatus={onlineServicesStatus}
                    />
                ))}
                {
                    // If there are no linked devices, show a message
                    onlineServicesStatus === OnlineServicesStatus.NoAccount && (
                        <p className="mt-2 text-center text-sm text-slate-500">
                            No linked devices - Link a device to synchronize
                        </p>
                    )
                }
            </div>
            {process.env.NODE_ENV === "development" && (
                <div className="my-3 border-y">
                    <DashboardSidebarMenuItem
                        Icon={XMarkIcon}
                        text="[DEBUG] Clear Diff list"
                        onClick={() => {
                            console.debug(
                                "[DEBUG] Clear Diff list - before -",
                                unlockedVault.Diffs
                            );

                            unlockedVault.Diffs = [];
                            setUnlockedVault(async () => unlockedVault);
                            unlockedVaultMetadata?.save(unlockedVault);

                            console.debug(
                                "[DEBUG] Clear Diff list - after -",
                                unlockedVault.Diffs
                            );
                        }}
                    />
                </div>
            )}
            <LinkDeviceInsideVaultDialog
                showDialogFnRef={showLinkingDeviceDialogFnRef}
            />
            <EditLinkedDeviceDialog
                showDialogFnRef={showEditLinkedDeviceDialogFnRef}
                selectedDevice={editLinkedDeviceDialogSelectedDeviceRef}
                vaultMetadata={unlockedVaultMetadata}
            />
            <DivergenceSolveDialog
                showDialogFnRef={showDivergenceSolveDialogRef}
                showWarningDialog={showWarningFn}
            />
        </div>
    );
};
//#endregion Linking vaults

const DashboardSidebarMenuItem: React.FC<{
    Icon: typeof ArrowUpCircleIcon; // Take the type of an arbitrary icon
    text: string;
    onClick?: () => void;
    pulsatingIndicatorVisible?: boolean;
}> = ({ Icon, text, onClick, pulsatingIndicatorVisible }) => {
    return (
        <div
            className="ml-5 flex cursor-pointer items-center gap-2 text-slate-400 hover:text-slate-500"
            onClick={onClick}
        >
            <Icon className="h-7 w-7" />
            <div className="flex gap-1">
                <p className="text-base font-semibold">{text}</p>
                <span
                    className={clsx({
                        "relative flex h-3 w-3": true,
                        hidden: !pulsatingIndicatorVisible,
                    })}
                >
                    <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[#FF5668] opacity-75"></span>
                    <span className="absolute inline-flex h-3 w-3 rounded-full bg-[#FF5668]"></span>
                </span>
            </div>
        </div>
    );
};

const DashboardSidebarMenuFeatureVoting: React.FC<{
    onClick?: () => void;
}> = ({ onClick }) => {
    const session = useSession();

    // This component is separate so that we don't rerender the whole dashboard
    // If the TRPC call resolves to a different value

    // Fetch the featureVoting.openRound trpc query if we're logged in (have a session)
    const { data: openRoundExists } =
        trpc.featureVoting.openRoundExists.useQuery(undefined, {
            retry: false,
            enabled: !!session && !!session.data,
            refetchOnWindowFocus: false,
        });

    return (
        <DashboardSidebarMenuItem
            Icon={ArrowUpCircleIcon}
            text="Feature Voting"
            onClick={onClick}
            pulsatingIndicatorVisible={openRoundExists?.result}
        />
    );
};

//#region Vault dashboard
const VaultDashboard: React.FC = ({}) => {
    // console.log("AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA");

    const vaultMetadata = useAtomValue(unlockedVaultMetadataAtom);
    const setUnlockedVaultMetadata = useSetAtom(unlockedVaultMetadataAtom);
    const setUnlockedVault = useSetAtom(unlockedVaultWriteOnlyAtom);

    const [isSidebarOpen, setIsSidebarOpen] = useState(false);
    const sidebarSelector = ".sidebar-event-selector";
    const toggleSidebar = () => setIsSidebarOpen(!isSidebarOpen);
    const closeSidebarOnOutsideClick = (e: MouseEvent) => {
        // TODO: Fix this, isSidebarOpen is always false
        if (
            e.target instanceof HTMLElement &&
            isSidebarOpen &&
            unlockedVaultAtom
        ) {
            if (!e.target.closest(sidebarSelector)) {
                setIsSidebarOpen(false);
            }
        }
    };

    const showWarningDialogFnRef = useRef<WarningDialogShowFn | null>(null);
    const showWarningDialog: WarningDialogShowFn = (
        description: string,
        onConfirm: () => void,
        onDismiss: (() => void) | null
    ) => {
        showWarningDialogFnRef.current?.(description, onConfirm, onDismiss);
    };

    const showNewCredentialsDialogFnRef = useRef<(() => void) | null>(null);

    const showAccountSignUpSignInDialogRef = useRef<(() => void) | null>(null);
    const showRecoveryGenerationDialogRef = useRef<(() => void) | null>(null);
    const showFeatureVotingDialogRef = useRef<(() => void) | null>(null);
    const showVaultSettingsDialogRef = useRef<() => void>(() => {
        // No-op
    });

    const showCredentialsGeneratorDialogFnRef = useRef<() => void>(() => {
        // No-op
    });

    const lockVault = async (vaultMetadata: VaultMetadata) => {
        toast.info("Securing vault...", {
            autoClose: false,
            closeButton: false,
            toastId: "lock-vault",
            updateId: "lock-vault",
        });

        // A little delay to make sure the toast is shown
        await new Promise((resolve) => setTimeout(resolve, 100));

        // NOTE: Why can't this just be an async function????
        setUnlockedVault(async (pre) => {
            if (!pre) return null;

            // Trigger the vault's save function (this might not be needed when the auto-save feature is implemented)
            // NOTE: This might not work, since we are not awaiting the save function
            try {
                await vaultMetadata.save(pre);
                toast.success("Vault secured.", {
                    autoClose: 3000,
                    closeButton: true,
                    toastId: "lock-vault",
                    updateId: "lock-vault",
                });

                setUnlockedVaultMetadata(null);
            } catch (e) {
                console.error(`Failed to save vault: ${e}`);
                toast.error(
                    "Failed to save vault. There is a high possibility of data loss!",
                    {
                        closeButton: true,
                        toastId: "lock-vault",
                        updateId: "lock-vault",
                    }
                );
            }

            // Clean up the unlocked vault - remove all data from the atom
            return null;
        });
    };

    useEffect(() => {
        // Bind the event listener
        document.addEventListener("click", closeSidebarOnOutsideClick);

        return () => {
            // Unbind the event listener on clean up
            document.removeEventListener("click", closeSidebarOnOutsideClick);
        };
    }, []);

    // console.log("BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB");

    if (!vaultMetadata) return null;

    // console.log("CCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC");

    return (
        <>
            <NavBar
                overrideLogoUrl={null}
                className="flex-row flex-nowrap justify-between p-3 px-4 sm:px-3"
                logoContainerClassName="hidden sm:flex"
            >
                <div className="flex transition-all sm:hidden">
                    {isSidebarOpen ? (
                        <XMarkIcon
                            className="h-6 w-6 text-slate-400"
                            onClick={() => toggleSidebar()}
                        />
                    ) : (
                        <Bars3Icon
                            className="h-6 w-6 text-slate-400"
                            onClick={() => toggleSidebar()}
                        />
                    )}
                </div>
                <div className="hidden md:block">
                    <VaultTitle title={vaultMetadata.Name} />
                </div>
                <AccountHeaderWidget
                    showAccountSignUpSignInDialog={() =>
                        showAccountSignUpSignInDialogRef.current?.()
                    }
                    showWarningDialogFn={showWarningDialog}
                    showRecoveryGenerationDialogFnRef={
                        showRecoveryGenerationDialogRef
                    }
                />
            </NavBar>
            <div className="flex flex-grow flex-row overflow-hidden">
                <div
                    className={clsx({
                        "flex min-w-0 max-w-[250px] flex-col gap-3 overflow-hidden pt-1 transition-all duration-300 ease-in-out sm:min-w-[250px]":
                            true,
                        [sidebarSelector.slice(1)]: true, // We use this class to select the sidebar in the closeSidebarOnOutsideClick function
                        "w-0 px-0": !isSidebarOpen,
                        "min-w-[90vw] border-r-2 border-slate-800/60 px-1 sm:border-r-0":
                            isSidebarOpen,
                    })}
                >
                    <div className="block md:hidden">
                        <VaultTitle title={vaultMetadata.Name} />
                    </div>
                    <div className="my-5 block h-1 rounded-md bg-slate-300/25 sm:hidden" />
                    {/* TODO: This should be made prettier on mobile */}
                    <div className="block w-full px-5">
                        <ButtonFlat
                            text="New Item"
                            className="w-full"
                            inhibitAutoWidth={true}
                            onClick={() =>
                                showNewCredentialsDialogFnRef.current?.()
                            }
                        />
                    </div>
                    <div className="mt-5 flex h-px flex-grow gap-5 overflow-y-auto overflow-x-clip">
                        <div className="flex w-full flex-col gap-2">
                            <p className="text-sm text-slate-500">
                                Synchronization
                            </p>
                            <DashboardSidebarSynchronization
                                showWarningFn={showWarningDialog}
                            />
                            <p className="text-sm text-slate-500">
                                CryptexVault
                            </p>
                            <DashboardSidebarMenuFeatureVoting
                                onClick={() =>
                                    showFeatureVotingDialogRef.current?.()
                                }
                            />
                            <p className="text-sm text-slate-500">Vault</p>
                            <DashboardSidebarMenuItem
                                Icon={KeyIcon}
                                text="Credentials Generator"
                                onClick={() =>
                                    showCredentialsGeneratorDialogFnRef.current()
                                }
                            />
                            <DashboardSidebarMenuItem
                                Icon={Cog8ToothIcon}
                                text="Settings"
                                onClick={() =>
                                    showVaultSettingsDialogRef.current?.()
                                }
                            />
                            <DashboardSidebarMenuItem
                                Icon={LockClosedIcon}
                                text="Lock Vault"
                                onClick={() => lockVault(vaultMetadata)}
                            />
                        </div>
                    </div>
                </div>
                <div
                    className={clsx({
                        "flex flex-grow flex-col border-t border-slate-700 sm:rounded-tl-md sm:border-l sm:blur-none":
                            true,
                        "pointer-events-none blur-sm sm:pointer-events-auto":
                            isSidebarOpen,
                    })}
                >
                    <CredentialsList
                        showNewCredentialsDialogFn={
                            showNewCredentialsDialogFnRef
                        }
                        showWarningDialog={showWarningDialog}
                        showCredentialsGeneratorDialogFn={
                            showCredentialsGeneratorDialogFnRef
                        }
                    />
                </div>
            </div>
            <WarningDialog showFnRef={showWarningDialogFnRef} />
            <VaultSettingsDialog
                showDialogFnRef={showVaultSettingsDialogRef}
                showWarningDialog={showWarningDialog}
            />
            <FeatureVotingDialog showDialogFnRef={showFeatureVotingDialogRef} />
            <AccountSignUpSignInDialog
                showDialogFnRef={showAccountSignUpSignInDialogRef}
                vaultMetadata={vaultMetadata}
                showRecoveryGenerationDialogFnRef={
                    showRecoveryGenerationDialogRef
                }
            />
            <RecoveryGenerationDialog
                showDialogFnRef={showRecoveryGenerationDialogRef}
            />
            <EmailNotVerifiedDialog />
            <CredentialsGeneratorDialog
                showDialogFnRef={showCredentialsGeneratorDialogFnRef}
            />
        </>
    );
};

// Vault item search bar that resembles the GitHub Projects search bar behaviour
const SearchBar: React.FC<{
    filter: React.Dispatch<React.SetStateAction<string>>;
}> = ({ filter }) => {
    const { register, watch, getValues, setValue, setFocus } = useForm<{
        search: string;
    }>({
        defaultValues: {
            search: "",
        },
    });

    const inputTimeoutRef = useRef<NodeJS.Timeout | null>(null);

    const onInput = () => {
        // Clear the timeout if it exists
        if (inputTimeoutRef.current) {
            clearTimeout(inputTimeoutRef.current);
        }

        // Set a new timeout
        inputTimeoutRef.current = setTimeout(() => {
            // Get the search value
            const search = getValues("search");
            console.debug("Search", search);

            filter(search);

            // Clear the timeout
            inputTimeoutRef.current = null;
        }, 200);
    };

    const clearSearch = () => {
        setValue("search", "");
        filter("");
    };

    // On Ctrl+F, focus the search bar
    useEffect(() => {
        const onKeyDown = (e: KeyboardEvent) => {
            if (e.ctrlKey && e.key === "f") {
                e.preventDefault();
                e.stopPropagation();

                // Focus the search bar
                setFocus("search");
            }
        };
        document.addEventListener("keydown", onKeyDown);

        return () => {
            document.removeEventListener("keydown", onKeyDown);
        };
    }, []);

    return (
        <div className="flex w-full flex-grow-0 items-center gap-1 border-b border-slate-700 p-2">
            {
                // If there is text in the search bar, show the clear button
                watch("search").length > 0 ? (
                    <XMarkIcon
                        className="h-5 w-5 cursor-pointer text-slate-400"
                        onClick={clearSearch}
                    />
                ) : (
                    <FunnelIcon className="h-5 w-5 text-slate-400" />
                )
            }
            <input
                type="text"
                // disabled={true}
                className="ml-2 flex-grow border-none bg-transparent text-slate-200 outline-none placeholder:text-slate-400"
                // placeholder="Filter by keyword or by field"
                title="Ctrl+F to search"
                placeholder="Filter by keyword (Ctrl+F)"
                onInput={onInput}
                {...register("search")}
            />
        </div>
    );
};

const CredentialCard: React.FC<{
    credential: Credential.VaultCredential;
    onClick: () => void;
    showWarningDialog: WarningDialogShowFn;
}> = ({ credential, onClick, showWarningDialog: showWarningDialogFn }) => {
    const setUnlockedVault = useSetAtom(unlockedVaultWriteOnlyAtom);
    const unlockedVaultMetadata = useAtomValue(unlockedVaultMetadataAtom);

    const { refs, floatingStyles } = useFloating({
        placement: "bottom-end",
        middleware: [autoPlacement()],
    });

    const options: Options[] = [
        {
            Name: "Copy Username",
            onClick: () => {
                navigator.clipboard.writeText(credential.Username);
                toast.info("Copied username to clipboard");
            },
        },
    ];

    if (credential.Password) {
        options.push({
            Name: "Copy Password",
            onClick: () => {
                navigator.clipboard.writeText(credential.Password);
                toast.info("Copied password to clipboard");
            },
        });
    }

    if (credential.URL) {
        options.push({
            Name: "Open URL",
            onClick: () => {
                window.open(credential.URL, "_blank");
            },
        });
    }

    if (credential.TOTP) {
        options.push({
            Name: "Copy OTP",
            onClick: () => {
                if (!credential.TOTP) return;

                const data = credential.TOTP.calculate();
                if (data) {
                    navigator.clipboard.writeText(data.code);
                    toast.info(
                        `Copied OTP to clipboard; ${data.timeRemaining} seconds left`,
                        {
                            autoClose: 3000,
                            pauseOnFocusLoss: false,
                            updateId: "copy-otp",
                            toastId: "copy-otp",
                        }
                    );

                    // let timePassed = 0;
                    // const interval = setInterval(() => {
                    //     const progress = (data.timeRemaining - timePassed / 1000) / credential.TOTP.Period;
                    //     toast.info(
                    //         `Copied OTP to clipboard; ${
                    //             data.timeRemaining - timePassed / 1000
                    //         } seconds left`,
                    //         {
                    //             progress:
                    //                 progress,
                    //             pauseOnFocusLoss: false,
                    //             updateId: "copy-otp",
                    //             toastId: "copy-otp",
                    //             onClick: () => clearInterval(interval),
                    //         }
                    //     );
                    //     timePassed += 1000;

                    //     if (timePassed >= data.timeRemaining * 1000) {
                    //         toast.dismiss("copy-otp");

                    //         clearInterval(interval);
                    //     }
                    // }, 1000);
                }
            },
        });
    }

    options.push({
        Name: "Remove",
        onClick: async () => {
            if (!unlockedVaultMetadata) return;

            showWarningDialogFn(
                `You are about to remove the "${credential.Name}" credential.`,
                async () => {
                    toast.info("Removing credential...", {
                        autoClose: false,
                        closeButton: false,
                        toastId: "remove-credential",
                        updateId: "remove-credential",
                    });

                    // A little delay to make sure the toast is shown
                    await new Promise((resolve) => setTimeout(resolve, 100));

                    setUnlockedVault(async (pre) => {
                        if (!pre) return null;

                        const newVault = pre;

                        // Remove the credential from the vault
                        await newVault.deleteCredential(credential.ID);
                        try {
                            // Trigger the vault's save function (this might not be needed when the auto-save feature is implemented)
                            await unlockedVaultMetadata.save(newVault);
                            toast.success("Credential removed.", {
                                autoClose: 3000,
                                closeButton: true,
                                toastId: "remove-credential",
                                updateId: "remove-credential",
                            });
                        } catch (e) {
                            console.error(`Failed to save vault: ${e}`);
                            toast.error(
                                "Failed to save vault. There is a high possibility of data loss!",
                                {
                                    autoClose: 3000,
                                    closeButton: true,
                                    toastId: "remove-credential",
                                    updateId: "remove-credential",
                                }
                            );
                        }

                        return newVault;
                    });
                },
                null
            );
        },
    });

    return (
        <div
            className="flex cursor-pointer items-center justify-between rounded-lg bg-gray-700 px-2 shadow-md transition-shadow hover:shadow-[#FF5668]"
            onContextMenu={(e) => {
                e.preventDefault();

                // Cast the ref to an HTMLElement and click it
                const optionsButtonRef = refs.reference?.current as HTMLElement;
                optionsButtonRef?.click();
            }}
        >
            <div
                className="flex w-full cursor-pointer items-center justify-between p-2"
                onClick={onClick}
            >
                <div className="flex items-center gap-2">
                    {/* Temporary colored circle */}
                    <div>
                        <div className="flex h-7 w-7 justify-center rounded-full bg-[#FF5668] text-black">
                            {credential.Name[0]}
                        </div>
                    </div>
                    {/* Credential info */}
                    <div className="flex flex-col">
                        <p className="text-md line-clamp-2 break-all font-bold lg:line-clamp-1">
                            {credential.Name}
                        </p>
                        {credential.Username?.trim().length ? (
                            <p className="line-clamp-2 break-all text-left text-sm text-slate-300 lg:line-clamp-1">
                                {credential.Username}
                            </p>
                        ) : (
                            <p className="line-clamp-2 break-all text-left text-sm italic text-slate-300 lg:line-clamp-1">
                                No username
                            </p>
                        )}
                    </div>
                </div>
            </div>
            <div onClick={onClick}>
                {/* Indicators - md+ */}
                <div className="hidden h-full items-center justify-center gap-3 rounded-sm px-3 md:flex">
                    {credential.TOTP && (
                        <p
                            className="rounded-md border border-slate-500 px-3 py-2 text-sm text-slate-50"
                            title="Contains OTP"
                        >
                            OTP
                        </p>
                    )}
                    {credential.Notes && (
                        <p
                            className="rounded-md border border-slate-500 px-3 py-2 text-sm text-slate-50"
                            title="Contains additional notes"
                        >
                            Notes
                        </p>
                    )}
                </div>
                {/* Indicators - mobile */}
                <div className="flex h-full flex-col items-center justify-center gap-3 rounded-sm px-3 text-center md:hidden">
                    {credential.TOTP && (
                        <p
                            className="rounded-md text-xs text-slate-50"
                            title="Contains OTP"
                        >
                            OTP
                        </p>
                    )}
                    {credential.Notes && (
                        <p
                            className="rounded-md text-xs text-slate-50"
                            title="Contains additional notes"
                        >
                            Notes
                        </p>
                    )}
                </div>
            </div>
            <Menu as="div" className="relative">
                <Menu.Button
                    ref={refs.setReference}
                    className="flex h-full items-center"
                >
                    <EllipsisVerticalIcon className="h-6 w-6 text-gray-400" />
                </Menu.Button>
                <Transition
                    as={React.Fragment}
                    enter="transition ease-out duration-100"
                    enterFrom="transform opacity-0 scale-95"
                    enterTo="transform opacity-100 scale-100"
                    leave="transition ease-in duration-75"
                    leaveFrom="transform opacity-100 scale-100"
                    leaveTo="transform opacity-0 scale-95"
                >
                    <Menu.Items
                        ref={refs.setFloating}
                        className="absolute right-0 z-10 mt-2 w-48 origin-top-right rounded-md bg-gray-800 shadow-lg focus:outline-none"
                        style={floatingStyles}
                    >
                        <div className="py-1">
                            {options.map((option, index) => (
                                <Menu.Item key={index}>
                                    {({ active }) => {
                                        const hoverClass = clsx({
                                            "bg-gray-900 text-white": active,
                                            "flex px-4 py-2 text-sm font-semibold text-gray-200":
                                                true,
                                        });
                                        return (
                                            <a
                                                className={hoverClass}
                                                onClick={option.onClick}
                                            >
                                                {option.Name}
                                            </a>
                                        );
                                    }}
                                </Menu.Item>
                            ))}
                        </div>
                    </Menu.Items>
                </Transition>
            </Menu>
        </div>
    );
};

const CredentialsList: React.FC<{
    showNewCredentialsDialogFn: React.MutableRefObject<(() => void) | null>;
    showWarningDialog: WarningDialogShowFn;
    showCredentialsGeneratorDialogFn: React.MutableRefObject<() => void>;
}> = ({
    showNewCredentialsDialogFn,
    showWarningDialog,
    showCredentialsGeneratorDialogFn,
}) => {
    // This is totally unnecessary, but this is the only way I could get the credentials to rerender when we change the credentials list
    // Seems that Jotai cannot detect changes if the changes are made to an array (which might be too deep)
    // TODO: Find a better way to do this
    const vaultCredentials = useAtomValue(unlockedVaultAtom).Credentials;

    const [filter, setFilter] = useState("");

    const selectedCredential = useRef<Credential.VaultCredential | undefined>(
        undefined
    );
    const showCredentialsDialogRef = useRef<(() => void) | null>(null);
    const showCredentialDialog = (showNewCredentialsDialogFn.current = (
        credential?: Credential.VaultCredential
    ) => {
        // Set the selected credential
        selectedCredential.current = credential;

        // Show the credential's dialog
        showCredentialsDialogRef.current?.();
    });

    let filteredCredentials: Credential.VaultCredential[] = [];
    if (vaultCredentials) {
        filteredCredentials = vaultCredentials
            ?.sort((a, b) => a.Name.localeCompare(b.Name))
            .filter((credential) => {
                if (filter === "") return true;

                if (
                    credential.Name.toLowerCase().includes(filter.toLowerCase())
                )
                    return true;

                if (
                    credential.Username.toLowerCase().includes(
                        filter.toLowerCase()
                    )
                )
                    return true;

                if (credential.URL.toLowerCase().includes(filter.toLowerCase()))
                    return true;

                return false;
            });
    }

    console.debug("Credentials list rerender");

    return (
        <>
            <SearchBar filter={setFilter} />
            <div className="my-5 flex h-px w-full flex-grow justify-center overflow-y-auto overflow-x-hidden px-5">
                {!vaultCredentials ||
                    (filteredCredentials.length === 0 && (
                        <div className="flex flex-grow flex-col items-center justify-center">
                            <p className="text-2xl font-bold text-slate-50">
                                No items
                            </p>
                            {filter.length > 0 && (
                                <p className="text-center text-slate-400">
                                    No items match the filter.
                                </p>
                            )}
                            {filter.length === 0 && (
                                <p className="text-center text-slate-400">
                                    {" "}
                                    Press the &quot;New Item&quot; button in the
                                    sidebar to add a new credential.
                                </p>
                            )}
                        </div>
                    ))}
                {vaultCredentials && filteredCredentials.length > 0 && (
                    <div className="flex w-full max-w-full flex-col gap-3 pb-3 2xl:max-w-7xl">
                        {filteredCredentials.map((credential) => (
                            <CredentialCard
                                key={credential.ID}
                                credential={credential}
                                onClick={() => showCredentialDialog(credential)}
                                showWarningDialog={showWarningDialog}
                            />
                        ))}
                    </div>
                )}
            </div>
            {vaultCredentials && vaultCredentials.length > 0 && (
                <div className="flex w-full flex-grow-0 items-center justify-center border-t border-slate-700 px-2 py-1">
                    {filter.length > 0 && (
                        <p className="text-slate-400">
                            Filtered items: {filteredCredentials.length}
                        </p>
                    )}
                    {filter.length === 0 && (
                        <p className="text-slate-400">
                            Items loaded: {vaultCredentials.length}
                        </p>
                    )}
                </div>
            )}
            <CredentialDialog
                showDialogFnRef={showCredentialsDialogRef}
                selected={selectedCredential}
                showCredentialsGeneratorDialogFn={
                    showCredentialsGeneratorDialogFn
                }
            />
        </>
    );
};

//#endregion Vault dashboard

const AppIndex: React.FC = () => {
    const isVaultUnlocked = useAtomValue(isVaultUnlockedAtom);
    const webRTConnections = useSetAtom(webRTCConnectionsAtom);

    // TODO: Check for multiple rerenderings of this component
    // console.log("MAIN RERENDER", unlockedVault);
    // NOTE: To implement a loading screen, we can use the !vaults check

    useEffect(() => {
        return () => {
            // Clean up all of the WebRTC connections individually
            webRTConnections((pre) => {
                pre.cleanup();
                return pre;
            });
        };
    }, [isVaultUnlocked]);

    return (
        <SessionProvider refetchWhenOffline={false} refetchInterval={60 * 60}>
            <HTMLHeaderPWA
                title="CryptexVault"
                description="Decentralized Password Manager"
            />

            <HTMLMain additionalClasses="content flex min-h-screen grow flex-col overflow-clip">
                {/* <h1>App</h1>
                {session ? (
                    <div>
                        <h2>Logged in as {session.user?.email}</h2>
                    </div>
                ) : (
                    <div>
                        <h2>Not signed in</h2>
                    </div>
                )} */}

                <VaultDashboard />

                {
                    // If the vault is not unlocked, show the welcome screen
                    !isVaultUnlocked && <WelcomeScreen />
                }
            </HTMLMain>
            <NotificationContainer pauseOnHover={false} />
        </SessionProvider>
    );
};

export default AppIndex;

// This generates the static HTML for the page and sends it to the user
// The application must take care of the user permissions and authentication
export const getStaticProps: GetStaticProps = async () => {
    return {
        props: {},
    };
};
