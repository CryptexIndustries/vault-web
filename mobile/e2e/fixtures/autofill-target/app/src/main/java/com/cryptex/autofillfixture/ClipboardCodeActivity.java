package com.cryptex.autofillfixture;

import android.app.Activity;
import android.content.ClipData;
import android.content.ClipboardManager;
import android.os.Bundle;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.TextView;

// Android lets only the focused app read the clipboard, so the browser flow
// reads the code here.
public final class ClipboardCodeActivity extends Activity {
    @Override
    protected void onCreate(Bundle state) {
        super.onCreate(state);
        LinearLayout root = Ui.vertical(this);
        root.addView(Ui.title(this, "Clipboard code fixture"));
        Button show = new Button(this);
        show.setText("Show clipboard");
        TextView clipboard = new TextView(this);
        show.setOnClickListener(view -> {
            ClipData clip = getSystemService(ClipboardManager.class).getPrimaryClip();
            clipboard.setText(clip == null ? "Clipboard empty" : clip.getItemAt(0).getText());
        });
        root.addView(show);
        root.addView(clipboard);
        setContentView(root);
    }
}
