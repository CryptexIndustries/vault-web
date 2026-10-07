import { useState } from "react";
import { Linking, View } from "react-native";
import Constants from "expo-constants";
import { getBuildDetails } from "@/lib/build-details";

function installedUpdateMetadata() {
    try { return require("expo-updates") as typeof import("expo-updates"); }
    catch { return {}; }
}
import { CircleHelp, Code2, Globe, Info } from "lucide-react-native";

import {
    UnlockedButton as Button,
    UnlockedMenuRow,
    UnlockedDialogTitle,
    UnlockedText,
} from "@/components/unlocked/unlocked-ui";
import { Dialog, DialogHeader } from "@/components/ui/dialog";
import { colors } from "@/theme";

export function AboutSheet({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
    const [licenseOpen, setLicenseOpen] = useState(false);
    const details = getBuildDetails(Constants.expoConfig, installedUpdateMetadata());
    const { version, build } = details;

    return (
        <Dialog open={open} onOpenChange={(next) => { if (!next) setLicenseOpen(false); onOpenChange(next); }} placement="bottom" scroll>
            <DialogHeader><UnlockedDialogTitle>{licenseOpen ? "License" : "About"}</UnlockedDialogTitle></DialogHeader>
            {licenseOpen ? (
                <>
                    <View style={{ paddingBottom: 22, marginBottom: 6, borderBottomWidth: 1, borderBottomColor: colors.border }}>
                        <UnlockedText style={{ fontSize: 22, fontWeight: "500", marginTop: 10, marginBottom: 6 }}>AGPL-3.0-only</UnlockedText>
                        <UnlockedText style={{ color: colors.muted, fontSize: 13, lineHeight: 20 }}>Cryptex Vault is free software licensed under the GNU Affero General Public License, version 3.</UnlockedText>
                    </View>
                    <View style={{ borderLeftWidth: 2, borderLeftColor: colors.muted, paddingLeft: 13, marginVertical: 20 }}><UnlockedText style={{ fontSize: 12, lineHeight: 18, color: colors.muted }}>See LICENSE.md in the repository for the full license text.</UnlockedText></View>
                    <Button className="mt-6" variant="outline" onPress={() => void Linking.openURL("https://www.gnu.org/licenses/agpl-3.0.html")}>View full license</Button>
                    <Button variant="ghost" onPress={() => setLicenseOpen(false)}>Back to About</Button>
                </>
            ) : (
                <>
                    <View style={{ paddingBottom: 22, marginBottom: 6, borderBottomWidth: 1, borderBottomColor: colors.border }}>
                        <UnlockedText style={{ fontSize: 22, fontWeight: "500", marginTop: 10 }}>Cryptex Vault</UnlockedText>
                        <UnlockedText style={{ color: colors.muted, fontSize: 13, marginTop: 6 }}>
                            Version {version}{build ? ` (${build})` : ""} on Android
                        </UnlockedText>
                    </View>
                    <View style={{ marginTop: 18, gap: 5 }}>
                        {[
                            ['Profile', `${details.profile} / ${details.distribution}`],
                            ['Source revision', details.revision],
                            ['Runtime', details.runtime],
                            ['Update', details.update],
                            ['OTA', `${details.ota} / ${details.channel}`],
                        ].map(([label, value]) => <UnlockedText key={label} selectable style={{ color: colors.muted, fontSize: 12 }}>{label}: {value}</UnlockedText>)}
                    </View>
                    <UnlockedText style={{ color: colors.muted, fontSize: 11, letterSpacing: 1, marginTop: 8, marginBottom: 6, textTransform: "uppercase" }}>
                        Project
                    </UnlockedText>
                    <UnlockedMenuRow icon={Globe} title="Website" subtitle="cryptex-vault.com" onPress={() => void Linking.openURL("https://cryptex-vault.com")} />
                    <UnlockedMenuRow icon={Code2} title="Source code" subtitle="View the project repository" onPress={() => void Linking.openURL("https://github.com/CryptexIndustries/vault-web")} />
                    <UnlockedMenuRow icon={CircleHelp} title="Report an issue" subtitle="Open the issue tracker" onPress={() => void Linking.openURL("https://github.com/CryptexIndustries/vault-web/issues")} />
                    <UnlockedMenuRow icon={Info} title="License" subtitle="AGPL-3.0-only" onPress={() => setLicenseOpen(true)} />
                </>
            )}
        </Dialog>
    );
}
