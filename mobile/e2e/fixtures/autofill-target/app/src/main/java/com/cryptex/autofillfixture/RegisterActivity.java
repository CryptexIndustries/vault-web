package com.cryptex.autofillfixture;

import android.app.Activity;
import android.os.Bundle;
import android.widget.Button;
import android.widget.EditText;
import android.widget.LinearLayout;

public final class RegisterActivity extends Activity {
    @Override
    protected void onCreate(Bundle state) {
        super.onCreate(state);
        LinearLayout root = Ui.vertical(this);
        root.addView(Ui.title(this, "Native registration fixture"));
        EditText email = Ui.email(this, "Email address");
        EditText username = Ui.username(this, "New username");
        EditText password = Ui.password(this, "New password", true);
        EditText confirmation = Ui.password(this, "Confirm password", true);
        root.addView(email);
        root.addView(username);
        root.addView(password);
        root.addView(confirmation);
        Button submit = new Button(this);
        submit.setText("Create account");
        submit.setOnClickListener(view -> {
            root.removeAllViews();
            root.addView(Ui.title(this, "Native registration complete"));
        });
        root.addView(submit);
        Ui.inputOracle(root, () -> "earlier-native-email@example.test".contentEquals(email.getText())
            && "native@example.test".contentEquals(username.getText())
            && "native-password-one".contentEquals(password.getText())
            && "native-password-one".contentEquals(confirmation.getText()));
        setContentView(root);
    }
}
