// The Moon's elongation from the Sun - its phase angle, 0 at new moon, 90 at
// first quarter, 180 at full, 270 at last quarter - from the low-precision
// solar and lunar longitude series in Meeus, "Astronomical Algorithms"
// (the leading terms of chapters 25 and 47). Good to about half a degree,
// which puts the new moon instant within roughly an hour: plenty for picking
// which limb of a small icon is lit.

const toRadians = (degrees) => (degrees * Math.PI) / 180;
const normalize = (degrees) => ((degrees % 360) + 360) % 360;

export function moonElongation(timestamp) {
  const d = timestamp / 86400000 + 2440587.5 - 2451545.0; // days since J2000.0

  const sunMeanLongitude = 280.46 + 0.9856474 * d;
  const sunMeanAnomaly = toRadians(357.529 + 0.98560028 * d);
  const sunLongitude =
    sunMeanLongitude + 1.915 * Math.sin(sunMeanAnomaly) + 0.02 * Math.sin(2 * sunMeanAnomaly);

  const moonMeanLongitude = 218.316 + 13.176396 * d;
  const moonMeanAnomaly = toRadians(134.963 + 13.064993 * d);
  const meanElongation = toRadians(297.85 + 12.190749 * d);
  const argumentOfLatitude = toRadians(93.272 + 13.22935 * d);
  const moonLongitude =
    moonMeanLongitude +
    6.289 * Math.sin(moonMeanAnomaly) +
    1.274 * Math.sin(2 * meanElongation - moonMeanAnomaly) +
    0.658 * Math.sin(2 * meanElongation) +
    0.214 * Math.sin(2 * moonMeanAnomaly) -
    0.186 * Math.sin(sunMeanAnomaly) -
    0.114 * Math.sin(2 * argumentOfLatitude);

  return normalize(moonLongitude - sunLongitude);
}

// Fraction of the disc that's lit, 0 (new) to 1 (full).
export function moonIllumination(elongation) {
  return (1 - Math.cos(toRadians(elongation))) / 2;
}
