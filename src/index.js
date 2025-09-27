import 'dotenv/config';
import { Telegraf, Markup } from 'telegraf';
import { AsterAPI } from './asterdex.js';
import { BNBWallet } from './bnb-wallet.js';

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

// --- THE NEW ONBOARDING FLOW ---
bot.start(async (ctx) => {
  console.log('🚀 [DEBUG] /start command received from user:', ctx.from.id);
  const userId = ctx.from.id;
  let session = userSessions.get(userId);
  console.log('🔍 [DEBUG] Current session exists:', !!session);

  // If the user already exists, reset any stuck trading flow
  if (session) {
      console.log('🔄 [DEBUG] Resetting trading flow for existing user');
      session.tradingFlow = null;
      userSessions.set(userId, session);
  }

  if (session && session.apiKey) {
      console.log('✅ [DEBUG] Returning welcome back message for existing user');
      return ctx.reply(`🎉 **Welcome back!** Any previous action has been cancelled.\n\nYour wallet address is:\n\`${session.walletAddress}\``, { parse_mode: 'Markdown' });
  }

  try {
      console.log('👋 [DEBUG] Sending welcome message to new user');
      await ctx.reply('👋 Welcome! Creating your secure wallet and API keys. This might take a moment...');
      
      console.log('🔑 [DEBUG] Creating new wallet...');
      const newWallet = BNBWallet.createWallet();
      console.log('✅ [DEBUG] Wallet created:', newWallet.address);
      
      console.log('🔐 [DEBUG] Creating API keys for wallet...');
      const apiKeys = await asterAPI.createApiKeysForWallet(newWallet);
      console.log('✅ [DEBUG] API keys created successfully');
      
      console.log('💾 [DEBUG] Storing user session...');
      session = {
          walletAddress: newWallet.address,
          privateKey: newWallet.privateKey, // WARNING: Encrypt this in production!
          apiKey: apiKeys.apiKey,
          apiSecret: apiKeys.apiSecret,
          isInitialized: true,
          tradingFlow: null
      };
      userSessions.set(userId, session);
      console.log('✅ [DEBUG] User session stored successfully');

      const welcomeMessage = `
✅ **Setup Complete!**
Your unique BEP-20 wallet address is:
\`${session.walletAddress}\`
**IMPORTANT**: You must send funds to this address to trade.

Use /menu to see the main menu with buttons, or /help to see all commands.
      `;
      console.log('📤 [DEBUG] Sending welcome message to user');
      await ctx.reply(welcomeMessage, { parse_mode: 'Markdown' });
      console.log('✅ [DEBUG] Welcome message sent successfully');
      
      // Show the main menu after setup
      console.log('📋 [DEBUG] Showing main menu after setup');
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
        ],
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
      console.log('✅ [DEBUG] Main menu sent successfully');

  } catch (error) {
      console.error('❌ [DEBUG] Error in /start command:', error);
      console.error('❌ [DEBUG] Error stack:', error.stack);
      await ctx.reply(`❌ Account setup failed: ${error.message}\nPlease try /start again.`);
  }
});

// Cancel command
bot.command('cancel', async (ctx) => {
  const userId = ctx.from.id;
  const session = userSessions.get(userId);
  if (session) {
      session.tradingFlow = null;
      userSessions.set(userId, session);
  }
  await ctx.reply('✅ Action cancelled. You are no longer in a trading flow.');
});

// Help command
bot.help(async (ctx) => {
  const helpText = `
📋 **Available Commands:**
/start - Start the bot & create your wallet
/menu - Show the main menu with buttons
/balance - Check your futures balance
/transfer [amount] [asset] - Transfer from spot to futures
/export - Export your wallet's private key
/long - Start opening a long position
/short - Start opening a short position
/positions - View your open positions
/close - Select a position to close
/cancel - Cancel your current action (like an open trade)
  `;
  await ctx.reply(helpText, { parse_mode: 'Markdown' });
});

// Main Menu command
bot.command('menu', async (ctx) => {
  const userId = ctx.from.id;
  const session = userSessions.get(userId);
  
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
  const session = userSessions.get(userId);

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


// Balance command
bot.command('balance', async (ctx) => {
  console.log('💰 [DEBUG] /balance (all) command received from user:', ctx.from.id);
  const session = userSessions.get(ctx.from.id);
  
  if (!session?.isInitialized) {
    return ctx.reply('Please use /start first to set up your account.');
  }

  await ctx.reply('Hold on, fetching all your balances...');

  try {
    // Fetch all three balances in parallel for speed
    const [onChainBalance, spotBalances, futuresBalance] = await Promise.all([
      BNBWallet.getWalletBalance(session.walletAddress),
      asterAPI.getSpotAccountBalance(session.apiKey, session.apiSecret),
      asterAPI.getAccountBalance(session.apiKey, session.apiSecret)
    ]);

    // --- Build the response message ---
    let balanceMessage = `
💰 **Your Complete Balances:**
**Address:** \`${session.walletAddress}\`
-----------------------------------
`;

    // 1. On-Chain Wallet Balance
    balanceMessage += `**BNB Wallet:** \`${onChainBalance} BNB\`\n`;

    // 2. Spot Account Balances
    balanceMessage += `**Spot Account:**\n`;
    if (Object.keys(spotBalances).length > 0) {
      for (const asset in spotBalances) {
        balanceMessage += `  - \`${spotBalances[asset].toFixed(4)} ${asset}\`\n`;
      }
    } else {
      balanceMessage += `  - \`Empty\`\n`;
    }
    balanceMessage += `-----------------------------------\n`;

    // 3. Futures Account Balance
    balanceMessage += `**Futures Account:**\n`;
    balanceMessage += `  - **Available:** \`${futuresBalance.available} USDT\`\n`;
    balanceMessage += `  - **Total Margin:** \`${futuresBalance.total} USDT\`\n`;

    await ctx.reply(balanceMessage, { parse_mode: 'Markdown' });

  } catch (error) {
    console.error('❌ [DEBUG] Error in combined /balance command:', error);
    await ctx.reply(`❌ An error occurred while fetching balances: ${error.message}`);
  }
});



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
    const session = userSessions.get(userId);
    
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
    const session = userSessions.get(ctx.from.id);
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
  const session = userSessions.get(userId);
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
    
    const session = userSessions.get(ctx.from.id);
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
    const session = userSessions.get(ctx.from.id);
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
    const session = userSessions.get(ctx.from.id);
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
  const session = userSessions.get(userId);

  // Handle menu button callbacks
  if (data.startsWith('menu_')) {
    // THIS IS THE NEW, CORRECTED CODE
    // THIS IS THE NEW, CORRECTED CODE
if (data === 'menu_balance') {
  await ctx.answerCbQuery();
  console.log('💰 [DEBUG] Balance button (callback) received from user:', ctx.from.id);
  
  // Use the exact same logic as the /balance command
  const session = userSessions.get(ctx.from.id);
  if (!session?.isInitialized) {
      return ctx.reply('Please use /start first to set up your account.');
  }

  await ctx.reply('Hold on, fetching all your balances...');

  try {
      const [onChainBalance, spotBalances, futuresBalance] = await Promise.all([
          BNBWallet.getWalletBalance(session.walletAddress),
          asterAPI.getSpotAccountBalance(session.apiKey, session.apiSecret),
          asterAPI.getAccountBalance(session.apiKey, session.apiSecret)
      ]);

      let balanceMessage = `
💰 **Your Complete Balances:**
**Address:** \`${session.walletAddress}\`
-----------------------------------
`;
      balanceMessage += `**BNB Wallet:** \`${onChainBalance} BNB\`\n`;
      balanceMessage += `**Spot Account:**\n`;

      if (Object.keys(spotBalances).length > 0) {
          for (const asset in spotBalances) {
              balanceMessage += `  - \`${spotBalances[asset].toFixed(4)} ${asset}\`\n`;
          }
      } else {
          balanceMessage += `  - \`Empty\`\n`;
      }
      balanceMessage += `-----------------------------------\n`;
      balanceMessage += `**Futures Account:**\n`;
      balanceMessage += `  - **Available:** \`${futuresBalance.available} USDT\`\n`;
      balanceMessage += `  - **Total Margin:** \`${futuresBalance.total} USDT\`\n`;

      await ctx.reply(balanceMessage, { parse_mode: 'Markdown' });

  } catch (error) {
      console.error('❌ [DEBUG] Error in combined /balance callback:', error);
      await ctx.reply(`❌ An error occurred while fetching balances: ${error.message}`);
  }
  return; // Stop further processing
}
    
    if (data === 'menu_positions') {
      await ctx.answerCbQuery();
      console.log('📊 [DEBUG] Positions button clicked by user:', ctx.from.id);
      try {
        const session = userSessions.get(ctx.from.id);
        if (!session?.isInitialized) {
          return ctx.reply('Please use /start first to set up your account.');
        }
        
        const positions = await asterAPI.getPositions(session.apiKey, session.apiSecret);
        
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
      return;
    }
    
    if (data === 'menu_long') {
      await ctx.answerCbQuery();
      return startTradingFlow(ctx, 'long');
    }
    
    if (data === 'menu_short') {
      await ctx.answerCbQuery();
      return startTradingFlow(ctx, 'short');
    }
    
    if (data === 'menu_export') {
      await ctx.answerCbQuery();
      console.log('🔑 [DEBUG] Export button clicked by user:', ctx.from.id);
      const userId = ctx.from.id;
      const session = userSessions.get(userId);

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
      return;
    }
    
    if (data === 'menu_markets') {
      await ctx.answerCbQuery();
      console.log('📋 [DEBUG] Markets button clicked by user:', ctx.from.id);
      try {
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
            return Markup.button.callback(market.symbol, `market_info_${market.symbol}`);
          });
          keyboard.push(row);
        }
        
        // Add navigation buttons
        const navButtons = [];
        if (totalPages > 1) {
          if (currentPage > 0) {
            navButtons.push(Markup.button.callback('⬅️ Previous', `markets_view_page_${currentPage - 1}`));
          }
          navButtons.push(Markup.button.callback(`Page ${currentPage + 1}/${totalPages}`, 'markets_info'));
          if (currentPage < totalPages - 1) {
            navButtons.push(Markup.button.callback('Next ➡️', `markets_view_page_${currentPage + 1}`));
          }
          keyboard.push(navButtons);
        }
        
        // Add back button
        keyboard.push([Markup.button.callback('🔙 Back to Menu', 'back_to_menu')]);
        
        const message = `📈 **Available Crypto Markets (${startIndex + 1}-${endIndex} of ${markets.length}):**\n\nClick on any market to see more details:`;
        
        await ctx.reply(message, Markup.inlineKeyboard(keyboard));
      } catch (error) {
        await ctx.reply(`❌ Unable to fetch markets: ${error.message}`);
      }
      return;
    }
    
    if (data === 'menu_close') {
      await ctx.answerCbQuery();
      console.log('❌ [DEBUG] Close button clicked by user:', ctx.from.id);
      try {
        const session = userSessions.get(ctx.from.id);
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
      return;
    }
    
    if (data === 'menu_transfer') {
      await ctx.answerCbQuery();
      await ctx.reply('💸 **Transfer Funds**\n\nTo transfer funds, use the command:\n`/transfer [amount] [asset]`\n\nExample: `/transfer 25 USDT`', { parse_mode: 'Markdown' });
    }
    
    
    return;
  }

  // Handle pagination and navigation callbacks
  if (data.startsWith('markets_page_')) {
    const page = parseInt(data.replace('markets_page_', ''));
    const session = userSessions.get(userId);
    if (!session?.tradingFlow) return;
    
    await ctx.answerCbQuery();
    
    // Update the page in the trading flow
    session.tradingFlow.page = page;
    userSessions.set(userId, session);
    
    // Get markets and create pagination
    const markets = await asterAPI.getMarkets();
    const marketsPerPage = 20;
    const totalPages = Math.ceil(markets.length / marketsPerPage);
    const startIndex = page * marketsPerPage;
    const endIndex = Math.min(startIndex + marketsPerPage, markets.length);
    const currentMarkets = markets.slice(startIndex, endIndex);
    
    // Create 4x5 grid with full button text
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
      if (page > 0) {
        navButtons.push(Markup.button.callback('⬅️ Previous', `markets_page_${page - 1}`));
      }
      navButtons.push(Markup.button.callback(`Page ${page + 1}/${totalPages}`, 'markets_info'));
      if (page < totalPages - 1) {
        navButtons.push(Markup.button.callback('Next ➡️', `markets_page_${page + 1}`));
      }
      keyboard.push(navButtons);
    }
    
    // Add back button
    keyboard.push([Markup.button.callback('🔙 Back to Menu', 'back_to_menu')]);
    
    const tradeType = session.tradingFlow.type;
    const message = tradeType === 'long' 
        ? `📈 **Open Long Position**\n\nSelect the asset (${startIndex + 1}-${endIndex} of ${markets.length}):` 
        : `📉 **Open Short Position**\n\nSelect the asset (${startIndex + 1}-${endIndex} of ${markets.length}):`;
    
    await ctx.editMessageText(message, Markup.inlineKeyboard(keyboard));
    return;
  }
  
  if (data === 'markets_info') {
    await ctx.answerCbQuery('Use the navigation buttons to browse through all available markets!');
    return;
  }
  
  if (data.startsWith('markets_view_page_')) {
    const page = parseInt(data.replace('markets_view_page_', ''));
    await ctx.answerCbQuery();
    
    try {
      const markets = await asterAPI.getMarkets();
      const marketsPerPage = 20;
      const totalPages = Math.ceil(markets.length / marketsPerPage);
      const startIndex = page * marketsPerPage;
      const endIndex = Math.min(startIndex + marketsPerPage, markets.length);
      const currentMarkets = markets.slice(startIndex, endIndex);
      
      // Create 4x5 grid with full button text
      const keyboard = [];
      for (let i = 0; i < currentMarkets.length; i += 5) {
        const row = currentMarkets.slice(i, i + 5).map(market => {
          // Use full symbol text since we have more space
          return Markup.button.callback(market.symbol, `market_info_${market.symbol}`);
        });
        keyboard.push(row);
      }
      
      // Add navigation buttons
      const navButtons = [];
      if (totalPages > 1) {
        if (page > 0) {
          navButtons.push(Markup.button.callback('⬅️ Previous', `markets_view_page_${page - 1}`));
        }
        navButtons.push(Markup.button.callback(`Page ${page + 1}/${totalPages}`, 'markets_info'));
        if (page < totalPages - 1) {
          navButtons.push(Markup.button.callback('Next ➡️', `markets_view_page_${page + 1}`));
        }
        keyboard.push(navButtons);
      }
      
      // Add back button
      keyboard.push([Markup.button.callback('🔙 Back to Menu', 'back_to_menu')]);
      
      const message = `📈 **Available Crypto Markets (${startIndex + 1}-${endIndex} of ${markets.length}):**\n\nClick on any market to see more details:`;
      
      await ctx.editMessageText(message, Markup.inlineKeyboard(keyboard));
    } catch (error) {
      await ctx.reply(`❌ Unable to fetch markets: ${error.message}`);
    }
    return;
  }
  
  if (data.startsWith('market_info_')) {
    const symbol = data.replace('market_info_', '');
    await ctx.answerCbQuery();
    
    try {
      // Get price info for the selected market
      const session = userSessions.get(userId);
      if (!session?.isInitialized) {
        return ctx.reply('Please use /start first to set up your account.');
      }
      
      const price = await asterAPI.getPrice(session.apiKey, session.apiSecret, symbol);
      
      const priceMessage = `
📊 **${symbol} Market Info**

**Current Price:** $${price.price}
**24h Change:** ${price.change24h}%
**24h High:** $${price.high24h}
**24h Low:** $${price.low24h}
**24h Volume:** $${price.volume24h}

💡 **Tip:** Use /long or /short to trade this pair!
      `;
      
      const keyboard = Markup.inlineKeyboard([
        [
          Markup.button.callback('📈 Trade Long', `trade_long_${symbol}`),
          Markup.button.callback('📉 Trade Short', `trade_short_${symbol}`)
        ],
        [Markup.button.callback('🔙 Back to Markets', 'menu_markets')]
      ]);
      
      await ctx.reply(priceMessage, { parse_mode: 'Markdown', ...keyboard });
    } catch (error) {
      await ctx.reply(`❌ Unable to fetch market info for ${symbol}: ${error.message}`);
    }
    return;
  }
  
  if (data.startsWith('trade_long_')) {
    const symbol = data.replace('trade_long_', '');
    await ctx.answerCbQuery();
    
    // Initialize trading flow and set the selected asset
    const session = userSessions.get(userId);
    if (!session?.isInitialized) {
      return ctx.reply('Please use /start first to set up your account.');
    }
    
    session.tradingFlow = { type: 'long', step: 'enter_size', asset: symbol, page: 0 };
    userSessions.set(userId, session);
    
    await ctx.reply(`📈 **Open Long Position - ${symbol}**\n\nEnter position size (in USDT):`);
    return;
  }
  
  if (data.startsWith('trade_short_')) {
    const symbol = data.replace('trade_short_', '');
    await ctx.answerCbQuery();
    
    // Initialize trading flow and set the selected asset
    const session = userSessions.get(userId);
    if (!session?.isInitialized) {
      return ctx.reply('Please use /start first to set up your account.');
    }
    
    session.tradingFlow = { type: 'short', step: 'enter_size', asset: symbol, page: 0 };
    userSessions.set(userId, session);
    
    await ctx.reply(`📉 **Open Short Position - ${symbol}**\n\nEnter position size (in USDT):`);
    return;
  }
  
  if (data === 'back_to_menu') {
    await ctx.answerCbQuery();
    // Reset trading flow and show main menu
    const session = userSessions.get(userId);
    if (session) {
      session.tradingFlow = null;
      userSessions.set(userId, session);
    }
    
    // Show main menu
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

**Wallet:** \`${session?.walletAddress || 'Not initialized'}\`

Choose an action from the menu below or use commands directly:
• Type /long or /short to trade
• Type /transfer 25 USDT to transfer funds
• Type /balance to check your balance
• Type /export to export your private key

💡 **Tip:** You can use both buttons and commands!
    `;

    await ctx.editMessageText(menuMessage, { 
      parse_mode: 'Markdown', 
      ...menuKeyboard 
    });
    return;
  }

  // Handle callbacks that are NOT part of the trading flow
  if (data.startsWith('export_confirm_')) {
      if (data === 'export_confirm_yes') {
          if (!session?.isInitialized || !session.privateKey) {
              return ctx.answerCbQuery('Please use /start first to generate a wallet.', { show_alert: true });
          }
          
          await ctx.answerCbQuery();
          await ctx.editMessageText(
              `🔑 **Your Private Key:**\n\n\`${session.privateKey}\`\n\n⚠️ **IMPORTANT:** Keep this key safe and never share it with anyone!`,
              { parse_mode: 'Markdown' }
          );
      } else if (data === 'export_confirm_no') {
          await ctx.answerCbQuery();
          await ctx.editMessageText('❌ Private key export cancelled.');
      }
      return;
  }
  
  if (data.startsWith('close_')) {
      const positionSymbol = data.replace('close_', '');
      try {
          await ctx.answerCbQuery();
          await ctx.editMessageText(`Closing position for ${positionSymbol}...`);
          
          const result = await asterAPI.closePosition(session.apiKey, session.apiSecret, positionSymbol);
          
          await ctx.editMessageText(
              `✅ **Position Closed!**\n\n` +
              `**Symbol:** ${positionSymbol}\n` +
              `**Order ID:** \`${result.orderId}\`\n` +
              `**Status:** ${result.status}`,
              { parse_mode: 'Markdown' }
          );
      } catch (error) {
          await ctx.editMessageText(`❌ Failed to close position: ${error.message}`);
      }
      return;
  }

  if (!session || !session.tradingFlow) {
      return ctx.answerCbQuery('Session expired. Please start a new command.');
  }

  // --- MAIN TRADING FLOW LOGIC ---
  try {
      const flow = session.tradingFlow;

      if (flow.step === 'select_asset' && data.startsWith('select_asset_')) {
          flow.asset = data.replace('select_asset_', '');
          flow.step = 'enter_size';
          await ctx.answerCbQuery();
          await ctx.editMessageText(`Selected: **${flow.asset}**\n\nEnter position size (in USDT):`, { parse_mode: 'Markdown' });
      }
      
      else if (flow.step === 'enter_leverage' && data.startsWith('leverage_')) {
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
      }

      else if (flow.step === 'confirm' && data === 'confirm_trade') {
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
      }

      else if (data === 'cancel_trade') {
          session.tradingFlow = null; // End the flow
          await ctx.answerCbQuery();
          await ctx.editMessageText('❌ Trade cancelled.');
      }

  } catch (error) {
      session.tradingFlow = null; // End the flow on error
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
  const session = userSessions.get(userId);

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

console.log('🚀 [DEBUG] Starting bot launch...');
bot.launch().then(() => {
  console.log('🚀 [DEBUG] AsterDex Multi-User Bot started successfully!');
  console.log('✅ [DEBUG] Bot is ready to receive commands');
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