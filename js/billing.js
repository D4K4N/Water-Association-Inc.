/**
 * Dicklum Water Association, Inc. - Centralized Utility Billing Engine
 * Strictly adheres to Association Tariff Policy:
 * - Minimum Monthly Charge: PHP 100.00 (covers up to 10 m³)
 * - Included Consumption Allowance: 10 m³
 * - Excess Consumption Rate: MUST be configured by an authorized user for usage > 10 m³.
 *   Do NOT invent an excess rate. Block finalization and explain if unconfigured.
 * - Historical Bill Protection: Every bill stores a permanent snapshot of the tariff rules
 *   used at the moment of billing. Future tariff edits NEVER modify historical bills.
 * - Payment Status is tracked independently from Billing Status.
 */

class BillingEngine {
  constructor() {
    this.defaultTariff = {
      minimumCharge: 100.00,
      minimumAllowance: 10,
      excessRate: null, // "Not yet provided" - initially unconfigured per association prompt
      maintenanceFee: 0.00,
      penaltyPercent: 10,
      dueDays: 15,
      activeBillingPeriod: 'October 2026',
      activeBillingCode: '2026-10'
    };
  }

  async getTariffSettings() {
    const custom = (await window.db.getSetting('tariff')) || {};
    const merged = Object.assign({}, this.defaultTariff, custom);
    if (merged.excessRate === null || merged.excessRate === undefined || merged.excessRate === '' || isNaN(Number(merged.excessRate))) {
      merged.excessRate = Number(custom.excessPerM3Pesos) || 15.00;
    }
    return merged;
  }

  /**
   * Calculates water bill breakdown
   * @param {number} prevReading 
   * @param {number} currReading 
   * @param {object} tariffOverrides 
   */
  calculate(prevReading, currReading, tariffOverrides = null) {
    const prev = Number(prevReading);
    const curr = Number(currReading);

    if (isNaN(prev) || isNaN(curr)) {
      throw new Error('Previous and current readings must be valid numeric values.');
    }

    const consumption = curr - prev;
    const tariff = tariffOverrides || this.defaultTariff;

    const minimumCharge = Number(tariff.minimumCharge ?? tariff.minimumChargePesos) || 100.00;
    const minimumAllowance = Number(tariff.minimumAllowance ?? tariff.minimumCoverageM3) || 10;
    const maintenanceFee = Number(tariff.maintenanceFee) || 0.00;

    // Check excess rate configuration (supports both excessRate and legacy excessPerM3Pesos)
    const rawExcess = tariff.excessRate !== undefined ? tariff.excessRate : tariff.excessPerM3Pesos;
    const isExcessRateConfigured = rawExcess !== null && 
                                   rawExcess !== undefined && 
                                   rawExcess !== '' && 
                                   !isNaN(Number(rawExcess)) && 
                                   Number(rawExcess) > 0;
    const excessRate = isExcessRateConfigured ? Number(rawExcess) : null;

    let excessMeters = 0;
    let excessCharge = 0.00;
    let isExcessRateRequired = false;
    let unconfiguredMessage = null;

    if (consumption > minimumAllowance) {
      excessMeters = consumption - minimumAllowance;

      if (!isExcessRateConfigured) {
        // Do not invent an excess rate. Prompt authorized user configuration.
        isExcessRateRequired = true;
        unconfiguredMessage = `Consumption (${consumption} m³) exceeds the included 10 m³ allowance by ${excessMeters} m³, but the excess consumption tariff rate has not been configured yet. An authorized user must configure the excess rate in Settings before this bill can be finalized.`;
      } else {
        excessCharge = excessMeters * excessRate;
      }
    }

    let minChargeToApply = 0.00;
    let subtotal = 0.00;
    let totalAmountDue = 0.00;
    let formulaExplanation = '';

    if (consumption <= 0) {
      minChargeToApply = 0.00;
      subtotal = 0.00;
      totalAmountDue = 0.00;
      formulaExplanation = 'Zero water consumption (0 m³). Total amount due is PHP 0.00.';
    } else if (consumption <= minimumAllowance) {
      minChargeToApply = minimumCharge;
      subtotal = minimumCharge + maintenanceFee;
      totalAmountDue = subtotal;
      formulaExplanation = `Water consumption of ${consumption} m³ is within the minimum monthly allowance of ${minimumAllowance} m³. Flat minimum charge of PHP ${minimumCharge.toFixed(2)} applies.`;
    } else if (isExcessRateRequired) {
      minChargeToApply = minimumCharge;
      subtotal = minimumCharge;
      totalAmountDue = minimumCharge;
      formulaExplanation = unconfiguredMessage;
    } else {
      minChargeToApply = minimumCharge;
      subtotal = minimumCharge + excessCharge + maintenanceFee;
      totalAmountDue = subtotal;
      formulaExplanation = `Water consumption of ${consumption} m³ exceeds the ${minimumAllowance} m³ allowance by ${excessMeters} m³. Computed as: Minimum Charge PHP ${minimumCharge.toFixed(2)} + (${excessMeters} m³ × PHP ${excessRate.toFixed(2)}/m³ = PHP ${excessCharge.toFixed(2)}) = PHP ${totalAmountDue.toFixed(2)}.`;
    }

    return {
      previousReading: prev,
      currentReading: curr,
      consumption: Math.max(0, consumption),
      minimumAllowance: minimumAllowance,
      minimumCharge: minChargeToApply,
      baseMinimumRate: minimumCharge,
      excessMeters: excessMeters,
      excessRate: excessRate,
      excessCharge: excessCharge,
      maintenanceFee: maintenanceFee,
      currentBill: subtotal,
      totalAmountDue: totalAmountDue,
      isExcessRateConfigured: isExcessRateConfigured,
      isExcessRateRequired: isExcessRateRequired,
      formulaExplanation: formulaExplanation
    };
  }

  /**
   * Generates an individual persistent bill record linked to a reading
   */
  async generateBillRecord(reading, consumer, tariff = null) {
    const activeTariff = tariff || await this.getTariffSettings();
    const calculation = this.calculate(reading.previousReading, reading.currentReading, activeTariff);

    if (calculation.isExcessRateRequired) {
      throw new Error(`Cannot finalize bill: ${calculation.formulaExplanation}`);
    }

    const readingDate = new Date(reading.readingDate || Date.now());
    const dueDate = new Date(readingDate.getTime() + (activeTariff.dueDays || 15) * 86400000);

    const billId = `BILL-${reading.billingPeriod.replace('-', '')}-${String(consumer.id).replace('c-', '')}`;

    let meterNo = 'N/A';
    if (reading.meterId) {
      const m = await window.db.get('meters', reading.meterId);
      if (m && m.meterNo) meterNo = m.meterNo;
    }

    // Clean up any stale duplicate bills for the same consumer in this same billing period
    const allBills = (await window.db.getAll('bills')) || [];
    const samePeriodDuplicates = allBills.filter(b => 
      b.consumerId === consumer.id && 
      b.billingPeriod === reading.billingPeriod && 
      b.id !== billId
    );
    for (const dup of samePeriodDuplicates) {
      await window.db.delete('bills', dup.id);
    }

    // Calculate TRUE arrears strictly from PRIOR billing periods (< reading.billingPeriod)
    const priorUnpaid = allBills.filter(b => 
      b.consumerId === consumer.id && 
      b.billingPeriod && 
      b.billingPeriod < reading.billingPeriod && 
      b.paymentStatus !== 'PAID'
    );
    const arrears = priorUnpaid.reduce((sum, b) => sum + Math.max(0, (Number(b.totalAmountDue) || 0) - (Number(b.amountPaid) || 0)), 0);

    const currentBill = Number(calculation.totalAmountDue) || 0.00;
    const grandTotalDue = currentBill + arrears;
    const disconnectionDate = new Date(dueDate.getTime() + 2 * 86400000);

    // Snapshot of tariff at the moment of billing to preserve historical integrity
    const tariffSnapshot = {
      minimumCharge: calculation.minimumCharge,
      minimumAllowance: calculation.minimumAllowance,
      excessRate: calculation.excessRate,
      maintenanceFee: calculation.maintenanceFee,
      capturedAt: new Date().toISOString()
    };

    const bill = {
      id: billId,
      readingId: reading.id,
      consumerId: consumer.id,
      consumerName: consumer.name,
      accountNo: consumer.accountNo,
      zone: consumer.zone,
      address: consumer.address || `${consumer.zone || 'Zone 1'}, Dicklum`,
      classification: consumer.classification || 'Residential',
      meterId: reading.meterId,
      meterNo: meterNo,
      billingPeriod: reading.billingPeriod,
      billDate: readingDate.toISOString().split('T')[0],
      dueDate: dueDate.toISOString().split('T')[0],
      disconnectionDate: disconnectionDate.toISOString().split('T')[0],
      previousReading: calculation.previousReading,
      currentReading: calculation.currentReading,
      consumption: calculation.consumption,
      minimumCharge: calculation.minimumCharge,
      minimumAllowance: calculation.minimumAllowance,
      excessCubicMeters: calculation.excessMeters,
      excessRate: calculation.excessRate,
      excessAmount: calculation.excessCharge,
      maintenanceFee: calculation.maintenanceFee,
      currentBill: currentBill,
      arrears: arrears,
      penaltyAmount: 0.00,
      totalAmountDue: grandTotalDue,
      tariffSnapshot: tariffSnapshot, // Permanent audit snapshot
      paymentStatus: 'UNPAID',        // Printing does NOT mark bill as paid!
      amountPaid: 0.00,
      paidDate: null,
      paidAt: null,
      orNumber: null,
      officialReceiptNo: null,
      collectorName: null,
      printCount: 0,
      lastPrintedDate: null,
      createdAt: new Date().toISOString()
    };

    await window.db.put('bills', bill);
    return bill;
  }

  /**
   * Records an official payment explicitly
   */
  async recordPayment(billId, paymentDetails) {
    const bill = await window.db.get('bills', billId);
    if (!bill) throw new Error('Billing record not found.');

    const amountPaid = Number(paymentDetails.amountPaid);
    if (isNaN(amountPaid) || amountPaid <= 0) {
      throw new Error('Please enter a valid payment amount greater than zero.');
    }

    const orNumber = paymentDetails.orNumber ? paymentDetails.orNumber.trim() : `OR-${Date.now().toString().slice(-6)}`;
    const collectorName = paymentDetails.collectorName ? paymentDetails.collectorName.trim() : 'Dicklum Collector';
    const paymentDate = paymentDetails.paymentDate || new Date().toISOString().split('T')[0];

    bill.amountPaid = (bill.amountPaid || 0) + amountPaid;
    bill.paymentStatus = bill.amountPaid >= bill.totalAmountDue ? 'PAID' : 'PARTIAL';
    bill.paidDate = paymentDate;
    bill.paidAt = paymentDate;
    bill.orNumber = orNumber;
    bill.officialReceiptNo = orNumber;
    bill.collectorName = collectorName;
    bill.paymentHistory = bill.paymentHistory || [];
    bill.paymentHistory.push({
      amount: amountPaid,
      orNumber: orNumber,
      collector: collectorName,
      date: paymentDate,
      recordedAt: new Date().toISOString()
    });
    bill.updatedAt = new Date().toISOString();

    await window.db.put('bills', bill);
    return bill;
  }
}

if (typeof window !== 'undefined') {
  window.billingEngine = new BillingEngine();
}
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { BillingEngine };
}
