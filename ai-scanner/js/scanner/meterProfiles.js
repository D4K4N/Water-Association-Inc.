/**
 * Dicklum Water Association, Inc. — Mechanical Water Meter Profiles
 * Configurable profiles supporting diverse meter brands, kL drum counts, polarity, and liter drum styles.
 */
(function (global) {
  'use strict';

  const METER_PROFILES = {
    ITRON_WHITE_ON_BLACK: {
      id: 'ITRON_WHITE_ON_BLACK',
      label: 'Itron TD8 (5 White-on-Black kL + 3 Red L)',
      klDigitCount: 5,
      literDigitCount: 3,
      polarity: 'WHITE_ON_BLACK',
      literStyle: 'SOLID_RED'
    },
    LINFLOW_BLACK_ON_WHITE: {
      id: 'LINFLOW_BLACK_ON_WHITE',
      label: 'Linflow SNI / Standard (4–5 Black-on-White kL + 3 Red L)',
      klDigitCount: 4,
      literDigitCount: 3,
      polarity: 'BLACK_ON_WHITE',
      literStyle: 'RED_OR_SOLID_RED'
    },
    POLARITY_SPLIT_REGISTER: {
      id: 'POLARITY_SPLIT_REGISTER',
      label: 'Polarity-Split (4 Black-on-White kL + 2 White-on-Black L)',
      klDigitCount: 4,
      literDigitCount: 2,
      polarity: 'BLACK_ON_WHITE',
      literStyle: 'WHITE_ON_BLACK'
    },
    MONO_ODOMETER_REGISTER: {
      id: 'MONO_ODOMETER_REGISTER',
      label: 'Monochrome Odometer (5 Black-on-White kL)',
      klDigitCount: 5,
      literDigitCount: 0,
      polarity: 'BLACK_ON_WHITE',
      literStyle: 'NONE'
    }
  };

  function getMeterProfile(typeId) {
    return METER_PROFILES[typeId] || METER_PROFILES.LINFLOW_BLACK_ON_WHITE;
  }

  const exported = { METER_PROFILES, getMeterProfile };
  if (typeof window !== 'undefined') window.DicklumMeterProfiles = exported;
  if (typeof module !== 'undefined' && module.exports) module.exports = exported;
})(typeof window !== 'undefined' ? window : globalThis);
