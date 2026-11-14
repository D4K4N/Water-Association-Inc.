/**
 * Dicklum Water Association, Inc. - Official Field Reports, PDF & Excel Export Engine
 * Generates publication-ready A4 PDF reports and arranged Excel (.xls) spreadsheets:
 * 1. Zone-Separated Billing & Reading Reports (Zone 1, Zone 2, Zone 3, Zone 4)
 * 2. Time-Filtered Reports ("Records I Made Today" vs "Records of This Month")
 * 3. Individual Consumer / Water Meter Owner Reading & Billing Ledger (e.g. Mario: Previous -> Current Reading)
 * 4. Monthly Billing & Revenue Summary Report
 * 5. Master Consumer & Water Meter Directory Listing
 */

class ReportsEngine {
  constructor() {
    this.association = {
      name: 'Dicklum Water Association, Inc.',
      address: 'Barangay Diclum, Manolo Fortich, Bukidnon, 8703',
      regNo: 'SEC Reg. CN2014-99120',
      tin: '008-721-432-000',
      contact: '0926-444-1234 / 0917-888-9921'
    };
  }

  /**
   * Filters bills & readings by Zone, Time Period ('today' | 'month' | 'all'), and optional Consumer ID
   */
  filterRecords({
    zone = 'ALL',
    periodMode = 'today',
    consumerId = '',
    consumers = [],
    meters = [],
    bills = [],
    readings = [],
    activeBillingPeriod = ''
  }) {
    const now = new Date();
    const todayStr = now.toDateString();
    const currentYearMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

    const isSameDay = (isoOrDate) => {
      if (!isoOrDate) return false;
      const d = new Date(isoOrDate);
      return !isNaN(d.getTime()) && d.toDateString() === todayStr;
    };

    const isThisMonth = (isoOrDate, billingPeriodStr) => {
      if (isoOrDate) {
        const d = new Date(isoOrDate);
        if (!isNaN(d.getTime())) {
          const ym = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
          if (ym === currentYearMonth) return true;
        }
      }
      if (billingPeriodStr && activeBillingPeriod) {
        const bp = String(billingPeriodStr).toLowerCase();
        const act = String(activeBillingPeriod).toLowerCase();
        if (bp.includes(act) || act.includes(bp)) return true;
      }
      return false;
    };

    // Build unified rows combining bills and readings so every reading from Previous -> Current is listed
    const rows = [];
    const seenReadingIds = new Set();

    // 1. From Bills (which include reading + computed bill amount)
    for (const b of (bills || [])) {
      const consumer = (consumers || []).find(c => c.id === b.consumerId);
      const meter = (meters || []).find(m => m.id === b.meterId || (consumer && m.consumerId === consumer.id));
      const rowZone = (consumer && consumer.zone) || (meter && meter.zone) || 'Zone 1';

      if (zone && zone !== 'ALL' && rowZone !== zone) continue;
      if (consumerId && b.consumerId !== consumerId) continue;

      const dateVal = b.createdAt || b.readingDate || b.billDate;
      if (periodMode === 'today' && !isSameDay(dateVal)) continue;
      if (periodMode === 'month' && !isThisMonth(dateVal, b.billingPeriod)) continue;

      if (b.readingId) seenReadingIds.add(b.readingId);

      rows.push({
        id: b.id,
        consumerId: b.consumerId,
        consumerName: consumer ? consumer.name : (meter && meter.ownerName ? meter.ownerName : 'Unknown'),
        accountNo: consumer ? consumer.accountNo : 'N/A',
        meterNo: meter ? meter.meterNo : 'Unassigned',
        zone: rowZone,
        address: consumer ? consumer.address : `${rowZone}, Diclum`,
        dateIso: dateVal || new Date().toISOString(),
        billingPeriod: b.billingPeriod || activeBillingPeriod || 'Current Period',
        previousReading: Number(b.previousReading ?? 0),
        currentReading: Number(b.currentReading ?? 0),
        consumption: Number(b.consumption ?? Math.max(0, Number(b.currentReading || 0) - Number(b.previousReading || 0))),
        totalAmountDue: Number(b.totalAmountDue ?? 100),
        amountPaid: Number(b.amountPaid ?? 0),
        paymentStatus: b.paymentStatus || 'UNPAID'
      });
    }

    // 2. Any standalone readings not already represented in bills
    for (const r of (readings || [])) {
      if (seenReadingIds.has(r.id)) continue;
      const consumer = (consumers || []).find(c => c.id === r.consumerId);
      const meter = (meters || []).find(m => m.id === r.meterId || (consumer && m.consumerId === consumer.id));
      const rowZone = (consumer && consumer.zone) || (meter && meter.zone) || 'Zone 1';

      if (zone && zone !== 'ALL' && rowZone !== zone) continue;
      if (consumerId && r.consumerId !== consumerId) continue;

      const dateVal = r.readingDate || r.createdAt;
      if (periodMode === 'today' && !isSameDay(dateVal)) continue;
      if (periodMode === 'month' && !isThisMonth(dateVal, r.billingPeriod)) continue;

      const prev = Number(r.previousReading ?? 0);
      const curr = Number(r.currentReading ?? 0);
      const cons = Number(r.consumption ?? Math.max(0, curr - prev));
      const excess = Math.max(0, cons - 10);
      const estBill = cons <= 0 ? 0.00 : (100 + excess * 15);

      rows.push({
        id: r.id,
        consumerId: r.consumerId,
        consumerName: consumer ? consumer.name : (meter && meter.ownerName ? meter.ownerName : 'Unknown'),
        accountNo: consumer ? consumer.accountNo : 'N/A',
        meterNo: meter ? meter.meterNo : 'Unassigned',
        zone: rowZone,
        address: consumer ? consumer.address : `${rowZone}, Diclum`,
        dateIso: dateVal || new Date().toISOString(),
        billingPeriod: r.billingPeriod || activeBillingPeriod || 'Current Period',
        previousReading: prev,
        currentReading: curr,
        consumption: cons,
        totalAmountDue: estBill,
        amountPaid: 0,
        paymentStatus: 'RECORDED'
      });
    }

    // 3. If filtering by Zone or Consumer and there are registered consumers in that zone who have an initial reading but no bill yet in 'all' mode
    if (rows.length === 0 && periodMode === 'all') {
      const targetConsumers = (consumers || []).filter(c => {
        if (consumerId && c.id !== consumerId) return false;
        if (zone && zone !== 'ALL' && c.zone !== zone) return false;
        return true;
      });
      for (const c of targetConsumers) {
        const meter = (meters || []).find(m => m.consumerId === c.id);
        const initRdg = meter ? Number(meter.initialReading || 0) : 0;
        rows.push({
          id: c.id,
          consumerId: c.id,
          consumerName: c.name,
          accountNo: c.accountNo,
          meterNo: meter ? meter.meterNo : 'Unassigned',
          zone: c.zone || 'Zone 1',
          address: c.address || `${c.zone || 'Zone 1'}, Diclum`,
          dateIso: c.createdAt || new Date().toISOString(),
          billingPeriod: activeBillingPeriod || 'Initial Registration',
          previousReading: initRdg,
          currentReading: initRdg,
          consumption: 0,
          totalAmountDue: 0.00,
          amountPaid: 0,
          paymentStatus: 'REGISTERED'
        });
      }
    }

    rows.sort((a, b) => new Date(b.dateIso) - new Date(a.dateIso));
    return rows;
  }

  /**
   * Generates Zone-Separated or Individual Consumer Printable A4 Report HTML
   */
  generateZoneOrConsumerReportHTML(opts = {}) {
    const {
      zone = 'ALL',
      periodMode = 'today',
      consumerId = '',
      consumers = [],
      meters = [],
      bills = [],
      readings = [],
      activeBillingPeriod = 'October 2026'
    } = opts;

    const rows = this.filterRecords({
      zone,
      periodMode,
      consumerId,
      consumers,
      meters,
      bills,
      readings,
      activeBillingPeriod
    });

    const targetConsumer = consumerId ? (consumers || []).find(c => c.id === consumerId) : null;
    const periodLabel = periodMode === 'today'
      ? `Records Made Today (${new Date().toLocaleDateString()})`
      : periodMode === 'month'
        ? `Records of This Month (${activeBillingPeriod || new Date().toLocaleString('default', { month: 'long', year: 'numeric' })})`
        : 'All Complete Reading & Billing Records';

    const zoneLabel = targetConsumer
      ? `Consumer Ledger: ${targetConsumer.name} (${targetConsumer.zone})`
      : (zone && zone !== 'ALL' ? `${zone} — Barangay Diclum` : 'All Zones (Zone 1 – Zone 4)');

    let totalVolume = 0;
    let totalBilled = 0;
    let totalPaid = 0;

    const tableRowsHtml = rows.length > 0 ? rows.map((r, idx) => {
      totalVolume += r.consumption;
      totalBilled += r.totalAmountDue;
      totalPaid += r.amountPaid;
      const d = new Date(r.dateIso);
      const dateFormatted = !isNaN(d.getTime())
        ? `${d.toLocaleDateString()} ${d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`
        : 'N/A';

      return `
        <tr>
          <td style="text-align: center;">${idx + 1}</td>
          <td><strong>${r.consumerName}</strong></td>
          <td style="font-family: monospace;">${r.accountNo}</td>
          <td style="font-family: monospace; font-weight: 700; color: #1E40AF;">${r.meterNo}</td>
          <td>${r.zone}</td>
          <td style="font-size: 9.5px;">${dateFormatted}</td>
          <td style="text-align: right; font-weight: 600;">${r.previousReading.toLocaleString()} m³</td>
          <td style="text-align: right; font-weight: 800; color: #0F172A;">${r.currentReading.toLocaleString()} m³</td>
          <td style="text-align: right; font-weight: 800; color: #0F766E;">${r.consumption.toLocaleString()} m³</td>
          <td style="text-align: right; font-weight: 800;">PHP ${r.totalAmountDue.toFixed(2)}</td>
          <td style="text-align: center;">
            <span class="badge ${r.paymentStatus === 'PAID' ? 'badge-success' : 'badge-warning'}">${r.paymentStatus}</span>
          </td>
        </tr>
      `;
    }).join('') : `
      <tr>
        <td colspan="11" style="text-align: center; padding: 22px; color: #64748B;">
          No reading or billing records found for <strong>${zoneLabel}</strong> under <strong>${periodLabel}</strong>.<br>
          Try switching the filter between <em>"Records I Made Today"</em> and <em>"Records of This Month"</em>.
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
          <div class="report-title-badge">${targetConsumer ? 'CONSUMER READING & BILLING LEDGER' : `${zone === 'ALL' ? 'ALL ZONES' : zone.toUpperCase()} — READING & BILLING REPORT`}</div>
          <div class="report-meta">
            <div><strong>District / Scope:</strong> ${zoneLabel}</div>
            <div><strong>Filter Period:</strong> ${periodLabel}</div>
            <div><strong>Generated:</strong> ${new Date().toLocaleString()}</div>
          </div>
        </header>

        <div class="report-metrics-grid" style="grid-template-columns: repeat(4, 1fr);">
          <div class="metric-card">
            <span class="lbl">Records Listed</span>
            <span class="val">${rows.length}</span>
          </div>
          <div class="metric-card">
            <span class="lbl">Total Water Consumed</span>
            <span class="val">${totalVolume.toLocaleString()} m³</span>
          </div>
          <div class="metric-card">
            <span class="lbl">Total Current Bills</span>
            <span class="val">PHP ${totalBilled.toFixed(2)}</span>
          </div>
          <div class="metric-card">
            <span class="lbl">Total Collected</span>
            <span class="val" style="color: #059669;">PHP ${totalPaid.toFixed(2)}</span>
          </div>
        </div>

        <table class="report-table">
          <thead>
            <tr>
              <th style="width: 28px;">#</th>
              <th>Water Meter Owner / Consumer</th>
              <th>Account #</th>
              <th>Meter # (WM)</th>
              <th>Zone</th>
              <th>Reading Date</th>
              <th style="text-align: right;">Previous Rdg</th>
              <th style="text-align: right;">Current Rdg</th>
              <th style="text-align: right;">Consumption</th>
              <th style="text-align: right;">Current Bill</th>
              <th style="text-align: center;">Status</th>
            </tr>
          </thead>
          <tbody>
            ${tableRowsHtml}
          </tbody>
          <tfoot>
            <tr style="background: #F8FAFC; font-weight: 800;">
              <td colspan="8" style="text-align: right;">TOTALS:</td>
              <td style="text-align: right; color: #0F766E;">${totalVolume.toLocaleString()} m³</td>
              <td style="text-align: right;">PHP ${totalBilled.toFixed(2)}</td>
              <td></td>
            </tr>
          </tfoot>
        </table>

        <div class="report-signatures">
          <div>
            <div class="sig-line">Prepared & Uploaded by (Meter Reader):</div>
            <strong>Field Operations Reader</strong>
            <div style="font-size: 10px; color: #64748B;">Dicklum Water Association</div>
          </div>
          <div>
            <div class="sig-line">Received & Verified at Office by:</div>
            <strong>Office Cashier / Treasurer</strong>
            <div style="font-size: 10px; color: #64748B;">Barangay Diclum Office</div>
          </div>
        </div>
      </div>
    `;
  }

  /**
   * Generates & Downloads a cleanly arranged Microsoft Excel (.xls) Spreadsheet Table
   * for a specific Zone, Period ('today' | 'month' | 'all'), or Consumer (e.g. Mario)
   */
  downloadExcelReport(opts = {}) {
    const {
      zone = 'ALL',
      periodMode = 'today',
      consumerId = '',
      consumers = [],
      meters = [],
      bills = [],
      readings = [],
      activeBillingPeriod = 'October 2026'
    } = opts;

    const rows = this.filterRecords({
      zone,
      periodMode,
      consumerId,
      consumers,
      meters,
      bills,
      readings,
      activeBillingPeriod
    });

    const targetConsumer = consumerId ? (consumers || []).find(c => c.id === consumerId) : null;
    const periodLabel = periodMode === 'today'
      ? `Records Made Today (${new Date().toLocaleDateString()})`
      : periodMode === 'month'
        ? `Records of This Month (${activeBillingPeriod})`
        : 'All Historical Records';

    const titleScope = targetConsumer
      ? `${targetConsumer.name} (${targetConsumer.accountNo})`
      : (zone === 'ALL' ? 'All Zones (Zone 1 to Zone 4)' : zone);

    let totalVolume = 0;
    let totalBilled = 0;

    const tableRows = rows.map((r, idx) => {
      totalVolume += r.consumption;
      totalBilled += r.totalAmountDue;
      const d = new Date(r.dateIso);
      const dateStr = !isNaN(d.getTime())
        ? `${d.toLocaleDateString()} ${d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`
        : '';
      return `
        <tr>
          <td style="text-align:center; border:1px solid #CBD5E1; padding:6px;">${idx + 1}</td>
          <td style="font-weight:bold; border:1px solid #CBD5E1; padding:6px;">${r.consumerName}</td>
          <td style="border:1px solid #CBD5E1; padding:6px;">${r.accountNo}</td>
          <td style="font-weight:bold; color:#1D4ED8; border:1px solid #CBD5E1; padding:6px;">${r.meterNo}</td>
          <td style="border:1px solid #CBD5E1; padding:6px;">${r.zone}</td>
          <td style="border:1px solid #CBD5E1; padding:6px;">${r.address}</td>
          <td style="border:1px solid #CBD5E1; padding:6px;">${dateStr}</td>
          <td style="text-align:right; border:1px solid #CBD5E1; padding:6px;">${r.previousReading}</td>
          <td style="text-align:right; font-weight:bold; border:1px solid #CBD5E1; padding:6px;">${r.currentReading}</td>
          <td style="text-align:right; font-weight:bold; color:#0F766E; border:1px solid #CBD5E1; padding:6px;">${r.consumption}</td>
          <td style="text-align:right; font-weight:bold; border:1px solid #CBD5E1; padding:6px;">${r.totalAmountDue.toFixed(2)}</td>
          <td style="text-align:center; border:1px solid #CBD5E1; padding:6px;">${r.paymentStatus}</td>
        </tr>
      `;
    }).join('');

    const excelHtml = `
      <html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel" xmlns="http://www.w3.org/TR/REC-html40">
      <head>
        <meta charset="UTF-8">
        <!--[if gte mso 9]><xml><x:ExcelWorkbook><x:ExcelWorksheets><x:ExcelWorksheet><x:Name>Dicklum Water Records</x:Name><x:WorksheetOptions><x:DisplayGridlines/></x:WorksheetOptions></x:ExcelWorksheet></x:ExcelWorksheets></x:ExcelWorkbook></xml><![endif]-->
      </head>
      <body style="font-family: Arial, sans-serif; font-size: 12px;">
        <table border="1" cellspacing="0" cellpadding="6" style="border-collapse:collapse;">
          <tr>
            <td colspan="12" style="background:#0F172A; color:#FFFFFF; font-size:15px; font-weight:bold; padding:10px;">
              DICKLUM WATER ASSOCIATION, INC. — OFFICIAL METER READING &amp; BILLING RECORDS
            </td>
          </tr>
          <tr>
            <td colspan="6" style="background:#F1F5F9; font-weight:bold;">Scope / Zone: ${titleScope}</td>
            <td colspan="6" style="background:#F1F5F9; font-weight:bold;">Filter: ${periodLabel}</td>
          </tr>
          <tr style="background:#0F766E; color:#FFFFFF; font-weight:bold; text-align:center;">
            <th>#</th>
            <th>Consumer / Water Meter Owner</th>
            <th>Account No.</th>
            <th>Water Meter # (WM)</th>
            <th>Zone</th>
            <th>Address</th>
            <th>Reading Date &amp; Time</th>
            <th>Previous Reading (m³)</th>
            <th>Current Reading (m³)</th>
            <th>Consumption (m³)</th>
            <th>Current Bill (PHP)</th>
            <th>Status</th>
          </tr>
          ${tableRows}
          <tr style="background:#FEF3C7; font-weight:bold;">
            <td colspan="9" style="text-align:right; padding:6px;">TOTALS (${rows.length} record${rows.length === 1 ? '' : 's'}):</td>
            <td style="text-align:right; padding:6px;">${totalVolume} m³</td>
            <td style="text-align:right; padding:6px;">PHP ${totalBilled.toFixed(2)}</td>
            <td></td>
          </tr>
        </table>
      </body>
      </html>
    `;

    const blob = new Blob(['\ufeff', excelHtml], { type: 'application/vnd.ms-excel;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const cleanScope = (targetConsumer ? targetConsumer.name : zone).replace(/[^a-zA-Z0-9_-]/g, '_');
    const datePart = new Date().toISOString().slice(0, 10);
    a.href = url;
    a.download = `Dicklum_${cleanScope}_${periodMode}_${datePart}.xls`;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }, 300);

    return { count: rows.length, filename: a.download };
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
      const consumer = (consumers || []).find(c => c.id === b.consumerId) || { name: 'Unknown', accountNo: 'N/A', zone: 'Zone 1' };
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
          <td>${consumer.zone || 'Zone 1'}</td>
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
        <td colspan="12" style="text-align: center; padding: 24px; color: #64748B;">
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
              <th>Zone</th>
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
              <td colspan="7" style="text-align: right;">TOTALS:</td>
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
