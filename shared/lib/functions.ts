// Typed wrappers around the existing callable Cloud Functions.
// Backend is unchanged — these just call the same endpoints in europe-west1.
import { httpsCallable } from 'firebase/functions';
import { fns } from './firebase';

export const callGetTokenHolders = httpsCallable(fns, 'getTokenHolders');
export const callGetWalletTokens = httpsCallable(fns, 'getWalletTokens');
export const callGetHolderGraph = httpsCallable(fns, 'getHolderGraph');
export const callGetPairTransfers = httpsCallable(fns, 'getPairTransfers');
export const callGetBalances = httpsCallable(fns, 'getBalances');
export const callGetBotInfo = httpsCallable(fns, 'getBotInfo');
export const callScanArbitrage = httpsCallable(fns, 'scanArbitrage');
export const callScanGems = httpsCallable(fns, 'scanGems', { timeout: 120000 });
export const callGetCexBalances = httpsCallable(fns, 'getCexBalances');

// Bot
export const callExecuteTrade = httpsCallable(fns, 'executeTrade');
export const callSaveBotWallet = httpsCallable(fns, 'saveWallet');
export const callRemoveBotWallet = httpsCallable(fns, 'removeWallet');
export const callGenerateTelegramCode = httpsCallable(fns, 'generateTelegramCode');
export const callGenerateDiscordCode = httpsCallable(fns, 'generateDiscordCode');
export const callChatPointer = httpsCallable(fns, 'chatPointer', { timeout: 120000 });

// Agent
export const callRunAgentScan = httpsCallable(fns, 'runAgentScan', { timeout: 300000 });
export const callSaveAgentSettings = httpsCallable(fns, 'saveAgentSettings');
export const callSaveCexApiKey = httpsCallable(fns, 'saveCexApiKey');
export const callRemoveCexApiKey = httpsCallable(fns, 'removeCexApiKey');
export const callApproveTrade = httpsCallable(fns, 'approveTrade');
export const callSkipSignal = httpsCallable(fns, 'skipSignal');

// Premium billing (crypto-only — Stripe/card checkout was removed from the app)
export const callGetPlans = httpsCallable(fns, 'getPlans');
export const callCreateCryptoInvoice = httpsCallable(fns, 'createCryptoInvoice');
export const callVerifyCryptoPayment = httpsCallable(fns, 'verifyCryptoPayment');
export const callGetPointerUsage = httpsCallable(fns, 'getPointerUsage');
export const callGetSignalStats = httpsCallable(fns, 'getSignalStats');
export const callGetGemStats = httpsCallable(fns, 'getGemStats');
export const callGetReferralInfo = httpsCallable(fns, 'getReferralInfo');
export const callGetCopyFeed = httpsCallable(fns, 'getCopyFeed');
export const callGetCopyLeaderboard = httpsCallable(fns, 'getCopyLeaderboard');
export const callTrackFunnel = httpsCallable(fns, 'trackFunnel');
export const callSavePriceAlert = httpsCallable(fns, 'savePriceAlert');
