import pandas as pd
import numpy as np
import json
import pickle
from datetime import datetime, timedelta
from sklearn.model_selection import train_test_split, TimeSeriesSplit
from sklearn.ensemble import RandomForestRegressor, GradientBoostingRegressor
from sklearn.linear_model import LinearRegression
from sklearn.preprocessing import StandardScaler, LabelEncoder
from sklearn.metrics import mean_squared_error, mean_absolute_error, r2_score
import joblib
import matplotlib.pyplot as plt
import seaborn as sns

class TradingAIPredictionModel:
    """
    🤖 AI Model for NIFTY/BANKNIFTY Price Movement Prediction
    """
    
    def __init__(self):
        self.models = {
            'price_direction': None,  # Classification: UP, DOWN, SIDEWAYS
            'price_target': None,     # Regression: Expected price after 15/30/60 minutes
            'volatility': None,       # Regression: Expected volatility
            'success_probability': None  # Classification: Probability of target hit
        }
        self.scalers = {}
        self.feature_columns = []
        self.label_encoders = {}
        
    def load_training_data(self, json_file_path):
        """Load and preprocess training data from Node.js bot"""
        print("🔄 Loading training data...")
        
        with open(json_file_path, 'r') as f:
            data = json.load(f)
        
        # Convert market snapshots to DataFrame
        snapshots_df = pd.DataFrame(data['marketSnapshots'])
        
        # Convert trade outcomes to DataFrame
        outcomes_df = pd.DataFrame(data['tradeOutcomes'])
        
        print(f"📊 Loaded {len(snapshots_df)} market snapshots")
        print(f"🎯 Loaded {len(outcomes_df)} trade outcomes")
        
        return snapshots_df, outcomes_df
    
    def engineer_features(self, snapshots_df, outcomes_df):
        """Create advanced features for ML models"""
        print("🔧 Engineering features...")
        
        # Time-based features
        snapshots_df['timestamp'] = pd.to_datetime(snapshots_df['timestamp'], unit='ms')
        snapshots_df['hour'] = snapshots_df['timestamp'].dt.hour
        snapshots_df['minute'] = snapshots_df['timestamp'].dt.minute
        snapshots_df['day_of_week'] = snapshots_df['timestamp'].dt.dayofweek
        snapshots_df['is_opening_hour'] = (snapshots_df['hour'] >= 9) & (snapshots_df['hour'] < 11)
        snapshots_df['is_closing_hour'] = (snapshots_df['hour'] >= 14) & (snapshots_df['hour'] < 16)
        
        # Technical indicator features
        for col in ['indicators']:
            if col in snapshots_df.columns and isinstance(snapshots_df[col].iloc[0], dict):
                indicators_df = pd.json_normalize(snapshots_df[col])
                snapshots_df = pd.concat([snapshots_df, indicators_df], axis=1)
        
        # Market condition features
        for col in ['marketConditions']:
            if col in snapshots_df.columns and isinstance(snapshots_df[col].iloc[0], dict):
                conditions_df = pd.json_normalize(snapshots_df[col])
                snapshots_df = pd.concat([snapshots_df, conditions_df], axis=1)
        
        # Price momentum features
        snapshots_df = snapshots_df.sort_values(['indexName', 'timestamp'])
        for window in [5, 10, 20]:
            snapshots_df[f'price_change_{window}'] = snapshots_df.groupby('indexName')['price'].pct_change(window)
            snapshots_df[f'price_ma_{window}'] = snapshots_df.groupby('indexName')['price'].rolling(window).mean().reset_index(0, drop=True)
            
        # Volatility features
        for window in [10, 20]:
            snapshots_df[f'price_volatility_{window}'] = snapshots_df.groupby('indexName')['price'].rolling(window).std().reset_index(0, drop=True)
        
        # RSI features
        if 'rsi' in snapshots_df.columns:
            snapshots_df['rsi_oversold'] = snapshots_df['rsi'] < 30
            snapshots_df['rsi_overbought'] = snapshots_df['rsi'] > 70
            snapshots_df['rsi_normalized'] = (snapshots_df['rsi'] - 50) / 50
        
        # Bollinger Band features
        if 'bollingerBands.upper' in snapshots_df.columns:
            snapshots_df['bb_position'] = (snapshots_df['price'] - snapshots_df['bollingerBands.lower']) / (snapshots_df['bollingerBands.upper'] - snapshots_df['bollingerBands.lower'])
            snapshots_df['bb_squeeze'] = snapshots_df['bollingerBands.squeeze'].astype(int)
        
        # Create target variables from trade outcomes
        target_df = self.create_target_variables(snapshots_df, outcomes_df)
        
        return target_df
    
    def create_target_variables(self, snapshots_df, outcomes_df):
        """Create target variables for different prediction tasks"""
        print("🎯 Creating target variables...")
        
        # Convert outcomes timestamp
        outcomes_df['entryTime'] = pd.to_datetime(outcomes_df['entryTime'], unit='ms')
        outcomes_df['exitTime'] = pd.to_datetime(outcomes_df['exitTime'], unit='ms')
        
        # Merge snapshots with nearest trade outcomes
        merged_df = []
        
        for _, outcome in outcomes_df.iterrows():
            # Find market snapshot closest to entry time
            index_snapshots = snapshots_df[snapshots_df['indexName'] == outcome.get('indexName', 'NIFTY')]
            time_diff = abs(index_snapshots['timestamp'] - outcome['entryTime'])
            closest_snapshot_idx = time_diff.idxmin()
            
            if pd.notna(closest_snapshot_idx):
                snapshot = snapshots_df.loc[closest_snapshot_idx].copy()
                
                # Add target variables
                snapshot['target_hit'] = 1 if outcome['outcome'] == 'TARGET_HIT' else 0
                snapshot['stop_loss_hit'] = 1 if outcome['outcome'] == 'STOP_LOSS_HIT' else 0
                snapshot['profit_loss_percent'] = outcome['profitLossPercent']
                snapshot['holding_duration_minutes'] = outcome['holdingDuration'] / (1000 * 60)
                
                # Price direction (classification target)
                if outcome['profitLossPercent'] > 2:
                    snapshot['price_direction'] = 'UP'
                elif outcome['profitLossPercent'] < -2:
                    snapshot['price_direction'] = 'DOWN'
                else:
                    snapshot['price_direction'] = 'SIDEWAYS'
                
                # Success probability (binary target)
                snapshot['trade_success'] = 1 if outcome['profitLossPercent'] > 0 else 0
                
                merged_df.append(snapshot)
        
        result_df = pd.DataFrame(merged_df)
        print(f"✅ Created {len(result_df)} training examples")
        
        return result_df
    
    def prepare_features(self, df):
        """Prepare feature matrix for training"""
        print("📋 Preparing feature matrix...")
        
        # Select numerical features
        feature_cols = [
            'price', 'hour', 'minute', 'day_of_week',
            'is_opening_hour', 'is_closing_hour'
        ]
        
        # Add technical indicators if available
        technical_cols = [col for col in df.columns if any(indicator in col.lower() for indicator in 
                         ['ema', 'rsi', 'momentum', 'volatility', 'bb_', 'price_change', 'price_ma'])]
        feature_cols.extend(technical_cols)
        
        # Add market condition features
        if 'trend' in df.columns:
            df['trend_bullish'] = (df['trend'] == 'BULLISH').astype(int)
            df['trend_bearish'] = (df['trend'] == 'BEARISH').astype(int)
            feature_cols.extend(['trend_bullish', 'trend_bearish'])
        
        if 'volatilityRegime' in df.columns:
            df['vol_high'] = (df['volatilityRegime'] == 'HIGH').astype(int)
            df['vol_medium'] = (df['volatilityRegime'] == 'MEDIUM').astype(int)
            feature_cols.extend(['vol_high', 'vol_medium'])
        
        # Filter existing columns
        available_cols = [col for col in feature_cols if col in df.columns]
        
        # Handle missing values
        X = df[available_cols].fillna(0)
        
        self.feature_columns = available_cols
        print(f"📊 Selected {len(available_cols)} features")
        
        return X
    
    def train_models(self, df):
        """Train multiple AI models"""
        print("🚀 Training AI models...")
        
        # Prepare features
        X = self.prepare_features(df)
        
        # Scale features
        self.scalers['main'] = StandardScaler()
        X_scaled = self.scalers['main'].fit_transform(X)
        
        # Train different models
        self.train_direction_model(X_scaled, df)
        self.train_success_probability_model(X_scaled, df)
        self.train_profit_regression_model(X_scaled, df)
        
        print("✅ All models trained successfully!")
    
    def train_direction_model(self, X_scaled, df):
        """Train price direction classification model"""
        if 'price_direction' not in df.columns:
            return
            
        print("📈 Training price direction model...")
        
        # Encode labels
        self.label_encoders['direction'] = LabelEncoder()
        y = self.label_encoders['direction'].fit_transform(df['price_direction'])
        
        # Split data with time series consideration
        tscv = TimeSeriesSplit(n_splits=3)
        best_score = 0
        best_model = None
        
        models_to_test = [
            ('RandomForest', RandomForestRegressor(n_estimators=100, random_state=42)),
            ('GradientBoosting', GradientBoostingRegressor(n_estimators=100, random_state=42))
        ]
        
        for name, model in models_to_test:
            scores = []
            for train_idx, val_idx in tscv.split(X_scaled):
                X_train, X_val = X_scaled[train_idx], X_scaled[val_idx]
                y_train, y_val = y[train_idx], y[val_idx]
                
                model.fit(X_train, y_train)
                score = model.score(X_val, y_val)
                scores.append(score)
            
            avg_score = np.mean(scores)
            print(f"   {name}: {avg_score:.4f} accuracy")
            
            if avg_score > best_score:
                best_score = avg_score
                best_model = model
        
        self.models['price_direction'] = best_model
        print(f"✅ Best direction model: {best_score:.4f} accuracy")
    
    def train_success_probability_model(self, X_scaled, df):
        """Train trade success probability model"""
        if 'trade_success' not in df.columns:
            return
            
        print("🎯 Training success probability model...")
        
        from sklearn.ensemble import RandomForestClassifier
        from sklearn.metrics import classification_report, roc_auc_score
        
        y = df['trade_success'].values
        
        # Split data
        X_train, X_test, y_train, y_test = train_test_split(
            X_scaled, y, test_size=0.2, random_state=42, stratify=y
        )
        
        # Train model
        model = RandomForestClassifier(n_estimators=200, random_state=42, class_weight='balanced')
        model.fit(X_train, y_train)
        
        # Evaluate
        y_pred = model.predict(X_test)
        y_pred_proba = model.predict_proba(X_test)[:, 1]
        
        accuracy = model.score(X_test, y_test)
        auc_score = roc_auc_score(y_test, y_pred_proba)
        
        print(f"✅ Success probability model: {accuracy:.4f} accuracy, {auc_score:.4f} AUC")
        print(classification_report(y_test, y_pred))
        
        self.models['success_probability'] = model
    
    def train_profit_regression_model(self, X_scaled, df):
        """Train profit/loss regression model"""
        if 'profit_loss_percent' not in df.columns:
            return
            
        print("💰 Training profit regression model...")
        
        y = df['profit_loss_percent'].values
        
        # Split data
        X_train, X_test, y_train, y_test = train_test_split(
            X_scaled, y, test_size=0.2, random_state=42
        )
        
        # Train model
        model = GradientBoostingRegressor(n_estimators=200, random_state=42)
        model.fit(X_train, y_train)
        
        # Evaluate
        y_pred = model.predict(X_test)
        mse = mean_squared_error(y_test, y_pred)
        mae = mean_absolute_error(y_test, y_pred)
        r2 = r2_score(y_test, y_pred)
        
        print(f"✅ Profit regression model: R²={r2:.4f}, MAE={mae:.4f}%, RMSE={np.sqrt(mse):.4f}%")
        
        self.models['price_target'] = model
    
    def predict(self, market_data):
        """Make predictions using trained models"""
        # Convert single prediction to DataFrame format
        if isinstance(market_data, dict):
            market_data = pd.DataFrame([market_data])
        
        # Prepare features
        X = self.prepare_features(market_data)
        X_scaled = self.scalers['main'].transform(X)
        
        predictions = {}
        
        # Price direction prediction
        if self.models['price_direction']:
            direction_pred = self.models['price_direction'].predict(X_scaled)
            predictions['direction'] = self.label_encoders['direction'].inverse_transform([int(direction_pred[0])])[0]
            predictions['direction_confidence'] = max(self.models['price_direction'].predict_proba(X_scaled)[0])
        
        # Success probability
        if self.models['success_probability']:
            success_proba = self.models['success_probability'].predict_proba(X_scaled)[0, 1]
            predictions['success_probability'] = success_proba
        
        # Profit target prediction
        if self.models['price_target']:
            profit_pred = self.models['price_target'].predict(X_scaled)[0]
            predictions['expected_profit_percent'] = profit_pred
        
        return predictions
    
    def save_models(self, model_dir='./models'):
        """Save trained models to disk"""
        import os
        os.makedirs(model_dir, exist_ok=True)
        
        # Save models
        for name, model in self.models.items():
            if model is not None:
                joblib.dump(model, f'{model_dir}/{name}_model.pkl')
        
        # Save scalers and encoders
        joblib.dump(self.scalers, f'{model_dir}/scalers.pkl')
        joblib.dump(self.label_encoders, f'{model_dir}/label_encoders.pkl')
        joblib.dump(self.feature_columns, f'{model_dir}/feature_columns.pkl')
        
        print(f"✅ Models saved to {model_dir}")
    
    def load_models(self, model_dir='./models'):
        """Load trained models from disk"""
        try:
            for name in self.models.keys():
                model_path = f'{model_dir}/{name}_model.pkl'
                if os.path.exists(model_path):
                    self.models[name] = joblib.load(model_path)
            
            self.scalers = joblib.load(f'{model_dir}/scalers.pkl')
            self.label_encoders = joblib.load(f'{model_dir}/label_encoders.pkl')
            self.feature_columns = joblib.load(f'{model_dir}/feature_columns.pkl')
            
            print("✅ Models loaded successfully")
            return True
        except Exception as e:
            print(f"❌ Error loading models: {e}")
            return False

# Example usage and training script
if __name__ == "__main__":
    # Initialize model
    ai_model = TradingAIPredictionModel()
    
    # Load training data (exported from Node.js bot)
    training_file = "../ai-data/training_data_latest.json"
    
    try:
        snapshots_df, outcomes_df = ai_model.load_training_data(training_file)
        
        # Engineer features and create training dataset
        training_df = ai_model.engineer_features(snapshots_df, outcomes_df)
        
        # Train models
        ai_model.train_models(training_df)
        
        # Save trained models
        ai_model.save_models('./models')
        
        print("🎉 AI model training completed successfully!")
        
        # Example prediction
        sample_market_data = {
            'price': 25000,
            'hour': 10,
            'minute': 30,
            'day_of_week': 1,
            'is_opening_hour': True,
            'is_closing_hour': False,
            'ema': 24950,
            'rsi': 65,
            'momentum': 0.02,
            'volatility': 0.18
        }
        
        predictions = ai_model.predict(sample_market_data)
        print(f"\n🔮 Sample prediction: {predictions}")
        
    except FileNotFoundError:
        print(f"❌ Training data file not found: {training_file}")
        print("Please run the Node.js bot to collect training data first.")