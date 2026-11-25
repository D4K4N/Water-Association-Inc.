package com.dicklum.waterbilling;

import android.content.ContentResolver;
import android.content.ContentValues;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Environment;
import android.provider.MediaStore;
import android.webkit.JavascriptInterface;
import android.webkit.WebView;
import com.getcapacitor.BridgeActivity;
import java.io.File;
import java.io.FileOutputStream;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        if (this.getBridge() != null && this.getBridge().getWebView() != null) {
            WebView webView = this.getBridge().getWebView();
            webView.addJavascriptInterface(new AndroidBackupBridge(), "AndroidBackupBridge");
        }
    }

    public class AndroidBackupBridge {
        @JavascriptInterface
        public String saveJsonToDownloads(String filename, String jsonContent) {
            try {
                String safeName = (filename == null || filename.trim().isEmpty())
                    ? "dicklum-water-backup.json"
                    : filename.replaceAll("[^a-zA-Z0-9._-]", "_");
                if (!safeName.endsWith(".json")) {
                    safeName = safeName + ".json";
                }
                byte[] bytes = (jsonContent != null ? jsonContent : "{}").getBytes(StandardCharsets.UTF_8);

                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                    ContentResolver resolver = getContentResolver();
                    ContentValues values = new ContentValues();
                    values.put(MediaStore.Downloads.DISPLAY_NAME, safeName);
                    values.put(MediaStore.Downloads.MIME_TYPE, "application/json");
                    values.put(MediaStore.Downloads.RELATIVE_PATH, Environment.DIRECTORY_DOWNLOADS + "/DicklumWater");
                    values.put(MediaStore.Downloads.IS_PENDING, 1);

                    Uri uri = resolver.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, values);
                    if (uri == null) {
                        return "{\"ok\":false,\"error\":\"MediaStore insert failed\"}";
                    }
                    try (OutputStream out = resolver.openOutputStream(uri)) {
                        if (out == null) {
                            return "{\"ok\":false,\"error\":\"Could not open output stream\"}";
                        }
                        out.write(bytes);
                        out.flush();
                    }
                    values.clear();
                    values.put(MediaStore.Downloads.IS_PENDING, 0);
                    resolver.update(uri, values, null, null);
                    return "{\"ok\":true,\"path\":\"Downloads/DicklumWater/" + safeName + "\"}";
                } else {
                    File downloadsDir = Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS);
                    File targetDir = new File(downloadsDir, "DicklumWater");
                    if (!targetDir.exists()) {
                        targetDir.mkdirs();
                    }
                    File outFile = new File(targetDir, safeName);
                    try (FileOutputStream fos = new FileOutputStream(outFile)) {
                        fos.write(bytes);
                        fos.flush();
                    }
                    return "{\"ok\":true,\"path\":\"Downloads/DicklumWater/" + safeName + "\"}";
                }
            } catch (Exception e) {
                String msg = (e.getMessage() != null ? e.getMessage() : "Write error").replace("\"", "'");
                return "{\"ok\":false,\"error\":\"" + msg + "\"}";
            }
        }
    }
}
