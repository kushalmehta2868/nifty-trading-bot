from flask import Flask, request, jsonify
from flask_cors import CORS
import pandas as pd
import numpy as np
from datetime import datetime
import logging
import os
from price_prediction_model import TradingAIPredictionModel
from sentiment_analyzer import SentimentAnalyzer

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = Flask(__name__)
CORS(app)

# Global model instances
ai_model = TradingAIPredictionModel()
sentiment_analyzer = SentimentAnalyzer()

# Model status
model_loaded = False
model_last_trained = None

@app.route('/health', methods=['GET'])
def health_check():
    """Health check endpoint"""
    return jsonify({
        'status': 'healthy',
        'model_loaded': model_loaded,
        'model_last_trained': model_last_trained,
        'timestamp': datetime.now().isoformat()
    })

@app.route('/predict', methods=['POST'])
def predict_price_movement():
    """
    🔮 Main prediction endpoint for trading decisions
    
    Expected input:
    {
        "indexName": "NIFTY",
        "currentPrice": 25000,
        "indicators": {
            "ema": 24950,
            "rsi": 65,
            "bollingerBands": {...},
            "momentum": 0.02,
            "volatility": 0.18
        },
        "marketConditions": {
            "trend": "BULLISH",
            "volatilityRegime": "MEDIUM",
            "timeOfDay": "OPENING"
        }
    }
    """
    try:
        if not model_loaded:
            return jsonify({'error': 'AI models not loaded'}), 500
        
        data = request.get_json()
        
        # Validate input
        required_fields = ['indexName', 'currentPrice', 'indicators']
        for field in required_fields:
            if field not in data:
                return jsonify({'error': f'Missing required field: {field}'}), 400
        
        # Prepare market data for prediction
        market_data = prepare_market_data_for_prediction(data)
        
        # Get AI predictions
        predictions = ai_model.predict(market_data)
        
        # Get sentiment analysis (if available)
        sentiment_score = None
        try:
            sentiment_score = sentiment_analyzer.analyze_current_sentiment(data['indexName'])
        except Exception as e:
            logger.warning(f"Sentiment analysis failed: {e}")
        
        # Combine predictions with trading recommendations
        trading_signal = generate_trading_recommendation(predictions, sentiment_score, data)
        
        response = {
            'success': True,
            'indexName': data['indexName'],
            'currentPrice': data['currentPrice'],
            'timestamp': datetime.now().isoformat(),
            'aiPredictions': predictions,
            'sentimentScore': sentiment_score,
            'tradingRecommendation': trading_signal,
            'confidence': calculate_overall_confidence(predictions, sentiment_score)
        }
        
        logger.info(f"Prediction for {data['indexName']}: {predictions}")
        return jsonify(response)
        
    except Exception as e:
        logger.error(f"Prediction error: {str(e)}")
        return jsonify({'error': 'Prediction failed', 'details': str(e)}), 500

@app.route('/sentiment/<index_name>', methods=['GET'])
def get_sentiment_analysis(index_name):
    """Get current sentiment analysis for an index"""
    try:
        sentiment_data = sentiment_analyzer.analyze_current_sentiment(index_name)
        
        return jsonify({
            'success': True,
            'indexName': index_name,
            'sentiment': sentiment_data,
            'timestamp': datetime.now().isoformat()
        })
        
    except Exception as e:
        logger.error(f"Sentiment analysis error: {str(e)}")
        return jsonify({'error': 'Sentiment analysis failed', 'details': str(e)}), 500

@app.route('/retrain', methods=['POST'])
def retrain_models():
    """Retrain AI models with new data"""
    try:
        global model_last_trained
        
        data = request.get_json()
        training_data_path = data.get('training_data_path', '../ai-data/training_data_latest.json')
        
        if not os.path.exists(training_data_path):
            return jsonify({'error': 'Training data not found'}), 404
        
        # Load and retrain models
        logger.info("Starting model retraining...")
        snapshots_df, outcomes_df = ai_model.load_training_data(training_data_path)
        training_df = ai_model.engineer_features(snapshots_df, outcomes_df)
        ai_model.train_models(training_df)
        ai_model.save_models('./models')
        
        model_last_trained = datetime.now().isoformat()
        
        return jsonify({
            'success': True,
            'message': 'Models retrained successfully',
            'trained_at': model_last_trained,
            'training_samples': len(training_df)
        })
        
    except Exception as e:
        logger.error(f"Retraining error: {str(e)}")
        return jsonify({'error': 'Retraining failed', 'details': str(e)}), 500

@app.route('/model-stats', methods=['GET'])
def get_model_statistics():
    """Get model performance statistics"""
    try:
        stats = {
            'model_loaded': model_loaded,
            'last_trained': model_last_trained,
            'available_models': list(ai_model.models.keys()),
            'feature_count': len(ai_model.feature_columns) if ai_model.feature_columns else 0,
            'features': ai_model.feature_columns if ai_model.feature_columns else []
        }
        
        return jsonify({
            'success': True,
            'statistics': stats,
            'timestamp': datetime.now().isoformat()
        })
        
    except Exception as e:
        logger.error(f"Statistics error: {str(e)}")
        return jsonify({'error': 'Failed to get statistics', 'details': str(e)}), 500

def prepare_market_data_for_prediction(data):
    """Convert API input to model format"""
    now = datetime.now()
    
    market_data = {
        'price': data['currentPrice'],
        'indexName': data['indexName'],
        'hour': now.hour,
        'minute': now.minute,
        'day_of_week': now.weekday(),
        'is_opening_hour': 9 <= now.hour < 11,
        'is_closing_hour': 14 <= now.hour < 16,
    }
    
    # Add technical indicators
    indicators = data.get('indicators', {})
    market_data.update({
        'ema': indicators.get('ema', 0),
        'rsi': indicators.get('rsi', 50),
        'momentum': indicators.get('momentum', 0),
        'volatility': indicators.get('volatility', 0.15)
    })
    
    # Add Bollinger Band features
    bb = indicators.get('bollingerBands', {})
    if bb:
        market_data.update({
            'bollingerBands.upper': bb.get('upper', 0),
            'bollingerBands.middle': bb.get('middle', 0),
            'bollingerBands.lower': bb.get('lower', 0),
            'bollingerBands.squeeze': bb.get('squeeze', False)
        })
    
    # Add market conditions
    conditions = data.get('marketConditions', {})
    market_data.update({
        'trend': conditions.get('trend', 'SIDEWAYS'),
        'volatilityRegime': conditions.get('volatilityRegime', 'MEDIUM'),
        'timeOfDay': conditions.get('timeOfDay', 'MID_DAY')
    })
    
    return market_data

def generate_trading_recommendation(predictions, sentiment_score, market_data):
    """Generate trading recommendation based on AI predictions"""
    
    recommendation = {
        'action': 'HOLD',  # BUY, SELL, HOLD
        'confidence': 0.5,
        'reasoning': [],
        'risk_level': 'MEDIUM',
        'position_size': 1.0  # Multiplier for normal position size
    }
    
    # Base recommendation on price direction prediction
    if 'direction' in predictions:
        direction = predictions['direction']
        direction_confidence = predictions.get('direction_confidence', 0.5)
        
        if direction == 'UP' and direction_confidence > 0.7:
            recommendation['action'] = 'BUY'
            recommendation['reasoning'].append(f"AI predicts upward movement ({direction_confidence:.2f} confidence)")
        elif direction == 'DOWN' and direction_confidence > 0.7:
            recommendation['action'] = 'SELL'
            recommendation['reasoning'].append(f"AI predicts downward movement ({direction_confidence:.2f} confidence)")
        else:
            recommendation['reasoning'].append(f"AI predicts {direction.lower()} movement with low confidence")
    
    # Factor in success probability
    if 'success_probability' in predictions:
        success_prob = predictions['success_probability']
        
        if success_prob > 0.8:
            recommendation['confidence'] = min(1.0, recommendation['confidence'] + 0.3)
            recommendation['reasoning'].append(f"High success probability ({success_prob:.2f})")
        elif success_prob < 0.4:
            recommendation['action'] = 'HOLD'
            recommendation['confidence'] = max(0.1, recommendation['confidence'] - 0.3)
            recommendation['reasoning'].append(f"Low success probability ({success_prob:.2f})")
    
    # Factor in sentiment analysis
    if sentiment_score:
        sentiment_value = sentiment_score.get('compound_score', 0)
        
        if sentiment_value > 0.3:
            if recommendation['action'] == 'BUY':
                recommendation['confidence'] = min(1.0, recommendation['confidence'] + 0.1)
            recommendation['reasoning'].append(f"Positive market sentiment ({sentiment_value:.2f})")
        elif sentiment_value < -0.3:
            if recommendation['action'] == 'SELL':
                recommendation['confidence'] = min(1.0, recommendation['confidence'] + 0.1)
            recommendation['reasoning'].append(f"Negative market sentiment ({sentiment_value:.2f})")
    
    # Adjust position size based on confidence and volatility
    volatility = market_data.get('volatility', 0.15)
    if volatility > 0.25:  # High volatility
        recommendation['position_size'] = 0.7  # Reduce position size
        recommendation['risk_level'] = 'HIGH'
    elif volatility < 0.10:  # Low volatility
        recommendation['position_size'] = 1.3  # Increase position size
        recommendation['risk_level'] = 'LOW'
    
    # Time-based adjustments
    hour = datetime.now().hour
    if hour >= 15:  # Near market close
        recommendation['position_size'] *= 0.8
        recommendation['reasoning'].append("Reduced size due to market close proximity")
    
    return recommendation

def calculate_overall_confidence(predictions, sentiment_score):
    """Calculate overall confidence score"""
    confidence_factors = []
    
    if 'direction_confidence' in predictions:
        confidence_factors.append(predictions['direction_confidence'])
    
    if 'success_probability' in predictions:
        confidence_factors.append(predictions['success_probability'])
    
    if sentiment_score and 'confidence' in sentiment_score:
        confidence_factors.append(sentiment_score['confidence'])
    
    if confidence_factors:
        return np.mean(confidence_factors)
    else:
        return 0.5

def initialize_models():
    """Initialize AI models on startup"""
    global model_loaded, model_last_trained
    
    try:
        # Try to load existing models
        if ai_model.load_models('./models'):
            model_loaded = True
            model_last_trained = "Loaded from disk"
            logger.info("✅ AI models loaded successfully")
        else:
            logger.warning("⚠️ No trained models found. Please train models first.")
            model_loaded = False
        
        # Initialize sentiment analyzer
        try:
            sentiment_analyzer.initialize()
            logger.info("✅ Sentiment analyzer initialized")
        except Exception as e:
            logger.warning(f"⚠️ Sentiment analyzer initialization failed: {e}")
            
    except Exception as e:
        logger.error(f"❌ Model initialization failed: {e}")
        model_loaded = False

if __name__ == '__main__':
    # Initialize models on startup
    initialize_models()
    
    # Start Flask server
    port = int(os.environ.get('AI_SERVICE_PORT', 5000))
    debug = os.environ.get('FLASK_ENV') == 'development'
    
    logger.info(f"🚀 Starting AI Prediction Service on port {port}")
    app.run(host='0.0.0.0', port=port, debug=debug)