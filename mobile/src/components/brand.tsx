import { Image, type ColorValue } from "react-native";

const brandMark = require("../../assets/brand-mark.png");
const monochromeMark = require("../../assets/brand-mark-mono.png");

function BrandIcon({
    size = 24,
    color,
}: {
    size?: number;
    color?: ColorValue;
}) {
    return (
        <Image
            source={color ? monochromeMark : brandMark}
            resizeMode="contain"
            style={{ width: size, height: size, tintColor: color }}
        />
    );
}

export { BrandIcon };
