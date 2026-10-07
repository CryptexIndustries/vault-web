package com.cryptex.autofillfixture;

import java.nio.ByteBuffer;
import java.util.Locale;
import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;

final class FixtureTotp {
    // Base32 JBSWY3DPEHPK3PXP, shared with setup-autofill-vault.yaml.
    private static final byte[] SECRET = {0x48, 0x65, 0x6c, 0x6c, 0x6f, 0x21, (byte) 0xde, (byte) 0xad, (byte) 0xbe, (byte) 0xef};

    static boolean accepts(String value) {
        if (!value.matches("[0-9]{6}")) return false;
        long step = System.currentTimeMillis() / 30000;
        for (int offset = -1; offset <= 1; offset++) {
            if (code(step + offset).equals(value)) return true;
        }
        return false;
    }

    private static String code(long step) {
        try {
            Mac mac = Mac.getInstance("HmacSHA1");
            mac.init(new SecretKeySpec(SECRET, "HmacSHA1"));
            byte[] hash = mac.doFinal(ByteBuffer.allocate(8).putLong(step).array());
            int offset = hash[hash.length - 1] & 15;
            int number = ByteBuffer.wrap(hash, offset, 4).getInt() & 0x7fffffff;
            return String.format(Locale.ROOT, "%06d", number % 1000000);
        } catch (Exception error) {
            throw new IllegalStateException("Fixture TOTP verification failed", error);
        }
    }
}
