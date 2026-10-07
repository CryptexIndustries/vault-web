import { atom } from "jotai";

type LockedSnackbar = {
    message: string;
};

export const lockedSnackbarAtom = atom<LockedSnackbar | null>(null);
