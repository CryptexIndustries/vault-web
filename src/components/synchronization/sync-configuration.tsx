import {
    ArrowDownOnSquareIcon,
    ArrowsRightLeftIcon,
    // ArrowTopRightOnSquareIcon,
    InformationCircleIcon,
    SignalIcon,
} from "@heroicons/react/20/solid";
import { zodResolver } from "@hookform/resolvers/zod";
import clsx from "clsx";
import { useAtomValue, useSetAtom } from "jotai/react";
import React, { useMemo, useRef, useState } from "react";
import { useForm, UseFormRegisterReturn } from "react-hook-form";
import { toast } from "react-toastify";
import { TableVirtuoso } from "react-virtuoso";
import {
    SignalingServerConfiguration,
    STUNServerConfiguration,
    TURNServerConfiguration,
    Vault,
} from "../../app_lib/proto/vault";
import {
    STUNServerConfiguration as cOnlineServicesSTUNConfiguration,
    TURNServerConfiguration as cOnlineServicesTURNConfiguration,
    SignalingServerConfiguration as cOnlineServicesWebSocketConfiguration,
} from "../../app_lib/vault-utils/vault";
import {
    SynchronizationSignalingUpsertSchema,
    SynchronizationSignalingUpsertSchemaType,
    SynchronizationSTUNUpsertSchema,
    SynchronizationSTUNUpsertSchemaType,
    SynchronizationTURNUpsertSchema,
    SynchronizationTURNUpsertSchemaType,
} from "../../app_lib/vault-utils/form-schemas";
import {
    unlockedVaultAtom,
    unlockedVaultWriteOnlyAtom,
} from "../../utils/atoms";
import {
    DIALOG_BLUR_TIME,
    ONLINE_SERVICES_SELECTION_ID,
} from "../../utils/consts";
import { WarningDialogShowFn } from "../dialog/warning";
import { ButtonFlat, ButtonType } from "../general/buttons";
import {
    FormInputField,
    FormNumberInputField,
    FormSelectboxField,
} from "../general/input-fields";
import { Body, Footer, GenericModal, Title } from "../general/modal";

type MenuItem = {
    id: number;
    label: string;
    icons?: React.ForwardRefExoticComponent<
        React.SVGProps<SVGSVGElement> & React.RefAttributes<SVGSVGElement>
    >;
    content?: React.ReactNode;
    onSelect: () => void;
};

export const SynchronizationConfigurationDialog: React.FC<{
    showDialogFnRef: React.MutableRefObject<(() => void) | null>;
    showWarningDialog: WarningDialogShowFn;
}> = ({ showDialogFnRef, showWarningDialog }) => {
    const [visible, setVisible] = useState(false);
    showDialogFnRef.current = () => {
        setVisible(true);
    };
    const hideDialog = () => {
        setVisible(false);

        // Reset the form with a delay for better UX
        setTimeout(() => {
            setCurrentMenu(menuSignalingServer.id);
        }, DIALOG_BLUR_TIME);
    };

    const menuSignalingServerID = 0;
    const menuSTUNServerID = 1;
    const menuTURNServerID = 2;
    const [currentMenu, setCurrentMenu] = useState<number>(
        menuSignalingServerID,
    );
    const menuSignalingServer: MenuItem = {
        id: menuSignalingServerID,
        label: "Signaling",
        icons: SignalIcon,
        onSelect: () => setCurrentMenu(menuSignalingServer.id),
    };
    const menuSTUNServer: MenuItem = {
        id: menuSTUNServerID,
        label: "STUN",
        icons: ArrowDownOnSquareIcon,
        content: <p>STUN Servers</p>,
        onSelect: () => setCurrentMenu(menuSTUNServer.id),
    };
    const menuTURNServer: MenuItem = {
        id: menuTURNServerID,
        label: "TURN",
        icons: ArrowsRightLeftIcon,
        content: <p>TURN Server</p>,
        onSelect: () => setCurrentMenu(menuTURNServer.id),
    };

    const menus: MenuItem[] = [
        menuSignalingServer,
        menuSTUNServer,
        menuTURNServer,
    ];

    return (
        <GenericModal
            key="synchronization-configuration"
            visibleState={[visible, hideDialog]}
            width="4xl"
            childrenTitle={<Title>Configuration - Synchronization</Title>}
        >
            {/* <DialogSidebarBody
                menus={menus}
                defaultMenu={menuSignalingServer}
                setCurrentMenuOut={setCurrentMenu}
            /> */}
            <Body className="flex w-full flex-grow flex-row">
                <div className="flex h-full flex-col">
                    {menus.map((menu) => (
                        <button
                            key={menu.id}
                            className={clsx({
                                "flex w-full flex-row items-center space-x-2 border-x border-b border-slate-200 px-4 py-2 text-left text-slate-700 transition-colors hover:bg-slate-300 hover:text-white":
                                    true,
                                "bg-gray-100": currentMenu === menu.id,
                                "border-x-transparent": currentMenu !== menu.id,
                                "border-x-red-500": currentMenu === menu.id,
                            })}
                            onClick={menu.onSelect}
                        >
                            <div className="h-full">
                                {menu.icons ? (
                                    <menu.icons className="h-5 w-5" />
                                ) : null}
                            </div>
                            <span className="text-sm text-gray-500">
                                {menu.label}
                            </span>
                        </button>
                    ))}
                </div>
                <div className="flex h-full w-full flex-col px-4 py-2">
                    {currentMenu === menuSignalingServer.id && (
                        <SignalingContent
                            showWarningDialog={showWarningDialog}
                        />
                    )}
                    {currentMenu === menuSTUNServer.id && (
                        <STUNContent showWarningDialog={showWarningDialog} />
                    )}
                    {currentMenu === menuTURNServer.id && (
                        <TURNContent showWarningDialog={showWarningDialog} />
                    )}
                </div>
            </Body>

            <Footer className="space-y-3 sm:space-x-5 sm:space-y-0">
                {/* <ButtonFlat
                    text="Save"
                    className="sm:ml-2"
                    type={ButtonType.Primary}
                    // onClick={handleSubmit(onSubmit)}
                    // disabled={isSubmitting}
                /> */}
                <ButtonFlat
                    text="Close"
                    type={ButtonType.Secondary}
                    onClick={hideDialog}
                    // disabled={isSubmitting}
                />
            </Footer>
        </GenericModal>
    );
};

/* export const DialogSidebarBody: React.FC<{
    menus: MenuItem[];
    defaultMenu: MenuItem;
    setCurrentMenuOut: React.MutableRefObject<
        React.Dispatch<React.SetStateAction<MenuItem>>
    >;
}> = ({ menus, defaultMenu, setCurrentMenuOut }) => {
    const [currentMenu, setCurrentMenu] = useState<MenuItem>(defaultMenu);

    setCurrentMenuOut.current = setCurrentMenu;

    return (
        <Body className="flex w-full flex-grow flex-row">
            <div className="flex h-full flex-col">
                {menus.map((menu) => (
                    <button
                        key={menu.id}
                        className={clsx({
                            "flex w-full flex-row items-center space-x-2 border-x border-b border-slate-200 px-4 py-2 text-left transition-colors hover:bg-slate-300 hover:text-white":
                                true,
                            "bg-gray-100": currentMenu.id === menu.id,
                            "border-x-transparent": currentMenu.id !== menu.id,
                            "border-x-red-500": currentMenu.id === menu.id,
                        })}
                        onClick={menu.onSelect}
                    >
                        <div className="h-full">
                            {menu.icons ? (
                                <menu.icons className="h-5 w-5" />
                            ) : null}
                        </div>
                        <span className="text-sm text-gray-500">
                            {menu.label}
                        </span>
                    </button>
                ))}
            </div>
            <div className="flex h-full w-full flex-col px-4 py-2">
                {currentMenu.content}
            </div>
        </Body>
    );
}; */

const SignalingContent: React.FC<{
    showWarningDialog: WarningDialogShowFn;
}> = ({ showWarningDialog }) => {
    const unlockedVault = useAtomValue(unlockedVaultAtom);
    const setUnlockedVault = useSetAtom(unlockedVaultWriteOnlyAtom);

    const signalingServers = unlockedVault.LinkedDevices.SignalingServers;

    const showSignalingDialogFnRef = useRef<(id?: string) => void>(() => {
        // No-op
    });

    const removeSignalingServer = (id: string, name: string) => {
        showWarningDialog(
            `You are about to remove "${name}".`,
            async () => {
                setUnlockedVault((vault) => {
                    const signalingServerIndex = signalingServers.findIndex(
                        (i) => i.ID === id,
                    );
                    if (signalingServerIndex >= 0) {
                        signalingServers.splice(signalingServerIndex, 1);
                    }

                    return vault;
                });
            },
            null,
        );
    };

    // console.log(unlockedVault.OnlineServices.Configuration);
    // console.log("SIGNALING RENDER");

    return (
        <>
            <div className="flex space-x-2 rounded-lg border border-blue-500 p-2">
                <div>
                    <InformationCircleIcon className="h-5 w-5 text-blue-500" />
                </div>
                <p className="line-clamp-2 text-sm text-gray-500 md:line-clamp-none">
                    The signaling server is usually a WebSocket server that is
                    used to exchange network information between devices so that
                    they can establish a connection between each other.
                    {/* TODO: Re-enable this when the documentation is ready */}
                    {/* {" "}<a
                            className="flex underline"
                            href="https://cryptex-vault.com/docs/signaling-server"
                            target="_blank"
                        >
                            <ArrowTopRightOnSquareIcon className="h-5 w-5" />
                            Official documentation
                        </a> */}
                </p>
            </div>
            <TableVirtuoso
                data={signalingServers}
                style={{
                    marginTop: "12px",
                    height: "240px",
                    backgroundColor: "white",
                }}
                components={{
                    EmptyPlaceholder: () => (
                        <tbody>
                            <tr>
                                <td className="pt-2 text-sm text-slate-500">
                                    No signaling servers saved yet.
                                </td>
                            </tr>
                        </tbody>
                    ),
                }}
                fixedHeaderContent={() => (
                    <tr className="border-b-2 text-slate-800">
                        <th className="min-w-[150px] max-w-[190px] py-4 pr-4">
                            Name
                        </th>
                        <th className="min-w-[50px] max-w-[250px] p-4">Host</th>
                        <th className="min-w-16 p-4">Port</th>
                        <th className="min-w-16 p-4">Secure Port</th>
                        <th className="min-w-16 p-4"></th>
                        <th className="min-w-16 border p-4 pr-0">
                            <button
                                className="text-blue-500 hover:underline"
                                onClick={() =>
                                    showSignalingDialogFnRef.current()
                                }
                            >
                                Add
                            </button>
                        </th>
                    </tr>
                )}
                itemContent={(_, item) => (
                    <>
                        <td
                            className="min-w-[150px] max-w-[190px] overflow-hidden text-ellipsis border-b p-4 pl-0 text-slate-700"
                            title={item.Name}
                        >
                            {item.Name}
                        </td>
                        <td
                            className="min-w-[50px] max-w-[250px] overflow-hidden text-ellipsis border-b p-4 text-slate-700"
                            title={item.Host}
                        >
                            {item.Host}
                        </td>
                        <td className="border-b p-4 text-slate-700">
                            {item.ServicePort}
                        </td>
                        <td className="border-b p-4 text-slate-700">
                            {item.SecureServicePort}
                        </td>
                        <td className="border-b p-4 text-slate-700">
                            <button
                                className="text-blue-500 hover:underline"
                                onClick={() =>
                                    showSignalingDialogFnRef.current(item.ID)
                                }
                            >
                                <p className="text-base">Edit</p>
                            </button>
                        </td>
                        <td className="border-b p-4 pr-0 text-slate-700">
                            <button
                                className="text-blue-500 hover:underline"
                                onClick={() =>
                                    removeSignalingServer(item.ID, item.Name)
                                }
                            >
                                <p className="text-base">Remove</p>
                            </button>
                        </td>
                    </>
                )}
            />
            <SynchronizationSignalingDialog
                showDialogFnRef={showSignalingDialogFnRef}
                unlockedVault={unlockedVault}
            />
        </>
    );
};

const SynchronizationSignalingDialog: React.FC<{
    showDialogFnRef: React.MutableRefObject<(id?: string) => void>;
    id?: string;
    unlockedVault: Vault;
}> = ({ showDialogFnRef, unlockedVault }) => {
    const [visible, setVisible] = useState(false);

    const [existingEntryName, setExistingEntryName] = useState<string | null>(
        null,
    );

    const setUnlockedVault = useSetAtom(unlockedVaultWriteOnlyAtom);

    const defaultValues = {
        ID: "",
        Name: "",
        AppID: "",
        Key: "",
        Secret: "",
        Host: "",
        ServicePort: "",
        SecureServicePort: "",
    };

    showDialogFnRef.current = (id?: string) => {
        const existingSignalingServer = id
            ? (unlockedVault.LinkedDevices?.SignalingServers.find(
                  (i) => i.ID === id,
              ) ?? null)
            : null;

        setExistingEntryName(existingSignalingServer?.Name ?? null);

        // Set the initial form values
        if (existingSignalingServer) {
            resetForm({
                ID: existingSignalingServer.ID,
                Name: existingSignalingServer.Name,
                AppID: existingSignalingServer.AppID,
                Key: existingSignalingServer.Key,
                Secret: existingSignalingServer.Secret,
                Host: existingSignalingServer.Host,
                ServicePort: existingSignalingServer.ServicePort,
                SecureServicePort: existingSignalingServer.SecureServicePort,
            });
        }

        setVisible(true);
    };

    const hideDialog = (force = false) => {
        const hide = () => {
            setVisible(false);

            // Reset the form with a delay for better UX
            setTimeout(() => {
                resetForm(defaultValues);
                setExistingEntryName(null);
            }, DIALOG_BLUR_TIME);
        };

        // Check if the form has been modified (only if we are not forcing)
        if (isDirty && !force) {
            // If it has, ask the user if they want to discard the changes (if the mode is "edit" || "add")
            if (confirm("Are you sure you want to discard your changes?")) {
                hide();
            }
        } else {
            hide();
        }
    };

    const {
        register,
        handleSubmit,
        formState: { errors, isSubmitting, isDirty },
        reset: resetForm,
    } = useForm<SynchronizationSignalingUpsertSchemaType>({
        resolver: zodResolver(SynchronizationSignalingUpsertSchema),
        defaultValues: defaultValues,
    });

    const onSubmit = async (
        formData: SynchronizationSignalingUpsertSchemaType,
    ) => {
        await Promise.all([
            new Promise((resolve) => setTimeout(resolve, DIALOG_BLUR_TIME)),
        ]);
        if (formData.ID.length) {
            toast.info("Updating signaling server...", {
                autoClose: false,
                closeButton: false,
                isLoading: true,
                toastId: "update-signaling-server",
                updateId: "update-signaling-server",
            });

            try {
                // If the ID is not empty, we are editing an existing signaling server
                setUnlockedVault((vault) => {
                    const existingItem =
                        vault.LinkedDevices.SignalingServers.find(
                            (i) => i.ID === formData.ID,
                        );

                    if (existingItem) {
                        existingItem.Name = formData.Name;
                        existingItem.AppID = formData.AppID;
                        existingItem.Key = formData.Key;
                        existingItem.Secret = formData.Secret;
                        existingItem.Host = formData.Host;
                        existingItem.ServicePort = formData.ServicePort;
                        existingItem.SecureServicePort =
                            formData.SecureServicePort;
                    }

                    return vault;
                });
            } catch (e) {
                console.error("Failed to update signaling server.", e);
                toast.error("Failed to update signaling server.", {
                    autoClose: 3000,
                    closeButton: true,
                    isLoading: false,
                    toastId: "update-signaling-server",
                    updateId: "update-signaling-server",
                });
                return;
            }

            toast.success("Successfully updated signaling server.", {
                autoClose: 3000,
                closeButton: true,
                isLoading: false,
                toastId: "update-signaling-server",
                updateId: "update-signaling-server",
            });
        } else {
            // If the ID is empty, we need to create a new WSServer
            toast.info("Inserting a new signaling server...", {
                autoClose: false,
                closeButton: false,
                isLoading: true,
                toastId: "insert-signaling-server",
                updateId: "insert-signaling-server",
            });

            try {
                const newItem = new cOnlineServicesWebSocketConfiguration(
                    formData.Name,
                    formData.Key,
                    formData.Host,
                    formData.ServicePort,
                    formData.SecureServicePort,
                );

                setUnlockedVault((vault) => {
                    vault.LinkedDevices.SignalingServers.push(newItem);
                    return vault;
                });
            } catch (e) {
                console.error("Failed to insert a new signaling server.", e);
                toast.error("Failed to insert a new signaling server.", {
                    autoClose: 3000,
                    closeButton: true,
                    isLoading: false,
                    toastId: "insert-signaling-server",
                    updateId: "insert-signaling-server",
                });
                return;
            }

            toast.success("Successfully added signaling server.", {
                autoClose: 3000,
                closeButton: true,
                isLoading: false,
                toastId: "insert-signaling-server",
                updateId: "insert-signaling-server",
            });
        }

        hideDialog(true);
    };

    return (
        <GenericModal
            key="synchronization-signaling-configuration-dialog"
            visibleState={[visible, () => hideDialog()]}
            inhibitDismissOnClickOutside={isSubmitting}
            childrenTitle={
                <Title>
                    {/* // If we're editing an existing signaling server, show the name of the signaling server */}
                    {existingEntryName
                        ? `${existingEntryName} - Edit Signaling Server`
                        : `New Signaling Server`}
                </Title>
            }
        >
            <Body className="flex w-full flex-grow flex-row">
                <div
                    className="flex w-full flex-col text-left"
                    onKeyDown={(e) => {
                        // If the user presses the CTRL + Enter key - fire the form submit event
                        if (e.ctrlKey && e.key === "Enter") {
                            handleSubmit(onSubmit)();
                        }
                    }}
                >
                    <div className="mt-2 flex flex-col">
                        <FormInputField
                            label="Name"
                            type="text"
                            placeholder="My Signaling Server"
                            autoCapitalize="words"
                            maxLength={50}
                            register={register("Name")}
                        />
                        {errors.Name && (
                            <p className="text-red-500">
                                {errors.Name.message}
                            </p>
                        )}
                    </div>
                    <div className="mt-2 flex flex-col">
                        <FormInputField
                            label="App ID"
                            type="text"
                            placeholder="Application ID"
                            autoCapitalize="none"
                            register={register("AppID")}
                        />
                        {errors.AppID && (
                            <p className="text-red-500">
                                {errors.AppID.message}
                            </p>
                        )}
                    </div>
                    <div className="mt-2 flex flex-col">
                        <FormInputField
                            label="Key"
                            type="password"
                            placeholder="Key"
                            autoCapitalize="none"
                            register={register("Key")}
                        />
                        {errors.Key && (
                            <p className="text-red-500">{errors.Key.message}</p>
                        )}
                    </div>
                    <div className="mt-2 flex flex-col">
                        <FormInputField
                            label="Secret"
                            type="password"
                            placeholder="Secret"
                            autoCapitalize="none"
                            register={register("Secret")}
                        />
                        {errors.Secret && (
                            <p className="text-red-500">
                                {errors.Secret.message}
                            </p>
                        )}
                    </div>
                    <div className="mt-2 flex flex-col">
                        <FormInputField
                            label="Host"
                            type="text"
                            placeholder="Host"
                            autoCapitalize="none"
                            register={register("Host")}
                        />
                        {errors.Host && (
                            <p className="text-red-500">
                                {errors.Host.message}
                            </p>
                        )}
                    </div>
                    <div className="flex flex-row justify-between">
                        <div className="mt-2 flex flex-col">
                            <FormNumberInputField
                                label="Service Port"
                                placeholder="ex. 80"
                                min={1}
                                register={register("ServicePort")}
                            />
                            {errors.ServicePort && (
                                <p className="text-red-500">
                                    {errors.ServicePort.message}
                                </p>
                            )}
                        </div>
                        <div className="mt-2 flex flex-col">
                            <FormNumberInputField
                                label="Secure Service Port"
                                placeholder="ex. 443"
                                min={0}
                                register={register("SecureServicePort")}
                            />
                            {errors.SecureServicePort && (
                                <p className="text-red-500">
                                    {errors.SecureServicePort.message}
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

const STUNContent: React.FC<{
    showWarningDialog: WarningDialogShowFn;
}> = ({ showWarningDialog }) => {
    const unlockedVault = useAtomValue(unlockedVaultAtom);
    const setUnlockedVault = useSetAtom(unlockedVaultWriteOnlyAtom);

    const stunServers = unlockedVault.LinkedDevices.STUNServers;

    const showSTUNDialogFnRef = useRef<(id?: string) => void>(() => {
        // No-op
    });

    const removeSTUNServer = (id: string, name: string) => {
        showWarningDialog(
            `You are about to remove "${name}".`,
            async () => {
                setUnlockedVault((vault) => {
                    const stunServerIndex = stunServers.findIndex(
                        (i) => i.ID === id,
                    );
                    if (stunServerIndex >= 0) {
                        stunServers.splice(stunServerIndex, 1);
                    }

                    return vault;
                });
            },
            null,
        );
    };

    return (
        <>
            <div className="flex space-x-2 rounded-lg border border-blue-500 p-2">
                <div>
                    <InformationCircleIcon className="h-5 w-5 text-blue-500" />
                </div>
                <p className="text-sm text-gray-500">
                    A STUN (Session Traversal Utilities for NAT) server helps
                    devices behind a firewall or NAT discover their public IP
                    address and port. This allows the devices to establish a
                    direct peer-to-peer connection for activities like video
                    calls, online gaming, or arbitrary data exchange.
                    {/* TODO: Re-enable this when the documentation is ready */}
                    {/* {" "}<a
                        className="flex underline"
                        href="https://cryptex-vault.com/docs/stun-server"
                        target="_blank"
                    >
                        <ArrowTopRightOnSquareIcon className="h-5 w-5" />
                        Official documentation
                    </a> */}
                </p>
            </div>
            <TableVirtuoso
                data={stunServers}
                style={{
                    marginTop: "12px",
                    height: "240px",
                    backgroundColor: "white",
                }}
                components={{
                    EmptyPlaceholder: () => (
                        <tbody>
                            <tr>
                                <td className="pt-2 text-sm text-slate-500">
                                    No STUN servers saved yet.
                                </td>
                            </tr>
                        </tbody>
                    ),
                }}
                fixedHeaderContent={() => (
                    <tr className="border-b-2 bg-white text-slate-800">
                        <th className="min-w-[150px] max-w-[190px] py-4 pr-4">
                            Name
                        </th>
                        <th className="min-w-[50px] max-w-[250px] p-4">Host</th>
                        <th className="min-w-16 p-4"></th>
                        <th className="min-w-16 border p-4 pr-0">
                            <button
                                className="text-blue-500 hover:underline"
                                onClick={() => showSTUNDialogFnRef.current()}
                            >
                                Add
                            </button>
                        </th>
                    </tr>
                )}
                itemContent={(_, item) => (
                    <>
                        <td
                            className="min-w-[150px] max-w-[190px] overflow-hidden text-ellipsis border-b p-4 pl-0 text-slate-700"
                            title={item.Name}
                        >
                            {item.Name}
                        </td>
                        <td
                            className="min-w-[50px] max-w-[250px] overflow-hidden text-ellipsis border-b p-4 text-slate-700"
                            title={item.Host}
                        >
                            {item.Host}
                        </td>
                        <td className="border-b p-4">
                            <button
                                className="text-blue-500 hover:underline"
                                onClick={() =>
                                    showSTUNDialogFnRef.current(item.ID)
                                }
                            >
                                <p className="text-base">Edit</p>
                            </button>
                        </td>
                        <td className="border-b p-4 pr-0">
                            <button
                                className="text-blue-500 hover:underline"
                                onClick={() =>
                                    removeSTUNServer(item.ID, item.Name)
                                }
                            >
                                <p className="text-base">Remove</p>
                            </button>
                        </td>
                    </>
                )}
            />
            <SynchronizationSTUNDialog
                showDialogFnRef={showSTUNDialogFnRef}
                unlockedVault={unlockedVault}
            />
        </>
    );
};

const SynchronizationSTUNDialog: React.FC<{
    showDialogFnRef: React.MutableRefObject<() => void>;
    id?: string;
    unlockedVault: Vault;
}> = ({ showDialogFnRef, unlockedVault }) => {
    const [visible, setVisible] = useState(false);

    const [existingEntryName, setExistingEntryName] = useState<string | null>(
        null,
    );

    const setUnlockedVault = useSetAtom(unlockedVaultWriteOnlyAtom);

    const defaultValues = {
        ID: "",
        Name: "",
        Host: "",
    };

    showDialogFnRef.current = (id?: string) => {
        const existingSTUNServer = id
            ? (unlockedVault.LinkedDevices?.STUNServers.find(
                  (i) => i.ID === id,
              ) ?? null)
            : null;

        setExistingEntryName(existingSTUNServer?.Name ?? null);

        // Set the initial form values
        if (existingSTUNServer) {
            resetForm({
                ID: existingSTUNServer.ID,
                Name: existingSTUNServer.Name,
                Host: existingSTUNServer.Host,
            });
        }

        setVisible(true);
    };

    const hideDialog = (force = false) => {
        const hide = () => {
            setVisible(false);

            // Reset the form with a delay for better UX
            setTimeout(() => {
                resetForm(defaultValues);
                setExistingEntryName(null);
            }, DIALOG_BLUR_TIME);
        };

        // Check if the form has been modified (only if we are not forcing)
        if (isDirty && !force) {
            // If it has, ask the user if they want to discard the changes (if the mode is "edit" || "add")
            if (confirm("Are you sure you want to discard your changes?")) {
                hide();
            }
        } else {
            hide();
        }
    };

    const {
        register,
        handleSubmit,
        formState: { errors, isSubmitting, isDirty },
        reset: resetForm,
    } = useForm<SynchronizationSTUNUpsertSchemaType>({
        resolver: zodResolver(SynchronizationSTUNUpsertSchema),
        defaultValues: defaultValues,
    });

    const onSubmit = async (formData: SynchronizationSTUNUpsertSchemaType) => {
        await Promise.all([
            new Promise((resolve) => setTimeout(resolve, DIALOG_BLUR_TIME)),
        ]);
        if (formData.ID.length) {
            toast.info("Updating STUN server...", {
                autoClose: false,
                closeButton: false,
                isLoading: true,
                toastId: "update-stun-server",
                updateId: "update-stun-server",
            });

            try {
                // If the ID is not empty, we are editing an existing STUN server
                setUnlockedVault((vault) => {
                    const existingItem = vault.LinkedDevices.STUNServers.find(
                        (i) => i.ID === formData.ID,
                    );

                    if (existingItem) {
                        existingItem.Name = formData.Name;
                        existingItem.Host = formData.Host;
                    }

                    return vault;
                });
            } catch (e) {
                console.error("Failed to update STUN server.", e);
                toast.error("Failed to update STUN server.", {
                    autoClose: 3000,
                    closeButton: true,
                    isLoading: false,
                    toastId: "update-stun-server",
                    updateId: "update-stun-server",
                });
                return;
            }

            toast.success("Successfully updated STUN server.", {
                autoClose: 3000,
                closeButton: true,
                isLoading: false,
                toastId: "update-stun-server",
                updateId: "update-stun-server",
            });
        } else {
            // If the ID is empty, we need to create a new STUN server
            toast.info("Inserting a new STUN server...", {
                autoClose: false,
                closeButton: false,
                isLoading: true,
                toastId: "insert-stun-server",
                updateId: "insert-stun-server",
            });

            try {
                const newItem = new cOnlineServicesSTUNConfiguration(
                    formData.Name,
                    formData.Host,
                );

                setUnlockedVault((vault) => {
                    vault.LinkedDevices.STUNServers.push(newItem);
                    return vault;
                });
            } catch (e) {
                console.error("Failed to insert a new STUN server.", e);
                toast.error("Failed to insert a new STUN server.", {
                    autoClose: 3000,
                    closeButton: true,
                    isLoading: false,
                    toastId: "insert-stun-server",
                    updateId: "insert-stun-server",
                });
                return;
            }

            toast.success("Successfully added STUN server.", {
                autoClose: 3000,
                closeButton: true,
                isLoading: false,
                toastId: "insert-stun-server",
                updateId: "insert-stun-server",
            });
        }

        hideDialog(true);
    };

    return (
        <GenericModal
            key="synchronization-stun-configuration-dialog"
            visibleState={[visible, () => hideDialog()]}
            inhibitDismissOnClickOutside={isSubmitting}
            childrenTitle={
                <Title>
                    {existingEntryName
                        ? `${existingEntryName} - Edit STUN Server`
                        : `New STUN Server`}
                </Title>
            }
        >
            <Body className="flex w-full flex-grow flex-row">
                <div
                    className="flex w-full flex-col text-left"
                    onKeyDown={(e) => {
                        // If the user presses the CTRL + Enter key - fire the form submit event
                        if (e.ctrlKey && e.key === "Enter") {
                            handleSubmit(onSubmit)();
                        }
                    }}
                >
                    <div className="mt-2 flex flex-col">
                        <FormInputField
                            label="Name"
                            type="text"
                            placeholder="My Signaling Server"
                            autoCapitalize="words"
                            maxLength={50}
                            register={register("Name")}
                        />
                        {errors.Name && (
                            <p className="text-red-500">
                                {errors.Name.message}
                            </p>
                        )}
                    </div>
                    <div className="mt-2 flex flex-col">
                        <FormInputField
                            label="Host"
                            type="text"
                            placeholder="Host"
                            autoCapitalize="none"
                            register={register("Host")}
                        />
                        {errors.Host && (
                            <p className="text-red-500">
                                {errors.Host.message}
                            </p>
                        )}
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

const TURNContent: React.FC<{
    showWarningDialog: WarningDialogShowFn;
}> = ({ showWarningDialog }) => {
    const unlockedVault = useAtomValue(unlockedVaultAtom);
    const setUnlockedVault = useSetAtom(unlockedVaultWriteOnlyAtom);

    const turnServers = unlockedVault.LinkedDevices.TURNServers;

    const showTURNDialogFnRef = useRef<(id?: string) => void>(() => {
        // No-op
    });

    const removeTURNServer = (id: string, name: string) => {
        showWarningDialog(
            `You are about to remove "${name}".`,
            async () => {
                setUnlockedVault((vault) => {
                    const turnServerIndex = turnServers.findIndex(
                        (i) => i.ID === id,
                    );
                    if (turnServerIndex >= 0) {
                        turnServers.splice(turnServerIndex, 1);
                    }

                    return vault;
                });
            },
            null,
        );
    };

    return (
        <>
            <div className="flex space-x-2 rounded-lg border border-blue-500 p-2">
                <div>
                    <InformationCircleIcon className="h-5 w-5 text-blue-500" />
                </div>
                <p className="text-sm text-gray-500">
                    A TURN (Traversal Using Relays around NAT) server relays
                    data between devices when they cannot establish a direct
                    peer-to-peer connection due to strict firewalls or NAT
                    restrictions. This ensures reliable communication for
                    activities such as video calls, online gaming, or file
                    sharing by routing data through an intermediary server.
                    {/* TODO: Re-enable this when the documentation is ready */}
                    {/* {" "}<a className="flex underline" href="https://cryptex-vault.com/docs/turn-server" target="_blank">
                        <ArrowTopRightOnSquareIcon className="h-5 w-5" />
                        Official documentation
                    </a>
                 */}
                </p>
            </div>
            <TableVirtuoso
                data={turnServers}
                style={{
                    marginTop: "12px",
                    height: "240px",
                    backgroundColor: "white",
                }}
                components={{
                    EmptyPlaceholder: () => (
                        <tbody>
                            <tr>
                                <td className="pt-2 text-sm text-slate-500">
                                    No TURN servers saved yet.
                                </td>
                            </tr>
                        </tbody>
                    ),
                }}
                fixedHeaderContent={() => (
                    <tr className="border-b-2 bg-white text-slate-800">
                        <th className="min-w-[150px] max-w-[190px] py-4 pr-4">
                            Name
                        </th>
                        <th className="min-w-[50px] max-w-[250px] p-4">Host</th>
                        <th className="min-w-16 p-4"></th>
                        <th className="min-w-16 border p-4 pr-0">
                            <button
                                className="text-blue-500 hover:underline"
                                onClick={() => showTURNDialogFnRef.current()}
                            >
                                Add
                            </button>
                        </th>
                    </tr>
                )}
                itemContent={(_, item) => (
                    <>
                        <td
                            className="min-w-[150px] max-w-[190px] overflow-hidden text-ellipsis border-b p-4 pl-0 text-slate-700"
                            title={item.Name}
                        >
                            {item.Name}
                        </td>
                        <td
                            className="min-w-[50px] max-w-[250px] overflow-hidden text-ellipsis border-b p-4 text-slate-700"
                            title={item.Host}
                        >
                            {item.Host}
                        </td>
                        <td className="border-b p-4">
                            <button
                                className="text-blue-500 hover:underline"
                                onClick={() =>
                                    showTURNDialogFnRef.current(item.ID)
                                }
                            >
                                <p className="text-base">Edit</p>
                            </button>
                        </td>
                        <td className="border-b p-4 pr-0">
                            <button
                                className="text-blue-500 hover:underline"
                                onClick={() =>
                                    removeTURNServer(item.ID, item.Name)
                                }
                            >
                                <p className="text-base">Remove</p>
                            </button>
                        </td>
                    </>
                )}
            />
            <SynchronizationTURNDialog
                showDialogFnRef={showTURNDialogFnRef}
                unlockedVault={unlockedVault}
            />
        </>
    );
};

const SynchronizationTURNDialog: React.FC<{
    showDialogFnRef: React.MutableRefObject<() => void>;
    id?: string;
    unlockedVault: Vault;
}> = ({ showDialogFnRef, unlockedVault }) => {
    const [visible, setVisible] = useState(false);

    const [existingEntryName, setExistingEntryName] = useState<string | null>(
        null,
    );

    const setUnlockedVault = useSetAtom(unlockedVaultWriteOnlyAtom);

    const defaultValues = {
        ID: "",
        Name: "",
        Host: "",
        Username: "",
        Password: "",
    };

    showDialogFnRef.current = (id?: string) => {
        const existingTURNServer = id
            ? (unlockedVault.LinkedDevices?.TURNServers.find(
                  (i) => i.ID === id,
              ) ?? null)
            : null;

        setExistingEntryName(existingTURNServer?.Name ?? null);

        // Set the initial form values
        if (existingTURNServer) {
            resetForm({
                ID: existingTURNServer.ID,
                Name: existingTURNServer.Name,
                Host: existingTURNServer.Host,
                Username: existingTURNServer.Username,
                Password: existingTURNServer.Password,
            });
        }

        setVisible(true);
    };

    const hideDialog = (force = false) => {
        const hide = () => {
            setVisible(false);

            // Reset the form with a delay for better UX
            setTimeout(() => {
                resetForm(defaultValues);
                setExistingEntryName(null);
            }, DIALOG_BLUR_TIME);
        };

        // Check if the form has been modified (only if we are not forcing)
        if (isDirty && !force) {
            // If it has, ask the user if they want to discard the changes (if the mode is "edit" || "add")
            if (confirm("Are you sure you want to discard your changes?")) {
                hide();
            }
        } else {
            hide();
        }
    };

    const {
        register,
        handleSubmit,
        formState: { errors, isSubmitting, isDirty },
        reset: resetForm,
    } = useForm<SynchronizationTURNUpsertSchemaType>({
        resolver: zodResolver(SynchronizationTURNUpsertSchema),
        defaultValues: defaultValues,
    });

    const onSubmit = async (formData: SynchronizationTURNUpsertSchemaType) => {
        await Promise.all([
            new Promise((resolve) => setTimeout(resolve, DIALOG_BLUR_TIME)),
        ]);
        if (formData.ID.length) {
            toast.info("Updating TURN server...", {
                autoClose: false,
                closeButton: false,
                isLoading: true,
                toastId: "update-turn-server",
                updateId: "update-turn-server",
            });

            try {
                // If the ID is not empty, we are editing an existing TURN server
                setUnlockedVault((vault) => {
                    const existingItem = vault.LinkedDevices.TURNServers.find(
                        (i) => i.ID === formData.ID,
                    );

                    if (existingItem) {
                        existingItem.Name = formData.Name;
                        existingItem.Host = formData.Host;
                        existingItem.Username = formData.Username;
                        existingItem.Password = formData.Password;
                    }

                    return vault;
                });
            } catch (e) {
                console.error("Failed to update TURN server.", e);
                toast.error("Failed to update TURN server.", {
                    autoClose: 3000,
                    closeButton: true,
                    isLoading: false,
                    toastId: "update-turn-server",
                    updateId: "update-turn-server",
                });
                return;
            }

            toast.success("Successfully updated TURN server.", {
                autoClose: 3000,
                closeButton: true,
                isLoading: false,
                toastId: "update-turn-server",
                updateId: "update-turn-server",
            });
        } else {
            // If the ID is empty, we need to create a new TURN server
            toast.info("Adding the TURN server configuration...", {
                autoClose: false,
                closeButton: false,
                isLoading: true,
                toastId: "insert-turn-server",
                updateId: "insert-turn-server",
            });

            try {
                const newItem = new cOnlineServicesTURNConfiguration(
                    formData.Name,
                    formData.Host,
                    formData.Username,
                    formData.Password,
                );

                setUnlockedVault((vault) => {
                    vault.LinkedDevices.TURNServers.push(newItem);
                    return vault;
                });
            } catch (e) {
                console.error("Failed to insert a new TURN server.", e);
                toast.error("Failed to insert a new TURN server.", {
                    autoClose: 3000,
                    closeButton: true,
                    isLoading: false,
                    toastId: "insert-turn-server",
                    updateId: "insert-turn-server",
                });
            }

            toast.info("New TURN server has been configured", {
                autoClose: 3000,
                closeButton: true,
                isLoading: false,
                toastId: "insert-turn-server",
                updateId: "insert-turn-server",
            });
        }

        hideDialog(true);
    };

    return (
        <GenericModal
            key="synchronization-turn-configuration-dialog"
            visibleState={[visible, () => hideDialog()]}
            inhibitDismissOnClickOutside={isSubmitting}
            childrenTitle={
                <Title>
                    {existingEntryName
                        ? `${existingEntryName} - Edit TURN Server`
                        : `New TURN Server`}
                </Title>
            }
        >
            <Body className="flex w-full flex-grow flex-row">
                <div
                    className="flex w-full flex-col text-left"
                    onKeyDown={(e) => {
                        // If the user presses the CTRL + Enter key - fire the form submit event
                        if (e.ctrlKey && e.key === "Enter") {
                            handleSubmit(onSubmit)();
                        }
                    }}
                >
                    <div className="mt-2 flex flex-col">
                        <FormInputField
                            label="Name"
                            type="text"
                            placeholder="My TURN Server"
                            autoCapitalize="words"
                            maxLength={50}
                            register={register("Name")}
                        />
                        {errors.Name && (
                            <p className="text-red-500">
                                {errors.Name.message}
                            </p>
                        )}
                    </div>
                    <div className="mt-2 flex flex-col">
                        <FormInputField
                            label="Host"
                            type="text"
                            placeholder="turn:turn.example.com:3478"
                            autoCapitalize="none"
                            register={register("Host")}
                        />
                        {errors.Host && (
                            <p className="text-red-500">
                                {errors.Host.message}
                            </p>
                        )}
                    </div>
                    <div className="mt-2 flex flex-col">
                        <FormInputField
                            label="Username"
                            type="text"
                            placeholder="username"
                            autoCapitalize="none"
                            register={register("Username")}
                        />
                        {errors.Username && (
                            <p className="text-red-500">
                                {errors.Username.message}
                            </p>
                        )}
                    </div>
                    <div className="mt-2 flex flex-col">
                        <FormInputField
                            label="Password"
                            type="password"
                            placeholder="password"
                            autoCapitalize="none"
                            register={register("Password")}
                        />
                        {errors.Password && (
                            <p className="text-red-500">
                                {errors.Password.message}
                            </p>
                        )}
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

export const SynchronizationServersSelectboxes: React.FC<{
    synchronizationConfiguration: {
        SignalingServers: SignalingServerConfiguration[];
        STUNServers: STUNServerConfiguration[];
        TURNServers: TURNServerConfiguration[];
    };
    registerSignaling: UseFormRegisterReturn;
    registerSTUN: UseFormRegisterReturn;
    registerTURN: UseFormRegisterReturn;
}> = ({
    synchronizationConfiguration,
    registerSignaling,
    registerSTUN,
    registerTURN,
}) => {
    // Three select boxes for selecting the signaling server, STUN server, and TURN server
    // Every select box needs to have one item "Online Services" and the rest are from the list

    const _signalingServers = synchronizationConfiguration.SignalingServers;
    const _stunServers = synchronizationConfiguration.STUNServers;
    const _turnServers = synchronizationConfiguration.TURNServers;

    const signalingServers = useMemo(() => {
        const items = _signalingServers.map((i) => {
            return {
                id: i.ID,
                label: i.Name,
            };
        });

        items.push({
            id: ONLINE_SERVICES_SELECTION_ID,
            label: "Online Services",
        });

        return items.reduce(
            (acc, item) => {
                acc[item.id] = item.label;
                return acc;
            },
            {} as Record<string, string>,
        );
    }, [synchronizationConfiguration]);

    const stunServers = useMemo(() => {
        const items = _stunServers.map((i) => {
            return {
                id: i.ID,
                label: i.Name,
            };
        });

        items.push({
            id: ONLINE_SERVICES_SELECTION_ID,
            label: "Online Services",
        });

        return items.reduce(
            (acc, item) => {
                acc[item.id] = item.label;
                return acc;
            },
            {} as Record<string, string>,
        );
    }, [synchronizationConfiguration]);

    const turnServers = useMemo(() => {
        const items = _turnServers.map((i) => {
            return {
                id: i.ID,
                label: i.Name,
            };
        });

        items.push({
            id: ONLINE_SERVICES_SELECTION_ID,
            label: "Online Services",
        });

        return items.reduce(
            (acc, item) => {
                acc[item.id] = item.label;
                return acc;
            },
            {} as Record<string, string>,
        );
    }, [synchronizationConfiguration]);

    return (
        <div className="flex flex-col space-y-2">
            <div className="flex flex-row items-center justify-between space-x-2">
                <p className="text-slate-600">Signaling Server</p>
                <FormSelectboxField
                    optionsEnum={signalingServers}
                    register={registerSignaling}
                    fullWidth={true}
                />
            </div>

            <div className="flex flex-row items-center justify-between space-x-2">
                <p className="text-slate-600">STUN Server</p>
                <FormSelectboxField
                    optionsEnum={stunServers}
                    register={registerSTUN}
                    fullWidth={true}
                />
            </div>
            <div className="flex flex-row items-center justify-between space-x-2">
                <p className="text-slate-600">TURN Server</p>
                <FormSelectboxField
                    optionsEnum={turnServers}
                    register={registerTURN}
                    fullWidth={true}
                />
            </div>
        </div>
    );
};
