import { useState } from "react";
import { router } from "expo-router";
import {
    Archive,
    CircleHelp,
    FileUp,
    Info,
    Shield,
    ShieldAlert,
    Smartphone,
} from "lucide-react-native";

import { AboutSheet } from "@/components/about-sheet";
import {
    UnlockedMenuRow as MoreRow,
    UnlockedScreen,
    UnlockedText as Text,
} from "@/components/unlocked/unlocked-ui";
import { colors } from "@/theme";

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
    const [aboutOpen, setAboutOpen] = useState(false);

    return (
        <UnlockedScreen scroll>
            <AboutSheet open={aboutOpen} onOpenChange={setAboutOpen} />
            <SectionLabel>Vault</SectionLabel>
            <MoreRow
                icon={Smartphone}
                title="Autofill"
                subtitle="Passwords, passkeys, and verification codes"
                onPress={() => router.push("/(app)/settings/autofill")}
            />
            <MoreRow
                icon={Shield}
                title="Security"
                subtitle="Auto-lock, biometrics, and encryption"
                onPress={() => router.push("/(app)/settings/security")}
            />
            <SectionLabel>Data &amp; recovery</SectionLabel>
            <MoreRow
                icon={FileUp}
                title="Import / Export"
                subtitle="Move logins or save an encrypted copy"
                onPress={() => router.push("/(app)/settings/import-export")}
            />
            <MoreRow
                icon={Archive}
                title="Backup Center"
                subtitle="Backup history and recovery readiness"
                onPress={() => router.push("/(app)/settings/backup-center")}
            />
            <MoreRow
                icon={ShieldAlert}
                title="Security report"
                subtitle="Find passwords that need attention"
                onPress={() => router.push("/(app)/settings/security-report")}
            />
            <SectionLabel>Help</SectionLabel>
            <MoreRow
                icon={CircleHelp}
                title="Diagnostics"
                subtitle="Review and share diagnostic logs"
                onPress={() => router.push("/(app)/settings/diagnostics")}
            />
            <MoreRow
                icon={Info}
                title="About"
                subtitle="Version and project information"
                onPress={() => setAboutOpen(true)}
            />
        </UnlockedScreen>
    );
}
