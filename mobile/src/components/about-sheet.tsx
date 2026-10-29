import { useState } from "react";
import { useLingui } from "@lingui/react/macro";
import { Linking, View } from "react-native";
import Constants from "expo-constants";
import { getBuildDetails } from "@/lib/build-details";

function installedUpdateMetadata() {
    try {
        return require("expo-updates") as typeof import("expo-updates");
    } catch {
        return {};
    }
}
import {
    CircleHelp,
    Code2,
    Globe,
    Info,
    ShieldCheck,
} from "lucide-react-native";

import {
    UnlockedButton as Button,
    UnlockedMenuRow,
    UnlockedDialogTitle,
    UnlockedText,
} from "@/components/unlocked/unlocked-ui";
import { Dialog, DialogHeader } from "@/components/ui/dialog";
import { colors } from "@/theme";

export function AboutSheet({
    open,
    onOpenChange,
}: {
    open: boolean;
    onOpenChange: (open: boolean) => void;
}) {
    const { t } = useLingui();
    const [licenseOpen, setLicenseOpen] = useState(false);
    const details = getBuildDetails(
        Constants.expoConfig,
        installedUpdateMetadata(),
    );
    const { version, build } = details;

    return (
        <Dialog
            open={open}
            onOpenChange={(next) => {
                if (!next) setLicenseOpen(false);
                onOpenChange(next);
            }}
            placement="bottom"
            scroll
        >
            <DialogHeader>
                <UnlockedDialogTitle>
                    {licenseOpen ? t`License` : t`About`}
                </UnlockedDialogTitle>
            </DialogHeader>
            {licenseOpen ? (
                <>
                    <View
                        style={{
                            paddingBottom: 22,
                            marginBottom: 6,
                            borderBottomWidth: 1,
                            borderBottomColor: colors.border,
                        }}
                    >
                        <UnlockedText
                            style={{
                                fontSize: 22,
                                fontWeight: "500",
                                marginTop: 10,
                                marginBottom: 6,
                            }}
                        >
                            {/* i18n-ignore: license identifier */}
                            AGPL-3.0-only
                        </UnlockedText>
                        <UnlockedText
                            style={{
                                color: colors.muted,
                                fontSize: 13,
                                lineHeight: 20,
                            }}
                        >
                            {t`Cryptex Vault is free software licensed under the GNU Affero General Public License, version 3.`}
                        </UnlockedText>
                    </View>
                    <View
                        style={{
                            borderLeftWidth: 2,
                            borderLeftColor: colors.muted,
                            paddingLeft: 13,
                            marginVertical: 20,
                        }}
                    >
                        <UnlockedText
                            style={{
                                fontSize: 12,
                                lineHeight: 18,
                                color: colors.muted,
                            }}
                        >
                            {t`See LICENSE.md in the repository for the full license text.`}
                        </UnlockedText>
                    </View>
                    <Button
                        className="mt-6"
                        variant="outline"
                        onPress={() =>
                            void Linking.openURL(
                                "https://www.gnu.org/licenses/agpl-3.0.html",
                            )
                        }
                    >
                        {t`View full license`}
                    </Button>
                    <Button
                        variant="ghost"
                        onPress={() => setLicenseOpen(false)}
                    >
                        {t`Back to About`}
                    </Button>
                </>
            ) : (
                <>
                    <View
                        style={{
                            paddingBottom: 22,
                            marginBottom: 6,
                            borderBottomWidth: 1,
                            borderBottomColor: colors.border,
                        }}
                    >
                        <UnlockedText
                            style={{
                                fontSize: 22,
                                fontWeight: "500",
                                marginTop: 10,
                            }}
                        >
                            {/* i18n-ignore: product name */}
                            Cryptex Vault
                        </UnlockedText>
                        <UnlockedText
                            style={{
                                color: colors.muted,
                                fontSize: 13,
                                marginTop: 6,
                            }}
                        >
                            {build
                                ? t`Version ${version} (${build}) on Android`
                                : t`Version ${version} on Android`}
                        </UnlockedText>
                    </View>
                    <View style={{ marginTop: 18, gap: 5 }}>
                        {[
                            [
                                t({
                                    message: "Profile",
                                    comment: "Build detail label in About",
                                }),
                                `${details.profile} / ${details.distribution}`,
                            ],
                            [t`Source revision`, details.revision],
                            [
                                t({
                                    message: "Runtime",
                                    comment: "Build detail label in About",
                                }),
                                details.runtime,
                            ],
                            [
                                t({
                                    message: "Update",
                                    comment:
                                        "Build detail label in About: the installed over-the-air update",
                                }),
                                details.update,
                            ],
                            ["OTA", `${details.ota} / ${details.channel}`],
                        ].map(([label, value]) => (
                            <UnlockedText
                                key={label}
                                selectable
                                style={{ color: colors.muted, fontSize: 12 }}
                            >
                                {label}: {value}
                            </UnlockedText>
                        ))}
                    </View>
                    <UnlockedText
                        style={{
                            color: colors.muted,
                            fontSize: 11,
                            letterSpacing: 1,
                            marginTop: 8,
                            marginBottom: 6,
                            textTransform: "uppercase",
                        }}
                    >
                        {t({
                            message: "Project",
                            comment: "Section label in About",
                        })}
                    </UnlockedText>
                    {details.distribution !== "play" ? (
                        <UnlockedMenuRow
                            icon={Globe}
                            title={t`Website`}
                            // i18n-ignore: domain name
                            subtitle="cryptex-vault.com"
                            onPress={() =>
                                void Linking.openURL(
                                    "https://cryptex-vault.com",
                                )
                            }
                        />
                    ) : null}
                    <UnlockedMenuRow
                        icon={Code2}
                        title={t`Source code`}
                        subtitle={t`View the project repository`}
                        onPress={() =>
                            void Linking.openURL(
                                "https://github.com/CryptexIndustries/vault-web",
                            )
                        }
                    />
                    <UnlockedMenuRow
                        icon={CircleHelp}
                        title={t`Report an issue`}
                        subtitle={t`Open the issue tracker`}
                        onPress={() =>
                            void Linking.openURL(
                                "https://github.com/CryptexIndustries/vault-web/issues",
                            )
                        }
                    />
                    <UnlockedMenuRow
                        icon={ShieldCheck}
                        title={t`Privacy policy`}
                        subtitle={t`How your data is handled`}
                        onPress={() =>
                            void Linking.openURL(
                                "https://www.cryptex-vault.com/privacy",
                            )
                        }
                    />
                    <UnlockedMenuRow
                        icon={Info}
                        title={t`License`}
                        // i18n-ignore: license identifier
                        subtitle="AGPL-3.0-only"
                        onPress={() => setLicenseOpen(true)}
                    />
                </>
            )}
        </Dialog>
    );
}
