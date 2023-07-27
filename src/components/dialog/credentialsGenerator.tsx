import React, { useState } from "react";
import { z } from "zod";
import { toast } from "react-toastify";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { wordlist as englishWordlist } from "@scure/bip39/wordlists/english";
import { ArrowPathIcon } from "@heroicons/react/20/solid";

import { Body, Footer, GenericModal } from "../general/modal";
import { ButtonFlat, ButtonType } from "../general/buttons";
import {
    FormBaseNumberInputField,
    FormSelectboxField,
} from "../general/inputFields";
import { AccordionItem } from "../general/accordion";

const MAX_LENGTH = 65535;

enum GenerationType {
    Random = "Random",
    Memorable = "Memorable",
}

enum WordSeparator {
    Space = "Space",
    Dash = "Dash",
    Underscore = "Underscore",
    Period = "Period",
    Comma = "Comma",
    None = "None",
}

const FormSchema = z.object({
    type: z.nativeEnum(GenerationType),
    length: z.number().min(1),

    wordSeparator: z.nativeEnum(WordSeparator),

    specialCharacters: z.boolean(),
    capitalLetters: z.boolean(),
    includeNumbers: z.boolean(),
});

type FormSchemaType = z.infer<typeof FormSchema>;

export const CredentialsGeneratorDialog: React.FC<{
    showDialogFnRef: React.MutableRefObject<() => void>;
}> = ({ showDialogFnRef }) => {
    const [dialogVisible, setDialogVisible] = useState(false);

    showDialogFnRef.current = () => {
        setDialogVisible(true);
        handleSubmit(regenerateOutput)();
    };

    const hideDialog = () => {
        setDialogVisible(false);
        reset();
    };

    const [output, setOutput] = useState<string>("");

    const { reset, register, watch, handleSubmit } = useForm<FormSchemaType>({
        resolver: zodResolver(FormSchema),
        mode: "onChange",
        defaultValues: {
            type: GenerationType.Random,
            length: 32,
            wordSeparator: WordSeparator.Space,
            specialCharacters: false,
            capitalLetters: false,
            includeNumbers: false,
        },
    });

    const copyOutput = () => {
        // Save the current selection to clipboard
        navigator.clipboard.writeText(output);
        toast.info("Copied to clipboard");
    };

    const generateRandomOutput = (form: FormSchemaType) => {
        const specialCharacters = form.specialCharacters;
        const capitalLetters = form.capitalLetters;
        const includeNumbers = form.includeNumbers;

        let validChars = "abcdefghijklmnopqrstuvwxyz";

        if (specialCharacters) validChars += "!@#$%^&*|\\/?><.,;:[]{}()_+-=";
        if (capitalLetters) validChars += validChars.toUpperCase();
        if (includeNumbers) validChars += "0123456789";

        let array = new Uint8Array(Math.abs(form.length));
        array = crypto.getRandomValues(array);
        array = array.map((x) => validChars.charCodeAt(x % validChars.length));

        // TODO: Remove the any cast
        return String.fromCharCode.apply(null, array as unknown as number[]);
    };

    const generateMemorableOutput = (form: FormSchemaType) => {
        const wordlist: string[] = englishWordlist;
        const mnemonic: string[] = [];

        const length = form.length;
        const capizalizeFirstLetter = form.capitalLetters;
        const includeNumbers = form.includeNumbers;

        for (let i = 0; i < length; i++) {
            // Get a random index from 0 to the length of the wordlist
            // To satisfy the type checker, we use ?? 1 to ensure that the value is never 0
            const randomIndex =
                (crypto.getRandomValues(new Uint32Array(1))[0] ?? 1) %
                wordlist.length;

            const randomWord = wordlist[randomIndex]?.split("");

            if (randomWord != undefined) {
                if (capizalizeFirstLetter && randomWord[0] != undefined) {
                    randomWord[0] = randomWord[0].toUpperCase();
                }

                if (includeNumbers) {
                    const randomDigit =
                        (crypto.getRandomValues(new Uint32Array(1))[0] ?? 1) %
                        10;

                    randomWord.push(randomDigit.toString());
                }

                mnemonic.push(randomWord.join(""));
            }
        }

        let separator = "";
        switch (form.wordSeparator) {
            case WordSeparator.Space:
                separator = " ";
                break;
            case WordSeparator.Dash:
                separator = "-";
                break;
            case WordSeparator.Underscore:
                separator = "_";
                break;
            case WordSeparator.Period:
                separator = ".";
                break;
            case WordSeparator.Comma:
                separator = ",";
                break;
            case WordSeparator.None:
                separator = "";
                break;
        }

        return mnemonic.join(separator);
    };
    const regenerateOutput = (form: FormSchemaType) => {
        console.debug("Regenerating output...");

        const type = form.type;
        let length = form.length;

        // If the length is over the max length, clamp it
        if (length > MAX_LENGTH) {
            length = MAX_LENGTH;
        }

        console.debug(`Generating ${length} len of type ${type}...`);

        if (type === GenerationType.Random) {
            const output = generateRandomOutput(form);
            setOutput(output);
        } else if (type === GenerationType.Memorable) {
            const output = generateMemorableOutput(form);
            setOutput(output);
        } else {
            console.error(`CredentialsGenerator - unknown type ${type}`);
        }
    };

    return (
        <GenericModal
            key="credentials-generator-modal"
            visibleState={[dialogVisible, hideDialog]}
        >
            <Body>
                <div
                    className="flex flex-col items-center text-center"
                    onInput={() =>
                        // FIXME: This is a hack to make sure the input is updated before we copy it
                        setTimeout(handleSubmit(regenerateOutput), 100)
                    }
                >
                    <div className="flex w-full items-center space-x-2">
                        <p
                            className="max-h-32 flex-grow select-all overflow-y-auto break-words rounded-lg border border-slate-200 p-3 text-slate-600"
                            onClick={copyOutput}
                        >
                            {output}
                        </p>
                        <div>
                            <ArrowPathIcon
                                className="h-6 w-6 cursor-pointer rounded-lg text-slate-600 transition-colors hover:bg-slate-100"
                                onClick={handleSubmit(regenerateOutput)}
                            />
                        </div>
                    </div>

                    <p className="text-sm text-gray-600">
                        Click to copy, click the arrow to regenerate
                    </p>

                    <div className="mt-5 flex w-full flex-col items-center justify-between space-y-5 border-t border-t-slate-100 p-3 sm:flex-row sm:items-baseline sm:space-x-5 sm:space-y-0">
                        <div className="flex flex-row items-center space-x-2">
                            <p className="text-gray-600">Type</p>
                            <FormSelectboxField
                                options={Object.values(GenerationType)}
                                register={register("type")}
                            />
                        </div>
                        <div className="flex flex-row items-center space-x-2">
                            <p className="text-gray-600">Length</p>
                            <div className="w-[100px]">
                                <FormBaseNumberInputField
                                    register={register("length", {
                                        valueAsNumber: true,
                                    })}
                                    min={1}
                                    max={MAX_LENGTH}
                                />
                            </div>
                        </div>
                    </div>
                    <AccordionItem
                        title="Advanced"
                        buttonClassName="bg-gray-500 rounded-t-md w-full rounded-b-none"
                        innerClassName={
                            "bg-slate-100 rounded-b-md px-2 py-2 flex w-full flex-col space-y-2"
                        }
                    >
                        {watch("type") === GenerationType.Random && (
                            <div className="flex flex-row items-center">
                                <p className="text-gray-600">
                                    Special Characters (!@#$%^&*)
                                </p>
                                <div className="w-[100px]">
                                    <input
                                        type="checkbox"
                                        {...register("specialCharacters")}
                                    />
                                </div>
                            </div>
                        )}

                        {watch("type") === GenerationType.Memorable && (
                            <div className="flex flex-row items-center space-x-5">
                                <p className="text-gray-600">Separator</p>
                                <FormSelectboxField
                                    options={Object.values(WordSeparator)}
                                    register={register("wordSeparator")}
                                />
                            </div>
                        )}

                        <div className="flex flex-row items-center">
                            <p className="text-gray-600">Capital letters</p>
                            <div className="w-[100px]">
                                <input
                                    type="checkbox"
                                    {...register("capitalLetters")}
                                />
                            </div>
                        </div>
                        <div className="flex flex-row items-center">
                            <p className="text-gray-600">Include numbers</p>
                            <div className="w-[100px]">
                                <input
                                    type="checkbox"
                                    {...register("includeNumbers")}
                                />
                            </div>
                        </div>
                    </AccordionItem>
                </div>
            </Body>

            <Footer className="space-y-3 sm:space-x-5 sm:space-y-0">
                <ButtonFlat
                    text="Copy and close"
                    className="sm:ml-2"
                    onClick={() => {
                        copyOutput();
                        hideDialog();
                    }}
                />
                <ButtonFlat
                    text="Close"
                    type={ButtonType.Secondary}
                    onClick={() => hideDialog()}
                />
            </Footer>
        </GenericModal>
    );
};
