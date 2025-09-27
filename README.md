# 🚀 AsterDex Trading Bot

A comprehensive Telegram bot for trading crypto perpetual futures on the Aster Finance exchange. This bot provides a user-friendly interface for managing trades, positions, and account balances with advanced features like dynamic leverage detection and symbol validation.

## 📋 Table of Contents

- [Features](#-features)
- [Prerequisites](#-prerequisites)
- [Installation](#-installation)
- [Configuration](#-configuration)
- [Usage Guide](#-usage-guide)
- [API Reference](#-api-reference)
- [Architecture](#-architecture)
- [Security](#-security)
- [Deployment](#-deployment)
- [Contributing](#-contributing)
- [License](#-license)

## ✨ Features

### 🔐 **Multi-User Architecture**
- **Automatic User Onboarding**: Each user gets a unique BEP-20 wallet and Aster API keys
- **Session Management**: Secure, isolated trading environments for all users
- **In-Memory Storage**: User data stored in memory during bot session

### 📈 **Advanced Trading Features**
- **Interactive Trading Interface**: Clean, button-based flow for all trading operations
- **Dynamic Leverage Detection**: Automatically fetches and validates leverage options for each asset
- **Symbol Validation**: Real-time testing of trading symbols to ensure compatibility
- **Smart Error Handling**: Comprehensive error messages and user guidance

### 🎯 **User Experience**
- **Intuitive Menu System**: Easy-to-use button-based navigation
- **Real-time Market Data**: Live price feeds and market information
- **Position Management**: Complete position tracking and management
- **Balance Monitoring**: Real-time account balance updates

### 🔧 **Technical Features**
- **Symbol Support Testing**: Automatic validation of 100+ trading symbols
- **Leverage Optimization**: Smart leverage detection and adjustment
- **Error Recovery**: Robust error handling and user guidance
- **Performance Optimization**: Fast execution with minimal latency

## 📋 Prerequisites

Before you begin, ensure you have the following installed:

- **Node.js** (v18.x or later)
- **npm** (comes with Node.js)
- **Git** (for cloning the repository)
- **Telegram Account** (for bot interaction)

## ⚙️ Installation

### 1. Clone the Repository

   ```bash
   git clone <your-repository-url>
   cd asterdexbot
   ```

### 2. Install Dependencies

   ```bash
   npm install
   ```

### 3. Environment Setup

Create a `.env` file in the project root:

   ```bash
   touch .env
   ```

Add your configuration:

```env
# Telegram Bot Configuration
TELEGRAM_BOT_TOKEN=your_telegram_bot_token_here
```

## 🔑 Configuration

### Telegram Bot Setup

1. **Create a Bot**:
   - Open Telegram and search for `@BotFather`
   - Send `/newbot` and follow the prompts
   - Copy the bot token provided

2. **Add Token to Environment**:
   ```env
   TELEGRAM_BOT_TOKEN=1234567890:ABCdefGHIjklMNOpqrsTUVwxyz
   ```


## 🚀 Running the Bot

### Development Mode

   ```bash
   npm run dev
   ```

### Production Mode

   ```bash
   npm start
   ```

### Docker (Optional)

```bash
docker build -t asterdexbot .
docker run -d --name asterdexbot --env-file .env asterdexbot
```

## 📖 Usage Guide

### Getting Started

1. **Start the Bot**: Send `/start` to initialize your account
2. **Automatic Setup**: The bot creates your wallet and API keys
3. **Begin Trading**: Use the menu buttons or commands to start trading

### Available Commands

#### Core Commands
- `/start` - Initialize your account and create wallet
- `/help` - Show available commands and features
- `/menu` - Display the main trading menu

#### Trading Commands
- `/long` - Open a long position
- `/short` - Open a short position
- `/close` - Close existing positions
- `/positions` - View all open positions

#### Account Commands
- `/balance` - Check your account balance
- `/export` - Export your wallet private key
- `/transfer` - Transfer funds between accounts

#### Market Commands
- `/markets` - Browse available trading markets
- `/price <symbol>` - Get current price for a symbol

### Trading Flow

#### Opening a Position

1. **Select Market**: Choose from 100+ available trading pairs
2. **Set Parameters**: Enter position size and leverage
3. **Confirm Trade**: Review and confirm your trade
4. **Monitor Position**: Track your position in real-time

#### Closing a Position

1. **View Positions**: Use `/positions` to see open trades
2. **Select Position**: Choose which position to close
3. **Confirm Close**: Review and confirm the closure

### Menu Navigation

The bot features an intuitive menu system:

```
🏠 Main Menu
├── 💰 Balance
├── 📈 Positions
├── 📊 Markets
├── 🔄 Transfer
├── 🔑 Export Key
└── ❓ Help
```

## 🔧 API Reference

### Core Functions

#### `startTradingFlow(symbol, side)`
Initiates the trading flow for a specific symbol and side.

**Parameters:**
- `symbol` (string): Trading pair symbol (e.g., 'BTCUSDT')
- `side` (string): 'long' or 'short'

#### `placeOrder(orderData)`
Places a trading order with the specified parameters.

**Parameters:**
- `orderData` (object): Order configuration
  - `symbol` (string): Trading pair
  - `side` (string): 'long' or 'short'
  - `size` (number): Position size in USDT
  - `leverage` (number): Leverage multiplier


## 🏗️ Architecture

### Project Structure

```
src/
├── index.js              # Main bot logic and command handlers
├── asterdex.js           # AsterDex API integration
└── bnb-wallet.js         # BEP-20 wallet utilities
```

### Key Components

#### 1. **Bot Controller** (`index.js`)
- Handles all Telegram interactions
- Manages user sessions and state
- Coordinates trading operations

#### 2. **API Client** (`asterdex.js`)
- Interfaces with AsterDex trading API
- Handles authentication and requests
- Manages order placement and position tracking

#### 3. **Wallet Manager** (`bnb-wallet.js`)
- Creates and manages BEP-20 wallets
- Handles message signing for API authentication
- Manages private key operations


## 🔒 Security

### Data Protection

- **Session Isolation**: Each user's data is completely isolated
- **API Key Security**: API keys are generated per user and stored in memory
- **In-Memory Storage**: User data stored securely in memory during bot session

### Best Practices

- **Environment Variables**: All sensitive data stored in environment variables
- **Input Validation**: All user inputs are validated and sanitized
- **Error Handling**: Comprehensive error handling prevents data leaks
- **Rate Limiting**: Built-in rate limiting prevents abuse

### Production Considerations

- **Data Persistence**: Consider implementing database storage for production
- **Key Management**: Consider using a key management service
- **Monitoring**: Implement comprehensive logging and monitoring
- **Session Management**: Implement persistent session storage


## 📊 Monitoring and Analytics

### Built-in Metrics

- **User Activity**: Track user engagement and trading patterns
- **Error Tracking**: Comprehensive error logging and analysis
- **Performance Metrics**: Response times and system performance
- **Symbol Support**: Track which symbols are supported and their leverage limits

## 🤝 Contributing

We welcome contributions! Please follow these steps:

1. **Fork the Repository**: Create your own fork
2. **Create Feature Branch**: `git checkout -b feature/amazing-feature`
3. **Commit Changes**: `git commit -m 'Add amazing feature'`
4. **Push to Branch**: `git push origin feature/amazing-feature`
5. **Open Pull Request**: Submit your changes for review

### Development Guidelines

- **Code Style**: Follow existing code patterns and conventions
- **Testing**: Add tests for new features
- **Documentation**: Update documentation for new features
- **Security**: Ensure all changes maintain security standards

## 📝 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## 🆘 Support

### Getting Help

- **Documentation**: Check this README and inline code comments
- **Issues**: Report bugs and request features via GitHub Issues
- **Discussions**: Join community discussions for questions and ideas

### Common Issues

#### Bot Not Responding
- Check if the bot token is correct
- Verify the bot is running and connected
- Check for error messages in the console

#### Trading Errors
- Ensure sufficient balance for trades
- Check if the symbol is supported
- Verify leverage settings are valid

#### Session Issues
- Check if user session exists
- Verify API keys are properly generated
- Restart bot if sessions are corrupted

## 🔄 Changelog

### Version 2.0.0
- Added comprehensive symbol validation
- Enhanced user interface with menu system
- Improved error handling and user guidance
- Added dynamic leverage detection
- Implemented interactive trading flow

### Version 1.0.0
- Initial release with basic trading functionality
- Multi-user architecture
- Basic position management
- Wallet creation and management

## 📞 Contact

- **Developer**: [Your Name]
- **Email**: [your-email@example.com]
- **GitHub**: [your-github-username]
- **Telegram**: [@your-telegram-username]

---

**⚠️ Disclaimer**: This bot is for educational and development purposes. Always test thoroughly before using in production. Trading cryptocurrencies involves risk, and you should never trade with money you cannot afford to lose.