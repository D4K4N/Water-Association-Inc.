/**
 * Phase 4 & Phase 6: Live AI Reading Stability State Machine & Billing Validator
 * - Implements the 9 explicit scanner states.
 * - Requires consecutive matching full-string readings (never averages different strings).
 * - Flags half-rolled/uncertain digits, negative/rollover readings, and high consumption spikes.
 */
(function (global) {
  'use strict';

  const SCANNER_STATES = {
    SEARCHING: 'SEARCHING FOR METER',
    DETECTING: 'DETECTING NUMBER WINDOW',
    ALIGNING: 'ALIGNING',
    TRACKING: 'TRACKING',
    READING: 'READING DIGITS',
    VERIFYING: 'VERIFYING READING',
    STABLE: 'READING STABLE',
    UNREADABLE: 'UNREADABLE',
    LOST: 'TRACKING LOST'
  };

  class ReadingValidator {
    constructor(requiredMatches = 2) {
      this.requiredMatches = requiredMatches;
      this.state = SCANNER_STATES.SEARCHING;
      this.frameHistory = [];
      this.lastConfirmed = null;
    }

    reset() {
      this.state = SCANNER_STATES.SEARCHING;
      this.frameHistory = [];
      this.lastConfirmed = null;
    }

    setState(nextState) {
      this.state = nextState;
      return this.state;
    }

    /**
     * Evaluates a recognition result across consecutive frames.
     * NEVER averages different digit strings; requires exact consecutive matches.
     */
    evaluateFrame(recognitionResult, previousReading = 0, immediate = false) {
      if (!recognitionResult) {
        this.state = SCANNER_STATES.READING;
        return { stable: false, state: this.state };
      }

      if (recognitionResult.status === 'UNREADABLE') {
        this.state = SCANNER_STATES.UNREADABLE;
        this.frameHistory = [];
        return { stable: false, state: this.state, reason: 'Meter glass obstructed or unreadable' };
      }

      if (recognitionResult.status === 'HALF_ROLLED' || recognitionResult.status === 'UNCERTAIN') {
        this.state = SCANNER_STATES.VERIFYING;
        return {
          stable: false,
          state: this.state,
          uncertain: true,
          halfRolled: recognitionResult.status === 'HALF_ROLLED',
          reading: recognitionResult.reading,
          confidence: recognitionResult.overallConfidence
        };
      }

      const str = recognitionResult.reading;
      if (immediate) {
        this.frameHistory = [str, str];
      } else {
        this.frameHistory.push(str);
        if (this.frameHistory.length > 5) this.frameHistory.shift();
      }

      // Count exact consecutive matches at the tail (no string averaging!)
      let matchStreak = 0;
      for (let i = this.frameHistory.length - 1; i >= 0; i--) {
        if (this.frameHistory[i] === str) matchStreak++;
        else break;
      }

      if (matchStreak < this.requiredMatches) {
        this.state = SCANNER_STATES.VERIFYING;
        return {
          stable: false,
          state: this.state,
          matchStreak,
          reading: str,
          confidence: recognitionResult.overallConfidence
        };
      }

      const numericValue = Number(str) || 0;
      const prev = Number(previousReading) || 0;
      const diff = numericValue - prev;
      const warnings = [];
      if (diff < 0) warnings.push('LOWER_THAN_PREVIOUS_OR_ROLLOVER');
      if (diff > 100) warnings.push('UNUSUALLY_HIGH_CONSUMPTION');

      this.state = SCANNER_STATES.STABLE;
      this.lastConfirmed = {
        reading: str,
        numericValue,
        digits: recognitionResult.digits,
        confidence: recognitionResult.overallConfidence,
        profileId: recognitionResult.profileId,
        previousReading: prev,
        consumption: Math.max(0, diff),
        warnings,
        status: 'CONFIRMED',
        confirmedAt: new Date().toISOString()
      };

      return {
        stable: true,
        state: this.state,
        bannerText: 'READING STABLE — READY TO CONFIRM',
        ...this.lastConfirmed
      };
    }
  }

  const exported = { SCANNER_STATES, ReadingValidator };
  if (typeof window !== 'undefined') window.DicklumReadingValidator = exported;
  if (typeof module !== 'undefined' && module.exports) module.exports = exported;
})(typeof window !== 'undefined' ? window : globalThis);
