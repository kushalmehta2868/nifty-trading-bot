#!/usr/bin/env python3
import requests
import json
import time

def test_ai_service():
    """Test AI service functionality"""
    print("Testing AI Service...")
    
    base_url = "http://localhost:5000"
    
    # Test health endpoint
    try:
        response = requests.get(f"{base_url}/health", timeout=5)
        if response.status_code == 200:
            data = response.json()
            print(f"Health check passed: {data}")
        else:
            print(f"Health check failed: {response.status_code}")
            return False
    except Exception as e:
        print(f"Could not connect to AI service: {e}")
        return False
    
    # Test prediction endpoint
    test_data = {
        "indexName": "NIFTY",
        "currentPrice": 25000,
        "indicators": {
            "ema": 24950,
            "rsi": 65,
            "bollingerBands": {
                "upper": 25100,
                "middle": 25000,
                "lower": 24900,
                "squeeze": False
            },
            "momentum": 0.02,
            "volatility": 0.18,
            "support": 24800,
            "resistance": 25200
        },
        "marketConditions": {
            "trend": "BULLISH",
            "volatilityRegime": "MEDIUM",
            "timeOfDay": "OPENING"
        }
    }
    
    try:
        response = requests.post(f"{base_url}/predict", json=test_data, timeout=10)
        if response.status_code == 200:
            prediction = response.json()
            print(f"Prediction test passed:")
            print(f"   Action: {prediction.get('tradingRecommendation', {}).get('action', 'Unknown')}")
            print(f"   Confidence: {prediction.get('confidence', 0):.2f}")
            return True
        else:
            print(f"Prediction test failed: {response.status_code}")
            print(f"   Response: {response.text}")
            return False
    except Exception as e:
        print(f"Prediction test failed: {e}")
        return False

def test_sentiment_analysis():
    """Test sentiment analysis"""
    print("\nTesting Sentiment Analysis...")
    
    try:
        response = requests.get("http://localhost:5000/sentiment/NIFTY", timeout=10)
        if response.status_code == 200:
            sentiment = response.json()
            print(f"Sentiment analysis test passed:")
            print(f"   Sentiment: {sentiment.get('sentiment', {}).get('sentiment_label', 'Unknown')}")
            return True
        else:
            print(f"Sentiment analysis test failed: {response.status_code}")
            return False
    except Exception as e:
        print(f"Sentiment analysis test failed: {e}")
        return False

if __name__ == "__main__":
    print("Running AI System Tests...")
    
    print("Waiting for services to start...")
    time.sleep(5)
    
    success = True
    success &= test_ai_service()
    success &= test_sentiment_analysis()
    
    if success:
        print("\nAll tests passed! AI system is ready.")
    else:
        print("\nSome tests failed. Check the service logs.")