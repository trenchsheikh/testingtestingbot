import axios from 'axios';
import crypto from 'crypto';
import { ethers } from 'ethers';

export class AsterAPI {
    // Constructor now accepts all necessary credentials for both Spot and Futures v3 APIs
    constructor(mainWalletAddress, apiWalletAddress, apiWalletPrivateKey, apiKey, apiSecret) {
        this.mainWalletAddress = mainWalletAddress;
        this.apiWalletAddress = apiWalletAddress;
        this.apiWalletPrivateKey = apiWalletPrivateKey;
        this.apiKey = apiKey; // For HMAC Spot API
        this.apiSecret = apiSecret; // For HMAC Spot API

        // Client for Futures API (v3)
        this.futuresClient = axios.create({
            baseURL: 'https://fapi.asterdex.com',
            timeout: 10000,
        });

        // Client for Spot API
        this.spotClient = axios.create({
            baseURL: 'https://sapi.asterdex.com',
            timeout: 10000,
        });
    }

    /**
     * Generates an HMAC-SHA256 signature for Spot API requests.
     */
    generateHmacSignature(queryString) {
        return crypto.createHmac('sha256', this.apiSecret).update(queryString).digest('hex');
    }

    /**
     * Generates a Web3 signature for Futures v3 API requests.
     */
    async generateV3Signature(businessParams) {
        try {
            const nonce = Date.now() * 1000; // Microsecond timestamp

            // Sort business parameters alphabetically and create JSON string
            const sortedParams = Object.keys(businessParams)
                .sort()
                .reduce((obj, key) => {
                    obj[key] = businessParams[key];
                    return obj;
                }, {});
            
            const jsonString = JSON.stringify(sortedParams);

            // The data to be hashed, as per the documentation
            const dataToHash = ethers.solidityPackedKeccak256(
                ['string', 'address', 'address', 'uint256'],
                [jsonString, this.mainWalletAddress, this.apiWalletAddress, nonce]
            );

            // Sign the hash with the API wallet's private key
            const wallet = new ethers.Wallet(this.apiWalletPrivateKey);
            const signature = await wallet.signMessage(ethers.getBytes(dataToHash));

            // Return the full authentication payload
            return {
                user: this.mainWalletAddress,
                signer: this.apiWalletAddress,
                nonce: nonce.toString(),
                signature: signature,
            };
        } catch (error) {
            console.error('V3 Signature generation error:', error);
            throw new Error(`Failed to generate v3 signature: ${error.message}`);
        }
    }
    
    /**
     * Places a futures order. This now includes the critical price fetch and quantity calculation.
     */
    async placeOrder(orderData) {
        try {
            const { symbol, side, size } = orderData;

            // 1. Fetch the current price of the asset
            const priceResponse = await this.futuresClient.get('/fapi/v1/ticker/price', { params: { symbol } });
            const currentPrice = parseFloat(priceResponse.data.price);
            if (!currentPrice || currentPrice <= 0) {
                throw new Error(`Could not fetch a valid price for ${symbol}`);
            }

            // 2. Calculate the quantity in the base asset from the size in USDT
            const quantity = size / currentPrice;

            // 3. Prepare the business parameters for the order
            const businessParams = {
                symbol: symbol,
                side: side === 'long' ? 'BUY' : 'SELL',
                positionSide: 'BOTH',
                type: 'MARKET',
                quantity: quantity.toFixed(3), // Adjust precision as needed per symbol
                recvWindow: 5000,
                timestamp: (Date.now() - 1000).toString()
            };

            // 4. Generate the v3 signature payload
            const authPayload = await this.generateV3Signature(businessParams);

            // 5. Combine business and auth params for the final request
            const requestParams = { ...businessParams, ...authPayload };

            const formData = new URLSearchParams();
            for (const key in requestParams) {
                formData.append(key, requestParams[key]);
            }

            const response = await this.futuresClient.post('/fapi/v3/order', formData, {
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
            });
            
            return response.data;

        } catch (error) {
            console.error('V3 Order error details:', {
                message: error.message,
                status: error.response?.status,
                data: error.response?.data
            });
            throw new Error(`Unable to place order: ${error.message}`);
        }
    }

    /**
     * Transfers funds from the Spot account to the Futures account using the Spot API.
     */
    async transferSpotToFutures(asset, amount) {
        try {
            const params = {
                asset: asset,
                amount: amount.toString(),
                kindType: 'SPOT_FUTURE',
                clientTranId: `bot-transfer-${Date.now()}`,
                recvWindow: 5000,
                timestamp: (Date.now() - 1000).toString()
            };

            const sortedParams = Object.keys(params).sort().map(key => `${key}=${params[key]}`).join('&');
            const signature = this.generateHmacSignature(sortedParams);
            const finalQueryString = `${sortedParams}&signature=${signature}`;

            const response = await this.spotClient.post(`/api/v1/asset/wallet/transfer?${finalQueryString}`, null, {
                headers: {
                    'X-MBX-APIKEY': this.apiKey,
                    'Content-Type': 'application/x-www-form-urlencoded'
                }
            });

            return response.data;
        } catch (error) {
            console.error('Spot Transfer error details:', {
                message: error.message,
                status: error.response?.status,
                data: error.response?.data,
            });
            throw new Error(`Unable to transfer from spot to futures: ${error.message}`);
        }
    }

    // Get account balance (Futures API)
    async getAccountBalance() {
        try {
            const businessParams = {
                recvWindow: 5000,
                timestamp: (Date.now() - 1000).toString()
            };
            
            const authPayload = await this.generateV3Signature(businessParams);
            const requestParams = { ...businessParams, ...authPayload };
            
            const formData = new URLSearchParams();
            for (const key in requestParams) {
                formData.append(key, requestParams[key]);
            }
            
            const response = await this.futuresClient.post('/fapi/v2/balance', formData, {
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
            });
            
            return {
                available: response.data.availableBalance || 0,
                total: response.data.totalWalletBalance || 0,
                margin: response.data.totalMarginBalance || 0
            };
        } catch (error) {
            throw new Error(`Unable to fetch account balance: ${error.message}`);
        }
    }

    // Get spot account balance
    async getSpotAccountBalance() {
        try {
            const params = {
                recvWindow: 5000,
                timestamp: (Date.now() - 1000).toString()
            };
            
            const sortedParams = Object.keys(params).sort().map(key => `${key}=${params[key]}`).join('&');
            const signature = this.generateHmacSignature(sortedParams);
            const finalQueryString = `${sortedParams}&signature=${signature}`;
            
            const response = await this.spotClient.get(`/api/v1/account?${finalQueryString}`, {
                headers: {
                    'X-MBX-APIKEY': this.apiKey,
                    'Content-Type': 'application/x-www-form-urlencoded'
                }
            });
            
            // Format balances for easy access
            const balances = {};
            if (response.data.balances) {
                response.data.balances.forEach(balance => {
                    balances[balance.asset] = parseFloat(balance.free) + parseFloat(balance.locked);
                });
            }
            
            return balances;
        } catch (error) {
            console.error('Spot balance error:', error.response?.data || error.message);
            throw new Error(`Unable to fetch spot account balance: ${error.message}`);
        }
    }

    // Get available markets
    async getMarkets() {
        try {
            const response = await this.futuresClient.get('/fapi/v1/exchangeInfo');
            const bnbMarkets = (response.data.symbols || [])
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
            const response = await this.futuresClient.get('/fapi/v1/exchangeInfo');
            return (response.data.symbols || []).map(s => s.symbol);
        } catch (error) {
            throw new Error(`Unable to fetch trading symbols: ${error.message}`);
        }
    }

    // Get price for a symbol
    async getPrice(symbol) {
        try {
            const response = await this.futuresClient.get('/fapi/v1/ticker/24hr', { params: { symbol } });
            return {
                price: parseFloat(response.data.lastPrice) || 0,
                change24h: parseFloat(response.data.priceChangePercent) || 0,
                high24h: parseFloat(response.data.highPrice) || 0,
                low24h: parseFloat(response.data.lowPrice) || 0,
                volume24h: parseFloat(response.data.volume) || 0
            };
        } catch (error) {
            throw new Error(`Unable to fetch price for ${symbol}: ${error.message}`);
        }
    }

    // Get user positions
    async getPositions(symbol = null) {
        try {
            const businessParams = {
                recvWindow: 5000,
                timestamp: (Date.now() - 1000).toString()
            };
            
            if (symbol) businessParams.symbol = symbol;
            
            const authPayload = await this.generateV3Signature(businessParams);
            const requestParams = { ...businessParams, ...authPayload };
            
            const formData = new URLSearchParams();
            for (const key in requestParams) {
                formData.append(key, requestParams[key]);
            }
            
            const response = await this.futuresClient.post('/fapi/v2/positionRisk', formData, {
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
            });
            
            const positions = (response.data || [])
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

    // Close position
    async closePosition(positionId) {
        try {
            const businessParams = {
                symbol: positionId,
                side: 'SELL',
                type: 'MARKET',
                quantity: 0,
                reduceOnly: true,
                recvWindow: 5000,
                timestamp: (Date.now() - 1000).toString()
            };
            
            const authPayload = await this.generateV3Signature(businessParams);
            const requestParams = { ...businessParams, ...authPayload };
            
            const formData = new URLSearchParams();
            for (const key in requestParams) {
                formData.append(key, requestParams[key]);
            }
            
            const response = await this.futuresClient.post('/fapi/v1/order', formData, {
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
            });
            
            return response.data;
        } catch (error) {
            throw new Error(`Unable to close position: ${error.message}`);
        }
    }

    // Get order history
    async getOrderHistory(symbol = null, limit = 50) {
        try {
            const businessParams = {
                limit,
                recvWindow: 5000,
                timestamp: (Date.now() - 1000).toString()
            };
            
            if (symbol) businessParams.symbol = symbol;
            
            const authPayload = await this.generateV3Signature(businessParams);
            const requestParams = { ...businessParams, ...authPayload };
            
            const formData = new URLSearchParams();
            for (const key in requestParams) {
                formData.append(key, requestParams[key]);
            }
            
            const response = await this.futuresClient.post('/fapi/v1/allOrders', formData, {
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
            });
            
            return response.data.orders || [];
        } catch (error) {
            return [];
        }
    }

    // Get trading history
    async getTradingHistory(symbol = null, limit = 50) {
        try {
            const businessParams = {
                limit,
                recvWindow: 5000,
                timestamp: (Date.now() - 1000).toString()
            };
            
            if (symbol) businessParams.symbol = symbol;
            
            const authPayload = await this.generateV3Signature(businessParams);
            const requestParams = { ...businessParams, ...authPayload };
            
            const formData = new URLSearchParams();
            for (const key in requestParams) {
                formData.append(key, requestParams[key]);
            }
            
            const response = await this.futuresClient.post('/fapi/v1/userTrades', formData, {
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
            });
            
            return response.data.trades || [];
        } catch (error) {
            return [];
        }
    }
}