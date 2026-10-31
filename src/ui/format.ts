export function formatPopulation(n: number): string {
  if (n >= 1e9) return `${(n / 1e9).toFixed(2)} B`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)} M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(0)} K`;
  return n < 1 ? '0' : n.toFixed(0);
}

export function formatUSD(n: number): string {
  if (n >= 1e12) return `$${(n / 1e12).toFixed(1)} T`;
  if (n >= 1e9) return `$${(n / 1e9).toFixed(1)} B`;
  if (n >= 1e6) return `$${(n / 1e6).toFixed(0)} M`;
  return n < 1 ? '$0' : `$${Math.round(n).toLocaleString('en-US')}`;
}

export function formatTempAnomaly(c: number): string {
  if (Math.abs(c) < 0.05) return '±0.0 °C';
  return `${c > 0 ? '+' : '−'}${Math.abs(c).toFixed(1)} °C`;
}

/** "Year 2, day 45" style calendar from elapsed sim days. */
export function formatSimDate(days: number): string {
  const d = Math.floor(days);
  const year = Math.floor(d / 365) + 1;
  return `Year ${year}, day ${(d % 365) + 1}`;
}

/** Formats a parameter value by its unit; meters switch to km past 1000. */
export function formatParam(value: number, unit = ''): string {
  if (unit === 'm') {
    return value >= 1000
      ? `${(value / 1000).toFixed(value >= 10000 ? 0 : 1)} km`
      : `${Math.round(value)} m`;
  }
  if (unit === '°') return `${Math.round(value)}°`;
  return `${value < 10 ? value.toFixed(1) : Math.round(value)} ${unit}`.trim();
}

export function formatLatLon(lat: number, lon: number): string {
  const ns = lat >= 0 ? 'N' : 'S';
  const ew = lon >= 0 ? 'E' : 'W';
  return `${Math.abs(lat).toFixed(1)}°${ns} ${Math.abs(lon).toFixed(1)}°${ew}`;
}

export function formatElevation(m: number): string {
  return m < 0
    ? `${Math.round(-m).toLocaleString()} m deep`
    : `${Math.round(m).toLocaleString()} m`;
}
