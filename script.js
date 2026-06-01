// ==========================================
// WORLD CURRENCIES — ISO 4217
// Sorted alphabetically by currency code
// ==========================================
const WORLD_CURRENCIES = [
  ["AED", "AED – UAE Dirham"],
  ["AFN", "AFN – Afghan Afghani"],
  ["ALL", "ALL – Albanian Lek"],
  ["AMD", "AMD – Armenian Dram"],
  ["ANG", "ANG – Netherlands Antillean Guilder"],
  ["AOA", "AOA – Angolan Kwanza"],
  ["ARS", "ARS – Argentine Peso"],
  ["AUD", "AUD – Australian Dollar"],
  ["AWG", "AWG – Aruban Florin"],
  ["AZN", "AZN – Azerbaijani Manat"],
  ["BAM", "BAM – Bosnia-Herzegovina Mark"],
  ["BBD", "BBD – Barbadian Dollar"],
  ["BDT", "BDT – Bangladeshi Taka"],
  ["BGN", "BGN – Bulgarian Lev"],
  ["BHD", "BHD – Bahraini Dinar"],
  ["BIF", "BIF – Burundian Franc"],
  ["BMD", "BMD – Bermudan Dollar"],
  ["BND", "BND – Brunei Dollar"],
  ["BOB", "BOB – Bolivian Boliviano"],
  ["BRL", "BRL – Brazilian Real"],
  ["BSD", "BSD – Bahamian Dollar"],
  ["BTN", "BTN – Bhutanese Ngultrum"],
  ["BWP", "BWP – Botswanan Pula"],
  ["BYN", "BYN – Belarusian Ruble"],
  ["BZD", "BZD – Belize Dollar"],
  ["CAD", "CAD – Canadian Dollar"],
  ["CDF", "CDF – Congolese Franc"],
  ["CHF", "CHF – Swiss Franc"],
  ["CLP", "CLP – Chilean Peso"],
  ["CNY", "CNY – Chinese Yuan"],
  ["COP", "COP – Colombian Peso"],
  ["CRC", "CRC – Costa Rican Colón"],
  ["CUP", "CUP – Cuban Peso"],
  ["CVE", "CVE – Cape Verdean Escudo"],
  ["CZK", "CZK – Czech Koruna"],
  ["DJF", "DJF – Djiboutian Franc"],
  ["DKK", "DKK – Danish Krone"],
  ["DOP", "DOP – Dominican Peso"],
  ["DZD", "DZD – Algerian Dinar"],
  ["EGP", "EGP – Egyptian Pound"],
  ["ERN", "ERN – Eritrean Nakfa"],
  ["ETB", "ETB – Ethiopian Birr"],
  ["EUR", "EUR – Euro"],
  ["FJD", "FJD – Fijian Dollar"],
  ["FKP", "FKP – Falkland Islands Pound"],
  ["GBP", "GBP – British Pound"],
  ["GEL", "GEL – Georgian Lari"],
  ["GHS", "GHS – Ghanaian Cedi"],
  ["GIP", "GIP – Gibraltar Pound"],
  ["GMD", "GMD – Gambian Dalasi"],
  ["GNF", "GNF – Guinean Franc"],
  ["GTQ", "GTQ – Guatemalan Quetzal"],
  ["GYD", "GYD – Guyanaese Dollar"],
  ["HKD", "HKD – Hong Kong Dollar"],
  ["HNL", "HNL – Honduran Lempira"],
  ["HTG", "HTG – Haitian Gourde"],
  ["HUF", "HUF – Hungarian Forint"],
  ["IDR", "IDR – Indonesian Rupiah"],
  ["ILS", "ILS – Israeli New Shekel"],
  ["INR", "INR – Indian Rupee"],
  ["IQD", "IQD – Iraqi Dinar"],
  ["IRR", "IRR – Iranian Rial"],
  ["ISK", "ISK – Icelandic Króna"],
  ["JMD", "JMD – Jamaican Dollar"],
  ["JOD", "JOD – Jordanian Dinar"],
  ["JPY", "JPY – Japanese Yen"],
  ["KES", "KES – Kenyan Shilling"],
  ["KGS", "KGS – Kyrgystani Som"],
  ["KHR", "KHR – Cambodian Riel"],
  ["KMF", "KMF – Comorian Franc"],
  ["KPW", "KPW – North Korean Won"],
  ["KRW", "KRW – South Korean Won"],
  ["KWD", "KWD – Kuwaiti Dinar"],
  ["KYD", "KYD – Cayman Islands Dollar"],
  ["KZT", "KZT – Kazakhstani Tenge"],
  ["LAK", "LAK – Laotian Kip"],
  ["LBP", "LBP – Lebanese Pound"],
  ["LKR", "LKR – Sri Lankan Rupee"],
  ["LRD", "LRD – Liberian Dollar"],
  ["LSL", "LSL – Lesotho Loti"],
  ["LYD", "LYD – Libyan Dinar"],
  ["MAD", "MAD – Moroccan Dirham"],
  ["MDL", "MDL – Moldovan Leu"],
  ["MGA", "MGA – Malagasy Ariary"],
  ["MKD", "MKD – Macedonian Denar"],
  ["MMK", "MMK – Myanmar Kyat"],
  ["MNT", "MNT – Mongolian Tögrög"],
  ["MOP", "MOP – Macanese Pataca"],
  ["MRU", "MRU – Mauritanian Ouguiya"],
  ["MUR", "MUR – Mauritian Rupee"],
  ["MVR", "MVR – Maldivian Rufiyaa"],
  ["MWK", "MWK – Malawian Kwacha"],
  ["MXN", "MXN – Mexican Peso"],
  ["MYR", "MYR – Malaysian Ringgit"],
  ["MZN", "MZN – Mozambican Metical"],
  ["NAD", "NAD – Namibian Dollar"],
  ["NGN", "NGN – Nigerian Naira"],
  ["NIO", "NIO – Nicaraguan Córdoba"],
  ["NOK", "NOK – Norwegian Krone"],
  ["NPR", "NPR – Nepalese Rupee"],
  ["NZD", "NZD – New Zealand Dollar"],
  ["OMR", "OMR – Omani Rial"],
  ["PAB", "PAB – Panamanian Balboa"],
  ["PEN", "PEN – Peruvian Sol"],
  ["PGK", "PGK – Papua New Guinean Kina"],
  ["PHP", "PHP – Philippine Peso"],
  ["PKR", "PKR – Pakistani Rupee"],
  ["PLN", "PLN – Polish Złoty"],
  ["PYG", "PYG – Paraguayan Guaraní"],
  ["QAR", "QAR – Qatari Rial"],
  ["RON", "RON – Romanian Leu"],
  ["RSD", "RSD – Serbian Dinar"],
  ["RUB", "RUB – Russian Ruble"],
  ["RWF", "RWF – Rwandan Franc"],
  ["SAR", "SAR – Saudi Riyal"],
  ["SBD", "SBD – Solomon Islands Dollar"],
  ["SCR", "SCR – Seychellois Rupee"],
  ["SDG", "SDG – Sudanese Pound"],
  ["SEK", "SEK – Swedish Krona"],
  ["SGD", "SGD – Singapore Dollar"],
  ["SHP", "SHP – Saint Helena Pound"],
  ["SLE", "SLE – Sierra Leonean Leone"],
  ["SOS", "SOS – Somali Shilling"],
  ["SRD", "SRD – Surinamese Dollar"],
  ["STN", "STN – São Tomé & Príncipe Dobra"],
  ["SVC", "SVC – Salvadoran Colón"],
  ["SYP", "SYP – Syrian Pound"],
  ["SZL", "SZL – Swazi Lilangeni"],
  ["THB", "THB – Thai Baht"],
  ["TJS", "TJS – Tajikistani Somoni"],
  ["TMT", "TMT – Turkmenistani Manat"],
  ["TND", "TND – Tunisian Dinar"],
  ["TOP", "TOP – Tongan Paʻanga"],
  ["TRY", "TRY – Turkish Lira"],
  ["TTD", "TTD – Trinidad & Tobago Dollar"],
  ["TWD", "TWD – New Taiwan Dollar"],
  ["TZS", "TZS – Tanzanian Shilling"],
  ["UAH", "UAH – Ukrainian Hryvnia"],
  ["UGX", "UGX – Ugandan Shilling"],
  ["USD", "USD – US Dollar"],
  ["UYU", "UYU – Uruguayan Peso"],
  ["UZS", "UZS – Uzbekistani Som"],
  ["VES", "VES – Venezuelan Bolívar"],
  ["VND", "VND – Vietnamese Đồng"],
  ["VUV", "VUV – Vanuatu Vatu"],
  ["WST", "WST – Samoan Tālā"],
  ["XAF", "XAF – Central African CFA Franc"],
  ["XCD", "XCD – East Caribbean Dollar"],
  ["XOF", "XOF – West African CFA Franc"],
  ["XPF", "XPF – CFP Franc"],
  ["YER", "YER – Yemeni Rial"],
  ["ZAR", "ZAR – South African Rand"],
  ["ZMW", "ZMW – Zambian Kwacha"],
  ["ZWL", "ZWL – Zimbabwean Dollar"],
];

// Populate currency selects with full world currency list
(function populateCurrencySelects() {
  const fromSel = document.getElementById("fromCurrency");
  const toSel   = document.getElementById("toCurrency");
  if (!fromSel || !toSel) return;

  // Build the options HTML once, then reuse it for both selects
  const optionsHTML = WORLD_CURRENCIES.map(([code, label]) =>
    `<option value="${code}">${label}</option>`
  ).join("");

  fromSel.innerHTML = optionsHTML;
  toSel.innerHTML   = optionsHTML;

  // Set sensible defaults: USD → EUR
  fromSel.value = "USD";
  toSel.value   = "EUR";
})();

// ==========================================
// SECTION 1: TRADE TYPE CHANGE HANDLER
// Description: Handles the change event on the trade type selector.
//              Shows/hides relevant options based on selected trade type (crypto or forex).
//              For forex, displays quantity input; for crypto, hides it and shows crypto options.
// ==========================================
document.getElementById("tradeType").addEventListener("change", function () {
  const forexOptions  = document.getElementById("forexOptions");
  const cryptoOptions = document.getElementById("cryptoOptions");
  const capitalLabel  = document.getElementById("capitalLabel");
  const capitalInput  = document.getElementById("capital");

  if (this.value === "forex") {
    forexOptions.style.display  = "block";
    cryptoOptions.style.display = "none";
    capitalLabel.textContent    = "Margin (optional — auto-calculated if blank):";
    capitalInput.required       = false;
  } else {
    forexOptions.style.display  = "none";
    cryptoOptions.style.display = "block";
    capitalLabel.textContent    = "Margin (Capital):";
    capitalInput.required       = true;
  }
});

// Crypto long/short toggle
const posBtns = document.querySelectorAll("#positionToggles .pos-btn");
const positionTypeInput = document.getElementById("positionType");

if (posBtns.length > 0 && positionTypeInput) {
  posBtns.forEach((btn) => {
    btn.addEventListener("click", () => {
      posBtns.forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      positionTypeInput.value = btn.dataset.pos;
    });
  });
}

// Forex BUY/SELL toggle
const fxPosBtns      = document.querySelectorAll("#forexPositionToggles .pos-btn");
const fxDirectionInput = document.getElementById("forexDirection");

if (fxPosBtns.length > 0 && fxDirectionInput) {
  fxPosBtns.forEach((btn) => {
    btn.addEventListener("click", () => {
      fxPosBtns.forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      fxDirectionInput.value = btn.dataset.fpos;
    });
  });
}

// ==========================================
// SECTION 2: CURRENCY CONVERTER FUNCTIONALITY
// Description: Handles the currency converter button click, fetches real-time exchange rates,
//              displays conversion results, and updates the exchange rate field.
//              Also clears converter results when currencies change.
// ==========================================

// Event listener for convert button
document
  .getElementById("convertBtn")
  .addEventListener("click", async function () {
    const fromCurrency = document.getElementById("fromCurrency").value;
    const toCurrency = document.getElementById("toCurrency").value;
    const amount = parseFloat(document.getElementById("convertAmount").value);
    const resultDiv = document.getElementById("converterResult");

    if (!amount || amount <= 0) {
      resultDiv.textContent = "Please enter a valid amount";
      resultDiv.style.color = "#ff1744";
      return;
    }

    try {
      const response = await fetch(
        `https://api.exchangerate-api.com/v4/latest/${fromCurrency}`,
      );
      if (!response.ok) {
        throw new Error("Failed to fetch exchange rate");
      }
      const data = await response.json();
      const rate = data.rates[toCurrency];
      const convertedAmount = (amount * rate).toFixed(2);

      resultDiv.textContent = `${amount} ${fromCurrency} = ${convertedAmount} ${toCurrency}`;
      resultDiv.style.color = "#00c853";
      document.getElementById("exchangeRate").value = rate.toFixed(6);
    } catch (error) {
      resultDiv.textContent =
        "Error fetching exchange rate. Using offline conversion.";
      resultDiv.style.color = "#ff9800";
    }
  });

// Event listeners to clear converter results when currencies change
document.getElementById("fromCurrency").addEventListener("change", function () {
  document.getElementById("converterResult").textContent = "";
});

document.getElementById("toCurrency").addEventListener("change", function () {
  document.getElementById("converterResult").textContent = "";
});

// ==========================================
// SECTION 3: PNL FORM SUBMISSION HANDLER
// Description: Handles the form submission for PnL calculation.
//              Calculates quantity, PnL, and ROI based on trade type (crypto or forex).
//              Displays results with appropriate styling.
// ==========================================
function calcCrypto(entryPrice, exitPrice, resultDiv) {
  var cCapital      = parseFloat(document.getElementById("capital").value);
  var cPositionType = document.getElementById("positionType").value;
  var cLeverage     = parseFloat(document.getElementById("leverage").value);

  if (!cCapital || cCapital <= 0) {
    resultDiv.innerHTML = '<p style="color:#F6465D;text-align:center;padding:12px">Please enter a valid Margin amount.</p>';
    return;
  }

  var cQuantity = (cCapital * cLeverage) / entryPrice;
  var cPnl      = cPositionType === "long"
    ? (exitPrice - entryPrice) * cQuantity
    : (entryPrice - exitPrice) * cQuantity;
  var cRoi  = (cPnl / cCapital) * 100;
  var cCls  = cPnl >= 0 ? "text-green" : "text-red";
  var cSign = cPnl > 0 ? "+" : "";

  resultDiv.innerHTML =
    '<div class="binance-result">' +
      '<div class="binance-result-row">' +
        '<span class="binance-result-label">Initial Margin</span>' +
        '<span class="binance-result-value">' + cCapital.toFixed(2) + ' USDT</span>' +
      '</div>' +
      '<div class="binance-result-row">' +
        '<span class="binance-result-label">Quantity</span>' +
        '<span class="binance-result-value">' + cQuantity.toFixed(4) + '</span>' +
      '</div>' +
      '<div class="binance-result-row">' +
        '<span class="binance-result-label">PNL</span>' +
        '<span class="binance-result-value ' + cCls + '">' + cSign + cPnl.toFixed(2) + ' USDT</span>' +
      '</div>' +
      '<div class="binance-result-row">' +
        '<span class="binance-result-label">ROE</span>' +
        '<span class="binance-result-value ' + cCls + '">' + cSign + cRoi.toFixed(2) + '%</span>' +
      '</div>' +
    '</div>';
  resultDiv.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

// ── Forex CFD calculation ──────────────────────────────────────────────────────
// PnL    = dirSign × (Exit − Entry) × Volume × ContractSize ÷ ExchangeRate
// Margin = (Volume × ContractSize × Entry) ÷ Leverage ÷ ExchangeRate
function calcForexCFD(entryPrice, exitPrice, resultDiv) {
  var fxDir      = document.getElementById("forexDirection").value;
  var fxVol      = parseFloat(document.getElementById("fxVolume").value)       || 1;
  var fxCS       = parseFloat(document.getElementById("contractSize").value)   || 100000;
  var fxLev      = parseFloat(document.getElementById("fxLeverage").value)     || 500;
  var fxRate     = parseFloat(document.getElementById("exchangeRate").value)   || 1;
  var fxCapRaw   = parseFloat(document.getElementById("capital").value);

  var fxDirSign  = fxDir === "buy" ? 1 : -1;
  var fxNotional = fxVol * fxCS;
  var fxPnl      = fxDirSign * (exitPrice - entryPrice) * fxNotional / fxRate;

  // Use entered margin if provided, otherwise auto-calculate from leverage
  var fxMargin   = (!isNaN(fxCapRaw) && fxCapRaw > 0)
    ? fxCapRaw
    : (fxNotional * entryPrice) / fxLev / fxRate;

  var fxRoe      = fxMargin > 0 ? (fxPnl / fxMargin) * 100 : 0;
  var fxCls      = fxPnl >= 0 ? "text-green" : "text-red";
  var fxPre      = fxPnl > 0 ? "+" : "";
  var fxDirLbl   = fxDir === "buy" ? "BUY" : "SELL";
  var fxDirCls   = fxDir === "buy" ? "text-green" : "text-red";
  var fxSizeFmt  = fxNotional.toLocaleString("en-US", { maximumFractionDigits: 0 });

  resultDiv.innerHTML =
    '<div class="binance-result">' +
      '<div class="binance-result-row">' +
        '<span class="binance-result-label">Direction</span>' +
        '<span class="binance-result-value ' + fxDirCls + '">' + fxDirLbl + '</span>' +
      '</div>' +
      '<div class="binance-result-row">' +
        '<span class="binance-result-label">Volume</span>' +
        '<span class="binance-result-value">' + fxVol.toFixed(2) + ' lot' + (fxVol === 1 ? '' : 's') + '</span>' +
      '</div>' +
      '<div class="binance-result-row">' +
        '<span class="binance-result-label">Position Size</span>' +
        '<span class="binance-result-value">' + fxSizeFmt + '</span>' +
      '</div>' +
      '<div class="binance-result-row">' +
        '<span class="binance-result-label">Required Margin</span>' +
        '<span class="binance-result-value">$' + fxMargin.toFixed(2) + '</span>' +
      '</div>' +
      '<div class="binance-result-row">' +
        '<span class="binance-result-label">PNL</span>' +
        '<span class="binance-result-value ' + fxCls + '">' + fxPre + fxPnl.toFixed(2) + ' USD</span>' +
      '</div>' +
      '<div class="binance-result-row">' +
        '<span class="binance-result-label">ROE</span>' +
        '<span class="binance-result-value ' + fxCls + '">' + fxPre + fxRoe.toFixed(2) + '%</span>' +
      '</div>' +
    '</div>';
  resultDiv.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

document.getElementById("pnlForm").addEventListener("submit", function (e) {
  e.preventDefault();
  var tradeType  = document.getElementById("tradeType").value;
  var entryPrice = parseFloat(document.getElementById("entryPrice").value);
  var exitPrice  = parseFloat(document.getElementById("exitPrice").value);
  var resultDiv  = document.getElementById("result");

  if (isNaN(entryPrice) || isNaN(exitPrice)) {
    resultDiv.innerHTML = '<p style="color:#F6465D;text-align:center;padding:12px">Please enter valid Entry and Exit prices.</p>';
    return;
  }

  try {
    if (tradeType === "crypto") {
      calcCrypto(entryPrice, exitPrice, resultDiv);
    } else {
      calcForexCFD(entryPrice, exitPrice, resultDiv);
    }
  } catch (err) {
    resultDiv.innerHTML = '<p style="color:#F6465D;text-align:center;padding:12px">Calculation error: ' + err.message + '</p>';
  }
});
