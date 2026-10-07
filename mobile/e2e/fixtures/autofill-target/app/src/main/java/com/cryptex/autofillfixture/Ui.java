package com.cryptex.autofillfixture;

import android.content.Context;
import android.graphics.Typeface;
import android.text.InputType;
import android.view.View;
import android.view.ViewGroup;
import android.widget.Button;
import android.widget.EditText;
import java.util.function.BooleanSupplier;
import android.widget.LinearLayout;
import android.widget.TextView;

final class Ui {
    private Ui() {}

    static LinearLayout vertical(Context context) {
        LinearLayout layout = new LinearLayout(context);
        layout.setOrientation(LinearLayout.VERTICAL);
        int padding = Math.round(24 * context.getResources().getDisplayMetrics().density);
        layout.setPadding(padding, padding, padding, padding);
        layout.setLayoutParams(new ViewGroup.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT,
            ViewGroup.LayoutParams.MATCH_PARENT
        ));
        return layout;
    }

    static TextView title(Context context, String value) {
        TextView title = new TextView(context);
        title.setText(value);
        title.setTextSize(24);
        title.setTypeface(Typeface.DEFAULT, Typeface.BOLD);
        return title;
    }

    static EditText username(Context context, String label) {
        EditText input = new EditText(context);
        input.setHint(label);
        input.setSingleLine(true);
        input.setInputType(InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_VARIATION_EMAIL_ADDRESS);
        input.setAutofillHints(View.AUTOFILL_HINT_USERNAME);
        input.setImportantForAutofill(View.IMPORTANT_FOR_AUTOFILL_YES);
        return input;
    }

    static EditText email(Context context, String label) {
        EditText input = new EditText(context);
        input.setHint(label);
        input.setSingleLine(true);
        input.setInputType(InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_VARIATION_EMAIL_ADDRESS);
        input.setAutofillHints(View.AUTOFILL_HINT_EMAIL_ADDRESS);
        input.setImportantForAutofill(View.IMPORTANT_FOR_AUTOFILL_YES);
        return input;
    }

    static EditText password(Context context, String label, boolean isNew) {
        EditText input = new EditText(context);
        input.setHint(label);
        input.setSingleLine(true);
        input.setInputType(InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_VARIATION_PASSWORD);
        input.setAutofillHints(isNew ? "newPassword" : View.AUTOFILL_HINT_PASSWORD);
        input.setImportantForAutofill(View.IMPORTANT_FOR_AUTOFILL_YES);
        return input;
    }
    // This APK is an isolated fixture. Check typed values without submitting or
    // changing fields, including passwords masked in the accessibility tree.
    static void inputOracle(LinearLayout root, BooleanSupplier matches) {
        Button verify = new Button(root.getContext());
        verify.setText("Verify fixture inputs");
        verify.setImportantForAutofill(View.IMPORTANT_FOR_AUTOFILL_NO);
        TextView result = new TextView(root.getContext());
        result.setImportantForAutofill(View.IMPORTANT_FOR_AUTOFILL_NO);
        verify.setOnClickListener(view -> result.setText(matches.getAsBoolean()
            ? "Fixture inputs matched" : "Fixture inputs mismatch"));
        root.addView(verify);
        root.addView(result);
    }

}
