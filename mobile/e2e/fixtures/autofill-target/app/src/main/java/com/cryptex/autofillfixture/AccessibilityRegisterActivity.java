package com.cryptex.autofillfixture;

import android.app.Activity;
import android.os.Bundle;
import android.view.View;
import android.widget.EditText;
import android.widget.LinearLayout;

public final class AccessibilityRegisterActivity extends Activity {
    @Override
    protected void onCreate(Bundle state) {
        super.onCreate(state);
        LinearLayout root = Ui.vertical(this);
        root.setImportantForAutofill(View.IMPORTANT_FOR_AUTOFILL_NO_EXCLUDE_DESCENDANTS);
        root.addView(Ui.title(this, "Accessibility registration fixture"));
        EditText email = Ui.email(this, "Accessibility email address");
        EditText username = Ui.username(this, "Accessibility new username");
        EditText password = Ui.password(this, "Accessibility new password", true);
        EditText confirmation = Ui.password(this, "Accessibility confirm password", true);
        root.addView(email);
        root.addView(username);
        root.addView(password);
        root.addView(confirmation);
        setContentView(root);
    }
}
