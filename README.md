# 📜 Description

This project is a Telegram bot that allows multiple users to trade crypto perpetual futures on the Aster Finance exchange. Each user who starts the bot is automatically provisioned with their own unique BEP-20 wallet and a dedicated set of Aster API keys, ensuring a secure and isolated trading environment for everyone.

The bot manages user sessions in-memory and provides an interactive, menu-based flow for opening long and short positions with dynamic, asset-specific leverage.

## ✨ Features

- **Automatic User Onboarding**: New users get a unique BEP-20 wallet and Aster API keys just by sending `/start`.
- **Multi-User Architecture**: Every user's data (wallet, keys, trading state) is handled separately and securely.
- **Interactive Trading**: A clean, button-based flow for selecting assets, setting trade size, and choosing leverage.
- **Dynamic Leverage**: The bot automatically fetches and displays only the valid leverage options for each specific asset, preventing errors.
- **Core Trading Functions**: Check balances, view open positions, and initiate trades.
- **Self-Custody**: Users can export their wallet's private key after acknowledging security warnings.

## 📋 Prerequisites

Before you begin, ensure you have the following installed:

- Node.js (v18.x or later)
- npm (comes with Node.js)

## ⚙️ Setup & Installation

1. **Clone the Repository**

   ```bash
   git clone <your-repository-url>
   cd asterdexbot
   ```

2. **Install Dependencies**

   This project relies on `telegraf`, `ethers`, `axios`, and `dotenv`. Install them via npm:

   ```bash
   npm install
   ```

3. **Create the Configuration File**

   The bot uses a `.env` file for its Telegram token. Create this file in the project's root directory:

   ```bash
   touch .env
   ```

## 🔑 Configuration

The multi-user architecture simplifies configuration significantly. The only secret you need is your Telegram Bot Token.

- **Get a Telegram Bot Token**:
  - Open Telegram and search for the user `@BotFather`.
  - Send the `/newbot` command and follow the prompts.
  - BotFather will give you a unique token.

- **Add the Token to your `.env` file**:

   ```plaintext
   # Telegram Bot Configuration
   TELEGRAM_BOT_TOKEN=YOUR_TELEGRAM_BOT_TOKEN_HERE
   ```

**Note**: You do not need to provide `ASTER_API_KEY` or `BNB_PRIVATE_KEY` in the `.env` file. The bot securely generates these for each individual user when they start a conversation.

## 🚀 Running the Bot

- **For Development** (with automatic restart on file changes):

   ```bash
   npm run dev
   ```

- **For Production**:

   ```bash
   npm start
   ```

Once started, find your bot on Telegram and send the `/start` command to begin.

## 🤖 Available Commands

- `/start` - Initializes your session, creating a unique wallet and API keys.
- `/help` - Shows the list of available commands.
- `/balance` - Checks your futures account balance.
- `/positions` - Views your open trading positions.
- `/long` - Starts the interactive flow to open a long position.
- `/short` - Starts the interactive flow to open a short position.
- `/cancel` - Cancels your current action (e.g., an unfinished trade).
- `/export` - Starts the secure flow to export your wallet's private key.

## ⚠️ IMPORTANT: Security & Production Use ⚠️

This bot is designed to create and manage private keys for users. The current implementation stores these keys unencrypted in an in-memory `Map` (`userSessions` in `src/index.js`).

**This is NOT secure for a production environment.**

- **Data Loss**: If the bot restarts, all user wallets and API keys will be lost.
- **Security Risk**: Storing unencrypted private keys in memory is a significant security risk.

For a real-world application, you **MUST** replace the `userSessions` `Map` with a secure, persistent database (like PostgreSQL with encryption, or a secrets manager like HashiCorp Vault).

## 🏗️ Project Structure

```
src/
├── index.js          # Main bot logic, command handlers, and session management
├── asterdex.js       # All communication with the AsterDex API
└── bnb-wallet.js     # Utilities for creating BEP-20 wallets and signing messages
```