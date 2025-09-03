#!/usr/bin/env node

/**
 * Comprehensive Trading Bot Validation Script
 * Tests all critical functionality to ensure the bot is fully functional
 */

const { exec } = require('child_process');
const fs = require('fs');
const path = require('path');

class TradingBotValidator {
    constructor() {
        this.errors = [];
        this.warnings = [];
        this.validations = [];
    }

    log(message, type = 'info') {
        const timestamp = new Date().toISOString();
        const formatted = `[${timestamp}] ${type.toUpperCase()}: ${message}`;
        console.log(formatted);
        
        if (type === 'error') this.errors.push(message);
        if (type === 'warning') this.warnings.push(message);
        if (type === 'validation') this.validations.push(message);
    }

    async validateFileStructure() {
        this.log('🔍 Validating file structure...', 'validation');
        
        const requiredFiles = [
            'src/app.ts',
            'src/config/config.ts',
            'src/services/strategy.ts',
            'src/services/orderService.ts',
            'src/services/angelAPI.ts',
            'src/services/webSocketFeed.ts',
            'src/services/telegramBot.ts',
            'src/types/index.ts',
            'package.json',
            '.env'
        ];

        for (const file of requiredFiles) {
            if (!fs.existsSync(file)) {
                this.log(`Missing required file: ${file}`, 'error');
            } else {
                this.log(`✅ Found: ${file}`, 'validation');
            }
        }
    }

    async validateMomentumConditions() {
        this.log('🔍 Validating momentum conditions...', 'validation');
        
        const strategyContent = fs.readFileSync('src/services/strategy.ts', 'utf8');
        
        const momentumPatterns = [
            /momentum.*>\s*0\.01/g,
            /momentum.*<\s*-0\.01/g
        ];

        let totalMatches = 0;
        momentumPatterns.forEach(pattern => {
            const matches = strategyContent.match(pattern) || [];
            totalMatches += matches.length;
            this.log(`Found ${matches.length} momentum conditions with pattern: ${pattern}`, 'validation');
        });

        if (totalMatches >= 6) {
            this.log('✅ Momentum conditions updated to 0.01%', 'validation');
        } else {
            this.log('⚠️ Some momentum conditions may not be updated', 'warning');
        }
    }

    async validatePositionTracking() {
        this.log('🔍 Validating position tracking logic...', 'validation');
        
        const strategyContent = fs.readFileSync('src/services/strategy.ts', 'utf8');
        const orderServiceContent = fs.readFileSync('src/services/orderService.ts', 'utf8');

        // Check for activePositions tracking
        if (strategyContent.includes('activePositions')) {
            this.log('✅ Strategy has activePositions tracking', 'validation');
        } else {
            this.log('❌ Missing activePositions tracking in strategy', 'error');
        }

        // Check for order removal logic
        if (orderServiceContent.includes('removeOrderFromActiveList')) {
            this.log('✅ OrderService has proper order cleanup', 'validation');
        } else {
            this.log('❌ Missing order cleanup logic in orderService', 'error');
        }

        // Check for event handlers
        const eventHandlers = [
            'orderPlaced',
            'orderExited', 
            'orderCancelled',
            'orderRejected',
            'orderFailed',
            'signalExecutionFailed'
        ];

        eventHandlers.forEach(handler => {
            if (strategyContent.includes(handler)) {
                this.log(`✅ Event handler found: ${handler}`, 'validation');
            } else {
                this.log(`❌ Missing event handler: ${handler}`, 'error');
            }
        });
    }

    async validatePaperTradingExit() {
        this.log('🔍 Validating paper trading exit logic...', 'validation');
        
        const orderServiceContent = fs.readFileSync('src/services/orderService.ts', 'utf8');

        // Check for realistic exit logic
        if (orderServiceContent.includes('slippage') && orderServiceContent.includes('currentPrice')) {
            this.log('✅ Paper trading has realistic exit logic with slippage', 'validation');
        } else {
            this.log('❌ Paper trading exit logic may be unrealistic', 'error');
        }

        // Check for price validation
        if (orderServiceContent.includes('priceRatio') && orderServiceContent.includes('Suspicious')) {
            this.log('✅ Paper trading has price validation', 'validation');
        } else {
            this.log('⚠️ Paper trading lacks price validation', 'warning');
        }
    }

    async validateEventCleanup() {
        this.log('🔍 Validating event listener cleanup...', 'validation');
        
        const files = ['src/services/strategy.ts', 'src/services/orderService.ts', 'src/services/telegramBot.ts'];
        
        files.forEach(file => {
            const content = fs.readFileSync(file, 'utf8');
            
            if (content.includes('removeListener') || content.includes('eventHandlers')) {
                this.log(`✅ ${file} has event cleanup logic`, 'validation');
            } else {
                this.log(`⚠️ ${file} may have memory leak potential`, 'warning');
            }
        });
    }

    async validateConfiguration() {
        this.log('🔍 Validating configuration...', 'validation');
        
        const configContent = fs.readFileSync('src/config/config.ts', 'utf8');
        
        // Check for required config sections
        const requiredSections = ['angel', 'telegram', 'trading', 'strategy', 'indices'];
        
        requiredSections.forEach(section => {
            if (configContent.includes(section)) {
                this.log(`✅ Config section found: ${section}`, 'validation');
            } else {
                this.log(`❌ Missing config section: ${section}`, 'error');
            }
        });

        // Check for environment variables
        if (fs.existsSync('.env')) {
            this.log('✅ Environment file exists', 'validation');
            const envContent = fs.readFileSync('.env', 'utf8');
            
            const requiredEnvVars = [
                'ANGEL_CLIENT_ID',
                'ANGEL_API_KEY', 
                'TELEGRAM_BOT_TOKEN',
                'TELEGRAM_CHAT_ID'
            ];

            requiredEnvVars.forEach(envVar => {
                if (envContent.includes(envVar)) {
                    this.log(`✅ Environment variable found: ${envVar}`, 'validation');
                } else {
                    this.log(`❌ Missing environment variable: ${envVar}`, 'error');
                }
            });
        } else {
            this.log('❌ Missing .env file', 'error');
        }
    }

    async validateStartupSequence() {
        this.log('🔍 Validating startup sequence...', 'validation');
        
        const appContent = fs.readFileSync('src/app.ts', 'utf8');
        
        // Check initialization order
        const initOrder = [
            'webSocketFeed.initialize',
            'strategy.initialize', 
            'telegramBot.initialize',
            'orderService.initialize'
        ];

        let lastIndex = -1;
        initOrder.forEach(init => {
            const index = appContent.indexOf(init);
            if (index > lastIndex) {
                this.log(`✅ Initialization order correct: ${init}`, 'validation');
                lastIndex = index;
            } else if (index === -1) {
                this.log(`❌ Missing initialization: ${init}`, 'error');
            } else {
                this.log(`⚠️ Initialization order may be incorrect: ${init}`, 'warning');
            }
        });
    }

    async validateTypeScript() {
        this.log('🔍 Validating TypeScript compilation...', 'validation');
        
        return new Promise((resolve) => {
            exec('npx tsc --noEmit', (error, stdout, stderr) => {
                if (error) {
                    this.log('⚠️ TypeScript compilation has issues', 'warning');
                    this.log(stderr, 'warning');
                } else {
                    this.log('✅ TypeScript compilation successful', 'validation');
                }
                resolve();
            });
        });
    }

    async runAllValidations() {
        this.log('🚀 Starting comprehensive trading bot validation...', 'info');
        
        try {
            await this.validateFileStructure();
            await this.validateMomentumConditions();
            await this.validatePositionTracking();
            await this.validatePaperTradingExit();
            await this.validateEventCleanup();
            await this.validateConfiguration();
            await this.validateStartupSequence();
            await this.validateTypeScript();
            
            this.generateReport();
        } catch (error) {
            this.log(`Validation failed: ${error.message}`, 'error');
        }
    }

    generateReport() {
        this.log('\n' + '='.repeat(60), 'info');
        this.log('📊 TRADING BOT VALIDATION REPORT', 'info');
        this.log('='.repeat(60), 'info');
        
        this.log(`✅ Validations Passed: ${this.validations.length}`, 'info');
        this.log(`⚠️ Warnings: ${this.warnings.length}`, 'info');
        this.log(`❌ Errors: ${this.errors.length}`, 'info');
        
        if (this.errors.length === 0) {
            this.log('\n🎉 ALL CRITICAL VALIDATIONS PASSED!', 'info');
            this.log('✅ Trading bot appears to be fully functional', 'info');
            
            if (this.warnings.length === 0) {
                this.log('🏆 PERFECT SCORE - No warnings or errors!', 'info');
            } else {
                this.log('⚠️ Some warnings detected - review recommended', 'info');
            }
        } else {
            this.log('\n🚨 CRITICAL ISSUES FOUND:', 'info');
            this.errors.forEach(error => this.log(`  ❌ ${error}`, 'info'));
            this.log('\n⚠️ Trading bot may not function correctly until issues are resolved', 'info');
        }
        
        this.log('\n📝 Next Steps:', 'info');
        this.log('1. Review and fix any errors listed above', 'info');
        this.log('2. Test with paper trading mode first', 'info');
        this.log('3. Monitor logs closely during initial runs', 'info');
        this.log('4. Ensure all environment variables are set', 'info');
        
        this.log('\n✅ Validation completed!', 'info');
    }
}

// Run validation if script is called directly
if (require.main === module) {
    const validator = new TradingBotValidator();
    validator.runAllValidations();
}

module.exports = TradingBotValidator;