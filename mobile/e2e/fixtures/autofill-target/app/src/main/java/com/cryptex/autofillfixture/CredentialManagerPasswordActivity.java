package com.cryptex.autofillfixture;

import android.app.Activity;
import android.os.Bundle;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.TextView;

import androidx.credentials.CreatePasswordRequest;
import androidx.credentials.CreateCredentialResponse;
import androidx.credentials.CredentialManager;
import androidx.credentials.CredentialManagerCallback;
import androidx.credentials.exceptions.CreateCredentialException;
import androidx.credentials.exceptions.GetCredentialException;
import androidx.credentials.exceptions.GetCredentialCancellationException;
import androidx.credentials.GetCredentialRequest;
import androidx.credentials.GetCredentialResponse;
import androidx.credentials.GetPasswordOption;
import androidx.credentials.PasswordCredential;

public final class CredentialManagerPasswordActivity extends Activity {
    private static final String USERNAME = "cm-native@example.test";
    private static final String PASSWORD = "cm-native-password";

    @Override
    protected void onCreate(Bundle state) {
        super.onCreate(state);
        LinearLayout root = Ui.vertical(this);
        root.addView(Ui.title(this, "Credential Manager password fixture"));
        TextView result = new TextView(this);
        result.setText("No Credential Manager request yet");

        Button create = new Button(this);
        create.setText("Create password credential");
        create.setOnClickListener(view -> {
            result.setText("Creating password credential");
            CredentialManager.create(this).createCredentialAsync(
                this,
                new CreatePasswordRequest(USERNAME, PASSWORD),
                null,
                command -> runOnUiThread(command),
                new CredentialManagerCallback<CreateCredentialResponse, CreateCredentialException>() {
                    @Override
                    public void onResult(CreateCredentialResponse response) {
                        result.setText("Credential Manager create complete");
                    }

                    @Override
                    public void onError(CreateCredentialException error) {
                        result.setText("Credential Manager create failed: " + error.getClass().getSimpleName());
                    }
                }
            );
        });

        Button get = new Button(this);
        get.setText("Get password credential");
        get.setOnClickListener(view -> {
            result.setText("Getting password credential");
            GetCredentialRequest request = new GetCredentialRequest.Builder()
                .addCredentialOption(new GetPasswordOption())
                .build();
            CredentialManager.create(this).getCredentialAsync(
                this,
                request,
                null,
                command -> runOnUiThread(command),
                new CredentialManagerCallback<GetCredentialResponse, GetCredentialException>() {
                    @Override
                    public void onResult(GetCredentialResponse response) {
                        if (response.getCredential() instanceof PasswordCredential password &&
                            USERNAME.equals(password.getId()) && PASSWORD.equals(password.getPassword())) {
                            result.setText("Credential Manager get complete: " + USERNAME);
                        } else {
                            result.setText("Credential Manager returned a different password");
                        }
                    }

                    @Override
                    public void onError(GetCredentialException error) {
                        result.setText(error instanceof GetCredentialCancellationException
                            ? "Credential Manager get cancelled; no password returned"
                            : "Credential Manager get failed: " + error.getClass().getSimpleName());
                    }
                }
            );
        });

        root.addView(create);
        root.addView(get);
        root.addView(result);
        setContentView(root);
    }
}
