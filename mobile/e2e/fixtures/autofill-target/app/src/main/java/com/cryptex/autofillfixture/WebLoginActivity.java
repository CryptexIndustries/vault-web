package com.cryptex.autofillfixture;

import android.app.Activity;
import android.content.Context;
import android.net.Uri;
import android.os.Bundle;
import android.view.View;
import android.view.ViewGroup;
import android.view.ViewStructure;
import android.widget.LinearLayout;

public final class WebLoginActivity extends Activity {
    static final String URL_EXTRA = "url";

    @Override
    protected void onCreate(Bundle state) {
        super.onCreate(state);
        String url = getIntent().getStringExtra(URL_EXTRA);
        if (url == null) {
            finish();
            return;
        }

        DomainLayout root = new DomainLayout(this, Uri.parse(url));
        root.setOrientation(LinearLayout.VERTICAL);
        int padding = Math.round(24 * getResources().getDisplayMetrics().density);
        root.setPadding(padding, padding, padding, padding);
        root.setLayoutParams(new ViewGroup.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT,
            ViewGroup.LayoutParams.MATCH_PARENT
        ));
        root.addView(Ui.title(this, "Web login fixture"));
        root.addView(Ui.username(this, "Username"));
        root.addView(Ui.password(this, "Password", false));
        setContentView(root);
    }

    private static final class DomainLayout extends LinearLayout {
        private final Uri webDomain;

        DomainLayout(Context context, Uri webDomain) {
            super(context);
            this.webDomain = webDomain;
            setImportantForAutofill(View.IMPORTANT_FOR_AUTOFILL_YES);
        }

        @Override
        public void onProvideAutofillStructure(ViewStructure structure, int flags) {
            super.onProvideAutofillStructure(structure, flags);
            structure.setWebDomain(webDomain.toString());
        }
    }
}
