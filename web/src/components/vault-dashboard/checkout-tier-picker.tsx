"use client";

import type { CheckoutTier } from "@/app_lib/online-services";
import { Label } from "@/components/ui/label";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";

type CheckoutTierPickerProps = {
    value: CheckoutTier;
    onChange: (tier: CheckoutTier) => void;
    disabled?: boolean;
    id?: string;
};

export function CheckoutTierPicker({
    value,
    onChange,
    disabled,
    id = "checkout-tier",
}: CheckoutTierPickerProps) {
    return (
        <div className="space-y-1.5">
            <Label htmlFor={id} className="text-xs text-muted-foreground">
                Billing interval
            </Label>
            <Select
                value={value}
                onValueChange={(next: string) => {
                    if (next === "premiumMonthly" || next === "premiumYearly") {
                        onChange(next as CheckoutTier);
                    }
                }}
                disabled={disabled}
            >
                <SelectTrigger id={id} className="h-8 text-sm">
                    <SelectValue />
                </SelectTrigger>
                <SelectContent>
                    <SelectItem value="premiumMonthly">Monthly</SelectItem>
                    <SelectItem value="premiumYearly">Yearly</SelectItem>
                </SelectContent>
            </Select>
        </div>
    );
}
