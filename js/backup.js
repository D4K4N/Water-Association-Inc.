/**
 * Dicklum Water Association - Offline Backup & Restore Engine
 * Exports and restores entire IndexedDB database to/from JSON files for reliable field disaster recovery.
 * 100% read-only during export (never modifies IndexedDB or saved pins).
 */

class BackupEngine {
  /**
   * Export all database records to a saved/downloaded JSON file across Desktop, Mobile Chrome/PWA, and Capacitor Android APK.
   */
  async exportBackup() {
    const dump = await window.db.dumpAllData();
    const jsonString = JSON.stringify(dump, null, 2);

    const now = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const filename = `dicklum-water-backup-${now}.json`;

    const isCapacitorNative = Boolean(
      typeof window !== 'undefined' &&
      window.Capacitor &&
      typeof window.Capacitor.isNativePlatform === 'function' &&
      window.Capacitor.isNativePlatform()
    );
    const isMobileDevice = Boolean(
      typeof navigator !== 'undefined' &&
      /Android|iPhone|iPad|iPod/i.test(navigator.userAgent || '')
    );

    // 1. Capacitor Native Filesystem + Share Plugins (when available inside Hybrid Android APK)
    if (isCapacitorNative && window.Capacitor.Plugins) {
      const { Filesystem, Share } = window.Capacitor.Plugins;
      if (Filesystem && typeof Filesystem.writeFile === 'function') {
        try {
          // Try saving directly into public Documents folder first
          const writeRes = await Filesystem.writeFile({
            path: filename,
            data: jsonString,
            directory: 'DOCUMENTS',
            encoding: 'utf8',
            recursive: true
          });
          if (Share && typeof Share.share === 'function' && writeRes && writeRes.uri) {
            try {
              await Share.share({
                title: filename,
                text: 'Dicklum Water Association JSON Backup',
                url: writeRes.uri,
                dialogTitle: 'Save or Share JSON Backup'
              });
            } catch (_) {
              // User dismissed share sheet; file is already safely written in Documents
            }
          }
          return { success: true, filename, method: 'capacitor-documents', timestamp: dump.exportedAt };
        } catch (_) {
          // Fallback to Cache directory + Native Share sheet if Documents permission restricted on Android 10+
          try {
            const cacheRes = await Filesystem.writeFile({
              path: filename,
              data: jsonString,
              directory: 'CACHE',
              encoding: 'utf8'
            });
            if (Share && typeof Share.share === 'function' && cacheRes && cacheRes.uri) {
              await Share.share({
                title: filename,
                text: 'Dicklum Water Association JSON Backup',
                url: cacheRes.uri,
                dialogTitle: 'Save JSON Backup to Files / Downloads'
              });
              return { success: true, filename, method: 'capacitor-share', timestamp: dump.exportedAt };
            }
          } catch (_err2) {}
        }
      }
    }

    // 2. Desktop Native OS "Save As" File Picker (Chrome / Edge Desktop)
    if (!isMobileDevice && !isCapacitorNative && typeof window !== 'undefined' && typeof window.showSaveFilePicker === 'function') {
      try {
        const handle = await window.showSaveFilePicker({
          suggestedName: filename,
          types: [
            {
              description: 'JSON Backup File',
              accept: { 'application/json': ['.json'] }
            }
          ]
        });
        const writable = await handle.createWritable();
        await writable.write(jsonString);
        await writable.close();
        return { success: true, filename, method: 'file-picker', timestamp: dump.exportedAt };
      } catch (pickerErr) {
        if (pickerErr && pickerErr.name === 'AbortError') {
          return { success: false, cancelled: true, filename, timestamp: dump.exportedAt };
        }
        // Fall through to standard Blob download if picker unsupported
      }
    }

    // 3. Mobile Web Share Level 2 File Sheet (Android Chrome / iOS Safari / Modern WebViews)
    if ((isMobileDevice || isCapacitorNative) && typeof navigator !== 'undefined' && typeof navigator.share === 'function' && typeof File !== 'undefined') {
      const candidateMimeTypes = ['application/json', 'text/plain'];
      for (const mime of candidateMimeTypes) {
        try {
          const shareFile = new File([jsonString], filename, { type: mime });
          const canShareFiles = typeof navigator.canShare === 'function'
            ? navigator.canShare({ files: [shareFile] })
            : false;
          if (canShareFiles) {
            await navigator.share({
              files: [shareFile],
              title: filename,
              text: 'Dicklum Water Association JSON Backup'
            });
            return { success: true, filename, method: 'web-share-file', timestamp: dump.exportedAt };
          }
        } catch (shareErr) {
          if (shareErr && shareErr.name === 'AbortError') {
            return { success: false, cancelled: true, filename, timestamp: dump.exportedAt };
          }
          // Continue to Blob download fallback
        }
      }
    }

    // 4. Standard Browser & Android Chrome DownloadManager (<a download> with 60-second safe Blob retention)
    // Using application/octet-stream forces Android Chrome to save the .json file to Downloads/
    // instead of revoking the Blob URL before DownloadManager reads it!
    const triggeredDownload = this._triggerSafeBlobDownload(jsonString, filename);

    // 5. Legacy Capacitor APK WebView Fallback Sheet:
    // Stock Android WebView without Filesystem plugin silently ignores <a href="blob:..." download>.
    // Present a guaranteed Safe-Save Modal so the user can Copy/Share/Save 100% of their JSON without losing a single pin!
    if (isCapacitorNative) {
      this._openWebViewSafeSaveModal(jsonString, filename, dump);
      return { success: true, filename, method: 'apk-safe-modal', timestamp: dump.exportedAt };
    }

    if (!triggeredDownload) {
      this._openWebViewSafeSaveModal(jsonString, filename, dump);
    }

    return { success: true, filename, method: 'browser-download', timestamp: dump.exportedAt };
  }

  _triggerSafeBlobDownload(jsonString, filename) {
    try {
      const blob = new Blob([jsonString], { type: 'application/octet-stream' });
      const url = URL.createObjectURL(blob);

      const a = document.createElement('a');
      a.style.display = 'none';
      a.href = url;
      a.setAttribute('download', filename);
      a.rel = 'noopener';
      document.body.appendChild(a);

      a.click();

      // CRITICAL FIX: Keep <a> in DOM for 2s and retain Blob URL for 60s
      // so Android DownloadManager / mobile browsers finish writing the entire file!
      setTimeout(() => {
        try {
          if (a.parentNode) a.parentNode.removeChild(a);
        } catch (_) {}
      }, 2000);

      setTimeout(() => {
        try {
          URL.revokeObjectURL(url);
        } catch (_) {}
      }, 60000);

      return true;
    } catch (err) {
      console.warn('Blob download fallback notice:', err);
      return false;
    }
  }

  _openWebViewSafeSaveModal(jsonString, filename, dump) {
    if (typeof document === 'undefined') return;
    const existing = document.getElementById('dwa-json-safe-save-modal');
    if (existing) existing.remove();

    const summary = (dump && dump.summary) || {};
    const cCount = summary.consumers ?? ((dump && dump.data && dump.data.consumers && dump.data.consumers.length) || 0);
    const mCount = summary.meters ?? ((dump && dump.data && dump.data.meters && dump.data.meters.length) || 0);
    const clCount = summary.clusters ?? ((dump && dump.data && dump.data.clusters && dump.data.clusters.length) || 0);
    const bCount = summary.bills ?? ((dump && dump.data && dump.data.bills && dump.data.bills.length) || 0);
    const kbSize = (new Blob([jsonString]).size / 1024).toFixed(1);

    const overlay = document.createElement('div');
    overlay.id = 'dwa-json-safe-save-modal';
    overlay.style.cssText = 'position:fixed;inset:0;z-index:100000;background:rgba(5,8,15,0.88);display:flex;align-items:center;justify-content:center;padding:14px;';

    overlay.innerHTML = `
      <div style="background:#111724;border:1px solid rgba(56,189,248,0.4);border-radius:12px;max-width:430px;width:100%;padding:16px;color:#F8FAFC;box-shadow:0 16px 40px rgba(0,0,0,0.65);font-family:system-ui,-apple-system,sans-serif;">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px;margin-bottom:10px;">
          <div>
            <div style="font-size:10px;font-weight:700;color:#34D399;text-transform:uppercase;letter-spacing:0.05em;">JSON Backup Ready (${kbSize} KB)</div>
            <h3 style="margin:2px 0 0;font-size:14.5px;color:#FFFFFF;word-break:break-all;">${filename}</h3>
          </div>
          <button type="button" id="dwa-safe-close-btn" style="background:transparent;border:1px solid #334155;color:#CBD5E1;border-radius:6px;width:28px;height:28px;cursor:pointer;font-size:14px;">✕</button>
        </div>

        <div style="background:#0B0F17;border:1px solid #1E293B;border-radius:8px;padding:8px 10px;font-size:11.5px;color:#CBD5E1;margin-bottom:12px;line-height:1.45;">
          <strong>Verified Records Inside Backup:</strong><br>
          • <strong>${cCount}</strong> Consumers &amp; House Pins • <strong>${mCount}</strong> Water Meters<br>
          • <strong>${clCount}</strong> Clusters • <strong>${bCount}</strong> Bills
        </div>

        <div style="display:flex;flex-direction:column;gap:8px;margin-bottom:10px;">
          <button type="button" id="dwa-safe-share-btn" style="background:#0284C7;border:none;color:#FFFFFF;font-weight:700;font-size:12.5px;padding:10px 12px;border-radius:8px;cursor:pointer;">
            Share / Save JSON File to Phone
          </button>
          <button type="button" id="dwa-safe-copy-btn" style="background:#059669;border:none;color:#FFFFFF;font-weight:700;font-size:12.5px;padding:10px 12px;border-radius:8px;cursor:pointer;">
            Copy Full JSON Backup to Clipboard
          </button>
          <button type="button" id="dwa-safe-download-btn" style="background:#1E293B;border:1px solid #334155;color:#E2E8F0;font-weight:600;font-size:12px;padding:9px 12px;border-radius:8px;cursor:pointer;">
            Direct Browser Download (.json)
          </button>
        </div>

        <details style="margin-top:4px;">
          <summary style="font-size:11px;color:#94A3B8;cursor:pointer;user-select:none;">View Raw JSON Backup Text</summary>
          <textarea id="dwa-safe-json-textarea" readonly style="width:100%;height:110px;margin-top:6px;background:#090D14;border:1px solid #334155;border-radius:6px;color:#38BDF8;font-family:monospace;font-size:10px;padding:8px;box-sizing:border-box;"></textarea>
        </details>
        <div id="dwa-safe-status-msg" style="font-size:11px;color:#34D399;text-align:center;margin-top:8px;min-height:15px;"></div>
      </div>
    `;

    document.body.appendChild(overlay);

    const txtArea = overlay.querySelector('#dwa-safe-json-textarea');
    if (txtArea) txtArea.value = jsonString;

    const statusMsg = overlay.querySelector('#dwa-safe-status-msg');
    const setStatus = (msg) => {
      if (statusMsg) statusMsg.textContent = msg;
    };

    overlay.querySelector('#dwa-safe-close-btn').onclick = () => overlay.remove();

    // Synchronous user-gesture Share handler (preserves Transient User Activation!)
    overlay.querySelector('#dwa-safe-share-btn').onclick = async () => {
      try {
        if (typeof navigator !== 'undefined' && typeof navigator.share === 'function') {
          if (typeof File !== 'undefined') {
            for (const mime of ['application/json', 'text/plain']) {
              const f = new File([jsonString], filename, { type: mime });
              if (typeof navigator.canShare === 'function' && navigator.canShare({ files: [f] })) {
                await navigator.share({ files: [f], title: filename });
                setStatus('Shared / saved JSON file!');
                return;
              }
            }
          }
          await navigator.share({ title: filename, text: jsonString });
          setStatus('Shared JSON backup text!');
          return;
        }
        setStatus('Native Share unavailable in this WebView — tap "Copy Full JSON Backup" below.');
      } catch (e) {
        if (!e || e.name !== 'AbortError') {
          setStatus('Tap "Copy Full JSON Backup" below to copy all records.');
        }
      }
    };

    overlay.querySelector('#dwa-safe-copy-btn').onclick = async () => {
      try {
        if (navigator.clipboard && navigator.clipboard.writeText) {
          await navigator.clipboard.writeText(jsonString);
          setStatus('✓ Copied 100% of JSON backup to clipboard! Paste into Notes/Files to save.');
          return;
        }
      } catch (_) {}
      if (txtArea) {
        txtArea.parentElement.open = true;
        txtArea.focus();
        txtArea.select();
        try {
          document.execCommand('copy');
          setStatus('✓ Copied 100% of JSON backup to clipboard!');
        } catch (_) {
          setStatus('Text selected — long-press inside the box and tap Copy.');
        }
      }
    };

    overlay.querySelector('#dwa-safe-download-btn').onclick = () => {
      this._triggerSafeBlobDownload(jsonString, filename);
      try {
        const dataUri = 'data:application/octet-stream;charset=utf-8,' + encodeURIComponent(jsonString);
        const a2 = document.createElement('a');
        a2.href = dataUri;
        a2.setAttribute('download', filename);
        document.body.appendChild(a2);
        a2.click();
        setTimeout(() => a2.remove(), 1500);
      } catch (_) {}
      setStatus('Download requested — check your phone Downloads folder.');
    };
  }

  /**
   * Restore database from a selected JSON backup file
   */
  async restoreBackup(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = async (e) => {
        try {
          const content = JSON.parse(e.target.result);
          const innerData = content.data || ((Array.isArray(content.consumers) || Array.isArray(content.meters)) ? content : null);
          if (!innerData) {
            throw new Error('Invalid backup file format. Please ensure this file was exported from Dicklum Water Billing System.');
          }
          await window.db.restoreAllData(content);
          resolve({ success: true, recordCount: Object.keys(innerData).length });
        } catch (err) {
          reject(err);
        }
      };
      reader.onerror = reject;
      reader.readAsText(file);
    });
  }

  /**
   * Resets database with default Dicklum Water Association seed data
   */
  async resetToSeedData() {
    const stores = ['consumers', 'meters', 'clusters', 'readings', 'bills', 'settings'];
    for (const s of stores) {
      await window.db.clear(s);
    }
    if (typeof window.seedMockDemoData === 'function') {
      await window.seedMockDemoData();
    } else {
      await window.seedSampleDataIfEmpty();
    }
    return true;
  }
}

if (typeof window !== 'undefined') {
  window.backupEngine = new BackupEngine();
}
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { BackupEngine };
}
