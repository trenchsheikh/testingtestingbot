# AsterDex BNB Trading Bot

A Telegram bot that replicates Asterbot functionality for BNB trading on AsterDex platform.

## Features

- **Complete Asterbot Interface**: All commands from the original Asterbot
- **BNB Trading**: Trade BNB pairs on AsterDex through Telegram
- **Interactive Trading**: Step-by-step position opening with buttons
- **Real-time Data**: Live prices, balances, and position tracking
- **Secure**: Private key management and API authentication

## Commands

### Getting Started
- `/start` - Initialize your account and generate wallet addresses
- `/help` - Show all available commands

### Wallet & Balance
- `/balance` - Check BNB and trading account balances
- `/deposit [amount|all]` - Deposit BNB to trading account
- `/export` - Export wallet keys (redirects to web interface)

### Trading
- `/long` - Open long position (interactive flow)
- `/short` - Open short position (interactive flow)
- `/close` - Close existing positions
- `/positions [symbol]` - View your trading positions

### Market Information
- `/price [symbol]` - Get current market prices
- `/markets` - List all available BNB pairs

## Setup

### Prerequisites
- Node.js 18+
- Telegram Bot Token (from @BotFather)
- AsterDex API credentials
- BNB wallet private key

### Installation

1. **Clone and install dependencies:**
   ```bash
   npm install
   ```

2. **Create environment file:**
   Create a `.env` file in the project root:
   ```env
   # Telegram Bot Configuration
   TELEGRAM_BOT_TOKEN=your_telegram_bot_token_here
   
   # AsterDex API Configuration
   ASTER_API_KEY=your_asterdex_api_key_here
   ASTER_API_SECRET=your_asterdex_api_secret_here
   
   # BNB Wallet Configuration
   BNB_PRIVATE_KEY=your_bnb_private_key_here
   BNB_RPC_URL=https://bsc-dataseed.binance.org
   
   # Optional: BSCScan API for transaction history
   BSCSCAN_API_KEY=your_bscscan_api_key_here
   ```

3. **Get API credentials:**
   - **Telegram Bot**: Message @BotFather on Telegram
   - **AsterDex API**: Get from AsterDex platform settings
   - **BNB Private Key**: Export from MetaMask, Trust Wallet, or generate new
   - **BSCScan API**: Get free API key from bscscan.com (optional)

4. **Run the bot:**
   ```bash
   npm start
   ```

## Usage Examples

### Basic Trading Flow
1. Start the bot: `/start`
2. Check balance: `/balance`
3. Deposit funds: `/deposit 0.1`
4. View markets: `/markets`
5. Open position: `/long` (interactive flow)
6. Check positions: `/positions`
7. Close position: `/close`

### Interactive Trading
- Use `/long` or `/short` to start interactive trading
- Select asset from buttons
- Enter position size
- Choose leverage (2x, 5x, 10x, 20x, 50x, 100x)
- Confirm trade

## Security Notes

⚠️ **Important Security Considerations:**

- **Use a dedicated wallet** for the bot with limited funds
- **Never share your private keys** or API credentials
- **Keep your `.env` file secure** and never commit it to version control
- **Test with small amounts** first
- **Monitor your positions** regularly

## API Integration

The bot integrates with:
- **AsterDex API**: For trading operations and market data
- **BSC Network**: For BNB wallet operations
- **BSCScan API**: For transaction history (optional)

## Development

### Project Structure
```
src/
├── index.js          # Main bot logic and commands
├── asterdex.js       # AsterDex API integration
└── bnb-wallet.js     # BNB wallet operations
```

### Adding New Features
- Commands: Add new command handlers in `src/index.js`
- API methods: Extend `AsterAPI` class in `src/asterdex.js`
- Wallet operations: Add methods to `BNBWallet` class in `src/bnb-wallet.js`

## Troubleshooting

### Common Issues

1. **"Missing environment variables"**
   - Check your `.env` file has all required variables

2. **"API Error"**
   - Verify your AsterDex API credentials
   - Check if API endpoints are accessible

3. **"Failed to send BNB"**
   - Ensure sufficient BNB for gas fees
   - Check BSC network connection

4. **"No positions found"**
   - Make sure you have open positions
   - Check if symbol filter is correct

### Getting Help
- Check the logs for detailed error messages
- Verify all API credentials are correct
- Ensure sufficient BNB balance for gas fees

## License

MIT License - Feel free to modify and distribute.

## Disclaimer

This bot is for educational purposes. Trading cryptocurrencies involves risk. Use at your own risk and never invest more than you can afford to lose.
