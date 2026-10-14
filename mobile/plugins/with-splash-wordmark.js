const { withFinalizedMod, XML } = require("@expo/config-plugins");
const fs = require("node:fs/promises");
const path = require("node:path");

const IMAGE_NAME = "SplashScreenWordmark";
const IMAGE_ID = "CRYPTEX-SplashWordmark";
// The approved artwork is 200 × 80 points at 3x resolution, with 4 points
// below the wordmark layout. Android's branding slot adds a 60dp bottom inset.
const WIDTH = 200;
const HEIGHT = 80;
const BOTTOM = 60;

module.exports = (config) => {
    config = withFinalizedMod(config, [
        "android",
        async (mod) => {
            const resources = path.join(
                mod.modRequest.platformProjectRoot,
                "app/src/main/res",
            );
            const stylesPath = path.join(resources, "values/styles.xml");
            const styles = await XML.readXMLAsync({ path: stylesPath });
            const splash = styles.resources.style.find(
                (style) => style.$.name === "Theme.App.SplashScreen",
            );
            for (const [name, value] of Object.entries({
                "android:windowSplashScreenBrandingImage":
                    "@drawable/splashscreen_wordmark",
                "android:windowBackground":
                    "@drawable/splashscreen_branded_background",
            })) {
                splash.item = splash.item.filter(
                    (item) => item.$.name !== name,
                );
                splash.item.push({ $: { name }, _: value });
            }
            await XML.writeXMLAsync({ path: stylesPath, xml: styles });
            const images = path.join(resources, "drawable-xxhdpi");
            await fs.mkdir(images, { recursive: true });
            await fs.copyFile(
                path.join(
                    mod.modRequest.projectRoot,
                    "assets/splash-wordmark.png",
                ),
                path.join(images, "splashscreen_wordmark.png"),
            );
            // Android 12+ uses its branding slot. Older Android versions use
            // this launch-window background, with the same centered app logo.
            await fs.mkdir(path.join(resources, "drawable"), {
                recursive: true,
            });
            await fs.writeFile(
                path.join(
                    resources,
                    "drawable/splashscreen_branded_background.xml",
                ),
                `<?xml version="1.0" encoding="utf-8"?>
<layer-list xmlns:android="http://schemas.android.com/apk/res/android">
    <item android:drawable="@color/splashscreen_background" />
    <item>
        <bitmap android:gravity="center" android:src="@drawable/splashscreen_logo" />
    </item>
    <item android:width="${WIDTH}dp" android:height="${HEIGHT}dp" android:gravity="bottom|center_horizontal" android:bottom="${BOTTOM}dp">
        <bitmap android:gravity="fill" android:src="@drawable/splashscreen_wordmark" />
    </item>
</layer-list>
`,
            );
            return mod;
        },
    ]);
    return withFinalizedMod(config, [
        "ios",
        async (mod) => {
            // Expo owns the storyboard provider, so update its finished output.
            const project = path.join(
                mod.modRequest.platformProjectRoot,
                mod.modRequest.projectName,
            );
            const storyboard = path.join(project, "SplashScreen.storyboard");
            const xml = await XML.readXMLAsync({ path: storyboard });
            const document = xml.document;
            const view =
                document.scenes[0].scene[0].objects[0].viewController[0]
                    .view[0];
            const frame = view.rect[0].$;
            const images = view.subviews[0].imageView;
            view.subviews[0].imageView = images.filter(
                (image) => image.$.id !== IMAGE_ID,
            );
            view.subviews[0].imageView.push({
                $: {
                    id: IMAGE_ID,
                    image: IMAGE_NAME,
                    userLabel: "Cryptex Industries",
                    contentMode: "scaleAspectFit",
                    clipsSubviews: "YES",
                    userInteractionEnabled: "NO",
                    translatesAutoresizingMaskIntoConstraints: "NO",
                },
                rect: [
                    {
                        $: {
                            key: "frame",
                            x: (Number(frame.width) - WIDTH) / 2,
                            y: Number(frame.height) - BOTTOM - HEIGHT,
                            width: WIDTH,
                            height: HEIGHT,
                        },
                    },
                ],
            });
            const constraints = view.constraints[0].constraint;
            view.constraints[0].constraint = constraints.filter(
                (constraint) =>
                    constraint.$.firstItem !== IMAGE_ID &&
                    constraint.$.secondItem !== IMAGE_ID,
            );
            view.constraints[0].constraint.push(
                {
                    $: {
                        firstItem: IMAGE_ID,
                        firstAttribute: "centerX",
                        secondItem: view.$.id,
                        secondAttribute: "centerX",
                        id: "CRYPTEX-WordmarkCenterX",
                    },
                },
                {
                    $: {
                        firstItem: view.$.id,
                        firstAttribute: "bottom",
                        secondItem: IMAGE_ID,
                        secondAttribute: "bottom",
                        constant: BOTTOM,
                        id: "CRYPTEX-WordmarkBottom",
                    },
                },
                {
                    $: {
                        firstItem: IMAGE_ID,
                        firstAttribute: "width",
                        constant: WIDTH,
                        id: "CRYPTEX-WordmarkWidth",
                    },
                },
                {
                    $: {
                        firstItem: IMAGE_ID,
                        firstAttribute: "height",
                        constant: HEIGHT,
                        id: "CRYPTEX-WordmarkHeight",
                    },
                },
            );
            const resources = document.resources[0];
            resources.image = resources.image.filter(
                (image) => image.$.name !== IMAGE_NAME,
            );
            resources.image.push({
                $: { name: IMAGE_NAME, width: WIDTH, height: HEIGHT },
            });
            await XML.writeXMLAsync({ path: storyboard, xml });
            const imageSet = path.join(
                project,
                `Images.xcassets/${IMAGE_NAME}.imageset`,
            );
            await fs.mkdir(imageSet, { recursive: true });
            await fs.copyFile(
                path.join(
                    mod.modRequest.projectRoot,
                    "assets/splash-wordmark.png",
                ),
                path.join(imageSet, "wordmark@3x.png"),
            );
            await fs.writeFile(
                path.join(imageSet, "Contents.json"),
                JSON.stringify(
                    {
                        images: [
                            {
                                filename: "wordmark@3x.png",
                                idiom: "universal",
                                scale: "3x",
                            },
                        ],
                        info: { version: 1, author: "xcode" },
                    },
                    null,
                    2,
                ) + "\n",
            );
            return mod;
        },
    ]);
};
