package com.dicklum.waterbilling;

import android.Manifest;
import android.content.ContentResolver;
import android.content.ContentValues;
import android.content.Context;
import android.content.pm.PackageManager;
import android.location.GnssStatus;
import android.location.Location;
import android.location.LocationListener;
import android.location.LocationManager;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Environment;
import android.os.Handler;
import android.os.Looper;
import android.provider.MediaStore;
import android.util.Base64;
import android.webkit.JavascriptInterface;
import android.webkit.WebView;
import androidx.core.app.ActivityCompat;
import androidx.core.content.ContextCompat;
import com.getcapacitor.BridgeActivity;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;

public class MainActivity extends BridgeActivity {
    private static final int REQ_LOCATION_PERM = 4091;
    private LocationManager locationManager;
    private LocationListener gpsListener;
    private GnssStatus.Callback gnssCallback;
    private volatile int satellitesUsed = 0;
    private volatile int satellitesVisible = 0;
    private volatile String lastFixJson = "";
    private volatile boolean gpsActive = false;
    private final Handler mainHandler = new Handler(Looper.getMainLooper());

    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        attachNativeBridges();
    }

    private void attachNativeBridges() {
        if (this.getBridge() != null && this.getBridge().getWebView() != null) {
            WebView webView = this.getBridge().getWebView();
            webView.addJavascriptInterface(new AndroidBackupBridge(), "AndroidBackupBridge");
            webView.addJavascriptInterface(new AndroidTileVault(), "AndroidTileVault");
            webView.addJavascriptInterface(new AndroidNativeGPS(), "AndroidNativeGPS");
        }
    }

    @Override
    public void onDestroy() {
        stopNativeGpsInternal();
        super.onDestroy();
    }

    private void dispatchGpsFixToJs(Location loc) {
        if (loc == null) return;
        final double lat = loc.getLatitude();
        final double lng = loc.getLongitude();
        final float acc = loc.hasAccuracy() ? loc.getAccuracy() : 99f;
        final float bearing = loc.hasBearing() ? loc.getBearing() : -1f;
        final float speed = loc.hasSpeed() ? loc.getSpeed() : 0f;
        final double alt = loc.hasAltitude() ? loc.getAltitude() : 0d;
        final long ts = loc.getTime() > 0 ? loc.getTime() : System.currentTimeMillis();
        final String provider = loc.getProvider() != null ? loc.getProvider() : "gps";

        final String json = "{"
            + "\"lat\":" + lat
            + ",\"lng\":" + lng
            + ",\"accuracy\":" + acc
            + ",\"heading\":" + (bearing >= 0 ? String.valueOf(bearing) : "null")
            + ",\"speed\":" + speed
            + ",\"altitude\":" + alt
            + ",\"satellitesUsed\":" + satellitesUsed
            + ",\"satellitesVisible\":" + satellitesVisible
            + ",\"provider\":\"" + provider + "\""
            + ",\"timestamp\":" + ts
            + "}";
        lastFixJson = json;

        mainHandler.post(() -> {
            try {
                if (getBridge() != null && getBridge().getWebView() != null) {
                    getBridge().getWebView().evaluateJavascript(
                        "window.__onNativeGpsFix && window.__onNativeGpsFix(" + json + ");",
                        null
                    );
                }
            } catch (Exception ignored) {}
        });
    }

    private void startNativeGpsInternal() {
        mainHandler.post(() -> {
            try {
                if (ContextCompat.checkSelfPermission(this, Manifest.permission.ACCESS_FINE_LOCATION)
                        != PackageManager.PERMISSION_GRANTED) {
                    ActivityCompat.requestPermissions(
                        this,
                        new String[] {
                            Manifest.permission.ACCESS_FINE_LOCATION,
                            Manifest.permission.ACCESS_COARSE_LOCATION
                        },
                        REQ_LOCATION_PERM
                    );
                    return;
                }

                if (locationManager == null) {
                    locationManager = (LocationManager) getSystemService(Context.LOCATION_SERVICE);
                }
                if (locationManager == null) return;

                if (gpsListener == null) {
                    gpsListener = new LocationListener() {
                        @Override
                        public void onLocationChanged(Location location) {
                            dispatchGpsFixToJs(location);
                        }
                        @Override public void onStatusChanged(String provider, int status, Bundle extras) {}
                        @Override public void onProviderEnabled(String provider) {}
                        @Override public void onProviderDisabled(String provider) {}
                    };
                }

                // Pure hardware GNSS (GPS + GLONASS + Galileo + BeiDou) — 100% offline, 1 Hz, 0m threshold
                if (locationManager.isProviderEnabled(LocationManager.GPS_PROVIDER)) {
                    locationManager.requestLocationUpdates(
                        LocationManager.GPS_PROVIDER,
                        1000L,
                        0f,
                        gpsListener,
                        Looper.getMainLooper()
                    );
                    Location lastGps = locationManager.getLastKnownLocation(LocationManager.GPS_PROVIDER);
                    if (lastGps != null) {
                        dispatchGpsFixToJs(lastGps);
                    }
                }

                // Track satellite lock count (API 24+)
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N && gnssCallback == null) {
                    gnssCallback = new GnssStatus.Callback() {
                        @Override
                        public void onSatelliteStatusChanged(GnssStatus status) {
                            int total = status.getSatelliteCount();
                            int used = 0;
                            for (int i = 0; i < total; i++) {
                                if (status.usedInFix(i)) used++;
                            }
                            satellitesVisible = total;
                            satellitesUsed = used;
                        }
                    };
                    try {
                        locationManager.registerGnssStatusCallback(gnssCallback, mainHandler);
                    } catch (Exception ignored) {}
                }

                gpsActive = true;
            } catch (Exception ignored) {}
        });
    }

    private void stopNativeGpsInternal() {
        mainHandler.post(() -> {
            try {
                if (locationManager != null && gpsListener != null) {
                    locationManager.removeUpdates(gpsListener);
                }
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N && locationManager != null && gnssCallback != null) {
                    locationManager.unregisterGnssStatusCallback(gnssCallback);
                    gnssCallback = null;
                }
                gpsActive = false;
            } catch (Exception ignored) {}
        });
    }

    @Override
    public void onRequestPermissionsResult(int requestCode, String[] permissions, int[] grantResults) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults);
        if (requestCode == REQ_LOCATION_PERM && grantResults.length > 0
                && grantResults[0] == PackageManager.PERMISSION_GRANTED) {
            startNativeGpsInternal();
        }
    }

    // ─── 1. NATIVE DOWNLOADS FOLDER SAVER (JSON, EXCEL .XLS, PDF) ───
    public class AndroidBackupBridge {
        @JavascriptInterface
        public String saveJsonToDownloads(String filename, String jsonContent) {
            return saveFileToDownloads(filename, jsonContent, "application/json", false);
        }

        @JavascriptInterface
        public String saveFileToDownloads(String filename, String content, String mimeType, boolean isBase64) {
            try {
                String safeName = (filename == null || filename.trim().isEmpty())
                    ? "dicklum-water-file.json"
                    : filename.replaceAll("[^a-zA-Z0-9._-]", "_");
                String safeMime = (mimeType == null || mimeType.trim().isEmpty())
                    ? "application/octet-stream"
                    : mimeType.trim();

                byte[] bytes;
                if (isBase64) {
                    String cleanB64 = content != null ? content : "";
                    int commaIdx = cleanB64.indexOf(',');
                    if (commaIdx >= 0) {
                        cleanB64 = cleanB64.substring(commaIdx + 1);
                    }
                    bytes = Base64.decode(cleanB64, Base64.DEFAULT);
                } else {
                    bytes = (content != null ? content : "").getBytes(StandardCharsets.UTF_8);
                }

                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                    ContentResolver resolver = getContentResolver();
                    ContentValues values = new ContentValues();
                    values.put(MediaStore.Downloads.DISPLAY_NAME, safeName);
                    values.put(MediaStore.Downloads.MIME_TYPE, safeMime);
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
                    return "{\"ok\":true,\"path\":\"Downloads/DicklumWater/" + safeName + "\",\"bytes\":" + bytes.length + "}";
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
                    return "{\"ok\":true,\"path\":\"Downloads/DicklumWater/" + safeName + "\",\"bytes\":" + bytes.length + "}";
                }
            } catch (Exception e) {
                String msg = (e.getMessage() != null ? e.getMessage() : "Write error").replace("\"", "'");
                return "{\"ok\":false,\"error\":\"" + msg + "\"}";
            }
        }
    }

    // ─── 2. NATIVE PERMANENT OFFLINE MAP TILE VAULT (SURVIVES REBOOT & AIRPLANE MODE) ───
    public class AndroidTileVault {
        private File getVaultRoot() {
            File dir = new File(getFilesDir(), "dicklum_tile_vault");
            if (!dir.exists()) dir.mkdirs();
            return dir;
        }

        private File getTileFile(String layer, int z, int x, int y) {
            String safeLayer = (layer == null ? "google_hybrid" : layer).replaceAll("[^a-zA-Z0-9_-]", "_");
            File zDir = new File(new File(getVaultRoot(), safeLayer), String.valueOf(z));
            return new File(zDir, x + "_" + y + ".bin");
        }

        @JavascriptInterface
        public boolean hasTile(String layer, int z, int x, int y) {
            try {
                File f = getTileFile(layer, z, x, y);
                return f.exists() && f.length() > 100;
            } catch (Exception e) {
                return false;
            }
        }

        @JavascriptInterface
        public boolean saveTileBase64(String layer, int z, int x, int y, String base64Data) {
            try {
                if (base64Data == null || base64Data.isEmpty()) return false;
                String clean = base64Data;
                int comma = clean.indexOf(',');
                if (comma >= 0) clean = clean.substring(comma + 1);
                byte[] bytes = Base64.decode(clean, Base64.DEFAULT);
                if (bytes.length < 100) return false;

                File f = getTileFile(layer, z, x, y);
                File parent = f.getParentFile();
                if (parent != null && !parent.exists()) parent.mkdirs();

                File tmp = new File(parent, f.getName() + ".tmp");
                try (FileOutputStream fos = new FileOutputStream(tmp)) {
                    fos.write(bytes);
                    fos.flush();
                }
                return tmp.renameTo(f);
            } catch (Exception e) {
                return false;
            }
        }

        @JavascriptInterface
        public String getTileDataUrl(String layer, int z, int x, int y) {
            try {
                File f = getTileFile(layer, z, x, y);
                if (!f.exists() || f.length() < 100) return "";
                byte[] buf = new byte[8192];
                ByteArrayOutputStream baos = new ByteArrayOutputStream((int) f.length());
                try (FileInputStream fis = new FileInputStream(f)) {
                    int n;
                    while ((n = fis.read(buf)) != -1) {
                        baos.write(buf, 0, n);
                    }
                }
                String mime = "streets".equals(layer) ? "image/png" : "image/jpeg";
                return "data:" + mime + ";base64," + Base64.encodeToString(baos.toByteArray(), Base64.NO_WRAP);
            } catch (Exception e) {
                return "";
            }
        }

        @JavascriptInterface
        public String getVaultStats() {
            try {
                long[] stats = new long[] { 0L, 0L }; // [count, bytes]
                countRecursive(getVaultRoot(), stats);
                return "{\"count\":" + stats[0] + ",\"bytes\":" + stats[1] + "}";
            } catch (Exception e) {
                return "{\"count\":0,\"bytes\":0}";
            }
        }

        @JavascriptInterface
        public boolean clearVault() {
            try {
                deleteRecursive(getVaultRoot());
                return true;
            } catch (Exception e) {
                return false;
            }
        }

        private void countRecursive(File dir, long[] stats) {
            if (dir == null || !dir.exists()) return;
            File[] files = dir.listFiles();
            if (files == null) return;
            for (File f : files) {
                if (f.isDirectory()) {
                    countRecursive(f, stats);
                } else if (f.getName().endsWith(".bin")) {
                    stats[0]++;
                    stats[1] += f.length();
                }
            }
        }

        private void deleteRecursive(File f) {
            if (f == null || !f.exists()) return;
            if (f.isDirectory()) {
                File[] children = f.listFiles();
                if (children != null) {
                    for (File c : children) deleteRecursive(c);
                }
            }
            f.delete();
        }
    }

    // ─── 3. NATIVE HARDWARE GNSS / PURE-SATELLITE ZERO-DELAY GPS BRIDGE ───
    public class AndroidNativeGPS {
        @JavascriptInterface
        public boolean startGps() {
            startNativeGpsInternal();
            return true;
        }

        @JavascriptInterface
        public boolean stopGps() {
            stopNativeGpsInternal();
            return true;
        }

        @JavascriptInterface
        public boolean isGpsEnabled() {
            try {
                LocationManager lm = (LocationManager) getSystemService(Context.LOCATION_SERVICE);
                return lm != null && lm.isProviderEnabled(LocationManager.GPS_PROVIDER);
            } catch (Exception e) {
                return false;
            }
        }

        @JavascriptInterface
        public String getLastFix() {
            return lastFixJson != null ? lastFixJson : "";
        }

        @JavascriptInterface
        public boolean isActive() {
            return gpsActive;
        }
    }
}
