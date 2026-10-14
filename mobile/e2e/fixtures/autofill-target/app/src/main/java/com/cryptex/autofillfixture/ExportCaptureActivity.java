package com.cryptex.autofillfixture;

import android.app.Activity;
import android.content.ContentValues;
import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;
import android.provider.MediaStore;
import android.provider.OpenableColumns;
import android.database.Cursor;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.TextView;
import java.io.InputStream;
import java.io.OutputStream;

/** Receives the app's real exported bytes through the Android share sheet. */
public final class ExportCaptureActivity extends Activity {
    @Override public void onCreate(Bundle state) {
        super.onCreate(state);
        LinearLayout layout = new LinearLayout(this);
        layout.setOrientation(LinearLayout.VERTICAL);
        int padding = Math.round(24 * getResources().getDisplayMetrics().density);
        layout.setPadding(padding, padding * 2, padding, padding);
        TextView result = new TextView(this);
        layout.addView(result);
        setContentView(layout);
        Uri destination = null;
        try {
            if (!Intent.ACTION_SEND.equals(getIntent().getAction())) {
                throw new IllegalArgumentException("Expected an Android file share");
            }
            Uri source = getIntent().getParcelableExtra(Intent.EXTRA_STREAM);
            if (source == null) throw new IllegalArgumentException("Shared file missing");
            String type = getIntent().getType();
            boolean json = "application/json".equals(type);
            boolean link = false;
            try (Cursor cursor = getContentResolver().query(source,
                    new String[] {OpenableColumns.DISPLAY_NAME}, null, null, null)) {
                if (cursor != null && cursor.moveToFirst()) {
                    link = cursor.getString(0).endsWith(".cryxlink");
                }
            }
            String name = json ? "e2e-export.json" : link ? "e2e-invitation.cryxlink" : "e2e-export.cryx";
            // Delete our previous capture so DocumentsUI never chooses stale bytes.
            getContentResolver().delete(MediaStore.Downloads.EXTERNAL_CONTENT_URI,
                MediaStore.MediaColumns.DISPLAY_NAME + "=?", new String[] {name});
            ContentValues values = new ContentValues();
            values.put(MediaStore.MediaColumns.DISPLAY_NAME, name);
            values.put(MediaStore.MediaColumns.MIME_TYPE, json ? type : "application/octet-stream");
            values.put(MediaStore.MediaColumns.RELATIVE_PATH, "Download/");
            values.put(MediaStore.MediaColumns.IS_PENDING, 1);
            destination = getContentResolver().insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, values);
            if (destination == null) throw new IllegalStateException("Cannot create captured export");
            long length = 0;
            try (InputStream input = getContentResolver().openInputStream(source);
                 OutputStream output = getContentResolver().openOutputStream(destination)) {
                if (input == null || output == null) throw new IllegalStateException("Cannot open shared file");
                byte[] buffer = new byte[8192];
                int read;
                while ((read = input.read(buffer)) != -1) {
                    output.write(buffer, 0, read);
                    length += read;
                }
            }
            if (length == 0) throw new IllegalStateException("Export is empty");
            values.clear();
            values.put(MediaStore.MediaColumns.IS_PENDING, 0);
            getContentResolver().update(destination, values, null, null);
            result.setText("E2E export captured: " + name + " (" + length + " bytes)");
        } catch (Exception error) {
            if (destination != null) getContentResolver().delete(destination, null, null);
            result.setText("E2E export failed: " + error.getClass().getSimpleName());
        }
        Button done = new Button(this);
        done.setAllCaps(false);
        done.setText("Return to vault");
        done.setOnClickListener(view -> finish());
        layout.addView(done);
    }
}
