import axios from 'axios';
import crypto from 'crypto';
import { ethers } from 'ethers';
import { BNBWallet } from './bnb-wallet.js';

export class AsterAPI {
    constructor() {
        // -Added a 15-second timeout to all requests to prevent hangs ---
        const requestTimeout = 15000; 

        this.futuresClient = axios.create({ 
            baseURL: 'https://fapi.asterdex.com',
            timeout: requestTimeout
        });
        this.spotClient = axios.create({ 
            baseURL: 'https://sapi.asterdex.com',
            timeout: requestTimeout
        });
    }

    generateHmacSignature(queryString, apiSecret) {
        return crypto.createHmac('sha256', apiSecret).update(queryString).digest('hex');
    }

    
    /**
     * Places a futures order using v1 API with leverage support.
     */

    // --- NEW FUNCTION FOR CREATING API KEYS ---

    async createApiKeysForWallet(wallet) {
        try {

            // --- THIS IS THE CORRECTED SECTION ---
            // 1. Get Nonce using a properly formatted POST request
            const nonceParams = new URLSearchParams({
                address: wallet.address,
                userOperationType: 'CREATE_API_KEY'
            }).toString();

            const nonceResponse = await this.spotClient.post(
                '/api/v1/getNonce',
                nonceParams,
                {
                    headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
                }
            );
            console.log('✅ [DEBUG] Nonce response received:', nonceResponse.status);
            
            const nonce = nonceResponse.data;
            if (!nonce) throw new Error('Failed to retrieve nonce.');
            console.log(`✅ [DEBUG] Got nonce: ${nonce}`);
            // --- END OF CORRECTION ---

            // 2. Sign the specific message format required by the API
            console.log('✍️ [DEBUG] Signing message...');
            const message = `You are signing into Astherus ${nonce}`;
            const signature = await BNBWallet.signMessage(wallet.privateKey, message);
            console.log('✅ [DEBUG] Message signed successfully.');

            // 3. Prepare the parameters for the API key creation call
            console.log('🔧 [DEBUG] Preparing API key creation request...');
            const createKeyParams = new URLSearchParams({
                address: wallet.address,
                userOperationType: 'CREATE_API_KEY',
                userSignature: signature,
                desc: `tg_bot_${(Date.now() % 1000000).toString(36)}`, // Short, unique description
                timestamp: Date.now()
            }).toString();
            console.log('📤 [DEBUG] Create key params prepared');

            // 4. Make the createApiKey POST request
            console.log('🌐 [DEBUG] Making createApiKey request to /api/v1/createApiKey...');
            const createKeyResponse = await this.spotClient.post(
                '/api/v1/createApiKey', 
                createKeyParams,
                {
                    headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
                }
            );
            console.log('✅ [DEBUG] Create key response received:', createKeyResponse.status);
            console.log(`✅ [DEBUG] API keys generated for ${wallet.address}`);
            
            return createKeyResponse.data; // { apiKey, apiSecret }
        } catch (error) {
            console.error('❌ [DEBUG] createApiKeysForWallet error:', error.response?.data || error.message);
            console.error('❌ [DEBUG] Error stack:', error.stack);
            throw new Error(`Could not create API keys: ${error.message}`);
        }
    }

    // Function to test if a symbol is supported
    async testSymbolSupport(symbol, apiKey, apiSecret) {
        try {
            // Instead of placing an order, let's check if the symbol exists in exchange info
            console.log(`🔍 Checking symbol support for ${symbol}...`);
            
            // Get exchange info to check if symbol exists and is trading
            const exchangeInfoResponse = await this.futuresClient.get('/fapi/v1/exchangeInfo');
            const symbolInfo = exchangeInfoResponse.data.symbols.find(s => s.symbol === symbol);
            
            if (!symbolInfo) {
                console.log(`❌ Symbol ${symbol} not found in exchange info`);
                return { supported: false, maxLeverage: 1, lastTested: Date.now() };
            }
            
            if (symbolInfo.status !== 'TRADING') {
                console.log(`❌ Symbol ${symbol} is not trading (status: ${symbolInfo.status})`);
                return { supported: false, maxLeverage: 1, lastTested: Date.now() };
            }
            
            // Try to get leverage brackets for the symbol
            try {
                const leverageResponse = await this.futuresClient.get('/fapi/v1/leverageBracket', {
                    params: { symbol: symbol }
                });
                
                if (leverageResponse.data && leverageResponse.data.length > 0) {
                    const maxLeverage = Math.max(...leverageResponse.data.map(bracket => parseInt(bracket.leverage)));
                    console.log(`✅ Symbol ${symbol} is supported with max leverage ${maxLeverage}x`);
                    return { supported: true, maxLeverage, lastTested: Date.now() };
                }
            } catch (leverageError) {
                console.log(`⚠️ Could not get leverage info for ${symbol}, assuming supported with default leverage`);
            }
            
            // If we get here, symbol exists and is trading
            console.log(`✅ Symbol ${symbol} is supported (default leverage)`);
            return { supported: true, maxLeverage: 100, lastTested: Date.now() };
            
        } catch (error) {
            console.log(`❌ Error checking symbol support for ${symbol}:`, error.message);
            // If we can't check, assume it's supported (better to be permissive)
            return { supported: true, maxLeverage: 100, lastTested: Date.now() };
        }
    }

    async placeOrder(apiKey, apiSecret, orderData) {
        try {
            console.log('📈 Placing order with data:', orderData);
            const { symbol, side, size, type = 'MARKET', price = null, leverage = 1 } = orderData;

            // 1. Check if symbol is supported (quick check)
            console.log(`🔍 Checking symbol support for ${symbol}...`);
            const symbolTest = await this.testSymbolSupport(symbol, apiKey, apiSecret);
            if (!symbolTest.supported) {
                throw new Error(`❌ Symbol ${symbol} is not supported for trading. Please try a different symbol.`);
            }

            // Use the tested max leverage if it's lower than requested
            const maxLeverage = symbolTest.maxLeverage;
            if (leverage > maxLeverage) {
                console.log(`⚠️ Requested leverage ${leverage} exceeds max ${maxLeverage} for ${symbol}, using ${maxLeverage}`);
                leverage = maxLeverage;
            }

            // 2. Set leverage
            await this.setLeverage(apiKey, apiSecret, symbol, leverage);

            // 2. Fetch exchange info to get precision for the quantity
            const exchangeInfoResponse = await this.futuresClient.get('/fapi/v1/exchangeInfo');
            const symbolInfo = exchangeInfoResponse.data.symbols.find(s => s.symbol === symbol);
            if (!symbolInfo) throw new Error(`Invalid symbol: ${symbol}`);
            const quantityPrecision = symbolInfo.quantityPrecision;

            // 3. Fetch the current price to calculate quantity from USDT size
            const priceResponse = await this.futuresClient.get('/fapi/v1/ticker/price', { params: { symbol } });
            const currentPrice = parseFloat(priceResponse.data.price);
            if (!currentPrice || currentPrice <= 0) {
                throw new Error(`Could not fetch a valid price for ${symbol}`);
            }
            const quantity = size / currentPrice;

            // 4. Prepare order parameters
            const params = {
                symbol: symbol,
                side: side === 'long' ? 'BUY' : 'SELL',
                type: 'MARKET', // Force market orders for this flow
                quantity: quantity.toFixed(quantityPrecision),
                recvWindow: 5000,
                timestamp: Date.now()
            };

            // 5. Sign and send the order request
            const queryString = Object.keys(params).sort().map(key => `${key}=${params[key]}`).join('&');
            const signature = this.generateHmacSignature(queryString, apiSecret);
            const finalQueryString = `${queryString}&signature=${signature}`;

            const response = await this.futuresClient.post(`/fapi/v1/order?${finalQueryString}`, null, {
                headers: { 'X-MBX-APIKEY': apiKey, 'Content-Type': 'application/x-www-form-urlencoded' }
            });
            
            return response.data;
        } catch (error) {
            const errorMsg = error.response?.data?.msg || error.message;
            console.error('❌ placeOrder error:', errorMsg);
            
            // Provide more helpful error messages
            if (errorMsg.includes('not supported symbol') || error.response?.data?.code === -4095) {
                throw new Error(`❌ **Trading Pair Not Supported**\n${orderData.symbol} is not available for trading. Please try a different symbol.`);
            } else if (errorMsg.includes('insufficient balance') || errorMsg.includes('margin') || errorMsg.includes('balance')) {
                throw new Error(`❌ **Empty Futures Account!**\nYou have no USDT in your futures account to trade with.\n\n**To fix this:**\n1. Use /deposit to add USDT to your futures account\n2. Or transfer from spot using the Transfer button`);
            } else if (errorMsg.includes('leverage')) {
                throw new Error(`❌ **Invalid Leverage**\nThe leverage amount is too high for ${orderData.symbol}. Please try a lower leverage (1x-10x).`);
            } else if (errorMsg.includes('quantity') || errorMsg.includes('size')) {
                throw new Error(`❌ **Position Size Too Large**\nYour position size exceeds your available balance or trading limits.\n\n**Try:**\n• Smaller position size\n• Check your futures balance with /balance`);
            } else {
                throw new Error(`❌ **Trading Error**\n${errorMsg}\n\nPlease check your balance and try again.`);
            }
        }
    }


    /**
     * Sets leverage for a symbol using v1 API.
     */
    async setLeverage(apiKey, apiSecret, symbol, leverage) {
        try {
            console.log('⚡ Setting leverage for', symbol, 'to', leverage);
            
            const params = {
                symbol: symbol,
                leverage: leverage,
                recvWindow: 5000,
                timestamp: Date.now()
            };

            const queryString = Object.keys(params).sort().map(key => `${key}=${params[key]}`).join('&');
            const signature = this.generateHmacSignature(queryString, apiSecret);
            const finalQueryString = `${queryString}&signature=${signature}`;

            console.log('🌐 Making POST request to /fapi/v1/leverage');
            const response = await this.futuresClient.post(`/fapi/v1/leverage?${finalQueryString}`, null, {
                headers: {
                    'X-MBX-APIKEY': apiKey,
                    'Content-Type': 'application/x-www-form-urlencoded'
                }
            });
            
            console.log('✅ Leverage response status:', response.status);
            console.log('📊 Leverage response data:', response.data);
            
            return response.data;
        } catch (error) {
            console.error('❌ setLeverage error:', error);
            console.error('❌ Error response:', error.response?.data);
            throw new Error(`Unable to set leverage: ${error.message}`);
        }
    }

    /**
     * Transfers funds from the Spot account to the Futures account using the Spot API.
     */
    async transferSpotToFutures(apiKey, apiSecret, asset, amount) {
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
            const signature = this.generateHmacSignature(sortedParams, apiSecret);
            const finalQueryString = `${sortedParams}&signature=${signature}`;

            const response = await this.spotClient.post(`/api/v1/asset/wallet/transfer?${finalQueryString}`, null, {
                headers: {
                    'X-MBX-APIKEY': apiKey,
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

    // Get account balance (Futures API v1)
    async getAccountBalance(apiKey, apiSecret) {
        try {
            
            const params = {
                recvWindow: 5000,
                timestamp: Date.now()
            };
            
            const queryString = Object.keys(params).sort().map(key => `${key}=${params[key]}`).join('&');
            const signature = this.generateHmacSignature(queryString, apiSecret);
            const finalQueryString = `${queryString}&signature=${signature}`;
            const response = await this.futuresClient.get(`/fapi/v2/balance?${finalQueryString}`, {
                headers: {
                    'X-MBX-APIKEY': apiKey,
                    'Content-Type': 'application/x-www-form-urlencoded'
                }
            });
            
            
            const usdtBalance = response.data.find(asset => asset.asset === 'USDT');
            const result = {
                available: parseFloat(usdtBalance?.availableBalance || 0).toFixed(2),
                total: parseFloat(usdtBalance?.balance || 0).toFixed(2),
            };
            return result;
        } catch (error) {
            console.error('❌ [DEBUG] getAccountBalance error:', error);
            console.error('❌ [DEBUG] Error response:', error.response?.data);
            console.error('❌ [DEBUG] Error status:', error.response?.status);
            console.error('❌ [DEBUG] Error headers:', error.response?.headers);
            console.error('❌ [DEBUG] Error stack:', error.stack);
            throw new Error(`Unable to fetch account balance: ${error.message}`);
        }
    }

    // Get spot account balance
  // REPLACE this entire function in src/asterdex.js

  async getSpotAccountBalance(apiKey, apiSecret) {
    try {
        console.log('💳 Fetching spot account balance...');
        const params = {
            recvWindow: 5000,
            timestamp: Date.now()
        };
        
        const sortedParams = Object.keys(params).sort().map(key => `${key}=${params[key]}`).join('&');
        const signature = this.generateHmacSignature(sortedParams, apiSecret);
        const finalQueryString = `${sortedParams}&signature=${signature}`;
        
        console.log('🌐 Making GET request to /api/v1/account');
        const response = await this.spotClient.get(`/api/v1/account?${finalQueryString}`, {
            headers: {
                'X-MBX-APIKEY': apiKey
                // 'Content-Type' header removed from here
            }
        });
        
        console.log('✅ Spot balance response status:', response.status);
        
        const balances = {};
        if (response.data.balances) {
            // Filter for assets with a balance greater than 0
            const fundedBalances = response.data.balances.filter(balance => {
                const free = parseFloat(balance.free);
                const locked = parseFloat(balance.locked);
                return (free + locked) > 0;
            });

            fundedBalances.forEach(balance => {
                balances[balance.asset] = parseFloat(balance.free); // Show only available balance
            });
        }
        
        console.log('💳 Processed spot balances:', balances);
        return balances;

    } catch (error) {
        console.error('❌ getSpotAccountBalance error:', error.response?.data || error.message);
        throw new Error(`Unable to fetch spot account balance: ${error.response?.data?.msg || error.message}`);
    }
}



    //deposit from wallet to aster treasury

    async depositFromWallet(privateKey, amount) {
        const ASTER_TREASURY_ADDRESS = '0x128463A60784c4D3f46c23Af3f65Ed859Ba87974';
        
        // The ABI for the treasury contract's deposit function.
        // This is a standard pattern, assuming the function is named 'deposit'.
        const TREASURY_ABI = [
            "function deposit(address token, uint256 amount)"
        ];

        if (!process.env.BSC_RPC_URL) throw new Error("BSC_RPC_URL not configured.");
        const provider = new ethers.JsonRpcProvider(process.env.BSC_RPC_URL);
        const wallet = new ethers.Wallet(privateKey, provider);

        try {
            // --- Step 1: Approve the Treasury to spend USDT ---
            console.log('➡️ [DEPOSIT] Step 1: Approving USDT...');
            await BNBWallet.approveUsdt(privateKey, ASTER_TREASURY_ADDRESS, amount);
            
            // --- Step 2: Call the deposit function on the Treasury contract ---
            console.log('➡️ [DEPOSIT] Step 2: Calling deposit contract...');
            const treasuryContract = new ethers.Contract(ASTER_TREASURY_ADDRESS, TREASURY_ABI, wallet);
            const usdtContract = new ethers.Contract('0x55d398326f99059ff775485246999027b3197955', ['function decimals() view returns (uint8)'], provider);
            const decimals = await usdtContract.decimals();
            const amountToDeposit = ethers.parseUnits(amount.toString(), decimals);

            const tx = await treasuryContract.deposit('0x55d398326f99059ff775485246999027b3197955', amountToDeposit);
            await tx.wait(); // Wait for the deposit transaction to be mined
            
            console.log(`✅ [DEPOSIT] Deposit successful! TxHash: ${tx.hash}`);
            return tx;

        } catch (error) {
            console.error('❌ [DEPOSIT] Error during deposit process:', error);
            // Try to give a more user-friendly error
            if (error.code === 'INSUFFICIENT_FUNDS') {
                throw new Error("Insufficient BNB for gas fees.");
            }
            throw new Error(`Deposit failed: ${error.message}`);
        }
    }
    

//get all available markets
    async getLeverageBrackets(apiKey, apiSecret, symbol) {
            try {
                console.log(`🔧 Fetching leverage brackets for ${symbol}...`);
                const params = {
                    symbol: symbol,
                    recvWindow: 5000,
                    timestamp: Date.now()
                };

                const queryString = Object.keys(params).sort().map(key => `${key}=${params[key]}`).join('&');
                const signature = this.generateHmacSignature(queryString, apiSecret);
                const finalQueryString = `${queryString}&signature=${signature}`;

                const response = await this.futuresClient.get(`/fapi/v1/leverageBracket?${finalQueryString}`, {
                    headers: {
                        'X-MBX-APIKEY': apiKey
                    }
                });

                // The API returns bracket info for the symbol. The highest leverage is in the first bracket.
                if (response.data && response.data.brackets && response.data.brackets.length > 0) {
                    const maxLeverage = response.data.brackets[0].initialLeverage;
                    console.log(`✅ Max leverage for ${symbol} is ${maxLeverage}x`);
                    return maxLeverage;
                }

                // Fallback if data is not in the expected format
                console.warn(`Could not determine max leverage for ${symbol}, falling back to 100.`);
                return 100;
            } catch (error) {
                console.error(`❌ getLeverageBrackets error for ${symbol}:`, error.response?.data || error.message);
                throw new Error(`Unable to fetch leverage data for ${symbol}.`);
            }
}

    // Get available crypto markets
    async getMarkets() {
        try {
            console.log('📈 Fetching all available crypto markets...');
            const response = await this.futuresClient.get('/fapi/v1/exchangeInfo');
            
            const allSymbols = response.data.symbols || [];
            if (!Array.isArray(allSymbols)) {
                throw new Error("Exchange info did not return a valid list of symbols.");
            }

            const cryptoMarkets = [];
            const cryptoIdentifiers = ['USDT', 'BUSD', 'USDC', 'BTC', 'ETH'];

            allSymbols.forEach(symbol => {
                // Check if the symbol is a known crypto pair and is trading
                // Also filter out leveraged tokens
                if (cryptoIdentifiers.some(id => symbol.symbol.endsWith(id)) && 
                    symbol.status === 'TRADING' &&
                    !symbol.symbol.includes('UP') &&
                    !symbol.symbol.includes('DOWN') &&
                    !symbol.symbol.includes('BULL') &&
                    !symbol.symbol.includes('BEAR')) {
                    cryptoMarkets.push({
                        symbol: symbol.symbol,
                        status: symbol.status
                    });
                }
            });
            
            console.log(`📈 Crypto markets found: ${cryptoMarkets.length}`);
            
            // Now returns a simple array of crypto markets
            return cryptoMarkets;
        } catch (error) {
            console.error('❌ getMarkets error:', error.response?.data || error.message);
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
    async getPrice(apiKey, apiSecret, symbol) {
        try {
            console.log('💰 Fetching price for symbol:', symbol);
            
            // This is a signed endpoint, so we need a signature
            const params = {
                symbol: symbol,
                recvWindow: 5000,
                timestamp: Date.now()
            };

            const queryString = Object.keys(params).sort().map(key => `${key}=${params[key]}`).join('&');
            const signature = this.generateHmacSignature(queryString, apiSecret);
            const finalQueryString = `${queryString}&signature=${signature}`;

            const response = await this.futuresClient.get(`/fapi/v1/ticker/24hr?${finalQueryString}`, {
                 headers: { 'X-MBX-APIKEY': apiKey }
            });

            const priceData = {
                price: parseFloat(response.data.lastPrice) || 0,
                change24h: parseFloat(response.data.priceChangePercent) || 0,
                high24h: parseFloat(response.data.highPrice) || 0,
                low24h: parseFloat(response.data.lowPrice) || 0,
                volume24h: parseFloat(response.data.volume) || 0
            };
            
            return priceData;
        } catch (error) {
            console.error('❌ getPrice error:', error.response?.data || error.message);
            throw new Error(`Unable to fetch price for ${symbol}.`);
        }
    }

    // Get user positions (Futures API v1)
    async getPositions(apiKey, apiSecret, symbol = null) {
        try {
            console.log('📊 Fetching positions for symbol:', symbol || 'all');
            const params = {
                recvWindow: 5000,
                timestamp: Date.now()
            };
            
            if (symbol) params.symbol = symbol;
            console.log('📋 Position params:', params);
            
            const queryString = Object.keys(params).sort().map(key => `${key}=${params[key]}`).join('&');
            const signature = this.generateHmacSignature(queryString, apiSecret);
            const finalQueryString = `${queryString}&signature=${signature}`;
            
            console.log('🌐 Making GET request to /fapi/v2/positionRisk');
            const response = await this.futuresClient.get(`/fapi/v2/positionRisk?${finalQueryString}`, {
                headers: {
                    'X-MBX-APIKEY': apiKey,
                    'Content-Type': 'application/x-www-form-urlencoded'
                }
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

    // Close position (Futures API v1)
    async closePosition(apiKey, apiSecret, positionSymbol) {
        try {
            console.log('🔒 Closing position for:', positionSymbol);
            
            const positions = await this.getPositions(apiKey, apiSecret, positionSymbol);
            const position = positions.find(p => p.symbol === positionSymbol);
            
            if (!position) {
                throw new Error(`No open position found for ${positionSymbol}`);
            }
            
            // Determine the opposite side to close the position
            const sideToClose = position.size > 0 ? 'short' : 'long'; // If positionAmt is positive it's a LONG, so we SHORT to close.
            const quantityToClose = Math.abs(position.size);

            console.log(`📊 Position size to close: ${quantityToClose}. Closing with a ${sideToClose} order.`);

            // Use placeOrder to execute the closing trade
            return await this.placeOrder(apiKey, apiSecret, {
                symbol: positionSymbol,
                side: sideToClose,
                size: quantityToClose * position.markPrice, // Approximate USDT size
                type: 'MARKET'
            });
        } catch (error) {
            console.error('❌ closePosition error:', error.response?.data || error.message);
            throw new Error(`Unable to close position: ${error.response?.data?.msg || error.message}`);
        }
    }

    // Get order history
    async getOrderHistory(apiKey, apiSecret, symbol = null, limit = 50) {
        try {
            console.log('📜 Fetching order history for symbol:', symbol || 'all', 'limit:', limit);
            const businessParams = {
                limit
            };
            
            if (symbol) businessParams.symbol = symbol;
            console.log('📋 Business params:', businessParams);
            
            const params = {
                ...businessParams,
                recvWindow: 5000,
                timestamp: Date.now()
            };
            
            const queryString = Object.keys(params).sort().map(key => `${key}=${params[key]}`).join('&');
            const signature = this.generateHmacSignature(queryString, apiSecret);
            const finalQueryString = `${queryString}&signature=${signature}`;
            
            console.log('🌐 Making GET request to /fapi/v1/allOrders');
            const response = await this.futuresClient.get(`/fapi/v1/allOrders?${finalQueryString}`, {
                headers: {
                    'X-MBX-APIKEY': apiKey
                }
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
    async getTradingHistory(apiKey, apiSecret, symbol = null, limit = 50) {
        try {
            console.log('💹 Fetching trading history for symbol:', symbol || 'all', 'limit:', limit);
            const businessParams = {
                limit
            };
            
            if (symbol) businessParams.symbol = symbol;
            console.log('📋 Business params:', businessParams);
            
            const params = {
                ...businessParams,
                recvWindow: 5000,
                timestamp: Date.now()
            };
            
            const queryString = Object.keys(params).sort().map(key => `${key}=${params[key]}`).join('&');
            const signature = this.generateHmacSignature(queryString, apiSecret);
            const finalQueryString = `${queryString}&signature=${signature}`;
            
            console.log('🌐 Making GET request to /fapi/v1/userTrades');
            const response = await this.futuresClient.get(`/fapi/v1/userTrades?${finalQueryString}`, {
                headers: {
                    'X-MBX-APIKEY': apiKey
                }
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