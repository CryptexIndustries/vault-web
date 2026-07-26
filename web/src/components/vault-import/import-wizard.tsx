import { useState } from "react";
import { AlertTriangle, FileUp, LoaderCircle } from "lucide-react";

import {
    ImportSourceLabels,
    ImportSources,
    parseImportFile,
    type ImportResult,
    type ImportSource,
} from "@cryptex-industries/vault-core/vault-utils/import-export";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
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

    const reset = () => {
        setFileName("");
        setResult(null);
        setError("");
        setIsParsing(false);
        setIsConfirming(false);
    };

    const handleFileChange: React.ChangeEventHandler<HTMLInputElement> = async (
        event,
    ) => {
        const file = event.target.files?.[0];
        event.target.value = "";
        setResult(null);
        setError("");
        if (!file) return;

        setFileName(file.name);
        setIsParsing(true);
        try {
            setResult(await parseImportFile(source, file));
        } catch (parseError) {
            importLog.error("Import parse failed", {
                source,
                fileName: file.name,
                fileSize: file.size,
                error: parseError,
            });
            setError("Could not parse this export file.");
        } finally {
            setIsParsing(false);
        }
    };

    const handleOpenChange = (nextOpen: boolean) => {
        if (!nextOpen) reset();
        onOpenChange(nextOpen);
    };

    const handleConfirm = async () => {
        if (!result) return;
        setIsConfirming(true);
        try {
            await onConfirm(result);
            reset();
            onOpenChange(false);
        } finally {
            setIsConfirming(false);
        }
    };

    return (
        <Dialog open={open} onOpenChange={handleOpenChange}>
            <DialogContent className="max-w-xl">
                <DialogHeader>
                    <DialogTitle>Import Passwords</DialogTitle>
                    <DialogDescription>
                        Import plaintext exports from another password manager
                        or browser.
                    </DialogDescription>
                </DialogHeader>

                <div className="space-y-4">
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
                                setSource(value as ImportSource);
                                setResult(null);
                                setError("");
                                setFileName("");
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
                            <div className="grid grid-cols-3 gap-2">
                                <div>
                                    <p className="text-muted-foreground">
                                        Items
                                    </p>
                                    <p className="font-semibold">
                                        {result.credentials.length}
                                    </p>
                                </div>
                                <div>
                                    <p className="text-muted-foreground">
                                        Directories
                                    </p>
                                    <p className="font-semibold">
                                        {result.directories.length}
                                    </p>
                                </div>
                                <div>
                                    <p className="text-muted-foreground">
                                        Skipped
                                    </p>
                                    <p className="font-semibold">
                                        {result.skipped}
                                    </p>
                                </div>
                            </div>

                            {result.warnings.length ? (
                                <div className="space-y-1">
                                    <p className="font-medium">Warnings</p>
                                    <ul className="max-h-28 list-disc overflow-auto pl-5 text-xs text-muted-foreground">
                                        {result.warnings
                                            .slice(0, 8)
                                            .map((warning, index) => (
                                                <li
                                                    key={`${warning.code}-${index}`}
                                                >
                                                    {warning.message}
                                                </li>
                                            ))}
                                    </ul>
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
                            result.credentials.length === 0 ||
                            isParsing ||
                            isConfirming
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
