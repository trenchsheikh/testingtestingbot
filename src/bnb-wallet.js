// src/bnb-wallet.js
import { ethers } from 'ethers';

const BSC_RPC_URL = process.env.BSC_RPC_URL;
if (!BSC_RPC_URL) {
  console.warn('⚠️ WARNING: BSC_RPC_URL is not set in .env. On-chain transactions will fail.');
}

const provider = BSC_RPC_URL ? new ethers.JsonRpcProvider(BSC_RPC_URL) : null;

// USDT Contract Details on Binance Smart Chain
const USDT_CONTRACT_ADDRESS = '0x55d398326f99059ff775485246999027b3197955';
const ERC20_ABI = [
  "function balanceOf(address owner) view returns (uint256)",
  "function decimals() view returns (uint8)",
  "function transfer(address to, uint amount) returns (bool)"
];

export class BNBWallet {
  // createWallet remains the same
  static createWallet() {
    const wallet = ethers.Wallet.createRandom();
    console.log(`✨ Created new wallet. Address: ${wallet.address}`);
    return { address: wallet.address, privateKey: wallet.privateKey };
  }

  // signMessage remains the same
  static async signMessage(privateKey, message) {
    const wallet = new ethers.Wallet(privateKey);
    return await wallet.signMessage(message);
  }

  // getWalletBalance (for BNB) remains the same
  static async getWalletBalance(address) {
    if (!provider) return '0.00';
    try {
        const balanceWei = await provider.getBalance(address);
        return parseFloat(ethers.formatEther(balanceWei)).toFixed(6);
    } catch (error) {
        console.error('❌ Error fetching on-chain BNB balance:', error);
        return 'Error';
    }
  }

  // getUsdtBalance remains the same
  static async getUsdtBalance(address) {
    if (!provider) return '0.00';
    try {
        const usdtContract = new ethers.Contract(USDT_CONTRACT_ADDRESS, ERC20_ABI, provider);
        const balanceRaw = await usdtContract.balanceOf(address);
        const decimals = await usdtContract.decimals();
        return parseFloat(ethers.formatUnits(balanceRaw, decimals)).toFixed(4);
    } catch (error) {
        console.error('❌ Error fetching on-chain USDT balance:', error);
        return 'Error';
    }
  }

  /**
   * --- NEW FUNCTION: SEND USDT ---
   * Creates and sends a standard USDT transfer transaction.
   */
  static async sendUsdt(privateKey, recipientAddress, amount) {
    if (!provider) throw new Error("BSC_RPC_URL not configured.");
    
    const wallet = new ethers.Wallet(privateKey, provider);
    const usdtContract = new ethers.Contract(USDT_CONTRACT_ADDRESS, ERC20_ABI, wallet);
    const decimals = await usdtContract.decimals();
    const amountToSend = ethers.parseUnits(amount.toString(), decimals);

    console.log(`💸 [DEBUG] Sending ${amount} USDT to ${recipientAddress}...`);
    const tx = await usdtContract.transfer(recipientAddress, amountToSend);
    await tx.wait(); // Wait for the transaction to be mined
    console.log(`✅ [DEBUG] USDT transfer successful: ${tx.hash}`);
    return tx;
  }
}