import java.nio.ByteBuffer;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Collections;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;

// The runner inserts the installed wrapper class and exact teardown methods.
public final class WebRtcLifecycleRegression {
    static void check(boolean result, String message) {
        if (!result) throw new AssertionError(message);
    }

    static void onExecutor() {
        check(Thread.currentThread().getName().equals("bridge-executor"),
            "Native ownership must release on the bridge executor, not a callback thread");
    }

    static final class ThreadUtils {
        static final ExecutorService executor = Executors.newSingleThreadExecutor(
            task -> new Thread(task, "bridge-executor"));
        static final AtomicReference<Throwable> failure = new AtomicReference<>();

        static void runOnExecutor(Runnable task) {
            executor.execute(() -> {
                try { task.run(); }
                catch (Throwable error) { failure.compareAndSet(null, error); }
            });
        }

        static void drain() throws Exception {
            executor.submit(() -> {}).get();
            if (failure.get() != null) throw new AssertionError("Bridge teardown failed", failure.get());
        }
    }

    static final class Log {
        static void d(String tag, String message) {}
    }

    @interface Nullable {}
    static final class Base64 {
        static final int NO_WRAP = 2;
        static String encodeToString(byte[] bytes, int flags) {
            return java.util.Base64.getEncoder().encodeToString(bytes);
        }
    }
    static final class WritableMap extends HashMap<String, Object> {
        void putString(String key, String value) { put(key, value); }
        void putInt(String key, int value) { put(key, value); }
        void putDouble(String key, double value) { put(key, value); }
    }
    static final class Arguments {
        static WritableMap createMap() { return new WritableMap(); }
    }

    static class MediaStreamTrack {}
    static final class VideoTrack extends MediaStreamTrack {}
    static final class VideoTrackAdapter {
        void removeAdapter(MediaStreamTrack track) {}
    }

    static final class DataChannel {
        enum State { CONNECTING, OPEN, CLOSING, CLOSED }
        interface Observer {
            void onBufferedAmountChange(long amount);
            void onMessage(Buffer buffer);
            void onStateChange();
        }
        static final class Buffer {
            final ByteBuffer data;
            final boolean binary;
            Buffer(ByteBuffer data, boolean binary) { this.data = data; this.binary = binary; }
        }
        final int channelId;
        volatile State channelState = State.OPEN;
        int unregisters;
        int releases;
        CountDownLatch stateEntered;
        CountDownLatch stateGate;
        CountDownLatch unregisterCalled;

        DataChannel(int id) { channelId = id; }

        int id() {
            check(releases == 0, "Native id read after release");
            return channelId;
        }

        State state() {
            check(releases == 0, "Native state read after release");
            if (stateGate != null) {
                stateEntered.countDown();
                try { check(stateGate.await(5, TimeUnit.SECONDS), "Callback state gate timed out"); }
                catch (InterruptedException error) { throw new AssertionError(error); }
            }
            check(releases == 0, "Native state read raced with release");
            return channelState;
        }

        void unregisterObserver() {
            onExecutor();
            check(releases == 0, "Observer access after native release");
            check(++unregisters == 1, "Observer must unregister exactly once");
            if (unregisterCalled != null) unregisterCalled.countDown();
        }

        void dispose() {
            onExecutor();
            check(unregisters == 1, "Native reference released before unregistering observer");
            check(++releases == 1, "Native reference released more than once");
        }
    }

    /* CHANNEL_WRAPPER */

    static final class PeerConnection {
        int releases;
        void dispose() {
            onExecutor();
            check(++releases == 1, "Peer reference released more than once");
        }
    }

    static final class PeerConnectionObserver {
        static final String TAG = "fixture";
        final int id = 1;
        final Map<String, DataChannelWrapper> dataChannels = new HashMap<>();
        final Map<String, String> remoteStreamIds = new HashMap<>();
        final Map<String, Object> remoteStreams = new HashMap<>();
        final Map<String, MediaStreamTrack> remoteTracks = new HashMap<>();
        final VideoTrackAdapter videoTrackAdapters = new VideoTrackAdapter();
        final PeerConnection peerConnection = new PeerConnection();

        PeerConnection getPeerConnection() { return peerConnection; }

        /* PEER_DISPOSE */
        /* CHANNEL_DISPOSE */
    }

    static final class WebRTCModule {
        static final String TAG = "fixture";
        final Map<Integer, PeerConnectionObserver> mPeerConnectionObservers = new HashMap<>();
        final List<WritableMap> events = Collections.synchronizedList(new ArrayList<>());

        void sendEvent(String name, WritableMap params) {
            check(name.equals("dataChannelStateChanged"), "Unexpected teardown event " + name);
            if (params.get("state").equals("closed")) {
                DataChannel nativeChannel = mPeerConnectionObservers.get(1).dataChannels
                    .get(params.get("reactTag")).getDataChannel();
                check(nativeChannel.channelState == DataChannel.State.CLOSED || nativeChannel.releases == 1,
                    "Terminal event must follow native CLOSED or actual native release");
            }
            events.add(params);
        }

        /* QUEUE_PEER_DISPOSE */
        /* QUEUE_CHANNEL_DISPOSE */
    }

    static void round(boolean peerFirst) throws Exception {
        WebRTCModule module = new WebRTCModule();
        PeerConnectionObserver peer = new PeerConnectionObserver();
        DataChannel localNative = new DataChannel(7);
        DataChannel remoteNative = new DataChannel(8);
        DataChannelWrapper local = new DataChannelWrapper(module, 1, "local", localNative);
        DataChannelWrapper remote = new DataChannelWrapper(module, 1, "remote", remoteNative);
        peer.dataChannels.put("local", local);
        peer.dataChannels.put("remote", remote);
        module.mPeerConnectionObservers.put(1, peer);

        if (peerFirst) {
            // Deterministic callback/executor overlap. State reads hold the wrapper
            // lock; unregister must let the in-flight callback finish before release.
            localNative.stateEntered = new CountDownLatch(1);
            localNative.stateGate = new CountDownLatch(1);
            localNative.unregisterCalled = new CountDownLatch(1);
            Thread callback = new Thread(() -> {
                try { local.onStateChange(); }
                catch (Throwable error) { ThreadUtils.failure.compareAndSet(null, error); }
            }, "native-callback");
            callback.start();
            check(localNative.stateEntered.await(5, TimeUnit.SECONDS), "Callback did not start");
            module.peerConnectionDispose(1);
            module.dataChannelDispose(1, "local");
            check(localNative.unregisterCalled.await(5, TimeUnit.SECONDS), "Unregister blocked on callback state lock");
            localNative.stateGate.countDown();
            callback.join(5_000);
            check(!callback.isAlive(), "Callback did not finish");
        } else {
            localNative.channelState = DataChannel.State.CLOSED;
            local.onStateChange();
            local.onStateChange();
            module.dataChannelDispose(1, "local");
            module.dataChannelDispose(1, "local");
            module.peerConnectionDispose(1);
        }
        module.dataChannelDispose(1, "local");
        module.dataChannelDispose(1, "remote");
        module.peerConnectionDispose(1);
        ThreadUtils.drain();
        ThreadUtils.runOnExecutor(() -> { local.dispose(); remote.dispose(); });
        ThreadUtils.drain();

        // Late duplicate and stale nonterminal callbacks must not touch freed JNI
        // objects, emit another close or reopen a JavaScript channel.
        localNative.channelState = DataChannel.State.OPEN;
        remoteNative.channelState = DataChannel.State.OPEN;
        local.onStateChange();
        remote.onStateChange();
        check(localNative.unregisters == 1 && localNative.releases == 1,
            "Local channel native reference leaked or released twice");
        check(remoteNative.unregisters == 1 && remoteNative.releases == 1,
            "Remote channel native reference leaked or released twice");
        check(peer.peerConnection.releases == 1, "Peer native reference leaked");
        check(peer.dataChannels.isEmpty(), "Retained channel map must clear");
        check(!module.mPeerConnectionObservers.containsKey(1), "Disposed peer must leave module map");
        for (String tag : List.of("local", "remote")) {
            boolean closed = false;
            for (WritableMap event : module.events) {
                if (!event.get("reactTag").equals(tag)) continue;
                check(!closed, "Event emitted after terminal close for " + tag);
                closed = event.get("state").equals("closed");
            }
            check(closed, "Missing native terminal event for " + tag);
        }
        // Feed these actual Java events to the installed JS listener in the runner.
        System.out.print("{\"peerFirst\":" + peerFirst + ",\"events\":[");
        for (int index = 0; index < module.events.size(); index++) {
            WritableMap event = module.events.get(index);
            if (index > 0) System.out.print(",");
            System.out.print("{\"reactTag\":\"" + event.get("reactTag") + "\",\"peerConnectionId\":"
                + event.get("peerConnectionId") + ",\"id\":" + event.get("id")
                + ",\"state\":\"" + event.get("state") + "\"}");
        }
        System.out.println("]}");
    }

    public static void main(String[] args) throws Exception {
        try {
            for (int i = 0; i < 100; i++) {
                round(false);
                round(true);
            }
        } finally {
            ThreadUtils.executor.shutdownNow();
        }
    }
}
