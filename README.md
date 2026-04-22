# FXcrypt

A simple web app for calculating Profit and Loss on forex and crypto trades.

## Features

- Support for Crypto and Forex trades
- Simple UI with form inputs
- Responsive design for mobile use

## How to Use

1. Open `index.html` in your web browser.
2. Select the trade type (Crypto or Forex).
3. Enter the entry price, exit price, and quantity.
4. For Forex, enter lot size, contract size, and exchange rate if applicable.
5. Click "Calculate PnL" to see the result.

## For Android Phones

FXcrypt is a web app that can be opened in any mobile browser. For a more app-like experience, you can:

- Save it as a bookmark on your home screen.
- Use a web app wrapper tool like PWA or Cordova to create an APK.

## Calculation Formulas

- **Crypto**: PnL = (Exit Price - Entry Price) \* Quantity
- **Forex**: PnL = (Exit Price - Entry Price) _ Quantity _ Lot Size \* Contract Size / Exchange Rate

Note: This is a basic calculator. For real trading, consult professional advice.
