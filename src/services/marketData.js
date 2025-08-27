const axios = require('axios');
const WebSocket = require('ws');
const logger = require('../utils/logger');

class MarketDataService {
    constructor() {
        this.niftyData = [];
        this.optionChain = new Map();
        this.isConnected = false;
    }

    async fetchNiftySpotPrice() {
        try {
            const response = await axios.get(
                'https://www.nseindia.com/api/equity-stockIndices?index=NIFTY%2050',
                {
                    headers: {
                        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                        'Accept': 'application/json'
                    }
                }
            );

            const niftyIndex = response.data.data.find(item => item.index === 'NIFTY 50');
            return {
                price: parseFloat(niftyIndex.last),
                change: parseFloat(niftyIndex.change),
                pChange: parseFloat(niftyIndex.pChange),
                timestamp: new Date()
            };
        } catch (error) {
            logger.error('Error fetching NIFTY spot price:', error.message);
            return null;
        }
    }

    async fetchOptionChain(expiry = 'current') {
        try {
            const response = await axios.get(
                'https://www.nseindia.com/api/option-chain-indices?symbol=NIFTY',
                {
                    headers: {
                        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                        'Accept': 'application/json'
                    }
                }
            );

            const optionData = response.data.records.data;
            const processedOptions = [];

            optionData.forEach(strike => {
                if (strike.CE) {
                    processedOptions.push({
                        type: 'CE',
                        strike: strike.strikePrice,
                        price: strike.CE.lastPrice,
                        volume: strike.CE.totalTradedVolume,
                        oi: strike.CE.openInterest,
                        iv: strike.CE.impliedVolatility,
                        delta: strike.CE.delta,
                        theta: strike.CE.theta,
                        vega: strike.CE.vega,
                        gamma: strike.CE.gamma
                    });
                }

                if (strike.PE) {
                    processedOptions.push({
                        type: 'PE',
                        strike: strike.strikePrice,
                        price: strike.PE.lastPrice,
                        volume: strike.PE.totalTradedVolume,
                        oi: strike.PE.openInterest,
                        iv: strike.PE.impliedVolatility,
                        delta: strike.PE.delta,
                        theta: strike.PE.theta,
                        vega: strike.PE.vega,
                        gamma: strike.PE.gamma
                    });
                }
            });

            return processedOptions;
        } catch (error) {
            logger.error('Error fetching option chain:', error.message);
            return [];
        }
    }

    async fetchBankNiftySpotPrice() {
        try {
            const response = await axios.get(
                'https://www.nseindia.com/api/equity-stockIndices?index=NIFTY%20BANK',
                {
                    headers: {
                        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                        'Accept': 'application/json'
                    }
                }
            );

            const bankNiftyIndex = response.data.data.find(item => item.index === 'NIFTY BANK');
            return {
                price: parseFloat(bankNiftyIndex.last),
                change: parseFloat(bankNiftyIndex.change),
                pChange: parseFloat(bankNiftyIndex.pChange),
                timestamp: new Date()
            };
        } catch (error) {
            logger.error('Error fetching Bank NIFTY spot price:', error.message);
            return null;
        }
    }

    async fetchBankNiftyOptionChain() {
        try {
            const response = await axios.get(
                'https://www.nseindia.com/api/option-chain-indices?symbol=BANKNIFTY',
                { /* same headers */ }
            );
            // Process Bank NIFTY options similar to NIFTY
        } catch (error) {
            logger.error('Error fetching Bank NIFTY option chain:', error.message);
            return [];
        }
    }

    async fetch5MinuteData(symbol, days = 1) {
        // Simulated 5-minute data - In production, use real-time data feed
        const data = [];
        const now = new Date();
        const startTime = new Date(now.getTime() - (days * 24 * 60 * 60 * 1000));

        for (let i = 0; i < (days * 24 * 12); i++) {
            const timestamp = new Date(startTime.getTime() + (i * 5 * 60 * 1000));
            const basePrice = 25000 + (Math.random() - 0.5) * 500;

            data.push({
                timestamp,
                open: basePrice + (Math.random() - 0.5) * 20,
                high: basePrice + Math.random() * 30,
                low: basePrice - Math.random() * 30,
                close: basePrice + (Math.random() - 0.5) * 20,
                volume: Math.floor(Math.random() * 1000000) + 500000
            });
        }

        return data;
    }
}

module.exports = new MarketDataService();
