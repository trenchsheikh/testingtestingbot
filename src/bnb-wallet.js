
import { ethers } from 'ethers';

export class BNBWallet {
  /**
   * Creates a new, random BEP-20 (EVM) wallet.
   * This is a static method, so you don't need to create an instance of BNBWallet to use it.
   * @returns {{address: string, privateKey: string}} The new wallet's address and private key.
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
   * @param {string} privateKey - The private key to sign with.
   * @param {string} message - The message to sign.
   * @returns {Promise<string>} The resulting signature.
   */
  static async signMessage(privateKey, message) {
    const wallet = new ethers.Wallet(privateKey);
    return await wallet.signMessage(message);
  }
}