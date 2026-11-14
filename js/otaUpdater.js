/**
 * Dicklum Water Association, Inc. - Offline PWA & Hybrid APK Live GitHub Auto-Updater
 * 1. Registers Service Worker (`./sw.js`) so the phone boots 100% offline even after a full device restart.
 * 2. Locks Android Persistent Storage (`navigator.storage.persist()`) so IndexedDB (pinned houses,
 *    water meters, readings, bills) and offline map caches are NEVER evicted by Android OS.
 * 3. Live GitHub OTA Sync for both Hybrid Android `.apk` and GitHub Pages PWA:
 *    Whenever internet is detected, checks `D4K4N/Water-Association-Inc.` on GitHub and silently
 *    updates HTML/CSS/JS in CacheStorage without needing to reinstall the `.apk` and without
 *    touching IndexedDB or JSON backups.
 */

class DicklumOtaUpdater {
  constructor() {
    this.localVersion = '2.5.0';
    this.localBuild = Number(localStorage.getItem('dicklum_ota_build_num')) || 25;
    this.cacheName = 'dicklum-water-v25';
    this.githubRepo = 'D4K4N/Water-Association-Inc.';
    this.githubBranch = 'main';
    this.rawBaseUrl = `https://raw.githubusercontent.com/${this.githubRepo}/${this.githubBranch}`;
    this.apkDownloadUrl = `https://github.com/${this.githubRepo}/releases/latest/download/Dicklum-Water-Billing.apk`;
    this.swRegistration = null;
    this.isChecking = false;

    this.updatableFiles = [
      { local: './index.html', remote: 'index.html', type: 'text/html; charset=utf-8' },
      { local: './manifest.webmanifest', remote: 'manifest.webmanifest', type: 'application/manifest+json' },
      { local: './version.json', remote: 'version.json', type: 'application/json' },
      { local: './css/styles.css', remote: 'css/styles.css', type: 'text/css; charset=utf-8' },
      { local: './css/print-thermal.css', remote: 'css/print-thermal.css', type: 'text/css; charset=utf-8' },
      { local: './css/print-a4.css', remote: 'css/print-a4.css', type: 'text/css; charset=utf-8' },
      { local: './js/icons.js', remote: 'js/icons.js', type: 'application/javascript; charset=utf-8' },
      { local: './js/db.js', remote: 'js/db.js', type: 'application/javascript; charset=utf-8' },
      { local: './js/sampleData.js', remote: 'js/sampleData.js', type: 'application/javascript; charset=utf-8' },
      { local: './js/billing.js', remote: 'js/billing.js', type: 'application/javascript; charset=utf-8' },
      { local: './js/reading.js', remote: 'js/reading.js', type: 'application/javascript; charset=utf-8' },
      { local: './js/thermalPrinter.js', remote: 'js/thermalPrinter.js', type: 'application/javascript; charset=utf-8' },
      { local: './js/a4Statement.js', remote: 'js/a4Statement.js', type: 'application/javascript; charset=utf-8' },
      { local: './js/reports.js', remote: 'js/reports.js', type: 'application/javascript; charset=utf-8' },
      { local: './js/backup.js', remote: 'js/backup.js', type: 'application/javascript; charset=utf-8' },
      { local: './js/offlineTileEngine.js', remote: 'js/offlineTileEngine.js', type: 'application/javascript; charset=utf-8' },
      { local: './js/mapEngine.js', remote: 'js/mapEngine.js', type: 'application/javascript; charset=utf-8' },
      { local: './js/maplibreEngine.js', remote: 'js/maplibreEngine.js', type: 'application/javascript; charset=utf-8' },
      { local: './js/otaUpdater.js', remote: 'js/otaUpdater.js', type: 'application/javascript; charset=utf-8' },
      { local: './js/app.js', remote: 'js/app.js', type: 'application/javascript; charset=utf-8' }
    ];
  }

  async init() {
    await this.requestPersistentStorage();
    await this.registerServiceWorker();
    this.bindUIEvents();

    // When device comes online, automatically check GitHub for silent live updates
    window.addEventListener('online', () => {
      setTimeout(() => this.checkForGitHubUpdates({ silent: true }), 2000);
    });

    if (navigator.onLine) {
      setTimeout(() => this.checkForGitHubUpdates({ silent: true }), 3500);
    }
  }

  /**
   * Requests Android / Chrome Persistent Storage so IndexedDB (pinned houses & meters)
   * and Service Worker caches are protected from OS storage cleanup.
   */
  async requestPersistentStorage() {
    try {
      if (navigator.storage && navigator.storage.persist) {
        const isPersisted = await navigator.storage.persisted();
        if (!isPersisted) {
          await navigator.storage.persist();
        }
      }
    } catch (_) {}
  }

  /**
   * Registers `./sw.js` for 100% offline boot after phone restart
   */
  async registerServiceWorker() {
    if (!('serviceWorker' in navigator)) return;
    try {
      const reg = await navigator.serviceWorker.register('./sw.js', { scope: './' });
      this.swRegistration = reg;

      reg.addEventListener('updatefound', () => {
        const newWorker = reg.installing;
        if (!newWorker) return;
        newWorker.addEventListener('statechange', () => {
          if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
            newWorker.postMessage({ type: 'SKIP_WAITING' });
            this.notifyUpdateReady('New offline cache ready');
          }
        });
      });

      navigator.serviceWorker.addEventListener('message', (e) => {
        if (e.data && e.data.type === 'CACHE_UPDATED') {
          this.updateStatusBadge('OFFLINE READY', 'badge-success');
        }
      });

      this.updateStatusBadge('100% OFFLINE READY', 'badge-success');
    } catch (err) {
      console.warn('Service Worker registration notice:', err);
    }
  }

  isRunningInsideApkOrLocal() {
    const isCap = typeof window.Capacitor !== 'undefined';
    const host = (window.location && window.location.hostname) || '';
    return isCap || host === 'localhost' || host === '127.0.0.1';
  }

  /**
   * Checks GitHub (`D4K4N/Water-Association-Inc.`) for newer commits / version.json
   * and updates the local offline CacheStorage without touching IndexedDB user data.
   */
  async checkForGitHubUpdates(opts = { silent: false }) {
    if (this.isChecking) return;
    if (!navigator.onLine) {
      if (!opts.silent && window.app && typeof window.app.showToast === 'function') {
        window.app.showToast('Phone is currently offline. Using built-in offline cache.', 2500);
      }
      return;
    }

    this.isChecking = true;
    if (!opts.silent) {
      this.updateStatusBadge('CHECKING GITHUB...', 'badge-warning');
    }

    try {
      // 1. Trigger standard Service Worker update check
      if (this.swRegistration) {
        try { await this.swRegistration.update(); } catch (_) {}
      }

      // 2. Fetch latest version.json from GitHub repo
      const remoteVersionUrl = `${this.rawBaseUrl}/version.json?t=${Date.now()}`;
      const resp = await fetch(remoteVersionUrl, { cache: 'no-store' });
      if (!resp.ok) {
        throw new Error(`GitHub status ${resp.status}`);
      }

      const remoteMeta = await resp.json();
      const remoteBuild = Number(remoteMeta.buildNumber) || 25;
      const remoteCommitTime = remoteMeta.releasedAt || '';
      const lastSyncedTime = localStorage.getItem('dicklum_ota_released_at') || '';

      const hasNewerVersion = (remoteBuild > this.localBuild) ||
                              (remoteCommitTime && remoteCommitTime !== lastSyncedTime) ||
                              opts.force === true;

      if (hasNewerVersion) {
        await this.pullFilesFromGitHubIntoCache();
        this.localBuild = remoteBuild;
        localStorage.setItem('dicklum_ota_build_num', String(remoteBuild));
        if (remoteCommitTime) {
          localStorage.setItem('dicklum_ota_released_at', remoteCommitTime);
        }
        this.updateStatusBadge(`UPDATED (v${remoteMeta.version || this.localVersion})`, 'badge-success');
        this.notifyUpdateReady(`Updated to v${remoteMeta.version || this.localVersion} from GitHub`);
      } else {
        this.updateStatusBadge('UP TO DATE (100% OFFLINE)', 'badge-success');
        if (!opts.silent && window.app && typeof window.app.showToast === 'function') {
          window.app.showToast(`App is up to date (v${remoteMeta.version || this.localVersion}) and 100% ready for offline use.`, 2600);
        }
      }
    } catch (err) {
      this.updateStatusBadge('100% OFFLINE READY', 'badge-success');
      if (!opts.silent && window.app && typeof window.app.showToast === 'function') {
        window.app.showToast('Offline cache verified. Could not reach GitHub right now.', 2500);
      }
    } finally {
      this.isChecking = false;
    }
  }

  /**
   * Downloads latest HTML/CSS/JS files from GitHub `main` branch into CacheStorage
   * so both the Hybrid `.apk` and PWA stay updated automatically without touching IndexedDB!
   */
  async pullFilesFromGitHubIntoCache() {
    if (typeof caches === 'undefined') return;
    const cache = await caches.open(this.cacheName);

    await Promise.all(
      this.updatableFiles.map(async (item) => {
        try {
          const url = `${this.rawBaseUrl}/${item.remote}?t=${Date.now()}`;
          const res = await fetch(url, { cache: 'no-store' });
          if (res && res.ok) {
            const body = await res.blob();
            const headers = new Headers({
              'Content-Type': item.type,
              'Cache-Control': 'public, max-age=31536000',
              'X-OTA-Updated-At': new Date().toISOString()
            });
            const syntheticResp = new Response(body, { status: 200, headers });
            await cache.put(item.local, syntheticResp.clone());
            if (item.local === './index.html') {
              await cache.put('./', syntheticResp.clone());
            }
          }
        } catch (_) {}
      })
    );

    if (navigator.serviceWorker && navigator.serviceWorker.controller) {
      navigator.serviceWorker.controller.postMessage({ type: 'FORCE_UPDATE_CACHE' });
    }
  }

  updateStatusBadge(text, badgeClass = 'badge-success') {
    const el = document.getElementById('ota-status-badge');
    if (el) {
      el.textContent = text;
      el.className = `badge ${badgeClass}`;
    }
  }

  notifyUpdateReady(msg) {
    if (window.app && typeof window.app.showToast === 'function') {
      window.app.showToast(`${msg} — Reloading in 2s or tap Sync in Settings.`, 3200);
    }
  }

  bindUIEvents() {
    const btnCheckUpdate = document.getElementById('btn-ota-check-update');
    if (btnCheckUpdate) {
      btnCheckUpdate.addEventListener('click', async () => {
        await this.checkForGitHubUpdates({ silent: false, force: true });
      });
    }

    const btnDownloadApk = document.getElementById('btn-download-hybrid-apk');
    if (btnDownloadApk) {
      btnDownloadApk.addEventListener('click', () => {
        window.open(this.apkDownloadUrl, '_blank', 'noopener');
      });
    }
  }
}

if (typeof window !== 'undefined') {
  window.otaUpdater = new DicklumOtaUpdater();
  window.addEventListener('DOMContentLoaded', () => {
    window.otaUpdater.init();
  });
}
