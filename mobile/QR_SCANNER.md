# Android QR scanner

All Android builds use Java ZXing core 3.5.3 with Expo Camera's existing CameraX
preview. `patches/expo-camera@57.0.4.patch` contains the adapter and native tests.
The patch removes more production code than it adds. iOS scanning is unchanged.

The app's `CameraView` callers and shared QR protocol are unchanged. Link chunks
remain 750 characters and rotate every 250 ms. Frames decode on one background
thread; callbacks return to the main thread. CameraX drops stale frames while
decoding, and the analyzer does not suppress repeated results. It copies only
luminance pixels, handles padded rows/pixel strides, clears the temporary copy,
and releases frames on success, failure, and unsupported formats. QR contents
are never logged. Existing TOTP parsing and device-link validation still run
after decoding; a successful QR decode is not authentication.

The decoder reads full frames with QR-only, TRY_HARDER and inverted-code options.
It tries HybridBinarizer and then GlobalHistogramBinarizer. The result's `data`
and `raw` contain the exact decoded text. Geometry is empty rather than treating
ZXing finder points as barcode corners; Cryptex uses only text. Other barcode
formats, `scanFromURLAsync`, and `launchScanner` are outside this patch's supported
Android API. The last two reject explicitly and modern-scanner availability is
false. Camera preview, photo/video capture and permissions retain Expo's code.

After a failed decode, the analyzer also tries quarter-turns of the binarized
image. CameraX orientation metadata describes the receiving phone, not the
orientation of a code displayed on another device. These retries add work on
missed frames; they do not change capture resolution or QR rotation timing.
The matrix is local to each frame and cleared after decoding.

Link receive uses a collector per scan session. Leaving the screen, cancelling,
switching input method or restarting discards its parts and rejects late camera
events and asynchronous hash results. A completed collection starts only one
hash check even if more camera frames arrive during verification.

## Verification

With Android SDK and JDK configured, from the repository root:

```sh
pnpm install --frozen-lockfile
pnpm mobile:build -- --dev
pnpm mobile:e2e -- qr
```

The test command uses the actual shared chunker and the same JS QR encoder as
the mobile sender. It tests TOTP, Unicode, full-size link chunks, rotation,
inversion, rectangular padded direct buffers, repeated/out-of-order chunks, malformed frames
and callback failure recovery. JVM tests substitute Android's empty Bundle;
they exercise real ZXing decoding and the real analyzer, not camera hardware.
The command also checks release compile/runtime dependencies, source linkage,
and the merged manifest. CI runs it after the E2E APK build and before the
unsigned production APK build.

Native tests cover turning the sender's code independently of the receiving
phone, then returning upright repeatedly on the same analyzer. Run
`pnpm mobile:check -- unit --runInBand qr-scan-session` for collection cancellation,
reopening and pending-hash regression tests. These checks do not establish
sustained camera throughput or thermal behavior on a phone.

The synthetic corpus uses 400 camera pixels across the QR. A probe with only
200 camera pixels failed on the dense link chunks, including after upscaling.
That is a known sampling limit of this implementation, not a passing acceptance
case. The sender's 200 CSS px/dp rendering is unchanged; its size in camera
pixels depends on screen density, distance, zoom and analysis resolution.

Physical-device acceptance is still required. Scan existing web, extension and
mobile invitations at the unchanged timing, confirm every chunk assembles, and
compare completion time with the previous ML Kit build. Include a lower-end
phone, portrait/landscape, dim light, glare, permission denial, background/resume
and reopening the scanner. Confirm camera work does not block typing/navigation.
Do not resolve a failure by changing shared payload size or timing.

## Upgrading

`mobile/package.json` pins `expo-camera` and requests its Android source build
through `expo.autolinking.android.buildFromSource`. Without that setting Expo 57
can silently use the unpatched upstream AAR. Keep both settings.

Use `pnpm patch expo-camera@<new-version>`, port the scanner patch, then
`pnpm patch-commit <edit-directory>`. Update the exact package version and remove
the old patch registration only once the new patch is installed. Run the command
above and physical-device checks. Verify the native tests actually run rather
than reporting NO-SOURCE. Review upstream camera lifecycle/executor changes.

The test command rejects ML Kit/Google Code Scanner dependencies and the upstream
camera Maven artifact. It checks compile dependencies too, so switching a
proprietary library to `compileOnly` is not sufficient. For F-Droid packaging,
remove unused local Maven AARs and Apple prebuilds from the installed Expo
packages, then audit the final APK. Follow the
[source cleanup instructions](fdroid/README.md#isolated-source-cleanup).

ZXing core is Apache-2.0; Expo Camera is MIT. The adapter was written for this
project using the libraries' APIs, without copying Proton's GPL implementation.
