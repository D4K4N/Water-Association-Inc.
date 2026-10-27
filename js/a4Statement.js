/**
 * Dicklum Water Association - Official A4 Statement of Account Generator
 * Generates an official, publication-quality A4 billing statement with tear-off cashier collection stub.
 * 100% English language format.
 */

class A4StatementGenerator {
  generateHTML(bill, consumer, meter, settings) {
    const assoc = settings.association || {
      name: 'Dicklum Water Association, Inc.',
      address: 'Dicklum, Manolo Fortich, Bukidnon, 8703',
      regNo: 'SEC Reg. CN2014-99120',
      tin: '008-721-432-000',
      emergencyContact: '0926-444-1234'
    };

    const isPaid = bill.paymentStatus === 'PAID';
    const statusBadgeClass = isPaid ? 'status-paid' : 'status-unpaid';
    const statusText = isPaid ? 'PAID' : 'UNPAID';

    return `
      <div class="a4-document">
        <!-- Header -->
        <header class="a4-header">
          <div class="a4-header-logo">
            <svg viewBox="0 0 120 120" width="70" height="70">
              <circle cx="60" cy="60" r="56" fill="#E8F5E9" stroke="#1B5E20" stroke-width="2"/>
              <path d="M60 22 C60 22 34 56 34 72 C34 86.36 45.64 98 60 98 C74.36 98 86 86.36 86 72 C86 56 60 22 60 22 Z" fill="#1B5E20"/>
              <path d="M50 48 C44 56 42 66 45 74 C42 68 44 58 50 48 Z" fill="#FFFFFF" opacity="0.6"/>
            </svg>
          </div>
          <div class="a4-header-text">
            <h1>${assoc.name}</h1>
            <p class="a4-subtitle">${assoc.address}</p>
            <p class="a4-meta">${assoc.regNo} | TIN: ${assoc.tin} | Hotline: ${assoc.emergencyContact}</p>
            <div class="a4-title-badge">STATEMENT OF WATER ACCOUNT</div>
          </div>
          <div class="a4-header-billno">
            <div class="billno-box">
              <span class="lbl">BILL REFERENCE</span>
              <span class="val">${bill.id}</span>
            </div>
            <div class="billdate-box">
              <span class="lbl">BILLING PERIOD</span>
              <span class="val">${bill.billingPeriod}</span>
            </div>
          </div>
        </header>

        <!-- Two-column info box -->
        <div class="a4-grid-2">
          <!-- Consumer Info -->
          <div class="a4-panel">
            <div class="a4-panel-title">CONSUMER INFORMATION</div>
            <table class="a4-table-compact">
              <tr>
                <td class="lbl">Account Number:</td>
                <td class="val highlight">${consumer.accountNo}</td>
              </tr>
              <tr>
                <td class="lbl">Consumer Name:</td>
                <td class="val bold">${consumer.name}</td>
              </tr>
              <tr>
                <td class="lbl">Service Address:</td>
                <td class="val">${consumer.address}</td>
              </tr>
              <tr>
                <td class="lbl">Zone / District:</td>
                <td class="val">${consumer.zone}</td>
              </tr>
              <tr>
                <td class="lbl">Contact Number:</td>
                <td class="val">${consumer.contact || 'N/A'}</td>
              </tr>
            </table>
          </div>

          <!-- Meter Info -->
          <div class="a4-panel">
            <div class="a4-panel-title">METER & READING DETAILS</div>
            <table class="a4-table-compact">
              <tr>
                <td class="lbl">Meter Number:</td>
                <td class="val bold">${meter ? meter.meterNo : 'N/A'}</td>
              </tr>
              <tr>
                <td class="lbl">Installation Type:</td>
                <td class="val">${meter && meter.isClustered ? 'Clustered Manifold' : 'Individual Standpipe'}</td>
              </tr>
              <tr>
                <td class="lbl">Billing Date:</td>
                <td class="val">${bill.billDate}</td>
              </tr>
              <tr>
                <td class="lbl">Payment Due Date:</td>
                <td class="val text-danger bold">${bill.dueDate}</td>
              </tr>
              <tr>
                <td class="lbl">Field Meter Reader:</td>
                <td class="val">${bill.readerName || 'R. Fernandez'}</td>
              </tr>
            </table>
          </div>
        </div>

        <!-- Meter Reading Computation Table -->
        <div class="a4-section">
          <div class="a4-panel-title">WATER CONSUMPTION COMPUTATION</div>
          <table class="a4-table-bordered">
            <thead>
              <tr>
                <th>Billing Period</th>
                <th>Previous Reading (m³)</th>
                <th>Current Reading (m³)</th>
                <th>Consumption (m³)</th>
                <th>Tariff Basis</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>${bill.billingPeriod}</td>
                <td class="text-right">${bill.previousReading.toLocaleString()}</td>
                <td class="text-right">${bill.currentReading.toLocaleString()}</td>
                <td class="text-right bold text-primary">${bill.consumption.toLocaleString()} m³</td>
                <td>Temporary Utility Tariff (Min. 10 m³)</td>
              </tr>
            </tbody>
          </table>
        </div>

        <!-- Itemized Charges Assessment -->
        <div class="a4-section a4-grid-charges">
          <div class="a4-advisory-box">
            <h4>Important Consumer Advisory:</h4>
            <ul>
              <li>The minimum monthly charge of PHP 100.00 includes water consumption up to 10 cubic meters (m³).</li>
              <li>Please settle this statement on or before the designated <strong>Due Date (${bill.dueDate})</strong>.</li>
              <li>Unsettled delinquent accounts are subject to service disconnection after notice period.</li>
              <li>For inquiries or service assistance, contact the Dicklum Water Association field office.</li>
            </ul>
            <div class="payment-status-badge ${statusBadgeClass}">
              ACCOUNT STATUS: ${statusText}
            </div>
          </div>

          <div class="a4-charges-box">
            <table class="a4-table-charges">
              <tr>
                <td>Minimum Monthly Charge (up to 10 m³):</td>
                <td class="text-right">PHP ${bill.minimumCharge.toFixed(2)}</td>
              </tr>
              <tr>
                <td>Excess Consumption (${bill.excessCubicMeters || 0} m³ @ PHP ${bill.excessRate || 0}/m³):</td>
                <td class="text-right">PHP ${(bill.excessAmount || 0).toFixed(2)}</td>
              </tr>
              <tr>
                <td>System Maintenance Fee:</td>
                <td class="text-right">PHP ${(bill.maintenanceFee || 0).toFixed(2)}</td>
              </tr>
              <tr>
                <td>Arrears / Penalties:</td>
                <td class="text-right">PHP ${(bill.penaltyAmount || 0).toFixed(2)}</td>
              </tr>
              <tr class="total-row">
                <td><strong>TOTAL AMOUNT DUE:</strong></td>
                <td class="text-right"><strong>PHP ${bill.totalAmountDue.toFixed(2)}</strong></td>
              </tr>
            </table>
          </div>
        </div>

        <!-- Tear-off line -->
        <div class="a4-tear-off">
          <div class="tear-off-line">
            <span>✂</span>
            <span>Tear along perforation line and present with payment to cashier</span>
            <span>✂</span>
          </div>
        </div>

        <!-- Cashier Collection Stub -->
        <div class="a4-stub">
          <div class="stub-header">
            <strong>DICKLUM WATER ASSOCIATION, INC. — CASHIER COLLECTION STUB</strong>
            <span>Bill Ref: ${bill.id}</span>
          </div>
          <div class="stub-body">
            <div><strong>Consumer:</strong> ${consumer.name}</div>
            <div><strong>Acct No:</strong> ${consumer.accountNo}</div>
            <div><strong>Zone:</strong> ${consumer.zone}</div>
            <div><strong>Period:</strong> ${bill.billingPeriod}</div>
            <div><strong>Due Date:</strong> ${bill.dueDate}</div>
            <div class="stub-total"><strong>Amount Due:</strong> PHP ${bill.totalAmountDue.toFixed(2)}</div>
          </div>
          <div class="stub-footer">
            <div class="stub-sig">Cashier / Collector Signature: _______________________</div>
            <div class="stub-or">OR Number: ______________ Date Paid: ______________</div>
          </div>
        </div>
      </div>
    `;
  }
}

window.a4StatementGenerator = new A4StatementGenerator();
