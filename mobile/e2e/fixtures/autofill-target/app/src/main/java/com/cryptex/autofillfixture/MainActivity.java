package com.cryptex.autofillfixture;

import android.app.Activity;
import android.content.Intent;
import android.os.Bundle;
import android.view.View;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.TextView;

public final class MainActivity extends Activity {
    @Override
    protected void onCreate(Bundle state) {
        super.onCreate(state);
        LinearLayout root = Ui.vertical(this);
        TextView title = Ui.title(this, "Autofill Test App");
        root.addView(title);
        root.addView(destination("Login form", LoginActivity.class));
        root.addView(destination("Registration form", RegisterActivity.class));
        root.addView(destination("Multi-step registration", MultiStepRegisterActivity.class));
        root.addView(destination("Password update form", UpdateActivity.class));
        root.addView(destination("Credential Manager passwords", CredentialManagerPasswordActivity.class));
        root.addView(destination("Accessibility login", AccessibilityLoginActivity.class));
        root.addView(destination("Accessibility registration", AccessibilityRegisterActivity.class));
        root.addView(webDestination("Exact web form", "https://login.exact.example.com/login"));
        root.addView(webDestination("Exact sibling web form", "https://sibling.exact.example.com/login"));
        root.addView(webDestination("Domain sibling web form", "https://accounts.domain.example.net/login"));
        root.addView(webDestination("Wildcard web form", "https://app.wild.example.org/login/team"));
        root.addView(webDestination("Wildcard apex web form", "https://wild.example.org/login/team"));
        setContentView(root);
    }

    private View destination(String label, Class<? extends Activity> activity) {
        Button button = new Button(this);
        button.setText(label);
        button.setOnClickListener(view -> startActivity(new Intent(this, activity)));
        return button;
    }

    private View webDestination(String label, String url) {
        Button button = new Button(this);
        button.setText(label);
        button.setOnClickListener(view -> {
            Intent intent = new Intent(this, WebLoginActivity.class);
            intent.putExtra(WebLoginActivity.URL_EXTRA, url);
            startActivity(intent);
        });
        return button;
    }
}
