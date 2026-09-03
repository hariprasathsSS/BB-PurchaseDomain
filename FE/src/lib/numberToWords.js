/* Indian numbering (lakh/crore) amount-in-words — same convention the
   client's own printed vouchers use ("One Lakh Ninety Three Thousand..."). */

const ONES = [
  "", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine",
  "Ten", "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen",
  "Seventeen", "Eighteen", "Nineteen",
];
const TENS = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];

function threeDigits(n) {
  let s = "";
  if (n >= 100) {
    s += `${ONES[Math.floor(n / 100)]} Hundred`;
    n %= 100;
    if (n > 0) s += " And ";
  }
  if (n >= 20) {
    s += `${TENS[Math.floor(n / 10)]} `;
    n %= 10;
  }
  if (n > 0) s += `${ONES[n]} `;
  return s.trim();
}

function numberToWordsIndian(value) {
  let n = Math.floor(value);
  if (n === 0) return "Zero";
  const parts = [];
  const crore = Math.floor(n / 10000000); n %= 10000000;
  const lakh = Math.floor(n / 100000); n %= 100000;
  const thousand = Math.floor(n / 1000); n %= 1000;
  if (crore) parts.push(`${threeDigits(crore)} Crore`);
  if (lakh) parts.push(`${threeDigits(lakh)} Lakh`);
  if (thousand) parts.push(`${threeDigits(thousand)} Thousand`);
  if (n) parts.push(threeDigits(n));
  return parts.join(" ");
}

export function amountInWords(amount) {
  if (amount == null || Number.isNaN(Number(amount))) return "";
  const rupees = Math.floor(Number(amount));
  const paise = Math.round((Number(amount) - rupees) * 100);
  let s = `${numberToWordsIndian(rupees)} ${rupees === 1 ? "Rupee" : "Rupees"}`;
  if (paise > 0) s += ` And ${numberToWordsIndian(paise)} ${paise === 1 ? "Paisa" : "Paise"}`;
  return `${s} Only`;
}
