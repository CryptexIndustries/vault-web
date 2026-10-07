package com.cryptex.autofillfixture;

import android.app.Activity;
import android.os.Bundle;
import android.view.autofill.AutofillManager;
import android.widget.Button;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.TextView;

public final class LoginActivity extends Activity {
    @Override
    protected void onCreate(Bundle state) {
        super.onCreate(state);
        LinearLayout root = Ui.vertical(this);
        root.addView(Ui.title(this, "Native login fixture"));
        EditText username = Ui.username(this, "Username");
        EditText password = Ui.password(this, "Password", false);
        root.addView(username);
        root.addView(password);
        Button submit = new Button(this);
        submit.setText("Sign in");
        submit.setOnClickListener(view -> {
            getSystemService(AutofillManager.class).commit();
            TextView result = new TextView(this);
            result.setText("Signed in as " + username.getText());
            root.removeAllViews();
            root.addView(Ui.title(this, "Native login complete"));
            root.addView(result);
            if ("fixture@example.test".contentEquals(username.getText())) {
                TextView passwordResult = new TextView(this);
                passwordResult.setText("fixture-password".contentEquals(password.getText())
                    ? "Native fixture password matched"
                    : "Native fixture password mismatch");
                root.addView(passwordResult);
            }
        });
        root.addView(submit);
        Ui.inputOracle(root, () -> ("fixture@example.test".contentEquals(username.getText())
                && "fixture-password".contentEquals(password.getText()))
            || ("native-unknown@example.test".contentEquals(username.getText())
                && "native-unknown-password".contentEquals(password.getText())));
        setContentView(root);
    }
}
