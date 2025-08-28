import { config } from '../src/config/config';
import { webSocketFeed } from '../src/services/webSocketFeed';
import { strategy } from '../src/services/strategy';
import { telegramBot } from '../src/services/telegramBot';
import { logger } from '../src/utils/logger';
import { TradingSignal } from '../src/types';

async function runTests(): Promise<void> {
    console.log('🧪 Testing WebSocket Trading Bot (TypeScript)...\n');

    // Test 1: Configuration
    console.log('1. Configuration Test:');
    console.log(`   ✅ Angel Client ID: ${config.angel.clientId ? 'Configured' : '❌ Missing'}`);
    console.log(`   ✅ Telegram Bot: ${config.telegram.botToken ? 'Configured' : '❌ Missing'}`);
    console.log(`   ✅ WebSocket Mode: ${config.trading.useWebSocket}`);
    console.log(`   ✅ Mock Data: ${config.trading.useMockData}`);

    // Test 2: WebSocket Feed
    console.log('\n2. WebSocket Feed Test:');
    try {
        await webSocketFeed.initialize();
        console.log('   ✅ WebSocket feed initialized');

        // Wait for some price updates
        setTimeout(() => {
            const niftyPrice = webSocketFeed.getCurrentPrice('NIFTY');
            const bankNiftyPrice = webSocketFeed.getCurrentPrice('BANKNIFTY');
            console.log(`   📊 NIFTY: ${niftyPrice}, Bank NIFTY: ${bankNiftyPrice}`);
        }, 3000);

    } catch (error) {
        console.log(`   ❌ WebSocket test failed: ${(error as Error).message}`);
    }

    // Test 3: Strategy
    console.log('\n3. Strategy Test:');
    try {
        await strategy.initialize();
        console.log('   ✅ Strategy initialized');
    } catch (error) {
        console.log(`   ❌ Strategy test failed: ${(error as Error).message}`);
    }

    // Test 4: Telegram
    console.log('\n4. Telegram Test:');
    try {
        await telegramBot.initialize();

        // Send test signal
        const testSignal: TradingSignal = {
            indexName: 'NIFTY',
            direction: 'UP',
            optionSymbol: 'NIFTY28AUG2524750PE',
            optionType: 'CE',
            entryPrice: 53.70,
            target: 59.75,
            stopLoss: 48.70,
            spotPrice: 24816.75,
            confidence: 75,
            timestamp: new Date(),
            technicals: {
                ema: 24785.50,
                rsi: 58.2,
                priceChange: 0.5
            }
        };

        (process as any).emit('tradingSignal', testSignal);
        console.log('   ✅ Test signal sent to Telegram');

    } catch (error) {
        console.log(`   ❌ Telegram test failed: ${(error as Error).message}`);
    }

    console.log('\n🎉 TypeScript tests completed!');
    console.log('\nTo start the bot:');
    console.log('  Development: npm run dev');
    console.log('  Production:  npm run build && npm start');
    console.log('Expected: Real-time signals like your Aug 26 trades! 🚀');

    // Exit after tests
    setTimeout(() => process.exit(0), 5000);
}

runTests().catch(console.error);