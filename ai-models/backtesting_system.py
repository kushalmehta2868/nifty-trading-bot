import pandas as pd
import numpy as np
import json
from datetime import datetime, timedelta
import matplotlib.pyplot as plt
import seaborn as sns
from typing import Dict, List, Tuple
import logging
from dataclasses import dataclass
from price_prediction_model import TradingAIPredictionModel

logger = logging.getLogger(__name__)

@dataclass
class BacktestResult:
    """Results from backtesting"""
    strategy_name: str
    total_trades: int
    winning_trades: int
    losing_trades: int
    win_rate: float
    total_profit: float
    total_loss: float
    net_profit: float
    max_drawdown: float
    sharpe_ratio: float
    avg_trade_duration: float
    best_trade: float
    worst_trade: float
    profit_factor: float
    
class TradingBacktester:
    """
    📈 Backtesting System for AI-Enhanced Trading Strategies
    """
    
    def __init__(self):
        self.results = {}
        self.trade_log = []
        
    def load_historical_data(self, data_file: str) -> pd.DataFrame:
        """Load historical market data and signals for backtesting"""
        try:
            with open(data_file, 'r') as f:
                data = json.load(f)
            
            # Convert to DataFrame
            snapshots = pd.DataFrame(data['marketSnapshots'])
            outcomes = pd.DataFrame(data['tradeOutcomes'])
            
            # Merge data for backtesting
            merged_data = self.prepare_backtest_data(snapshots, outcomes)
            
            logger.info(f"📊 Loaded {len(merged_data)} data points for backtesting")
            return merged_data
            
        except Exception as e:
            logger.error(f"Failed to load historical data: {e}")
            return pd.DataFrame()
    
    def prepare_backtest_data(self, snapshots_df: pd.DataFrame, outcomes_df: pd.DataFrame) -> pd.DataFrame:
        """Prepare data for backtesting"""
        # Convert timestamps
        snapshots_df['timestamp'] = pd.to_datetime(snapshots_df['timestamp'], unit='ms')
        outcomes_df['entryTime'] = pd.to_datetime(outcomes_df['entryTime'], unit='ms')
        
        # Sort by timestamp
        snapshots_df = snapshots_df.sort_values('timestamp')
        outcomes_df = outcomes_df.sort_values('entryTime')
        
        # Add features for backtesting
        snapshots_df['hour'] = snapshots_df['timestamp'].dt.hour
        snapshots_df['day_of_week'] = snapshots_df['timestamp'].dt.day_of_week
        
        return snapshots_df
    
    def backtest_technical_only_strategy(self, data: pd.DataFrame) -> BacktestResult:
        """Backtest strategy using only technical analysis"""
        trades = []
        
        for idx, row in data.iterrows():
            # Simulate technical signal generation
            if self.should_generate_technical_signal(row):
                trade = self.simulate_trade(row, 'TECHNICAL_ONLY')
                if trade:
                    trades.append(trade)
        
        return self.calculate_backtest_results(trades, 'Technical Only')
    
    def backtest_ai_enhanced_strategy(self, data: pd.DataFrame, ai_model: TradingAIPredictionModel) -> BacktestResult:
        """Backtest strategy using AI-enhanced signals"""
        trades = []
        
        for idx, row in data.iterrows():
            # Generate technical signal
            if self.should_generate_technical_signal(row):
                # Get AI prediction
                ai_prediction = self.get_ai_prediction_for_backtest(row, ai_model)
                
                # Combine technical and AI signals
                enhanced_signal = self.combine_technical_ai_signals(row, ai_prediction)
                
                if enhanced_signal['should_trade']:
                    trade = self.simulate_trade(row, 'AI_ENHANCED', enhanced_signal)
                    if trade:
                        trades.append(trade)
        
        return self.calculate_backtest_results(trades, 'AI Enhanced')
    
    def backtest_ai_only_strategy(self, data: pd.DataFrame, ai_model: TradingAIPredictionModel) -> BacktestResult:
        """Backtest strategy using only AI predictions"""
        trades = []
        
        for idx, row in data.iterrows():
            # Get AI prediction
            ai_prediction = self.get_ai_prediction_for_backtest(row, ai_model)
            
            if ai_prediction and ai_prediction.get('confidence', 0) > 0.7:
                trade = self.simulate_trade(row, 'AI_ONLY', ai_prediction)
                if trade:
                    trades.append(trade)
        
        return self.calculate_backtest_results(trades, 'AI Only')
    
    def should_generate_technical_signal(self, row: pd.Series) -> bool:
        """Determine if technical conditions warrant a signal"""
        try:
            # Extract technical indicators
            indicators = row.get('indicators', {})
            if isinstance(indicators, str):
                indicators = json.loads(indicators)
            
            rsi = indicators.get('rsi', 50)
            ema = indicators.get('ema', 0)
            momentum = indicators.get('momentum', 0)
            
            # Simple technical signal logic
            bullish_conditions = (
                rsi < 70 and rsi > 30 and  # Not overbought/oversold
                momentum > 0.005 and      # Positive momentum
                row['price'] > ema        # Price above EMA
            )
            
            bearish_conditions = (
                rsi > 30 and rsi < 70 and  # Not overbought/oversold
                momentum < -0.005 and     # Negative momentum
                row['price'] < ema        # Price below EMA
            )
            
            return bullish_conditions or bearish_conditions
            
        except Exception:
            return False
    
    def get_ai_prediction_for_backtest(self, row: pd.Series, ai_model: TradingAIPredictionModel) -> Dict:
        """Get AI prediction for backtesting (simulated)"""
        try:
            # Prepare market data
            market_data = {
                'price': row['price'],
                'hour': row.get('hour', 10),
                'day_of_week': row.get('day_of_week', 1),
                'is_opening_hour': row.get('hour', 10) < 11,
                'is_closing_hour': row.get('hour', 10) > 14
            }
            
            # Add technical indicators if available
            indicators = row.get('indicators', {})
            if isinstance(indicators, str):
                indicators = json.loads(indicators)
                
            market_data.update({
                'ema': indicators.get('ema', 0),
                'rsi': indicators.get('rsi', 50),
                'momentum': indicators.get('momentum', 0),
                'volatility': indicators.get('volatility', 0.15)
            })
            
            # Get AI prediction
            prediction = ai_model.predict(market_data)
            return prediction
            
        except Exception as e:
            logger.debug(f"AI prediction failed for backtest: {e}")
            return None
    
    def combine_technical_ai_signals(self, row: pd.Series, ai_prediction: Dict) -> Dict:
        """Combine technical and AI signals"""
        result = {
            'should_trade': False,
            'confidence': 0.5,
            'direction': 'HOLD',
            'reasoning': []
        }
        
        if not ai_prediction:
            return result
        
        # Technical signal
        indicators = row.get('indicators', {})
        if isinstance(indicators, str):
            indicators = json.loads(indicators)
            
        tech_bullish = indicators.get('momentum', 0) > 0.005
        
        # AI signal
        ai_direction = ai_prediction.get('direction', 'SIDEWAYS')
        ai_confidence = ai_prediction.get('direction_confidence', 0.5)
        
        # Combine signals
        if ai_confidence > 0.7:
            if (tech_bullish and ai_direction == 'UP') or (not tech_bullish and ai_direction == 'DOWN'):
                result['should_trade'] = True
                result['confidence'] = min(0.95, ai_confidence + 0.1)
                result['direction'] = ai_direction
                result['reasoning'].append('Technical and AI agreement')
            elif ai_confidence > 0.8:  # High AI confidence overrides
                result['should_trade'] = True
                result['confidence'] = ai_confidence
                result['direction'] = ai_direction
                result['reasoning'].append('High AI confidence override')
        
        return result
    
    def simulate_trade(self, row: pd.Series, strategy_type: str, signal_data: Dict = None) -> Dict:
        """Simulate a trade based on the signal"""
        try:
            entry_price = row['price']
            
            # Determine trade direction
            if signal_data:
                direction = signal_data.get('direction', 'UP')
                confidence = signal_data.get('confidence', 0.6)
            else:
                # Default technical signal
                indicators = row.get('indicators', {})
                if isinstance(indicators, str):
                    indicators = json.loads(indicators)
                momentum = indicators.get('momentum', 0)
                direction = 'UP' if momentum > 0 else 'DOWN'
                confidence = 0.6
            
            # Calculate target and stop loss (20% SL, 30% target as configured)
            if direction == 'UP':
                target_price = entry_price * 1.30
                stop_loss_price = entry_price * 0.80
            else:
                target_price = entry_price * 0.70
                stop_loss_price = entry_price * 1.20
            
            # Simulate trade outcome (simplified)
            # In reality, this would use actual price movements
            outcome = self.simulate_trade_outcome(entry_price, target_price, stop_loss_price, confidence)
            
            trade = {
                'timestamp': row['timestamp'],
                'strategy': strategy_type,
                'direction': direction,
                'entry_price': entry_price,
                'target_price': target_price,
                'stop_loss_price': stop_loss_price,
                'exit_price': outcome['exit_price'],
                'outcome': outcome['result'],
                'profit_loss': outcome['profit_loss'],
                'profit_loss_percent': outcome['profit_loss_percent'],
                'confidence': confidence,
                'duration_minutes': outcome['duration_minutes']
            }
            
            return trade
            
        except Exception as e:
            logger.error(f"Trade simulation failed: {e}")
            return None
    
    def simulate_trade_outcome(self, entry_price: float, target_price: float, 
                             stop_loss_price: float, confidence: float) -> Dict:
        """Simulate realistic trade outcome based on confidence and market conditions"""
        
        # Probability of hitting target based on confidence
        target_probability = confidence * 0.7  # Max 70% chance even with high confidence
        
        # Random outcome based on probabilities
        rand = np.random.random()
        
        if rand < target_probability:
            # Target hit
            # Add some randomness to exit price (slippage, early exit, etc.)
            slippage_factor = np.random.uniform(0.95, 1.0)
            exit_price = target_price * slippage_factor
            result = 'TARGET_HIT'
            duration = np.random.randint(5, 120)  # 5 to 120 minutes
        else:
            # Stop loss or early exit
            if rand < target_probability + 0.6:  # 60% chance of SL after target miss
                # Stop loss hit
                slippage_factor = np.random.uniform(1.0, 1.05)
                exit_price = stop_loss_price * slippage_factor
                result = 'STOP_LOSS_HIT'
                duration = np.random.randint(2, 60)  # Faster exit on SL
            else:
                # Manual exit (breakeven or small profit/loss)
                exit_factor = np.random.uniform(0.98, 1.02)
                exit_price = entry_price * exit_factor
                result = 'MANUAL_EXIT'
                duration = np.random.randint(10, 90)
        
        profit_loss = exit_price - entry_price
        profit_loss_percent = (profit_loss / entry_price) * 100
        
        return {
            'exit_price': exit_price,
            'result': result,
            'profit_loss': profit_loss,
            'profit_loss_percent': profit_loss_percent,
            'duration_minutes': duration
        }
    
    def calculate_backtest_results(self, trades: List[Dict], strategy_name: str) -> BacktestResult:
        """Calculate comprehensive backtest results"""
        
        if not trades:
            return BacktestResult(
                strategy_name=strategy_name,
                total_trades=0,
                winning_trades=0,
                losing_trades=0,
                win_rate=0,
                total_profit=0,
                total_loss=0,
                net_profit=0,
                max_drawdown=0,
                sharpe_ratio=0,
                avg_trade_duration=0,
                best_trade=0,
                worst_trade=0,
                profit_factor=0
            )
        
        # Convert to DataFrame for easier analysis
        trades_df = pd.DataFrame(trades)
        
        # Basic statistics
        total_trades = len(trades)
        winning_trades = len(trades_df[trades_df['profit_loss_percent'] > 0])
        losing_trades = len(trades_df[trades_df['profit_loss_percent'] <= 0])
        win_rate = (winning_trades / total_trades) * 100 if total_trades > 0 else 0
        
        # Profit/Loss analysis
        profits = trades_df[trades_df['profit_loss_percent'] > 0]['profit_loss_percent']
        losses = trades_df[trades_df['profit_loss_percent'] <= 0]['profit_loss_percent']
        
        total_profit = profits.sum() if len(profits) > 0 else 0
        total_loss = abs(losses.sum()) if len(losses) > 0 else 0
        net_profit = total_profit - total_loss
        
        # Risk metrics
        returns = trades_df['profit_loss_percent'].values
        max_drawdown = self.calculate_max_drawdown(returns)
        sharpe_ratio = self.calculate_sharpe_ratio(returns)
        
        # Other metrics
        avg_trade_duration = trades_df['duration_minutes'].mean()
        best_trade = trades_df['profit_loss_percent'].max()
        worst_trade = trades_df['profit_loss_percent'].min()
        profit_factor = total_profit / total_loss if total_loss > 0 else float('inf')
        
        return BacktestResult(
            strategy_name=strategy_name,
            total_trades=total_trades,
            winning_trades=winning_trades,
            losing_trades=losing_trades,
            win_rate=win_rate,
            total_profit=total_profit,
            total_loss=total_loss,
            net_profit=net_profit,
            max_drawdown=max_drawdown,
            sharpe_ratio=sharpe_ratio,
            avg_trade_duration=avg_trade_duration,
            best_trade=best_trade,
            worst_trade=worst_trade,
            profit_factor=profit_factor
        )
    
    def calculate_max_drawdown(self, returns: np.ndarray) -> float:
        """Calculate maximum drawdown"""
        cumulative_returns = np.cumsum(returns)
        running_max = np.maximum.accumulate(cumulative_returns)
        drawdown = cumulative_returns - running_max
        return float(np.min(drawdown))
    
    def calculate_sharpe_ratio(self, returns: np.ndarray, risk_free_rate: float = 0.05) -> float:
        """Calculate Sharpe ratio"""
        if len(returns) == 0 or np.std(returns) == 0:
            return 0
        
        excess_returns = returns - (risk_free_rate / 252)  # Daily risk-free rate
        return float(np.mean(excess_returns) / np.std(excess_returns) * np.sqrt(252))
    
    def compare_strategies(self, results: List[BacktestResult]) -> pd.DataFrame:
        """Compare multiple strategy results"""
        comparison_data = []
        
        for result in results:
            comparison_data.append({
                'Strategy': result.strategy_name,
                'Total Trades': result.total_trades,
                'Win Rate (%)': f"{result.win_rate:.1f}%",
                'Net Profit (%)': f"{result.net_profit:.2f}%",
                'Max Drawdown (%)': f"{result.max_drawdown:.2f}%",
                'Sharpe Ratio': f"{result.sharpe_ratio:.2f}",
                'Profit Factor': f"{result.profit_factor:.2f}",
                'Avg Duration (min)': f"{result.avg_trade_duration:.1f}"
            })
        
        return pd.DataFrame(comparison_data)
    
    def generate_backtest_report(self, results: List[BacktestResult], output_file: str = None):
        """Generate comprehensive backtest report"""
        
        print("📊 TRADING STRATEGY BACKTEST REPORT")
        print("="*60)
        
        # Strategy comparison
        comparison_df = self.compare_strategies(results)
        print("\n📈 Strategy Comparison:")
        print(comparison_df.to_string(index=False))
        
        # Detailed results for each strategy
        for result in results:
            print(f"\n🎯 {result.strategy_name.upper()} STRATEGY DETAILS:")
            print("-" * 40)
            print(f"Total Trades: {result.total_trades}")
            print(f"Winning Trades: {result.winning_trades} ({result.win_rate:.1f}%)")
            print(f"Losing Trades: {result.losing_trades}")
            print(f"Best Trade: +{result.best_trade:.2f}%")
            print(f"Worst Trade: {result.worst_trade:.2f}%")
            print(f"Net Profit: {result.net_profit:.2f}%")
            print(f"Profit Factor: {result.profit_factor:.2f}")
            print(f"Max Drawdown: {result.max_drawdown:.2f}%")
            print(f"Sharpe Ratio: {result.sharpe_ratio:.2f}")
            print(f"Avg Trade Duration: {result.avg_trade_duration:.1f} minutes")
        
        # Save to file if specified
        if output_file:
            with open(output_file, 'w') as f:
                f.write("TRADING STRATEGY BACKTEST REPORT\\n")
                f.write("="*60 + "\\n\\n")
                f.write("Strategy Comparison:\\n")
                f.write(comparison_df.to_string(index=False) + "\\n\\n")
                
                for result in results:
                    f.write(f"{result.strategy_name.upper()} STRATEGY DETAILS:\\n")
                    f.write("-" * 40 + "\\n")
                    f.write(f"Total Trades: {result.total_trades}\\n")
                    f.write(f"Win Rate: {result.win_rate:.1f}%\\n")
                    f.write(f"Net Profit: {result.net_profit:.2f}%\\n")
                    f.write(f"Max Drawdown: {result.max_drawdown:.2f}%\\n")
                    f.write(f"Sharpe Ratio: {result.sharpe_ratio:.2f}\\n\\n")
            
            print(f"\\n💾 Report saved to: {output_file}")

# Example usage
if __name__ == "__main__":
    # Initialize backtester
    backtester = TradingBacktester()
    
    # Load historical data
    data_file = "../ai-data/training_data_latest.json"
    
    try:
        historical_data = backtester.load_historical_data(data_file)
        
        if not historical_data.empty:
            # Initialize AI model
            ai_model = TradingAIPredictionModel()
            
            # Try to load trained models
            if ai_model.load_models('./models'):
                print("✅ AI models loaded for backtesting")
                
                # Run backtests
                print("🚀 Running backtests...")
                
                # Technical only strategy
                tech_results = backtester.backtest_technical_only_strategy(historical_data)
                
                # AI enhanced strategy
                ai_enhanced_results = backtester.backtest_ai_enhanced_strategy(historical_data, ai_model)
                
                # AI only strategy
                ai_only_results = backtester.backtest_ai_only_strategy(historical_data, ai_model)
                
                # Generate report
                all_results = [tech_results, ai_enhanced_results, ai_only_results]
                backtester.generate_backtest_report(all_results, 'backtest_report.txt')
                
            else:
                print("❌ No trained AI models found. Please train models first.")
        else:
            print("❌ No historical data available for backtesting")
            
    except FileNotFoundError:
        print(f"❌ Training data file not found: {data_file}")
        print("Please run the Node.js bot to collect data first.")