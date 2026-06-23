export const CURRENCIES = [
  { code: 'USD', name: 'US Dollar',      symbol: '$',   isBase: true  },
  { code: 'UYU', name: 'Uruguayan Peso', symbol: '$U',  isBase: false },
  { code: 'EUR', name: 'Euro',           symbol: '€',   isBase: false },
  { code: 'ARS', name: 'Argentine Peso', symbol: 'AR$', isBase: false },
]

export const BASE_CURRENCY = 'USD'

export function getCurrencySymbol(code) {
  return CURRENCIES.find((c) => c.code === code)?.symbol ?? (code ?? '$')
}

// Format a monetary amount with the currency symbol prefix.
export function fmtMoney(amount, currencyCode = 'USD') {
  const sym = getCurrencySymbol(currencyCode)
  const n = Number(amount || 0)
  return `${sym}${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}
