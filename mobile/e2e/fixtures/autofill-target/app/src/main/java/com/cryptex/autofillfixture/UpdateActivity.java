package com.cryptex.autofillfixture;

import android.app.Activity;
import android.os.Bundle;
import android.widget.Button;
import android.widget.EditText;
import android.widget.LinearLayout;

public final class UpdateActivity extends Activity {
    @Override
    protected void onCreate(Bundle state) {
        super.onCreate(state);
        LinearLayout root = Ui.vertical(this);
        root.addView(Ui.title(this, "Native password update fixture"));
        EditText username = Ui.username(this, "Username");
        EditText password = Ui.password(this, "New password", true);
        EditText confirmation = Ui.password(this, "Confirm new password", true);
        root.addView(username);
        root.addView(password);
        root.addView(confirmation);
        Button submit = new Button(this);
        submit.setText("Change password");
        submit.setOnClickListener(view -> {
            root.removeAllViews();
            root.addView(Ui.title(this, "Native password changed"));
        });
        root.addView(submit);
        Ui.inputOracle(root, () -> "native@example.test".contentEquals(username.getText())
            && "native-password-two".contentEquals(password.getText())
            && "native-password-two".contentEquals(confirmation.getText()));
        setContentView(root);
    }
}
