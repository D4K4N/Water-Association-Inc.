/**
 * Dicklum Water Association, Inc. - Water Meter Reading Module
 * Handles field readings, live consumption computation, validation, duplicate prevention, and photo capture.
 * All user-facing communications in clear, professional English.
 */

class ReadingModule {
  constructor() {
    this.currentConsumer = null;
    this.currentMeter = null;
    this.previousReadingVal = 0;
    this.capturedPhotoBlob = null;
  }

  /**
   * Loads consumer and their latest reading to prepare reading form
   */
  async loadConsumer(consumerId) {
    const data = await window.db.getConsumerWithMeter(consumerId);
    if (!data || !data.consumer) {
      throw new Error('Consumer record not found.');
    }

    this.currentConsumer = data.consumer;
    this.currentMeter = data.meter;

    if (data.latestReading) {
      this.previousReadingVal = Number(data.latestReading.currentReading) || 0;
    } else if (data.meter && data.meter.initialReading !== undefined) {
      this.previousReadingVal = Number(data.meter.initialReading) || 0;
    } else {
      this.previousReadingVal = 0;
    }

    return {
      consumer: this.currentConsumer,
      meter: this.currentMeter,
      cluster: data.cluster,
      previousReading: this.previousReadingVal,
      history: data.readings
    };
  }

  /**
   * Computes usage and validates
   * Formula: Current - Previous = Usage
   */
  computeConsumption(currentVal, isRolloverAllowed = false, customPrev = null) {
    const prev = (customPrev !== null && customPrev !== undefined && !isNaN(customPrev))
      ? Number(customPrev)
      : Number(this.previousReadingVal);
    const curr = Number(currentVal);

    if (isNaN(curr)) {
      return {
        isValid: false,
        consumption: 0,
        errorMessage: 'Please enter a valid meter reading number.'
      };
    }

    // Subtraction formula: Current - Previous
    const usage = curr - prev;

    if (usage < 0 && !isRolloverAllowed) {
      return {
        isValid: false,
        consumption: usage,
        isNegative: true,
        errorMessage: `Current reading (${curr} m³) cannot be less than previous reading (${prev} m³). Negative consumption is not allowed. Please verify the meter digits or enable 'Meter Replacement / Rollover Override'.`
      };
    }

    return {
      isValid: true,
      consumption: usage < 0 ? 0 : usage,
      previousReading: prev,
      currentReading: curr
    };
  }

  /**
   * Checks if consumer was already read for the given period
   */
  async checkDuplicate(consumerId, billingPeriod) {
    const existing = await window.db.findDuplicateReading(consumerId, billingPeriod);
    return existing;
  }

  /**
   * Saves reading and generates bill
   */
  async saveReading(formData) {
    const {
      consumerId,
      meterId,
      billingPeriod,
      previousReading,
      currentReading,
      readerName,
      notes,
      isRolloverOverride,
      photoDataUrl
    } = formData;

    const prev = Number(previousReading);
    const curr = Number(currentReading);
    const consumption = (curr - prev < 0 && isRolloverOverride) ? 0 : (curr - prev);

    // Save Reading record
    const readingId = `r-${consumerId}-${billingPeriod}-${Date.now().toString().slice(-4)}`;
    const readingRecord = {
      id: readingId,
      consumerId,
      meterId: meterId || (this.currentMeter ? this.currentMeter.id : null),
      billingPeriod,
      previousReading: prev,
      currentReading: curr,
      consumption: consumption,
      readingDate: new Date().toISOString(),
      readerName: readerName || 'R. Fernandez',
      notes: notes || '',
      isRolloverOverride: Boolean(isRolloverOverride),
      photoUrl: photoDataUrl || null,
      status: 'Recorded'
    };

    await window.db.put('readings', readingRecord);

    // Automatically generate Bill record linked to this reading
    const consumer = await window.db.get('consumers', consumerId);
    const bill = await window.billingEngine.generateBillRecord(readingRecord, consumer);

    return { reading: readingRecord, bill };
  }

  /**
   * Captures photo and watermarks it with GPS, timestamp, and meter #
   */
  async watermarkPhoto(imageSource, metadata) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        const maxDim = 1200;
        let w = img.width;
        let h = img.height;

        if (w > maxDim || h > maxDim) {
          if (w > h) {
            h = Math.round((h * maxDim) / w);
            w = maxDim;
          } else {
            w = Math.round((w * maxDim) / h);
            h = maxDim;
          }
        }

        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, w, h);

        // Watermark overlay bar
        const barHeight = Math.max(50, Math.round(h * 0.12));
        ctx.fillStyle = 'rgba(15, 23, 42, 0.75)';
        ctx.fillRect(0, h - barHeight, w, barHeight);

        // Watermark text
        ctx.fillStyle = '#FFFFFF';
        ctx.font = `600 ${Math.max(14, Math.round(barHeight * 0.28))}px -apple-system, sans-serif`;
        ctx.textAlign = 'left';
        ctx.textBaseline = 'top';

        const line1 = `Dicklum Water Assn | Meter: ${metadata.meterNo || 'N/A'} | Reading: ${metadata.reading || 0} m³`;
        const line2 = `${metadata.consumerName || 'Consumer'} | ${metadata.timestamp || new Date().toLocaleString()}`;
        const line3 = `GPS: ${metadata.gps || 'Dicklum, Manolo Fortich'}`;

        const pad = 12;
        ctx.fillText(line1, pad, h - barHeight + 6);
        ctx.fillText(line2, pad, h - barHeight + Math.round(barHeight * 0.35));
        ctx.font = `400 ${Math.max(12, Math.round(barHeight * 0.22))}px -apple-system, sans-serif`;
        ctx.fillStyle = '#6EE7B7';
        ctx.fillText(line3, pad, h - barHeight + Math.round(barHeight * 0.68));

        resolve(canvas.toDataURL('image/jpeg', 0.85));
      };
      img.onerror = reject;
      img.src = imageSource;
    });
  }
}

if (typeof window !== 'undefined') {
  window.readingModule = new ReadingModule();
}
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { ReadingModule };
}
