import { ethers } from 'ethers';
import axios from 'axios';

export class BNBWallet {
  constructor() {
    this.privateKey = process.env.BNB_PRIVATE_KEY;
    this.rpcUrl = process.env.BNB_RPC_URL || 'https://bsc-dataseed.binance.org';
    
    if (!this.privateKey) {
      throw new Error('Missing BNB_PRIVATE_KEY in environment variables');
    }

    this.wallet = new ethers.Wallet(this.privateKey);
    this.provider = new ethers.JsonRpcProvider(this.rpcUrl);
    this.wallet = this.wallet.connect(this.provider);
  }

  // Get wallet address
  getAddress() {
    return this.wallet.address;
  }

  // Get BNB balance
  async getBalance() {
    try {
      const balance = await this.provider.getBalance(this.wallet.address);
      return parseFloat(ethers.formatEther(balance));
    } catch (error) {
      console.error('Error getting BNB balance:', error);
      return 0;
    }
  }

  // Get BEP-20 token balance
  async getTokenBalance(tokenAddress) {
    try {
      const tokenContract = new ethers.Contract(
        tokenAddress,
        [
          'function balanceOf(address owner) view returns (uint256)',
          'function decimals() view returns (uint8)',
          'function symbol() view returns (string)'
        ],
        this.wallet
      );

      const [balance, decimals, symbol] = await Promise.all([
        tokenContract.balanceOf(this.wallet.address),
        tokenContract.decimals(),
        tokenContract.symbol()
      ]);

      return {
        balance: parseFloat(ethers.formatUnits(balance, decimals)),
        decimals,
        symbol
      };
    } catch (error) {
      console.error('Error getting token balance:', error);
      return { balance: 0, decimals: 18, symbol: 'UNKNOWN' };
    }
  }

  // Send BNB transaction
  async sendBNB(to, amount) {
    try {
      const tx = await this.wallet.sendTransaction({
        to,
        value: ethers.parseEther(amount.toString())
      });

      await tx.wait();
      return tx.hash;
    } catch (error) {
      throw new Error(`Failed to send BNB: ${error.message}`);
    }
  }

  // Send BEP-20 token transaction
  async sendToken(tokenAddress, to, amount) {
    try {
      const tokenContract = new ethers.Contract(
        tokenAddress,
        [
          'function transfer(address to, uint256 amount) returns (bool)',
          'function decimals() view returns (uint8)'
        ],
        this.wallet
      );

      const decimals = await tokenContract.decimals();
      const amountWei = ethers.parseUnits(amount.toString(), decimals);

      const tx = await tokenContract.transfer(to, amountWei);
      await tx.wait();
      return tx.hash;
    } catch (error) {
      throw new Error(`Failed to send token: ${error.message}`);
    }
  }

  // Get transaction history
  async getTransactionHistory(limit = 20) {
    try {
      // Using BSCScan API for transaction history
      const apiKey = process.env.BSCSCAN_API_KEY;
      if (!apiKey) {
        console.warn('BSCSCAN_API_KEY not provided, using mock data');
        return this.getMockTransactionHistory();
      }

      const response = await axios.get(
        `https://api.bscscan.com/api?module=account&action=txlist&address=${this.wallet.address}&startblock=0&endblock=99999999&page=1&offset=${limit}&sort=desc&apikey=${apiKey}`
      );

      if (response.data.status === '1') {
        return response.data.result.map(tx => ({
          hash: tx.hash,
          from: tx.from,
          to: tx.to,
          value: ethers.formatEther(tx.value),
          timestamp: parseInt(tx.timeStamp),
          gasUsed: tx.gasUsed,
          gasPrice: tx.gasPrice,
          status: tx.isError === '0' ? 'success' : 'failed'
        }));
      }

      return [];
    } catch (error) {
      console.error('Error getting transaction history:', error);
      return this.getMockTransactionHistory();
    }
  }

  // Mock transaction history for development
  getMockTransactionHistory() {
    return [
      {
        hash: '0x1234567890abcdef...',
        from: this.wallet.address,
        to: '0x742d35Cc6634C0532925a3b8D4C9db96C4b4d8b6',
        value: '0.1',
        timestamp: Date.now() - 3600000,
        gasUsed: '21000',
        gasPrice: '5000000000',
        status: 'success'
      }
    ];
  }

  // Get gas price
  async getGasPrice() {
    try {
      const feeData = await this.provider.getFeeData();
      return {
        gasPrice: ethers.formatUnits(feeData.gasPrice, 'gwei'),
        maxFeePerGas: feeData.maxFeePerGas ? ethers.formatUnits(feeData.maxFeePerGas, 'gwei') : null,
        maxPriorityFeePerGas: feeData.maxPriorityFeePerGas ? ethers.formatUnits(feeData.maxPriorityFeePerGas, 'gwei') : null
      };
    } catch (error) {
      console.error('Error getting gas price:', error);
      return { gasPrice: '5', maxFeePerGas: null, maxPriorityFeePerGas: null };
    }
  }

  // Estimate gas for transaction
  async estimateGas(to, value = '0', data = '0x') {
    try {
      const gasEstimate = await this.provider.estimateGas({
        to,
        value: ethers.parseEther(value),
        data
      });
      return gasEstimate.toString();
    } catch (error) {
      console.error('Error estimating gas:', error);
      return '21000'; // Default gas limit
    }
  }

  // Check if address is valid
  static isValidAddress(address) {
    return ethers.isAddress(address);
  }

  // Get network info
  async getNetworkInfo() {
    try {
      const network = await this.provider.getNetwork();
      const blockNumber = await this.provider.getBlockNumber();
      
      return {
        name: network.name,
        chainId: network.chainId,
        blockNumber,
        rpcUrl: this.rpcUrl
      };
    } catch (error) {
      console.error('Error getting network info:', error);
      return {
        name: 'BSC',
        chainId: 56,
        blockNumber: 0,
        rpcUrl: this.rpcUrl
      };
    }
  }
}
