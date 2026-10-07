import { describe, expect, it } from "@jest/globals";

import { parseMobileImportFile } from "@/utils/mobile-import-file";

const textFile = (text: string) =>
    ({ text: async () => text }) as unknown as File;

describe("parseMobileImportFile", () => {
    it("preserves nested KeePass groups, TOTP, custom fields, and timestamps", async () => {
        const result = await parseMobileImportFile(
            "keepass-xml",
            textFile(`<?xml version="1.0" encoding="UTF-8"?>
                <KeePassFile><Root><Group>
                    <UUID>root-id</UUID><Name>Root</Name>
                    <Entry>
                        <String><Key>Title</Key><Value>Root login</Value></String>
                        <String><Key>otp</Key><Value>JBSWY3DPEHPK3PXP</Value></String>
                        <String><Key>Account number</Key><Value>42</Value></String>
                        <Times>
                            <CreationTime>2025-01-02T03:04:05.000Z</CreationTime>
                            <LastModificationTime>2026-02-03T04:05:06.000Z</LastModificationTime>
                        </Times>
                    </Entry>
                    <Group><UUID>child-id</UUID><Name>Child</Name><Entry>
                        <String><Key>Title</Key><Value>Child login</Value></String>
                    </Entry></Group>
                </Group></Root></KeePassFile>`),
        );

        expect(
            result.directories.map(({ ID, Name }) => ({ ID, Name })),
        ).toEqual([
            { ID: "root-id", Name: "Root" },
            { ID: "child-id", Name: "Root/Child" },
        ]);
        expect(result.credentials).toHaveLength(2);
        expect(result.credentials[0]).toMatchObject({
            DirectoryID: "root-id",
            Name: "Root login",
            DateCreatedTimestamp: Date.parse("2025-01-02T03:04:05.000Z"),
            DateModifiedTimestamp: Date.parse("2026-02-03T04:05:06.000Z"),
            TOTP: { Secret: "JBSWY3DPEHPK3PXP" },
        });
        expect(result.credentials[0]?.CustomFields).toEqual(
            expect.arrayContaining([
                expect.objectContaining({
                    Name: "Account number",
                    Value: "42",
                }),
            ]),
        );
        expect(result.credentials[1]).toMatchObject({
            DirectoryID: "child-id",
            Name: "Child login",
        });
    });

    it("rejects malformed KeePass XML", async () => {
        await expect(
            parseMobileImportFile(
                "keepass-xml",
                textFile("<KeePassFile><Root><Group></Root></KeePassFile>"),
            ),
        ).rejects.toThrow("The selected file is not valid XML.");
    });
});
