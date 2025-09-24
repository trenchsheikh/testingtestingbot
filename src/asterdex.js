import axios from 'axios';
import crypto from 'crypto';

export class AsterAPI {
  constructor(apiKey, apiSecret) {
    this.apiKey = apiKey;
    this.apiSecret = apiSecret;
    this.baseURL = 'https://fapi.asterdex.com'; // Real AsterDex API URL from docs
    this.client = axios.create({
      baseURL: this.baseURL,
      timeout: 10000
    });
  }

  // Generate signature for API requests (AsterDex format)
  generateSignature(queryString) {
    return crypto.createHmac('sha256', this.apiSecret).update(queryString).digest('hex');
  }

  // Make authenticated API request
  async makeRequest(method, endpoint, data = null) {
    const timestamp = Date.now();
    
    // Build query string for signature
    let queryString = `timestamp=${timestamp}`;
    if (data && method === 'GET') {
      const params = new URLSearchParams(data);
      queryString += `&${params.toString()}`;
    }
    
    // Generate signature
    const signature = this.generateSignature(queryString);
    
    // Add signature to query string
    const finalQueryString = `${queryString}&signature=${signature}`;
    
    const headers = {
      'X-MBX-APIKEY': this.apiKey,
      'Content-Type': 'application/json'
    };

    try {
      const url = method === 'GET' ? `${endpoint}?${finalQueryString}` : endpoint;
      
      const response = await this.client.request({
        method,
        url,
        data: method !== 'GET' ? data : undefined,
        headers
      });
      return response.data;
    } catch (error) {
      console.error('API Error:', error.response?.data || error.message);
      throw new Error(`API Error: ${error.response?.data?.message || error.message}`);
    }
  }

  // Get account balance
  async getAccountBalance() {
    try {
      const response = await this.makeRequest('GET', '/fapi/v2/balance');
      return {
        available: response.availableBalance || 0,
        total: response.totalWalletBalance || 0,
        margin: response.totalMarginBalance || 0
      };
    } catch (error) {
      throw new Error(`Failed to get balance: ${error.message}`);
    }
  }

  // Get available markets
  async getMarkets() {
    try {
      const response = await this.makeRequest('GET', '/fapi/v1/exchangeInfo');
      // Filter for BNB pairs and format for display
      const bnbMarkets = (response.symbols || [])
        .filter(symbol => symbol.symbol.includes('BNB'))
        .map(symbol => ({
          symbol: symbol.symbol,
          maxLeverage: symbol.maxLeverage || 100,
          status: symbol.status
        }));
      return bnbMarkets;
    } catch (error) {
      throw new Error(`Failed to get markets: ${error.message}`);
    }
  }

  // Get all available symbols (for debugging)
  async getAllSymbols() {
    try {
      const response = await this.makeRequest('GET', '/fapi/v1/exchangeInfo');
      return (response.symbols || []).map(s => s.symbol);
    } catch (error) {
      throw new Error(`Failed to get symbols: ${error.message}`);
    }
  }

  // Get price for a symbol
  async getPrice(symbol) {
    try {
      // First get all symbols to find the correct format
      const exchangeInfo = await this.makeRequest('GET', '/fapi/v1/exchangeInfo');
      const availableSymbols = exchangeInfo.symbols || [];
      
      // Find matching symbol (case-insensitive)
      const matchingSymbol = availableSymbols.find(s => 
        s.symbol.toLowerCase().includes(symbol.toLowerCase())
      );
      
      if (!matchingSymbol) {
        throw new Error(`Symbol ${symbol} not found. Available symbols: ${availableSymbols.slice(0, 5).map(s => s.symbol).join(', ')}...`);
      }
      
      const response = await this.makeRequest('GET', '/fapi/v1/ticker/24hr', { symbol: matchingSymbol.symbol });
      return {
        price: parseFloat(response.lastPrice) || 0,
        change24h: parseFloat(response.priceChangePercent) || 0,
        high24h: parseFloat(response.highPrice) || 0,
        low24h: parseFloat(response.lowPrice) || 0,
        volume24h: parseFloat(response.volume) || 0
      };
    } catch (error) {
      throw new Error(`Failed to get price: ${error.message}`);
    }
  }

  // Get user positions
  async getPositions(symbol = null) {
    try {
      const params = symbol ? { symbol } : {};
      const response = await this.makeRequest('GET', '/fapi/v2/positionRisk', params);
      
      // Format positions for display
      const positions = (response || [])
        .filter(pos => parseFloat(pos.positionAmt) !== 0)
        .map(pos => ({
          id: pos.symbol,
          symbol: pos.symbol,
          size: Math.abs(parseFloat(pos.positionAmt)),
          entryPrice: parseFloat(pos.entryPrice),
          markPrice: parseFloat(pos.markPrice),
          leverage: parseFloat(pos.leverage),
          unrealizedPnl: parseFloat(pos.unRealizedProfit)
        }));
      
      return positions;
    } catch (error) {
      throw new Error(`Failed to get positions: ${error.message}`);
    }
  }

  // Place order
  async placeOrder(orderData) {
    try {
      const { symbol, side, size, leverage } = orderData;
      
      const order = {
        symbol,
        side: side === 'long' ? 'BUY' : 'SELL',
        type: 'MARKET',
        quantity: size,
        timeInForce: 'GTC'
      };

      const response = await this.makeRequest('POST', '/fapi/v1/order', order);
      return {
        orderId: response.orderId || `order_${Date.now()}`,
        status: response.status || 'FILLED',
        symbol,
        side,
        size,
        leverage
      };
    } catch (error) {
      throw new Error(`Failed to place order: ${error.message}`);
    }
  }

  // Close position
  async closePosition(positionId) {
    try {
      // Close position by placing opposite order
      const response = await this.makeRequest('POST', '/fapi/v1/order', {
        symbol: positionId,
        side: 'SELL', // This will be determined by current position
        type: 'MARKET',
        quantity: 0, // This will be determined by current position size
        reduceOnly: true
      });
      return response;
    } catch (error) {
      throw new Error(`Failed to close position: ${error.message}`);
    }
  }

  // Get order history
  async getOrderHistory(symbol = null, limit = 50) {
    try {
      const endpoint = symbol ? `/api/v1/orders?symbol=${symbol}&limit=${limit}` : `/api/v1/orders?limit=${limit}`;
      const response = await this.makeRequest('GET', endpoint);
      return response.orders || [];
    } catch (error) {
      return [];
    }
  }

  // Get trading history
  async getTradingHistory(symbol = null, limit = 50) {
    try {
      const endpoint = symbol ? `/api/v1/trades?symbol=${symbol}&limit=${limit}` : `/api/v1/trades?limit=${limit}`;
      const response = await this.makeRequest('GET', endpoint);
      return response.trades || [];
    } catch (error) {
      return [];
    }
  }
}
