import { useState } from "react";
import { router } from "expo-router";
import { useLingui } from "@lingui/react/macro";
import {
    Archive,
    CircleHelp,
    FileUp,
    Info,
    Languages,
    Link2,
    Shield,
    ShieldAlert,
    Smartphone,
} from "lucide-react-native";

import { AboutSheet } from "@/components/about-sheet";
import { LanguageDialog } from "@/components/language-dialog";
import {
    UnlockedMenuRow as MoreRow,
    UnlockedScreen,
    UnlockedText as Text,
} from "@/components/unlocked/unlocked-ui";
import { colors } from "@/theme";
import {
    APP_LOCALES,
    appLocaleChoiceAvailable,
    getChosenAppLocale,
} from "@/i18n";

function SectionLabel({ children }: { children: string }) {
    return (
        <Text
            style={{
                color: colors.muted,
                fontSize: 11,
                letterSpacing: 1,
                marginTop: 26,
                marginBottom: 6,
                textTransform: "uppercase",
            }}
        >
            {children}
        </Text>
    );
}

export default function SettingsScreen() {
    const { t } = useLingui();
    const [aboutOpen, setAboutOpen] = useState(false);
    const [languageOpen, setLanguageOpen] = useState(false);
    const chosenLocale = getChosenAppLocale();

    return (
        <UnlockedScreen scroll>
            <AboutSheet open={aboutOpen} onOpenChange={setAboutOpen} />
            <LanguageDialog
                open={languageOpen}
                onOpenChange={setLanguageOpen}
            />
            <SectionLabel>{t`Vault`}</SectionLabel>
            <MoreRow
                icon={Smartphone}
                title={t`Autofill`}
                subtitle={t`Passwords, passkeys, and verification codes`}
                onPress={() => router.push("/(app)/settings/autofill")}
            />
            <MoreRow
                icon={Shield}
                title={t`Security`}
                subtitle={t`Auto-lock, biometrics, and encryption`}
                onPress={() => router.push("/(app)/settings/security")}
            />
            <SectionLabel>{t`Data & recovery`}</SectionLabel>
            <MoreRow
                icon={FileUp}
                title={t`Import / Export`}
                subtitle={t`Move logins or save an encrypted copy`}
                onPress={() => router.push("/(app)/settings/import-export")}
            />
            <MoreRow
                icon={Archive}
                title={t`Backup Center`}
                subtitle={t`Backup history and recovery readiness`}
                onPress={() => router.push("/(app)/settings/backup-center")}
            />
            <MoreRow
                icon={Link2}
                title={t`Shared links`}
                subtitle={t`One-time links you sent`}
                onPress={() => router.push("/(app)/share/links")}
            />
            <MoreRow
                icon={ShieldAlert}
                title={t`Security report`}
                subtitle={t`Find passwords that need attention`}
                onPress={() => router.push("/(app)/settings/security-report")}
            />
            {appLocaleChoiceAvailable ? (
                <>
                    <SectionLabel>{t`App`}</SectionLabel>
                    <MoreRow
                        icon={Languages}
                        title={t`Language`}
                        subtitle={t`The language the app uses`}
                        value={
                            chosenLocale
                                ? APP_LOCALES[chosenLocale]
                                : t`Device language`
                        }
                        onPress={() => setLanguageOpen(true)}
                    />
                </>
            ) : null}
            <SectionLabel>{t`Help`}</SectionLabel>
            <MoreRow
                icon={CircleHelp}
                title={t`Diagnostics`}
                subtitle={t`Review and share diagnostic logs`}
                onPress={() => router.push("/(app)/settings/diagnostics")}
            />
            <MoreRow
                icon={Info}
                title={t`About`}
                subtitle={t`Version and project information`}
                onPress={() => setAboutOpen(true)}
            />
        </UnlockedScreen>
    );
}
