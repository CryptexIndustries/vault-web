import { trpc } from "@/utils/trpc";

export async function listAllRecoverySnapshots(
    sessionToken: string,
    initialCursor: string,
) {
    const items: Awaited<
        ReturnType<typeof trpc.v1.backup.recoveryList.mutate>
    >["items"] = [];
    let cursor: string | null = initialCursor;
    while (cursor) {
        const page = await trpc.v1.backup.recoveryList.mutate({
            sessionToken,
            cursor,
        });
        items.push(...page.items);
        cursor = page.nextCursor;
    }
    return items;
}
