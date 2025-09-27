import 'dotenv/config';
import { Telegraf, Markup } from 'telegraf';
import crypto from 'crypto';
import { createClient } from 'redis';
import { AsterAPI } from './asterdex.js';
import { BNBWallet } from './bnb-wallet.js';
import { saveUserSession, loadUserSession } from './database.js';
import { startKeepAliveServer } from './web.js';

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY;

if (!BOT_TOKEN) {
  console.error('Missing TELEGRAM_BOT_TOKEN in .env');
  process.exit(1);
}

if (!ENCRYPTION_KEY) {
  console.error('Missing ENCRYPTION_KEY in .env');
  process.exit(1);
}

const bot = new Telegraf(BOT_TOKEN);
// Initialize the API client without any credentials
const asterAPI = new AsterAPI();

// Note: Removed userSessions Map to prevent memory leaks with 1000s of users
// Now using MongoDB directly for all session data

// Redis client for caching and rate limiting
let redisClient = null;

// Initialize Redis client (with fallback if Redis fails)
if (process.env.REDIS_URL) {
  redisClient = createClient({
    url: process.env.REDIS_URL
  });
  
  redisClient.on('error', (err) => {
    console.error('❌ Redis connection error:', err);
    redisClient = null; // Disable Redis on error
  });
  
  redisClient.on('connect', () => {
    console.log('✅ Redis connected successfully');
  });
}

// Redis-based rate limiting (works across multiple instances)
async function checkRateLimit(userId, action, maxRequests, windowMs) {
  if (!redisClient) {
    return true; // Allow if Redis is not available
  }
  
  try {
    const key = `rate_limit:${userId}:${action}`;
    const now = Date.now();
    
    // Use Redis sorted set for sliding window rate limiting
    const pipeline = redisClient.multi();
    
    // Remove old entries (outside the window)
    pipeline.zRemRangeByScore(key, 0, now - windowMs);
    
    // Count current entries
    pipeline.zCard(key);
    
    // Add current request
    pipeline.zAdd(key, { score: now, value: now.toString() });
    
    // Set expiration
    pipeline.expire(key, Math.ceil(windowMs / 1000));
    
    const results = await pipeline.exec();
    const currentCount = results[1][1]; // Get count result
    
    return currentCount < maxRequests;
  } catch (error) {
    console.error('❌ Rate limiting error:', error);
    return true; // Allow if Redis fails
  }
}

// Helper function to get user session with Redis caching
async function getUserSession(userId) {
  try {
    // Try Redis first (if available)
    if (redisClient) {
      const cached = await redisClient.get(`session:${userId}`);
      if (cached) {
        return JSON.parse(cached);
      }
    }
    
    // Fallback to MongoDB
    const session = await loadUserSession(userId);
    
    // Cache in Redis for 1 hour (if Redis is available)
    if (session && redisClient) {
      await redisClient.setEx(`session:${userId}`, 3600, JSON.stringify(session));
    }
    
    return session;
  } catch (error) {
    console.error('❌ Session retrieval error:', error);
    // Always fallback to MongoDB if Redis fails
    return await loadUserSession(userId);
  }
}

// Helper function to save user session with Redis caching
async function saveUserSessionData(userId, sessionData) {
  try {
    // Save to MongoDB first (source of truth)
    await saveUserSession(userId, sessionData);
    
    // Update Redis cache (if available)
    if (redisClient) {
      await redisClient.setEx(`session:${userId}`, 3600, JSON.stringify(sessionData));
    }
  } catch (error) {
    console.error('❌ Session save error:', error);
    throw error; // Re-throw to maintain error handling
  }
}

// Encryption/Decryption functions for sensitive data
function encrypt(text) {
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipher('aes-256-cbc', ENCRYPTION_KEY);
  let encrypted = cipher.update(text, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  return iv.toString('hex') + ':' + encrypted;
}

function decrypt(encryptedText) {
  const textParts = encryptedText.split(':');
  const iv = Buffer.from(textParts.shift(), 'hex');
  const encryptedData = textParts.join(':');
  const decipher = crypto.createDecipher('aes-256-cbc', ENCRYPTION_KEY);
  let decrypted = decipher.update(encryptedData, 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  return decrypted;
}


// Function to show the main menu
async function showMainMenu(ctx) {
  const userId = ctx.from.id;
  const session = await getUserSession(userId);
  
  const menuKeyboard = Markup.inlineKeyboard([
    [
      Markup.button.callback('💰 Balance', 'menu_balance'),
      Markup.button.callback('📊 Positions', 'menu_positions')
    ],
    [
      Markup.button.callback('📈 Long Position', 'menu_long'),
      Markup.button.callback('📉 Short Position', 'menu_short')
    ],
    [
      // --- MODIFIED LINE ---
      Markup.button.callback('💸 Deposit', 'menu_deposit'), 
      Markup.button.callback('🔄 Transfer', 'menu_transfer')
    ],
    [
      Markup.button.callback('📋 Markets', 'menu_markets'),
      Markup.button.callback('❌ Close Position', 'menu_close')
    ],
    [
       Markup.button.callback('🔑 Export Key', 'menu_export')
    ]
  ]);

  const menuMessage = `
🎯 AsterDex Trading Bot - Main Menu

**Wallet:** \`${session?.walletAddress || 'Not initialized'}\`

Choose an action from the menu below or use commands directly:
  `;

  // Use editMessageText if possible, otherwise send a new message
  try {
      if (ctx.updateType === 'callback_query') {
          await ctx.editMessageText(menuMessage, { 
              parse_mode: 'Markdown', 
              ...menuKeyboard 
          });
      } else {
          await ctx.reply(menuMessage, { 
              parse_mode: 'Markdown', 
              ...menuKeyboard 
          });
      }
  } catch (error) {
      // This can fail if the message is identical, so just log it.
      console.log('Info: Could not edit menu message, it might be the same.');
  }
}

// --- THE NEW ONBOARDING FLOW ---
bot.start(async (ctx) => {
  const userId = ctx.from.id;
  
  // Rate limiting: max 5 /start commands per minute
  if (!checkRateLimit(userId, 'start', 5, 60000)) {
    return ctx.reply('⏳ **Rate Limit Exceeded**\nPlease wait a moment before trying again.');
  }

  // 1. Try to load the user from the database
  let session = await loadUserSession(userId);

  if (session) {
    // If user exists, welcome them back
    await ctx.reply(`🎉 Welcome back! Your wallet is: \`${session.walletAddress}\``, { parse_mode: 'Markdown' });
    return showMainMenu(ctx);
  }

  // 2. If user does NOT exist, create a new wallet and session
  try {
      await ctx.reply('👋 Welcome! Creating your secure wallet and API keys...');

      const newWallet = BNBWallet.createWallet();
      const apiKeys = await asterAPI.createApiKeysForWallet(newWallet);

      const newSession = {
          _id: userId, // Use userId as the unique ID for the database
          walletAddress: newWallet.address, // Keep wallet address unencrypted for display
          privateKey: encrypt(newWallet.privateKey), // Encrypt private key
          apiKey: encrypt(apiKeys.apiKey), // Encrypt API key
          apiSecret: encrypt(apiKeys.apiSecret), // Encrypt API secret
          isInitialized: true,
          tradingFlow: null
      };

      // 3. Save the new session to the database
      await saveUserSession(userId, newSession);

      const welcomeMessage = `✅ **Setup Complete!**\nYour unique BEP-20 wallet address is:\n\`${newSession.walletAddress}\`\n\n**IMPORTANT**: Send funds (USDT, BNB etc.) to this address to begin trading.`;
      await ctx.reply(welcomeMessage, { parse_mode: 'Markdown' });

      await showMainMenu(ctx);

  } catch (error) {
      console.error('❌ [DEBUG] Error in /start command for new user:', error);
      await ctx.reply(`❌ Account setup failed: ${error.message}\nPlease try /start again.`);
  }
});

// Cancel command
bot.command('cancel', async (ctx) => {
  const userId = ctx.from.id;
  const session = await getUserSession(userId);

  if (session) {
      session.tradingFlow = null;
      await saveUserSessionData(userId, session);
  }
  await ctx.reply('✅ Action cancelled. You are no longer in a trading flow.');
});

// Help command
bot.help(async (ctx) => {
  // --- MODIFIED TEXT ---
  const helpText = `
📋 Available Commands:
/start - Start the bot & create your wallet
/menu - Show the main menu with buttons
/balance - Check all your balances (Wallet, Spot, Futures)
/deposit [amount] - Alternative to /transfer . Deposit USDT directly from your wallet to Futures account
/transfer [amount] [asset] - Transfer from your Spot to Futures account . You will need to manually deposit USDT to your Spot account.
/export - Export your wallet's private key
/long & /short - Start opening a trade
/positions - View your open positions
/close - Select a position to close
/cancel - Cancel your current action (like an open trade)
  `;
  await ctx.reply(helpText, { parse_mode: 'Markdown' });
});

// Main Menu command
bot.command('menu', async (ctx) => {
  const userId = ctx.from.id;
  const session = await getUserSession(userId);
  
  if (!session?.isInitialized) {
    return ctx.reply('Please use /start first to set up your account.');
  }

  const menuKeyboard = Markup.inlineKeyboard([
    [
      Markup.button.callback('💰 Balance', 'menu_balance'),
      Markup.button.callback('📊 Positions', 'menu_positions')
    ],
    [
      Markup.button.callback('📈 Long Position', 'menu_long'),
      Markup.button.callback('📉 Short Position', 'menu_short')
    ],
    [
      Markup.button.callback('💸 Transfer Funds', 'menu_transfer'),
      Markup.button.callback('🔑 Export Key', 'menu_export')
    ],
    [
      Markup.button.callback('📋 Markets', 'menu_markets'),
      Markup.button.callback('❌ Close Position', 'menu_close')
    ]
  ]);

  const menuMessage = `
🎯 AsterDex Trading Bot - Main Menu

**Wallet:** \`${session.walletAddress}\`

Choose an action from the menu below or use commands directly:
• Type /long or /short to trade
• Type /transfer 25 USDT to transfer funds
• Type /balance to check your balance
• Type /export to export your private key

💡 **Tip:** You can use both buttons and commands!
  `;

  await ctx.reply(menuMessage, { 
    parse_mode: 'Markdown', 
    ...menuKeyboard 
  });
});



// Export private key command
bot.command('export', async (ctx) => {
  const userId = ctx.from.id;
  const session = await getUserSession(userId);

  if (!session?.isInitialized || !session.privateKey) {
    return ctx.reply('Please use /start first to generate a wallet.');
  }

  const warningMessage = `
⚠️ **SECURITY WARNING** ⚠️

You are about to view your wallet's private key.

- **NEVER** share this key with anyone.
- Anyone with this key has **FULL and IRREVERSIBLE CONTROL** over all funds in this wallet.
- We strongly recommend you import this key into a secure, self-custodial wallet (like MetaMask or Trust Wallet) immediately.

Do you understand the risks and wish to proceed?
  `;

  // Create a confirmation keyboard
  const keyboard = Markup.inlineKeyboard([
    Markup.button.callback('✅ Yes, export my key', 'export_confirm_yes'),
    Markup.button.callback('❌ Cancel', 'export_confirm_no')
  ]);

  await ctx.reply(warningMessage, { parse_mode: 'Markdown', ...keyboard });
});


// Shared deposit function
async function handleDepositRequest(ctx, amount) {
  const userId = ctx.from.id;
  
  // Rate limiting: max 3 deposits per minute
  if (!checkRateLimit(userId, 'deposit', 3, 60000)) {
    return ctx.reply('⏳ **Rate Limit Exceeded**\nPlease wait a moment before making another deposit.');
  }
  
  const session = await getUserSession(userId);
  
  if (!session?.isInitialized) {
    return ctx.reply('Please use /start first.');
  }

  const ASTER_TREASURY_ADDRESS = '0x128463A60784c4D3f46c23Af3f65Ed859Ba87974';

  if (isNaN(amount) || amount <= 0) {
    return ctx.reply('Please provide a valid amount in USDT.\nUsage: `/deposit 50`', { parse_mode: 'Markdown' });
  }

  try {
    // Check for sufficient USDT balance first (more important for user)
    const usdtBalance = await BNBWallet.getUsdtBalance(session.walletAddress);
    if (parseFloat(usdtBalance) < amount) {
      return ctx.reply(`⚠️ **Insufficient USDT Balance!**\nYour wallet has ${usdtBalance} USDT, but you're trying to deposit ${amount} USDT.\n\nPlease send USDT to your wallet address first:\n\`${session.walletAddress}\``, { parse_mode: 'Markdown' });
    }
    
    // Check for sufficient BNB for gas fees
    const bnbBalance = await BNBWallet.getWalletBalance(session.walletAddress);
    if (parseFloat(bnbBalance) < 0.001) {
      return ctx.reply('⚠️ **Low Gas Balance!**\nYou need at least ~0.001 BNB in your wallet to pay for transaction fees.\n\nPlease send some BNB to your wallet address for gas fees.', { parse_mode: 'Markdown' });
    }

    await ctx.reply(`Depositing ${amount} USDT directly to the Aster exchange. Please wait for the on-chain transaction to confirm...`);
    
    // Call the new, direct transfer function (decrypt private key first)
    const decryptedPrivateKey = decrypt(session.privateKey);
    const tx = await BNBWallet.sendUsdt(decryptedPrivateKey, ASTER_TREASURY_ADDRESS, amount);
    
    await ctx.reply(`✅ **Deposit Transaction Sent!**\nYour funds should appear in your **Futures Account** in a few minutes.\n\n**Transaction Hash:** \`${tx.hash}\``, { parse_mode: 'Markdown' });

  } catch (error) {
    console.error('❌ [DEBUG] Error in /deposit command:', error);
    const errorMessage = error.code === 'INSUFFICIENT_FUNDS' ? 'Insufficient BNB for gas fees.' : error.message;
    // User-friendly error messages
    let userMessage = '❌ **Deposit Failed** ';
    if (error.code === 'INSUFFICIENT_FUNDS') {
      userMessage += '❌ **Insufficient BNB for Gas Fees**\nYou need at least 0.001 BNB in your wallet to pay for transaction fees.\n\n**To fix this:**\nSend some BNB to your wallet address for gas fees.';
    } else if (error.message.includes('insufficient') && error.message.includes('USDT')) {
      userMessage += '❌ **Insufficient USDT Balance**\nYou don\'t have enough USDT in your wallet to deposit.\n\n**To fix this:**\nSend USDT to your wallet address first:\n`' + session.walletAddress + '`';
    } else if (error.message.includes('insufficient')) {
      userMessage += '❌ **Insufficient Funds**\nPlease check your wallet balance and add more funds.';
    } else if (error.message.includes('network') || error.message.includes('timeout')) {
      userMessage += '❌ **Network Issue**\nConnection problem with the blockchain. Please try again in a few moments.';
    } else if (error.message.includes('revert') || error.message.includes('failed')) {
      userMessage += '❌ **Transaction Failed**\nThe blockchain transaction was rejected. Please check your balance and try again.';
    } else {
      userMessage += '❌ **Deposit Error**\nSomething went wrong. Please try again or contact support.';
    }
    await ctx.reply(userMessage);
  }
}

// Deposit command
bot.command('deposit', async (ctx) => {
  const args = ctx.message.text.split(' ');
  const amount = parseFloat(args[1]);
  await handleDepositRequest(ctx, amount);
});

// Balance command


async function handleBalanceRequest(ctx) {
  const userId = ctx.from.id;
  
  // Rate limiting: max 10 balance checks per minute
  if (!checkRateLimit(userId, 'balance', 10, 60000)) {
    return ctx.reply('⏳ **Rate Limit Exceeded**\nPlease wait a moment before checking your balance again.');
  }
  
  const session = await getUserSession(userId);
  
  if (!session?.isInitialized) {
    return ctx.reply('Please use /start first to set up your account.');
  }

  await ctx.reply('Hold on, fetching all your balances...');

  try {
    const [onChainBnb, onChainUsdt, spotBalances, futuresBalance] = await Promise.all([
      BNBWallet.getWalletBalance(session.walletAddress),
      BNBWallet.getUsdtBalance(session.walletAddress),
      asterAPI.getSpotAccountBalance(decrypt(session.apiKey), decrypt(session.apiSecret)),
      asterAPI.getAccountBalance(decrypt(session.apiKey), decrypt(session.apiSecret))
    ]);

    let balanceMessage = `
💰 Your Complete Balances:
**Address:** \`${session.walletAddress}\`
-----------------------------------
`;
    balanceMessage += `**On-Chain Wallet:**\n`;
    balanceMessage += `  - \`${onChainBnb} BNB\`\n`;
    balanceMessage += `  - \`${onChainUsdt} USDT\`\n`;
    balanceMessage += `**Spot Account:**\n`;

    if (Object.keys(spotBalances).length > 0) {
      for (const asset in spotBalances) {
        balanceMessage += `  - \`${spotBalances[asset].toFixed(4)} ${asset}\`\n`;
      }
    } else {
      // --- MODIFIED LINE ---
      balanceMessage += `  - \`0.00 USDT\`\n`;
    }
    balanceMessage += `-----------------------------------\n`;
    balanceMessage += `**Futures Account:**\n`;
    balanceMessage += `  - **Available:** \`${futuresBalance.available} USDT\`\n`;
    balanceMessage += `  - **Total Margin:** \`${futuresBalance.total} USDT\`\n`;

    await ctx.reply(balanceMessage, { parse_mode: 'Markdown' });

  } catch (error) {
    console.error('❌ [DEBUG] Error in combined /balance command:', error);
    console.error('❌ [DEBUG] Error fetching balances:', error);
    await ctx.reply('❌ Unable to fetch your balances. Please try again in a moment.');
  }
}

bot.command('balance', handleBalanceRequest);

// Register command handlers FIRST
bot.command('long', (ctx) => {
  return startTradingFlow(ctx, 'long');
});

bot.command('short', (ctx) => {
  return startTradingFlow(ctx, 'short');
});

bot.command('transfer', async (ctx) => {
  try {
    const userId = ctx.from.id;
    
    // Rate limiting: max 5 transfers per minute
    if (!checkRateLimit(userId, 'transfer', 5, 60000)) {
      return ctx.reply('⏳ **Rate Limit Exceeded**\nPlease wait a moment before making another transfer.');
    }
    
    const args = ctx.message.text.split(' ');
    const amount = args[1];
    const asset = args[2] || 'USDT';
    
    if (!amount) {
      return ctx.reply('Usage: /transfer [amount] [asset]\nExample: /transfer 25 USDT');
    }
    const session = await getUserSession(userId);

    // If session is not in memory, try loading it from the database
    if (!session) {
      session = await loadUserSession(userId);
      if (session) {
        await saveUserSessionData(userId, session); // Add to memory for faster access next time
      }
    }
    
    if (!session?.isInitialized) {
      return ctx.reply('Please use /start first to initialize your account.');
    }

    const transferAmount = parseFloat(amount);
    if (isNaN(transferAmount) || transferAmount <= 0) {
      return ctx.reply('Invalid amount. Please enter a valid number.');
    }

    // Transfer from spot to futures using v3 API
    const result = await asterAPI.transferSpotToFutures(decrypt(session.apiKey), decrypt(session.apiSecret), asset, transferAmount);
    
    const transferMessage = `
✅ **Transfer Successful!**

**Asset:** ${asset}
**Amount:** ${transferAmount}
**Transaction ID:** ${result.transactionId}
**Status:** ${result.status}

Your funds are now available in your futures account for trading.
    `;

    await ctx.reply(transferMessage, { parse_mode: 'Markdown' });
  } catch (error) {
      console.error('❌ [DEBUG] Transfer command error:', error);
      let userMessage = '❌ Transfer failed. ';
      if (error.message.includes('insufficient') || error.message.includes('balance')) {
        userMessage += 'Insufficient balance in your spot account. Please deposit more funds to your spot account first.';
      } else if (error.message.includes('not supported') || error.message.includes('symbol')) {
        userMessage += 'This asset is not supported for transfer. Please try USDT or another supported asset.';
      } else if (error.message.includes('network') || error.message.includes('timeout')) {
        userMessage += 'Network connection issue. Please try again in a few moments.';
      } else {
        userMessage += 'Please check your spot balance and try again.';
      }
      await ctx.reply(userMessage);
  }
});


// Markets command
bot.command('markets', async (ctx) => {
  const userId = ctx.from.id;
  
  // Rate limiting: max 15 market requests per minute
  if (!checkRateLimit(userId, 'markets', 15, 60000)) {
    return ctx.reply('⏳ **Rate Limit Exceeded**\nPlease wait a moment before browsing markets again.');
  }
  
  let session = await getUserSession(userId);

  // If session is not in memory, try loading it from the database
  if (!session) {
    session = await loadUserSession(userId);
    if (session) {
      await saveUserSessionData(userId, session);
    }
  }

  try {
    const markets = await asterAPI.getMarkets();
    
    // Set up markets browsing flow with cached data
    if (session) {
      session.tradingFlow = { step: 'browse_markets', page: 0, markets: markets };
      await saveUserSessionData(userId, session);
    }
    
    // Create pagination with 4 rows x 5 columns = 20 markets per page
    const marketsPerPage = 20;
    const totalPages = Math.ceil(markets.length / marketsPerPage);
    const currentPage = 0;
    const startIndex = currentPage * marketsPerPage;
    const endIndex = Math.min(startIndex + marketsPerPage, markets.length);
    const currentMarkets = markets.slice(startIndex, endIndex);
    
    // Create 4x5 grid (4 rows, 5 columns) with market symbols
    const keyboard = [];
    for (let i = 0; i < currentMarkets.length; i += 5) {
      const row = currentMarkets.slice(i, i + 5).map(market => {
        return Markup.button.callback(market.symbol, `view_market_${market.symbol}`);
      });
      keyboard.push(row);
    }
    
    // Add navigation buttons
    const navButtons = [];
    if (totalPages > 1) {
      if (currentPage > 0) {
        navButtons.push(Markup.button.callback('⬅️ Previous', `markets_browse_page_${currentPage - 1}`));
      }
      navButtons.push(Markup.button.callback(`Page ${currentPage + 1}/${totalPages}`, 'markets_browse_info'));
      if (currentPage < totalPages - 1) {
        navButtons.push(Markup.button.callback('Next ➡️', `markets_browse_page_${currentPage + 1}`));
      }
      keyboard.push(navButtons);
    }
    
    // Add back button
    keyboard.push([Markup.button.callback('🔙 Back to Menu', 'back_to_menu')]);
    
    const message = `📈 Available Markets (${markets.length} pairs)\n\nSelect a market to view details:\n\nShowing: ${startIndex + 1}-${endIndex} of ${markets.length}`;
    
    await ctx.reply(message, Markup.inlineKeyboard(keyboard));
  } catch (error) {
    console.error('❌ [DEBUG] Markets command error:', error);
    await ctx.reply('❌ Unable to fetch markets. Please try again in a moment.');
  }
});

// Price command
bot.command('price', async (ctx) => {
  try {
    const args = ctx.message.text.split(' ');
    // Change the default symbol to a valid trading pair
    const symbol = args[1]?.toUpperCase() || 'BNBUSDT'; 
    
    // Use the user's session keys for the API call
    const userId = ctx.from.id;
    const session = await getUserSession(userId);

    // If session is not in memory, try loading it from the database
    if (!session) {
      session = await loadUserSession(userId);
      if (session) {
        await saveUserSessionData(userId, session); // Add to memory for faster access next time
      }
    }

    if (!session?.isInitialized) {
      return ctx.reply('Please use /start first to set up your account.');
    }

    const price = await asterAPI.getPrice(decrypt(session.apiKey), decrypt(session.apiSecret), symbol);
    
    const priceMessage = `
📊 **${symbol} Price:**

**Current:** $${price.price}
**24h Change:** ${price.change24h}%
**24h High:** $${price.high24h}
**24h Low:** $${price.low24h}
**Volume:** $${price.volume24h}
    `;
    
    await ctx.reply(priceMessage, { parse_mode: 'Markdown' });
  } catch (error) {
    console.error('❌ [DEBUG] Price command error:', error);
    await ctx.reply('❌ Unable to fetch price. Please make sure you use a valid trading pair like BTCUSDT.');
  }
});

// Long position command
const startTradingFlow = async (ctx, tradeType) => {
  const userId = ctx.from.id;
  
  // Rate limiting: max 5 trading attempts per minute
  if (!checkRateLimit(userId, 'trading', 5, 60000)) {
    return ctx.reply('⏳ **Rate Limit Exceeded**\nPlease wait a moment before making another trade.');
  }
  
  const session = await getUserSession(userId);

  if (!session?.isInitialized) {
      return ctx.reply('Please use /start first to initialize your account.');
  }
  session.tradingFlow = { type: tradeType, step: 'select_asset', page: 0 };
  await saveUserSessionData(userId, session);

  // FIX: getMarkets is a public call and doesn't need API keys
  const markets = await asterAPI.getMarkets(); 
  
  // Create pagination with 4 rows x 5 columns = 20 markets per page
  const marketsPerPage = 20;
  const totalPages = Math.ceil(markets.length / marketsPerPage);
  const currentPage = 0;
  const startIndex = currentPage * marketsPerPage;
  const endIndex = Math.min(startIndex + marketsPerPage, markets.length);
  const currentMarkets = markets.slice(startIndex, endIndex);
  
  // Create 4x5 grid (4 rows, 5 columns) with full button text
  const keyboard = [];
  for (let i = 0; i < currentMarkets.length; i += 5) {
    const row = currentMarkets.slice(i, i + 5).map(market => {
      // Use full symbol text since we have more space
      return Markup.button.callback(market.symbol, `select_asset_${market.symbol}`);
    });
    keyboard.push(row);
  }
  
  // Add navigation buttons
  const navButtons = [];
  if (totalPages > 1) {
    if (currentPage > 0) {
      navButtons.push(Markup.button.callback('⬅️ Previous', `markets_page_${currentPage - 1}`));
    }
    navButtons.push(Markup.button.callback(`Page ${currentPage + 1}/${totalPages}`, 'markets_info'));
    if (currentPage < totalPages - 1) {
      navButtons.push(Markup.button.callback('Next ➡️', `markets_page_${currentPage + 1}`));
    }
    keyboard.push(navButtons);
  }
  
  // Add back button
  keyboard.push([Markup.button.callback('🔙 Back to Menu', 'back_to_menu')]);
  
  const message = tradeType === 'long' 
      ? `📈 Open Long Position\n\nSelect the asset (${startIndex + 1}-${endIndex} of ${markets.length}):` 
      : `📉 Open Short Position\n\nSelect the asset (${startIndex + 1}-${endIndex} of ${markets.length}):`;
  await ctx.reply(message, Markup.inlineKeyboard(keyboard));
};


// Positions command
bot.command('positions', async (ctx) => {
  try {
    const args = ctx.message.text.split(' ');
    const symbol = args[1];
    
    const userId = ctx.from.id;
    const session = await getUserSession(userId);

    // If session is not in memory, try loading it from the database
    if (!session) {
      session = await loadUserSession(userId);
      if (session) {
        await saveUserSessionData(userId, session); // Add to memory for faster access next time
      }
    }

    if (!session?.isInitialized) {
      return ctx.reply('Please use /start first to set up your account.');
    }
    
    const positions = await asterAPI.getPositions(decrypt(session.apiKey), decrypt(session.apiSecret), symbol);
    
    if (positions.length === 0) {
      return ctx.reply('No open positions found.');
    }
    
    let positionsList = '📊 Your Positions:\n\n';
    
    positions.forEach(pos => {
      const pnl = pos.unrealizedPnl >= 0 ? `+$${pos.unrealizedPnl}` : `-$${Math.abs(pos.unrealizedPnl)}`;
      const pnlEmoji = pos.unrealizedPnl >= 0 ? '🟢' : '🔴';
      
      positionsList += `${pnlEmoji} **${pos.symbol}**\n`;
      positionsList += `Size: ${pos.size} | Leverage: ${pos.leverage}x\n`;
      positionsList += `Entry: $${pos.entryPrice} | Current: $${pos.markPrice}\n`;
      positionsList += `PnL: ${pnl}\n\n`;
    });
    
    await ctx.reply(positionsList, { parse_mode: 'Markdown' });
  } catch (error) {
    console.error('❌ [DEBUG] Positions command error:', error);
    await ctx.reply('❌ Unable to fetch your positions. Please try again in a moment.');
  }
});

// Close positions command
bot.command('close', async (ctx) => {
  try {
    const userId = ctx.from.id;
    const session = await getUserSession(userId);

    // If session is not in memory, try loading it from the database
    if (!session) {
      session = await loadUserSession(userId);
      if (session) {
        await saveUserSessionData(userId, session); // Add to memory for faster access next time
      }
    }

    if (!session?.isInitialized) {
      return ctx.reply('Please use /start first to set up your account.');
    }
    
    const positions = await asterAPI.getPositions(decrypt(session.apiKey), decrypt(session.apiSecret));
    
    if (positions.length === 0) {
      return ctx.reply('No open positions to close.');
    }
    
    const keyboard = positions.map(pos => 
      [Markup.button.callback(`${pos.symbol} (${pos.size})`, `close_${pos.id}`)]
    );
    
    await ctx.reply(
      '🔒 Close Position\n\nSelect position to close:',
      Markup.inlineKeyboard(keyboard)
    );
  } catch (error) {
    console.error('❌ [DEBUG] Close command error:', error);
    await ctx.reply('❌ Unable to fetch your positions. Please try again in a moment.');
  }
});


// Handle callback queries for interactive flows
bot.on('callback_query', async (ctx) => {
  try {
  const data = ctx.callbackQuery.data;
  const userId = ctx.from.id;
  let session = await getUserSession(userId);

  // Load session from DB if not in cache
  if (!session) {
    session = await loadUserSession(userId);
    if (session) {
      await saveUserSessionData(userId, session);
    } else {
      // If no session exists at all, ask user to /start
      return ctx.answerCbQuery('Please use /start to initialize your bot.', { show_alert: true });
    }
  }

  // --- Main Menu Buttons ---
  if (data === 'menu_balance') {
    await ctx.answerCbQuery();
    return handleBalanceRequest(ctx);
  }
  if (data === 'menu_positions') {
    await ctx.answerCbQuery();
    // Call positions command handler directly
    try {
      if (!session?.isInitialized) {
        return ctx.reply('Please use /start first to set up your account.');
      }
      
      const positions = await asterAPI.getPositions(decrypt(session.apiKey), decrypt(session.apiSecret));
      
      if (positions.length === 0) {
        return ctx.reply('No open positions found.');
      }
      
      let positionsList = '📊 Your Positions:\n\n';
      
      positions.forEach(pos => {
        const pnl = pos.unrealizedPnl >= 0 ? `+$${pos.unrealizedPnl}` : `-$${Math.abs(pos.unrealizedPnl)}`;
        const pnlEmoji = pos.unrealizedPnl >= 0 ? '🟢' : '🔴';
        
        positionsList += `${pnlEmoji} **${pos.symbol}**\n`;
        positionsList += `Size: ${pos.size} | Leverage: ${pos.leverage}x\n`;
        positionsList += `Entry: $${pos.entryPrice} | Current: $${pos.markPrice}\n`;
        positionsList += `PnL: ${pnl}\n\n`;
      });
      
      return ctx.reply(positionsList, { parse_mode: 'Markdown' });
    } catch (error) {
      console.error('❌ [DEBUG] Error fetching positions:', error);
      return ctx.reply('❌ Unable to fetch your positions. Please try again in a moment.');
    }
  }
  if (data === 'menu_long') {
    await ctx.answerCbQuery();
    return startTradingFlow(ctx, 'long');
  }
  if (data === 'menu_short') {
    await ctx.answerCbQuery();
    return startTradingFlow(ctx, 'short');
  }
  if (data === 'menu_deposit') {
    await ctx.answerCbQuery();
    // Set up deposit flow state
    session.tradingFlow = { step: 'enter_deposit_amount' };
    await saveUserSessionData(userId, session);
    return ctx.reply('💸 Deposit Funds\n\nEnter the amount of USDT you want to deposit:\n\nExample: `50`', { parse_mode: 'Markdown' });
  }
  if (data === 'menu_transfer') {
    await ctx.answerCbQuery();
    // Set up transfer flow state
    session.tradingFlow = { step: 'enter_transfer_details' };
    await saveUserSessionData(userId, session);
    return ctx.reply('🔄 Transfer Funds\n\nEnter the amount and asset to transfer from Spot to Futures:\n\nFormat: `<amount> <asset>`\nExample: `25 USDT`', { parse_mode: 'Markdown' });
  }
  if (data === 'menu_markets') {
    await ctx.answerCbQuery();
    // Show interactive markets with pagination
    try {
      const markets = await asterAPI.getMarkets();
      
    // Set up markets browsing flow with cached data
    session.tradingFlow = { step: 'browse_markets', page: 0, markets: markets };
    await saveUserSessionData(userId, session);
      
      // Create pagination with 4 rows x 5 columns = 20 markets per page
      const marketsPerPage = 20;
      const totalPages = Math.ceil(markets.length / marketsPerPage);
      const currentPage = 0;
      const startIndex = currentPage * marketsPerPage;
      const endIndex = Math.min(startIndex + marketsPerPage, markets.length);
      const currentMarkets = markets.slice(startIndex, endIndex);
      
      // Create 4x5 grid (4 rows, 5 columns) with market symbols
      const keyboard = [];
      for (let i = 0; i < currentMarkets.length; i += 5) {
        const row = currentMarkets.slice(i, i + 5).map(market => {
          return Markup.button.callback(market.symbol, `view_market_${market.symbol}`);
        });
        keyboard.push(row);
      }
      
      // Add navigation buttons
      const navButtons = [];
      if (totalPages > 1) {
        if (currentPage > 0) {
          navButtons.push(Markup.button.callback('⬅️ Previous', `markets_browse_page_${currentPage - 1}`));
        }
        navButtons.push(Markup.button.callback(`Page ${currentPage + 1}/${totalPages}`, 'markets_browse_info'));
        if (currentPage < totalPages - 1) {
          navButtons.push(Markup.button.callback('Next ➡️', `markets_browse_page_${currentPage + 1}`));
        }
        keyboard.push(navButtons);
      }
      
      // Add back button
      keyboard.push([Markup.button.callback('🔙 Back to Menu', 'back_to_menu')]);
      
      const message = `📈 Available Markets (${markets.length} pairs)\n\nSelect a market to view details:\n\nShowing: ${startIndex + 1}-${endIndex} of ${markets.length}`;
      
      return ctx.reply(message, Markup.inlineKeyboard(keyboard));
    } catch (error) {
      console.error('❌ [DEBUG] Error fetching markets:', error);
      return ctx.reply('❌ Unable to fetch markets. Please try again in a moment.');
    }
  }
  if (data === 'menu_close') {
    await ctx.answerCbQuery();
    // Call close positions command handler directly
    try {
      if (!session?.isInitialized) {
        return ctx.reply('Please use /start first to set up your account.');
      }
      
      const positions = await asterAPI.getPositions(decrypt(session.apiKey), decrypt(session.apiSecret));
      
      if (positions.length === 0) {
        return ctx.reply('No open positions to close.');
      }
      
      const keyboard = positions.map(pos => 
        [Markup.button.callback(`${pos.symbol} (${pos.size})`, `close_${pos.symbol}`)]
      );
      
      return ctx.reply(
        '🔒 Close Position\n\nSelect position to close:',
        Markup.inlineKeyboard(keyboard)
      );
    } catch (error) {
      console.error('❌ [DEBUG] Error fetching positions for close:', error);
      return ctx.reply('❌ Unable to fetch your positions. Please try again in a moment.');
    }
  }
  if (data === 'menu_export') {
    await ctx.answerCbQuery();
    // Call the export command handler directly
    if (!session?.isInitialized || !session.privateKey) {
      return ctx.reply('Please use /start first to generate a wallet.');
    }

    const warningMessage = `
⚠️ **SECURITY WARNING** ⚠️

You are about to view your wallet's private key.

- **NEVER** share this key with anyone.
- Anyone with this key has **FULL and IRREVERSIBLE CONTROL** over all funds in this wallet.
- We strongly recommend you import this key into a secure, self-custodial wallet (like MetaMask or Trust Wallet) immediately.

Do you understand the risks and wish to proceed?
    `;

    // Create a confirmation keyboard
    const keyboard = Markup.inlineKeyboard([
      Markup.button.callback('✅ Yes, export my key', 'export_confirm_yes'),
      Markup.button.callback('❌ Cancel', 'export_confirm_no')
    ]);

    return ctx.reply(warningMessage, { parse_mode: 'Markdown', ...keyboard });
  }
  if (data === 'back_to_menu') {
    await ctx.answerCbQuery();
    if (session) {
      session.tradingFlow = null;
      await saveUserSessionData(userId, session);
    }
    return showMainMenu(ctx);
  }

  // --- Export Confirmation Flow ---
  if (data === 'export_confirm_yes') {
    await ctx.answerCbQuery();
    const decryptedKey = decrypt(session.privateKey);
    return ctx.editMessageText(`🔑 **Your Private Key:**\n\n\`${decryptedKey}\`\n\n⚠️ **Keep this safe and never share it with anyone!**`, { parse_mode: 'Markdown' });
  }
  if (data === 'export_confirm_no') {
    await ctx.answerCbQuery();
    return ctx.editMessageText('❌ Private key export cancelled.');
  }

  // --- Markets Browsing Handlers ---
  if (data.startsWith('markets_browse_page_')) {
    const page = parseInt(data.replace('markets_browse_page_', ''));
    const flow = session.tradingFlow;
    
    if (!flow || flow.step !== 'browse_markets') {
      await ctx.answerCbQuery('Market browsing has expired. Please start again.', { show_alert: true });
      return;
    }
    
    // Check if we're already on this page
    if (flow.page === page) {
      await ctx.answerCbQuery('You are already on this page.', { show_alert: false });
      return;
    }
    
    try {
      // Use cached markets data for faster pagination
      const markets = flow.markets || await asterAPI.getMarkets();
      const marketsPerPage = 20;
      const totalPages = Math.ceil(markets.length / marketsPerPage);
      const startIndex = page * marketsPerPage;
      const endIndex = Math.min(startIndex + marketsPerPage, markets.length);
      const currentMarkets = markets.slice(startIndex, endIndex);
      
      // Create 4x5 grid
      const keyboard = [];
      for (let i = 0; i < currentMarkets.length; i += 5) {
        const row = currentMarkets.slice(i, i + 5).map(market => {
          return Markup.button.callback(market.symbol, `view_market_${market.symbol}`);
        });
        keyboard.push(row);
      }
      
      // Add navigation buttons
      const navButtons = [];
      if (totalPages > 1) {
        if (page > 0) {
          navButtons.push(Markup.button.callback('⬅️ Previous', `markets_browse_page_${page - 1}`));
        }
        navButtons.push(Markup.button.callback(`Page ${page + 1}/${totalPages}`, 'markets_browse_info'));
        if (page < totalPages - 1) {
          navButtons.push(Markup.button.callback('Next ➡️', `markets_browse_page_${page + 1}`));
        }
        keyboard.push(navButtons);
      }
      
      keyboard.push([Markup.button.callback('🔙 Back to Menu', 'back_to_menu')]);
      
      const message = `📈 Available Markets (${markets.length} pairs)\n\nSelect a market to view details:\n\nShowing: ${startIndex + 1}-${endIndex} of ${markets.length}`;
      
      // Update the browsing flow page and cache markets
      flow.page = page;
      flow.markets = markets; // Cache the markets data
      await saveUserSessionData(userId, session);
      
      await ctx.answerCbQuery();
      return ctx.editMessageText(message, Markup.inlineKeyboard(keyboard));
    } catch (error) {
      console.error('❌ Markets pagination error:', error);
      await ctx.answerCbQuery('Error loading markets page', { show_alert: true });
      return;
    }
  }
  
  if (data === 'markets_browse_info') {
    await ctx.answerCbQuery('Market browsing pagination info', { show_alert: false });
    return;
  }

  // --- Individual Market View Handlers ---
  if (data.startsWith('view_market_')) {
    await ctx.answerCbQuery();
    const symbol = data.replace('view_market_', '');
    
    try {
      if (!session?.isInitialized) {
        return ctx.reply('Please use /start first to set up your account.');
      }
      
      // Get market price information
      const price = await asterAPI.getPrice(decrypt(session.apiKey), decrypt(session.apiSecret), symbol);
      
      const marketDetails = `
📊 ${symbol} Market Details

💰 **Current Price:** $${price.price}
📈 **24h Change:** ${price.change24h}%
📊 **24h High:** $${price.high24h}
📉 **24h Low:** $${price.low24h}
📊 **24h Volume:** $${price.volume24h}

Choose an action for this market:
      `;
      
      const keyboard = Markup.inlineKeyboard([
        [
          Markup.button.callback('📈 Long Position', `quick_long_${symbol}`),
          Markup.button.callback('📉 Short Position', `quick_short_${symbol}`)
        ],
        [
          Markup.button.callback('🔙 Back to Markets', 'menu_markets')
        ]
      ]);
      
      return ctx.editMessageText(marketDetails, { parse_mode: 'Markdown', ...keyboard });
    } catch (error) {
      console.error('❌ [DEBUG] Error fetching market details:', error);
      return ctx.editMessageText('❌ Unable to fetch market details. Please try again.');
    }
  }

  // --- Quick Trading from Market View ---
  if (data.startsWith('quick_long_') || data.startsWith('quick_short_')) {
    await ctx.answerCbQuery();
    const symbol = data.replace('quick_long_', '').replace('quick_short_', '');
    const tradeType = data.startsWith('quick_long_') ? 'long' : 'short';
    
    // Set up trading flow with pre-selected asset
    session.tradingFlow = { type: tradeType, step: 'enter_size', asset: symbol };
    await saveUserSessionData(userId, session);
    
    const message = `📈 **Open ${tradeType.toUpperCase()} Position**\n\nSelected: **${symbol}**\n\nEnter position size (in USDT):`;
    
    return ctx.editMessageText(message, { parse_mode: 'Markdown' });
  }

  // --- Market Pagination Handlers (for trading flow) ---
  if (data.startsWith('markets_page_')) {
    await ctx.answerCbQuery();
    const page = parseInt(data.replace('markets_page_', ''));
    const flow = session.tradingFlow;
    
    if (!flow || flow.step !== 'select_asset') {
      return ctx.answerCbQuery('Market selection has expired. Please start again.', { show_alert: true });
    }
    
    try {
      const markets = await asterAPI.getMarkets();
      const marketsPerPage = 20;
      const totalPages = Math.ceil(markets.length / marketsPerPage);
      const startIndex = page * marketsPerPage;
      const endIndex = Math.min(startIndex + marketsPerPage, markets.length);
      const currentMarkets = markets.slice(startIndex, endIndex);
      
      // Create 4x5 grid
      const keyboard = [];
      for (let i = 0; i < currentMarkets.length; i += 5) {
        const row = currentMarkets.slice(i, i + 5).map(market => {
          return Markup.button.callback(market.symbol, `select_asset_${market.symbol}`);
        });
        keyboard.push(row);
      }
      
      // Add navigation buttons
      const navButtons = [];
      if (totalPages > 1) {
        if (page > 0) {
          navButtons.push(Markup.button.callback('⬅️ Previous', `markets_page_${page - 1}`));
        }
        navButtons.push(Markup.button.callback(`Page ${page + 1}/${totalPages}`, 'markets_info'));
        if (page < totalPages - 1) {
          navButtons.push(Markup.button.callback('Next ➡️', `markets_page_${page + 1}`));
        }
        keyboard.push(navButtons);
      }
      
      keyboard.push([Markup.button.callback('🔙 Back to Menu', 'back_to_menu')]);
      
      const message = flow.type === 'long' 
          ? `📈 Open Long Position\n\nSelect the asset (${startIndex + 1}-${endIndex} of ${markets.length}):` 
          : `📉 Open Short Position\n\nSelect the asset (${startIndex + 1}-${endIndex} of ${markets.length}):`;
      
      // Update the trading flow page
      flow.page = page;
      await saveUserSessionData(userId, session);
      
      return ctx.editMessageText(message, Markup.inlineKeyboard(keyboard));
    } catch (error) {
      console.error('❌ [DEBUG] Error loading markets page:', error);
      return ctx.editMessageText('❌ Error loading markets page. Please try again.');
    }
  }
  
  if (data === 'markets_info') {
    await ctx.answerCbQuery('Market pagination info', { show_alert: false });
    return;
  }

  // --- Individual Position Close Handlers ---
  if (data.startsWith('close_')) {
    await ctx.answerCbQuery();
    const symbol = data.replace('close_', '');
    
    try {
      if (!session?.isInitialized) {
        return ctx.reply('Please use /start first to set up your account.');
      }
      
      await ctx.editMessageText(`🔄 Closing position for ${symbol}...`);
      
      const result = await asterAPI.closePosition(decrypt(session.apiKey), decrypt(session.apiSecret), symbol);
      
      const closeMessage = `
✅ **Position Closed Successfully!**

**Symbol:** ${symbol}
**Order ID:** ${result.orderId}
**Status:** ${result.status}

Your position has been closed and funds are available in your account.
      `;
      
      return ctx.editMessageText(closeMessage, { parse_mode: 'Markdown' });
    } catch (error) {
      console.error('❌ [DEBUG] Error closing position:', error);
      return ctx.editMessageText('❌ Failed to close position. Please try again.');
    }
  }

  // --- Trading Flow (Asset Selection, Leverage, etc.) ---
  try {
    const flow = session.tradingFlow;
    if (!flow) return ctx.answerCbQuery('This action has expired. Please start again.', { show_alert: true });

    if (flow.step === 'select_asset' && data.startsWith('select_asset_')) {
        flow.asset = data.replace('select_asset_', '');
        flow.step = 'enter_size';
        await ctx.answerCbQuery();
        await ctx.editMessageText(`Selected: **${flow.asset}**\n\nEnter position size (in USDT):`, { parse_mode: 'Markdown' });
    } else if (flow.step === 'enter_leverage' && data.startsWith('leverage_')) {
        flow.leverage = parseInt(data.replace('leverage_', ''));
        flow.step = 'confirm';
        const confirmKeyboard = Markup.inlineKeyboard([
            Markup.button.callback('✅ Confirm Trade', 'confirm_trade'),
            Markup.button.callback('❌ Cancel', 'cancel_trade')
        ]);
        await ctx.answerCbQuery();
        await ctx.editMessageText(
            `📋 Trade Confirmation:\n\n` +
            `**Asset:** ${flow.asset}\n` +
            `**Side:** ${flow.type.toUpperCase()}\n` +
            `**Size:** ${flow.size} USDT\n` +
            `**Leverage:** ${flow.leverage}x`,
            { parse_mode: 'Markdown', ...confirmKeyboard }
        );
    } else if (flow.step === 'confirm' && data === 'confirm_trade') {
        await ctx.answerCbQuery();
        await ctx.editMessageText('Processing your trade...');
        const result = await asterAPI.placeOrder(decrypt(session.apiKey), decrypt(session.apiSecret), {
            symbol: flow.asset, side: flow.type, size: flow.size, leverage: flow.leverage
        });
        session.tradingFlow = null; // End the flow
        await ctx.editMessageText(
            `✅ **Trade Executed!**\n\n` +
            `**Order ID:** \`${result.orderId}\`\n` +
            `**Symbol:** ${result.symbol}\n` +
            `**Side:** ${result.side}\n` +
            `**Quantity:** ${parseFloat(result.origQty).toFixed(5)}`,
            { parse_mode: 'Markdown' }
        );
    } else if (data === 'cancel_trade') {
        session.tradingFlow = null; // End the flow
        await ctx.answerCbQuery();
        await ctx.editMessageText('❌ Trade cancelled.');
    }
  } catch (error) {
    if (session) session.tradingFlow = null; // End the flow on error
    await ctx.answerCbQuery('An error occurred.', { show_alert: true });
    console.error('❌ [DEBUG] Error during trade:', error);
    let userMessage = '❌ Trading failed. ';
    if (error.message.includes('insufficient') || error.message.includes('balance')) {
      userMessage += '❌ **Empty Futures Account!**\nYou have no USDT in your futures account to trade with.\n\n**To fix this:**\n1. Use `/deposit` to add USDT to your futures account\n2. Or transfer from spot using the Transfer button';
    } else if (error.message.includes('not supported symbol') || error.message.includes('symbol')) {
      userMessage += '❌ **Trading Pair Not Supported**\nThis asset is not available for trading. Please try a different symbol.';
    } else if (error.message.includes('leverage')) {
      userMessage += '❌ **Invalid Leverage**\nThe leverage amount is too high for this trading pair. Please try a lower leverage (1x-10x).';
    } else if (error.message.includes('quantity') || error.message.includes('size')) {
      userMessage += '❌ **Position Size Too Large**\nYour position size exceeds your available balance or trading limits.\n\n**Try:**\n• Smaller position size\n• Check your futures balance with `/balance`';
    } else if (error.message.includes('network') || error.message.includes('timeout')) {
      userMessage += '❌ **Network Issue**\nConnection problem with the trading server. Please try again in a few moments.';
    } else {
      userMessage += '❌ **Trading Error**\nSomething went wrong. Please check your balance and try again.';
    }
    await ctx.reply(userMessage);
  }
  } catch (error) {
    console.error('❌ Callback query error:', error);
    try {
      await ctx.answerCbQuery('An error occurred. Please try again.', { show_alert: true });
    } catch (answerError) {
      console.error('❌ Failed to answer callback query:', answerError);
    }
  }
});

bot.on('text', async (ctx) => {
  
  // Skip if this is a command (starts with /)
  if (ctx.message.text.startsWith('/')) {
    return;
  }
  
  const userId = ctx.from.id;
  const session = await getUserSession(userId);

  // Handle deposit flow (when user enters amount after clicking deposit button)
  if (session?.tradingFlow?.step === 'enter_deposit_amount') {
    try {
      const amount = parseFloat(ctx.message.text);
      if (isNaN(amount) || amount <= 0) {
        return ctx.reply('Invalid amount. Please enter a positive number for USDT deposit.');
      }

      // Clear the trading flow and handle deposit
      session.tradingFlow = null;
      await saveUserSessionData(userId, session);
      
      return handleDepositRequest(ctx, amount);
    } catch (error) {
      session.tradingFlow = null;
      await saveUserSessionData(userId, session);
      return ctx.reply(`❌ Deposit failed: ${error.message}`);
    }
  }

  // Handle transfer flow (when user enters amount and asset after clicking transfer button)
  if (session?.tradingFlow?.step === 'enter_transfer_details') {
    try {
      const parts = ctx.message.text.trim().split(' ');
      if (parts.length < 2) {
        return ctx.reply('Please enter both amount and asset. Example: `25 USDT`', { parse_mode: 'Markdown' });
      }

      const amount = parseFloat(parts[0]);
      const asset = parts[1].toUpperCase();

      if (isNaN(amount) || amount <= 0) {
        return ctx.reply('Invalid amount. Please enter a positive number.');
      }

      // Clear the trading flow and handle transfer
      session.tradingFlow = null;
      await saveUserSessionData(userId, session);

      // Call the transfer command handler directly
      const result = await asterAPI.transferSpotToFutures(decrypt(session.apiKey), decrypt(session.apiSecret), asset, amount);
      
      const transferMessage = `
✅ **Transfer Successful!**

**Asset:** ${asset}
**Amount:** ${amount}
**Transaction ID:** ${result.transactionId}
**Status:** ${result.status}

Your funds are now available in your futures account for trading.
      `;

      return ctx.reply(transferMessage, { parse_mode: 'Markdown' });
    } catch (error) {
      session.tradingFlow = null;
      await saveUserSessionData(userId, session);
      console.error('❌ [DEBUG] Transfer error:', error);
      let userMessage = '❌ Transfer failed. ';
      if (error.message.includes('insufficient') || error.message.includes('balance')) {
        userMessage += 'Insufficient balance in your spot account. Please deposit more funds to your spot account first.';
      } else if (error.message.includes('not supported') || error.message.includes('symbol')) {
        userMessage += 'This asset is not supported for transfer. Please try USDT or another supported asset.';
      } else if (error.message.includes('network') || error.message.includes('timeout')) {
        userMessage += 'Network connection issue. Please try again in a few moments.';
      } else {
        userMessage += 'Please check your spot balance and try again.';
      }
      return ctx.reply(userMessage);
    }
  }

  // This code only runs if the user is in the middle of a trade and needs to enter a size
  if (session?.tradingFlow?.step === 'enter_size') {
      try {
          const size = parseFloat(ctx.message.text);
          if (isNaN(size) || size <= 0) {
              return ctx.reply('Invalid size. Please enter a positive number.');
          }

          session.tradingFlow.size = size;
          session.tradingFlow.step = 'enter_leverage';
          await saveUserSessionData(userId, session);

          const symbol = session.tradingFlow.asset;
          await ctx.reply(`Fetching leverage options for ${symbol}...`);

          // 1. Get the asset-specific max leverage
          const maxLeverage = await asterAPI.getLeverageBrackets(decrypt(session.apiKey), decrypt(session.apiSecret), symbol);

          // 2. Define all possible leverage steps
          const allLeverageSteps = [2, 5, 10, 20, 25, 50, 75, 100, 125];

          // 3. Filter to show only valid options for this specific asset
          const validLeverageOptions = allLeverageSteps.filter(step => step <= maxLeverage);
          
          // 4. Dynamically create the keyboard with valid options
          const leverageKeyboard = [];
          for (let i = 0; i < validLeverageOptions.length; i += 3) {
              leverageKeyboard.push(
                  validLeverageOptions.slice(i, i + 3).map(leverage => 
                      Markup.button.callback(`${leverage}x`, `leverage_${leverage}`)
                  )
              );
          }
          
          await ctx.reply(
              `Size: ${size} USDT\nMax Leverage for ${symbol}: **${maxLeverage}x**\n\nSelect your leverage:`,
              {
                  parse_mode: 'Markdown',
                  ...Markup.inlineKeyboard(leverageKeyboard)
              }
          );
      } catch (error) {
          session.tradingFlow = null; // Reset flow on error
          await saveUserSessionData(userId, session);
          console.error('❌ [DEBUG] Trading flow error:', error);
          let userMessage = '❌ **Trading Failed** ';
          if (error.message.includes('insufficient') || error.message.includes('balance')) {
            userMessage += '❌ **Empty Futures Account!**\nYou have no USDT in your futures account to trade with.\n\n**To fix this:**\n1. Use `/deposit` to add USDT to your futures account\n2. Or transfer from spot using the Transfer button';
          } else if (error.message.includes('leverage')) {
            userMessage += '❌ **Invalid Leverage**\nThe leverage amount is too high for this trading pair. Please try a lower leverage (1x-10x).';
          } else if (error.message.includes('quantity') || error.message.includes('size')) {
            userMessage += '❌ **Position Size Too Large**\nYour position size exceeds your available balance or trading limits.\n\n**Try:**\n• Smaller position size\n• Check your futures balance with `/balance`';
          } else if (error.message.includes('network') || error.message.includes('timeout')) {
            userMessage += '❌ **Network Issue**\nConnection problem with the trading server. Please try again in a few moments.';
          } else {
            userMessage += '❌ **Trading Error**\nSomething went wrong. Please check your balance and try again.';
          }
          await ctx.reply(userMessage);
      }
  }
});

try {
  await bot.telegram.setMyCommands([
    { command: 'start', description: 'Start the bot & get your wallet' },
    { command: 'menu', description: 'Show the main interactive menu' },
    { command: 'balance', description: 'Check all account balances' },
    { command: 'markets', description: 'Browse available trading markets' },
    { command: 'deposit', description: 'Deposit USDT from wallet to exchange' },
    { command: 'transfer', description: 'Transfer funds from Spot to Futures' },
    { command: 'long', description: 'Open a long position' },
    { command: 'short', description: 'Open a short position' },
    { command: 'positions', description: 'View your open positions' },
    { command: 'close', description: 'Close an open position' },
    { command: 'export', description: 'Export your wallet\'s private key' },
    { command: 'cancel', description: 'Cancel the current action' },
    { command: 'help', description: 'Show this help message' },
  ]);
  console.log('✅ Bot command menu has been set.');
} catch (error) {
  console.error('❌ [DEBUG] Failed to set bot command menu:', error);
}

console.log('🚀 Starting bot launch...');

// Initialize Redis connection
async function initializeRedis() {
  if (redisClient) {
    try {
      await redisClient.connect();
      console.log('✅ Redis connected successfully');
    } catch (error) {
      console.error('❌ Redis connection failed:', error);
      redisClient = null; // Disable Redis on connection failure
    }
  }
}

// Initialize Redis and start bot
initializeRedis().then(() => {
  startKeepAliveServer();
  bot.launch().then(() => {
  
    console.log('🚀 AsterDex Multi-User Bot started successfully!');
    console.log('✅ Bot is ready to receive commands');
    
  }).catch((error) => {
    console.error('❌ [DEBUG] Bot launch failed:', error);
    console.error('❌ [DEBUG] Launch error stack:', error.stack);
  });
}).catch((error) => {
  console.error('❌ Bot initialization failed:', error);
});

console.log('🛡️ Setting up signal handlers...');
process.once('SIGINT', () => {
  console.log('🛑 SIGINT received, stopping bot...');
  bot.stop('SIGINT');
});
process.once('SIGTERM', () => {
  console.log('🛑 SIGTERM received, stopping bot...');
  bot.stop('SIGTERM');
});