/**
 * Dicklum Water Association - Offline Backup & Restore Engine
 * Exports and restores entire IndexedDB database to/from JSON files for reliable field disaster recovery.
 * 100% English language interface.
 */

class BackupEngine {
  /**
   * Export all database records to a downloaded JSON file
   */
  async exportBackup() {
    try {
      const dump = await window.db.dumpAllData();
      const jsonString = JSON.stringify(dump, null, 2);
      const blob = new Blob([jsonString], { type: 'application/json' });
      const url = URL.createObjectURL(blob);

      const now = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
      const filename = `dicklum-water-backup-${now}.json`;

      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      return { success: true, filename, timestamp: dump.exportedAt };
    } catch (err) {
      console.error('Backup export failed:', err);
      throw err;
    }
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
          if (!content.appName || !content.data) {
            throw new Error('Invalid backup file format. Please ensure this file was exported from Dicklum Water Billing System.');
          }
          await window.db.restoreAllData(content);
          resolve({ success: true, recordCount: Object.keys(content.data).length });
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
