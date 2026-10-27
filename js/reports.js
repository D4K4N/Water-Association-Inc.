/**
 * Dicklum Water Association, Inc. - Official Field Reports & PDF Engine
 * Generates publication-ready A4 reports:
 * 1. Monthly Billing & Revenue Summary Report
 * 2. Master Consumer & Water Meter Directory Listing
 * 3. Individual Consumer Billing, Payment & Reading Ledger Statement
 */

class ReportsEngine {
  constructor() {
    this.association = {
      name: 'Dicklum Water Association, Inc.',
      address: 'Dicklum, Manolo Fortich, Bukidnon, 8703',
      regNo: 'SEC Reg. CN2014-99120',
      tin: '008-721-432-000',
      contact: '0926-444-1234 / 0917-888-9921'
    };
  }

  /**
   * Generates Monthly Billing & Revenue Summary Report
   */
  generateBillingSummaryHTML(billingPeriod, bills = [], consumers = [], meters = []) {
    const targetPeriod = String(billingPeriod || '').trim().toLowerCase();
    const periodBills = (bills || []).filter(b => {
      if (!b) return false;
      if (!targetPeriod) return true;
      const bp = String(b.billingPeriod || '').toLowerCase();
      return bp === targetPeriod || bp.includes(targetPeriod);
    });
    
    let totalVolume = 0;
    let totalBilled = 0;
    let totalCollected = 0;
    let totalUnpaid = 0;
    let paidCount = 0;

    const rows = periodBills.length > 0 ? periodBills.map((b, idx) => {
      const consumer = (consumers || []).find(c => c.id === b.consumerId) || { name: 'Unknown', accountNo: 'N/A' };
      const meter = (meters || []).find(m => m.id === b.meterId || m.consumerId === b.consumerId) || { meterNo: 'N/A' };
      
      totalVolume += (b.consumption || 0);
      totalBilled += (b.totalAmountDue || 0);
      totalCollected += (b.amountPaid || 0);
      const balance = Math.max(0, (b.totalAmountDue || 0) - (b.amountPaid || 0));
      totalUnpaid += balance;
      if (b.paymentStatus === 'PAID') paidCount++;

      return `
        <tr>
          <td style="text-align: center;">${idx + 1}</td>
          <td><strong>${consumer.name}</strong></td>
          <td style="font-family: monospace;">${consumer.accountNo}</td>
          <td style="font-family: monospace;">${meter.meterNo}</td>
          <td style="text-align: right;">${(b.previousReading || 0).toLocaleString()}</td>
          <td style="text-align: right;">${(b.currentReading || 0).toLocaleString()}</td>
          <td style="text-align: right; font-weight: 700;">${(b.consumption || 0).toLocaleString()} m³</td>
          <td style="text-align: right;">PHP ${(b.totalAmountDue || 0).toFixed(2)}</td>
          <td style="text-align: right; color: #059669;">PHP ${(b.amountPaid || 0).toFixed(2)}</td>
          <td style="text-align: right; color: ${balance > 0 ? '#DC2626' : '#64748B'}; font-weight: 700;">
            PHP ${balance.toFixed(2)}
          </td>
          <td style="text-align: center;">
            <span class="badge ${b.paymentStatus === 'PAID' ? 'badge-success' : 'badge-danger'}">
              ${b.paymentStatus}
            </span>
          </td>
        </tr>
      `;
    }).join('') : `
      <tr>
        <td colspan="11" style="text-align: center; padding: 24px; color: #64748B;">
          No billing records found for period: <strong>${billingPeriod || 'Current Period'}</strong>.<br>
          Record meter readings in Reading Mode to populate official monthly summaries.
        </td>
      </tr>
    `;

    return `
      <div class="report-document">
        <header class="report-header">
          <div class="report-brand">
            <h2>${this.association.name}</h2>
            <p>${this.association.address}</p>
            <p class="sub">${this.association.regNo} • TIN: ${this.association.tin}</p>
          </div>
          <div class="report-title-badge">MONTHLY BILLING & REVENUE SUMMARY</div>
          <div class="report-meta">
            <div><strong>Billing Period:</strong> ${billingPeriod || 'Consolidated Summary'}</div>
            <div><strong>Generated:</strong> ${new Date().toLocaleDateString()}</div>
          </div>
        </header>

        <!-- KPI Metrics Summary -->
        <div class="report-metrics-grid">
          <div class="metric-card">
            <span class="lbl">Total Accounts Billed</span>
            <span class="val">${periodBills.length}</span>
          </div>
          <div class="metric-card">
            <span class="lbl">Total Volume Billed</span>
            <span class="val">${totalVolume.toLocaleString()} m³</span>
          </div>
          <div class="metric-card">
            <span class="lbl">Total Assessment Due</span>
            <span class="val">PHP ${totalBilled.toFixed(2)}</span>
          </div>
          <div class="metric-card">
            <span class="lbl">Total Collections</span>
            <span class="val" style="color: #059669;">PHP ${totalCollected.toFixed(2)}</span>
          </div>
          <div class="metric-card">
            <span class="lbl">Uncollected Balance</span>
            <span class="val" style="color: ${totalUnpaid > 0 ? '#DC2626' : '#64748B'};">PHP ${totalUnpaid.toFixed(2)}</span>
          </div>
          <div class="metric-card">
            <span class="lbl">Collection Efficiency</span>
            <span class="val">${totalBilled > 0 ? ((totalCollected / totalBilled) * 100).toFixed(1) : 0}%</span>
          </div>
        </div>

        <table class="report-table">
          <thead>
            <tr>
              <th style="width: 30px;">#</th>
              <th>Consumer Name</th>
              <th>Account #</th>
              <th>Meter #</th>
              <th style="text-align: right;">Prev (m³)</th>
              <th style="text-align: right;">Curr (m³)</th>
              <th style="text-align: right;">Usage</th>
              <th style="text-align: right;">Amount Due</th>
              <th style="text-align: right;">Paid</th>
              <th style="text-align: right;">Balance</th>
              <th style="text-align: center;">Status</th>
            </tr>
          </thead>
          <tbody>
            ${rows}
          </tbody>
          <tfoot>
            <tr style="background: #F8FAFC; font-weight: 800;">
              <td colspan="6" style="text-align: right;">TOTALS:</td>
              <td style="text-align: right;">${totalVolume.toLocaleString()} m³</td>
              <td style="text-align: right;">PHP ${totalBilled.toFixed(2)}</td>
              <td style="text-align: right; color: #059669;">PHP ${totalCollected.toFixed(2)}</td>
              <td style="text-align: right; color: #DC2626;">PHP ${totalUnpaid.toFixed(2)}</td>
              <td></td>
            </tr>
          </tfoot>
        </table>

        <div class="report-signatures">
          <div>
            <div class="sig-line">Prepared by (Meter Reader / Cashier):</div>
            <strong>Field Operations Officer</strong>
            <div style="font-size: 10px; color: #64748B;">Dicklum Water Association</div>
          </div>
          <div>
            <div class="sig-line">Verified by:</div>
            <strong>Association Treasurer / President</strong>
            <div style="font-size: 10px; color: #64748B;">Audit & Collections</div>
          </div>
        </div>
      </div>
    `;
  }

  /**
   * Generates Master Consumer & Water Meter Directory Listing
   */
  generateConsumerDirectoryHTML(consumers = [], meters = [], clusters = []) {
    const list = consumers || [];
    const rows = list.length > 0 ? list.map((c, idx) => {
      const meter = (meters || []).find(m => m.consumerId === c.id);
      const cluster = meter && meter.clusterId ? (clusters || []).find(cl => cl.id === meter.clusterId) : null;
      const hasHouseGps = Boolean(c.householdLat && c.householdLng);
      const hasMeterGps = Boolean(meter && meter.meterLat && meter.meterLng);

      return `
        <tr>
          <td style="text-align: center;">${idx + 1}</td>
          <td><strong>${c.name}</strong></td>
          <td style="font-family: monospace;">${c.accountNo}</td>
          <td>${c.zone}</td>
          <td>${meter ? meter.meterNo : '<em style="color:#94A3B8;">None</em>'}</td>
          <td>${cluster ? `${cluster.name} (Cluster)` : (meter ? 'Individual Standpipe' : 'N/A')}</td>
          <td style="font-size: 10.5px;">
            House: ${hasHouseGps ? `${c.householdLat.toFixed(5)}, ${c.householdLng.toFixed(5)}` : '<span style="color:#DC2626;">Unpinned</span>'}<br>
            Meter: ${hasMeterGps ? `${meter.meterLat.toFixed(5)}, ${meter.meterLng.toFixed(5)}` : '<span style="color:#DC2626;">Unpinned</span>'}
          </td>
          <td style="text-align: center;">
            <span class="badge ${c.status === 'Active' ? 'badge-success' : 'badge-danger'}">${c.status}</span>
          </td>
        </tr>
      `;
    }).join('') : `
      <tr>
        <td colspan="8" style="text-align: center; padding: 24px; color: #64748B;">
          No registered consumers in database.
        </td>
      </tr>
    `;

    return `
      <div class="report-document">
        <header class="report-header">
          <div class="report-brand">
            <h2>${this.association.name}</h2>
            <p>${this.association.address}</p>
          </div>
          <div class="report-title-badge">MASTER CONSUMER & WATER METER DIRECTORY</div>
          <div class="report-meta">
            <div><strong>Total Registered Consumers:</strong> ${list.length}</div>
            <div><strong>Generated:</strong> ${new Date().toLocaleDateString()}</div>
          </div>
        </header>

        <table class="report-table">
          <thead>
            <tr>
              <th style="width: 30px;">#</th>
              <th>Consumer Name</th>
              <th>Account #</th>
              <th>District / Zone</th>
              <th>Meter #</th>
              <th>Installation Type</th>
              <th>GPS Location Status</th>
              <th style="text-align: center;">Status</th>
            </tr>
          </thead>
          <tbody>
            ${rows}
          </tbody>
        </table>
      </div>
    `;
  }
}

if (typeof window !== 'undefined') {
  window.reportsEngine = new ReportsEngine();
}
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { ReportsEngine };
}
