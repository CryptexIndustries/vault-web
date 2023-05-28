import React, { Fragment, useEffect, useRef, useState } from "react";
import { GetStaticProps } from "next";
import { SessionProvider, signOut, useSession } from "next-auth/react";
import { useRouter } from "next/router";

import { toast } from "react-toastify";
import { Controller, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useLiveQuery } from "dexie-react-hooks";
import { Disclosure, Menu, Popover, Transition } from "@headlessui/react";
import clsx from "clsx";
import { atom, useAtomValue, useSetAtom } from "jotai";
import * as OTPAuth from "otpauth";
import { shift, useFloating } from "@floating-ui/react-dom";
import { z } from "zod";

import Pusher from "pusher-js";
import type * as PusherOptions from "pusher-js/types/src/core/options";

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
    CogIcon,
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
    cryptexAccountInit,
    cryptexAccountSignIn,
    generateKeyPair,
    navigateToCheckout,
} from "../../app_lib/online_services_utils";
import { signUpFormSchema } from "../../app_lib/online_services_utils";
import {
    BackupUtils,
    Credential,
    NewVaultFormSchemaType,
    OnlineServicesAccount,
    OnlineServicesAccountInterface,
    Vault,
    VaultEncryption,
    VaultMetadata,
    VaultRestoreFormSchema,
    VaultStorage,
    newVaultFormSchema,
    vaultRestoreFormSchema,
} from "../../app_lib/vault_utils";
import NavBar from "../../components/navbar";
import { WarningDialog } from "../../components/dialog/warning";
import { AccordionItem } from "../../components/general/accordion";
import { GetSubscriptionOutputSchemaType } from "../../schemes/payment_router";
import Spinner from "../../components/general/spinner";
import { env } from "../../env/client.mjs";

dayjs.extend(RelativeTime);

const unlockedVaultMetadataAtom = atom<VaultMetadata | null>(null);
const unlockedVaultAtom = atom<Vault | null>(null);

const onlineServicesEndpointConfiguration: PusherOptions.Options = {
    wsHost: env.NEXT_PUBLIC_PUSHER_APP_HOST,
    wsPort: parseInt(env.NEXT_PUBLIC_PUSHER_APP_PORT) ?? 6001,
    wssPort: parseInt(env.NEXT_PUBLIC_PUSHER_APP_PORT) ?? 6001,
    forceTLS: env.NEXT_PUBLIC_PUSHER_APP_TLS,
    // encrypted: true,
    disableStats: true,
    enabledTransports: ["ws", "wss"],
    cluster: "",
    userAuthentication: {
        transport: "ajax",
        endpoint: "/api/pusher/auth",
    },
    channelAuthorization: {
        transport: "ajax",
        endpoint: "/api/pusher/channel-auth",
    },
};

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
    showWarningDialogCallback: (
        description: string,
        onConfirm: () => void,
        onDismiss: (() => void) | null
    ) => void;
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
            "You are about to delete this vault, irreversibly.",
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
                                    key={`vault-${vaultBlob.header_iv}-${index}`}
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
                                                href="#"
                                                key={`cryptex-welcome-action-${index}`}
                                                onClick={item.onClick}
                                                className="-m-3 flex items-center rounded-lg p-2 transition duration-150 ease-in-out hover:bg-gray-800 focus:outline-none focus-visible:ring focus-visible:ring-orange-500 focus-visible:ring-opacity-50"
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

const IconLinkVault: React.FC = () => {
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

type VaultEncryptionAlgorithmSelectboxProps = {
    onChange: (event: React.ChangeEvent<HTMLSelectElement>) => void;
    onBlur: () => void;
    value: VaultEncryption.EncryptionAlgorithm;
};
const EncryptionAlgorithmSelectbox: React.FC<
    VaultEncryptionAlgorithmSelectboxProps
> = ({ onChange, onBlur, value }) => {
    return (
        <div className="mt-1 rounded-md bg-gray-200 px-3 py-2">
            <select
                className="w-full bg-gray-200 text-gray-900"
                onChange={onChange}
                onBlur={onBlur}
                value={value}
            >
                {Object.values(VaultEncryption.EncryptionAlgorithm).map(
                    (key) => (
                        <option
                            key={key}
                            value={VaultEncryption.EncryptionAlgorithm[key]}
                        >
                            {VaultEncryption.EncryptionAlgorithm[key]}
                        </option>
                    )
                )}
            </select>
        </div>
    );
};

type KeyDerivationFunctionSelectboxProps = {
    onChange: (event: React.ChangeEvent<HTMLSelectElement>) => void;
    onBlur: () => void;
    value: VaultEncryption.KeyDerivationFunction;
};
const KeyDerivationFunctionSelectbox: React.FC<
    KeyDerivationFunctionSelectboxProps
> = ({ onChange, onBlur, value }) => {
    return (
        <div className="mt-1 rounded-md bg-gray-200 px-3 py-2">
            <select
                className="w-full bg-gray-200 text-gray-900"
                onChange={onChange}
                onBlur={onBlur}
                value={value}
            >
                {Object.values(VaultEncryption.KeyDerivationFunction).map(
                    (key) => (
                        <option
                            key={key}
                            value={VaultEncryption.KeyDerivationFunction[key]}
                        >
                            {VaultEncryption.KeyDerivationFunction[key]}
                        </option>
                    )
                )}
            </select>
        </div>
    );
};

type UnlockVaultDialogProps = {
    visibleState: [boolean, React.Dispatch<React.SetStateAction<boolean>>];
    selected: React.MutableRefObject<VaultMetadata | undefined>;
};
const UnlockVaultDialog: React.FC<UnlockVaultDialogProps> = ({
    visibleState,
    selected,
}) => {
    const defaultValues: VaultEncryption.UnlockVaultFormSchemaType = {
        vaultSecret: "",
        vaultEncryption: VaultEncryption.EncryptionAlgorithm.XChaCha20Poly1305,
        vaultEncryptionKeyDerivationFunction:
            VaultEncryption.KeyDerivationFunction.Argon2ID,
        vaultEncryptionConfig: {
            iterations:
                VaultEncryption.KeyDerivationConfig_PBKDF2.DEFAULT_ITERATIONS,
            memLimit:
                VaultEncryption.KeyDerivationConfig_Argon2ID.DEFAULT_MEM_LIMIT,
            opsLimit:
                VaultEncryption.KeyDerivationConfig_Argon2ID.DEFAULT_OPS_LIMIT,
        },
        captchaToken: "",
    };
    const {
        handleSubmit,
        control,
        setError: setFormError,
        formState: { errors, isSubmitting, isDirty },
        reset: resetForm,
        watch,
        setValue,
    } = useForm<VaultEncryption.UnlockVaultFormSchemaType>({
        resolver: zodResolver(VaultEncryption.unlockVaultFormSchema),
        defaultValues: defaultValues,
    });

    const setUnlockedVault = useSetAtom(unlockedVaultAtom);
    const setUnlockedVaultMetadata = useSetAtom(unlockedVaultMetadataAtom);

    const onSubmit = async (
        formData: VaultEncryption.UnlockVaultFormSchemaType
    ) => {
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
                formData.vaultSecret,
                formData.vaultEncryption,
                formData.vaultEncryptionKeyDerivationFunction,
                formData.vaultEncryptionConfig
            );

            if (
                vault.OnlineServices.isBound() &&
                vault.OnlineServices.UserID &&
                vault.OnlineServices.PrivateKey
            ) {
                // Initialize the vault account
                await cryptexAccountInit(
                    vault.OnlineServices.UserID,
                    vault.OnlineServices.PrivateKey,
                    formData.captchaToken
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

            hideModal(true);
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
    };

    const hideModal = async (force = false) => {
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
                vaultSecret: "",
                vaultEncryption: selected.current.Blob.algorithm,
                vaultEncryptionKeyDerivationFunction:
                    selected.current.Blob.keyDerivationFunc,
                vaultEncryptionConfig:
                    selected.current.Blob.keyDerivationFuncConfig,
                captchaToken: "",
            });

            // If we're in development, automatically unlock the vault
            // if (process.env.NODE_ENV === "development") {
            //     setValue("vaultSecret", "This is insane");
            //     handleSubmit(onSubmit)();
            // }
        }
    }, [selected, selected.current, resetForm, visibleState]);

    return (
        <GenericModal
            key="vault-unlock-modal"
            visibleState={visibleState}
            inhibitDismissOnClickOutside={true}
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
                        <b>{selected.current?.Blob?.algorithm ?? "Unknown"}</b>
                    </p>
                    <div className="flex w-full flex-col text-left">
                        <div className="mt-2 flex flex-col">
                            <Controller
                                control={control}
                                name="vaultSecret"
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
                                            className="mt-1 rounded-md bg-gray-200 px-4 py-2 text-gray-900"
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
                            {errors.vaultSecret && (
                                <p className="text-red-500">
                                    {errors.vaultSecret.message}
                                </p>
                            )}
                        </div>
                        <div className="mt-4 flex flex-col">
                            <Controller
                                control={control}
                                name="vaultEncryption"
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
                            {errors.vaultEncryption && (
                                <p className="text-red-500">
                                    {errors.vaultEncryption.message}
                                </p>
                            )}
                        </div>
                        <div className="mt-4 flex flex-col">
                            <Controller
                                control={control}
                                name="vaultEncryptionKeyDerivationFunction"
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
                            {errors.vaultEncryptionKeyDerivationFunction && (
                                <p className="text-red-500">
                                    {
                                        errors
                                            .vaultEncryptionKeyDerivationFunction
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
                                                "vaultEncryptionKeyDerivationFunction"
                                            ) !==
                                            VaultEncryption
                                                .KeyDerivationFunction.Argon2ID,
                                    })}
                                >
                                    <div className="flex flex-col">
                                        <Controller
                                            control={control}
                                            name="vaultEncryptionConfig.memLimit"
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
                                        {errors.vaultEncryptionConfig
                                            ?.memLimit && (
                                            <p className="text-red-500">
                                                {
                                                    errors.vaultEncryptionConfig
                                                        ?.memLimit.message
                                                }
                                            </p>
                                        )}
                                    </div>
                                    <div className="mt-4 flex flex-col">
                                        <Controller
                                            control={control}
                                            name="vaultEncryptionConfig.opsLimit"
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
                                        {errors.vaultEncryptionConfig
                                            ?.opsLimit && (
                                            <p className="text-red-500">
                                                {
                                                    errors.vaultEncryptionConfig
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
                                                "vaultEncryptionKeyDerivationFunction"
                                            ) !==
                                            VaultEncryption
                                                .KeyDerivationFunction.PBKDF2,
                                    })}
                                >
                                    <div className="flex flex-col">
                                        <Controller
                                            control={control}
                                            name="vaultEncryptionConfig.iterations"
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
                                        {errors.vaultEncryptionConfig
                                            ?.iterations && (
                                            <p className="text-red-500">
                                                {
                                                    errors.vaultEncryptionConfig
                                                        ?.iterations.message
                                                }
                                            </p>
                                        )}
                                    </div>
                                </div>

                                {errors.vaultEncryptionConfig && (
                                    <p className="text-red-500">
                                        {errors.vaultEncryptionConfig.message}
                                    </p>
                                )}
                            </AccordionItem>
                        </div>

                        {env.NEXT_PUBLIC_SIGNIN_VALIDATE_CAPTCHA && (
                            <div className="mt-4 flex flex-col items-center">
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
                                                setFormError("captchaToken", {
                                                    message: "Captcha error",
                                                });
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
                    onClick={() => hideModal()}
                    disabled={isSubmitting}
                />
            </Footer>
        </GenericModal>
    );
};

type FormInputFieldProps = {
    label: string;
    type?: "text" | "password" | "email" | "tel" | "url";
    placeholder?: string;
    autoCapitalize?: "none" | "sentences" | "words" | "characters";
    value: string | number | readonly string[] | undefined;
    onChange?: (e: React.ChangeEvent<HTMLInputElement>) => void;
    onBlur?: (e: React.FocusEvent<HTMLInputElement>) => void;
};
const FormInputField: React.FC<FormInputFieldProps> = ({
    label,
    type = "text",
    placeholder,
    autoCapitalize,
    value,
    onChange,
    onBlur,
}) => {
    return (
        <>
            {label && <label className="text-gray-600">{label}</label>}
            <input
                type={type}
                placeholder={placeholder}
                autoCapitalize={autoCapitalize}
                className="mt-1 rounded-md bg-gray-200 px-4 py-2 text-gray-900"
                onChange={onChange}
                onBlur={onBlur}
                value={value}
            />
        </>
    );
};

type FormTextAreaFieldProps = {
    type?: never;
    onChange?: (e: React.ChangeEvent<HTMLTextAreaElement>) => void;
    onBlur?: (e: React.FocusEvent<HTMLTextAreaElement>) => void;
} & FormInputFieldProps;
const FormTextAreaField: React.FC<FormTextAreaFieldProps> = ({
    label,
    placeholder,
    autoCapitalize,
    value,
    onChange,
    onBlur,
}) => {
    return (
        <>
            {label && <label className="text-gray-600">{label}</label>}
            <textarea
                placeholder={placeholder}
                autoCapitalize={autoCapitalize}
                className="mt-1 max-h-52 min-h-[50px] rounded-md bg-gray-200 px-4 py-2 text-gray-900"
                onChange={onChange}
                onBlur={onBlur}
                value={value}
            />
        </>
    );
};

type FormNumberInputFieldProps = {
    type?: never;
    autoCapitalize?: never;
    placeholder?: never;
    min?: number;
    max?: number;
    valueLabel?: string;
} & FormInputFieldProps;
const FormNumberInputField: React.FC<FormNumberInputFieldProps> = ({
    label,
    min,
    max,
    valueLabel,
    onChange,
    onBlur,
    value,
}) => {
    return (
        <>
            {label && <label className="text-gray-600">{label}</label>}
            <div className="flex items-center gap-2">
                <input
                    type="number"
                    onChange={onChange}
                    onBlur={onBlur}
                    value={value}
                    className="w-full border p-2 transition-all hover:border-slate-500"
                    min={min}
                    max={max}
                />
                {valueLabel && (
                    <span className="text-md text-gray-600">{valueLabel}</span>
                )}
            </div>
        </>
    );
};

enum CreateVaultDialogMode {
    Blank,
    FromImport,
}
type CreateVaultDialogProps = {
    visibleState: [boolean, React.Dispatch<React.SetStateAction<boolean>>];
    mode: CreateVaultDialogMode;
    vaultInstance: React.MutableRefObject<Vault | undefined>;
};
const CreateVaultDialog: React.FC<CreateVaultDialogProps> = ({
    visibleState,
}) => {
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
            vaultName: "",
            vaultDescription: "",
            vaultSecret: "",
            vaultEncryption:
                VaultEncryption.EncryptionAlgorithm.XChaCha20Poly1305,
            vaultEncryptionKeyDerivationFunction:
                VaultEncryption.KeyDerivationFunction.Argon2ID,
            vaultEncryptionConfig: {
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
                data.vaultSecret,
                data.vaultEncryption,
                data.vaultEncryptionKeyDerivationFunction,
                data.vaultEncryptionConfig
            );
            // console.debug("Decrypted vault:", _);

            // Vault encryption/decryption is working, save the vault
            await vaultMetadata.save(null);

            toast.success("Vault created.", {
                autoClose: 3000,
                toastId: "create-vault",
                updateId: "create-vault",
            });

            hideModal(true);
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

    const hideModal = async (force = false) => {
        const hide = () => {
            visibleState[1](false);
            resetForm();
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
            key="vault-creation-modal"
            visibleState={visibleState}
            inhibitDismissOnClickOutside={true}
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
                                name="vaultName"
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
                            {errors.vaultName && (
                                <p className="text-red-500">
                                    {errors.vaultName.message}
                                </p>
                            )}
                        </div>
                        <div className="mt-4 flex flex-col">
                            <Controller
                                control={control}
                                name="vaultDescription"
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
                            {errors.vaultDescription && (
                                <p className="text-red-500">
                                    {errors.vaultDescription.message}
                                </p>
                            )}
                        </div>
                        <div className="mt-4 flex flex-col">
                            <Controller
                                control={control}
                                name="vaultSecret"
                                render={({
                                    field: { onChange, onBlur, value },
                                }) => (
                                    <>
                                        <FormInputField
                                            label="Secret *"
                                            type="text"
                                            placeholder="E.g. My super secr3t p4ssphrase"
                                            autoCapitalize="none"
                                            onChange={onChange}
                                            onBlur={onBlur}
                                            value={value}
                                        />
                                    </>
                                )}
                            />
                            {errors.vaultSecret && (
                                <p className="text-red-500">
                                    {errors.vaultSecret.message}
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
                                name="vaultEncryption"
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
                            {errors.vaultEncryption && (
                                <p className="text-red-500">
                                    {errors.vaultEncryption.message}
                                </p>
                            )}
                        </div>
                        <div className="mt-4 flex flex-col">
                            <Controller
                                control={control}
                                name="vaultEncryptionKeyDerivationFunction"
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
                            {errors.vaultEncryptionKeyDerivationFunction && (
                                <p className="text-red-500">
                                    {
                                        errors
                                            .vaultEncryptionKeyDerivationFunction
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
                                                "vaultEncryptionKeyDerivationFunction"
                                            ) !==
                                            VaultEncryption
                                                .KeyDerivationFunction.Argon2ID,
                                    })}
                                >
                                    <div className="flex flex-col">
                                        <Controller
                                            control={control}
                                            name="vaultEncryptionConfig.memLimit"
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
                                        {errors.vaultEncryptionConfig
                                            ?.memLimit && (
                                            <p className="text-red-500">
                                                {
                                                    errors.vaultEncryptionConfig
                                                        ?.memLimit.message
                                                }
                                            </p>
                                        )}
                                    </div>
                                    <div className="mt-4 flex flex-col">
                                        <Controller
                                            control={control}
                                            name="vaultEncryptionConfig.opsLimit"
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
                                        {errors.vaultEncryptionConfig
                                            ?.opsLimit && (
                                            <p className="text-red-500">
                                                {
                                                    errors.vaultEncryptionConfig
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
                                                "vaultEncryptionKeyDerivationFunction"
                                            ) !==
                                            VaultEncryption
                                                .KeyDerivationFunction.PBKDF2,
                                    })}
                                >
                                    <div className="flex flex-col">
                                        <Controller
                                            control={control}
                                            name="vaultEncryptionConfig.iterations"
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
                                        {errors.vaultEncryptionConfig
                                            ?.iterations && (
                                            <p className="text-red-500">
                                                {
                                                    errors.vaultEncryptionConfig
                                                        ?.iterations.message
                                                }
                                            </p>
                                        )}
                                    </div>
                                </div>

                                {errors.vaultEncryptionConfig && (
                                    <p className="text-red-500">
                                        {errors.vaultEncryptionConfig.message}
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
                    onClick={() => hideModal()}
                    disabled={isSubmitting}
                />
            </Footer>
        </GenericModal>
    );
};

const VaultLinkingDialog: React.FC<{
    showDialogFnRef: React.MutableRefObject<(() => void) | null>;
}> = ({ showDialogFnRef }) => {
    const [visible, setVisible] = useState(false);
    showDialogFnRef.current = () => setVisible(true);
    const hideDialog = () => {
        setVisible(false);
        resetForm();
        setCurrentState(State.LinkingMethod);
    };

    enum State {
        LinkingMethod = "LinkingMethod",
        SoundListening = "SoundListening",
        DecryptionPassphrase = "DecryptionPassphrase",
        WaitingForDevice = "WaitingForDevice",
        ReceivingVaultMetadata = "ReceivingVaultMe",
        AcceptingVault = "AcceptingVault",
        SavingVault = "SavingVault",
    }

    const [currentState, setCurrentState] = useState<State>(
        State.LinkingMethod
    );
    const [isOperationInProgress, setOperationInProgress] = useState(false);

    const fileInputRef = useRef<HTMLInputElement>(null);
    const vaultLinkingFormSchema = z.object({
        encryptedData: z.string().nonempty(),
        decryptionPassphrase: z.string().nonempty(),
        captchaToken: env.NEXT_PUBLIC_SIGNIN_VALIDATE_CAPTCHA
            ? z.string().nonempty("Captcha is required.")
            : z.string(),
    });
    type VaultLinkingFormSchemaType = z.infer<typeof vaultLinkingFormSchema>;
    const {
        control,
        handleSubmit,
        getValues: getFormValue,
        setValue: setFormValue,
        setError: setFormError,
        formState: { errors, isSubmitting, isDirty },
        reset: resetForm,
    } = useForm<VaultLinkingFormSchemaType>({
        resolver: zodResolver(vaultLinkingFormSchema),
        defaultValues: {
            encryptedData: "",
            decryptionPassphrase: "",
            captchaToken: "",
        },
    });

    const BlockButton: React.FC<{
        icon: React.ReactNode;
        iconCaption: string;
        description: string;
        onClick?: () => void;
        disabled?: boolean;
    }> = ({ icon, iconCaption, description, onClick, disabled }) => (
        <div
            className={clsx({
                "mb-2 flex flex-col items-center gap-1 rounded-md bg-gray-200 px-4 py-2 transition-colors ":
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

            setCurrentState(State.DecryptionPassphrase);
        } catch (e) {
            console.error("Failed to load the file.", e);
            toast.error("Failed to load the file.");
        }
    };

    /**
     * This is called after the user enters the decryption passphrase
     */
    const onSubmit = async (formData: VaultLinkingFormSchemaType) => {
        setOperationInProgress(true);

        // Delay a bit for the UI to update
        await new Promise((res) => setTimeout(res, 100));

        // scrap believe knock lumber civil accident diesel coconut stay wedding just conduct

        // Try to decrypt the data - setError if it fails
        let decryptedData: OnlineServicesAccountInterface = {
            UserID: "",
            PublicKey: "",
            PrivateKey: "",
        };
        try {
            decryptedData = await OnlineServicesAccount.decryptTransferableData(
                formData.encryptedData,
                formData.decryptionPassphrase
            );

            // Validate the decrypted data
            if (
                !decryptedData.UserID ||
                !decryptedData.PublicKey ||
                !decryptedData.PrivateKey
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

            return;
        }

        //---
        // Start setting up the WebRTC connection
        const localConnection = new RTCPeerConnection({
            iceServers: [
                {
                    urls: "stun:stun.l.google.com:19302",
                },
            ],
        });

        // TODO: Access the WS server (provide the signed nonce) - subscribe to own channel
        // TODO: Wait for a WebRTC offer from the other device
        const onlineServicesEndpoint = new Pusher(
            env.NEXT_PUBLIC_PUSHER_APP_KEY,
            onlineServicesEndpointConfiguration
        );

        const channelName = `presence-link-${decryptedData.UserID}`;
        const channel = onlineServicesEndpoint.subscribe(channelName);
        channel.bind(
            "client-link",
            async (data: {
                type: "offer" | "ice-candidate";
                data: RTCIceCandidateInit | RTCSessionDescriptionInit;
            }) => {
                // console.log("Received WebRTC offer:", data);

                if (data.type === "offer") {
                    // console.log("Received WebRTC offer:", data.data);
                    localConnection.setRemoteDescription(
                        data.data as RTCSessionDescriptionInit
                    );

                    localConnection.onicecandidate = (event) => {
                        if (event.candidate) {
                            // console.log(
                            //     "Sending WebRTC ice candidate:",
                            //     event.candidate
                            // );
                            channel.trigger("client-link", {
                                type: "ice-candidate",
                                data: event.candidate,
                            });
                        }
                    };

                    // Send the answer
                    const answer = await localConnection.createAnswer();
                    await localConnection.setLocalDescription(answer);
                    // console.log("Sending WebRTC answer:", answer);
                    channel.trigger("client-link", {
                        type: "answer",
                        data: answer,
                    });
                } else if (data.type === "ice-candidate") {
                    // console.log("Received WebRTC ice candidate:", data.data);
                    localConnection.addIceCandidate(
                        data.data as RTCIceCandidateInit
                    );
                }
            }
        );

        localConnection.ondatachannel = (event) => {
            // console.debug("Received WebRTC data channel:", event);

            const receiveChannel = event.channel;
            receiveChannel.onmessage = async (event) => {
                // console.log("Received WebRTC data channel message:", event);

                toast.info("Receiving vault...", {
                    toastId: "receive-vault",
                    updateId: "receive-vault",
                });
                try {
                    // Get the message and JSON parse it
                    const rawVaultMetadata: string = event.data;

                    // Parse the vault metadata
                    const newVaultMetadata =
                        await VaultMetadata.parseFromString(rawVaultMetadata);

                    await newVaultMetadata.save(null);

                    toast.success("Vault received.", {
                        autoClose: 3000,
                        toastId: "receive-vault",
                        updateId: "receive-vault",
                    });
                } catch (e) {
                    console.error("Failed to receive the vault.", e);
                    toast.error("Failed to receive the vault.", {
                        autoClose: 3000,
                        toastId: "receive-vault",
                        updateId: "receive-vault",
                    });
                }

                receiveChannel.close();

                // Close the dialog
                hideDialog();
            };
            receiveChannel.onerror = receiveChannel.onclose = (event) => {
                console.debug("WebRTC data channel closed:", event);
                // Close the WebRTC connection
                localConnection.close();
            };
        };
        localConnection.onconnectionstatechange = (event) => {
            console.debug("WebRTC connection state changed:", event);

            if (localConnection.connectionState === "connected") {
                // console.log("WebRTC connection established.");

                // Disconnect from the WS server
                onlineServicesEndpoint.disconnect();
            }

            if (localConnection.connectionState === "disconnected") {
                // console.log("WebRTC connection lost.");
            }
        };

        //---
        // TODO: Once the WebRTC connection is established, receive the vault metadata
        //---
        // TODO: Ask the user if they want to accept the vault - show the number of entries and the size
        // TODO: If the user accepts, save the vault metadata and the vault itself then bind the received account
        // TODO: Show a success message and close the dialog

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
                        Link Vault
                    </p>
                    {currentState === State.LinkingMethod && (
                        <p className="mt-2 text-base text-gray-600">
                            Choose a method to link this device with another
                            device.
                        </p>
                    )}
                    {currentState === State.DecryptionPassphrase && (
                        <p className="mt-2 text-base text-gray-600">
                            Enter the decryption passphrase displayed on the
                            other device and click on &quot;Continue&quot;.
                        </p>
                    )}
                </div>
                <div className="mt-5 flex flex-col">
                    {currentState === State.LinkingMethod && (
                        <>
                            <BlockButton
                                icon={
                                    <CameraIcon className="h-5 w-5 text-gray-900" />
                                }
                                iconCaption="QR code"
                                description="Scan a QR code to link the devices"
                                // disabled={
                                //     isSubmitting ||
                                //     (validInput !== ValidInput.QRCode && validInput !== null)
                                // }
                                disabled={true} // FIXME: QR code scanning is not implemented yet
                                // validInput={validInput === ValidInput.QRCode}
                            />

                            <BlockButton
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

                            <BlockButton
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
                    text="Cancel"
                    type={ButtonType.Secondary}
                    onClick={hideDialog}
                    disabled={isOperationInProgress}
                />
            </Footer>
        </GenericModal>
    );
};

const WelcomeScreen: React.FC<{
    encryptedVaults?: VaultMetadata[];
}> = ({ encryptedVaults }) => {
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

    const vaultLinkingDialogShowDialogFnRef = useRef<(() => void) | null>(null);

    // NOTE: Hardcoded for now, will come from the user's settings in the future
    const shouldShowUnlockDialogWhenAlone = true;
    const showOnFirstRenderTriggered = useRef(false);
    const unlockDialogVisibleOnFirstRender =
        encryptedVaults?.length === 1 &&
        shouldShowUnlockDialogWhenAlone &&
        !showOnFirstRenderTriggered.current;

    const selectedVault = useRef<VaultMetadata | undefined>(undefined);
    const unlockVaultDialogVisible = useState<boolean>(
        unlockDialogVisibleOnFirstRender
    );
    const showUnlockVaultDialog = (vaultMetadata: VaultMetadata) => {
        // Set the selected vault
        selectedVault.current = vaultMetadata;

        // Show the unlock vault dialog
        unlockVaultDialogVisible[1](true);
    };

    const restoreVaultDialogVisible = useState(false);
    const showRestoreVaultDialog = () => restoreVaultDialogVisible[1](true);

    const actionButtons: ActionButton[] = [
        {
            Name: "Create Vault",
            Description: "Create a new secure vault",
            onClick: showCreateVaultDialog,
            Icon: IconCreateVault,
        },
        {
            Name: "Link Vault",
            Description: "Link a vault from another device",
            onClick: () => vaultLinkingDialogShowDialogFnRef.current?.(),
            Icon: IconLinkVault,
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
    }

    //#region Warning dialog
    const isWarningDialogOpen = useState(false);
    const warningDialogDescriptionRef = useRef<string | null>(null);
    const warningDialogOnConfirmFnRef = useRef<
        (() => Promise<void>) | (() => void) | null
    >(null);
    const warningDialogOnDismissFnRef = useRef<
        (() => Promise<void>) | (() => void) | null
    >(null);

    const showWarningDialog = (
        description: string,
        onConfirm: () => void,
        onDismiss: (() => void) | null
    ) => {
        warningDialogDescriptionRef.current = description;
        warningDialogOnConfirmFnRef.current = onConfirm;

        warningDialogOnDismissFnRef.current = onDismiss;
        isWarningDialogOpen[1](true);
    };
    //#endregion Warning dialog

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
                                CryptexVault is a decentralized identity manager
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
                                    vaultLinkingDialogShowDialogFnRef.current?.()
                                }
                            >
                                <p className="text-md font-bold sm:text-2xl">
                                    Link Vault
                                </p>
                                <p className="hidden select-none text-center text-sm text-slate-300 sm:block">
                                    Link a Vault from another device.
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
                                    Import a Vault from another identity
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
            />
            <VaultLinkingDialog
                showDialogFnRef={vaultLinkingDialogShowDialogFnRef}
            />
            <RestoreVaultDialog visibleState={restoreVaultDialogVisible} />
            <UnlockVaultDialog
                visibleState={unlockVaultDialogVisible}
                selected={selectedVault}
            />
            <WarningDialog
                visibleState={isWarningDialogOpen}
                descriptionRef={warningDialogDescriptionRef}
                onConfirmFnRef={warningDialogOnConfirmFnRef}
                onDismissFnRef={warningDialogOnDismissFnRef}
            />
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
type RestoreVaultDialogProps = {
    visibleState: [boolean, React.Dispatch<React.SetStateAction<boolean>>];
};
const RestoreVaultDialog: React.FC<RestoreVaultDialogProps> = ({
    visibleState,
}) => {
    const [isLoading, setIsLoading] = useState(false);

    const [validFile, setValidFile] =
        useState<VaultEncryption.EncryptedBlob | null>(null);

    const {
        handleSubmit,
        control,
        formState: { errors, isSubmitting, isDirty },
        reset: resetForm,
    } = useForm<VaultRestoreFormSchema>({
        resolver: zodResolver(vaultRestoreFormSchema),
        defaultValues: {
            vaultName: `Restored Vault ${new Date().toLocaleString()}`,
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
            const validEncryptedData =
                await VaultEncryption.EncryptedBlob.FromJSON(await file.text());

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
        newVaultMetadataInst.Name = data.vaultName;
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
                                    name="vaultName"
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
                                {errors.vaultName && (
                                    <p className="text-red-500">
                                        {errors.vaultName.message}
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
                    toast.success("Vote placed.", {
                        autoClose: 3000,
                    });
                },
                onError: (error) => {
                    console.error("Error placing vote.", error);
                    toast.error("Error placing vote.", {
                        autoClose: 3000,
                    });
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

type AccountDialogProps = {
    showDialogFnRef: React.MutableRefObject<() => void>;
    subscriptionData?: GetSubscriptionOutputSchemaType;
    dataLoading: boolean;
    hasDataLoadingError: boolean;
};
const AccountDialog: React.FC<AccountDialogProps> = ({
    showDialogFnRef,
    subscriptionData,
    dataLoading,
    hasDataLoadingError,
}) => {
    const { data: session } = useSession();
    const router = useRouter();

    const [isVisible, setIsVisible] = useState(false);
    showDialogFnRef.current = () => setIsVisible(true);

    const [ongoingOperation, setOngoingOperation] = useState(false);

    const vaultMetadata = useAtomValue(unlockedVaultMetadataAtom);
    const unlockedVault = useAtomValue(unlockedVaultAtom);

    // Prepare the user deletion trpc call
    const deleteUser = trpc.account.deleteUser.useMutation();

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

    const LinkedDevices: React.FC = () => {
        const { data: linkedDevices, refetch: refetchLinkedDevices } =
            trpc.account.getLinkedDevices.useQuery(undefined, {
                refetchOnWindowFocus: false,
                enabled: !!session,
            });
        const unlinkDevice = trpc.account.unlinkDevice.useMutation();

        if (!linkedDevices) {
            // Something went wrong
            return (
                <div className="mt-2 flex w-full flex-col items-center text-left">
                    <p className="line-clamp-2 text-left text-base text-gray-600">
                        There was an error loading your linked devices.
                    </p>
                    <p className="line-clamp-2 text-left text-base text-gray-600">
                        Please try again later.
                    </p>
                </div>
            );
        }

        if (!subscriptionData?.configuration?.linking_allowed) {
            return (
                <div className="mt-2 flex w-full flex-col items-center text-left">
                    <p className="line-clamp-2 text-left text-base text-gray-600">
                        You are not allowed to link devices.
                    </p>
                    <p className="line-clamp-2 text-left text-base text-gray-600">
                        Please upgrade your subscription to enable this feature.
                    </p>
                </div>
            );
        }

        return (
            <div className="overflow-auto">
                <p className="mt-2 text-lg">
                    Currently Linked ({linkedDevices?.length} /{" "}
                    {subscriptionData.configuration.linked_devices_limit})
                </p>
                <table className="mt-2 w-full max-w-3xl border-separate border border-slate-500 bg-slate-800 text-sm shadow-sm">
                    {linkedDevices?.length !== 1 && (
                        <thead className="bg-slate-700">
                            <tr>
                                <th className="border border-slate-600 p-4 font-semibold text-slate-200">
                                    Name
                                </th>
                                <th className="border border-slate-600 p-4 font-semibold text-slate-200">
                                    Created At
                                </th>
                                <th className="border border-slate-600 p-4 font-semibold text-slate-200">
                                    Remove
                                </th>
                            </tr>
                        </thead>
                    )}
                    <tbody>
                        {linkedDevices.length > 1 &&
                            linkedDevices.map((device) => (
                                <tr key={device.id} className="h-4 text-center">
                                    {/* TODO: Pull device name from on-device data using the device ID */}
                                    <td
                                        // title={device.name ?? ""}
                                        className="overflow-hidden text-ellipsis border border-slate-700 p-4 text-center text-slate-400"
                                        style={{
                                            maxWidth: "20px",
                                        }}
                                    >
                                        {/* {device.name} */}?
                                    </td>
                                    <td className="border border-slate-700 p-4 text-slate-400">
                                        {device.created_at.toDateString()}{" "}
                                        {device.created_at.toLocaleTimeString()}
                                    </td>
                                    <td className="border border-slate-700 p-4 text-center text-slate-400">
                                        <ButtonFlat
                                            text="X"
                                            onClick={async () => {
                                                const confirmRemoval =
                                                    window.confirm(
                                                        `Do you really want to remove the selected linked device? This will prevent the device from accessing the service.`
                                                    );

                                                if (confirmRemoval) {
                                                    setOngoingOperation(true);
                                                    try {
                                                        await unlinkDevice.mutateAsync(
                                                            {
                                                                id: device.id,
                                                            }
                                                        );
                                                        refetchLinkedDevices();
                                                    } catch (error) {
                                                        console.error(
                                                            "Error unlinking device.",
                                                            error
                                                        );
                                                        toast.error(
                                                            "Error unlinking device.",
                                                            {
                                                                autoClose: 3000,
                                                            }
                                                        );
                                                    }
                                                    setOngoingOperation(false);
                                                }
                                            }}
                                        ></ButtonFlat>
                                    </td>
                                </tr>
                            ))}
                        {linkedDevices.length <= 1 && (
                            <tr>
                                <td
                                    colSpan={4}
                                    className="border border-slate-700 p-4 text-center text-slate-400 "
                                >
                                    No linked devices found besides the current
                                    device.
                                </td>
                            </tr>
                        )}
                    </tbody>
                </table>
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
                                    Subscription
                                </p>
                                <SubscriptionMenu />
                            </div>

                            <div className="mt-4 rounded-lg bg-gray-100 p-4">
                                <p className="text-lg font-bold text-slate-800">
                                    Linked Devices
                                </p>
                                <LinkedDevices />
                            </div>

                            <div className="mt-4 rounded-lg bg-gray-100 p-4">
                                <p className="text-lg font-bold text-slate-800">
                                    General
                                </p>
                                <div className="mt-2 flex flex-col">
                                    <ButtonFlat
                                        type={ButtonType.Secondary}
                                        text="Delete Account"
                                        onClick={async () => {
                                            if (
                                                !vaultMetadata ||
                                                !unlockedVault
                                            )
                                                return;

                                            const confirmBox = window.confirm(
                                                "Do you really want to delete this account permanently?"
                                            );
                                            if (confirmBox === true) {
                                                await deleteUser.mutateAsync();
                                                await unbindAccountFromVault(
                                                    vaultMetadata,
                                                    unlockedVault
                                                );
                                                router.reload();
                                            }
                                        }}
                                    ></ButtonFlat>
                                </div>
                            </div>

                            {/* Overlay that is active if the session is null and tells the user that he is offline */}
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
                                        You are offline
                                    </p>
                                    <p className="text-base text-slate-600">
                                        You need to be online to manage your
                                        account.
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
const AccountHeaderWidget: React.FC<{
    showAccountSignUpSignInDialog: () => void;
    signOutCallback: () => void;
}> = ({ showAccountSignUpSignInDialog, signOutCallback }) => {
    const { data: session, status: sessionStatus } = useSession();
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
                    <p className="text-slate-400">Access online services</p>
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
                                                        session?.user?.name ??
                                                        ""
                                                    }
                                                >
                                                    {session?.user?.name}
                                                </p>
                                                <p
                                                    className="max-w-[200px] truncate text-slate-400"
                                                    title={
                                                        session?.user?.email ??
                                                        ""
                                                    }
                                                >
                                                    {session?.user?.email}
                                                </p>
                                            </>
                                        )}

                                        {!session &&
                                            sessionStatus ===
                                                "unauthenticated" && (
                                                <div className="text-center">
                                                    <p className="max-w-xs truncate capitalize text-slate-50">
                                                        Disconnected
                                                    </p>
                                                    <p className="max-w-xs truncate text-slate-400">
                                                        From CryptexVault
                                                        services
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
                                                text="Unbind account"
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
                subscriptionData={subscriptionData}
                dataLoading={isSubscriptionDataLoading}
                hasDataLoadingError={hasSubscriptionDataError}
            />
        </>
    );
};

const VaultSettingsDialog: React.FC<{
    showDialogFnRef: React.MutableRefObject<(() => void) | null>;
}> = ({ showDialogFnRef }) => {
    const [visibleState, setVisibleState] = useState(false);
    const hideModal = () => setVisibleState(false);
    showDialogFnRef.current = () => setVisibleState(true);

    const [isLoading, setIsLoading] = useState(false);

    const vaultMetadata = useAtomValue(unlockedVaultMetadataAtom);

    const manualVaultBackup = async () => {
        setIsLoading(true);
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

            await BackupUtils.trigger(
                BackupUtils.BackupType.Manual,
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
        <GenericModal
            key="vault-settings-modal"
            visibleState={[visibleState, setVisibleState]}
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
                                {vaultMetadata.CreatedAt.toLocaleDateString()}
                            </b>
                        </p>
                    </div>
                    <div className="flex w-full flex-col text-left">
                        {/* The Backup section with rounded corners and a header top-left */}
                        <div className="mt-4 rounded-lg bg-gray-100 p-4">
                            <p className="text-lg font-bold text-slate-800">
                                Backup
                            </p>
                            <p className="mt-2 text-base text-gray-600">
                                You can backup your vault by exporting it as an
                                encrypted JSON file. This file can be imported
                                on another device or browser to restore your
                                vault there.
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
                                algorithm used to encrypt your vault. This will
                                re-encrypt your vault with the new settings.
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
                <ButtonFlat
                    text="Close"
                    type={ButtonType.Secondary}
                    onClick={() => hideModal()}
                    disabled={isLoading}
                />
            </Footer>
        </GenericModal>
    );
};

const TOTPDialog: React.FC<{
    visibleState: [boolean, React.Dispatch<React.SetStateAction<boolean>>];
    submitCallback: (formData: Credential.TOTPFormSchemaType) => Promise<void>;
}> = ({ visibleState, submitCallback }) => {
    const {
        handleSubmit,
        control,
        formState: { errors, isSubmitting, isDirty },
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

    const hideModal = async (force = false) => {
        const hide = () => {
            visibleState[1](false);
            resetForm();
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
        hideModal(true);
    };

    return (
        <GenericModal key="credentials-totp-modal" visibleState={visibleState}>
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
                    onClick={() => hideModal()}
                />
            </Footer>
        </GenericModal>
    );
};
type CredentialDialogProps = {
    showDialogFnRef: React.MutableRefObject<(() => void) | null>;
    vaultMetadata: VaultMetadata;
    vault: Vault;
    selected: React.MutableRefObject<Credential.VaultCredential | undefined>;
    requiredAuth?: boolean;
};
const CredentialDialog: React.FC<CredentialDialogProps> = ({
    showDialogFnRef,
    vaultMetadata,
    vault,
    selected,
    requiredAuth = false, // Not used yet, but will be used to require authentication to view credentials
}) => {
    const [isDialogVisible, setIsDialogVisible] = useState(false);
    showDialogFnRef.current = () => setIsDialogVisible(true);
    const hideModal = async (force = false) => {
        const hide = () => {
            setIsDialogVisible(false);
            selected.current = undefined; // Reset the selected credential
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
        id: null, // This is set to null to indicate that this is a new credential
        name: "",
        username: "",
        password: "",
        totp: null,
        tags: [],
        url: "",
        notes: "",
    };

    const {
        handleSubmit,
        control,
        formState: { errors, isSubmitting, isDirty },
        reset: resetForm,
        setValue,
        register,
    } = useForm<Credential.CredentialFormSchemaType>({
        resolver: zodResolver(Credential.credentialFormSchema),
        defaultValues: defaultValues,
    });

    const TOTPDialogVisible = useState(false);
    const showTOTPDialog = () => TOTPDialogVisible[1](true);
    const setTOTPFormValue = async (form: Credential.TOTPFormSchemaType) => {
        setValue("totp", form, {
            shouldDirty: true,
        });
    };

    const setUnlockedVault = useSetAtom(unlockedVaultAtom);

    const saveToClipboard = async (value?: string) => {
        if (!value) return;
        await navigator.clipboard.writeText(value);
        toast.success("Copied to clipboard");
    };

    const ClipboardButton = ({ value }: { value?: string }) => {
        return (
            <ClipboardDocumentIcon
                className="mx-2 h-5 w-5 flex-grow-0 cursor-pointer text-slate-400 hover:text-slate-500"
                style={{
                    // display: value ? "block" : "none",
                    // If the value is empty, set opacity to 50%
                    opacity: value ? 1 : 0.5,
                    pointerEvents: value ? "auto" : "none",
                }}
                aria-hidden="true"
                title="Copy to clipboard"
                onClick={() => saveToClipboard(value)}
            />
        );
    };

    const TagBox: React.FC<{
        value: string[];
        onChange: (tags: string[]) => void;
    }> = ({ value, onChange }) => {
        const [inputValue, setInputValue] = useState("");
        const [inputFocused, setInputFocused] = useState(false);

        const tagInputRef = useRef<HTMLInputElement>(null);

        const addTag = (tag: string) => {
            if (tag.length === 0) return;
            if (value.includes(tag)) return;
            onChange([...value, tag]);
            setInputValue("");
        };

        const removeTag = (tag: string) => {
            onChange(value.filter((t) => t !== tag));

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
                {value.map((tag) => (
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
        const [code, setCode] = useState("");
        const [timeLeft, setTimeLeft] = useState(0);

        const updateCode = () => {
            const totp = new OTPAuth.TOTP({
                issuer: value.Issuer,
                secret: value.Secret,
                period: value.Period,
                digits: value.Digits,
                algorithm: value.Algorithm,
            });
            const code = totp.generate();

            setCode(code);
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
                        <span className="text-2xl font-bold">{code}</span>
                        <span className="text-xs text-gray-500">
                            {timeLeft} seconds left
                        </span>
                    </div>
                    <div className="flex flex-row items-center">
                        <ClipboardButton value={code} />
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
        // Upsert the credential in the vault
        vault.upsertCredential(formData);

        // Update the unlocked vault atom
        setUnlockedVault(vault);

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
            await vaultMetadata.save(vault);

            toast.success("Vault data saved", {
                autoClose: 3000,
                closeButton: false,
                toastId: "saving-vault-data",
                updateId: "saving-vault-data",
            });

            // Hide the modal
            hideModal(true);
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
    };

    useEffect(() => {
        // Set the form fields to the selected credential's values
        if (selected.current) {
            const formData = {
                id: selected.current.ID, // This means that the form is in "edit" mode
                name: selected.current.Name,
                username: selected.current.Username,
                password: selected.current.Password,
                totp: selected.current.TOTP ?? null,
                tags: selected.current.Tags,
                url: selected.current.URL,
                notes: selected.current.Notes,
            };

            resetForm(formData);
        } else {
            // If no credential is selected, reset the form
            resetForm(defaultValues);
        }
    }, [selected, selected.current, resetForm]);

    return (
        <GenericModal
            key="credentials-modal"
            visibleState={[isDialogVisible, setIsDialogVisible]}
            inhibitDismissOnClickOutside={true}
        >
            <Body className="flex w-full flex-col items-center gap-3">
                <>
                    <p className="text-center text-2xl font-bold text-gray-900">
                        Credentials
                    </p>

                    {
                        // If a credential is selected, show the credential's information
                        selected.current && (
                            <p className="mt-2 text-left text-base text-gray-600">
                                Name: <b>{selected.current.Name}</b>
                                <br />
                                Created at:{" "}
                                <b>
                                    {selected.current.DateCreated.toLocaleDateString()}
                                </b>
                                {
                                    // If the credential has been modified, show the date it was modified
                                    selected.current.DateModified && (
                                        <>
                                            <br />
                                            Updated at:{" "}
                                            <b>
                                                {selected.current.DateModified.toLocaleDateString()}
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
                                                {selected.current.DatePasswordChanged.toLocaleDateString()}
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
                                name="name"
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
                            {errors.name && (
                                <p className="text-red-500">
                                    {errors.name.message}
                                </p>
                            )}
                        </div>
                        <div className="mt-4 flex flex-col">
                            <Controller
                                control={control}
                                name="username"
                                render={({
                                    field: { onChange, onBlur, value, ref },
                                }) => (
                                    <>
                                        <label className="text-gray-600">
                                            Username
                                        </label>
                                        <div className="flex flex-row items-center">
                                            <input
                                                ref={ref}
                                                type="text"
                                                autoCapitalize="none"
                                                className="mt-1 flex-grow rounded-md bg-gray-200 px-4 py-2 text-gray-900"
                                                onChange={onChange}
                                                onBlur={onBlur}
                                                value={value}
                                            />
                                            <ClipboardButton value={value} />
                                        </div>
                                    </>
                                )}
                            />
                            {errors.username && (
                                <p className="text-red-500">
                                    {errors.username.message}
                                </p>
                            )}
                        </div>
                        <div className="mt-4 flex flex-col">
                            <Controller
                                control={control}
                                name="password"
                                render={({
                                    field: { onChange, onBlur, value },
                                }) => (
                                    <>
                                        <label className="text-gray-600">
                                            Password
                                        </label>
                                        <div className="flex flex-row items-center">
                                            <input
                                                type="password"
                                                autoCapitalize="none"
                                                className="mt-1 flex-grow rounded-md bg-gray-200 px-4 py-2 text-gray-900"
                                                onChange={onChange}
                                                onBlur={onBlur}
                                                value={value}
                                            />
                                            <ClipboardButton value={value} />
                                        </div>
                                        {/* <EntropyCalculator value={value} /> */}
                                    </>
                                )}
                            />
                            {errors.password && (
                                <p className="text-red-500">
                                    {errors.password.message}
                                </p>
                            )}
                        </div>
                        <div className="mt-4 flex flex-col">
                            <Controller
                                control={control}
                                name="totp"
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
                            {errors.totp && (
                                <p className="text-red-500">
                                    {errors.totp.message}
                                </p>
                            )}
                        </div>
                        <div className="mt-4 flex flex-col">
                            <Controller
                                control={control}
                                name="tags"
                                render={({ field: { onChange, value } }) => (
                                    <>
                                        <label className="text-gray-600">
                                            Tags
                                        </label>
                                        <TagBox
                                            onChange={onChange}
                                            value={value}
                                        />
                                    </>
                                )}
                            />
                            {errors.tags && (
                                <p className="text-red-500">
                                    {errors.tags.message}
                                </p>
                            )}
                        </div>
                        <div className="mt-4 flex flex-col">
                            <Controller
                                control={control}
                                name="url"
                                render={({
                                    field: { onChange, onBlur, value },
                                }) => (
                                    <>
                                        <label className="text-gray-600">
                                            Website (URL)
                                        </label>
                                        <div className="flex flex-row items-center">
                                            <input
                                                type="text"
                                                autoCapitalize="none"
                                                className="mt-1 flex-grow rounded-md bg-gray-200 px-4 py-2 text-gray-900"
                                                onChange={onChange}
                                                onBlur={onBlur}
                                                value={value}
                                            />
                                            <ClipboardButton value={value} />
                                            <OpenInNewTabButton value={value} />
                                        </div>
                                    </>
                                )}
                            />
                            {errors.url && (
                                <p className="text-red-500">
                                    {errors.url.message}
                                </p>
                            )}
                        </div>
                        <div className="mt-4 flex flex-col">
                            <Controller
                                control={control}
                                name="notes"
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
                            {errors.notes && (
                                <p className="text-red-500">
                                    {errors.notes.message}
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
                    onClick={() => hideModal()}
                    disabled={isSubmitting}
                />
            </Footer>
        </GenericModal>
    );
};

const CredentialCard: React.FC<{
    /**
     * The credential to display
     */
    credential: Credential.VaultCredential;

    /**
     * The function to call when the card is clicked
     * @returns void
     */
    onClick: () => void;

    /**
     * The function to call when the credential is removed.
     * This is done so that every card doesn't have to hold the reference to the vault.
     * @param id The ID of the credential to remove
     * @returns Promise<void>
     */
    removalCallback: (id: string) => Promise<void>;
}> = ({ credential, onClick, removalCallback }) => {
    const optionsButtonRef = useRef<HTMLButtonElement>(null);

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
                const data = credential.calculateTOTP();
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
        onClick: async () => await removalCallback(credential.ID),
    });

    return (
        <div
            className="flex cursor-pointer items-center justify-between rounded-lg bg-gray-700 px-2 shadow-md transition-shadow hover:shadow-[#FF5668]"
            onContextMenu={(e) => {
                e.preventDefault();
                optionsButtonRef.current?.click();
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
                        <p className="text-md line-clamp-2 font-bold lg:line-clamp-1">
                            {credential.Name}
                        </p>
                        <p className="text-left text-sm text-slate-300">
                            {credential.Username}
                        </p>
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
                    ref={optionsButtonRef}
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
                    <Menu.Items className="absolute right-0 z-10 mt-2 w-48 origin-top-right rounded-md bg-gray-800 shadow-lg focus:outline-none">
                        <div className="py-1">
                            {options.map((option, index) => (
                                <Menu.Item
                                    key={`vault-${credential.ID}-${index}`}
                                >
                                    {({ active }) => {
                                        const hoverClass = clsx({
                                            "bg-gray-900 text-white": active,
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
    // SignIn = "Sign In",
    SignUp = "Sign Up",
}
type AccountDialogTabBarProps = {
    currentFormMode: AccountDialogMode;
    changeFormMode: (
        // newFormMode: AccountDialogMode.SignIn | AccountDialogMode.SignUp
        newFormMode: AccountDialogMode.SignUp
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

type AccountSignUpSignInDialogProps = {
    showDialogFnRef: React.MutableRefObject<(() => void) | null>;
    vaultMetadata: VaultMetadata;
    vault: Vault;
};
const AccountSignUpSignInDialog: React.FC<AccountSignUpSignInDialogProps> = ({
    showDialogFnRef,
    vaultMetadata,
    vault,
}) => {
    // TODO: Show this dialog only if the user is actually online
    const [visible, setVisible] = useState(!vault.OnlineServices.isBound());
    showDialogFnRef.current = () => setVisible(true);
    const hideDialog = () => setVisible(false);

    const setUnlockedVault = useSetAtom(unlockedVaultAtom);

    const [currentFormMode, setCurrentFormMode] = useState(
        AccountDialogMode.SignUp
    );

    const changeFormMode = (
        // newFormMode: AccountDialogMode.SignIn | AccountDialogMode.SignUp
        newFormMode: AccountDialogMode.SignUp
    ) => {
        // Clear the submit function reference
        // signInSubmitFnRef.current = null;

        setCurrentFormMode(newFormMode);
    };

    const isSubmitting = useState(false);
    const isFormSubmitting = isSubmitting[0];

    // const signInSubmitFnRef = useRef<(() => Promise<void>) | null>(null);
    const signUpSubmitFnRef = useRef<(() => Promise<void>) | null>(null);

    const onConfirm = async () => {
        // if (
        //     currentFormMode === AccountDialogMode.SignIn &&
        //     signInSubmitFnRef.current
        // ) {
        //     await signInSubmitFnRef.current();
        // } else if (
        //     currentFormMode === AccountDialogMode.SignUp &&
        //     signUpSubmitFnRef.current
        // ) {
        await signUpSubmitFnRef.current?.();
        // }
    };

    const bindAccount = async (
        userID: string,
        privateKey: string,
        publicKey: string
    ) => {
        // Save the UserID, public/private key to the vault
        vault.OnlineServices.bindAccount(userID, publicKey, privateKey);
        setUnlockedVault(vault);

        try {
            // Save the vault
            await vaultMetadata.save(vault);
        } catch (e) {
            console.error("Failed to save vault.", e);
            toast.error("Failed to save vault.", {
                autoClose: 3000,
                closeButton: true,
            });
        }
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
                {/* <div className="mt-3 flex flex-col items-center text-center sm:ml-4 sm:mt-0 sm:text-left">
                    {currentFormMode === AccountDialogMode.SignIn ? (
                        // <AccountDialogSignInForm
                        //     submittingState={isSubmitting}
                        //     submitFnRef={signInSubmitFnRef}
                        //     bindAccountFn={bindAccount}
                        //     vault={vault}
                        // />
                    ) : ( */}
                <AccountDialogSignUpForm
                    submittingState={isSubmitting}
                    submitFnRef={signUpSubmitFnRef}
                    vaultMetadata={vaultMetadata}
                    vault={vault}
                    bindAccountFn={bindAccount}
                    hideDialogFn={hideDialog}
                />
                {/* //     )}
                // </div> */}
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

const AccountDialogSignInForm: React.FC<{
    submittingState: [boolean, React.Dispatch<React.SetStateAction<boolean>>];
    submitFnRef: React.MutableRefObject<(() => Promise<void>) | null>;
    bindAccountFn: (
        userId: string,
        privateKey: string,
        publicKey: string
    ) => Promise<void>;
    vault: Vault;
}> = ({ submittingState, submitFnRef, bindAccountFn, vault }) => {
    const [isSubmitting, setIsSubmitting] = submittingState;

    enum ValidInput {
        QRCode = "QR Code",
        Sound = "Sound",
        File = "File",
    }

    const [validInput, setValidInput] = useState<ValidInput | null>(null);
    const clearValidInput = () => {
        setValidInput(null);
        submitFnRef.current = null;
    };

    const fileInputRef = useRef<HTMLInputElement>(null);

    const promptPassphrase = async () => {
        return new Promise<string>((resolve, reject) => {
            const passphrase = prompt(
                "Enter the passphrase from the other device."
            );
            if (passphrase) {
                resolve(passphrase);
            } else {
                reject("No passphrase entered.");
            }
        });
    };

    const loadFromFile = async () => {
        try {
            // Open the file picker
            // FIXME: This promise never resolves if the user cancels the file picker
            const file = await openFilePicker(fileInputRef);

            setIsSubmitting(true);

            // On file selection, read the file
            const encryptedFileContents = await readFile(file);

            // Prompt the user for the decryption passphrase
            const secret = await promptPassphrase();

            // Decrypt and parse the file
            const decryptedData =
                await OnlineServicesAccount.decryptTransferableData(
                    encryptedFileContents,
                    secret
                );

            // The file is valid
            setValidInput(ValidInput.File);

            // Bind the submitFnRef to the submit function suitable for this input
            submitFnRef.current = async () => {
                console.debug(
                    "Submitting sign in form using data from file loader."
                );

                // console.log("Trying to use the following data:", decryptedData);

                setIsSubmitting(true);

                // Try to sign in with the data from the file
                // const signInRes = await cryptexAccountSignIn(
                //     decryptedData.UserID,
                //     decryptedData.PrivateKey
                // );

                // If successful, save the credentials to the vault
                // if (signInRes) {
                //     bindAccountFn(
                //         decryptedData.UserID,
                //         decryptedData.PrivateKey,
                //         decryptedData.PublicKey
                //     );
                // }

                setIsSubmitting(false);
            };
        } catch (error) {
            console.error(`Failed to load account from file. ${error}`);
            toast.error("Failed to load account from file.", {
                autoClose: 3000,
                closeButton: true,
            });
        }

        setIsSubmitting(false);
    };

    const ButtonContainer: React.FC<{
        icon: React.ReactNode;
        iconCaption: string;
        description: string;
        onClick?: () => void;
        disabled?: boolean;
        validInput?: boolean;
    }> = ({
        icon,
        iconCaption,
        description,
        onClick,
        disabled,
        validInput,
    }) => {
        // If the input is valid, show a green checkmark
        return validInput ? (
            <div className="flex flex-col items-center justify-center rounded-md bg-slate-500 p-5 shadow-md">
                <div className="flex w-full flex-col items-end">
                    {/* Clear field icon */}
                    <XMarkIcon
                        className={`h-5 w-5 cursor-pointer`}
                        title="Clear file"
                        aria-hidden="true"
                        onClick={clearValidInput}
                    />
                </div>
                <div className="mb-5 flex flex-col items-center justify-center">
                    <CheckCircleIcon
                        className={`h-12 w-12 text-green-500`}
                        aria-hidden="true"
                    />
                    <p className="h-full w-full cursor-pointer text-center text-base text-slate-200">
                        File successfully loaded
                    </p>
                </div>
            </div>
        ) : (
            <div
                className={clsx({
                    "mb-2 flex flex-col items-center gap-1 rounded-md bg-gray-200 px-4 py-2 transition-colors ":
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
    };

    // Debugging purposes, creates an encrypted transferable data object and logs it to the console
    // useEffect(() => {
    //     vault.OnlineServices.encryptTransferableData().then((data) => {
    //         console.log("TransferableData", data);
    //     });
    // }, []);

    return (
        <div className="flex w-full flex-col text-left">
            {/* Notice  */}

            <ButtonContainer
                icon={<CameraIcon className="h-5 w-5 text-gray-900" />}
                iconCaption="Scan QR code"
                description="Scan the QR code with your camera"
                // disabled={
                //     isSubmitting ||
                //     (validInput !== ValidInput.QRCode && validInput !== null)
                // }
                disabled={true} // FIXME: QR code scanning is not implemented yet
                validInput={validInput === ValidInput.QRCode}
            />

            <ButtonContainer
                icon={<SpeakerWaveIcon className="h-5 w-5 text-gray-900" />}
                iconCaption="Transfer with sound"
                description="Transfer the data with sound"
                // disabled={
                //     isSubmitting ||
                //     (validInput !== ValidInput.Sound && validInput !== null)
                // }
                disabled={true} // FIXME: Sound transfer is not implemented yet
                validInput={validInput === ValidInput.Sound}
            />

            <ButtonContainer
                icon={<DocumentTextIcon className="h-5 w-5 text-gray-900" />}
                iconCaption="Load from file"
                description="Load the data from a file"
                onClick={loadFromFile}
                disabled={
                    isSubmitting ||
                    (validInput !== ValidInput.File && validInput !== null)
                }
                validInput={validInput === ValidInput.File}
            />

            <div className="hidden">
                <input type="file" ref={fileInputRef} accept=".cryxa" />
            </div>
        </div>
    );
};

const AccountDialogSignUpForm: React.FC<{
    submittingState: [boolean, React.Dispatch<React.SetStateAction<boolean>>];
    submitFnRef: React.MutableRefObject<(() => Promise<void>) | null>;
    vaultMetadata: VaultMetadata;
    vault: Vault;
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
                    registration. The token will expire after 24 hours.
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

//#endregion Vault account management

//#region Linking vaults
const LinkDeviceDialog: React.FC<{
    showDialogFnRef: React.MutableRefObject<(() => void) | null>;
}> = ({ showDialogFnRef }) => {
    const { data: session } = useSession();
    const hasSession = session != null;

    const unlockedVault = useAtomValue(unlockedVaultAtom);
    const vaultMetadata = useAtomValue(unlockedVaultMetadataAtom);

    const [selectedLinkMethod, setSelectedLinkMethod] =
        useState<LinkMethod | null>(null);

    const [isOperationInProgress, setIsOperationInProgress] = useState(false);

    const linkingDeviceFormSchema = z.object({
        deviceName: z
            .string()
            .min(1, "Device name cannot be empty.")
            .max(150, "Device name cannot be longer than 150 characters.")
            .default("My Device"),
        generatedKeys: z.boolean().default(false),
        linkedDevice: z.boolean().default(false),
        serializedTransferableData: z.boolean().default(false),
        showingMnemonic: z.boolean().default(false),
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
            generatedKeys: false,
            linkedDevice: false,
            serializedTransferableData: false,
            showingMnemonic: false,
            mnemonic: "",
        },
    });

    const [visible, setVisible] = useState(false);
    showDialogFnRef.current = () => setVisible(true);
    const hideDialog = () => {
        setVisible(false);
        setSelectedLinkMethod(null);
        setIsOperationInProgress(false);
        resetForm();
    };

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

    const saveNewLinkedDevice = async (userID: string): Promise<void> => {
        // Save the UserID and device name to the vault as a new linked device
        if (unlockedVault && vaultMetadata) {
            unlockedVault.OnlineServices.addLinkedDevice(
                userID,
                getFormValues("deviceName")
            );
            await vaultMetadata.save(unlockedVault);
        }

        // Close the dialog
        hideDialog();

        toast.success("Successfully linked device.", {
            autoClose: 3000,
            closeButton: true,
        });
    };

    const startLinkingProcess = async (): Promise<{
        userID: string;
        encryptedTransferableData: string;
        generatedKeyPair: {
            publicKey: string;
            privateKey: string;
        };
    }> => {
        if (!unlockedVault) {
            throw new Error("No unlocked vault found.");
        }

        // Generate a set of keys for the device
        const keyPair = await generateKeyPair();
        setFormValue("generatedKeys", true);

        // Run the account.linkDevice mutation
        const userID = await linkNewDevice({
            publicKey: keyPair.publicKey,
        });
        setFormValue("linkedDevice", true);

        // Encrypt the received UserID and PrivateKey with a random mnemonic passphrase
        const encryptedTransferableData =
            await OnlineServicesAccount.encryptTransferableData(
                userID,
                keyPair.publicKey,
                keyPair.privateKey
            );
        setFormValue("serializedTransferableData", true);

        // Show the user a note and the mnemonic passphrase to enter on the other device
        setFormValue("mnemonic", encryptedTransferableData.secret);
        setFormValue("showingMnemonic", true);

        return {
            userID,
            encryptedTransferableData:
                encryptedTransferableData?.encryptedDataB64,
            generatedKeyPair: keyPair,
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
        const localConnection = new RTCPeerConnection({
            iceServers: [
                {
                    urls: "stun:stun.l.google.com:19302",
                },
            ],
        });

        // Create a data channel
        const dataChannel = localConnection.createDataChannel("linking");
        dataChannel.addEventListener("open", async (event) => {
            // console.log("Data channel opened.", event);

            if (
                vaultMetadata &&
                unlockedVault &&
                unlockedVault.OnlineServices.UserID
            ) {
                //#region Preparing vault data for transmission
                const exportedVault = unlockedVault.packageForLinking({
                    UserID: userID,
                    PublicKey: generatedKeyPair.publicKey,
                    PrivateKey: generatedKeyPair.privateKey,
                });

                const encryptedBlobObj = await vaultMetadata.exportForLinking(
                    exportedVault
                );
                //#endregion Preparing vault data for transmission

                // Send the encrypted data to the other device
                dataChannel.send(JSON.stringify(encryptedBlobObj, null, 0));

                saveNewLinkedDevice(userID);
            }

            // Close the data channel
            dataChannel.close();
        });
        dataChannel.addEventListener("close", (event) => {
            console.debug("Data channel closed.", event);
            // Close the WebRTC connection
            localConnection.close();
        });

        // Connect to WS and wait for the other device
        const onlineServicesEndpoint = new Pusher(
            env.NEXT_PUBLIC_PUSHER_APP_KEY,
            onlineServicesEndpointConfiguration
        );
        // client.signin();

        const channelName = `presence-link-${userID}`;

        const channel = onlineServicesEndpoint.subscribe(channelName);

        channel.bind("pusher:subscription_succeeded", () => {
            // console.log("Subscribed to channel.");
        });

        // When the user connects, send the encrypted data to the other device
        channel.bind("pusher:member_added", async () => {
            // console.log("Other device connected.", member);

            const offer = await localConnection.createOffer();
            localConnection.setLocalDescription(offer);
            channel.trigger("client-link", {
                type: "offer",
                data: offer,
            });

            // On ICE candidate, send it to the other device
            localConnection.onicecandidate = (event) => {
                if (event.candidate) {
                    channel.trigger("client-link", {
                        type: "ice-candidate",
                        data: event.candidate,
                    });
                }
            };
        });

        // Receive WebRTC events from the other device
        channel.bind(
            "client-link",
            async (data: {
                type: "ice-candidate" | "answer";
                data: RTCIceCandidateInit | RTCSessionDescriptionInit;
            }) => {
                // console.log("Received data from other device.", data);

                if (data.type === "ice-candidate") {
                    console.debug("Adding ICE candidate.");
                    await localConnection.addIceCandidate(
                        data.data as RTCIceCandidateInit
                    );
                } else if (data.type === "answer") {
                    console.debug("Setting remote description.");
                    await localConnection.setRemoteDescription(
                        data.data as RTCSessionDescriptionInit
                    );
                }
            }
        );

        // Bind to an on error event
        onlineServicesEndpoint.connection.bind("error", (err: any) => {
            console.error("Pusher error:", err);
            // TODO: Handle errors
            // if (err.error.data.code === 4004) {
            //     // log('Over limit!');
            // }
        });

        localConnection.onconnectionstatechange = (event) => {
            console.debug("WebRTC connection state changed:", event);

            if (localConnection.connectionState === "connected") {
                console.debug("WebRTC connection established.");

                // Disconnect from the WS server
                onlineServicesEndpoint.disconnect();
            }

            if (localConnection.connectionState === "disconnected") {
                console.debug("WebRTC connection lost.");
            }
        };

        // TODO: When the device connects, create a WebRTC offer and send it to the other device
        // TODO: After the other device accepts the offer, send the encrypted data to the other device
    };

    const fileMethod = async () => {
        if (!isFormValid) {
            handleSubmit(() => {
                // No-op
            })();
            return;
        }

        setSelectedLinkMethod(LinkMethod.File);
        setIsOperationInProgress(true);

        try {
            // Trigger linking
            const { userID, encryptedTransferableData, generatedKeyPair } =
                await startLinkingProcess();

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

            await finishLinkingProcess(userID, generatedKeyPair);
        } catch (e) {
            console.error("Failed to link device.", e);

            let message = "Failed to link device.";
            if (e instanceof TRPCClientError) {
                message = e.message;
            }

            toast.error(message, {
                autoClose: 3000,
                closeButton: true,
            });

            setIsOperationInProgress(false);
        }
    };

    const BlockButton: React.FC<{
        icon: React.ReactNode;
        iconCaption: string;
        description: string;
        onClick?: () => void;
        disabled?: boolean;
    }> = ({ icon, iconCaption, description, onClick, disabled }) => (
        <div
            className={clsx({
                "mb-2 flex flex-col items-center gap-1 rounded-md bg-gray-200 px-4 py-2 transition-colors ":
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

                                <BlockButton
                                    icon={
                                        <CameraIcon className="h-5 w-5 text-gray-900" />
                                    }
                                    iconCaption="QR code"
                                    description="Generate a QR code to scan with the other device"
                                    // disabled={
                                    //     isSubmitting ||
                                    //     (validInput !== ValidInput.QRCode && validInput !== null)
                                    // }
                                    disabled={true} // FIXME: QR code scanning is not implemented yet
                                    // validInput={validInput === ValidInput.QRCode}
                                />

                                <BlockButton
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

                                <BlockButton
                                    icon={
                                        <DocumentTextIcon className="h-5 w-5 text-gray-900" />
                                    }
                                    iconCaption="Using a file"
                                    description="Generate a file to transfer to the other device"
                                    onClick={fileMethod}
                                    disabled={isOperationInProgress}
                                />
                            </>
                        )}

                    {!isWrongTier &&
                        hasSession &&
                        selectedLinkMethod != null && (
                            <div>
                                {/* A check list that has the items listed in the fileMethod function with gray checkmarks on the left side */}
                                <div className="flex flex-col gap-2">
                                    <div className="flex flex-row items-center gap-2">
                                        <Controller
                                            control={control}
                                            name="generatedKeys"
                                            render={({ field: { value } }) => (
                                                <CheckCircleIcon
                                                    className={clsx({
                                                        "h-5 w-5": true,
                                                        "text-gray-400": !value,
                                                        "text-green-500": value,
                                                    })}
                                                />
                                            )}
                                        />
                                        <p className="text-gray-900">
                                            Generated keys
                                        </p>
                                    </div>
                                    <div className="flex flex-row items-center gap-2">
                                        <Controller
                                            control={control}
                                            name="linkedDevice"
                                            render={({ field: { value } }) => (
                                                <CheckCircleIcon
                                                    className={clsx({
                                                        "h-5 w-5": true,
                                                        "text-gray-400": !value,
                                                        "text-green-500": value,
                                                    })}
                                                />
                                            )}
                                        />
                                        <p className="text-gray-900">
                                            Registered device
                                        </p>
                                    </div>
                                    <div className="flex flex-row items-center gap-2">
                                        <Controller
                                            control={control}
                                            name="serializedTransferableData"
                                            render={({ field: { value } }) => (
                                                <CheckCircleIcon
                                                    className={clsx({
                                                        "h-5 w-5": true,
                                                        "text-gray-400": !value,
                                                        "text-green-500": value,
                                                    })}
                                                />
                                            )}
                                        />
                                        <p className="text-gray-900">
                                            Encrypted and serialized data
                                        </p>
                                    </div>
                                    <div className="flex flex-row items-center gap-2">
                                        <Controller
                                            control={control}
                                            name="showingMnemonic"
                                            render={({ field: { value } }) => (
                                                <CheckCircleIcon
                                                    className={clsx({
                                                        "h-5 w-5": true,
                                                        "text-gray-400": !value,
                                                        "text-green-500": value,
                                                    })}
                                                />
                                            )}
                                        />
                                        <p className="text-gray-900">
                                            Showing decryption passphrase
                                        </p>
                                    </div>
                                    {/* Show the mnemonic */}
                                    <div className="flex flex-col items-center gap-2">
                                        <Controller
                                            control={control}
                                            name="showingMnemonic"
                                            render={({
                                                field: {
                                                    value: showingMnemonic,
                                                },
                                            }) => (
                                                <div
                                                    className={clsx({
                                                        "flex flex-col items-center gap-2":
                                                            true,
                                                        hidden: !showingMnemonic,
                                                    })}
                                                >
                                                    <p className="rounded-md bg-gray-200 p-2 text-gray-900">
                                                        {getFormValues(
                                                            "mnemonic"
                                                        )}
                                                    </p>
                                                    <p className="text-xs text-gray-500">
                                                        Enter this mnemonic on
                                                        the other device when
                                                        prompted.
                                                    </p>
                                                </div>
                                            )}
                                        />
                                    </div>
                                    <div className="mt-2 flex flex-col items-center gap-2">
                                        {/* Show the operation in progress indicator - loading spinner */}
                                        {isOperationInProgress && (
                                            <div className="flex flex-col items-center gap-2">
                                                <p className="animate-pulse text-gray-900">
                                                    Linking device...
                                                </p>
                                                <div className="h-8 w-8 animate-spin rounded-full border-b-2 border-t-2 border-gray-900"></div>
                                            </div>
                                        )}

                                        {
                                            // If the link method is file, show a nicely formatted tip on how to load it into the other device
                                            selectedLinkMethod ===
                                                LinkMethod.File && (
                                                <div className="flex list-decimal flex-col gap-2 rounded-md bg-slate-200 p-2">
                                                    <p className="text-md w-full text-center text-slate-600">
                                                        Tips for loading the
                                                        file into the other
                                                        device
                                                    </p>
                                                    <p className="text-md text-slate-600">
                                                        1. Load the file into
                                                        the other device by
                                                        selecting &quot;Link a
                                                        vault&quot; and then
                                                        &quot;Load from
                                                        file&quot;
                                                    </p>
                                                    <p className="text-md text-slate-600">
                                                        2. Once the file is
                                                        loaded, enter the
                                                        decryption passphrase
                                                        shown above.
                                                    </p>
                                                    <p className="text-md text-slate-600">
                                                        3. Follow the
                                                        instructions on the
                                                        other device.
                                                    </p>
                                                </div>
                                            )
                                        }
                                    </div>
                                </div>
                            </div>
                        )}
                </div>
            </Body>
            <Footer className="space-y-3 sm:space-x-5 sm:space-y-0">
                {/* <ButtonFlat
                    text="Link"
                    className="sm:ml-2"
                    // onClick={onConfirm}
                    disabled={isFormSubmitting}
                    loading={isFormSubmitting}
                /> */}
                <ButtonFlat
                    text="Cancel"
                    type={ButtonType.Secondary}
                    onClick={hideDialog}
                    disabled={isOperationInProgress}
                />
            </Footer>
        </GenericModal>
    );
};

const DashboardSidebarSynchronization: React.FC = () => {
    const showLinkingDeviceDialogFnRef = useRef<(() => void) | null>(null);

    const unlockedVault = useAtomValue(unlockedVaultAtom);

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
            <div className="mt-1 border-l-2 border-slate-500 pl-2">
                <p className="text-sm text-slate-500">Linked Devices</p>
                {unlockedVault.OnlineServices.LinkedDevices.map((device) => (
                    <div
                        key={`linked-device-sidebar-${device.ID}`}
                        className="mt-1 flex flex-col gap-2"
                    >
                        <div
                            className="ml-2 flex cursor-pointer items-center gap-2 text-slate-400 hover:text-slate-500"
                            // onClick={() =>
                            //     console.log(
                            //         `TODO: Linked device ${device.ID} clicked`
                            //     )
                            // }
                        >
                            <div>
                                <DevicePhoneMobileIcon className="h-5 w-5" />
                            </div>
                            <div className="flex flex-col">
                                <p
                                    className="line-clamp-1 text-base font-medium"
                                    title={device.Name}
                                >
                                    {device.Name}
                                </p>
                                {/* Last synchronization date */}
                                <p
                                    className="text-xs normal-case text-slate-300"
                                    title={
                                        device.LastSync
                                            ? `Last synchronized ${dayjs(
                                                  device.LastSync
                                              ).fromNow()}`
                                            : "Never synchronized"
                                    }
                                >
                                    {device.LastSync
                                        ? dayjs(device.LastSync).fromNow()
                                        : "Never"}
                                </p>
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
                        </div>
                    </div>
                ))}
                {
                    // If there are no linked devices, show a message
                    unlockedVault.OnlineServices.LinkedDevices.length === 0 && (
                        <p className="mt-2 text-center text-sm text-slate-500">
                            No linked devices
                        </p>
                    )
                }
            </div>
            <LinkDeviceDialog showDialogFnRef={showLinkingDeviceDialogFnRef} />
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
type VaultDashboardProps = {
    vault: Vault | null;
};
const VaultDashboard: React.FC<VaultDashboardProps> = ({ vault }) => {
    // console.log("AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA");

    const vaultMetadata = useAtomValue(unlockedVaultMetadataAtom);

    // We use this so that we can force a rerender of the component/app
    const setUnlockedVault = useSetAtom(unlockedVaultAtom);

    const [isSidebarOpen, setIsSidebarOpen] = useState(false);
    const sidebarSelector = ".sidebar-event-selector";
    const closeSidebarOnOutsideClick = (e: MouseEvent) => {
        if (e.target instanceof HTMLElement) {
            if (!e.target.closest(sidebarSelector)) {
                setIsSidebarOpen(false);
            }
        }
    };

    //#region Warning dialog
    const isWarningDialogOpen = useState(false);
    const warningDialogDescriptionRef = useRef<string | null>(null);
    const warningDialogOnConfirmFnRef = useRef<
        (() => Promise<void>) | (() => void) | null
    >(null);
    const warningDialogOnDismissFnRef = useRef<
        (() => Promise<void>) | (() => void) | null
    >(null);

    const showWarningDialog = (
        description: string,
        onConfirm: () => void,
        onDismiss: (() => void) | null
    ) => {
        warningDialogDescriptionRef.current = description;
        warningDialogOnConfirmFnRef.current = onConfirm;

        warningDialogOnDismissFnRef.current = onDismiss;
        isWarningDialogOpen[1](true);
    };
    //#endregion Warning dialog

    //#region Credential dialog
    const selectedCredential = useRef<Credential.VaultCredential | undefined>(
        undefined
    );
    const showCredentialsDialogRef = useRef<(() => void) | null>(null);
    const showCredentialDialog = (credential?: Credential.VaultCredential) => {
        // Set the selected credential
        selectedCredential.current = credential;

        // Show the credential's dialog
        showCredentialsDialogRef.current?.();
    };
    //#endregion Credential dialog

    const showAccountSignUpSignInDialogRef = useRef<(() => void) | null>(null);
    const showFeatureVotingDialogRef = useRef<(() => void) | null>(null);
    const showVaultSettingsDialogRef = useRef<(() => void) | null>(null);

    const showUnbindAccountDialog = () => {
        if (!vaultMetadata || !vault) return;

        showWarningDialog(
            `You are about to sign out and lose access to online services. This will unbind the account from your vault and you will have to restore from a backed-up vault to regain access to your account.`,
            async () => await unbindAccountFromVault(vaultMetadata, vault),
            null
        );
    };

    const lockVault = async (
        vaultMetadata: VaultMetadata,
        vaultInstance: Vault
    ) => {
        toast.info("Securing vault...", {
            autoClose: false,
            closeButton: false,
            toastId: "lock-vault",
            updateId: "lock-vault",
        });

        // A little delay to make sure the toast is shown
        await new Promise((resolve) => setTimeout(resolve, 100));

        try {
            // Trigger the vault's save function (this might not be needed when the auto-save feature is implemented)
            await vaultMetadata.save(vaultInstance);

            toast.success("Vault secured.", {
                autoClose: 3000,
                closeButton: true,
                toastId: "lock-vault",
                updateId: "lock-vault",
            });

            setUnlockedVault(null);
        } catch (e) {
            console.error(`Failed to save vault: ${e}`);
            toast.error(
                "Failed to save vault. There is a high possibility of data loss!",
                {
                    autoClose: 3000,
                    closeButton: true,
                    toastId: "lock-vault",
                    updateId: "lock-vault",
                }
            );
        }
    };

    const removeCredential = async (
        vaultMetadata: VaultMetadata,
        vaultInstance: Vault,
        ID: string
    ) => {
        toast.info("Removing credential...", {
            autoClose: false,
            closeButton: false,
            toastId: "remove-credential",
            updateId: "remove-credential",
        });

        // A little delay to make sure the toast is shown
        await new Promise((resolve) => setTimeout(resolve, 100));

        try {
            // Remove the credential from the vault
            vaultInstance.deleteCredential(ID);

            // Trigger the vault's save function (this might not be needed when the auto-save feature is implemented)
            await vaultMetadata.save(vaultInstance);

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
    };

    const sidebarClasses = clsx({
        "flex-col sm:px-5 pt-1 flex min-w-0 sm:min-w-[250px] max-w-[250px] transition-all duration-300 ease-in-out overflow-hidden gap-3":
            true,
        [sidebarSelector.slice(1)]: true, // We use this class to select the sidebar in the closeSidebarOnOutsideClick function
        "w-0 px-0": !isSidebarOpen,
        "min-w-[90vw] px-5 border-r-2 border-slate-800/60 sm:border-r-0":
            isSidebarOpen,
    });

    useEffect(() => {
        // Bind the event listener
        document.addEventListener("click", closeSidebarOnOutsideClick);

        return () => {
            // Unbind the event listener on clean up
            document.removeEventListener("click", closeSidebarOnOutsideClick);
        };
    }, []);

    // console.log("BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB");

    if (!vaultMetadata || !vault) return null;

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
                            onClick={() => setIsSidebarOpen(!isSidebarOpen)}
                        />
                    ) : (
                        <Bars3Icon
                            className="h-6 w-6 text-slate-400"
                            onClick={() => setIsSidebarOpen(!isSidebarOpen)}
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
                    signOutCallback={showUnbindAccountDialog}
                />
            </NavBar>
            <div className="flex flex-grow flex-row overflow-hidden">
                <div className={sidebarClasses}>
                    <div className="block md:hidden">
                        <VaultTitle title={vaultMetadata.Name} />
                    </div>
                    <div className="my-5 block h-1 rounded-md bg-slate-300/25 sm:hidden" />
                    {/* TODO: This should be made prettier on mobile */}
                    <div className="block w-full">
                        <ButtonFlat
                            text="New Item"
                            className="w-full"
                            inhibitAutoWidth={true}
                            onClick={() => showCredentialDialog()}
                        />
                    </div>
                    <div className="mt-5 flex gap-5">
                        <div className="flex w-full flex-col gap-2">
                            <p className="text-sm text-slate-500">
                                Synchronization
                            </p>
                            <DashboardSidebarSynchronization />
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
                                Icon={Cog8ToothIcon}
                                text="Settings"
                                onClick={() =>
                                    showVaultSettingsDialogRef.current?.()
                                }
                            />
                            <DashboardSidebarMenuItem
                                Icon={LockClosedIcon}
                                text="Lock Vault"
                                onClick={() => lockVault(vaultMetadata, vault)}
                            />
                        </div>
                    </div>
                </div>
                <div
                    className={clsx({
                        "flex flex-grow flex-col border-t border-slate-700 sm:rounded-tl-md sm:border-l sm:blur-none":
                            true,
                        "blur-sm": isSidebarOpen,
                    })}
                >
                    <div className="hidden w-full flex-grow-0 items-center gap-1 border-b border-slate-700 px-2">
                        {/* TODO: Replicate GitHub Projects filter bar behaviour */}
                        <FunnelIcon className="h-5 w-5 text-slate-400" />
                        {/* <XMarkIcon className="h-6 w-6 text-slate-400" /> */}
                        <input
                            type="text"
                            disabled={true}
                            className="ml-2 flex-grow border-none bg-transparent text-slate-400 outline-none"
                            placeholder="Filter by keyword or by field"
                        />
                    </div>
                    <div className="my-5 flex h-px w-full flex-grow justify-center overflow-y-auto px-5">
                        {vault.Credentials.length === 0 && (
                            <div className="flex flex-grow flex-col items-center justify-center">
                                <p className="text-2xl font-bold text-slate-50">
                                    No items
                                </p>
                                <p className="text-center text-slate-400">
                                    {" "}
                                    Press the &quot;New Item&quot; button in the
                                    sidebar to add a new credential.
                                </p>
                            </div>
                        )}
                        {vault.Credentials.length > 0 && (
                            <div className="flex w-full max-w-full flex-col gap-3 pb-3 2xl:max-w-7xl">
                                {vault.Credentials.map((credential) => (
                                    <CredentialCard
                                        key={credential.ID}
                                        credential={credential}
                                        onClick={() =>
                                            showCredentialDialog(credential)
                                        }
                                        removalCallback={async (ID: string) =>
                                            showWarningDialog(
                                                `You are about to remove the "${credential.Name}" credential.`,
                                                async () =>
                                                    await removeCredential(
                                                        vaultMetadata,
                                                        vault,
                                                        ID
                                                    ),
                                                null
                                            )
                                        }
                                    />
                                ))}
                            </div>
                        )}
                    </div>
                    {vault.Credentials.length > 0 && (
                        <div className="flex w-full flex-grow-0 items-center justify-center border-t border-slate-700 px-2 py-1">
                            <p className="text-slate-400">
                                Items loaded: {vault.Credentials.length}
                            </p>
                        </div>
                    )}
                </div>
            </div>
            <WarningDialog
                visibleState={isWarningDialogOpen}
                descriptionRef={warningDialogDescriptionRef}
                onConfirmFnRef={warningDialogOnConfirmFnRef}
                onDismissFnRef={warningDialogOnDismissFnRef}
            />
            <CredentialDialog
                showDialogFnRef={showCredentialsDialogRef}
                vaultMetadata={vaultMetadata}
                vault={vault}
                selected={selectedCredential}
            />
            <VaultSettingsDialog showDialogFnRef={showVaultSettingsDialogRef} />
            <FeatureVotingDialog showDialogFnRef={showFeatureVotingDialogRef} />
            <AccountSignUpSignInDialog
                showDialogFnRef={showAccountSignUpSignInDialogRef}
                vaultMetadata={vaultMetadata}
                vault={vault}
            />
        </>
    );
};

//#endregion Vault dashboard

const AppIndex: React.FC = () => {
    const vaults = useLiveQuery(() => VaultStorage.db.vaults.toArray());
    const unlockedVault = useAtomValue(unlockedVaultAtom);

    // TODO: Check for multiple rerenderings of this component
    // console.log("MAIN RERENDER", unlockedVault);

    // NOTE: To implement a loading screen, we can use the !vaults check

    const parsedVaults = vaults?.map((vault) => {
        return VaultMetadata.parseFromDatabase(vault);
    });

    return (
        <SessionProvider refetchWhenOffline={false} refetchInterval={60 * 60}>
            <HTMLHeaderPWA
                title="CryptexVault"
                description="Decentralized Identity Manager"
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

                <VaultDashboard vault={unlockedVault} />

                {
                    // If the vault is not unlocked, show the welcome screen
                    !unlockedVault && parsedVaults && (
                        <WelcomeScreen encryptedVaults={parsedVaults} />
                    )
                }
            </HTMLMain>
            <NotificationContainer
                position="bottom-right"
                pauseOnHover={false}
            />
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

// SSR on the whole app is not flexible enough for our use case
// export const getServerSideProps = async (ctx: {
//     res: NextApiResponse;
//     req: NextApiRequest;
// }) => {
//     const session = await getServerAuthSession({
//         req: ctx.req,
//         res: ctx.res,
//     });

//     return {
//         props: {
//             serversideSession: session,
//         },
//     };
// };
