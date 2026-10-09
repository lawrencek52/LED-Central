// Sunrise and sunset for a location and calendar date, from the standard
// sunrise equation (solar mean anomaly, equation of centre, solar transit,
// declination, with -0.833 degrees for refraction and the solar disc) - good
// to about a minute at mid latitudes. Computed for the display's own postal
// code location rather than taken from the forecast city's page, which is
// for the city's reference point and can be a minute or so off.

const toRadians = (degrees) => (degrees * Math.PI) / 180;
const toDegrees = (radians) => (radians * 180) / Math.PI;
const julianDayToMs = (julianDay) => (julianDay - 2440587.5) * 86400000;

// `date` is the local calendar date as "YYYY-MM-DD"; lon is east-positive.
// Returns { sunrise, sunset } as epoch ms, or null on a polar day/night.
export function sunTimes(date, latitude, longitude) {
  const noonJulianDay = Date.parse(`${date}T12:00:00Z`) / 86400000 + 2440587.5;
  const dayNumber = Math.round(noonJulianDay - 2451545 + 0.0008);
  const meanSolarTime = dayNumber - longitude / 360;
  const anomaly = (357.5291 + 0.98560028 * meanSolarTime) % 360;
  const centre =
    1.9148 * Math.sin(toRadians(anomaly)) +
    0.02 * Math.sin(toRadians(2 * anomaly)) +
    0.0003 * Math.sin(toRadians(3 * anomaly));
  const eclipticLongitude = (anomaly + centre + 180 + 102.9372) % 360;
  const transit =
    2451545 +
    meanSolarTime +
    0.0053 * Math.sin(toRadians(anomaly)) -
    0.0069 * Math.sin(toRadians(2 * eclipticLongitude));
  const sinDeclination = Math.sin(toRadians(eclipticLongitude)) * Math.sin(toRadians(23.4397));
  const cosDeclination = Math.cos(Math.asin(sinDeclination));
  const cosHourAngle =
    (Math.sin(toRadians(-0.833)) - Math.sin(toRadians(latitude)) * sinDeclination) /
    (Math.cos(toRadians(latitude)) * cosDeclination);
  if (cosHourAngle < -1 || cosHourAngle > 1) return null;
  const hourAngle = toDegrees(Math.acos(cosHourAngle));
  return {
    sunrise: julianDayToMs(transit - hourAngle / 360),
    sunset: julianDayToMs(transit + hourAngle / 360),
  };
}
