// ==========================================
// SECTION 1: TRADE TYPE CHANGE HANDLER
// Description: Handles the change event on the trade type selector.
//              Shows/hides relevant options based on selected trade type (crypto or forex).
//              For forex, displays quantity input; for crypto, hides it and shows crypto options.
// ==========================================
document.getElementById("tradeType").addEventListener("change", function () {
  const forexOptions = document.getElementById("forexOptions");
  const cryptoOptions = document.getElementById("cryptoOptions");
  const quantityLabel = document.getElementById("quantityLabel");
  const quantityInput = document.getElementById("quantity");

  if (this.value === "forex") {
    forexOptions.style.display = "block";
    cryptoOptions.style.display = "none";
    quantityLabel.style.display = "block";
    quantityInput.style.display = "block";
    quantityInput.required = true;
  } else {
    forexOptions.style.display = "none";
    cryptoOptions.style.display = "block";
    quantityLabel.style.display = "none";
    quantityInput.style.display = "none";
    quantityInput.required = false;
  }
});

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
document.getElementById("pnlForm").addEventListener("submit", function (e) {
  e.preventDefault();
  const tradeType = document.getElementById("tradeType").value;
  const entryPrice = parseFloat(document.getElementById("entryPrice").value);
  const exitPrice = parseFloat(document.getElementById("exitPrice").value);
  const capital = parseFloat(document.getElementById("capital").value);
  let quantity = 0;
  let pnl = 0;

  if (tradeType === "crypto") {
    const positionType = document.getElementById("positionType").value;
    const leverage = parseFloat(document.getElementById("leverage").value);

    quantity = (capital * leverage) / entryPrice;

    if (positionType === "long") {
      pnl = (exitPrice - entryPrice) * quantity;
    } else {
      pnl = (entryPrice - exitPrice) * quantity;
    }
  } else {
    quantity = parseFloat(document.getElementById("quantity").value);
    const lotSize = parseFloat(document.getElementById("lotSize").value);
    const contractSize = parseFloat(
      document.getElementById("contractSize").value,
    );
    const exchangeRate = parseFloat(
      document.getElementById("exchangeRate").value,
    );
    pnl =
      ((exitPrice - entryPrice) * quantity * lotSize * contractSize) /
      exchangeRate;
  }

  const roi = capital > 0 ? (pnl / capital) * 100 : 0;
  let resultDiv = document.getElementById("result");
  resultDiv.className = pnl >= 0 ? "positive" : "negative";
  resultDiv.innerHTML = `<div class="result-container"><p>Quantity: ${quantity.toFixed(4)}</p><p>PnL: ${pnl.toFixed(2)}</p><p>ROI: ${roi.toFixed(2)}%</p></div>`;
});
