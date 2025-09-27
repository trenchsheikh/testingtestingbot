import 'dotenv/config';
import { Telegraf, Markup } from 'telegraf';
import axios from 'axios';
import { AsterAPI } from './asterdex.js';
import { BNBWallet } from './bnb-wallet.js';
import { saveUserSession, loadUserSession } from './database.js';
import { startKeepAliveServer } from './web.js';

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
if (!BOT_TOKEN) {
  console.error('Missing TELEGRAM_BOT_TOKEN in .env');
  process.exit(1);
}

const bot = new Telegraf(BOT_TOKEN);
// Initialize the API client without any credentials
const asterAPI = new AsterAPI();

// User session storage
const userSessions = new Map();

// Symbol support tracking
const symbolSupport = new Map(); // symbol -> { supported: boolean, maxLeverage: number, lastTested: timestamp }

// Function to test if a symbol is supported
async function testSymbolSupport(symbol, apiKey, apiSecret) {
  // Check if we already tested this symbol recently (within 1 hour)
  const cached = symbolSupport.get(symbol);
  if (cached && Date.now() - cached.lastTested < 3600000) {
    return cached;
  }

  try {
    // Try to place a very small test order
    const timestamp = Date.now();
    const params = {
      symbol: symbol,
      side: 'BUY',
      type: 'MARKET',
      quantity: '0.001', // Very small amount for testing
      recvWindow: 5000,
      timestamp: timestamp
    };
    
    const queryString = Object.keys(params)
      .map(key => `${key}=${encodeURIComponent(params[key])}`)
      .join('&');
    
    const signature = asterAPI.generateSignature(queryString, apiSecret);
    const finalQueryString = `${queryString}&signature=${signature}`;
    
    const response = await axios.post(`${asterAPI.baseURL}/fapi/v1/order?${finalQueryString}`, null, {
      headers: {
        'X-MBX-APIKEY': apiKey,
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      timeout: 10000
    });
    
    // If we get here, the symbol is supported
    const result = { supported: true, maxLeverage: 100, lastTested: Date.now() };
    symbolSupport.set(symbol, result);
    return result;
  } catch (error) {
    const errorMsg = error.response?.data?.msg || error.message;
    const errorCode = error.response?.data?.code;
    
    let supported = false;
    let maxLeverage = 1;
    
    // Categorize the error
    if (errorMsg.includes('not supported symbol') || errorCode === -4095) {
      supported = false;
    } else if (errorMsg.includes('insufficient balance') || errorMsg.includes('margin') || errorCode === -2019) {
      supported = true;
      maxLeverage = 100; // Default assumption
    } else if (errorMsg.includes('leverage') || errorCode === -4028) {
      supported = true;
      maxLeverage = 1; // Conservative assumption
    } else if (errorMsg.includes('quantity') || errorCode === -1013) {
      supported = true;
      maxLeverage = 100; // Default assumption
    } else {
      supported = false;
    }
    
    const result = { supported, maxLeverage, lastTested: Date.now() };
    symbolSupport.set(symbol, result);
    return result;
  }
}

// Function to show the main menu
async function showMainMenu(ctx) {
  const userId = ctx.from.id;
  let session = userSessions.get(userId);

  // If session is not in memory, try loading it from the database
  if (!session) {
    session = await loadUserSession(userId);
    if (session) {
      userSessions.set(userId, session); // Add to memory for faster access next time
    }
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
🎯 **AsterDex Trading Bot - Main Menu**

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
  console.log('🚀 [DEBUG] /start command received from user:', ctx.from.id);
  const userId = ctx.from.id;

  // 1. Try to load the user from the database
  let session = await loadUserSession(userId);

  if (session) {
    // If user exists, add their session to the in-memory cache and welcome them back
    userSessions.set(userId, session);
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
          walletAddress: newWallet.address,
          privateKey: newWallet.privateKey,
          apiKey: apiKeys.apiKey,
          apiSecret: apiKeys.apiSecret,
          isInitialized: true,
          tradingFlow: null
      };

      // 3. Save the new session to the database AND the in-memory cache
      await saveUserSession(userId, newSession);
      userSessions.set(userId, newSession);
      console.log('✅ [DEBUG] User session stored successfully in DB and cache.');

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
  let session = userSessions.get(userId);

  // If session is not in memory, try loading it from the database
  if (!session) {
    session = await loadUserSession(userId);
    if (session) {
      userSessions.set(userId, session); // Add to memory for faster access next time
    }
  }

  if (session) {
      session.tradingFlow = null;
      userSessions.set(userId, session);
  }
  await ctx.reply('✅ Action cancelled. You are no longer in a trading flow.');
});

// Help command
bot.help(async (ctx) => {
  // --- MODIFIED TEXT ---
  const helpText = `
📋 **Available Commands:**
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
  let session = userSessions.get(userId);

  // If session is not in memory, try loading it from the database
  if (!session) {
    session = await loadUserSession(userId);
    if (session) {
      userSessions.set(userId, session); // Add to memory for faster access next time
    }
  }
  
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
🎯 **AsterDex Trading Bot - Main Menu**

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
  let session = userSessions.get(userId);

  // If session is not in memory, try loading it from the database
  if (!session) {
    session = await loadUserSession(userId);
    if (session) {
      userSessions.set(userId, session); // Add to memory for faster access next time
    }
  }

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
  console.log('💸 [DEBUG] /deposit command received from user:', ctx.from.id);
  const userId = ctx.from.id;
  let session = userSessions.get(userId);

  if (!session) {
    session = await loadUserSession(userId);
    if (session) userSessions.set(userId, session);
  }
  
  if (!session?.isInitialized) {
    return ctx.reply('Please use /start first.');
  }

  const ASTER_TREASURY_ADDRESS = '0x128463A60784c4D3f46c23Af3f65Ed859Ba87974';

  if (isNaN(amount) || amount <= 0) {
    return ctx.reply('Please provide a valid amount in USDT.\nUsage: `/deposit 50`', { parse_mode: 'Markdown' });
  }

  try {
    // Check for sufficient BNB for gas fees
    const bnbBalance = await BNBWallet.getWalletBalance(session.walletAddress);
    if (parseFloat(bnbBalance) < 0.001) {
      return ctx.reply('⚠️ **Low Gas Balance!**\nYou need at least ~0.001 BNB in your wallet to pay for transaction fees.', { parse_mode: 'Markdown' });
    }
    
    // Check for sufficient USDT balance
    const usdtBalance = await BNBWallet.getUsdtBalance(session.walletAddress);
    if (parseFloat(usdtBalance) < amount) {
      return ctx.reply(`⚠️ **Insufficient USDT!**\nYour wallet has ${usdtBalance} USDT, but you're trying to deposit ${amount} USDT.`, { parse_mode: 'Markdown' });
    }

    await ctx.reply(`Depositing ${amount} USDT directly to the Aster exchange. Please wait for the on-chain transaction to confirm...`);
    
    // Call the new, direct transfer function
    const tx = await BNBWallet.sendUsdt(session.privateKey, ASTER_TREASURY_ADDRESS, amount);
    
    await ctx.reply(`✅ **Deposit Transaction Sent!**\nYour funds should appear in your **Futures Account** in a few minutes.\n\n**Transaction Hash:** \`${tx.hash}\``, { parse_mode: 'Markdown' });

  } catch (error) {
    console.error('❌ [DEBUG] Error in /deposit command:', error);
    const errorMessage = error.code === 'INSUFFICIENT_FUNDS' ? 'Insufficient BNB for gas fees.' : error.message;
    await ctx.reply(`❌ Deposit failed: ${errorMessage}`);
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
  console.log('💰 [DEBUG] /balance (all) command received from user:', ctx.from.id);
  const userId = ctx.from.id;
  let session = userSessions.get(userId);

  if (!session) {
    session = await loadUserSession(userId);
    if (session) userSessions.set(userId, session);
  }
  
  if (!session?.isInitialized) {
    return ctx.reply('Please use /start first to set up your account.');
  }

  await ctx.reply('Hold on, fetching all your balances...');

  try {
    const [onChainBnb, onChainUsdt, spotBalances, futuresBalance] = await Promise.all([
      BNBWallet.getWalletBalance(session.walletAddress),
      BNBWallet.getUsdtBalance(session.walletAddress),
      asterAPI.getSpotAccountBalance(session.apiKey, session.apiSecret),
      asterAPI.getAccountBalance(session.apiKey, session.apiSecret)
    ]);

    let balanceMessage = `
💰 **Your Complete Balances:**
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
    await ctx.reply(`❌ An error occurred while fetching balances: ${error.message}`);
  }
}

bot.command('balance', handleBalanceRequest);

// Inside your bot.on('callback_query', ...) handler
// ...
// if (data === 'menu_balance') {
//     await ctx.answerCbQuery();
//     // The button also calls the same handler function
//     return handleBalanceRequest(ctx); 
// }

// Add this new handler for the deposit button



// Register command handlers FIRST
bot.command('long', (ctx) => {
  console.log('📈 [DEBUG] /long command received from user:', ctx.from.id);
  return startTradingFlow(ctx, 'long');
});

bot.command('short', (ctx) => {
  console.log('📉 [DEBUG] /short command received from user:', ctx.from.id);
  return startTradingFlow(ctx, 'short');
});

bot.command('transfer', async (ctx) => {
  console.log('🔄 [DEBUG] /transfer command received from user:', ctx.from.id);
  try {
    const args = ctx.message.text.split(' ');
    const amount = args[1];
    const asset = args[2] || 'USDT';
    
    if (!amount) {
      return ctx.reply('Usage: /transfer [amount] [asset]\nExample: /transfer 25 USDT');
    }

    const userId = ctx.from.id;
    let session = userSessions.get(userId);

    // If session is not in memory, try loading it from the database
    if (!session) {
      session = await loadUserSession(userId);
      if (session) {
        userSessions.set(userId, session); // Add to memory for faster access next time
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
    const result = await asterAPI.transferSpotToFutures(session.apiKey, session.apiSecret, asset, transferAmount);
    
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
    await ctx.reply(`❌ Transfer failed: ${error.message}`);
  }
});

console.log('✅ [DEBUG] All command handlers registered');

// Handle text messages for position size and dynamic leverage





// Markets command
// bot.command('markets', async (ctx) => {
//   try {
//     const markets = await asterAPI.getMarkets();
    
//     let marketList = '📈 **Available BNB Markets:**\n\n';
    
//     markets.forEach(market => {
//       marketList += `**${market.symbol}** - Max Leverage: ${market.maxLeverage}x\n`;
//     });
    
//     marketList += `\nTotal: ${markets.length} BNB pairs available`;
    
//     await ctx.reply(marketList, { parse_mode: 'Markdown' });
//   } catch (error) {
//     await ctx.reply(`❌ Unable to fetch markets: ${error.message}`);
//   }
// });

// Debug command to see all symbols
// src/index.js

// Markets command
// Markets command
bot.command('markets', async (ctx) => {
  try {
    const markets = await asterAPI.getMarkets(); // This is now a simple array
    
    const marketList = markets
        .slice(0, 20) // Show the first 20 markets
        .map(market => `**${market.symbol}**`)
        .join('\n');

    const marketMessage = `📈 **Available Crypto Markets (${markets.length} pairs):**\n\n${marketList}\n\n...and more.`;
    
    await ctx.reply(marketMessage, { parse_mode: 'Markdown' });
  } catch (error) {
    await ctx.reply(`❌ Unable to fetch markets: ${error.message}`);
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
    let session = userSessions.get(userId);

    // If session is not in memory, try loading it from the database
    if (!session) {
      session = await loadUserSession(userId);
      if (session) {
        userSessions.set(userId, session); // Add to memory for faster access next time
      }
    }

    if (!session?.isInitialized) {
      return ctx.reply('Please use /start first to set up your account.');
    }

    const price = await asterAPI.getPrice(session.apiKey, session.apiSecret, symbol);
    
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
    await ctx.reply(`❌ Unable to fetch price. Make sure you use a valid pair (e.g., /price BTCUSDT).`);
  }
});

// Long position command
const startTradingFlow = async (ctx, tradeType) => {
  const userId = ctx.from.id;
  let session = userSessions.get(userId);

  // If session is not in memory, try loading it from the database
  if (!session) {
    session = await loadUserSession(userId);
    if (session) {
      userSessions.set(userId, session); // Add to memory for faster access next time
    }
  }

  if (!session?.isInitialized) {
      return ctx.reply('Please use /start first to initialize your account.');
  }
  session.tradingFlow = { type: tradeType, step: 'select_asset', page: 0 };
  userSessions.set(userId, session);

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
      ? `📈 **Open Long Position**\n\nSelect the asset (${startIndex + 1}-${endIndex} of ${markets.length}):` 
      : `📉 **Open Short Position**\n\nSelect the asset (${startIndex + 1}-${endIndex} of ${markets.length}):`;
  await ctx.reply(message, Markup.inlineKeyboard(keyboard));
};


// Positions command
bot.command('positions', async (ctx) => {
  try {
    const args = ctx.message.text.split(' ');
    const symbol = args[1];
    
    const userId = ctx.from.id;
    let session = userSessions.get(userId);

    // If session is not in memory, try loading it from the database
    if (!session) {
      session = await loadUserSession(userId);
      if (session) {
        userSessions.set(userId, session); // Add to memory for faster access next time
      }
    }

    if (!session?.isInitialized) {
      return ctx.reply('Please use /start first to set up your account.');
    }
    
    const positions = await asterAPI.getPositions(session.apiKey, session.apiSecret, symbol);
    
    if (positions.length === 0) {
      return ctx.reply('No open positions found.');
    }
    
    let positionsList = '📊 **Your Positions:**\n\n';
    
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
    await ctx.reply(`❌ Unable to fetch positions: ${error.message}`);
  }
});

// Close positions command
bot.command('close', async (ctx) => {
  try {
    const userId = ctx.from.id;
    let session = userSessions.get(userId);

    // If session is not in memory, try loading it from the database
    if (!session) {
      session = await loadUserSession(userId);
      if (session) {
        userSessions.set(userId, session); // Add to memory for faster access next time
      }
    }

    if (!session?.isInitialized) {
      return ctx.reply('Please use /start first to set up your account.');
    }
    
    const positions = await asterAPI.getPositions(session.apiKey, session.apiSecret);
    
    if (positions.length === 0) {
      return ctx.reply('No open positions to close.');
    }
    
    const keyboard = positions.map(pos => 
      [Markup.button.callback(`${pos.symbol} (${pos.size})`, `close_${pos.id}`)]
    );
    
    await ctx.reply(
      '🔒 **Close Position**\n\nSelect position to close:',
      Markup.inlineKeyboard(keyboard)
    );
  } catch (error) {
    await ctx.reply(`❌ Unable to fetch positions: ${error.message}`);
  }
});

// Spot balance command
bot.command('spotbalance', async (ctx) => {
  console.log('💳 [DEBUG] /spotbalance command received from user:', ctx.from.id);
  try {
    const userId = ctx.from.id;
    let session = userSessions.get(userId);

    // If session is not in memory, try loading it from the database
    if (!session) {
      session = await loadUserSession(userId);
      if (session) {
        userSessions.set(userId, session); // Add to memory for faster access next time
      }
    }

    if (!session?.isInitialized) {
      return ctx.reply('Please use /start first to set up your account.');
    }

    await ctx.reply('Checking your Spot Account balance, please wait...');

    // Call the existing function to get the Spot balance
    const spotBalances = await asterAPI.getSpotAccountBalance(session.apiKey, session.apiSecret);

    let balanceMessage = `
💳 **Your Spot Account Balances:**
**Wallet:** \`${session.walletAddress}\`
\n`;

    if (Object.keys(spotBalances).length > 0) {
      for (const asset in spotBalances) {
        balanceMessage += `**${asset}:** ${spotBalances[asset].toFixed(8)}\n`;
      }
    } else {
      balanceMessage += 'Your spot account is currently empty. Deposits can take a few minutes to arrive after being confirmed on the blockchain.';
    }

    await ctx.reply(balanceMessage, { parse_mode: 'Markdown' });
  } catch (error) {
    console.error('❌ [DEBUG] Error in /spotbalance command:', error);
    await ctx.reply(`❌ Unable to fetch spot balance: ${error.message}`);
  }
});

// Handle callback queries for interactive flows
bot.on('callback_query', async (ctx) => {
  const data = ctx.callbackQuery.data;
  const userId = ctx.from.id;
  let session = userSessions.get(userId);

  // Load session from DB if not in cache
  if (!session) {
    session = await loadUserSession(userId);
    if (session) {
      userSessions.set(userId, session);
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
    return bot.handleUpdate({ message: { text: '/positions', from: ctx.from } });
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
    return ctx.reply('To deposit, use the command: `/deposit <amount>`\nExample: `/deposit 50`', { parse_mode: 'Markdown' });
  }
  if (data === 'menu_transfer') {
    await ctx.answerCbQuery();
    return ctx.reply('To transfer, use the command: `/transfer <amount> <asset>`\nExample: `/transfer 25 USDT`', { parse_mode: 'Markdown' });
  }
  if (data === 'menu_markets') {
    await ctx.answerCbQuery();
    return bot.handleUpdate({ message: { text: '/markets', from: ctx.from } });
  }
  if (data === 'menu_close') {
    await ctx.answerCbQuery();
    return bot.handleUpdate({ message: { text: '/close', from: ctx.from } });
  }
  if (data === 'menu_export') {
    await ctx.answerCbQuery();
    return bot.handleUpdate({ message: { text: '/export', from: ctx.from } });
  }
  if (data === 'back_to_menu') {
    await ctx.answerCbQuery();
    if (session) {
      session.tradingFlow = null;
      userSessions.set(userId, session);
    }
    return showMainMenu(ctx);
  }

  // --- Export Confirmation Flow ---
  if (data === 'export_confirm_yes') {
    await ctx.answerCbQuery();
    const decryptedKey = decrypt(session.privateKey); // Assuming you've implemented encryption
    return ctx.editMessageText(`🔑 **Your Private Key:**\n\n\`${decryptedKey}\`\n\n⚠️ Keep this safe!`, { parse_mode: 'Markdown' });
  }
  if (data === 'export_confirm_no') {
    await ctx.answerCbQuery();
    return ctx.editMessageText('❌ Private key export cancelled.');
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
            `📋 **Trade Confirmation:**\n\n` +
            `**Asset:** ${flow.asset}\n` +
            `**Side:** ${flow.type.toUpperCase()}\n` +
            `**Size:** ${flow.size} USDT\n` +
            `**Leverage:** ${flow.leverage}x`,
            { parse_mode: 'Markdown', ...confirmKeyboard }
        );
    } else if (flow.step === 'confirm' && data === 'confirm_trade') {
        await ctx.answerCbQuery();
        await ctx.editMessageText('Processing your trade...');
        const result = await asterAPI.placeOrder(session.apiKey, session.apiSecret, {
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
    await ctx.reply(`❌ Error during trade: ${error.message}`);
  }
});

bot.on('text', async (ctx) => {
  console.log('📝 [DEBUG] Text message received:', ctx.message.text, 'from user:', ctx.from.id);
  
  // Skip if this is a command (starts with /)
  if (ctx.message.text.startsWith('/')) {
    console.log('⚠️ [DEBUG] Skipping command in text handler:', ctx.message.text);
    return;
  }
  
  const userId = ctx.from.id;
  let session = userSessions.get(userId);

  // If session is not in memory, try loading it from the database
  if (!session) {
    session = await loadUserSession(userId);
    if (session) {
      userSessions.set(userId, session); // Add to memory for faster access next time
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
          userSessions.set(userId, session);

          const symbol = session.tradingFlow.asset;
          await ctx.reply(`Fetching leverage options for ${symbol}...`);

          // 1. Get the asset-specific max leverage
          const maxLeverage = await asterAPI.getLeverageBrackets(session.apiKey, session.apiSecret, symbol);

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
          userSessions.set(userId, session);
          await ctx.reply(`❌ Error: ${error.message}`);
      }
  }
});

try {
  await bot.telegram.setMyCommands([
    { command: 'start', description: 'Start the bot & get your wallet' },
    { command: 'menu', description: 'Show the main interactive menu' },
    { command: 'balance', description: 'Check all account balances' },
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
  console.log('✅ [DEBUG] Bot command menu has been set.');
} catch (error) {
  console.error('❌ [DEBUG] Failed to set bot command menu:', error);
}

console.log('🚀 [DEBUG] Starting bot launch...');
bot.launch().then(() => {
  console.log('🚀 [DEBUG] AsterDex Multi-User Bot started successfully!');
  console.log('✅ [DEBUG] Bot is ready to receive commands');
  startKeepAliveServer();
}).catch((error) => {
  console.error('❌ [DEBUG] Bot launch failed:', error);
  console.error('❌ [DEBUG] Launch error stack:', error.stack);
});

console.log('🛡️ [DEBUG] Setting up signal handlers...');
process.once('SIGINT', () => {
  console.log('🛑 [DEBUG] SIGINT received, stopping bot...');
  bot.stop('SIGINT');
});
process.once('SIGTERM', () => {
  console.log('🛑 [DEBUG] SIGTERM received, stopping bot...');
  bot.stop('SIGTERM');
});