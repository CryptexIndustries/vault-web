import { Disclosure, Transition } from "@headlessui/react";
import { ChevronUpIcon } from "@heroicons/react/20/solid";
import { clsx } from "clsx";
import React from "react";

export type AccordionProps = {
    children:
        | React.ReactElement<typeof AccordionItem>
        | React.ReactElement<typeof AccordionItem>[];
};

export const Accordion: React.FC<AccordionProps> = ({ children }) => {
    return (
        <div className="w-full px-4 pt-16 transition-all">
            <div className="mx-auto flex w-full max-w-md flex-col space-y-2 rounded-2xl bg-gray-700 p-2">
                {children}
            </div>
        </div>
    );
};

export type AccordionItemProps = {
    title: string;
    children: React.ReactNode;
    buttonClassName?: string;
    innerClassName?: string | null;
};

export const AccordionItem: React.FC<AccordionItemProps> = ({
    title,
    children,
    buttonClassName = "bg-colorPrimary",
    innerClassName = "text-md px-4 pb-2 text-gray-200",
}) => (
    <Disclosure>
        {({ open }) => (
            <>
                <Disclosure.Button
                    className={clsx({
                        "text-md flex w-full items-center justify-between rounded-lg px-4 py-2 text-left font-medium text-white hover:opacity-90 focus:outline-none focus-visible:opacity-90 focus-visible:ring focus-visible:ring-opacity-75":
                            true,
                        [buttonClassName]: true,
                    })}
                >
                    <span className="w-full">{title}</span>
                    <ChevronUpIcon
                        className={clsx({
                            "h-5 w-5 text-gray-100 transition-all": true,
                            "rotate-180 transform": open,
                        })}
                    />
                </Disclosure.Button>
                <Transition
                    enter="transition duration-100 ease-out"
                    enterFrom="transform scale-95 opacity-0"
                    enterTo="transform scale-100 opacity-100"
                    leave="transition duration-75 ease-out"
                    leaveFrom="transform scale-100 opacity-100"
                    leaveTo="transform scale-95 opacity-0"
                    className={`${innerClassName}`}
                >
                    <Disclosure.Panel className={`${innerClassName}`}>
                        {children}
                    </Disclosure.Panel>
                </Transition>
            </>
        )}
    </Disclosure>
);
