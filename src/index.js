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
Use /help to see all commands.
      `;
      console.log('📤 [DEBUG] Sending welcome message to user');
      await ctx.reply(welcomeMessage, { parse_mode: 'Markdown' });
      console.log('✅ [DEBUG] Welcome message sent successfully');

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
  console.log('💰 [DEBUG] /balance command received from user:', ctx.from.id);
  try {
    const session = userSessions.get(ctx.from.id);
    console.log('🔍 [DEBUG] Session exists:', !!session);
    console.log('🔍 [DEBUG] Session initialized:', session?.isInitialized);
    
    if (!session?.isInitialized) {
      console.log('❌ [DEBUG] User not initialized, returning error message');
      return ctx.reply('Please use /start first to set up your account.');
    }

    console.log('🔑 [DEBUG] User has API keys, fetching balance...');
    console.log('🔑 [DEBUG] API Key exists:', !!session.apiKey);
    console.log('🔑 [DEBUG] API Secret exists:', !!session.apiSecret);
    
    // Pass the user's unique keys to the API method
    console.log('🌐 [DEBUG] Calling asterAPI.getAccountBalance...');
    const futuresBalance = await asterAPI.getAccountBalance(session.apiKey, session.apiSecret);
    console.log('✅ [DEBUG] Balance received:', futuresBalance);
    
    const balanceMessage = `
💰 **Your Balances:**
**Wallet:** \`${session.walletAddress}\`
**Futures Account:** ${futuresBalance.available} USDT
**Total Margin:** ${futuresBalance.total} USDT
    `;
    console.log('📤 [DEBUG] Sending balance message to user');
    await ctx.reply(balanceMessage, { parse_mode: 'Markdown' });
    console.log('✅ [DEBUG] Balance message sent successfully');
  } catch (error) {
    console.error('❌ [DEBUG] Error in /balance command:', error);
    console.error('❌ [DEBUG] Error stack:', error.stack);
    await ctx.reply(`❌ Unable to fetch balance: ${error.message}`);
  }
});

// Add this entire function to the end of src/index.js, before bot.launch()

// Handle text messages for position size and dynamic leverage
bot.on('text', async (ctx) => {
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

// Transfer command - Transfer from spot to futures using v3 API
bot.command('transfer', async (ctx) => {
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
  session.tradingFlow = { type: tradeType, step: 'select_asset' };
  userSessions.set(userId, session);

  // FIX: getMarkets is a public call and doesn't need API keys
  const markets = await asterAPI.getMarkets(); 
  
  const keyboard = markets.slice(0, 10).map(market =>
      [Markup.button.callback(market.symbol, `select_asset_${market.symbol}`)]
  );
  const message = tradeType === 'long' 
      ? '📈 **Open Long Position**\n\nSelect the asset:' 
      : '📉 **Open Short Position**\n\nSelect the asset:';
  await ctx.reply(message, Markup.inlineKeyboard(keyboard));
};

bot.command('long', (ctx) => startTradingFlow(ctx, 'long'));
bot.command('short', (ctx) => startTradingFlow(ctx, 'short'));

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

// Handle callback queries for interactive flows
bot.on('callback_query', async (ctx) => {
  const data = ctx.callbackQuery.data;
  const userId = ctx.from.id;
  const session = userSessions.get(userId);

  // Handle callbacks that are NOT part of the trading flow
  if (data.startsWith('export_confirm_')) {
      // ... (insert your working export logic here)
      return;
  }
  if (data.startsWith('close_')) {
      // ... (insert your working close logic here)
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