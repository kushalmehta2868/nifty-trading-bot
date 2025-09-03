// Quick test script to validate the order flow fixes
// Run with: node test-order-flow.js

const { orderService } = require('./src/services/orderService');
const { strategy } = require('./src/services/strategy');

async function testOrderFlow() {
    console.log('🧪 Testing Order Flow Management...\n');
    
    // Test 1: Check initial state
    console.log('TEST 1: Initial State');
    strategy.logPositionStatusNow();
    orderService.logActiveOrdersStatus();
    
    // Test 2: Check position and cooldown status
    console.log('\nTEST 2: Position and Cooldown Status');
    const positions = strategy.getPositionStatus();
    const cooldowns = strategy.getSignalCooldowns();
    
    console.log('Positions:', positions);
    console.log('Cooldowns:', cooldowns);
    
    // Test 3: Force cleanup if needed
    console.log('\nTEST 3: Manual Cleanup Commands Available');
    console.log('strategy.resetPositions() - Reset locked positions');
    console.log('strategy.resetCooldowns() - Clear all cooldowns');
    console.log('orderService.forceCleanActiveOrders() - Clear all active orders');
    console.log('orderService.cleanupStaleOrders() - Remove stale orders');
    
    console.log('\n✅ Order flow test completed!');
}

// Run if called directly
if (require.main === module) {
    testOrderFlow().catch(console.error);
}

module.exports = { testOrderFlow };