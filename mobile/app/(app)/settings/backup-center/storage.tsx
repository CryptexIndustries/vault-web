import { useLingui } from "@lingui/react/macro";

import { BackupDestinationsSection } from "@/components/backup-destinations/backup-destinations-section";
import { UnlockedTaskScreen } from "@/components/unlocked/unlocked-ui";

export default function BackupStorageRoute() {
    const { t } = useLingui();
    return (
        <UnlockedTaskScreen title={t`Your own storage`}>
            <BackupDestinationsSection />
        </UnlockedTaskScreen>
    );
}
