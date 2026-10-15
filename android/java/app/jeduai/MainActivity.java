package app.jeduai;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.app.DownloadManager;
import android.content.ContentValues;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Environment;
import android.provider.MediaStore;
import android.util.Base64;
import android.view.KeyEvent;
import android.view.View;
import android.view.inputmethod.EditorInfo;
import android.webkit.CookieManager;
import android.webkit.DownloadListener;
import android.webkit.JavascriptInterface;
import android.webkit.URLUtil;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Button;
import android.widget.EditText;
import android.widget.ProgressBar;
import android.widget.TextView;
import android.widget.Toast;

import java.io.OutputStream;
import java.util.ArrayList;
import java.util.List;

/**
 * JeduAI Android client — a thin, native shell around the JeduAI web app.
 * First run: the user enters their JeduAI server address (self-hosted / school URL),
 * which is remembered in SharedPreferences. All learning content, auth and data
 * stay on the user's own JeduAI server.
 */
public class MainActivity extends Activity {

    private static final int FILE_CHOOSER_CODE = 1001;

    /**
     * Build-time default server. Empty = ask the user (normal self-hosted behaviour).
     * When a school/instance URL is known at build time, set it here (or via -PjeDUAI... sed)
     * and the app connects straight away on first launch — the address can still be
     * changed later from the offline screen's "Change server address".
     */
    private static final String DEFAULT_URL = "";

    private WebView web = null;
    private ProgressBar progress = null;
    private ValueCallback<Uri[]> fileCallback = null;
    private String serverUrl = null;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        serverUrl = getSharedPreferences("cfg", MODE_PRIVATE).getString("url", "");
        if ((serverUrl == null || serverUrl.isEmpty()) && DEFAULT_URL != null && DEFAULT_URL.length() > 0) {
            // A default server was baked in at build time — connect straight away.
            serverUrl = DEFAULT_URL;
            getSharedPreferences("cfg", MODE_PRIVATE).edit().putString("url", DEFAULT_URL).apply();
            showWeb(DEFAULT_URL);
        } else if (serverUrl == null || serverUrl.isEmpty()) {
            showSetup();
        } else {
            showWeb(serverUrl);
        }
    }

    /* ---------------- setup screen ---------------- */

    private void showSetup() {
        setContentView(R.layout.activity_setup);
        final EditText input = (EditText) findViewById(R.id.urlInput);
        String last = getSharedPreferences("cfg", MODE_PRIVATE).getString("last", "");
        if (last == null || last.isEmpty()) last = DEFAULT_URL != null && DEFAULT_URL.length() > 0 ? DEFAULT_URL : "https://";
        input.setText(last);
        final Button connect = (Button) findViewById(R.id.connectBtn);
        View.OnClickListener onConnect = new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                String u = normalize(input.getText().toString());
                Uri parsed = Uri.parse(u);
                if (u.length() < 10 || parsed.getHost() == null || parsed.getHost().isEmpty()) {
                    Toast.makeText(MainActivity.this, R.string.invalid_url, Toast.LENGTH_LONG).show();
                    return;
                }
                getSharedPreferences("cfg", MODE_PRIVATE).edit()
                        .putString("last", u)
                        .putString("url", u)
                        .apply();
                serverUrl = u;
                showWeb(u);
            }
        };
        connect.setOnClickListener(onConnect);
        input.setOnEditorActionListener(new TextView.OnEditorActionListener() {
            @Override
            public boolean onEditorAction(TextView v, int actionId, KeyEvent event) {
                if (actionId == EditorInfo.IME_ACTION_GO) {
                    connect.performClick();
                    return true;
                }
                return false;
            }
        });
    }

    private static String normalize(String raw) {
        String u = raw == null ? "" : raw.trim();
        if (u.isEmpty()) return "";
        // People sometimes paste the APK download link by mistake — use its origin instead.
        if (u.endsWith("/downloads/jeduai.apk")) {
            u = u.substring(0, u.length() - "/downloads/jeduai.apk".length());
        }
        String low = u.toLowerCase();
        if (!low.startsWith("http://") && !low.startsWith("https://")) u = "https://" + u;
        while (u.endsWith("/") && u.length() > 9) u = u.substring(0, u.length() - 1);
        return u;
    }

    /* ---------------- web screen ---------------- */

    @SuppressLint("SetJavaScriptEnabled")
    private void showWeb(final String url) {
        setContentView(R.layout.activity_main);
        web = (WebView) findViewById(R.id.webview);
        progress = (ProgressBar) findViewById(R.id.progress);

        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setDatabaseEnabled(true);
        s.setAllowFileAccess(true);
        s.setAllowContentAccess(true);
        s.setMediaPlaybackRequiresUserGesture(false);
        s.setMixedContentMode(WebSettings.MIXED_CONTENT_COMPATIBILITY_MODE);
        s.setLoadWithOverviewMode(true);
        s.setUseWideViewPort(true);

        CookieManager cm = CookieManager.getInstance();
        cm.setAcceptCookie(true);
        cm.setAcceptThirdPartyCookies(web, true);

        web.addJavascriptInterface(new BlobBridge(), "JeduAIApp");

        web.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                Uri u = request.getUrl();
                String host = u.getHost();
                String mine = Uri.parse(url).getHost();
                if (host != null && host.equalsIgnoreCase(mine)) {
                    return false; // same server -> stay inside the app
                }
                try {
                    startActivity(new Intent(Intent.ACTION_VIEW, u)); // external -> browser
                } catch (Exception ignored) {
                }
                return true;
            }

            @Override
            public void onPageFinished(WebView view, String finishedUrl) {
                view.evaluateJavascript(BLOB_HOOK_JS, null);
            }

            @Override
            public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
                if (request.isForMainFrame() && web != null) {
                    showOffline();
                }
            }
        });

        web.setWebChromeClient(new WebChromeClient() {
            @Override
            public void onProgressChanged(WebView view, int newProgress) {
                if (progress != null) {
                    progress.setVisibility(newProgress < 100 ? View.VISIBLE : View.GONE);
                    progress.setProgress(newProgress);
                }
            }

            @Override
            public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback,
                                             FileChooserParams params) {
                if (fileCallback != null) fileCallback.onReceiveValue(null);
                fileCallback = callback;
                try {
                    Intent i = params.createIntent();
                    if (params.getMode() == FileChooserParams.MODE_OPEN_MULTIPLE) {
                        i.putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true);
                    }
                    startActivityForResult(i, FILE_CHOOSER_CODE);
                } catch (Exception e) {
                    fileCallback = null;
                    Toast.makeText(MainActivity.this, R.string.no_file_app, Toast.LENGTH_SHORT).show();
                    return false;
                }
                return true;
            }
        });

        web.setDownloadListener(new DownloadListener() {
            @Override
            public void onDownloadStart(String dlUrl, String userAgent, String contentDisposition,
                                        String mimetype, long contentLength) {
                try {
                    DownloadManager.Request req = new DownloadManager.Request(Uri.parse(dlUrl));
                    req.setMimeType(mimetype);
                    String cookies = CookieManager.getInstance().getCookie(dlUrl);
                    if (cookies != null) req.addRequestHeader("cookie", cookies);
                    req.addRequestHeader("User-Agent", userAgent);
                    req.setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED);
                    String name = URLUtil.guessFileName(dlUrl, contentDisposition, mimetype);
                    req.setDestinationInExternalPublicDir(Environment.DIRECTORY_DOWNLOADS, "JeduAI/" + name);
                    DownloadManager dm = (DownloadManager) getSystemService(Context.DOWNLOAD_SERVICE);
                    dm.enqueue(req);
                    Toast.makeText(MainActivity.this,
                            getString(R.string.downloading, name), Toast.LENGTH_SHORT).show();
                } catch (Exception e) {
                    try {
                        startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse(dlUrl)));
                    } catch (Exception ignored) {
                    }
                }
            }
        });

        web.loadUrl(url);
    }

    /* ---------------- offline screen ---------------- */

    private void showOffline() {
        setContentView(R.layout.activity_offline);
        Button retry = (Button) findViewById(R.id.retryBtn);
        retry.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                if (serverUrl != null && !serverUrl.isEmpty()) showWeb(serverUrl);
            }
        });
        Button change = (Button) findViewById(R.id.changeBtn);
        change.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                showSetup();
            }
        });
    }

    /* ---------------- file chooser result ---------------- */

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        if (requestCode == FILE_CHOOSER_CODE) {
            if (fileCallback != null) {
                fileCallback.onReceiveValue(pickResults(resultCode, data));
                fileCallback = null;
            }
        } else {
            super.onActivityResult(requestCode, resultCode, data);
        }
    }

    private Uri[] pickResults(int resultCode, Intent data) {
        if (resultCode != RESULT_OK || data == null) return null;
        List<Uri> out = new ArrayList<Uri>();
        if (data.getClipData() != null) {
            int n = data.getClipData().getItemCount();
            for (int i = 0; i < n; i++) out.add(data.getClipData().getItemAt(i).getUri());
        } else if (data.getData() != null) {
            out.add(data.getData());
        }
        return out.isEmpty() ? null : out.toArray(new Uri[0]);
    }

    /* ---------------- back navigation ---------------- */

    @Override
    public boolean onKeyDown(int keyCode, KeyEvent event) {
        if (keyCode == KeyEvent.KEYCODE_BACK && web != null && web.canGoBack()) {
            web.goBack();
            return true;
        }
        return super.onKeyDown(keyCode, event);
    }

    /* ---------------- blob bridge ----------------
       The web app exports some artifacts client-side (CSV, Markdown) via blob: URLs.
       Android WebView can't download blob: URLs, so a tiny JS hook catches those
       clicks and streams the bytes to this bridge, which saves them to
       Downloads/JeduAI via MediaStore (API 29+) or direct file write (older). */

    private class BlobBridge {
        @JavascriptInterface
        public void saveBlob(final String name, final String mime, final String b64) {
            try {
                byte[] bytes = Base64.decode(b64, Base64.DEFAULT);
                String safeName = (name == null || name.trim().isEmpty()) ? "jeduai-export.bin" : name;
                if (Build.VERSION.SDK_INT >= 29) {
                    ContentValues v = new ContentValues();
                    v.put(MediaStore.MediaColumns.DISPLAY_NAME, safeName);
                    v.put(MediaStore.MediaColumns.MIME_TYPE,
                            (mime == null || mime.isEmpty()) ? "application/octet-stream" : mime);
                    v.put(MediaStore.MediaColumns.RELATIVE_PATH,
                            Environment.DIRECTORY_DOWNLOADS + "/JeduAI");
                    Uri uri = getContentResolver().insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, v);
                    if (uri == null) throw new IllegalStateException("MediaStore insert failed");
                    OutputStream os = getContentResolver().openOutputStream(uri);
                    os.write(bytes);
                    os.close();
                } else {
                    java.io.File dir = new java.io.File(
                            Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS),
                            "JeduAI");
                    if (!dir.exists()) dir.mkdirs();
                    java.io.File f = new java.io.File(dir, safeName);
                    java.io.FileOutputStream fos = new java.io.FileOutputStream(f);
                    fos.write(bytes);
                    fos.close();
                }
                runOnUiThread(new Runnable() {
                    @Override
                    public void run() {
                        Toast.makeText(MainActivity.this, R.string.saved_downloads, Toast.LENGTH_SHORT).show();
                    }
                });
            } catch (final Exception e) {
                runOnUiThread(new Runnable() {
                    @Override
                    public void run() {
                        Toast.makeText(MainActivity.this, R.string.save_failed, Toast.LENGTH_SHORT).show();
                    }
                });
            }
        }
    }

    private static final String BLOB_HOOK_JS =
            "(function(){if(window.__jeduBlobHooked)return;window.__jeduBlobHooked=true;" +
            "document.addEventListener('click',function(e){" +
            "var t=e.target;var a=(t&&t.closest)?t.closest('a[href^=\"blob:\"]'):null;" +
            "if(!a)return;e.preventDefault();e.stopPropagation();" +
            "var name=a.getAttribute('download')||'jeduai-export.bin';" +
            "fetch(a.href).then(function(r){return r.blob()}).then(function(b){" +
            "var fr=new FileReader();fr.onload=function(){" +
            "var d=String(fr.result).split(',')[1]||'';" +
            "if(window.JeduAIApp)window.JeduAIApp.saveBlob(name,b.type||'application/octet-stream',d)};" +
            "fr.readAsDataURL(b)})},true)})()";
}
