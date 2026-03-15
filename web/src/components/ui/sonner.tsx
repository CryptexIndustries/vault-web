"use client";

import { Toaster as Sonner, type ToasterProps } from "sonner";

const Toaster = ({ ...props }: ToasterProps) => {
    return (
        <Sonner
            closeButton
            theme="dark"
            className="toaster group"
            toastOptions={{
                style: {
                    background: "#262e43",
                    borderColor: "#181d2b",
                    color: "#fcf8ec",
                },
                classNames: {
                    toast: "group toast border shadow-lg",
                    title: "text-[#fcf8ec]",
                    description: "text-[#c7cddc]",
                    actionButton: "bg-[#ff5668] text-[#fcf8ec] hover:bg-[#ff6f7e]",
                    cancelButton: "bg-[#181d2b] text-[#fcf8ec] hover:bg-[#141926]",
                    closeButton:
                        "border-[#181d2b] bg-[#262e43] text-[#c7cddc] hover:text-[#fcf8ec]",
                    success: "border-[#25c472]/60",
                    error: "border-[#ff5668]/70",
                    warning: "border-[#f5b14c]/70",
                    info: "border-[#6aa7ff]/70",
                },
            }}
            {...props}
        />
    );
};

export { Toaster };
