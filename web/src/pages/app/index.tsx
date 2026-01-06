import React, {
    Suspense,
    useEffect,
    useRef,
    useState,
    type RefObject,
} from "react";

import {
    Disclosure,
    DisclosureButton,
    DisclosurePanel,
    Menu,
    MenuButton,
    MenuItem,
    MenuItems,
    Popover,
    PopoverButton,
    PopoverPanel,
    Transition,
} from "@headlessui/react";
import { zodResolver } from "@hookform/resolvers/zod";
import clsx from "clsx";
import { useAtom, useAtomValue, useSetAtom } from "jotai";
import * as OTPAuth from "otpauth";
import { Control, Controller, useForm, useWatch } from "react-hook-form";
import { toast } from "react-toastify";
import { z } from "zod";

import dayjs from "dayjs";
import RelativeTime from "dayjs/plugin/relativeTime";

import {
    ArrowTopRightOnSquareIcon,
    ArrowUpCircleIcon,
    Bars3Icon,
    CameraIcon,
    ChatBubbleBottomCenterTextIcon,
    CheckCircleIcon,
    ChevronDownIcon,
    ChevronUpIcon,
    ClockIcon,
    Cog8ToothIcon,
    DevicePhoneMobileIcon,
    DocumentTextIcon,
    EllipsisVerticalIcon,
    ExclamationCircleIcon,
    ExclamationTriangleIcon,
    FunnelIcon,
    GlobeAltIcon,
    InformationCircleIcon,
    KeyIcon,
    LinkIcon,
    LockClosedIcon,
    PlusCircleIcon,
    SpeakerWaveIcon,
    TableCellsIcon,
    WifiIcon,
    XCircleIcon,
    XMarkIcon,
} from "@heroicons/react/20/solid";

import { Turnstile } from "@marsidev/react-turnstile";

import { TRPCClientError } from "@trpc/client";
import {
    SignUpFormSchemaType,
    constructLinkPresenceChannelName,
    extractIDFromAPIKey,
    navigateToCheckout,
    openCustomerPortal,
    signUpFormSchema,
} from "../../app_lib/online-services";
import * as VaultUtilTypes from "../../app_lib/proto/vault";
import * as SynchronizationUtils from "../../app_lib/synchronization-utils";
import * as Synchronization from "../../app_lib/synchronization";
import { LinkedDevices, LinkedDevice } from "../../app_lib/vault-utils/vault";
import * as Storage from "../../app_lib/vault-utils/storage";
import * as Vault from "../../app_lib/vault-utils/vault";
import * as FormSchemas from "../../app_lib/vault-utils/form-schemas";
import * as VaultEncryption from "../../app_lib/vault-utils/encryption";
import { LinkingPackage } from "../../app_lib/vault-utils/linking";
import * as Import from "../../app_lib/vault-utils/import-export";
import * as Export from "../../app_lib/vault-utils/import-export";
import { ButtonFlat, ButtonType } from "../../components/general/buttons";
import {
    Body,
    Footer,
    GenericModal,
    Title,
} from "../../components/general/modal";
import NotificationContainer from "../../components/general/notification-container";
import HTMLHeader from "../../components/html-header";
import HTMLMain from "../../components/html-main";
import { trpc, trpcReact } from "../../utils/trpc";

import { autoPlacement, shift, useFloating } from "@floating-ui/react";
import dynamic from "next/dynamic";
import { useRouter } from "next/router";
import { Virtuoso } from "react-virtuoso";
import { CredentialsGeneratorDialog } from "../../components/dialog/credentials-generator";
import FeedbackDialog from "../../components/dialog/feedback-dialog";
import {
    ManualSynchronizationDialog,
    type ManualSyncShowDialogFnPropType,
} from "../../components/dialog/synchronization";
import { LogInspectorDialog } from "../../components/dialog/log-inspector";
import {
    WarningDialog,
    WarningDialogShowFn,
} from "../../components/dialog/warning";
import { AccordionItem } from "../../components/general/accordion";
import {
    ClipboardButton,
    FormBaseNumberInputField,
    FormInputCheckbox,
    FormInputField,
    FormNumberInputField,
    FormSelectboxField,
    FormTextAreaField,
} from "../../components/general/input-fields";
import Spinner from "../../components/general/spinner";
import NavBar from "../../components/navbar";
import {
    SynchronizationConfigurationDialog,
    SynchronizationServersSelectboxes,
} from "../../components/synchronization/sync-configuration";
import { env } from "../../env/client.mjs";
import { GetSubscriptionOutputSchemaType } from "../../schemes/payment_router";
import {
    OnlineServicesAuthenticationStatusHelpers,
    clearOnlineServicesAPIKey,
    isVaultUnlockedAtom,
    linkedDevicesAtom,
    onlineServicesAuthConnectionStatusAtom,
    onlineServicesBoundAtom,
    onlineServicesDataAtom,
    onlineServicesStore,
    setOnlineServicesAPIKey,
    unlockedVaultAtom,
    unlockedVaultMetadataAtom,
    unlockedVaultWriteOnlyAtom,
    vaultCredentialsAtom,
    vaultGet,
} from "../../utils/atoms";
import { vaultLogger } from "../../utils/logging";
import {
    DIALOG_BLUR_TIME,
    enumToRecord,
    ONLINE_SERVICES_SELECTION_ID,
    TOTPConstants,
    CredentialConstants,
    LINK_FILE_EXTENSION,
    BACKUP_FILE_EXTENSION,
} from "../../utils/consts";
import VaultManager from "@/components/vault-manager/layout";
import { err, ok } from "neverthrow";
import { Calendar, CircleCheck, CircleX, Link } from "lucide-react";
import { ChangelogDialog } from "@/components/changelog";

dayjs.extend(RelativeTime);

// Global sync connection controller will be created in the component
let GlobalSyncConnectionController: Synchronization.SyncConnectionController;

// Vault operations implementation using atoms
const createVaultOperations = (setUnlockedVault: (vault: Vault.Vault | ((prev: Vault.Vault) => Vault.Vault)) => void, vaultMetadata: Storage.VaultMetadata | null): Synchronization.VaultOperations => {
    return {
        getVault: () => vaultGet(),
        getCredentials: () => vaultGet().Credentials,
        updateCredentials: (credentials) => {
            // Update credentials directly using the vault atom
            const currentVault = vaultGet();
            currentVault.Credentials = credentials;
            setUnlockedVault(currentVault);
        },
        updateDiffs: (diffs) => {
            // Update diffs directly using the vault atom
            const currentVault = vaultGet();
            currentVault.Diffs = diffs;
            setUnlockedVault(currentVault);
        },
        saveVault: async (vault) => {
            if (vaultMetadata) {
                await vaultMetadata.save(vault);
            }
        },
        getSynchronizationConfig: () => {
            return vaultGet().LinkedDevices;
        },
    };
};

// Create sync connection controller with vault operations
const createSyncConnectionController = (setUnlockedVault: (vault: Vault.Vault | ((prev: Vault.Vault) => Vault.Vault)) => void, vaultMetadata: Storage.VaultMetadata | null) => {
    return new Synchronization.SyncConnectionController(createVaultOperations(setUnlockedVault, vaultMetadata));
};

const useClearOnlineServicesDataAtom = () => {
    const setOnlineServicesData = useSetAtom(onlineServicesDataAtom);
    const setOnlineServicesConnectionStatus = useSetAtom(
        onlineServicesAuthConnectionStatusAtom,
    );
    return () => {
        setOnlineServicesData(null);
        setOnlineServicesConnectionStatus(() =>
            OnlineServicesAuthenticationStatusHelpers.setDisconnected(),
        );
    };
};

const useFetchOnlineServicesData = () => {
    const setOnlineServicesRemoteUserData = useSetAtom(onlineServicesDataAtom);
    const setOnlineServicesConnectionStatus = useSetAtom(
        onlineServicesAuthConnectionStatusAtom,
    );

    return async () => {
        setOnlineServicesConnectionStatus(() =>
            OnlineServicesAuthenticationStatusHelpers.setConnecting(),
        );
        try {
            const config = await trpc.v1.user.configuration.query();

            const osData = onlineServicesStore.get(onlineServicesDataAtom);
            if (!osData || !osData.key.length) {
                console.error(
                    "Tried to fetch online services data, but the API key was invalid.",
                );

                setOnlineServicesConnectionStatus(() =>
                    OnlineServicesAuthenticationStatusHelpers.setFailed(
                        "Malformed API key.",
                    ),
                );

                return;
            }

            // console.warn("Fetched Online Services data.", osData, config);
            setOnlineServicesRemoteUserData({
                key: osData.key, // Same key, but this one is of correct type (not null)
                remoteData: config,
            });

            setOnlineServicesConnectionStatus(() =>
                OnlineServicesAuthenticationStatusHelpers.setConnected(),
            );
        } catch (e) {
            console.error("Error refreshing online services data.", e);

            if (e instanceof TRPCClientError) {
                if (e.data?.code === "E_UNAUTHORIZED") {
                    setOnlineServicesConnectionStatus(() =>
                        OnlineServicesAuthenticationStatusHelpers.setFailed(
                            "Authorization failed",
                        ),
                    );
                } else {
                    setOnlineServicesConnectionStatus(() =>
                        OnlineServicesAuthenticationStatusHelpers.setFailed(
                            "Failed to connect.",
                        ),
                    );
                }
            } else {
                setOnlineServicesConnectionStatus(() =>
                    OnlineServicesAuthenticationStatusHelpers.setFailed(
                        "Could not connect.",
                    ),
                );
            }
        }
    };
};

const useUnbindOnlineServices = () => {
    const clearOnlineServicesData = useClearOnlineServicesDataAtom();

    return async (vaultMetadata: Storage.VaultMetadata, vault: Vault.Vault) => {
        clearOnlineServicesAPIKey();

        LinkedDevices.unbindAccount(vault.LinkedDevices);

        await vaultMetadata.save(vault);

        clearOnlineServicesData();
    };
};

// Function for opening the browsers file picker
const openFilePicker = async (
    inputRef: React.RefObject<HTMLInputElement | null>,
) => {
    if (!inputRef.current) {
        console.warn("File input not found.");
        return;
    }

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

enum LinkMethod {
    QRCode = "QR Code",
    Sound = "Sound",
    File = "File",
}

type Options = {
    Name: string;
    onClick: () => void;
};

const EncryptionFormGroup: React.FC<{
    handleSubmitFn: React.RefObject<
        (
            onValid: (data: FormSchemas.EncryptionFormGroupSchemaType) => void,
        ) => () => Promise<void>
    >;
    defaultValues?: FormSchemas.EncryptionFormGroupSchemaType;
    resetFormFn?: React.RefObject<() => void>;
    isDirtyFn?: React.RefObject<() => boolean>;
    onEnterKeyPressFnRef?: React.RefObject<() => void>;
    credentialsGeneratorFnRef?: React.RefObject<() => void>;
    showSecretHelpText?: boolean;
}> = ({
    handleSubmitFn,
    defaultValues,
    resetFormFn,
    isDirtyFn,
    onEnterKeyPressFnRef,
    credentialsGeneratorFnRef,
    showSecretHelpText = false,
}) => {
    const {
        handleSubmit,
        register,
        formState: { errors, isDirty },
        reset: resetForm,
        watch,
        setFocus,
    } = useForm<FormSchemas.EncryptionFormGroupSchemaType>({
        resolver: zodResolver(FormSchemas.encryptionFormGroupSchema),
        defaultValues: defaultValues ?? {
            Secret: "",
            Encryption: VaultUtilTypes.EncryptionAlgorithm.XChaCha20Poly1305,
            EncryptionKeyDerivationFunction:
                VaultUtilTypes.KeyDerivationFunction.Argon2ID,
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

    handleSubmitFn.current = handleSubmit;

    if (resetFormFn) {
        resetFormFn.current = resetForm;
    }

    if (isDirtyFn) {
        isDirtyFn.current = () => isDirty;
    }

    useEffect(() => {
        setFocus("Secret");
    }, []);

    return (
        <>
            <div className="mt-4 flex flex-col">
                <FormInputField
                    label="Secret *"
                    type="password"
                    onKeyDown={
                        onEnterKeyPressFnRef
                            ? (e) => {
                                  if (e.key === "Enter") {
                                      onEnterKeyPressFnRef.current();
                                  }
                              }
                            : undefined
                    }
                    placeholder={
                        showSecretHelpText
                            ? "E.g. My super secr3t p4ssphrase"
                            : undefined
                    }
                    autoCapitalize="none"
                    credentialsGeneratorFnRef={credentialsGeneratorFnRef}
                    value={undefined}
                    register={register("Secret")}
                />
                {errors.Secret && (
                    <p className="text-red-500">{errors.Secret.message}</p>
                )}
                {showSecretHelpText && (
                    <p className="mt-2 text-sm text-gray-600">
                        This is the secret that you will use to unlock your
                        vault.
                    </p>
                )}
            </div>
            <div className="mt-4">
                <AccordionItem
                    title="Advanced"
                    buttonClassName="bg-gray-500"
                    innerClassName={"bg-slate-100 rounded-b-md px-2 py-1"}
                >
                    <div className="flex flex-col">
                        <>
                            <label className="text-gray-600">
                                Encryption Algorithm *
                            </label>
                            <FormSelectboxField
                                optionsEnum={enumToRecord(
                                    VaultUtilTypes.EncryptionAlgorithm,
                                )}
                                register={register("Encryption", {
                                    valueAsNumber: true,
                                })}
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
                        {errors.Encryption && (
                            <p className="text-red-500">
                                {errors.Encryption.message}
                            </p>
                        )}
                    </div>
                    <div className="mt-4 flex flex-col">
                        <>
                            <label className="text-gray-600">
                                Encryption Key Derivation Function *
                            </label>
                            <FormSelectboxField
                                optionsEnum={enumToRecord(
                                    VaultUtilTypes.KeyDerivationFunction,
                                )}
                                register={register(
                                    "EncryptionKeyDerivationFunction",
                                    {
                                        valueAsNumber: true,
                                    },
                                )}
                            />
                        </>
                        {errors.EncryptionKeyDerivationFunction && (
                            <p className="text-red-500">
                                {errors.EncryptionKeyDerivationFunction.message}
                            </p>
                        )}
                    </div>

                    {/* Depending on which encryption method is chosen switch between different options */}
                    {/* Argon2ID options */}
                    <div
                        className={clsx({
                            hidden:
                                watch(
                                    "EncryptionKeyDerivationFunction",
                                ).toString() !==
                                VaultUtilTypes.KeyDerivationFunction.Argon2ID.toString(),
                        })}
                    >
                        <div className="mt-4 flex flex-col">
                            <FormBaseNumberInputField
                                label="Memory Limit"
                                valueLabel="MiB"
                                min={
                                    VaultEncryption.KeyDerivationConfig_Argon2ID
                                        .MIN_MEM_LIMIT
                                }
                                register={register("EncryptionConfig.memLimit")}
                            />
                            {errors.EncryptionConfig?.memLimit && (
                                <p className="text-red-500">
                                    {errors.EncryptionConfig?.memLimit.message}
                                </p>
                            )}
                        </div>
                        <div className="mt-4 flex flex-col">
                            <FormBaseNumberInputField
                                label="Operations Limit"
                                min={
                                    VaultEncryption.KeyDerivationConfig_Argon2ID
                                        .MIN_OPS_LIMIT
                                }
                                max={
                                    VaultEncryption.KeyDerivationConfig_Argon2ID
                                        .MAX_OPS_LIMIT
                                }
                                register={register("EncryptionConfig.opsLimit")}
                            />
                            {errors.EncryptionConfig?.opsLimit && (
                                <p className="text-red-500">
                                    {errors.EncryptionConfig?.opsLimit.message}
                                </p>
                            )}
                        </div>
                    </div>

                    {/* PBKDF2 options */}
                    <div
                        className={clsx({
                            hidden:
                                watch(
                                    "EncryptionKeyDerivationFunction",
                                ).toString() !==
                                VaultUtilTypes.KeyDerivationFunction.PBKDF2.toString(),
                        })}
                    >
                        <div className="mt-4 flex flex-col">
                            <FormBaseNumberInputField
                                label="Iterations"
                                min={1}
                                register={register(
                                    "EncryptionConfig.iterations",
                                )}
                            />
                            {errors.EncryptionConfig?.iterations && (
                                <p className="text-red-500">
                                    {
                                        errors.EncryptionConfig?.iterations
                                            .message
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
        </>
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
            "mb-2 flex flex-col items-center gap-1 rounded-md bg-gray-200 px-4 py-2 transition-colors": true,
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

const FeatureVotingDialog: React.FC<{
    showDialogFnRef: React.RefObject<(() => void) | null>;
}> = ({ showDialogFnRef }) => {
    const [visibleState, setVisibleState] = useState(false);
    const hideModal = () => setVisibleState(false);
    showDialogFnRef.current = () => setVisibleState(true);

    const onlineServicesBound = useAtomValue(onlineServicesBoundAtom);
    const onlineServicesData = useAtomValue(onlineServicesDataAtom);

    // Get the featureVoting.rounds trpc query if the user is logged in
    const {
        data: featureVotingRounds,
        isLoading: isLoadingRounds,
        refetch: refetchRounds,
        // remove: removeRoundsData,
    } = trpcReact.v1.featureVoting.rounds.useQuery(undefined, {
        retryDelay: 10000,
        enabled:
            onlineServicesBound &&
            !!onlineServicesData?.remoteData &&
            visibleState,
        refetchOnWindowFocus: false,
    });

    const numberOfOpenRounds =
        featureVotingRounds?.rounds.filter((i) => i.active).length ?? 0;

    // A mutation for featureVoting.placeVote
    const { mutate: placeVote, isPending: isPlacingVoteInProgress } =
        trpcReact.v1.featureVoting.placeVote.useMutation({
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
            },
        );
    };

    useEffect(() => {
        // Make sure we can refetch the rounds data if onlineServices object changes
        // if (!onlineServicesBound) {
        //     removeRoundsData();
        // }
    }, [onlineServicesBound]);

    return (
        <GenericModal
            key="feature-voting-modal"
            visibleState={[visibleState, setVisibleState]}
            childrenTitle={<Title>Feature Voting</Title>}
        >
            <Body>
                <div className="flex flex-col items-center text-center">
                    <div className="flex w-full flex-col items-center text-left">
                        {
                            // If the user is not logged in, tell them to log in
                            !onlineServicesBound && (
                                <p className="text-center text-base text-gray-600">
                                    You need to be logged in to online services
                                    in order to view and vote on features.
                                </p>
                            )
                        }

                        {/* Show a call to action message if there are rounds and incorrectTier boolean flag is true */}
                        {onlineServicesBound &&
                            featureVotingRounds?.incorrectTier && (
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
                            onlineServicesBound && numberOfOpenRounds === 0 && (
                                <p className="line-clamp-2 text-left text-base text-gray-600">
                                    There are currently no voting rounds open.
                                </p>
                            )
                        }
                        {
                            // If the user is logged in, and there are open rounds, show the open rounds
                            onlineServicesBound && numberOfOpenRounds > 0 && (
                                <p className="line-clamp-2 text-left text-base text-gray-600">
                                    There is currently a voting round open.
                                </p>
                            )
                        }
                    </div>
                    <div className="flex w-full flex-col text-left">
                        {/* Map the feature voting rounds if the loading is done, show a loading indicator otherwise */}
                        {!isLoadingRounds && featureVotingRounds && (
                            <div className="mt-2 flex flex-col">
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
                                                            "flex flex-col p-4 sm:justify-between": true,
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
                                                                                item.id,
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
                                    ),
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
    showDialogFnRef: React.RefObject<() => void>;
    showWarningDialogFn: WarningDialogShowFn;
    showRecoveryGenerationDialogFnRef: React.RefObject<(() => void) | null>;
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

    const [ongoingOperation, setOngoingOperation] = useState(false);

    const vaultMetadata = useAtomValue(unlockedVaultMetadataAtom);
    const unlockedVault = useAtomValue(unlockedVaultAtom);
    const onlineServicesBound = LinkedDevices.isBound(
        unlockedVault.LinkedDevices,
    );
    const onlineServicesData = useAtomValue(onlineServicesDataAtom);
    const unbindOnlineServices = useUnbindOnlineServices();

    // Prepare the user deletion trpc call
    const { mutateAsync: deleteUser } = trpcReact.v1.user.delete.useMutation();

    const {
        data: linkedDevices,
        refetch: refetchRegisteredDevices,
        isFetching: fetchingLinkedDevices,
    } = trpcReact.v1.device.linked.useQuery(undefined, {
        refetchOnWindowFocus: false,
        enabled:
            onlineServicesBound &&
            !!onlineServicesData?.remoteData?.root &&
            isVisible,
    });

    const deleteUserAccount = async () => {
        if (!vaultMetadata) return;

        showWarningDialogFn(
            "You are about to permanently delete your online services account. This will prevent you from accessing online services until you create a new account. This will not affect your vault data.",
            async () => {
                setOngoingOperation(true);

                try {
                    await deleteUser();
                    await unbindOnlineServices(vaultMetadata, unlockedVault);

                    toast.success("User account deleted.");

                    setIsVisible(false);
                } catch (err) {
                    toast.error(
                        "An error occured while deleting your user account. Please try again later.",
                    );
                    console.error(err);
                }

                setOngoingOperation(false);
            },
            null,
        );
    };

    const Account: React.FC = () => {
        const fetchOnlineServicesData = useFetchOnlineServicesData();

        const {
            mutateAsync: _clearRecoveryPhrase,
            isPending: isClearingRecoveryPhrase,
        } = trpcReact.v1.user.clearRecoveryToken.useMutation();

        const clearRecoveryPhrase = async () => {
            showWarningDialogFn(
                "You are about to clear your recovery phrase. This will make it impossible to recover your online services account using the existing recovery phrase, if you lose access to your vault.",
                async () => {
                    setOngoingOperation(true);

                    try {
                        await _clearRecoveryPhrase();

                        toast.success("Recovery phrase cleared.");

                        // Refresh the remote user data
                        await fetchOnlineServicesData();
                    } catch (error) {
                        if (error instanceof TRPCClientError) {
                            console.error(error.message);
                        } else {
                            console.error(
                                "Error clearing recovery phrase:",
                                error,
                            );
                        }
                        toast.error(
                            "Error clearing recovery phrase. Please try again later.",
                        );
                    }

                    setOngoingOperation(false);
                },
                null,
            );
        };

        const generateRecoveryPhrase = async () =>
            showRecoveryGenerationDialogFnRef.current?.();

        return (
            <>
                <div className="flex flex-col">
                    <div className="flex items-center gap-1">
                        <p className="text-left text-base text-gray-600">
                            Recovery Phrase:
                        </p>
                        {onlineServicesData?.remoteData
                            ?.recoveryTokenCreatedAt ? (
                            <p className="text-green-500">Backed up</p>
                        ) : (
                            <p className="text-red-500">Not Backed up</p>
                        )}
                    </div>
                    {onlineServicesData?.remoteData?.recoveryTokenCreatedAt && (
                        <p className="text-left text-base text-gray-600">
                            Date of backup:{" "}
                            {new Date(
                                onlineServicesData?.remoteData?.recoveryTokenCreatedAt,
                            ).toLocaleDateString()}
                        </p>
                    )}
                </div>
                {!onlineServicesData?.remoteData?.recoveryTokenCreatedAt && (
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
                {!onlineServicesData?.remoteData?.root && (
                    <div className="mt-2 flex flex-col">
                        <p className="text-left text-base text-gray-600">
                            Use the root device to generate a recovery phrase.
                        </p>
                    </div>
                )}
                {onlineServicesData?.remoteData?.recoveryTokenCreatedAt &&
                    onlineServicesData?.remoteData?.root && (
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
                {!onlineServicesData?.remoteData?.recoveryTokenCreatedAt &&
                    onlineServicesData?.remoteData?.root && (
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
        const [isCustomerPortalLoading, setIsCustomerPortalLoading] =
            useState(false);

        const _openCustomerPortal = async () => {
            if (!(subscriptionData && subscriptionData.nonFree)) return;

            setIsCustomerPortalLoading(true);

            try {
                await openCustomerPortal();
            } catch (error) {
                console.error("Error opening customer portal.", error);
                toast.error(
                    "Error opening customer portal. Please try again later.",
                );
            } finally {
                setIsCustomerPortalLoading(false);
            }
        };

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
            <div className="flex max-w-md flex-col rounded-md border-slate-500 p-5 text-slate-600">
                <p className="text-2xl font-medium text-slate-800">
                    {subscriptionData.productName}
                </p>
                <div className="mt-2 space-y-2 p-2">
                    <div className="flex items-center space-x-2">
                        <Calendar className="mr-2 inline-block h-5 w-5" />
                        <p>Started on</p>
                        <p className="text-slate-700">
                            {subscriptionData.createdAt?.toLocaleDateString()}
                        </p>
                    </div>
                    {subscriptionData.expiresAt && (
                        <div className="flex items-center space-x-2">
                            <ClockIcon className="mr-2 inline-block h-5 w-5" />
                            <p>
                                {subscriptionData.cancelAtPeriodEnd
                                    ? "Expires on"
                                    : "Next billing"}
                            </p>
                            <p className="text-slate-700">
                                {subscriptionData.expiresAt?.toLocaleDateString()}
                            </p>
                        </div>
                    )}
                    <div className="flex items-center space-x-2">
                        {onlineServicesData?.remoteData &&
                            onlineServicesData.remoteData.canLink && (
                                <div className="text-green-500">
                                    <CircleCheck className="mr-2 inline-block h-5 w-5" />
                                </div>
                            )}

                        {onlineServicesData?.remoteData &&
                            !onlineServicesData.remoteData.canLink && (
                                <div className="text-red-500">
                                    <CircleX className="mr-2 inline-block h-5 w-5" />
                                </div>
                            )}
                        <p>
                            Access to Online Services - zero hassle
                            synchronization
                        </p>
                    </div>
                    {onlineServicesData?.remoteData &&
                        onlineServicesData.remoteData.canLink && (
                            <div className="flex items-center space-x-2">
                                <Link className="mr-2 inline-block h-5 w-5" />
                                <p className="text-slate-700">
                                    {
                                        subscriptionData.resourceStatus
                                            .linkedDevices
                                    }{" "}
                                </p>
                                <p>of </p>
                                <p className="text-slate-700">
                                    {
                                        onlineServicesData.remoteData.maxLinks
                                    }{" "}
                                </p>
                                <p>linked devices</p>
                            </div>
                        )}
                    <div className="flex items-center space-x-2">
                        <div className="text-green-500">
                            <CircleCheck className="mr-2 inline-block h-5 w-5" />
                        </div>
                        <p>Unlimited credentials per vault</p>
                    </div>
                    <div className="flex items-center space-x-2">
                        <div className="text-green-500">
                            <CircleCheck className="mr-2 inline-block h-5 w-5" />
                        </div>
                        <p>Unlimited secure vaults</p>
                    </div>
                    <div className="flex items-center space-x-2">
                        <div className="text-green-500">
                            <CircleCheck className="mr-2 inline-block h-5 w-5" />
                        </div>
                        <p>Create encrypted backups</p>
                    </div>
                    {/* {subscriptionData.nonFree &&
                        subscriptionData.configuration?.automated_backups && (
                            <div className="flex items-center space-x-2">
                                <ArrowUturnUpIcon className="mr-2 inline-block h-5 w-5" />
                                <p>Automated encrypted backups</p>
                            </div>
                        )} */}
                    <div className="flex items-center space-x-2">
                        {onlineServicesData?.remoteData?.canFeatureVote && (
                            <div className="text-green-500">
                                <CircleCheck className="mr-2 inline-block h-5 w-5" />
                            </div>
                        )}

                        {!onlineServicesData?.remoteData?.canFeatureVote && (
                            <div className="text-red-500">
                                <CircleX className="mr-2 inline-block h-5 w-5" />
                            </div>
                        )}
                        <p>Feature voting</p>
                    </div>
                    {/* {subscriptionData.nonFree &&
                        subscriptionData.configuration
                            ?.credentialsBorrowing && (
                            <div className="flex items-center space-x-2">
                                <ShareIcon className="mr-2 inline-block h-5 w-5" />
                                <p>Credentials borrowing</p>
                            </div>
                        )} */}
                </div>
                <div className="mt-2 flex flex-col">
                    {subscriptionData.nonFree ? (
                        <ButtonFlat
                            text="Manage Subscription"
                            loading={isCustomerPortalLoading}
                            onClick={_openCustomerPortal}
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
        const { mutateAsync: removeDevice } =
            trpcReact.v1.device.remove.useMutation();

        const { mutateAsync: _setRoot } =
            trpcReact.v1.device.setRoot.useMutation();

        const setRoot = (id: string, currentStatus: boolean) => {
            const message = currentStatus
                ? "Do you really want to demote the selected device from root device? This will prevent the device from managing registered devices and account settings."
                : "Do you really want to promote the selected device to root device? This will allow the device to manage registered devices and account settings.";

            showWarningDialogFn(
                message,
                async () => {
                    setOngoingOperation(true);

                    try {
                        await _setRoot({
                            id,
                            root: !currentStatus,
                        });
                        refetchRegisteredDevices();
                    } catch (error) {
                        console.error(
                            "Error while setting device status.",
                            error,
                        );
                        toast.error(
                            "Failure while setting device Root status.",
                        );
                    }

                    setOngoingOperation(false);
                },
                null,
            );
        };

        const tempRmFn = (id: string) => {
            showWarningDialogFn(
                "Do you really want to remove the selected device? This will prevent the device from accessing the online services.",
                async () => {
                    setOngoingOperation(true);

                    try {
                        await removeDevice({
                            id,
                        });
                        refetchRegisteredDevices();
                    } catch (error) {
                        console.error("Error unlinking device.", error);
                        toast.error("Error unlinking device.");
                    }

                    setOngoingOperation(false);
                },
                null,
            );
        };

        if (!linkedDevices && onlineServicesData?.remoteData?.root) {
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
        } else if (!linkedDevices && !onlineServicesData?.remoteData?.root) {
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

        if (!onlineServicesData?.remoteData?.canLink) {
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

        if (!linkedDevices?.length) {
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

        return (
            <div className="overflow-auto">
                <p className="mt-2 text-lg">
                    Currently Registered ({linkedDevices.length - 1} /{" "}
                    {onlineServicesData?.remoteData?.maxLinks})
                </p>
                <div className="mt-2 flex max-h-52 flex-col gap-2 overflow-y-auto overflow-x-clip">
                    {linkedDevices?.map((device) => {
                        const resolvedDeviceName =
                            unlockedVault.LinkedDevices.Devices.find(
                                (d) => d.ID === device.id,
                            )?.Name;
                        const isCurrentDevice =
                            device.id === unlockedVault.LinkedDevices.ID;

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
                                            {device.createdAt
                                                ? new Date(
                                                      device.createdAt,
                                                  ).toLocaleString()
                                                : "Unknown"}
                                        </p>
                                        <div className="flex items-center space-x-2">
                                            <p
                                                title={
                                                    device.root
                                                        ? "Device can manage registered devices and account settings."
                                                        : "Device cannot manage registered devices and account settings."
                                                }
                                            >
                                                <ButtonFlat
                                                    text={
                                                        device.root
                                                            ? "Demote"
                                                            : "Promote"
                                                    }
                                                    type={ButtonType.Tertiary}
                                                    onClick={() =>
                                                        setRoot(
                                                            device.id,
                                                            device.root,
                                                        )
                                                    }
                                                    disabled={
                                                        ongoingOperation ||
                                                        isCurrentDevice
                                                    }
                                                ></ButtonFlat>
                                            </p>
                                        </div>
                                    </div>
                                </div>
                                {/* <div className="mt-2 flex items-center space-x-2">
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
                                </div> */}
                                <div
                                    className={clsx({
                                        "mt-2 flex justify-start space-x-2": true,
                                        hidden: isCurrentDevice,
                                    })}
                                >
                                    <ButtonFlat
                                        text="Remove"
                                        type={ButtonType.Tertiary}
                                        onClick={() => tempRmFn(device.id)}
                                        disabled={
                                            ongoingOperation || isCurrentDevice
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
            key="online-services-modal"
            visibleState={[isVisible, setIsVisible]}
            childrenTitle={<Title>Online Services</Title>}
        >
            <Body>
                <div className="flex flex-col items-center text-center">
                    {hasDataLoadingError && (
                        <div className="flex w-full flex-col items-center text-left">
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
                        <div className="flex w-full flex-col text-left">
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
                                <div className="flex items-center justify-between">
                                    <p className="text-lg font-bold text-slate-800">
                                        Registered Devices
                                    </p>

                                    <div>
                                        <ButtonFlat
                                            type={ButtonType.Secondary}
                                            text="Refresh"
                                            onClick={async () =>
                                                await refetchRegisteredDevices()
                                            }
                                            loading={fetchingLinkedDevices}
                                            disabled={
                                                ongoingOperation ||
                                                !onlineServicesData?.remoteData
                                                    ?.root
                                            }
                                        ></ButtonFlat>
                                    </div>
                                </div>
                                <RegisteredDevices />
                            </div>

                            <div className="mt-4 rounded-lg bg-gray-100 p-4">
                                <p className="text-lg font-bold text-slate-800">
                                    General
                                </p>
                                <div className="mt-2 flex flex-col">
                                    {!onlineServicesData?.remoteData?.root && (
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
                                            !onlineServicesData?.remoteData
                                                ?.root
                                        }
                                    ></ButtonFlat>
                                </div>
                            </div>

                            {/* Overlay that is active if the session is null */}
                            <div
                                className={clsx({
                                    "absolute inset-0 items-center justify-center backdrop-blur-sm": true,
                                    flex: !onlineServicesBound,
                                    hidden: onlineServicesBound,
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
    showDialogFnRef: React.RefObject<(() => void) | null>;
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

    const [showRecoveryPhrase, setShowRecoveryPhrase] = useState(false);
    const [userId, setUserId] = useState<string>("");
    const [recoveryPhrase, setRecoveryPhrase] = useState<string>("");

    const refreshOnlineServicesRemoteUserData = useFetchOnlineServicesData();

    const {
        mutateAsync: _generateRecoveryPhrase,
        isPending: isGeneratingRecoveryPhrase,
    } = trpcReact.v1.user.generateRecoveryToken.useMutation();

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

            // Refresh the remote user data
            await refreshOnlineServicesRemoteUserData();
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
                },
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
    showRecoveryGenerationDialogFnRef: React.RefObject<(() => void) | null>;
}> = ({
    showAccountSignUpSignInDialog,
    showWarningDialogFn,
    showRecoveryGenerationDialogFnRef,
}) => {
    const unlockedVaultMetadata = useAtomValue(unlockedVaultMetadataAtom);
    const unlockedVault = useAtomValue(unlockedVaultAtom);
    const onlineServicesBound = LinkedDevices.isBound(
        unlockedVault.LinkedDevices,
    );
    const onlineServicesData = useAtomValue(onlineServicesDataAtom);
    const onlineServicesAuthConnectionStatus = useAtomValue(
        onlineServicesAuthConnectionStatusAtom,
    );
    const unbindOnlineServices = useUnbindOnlineServices();

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
    } = trpcReact.v1.payment.subscription.useQuery(undefined, {
        refetchOnWindowFocus: true,
        staleTime: 60 * 1000,
        enabled:
            !!unlockedVault &&
            LinkedDevices.isBound(unlockedVault.LinkedDevices) &&
            !!onlineServicesData?.remoteData,
    });

    const signOutCallback = () => {
        if (!unlockedVaultMetadata || !unlockedVault) return;

        showWarningDialogFn(
            `You are about to sign out and lose access to online services. This will unbind the account from your vault. \
            Make sure you have generated a account recovery phrase in the Account dialog. \
            You can use that recovery phrase to regain access to your account after signing out.`,
            async () =>
                await unbindOnlineServices(
                    unlockedVaultMetadata,
                    unlockedVault,
                ),
            null,
        );
    };

    return (
        <>
            <Popover className="relative">
                {({ open }) => {
                    const popoverButtonClasses = clsx({
                        "text-opacity-90": open,
                        "group flex items-center justify-center rounded-md text-base font-medium text-white hover:text-opacity-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-opacity-75": true,
                    });
                    return (
                        <>
                            <PopoverButton
                                ref={refs.setReference}
                                className={popoverButtonClasses}
                                onClick={
                                    !onlineServicesBound
                                        ? showAccountSignUpSignInDialog
                                        : undefined
                                }
                            >
                                <div className="flex cursor-pointer items-center gap-2 rounded-lg p-1 px-2 transition-colors hover:bg-slate-800">
                                    <div className="flex flex-col text-left">
                                        <p className="max-w-[200px] truncate capitalize text-slate-50">
                                            Online Services
                                        </p>
                                        <p
                                            className="max-w-xs text-left text-slate-400"
                                            title={
                                                onlineServicesAuthConnectionStatus.statusDescription
                                            }
                                        >
                                            {
                                                onlineServicesAuthConnectionStatus.statusDescription
                                            }
                                        </p>
                                    </div>
                                    <div
                                        className={clsx({
                                            "flex items-center justify-center rounded-md border border-slate-500 px-3 py-3 text-sm": true,
                                            "text-slate-500 shadow-md shadow-slate-500":
                                                !onlineServicesBound &&
                                                onlineServicesAuthConnectionStatus.status ===
                                                    "DISCONNECTED",
                                            "text-yellow-500 shadow-md shadow-yellow-500":
                                                onlineServicesBound &&
                                                onlineServicesAuthConnectionStatus.status ===
                                                    "CONNECTING",
                                            "text-green-500 shadow-md shadow-green-500":
                                                onlineServicesBound &&
                                                onlineServicesAuthConnectionStatus.status ===
                                                    "CONNECTED",
                                            "text-red-500 shadow-md shadow-red-500":
                                                (onlineServicesBound &&
                                                    onlineServicesAuthConnectionStatus.status ===
                                                        "DISCONNECTED") ||
                                                onlineServicesAuthConnectionStatus.status ===
                                                    "FAILED",
                                        })}
                                    >
                                        <WifiIcon className="h-5 w-5 text-inherit" />
                                    </div>
                                </div>
                            </PopoverButton>
                            <Transition
                                // as={Fragment}
                                enter="transition ease-out duration-200"
                                enterFrom="opacity-0 translate-y-1"
                                enterTo="opacity-100 translate-y-0"
                                leave="transition ease-in duration-150"
                                leaveFrom="opacity-100 translate-y-0"
                                leaveTo="opacity-0 translate-y-1"
                            >
                                <PopoverPanel
                                    ref={refs.setFloating}
                                    style={floatingStyles}
                                    className="z-10 w-[200px] max-w-md px-4 sm:px-0"
                                >
                                    <div className="divide-y divide-slate-800/60 overflow-hidden rounded-lg shadow-lg ring-1 ring-black ring-opacity-5">
                                        <div
                                            className={clsx({
                                                "flex-col gap-4 bg-slate-700 p-4": true,
                                                flex: onlineServicesBound,
                                                hidden:
                                                    !onlineServicesBound ||
                                                    onlineServicesAuthConnectionStatus.status !==
                                                        "CONNECTED",
                                            })}
                                        >
                                            {/* Display the pill for the users tier */}
                                            <div
                                                className={clsx({
                                                    "flex items-center gap-4 rounded-sm": true,
                                                    "opacity-50":
                                                        isSubscriptionDataLoading,
                                                })}
                                            >
                                                <p className="text-sm font-semibold">
                                                    Current Tier
                                                </p>
                                                <p className="rounded-lg border border-slate-500 px-2 py-1 text-xs text-slate-50">
                                                    {
                                                        subscriptionData?.productName
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
                                                onClick={signOutCallback}
                                            />
                                        </div>
                                    </div>
                                </PopoverPanel>
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
    showDialogFnRef: React.RefObject<() => void>;
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
    const credentialsToImportRef = useRef<Vault.CredentialFormSchemaType[]>([]);

    // CSV import
    const fileInputRef = useRef<HTMLInputElement>(null);
    const columnMatchingFormRef = useRef<HTMLFormElement>(null);
    const parsedColumns = useRef<string[]>([]);

    const importCredentials = async (
        credentials: VaultUtilTypes.PartialCredential[],
        groups: FormSchemas.GroupSchemaType[] = [],
    ) => {
        // Add the credentials to the vault
        const vault = unlockedVault;

        if (!vault) {
            console.error("No vault to import into.");
            return;
        }

        groups.forEach((group) => {
            const existingGroup =
                vault.Groups.find((g) => g.ID == group.ID) ?? null;
            const gropInst = Vault.upsertGroup(existingGroup, group);
            vault.Groups.push(gropInst);
        });
        for (const credential of credentials) {
            const data = await Vault.createCredential(credential);

            vault.Credentials.push(data.credential);
            const listHash = await Vault.hashCredentials(vault.Credentials);
            const diff: VaultUtilTypes.Diff = {
                Hash: listHash,
                Changes: data.changes,
            };
            vault.Diffs.push(diff);
        }
        unlockedVaultMetadata?.save(vault);

        setUnlockedVault(async () => vault);

        toast.success(
            `Successfully imported ${credentials.length} credentials.`,
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

        if (!fileData) return;

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
                    "Failed to extract column names from CSV file. More details in the console.",
                );
            },
        );
    };

    const submitGenericCSVImport = async (
        formData: Import.FieldsSchemaType,
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
                        "Failed to import CSV file. More details in the console.",
                    );
                    setIsOperationInProgress(false);
                },
            );
        } catch (error) {
            console.error(
                "Fatal error while parsing the provided CSV file",
                error,
            );
            toast.error(
                "Failed to parse CSV file. More details in the console.",
            );
        }
    };

    const parseBitwardenExport = async () => {
        // Bring up the file picker
        const fileData = await openFilePicker(fileInputRef);

        if (!fileData) return;

        selectedFileRef.current = fileData;

        setIsOperationInProgress(true);

        try {
            const { credentials, groups } =
                await Import.BitwardenJSON(fileData);

            if (credentials.length) {
                await importCredentials(credentials, groups);
            } else {
                toast.warn("Bitwarden export file doesn't contain any data.");
            }
        } catch (error) {
            console.error("Error importing Bitwarden JSON file", error);
            toast.error(
                "Failed to import Bitwarden JSON file. More details in the console.",
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
                                    ),
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

const ChangeVaultEncryptionConfigDialog: React.FC<{
    showDialogFnRef: React.RefObject<() => void>;
    showCredentialsGeneratorDialogFnRef: React.RefObject<() => void>;
}> = ({ showDialogFnRef, showCredentialsGeneratorDialogFnRef }) => {
    const [visible, setVisible] = useState(false);
    showDialogFnRef.current = () => setVisible(true);

    const [isLoading, setIsLoading] = useState(false);

    const vaultMetadata = useAtomValue(unlockedVaultMetadataAtom);
    const unlockedVault = useAtomValue(unlockedVaultAtom);

    const handleSubmitEncryptionForm = useRef<
        (
            onValid?: (data: FormSchemas.EncryptionFormGroupSchemaType) => void,
        ) => () => Promise<void>
    >(() => async () => {});
    const resetEncryptionGroupForm = useRef(() => {});
    const isEncryptionGroupFormDirty = useRef(() => false);

    const hideDialog = (force = false) => {
        const hide = () => {
            setVisible(false);

            setTimeout(() => {
                resetEncryptionGroupForm.current();
            }, DIALOG_BLUR_TIME);
        };

        // Check if the form has been modified (only if we are not forcing)
        if (isEncryptionGroupFormDirty.current() && !force) {
            // If it has, ask the user if they want to discard the changes
            if (confirm("Are you sure you want to discard your changes?")) {
                hide();
            }
        } else {
            // If not, just hide the modal
            hide();
        }
    };

    const onSubmit = async (
        data: FormSchemas.EncryptionFormGroupSchemaType,
    ) => {
        setIsLoading(true);

        toast.info("Changing encryption configuration...", {
            autoClose: false,
            closeButton: false,
            updateId: "change-encryption-config",
            toastId: "change-encryption-config",
        });

        await new Promise((resolve) => setTimeout(resolve, 100));

        try {
            await vaultMetadata?.save(unlockedVault, data);

            toast.success("Encryption configuration changed.", {
                autoClose: 3000,
                closeButton: true,
                updateId: "change-encryption-config",
                toastId: "change-encryption-config",
            });

            hideDialog(true);
        } catch (error) {
            toast.error("An error occured while saving the vault metadata.", {
                autoClose: 3000,
                closeButton: true,
                updateId: "change-encryption-config",
                toastId: "change-encryption-config",
            });
            console.error("Error while saving vault metadata", error);
        }

        setIsLoading(false);
    };

    return (
        <GenericModal
            key="change-vault-encryption-config-modal"
            visibleState={[visible, () => hideDialog()]}
            inhibitDismissOnClickOutside={isLoading}
        >
            <Body className="flex w-full flex-col">
                <p className="w-full text-center text-2xl font-bold text-gray-900">
                    Change Vault Encryption Configuration
                </p>

                <div className="mt-4 flex flex-col items-center gap-1 rounded-md border-2 border-yellow-400 p-4">
                    <ExclamationTriangleIcon
                        className="h-7 w-7 text-slate-800"
                        aria-hidden="true"
                    />
                    <p className="text-sm text-slate-700">
                        <span className="font-bold">Note:</span> This operation
                        might take a while to complete, depending on the vault
                        size and the encryption configuration you are changing
                        to.
                    </p>
                </div>

                <EncryptionFormGroup
                    handleSubmitFn={handleSubmitEncryptionForm}
                    resetFormFn={resetEncryptionGroupForm}
                    isDirtyFn={isEncryptionGroupFormDirty}
                    credentialsGeneratorFnRef={
                        showCredentialsGeneratorDialogFnRef
                    }
                    showSecretHelpText={true}
                />
            </Body>

            <Footer className="space-y-3 sm:space-x-5 sm:space-y-0">
                <ButtonFlat
                    text="Save"
                    className="sm:ml-2"
                    onClick={() =>
                        handleSubmitEncryptionForm.current(onSubmit)()
                    }
                    disabled={isLoading}
                    loading={isLoading}
                />
                <ButtonFlat
                    text="Cancel"
                    type={ButtonType.Secondary}
                    onClick={() => hideDialog()}
                    disabled={isLoading}
                />
            </Footer>
        </GenericModal>
    );
};

const VaultSettingsDialog: React.FC<{
    showDialogFnRef: React.RefObject<() => void>;
    showWarningDialog: WarningDialogShowFn;
    showCredentialsGeneratorDialogFnRef: React.RefObject<() => void>;
    showLogInspectorDialog: () => void;
}> = ({
    showDialogFnRef,
    showWarningDialog,
    showCredentialsGeneratorDialogFnRef,
    showLogInspectorDialog,
}) => {
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

    const changeEncryptionConfigDialogShowFnRef = useRef<() => void>(() => {
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
                    // Only leave the last diff in the list
                    prev.Diffs = prev.Diffs.slice(prev.Diffs.length - 1);
                    return prev;
                });
                setIsLoading(false);

                toast.success("Synchronization list cleared.");
            },
            null,
        );
    };

    const showImportDataDialog = () => importDataDialogShowFnRef.current();

    const triggerDataExport = async () => {
        showWarningDialog(
            `You are about to export your vault as a clear-text JSON file. It is unsafe to store this file on your device.\nMake sure to store it in a safe place.`,
            async () => {
                // Clear the sync list
                setIsLoading(true);

                toast.info("Exporting data...", {
                    autoClose: false,
                    closeButton: false,
                    updateId: "export-data",
                    toastId: "export-data",
                });

                await new Promise((resolve) => setTimeout(resolve, 100));

                try {
                    Export.vaultToJSON(unlockedVault);

                    toast.success("Data successfuly exported.", {
                        autoClose: 3000,
                        closeButton: true,
                        updateId: "export-data",
                        toastId: "export-data",
                    });
                } catch (error) {
                    toast.error("An error occured while exporting the data.", {
                        autoClose: 3000,
                        closeButton: true,
                        updateId: "export-data",
                        toastId: "export-data",
                    });

                    console.error("Error while exporting vault", error);
                }

                setIsLoading(false);
            },
            null,
        );
    };

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

            const serializedData = await Storage.serializeVault(
                unlockedVault,
                vaultMetadata.Blob,
            );

            // Dump the data into a blob
            const blob = new Blob([serializedData], {
                type: "application/octet-stream",
            });
            const url = URL.createObjectURL(blob);
            const a = document.createElement("a");

            // Trigger the file download by simulating an anchor tag click
            a.href = url;
            a.download = `cryptexvault-bk-${Date.now()}.${BACKUP_FILE_EXTENSION}`;
            a.click();
            URL.revokeObjectURL(url);

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
                childrenTitle={<Title>Vault Settings</Title>}
                width="3xl"
            >
                <Body>
                    <div className="flex flex-col items-center text-center">
                        <div className="flex w-full flex-col items-center text-left">
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
                                        vaultMetadata.CreatedAt,
                                    ).toLocaleDateString()}
                                </b>
                            </p>
                        </div>
                        <div className="mt-4 flex w-full flex-col gap-4 text-left">
                            <div className="rounded-lg bg-gray-100 p-4">
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
                            <div className="flex flex-row gap-2">
                                <div className="rounded-lg bg-gray-100 p-4">
                                    <p className="text-lg font-bold text-slate-800">
                                        Import
                                    </p>
                                    <p className="mt-2 text-base text-gray-600">
                                        Import data from third-party
                                        applications.
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
                                <div className="rounded-lg bg-gray-100 p-4">
                                    <p className="text-lg font-bold text-slate-800">
                                        Export
                                    </p>
                                    <p className="mt-2 text-base text-gray-600">
                                        Export your vault as a clear-text JSON
                                        file for import into other applications.
                                    </p>
                                    <div className="mt-4 flex flex-col sm:flex-row sm:items-center sm:justify-between">
                                        <ButtonFlat
                                            text="Export Data"
                                            type={ButtonType.Secondary}
                                            onClick={triggerDataExport}
                                            disabled={isLoading}
                                        />
                                    </div>
                                </div>
                            </div>
                            <div className="rounded-lg bg-gray-100 p-4">
                                <p className="text-lg font-bold text-slate-800">
                                    Encryption
                                </p>
                                <p className="mt-2 text-base text-gray-600">
                                    You can change the encryption key or the
                                    algorithm used to encrypt your vault. Using
                                    this, you can re-encrypt your vault with the
                                    new settings.
                                </p>
                                <div className="mt-4 flex flex-col sm:flex-row sm:items-center sm:justify-between">
                                    <ButtonFlat
                                        text="Change Encryption Configuration"
                                        type={ButtonType.Secondary}
                                        onClick={
                                            changeEncryptionConfigDialogShowFnRef.current
                                        }
                                        disabled={isLoading}
                                    />
                                </div>
                            </div>
                            <div className="rounded-lg bg-gray-100 p-4">
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
                            <div className="rounded-lg bg-gray-100 p-4 border border-slate-200">
                                <p className="text-lg font-bold text-slate-800">
                                    Developer Tools
                                </p>
                                <p className="mt-2 text-base text-gray-600">
                                    Access diagnostic tools for debugging
                                    synchronization and other vault operations.
                                    Logs are cleared when you lock the vault.
                                </p>
                                <div className="mt-4 flex flex-col sm:flex-row sm:items-center sm:justify-between">
                                    <ButtonFlat
                                        text="Open Log Inspector"
                                        type={ButtonType.Secondary}
                                        onClick={showLogInspectorDialog}
                                        disabled={isLoading}
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
            <ChangeVaultEncryptionConfigDialog
                showDialogFnRef={changeEncryptionConfigDialogShowFnRef}
                showCredentialsGeneratorDialogFnRef={
                    showCredentialsGeneratorDialogFnRef
                }
            />
        </>
    );
};

const VaultTitle: React.FC<{ title: string }> = ({ title }) => {
    return (
        <div className="flex flex-col items-center justify-center overflow-hidden overflow-ellipsis">
            {/* <p className="text-sm font-bold text-slate-400">Current Vault</p> */}
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
    Register = "Register",
}
type AccountDialogTabBarProps = {
    currentFormMode: AccountDialogMode;
    changeFormMode: (
        newFormMode: AccountDialogMode.Recover | AccountDialogMode.Register,
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
                            "w-auto border border-gray-300 px-4 py-3 text-sm font-medium": true,
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

const OnlineServicesSignUpRestoreDialog: React.FC<{
    showDialogFnRef: React.RefObject<(() => void) | null>;
    vaultMetadata: Storage.VaultMetadata;
    showRecoveryGenerationDialogFnRef: React.RefObject<(() => void) | null>;
}> = ({
    showDialogFnRef,
    vaultMetadata,
    showRecoveryGenerationDialogFnRef,
}) => {
    // const vault = useAtomValue(onlineServicesAccountAtom);
    const onlineServicesBound = useAtomValue(onlineServicesBoundAtom);
    const fetchOnlineServicesData = useFetchOnlineServicesData();

    // TODO: Show this dialog only if the user is actually online
    const [visible, setVisible] = useState(!onlineServicesBound);
    showDialogFnRef.current = () => setVisible(true);
    const hideDialog = () => setVisible(false);

    const setUnlockedVault = useSetAtom(unlockedVaultWriteOnlyAtom);

    const [currentFormMode, setCurrentFormMode] = useState(
        AccountDialogMode.Register,
    );

    const changeFormMode = (
        newFormMode: AccountDialogMode.Recover | AccountDialogMode.Register,
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
            currentFormMode === AccountDialogMode.Register &&
            signUpSubmitFnRef.current
        ) {
            await signUpSubmitFnRef.current?.();
        }
    };

    const bindAccount = async (apiKey: string) => {
        // Save the authentication data to the vault
        setUnlockedVault(async (pre) => {
            LinkedDevices.bindAccount(pre.LinkedDevices, apiKey);

            setOnlineServicesAPIKey(apiKey);
            await fetchOnlineServicesData();

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
                    <AccountDialogRegisterForm
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
    submitFnRef: React.RefObject<(() => Promise<void>) | null>;
    bindAccountFn: (apiKey: string) => Promise<void>;
    hideDialogFn: () => void;
}> = ({ submittingState, submitFnRef, bindAccountFn, hideDialogFn }) => {
    const [, setIsSubmitting] = submittingState;

    const recoverFormSchema = z.object({
        userId: z.string().min(1, "This field is required").max(100),
        recoveryPhrase: z.string().min(1, "This field is required"),
        captchaToken: z.string().min(1, "Captch is required"),
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
        trpcReact.v1.user.recover.useMutation();

    const onSubmit = async (formData: RecoverFormSchemaType) => {
        setIsSubmitting(true);

        // Send the public key and the email to the server
        toast.info("Contacting the server...", {
            autoClose: false,
            closeButton: false,
            toastId: "recovery-contacting-server",
            updateId: "recovery-contacting-server",
        });

        try {
            const apiKey = await recoverUser({
                userId: formData.userId,
                recoveryPhrase: formData.recoveryPhrase,
                // publicKey: keyPair.publicKey,
                captchaToken: formData.captchaToken,
            });

            // Save the API key to the vault
            await bindAccountFn(apiKey);

            toast.update("recovery-contacting-server", {
                autoClose: 1000,
                closeButton: true,
            });

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
                toastId: "recovery-contacting-server",
                updateId: "recovery-contacting-server",
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

const AccountDialogRegisterForm: React.FC<{
    submittingState: [boolean, React.Dispatch<React.SetStateAction<boolean>>];
    submitFnRef: React.RefObject<(() => Promise<void>) | null>;
    vaultMetadata: Storage.VaultMetadata;
    bindAccountFn: (apiKey: string) => Promise<void>;
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
            captchaToken: "",
        },
    });

    const { mutateAsync: register_user } =
        trpcReact.v1.user.register.useMutation();

    const onSubmit = async (formData: SignUpFormSchemaType) => {
        setIsSubmitting(true);

        // Send the public key and the email to the server
        toast.info("Contacting the server...", {
            autoClose: false,
            closeButton: false,
            toastId: "register-user",
            updateId: "register-user",
        });

        try {
            const apiKey = await register_user({
                captchaToken: formData.captchaToken,
            });

            // Save the api key
            await bindAccountFn(apiKey);

            // Hide the dialog
            hideDialogFn();

            toast.success("Successfully registered user.", {
                autoClose: 3000,
                closeButton: true,
                toastId: "register-user",
                updateId: "register-user",
            });
        } catch (e) {
            console.error("Failed to register user.", e);

            let message = "Failed to register user.";
            if (e instanceof TRPCClientError) {
                message = e.message;
            }

            toast.error(message, {
                autoClose: 3000,
                closeButton: true,
                toastId: "register-user",
                updateId: "register-user",
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
            <Disclosure as="div" defaultOpen={true}>
                {({ open }) => (
                    <>
                        <DisclosureButton className="flex flex-col justify-between rounded-t-lg bg-slate-100 p-4">
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
                        </DisclosureButton>
                        <DisclosurePanel>
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
                        </DisclosurePanel>
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
    const DynamicQRCode = dynamic(() => import("react-qr-code"));
    const [copied, setCopied] = useState(false);

    const handleClick = async () => {
        try {
            if (clickCallback) {
                clickCallback();
            } else {
                await navigator.clipboard.writeText(value);
                toast.info("QR data copied to clipboard");
            }
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
        } catch (e) {
            toast.error("Failed to copy QR data to clipboard");
        }
    };

    return (
        <Suspense fallback={<Spinner />}>
            <div
                className="group relative inline-flex flex-col items-center"
                aria-label="QR code. Click to copy base64 data to clipboard"
            >
                <div className="cursor-pointer select-none rounded-lg border bg-white p-2 shadow-sm transition hover:shadow-md active:scale-[0.99] dark:bg-slate-900">
                    <DynamicQRCode value={value} onClick={handleClick} />
                </div>
                <div className="mt-2 text-xs text-slate-500 dark:text-slate-400">
                    {copied ? "Copied!" : "Click the QR to copy base64 data"}
                </div>
                <div
                    className={clsx(
                        "pointer-events-none absolute inset-0 flex items-center justify-center",
                        copied ? "opacity-100" : "opacity-0",
                        "transition-opacity duration-200",
                    )}
                >
                    <CheckCircleIcon className="h-12 w-12 text-green-500 drop-shadow" />
                </div>
            </div>
        </Suspense>
    );
};

const LinkDeviceInsideVaultDialog: React.FC<{
    showDialogFnRef: React.RefObject<(() => void) | null>;
    showWarningDialog: WarningDialogShowFn;
    showSignInDialog: React.RefObject<(() => void) | null>;
}> = ({ showDialogFnRef, showWarningDialog, showSignInDialog }) => {
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

    const unlockedVault = useAtomValue(unlockedVaultAtom);
    const setLinkedDevices = useSetAtom(linkedDevicesAtom);
    const vaultMetadata = useAtomValue(unlockedVaultMetadataAtom);
    const onlineServicesData = useAtomValue(onlineServicesDataAtom);

    const isSignedIn = LinkedDevices.isBound(unlockedVault.LinkedDevices);
    const tierAllowsLinkingWithOnlineServices =
        isSignedIn && !!onlineServicesData?.remoteData?.canLink;

    const [selectedLinkMethod, setSelectedLinkMethod] =
        useState<LinkMethod | null>(null);
    const [isOperationInProgress, setIsOperationInProgress] = useState(false);
    const [readyForOtherDevice, setReadyForOtherDevice] = useState(false);
    const progressLogRef = useRef<ProgressLogType[]>([]);
    const cancelFnRef = useRef<() => void>(() => {
        // No-op
    });

    const linkingDeviceFormSchema = z.object({
        deviceName: z
            .string()
            .min(1, "Device name cannot be empty.")
            .max(150, "Device name cannot be longer than 150 characters.")
            .default("My Device"),
        signalingServerID: z
            .string()
            .min(1, "Signaling server cannot be empty.")
            .default(ONLINE_SERVICES_SELECTION_ID),
        stunServerID: z
            .string()
            .min(1, "STUN server cannot be empty.")
            .default(ONLINE_SERVICES_SELECTION_ID),
        turnServerID: z
            .string()
            .min(1, "TURN server cannot be empty.")
            .default(ONLINE_SERVICES_SELECTION_ID),
        progressLog: z.array(
            z.object({
                message: z.string(),
                type: z.enum(["done", "info", "warn", "error"]),
            }),
        ),
        rootDevice: z.boolean().default(false),
        mnemonic: z.string().default(""),
    });
    type LinkingDeviceFormSchemaType = z.infer<typeof linkingDeviceFormSchema>;
    const {
        control,
        register,
        handleSubmit,
        setValue: setFormValue,
        getValues: getFormValues,
        formState: { errors, isValid: isFormValid },
        reset: resetForm,
    } = useForm<LinkingDeviceFormSchemaType>({
        resolver: zodResolver(linkingDeviceFormSchema),
        defaultValues: {
            deviceName: "My Device",
            signalingServerID: ONLINE_SERVICES_SELECTION_ID,
            stunServerID: ONLINE_SERVICES_SELECTION_ID,
            turnServerID: ONLINE_SERVICES_SELECTION_ID,
            progressLog: [],
            mnemonic: "",
        },
    });

    const encryptedTransferableDataRef = useRef<string>("");

    const { mutateAsync: linkNewDevice } =
        trpcReact.v1.device.link.useMutation();
    const removeDevice = trpcReact.v1.device.remove.useMutation();

    const addToProgressLog = (
        message: string,
        type: "done" | "info" | "warn" | "error" = "done",
    ) => {
        const newProgressLog = [{ message, type }, ...progressLogRef.current];
        progressLogRef.current = newProgressLog;
        setFormValue("progressLog", newProgressLog);
    };

    const prepareConnectionPackage = async (
        usesOnlineServices: boolean,
        isDeviceRoot: boolean,
        stunServers: VaultUtilTypes.STUNServerConfiguration[],
        turnServers: VaultUtilTypes.TURNServerConfiguration[],
        signalingServer:
            | VaultUtilTypes.SignalingServerConfiguration
            | undefined,
    ): Promise<{
        ID: string;
        apiKey?: string;
        linkingPackage: LinkingPackage;
    }> => {
        const returnData: {
            ID: string;
            apiKey?: string;
            linkingPackage: LinkingPackage;
        } = {
            ID: "",
            apiKey: undefined,
            linkingPackage: new LinkingPackage(new Uint8Array(0), "", ""),
        };

        if (usesOnlineServices) {
            // Run the account.linkDevice mutation and set the ID and API key properties
            try {
                addToProgressLog(
                    "Registering a new device with the server...",
                    "info",
                );

                const apiKey = await linkNewDevice({
                    root: isDeviceRoot,
                });
                returnData.ID = extractIDFromAPIKey(apiKey);
                returnData.apiKey = apiKey;

                addToProgressLog("Device registered.");
            } catch (e) {
                if (e instanceof TRPCClientError) {
                    addToProgressLog(
                        `Failed to register the device with the server: ${e.message}`,
                        "error",
                    );
                } else {
                    addToProgressLog(
                        "Failed to register the device with the server.",
                        "error",
                    );
                }
                throw e;
            }
        } else {
            // Generate a random ID using the ULID library
            returnData.ID = LinkedDevices.generateNewDeviceID();
            returnData.apiKey = undefined;
        }

        // Create a linking package
        try {
            addToProgressLog(
                "Encrypting and serializing linking package...",
                "info",
            );

            const { linkingPackage, mnemonic } =
                await LinkingPackage.createNewPackage({
                    ID: returnData.ID,
                    APIKey: returnData.apiKey,
                    STUNServers: stunServers,
                    TURNServers: turnServers,
                    SignalingServer: signalingServer,
                });

            returnData.linkingPackage = linkingPackage;

            addToProgressLog("Encrypted and serialized linking package.");

            // Show the user a note and the mnemonic passphrase to enter on the other device
            setFormValue("mnemonic", mnemonic);
        } catch (e) {
            addToProgressLog(
                "Failed to encrypt and serialize linking package.",
                "error",
            );
            throw e;
        }

        return returnData;
    };

    const startLinkingProcess = async (
        usesOnlineServices: boolean,
        deviceName: string,
        deviceID: string,
        deviceAPIKey: string | undefined,
        isDeviceRoot: boolean,
        stunServers: VaultUtilTypes.STUNServerConfiguration[],
        turnServers: VaultUtilTypes.TURNServerConfiguration[],
        signalingServer: VaultUtilTypes.SignalingServerConfiguration | null = null,
    ) => {
        // Start setting up the WebRTC connection
        const webRTConnection = Synchronization.initWebRTC(
            stunServers,
            turnServers,
        );

        webRTConnection.onconnectionstatechange = () => {
            // console.debug(
            //     "WebRTC connection state changed:",
            //     webRTConnection.connectionState
            // );

            if (webRTConnection.connectionState === "connected") {
                addToProgressLog(
                    "Private connection established, dropping Signaling server connection...",
                    "info",
                );

                // Since we're connected directly to the other device, we can disconnect from the Signaling Server
                signalingServerConnection.disconnect();
                signalingServerConnection.unbind();
            } else if (
                webRTConnection.connectionState === "disconnected" ||
                webRTConnection.connectionState === "failed"
            ) {
                // Handle disconnection from the other device
                addToProgressLog(
                    "Private connection has been terminated",
                    "info",
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
                "info",
            );

            // Check if we have valid vault data to send
            // In reality, this should never happen, but we'll check anyway to make the typescript compiler happy
            if (!vaultMetadata || !unlockedVault) {
                addToProgressLog(
                    "Cannot find Vault metadata or the Vault itself.",
                    "error",
                );
                console.error(
                    "Cannot find Vault metadata or unlocked Vault data.",
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
                    "Packaging Vault data for transmission...",
                    "info",
                );

                // Prepare the vault data for transmission
                const exportedVault = Vault.packageForLinking(
                    unlockedVault,
                    deviceID,
                    deviceAPIKey,
                    stunServers.map((i) => i.ID),
                    turnServers.map((i) => i.ID),
                    signalingServer?.ID ?? ONLINE_SERVICES_SELECTION_ID,
                );

                addToProgressLog("Vault data packaged. Encrypting...", "info");

                const encryptedBlobObj =
                    await vaultMetadata.exportForLinking(exportedVault);

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
                    "Saving new linked device to Vault...",
                    "info",
                );

                // setUnlockedVault(async (prev) => {
                //     LinkedDevices.addLinkedDevice(
                //         prev.LinkedDevices,
                //         deviceID,
                //         deviceName,
                //         isDeviceRoot,
                //         stunServers.map((i) => i.ID),
                //         turnServers.map((i) => i.ID),
                //         signalingServer?.ID,
                //     );

                //     await vaultMetadata.save(unlockedVault);

                //     return prev;
                // });
                console.warn(
                    "Number of linked devices",
                    unlockedVault.LinkedDevices.Devices.length,
                );
                LinkedDevices.addLinkedDevice(
                    unlockedVault.LinkedDevices,
                    deviceID,
                    deviceName,
                    isDeviceRoot,
                    stunServers.map((i) => i.ID),
                    turnServers.map((i) => i.ID),
                    signalingServer?.ID,
                );
                setLinkedDevices([...unlockedVault.LinkedDevices.Devices]);
                console.warn(
                    "Number of linked devices",
                    unlockedVault.LinkedDevices.Devices.length,
                );
                // TODO: Check if this saves the old or the new data
                vaultMetadata.save(unlockedVault);

                addToProgressLog("New linked device saved.");
            }

            toast.success("Successfully linked device.", {
                closeButton: true,
            });

            addToProgressLog("It is safe to close this dialog now.", "info");
        };
        webRTCDataChannel.onerror = () => {
            addToProgressLog(
                "Failed to send Vault data. Data channel error.",
                "error",
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
                    "error",
                );

                // Close the WebRTC connection
                webRTCDataChannel.close();
                webRTConnection.close();

                signalingServerConnection.disconnect();

                setIsOperationInProgress(false);
            }
        };

        // Connect to WS and wait for the other device
        const signalingServerConnection = Synchronization.initPusherInstance(
            signalingServer,
            unlockedVault.LinkedDevices.ID,
        );
        signalingServerConnection.connection.bind(
            "pusher:connection_established",
            () => {
                console.debug("-- Connected to custom signaling server --");

                addToProgressLog(
                    "Connected to custom signaling server.",
                    "info",
                );
            },
        );

        signalingServerConnection.connection.bind("error", (err: object) => {
            console.error("WS error:", err);
            // NOTE: Should we handle specific errors?
            // if (err.error.data.code === 4004) {
            //     // log('Over limit!');
            // }
            addToProgressLog(
                "An error occurred while setting up a private connection.",
                "error",
            );

            setIsOperationInProgress(false);
        });

        const channelName = constructLinkPresenceChannelName(
            usesOnlineServices && deviceAPIKey ? deviceAPIKey : deviceID,
        );
        const wsChannel = signalingServerConnection.subscribe(channelName);
        wsChannel.bind("pusher:subscription_succeeded", () => {
            setReadyForOtherDevice(true);
            cancelFnRef.current = async () => {
                // Close the WS connection
                signalingServerConnection.disconnect();

                setIsOperationInProgress(false);
                setReadyForOtherDevice(false);

                if (usesOnlineServices) {
                    addToProgressLog(
                        "Rollback - Cleaning up the registration...",
                        "info",
                    );

                    // Try to remove the device from the account - if it fails, we'll just have to leave it there for the user to remove manually
                    try {
                        await removeDevice.mutateAsync({
                            id: deviceID,
                        });
                    } catch (err) {
                        console.error("Failed to remove device:", err);

                        addToProgressLog(
                            "Rollback - Failed to remove device from account.",
                            "error",
                        );
                    }
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
                        data.data as RTCIceCandidateInit,
                    );
                } else if (data.type === "answer") {
                    console.debug("Setting remote description.", data.data);
                    await webRTConnection.setRemoteDescription(
                        data.data as RTCSessionDescriptionInit,
                    );
                }
            },
        );
    };

    const fileMethod = (
        _deviceName: string,
        encryptedLinkingPackage: Uint8Array,
    ) => {
        // Save it to a file with a .${LINK_FILE_EXTENSION} extension
        const blob = new Blob([encryptedLinkingPackage], {
            type: "application/octet-stream",
        });

        // Normalize the device name
        const deviceName = _deviceName.replaceAll(" ", "-").toLowerCase();

        // Save the file
        const fileName = `vault-linking-${deviceName}-${Date.now()}.${LINK_FILE_EXTENSION}`;
        const link = document.createElement("a");
        link.href = window.URL.createObjectURL(blob);
        link.download = fileName;
        link.click();

        // Clean up the URL
        URL.revokeObjectURL(link.href);
    };

    const qrCodeMethod = (encryptedLinkingPackageB64: string) => {
        // Set the encryptedTransferableDataRef to the encrypted data
        // By the time this method is called, the QR Code component should be mounted
        encryptedTransferableDataRef.current = encryptedLinkingPackageB64;
    };

    const onSubmit = async (type: LinkMethod) => {
        // If the form is not valid, submit it to show the errors
        if (!isFormValid) {
            handleSubmit(() => {
                // No-op
            })();
            return;
        }

        const deviceName = getFormValues("deviceName");
        const isDeviceRoot = getFormValues("rootDevice");

        // Get the selected servers
        const _selectedSignalingServerID = getFormValues("signalingServerID");
        // NOTE: This is in preparation for multiple STUN and TURN server selection capabilities
        const _selectedSTUNServerIDs = [getFormValues("stunServerID")];
        const _selectedTURNServerIDs = [getFormValues("turnServerID")];

        // In case the user selected the "Online Services" option, check if their tier allows linking
        if (
            _selectedSignalingServerID === ONLINE_SERVICES_SELECTION_ID ||
            _selectedSTUNServerIDs[0] === ONLINE_SERVICES_SELECTION_ID ||
            _selectedTURNServerIDs[0] === ONLINE_SERVICES_SELECTION_ID
        ) {
            if (!isSignedIn) {
                // If the user doesn't have a bound account, show a warning dialog with the confirmation to open the sign-in dialog
                showWarningDialog(
                    "You need to be signed in to use the Online Services.",
                    () => {
                        // Close this dialog
                        hideDialog();

                        showSignInDialog.current?.();
                    },
                    null,
                    "Sign In",
                    "By signing in, you will be able to link devices to this Vault using the Online Services.",
                );
                return;
            } else if (!tierAllowsLinkingWithOnlineServices) {
                // If the user doesn't have a tier that allows linking, show a warning dialog with the confirmation to upgrade their tier
                showWarningDialog(
                    "Upgrade your tier to enable linking with the Online Services.",
                    async () => {
                        hideDialog();

                        // showAccountDialog.current?.();
                        await navigateToCheckout();
                    },
                    null,
                    "Upgrade",
                    "",
                );
                return;
            }
        }

        setSelectedLinkMethod(type);
        setIsOperationInProgress(true);

        const signalingServer =
            unlockedVault.LinkedDevices.SignalingServers.find(
                (server) => server.ID === _selectedSignalingServerID,
            );
        const stunServers = unlockedVault.LinkedDevices.STUNServers.filter(
            (server) => _selectedSTUNServerIDs.includes(server.ID),
        );
        const turnServers = unlockedVault.LinkedDevices.TURNServers.filter(
            (server) => _selectedTURNServerIDs.includes(server.ID),
        );

        // In case any of the servers are not found, we'll conclude that the link should be setup over Cryptex Vault Online Services
        const usesOnlineServices =
            signalingServer == null ||
            !stunServers.length ||
            !turnServers.length;

        // We exploit this try-catch block to catch any errors that may occur and stop execution in case of an error
        // All expected errors should be handled inside each method that can throw them
        // Meaning, only unexpected errors should be caught here
        try {
            // Craft the connection package
            const connectionPackage = await prepareConnectionPackage(
                usesOnlineServices,
                isDeviceRoot,
                stunServers,
                turnServers,
                signalingServer,
            );

            if (type === LinkMethod.File) {
                // Generate the file with the encrypted data for the other device
                fileMethod(
                    deviceName,
                    connectionPackage.linkingPackage.toBinary(),
                );
            } else if (type === LinkMethod.QRCode) {
                // Make sure that a QR Code with the encrypted data is generated
                qrCodeMethod(connectionPackage.linkingPackage.toBase64());
            } else if (type === LinkMethod.Sound) {
                throw new Error("Not implemented.");
            } else {
                throw new Error("Unknown linking method.");
            }

            await startLinkingProcess(
                usesOnlineServices,
                deviceName,
                connectionPackage.ID,
                connectionPackage.apiKey,
                isDeviceRoot,
                stunServers,
                turnServers,
                signalingServer,
            );
        } catch (e) {
            console.error("Failed to link device.", e);

            toast.error(
                "Failed to link device. Please check the console for details.",
                {
                    closeButton: true,
                },
            );

            setIsOperationInProgress(false);
        }
    };

    const RootDeviceCheckboxOnlineServices: React.FC<{
        formControl: Control<LinkingDeviceFormSchemaType>;
    }> = ({ formControl }) => {
        const signalingServerID = useWatch({
            control: formControl,
            name: "signalingServerID",
            defaultValue: ONLINE_SERVICES_SELECTION_ID,
        });
        const stunServerID = useWatch({
            control: formControl,
            name: "stunServerID",
            defaultValue: ONLINE_SERVICES_SELECTION_ID,
        });
        const turnServerID = useWatch({
            control: formControl,
            name: "turnServerID",
            defaultValue: ONLINE_SERVICES_SELECTION_ID,
        });

        if (
            signalingServerID == ONLINE_SERVICES_SELECTION_ID ||
            stunServerID == ONLINE_SERVICES_SELECTION_ID ||
            turnServerID == ONLINE_SERVICES_SELECTION_ID
        ) {
            return (
                <FormInputCheckbox
                    label="Link as the root device"
                    valueLabel="Whether or not we should automatically connect to this device when it is available."
                    register={register("rootDevice")}
                />
            );
        }

        return null;
    };

    return (
        <GenericModal
            visibleState={[visible, () => hideDialog()]}
            inhibitDismissOnClickOutside={isOperationInProgress}
            childrenTitle={<Title>Link a Device</Title>}
        >
            <Body className="flex w-full flex-col">
                {/* {
                        // If the user is not registered
                        !hasCredentials && (
                            <p className="text-center text-base text-gray-600">
                                You need to be registered with the online
                                services in order to link devices to your vault.
                            </p>
                        )
                    } */}
                {/* {
                        // If there was an error while fetching the linking configuration, tell the user
                        onlineServicesData == null && (
                            <p className="text-center text-base text-gray-600">
                                Failed to fetch linking configuration. Please
                                try again later.
                            </p>
                        )
                    } */}
                {/* {isWrongTier && (
                        <>
                            <p className="text-center text-base text-gray-600">
                                Your tier does not allow linking devices.
                            </p>
                            <p className="text-center text-base text-gray-600">
                                Please upgrade your account to link devices.
                            </p>
                        </>
                    )} */}
                {
                    // !isWrongTier &&
                    //     hasCredentials &&
                    selectedLinkMethod == null && (
                        <>
                            <p className="text-center text-base text-gray-600">
                                In order to enable data synchronization between
                                two devices, you need to link them.
                            </p>
                            <p className="text-center text-base text-gray-600">
                                Choose one of the available linking methods
                                below to start.
                            </p>

                            <div className="my-5 flex flex-col">
                                <Controller
                                    control={control}
                                    name="deviceName"
                                    render={({
                                        field: { onChange, onBlur, value },
                                    }) => (
                                        <>
                                            <FormInputField
                                                label="Device name"
                                                placeholder="Linked device name"
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
                                <div className="w-full">
                                    <p className="mt-1 text-xs text-gray-500">
                                        This name will be used to help you
                                        differentiate between devices.
                                    </p>
                                </div>
                            </div>

                            <div className="mb-2 flex w-full flex-col">
                                <SynchronizationServersSelectboxes
                                    synchronizationConfiguration={{
                                        SignalingServers:
                                            unlockedVault.LinkedDevices
                                                .SignalingServers,
                                        STUNServers:
                                            unlockedVault.LinkedDevices
                                                .STUNServers,
                                        TURNServers:
                                            unlockedVault.LinkedDevices
                                                .TURNServers,
                                    }}
                                    registerSignaling={register(
                                        "signalingServerID",
                                    )}
                                    registerSTUN={register("stunServerID")}
                                    registerTURN={register("turnServerID")}
                                />
                                {errors.signalingServerID &&
                                    errors.signalingServerID.message && (
                                        <p className="text-red-500">
                                            {errors.signalingServerID.message}
                                        </p>
                                    )}
                                {errors.stunServerID &&
                                    errors.stunServerID.message && (
                                        <p className="text-red-500">
                                            {errors.stunServerID.message}
                                        </p>
                                    )}
                                {errors.turnServerID &&
                                    errors.turnServerID.message && (
                                        <p className="text-red-500">
                                            {errors.turnServerID.message}
                                        </p>
                                    )}
                            </div>

                            <div className="mb-2">
                                <RootDeviceCheckboxOnlineServices
                                    formControl={control}
                                />
                            </div>

                            {/* <p className="mb-2 text-center text-base text-slate-600">
                                <b>Note:</b> You need to be signed in to use the
                                Online Services.
                            </p> */}

                            <BlockWideButton
                                icon={
                                    <CameraIcon className="h-5 w-5 text-gray-900" />
                                }
                                iconCaption="QR code"
                                description="Generate a QR code to link the devices"
                                onClick={() => onSubmit(LinkMethod.QRCode)}
                                disabled={isOperationInProgress}
                            />

                            <BlockWideButton
                                icon={
                                    <SpeakerWaveIcon className="h-5 w-5 text-gray-900" />
                                }
                                iconCaption="Sound"
                                description="Use sound to link the devices"
                                // disabled={
                                //     isSubmitting ||
                                //     (validInput !== ValidInput.Sound && validInput !== null)
                                // }
                                disabled={true} // TODO: Sound transfer is not implemented yet
                                // validInput={validInput === ValidInput.Sound}
                            />

                            <BlockWideButton
                                icon={
                                    <DocumentTextIcon className="h-5 w-5 text-gray-900" />
                                }
                                iconCaption="File"
                                description="Generate a file to link devices manually"
                                onClick={() => onSubmit(LinkMethod.File)}
                                disabled={isOperationInProgress}
                            />
                        </>
                    )
                }

                {
                    // !isWrongTier &&
                    //     hasCredentials &&
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

                                {readyForOtherDevice &&
                                    isOperationInProgress && (
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
                                                    "flex flex-col items-center gap-2": true,
                                                    hidden: !value.length,
                                                })}
                                            >
                                                <p className="select-all rounded-md bg-gray-200 p-2 text-gray-900">
                                                    {value}
                                                </p>
                                                <p className="text-xs text-gray-500">
                                                    Enter this mnemonic on the
                                                    other device when prompted.
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
                    )
                }
            </Body>
            <Footer className="space-y-3 sm:space-x-5 sm:space-y-0">
                <ButtonFlat
                    text="Cancel"
                    type={ButtonType.Secondary}
                    className={clsx({
                        "sm:ml-2": true,
                        hidden: !readyForOtherDevice || !isOperationInProgress,
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
    showDialogFnRef: React.RefObject<(selectedDevice: LinkedDevice) => void>;
    // selectedDevice: React.RefObject<LinkedDevice | null>;
    vaultMetadata: Storage.VaultMetadata | null;
}> = ({ showDialogFnRef, vaultMetadata }) => {
    const [visible, setVisible] = useState(false);
    const [selectedDevice, setSelectedDevice] = useState<LinkedDevice | null>(
        null,
    );

    showDialogFnRef.current = (selectedDevice: LinkedDevice) => {
        if (selectedDevice == null) return;

        // Set the initial form values
        resetForm({
            name: selectedDevice.Name,
            autoConnect: selectedDevice.AutoConnect,
            syncTimeout: selectedDevice.SyncTimeout,
            syncTimeoutPeriod: selectedDevice.SyncTimeoutPeriod ?? 1,
            stunServerIDs:
                selectedDevice.STUNServerIDs[0] ?? ONLINE_SERVICES_SELECTION_ID,
            turnServerIDs:
                selectedDevice.TURNServerIDs[0] ?? ONLINE_SERVICES_SELECTION_ID,
            signalingServerID: selectedDevice.SignalingServerID,
        });

        setSelectedDevice(selectedDevice);
        setVisible(true);
    };
    const hideDialog = (force = false) => {
        const hide = () => {
            setVisible(false);

            // Reset the form with a delay for better UX
            setTimeout(() => {
                resetForm();
                // selectedDevice.current = null;
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

    const setLinkedDevices = useSetAtom(linkedDevicesAtom);
    const unlockedVault = useAtomValue(unlockedVaultAtom);

    const formSchema = z.object({
        name: z.string().min(1).max(200),
        autoConnect: z.boolean(),
        syncTimeout: z.boolean(),
        syncTimeoutPeriod: z.coerce.number().int().min(1),
        stunServerIDs: z.string().min(1), // stunServerIDs: z.array(z.string()).nonempty(),
        turnServerIDs: z.string().min(1), // turnServerIDs: z.array(z.string()).nonempty(),
        signalingServerID: z
            .string()
            .min(1, "Signaling server cannot be empty."),
    });
    type FormSchema = z.infer<typeof formSchema>;
    const {
        handleSubmit,
        register,
        watch,
        formState: { errors, isSubmitting, isDirty },
        reset: resetForm,
    } = useForm<FormSchema>({
        resolver: zodResolver(formSchema),
        defaultValues: {
            name: "",
            autoConnect: false,
            syncTimeout: false,
            syncTimeoutPeriod: 1,
            stunServerIDs: ONLINE_SERVICES_SELECTION_ID,
            turnServerIDs: ONLINE_SERVICES_SELECTION_ID,
            signalingServerID: ONLINE_SERVICES_SELECTION_ID,
        },
    });

    const syncTimeoutValue = watch(
        "syncTimeout",
        selectedDevice?.SyncTimeout ?? false,
    );

    const onSubmit = async (form: FormSchema) => {
        if (selectedDevice == null || vaultMetadata == null || !isDirty) {
            hideDialog();
            return;
        }

        await new Promise((resolve) => setTimeout(resolve, 100));

        const originalLinkedDevice = unlockedVault.LinkedDevices.Devices.find(
            (d) => d.ID === selectedDevice?.ID,
        );

        if (originalLinkedDevice != null) {
            originalLinkedDevice.setName = form.name;
            originalLinkedDevice.setAutoConnect = form.autoConnect;
            originalLinkedDevice.setSyncTimeout = form.syncTimeout;
            originalLinkedDevice.setSyncTimeoutPeriod = form.syncTimeoutPeriod;
            originalLinkedDevice.setSTUNServers = [form.stunServerIDs];
            originalLinkedDevice.setTURNServers = [form.turnServerIDs];
            originalLinkedDevice.setSignalingServer = form.signalingServerID;
        }
        setLinkedDevices([...unlockedVault.LinkedDevices.Devices]);

        await vaultMetadata.save(unlockedVault);

        hideDialog(true);
    };

    return (
        <GenericModal
            key="edit-linked-device"
            visibleState={[
                visible && selectedDevice != null,
                () => hideDialog(),
            ]}
            childrenTitle={<Title>Edit Linked Device</Title>}
        >
            <Body>
                <div className="flex flex-col text-center">
                    <div className="flex w-full flex-col items-center text-left">
                        <p
                            className="line-clamp-2 text-left text-base text-gray-600"
                            title={"Name of the linked device"}
                        >
                            <span className="font-bold">Name:</span>{" "}
                            {selectedDevice?.Name}
                        </p>
                        <p
                            className="line-clamp-2 text-left text-base text-gray-600"
                            title={"When the device was linked to this vault"}
                        >
                            <span className="font-bold">Linked on:</span>{" "}
                            {selectedDevice?.LinkedAtTimestamp && (
                                <>
                                    {new Date(
                                        selectedDevice.LinkedAtTimestamp,
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
                            {selectedDevice?.LastSync ? (
                                <>
                                    {new Date(
                                        selectedDevice.LastSync,
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
                            {selectedDevice?.IsRoot ? "Yes" : "No"}
                        </p>
                    </div>
                    <div className="flex w-full flex-col space-y-3 text-left">
                        <div className="flex flex-col">
                            <FormInputField
                                label="Name *"
                                placeholder="Name of the device"
                                type="text"
                                autoCapitalize="words"
                                register={register("name")}
                            />
                            {errors.name && (
                                <p className="text-red-500">
                                    {errors.name.message}
                                </p>
                            )}
                        </div>
                        <div className="mb-2 flex w-full flex-col">
                            <SynchronizationServersSelectboxes
                                synchronizationConfiguration={{
                                    SignalingServers:
                                        unlockedVault.LinkedDevices
                                            .SignalingServers,
                                    STUNServers:
                                        unlockedVault.LinkedDevices.STUNServers,
                                    TURNServers:
                                        unlockedVault.LinkedDevices.TURNServers,
                                }}
                                registerSignaling={register(
                                    "signalingServerID",
                                )}
                                registerSTUN={register("stunServerIDs")}
                                registerTURN={register("turnServerIDs")}
                            />
                            {errors.signalingServerID &&
                                errors.signalingServerID.message && (
                                    <p className="text-red-500">
                                        {errors.signalingServerID.message}
                                    </p>
                                )}
                            {errors.stunServerIDs &&
                                errors.stunServerIDs.message && (
                                    <p className="text-red-500">
                                        {errors.stunServerIDs.message}
                                    </p>
                                )}
                            {errors.turnServerIDs &&
                                errors.turnServerIDs.message && (
                                    <p className="text-red-500">
                                        {errors.turnServerIDs.message}
                                    </p>
                                )}
                        </div>
                        <div className="flex items-center space-x-2">
                            <FormInputCheckbox
                                label="Auto Connect"
                                register={register("autoConnect")}
                                valueLabel="Whether or not we should automatically connect to this device when it is available."
                            />
                            {errors.name && (
                                <p className="text-red-500">
                                    {errors.name.message}
                                </p>
                            )}
                        </div>
                        <div>
                            <div className="flex items-center space-x-2">
                                <FormInputCheckbox
                                    label="Impose a synchronization window"
                                    register={register("syncTimeout")}
                                    valueLabel="The synchronization will only be possible when manually triggered and will only last for the specified amount of time."
                                />
                                {errors.name && (
                                    <p className="text-red-500">
                                        {errors.name.message}
                                    </p>
                                )}
                            </div>
                            {syncTimeoutValue && (
                                <div
                                    className="mt-2 flex flex-col pl-8"
                                    title="The amount of time to stay connected to the device."
                                >
                                    <div
                                        className={clsx({
                                            "border-l pl-2": true,
                                        })}
                                    >
                                        <FormNumberInputField
                                            label=""
                                            valueLabel="seconds"
                                            min={1}
                                            register={register(
                                                "syncTimeoutPeriod",
                                            )}
                                        />
                                    </div>
                                    {errors.syncTimeoutPeriod && (
                                        <p className="text-red-500">
                                            {errors.syncTimeoutPeriod.message}
                                        </p>
                                    )}
                                </div>
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
                    disabled={isSubmitting}
                    loading={isSubmitting}
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
//#endregion Linking vaults

//#region Sidebar
const SidebarSyncDeviceListItem: React.FC<{
    item: LinkedDevice;
    showEditDialog: RefObject<(device: LinkedDevice) => void>;
    unlinkDevice: (id: string) => Promise<void>;
    showManualSyncDialog: RefObject<ManualSyncShowDialogFnPropType>;
    showLogInspectorDialog: () => void;
}> = ({ item, showEditDialog, unlinkDevice, showManualSyncDialog, showLogInspectorDialog }) => {
    const device = item;

    const setVaultCredentials = useSetAtom(vaultCredentialsAtom);

    const [lastSync, setLastSync] = useState(
        device.LastSync ? dayjs(device.LastSync) : null,
    );
    const optionsButtonRef = useRef<HTMLButtonElement | null>(null);
    const [signalingStatus, setSignalingServerStatus] =
        useState<SynchronizationUtils.SignalingStatus>(
            GlobalSyncConnectionController.getSignalingStatus(
                device.SignalingServerID,
            ),
        );
    const [webRTCStatus, setWebRTCStatus] =
        useState<SynchronizationUtils.WebRTCStatus>(
            GlobalSyncConnectionController.getWebRTCStatus(device.ID),
        );
    const webRTCConnectedOrConnecting =
        webRTCStatus === SynchronizationUtils.WebRTCStatus.Connected ||
        webRTCStatus === SynchronizationUtils.WebRTCStatus.Connecting;

    // console.warn("DEVICE RERENDER", device);

    const contextMenuOptions: {
        disabled: boolean;
        visible: boolean;
        name: string;
        onClick: (device: LinkedDevice) => Promise<void>;
    }[] = [
        {
            disabled: false,
            visible: !webRTCConnectedOrConnecting,
            name: "Connect",
            onClick: async () => {
                GlobalSyncConnectionController.connectDevice(device);
            },
        },
        {
            disabled: false,
            visible: webRTCConnectedOrConnecting,
            name: "Disconnect",
            onClick: async () => {
                GlobalSyncConnectionController.disconnectDevice(device);
            },
        },
        {
            disabled: false,
            visible:
                webRTCStatus === SynchronizationUtils.WebRTCStatus.Connected,
            name: "Synchronize now",
            onClick: async () => {
                GlobalSyncConnectionController.transmitSyncRequest(device.ID);
            },
        },
        {
            disabled: false,
            visible: true,
            name: "Unlink device",
            onClick: async (device) => {
                await unlinkDevice(device.ID);
            },
        },
        {
            disabled: false,
            visible: true,
            name: "Edit",
            onClick: async (device) => {
                showEditDialog.current(device);
            },
        },
    ];

    const syncSignalingEventHandler = (
        event: SynchronizationUtils.SCCEvent<SynchronizationUtils.SignalingEventData>,
    ) => {
        console.debug(
            `[INDEX - SCC Verbose] Received sync Signaling event from device ${device.ID}:`,
            event,
        );
        setSignalingServerStatus(event.data.connectionState);

        if (
            device.AutoConnect &&
            event.data.connectionState ===
                SynchronizationUtils.SignalingStatus.Connected &&
            webRTCConnectedOrConnecting
        ) {
            GlobalSyncConnectionController.connectDevice(device);
        }
    };

    const syncWebRTCEventHandler = (
        event: SynchronizationUtils.SCCEvent<SynchronizationUtils.WebRTCEventData>,
    ) => {
        console.debug(
            `[INDEX - SCC Verbose] Received sync WebRTC event from device ${device.ID}:`,
            event,
        );

        if (
            event.data.event ===
            SynchronizationUtils.WebRTCMessageEventType.Synchronized
        ) {
            device.updateLastSync();

            // NOTE: This doesn't cause a re-render, so had to do the setLastSync
            // setDevice((oldVal) => device);

            setLastSync(dayjs(device.LastSync));
        }

        if (
            event.data.event ===
                SynchronizationUtils.WebRTCMessageEventType
                    .ManualSyncNecessary &&
            event.data.message != null
        ) {
            // Trigger the manual synchronization dialog
            const credentials = vaultGet().Credentials;
            const theirCredentials: VaultUtilTypes.PartialCredential[] =
                event.data.message.Diffs.map(
                    (i) => i.Changes?.Props ?? null,
                ).filter((i) => i != null);

            showManualSyncDialog.current(
                credentials,
                theirCredentials,
                async (
                    diffsToApply: VaultUtilTypes.Diff[],
                    diffsToSend: VaultUtilTypes.Diff[],
                ) => {
                    console.debug(
                        "[SidebarSyncDeviceListItem] Device solve confirmed. diffsToApply:",
                        diffsToApply,
                        "diffsToSend:",
                        diffsToSend,
                    );

                    await GlobalSyncConnectionController.applyManualSynchronization(
                        diffsToApply,
                    );

                    // Send the manual synchronization solution
                    GlobalSyncConnectionController.transmitManualSyncSolve(
                        device.ID,
                        diffsToSend,
                    );
                },
                () => {
                    // Warn the user that the vaults are still diverged
                    toast.warn(
                        "Failed to solve the vault divergence. The vaults are still diverged.",
                    );
                },
            );
        }

        if (
            event.data.event ===
            SynchronizationUtils.WebRTCMessageEventType.Error
        ) {
            toast.warn(
                <p onClick={showLogInspectorDialog}>Connection to "{device.Name}" ({device.ID}) has failed. Please inspect the vault logs for more information.</p>
            );
        }

        if (
            event.type ===
            SynchronizationUtils.SyncConnectionControllerEventType
                .ConnectionStatus
        ) {
            if (event.data.connectionState != null)
                setWebRTCStatus(event.data.connectionState);

            if (
                event.data.connectionState ===
                SynchronizationUtils.WebRTCStatus.Failed
            ) {
                console.error(
                    `[SidebarSyncDeviceListItem] Connection to "${device.Name}" (${device.ID}) has failed. Additional information:`,
                    event.data.additionalData,
                );

                if (event.data.additionalData)
                    toast.warn(
                        `Connection to "${device.Name}" (${device.ID}) has failed. Please see console for more information.`,
                    );
            }

            // Mind the SyncTimeout configuration
            if (
                device.SyncTimeout &&
                event.data.connectionState ===
                    SynchronizationUtils.WebRTCStatus.Connected
            ) {
                const period = Math.abs(device.SyncTimeoutPeriod) * 1000;
                console.debug(
                    `[SidebarSyncDeviceListItem] ID: ${device.ID} | Name: ${device.Name} > SyncTimeout enabled. Will disconnect in ${period}s.`,
                );
                setTimeout(() => {
                    GlobalSyncConnectionController.disconnectDevice(device);
                    console.debug(
                        `[SidebarSyncDeviceListItem] ID: ${device.ID} | Name: ${device.Name} > SyncTimeout expired. Disconnecting...`,
                    );
                }, period);
            } else if (
                event.data.connectionState ===
                    SynchronizationUtils.WebRTCStatus.Disconnected ||
                event.data.connectionState ===
                    SynchronizationUtils.WebRTCStatus.Failed
            ) {
                // Clean up connection and try to reconnect if we're configured to do so
                if (device.AutoConnect) {
                    GlobalSyncConnectionController.disconnectDevice(device);
                    GlobalSyncConnectionController.connectDevice(device);
                }
            }
        }

        if (
            event.type ===
            SynchronizationUtils.SyncConnectionControllerEventType
                .VaultDataUpdate
        ) {
            if (!event.data.vaultData?.credentials) return;

            setVaultCredentials(() => {
                if (event.data.vaultData?.credentials)
                    return [...event.data.vaultData.credentials];
                else return [];
            });

            vaultGet().Diffs = event.data.vaultData.diffs;

            // TODO: Trigger a vault save
        }
    };

    useEffect(() => {
        // Bind a message receiver for this device
        const handlerID =
            GlobalSyncConnectionController.registerSyncSignalingHandler(
                device.SignalingServerID,
                syncSignalingEventHandler,
            );

        if (!handlerID) {
            console.error(
                `[INDEX - SCC Verbose] Failed to register sync signaling handler for device ${device.ID}`,
            );
            return;
        }

        GlobalSyncConnectionController.registerSyncWebRTCHandler(
            device.ID,
            syncWebRTCEventHandler,
        );

        if (device.AutoConnect) {
            GlobalSyncConnectionController.connectDevice(device);
        }

        // Set up a timer to refresh the last sync date every minute
        const timerID = setInterval(() => {
            if (device.LastSync) setLastSync(dayjs(device.LastSync));
        }, 60000);

        return () => {
            // Remove any message receiver for this device
            if (handlerID) {
                GlobalSyncConnectionController.removeSyncSignalingHandler(
                    device.SignalingServerID,
                    handlerID,
                );
            }
            GlobalSyncConnectionController.removeSyncWebRTCHandler(device.ID);

            // Clean up the connection
            GlobalSyncConnectionController.disconnectDevice(device);

            clearInterval(timerID);
        };
    }, []);

    return (
        <div
            className="ml-2 flex cursor-pointer items-center gap-2 text-slate-400 hover:text-slate-500"
            onContextMenu={(e) => {
                e.preventDefault();
                optionsButtonRef.current?.click();
            }}
        >
            <div>
                <DevicePhoneMobileIcon className="h-5 w-5" />
            </div>
            <div className="flex flex-grow flex-col overflow-x-hidden py-1">
                <p
                    className="line-clamp-1 overflow-hidden text-base font-medium"
                    title={device.Name}
                >
                    {device.Name}
                </p>
                <div className="flex flex-col items-start">
                    <div className="flex gap-2">
                        <p
                            title="Signaling status"
                            className={clsx({
                                "flex h-full items-center rounded border px-1 text-xs capitalize": true,
                                "border-green-500/50 text-green-500":
                                    signalingStatus ===
                                    SynchronizationUtils.SignalingStatus
                                        .Connected,
                                "border-red-500/50 text-red-500":
                                    signalingStatus ===
                                        SynchronizationUtils.SignalingStatus
                                            .Disconnected ||
                                    signalingStatus ===
                                        SynchronizationUtils.SignalingStatus
                                            .Failed,
                                "border-yellow-500/50 text-yellow-500":
                                    signalingStatus ===
                                        SynchronizationUtils.SignalingStatus
                                            .Connecting ||
                                    signalingStatus ===
                                        SynchronizationUtils.SignalingStatus
                                            .Unavailable,
                            })}
                        >
                            {signalingStatus ===
                                SynchronizationUtils.SignalingStatus
                                    .Connected && "Connected"}
                            {signalingStatus ===
                                SynchronizationUtils.SignalingStatus
                                    .Connecting && (
                                <span className="ml-1 animate-pulse">
                                    Connecting...
                                </span>
                            )}
                            {signalingStatus ===
                                SynchronizationUtils.SignalingStatus
                                    .Disconnected && "Disconnected"}
                            {signalingStatus ===
                                SynchronizationUtils.SignalingStatus
                                    .Unavailable && "Disconnected"}
                            {signalingStatus ===
                                SynchronizationUtils.SignalingStatus.Failed &&
                                "Failed"}
                        </p>

                        {/* WebRTC status */}
                        <p
                            title="Device connection status"
                            className={clsx({
                                "flex h-full items-center rounded border px-1 text-xs capitalize": true,
                                "border-green-500/50 text-green-500":
                                    webRTCStatus ===
                                    SynchronizationUtils.WebRTCStatus.Connected,
                                "border-red-500/50 text-red-500":
                                    webRTCStatus ===
                                        SynchronizationUtils.WebRTCStatus
                                            .Disconnected ||
                                    webRTCStatus ===
                                        SynchronizationUtils.WebRTCStatus
                                            .Failed,
                                "border-yellow-500/50 text-yellow-500":
                                    webRTCStatus ===
                                    SynchronizationUtils.WebRTCStatus
                                        .Connecting,
                            })}
                        >
                            {webRTCStatus ===
                                SynchronizationUtils.WebRTCStatus.Connected &&
                                "Connected"}
                            {webRTCStatus ===
                                SynchronizationUtils.WebRTCStatus
                                    .Connecting && (
                                <span className="ml-1 animate-pulse">
                                    Connecting...
                                </span>
                            )}
                            {webRTCStatus ===
                                SynchronizationUtils.WebRTCStatus
                                    .Disconnected && "Disconnected"}
                            {webRTCStatus ===
                                SynchronizationUtils.WebRTCStatus.Failed &&
                                "Failed"}
                        </p>
                    </div>

                    {/* Last synchronization date */}
                    <p
                        className="text-xs normal-case text-slate-300/50"
                        title="Last synchronization"
                    >
                        {lastSync?.fromNow() ?? "Never"}
                    </p>
                </div>
            </div>
            <Menu>
                <MenuButton
                    ref={optionsButtonRef}
                    className="flex h-full items-center"
                >
                    <EllipsisVerticalIcon className="h-7 w-6 text-slate-400" />
                </MenuButton>
                {/* <Transition
                    // as={React.Fragment}
                    enter="transition ease-out duration-100"
                    enterFrom="transform opacity-0 scale-95"
                    enterTo="transform opacity-100 scale-100"
                    leave="transition ease-in duration-75"
                    leaveFrom="transform opacity-100 scale-100"
                    leaveTo="transform opacity-0 scale-95"
                > */}
                <MenuItems
                    className="mt-2 w-48 rounded-md bg-gray-800 shadow-lg focus:outline-none"
                    anchor="bottom"
                >
                    {contextMenuOptions.map((option, index) => (
                        <MenuItem key={index}>
                            {({ focus: active }) => {
                                const hoverClass = clsx({
                                    "bg-gray-900 text-white select-none":
                                        active && !option.disabled,
                                    "flex px-4 py-2 text-sm font-semibold text-gray-200": true,
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
                                                : () => option.onClick(device)
                                        }
                                    >
                                        {option.name}
                                    </a>
                                );
                            }}
                        </MenuItem>
                    ))}
                </MenuItems>
                {/* </Transition> */}
            </Menu>
        </div>
    );
};

const SidebarSyncDeviceList: React.FC<{
    showWarningFn: WarningDialogShowFn;
    showLinkedDeviceEditDialog: RefObject<(device: LinkedDevice) => void>;
    showManualSyncDialog: RefObject<ManualSyncShowDialogFnPropType>;
    showLogInspectorDialog: () => void;
}> = ({ showWarningFn, showLinkedDeviceEditDialog, showManualSyncDialog, showLogInspectorDialog }) => {
    const [linkedVaultDevices, setLinkedDevices] = useAtom(linkedDevicesAtom);
    const { mutateAsync: removeFromOnlineServices } =
        trpcReact.v1.device.remove.useMutation();

    console.debug("SidebarSyncDeviceList RENDER");

    const linkedDevicesCount = linkedVaultDevices.length;

    const _unlinkDevice = async (id: string) => {
        // Remove the device from the Vault and the UI
        setLinkedDevices((devices) => {
            return LinkedDevices.removeLinkedDevice(devices, id);
        });

        // TODO: Try this only if the device is not bound to the online services
        await removeFromOnlineServices({
            id,
        }).catch((err) => {
            console.warn(
                "Tried to remove device from online services, but failed.",
                err,
            );
        });
    };

    const unlinkDevice = async (id: string) => {
        showWarningFn(
            "Removing the link between these devices will prevent you from syncing your credentials between them.",
            async () => {
                await _unlinkDevice(id);
            },
            null,
        );
    };

    return (
        <div className="my-2 flex h-px w-full grow overflow-y-auto border-y border-y-slate-700">
            {/* If there are devices, show a list of them */}
            {linkedDevicesCount > 0 && (
                <div className="flex h-full w-full flex-col gap-2 overflow-y-auto">
                    {linkedVaultDevices.map((device, i) => {
                        return (
                            <SidebarSyncDeviceListItem
                                key={`linked-device-${i}`}
                                // deviceAtom={deviceAtom}
                                item={device}
                                showEditDialog={showLinkedDeviceEditDialog}
                                unlinkDevice={unlinkDevice}
                                showManualSyncDialog={showManualSyncDialog}
                                showLogInspectorDialog={showLogInspectorDialog}
                            />
                        );
                    })}
                </div>
            )}

            {/* If there are no devices, show a message */}
            {linkedDevicesCount === 0 && (
                <div className="flex w-full flex-col items-center justify-center gap-2 text-center">
                    <p className="text-sm font-bold text-slate-400">
                        No linked devices
                    </p>
                    <p className="text-xs text-slate-500">
                        You have no linked devices. Link a device to sync your
                        credentials.
                    </p>
                </div>
            )}
        </div>
    );
};

const DashboardSidebarMenuFeatureVoting: React.FC<{
    onClick?: () => void;
}> = ({ onClick }) => {
    // This component is separate so that we don't rerender the whole dashboard
    // If the TRPC call resolves to a different value
    const onlineServicesData = useAtomValue(onlineServicesDataAtom);

    // Fetch the featureVoting.openRound trpc query if we're logged in (have a session)
    const { data: openRoundExists } =
        trpcReact.v1.featureVoting.openRoundExists.useQuery(undefined, {
            retry: false,
            enabled: !!onlineServicesData?.remoteData,
            refetchOnWindowFocus: false,
            trpc: {},
        });

    return (
        <SidebarMenuItem
            Icon={ArrowUpCircleIcon}
            text="Feature Voting"
            onClick={onClick}
            pulsatingIndicatorVisible={openRoundExists ?? false}
        />
    );
};

const SidebarMenuItem: React.FC<{
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

const SidebarMenuItemCompact: React.FC<{
    Icon: typeof ArrowUpCircleIcon; // Take the type of an arbitrary icon
    text: string;
    onClick?: () => void;
    pulsatingIndicatorVisible?: boolean;
}> = ({ Icon, text, onClick, pulsatingIndicatorVisible }) => {
    return (
        <div
            className="flex cursor-pointer items-center text-slate-400 hover:text-slate-500"
            onClick={onClick}
            title={text}
        >
            <Icon className="h-6 w-6" />
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
    );
};
//#endregion Sidebar

//#region Vault dashboard
const VaultDashboard: React.FC = ({}) => {
    // console.log("AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA");

    const vaultMetadata = useAtomValue(unlockedVaultMetadataAtom);
    const setUnlockedVaultMetadata = useSetAtom(unlockedVaultMetadataAtom);
    const setUnlockedVault = useSetAtom(unlockedVaultWriteOnlyAtom);
    const clearOnlineServicesData = useClearOnlineServicesDataAtom();

    const [isSidebarOpen, setIsSidebarOpen] = useState(false);
    const toggleSidebar = () => setIsSidebarOpen(!isSidebarOpen);

    const showWarningDialogFnRef = useRef<WarningDialogShowFn | null>(null);
    const showWarningDialog: WarningDialogShowFn = (
        description: string,
        onConfirm: (() => void) | null,
        onDismiss: (() => void) | null,
        confirmationButtonText?: string,
        descriptionSecondPart?: string,
        autoConfirmCountdown?: number,
    ) => {
        showWarningDialogFnRef.current?.(
            description,
            onConfirm,
            onDismiss,
            confirmationButtonText,
            descriptionSecondPart,
            autoConfirmCountdown,
        );
    };

    const triggerNewCredentialModeFn = useRef<() => void>(() => {});

    const showAccountSignUpSignInDialogRef = useRef<(() => void) | null>(null);
    const showRecoveryGenerationDialogRef = useRef<(() => void) | null>(null);
    const showFeatureVotingDialogRef = useRef<(() => void) | null>(null);
    const showFeedbackDialogFnRef = useRef<() => void>(() => {
        // No-op
    });
    const showVaultSettingsDialogRef = useRef<() => void>(() => {
        // No-op
    });

    const showCredentialsGeneratorDialogFnRef = useRef<() => void>(() => {
        // No-op
    });

    const showLinkingDeviceDialogFnRef = useRef<() => void>(() => {
        // No-op
    });
    const showSynchronizationConfigurationDialogFnRef = useRef<() => void>(
        () => {
            // No-op
        },
    );
    const showLinkedDeviceEditDialogFnRef = useRef<
        (device: LinkedDevice) => void
    >(() => {
        // No-op
    });
    const showManualSyncDialogFnRef = useRef<ManualSyncShowDialogFnPropType>(
        () => {
            // No-op
        },
    );

    const showLogInspectorDialogFnRef = useRef<() => void>(() => {
        // No-op
    });

    const lockVaultConfirm = () => {
        if (!vaultMetadata) return;

        showWarningDialog(
            "Are you sure you want to lock the vault?",
            async () => {
                await _lockVault(vaultMetadata);
            },
            () => {
                // No-op
            },
            "Lock Vault",
            "This will lock the vault and prevent anyone from accessing it.",
            5, // Auto-lock countdown in seconds
        );
    };

    const _lockVault = async (vaultMetadata: Storage.VaultMetadata) => {
        toast.info("Securing vault...", {
            autoClose: false,
            closeButton: false,
            toastId: "lock-vault",
            updateId: "lock-vault",
        });

        // A little delay to make sure the toast is shown
        await new Promise((resolve) => setTimeout(resolve, 100));

        // Trigger the vault's save function (this might not be needed when the auto-save feature is implemented)
        try {
            await vaultMetadata.save(vaultGet());
            toast.success("Vault secured.", {
                autoClose: 3000,
                closeButton: true,
                toastId: "lock-vault",
                updateId: "lock-vault",
            });

            clearOnlineServicesData();
            GlobalSyncConnectionController.teardown();
            setUnlockedVaultMetadata(null);
            setUnlockedVault(new Vault.Vault());

            // Clear all logs when locking the vault to ensure no sensitive data persists
            vaultLogger.clearAll();
        } catch (e) {
            console.error(`Failed to save vault: ${e}`);
            toast.error(
                "Failed to save vault. There is a high possibility of data loss!",
                {
                    closeButton: true,
                    toastId: "lock-vault",
                    updateId: "lock-vault",
                },
            );
        }
    };

    // console.debug("VaultDashboard RENDER - pre vaultmetadata check", !!vaultMetadata);

    if (!vaultMetadata) return null;

    // console.debug("VaultDashboard RENDER - post vaultmetadata check", !!vaultMetadata);

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
                        "flex min-w-0 max-w-[250px] flex-col gap-3 overflow-hidden pt-1 transition-all duration-300 ease-in-out sm:min-w-[250px]": true,
                        "w-0 px-0": !isSidebarOpen,
                        "min-w-[90vw] border-r-2 border-slate-800/60 px-1 sm:border-r-0":
                            isSidebarOpen,
                    })}
                >
                    <div className="block md:hidden">
                        <VaultTitle title={vaultMetadata.Name} />
                    </div>
                    {/* TODO: This should be made prettier on mobile */}
                    <div className="block w-full px-5">
                        <ButtonFlat
                            text="New Item"
                            className="w-full"
                            inhibitAutoWidth={true}
                            onClick={() => {
                                triggerNewCredentialModeFn.current?.();
                                if (isSidebarOpen) toggleSidebar();
                            }}
                        />
                    </div>
                    <div className="mt-5 flex h-px flex-grow overflow-y-auto overflow-x-clip">
                        <div className="flex h-full w-full flex-col justify-between pb-2">
                            <div className="flex grow flex-col">
                                <p className="text-sm text-slate-500">
                                    Synchronization
                                </p>
                                {/*<DashboardSidebarSynchronization
                                    showWarningFn={showWarningDialog}
                                    showSignInDialogFn={
                                        showAccountSignUpSignInDialogRef
                                    }
                                />*/}
                                <SidebarMenuItem
                                    Icon={LinkIcon}
                                    text="Link a Device"
                                    onClick={() =>
                                        showLinkingDeviceDialogFnRef.current?.()
                                    }
                                />
                                <SidebarMenuItem
                                    Icon={GlobeAltIcon}
                                    text="Configuration"
                                    onClick={() =>
                                        showSynchronizationConfigurationDialogFnRef.current?.()
                                    }
                                />
                                <SidebarSyncDeviceList
                                    showWarningFn={showWarningDialog}
                                    showLinkedDeviceEditDialog={
                                        showLinkedDeviceEditDialogFnRef
                                    }
                                    showManualSyncDialog={
                                        showManualSyncDialogFnRef
                                    }
                                    showLogInspectorDialog={() => showLogInspectorDialogFnRef.current?.()}
                                />
                            </div>
                            <div className="flex flex-col gap-2">
                                <div>
                                    {process.env.NODE_ENV === "development" && (
                                        <SidebarMenuItem
                                            Icon={XMarkIcon}
                                            text="[DEBUG] Clear Diff list"
                                            onClick={async () => {
                                                await setUnlockedVault(
                                                    (vault) => {
                                                        console.debug(
                                                            "[DEBUG] Clear Diff list - before -",
                                                            vault.Diffs,
                                                        );

                                                        vault.Diffs = [];

                                                        vaultMetadata.save(
                                                            vault,
                                                        );

                                                        console.debug(
                                                            "[DEBUG] Clear Diff list - after -",
                                                            vault.Diffs,
                                                        );

                                                        return vault;
                                                    },
                                                );
                                            }}
                                        />
                                    )}
                                    <DashboardSidebarMenuFeatureVoting
                                        onClick={() =>
                                            showFeatureVotingDialogRef.current?.()
                                        }
                                    />
                                    <SidebarMenuItem
                                        Icon={ChatBubbleBottomCenterTextIcon}
                                        text="Contact Us"
                                        onClick={() =>
                                            showFeedbackDialogFnRef.current?.()
                                        }
                                    />
                                </div>
                                <div className="flex w-full justify-evenly">
                                    {/* <p className="text-sm text-slate-500">
                                        Vault
                                    </p> */}
                                    <SidebarMenuItemCompact
                                        Icon={KeyIcon}
                                        text="Credentials Generator"
                                        onClick={() =>
                                            showCredentialsGeneratorDialogFnRef.current()
                                        }
                                    />
                                    <SidebarMenuItemCompact
                                        Icon={Cog8ToothIcon}
                                        text="Settings"
                                        onClick={() =>
                                            showVaultSettingsDialogRef.current?.()
                                        }
                                    />
                                    <SidebarMenuItemCompact
                                        Icon={LockClosedIcon}
                                        text="Lock Vault"
                                        // onClick={() => lockVault(vaultMetadata)}
                                        onClick={() => lockVaultConfirm()}
                                    />
                                </div>
                                <div className="flex w-full justify-center">
                                    <ChangelogDialog />
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
                <div
                    className={clsx({
                        "w-full": true,
                        "flex flex-grow border-t border-slate-700 sm:rounded-tl-md sm:border-l sm:blur-none": true,
                        "pointer-events-none blur-sm sm:pointer-events-auto":
                            isSidebarOpen,
                    })}
                >
                    <VaultContentWindow
                        showWarningDialog={showWarningDialog}
                        triggerNewCredentialModeFnOut={
                            triggerNewCredentialModeFn
                        }
                        showCredentialsGeneratorDialogFnRef={
                            showCredentialsGeneratorDialogFnRef
                        }
                    />
                </div>
            </div>
            <WarningDialog showFnRef={showWarningDialogFnRef} />
            <VaultSettingsDialog
                showDialogFnRef={showVaultSettingsDialogRef}
                showWarningDialog={showWarningDialog}
                showCredentialsGeneratorDialogFnRef={
                    showCredentialsGeneratorDialogFnRef
                }
                showLogInspectorDialog={() => showLogInspectorDialogFnRef.current?.()}
            />
            <FeatureVotingDialog showDialogFnRef={showFeatureVotingDialogRef} />
            <OnlineServicesSignUpRestoreDialog
                showDialogFnRef={showAccountSignUpSignInDialogRef}
                vaultMetadata={vaultMetadata}
                showRecoveryGenerationDialogFnRef={
                    showRecoveryGenerationDialogRef
                }
            />
            <RecoveryGenerationDialog
                showDialogFnRef={showRecoveryGenerationDialogRef}
            />
            <CredentialsGeneratorDialog
                showDialogFnRef={showCredentialsGeneratorDialogFnRef}
            />
            <FeedbackDialog showDialogFnRef={showFeedbackDialogFnRef} />
            <LinkDeviceInsideVaultDialog
                showDialogFnRef={showLinkingDeviceDialogFnRef}
                showWarningDialog={showWarningDialog}
                showSignInDialog={showAccountSignUpSignInDialogRef}
            />
            <SynchronizationConfigurationDialog
                showDialogFnRef={showSynchronizationConfigurationDialogFnRef}
                showWarningDialog={showWarningDialog}
            />
            <EditLinkedDeviceDialog
                showDialogFnRef={showLinkedDeviceEditDialogFnRef}
                vaultMetadata={vaultMetadata}
            />
            <ManualSynchronizationDialog
                showDialogFnRef={showManualSyncDialogFnRef}
                showWarningDialog={showWarningDialog}
            />
            <LogInspectorDialog showDialogFnRef={showLogInspectorDialogFnRef} />
        </>
    );
};

const VaultContentWindow: React.FC<{
    showWarningDialog: WarningDialogShowFn;
    /**
     * Function defined by this component that is used to set the sideview mode to the new credential mode.
     */
    triggerNewCredentialModeFnOut: React.RefObject<() => void>;
    showCredentialsGeneratorDialogFnRef: React.RefObject<() => void>;
}> = ({
    showWarningDialog,
    triggerNewCredentialModeFnOut,
    showCredentialsGeneratorDialogFnRef,
}) => {
    const router = useRouter();

    const vaultCredentials = useAtomValue(vaultCredentialsAtom);
    const [filter, setFilter] = useState("");

    const editCredentialModeFn = useRef<
        (credential: Vault.VaultCredential) => void
    >(() => {});

    let filteredCredentials: Vault.VaultCredential[] = [];
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
                        filter.toLowerCase(),
                    )
                )
                    return true;

                if (credential.URL.toLowerCase().includes(filter.toLowerCase()))
                    return true;

                return false;
            });
    }

    const sideviewFragmentSet = router.asPath.includes("#sideview");
    const itemListClasses = clsx({
        "flex-col": true,
        "flex w-full": !sideviewFragmentSet,
        "hidden lg:flex lg:w-full": sideviewFragmentSet,
    });

    const sideviewPanelClasses = clsx({
        "w-full flex-grow border-l border-slate-700": true,
        // flex: !sideviewFragmentSet,
        // "hidden lg:flex": router.asPath == "/app",
        flex: sideviewFragmentSet,
        "hidden lg:flex": !sideviewFragmentSet,
    });

    console.debug("VaultContentWindow RENDER", sideviewFragmentSet);

    return (
        <>
            <div className={itemListClasses}>
                <SearchBar filter={setFilter} />
                <div className="my-5 h-px w-full flex-grow justify-center overflow-y-auto overflow-x-hidden px-5">
                    {filteredCredentials?.length !== 0 && (
                        <Virtuoso
                            data={filteredCredentials}
                            itemContent={(_, credential) => (
                                <div className="my-2">
                                    <ListItemCredential
                                        key={credential.ID}
                                        credential={credential}
                                        onClick={() =>
                                            editCredentialModeFn.current(
                                                credential,
                                            )
                                        }
                                        showWarningDialog={showWarningDialog}
                                    />
                                </div>
                            )}
                        />
                    )}
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
                                        Press the &quot;New Item&quot; button in
                                        the sidebar to add a new credential.
                                    </p>
                                )}
                            </div>
                        ))}
                </div>
                {vaultCredentials && vaultCredentials.length > 0 && (
                    <div className="flex w-full flex-grow-0 items-center justify-center border-t border-slate-700 px-2 py-1">
                        {filter.length > 0 && (
                            <p className="text-slate-400">
                                Filtered items: {filteredCredentials.length} out
                                of {vaultCredentials.length}
                            </p>
                        )}
                        {filter.length === 0 && (
                            <p className="text-slate-400">
                                Items loaded: {vaultCredentials.length}
                            </p>
                        )}
                    </div>
                )}
            </div>
            <div className={sideviewPanelClasses}>
                <CredentialSideview
                    newCredentialModeFnOut={triggerNewCredentialModeFnOut}
                    editCredentialModeFnOut={editCredentialModeFn}
                    showCredentialsGeneratorDialogFn={
                        showCredentialsGeneratorDialogFnRef
                    }
                    showWarningDialogFn={showWarningDialog}
                />
            </div>
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

const ListItemCredential: React.FC<{
    credential: Vault.VaultCredential;
    onClick: () => void;
    showWarningDialog: WarningDialogShowFn;
}> = ({ credential, onClick, showWarningDialog: showWarningDialogFn }) => {
    const setCredentialsList = useSetAtom(vaultCredentialsAtom);
    //const setUnlockedVault = useSetAtom(unlockedVaultWriteOnlyAtom);
    const unlockedVaultMetadata = useAtomValue(unlockedVaultMetadataAtom);
    const siteFaviconURL = React.useMemo(() => {
        const faviconUrl = credential.URL.replace(/^https?:\/\//, "");
        const faviconUrlParts = faviconUrl.split("/");
        const faviconDomain = faviconUrlParts[0];

        if (!faviconDomain?.length) return "";

        // Try and fetch the favicon from the public api
        return `https://s2.googleusercontent.com/s2/favicons?domain=${faviconDomain}&sz=64`;
    }, [credential.URL]);

    const contextBtnRef = useRef<HTMLButtonElement | null>(null);
    const { refs, floatingStyles } = useFloating({
        placement: "bottom-end",
        middleware: [autoPlacement(), shift()],
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
                let value = credential.URL;
                // Add the HTTPS protocol if it's missing
                if (!value?.startsWith("https://")) {
                    value = `https://${credential.URL}`;
                }

                showWarningDialogFn(
                    `You are about to visit "${value}"?`,
                    () => {
                        window.open(value, "_blank");
                    },
                    null,
                );
            },
        });
    }

    if (credential.TOTP) {
        options.push({
            Name: "Copy OTP",
            onClick: () => {
                if (!credential.TOTP) return;

                const data = Vault.calculateTOTP(credential.TOTP);
                if (data) {
                    navigator.clipboard.writeText(data.code);
                    toast.info(
                        `Copied OTP to clipboard; ${data.timeRemaining} seconds left`,
                        {
                            autoClose: 3000,
                            pauseOnFocusLoss: false,
                            updateId: "copy-otp",
                            toastId: "copy-otp",
                        },
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

                    const vault = vaultGet();

                    // Remove the credential from the vault
                    const data = Vault.deleteCredential(
                        vault.Credentials,
                        credential.ID,
                    );

                    if (data.isErr()) {
                        console.error(
                            `Failed to remove credential. Error: "${data.error}". ID: "${credential.ID}". Could not find the item index.`,
                        );
                        return vault;
                    }

                    vault.Credentials = [...data.value.credentials];

                    const listHash = await Vault.hashCredentials(
                        vault.Credentials,
                    );
                    const diff: VaultUtilTypes.Diff = {
                        Hash: listHash,
                        Changes: data.value.change,
                    };
                    vault.Diffs = [...vault.Diffs, diff];

                    setCredentialsList(vault.Credentials);

                    try {
                        // Trigger the vault's save function (this might not be needed when the auto-save feature is implemented)
                        await unlockedVaultMetadata.save(vault);
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
                            },
                        );
                    }
                },
                null,
            );
        },
    });

    const setCtxMenuPosition = (
        e:
            | React.MouseEvent<HTMLDivElement>
            | React.MouseEvent<HTMLButtonElement>,
    ) => {
        refs.setPositionReference({
            getBoundingClientRect() {
                return {
                    width: 0,
                    height: 0,
                    x: e.clientX,
                    y: e.clientY,
                    top: e.clientY,
                    right: e.clientX,
                    bottom: e.clientY,
                    left: e.clientX,
                };
            },
        });
    };

    const FallbackFavicon: React.FC = () => {
        return (
            <div className="flex h-7 w-7 items-center justify-center rounded-full bg-[#FF5668] text-black">
                {credential.Name[0]}
            </div>
        );
    };

    return (
        <div
            className="flex cursor-pointer items-center justify-between rounded-md bg-gray-700 px-2 shadow-md transition-shadow hover:shadow-[#FF5668]"
            onContextMenu={(e) => {
                e.preventDefault();
                setCtxMenuPosition(e);
                contextBtnRef.current?.click?.();
            }}
        >
            <div
                className="flex w-full cursor-pointer items-center justify-between p-2"
                onClick={onClick}
            >
                <div className="flex items-center gap-2">
                    <div>
                        {siteFaviconURL ? (
                            <div className="h-7 w-7 justify-center">
                                {/* TODO: Call a backend service that will cache every request */}
                                <img
                                    src={siteFaviconURL}
                                    className="rounded-full"
                                    width={28}
                                    height={28}
                                    alt={"-"}
                                    loading="lazy"
                                    onError={(e) => {
                                        // Prevent the default error behavior
                                        e.preventDefault();

                                        // Replace the img with the fallback
                                        e.currentTarget.style.display = "none";
                                        const fallbackElement =
                                            document.createElement("div");
                                        fallbackElement.className =
                                            "flex h-7 w-7 justify-center rounded-full bg-[#FF5668] text-black items-center";
                                        fallbackElement.textContent =
                                            credential.Name[0] ?? "-";
                                        e.currentTarget.parentElement?.appendChild(
                                            fallbackElement,
                                        );
                                    }}
                                />
                            </div>
                        ) : (
                            <FallbackFavicon />
                        )}
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
                <MenuButton
                    ref={(r) => {
                        refs.setReference(r);
                        contextBtnRef.current = r;
                    }}
                    className="flex h-full items-center"
                    onClick={(e) => {
                        if (e.clientX !== 0 && e.clientY !== 0) {
                            setCtxMenuPosition(e);
                        }
                    }}
                >
                    <EllipsisVerticalIcon className="h-6 w-6 text-gray-400" />
                </MenuButton>
                {/* <Transition
                    as={React.Fragment}
                    enter="transition ease-out duration-100"
                    enterFrom="transform opacity-0 scale-95"
                    enterTo="transform opacity-100 scale-100"
                    leave="transition ease-in duration-75"
                    leaveFrom="transform opacity-100 scale-100"
                    leaveTo="transform opacity-0 scale-95"
                > */}
                <MenuItems
                    ref={refs.setFloating}
                    className="absolute right-0 z-10 mt-2 w-48 origin-top-right rounded-sm bg-gray-800 shadow-lg focus:outline-none"
                    style={floatingStyles}
                >
                    <div className="py-1">
                        {options.map((option, index) => (
                            <MenuItem key={index}>
                                {({ active }) => {
                                    const hoverClass = clsx({
                                        "bg-gray-900 text-white": active,
                                        "flex px-4 py-2 text-sm font-semibold text-gray-200": true,
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
                            </MenuItem>
                        ))}
                    </div>
                </MenuItems>
                {/* </Transition> */}
            </Menu>
        </div>
    );
};

const TOTPDialog: React.FC<{
    visibleState: [boolean, React.Dispatch<React.SetStateAction<boolean>>];
    submitCallback: (formData: FormSchemas.TOTPFormSchemaType) => Promise<void>;
}> = ({ visibleState, submitCallback }) => {
    const {
        handleSubmit,
        control,
        formState: { errors, isDirty },
        reset: resetForm,
    } = useForm<FormSchemas.TOTPFormSchemaType>({
        resolver: zodResolver(FormSchemas.TOTPFormSchema),
        defaultValues: {
            Label: "",
            Secret: "",
            Period: TOTPConstants.PERIOD_DEFAULT,
            Digits: TOTPConstants.DIGITS_DEFAULT,
            Algorithm: TOTPConstants.ALGORITHM_DEFAULT,
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

    const onSubmit = async (formData: FormSchemas.TOTPFormSchemaType) => {
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
                        <div className="mt-2 hidden flex-col">
                            <Controller
                                control={control}
                                name="Label"
                                render={({
                                    field: { onChange, onBlur, value },
                                }) => (
                                    <>
                                        <label className="text-gray-600">
                                            Label
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

const CredentialSideview: React.FC<{
    newCredentialModeFnOut: React.RefObject<() => void>;
    editCredentialModeFnOut: React.RefObject<
        (credential: Vault.VaultCredential) => void
    >;
    showCredentialsGeneratorDialogFn: React.RefObject<() => void>;
    showWarningDialogFn: WarningDialogShowFn;
}> = ({
    newCredentialModeFnOut,
    editCredentialModeFnOut,
    showCredentialsGeneratorDialogFn,
    showWarningDialogFn,
}) => {
    enum CredentialSideviewMode {
        Undefined,
        New,
        Edit,
    }

    const router = useRouter();

    const setVaultCredentials = useSetAtom(vaultCredentialsAtom);
    const vaultMetadata = useAtomValue(unlockedVaultMetadataAtom);

    const [mode, _setMode] = useState(CredentialSideviewMode.Undefined);
    const [selectedCredential, _setSelectedCredential] = useState<
        Vault.VaultCredential | undefined
    >();

    const closeBtnRef = useRef<HTMLButtonElement>(null);

    const defaultValues = () => {
        const obj: Vault.CredentialFormSchemaType = Object.assign(
            {},
            new Vault.VaultCredential(),
        );
        obj.ID = null; // This is set to null to indicate that this is a new credential
        return obj;
    };

    const {
        handleSubmit,
        register,
        control,
        formState: { errors, isSubmitting, isDirty },
        reset: resetForm,
        setValue,
        getValues: getFormValues,
        setFocus,
    } = useForm<Vault.CredentialFormSchemaType>({
        resolver: zodResolver(Vault.CredentialFormSchema),
        defaultValues: defaultValues(),
    });

    const resetFormValues = (credential: Vault.VaultCredential) => {
        const formData: Vault.CredentialFormSchemaType = {
            ID: credential.ID, // This means that the form is in "edit" mode
            Type: credential.Type,
            GroupID: credential.GroupID,
            Name: credential.Name,
            Username: credential.Username,
            Password: credential.Password,
            TOTP: credential.TOTP,
            Tags: credential.Tags,
            URL: credential.URL,
            Notes: credential.Notes,
            CustomFields: credential.CustomFields,
            DateCreated: credential.DateCreated,
            DateModified: credential.DateModified,
            DatePasswordChanged: credential.DatePasswordChanged,
        };

        resetForm(formData, {
            keepDirty: false,
            keepDirtyValues: false,
        });
    };

    const setModeFn = (
        newMode: CredentialSideviewMode,
        credential: Vault.VaultCredential | undefined = undefined,
        ignoreDirtyCheck = false,
    ) => {
        const actuallyExecFn = () => {
            _setMode(newMode);
            _setSelectedCredential(credential);

            if (newMode !== CredentialSideviewMode.Undefined) {
                router.push("/app#sideview", undefined, {
                    shallow: true,
                });
            } else {
                router.push("/app", undefined, {
                    shallow: true,
                });
            }

            if (credential) {
                resetFormValues(credential);
            } else {
                resetForm(defaultValues);
            }
        };

        if (
            mode !== CredentialSideviewMode.Undefined &&
            isDirty &&
            !ignoreDirtyCheck
        ) {
            showWarningDialogFn(
                "You have unsaved changes.",
                actuallyExecFn,
                null,
            );
        } else {
            actuallyExecFn();
        }
    };
    newCredentialModeFnOut.current = () => {
        setModeFn(CredentialSideviewMode.New);
    };
    editCredentialModeFnOut.current = (credential: Vault.VaultCredential) => {
        setModeFn(CredentialSideviewMode.Edit, credential);
    };
    const closeSideview = (force: boolean = false) => {
        setModeFn(CredentialSideviewMode.Undefined, undefined, force);
    };

    const TOTPDialogVisible = useState(false);
    const showTOTPDialog = () => TOTPDialogVisible[1](true);
    const setTOTPFormValue = async (form: FormSchemas.TOTPFormSchemaType) => {
        setValue("TOTP", form, {
            shouldDirty: true,
        });
    };

    const TagBox: React.FC<{
        value: string | undefined;
        onChange: (tags: string) => void;
    }> = ({ value, onChange }) => {
        const tagSeparator = CredentialConstants.TAG_SEPARATOR;

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
                <div className="m-1 flex flex-row items-center rounded-full bg-gray-200 px-2 py-2">
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
        value: FormSchemas.TOTPFormSchemaType;
        onChange: (event: FormSchemas.TOTPFormSchemaType | null) => void;
    }> = ({ value, onChange }) => {
        const codeRef = useRef<string>("");
        const [timeLeft, setTimeLeft] = useState(0);

        // FIXME: Use the code in the TOTP class to calculate the code and time left
        const updateCode = () => {
            // Wrap in try/catch to prevent bad values from crashing the app
            try {
                const totp = new OTPAuth.TOTP({
                    issuer: value.Label,
                    secret: value.Secret.replaceAll(" ", ""),
                    period: value.Period,
                    digits: value.Digits,
                    algorithm: VaultUtilTypes.TOTPAlgorithm[value.Algorithm],
                });
                const code = totp.generate();

                codeRef.current = code;
            } catch (e) {
                console.debug("[TOTP] Update code threw.", e);
                clearTOTP();

                // FIXME: This thing triggers multiple times
                // console.error("Failed to generate TOTP code.", e);
                // toast.error("Failed to generate TOTP code.", {
                //     autoClose: 3000,
                //     closeButton: false,
                // });
            }
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

    const OpenInNewTabButton = ({
        initialValue,
        valueFn,
    }: {
        initialValue?: string;
        valueFn?: () => string;
    }) => {
        return (
            <ArrowTopRightOnSquareIcon
                className="mx-2 h-5 w-5 flex-grow-0 cursor-pointer text-slate-400 hover:text-slate-500"
                style={{
                    display: initialValue ? "block" : "none",
                }}
                aria-hidden="true"
                onClick={() => {
                    let value = initialValue ?? valueFn?.();

                    // If the value is not a URL, add the HTTPS protocol
                    if (!value?.toLowerCase().startsWith("https://")) {
                        value = `https://${value}`;
                    }

                    showWarningDialogFn(
                        `You are about to visit "${value}".`,
                        () => {
                            window.open(value, "_blank");
                        },
                        null,
                    );
                }}
            />
        );
    };

    const onSubmit = async (formData: Vault.CredentialFormSchemaType) => {
        if (!vaultMetadata) return;

        // Create/Update the credential in the vault
        const vault = vaultGet();
        if (formData.ID) {
            const existingIndex = vault.Credentials.findIndex(
                (i) => i.ID === formData.ID,
            );
            const existing = vault.Credentials[existingIndex];

            if (!existing) {
                console.error(
                    `Failed to find credential with ID "${formData.ID}". Skipping update...`,
                );
                toast.error(
                    "Failed to update credential. Please check the console for more infomation.",
                    {
                        autoClose: 5000,
                        closeButton: false,
                        toastId: "update-vault-data",
                        updateId: "update-vault-data",
                    },
                );
                return vault;
            }

            const data = await Vault.updateCredentialFromForm(
                existing,
                formData,
            );

            // Update the credential
            vault.Credentials[existingIndex] = data.credential;

            const listHash = await Vault.hashCredentials(vault.Credentials);
            const diff: VaultUtilTypes.Diff = {
                Hash: listHash,
                Changes: data.changes,
            };
            vault.Diffs.push(diff);
        } else {
            const data = await Vault.createCredential(formData);

            vault.Credentials.push(data.credential);
            const listHash = await Vault.hashCredentials(vault.Credentials);
            const diff: VaultUtilTypes.Diff = {
                Hash: listHash,
                Changes: data.changes,
            };
            vault.Diffs.push(diff);
        }

        // Trigger a render by spreading the list in a new list
        setVaultCredentials([...vault.Credentials]);

        toast.info("Saving vault data...", {
            autoClose: false,
            closeButton: false,
            toastId: "saving-vault-data",
            updateId: "saving-vault-data",
        });

        // Delay a little bit to allow the toast to update
        await new Promise((resolve) => setTimeout(resolve, 100));

        try {
            // Trigger manual vault save
            // TODO: Remove when the auto-save feature is implemented
            await vaultMetadata.save(vault);

            toast.success("Vault data saved", {
                autoClose: 3000,
                closeButton: false,
                toastId: "saving-vault-data",
                updateId: "saving-vault-data",
            });

            // Reset the view
            // FIXME: This rerenders the holy Jesus
            closeSideview(true);
        } catch (e) {
            console.error(`Failed to save vault data. ${e}`);
            toast.error(
                "Failed to save vault. There is a high possibility of data loss!",
                {
                    autoClose: 3000,
                    closeButton: false,
                    toastId: "saving-vault-data",
                    updateId: "saving-vault-data",
                },
            );
        }
    };

    useEffect(() => {
        if (mode === CredentialSideviewMode.New) setFocus("Name");
    }, [mode]);

    return (
        <div
            className="flex w-full flex-grow flex-col md:items-center"
            onKeyDown={(e) => {
                // In case the user presses the CTRL+Return key, trigger the submit function
                if (
                    e.key === "Enter" &&
                    e.ctrlKey &&
                    mode !== CredentialSideviewMode.Undefined &&
                    !isSubmitting &&
                    isDirty
                ) {
                    handleSubmit(onSubmit)();
                }
            }}
        >
            {/* No items placeholder */}
            {mode === CredentialSideviewMode.Undefined && (
                <div className="flex h-full flex-col items-center justify-center text-slate-400">
                    <p>Select an item on the left to view its details.</p>
                </div>
            )}
            {mode !== CredentialSideviewMode.Undefined && (
                <div className="flex w-full flex-row items-center justify-between border-b border-slate-700 p-2">
                    {mode === CredentialSideviewMode.New && (
                        <span className="max-w-xs truncate text-xl font-bold text-slate-200 2xl:max-w-2xl">
                            New Credential
                        </span>
                    )}
                    {selectedCredential && (
                        <span
                            className="max-w-xs truncate text-xl text-slate-200 2xl:max-w-2xl"
                            title={selectedCredential.Name}
                        >
                            <b>Editing: </b>
                            {selectedCredential.Name}
                        </span>
                    )}
                    <div className="flex gap-2">
                        <ButtonFlat
                            text="Close"
                            ref_={closeBtnRef}
                            type={ButtonType.Tertiary}
                            onClick={() => closeSideview()}
                            disabled={isSubmitting}
                        />
                        <ButtonFlat
                            text={selectedCredential ? "Save" : "Create"}
                            type={ButtonType.Primary}
                            onClick={handleSubmit(onSubmit)}
                            disabled={isSubmitting || !isDirty}
                            loading={isSubmitting}
                            className={clsx({
                                hidden: !isDirty,
                            })}
                        />
                    </div>
                </div>
            )}
            <div className="flex h-px w-full flex-grow justify-center overflow-y-auto">
                <div className="my-4 w-full max-w-lg p-4">
                    {
                        // If a credential is selected, show the credential's information
                        selectedCredential && (
                            <div className="flex w-full flex-wrap justify-evenly gap-x-4 text-base text-slate-200">
                                <div className="flex justify-center gap-x-2">
                                    <span>
                                        <b>Created at:</b>{" "}
                                    </span>
                                    <span>
                                        {new Date(
                                            selectedCredential.DateCreated,
                                        ).toLocaleDateString()}
                                    </span>
                                </div>
                                {
                                    // If the credential has been modified, show the date it was modified
                                    selectedCredential.DateModified && (
                                        <div className="flex justify-center gap-x-2">
                                            <span>
                                                <b>Updated at:</b>{" "}
                                            </span>
                                            <span>
                                                {new Date(
                                                    selectedCredential.DateModified,
                                                ).toLocaleDateString()}
                                            </span>
                                        </div>
                                    )
                                }
                                {
                                    // If the credential has a password, show the date it was last changed
                                    selectedCredential.DatePasswordChanged && (
                                        <div className="flex justify-center gap-x-2">
                                            <span>
                                                <b>
                                                    Last password change:
                                                </b>{" "}
                                            </span>
                                            <span>
                                                {new Date(
                                                    selectedCredential.DatePasswordChanged,
                                                ).toLocaleDateString()}
                                            </span>
                                        </div>
                                    )
                                }
                            </div>
                        )
                    }
                    {mode !== CredentialSideviewMode.Undefined && (
                        <>
                            <div className="mt-2 flex flex-col">
                                <FormInputField
                                    label="Name *"
                                    type="text"
                                    darkBackground={true}
                                    autoCapitalize="none"
                                    register={register("Name")}
                                />
                                {errors.Name && (
                                    <p className="text-red-500">
                                        {errors.Name.message}
                                    </p>
                                )}
                            </div>
                            <div className="mt-4 flex flex-col">
                                <FormInputField
                                    label="Username"
                                    type="text"
                                    darkBackground={true}
                                    autoCapitalize="none"
                                    clipboardButton={true}
                                    register={register("Username")}
                                />
                                {errors.Username && (
                                    <p className="text-red-500">
                                        {errors.Username.message}
                                    </p>
                                )}
                            </div>
                            <div className="mt-4 flex flex-col">
                                {/* <EntropyCalculator value={value} /> */}
                                <FormInputField
                                    label="Password"
                                    type="password"
                                    darkBackground={true}
                                    autoCapitalize="none"
                                    clipboardButton={true}
                                    credentialsGeneratorFnRef={
                                        showCredentialsGeneratorDialogFn
                                    }
                                    register={register("Password")}
                                />
                                {/* <FormInput
                                    type="password"
                                    placeholder="Enter your password"
                                    autoCapitalize="none"
                                    // className="pr-10"
                                    showPasswordGenerator={true}
                                    showClipboardButton={true}
                                    {...register("Password")}
                                    setValue={(value) => setValue("Password", value)}
                                /> */}
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
                                    render={({
                                        field: { onChange, value },
                                    }) => (
                                        <>
                                            <label className="text-slate-400">
                                                TOTP
                                            </label>
                                            {
                                                // If the credential has a TOTP, show the TOTP
                                                value != null ? (
                                                    <div
                                                        key="credentials-totp"
                                                        className="mt-1 flex-grow rounded-md bg-slate-200 px-4 py-2 text-slate-900"
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
                                                            className="mt-1 flex-grow rounded-md bg-slate-700 px-4 py-2 text-slate-100 hover:bg-slate-800"
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
                                    render={({
                                        field: { onChange, value },
                                    }) => (
                                        <>
                                            <label className="text-slate-400">
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
                                <FormInputField
                                    label="Website (URL)"
                                    type="url"
                                    darkBackground={true}
                                    autoCapitalize="none"
                                    clipboardButton={true}
                                    additionalButtons={
                                        <OpenInNewTabButton
                                            initialValue={
                                                selectedCredential?.URL
                                            }
                                            valueFn={() => getFormValues("URL")}
                                        />
                                    }
                                    register={register("URL")}
                                />
                                {errors.URL && (
                                    <p className="text-red-500">
                                        {errors.URL.message}
                                    </p>
                                )}
                            </div>
                            <div className="mt-4 flex flex-col">
                                <FormTextAreaField
                                    label="Notes"
                                    darkBackground={true}
                                    autoCapitalize="none"
                                    placeholder="Add notes"
                                    register={register("Notes")}
                                />
                                {errors.Notes && (
                                    <p className="text-red-500">
                                        {errors.Notes.message}
                                    </p>
                                )}
                            </div>
                        </>
                    )}
                </div>
            </div>
            <TOTPDialog
                visibleState={TOTPDialogVisible}
                submitCallback={setTOTPFormValue}
            />
        </div>
    );
};
//#endregion Vault dashboard

const AppIndex: React.FC = () => {
    const isVaultUnlocked = useAtomValue(isVaultUnlockedAtom);
    const setUnlockedVault = useSetAtom(unlockedVaultAtom);
    const setUnlockedVaultMetadata = useSetAtom(unlockedVaultMetadataAtom);
    const refreshOnlineServicesRemoteData = useFetchOnlineServicesData();

    // Create sync connection controller with vault operations
    const vaultMetadata = useAtomValue(unlockedVaultMetadataAtom);
    if (!GlobalSyncConnectionController) {
        GlobalSyncConnectionController = createSyncConnectionController(setUnlockedVault, vaultMetadata);
        GlobalSyncConnectionController.init();
    }

    console.debug("MAIN RERENDER", isVaultUnlocked);

    // useEffect(() => {
    //     return () => {
    //         console.warn(
    //             "[SCC - Verbose Signaling] Cleaning up the sync connection controller...",
    //             isVaultUnlocked,
    //         );
    //         // Clean up the synchronization connections, if any
    //         GlobalSyncConnectionController.teardown();
    //     };
    // }, [isVaultUnlocked]);
    //
    const tryVaultDecrypt = async (
        metadata: Storage.VaultMetadata,
        formData: FormSchemas.EncryptionFormGroupSchemaType,
    ) => {
        const vaultRes = await metadata.decryptVault(
            formData.Secret,
            formData.Encryption,
            formData.EncryptionKeyDerivationFunction,
            formData.EncryptionConfig,
        );

        if (vaultRes.isErr()) return err(vaultRes.error);

        const vault = vaultRes.value;

        // Set the vault metadata and vault atoms
        setUnlockedVaultMetadata(metadata);
        setUnlockedVault(vault);

        GlobalSyncConnectionController.teardown();
        GlobalSyncConnectionController.init();

        if (
            vault &&
            LinkedDevices.isBound(vault.LinkedDevices) &&
            vault.LinkedDevices.APIKey
        ) {
            setOnlineServicesAPIKey(vault.LinkedDevices.APIKey);

            try {
                await refreshOnlineServicesRemoteData();
            } catch (e) {
                console.error(
                    "Failed to refresh online services remote data.",
                    e,
                );
            }
        }

        return ok();
    };

    const tryCreateVault = async (
        formData: FormSchemas.NewVaultFormSchemaType &
            FormSchemas.EncryptionFormGroupSchemaType,
    ) => {
        try {
            const vaultMetadata = await Storage.VaultMetadata.createNewVault(
                formData,
                formData,
                false,
                0,
            );
            await vaultMetadata.save(null);
        } catch (e) {
            console.error("Failed to create a vault", e);
            return false;
        }

        return true;
    };

    const tryRestoreVault = async (
        formData: FormSchemas.VaultRestoreFormSchema,
    ) => {
        let validBackupFile: VaultEncryption.EncryptedBlob | null = null;
        try {
            validBackupFile = VaultEncryption.EncryptedBlob.fromBinary(
                new Uint8Array(await formData.BackupFile.arrayBuffer()),
            );
        } catch (e) {
            console.error(
                "Failed to restore the vault. Could not deserialize the blob.",
                e,
            );
            return false;
        }

        const newVaultMetadataInst = new Storage.VaultMetadata();
        newVaultMetadataInst.Name = formData.Name;
        newVaultMetadataInst.Description = formData.Description;
        newVaultMetadataInst.Blob = validBackupFile;

        try {
            await newVaultMetadataInst.save(null);
        } catch (e) {
            console.error("Failed to save the restored vault metadata", e);
            return false;
        }

        return true;
    };

    return (
        <>
            <HTMLHeader
                title="Cryptex Vault"
                description="Decentralized Password Manager"
            />

            <HTMLMain additionalClasses="content flex min-h-screen grow flex-col overflow-clip">
                <VaultDashboard />

                {
                    // If the vault is not unlocked, show the welcome screen
                    !isVaultUnlocked && (
                        <>
                            <div className="flex grow flex-col items-center justify-center">
                                <VaultManager
                                    tryDecryptVaultCallback={tryVaultDecrypt}
                                    tryCreateVaultCallback={tryCreateVault}
                                    tryRestoreVaultCallback={tryRestoreVault}
                                />
                            </div>
                        </>
                    )
                }
            </HTMLMain>
            <NotificationContainer pauseOnHover={false} />
        </>
    );
};

export default AppIndex;
