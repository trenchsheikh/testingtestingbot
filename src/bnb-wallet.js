import { ethers } from 'ethers';

// Retrieve the RPC URL from environment variables
const BSC_RPC_URL = process.env.BSC_RPC_URL;
if (!BSC_RPC_URL) {
  console.warn('⚠️ WARNING: BSC_RPC_URL is not set in .env. On-chain balance checks will fail.');
}

// Initialize the provider once
const provider = BSC_RPC_URL ? new ethers.JsonRpcProvider(BSC_RPC_URL) : null;

export class BNBWallet {
  /**
   * Creates a new, random BEP-20 (EVM) wallet.
   */
  static createWallet() {
    const wallet = ethers.Wallet.createRandom();
    console.log(`✨ Created new wallet. Address: ${wallet.address}`);
    return {
      address: wallet.address,
      privateKey: wallet.privateKey,
    };
  }

  /**
   * Signs a message with a given private key.
   */
  static async signMessage(privateKey, message) {
    const wallet = new ethers.Wallet(privateKey);
    return await wallet.signMessage(message);
  }

  /**
   * --- NEW FUNCTION ---
   * Gets the on-chain BNB balance for a given wallet address.
   * @param {string} address - The wallet address to check.
   * @returns {Promise<string>} The formatted BNB balance as a string.
   */
  static async getWalletBalance(address) {
    if (!provider) {
        console.error('❌ Cannot get wallet balance because BSC_RPC_URL is not configured.');
        return '0.00'; // Return a default value if the provider is not available
    }
    try {
        const balanceWei = await provider.getBalance(address);
        // Format the balance from Wei to BNB, showing about 6 decimal places
        return parseFloat(ethers.formatEther(balanceWei)).toFixed(6);
    } catch (error) {
        console.error('❌ Error fetching on-chain wallet balance:', error);
        return 'Error';
    }
  }
}