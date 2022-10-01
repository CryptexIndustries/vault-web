import { Disclosure, Transition } from "@headlessui/react";
import { ChevronUpIcon } from "@heroicons/react/20/solid";
import React from "react";

export type AccordionProps = {
    children:
        | React.ReactElement<typeof AccordionItem>
        | React.ReactElement<typeof AccordionItem>[];
};

export const Accordion: React.FC<AccordionProps> = ({ children }) => {
    return (
        <div className="w-full px-4 pt-16 transition-all">
            <div className="mx-auto w-full max-w-md rounded-2xl bg-gray-700 p-2 flex flex-col space-y-2">
                {children}
            </div>
        </div>
    );
};

export type AccordionItemProps = {
    title: string;
    children: React.ReactNode;
};

export const AccordionItem: React.FC<AccordionItemProps> = ({
    title,
    children,
}) => (
    <Disclosure>
        {({ open }) => (
            <>
                <Disclosure.Button className="flex w-full justify-between rounded-lg bg-colorPrimary px-4 py-2 text-left text-sm font-medium text-white hover:opacity-90 focus:outline-none focus-visible:ring focus-visible:opacity-90 focus-visible:ring-opacity-75">
                    <span className="w-full">{title}</span>
                    <ChevronUpIcon
                        className={`${
                            open ? "rotate-180 transform" : ""
                        } h-5 w-5 text-gray-100`}
                    />
                </Disclosure.Button>
                <Transition
                    enter="transition duration-100 ease-out"
                    enterFrom="transform scale-95 opacity-0"
                    enterTo="transform scale-100 opacity-100"
                    leave="transition duration-75 ease-out"
                    leaveFrom="transform scale-100 opacity-100"
                    leaveTo="transform scale-95 opacity-0"
                >
                    <Disclosure.Panel className="px-4 pt-2 pb-2 text-sm text-gray-200">
                        {children}
                    </Disclosure.Panel>
                </Transition>
            </>
        )}
    </Disclosure>
);
