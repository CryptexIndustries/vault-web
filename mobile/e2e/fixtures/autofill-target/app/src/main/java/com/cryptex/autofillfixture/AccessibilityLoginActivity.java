package com.cryptex.autofillfixture;

import android.app.Activity;
import android.os.Bundle;
import android.view.View;
import android.widget.Button;
import android.widget.EditText;
import android.widget.LinearLayout;

public final class AccessibilityLoginActivity extends Activity {
    @Override
    protected void onCreate(Bundle state) {
        super.onCreate(state);
        LinearLayout root = Ui.vertical(this);
        root.setImportantForAutofill(View.IMPORTANT_FOR_AUTOFILL_NO_EXCLUDE_DESCENDANTS);
        root.addView(Ui.title(this, "Accessibility login fixture"));
        EditText username = Ui.username(this, "Accessibility username");
        EditText password = Ui.password(this, "Accessibility password", false);
        EditText otp = Ui.username(this, "Verification code");
        root.addView(username);
        root.addView(password);
        root.addView(otp);
        Button submit = new Button(this);
        submit.setText("Validate accessibility login");
        submit.setOnClickListener(view -> {
            boolean validCode = FixtureTotp.accepts(otp.getText().toString());
            boolean valid = "fixture@example.test".contentEquals(username.getText())
                && "fixture-password".contentEquals(password.getText())
                && validCode;
            root.removeAllViews();
            root.addView(Ui.title(
                this,
                valid ? "Accessibility login complete" : "Accessibility login incomplete"
            ));
            root.addView(Ui.title(this, validCode
                ? "Accessibility verification code matched"
                : "Accessibility verification code mismatch"));
        });
        root.addView(submit);
        setContentView(root);
    }
}
