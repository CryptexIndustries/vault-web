import java.nio.ByteBuffer;
import java.nio.charset.StandardCharsets;
import java.util.Arrays;
import java.util.HashMap;
import java.util.Map;

public final class WebRtcSendRegression {
    static final class Base64 {
        static final int NO_WRAP = 2;
        static byte[] decode(String data, int flags) {
            if (flags != NO_WRAP) throw new AssertionError("Changed base64 flags");
            return java.util.Base64.getDecoder().decode(data);
        }
    }
    static final class Log {
        static void d(String tag, String message) {}
        static void e(String tag, String message) {}
    }
    static final class DataChannel {
        static final class Buffer {
            final ByteBuffer data;
            final boolean binary;
            Buffer(ByteBuffer data, boolean binary) { this.data = data; this.binary = binary; }
        }
        Buffer sent;
        int sends;
        boolean send(Buffer buffer) { sent = buffer; sends++; return true; }
    }
    static final class DataChannelWrapper {
        final DataChannel channel = new DataChannel();
        DataChannel getDataChannel() { return channel; }
    }
    static final class PeerConnectionObserver {
        static final String TAG = "fixture";
        final Map<String, DataChannelWrapper> dataChannels = new HashMap<>();
        /* SEND_METHOD */
    }
    public static void main(String[] args) {
        if (args.length == 0 || args.length % 4 != 0) throw new AssertionError("Missing JS send cases");
        for (int index = 0; index < args.length; index += 4) {
            PeerConnectionObserver observer = new PeerConnectionObserver();
            DataChannelWrapper wrapper = new DataChannelWrapper();
            observer.dataChannels.put("channel", wrapper);
            observer.dataChannelSend("channel", args[index + 1], args[index]);
            DataChannel channel = wrapper.channel;
            if (channel.sends != 1) throw new AssertionError("Case " + index / 4 + " did not send exactly once");
            byte[] actual = new byte[channel.sent.data.remaining()];
            channel.sent.data.get(actual);
            byte[] expected = java.util.Base64.getDecoder().decode(args[index + 2]);
            if (!Arrays.equals(actual, expected)) throw new AssertionError("Case " + index / 4 + " changed payload bytes");
            if (channel.sent.binary != Boolean.parseBoolean(args[index + 3])) {
                throw new AssertionError("Case " + index / 4 + " changed WebRTC text/binary wire type");
            }
        }
        System.out.println("Installed JS/native send regression passed " + args.length / 4 + " Android cases");
    }
}
