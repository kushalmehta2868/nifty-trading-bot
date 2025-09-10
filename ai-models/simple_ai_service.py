#!/usr/bin/env python3
"""
🤖 Simple AI Trading Prediction Service
A lightweight version without TensorFlow/Seaborn dependencies
"""

from flask import Flask, request, jsonify
from flask_cors import CORS
import logging
import numpy as np
from datetime import datetime
import json
import os

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Initialize Flask app
app = Flask(__name__)
CORS(app)

class SimpleAIPredictor:
    """Simple AI predictor using statistical methods"""
    
    def __init__(self):
        self.model_loaded = True
        self.model_version = "1.0.0"
        
    def predict_direction(self, market_data):
        """Predict market direction using simple heuristics"""
        try:
            current_price = market_data.get('currentPrice', 0)
            indicators = market_data.get('indicators', {})
            
            # Get technical indicators
            ema = indicators.get('ema', current_price)
            rsi = indicators.get('rsi', 50)
            momentum = indicators.get('momentum', 0)
            volatility = indicators.get('volatility', 0.15)
            
            # Simple prediction logic
            score = 0
            confidence = 0.5
            
            # EMA trend
            if current_price > ema:
                score += 1
            elif current_price < ema:
                score -= 1
                
            # RSI conditions
            if rsi < 30:  # Oversold
                score += 1
            elif rsi > 70:  # Overbought
                score -= 1
                
            # Momentum
            if momentum > 0.01:
                score += 1
            elif momentum < -0.01:
                score -= 1
                
            # Determine direction and confidence
            if score > 0:
                direction = 'UP'
                confidence = min(0.85, 0.5 + (score * 0.15))
            elif score < 0:
                direction = 'DOWN'
                confidence = min(0.85, 0.5 + (abs(score) * 0.15))
            else:
                direction = 'SIDEWAYS'
                confidence = 0.4
                
            # Adjust for volatility (high volatility reduces confidence)
            if volatility > 0.25:
                confidence *= 0.8
                
            return {
                'direction': direction,
                'direction_confidence': confidence,
                'success_probability': confidence * 0.9,
                'expected_profit_percent': confidence * 2.5
            }
            
        except Exception as e:
            logger.error(f"Direction prediction error: {e}")
            return {
                'direction': 'SIDEWAYS',
                'direction_confidence': 0.3,
                'success_probability': 0.3,
                'expected_profit_percent': 0.5
            }
    
    def generate_trading_recommendation(self, prediction, market_data):
        """Generate trading recommendation"""
        try:
            direction = prediction.get('direction', 'SIDEWAYS')
            confidence = prediction.get('direction_confidence', 0.5)
            
            # Generate action based on direction and confidence
            if direction == 'UP' and confidence > 0.6:
                action = 'BUY'
                risk_level = 'LOW' if confidence > 0.8 else 'MEDIUM'
            elif direction == 'DOWN' and confidence > 0.6:
                action = 'SELL'
                risk_level = 'LOW' if confidence > 0.8 else 'MEDIUM'
            else:
                action = 'HOLD'
                risk_level = 'HIGH' if confidence < 0.4 else 'MEDIUM'
                
            # Position sizing based on confidence
            if confidence > 0.8:
                position_size = 1.0
            elif confidence > 0.6:
                position_size = 0.8
            elif confidence > 0.4:
                position_size = 0.5
            else:
                position_size = 0.3
                
            # Generate reasoning
            reasoning = []
            if direction != 'SIDEWAYS':
                reasoning.append(f"Technical indicators suggest {direction.lower()} movement")
            reasoning.append(f"Confidence level: {confidence:.1%}")
            reasoning.append(f"Risk assessment: {risk_level}")
            
            return {
                'action': action,
                'confidence': confidence,
                'reasoning': reasoning,
                'risk_level': risk_level,
                'position_size': position_size
            }
            
        except Exception as e:
            logger.error(f"Recommendation generation error: {e}")
            return {
                'action': 'HOLD',
                'confidence': 0.3,
                'reasoning': ['Error in analysis - holding position'],
                'risk_level': 'HIGH',
                'position_size': 0.3
            }

# Initialize predictor
ai_predictor = SimpleAIPredictor()

@app.route('/health', methods=['GET'])
def health_check():
    """Health check endpoint"""
    return jsonify({
        'status': 'healthy',
        'timestamp': datetime.now().isoformat(),
        'model_loaded': ai_predictor.model_loaded,
        'model_version': ai_predictor.model_version,
        'service': 'Simple AI Trading Predictor'
    })

@app.route('/predict', methods=['POST'])
def predict():
    """Main prediction endpoint"""
    try:
        data = request.get_json()
        
        if not data:
            return jsonify({
                'success': False,
                'error': 'No data provided'
            }), 400
            
        # Extract required fields
        index_name = data.get('indexName', 'UNKNOWN')
        current_price = data.get('currentPrice', 0)
        
        # Get AI prediction
        ai_prediction = ai_predictor.predict_direction(data)
        trading_recommendation = ai_predictor.generate_trading_recommendation(ai_prediction, data)
        
        # Calculate overall confidence
        overall_confidence = ai_prediction.get('direction_confidence', 0.5)
        
        response = {
            'success': True,
            'indexName': index_name,
            'currentPrice': current_price,
            'timestamp': datetime.now().isoformat(),
            'aiPredictions': ai_prediction,
            'tradingRecommendation': trading_recommendation,
            'confidence': overall_confidence,
            'model_version': ai_predictor.model_version
        }
        
        logger.info(f"Prediction generated for {index_name}: {trading_recommendation['action']} ({overall_confidence:.2f})")
        
        return jsonify(response)
        
    except Exception as e:
        logger.error(f"Prediction endpoint error: {e}")
        return jsonify({
            'success': False,
            'error': str(e),
            'timestamp': datetime.now().isoformat()
        }), 500

@app.route('/sentiment/<index_name>', methods=['GET'])
def get_sentiment(index_name):
    """Sentiment analysis endpoint (simplified)"""
    try:
        # Simple sentiment simulation
        base_sentiment = 0.1 if index_name == 'NIFTY' else -0.05
        
        # Add some randomness but keep it realistic
        import time
        np.random.seed(int(time.time()) % 1000)
        sentiment_noise = np.random.normal(0, 0.2)
        compound_score = np.clip(base_sentiment + sentiment_noise, -1, 1)
        
        # Determine sentiment label
        if compound_score > 0.3:
            sentiment_label = 'BULLISH'
        elif compound_score < -0.3:
            sentiment_label = 'BEARISH'
        else:
            sentiment_label = 'NEUTRAL'
            
        sentiment_data = {
            'success': True,
            'index_name': index_name,
            'timestamp': datetime.now().isoformat(),
            'sentiment': {
                'overall_score': compound_score * 0.8,
                'compound_score': compound_score,
                'confidence': 0.7,
                'sentiment_label': sentiment_label
            }
        }
        
        return jsonify(sentiment_data)
        
    except Exception as e:
        logger.error(f"Sentiment endpoint error: {e}")
        return jsonify({
            'success': False,
            'error': str(e),
            'timestamp': datetime.now().isoformat()
        }), 500

@app.route('/model-stats', methods=['GET'])
def get_model_stats():
    """Get model statistics"""
    return jsonify({
        'success': True,
        'model_version': ai_predictor.model_version,
        'model_type': 'Simple Statistical Predictor',
        'model_loaded': ai_predictor.model_loaded,
        'features_used': [
            'EMA', 'RSI', 'Momentum', 'Volatility'
        ],
        'last_updated': datetime.now().isoformat()
    })

if __name__ == '__main__':
    import os
    port = int(os.environ.get('PORT', 5000))
    
    logger.info("🤖 Starting Simple AI Trading Prediction Service...")
    logger.info("📊 Model: Simple Statistical Predictor")
    logger.info(f"🌐 Service will be available at: http://localhost:{port}")
    
    app.run(
        host='0.0.0.0',
        port=port,
        debug=False,
        use_reloader=False
    )