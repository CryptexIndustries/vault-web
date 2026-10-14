import { router } from "expo-router";
import { AboutSheet } from "@/components/about-sheet";

export default function AboutScreen() {
    return <AboutSheet open onOpenChange={(open) => { if (!open) router.back(); }} />;
}
