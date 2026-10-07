package com.cryptex.autofillfixture;

import android.app.Activity;
import android.os.Bundle;
import android.widget.Button;
import android.widget.EditText;
import android.widget.LinearLayout;

public final class MultiStepRegisterActivity extends Activity {
    private EditText username;

    @Override
    protected void onCreate(Bundle state) {
        super.onCreate(state);
        showUsernameStep();
    }

    private void showUsernameStep() {
        LinearLayout root = Ui.vertical(this);
        root.addView(Ui.title(this, "Multi-step registration: username"));
        username = Ui.username(this, "Account username");
        root.addView(username);
        Button next = new Button(this);
        next.setText("Continue");
        next.setOnClickListener(view -> showPasswordStep());
        root.addView(next);
        setContentView(root);
    }

    private void showPasswordStep() {
        LinearLayout root = Ui.vertical(this);
        root.addView(Ui.title(this, "Multi-step registration: password"));
        EditText password = Ui.password(this, "New password", true);
        EditText confirmation = Ui.password(this, "Confirm password", true);
        root.addView(password);
        root.addView(confirmation);
        Button submit = new Button(this);
        submit.setText("Create account");
        submit.setOnClickListener(view -> {
            root.removeAllViews();
            root.addView(Ui.title(this, "Multi-step registration complete"));
        });
        root.addView(submit);
        Ui.inputOracle(root, () -> "multistep@example.test".contentEquals(username.getText())
            && "multistep-password".contentEquals(password.getText())
            && "multistep-password".contentEquals(confirmation.getText()));
        setContentView(root);
        password.requestFocus();
    }
}
