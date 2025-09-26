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
            console.log('🔐 Generating V3 signature with params:', businessParams);
            
            const nonce = Math.trunc(Date.now() * 1000); // Microsecond timestamp
            console.log('📅 Generated nonce:', nonce);

            // Clean and prepare parameters (remove null/undefined values)
            const cleanParams = {};
            for (const [key, value] of Object.entries(businessParams)) {
                if (value !== null && value !== undefined) {
                    cleanParams[key] = value;
                }
            }

            // Add recvWindow and timestamp
            cleanParams.recvWindow = 50000;
            cleanParams.timestamp = Math.round(Date.now());
            console.log('🧹 Cleaned params:', cleanParams);

            // Convert all values to strings and sort alphabetically
            const stringParams = {};
            for (const [key, value] of Object.entries(cleanParams)) {
                stringParams[key] = String(value);
            }

            // Create JSON string with sorted keys
            const sortedParams = {};
            Object.keys(stringParams).sort().forEach(key => {
                sortedParams[key] = stringParams[key];
            });
            const jsonString = JSON.stringify(sortedParams);
            console.log('📝 JSON string for signing:', jsonString);

            // ABI encode the parameters: [string, address, address, uint256]
            const encoded = ethers.AbiCoder.defaultAbiCoder().encode(
                ['string', 'address', 'address', 'uint256'],
                [jsonString, this.mainWalletAddress, this.apiWalletAddress, nonce]
            );
            console.log('🔢 Encoded data:', encoded);

            // Generate Keccak hash
            const keccakHash = ethers.keccak256(encoded);
            console.log('🔐 Keccak hash:', keccakHash);

            // Sign the hash with the API wallet's private key
            const wallet = new ethers.Wallet(this.apiWalletPrivateKey);
            const signature = wallet.signingKey.sign(keccakHash).serialized;
            console.log('✍️ Generated signature:', signature);

            // Return the full authentication payload
            const authPayload = {
                user: this.mainWalletAddress,
                signer: this.apiWalletAddress,
                nonce: nonce.toString(),
                signature: signature,
            };
            console.log('📦 Final auth payload:', authPayload);
            
            return authPayload;
        } catch (error) {
            console.error('❌ V3 Signature generation error:', error);
            console.error('❌ Error stack:', error.stack);
            throw new Error(`Failed to generate v3 signature: ${error.message}`);
        }
    }
    
    /**
     * Places a futures order. This now includes the critical price fetch and quantity calculation.
     */
    async placeOrder(orderData) {
        try {
            console.log('📈 Placing order with data:', orderData);
            const { symbol, side, size, type = 'MARKET', price = null } = orderData;

            // 1. Fetch exchange info to get quantity precision
            console.log('🔍 Fetching exchange info for symbol:', symbol);
            const exchangeInfoResponse = await this.futuresClient.get('/fapi/v1/exchangeInfo');
            const symbolInfo = exchangeInfoResponse.data.symbols.find(s => s.symbol === symbol);
            const quantityPrecision = symbolInfo?.quantityPrecision || 3;
            console.log('📏 Quantity precision for', symbol, ':', quantityPrecision);

            let quantity;
            if (type === 'MARKET') {
                // 2. Fetch the current price of the asset for market orders
                console.log('💰 Fetching current price for', symbol);
                const priceResponse = await this.futuresClient.get('/fapi/v1/ticker/price', { params: { symbol } });
                const currentPrice = parseFloat(priceResponse.data.price);
                console.log('💲 Current price:', currentPrice);
                
                if (!currentPrice || currentPrice <= 0) {
                    throw new Error(`Could not fetch a valid price for ${symbol}`);
                }
                // 3. Calculate the quantity in the base asset from the size in USDT
                quantity = size / currentPrice;
                console.log('📊 Calculated quantity:', quantity);
            } else {
                // For limit orders, use the provided price
                if (!price) {
                    throw new Error('Price is required for limit orders');
                }
                quantity = size / price;
                console.log('📊 Calculated quantity for limit order:', quantity);
            }

            // 4. Prepare the business parameters for the order
            const businessParams = {
                symbol: symbol,
                side: side === 'long' ? 'BUY' : 'SELL',
                positionSide: 'BOTH',
                type: type,
                quantity: quantity.toFixed(quantityPrecision), // Use dynamic precision from exchange info
                recvWindow: 5000,
                timestamp: (Date.now() - 1000).toString()
            };

            // Add price for limit orders
            if (type === 'LIMIT') {
                businessParams.price = price.toFixed(6);
                businessParams.timeInForce = 'GTC';
            }

            console.log('📋 Business params:', businessParams);

            // 5. Generate the v3 signature payload
            const authPayload = await this.generateV3Signature(businessParams);

            // 6. Combine business and auth params for the final request
            const requestParams = { ...businessParams, ...authPayload };
            console.log('📤 Final request params:', requestParams);

            const formData = new URLSearchParams();
            for (const key in requestParams) {
                formData.append(key, requestParams[key]);
            }

            console.log('🌐 Making POST request to /fapi/v3/order');
            const response = await this.futuresClient.post('/fapi/v3/order', formData, {
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
            });
            
            console.log('✅ Order response status:', response.status);
            console.log('📊 Order response data:', response.data);
            
            return response.data;

        } catch (error) {
            console.error('❌ placeOrder error:', error);
            console.error('❌ Error response:', error.response?.data);
            console.error('❌ Error status:', error.response?.status);
            console.error('❌ Error headers:', error.response?.headers);
            console.error('❌ Error stack:', error.stack);
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
            console.log('💰 Fetching account balance...');
            const businessParams = {};
            console.log('📋 Business params:', businessParams);
            
            const authPayload = await this.generateV3Signature(businessParams);
            const requestParams = { ...businessParams, ...authPayload };
            console.log('📤 Request params:', requestParams);
            
            console.log('🌐 Making GET request to /fapi/v2/balance');
            const response = await this.futuresClient.get('/fapi/v2/balance', {
                params: requestParams
            });
            
            console.log('✅ Balance response status:', response.status);
            console.log('📊 Balance response data:', response.data);
            
            const result = {
                available: response.data.availableBalance || 0,
                total: response.data.totalWalletBalance || 0,
                margin: response.data.totalMarginBalance || 0
            };
            console.log('💰 Processed balance result:', result);
            
            return result;
        } catch (error) {
            console.error('❌ getAccountBalance error:', error);
            console.error('❌ Error response:', error.response?.data);
            console.error('❌ Error status:', error.response?.status);
            console.error('❌ Error headers:', error.response?.headers);
            console.error('❌ Error stack:', error.stack);
            throw new Error(`Unable to fetch account balance: ${error.message}`);
        }
    }

    // Get spot account balance
    async getSpotAccountBalance() {
        try {
            console.log('💳 Fetching spot account balance...');
            const params = {
                recvWindow: 5000,
                timestamp: Date.now()
            };
            console.log('📋 Spot params:', params);
            
            const sortedParams = Object.keys(params).sort().map(key => `${key}=${params[key]}`).join('&');
            console.log('🔗 Sorted params string:', sortedParams);
            
            const signature = this.generateHmacSignature(sortedParams);
            console.log('🔐 HMAC signature:', signature);
            
            const finalQueryString = `${sortedParams}&signature=${signature}`;
            console.log('📤 Final query string:', finalQueryString);
            
            console.log('🌐 Making GET request to /api/v1/account');
            const response = await this.spotClient.get(`/api/v1/account?${finalQueryString}`, {
                headers: {
                    'X-MBX-APIKEY': this.apiKey,
                    'Content-Type': 'application/x-www-form-urlencoded'
                }
            });
            
            console.log('✅ Spot balance response status:', response.status);
            console.log('📊 Spot balance response data:', response.data);
            
            // Format balances for easy access
            const balances = {};
            if (response.data.balances) {
                response.data.balances.forEach(balance => {
                    balances[balance.asset] = parseFloat(balance.free) + parseFloat(balance.locked);
                });
            }
            
            console.log('💳 Processed spot balances:', balances);
            return balances;
        } catch (error) {
            console.error('❌ getSpotAccountBalance error:', error);
            console.error('❌ Error response:', error.response?.data);
            console.error('❌ Error status:', error.response?.status);
            console.error('❌ Error headers:', error.response?.headers);
            console.error('❌ Error stack:', error.stack);
            throw new Error(`Unable to fetch spot account balance: ${error.message}`);
        }
    }

    // Get available markets
    async getMarkets() {
        try {
            console.log('📈 Fetching available markets...');
            const response = await this.futuresClient.get('/fapi/v1/exchangeInfo');
            console.log('✅ Markets response status:', response.status);
            console.log('📊 Total symbols available:', response.data.symbols?.length || 0);
            
            const bnbMarkets = (response.data.symbols || [])
                .filter(symbol => symbol.symbol.includes('BNB'))
                .map(symbol => ({
                    symbol: symbol.symbol,
                    maxLeverage: symbol.maxLeverage || 100,
                    status: symbol.status
                }));
            
            console.log('📈 BNB markets found:', bnbMarkets.length);
            console.log('📈 BNB markets:', bnbMarkets);
            
            return bnbMarkets;
        } catch (error) {
            console.error('❌ getMarkets error:', error);
            console.error('❌ Error response:', error.response?.data);
            console.error('❌ Error status:', error.response?.status);
            console.error('❌ Error headers:', error.response?.headers);
            console.error('❌ Error stack:', error.stack);
            throw new Error(`Unable to fetch market data: ${error.message}`);
        }
    }

    // Get all available symbols
    async getAllSymbols() {
        try {
            console.log('🔍 Fetching all available symbols...');
            const response = await this.futuresClient.get('/fapi/v1/exchangeInfo');
            console.log('✅ Symbols response status:', response.status);
            
            const symbols = (response.data.symbols || []).map(s => s.symbol);
            console.log('🔍 Total symbols found:', symbols.length);
            console.log('🔍 First 10 symbols:', symbols.slice(0, 10));
            
            return symbols;
        } catch (error) {
            console.error('❌ getAllSymbols error:', error);
            console.error('❌ Error response:', error.response?.data);
            console.error('❌ Error status:', error.response?.status);
            console.error('❌ Error headers:', error.response?.headers);
            console.error('❌ Error stack:', error.stack);
            throw new Error(`Unable to fetch trading symbols: ${error.message}`);
        }
    }

    // Get price for a symbol
    async getPrice(symbol) {
        try {
            console.log('💰 Fetching price for symbol:', symbol);
            const response = await this.futuresClient.get('/fapi/v1/ticker/24hr', { params: { symbol } });
            console.log('✅ Price response status:', response.status);
            console.log('📊 Price response data:', response.data);
            
            const priceData = {
                price: parseFloat(response.data.lastPrice) || 0,
                change24h: parseFloat(response.data.priceChangePercent) || 0,
                high24h: parseFloat(response.data.highPrice) || 0,
                low24h: parseFloat(response.data.lowPrice) || 0,
                volume24h: parseFloat(response.data.volume) || 0
            };
            
            console.log('💰 Processed price data:', priceData);
            return priceData;
        } catch (error) {
            console.error('❌ getPrice error:', error);
            console.error('❌ Error response:', error.response?.data);
            console.error('❌ Error status:', error.response?.status);
            console.error('❌ Error headers:', error.response?.headers);
            console.error('❌ Error stack:', error.stack);
            throw new Error(`Unable to fetch price for ${symbol}: ${error.message}`);
        }
    }

    // Get user positions
    async getPositions(symbol = null) {
        try {
            console.log('📊 Fetching positions for symbol:', symbol || 'all');
            const businessParams = {};
            
            if (symbol) businessParams.symbol = symbol;
            console.log('📋 Business params:', businessParams);
            
            const authPayload = await this.generateV3Signature(businessParams);
            const requestParams = { ...businessParams, ...authPayload };
            console.log('📤 Request params:', requestParams);
            
            console.log('🌐 Making GET request to /fapi/v2/positionRisk');
            const response = await this.futuresClient.get('/fapi/v2/positionRisk', {
                params: requestParams
            });
            
            console.log('✅ Positions response status:', response.status);
            console.log('📊 Positions response data:', response.data);
            
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
            
            console.log('📊 Processed positions:', positions);
            return positions;
        } catch (error) {
            console.error('❌ getPositions error:', error);
            console.error('❌ Error response:', error.response?.data);
            console.error('❌ Error status:', error.response?.status);
            console.error('❌ Error headers:', error.response?.headers);
            console.error('❌ Error stack:', error.stack);
            throw new Error(`Unable to fetch positions: ${error.message}`);
        }
    }

    // Close position
    async closePosition(positionId) {
        try {
            console.log('🔒 Closing position for:', positionId);
            
            // First get the current position to determine the quantity and side
            const positions = await this.getPositions(positionId);
            console.log('📊 Found positions:', positions);
            
            if (positions.length === 0) {
                throw new Error(`No position found for ${positionId}`);
            }
            
            const position = positions[0];
            const quantity = position.size;
            console.log('📏 Position quantity:', quantity);
            
            // Determine the opposite side to close the position
            // If we have a long position (positive size), we need to SELL to close
            // If we have a short position (negative size), we need to BUY to close
            const side = quantity > 0 ? 'SELL' : 'BUY';
            console.log('🔄 Closing side:', side);
            
            // Create a new MARKET order with the opposite side to close the position
            const orderData = {
                symbol: positionId,
                side: side,
                size: Math.abs(quantity), // Use absolute value for size
                type: 'MARKET'
            };
            console.log('📋 Close order data:', orderData);
            
            // Use the existing placeOrder function to execute the closing order
            const result = await this.placeOrder(orderData);
            console.log('✅ Close position result:', result);
            
            return result;
        } catch (error) {
            console.error('❌ closePosition error:', error);
            console.error('❌ Error response:', error.response?.data);
            console.error('❌ Error status:', error.response?.status);
            console.error('❌ Error headers:', error.response?.headers);
            console.error('❌ Error stack:', error.stack);
            throw new Error(`Unable to close position: ${error.message}`);
        }
    }

    // Get order history
    async getOrderHistory(symbol = null, limit = 50) {
        try {
            console.log('📜 Fetching order history for symbol:', symbol || 'all', 'limit:', limit);
            const businessParams = {
                limit
            };
            
            if (symbol) businessParams.symbol = symbol;
            console.log('📋 Business params:', businessParams);
            
            const authPayload = await this.generateV3Signature(businessParams);
            const requestParams = { ...businessParams, ...authPayload };
            console.log('📤 Request params:', requestParams);
            
            const formData = new URLSearchParams();
            for (const key in requestParams) {
                formData.append(key, requestParams[key]);
            }
            
            console.log('🌐 Making POST request to /fapi/v1/allOrders');
            const response = await this.futuresClient.post('/fapi/v1/allOrders', formData, {
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
            });
            
            console.log('✅ Order history response status:', response.status);
            console.log('📊 Order history response data:', response.data);
            
            return response.data || [];
        } catch (error) {
            console.error('❌ getOrderHistory error:', error);
            console.error('❌ Error response:', error.response?.data);
            console.error('❌ Error status:', error.response?.status);
            console.error('❌ Error headers:', error.response?.headers);
            console.error('❌ Error stack:', error.stack);
            return [];
        }
    }

    // Get trading history
    async getTradingHistory(symbol = null, limit = 50) {
        try {
            console.log('💹 Fetching trading history for symbol:', symbol || 'all', 'limit:', limit);
            const businessParams = {
                limit
            };
            
            if (symbol) businessParams.symbol = symbol;
            console.log('📋 Business params:', businessParams);
            
            const authPayload = await this.generateV3Signature(businessParams);
            const requestParams = { ...businessParams, ...authPayload };
            console.log('📤 Request params:', requestParams);
            
            const formData = new URLSearchParams();
            for (const key in requestParams) {
                formData.append(key, requestParams[key]);
            }
            
            console.log('🌐 Making POST request to /fapi/v1/userTrades');
            const response = await this.futuresClient.post('/fapi/v1/userTrades', formData, {
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
            });
            
            console.log('✅ Trading history response status:', response.status);
            console.log('📊 Trading history response data:', response.data);
            
            return response.data || [];
        } catch (error) {
            console.error('❌ getTradingHistory error:', error);
            console.error('❌ Error response:', error.response?.data);
            console.error('❌ Error status:', error.response?.status);
            console.error('❌ Error headers:', error.response?.headers);
            console.error('❌ Error stack:', error.stack);
            return [];
        }
    }
}