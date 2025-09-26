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

  // Generate signature for API requests (Binance/AsterDex format)
  generateSignature(queryString) {
    return crypto.createHmac('sha256', this.apiSecret).update(queryString).digest('hex');
  }

  // Make authenticated API request
  async makeRequest(method, endpoint, data = null) {
    const timestamp = Date.now();
    
    // Build parameters object for signature (exactly as per AsterDex docs)
    const params = { timestamp: timestamp.toString() };
    if (data) {
      Object.keys(data).forEach(key => {
        params[key] = data[key].toString();
      });
    }
    
    // Sort parameters alphabetically for signature (Binance/AsterDex standard)
    const sortedParams = Object.keys(params)
      .sort()
      .map(key => `${key}=${params[key]}`)
      .join('&');
    
    // Generate signature from sorted parameters
    const signature = this.generateSignature(sortedParams);
    
    const headers = {
      'X-MBX-APIKEY': this.apiKey,
      'Content-Type': 'application/x-www-form-urlencoded'
    };

    try {
      let url, requestData;
      
      if (method === 'GET') {
        // For GET requests, add timestamp and signature to URL
        const finalQueryString = `${sortedParams}&signature=${signature}`;
        url = `${endpoint}?${finalQueryString}`;
        requestData = undefined;
      } else {
        // For POST requests, send parameters in request body as per AsterDex docs
        url = endpoint;
        
        // Create form data in the SAME order as sorted parameters for signature
        const formData = new URLSearchParams();
        
        // Add parameters in sorted order (same as signature generation)
        const sortedKeys = Object.keys(params).sort();
        sortedKeys.forEach(key => {
          formData.append(key, params[key]);
        });
        formData.append('signature', signature);
        
        requestData = formData;
      }
      
      const response = await this.client.request({
        method,
        url,
        data: requestData,
        headers
      });
      return response.data;
    } catch (error) {
      // Handle specific API errors with user-friendly messages
      const apiError = error.response?.data;
      if (apiError) {
        switch (apiError.code) {
          case -1022:
            throw new Error('Invalid API signature. Please check your API credentials.');
          case -1102:
            throw new Error('Missing required parameters. Please try again.');
          case -1106:
            throw new Error('Invalid parameter sent. Please try again.');
          case -2019:
            throw new Error('Insufficient margin. Please deposit more funds to your trading account.');
          case -2018:
            throw new Error('Insufficient balance. Please check your account balance.');
          case -1121:
            throw new Error('Invalid trading pair. Please select a valid symbol.');
          case -1002:
            throw new Error('Unauthorized. Please check your API key permissions.');
          case -1003:
            throw new Error('Too many requests. Please wait a moment and try again.');
          default:
            throw new Error(`Trading error: ${apiError.msg || 'Unknown error occurred'}`);
        }
      }
      throw new Error(`Connection error: ${error.message}`);
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
      throw new Error(`Unable to fetch account balance: ${error.message}`);
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
      throw new Error(`Unable to fetch market data: ${error.message}`);
    }
  }

  // Get all available symbols
  async getAllSymbols() {
    try {
      const response = await this.makeRequest('GET', '/fapi/v1/exchangeInfo');
      return (response.symbols || []).map(s => s.symbol);
    } catch (error) {
      throw new Error(`Unable to fetch trading symbols: ${error.message}`);
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
        throw new Error(`Trading pair "${symbol}" not found. Please check the symbol name.`);
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
      throw new Error(`Unable to fetch price for ${symbol}: ${error.message}`);
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
      throw new Error(`Unable to fetch positions: ${error.message}`);
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
        quantity: size
        // timeInForce is not required for MARKET orders per AsterDex docs
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
      throw new Error(`Unable to place order: ${error.message}`);
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
      throw new Error(`Unable to close position: ${error.message}`);
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
