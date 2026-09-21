import { useRef, useState } from "react";
import { AlertTriangle, FileUp, LoaderCircle } from "lucide-react";

import {
    getImportErrorMessage,
    ImportSourceLabels,
    ImportSources,
    parseImportFile,
    type ImportResult,
    type ImportSource,
} from "@cryptex-industries/vault-core/vault-utils/import-export";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import { importLog } from "@/utils/logging";

type ImportWizardProps = {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    onConfirm: (result: ImportResult) => Promise<void> | void;
};

const sourceAccept: Record<ImportSource, string> = {
    "cryptex-json": ".json,application/json",
    "bitwarden-json": ".json,application/json",
    "onepassword-csv": ".csv,text/csv",
    "onepassword-1pux": ".1pux,.zip,application/zip",
    "keepass-xml": ".xml,application/xml,text/xml",
    "keepass-csv": ".csv,text/csv",
    "lastpass-csv": ".csv,text/csv",
    "chrome-csv": ".csv,text/csv",
    "firefox-csv": ".csv,text/csv",
};

export function ImportWizard({
    open,
    onOpenChange,
    onConfirm,
}: ImportWizardProps) {
    const [source, setSource] = useState<ImportSource>("cryptex-json");
    const [fileName, setFileName] = useState("");
    const [result, setResult] = useState<ImportResult | null>(null);
    const [error, setError] = useState("");
    const [isParsing, setIsParsing] = useState(false);
    const [isConfirming, setIsConfirming] = useState(false);
    const [acceptedUnsupportedData, setAcceptedUnsupportedData] =
        useState(false);
    const parseRequest = useRef(0);

    const confirmationNotices =
        result?.notices.filter((notice) => notice.requiresConfirmation) ?? [];

    const reset = () => {
        parseRequest.current += 1;
        setFileName("");
        setResult(null);
        setError("");
        setIsParsing(false);
        setIsConfirming(false);
        setAcceptedUnsupportedData(false);
    };

    const handleFileChange: React.ChangeEventHandler<HTMLInputElement> = async (
        event,
    ) => {
        const file = event.target.files?.[0];
        event.target.value = "";
        setResult(null);
        setError("");
        setAcceptedUnsupportedData(false);
        if (!file) return;

        setFileName(file.name);
        setIsParsing(true);
        const request = ++parseRequest.current;
        try {
            const parsed = await parseImportFile(source, file);
            if (request === parseRequest.current) setResult(parsed);
        } catch (parseError) {
            if (request !== parseRequest.current) return;
            importLog.error("Import parse failed", {
                source,
                fileName: file.name,
                fileSize: file.size,
                error: parseError,
            });
            setError(getImportErrorMessage(parseError));
        } finally {
            if (request === parseRequest.current) setIsParsing(false);
        }
    };

    const handleOpenChange = (nextOpen: boolean) => {
        if (!nextOpen) reset();
        onOpenChange(nextOpen);
    };

    const handleConfirm = async () => {
        if (!result) return;
        setIsConfirming(true);
        setError("");
        try {
            await onConfirm(result);
            reset();
            onOpenChange(false);
        } catch (confirmError) {
            importLog.error("Import save failed", {
                source: result.source,
                itemCount: result.credentials.length,
                error: confirmError,
            });
            setError("Could not save the imported data. Nothing was imported.");
        } finally {
            setIsConfirming(false);
        }
    };

    return (
        <Dialog open={open} onOpenChange={handleOpenChange}>
            <DialogContent className="grid max-h-[calc(100dvh-2rem)] max-w-xl grid-rows-[auto_minmax(0,1fr)_auto] overflow-hidden">
                <DialogHeader>
                    <DialogTitle>Import Passwords</DialogTitle>
                    <DialogDescription>
                        Import plaintext exports from another password manager
                        or browser.
                    </DialogDescription>
                </DialogHeader>

                <div className="min-h-0 space-y-4 overflow-y-auto overscroll-contain pr-1">
                    <Alert>
                        <AlertTriangle className="h-4 w-4" />
                        <AlertDescription>
                            Export files contain readable secrets. Import on a
                            trusted device, then delete the export file.
                        </AlertDescription>
                    </Alert>

                    <div className="space-y-2">
                        <Label>Source</Label>
                        <Select
                            value={source}
                            onValueChange={(value) => {
                                parseRequest.current += 1;
                                setSource(value as ImportSource);
                                setResult(null);
                                setError("");
                                setFileName("");
                                setIsParsing(false);
                                setAcceptedUnsupportedData(false);
                            }}
                        >
                            <SelectTrigger>
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                {ImportSources.map((entry) => (
                                    <SelectItem key={entry} value={entry}>
                                        {ImportSourceLabels[entry]}
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </div>

                    <div className="space-y-2">
                        <Label htmlFor="import-file">Export file</Label>
                        <Input
                            id="import-file"
                            type="file"
                            accept={sourceAccept[source]}
                            onChange={handleFileChange}
                            disabled={isParsing || isConfirming}
                        />
                        {fileName ? (
                            <p className="text-xs text-muted-foreground">
                                Selected: {fileName}
                            </p>
                        ) : null}
                    </div>

                    {isParsing ? (
                        <div className="flex items-center gap-2 text-sm text-muted-foreground">
                            <LoaderCircle className="h-4 w-4 animate-spin" />
                            Parsing export...
                        </div>
                    ) : null}

                    {error ? (
                        <Alert variant="destructive">
                            <AlertDescription>{error}</AlertDescription>
                        </Alert>
                    ) : null}

                    {result ? (
                        <div className="space-y-3 rounded-md border p-3 text-sm">
                            <p className="font-medium">Before you import</p>
                            <div className="grid grid-cols-2 gap-2">
                                {[
                                    {
                                        count:
                                            result.credentials.length +
                                            result.skippedItems,
                                        label: "items found",
                                    },
                                    {
                                        count: result.credentials.length,
                                        label: "items will be added",
                                    },
                                    {
                                        count: result.skippedItems,
                                        label: "items will not be added",
                                    },
                                    {
                                        count: result.directories.length,
                                        label: "folders will be created",
                                    },
                                ].map(({ count, label }) => (
                                    <div
                                        key={label}
                                        className="rounded-md bg-muted/50 p-2"
                                    >
                                        <p className="font-semibold">{count}</p>
                                        <p className="text-xs text-muted-foreground">
                                            {label}
                                        </p>
                                    </div>
                                ))}
                            </div>

                            {result.credentials.length === 0 &&
                            result.directories.length === 0 ? (
                                <p className="text-xs text-muted-foreground">
                                    No importable items or folders were found.
                                </p>
                            ) : null}

                            {[
                                {
                                    kind: "items-skipped" as const,
                                    heading: "Items that won't be added",
                                },
                                {
                                    kind: "saved-differently" as const,
                                    heading:
                                        "Information that will be saved differently",
                                },
                                {
                                    kind: "not-imported" as const,
                                    heading:
                                        "Information that can't be carried over",
                                },
                            ].map(({ kind, heading }) => {
                                const notices = result.notices.filter(
                                    (notice) => notice.kind === kind,
                                );
                                if (!notices.length) return null;
                                return (
                                    <div key={kind} className="space-y-2">
                                        <p className="font-medium">{heading}</p>
                                        <div className="space-y-2">
                                            {notices.map((notice) => (
                                                <div
                                                    key={notice.code}
                                                    className="rounded-md bg-muted/50 p-2"
                                                >
                                                    <div className="flex items-start gap-2">
                                                        <span className="min-w-6 rounded bg-background px-1.5 py-0.5 text-center text-xs font-semibold">
                                                            {notice.count}
                                                        </span>
                                                        <div className="min-w-0">
                                                            <p className="text-xs font-medium">
                                                                {notice.title}
                                                            </p>
                                                            {notice.detail ? (
                                                                <p className="mt-1 text-xs text-muted-foreground">
                                                                    {
                                                                        notice.detail
                                                                    }
                                                                </p>
                                                            ) : null}
                                                            {notice.itemNames
                                                                .length ? (
                                                                <details className="mt-1 text-xs text-muted-foreground">
                                                                    <summary className="cursor-pointer">
                                                                        Affected
                                                                        items
                                                                    </summary>
                                                                    <ul className="mt-1 list-disc pl-5">
                                                                        {notice.itemNames.map(
                                                                            (
                                                                                itemName,
                                                                                index,
                                                                            ) => (
                                                                                <li
                                                                                    key={`${itemName}-${index}`}
                                                                                >
                                                                                    {
                                                                                        itemName
                                                                                    }
                                                                                </li>
                                                                            ),
                                                                        )}
                                                                    </ul>
                                                                </details>
                                                            ) : null}
                                                        </div>
                                                    </div>
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                );
                            })}

                            <p className="text-xs text-muted-foreground">
                                Importing does not check for duplicates.
                                Importing the same file again will add the items
                                again.
                            </p>

                            {confirmationNotices.length ? (
                                <div className="flex items-start gap-2 rounded-md border border-amber-500/50 bg-amber-500/10 p-2">
                                    <Checkbox
                                        id="accept-unsupported-import-data"
                                        checked={acceptedUnsupportedData}
                                        onCheckedChange={(checked) =>
                                            setAcceptedUnsupportedData(
                                                checked === true,
                                            )
                                        }
                                    />
                                    <Label
                                        htmlFor="accept-unsupported-import-data"
                                        className="text-xs font-normal leading-snug"
                                    >
                                        I understand that the items and
                                        information listed above will be skipped
                                        or saved differently.
                                    </Label>
                                </div>
                            ) : null}
                        </div>
                    ) : null}
                </div>

                <DialogFooter>
                    <Button
                        variant="outline"
                        onClick={() => handleOpenChange(false)}
                        disabled={isConfirming}
                    >
                        Cancel
                    </Button>
                    <Button
                        onClick={handleConfirm}
                        disabled={
                            !result ||
                            (result.credentials.length === 0 &&
                                result.directories.length === 0) ||
                            isParsing ||
                            isConfirming ||
                            (confirmationNotices.length > 0 &&
                                !acceptedUnsupportedData)
                        }
                    >
                        {isConfirming ? (
                            <span className="flex items-center">
                                <LoaderCircle className="mr-2 h-4 w-4 animate-spin" />
                                Importing...
                            </span>
                        ) : (
                            <span className="flex items-center">
                                <FileUp className="mr-2 h-4 w-4" />
                                Import
                            </span>
                        )}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
